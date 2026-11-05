'use strict';
// Helpers shared by the game branches.
const crypto = require('crypto');

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cleanText(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .replace(/\n{2,}/g, '\n').replace(/[ \t]+/g, ' ').trim().slice(0, max);
}

// true once every *connected* player in ids is done (and at least one of them is connected)
function allDone(ctx, ids, isDone) {
  const live = ids.filter(id => ctx.connected(id));
  return live.length > 0 && live.every(isDone);
}

// lowercase, no accents/punctuation/articles/plural s - for "is this the same answer?" checks
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
    .filter(w => w && w !== 'a' && w !== 'an' && w !== 'the')
    .map(w => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)).join(' ');
}

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

// count of votes per key, e.g. {pid: target}
function tally(map) {
  const out = {};
  for (const k of Object.keys(map)) out[map[k]] = (out[map[k]] || 0) + 1;
  return out;
}

module.exports = { shuffle, cleanText, allDone, norm, lev, tally };
