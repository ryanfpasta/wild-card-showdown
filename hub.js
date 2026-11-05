'use strict';
// WILD CARD SHOWDOWN - the hub.
// Owns tables (rooms), players and identity, dealer setup, the round flow, wild card twists,
// scoring multipliers, the shared leaderboard, badges, the finale and the recap.
// The games themselves live in games/ and only see the small ctx API described in games/index.js.

const crypto = require('crypto');
const C = require('./config');
const GAMES = require('./games');
const randomName = require('./content/names');

const GAME = Object.fromEntries(GAMES.map(g => [g.id, g]));
const GAME_IDS = GAMES.map(g => g.id);
const COLOR = Object.fromEntries(C.COLORS.map(c => [c.id, c]));
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOBBY_DROP_MS = 2 * 60 * 1000;
const MAX_ROOMS = 300;
const rand = n => crypto.randomInt(n);
const pickOne = a => a[rand(a.length)];

// ---------------------------------------------------------------------------
// rooms
// ---------------------------------------------------------------------------
const rooms = new Map();

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_LETTERS[rand(CODE_LETTERS.length)];
    if (!rooms.has(c)) return c;
  }
}

function defaultSettings() {
  return {
    mode: 'rotation',                 // 'single' | 'rotation' | 'mix'
    single: 'cardCulprit',
    mix: Object.fromEntries(GAME_IDS.map(id => [id, true])),
    rounds: 6,
    twistFreq: 2,                     // index into C.TWIST_LEVELS
    drawSecs: 180,
    doodleGuess: true,                // Doodle Duel: guess-the-prompt step
    showdown: true,                   // Showdown Duel after the finale
  };
}

function createRoom(isDefault) {
  if (!isDefault && rooms.size >= MAX_ROOMS) return null;
  const room = {
    code: newCode(), isDefault: !!isDefault,
    players: new Map(), order: [], hosts: new Set(), dealerId: null,
    settings: defaultSettings(),
    phase: 'lobby', round: 0, cur: null,
    used: {}, rotation: [], lastGame: null, lastTwist: null,
    t: { h: null, fn: null, deadline: null, remaining: null, total: 0 }, paused: false,
    stats: {}, history: [], badges: {}, board: null,
    wagers: {}, wagerIds: [], recap: null,
    lastActive: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

function getRoom(code) { return rooms.get(String(code || '').toUpperCase().trim()); }

// ---------------------------------------------------------------------------
// timer: one pausable, skippable timer per table
// ---------------------------------------------------------------------------
function setTimer(room, ms, fn) {
  clearTimeout(room.t.h);
  room.step = (room.step || 0) + 1;    // every phase step gets a number; "skip" must name the step it means
  room.t = { h: null, fn, total: ms, deadline: null, remaining: null };
  if (room.paused) room.t.remaining = ms;
  else { room.t.deadline = Date.now() + ms; room.t.h = setTimeout(() => fire(room), ms); }
}

function fire(room) {
  const fn = room.t.fn;
  clearTimeout(room.t.h);
  room.t = { h: null, fn: null, total: 0, deadline: null, remaining: null };
  if (fn) { try { fn(); } catch (e) { console.error('Timer error', e); } }
}

function clearTimer(room) {
  clearTimeout(room.t.h);
  room.t = { h: null, fn: null, total: 0, deadline: null, remaining: null };
}

function pause(room) {
  if (room.paused || room.phase === 'lobby' || room.phase === 'final') return;
  room.paused = true;
  if (room.t.fn && room.t.deadline) {
    clearTimeout(room.t.h);
    room.t.remaining = Math.max(0, room.t.deadline - Date.now());
    room.t.deadline = null;
  }
}

function resume(room) {
  if (!room.paused) return;
  room.paused = false;
  if (room.t.fn && room.t.remaining != null) {
    const ms = room.t.remaining;
    room.t.remaining = null;
    room.t.deadline = Date.now() + ms;
    room.t.h = setTimeout(() => fire(room), ms);
  }
  recheck(room);
}

// ---------------------------------------------------------------------------
// players
// ---------------------------------------------------------------------------
function connectedIds(room) { return room.order.filter(id => room.players.get(id).connected); }

function ensureDealer(room) {
  const d = room.players.get(room.dealerId);
  if (d && d.connected) return;
  const next = connectedIds(room)[0];
  if (next) room.dealerId = next;
  else if (!d) room.dealerId = room.order[0] || null;
}

function stats(room, id) {
  if (!room.stats[id]) {
    room.stats[id] = {
      ccCorrect: 0, ccCards: 0, ccCaught: 0, ccFooled: 0, bluffFooled: 0, bluffTruths: 0,
      doodleDrawn: 0, doodleVotes: 0, doodleRight: 0, biggestLoss: 0, lossWhy: '', wager: 0, leadRounds: 0,
    };
  }
  return room.stats[id];
}

function cleanName(s, max) {
  return String(s || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max || C.MAX_NAME);
}

function taken(room, exceptId) {
  const out = { avatars: [], colors: [], names: [] };
  for (const p of room.players.values()) {
    if (p.id === exceptId) continue;
    out.avatars.push(p.avatar); out.colors.push(p.color); out.names.push(p.name);
  }
  return out;
}

function freeLook(room, exceptId, avatar, color) {
  const t = taken(room, exceptId);
  const freeA = C.AVATARS.filter(a => !t.avatars.includes(a));
  const freeC = C.COLORS.map(c => c.id).filter(c => !t.colors.includes(c));
  return {
    avatar: freeA.includes(avatar) ? avatar : pickOne(freeA.length ? freeA : C.AVATARS),
    color: freeC.includes(color) ? color : pickOne(freeC.length ? freeC : C.COLORS.map(c => c.id)),
  };
}

function shuffleLook(room) {
  const t = room ? taken(room) : { avatars: [], colors: [], names: [] };
  const look = room ? freeLook(room, null, null, null) : { avatar: pickOne(C.AVATARS), color: pickOne(C.COLORS).id };
  return { name: randomName(rand, t.names), avatar: look.avatar, color: look.color };
}

function removePlayer(room, id) {
  const p = room.players.get(id);
  if (!p) return;
  clearTimeout(p.dropTimer);
  if (p.ws) { const w = p.ws; p.ws = null; w.ctx = { room: null, pid: null, host: false }; try { w.close(4001, 'removed'); } catch (e) { /* ignore */ } }
  room.players.delete(id);
  room.order = room.order.filter(x => x !== id);
  delete room.wagers[id];
  for (const k of Object.keys(room.badges)) if (room.badges[k] === id) delete room.badges[k];
  if (room.dealerId === id) room.dealerId = null;
  ensureDealer(room);
}

function scheduleLobbyDrop(room, p) {
  clearTimeout(p.dropTimer);
  p.dropTimer = setTimeout(() => {
    if (room.phase === 'lobby' && !p.connected && room.players.get(p.id) === p) {
      removePlayer(room, p.id);
      broadcast(room);
    }
  }, LOBBY_DROP_MS);
}

// ---------------------------------------------------------------------------
// game & twist choice
// ---------------------------------------------------------------------------
function enabledGames(s) {
  if (s.mode === 'single') return [GAME[s.single] ? s.single : GAME_IDS[0]];
  if (s.mode === 'mix') { const l = GAME_IDS.filter(id => s.mix[id]); return l.length ? l : GAME_IDS.slice(); }
  return GAME_IDS.slice();
}

function chooseGame(room, special) {
  const list = enabledGames(room.settings);
  if (list.length === 1) return list[0];
  if (special) return pickOne(list);
  if (room.settings.mode === 'rotation') {
    if (!room.rotation.length) room.rotation = shuffleArr(list.slice());
    // never start a new cycle with the game we just played
    if (room.rotation[0] === room.lastGame && room.rotation.length > 1) room.rotation.push(room.rotation.shift());
    return room.rotation.shift();
  }
  const options = list.filter(id => id !== room.lastGame);
  return pickOne(options.length ? options : list);
}

function chooseTwist(room, participants) {
  const level = C.TWIST_LEVELS[room.settings.twistFreq] || C.TWIST_LEVELS[0];
  if (!level.p || Math.random() >= level.p) return null;
  const scores = participants.map(id => room.players.get(id).score);
  const allEqual = scores.every(s => s === scores[0]);
  let cands = Object.keys(C.TWISTS).filter(id => {
    if ((id === 'steal' || id === 'underdog') && allEqual) return false;
    if (id === 'mystery' && enabledGames(room.settings).length < 2) return false;
    return true;
  });
  if (cands.length > 1) cands = cands.filter(id => id !== room.lastTwist);
  return cands.length ? pickOne(cands) : null;
}

function shuffleArr(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------------------------------------------------------------------------
// the ctx a game branch sees
// ---------------------------------------------------------------------------
function makeCtx(room) {
  const cur = room.cur;
  const ctx = {
    g: null,
    round: room.round + (cur.duel ? 's' : ''),
    settings: room.settings,
    finale: cur.finale,
    duel: cur.duel,
    participants: () => cur.participants.filter(id => room.players.has(id)),
    has: id => room.players.has(id),
    connected: id => { const p = room.players.get(id); return !!(p && p.connected); },
    ms: base => (cur.twist === 'speed' ? Math.round(base / 2) : base),
    timer: (ms, fn) => setTimer(room, ms, () => { if (room.cur === cur && room.phase === 'play') fn(); }),
    award: (id, pts, kind) => award(room, id, pts, kind),
    stat: (id, key, n) => { if (room.players.has(id)) stats(room, id)[key] += (n == null ? 1 : n); },
    pick: (key, list) => pickFrom(room, key, list),
    update: () => broadcast(room),
    error: (pid, msg, code) => { const p = room.players.get(pid); if (p && p.ws) send(p.ws, { t: 'error', msg, code }); },
    done: () => { if (room.cur === cur && room.phase === 'play') endRound(room); },
  };
  return ctx;
}

function pickFrom(room, key, list) {
  const used = room.used[key] || (room.used[key] = new Set());
  if (used.size >= list.length) used.clear();
  let i;
  do { i = rand(list.length); } while (used.has(i));
  used.add(i);
  return list[i];
}

function award(room, id, pts, kind) {
  const cur = room.cur;
  const p = room.players.get(id);
  if (!cur || !p || !pts) return 0;
  let m = 1;
  if (kind !== 'duel') {
    if (cur.twist === 'doubleDown') m *= 2;
    if (cur.twist === 'reverse') { if (kind === 'fool') m *= 2; else if (kind === 'correct') m *= 0.5; }
    if (cur.twist === 'underdog' && cur.underdogs.includes(id)) m *= 2;
    if (cur.finale) m *= C.FINALE_MULT;
  }
  const n = Math.round(pts * m);
  p.score += n;
  cur.roundPoints[id] = (cur.roundPoints[id] || 0) + n;
  return n;
}

// ---------------------------------------------------------------------------
// flow: lobby -> [intro -> play -> scores] x N (wager before the last) -> showdown? -> recap -> final
// ---------------------------------------------------------------------------
function startGame(room) {
  for (const p of room.players.values()) p.score = 0;
  room.stats = {};
  for (const id of room.order) stats(room, id);
  room.history = []; room.badges = {}; room.board = null; room.wagers = {}; room.recap = null;
  room.round = 0; room.rotation = []; room.lastGame = null; room.lastTwist = null;
  room.paused = false;
  startRound(room);
}

function newCur(room, extra) {
  return Object.assign({
    gameId: null, twist: null, finale: false, duel: null, participants: connectedIds(room),
    underdogs: [], roundPoints: {}, events: [], hidden: false, ctx: null, startScores: {},
  }, extra);
}

function startRound(room) {
  room.round += 1;
  const finale = room.round >= room.settings.rounds;
  const participants = connectedIds(room);
  const twist = finale ? null : chooseTwist(room, participants);
  const gameId = chooseGame(room, finale);
  room.cur = newCur(room, { gameId, twist, finale, participants, hidden: finale || twist === 'mystery' });
  if (twist === 'underdog') {
    const low = Math.min(...participants.map(id => room.players.get(id).score));
    room.cur.underdogs = participants.filter(id => room.players.get(id).score === low);
  }
  for (const id of participants) { stats(room, id); room.cur.startScores[id] = room.players.get(id).score; }
  room.lastGame = gameId;
  if (twist) room.lastTwist = twist;
  startIntro(room, C.INTRO_MS + (twist ? 2500 : 0));
}

function startIntro(room, ms) {
  room.phase = 'intro';
  const cur = room.cur;
  if (cur.hidden) {
    // keep the game a secret until the last moment
    const revealAt = Math.max(0, ms - 1800);
    setTimer(room, revealAt, () => {
      if (room.cur !== cur) return;
      cur.hidden = false;
      setTimer(room, ms - revealAt, () => startPlay(room));
      broadcast(room);
    });
  } else {
    setTimer(room, ms, () => startPlay(room));
  }
  broadcast(room);
}

function startPlay(room) {
  const cur = room.cur;
  if (!cur || room.phase !== 'intro') return;
  cur.hidden = false;
  room.phase = 'play';
  cur.ctx = makeCtx(room);
  GAME[cur.gameId].start(cur.ctx);
  broadcast(room);
}

function ranksOf(room) {
  const ids = room.order.slice();
  const ranks = {};
  for (const id of ids) {
    const s = room.players.get(id).score;
    ranks[id] = 1 + ids.filter(o => room.players.get(o).score > s).length;
  }
  return ranks;
}

function endRound(room) {
  const cur = room.cur;
  clearTimer(room);
  const prev = room.history.length ? room.history[room.history.length - 1].ranks : null;
  const before = {};
  for (const id of room.order) before[id] = room.players.get(id).score - (cur.roundPoints[id] || 0);

  if (cur.twist === 'steal') resolveSteal(room);
  if (cur.finale) resolveWagers(room);

  const ranks = ranksOf(room);
  const scores = {};
  const delta = {};
  for (const id of room.order) {
    scores[id] = room.players.get(id).score;
    delta[id] = scores[id] - (before[id] != null ? before[id] : scores[id]);
  }
  // who led after this round (for "Biggest Heartbreak")
  const top = Math.max(...room.order.map(id => scores[id]));
  if (top > 0) for (const id of room.order) if (scores[id] === top) stats(room, id).leadRounds++;
  room.history.push({ round: room.round, gameId: cur.gameId, showdown: !!cur.duel, scores, ranks, delta });

  const badgeChanges = updateBadges(room);
  const rows = room.order.map(id => ({
    id, score: scores[id], delta: delta[id], rank: ranks[id], prevRank: prev && prev[id] != null ? prev[id] : null,
  })).sort((a, b) => a.rank - b.rank || room.order.indexOf(a.id) - room.order.indexOf(b.id));

  room.board = {
    round: room.round, gameId: cur.gameId, twist: cur.twist, finale: cur.finale, showdown: !!cur.duel,
    rows, events: cur.events, badgeChanges, roundPoints: cur.roundPoints,
    contestants: cur.duel ? cur.duel.contestants : null,
  };
  room.phase = 'scores';
  setTimer(room, C.SCORES_MS, () => afterScores(room));
  broadcast(room);
}

function afterScores(room) {
  if (room.phase !== 'scores') return;
  const cur = room.cur;
  if (cur && cur.duel) return startRecap(room);
  if (room.round >= room.settings.rounds) {
    if (room.settings.showdown && connectedIds(room).length >= 2) return startShowdown(room);
    return startRecap(room);
  }
  if (room.round === room.settings.rounds - 1) return startWager(room);
  startRound(room);
}

// ----- twists resolved at the end of a round -----
function resolveSteal(room) {
  const cur = room.cur;
  const ids = cur.participants.filter(id => room.players.has(id));
  const best = Math.max(0, ...ids.map(id => cur.roundPoints[id] || 0));
  const thieves = ids.filter(id => (cur.roundPoints[id] || 0) === best);
  if (best <= 0 || thieves.length !== 1) { cur.events.push({ type: 'stealFail', reason: 'tie' }); return; }
  const thief = thieves[0];
  const all = room.order;
  const lead = Math.max(...all.map(id => room.players.get(id).score));
  const leaders = all.filter(id => room.players.get(id).score === lead);
  if (leaders.includes(thief)) { cur.events.push({ type: 'stealFail', reason: 'leader', id: thief }); return; }
  const victim = leaders[0];
  const vp = room.players.get(victim);
  const amount = Math.min(vp.score, Math.max(50, Math.round(vp.score * 0.2 / 10) * 10));
  if (amount <= 0) return;
  vp.score -= amount;
  room.players.get(thief).score += amount;
  noteLoss(room, victim, amount, 'robbed by a Steal');
  cur.events.push({ type: 'steal', from: victim, to: thief, amount });
}

function noteLoss(room, id, amount, why) {
  const s = stats(room, id);
  if (amount > s.biggestLoss) { s.biggestLoss = amount; s.lossWhy = why; }
}

function startWager(room) {
  room.phase = 'wager';
  room.cur = null;
  room.wagers = {};
  room.wagerIds = connectedIds(room);
  setTimer(room, C.WAGER_MS, () => { if (room.phase === 'wager') startRound(room); });
  broadcast(room);
}

function checkWagers(room) {
  if (room.phase !== 'wager' || room.paused) return;
  const live = room.wagerIds.filter(id => { const p = room.players.get(id); return p && p.connected; });
  if (live.length && live.every(id => room.wagers[id] != null)) { clearTimer(room); startRound(room); }
}

function resolveWagers(room) {
  const cur = room.cur;
  const ids = cur.participants.filter(id => room.players.has(id));
  const need = Math.ceil(ids.length / 2);
  for (const id of ids) {
    const w = room.wagers[id] || 0;
    if (!w) continue;
    const mine = cur.roundPoints[id] || 0;
    const better = ids.filter(o => (cur.roundPoints[o] || 0) > mine).length;
    const won = mine > 0 && better < need;
    const p = room.players.get(id);
    if (won) p.score += w;
    else { p.score = Math.max(0, p.score - w); noteLoss(room, id, w, 'lost the Final Wager'); }
    cur.events.push({ type: 'wager', id, amount: w, won });
  }
}

// ----- showdown duel -----
function startShowdown(room) {
  const live = connectedIds(room);
  const n = live.length >= 6 ? 3 : 2;
  const sorted = live.slice().sort((a, b) => room.players.get(b).score - room.players.get(a).score || room.order.indexOf(a) - room.order.indexOf(b));
  const contestants = sorted.slice(0, n);
  const audience = live.filter(id => !contestants.includes(id));
  room.cur = newCur(room, {
    gameId: chooseGame(room, true), duel: { contestants, audience }, participants: live, hidden: true,
  });
  for (const id of live) room.cur.startScores[id] = room.players.get(id).score;
  room.phase = 'intro';
  startIntro(room, C.INTRO_MS + 3000);
}

// ---------------------------------------------------------------------------
// badges
// ---------------------------------------------------------------------------
const LIVE_BADGES = [
  { id: 'masterLiar', name: 'Master Liar', icon: '🤥', desc: 'Fooled the most people in Bluff Club', pick: r => best(r, 'bluffFooled', 'max', 1) },
  { id: 'bloodhound', name: 'Bloodhound', icon: '🐕', desc: 'Best guesser in Card Culprit', pick: r => best(r, 'ccCorrect', 'max', 1) },
  { id: 'truthSeeker', name: 'Truth Seeker', icon: '🔍', desc: 'Spotted the most real answers in Bluff Club', pick: r => best(r, 'bluffTruths', 'max', 1) },
  { id: 'picasso', name: 'Picasso', icon: '🖼️', desc: 'Most votes for their drawings', pick: r => artistBadge(r, 'max') },
  { id: 'terribleArtist', name: 'Terrible Artist', icon: '🖍️', desc: 'Fewest votes for their drawings', pick: r => artistBadge(r, 'min') },
  { id: 'pokerFace', name: 'Poker Face', icon: '😐', desc: 'Nobody could pin them down in Card Culprit', pick: pokerFace },
];
const BADGE = Object.fromEntries(LIVE_BADGES.map(b => [b.id, b]));

// returns the list of players tied for best (the caller keeps a current holder in a tie)
function best(room, key, dir, min) {
  const ids = room.order.filter(id => stats(room, id)[key] >= (min || 0));
  if (!ids.length) return [];
  const vals = ids.map(id => stats(room, id)[key]);
  const target = dir === 'min' ? Math.min(...vals) : Math.max(...vals);
  return ids.filter(id => stats(room, id)[key] === target);
}

function artistBadge(room, dir) {
  const artists = room.order.filter(id => stats(room, id).doodleDrawn > 0);
  if (artists.length < 2) return [];
  const vals = artists.map(id => stats(room, id).doodleVotes);
  const target = dir === 'min' ? Math.min(...vals) : Math.max(...vals);
  if (dir === 'max' && target <= 0) return [];
  if (vals.every(v => v === target)) return [];
  return artists.filter(id => stats(room, id).doodleVotes === target);
}

function pokerFace(room) {
  const ids = room.order.filter(id => { const s = stats(room, id); return s.ccCards > 0 && s.ccFooled > 0; });
  if (!ids.length) return [];
  const rate = id => { const s = stats(room, id); return s.ccCaught / (s.ccCaught + s.ccFooled); };
  const target = Math.min(...ids.map(rate));
  if (target >= 0.5) return [];
  return ids.filter(id => rate(id) === target);
}

function updateBadges(room) {
  const changes = [];
  for (const b of LIVE_BADGES) {
    const cands = b.pick(room);
    const holder = room.badges[b.id] || null;
    let next = null;
    if (cands.length === 1) next = cands[0];
    else if (holder && cands.includes(holder)) next = holder;
    if (next !== holder) {
      if (next) room.badges[b.id] = next; else delete room.badges[b.id];
      if (next) changes.push({ badge: b.id, to: next, from: holder });
    }
  }
  return changes;
}

function badgesOf(room, id) { return Object.keys(room.badges).filter(k => room.badges[k] === id); }

// ---------------------------------------------------------------------------
// recap: the awards show
// ---------------------------------------------------------------------------
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

function buildAwards(room) {
  const awards = [];
  const ids = room.order.slice();
  const H = room.history.filter(h => !h.showdown);
  const final = room.history.length ? room.history[room.history.length - 1].ranks : ranksOf(room);

  // Comeback Kid: biggest climb from their worst position to their final position
  let bestClimb = 0, climbers = [];
  for (const id of ids) {
    const rs = room.history.map(h => h.ranks[id]).filter(r => r != null);
    if (rs.length < 2) continue;
    const worst = Math.max(...rs.slice(0, -1));
    const climb = worst - final[id];
    if (climb > bestClimb) { bestClimb = climb; climbers = [{ id, worst }]; }
    else if (climb === bestClimb && climb > 0) climbers.push({ id, worst });
  }
  if (bestClimb > 0) awards.push({
    id: 'comebackKid', name: 'Comeback Kid', icon: '🚀', desc: 'Biggest climb up the leaderboard',
    winners: climbers.map(c => c.id), detail: climbers.length === 1 ? `From ${ordinal(climbers[0].worst)} place to ${ordinal(final[climbers[0].id])}` : `Climbed ${bestClimb} place${bestClimb === 1 ? '' : 's'}`,
  });

  // Most Improved: scored much more in the second half of the night than the first
  if (H.length >= 2) {
    const half = Math.floor(H.length / 2);
    let bestGain = 0, who = [];
    for (const id of ids) {
      const d = H.map(h => h.delta[id] || 0);
      const gain = d.slice(half).reduce((a, b) => a + b, 0) - d.slice(0, half).reduce((a, b) => a + b, 0);
      if (gain > bestGain) { bestGain = gain; who = [id]; } else if (gain === bestGain && gain > 0) who.push(id);
    }
    if (bestGain > 0) awards.push({ id: 'mostImproved', name: 'Most Improved', icon: '📈', desc: 'Saved their best for the second half', winners: who, detail: `+${bestGain} more points in the second half` });
  }

  // Biggest Heartbreak: lost the most in one go, or led a lot but didn't win
  const losses = best(room, 'biggestLoss', 'max', 1);
  const champs = championIds(room);
  if (losses.length) {
    const s = stats(room, losses[0]);
    awards.push({ id: 'heartbreak', name: 'Biggest Heartbreak', icon: '💔', desc: 'Ouch. That one hurt.', winners: losses, detail: `Lost ${s.biggestLoss} points at once (${s.lossWhy})` });
  } else {
    const leaders = best(room, 'leadRounds', 'max', 1).filter(id => !champs.includes(id));
    if (leaders.length) awards.push({ id: 'heartbreak', name: 'Biggest Heartbreak', icon: '💔', desc: 'So close, yet so far', winners: leaders, detail: `Led after ${stats(room, leaders[0]).leadRounds} round(s) but didn't win` });
  }

  // High Roller: biggest Final Wager
  const rollers = best(room, 'wager', 'max', 1);
  if (rollers.length) awards.push({ id: 'highRoller', name: 'High Roller', icon: '🎲', desc: 'Biggest bet in the Final Wager', winners: rollers, detail: `Bet ${stats(room, rollers[0]).wager} points` });

  // the live badges, as they ended up
  for (const b of LIVE_BADGES) {
    const holder = room.badges[b.id];
    if (!holder || !room.players.has(holder)) continue;
    const s = stats(room, holder);
    const detail = {
      masterLiar: `Fooled ${s.bluffFooled} time${s.bluffFooled === 1 ? '' : 's'}`,
      bloodhound: `${s.ccCorrect} correct guess${s.ccCorrect === 1 ? '' : 'es'}`,
      truthSeeker: `Found the truth ${s.bluffTruths} time${s.bluffTruths === 1 ? '' : 's'}`,
      picasso: `${s.doodleVotes} favourite vote${s.doodleVotes === 1 ? '' : 's'}`,
      terribleArtist: `${s.doodleVotes} vote${s.doodleVotes === 1 ? '' : 's'}. Art is subjective.`,
      pokerFace: `Caught only ${s.ccCaught} of ${s.ccCaught + s.ccFooled} times`,
    }[b.id];
    awards.push({ id: b.id, name: b.name, icon: b.icon, desc: b.desc, winners: [holder], detail, badge: true });
  }

  awards.push({ id: 'champion', name: 'Wild Card Champion', icon: '👑', desc: 'Most points at the end of the night', winners: champs, detail: champs.length ? `${room.players.get(champs[0]).score} points` : '' });
  return awards.filter(a => a.winners.length);
}

function championIds(room) {
  const top = Math.max(0, ...room.order.map(id => room.players.get(id).score));
  return room.order.filter(id => room.players.get(id).score === top);
}

function startRecap(room) {
  clearTimer(room);
  room.cur = null;
  room.recap = { awards: buildAwards(room), idx: 0 };
  room.phase = 'recap';
  setTimer(room, C.RECAP_MS, () => nextAward(room));
  broadcast(room);
}

function nextAward(room) {
  if (room.phase !== 'recap') return;
  room.recap.idx++;
  if (room.recap.idx >= room.recap.awards.length) return finish(room);
  setTimer(room, C.RECAP_MS, () => nextAward(room));
  broadcast(room);
}

function finish(room) {
  clearTimer(room);
  room.paused = false;
  room.phase = 'final';
  broadcast(room);
}

function backToLobby(room) {
  clearTimer(room);
  room.phase = 'lobby'; room.round = 0; room.cur = null; room.paused = false;
  room.board = null; room.recap = null; room.badges = {}; room.history = []; room.wagers = {};
  for (const p of room.players.values()) p.score = 0;
  for (const id of [...room.order]) { const p = room.players.get(id); if (!p.connected) scheduleLobbyDrop(room, p); }
  broadcast(room);
}

// re-check "has everyone acted?" after a disconnect, removal or resume
function recheck(room) {
  if (room.paused) return;
  if (room.phase === 'play' && room.cur && room.cur.ctx) GAME[room.cur.gameId].check(room.cur.ctx);
  else if (room.phase === 'wager') checkWagers(room);
}

// ---------------------------------------------------------------------------
// views
// ---------------------------------------------------------------------------
function settingsView(s) {
  return { mode: s.mode, single: s.single, mix: s.mix, rounds: s.rounds, twistFreq: s.twistFreq, drawSecs: s.drawSecs, doodleGuess: s.doodleGuess, showdown: s.showdown, games: enabledGames(s) };
}

function viewFor(room, pid) {
  const cur = room.cur;
  const inPlay = room.phase === 'play' && cur && cur.ctx;
  const game = inPlay ? GAME[cur.gameId] : null;
  const waiting = inPlay ? game.waiting(cur.ctx) : (room.phase === 'wager' ? Object.fromEntries(room.wagerIds.map(id => [id, room.wagers[id] != null])) : null);
  const inRound = id => !!(cur && cur.participants.includes(id)) || (room.phase === 'wager' && room.wagerIds.includes(id));

  const players = room.order.map(id => {
    const p = room.players.get(id);
    const col = COLOR[p.color] || C.COLORS[0];
    return {
      id, name: p.name, real: p.real || '', avatar: p.avatar, color: col.hex, colorId: col.id, score: p.score, connected: p.connected,
      inRound: inRound(id), done: waiting && id in waiting ? waiting[id] : null, badges: badgesOf(room, id),
    };
  });
  const t = room.t;
  const msLeft = t.fn ? (room.paused ? t.remaining : Math.max(0, t.deadline - Date.now())) : null;

  const v = {
    t: 'state', code: room.code, phase: room.phase, you: pid || null, dealerId: room.dealerId,
    settings: settingsView(room.settings), round: room.round, rounds: room.settings.rounds,
    minPlayers: C.MIN_PLAYERS, maxPlayers: C.MAX_PLAYERS, paused: room.paused,
    players, msLeft, totalMs: t.fn ? t.total : null, step: room.step || 0,
    inRound: pid ? inRound(pid) : false,
  };
  if (cur && room.phase !== 'scores') {
    v.cur = {
      gameId: cur.hidden ? null : cur.gameId, twist: cur.twist, finale: cur.finale, showdown: !!cur.duel,
      contestants: cur.duel ? cur.duel.contestants : null, underdogs: cur.underdogs,
      stage: cur.hidden ? 'hidden' : 'shown',
    };
    if (cur.duel && pid) v.cur.role = cur.duel.contestants.includes(pid) ? 'contestant' : 'audience';
  }
  if (inPlay) v.game = game.view(cur.ctx, pid);
  if (room.phase === 'scores') v.board = room.board;
  if (room.phase === 'wager') {
    const me = pid ? room.players.get(pid) : null;
    v.wager = { canWager: !!me && room.wagerIds.includes(pid) && room.wagers[pid] == null, mine: pid ? room.wagers[pid] : null, max: me ? me.score : 0, mult: C.FINALE_MULT };
  }
  if (room.phase === 'recap') {
    v.recap = { idx: room.recap.idx, total: room.recap.awards.length, award: room.recap.awards[room.recap.idx] };
  }
  if (room.phase === 'final') {
    v.winners = championIds(room);
    v.awards = (room.recap ? room.recap.awards : []).map(a => ({ id: a.id, name: a.name, icon: a.icon, winners: a.winners }));
  }
  return v;
}

function meta() {
  return {
    t: 'meta',
    avatars: C.AVATARS, colors: C.COLORS, twists: C.TWISTS, twistLevels: C.TWIST_LEVELS,
    roundChoices: C.ROUND_CHOICES, drawChoices: C.DRAW_CHOICES, brush: C.BRUSH, brushSizes: C.BRUSH_SIZES,
    games: GAMES.map(g => ({ id: g.id, name: g.name, icon: g.icon, tagline: g.tagline, rule: g.rule, duelRule: g.duelRule })),
    badges: LIVE_BADGES.map(b => ({ id: b.id, name: b.name, icon: b.icon, desc: b.desc })),
    maxName: C.MAX_NAME, maxReal: C.MAX_REAL, maxAnswer: C.MAX_ANSWER, finaleMult: C.FINALE_MULT, duelPts: C.DUEL_VOTE_PTS,
  };
}

function send(ws, obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function sendDrawings(room, ws, pid) {
  const cur = room.cur;
  if (room.phase !== 'play' || !cur || !cur.ctx) return;
  const game = GAME[cur.gameId];
  if (!game.drawings) return;
  const d = game.drawings(cur.ctx, pid);
  if (!ws.sentDrawings) ws.sentDrawings = new Set();
  for (const id of Object.keys(d)) {
    if (ws.sentDrawings.has(id)) continue;
    ws.sentDrawings.add(id);
    send(ws, { t: 'drawing', id, strokes: d[id] });
  }
}

function broadcast(room) {
  room.lastActive = Date.now();
  for (const p of room.players.values()) if (p.ws) { sendDrawings(room, p.ws, p.id); send(p.ws, viewFor(room, p.id)); }
  for (const h of room.hosts) { sendDrawings(room, h, null); send(h, viewFor(room, null)); }
}

// ---------------------------------------------------------------------------
// messages
// ---------------------------------------------------------------------------
function attach(ws, room, p) {
  if (p.ws && p.ws !== ws) {
    const old = p.ws;
    old.ctx = { room: null, pid: null, host: false };
    try { old.close(4000, 'replaced'); } catch (e) { /* ignore */ }
  }
  clearTimeout(p.dropTimer);
  p.ws = ws;
  p.connected = true;
  ws.ctx = { room, pid: p.id, host: false };
  ws.sentDrawings = new Set();
  ensureDealer(room);
  send(ws, { t: 'joined', code: room.code, playerId: p.id, token: p.token, name: p.name, real: p.real || '', avatar: p.avatar, color: p.color });
  broadcast(room);
}

function onClose(ws) {
  const { room, pid, host } = ws.ctx || {};
  if (!room) return;
  if (host) { room.hosts.delete(ws); return; }
  const p = room.players.get(pid);
  if (!p || p.ws !== ws) return;
  p.ws = null;
  p.connected = false;
  if (room.phase === 'lobby') scheduleLobbyDrop(room, p);
  ensureDealer(room);
  broadcast(room);
  recheck(room);
}

function lookFrom(room, m, exceptId) {
  const look = freeLook(room, exceptId, m.avatar, m.color);
  return { avatar: look.avatar, color: look.color, changed: look.avatar !== m.avatar || look.color !== m.color };
}

function handle(ws, m) {
  const ctx = ws.ctx;

  if (m.t === 'host') {
    const room = getRoom(m.code);
    if (!room) return send(ws, { t: 'error', code: 'noroom', msg: 'That table no longer exists.' });
    ws.ctx = { room, pid: null, host: true };
    ws.sentDrawings = new Set();
    room.hosts.add(ws);
    sendDrawings(room, ws, null);
    return send(ws, viewFor(room, null));
  }

  if (m.t === 'peek') {
    const room = getRoom(m.code);
    if (!room) return send(ws, { t: 'peek', ok: false, code: String(m.code || '').toUpperCase() });
    return send(ws, { t: 'peek', ok: true, code: room.code, taken: taken(room), full: room.players.size >= C.MAX_PLAYERS, phase: room.phase });
  }

  if (m.t === 'shuffle') {
    const room = getRoom(m.code) || (ctx.room && !ctx.host ? ctx.room : null);
    const look = shuffleLook(room);
    if (room && ctx.pid) { // keep my own look free for myself
      const mine = freeLook(room, ctx.pid, null, null);
      look.avatar = mine.avatar; look.color = mine.color;
      look.name = randomName(rand, taken(room, ctx.pid).names);
    }
    return send(ws, Object.assign({ t: 'shuffled' }, look));
  }

  if (m.t === 'rejoin') {
    const room = getRoom(m.code);
    const p = room && room.players.get(m.playerId);
    if (!p || p.token !== m.token) return send(ws, { t: 'error', code: 'nosession', msg: 'Your seat has gone. Please join again.' });
    return attach(ws, room, p);
  }

  if (m.t === 'join' || m.t === 'create') {
    const real = cleanName(m.real, C.MAX_REAL);
    const name = cleanName(m.name) || real;
    if (!real) return send(ws, { t: 'error', code: 'join', msg: 'Type your real name first.' });
    let room;
    if (m.t === 'create') {
      room = createRoom(false);
      if (!room) return send(ws, { t: 'error', code: 'join', msg: 'The game is very busy right now. Try again in a few minutes.' });
    } else {
      room = getRoom(m.code);
      if (!room) return send(ws, { t: 'error', code: 'join', msg: 'No table with that code. Check the code on the big screen.' });
    }
    const same = [...room.players.values()].find(p => p.name.toLowerCase() === name.toLowerCase());
    if (same) {
      if (same.connected) return send(ws, { t: 'error', code: 'join', msg: 'Someone at this table already has that name.' });
      same.real = real;
      return attach(ws, room, same); // reclaim a dropped seat (e.g. the phone lost its storage)
    }
    if (room.players.size >= C.MAX_PLAYERS) return send(ws, { t: 'error', code: 'join', msg: `This table is full (${C.MAX_PLAYERS} players).` });
    const look = lookFrom(room, m, null);
    const p = {
      id: crypto.randomBytes(6).toString('hex'), token: crypto.randomBytes(12).toString('hex'),
      name, real, avatar: look.avatar, color: look.color, score: 0, ws: null, connected: false, dropTimer: null,
    };
    room.players.set(p.id, p);
    room.order.push(p.id);
    stats(room, p.id);
    if (!room.dealerId) room.dealerId = p.id;
    attach(ws, room, p);
    if (look.changed && (m.avatar || m.color)) send(ws, { t: 'error', msg: 'Someone just grabbed that look, so you got a fresh one. Change it any time.' });
    return;
  }

  // ---- everything below needs a seat ----
  const room = ctx.room;
  if (!room || ctx.host) return;
  const pid = ctx.pid;
  const p = room.players.get(pid);
  if (!p) return;
  const isDealer = room.dealerId === pid;

  switch (m.t) {
    case 'look': {
      const name = cleanName(m.name) || p.name;
      if ([...room.players.values()].some(o => o.id !== pid && o.name.toLowerCase() === name.toLowerCase())) {
        return send(ws, { t: 'error', msg: 'Someone at this table already has that name.' });
      }
      const look = lookFrom(room, m, pid);
      p.name = name; p.avatar = look.avatar; p.color = look.color;
      if (cleanName(m.real, C.MAX_REAL)) p.real = cleanName(m.real, C.MAX_REAL);
      if (look.changed) send(ws, { t: 'error', msg: 'That one was just taken. Pick another.' });
      broadcast(room);
      break;
    }
    case 'settings': {
      if (!isDealer || room.phase !== 'lobby' || !m.patch) break;
      const s = room.settings, q = m.patch;
      if (['single', 'rotation', 'mix'].includes(q.mode)) s.mode = q.mode;
      if (GAME[q.single]) s.single = q.single;
      if (q.mix && typeof q.mix === 'object') {
        for (const id of GAME_IDS) if (typeof q.mix[id] === 'boolean') s.mix[id] = q.mix[id];
        if (!GAME_IDS.some(id => s.mix[id])) s.mix[GAME_IDS[0]] = true;
      }
      if (C.ROUND_CHOICES.includes(q.rounds)) s.rounds = q.rounds;
      if (Number.isInteger(q.twistFreq) && C.TWIST_LEVELS[q.twistFreq]) s.twistFreq = q.twistFreq;
      if (C.DRAW_CHOICES.includes(q.drawSecs)) s.drawSecs = q.drawSecs;
      if (typeof q.doodleGuess === 'boolean') s.doodleGuess = q.doodleGuess;
      if (typeof q.showdown === 'boolean') s.showdown = q.showdown;
      broadcast(room);
      break;
    }
    case 'start':
      if (!isDealer || room.phase !== 'lobby') break;
      if (connectedIds(room).length < C.MIN_PLAYERS) return send(ws, { t: 'error', msg: `You need at least ${C.MIN_PLAYERS} players.` });
      startGame(room);
      break;
    case 'game':
      if (room.phase !== 'play' || room.paused || !room.cur || !room.cur.ctx) break;
      if (typeof m.a !== 'string') break;
      GAME[room.cur.gameId].message(room.cur.ctx, pid, m.a, m.v);
      break;
    case 'wager': {
      if (room.phase !== 'wager' || room.paused || !room.wagerIds.includes(pid) || room.wagers[pid] != null) break;
      const n = Math.max(0, Math.min(p.score, Math.round(Number(m.amount) || 0)));
      room.wagers[pid] = n;
      stats(room, pid).wager = n;
      broadcast(room);
      checkWagers(room);
      break;
    }
    case 'next':        // dealer taps "next" / "skip ahead"
    case 'skip':
      if (!isDealer || room.phase === 'lobby' || room.phase === 'final') break;
      if (m.step != null && m.step !== room.step) break;   // a late double-tap: that step is already over
      if (room.paused) { room.paused = false; }
      if (room.t.fn) fire(room);
      break;
    case 'pause':
      if (isDealer) { pause(room); broadcast(room); }
      break;
    case 'resume':
      if (isDealer) { resume(room); broadcast(room); }
      break;
    case 'skipRound':
      if (!isDealer || (m.step != null && m.step !== room.step)) break;
      room.paused = false;
      if (room.phase === 'intro' || room.phase === 'play') endRound(room);
      else if (room.t.fn) fire(room);
      break;
    case 'endGame':
      if (!isDealer || room.phase === 'lobby') break;
      room.paused = false;
      if (room.phase === 'final' || !room.history.length) backToLobby(room);
      else if (room.phase === 'recap') finish(room);
      else startRecap(room);
      break;
    case 'playAgain':
      if (isDealer && room.phase === 'final') backToLobby(room);
      break;
    case 'rename': {
      if (!isDealer || !room.players.has(m.id)) break;
      const name = cleanName(m.name);
      if (!name) break;
      if ([...room.players.values()].some(o => o.id !== m.id && o.name.toLowerCase() === name.toLowerCase())) {
        return send(ws, { t: 'error', msg: 'Someone already has that name.' });
      }
      room.players.get(m.id).name = name;
      broadcast(room);
      break;
    }
    case 'kick':
      if (isDealer && m.id !== pid && room.players.has(m.id)) {
        const k = room.players.get(m.id);
        if (k.ws) send(k.ws, { t: 'kicked' });
        removePlayer(room, m.id);
        broadcast(room);
        recheck(room);
      }
      break;
    case 'leave':
      if (room.phase === 'lobby') {
        ws.ctx = { room: null, pid: null, host: false };
        p.ws = null;
        removePlayer(room, pid);
        broadcast(room);
      }
      break;
  }
}

// tidy up empty tables made from phones / online host screens
function sweep() {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.isDefault) continue;
    const anyone = [...room.players.values()].some(p => p.connected) || room.hosts.size > 0;
    if (!anyone && now - room.lastActive > 15 * 60 * 1000) { clearTimer(room); rooms.delete(room.code); }
  }
}

module.exports = { rooms, createRoom, getRoom, handle, onClose, meta, sweep, MAX_ROOMS };
