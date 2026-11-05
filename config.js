'use strict';
// Shared settings and fixed lists for Wild Card Showdown.

function num(v, d) { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : d; }
const env = process.env;

module.exports = {
  // timers (ms) - override with environment variables for testing
  ANSWER_MS: num(env.ANSWER_MS, 90000),   // write an answer / a fake
  GUESS_MS: num(env.GUESS_MS, 30000),     // guess one card / one drawing
  VOTE_MS: num(env.VOTE_MS, 30000),       // vote in Bluff Club, Doodle favourites, Showdown
  REVEAL_MS: num(env.REVEAL_MS, 9000),    // each reveal
  SCORES_MS: num(env.SCORES_MS, 25000),   // leaderboard between rounds
  INTRO_MS: num(env.INTRO_MS, 5000),      // round intro (twist card flip)
  WAGER_MS: num(env.WAGER_MS, 30000),     // Final Wager
  RECAP_MS: num(env.RECAP_MS, 7000),      // each award in the recap
  SHOW_MS: num(env.SHOW_MS, 6000),        // each drawing in the gallery
  DRAW_MAX_MS: 180000,
  MIN_PLAYERS: num(env.MIN_PLAYERS, 3),
  MAX_PLAYERS: 8,
  MAX_NAME: 18,
  MAX_REAL: 14,
  MAX_ANSWER: 140,
  MAX_FAKE: 60,

  AVATARS: ['🦊', '🐸', '🐙', '🦄', '🐼', '🐯', '🦉', '🐧', '🦖', '🐝', '🐢', '🦀', '🐵', '🐨', '🐷', '🐻'],
  COLORS: [
    { id: 'ruby', name: 'Ruby', hex: '#d23b3b' },
    { id: 'tangerine', name: 'Tangerine', hex: '#ec7a26' },
    { id: 'gold', name: 'Gold', hex: '#d9a514' },
    { id: 'lime', name: 'Lime', hex: '#7cb82f' },
    { id: 'emerald', name: 'Emerald', hex: '#24945a' },
    { id: 'teal', name: 'Teal', hex: '#169c9c' },
    { id: 'sky', name: 'Sky', hex: '#2f9be0' },
    { id: 'cobalt', name: 'Cobalt', hex: '#2f55d6' },
    { id: 'violet', name: 'Violet', hex: '#7a4fd1' },
    { id: 'plum', name: 'Plum', hex: '#8e2f7d' },
    { id: 'pink', name: 'Pink', hex: '#e0559b' },
    { id: 'coral', name: 'Coral', hex: '#f0716b' },
    { id: 'chocolate', name: 'Chocolate', hex: '#7b4a2a' },
    { id: 'slate', name: 'Slate', hex: '#5a6b7c' },
    { id: 'charcoal', name: 'Charcoal', hex: '#2e2e36' },
    { id: 'pearl', name: 'Pearl', hex: '#b8b2a7' },
  ],
  // Doodle Duel brush colours (index is sent with each stroke; last one is the eraser)
  BRUSH: ['#222222', '#e23b3b', '#f08a24', '#f2c230', '#2e9e5b', '#2f6fd6', '#8a4fd1', '#8b5a2b', '#ffffff'],
  BRUSH_SIZES: [6, 14, 32],

  ROUND_CHOICES: [3, 6, 9, 12],
  TWIST_LEVELS: [
    { id: 0, name: 'Never', p: 0 },
    { id: 1, name: 'Rarely', p: 0.25 },
    { id: 2, name: 'Sometimes', p: 0.5 },
    { id: 3, name: 'Often', p: 0.75 },
    { id: 4, name: 'Every round', p: 1 },
  ],
  DRAW_CHOICES: [60, 90, 120, 180],

  TWISTS: {
    doubleDown: { id: 'doubleDown', name: 'Double Down', icon: '✌️', desc: 'Every point this round counts double.' },
    steal: { id: 'steal', name: 'Steal', icon: '🦝', desc: 'The top scorer this round steals points from the leader.' },
    underdog: { id: 'underdog', name: 'Underdog', icon: '🐶', desc: 'Whoever is in last place scores double this round.' },
    mystery: { id: 'mystery', name: 'Mystery Round', icon: '❓', desc: 'Nobody knows which game is next until the last second.' },
    speed: { id: 'speed', name: 'Speed Round', icon: '⚡', desc: 'Every timer is cut in half. Go go go!' },
    reverse: { id: 'reverse', name: 'Reverse Scoring', icon: '🔄', desc: 'Fooling people pays double. Guessing right pays half.' },
  },

  FINALE_MULT: 3,
  DUEL_VOTE_PTS: 200,
};
