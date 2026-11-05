/* Wild Card Showdown - shared client code for the phones and the host screen (no build step).
   Exposes window.WCS: helpers, sound + vibration, the doodle renderer, and the game registry
   (each file in public/games/ registers itself with WCS.register). */
(function () {
  'use strict';
  var WCS = window.WCS = { games: {}, meta: null, drawings: {} };

  WCS.register = function (id, mod) { WCS.games[id] = mod; };

  // ---------- small helpers ----------
  WCS.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var esc = WCS.esc;

  // helpers bound to the latest state (u.player(id), u.av(p) ...)
  WCS.helpers = function (state, host) {
    var u = { s: state, host: !!host };
    u.player = function (id) {
      for (var i = 0; state && i < state.players.length; i++) if (state.players[i].id === id) return state.players[i];
      return null;
    };
    u.name = function (id) { var p = u.player(id); return p ? WCS.pname(p) : '?'; };
    u.av = function (p, size) { return WCS.avatar(typeof p === 'string' ? u.player(p) : p, size); };
    u.who = function (id, size) { var p = u.player(id); return '<span class="who">' + WCS.avatar(p, size || 'small') + '<span>' + WCS.pname(p) + '</span></span>'; };
    u.isDealer = function () { return !host && state && state.dealerId === state.you; };
    u.me = function () { return u.player(state.you); };
    u.timer = function () { return '<div class="timer" data-timer><div class="bar"><div class="fill"></div></div><span class="secs"></span></div>'; };
    u.waiting = function () {
      return '<div class="waiting" id="waiting">' + WCS.waitingChips(state) + '</div>';
    };
    u.pts = function (n) { return n ? '<span class="pts">' + (n > 0 ? '+' : '') + n + '</span>' : ''; };
    u.spectating = function () {
      return '<p class="hint">You joined mid-round, so you\'re watching this one. You\'re dealt in next round.</p>';
    };
    return u;
  };

  // "Sneaky Walrus (Ryan)": character name plus the real name, so everyone knows who's who
  WCS.pname = function (p) {
    if (!p) return '?';
    var r = p.real && p.real.toLowerCase() !== p.name.toLowerCase() ? ' <span class="real">(' + esc(p.real) + ')</span>' : '';
    return esc(p.name) + r;
  };

  WCS.avatar = function (p, size) {
    if (!p) return '<span class="av ' + (size || '') + '" style="--c:#555"><i>?</i></span>';
    return '<span class="av ' + (size || '') + (p.connected === false ? ' off' : '') + '" style="--c:' + p.color + '"><i>' + esc(p.avatar) + '</i></span>';
  };

  WCS.badgeIcons = function (p) {
    if (!p || !p.badges || !p.badges.length || !WCS.meta) return '';
    return p.badges.map(function (b) {
      var d = WCS.badge(b);
      return d ? '<span class="bdg" title="' + esc(d.name) + '">' + d.icon + '<em>' + esc(d.name) + '</em></span>' : '';
    }).join('');
  };
  WCS.badge = function (id) {
    var l = (WCS.meta && WCS.meta.badges) || [];
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  };
  WCS.game = function (id) {
    var l = (WCS.meta && WCS.meta.games) || [];
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  };

  WCS.waitingChips = function (state) {
    return state.players.filter(function (p) { return p.done === true || p.done === false; }).map(function (p) {
      return '<div class="w' + (p.done ? ' done' : '') + '">' + WCS.avatar(p, 'small') + '<span>' + esc(p.real || p.name) + '</span></div>';
    }).join('');
  };

  // ---------- timers ----------
  var deadline = 0, totalMs = 0, paused = false, frozen = 0, warned = '';
  WCS.setClock = function (state) {
    paused = !!state.paused;
    frozen = state.msLeft || 0;
    deadline = state.msLeft != null ? Date.now() + state.msLeft : 0;
    totalMs = state.totalMs || 0;
    WCS.clockStep = state.step;
  };
  WCS.tick = function () {
    var els = document.querySelectorAll('[data-timer]');
    if (!els.length) return;
    var left = paused ? frozen : Math.max(0, deadline - Date.now());
    var secs = Math.ceil(left / 1000);
    var pct = totalMs ? Math.max(0, Math.min(100, (left / totalMs) * 100)) : 0;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      el.querySelector('.fill').style.width = pct + '%';
      el.querySelector('.secs').textContent = deadline ? (secs >= 60 ? Math.floor(secs / 60) + ':' + ('0' + secs % 60).slice(-2) : secs + 's') : '';
      el.classList.toggle('urgent', deadline > 0 && secs <= 10);
      el.classList.toggle('paused', paused);
    }
    // the 10-second warning (once per step)
    if (!paused && deadline && totalMs >= 20000 && secs <= 10 && secs > 0 && warned !== String(WCS.clockStep)) {
      warned = String(WCS.clockStep);
      WCS.sfx('warn');
      WCS.buzz([80, 60, 80]);
      if (WCS.onWarn) WCS.onWarn();
    }
  };
  setInterval(function () { WCS.tick(); }, 250);

  // ---------- sound (synthesised with Web Audio: no files, works offline) ----------
  var ac = null, muted = false;
  try { muted = localStorage.getItem('wcs.muted') === '1'; } catch (e) { /* ignore */ }
  function audio() {
    if (!ac) {
      var A = window.AudioContext || window.webkitAudioContext;
      if (!A) return null;
      try { ac = new A(); } catch (e) { return null; }
    }
    if (ac.state === 'suspended') { try { ac.resume(); } catch (e) { /* ignore */ } }
    return ac;
  }
  // phones only allow sound after a tap: unlock on the first one
  function unlock() {
    var a = audio();
    if (!a) return;
    try { var b = a.createBuffer(1, 1, 22050), s = a.createBufferSource(); s.buffer = b; s.connect(a.destination); s.start(0); } catch (e) { /* ignore */ }
    WCS.audioReady = a.state !== 'suspended';
  }
  ['pointerdown', 'touchend', 'keydown', 'click'].forEach(function (ev) { document.addEventListener(ev, unlock, { passive: true, capture: true }); });

  function tone(a, f, t, dur, type, vol, f2) {
    var o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  var noiseBuf = null;
  function noise(a, t, dur, vol, freq, q) {
    if (!noiseBuf) {
      noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    var s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = noiseBuf;
    f.type = 'bandpass'; f.frequency.value = freq || 1000; f.Q.value = q || 1;
    g.gain.setValueAtTime(vol || 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(a.destination);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  var SOUNDS = {
    pop: function (a, t) { tone(a, 520, t, 0.09, 'sine', 0.18, 880); },
    tap: function (a, t) { tone(a, 700, t, 0.05, 'triangle', 0.1); },
    flip: function (a, t) { noise(a, t, 0.22, 0.25, 2200, 0.8); tone(a, 300, t + 0.18, 0.12, 'triangle', 0.12, 600); },
    ding: function (a, t) { tone(a, 880, t, 0.35, 'sine', 0.2); tone(a, 1320, t + 0.09, 0.5, 'sine', 0.16); },
    wrong: function (a, t) { tone(a, 220, t, 0.18, 'square', 0.08, 160); tone(a, 160, t + 0.16, 0.25, 'square', 0.08, 110); },
    warn: function (a, t) { tone(a, 1000, t, 0.08, 'square', 0.07); tone(a, 1000, t + 0.16, 0.08, 'square', 0.07); },
    drum: function (a, t) {
      var x = 0, gap = 0.09;
      for (var i = 0; i < 22; i++) { noise(a, t + x, 0.08, 0.22 + i * 0.01, 180 + (i % 2) * 60, 0.7); x += gap; gap = Math.max(0.035, gap * 0.93); }
      noise(a, t + x + 0.05, 0.9, 0.35, 5000, 0.5);   // crash
      tone(a, 90, t + x + 0.05, 0.4, 'sine', 0.3, 50);
    },
    fanfare: function (a, t) {
      [523, 659, 784, 1047].forEach(function (f, i) { tone(a, f, t + i * 0.12, i === 3 ? 0.7 : 0.16, 'triangle', 0.17); });
      tone(a, 784, t + 0.48, 0.7, 'sine', 0.08);
    },
    whoosh: function (a, t) { noise(a, t, 0.45, 0.18, 900, 0.5); },
    cash: function (a, t) { tone(a, 1568, t, 0.08, 'square', 0.06); tone(a, 2093, t + 0.08, 0.3, 'square', 0.06); },
  };
  WCS.sfx = function (name, delay) {
    if (muted || !SOUNDS[name]) return;
    var a = audio();
    if (!a || a.state === 'suspended') return;
    try { SOUNDS[name](a, a.currentTime + 0.01 + (delay || 0)); } catch (e) { /* ignore */ }
  };
  WCS.isMuted = function () { return muted; };
  WCS.setMuted = function (m) { muted = !!m; try { localStorage.setItem('wcs.muted', muted ? '1' : '0'); } catch (e) { /* ignore */ } };
  // vibration: Android Chrome supports it; iPhones quietly ignore it
  WCS.buzz = function (pattern) {
    if (WCS.noBuzz || muted) return;
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* ignore */ }
  };

  // ---------- doodles: strokes are {c: colour index, s: size index, p: [x,y, x,y ...]} in 0..1000 ----------
  WCS.sizeCanvas = function (canvas) {
    var dpr = Math.min(3, window.devicePixelRatio || 1);
    var w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    return canvas.width / 1000;
  };
  WCS.strokeStyle = function (g, st, k) {
    var brush = (WCS.meta && WCS.meta.brush) || ['#222'], sizes = (WCS.meta && WCS.meta.brushSizes) || [10];
    g.strokeStyle = g.fillStyle = brush[st.c] || '#222';
    g.lineWidth = (sizes[st.s] || 10) * k;
    g.lineCap = 'round';
    g.lineJoin = 'round';
  };
  WCS.paintStroke = function (g, st, k) {
    var p = st.p;
    WCS.strokeStyle(g, st, k);
    if (p.length <= 2) { g.beginPath(); g.arc(p[0] * k, p[1] * k, g.lineWidth / 2, 0, Math.PI * 2); g.fill(); return; }
    g.beginPath();
    g.moveTo(p[0] * k, p[1] * k);
    // smooth curve through the midpoints
    for (var i = 2; i < p.length - 2; i += 2) {
      var mx = (p[i] + p[i + 2]) / 2, my = (p[i + 1] + p[i + 3]) / 2;
      g.quadraticCurveTo(p[i] * k, p[i + 1] * k, mx * k, my * k);
    }
    g.lineTo(p[p.length - 2] * k, p[p.length - 1] * k);
    g.stroke();
  };
  WCS.paint = function (canvas, strokes) {
    var k = WCS.sizeCanvas(canvas);
    var g = canvas.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    for (var i = 0; strokes && i < strokes.length; i++) WCS.paintStroke(g, strokes[i], k);
  };
  WCS.canvasFor = function (id, cls) { return '<canvas class="doodle ' + (cls || '') + '" data-drawing="' + esc(id) + '"></canvas>'; };
  WCS.paintAll = function (root) {
    var list = (root || document).querySelectorAll('canvas[data-drawing]');
    for (var i = 0; i < list.length; i++) {
      var id = list[i].getAttribute('data-drawing');
      WCS.paint(list[i], WCS.drawings[id] || []);
    }
  };
  window.addEventListener('resize', function () { WCS.paintAll(); });

  // ---------- generic "card flip" used by twists, reveals and awards ----------
  WCS.flipCard = function (front, back, cls, instant) {
    return '<div class="flip ' + (cls || '') + (instant ? ' flipped instant' : '') + '" data-flip><div class="flip-inner">' +
      '<div class="face front">' + front + '</div><div class="face back">' + back + '</div></div></div>';
  };
  WCS.runFlips = function (root, delay) {
    var list = (root || document).querySelectorAll('[data-flip]:not(.flipped)');
    for (var i = 0; i < list.length; i++) {
      (function (el) { setTimeout(function () { el.classList.add('flipped'); }, delay == null ? 500 : delay); })(list[i]);
    }
  };


  // the banner that stays on screen all round: what you're trying to do right now
  WCS.goalBanner = function (s, host) {
    var mod = s.cur && WCS.games[s.cur.gameId];
    if (!mod || !mod.goal || !s.game) return '';
    var text = mod.goal(s);
    if (!text) return '';
    var t = s.cur.twist, extra = '';
    if (t === 'reverse') extra = 'Reverse Scoring: fooling pays <b>double</b>, guessing right pays <b>half</b>.';
    else if (t === 'doubleDown') extra = 'Double Down: every point counts <b>double</b>.';
    else if (t === 'underdog') extra = 'Underdog: last place scores <b>double</b>.';
    else if (t === 'steal') extra = 'Steal: top scorer this round <b>steals from the leader</b>.';
    else if (t === 'speed') extra = 'Speed Round: timers cut in <b>half</b>.';
    if (s.game.phase === 'draw' && !host) extra = '';
    if (s.cur.finale) extra = 'Finale: every point counts <b>&times;' + WCS.meta.finaleMult + '</b>. Top half wins their bet.';
    if (s.game.phase === 'draw' && !host && s.cur.finale) extra = '';
    return '<div class="goal' + (host ? ' host-goal' : '') + '"><span class="goal-tag">🎯 Your goal</span><span class="goal-text">' + text + '</span>' +
      (extra ? '<span class="goal-extra">' + extra + '</span>' : '') + '</div>';
  };

  WCS.ordinal = function (n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
})();
