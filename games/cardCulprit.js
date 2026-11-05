'use strict';
// CARD CULPRIT - everyone answers an opinion prompt; answers are dealt anonymously
// and everyone guesses who wrote each one.
// Showdown Duel version: the contestants answer, the audience votes for the best answer.
const C = require('../config');
const PROMPTS = require('../prompts');
const { shuffle, cleanText, allDone } = require('./common');

const PLACEHOLDER = '...sat there in stunned silence';

function writers(ctx) { return ctx.duel ? ctx.duel.contestants.filter(ctx.has) : ctx.participants(); }
function voters(ctx) {
  if (!ctx.duel) return ctx.participants();
  const a = ctx.duel.audience.filter(ctx.has);
  return a.length ? a : ctx.duel.contestants.filter(ctx.has);
}

function start(ctx) {
  ctx.g = { phase: 'answer', prompt: ctx.pick('prompts', PROMPTS), answers: {}, cards: [], idx: 0, guesses: {}, pts: {}, votes: {} };
  ctx.timer(ctx.ms(C.ANSWER_MS), () => endAnswers(ctx));
}

function endAnswers(ctx) {
  const g = ctx.g;
  if (g.phase !== 'answer') return;
  g.cards = shuffle(writers(ctx).map(id => g.answers[id]
    ? { authorId: id, text: g.answers[id], placeholder: false }
    : { authorId: id, text: PLACEHOLDER, placeholder: true }));
  if (ctx.duel) return startVote(ctx);
  startGuess(ctx, 0);
}

// ----- normal game: guess the author of each card -----
function guessers(ctx) {
  const card = ctx.g.cards[ctx.g.idx];
  return ctx.participants().filter(id => id !== card.authorId);
}

function startGuess(ctx, i) {
  const g = ctx.g;
  while (i < g.cards.length && !ctx.has(g.cards[i].authorId)) i++; // author was removed
  if (i >= g.cards.length) return ctx.done();
  g.idx = i;
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
  const card = g.cards[g.idx];
  const pts = {};
  const add = (id, n, kind) => { pts[id] = (pts[id] || 0) + ctx.award(id, n, kind); };
  let fooled = 0, right = 0;
  for (const guesser of Object.keys(g.guesses)) {
    if (g.guesses[guesser] === card.authorId) { add(guesser, 100, 'correct'); ctx.stat(guesser, 'ccCorrect'); right++; }
    else if (!card.placeholder) { add(card.authorId, 50, 'fool'); fooled++; }
  }
  if (!card.placeholder && Object.keys(g.guesses).length) {
    ctx.stat(card.authorId, 'ccCards');
    ctx.stat(card.authorId, 'ccCaught', right);
    ctx.stat(card.authorId, 'ccFooled', fooled);
  }
  g.pts = pts;
  g.phase = 'reveal';
  ctx.timer(C.REVEAL_MS, () => startGuess(ctx, g.idx + 1));
  ctx.update();
}

// ----- duel: audience votes for the best answer -----
function startVote(ctx) {
  const g = ctx.g;
  g.phase = 'vote';
  g.votes = {};
  ctx.timer(ctx.ms(C.VOTE_MS), () => endVote(ctx));
  ctx.update();
  check(ctx);
}

function canVoteFor(ctx, pid, i) {
  const c = ctx.g.cards[i];
  return c && c.authorId !== pid && !c.placeholder;
}

function endVote(ctx) {
  const g = ctx.g;
  if (g.phase !== 'vote') return;
  const pts = {};
  g.cards.forEach((c, i) => {
    const n = Object.values(g.votes).filter(v => v === i).length;
    if (n) pts[c.authorId] = ctx.award(c.authorId, C.DUEL_VOTE_PTS * n, 'duel');
  });
  g.pts = pts;
  g.phase = 'results';
  ctx.timer(C.REVEAL_MS + 3000, () => ctx.done());
  ctx.update();
}

// ----- plumbing -----
function message(ctx, pid, a, v) {
  const g = ctx.g;
  if (a === 'answer') {
    if (g.phase !== 'answer' || !writers(ctx).includes(pid) || g.answers[pid]) return;
    const text = cleanText(v, C.MAX_ANSWER);
    if (!text) return ctx.error(pid, 'Write something first!');
    g.answers[pid] = text;
  } else if (a === 'guess') {
    if (g.phase !== 'guess' || g.guesses[pid] || !guessers(ctx).includes(pid)) return;
    if (v === pid || !g.cards.some(c => c.authorId === v)) return;
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
  if (g.phase === 'answer' && allDone(ctx, writers(ctx), id => !!g.answers[id])) endAnswers(ctx);
  else if (g.phase === 'guess' && allDone(ctx, guessers(ctx), id => !!g.guesses[id])) endGuess(ctx);
  else if (g.phase === 'vote') {
    const vs = voters(ctx).filter(id => g.cards.some((c, i) => canVoteFor(ctx, id, i)));
    if (!vs.length || allDone(ctx, vs, id => g.votes[id] !== undefined)) endVote(ctx);
  }
}

function waiting(ctx) {
  const g = ctx.g, out = {};
  if (g.phase === 'answer') for (const id of writers(ctx)) out[id] = !!g.answers[id];
  else if (g.phase === 'guess') for (const id of guessers(ctx)) out[id] = !!g.guesses[id];
  else if (g.phase === 'vote') for (const id of voters(ctx)) out[id] = g.votes[id] !== undefined;
  else return null;
  return out;
}

function view(ctx, pid) {
  const g = ctx.g;
  const v = { phase: g.phase, prompt: g.prompt };
  if (g.phase === 'answer') {
    v.canAnswer = !!pid && writers(ctx).includes(pid) && !g.answers[pid];
    v.writer = !!pid && writers(ctx).includes(pid);
    v.myAnswer = pid ? g.answers[pid] || null : null;
  } else if (g.phase === 'guess' || g.phase === 'reveal') {
    const card = g.cards[g.idx];
    v.card = {
      index: g.idx, total: g.cards.length, text: card.text, placeholder: card.placeholder,
      mine: card.authorId === pid,
      myGuess: pid ? g.guesses[pid] || null : null,
      canGuess: g.phase === 'guess' && !!pid && guessers(ctx).includes(pid) && !g.guesses[pid],
      choices: g.cards.map(c => c.authorId).filter(id => id !== pid && ctx.has(id)),
    };
    if (g.phase === 'reveal') {
      v.card.authorId = card.authorId;
      v.card.guesses = Object.entries(g.guesses);
      v.card.points = g.pts;
    }
  } else if (g.phase === 'vote' || g.phase === 'results') {
    v.entries = g.cards.map((c, i) => ({
      i, text: c.text, placeholder: c.placeholder, mine: c.authorId === pid,
      authorId: g.phase === 'results' ? c.authorId : undefined,
      voters: g.phase === 'results' ? Object.keys(g.votes).filter(k => g.votes[k] === i) : undefined,
    }));
    v.myVote = pid && g.votes[pid] !== undefined ? g.votes[pid] : null;
    v.canVote = g.phase === 'vote' && !!pid && voters(ctx).includes(pid) && g.votes[pid] === undefined;
    if (g.phase === 'results') v.points = g.pts;
  }
  return v;
}

module.exports = {
  id: 'cardCulprit',
  name: 'Card Culprit',
  icon: '🕵️',
  tagline: 'Answer the question. Then guess who wrote what.',
  rule: 'Answer the question. Then guess who wrote each anonymous answer.',
  duelRule: 'Both answer the same question. The audience votes for the best answer.',
  start, message, view, waiting, check,
};
