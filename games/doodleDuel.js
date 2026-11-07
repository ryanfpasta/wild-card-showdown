'use strict';
// DOODLE DUEL - everyone gets a secret silly prompt and draws it with a finger.
// Drawings are shown one at a time, anonymously (optionally: guess which prompt each one was),
// then everyone votes for their favourite.
// Showdown Duel version: the contestants draw the SAME prompt and the audience votes.
const C = require('../config');
const DOODLES = require('../content/doodles');
const { shuffle, allDone } = require('./common');

const MAX_STROKES = 600;
const MAX_POINTS = 16000;       // per drawing (x,y pairs)
const MAX_STROKE_POINTS = 3000;

function artists(ctx) { return ctx.duel ? ctx.duel.contestants.filter(ctx.has) : ctx.participants(); }
function voters(ctx) {
  if (!ctx.duel) return ctx.participants();
  const a = ctx.duel.audience.filter(ctx.has);
  return a.length ? a : ctx.duel.contestants.filter(ctx.has);
}
function drawingId(ctx, pid) { return ctx.gameKey + '-' + ctx.round + '-' + (ctx.duel ? 'duel-' : '') + pid; }

function start(ctx) {
  const g = ctx.g = {
    phase: 'draw', prompts: {}, strokes: {}, points: {}, done: {},
    order: [], idx: 0, choices: [], guesses: {}, votes: {}, pts: {},
  };
  const same = ctx.duel ? ctx.pick('doodles', DOODLES) : null;
  for (const id of artists(ctx)) {
    g.prompts[id] = same || ctx.pick('doodles', DOODLES);
    g.strokes[id] = [];
    g.points[id] = 0;
  }
  const ms = Math.min(C.DRAW_MAX_MS, Math.max(10000, (ctx.settings.drawSecs || 180) * 1000));
  ctx.timer(ctx.ms(ms), () => endDraw(ctx));
}

function validStroke(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.p)) return null;
  const c = s.c | 0, w = s.s | 0;
  if (c < 0 || c >= C.BRUSH.length || w < 0 || w >= C.BRUSH_SIZES.length) return null;
  const p = s.p.slice(0, MAX_STROKE_POINTS * 2);
  if (p.length < 2 || p.length % 2) return null;
  for (let i = 0; i < p.length; i++) {
    const n = Math.round(p[i]);
    if (!Number.isFinite(n)) return null;
    p[i] = Math.max(0, Math.min(1000, n));
  }
  return { c, s: w, p };
}

function addStroke(g, pid, s) {
  const st = validStroke(s);
  if (!st || g.strokes[pid].length >= MAX_STROKES) return false;
  if (g.points[pid] + st.p.length / 2 > MAX_POINTS) return false;
  g.strokes[pid].push(st);
  g.points[pid] += st.p.length / 2;
  return true;
}

function endDraw(ctx) {
  const g = ctx.g;
  if (g.phase !== 'draw') return;
  g.order = shuffle(artists(ctx).filter(id => g.strokes[id] && g.strokes[id].length));
  for (const id of g.order) ctx.stat(id, 'doodleDrawn');
  if (!g.order.length) { g.phase = 'empty'; ctx.timer(5000, () => ctx.done()); return ctx.update(); }
  if (ctx.duel) return startVote(ctx);
  if (ctx.settings.doodleGuess) return startGuess(ctx, 0);
  startShow(ctx, 0);
}

// ----- one at a time: the gallery (no guessing) -----
function startShow(ctx, i) {
  const g = ctx.g;
  if (i >= g.order.length) return startVote(ctx);
  g.idx = i;
  g.phase = 'show';
  ctx.timer(C.SHOW_MS, () => startShow(ctx, i + 1));
  ctx.update();
}

// ----- one at a time: guess which prompt it was -----
function guessers(ctx) {
  const artist = ctx.g.order[ctx.g.idx];
  return ctx.participants().filter(id => id !== artist);
}

function startGuess(ctx, i) {
  const g = ctx.g;
  while (i < g.order.length && !ctx.has(g.order[i])) i++;
  if (i >= g.order.length) return startVote(ctx);
  g.idx = i;
  const artist = g.order[i];
  const real = g.prompts[artist];
  const others = shuffle(Object.keys(g.prompts).filter(id => id !== artist).map(id => g.prompts[id]));
  const decoys = shuffle(DOODLES.filter(d => d !== real && !others.includes(d)));
  const choices = [real, ...others.slice(0, 3)];
  while (choices.length < 4 && decoys.length) choices.push(decoys.pop());
  g.choices = shuffle(choices);
  g.phase = 'guess';
  g.guesses = {};
  g.pts = {};
  ctx.timer(ctx.ms(C.GUESS_MS), () => endGuess(ctx));
  ctx.update();
  check(ctx);
}

function endGuess(ctx) {
  const g = ctx.g;
  if (g.phase !== 'guess') return;
  const artist = g.order[g.idx];
  const real = g.choices.indexOf(g.prompts[artist]);
  const pts = {};
  const add = (id, n, kind) => { pts[id] = (pts[id] || 0) + ctx.award(id, n, kind); };
  for (const id of Object.keys(g.guesses)) {
    if (g.guesses[id] === real) { add(id, 100, 'correct'); add(artist, 50, 'art'); ctx.stat(id, 'doodleRight'); }
  }
  g.pts = pts;
  g.phase = 'guessReveal';
  ctx.timer(Math.round(C.REVEAL_MS * 0.75), () => startGuess(ctx, g.idx + 1));
  ctx.update();
}

// ----- favourites vote -----
function canVoteFor(ctx, pid, i) { const a = ctx.g.order[i]; return a !== undefined && a !== pid && ctx.has(a); }

function startVote(ctx) {
  const g = ctx.g;
  g.phase = 'vote';
  g.votes = {};
  ctx.timer(ctx.ms(C.VOTE_MS), () => endVote(ctx));
  ctx.update();
  check(ctx);
}

function endVote(ctx) {
  const g = ctx.g;
  if (g.phase !== 'vote') return;
  const pts = {};
  g.order.forEach((artist, i) => {
    const n = Object.values(g.votes).filter(v => v === i).length;
    ctx.stat(artist, 'doodleVotes', n);
    if (n) pts[artist] = (pts[artist] || 0) + ctx.award(artist, (ctx.duel ? C.DUEL_VOTE_PTS : 100) * n, ctx.duel ? 'duel' : 'vote');
  });
  g.pts = pts;
  g.phase = 'results';
  ctx.timer(C.REVEAL_MS + 3000, () => ctx.done());
  ctx.update();
}

// ----- plumbing -----
function message(ctx, pid, a, v) {
  const g = ctx.g;
  if (g.phase === 'draw' && g.strokes[pid]) {
    if (a === 'stroke') { if (!g.done[pid]) addStroke(g, pid, v); return; }   // no broadcast needed
    if (a === 'undo') { if (!g.done[pid] && g.strokes[pid].length) { const s = g.strokes[pid].pop(); g.points[pid] -= s.p.length / 2; } return; }
    if (a === 'sync') {
      if (g.done[pid] || !Array.isArray(v)) return;
      g.strokes[pid] = []; g.points[pid] = 0;
      for (const s of v.slice(0, MAX_STROKES)) addStroke(g, pid, s);
      return;
    }
    if (a === 'done') { g.done[pid] = !!v; ctx.update(); return check(ctx); }
    return;
  }
  if (a === 'guess') {
    if (g.phase !== 'guess' || g.guesses[pid] !== undefined || !guessers(ctx).includes(pid)) return;
    if (!Number.isInteger(v) || v < 0 || v >= g.choices.length) return;
    g.guesses[pid] = v;
  } else if (a === 'vote') {
    if (g.phase !== 'vote' || g.votes[pid] !== undefined || !voters(ctx).includes(pid)) return;
    if (!canVoteFor(ctx, pid, v)) return;
    g.votes[pid] = v;
  } else return;
  ctx.update();
  check(ctx);
}

function check(ctx) {
  const g = ctx.g;
  if (g.phase === 'draw' && allDone(ctx, artists(ctx), id => !!g.done[id])) endDraw(ctx);
  else if (g.phase === 'guess' && allDone(ctx, guessers(ctx), id => g.guesses[id] !== undefined)) endGuess(ctx);
  else if (g.phase === 'vote') {
    const vs = voters(ctx).filter(id => g.order.some((a, i) => canVoteFor(ctx, id, i)));
    if (!vs.length || allDone(ctx, vs, id => g.votes[id] !== undefined)) endVote(ctx);
  }
}

function waiting(ctx) {
  const g = ctx.g, out = {};
  if (g.phase === 'draw') for (const id of artists(ctx)) out[id] = !!g.done[id];
  else if (g.phase === 'guess') for (const id of guessers(ctx)) out[id] = g.guesses[id] !== undefined;
  else if (g.phase === 'vote') for (const id of voters(ctx)) out[id] = g.votes[id] !== undefined;
  else return null;
  return out;
}

// drawings this viewer needs: {id: strokes}
function drawings(ctx, pid) {
  const g = ctx.g, out = {};
  if (g.phase === 'draw') {
    if (pid && g.strokes[pid]) out[drawingId(ctx, pid)] = g.strokes[pid];   // so a reconnecting phone gets its doodle back
    return out;
  }
  if (g.phase === 'empty') return out;
  if (g.phase === 'vote' || g.phase === 'results') for (const a of g.order) out[drawingId(ctx, a)] = g.strokes[a];
  else { const a = g.order[g.idx]; if (a) out[drawingId(ctx, a)] = g.strokes[a]; }
  return out;
}

function view(ctx, pid) {
  const g = ctx.g;
  const v = { phase: g.phase };
  if (g.phase === 'draw') {
    v.artist = !!pid && !!g.strokes[pid];
    v.prompt = v.artist ? g.prompts[pid] : (ctx.duel && pid ? g.prompts[ctx.duel.contestants[0]] : null);
    v.myDrawing = v.artist ? drawingId(ctx, pid) : null;
    v.done = !!(pid && g.done[pid]);
    v.brush = C.BRUSH; v.sizes = C.BRUSH_SIZES;
    v.duelPrompt = ctx.duel ? g.prompts[ctx.duel.contestants[0]] : null;
    return v;
  }
  if (g.phase === 'empty') return v;
  const entry = i => ({ i, drawing: drawingId(ctx, g.order[i]), mine: g.order[i] === pid });
  if (g.phase === 'show' || g.phase === 'guess' || g.phase === 'guessReveal') {
    Object.assign(v, entry(g.idx), { index: g.idx, total: g.order.length });
    if (g.phase === 'show') v.prompt = g.prompts[g.order[g.idx]];
    else {
      v.choices = g.choices;
      v.myGuess = pid && g.guesses[pid] !== undefined ? g.guesses[pid] : null;
      v.canGuess = g.phase === 'guess' && !!pid && guessers(ctx).includes(pid) && g.guesses[pid] === undefined;
      if (g.phase === 'guessReveal') {
        v.answer = g.choices.indexOf(g.prompts[g.order[g.idx]]);
        v.artistId = g.order[g.idx];
        v.guesses = g.guesses;
        v.points = g.pts;
      }
    }
  } else if (g.phase === 'vote' || g.phase === 'results') {
    const showPrompt = !ctx.duel;
    v.entries = g.order.map((a, i) => Object.assign(entry(i), {
      prompt: showPrompt ? g.prompts[a] : undefined,
      artistId: g.phase === 'results' ? a : undefined,
      voters: g.phase === 'results' ? Object.keys(g.votes).filter(k => g.votes[k] === i) : undefined,
    }));
    if (ctx.duel) v.duelPrompt = g.prompts[g.order[0]];
    v.myVote = pid && g.votes[pid] !== undefined ? g.votes[pid] : null;
    v.canVote = g.phase === 'vote' && !!pid && voters(ctx).includes(pid) && g.votes[pid] === undefined &&
      g.order.some((a, i) => canVoteFor(ctx, pid, i));
    if (g.phase === 'results') v.points = g.pts;
  }
  return v;
}

module.exports = {
  id: 'doodleDuel',
  name: 'Doodle Duel',
  icon: '🎨',
  tagline: 'Draw your secret prompt with a finger. Vote for the best.',
  rule: 'Draw your secret prompt. Guess which prompt each drawing was, then vote for the best.',
  duelRule: 'Both draw the same prompt. The audience votes for the best drawing.',
  start, message, view, waiting, check, drawings,
};
