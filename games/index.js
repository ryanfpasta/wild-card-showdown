'use strict';
// GAME BRANCHES
// Each game is one module. The hub (hub.js) owns the lobby, players, rounds, twists,
// scoring multipliers, leaderboard, badges and finale; a game only decides
//   1. what appears on the phones      -> view(ctx, playerId)   (+ a client file in public/games/)
//   2. how players respond             -> message(ctx, playerId, action, value)
//   3. how points are awarded          -> ctx.award(playerId, points, kind)
//
// A game module exports:
//   id, name, icon, tagline, duelRule
//   start(ctx)                  begin a round: set ctx.g (the game's own state) and a ctx.timer
//   message(ctx, pid, a, v)     a player action {t:'game', a, v} from a phone
//   view(ctx, pid)              JSON for one phone (pid) or the host screen (pid = null). Must not leak secrets.
//   waiting(ctx)                {pid: true/false} - who has / hasn't acted in the current step (or null)
//   check(ctx)                  "has everyone acted?" - called after disconnects, removals and resume
//   drawings(ctx, pid)          optional: {drawingId: strokes} this viewer needs
// and calls ctx.done() when its round is over.
//
// ctx (made by the hub for each round):
//   ctx.g                       the game's state object
//   ctx.round, ctx.gameKey (unique per game), ctx.settings, ctx.finale
//   ctx.duel                    null, or {contestants: [ids], audience: [ids]} for the Showdown Duel
//   ctx.participants()          ids dealt into this round (still at the table)
//   ctx.has(id), ctx.connected(id)
//   ctx.ms(baseMs)              timer length after twists (Speed Round halves it)
//   ctx.timer(ms, fn)           the one pausable/skippable phase timer
//   ctx.award(id, pts, kind)    kind: 'correct' | 'fool' | 'vote' | 'art' | 'duel'; returns the points actually given
//   ctx.stat(id, key, n)        add to a badge statistic
//   ctx.pick(key, list)         a random item not used yet at this table
//   ctx.update()                send fresh state to every screen
//   ctx.error(pid, msg, code)   show a message on one phone
//   ctx.done()                  round over -> leaderboard
//
// To add a game: write games/<id>.js and public/games/<id>.js, then add it to the list below.

module.exports = [
  require('./cardCulprit'),
  require('./bluffClub'),
  require('./doodleDuel'),
];
