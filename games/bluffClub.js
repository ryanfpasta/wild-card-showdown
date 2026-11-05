'use strict';
// BLUFF CLUB - a strange true-trivia question; everyone writes a believable fake answer;
// fakes are shuffled with the truth and everyone votes on which one is real.
// Showdown Duel version: only the contestants write fakes; the audience hunts for the truth,
// and contestants score for every audience member they fool.
const C = require('../config');
const FACTS = require('../content/facts');
const { shuffle, cleanText, allDone, norm, lev } = require('./common');

function writers(ctx) { return ctx.duel ? ctx.duel.contestants.filter(ctx.has) : ctx.participants(); }
function voters(ctx) {
  if (!ctx.duel) return ctx.participants();
  const a = ctx.duel.audience.filter(ctx.has);
  return a.length ? a : ctx.duel.contestants.filter(ctx.has);
}

function isTruth(fact, text) {
  const f = norm(text);
  if (!f) return false;
  return fact.alts.some(alt => {
    const t = norm(alt);
    if (!t) return false;
    if (f === t) return true;
    if (t.length >= 6 && lev(f, t) <= 1) return true;
    return t.length >= 4 && (' ' + f + ' ').includes(' ' + t + ' ');
  });
}

// Every card is shown in the same casing so capitals can't give the truth (or a fake) away:
// first letter upper case, SHOUTING turned down, no trailing full stop.
function tidy(text) {
  let t = String(text).trim().replace(/\s+/g, ' ').replace(/[.!]+$/, '');
  if (t.length > 3 && !/[a-z]/.test(t)) t = t.toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function start(ctx) {
  const fact = ctx.pick('facts', FACTS);
  ctx.g = { phase: 'write', fact, fakes: {}, options: [], votes: {}, pts: {} };
  ctx.timer(ctx.ms(C.ANSWER_MS), () => endWrite(ctx));
}

function endWrite(ctx) {
  const g = ctx.g;
  if (g.phase !== 'write') return;
  const byText = new Map();
  for (const id of writers(ctx)) {
    const t = g.fakes[id];
    if (!t) continue;
    const k = norm(t) || t.toLowerCase();
    if (byText.has(k)) byText.get(k).authors.push(id);
    else byText.set(k, { text: tidy(t), authors: [id], truth: false, house: false });
  }
  const options = [...byText.values()];
  // too few fakes (people asleep, or a 2-player test)? the house adds some
  const used = new Set([norm(g.fact.a), ...byText.keys()]);
  const pool = shuffle(FACTS.filter(f => f !== g.fact).map(f => f.a));
  while (options.length < 2 && pool.length) {
    const t = pool.pop();
    if (used.has(norm(t)) || isTruth(g.fact, t)) continue;
    used.add(norm(t));
    options.push({ text: tidy(t), authors: [], truth: false, house: true });
  }
  options.push({ text: tidy(g.fact.a), authors: [], truth: true, house: false });
  g.options = shuffle(options);
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
  const add = (id, n, kind) => { pts[id] = (pts[id] || 0) + ctx.award(id, n, kind); };
  for (const voter of Object.keys(g.votes)) {
    const o = g.options[g.votes[voter]];
    if (!o) continue;
    if (o.truth) {
      if (!ctx.duel) { add(voter, 100, 'correct'); ctx.stat(voter, 'bluffTruths'); }
    } else {
      for (const a of o.authors) {
        if (ctx.duel) add(a, C.DUEL_VOTE_PTS, 'duel');
        else add(a, 50, 'fool');
        ctx.stat(a, 'bluffFooled');
      }
    }
  }
  g.pts = pts;
  g.phase = 'reveal';
  ctx.timer(C.REVEAL_MS + 1200 * g.options.length, () => ctx.done());
  ctx.update();
}

function message(ctx, pid, a, v) {
  const g = ctx.g;
  if (a === 'fake') {
    if (g.phase !== 'write' || !writers(ctx).includes(pid) || g.fakes[pid]) return;
    const text = cleanText(v, C.MAX_FAKE).replace(/\n/g, ' ');
    if (!text) return ctx.error(pid, 'Write a fake answer first!');
    if (isTruth(g.fact, text)) return ctx.error(pid, 'Whoa, that\'s actually the real answer! Try a different fake.', 'truth');
    g.fakes[pid] = text;
  } else if (a === 'vote') {
    if (g.phase !== 'vote' || g.votes[pid] !== undefined || !voters(ctx).includes(pid)) return;
    const o = g.options[v];
    if (!o || o.authors.includes(pid)) return;
    g.votes[pid] = v;
  } else return;
  ctx.update();
  check(ctx);
}

function check(ctx) {
  const g = ctx.g;
  if (g.phase === 'write' && allDone(ctx, writers(ctx), id => !!g.fakes[id])) endWrite(ctx);
  else if (g.phase === 'vote' && allDone(ctx, voters(ctx), id => g.votes[id] !== undefined)) endVote(ctx);
}

function waiting(ctx) {
  const g = ctx.g, out = {};
  if (g.phase === 'write') for (const id of writers(ctx)) out[id] = !!g.fakes[id];
  else if (g.phase === 'vote') for (const id of voters(ctx)) out[id] = g.votes[id] !== undefined;
  else return null;
  return out;
}

function view(ctx, pid) {
  const g = ctx.g;
  const v = { phase: g.phase, q: g.fact.q };
  if (g.phase === 'write') {
    v.writer = !!pid && writers(ctx).includes(pid);
    v.canWrite = v.writer && !g.fakes[pid];
    v.myFake = pid ? g.fakes[pid] || null : null;
    v.maxLen = C.MAX_FAKE;
  } else if (g.phase === 'vote') {
    v.options = g.options.map((o, i) => ({ i, text: o.text, mine: !!pid && o.authors.includes(pid) }));
    v.canVote = !!pid && voters(ctx).includes(pid) && g.votes[pid] === undefined;
    v.voter = !!pid && voters(ctx).includes(pid);
    v.myVote = pid && g.votes[pid] !== undefined ? g.votes[pid] : null;
  } else if (g.phase === 'reveal') {
    const truthFirst = g.options.map((o, i) => ({
      i, text: o.text, truth: o.truth, house: o.house, authors: o.authors,
      pickers: Object.keys(g.votes).filter(k => g.votes[k] === i), mine: !!pid && o.authors.includes(pid),
    }));
    // lies first (most-picked last for drama), the truth at the very end
    v.options = truthFirst.filter(o => !o.truth).sort((a, b) => a.pickers.length - b.pickers.length)
      .concat(truthFirst.filter(o => o.truth));
    v.answer = tidy(g.fact.a);
    v.myVote = pid && g.votes[pid] !== undefined ? g.votes[pid] : null;
    v.points = g.pts;
  }
  return v;
}

module.exports = {
  id: 'bluffClub',
  name: 'Bluff Club',
  icon: '🎭',
  tagline: 'One weird true fact. Write a fake answer. Spot the truth.',
  rule: 'Write a fake answer to a true fact. Then find the real one.',
  duelRule: 'Both write a fake answer. Score for every audience member you fool.',
  start, message, view, waiting, check,
  isTruth,
};
