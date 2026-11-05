/* Doodle Duel - phone + host screens, and the finger drawing pad */
(function () {
  'use strict';
  var WCS = window.WCS, esc = WCS.esc;

  // the player's own drawing lives here while they draw (survives re-renders and reconnects)
  var local = { id: null, strokes: [], color: 0, size: 1 };

  function frame(id, cls, caption) {
    return '<div class="doodle-frame ' + (cls || '') + '">' + WCS.canvasFor(id) + (caption ? '<div class="caption">' + caption + '</div>' : '') + '</div>';
  }

  function drawScreen(s, u) {
    var g = s.game;
    if (!g.artist) {
      var who = s.cur.showdown ? '<div class="card qcard doodle small"><span class="corner">The duellists are drawing</span>' + esc(g.duelPrompt || '') + '</div>' : '';
      return u.timer() + who + (s.inRound || s.cur.showdown ? '<p class="hint">Everyone is drawing their secret prompt&hellip;</p>' : u.spectating()) + u.waiting();
    }
    var tools = '<div class="palette">' + g.brush.map(function (c, i) {
      return '<button type="button" class="swatch' + (i === local.color ? ' on' : '') + (i === g.brush.length - 1 ? ' eraser' : '') + '" data-color-i="' + i + '" style="--c:' + c + '" aria-label="' + (i === g.brush.length - 1 ? 'Eraser' : 'Colour') + '">' + (i === g.brush.length - 1 ? '⌫' : '') + '</button>';
    }).join('') + '</div>' +
      '<div class="toolrow">' + g.sizes.map(function (sz, i) {
        return '<button type="button" class="size' + (i === local.size ? ' on' : '') + '" data-size-i="' + i + '"><span style="width:' + (6 + i * 7) + 'px;height:' + (6 + i * 7) + 'px"></span></button>';
      }).join('') + '<button type="button" class="tool" id="undoBtn">↶ Undo</button></div>';
    var done = g.done;
    return '<div class="card qcard doodle small secret"><span class="corner">Your secret prompt &middot; draw it!</span>' + esc(g.prompt) + '</div>' + u.timer() +
      '<div class="pad-wrap' + (done ? ' done' : '') + '"><canvas id="pad" class="doodle pad"></canvas>' + (done ? '<div class="pad-done">Done! Waiting for the others&hellip;</div>' : '') + '</div>' +
      (done ? '' : tools) +
      (done ? '<button class="btn secondary" data-a="done" data-v="0" data-bool="1">Wait, keep drawing</button>'
        : '<button class="btn" data-a="done" data-v="1" data-bool="1" id="doneBtn">I\'m done</button>') + u.waiting();
  }

  function choicesHtml(s, u) {
    var g = s.game, reveal = g.phase === 'guessReveal';
    return '<div class="options">' + g.choices.map(function (text, i) {
      if (!reveal && g.canGuess) return '<button class="option" data-a="guess" data-v="' + i + '" data-num="1">' + esc(text) + '</button>';
      var pickers = reveal ? Object.keys(g.guesses).filter(function (id) { return g.guesses[id] === i; }) : [];
      return '<div class="option' + (reveal && i === g.answer ? ' correct' : '') + (g.myGuess === i ? ' voted' : '') + '">' + esc(text) +
        (pickers.length ? '<span class="pickers">' + pickers.map(function (id) { return u.av(id, 'small'); }).join('') + '</span>' : '') + '</div>';
    }).join('') + '</div>';
  }

  function gallery(s, u, vote) {
    var g = s.game;
    var list = g.entries.slice();
    if (!vote) list.sort(function (a, b) { return b.voters.length - a.voters.length; });
    var top = !vote && list.length ? list[0].voters.length : 0;
    return '<div class="gallery">' + list.map(function (e) {
      var cap = e.prompt ? esc(e.prompt) : '';
      if (!vote) {
        cap = (top && e.voters.length === top ? '🏆 ' : '') + u.who(e.artistId) + ' <b>' + e.voters.length + ' vote' + (e.voters.length === 1 ? '' : 's') + '</b>' +
          (g.points[e.artistId] ? ' <span class="pts">+' + g.points[e.artistId] + '</span>' : '') + (e.prompt ? '<small>' + esc(e.prompt) + '</small>' : '');
      }
      if (vote && g.canVote && !e.mine) return '<button class="doodle-frame pickable" data-a="vote" data-v="' + e.i + '" data-num="1">' + WCS.canvasFor(e.drawing) + '<div class="caption">' + cap + '</div></button>';
      return frame(e.drawing, (e.mine ? 'mine ' : '') + (g.myVote === e.i ? 'voted' : ''), (e.mine && vote ? '<b>Yours</b> ' : '') + cap);
    }).join('') + '</div>';
  }

  function phone(s, u) {
    var g = s.game;
    if (g.phase === 'draw') return drawScreen(s, u);
    if (g.phase === 'empty') return '<h2>Blank canvases all round!</h2><p class="hint">Nobody drew anything. Moving on&hellip;</p>';
    if (g.phase === 'show') return '<div class="sub">Drawing ' + (g.index + 1) + ' of ' + g.total + '</div>' + frame(g.drawing, 'big', esc(g.prompt)) + u.timer();
    if (g.phase === 'guess' || g.phase === 'guessReveal') {
      var h = '<div class="sub">Drawing ' + (g.index + 1) + ' of ' + g.total + ' &middot; Which prompt was it?</div>' + (g.phase === 'guess' ? u.timer() : '') + frame(g.drawing, 'big');
      if (g.phase === 'guessReveal') {
        var mine = g.points && g.points[s.you];
        return h + '<div class="youbox">' + (g.mine ? 'Your masterpiece!' : 'Drawn by') + ' ' + u.who(g.artistId) + (mine ? ' <b>+' + mine + '</b>' : '') + '</div>' + choicesHtml(s, u) + u.timer();
      }
      if (g.mine) return h + '<h2>This one\'s yours!</h2><p class="hint">Watch them try to work it out&hellip;</p>' + u.waiting();
      if (!s.inRound) return h + u.spectating() + choicesHtml(s, u);
      return h + (g.canGuess ? '' : '<p class="hint">Locked in. Waiting for the others&hellip;</p>') + choicesHtml(s, u) + (g.canGuess ? '' : u.waiting());
    }
    if (g.phase === 'vote') {
      var title = g.canVote ? '<h2>Tap your favourite</h2>' : '<p class="hint">' + (g.myVote != null ? 'Vote locked in. Waiting&hellip;' : 'Voting in progress&hellip;') + '</p>';
      return u.timer() + (g.duelPrompt ? '<div class="card qcard doodle small"><span class="corner">Showdown prompt</span>' + esc(g.duelPrompt) + '</div>' : '') + title + gallery(s, u, true) + (g.canVote ? '' : u.waiting());
    }
    if (g.phase === 'results') return '<h2>The votes are in</h2>' + gallery(s, u, false) + u.timer();
    return '';
  }

  function host(s, u) {
    var g = s.game;
    if (g.phase === 'draw') return '<div class="host-status">Draw your secret prompt on your phone!</div>' + (g.duelPrompt ? '<div class="card qcard doodle">' + esc(g.duelPrompt) + '</div>' : '') + u.timer() + '<div class="host-draw-icon">🎨✏️</div>' + u.waiting();
    if (g.phase === 'empty') return '<h2>Nobody drew anything!</h2>';
    if (g.phase === 'show') return '<div class="host-status">Drawing ' + (g.index + 1) + ' of ' + g.total + '</div>' + frame(g.drawing, 'host-big', esc(g.prompt));
    if (g.phase === 'guess' || g.phase === 'guessReveal') {
      return '<div class="host-status">Drawing ' + (g.index + 1) + ' of ' + g.total + ' &middot; Which prompt was it?</div>' +
        '<div class="host-split">' + frame(g.drawing, 'host-big') + '<div>' +
        (g.phase === 'guessReveal' ? '<div class="youbox">Drawn by ' + u.who(g.artistId, '') + '</div>' : u.timer()) +
        choicesHtml(s, u) + (g.phase === 'guess' ? u.waiting() : '') + '</div></div>';
    }
    if (g.phase === 'vote') return '<div class="host-status">Vote for your favourite on your phone</div>' + (g.duelPrompt ? '<div class="card qcard doodle small">' + esc(g.duelPrompt) + '</div>' : '') + u.timer() + gallery(s, u, true) + u.waiting();
    if (g.phase === 'results') return '<h2>The votes are in</h2>' + gallery(s, u, false);
    return '';
  }

  function keep(s) {
    var g = s.game;
    if (g.phase === 'draw' && g.artist) return 'dd-draw:' + g.myDrawing + ':' + g.done;
    return null;
  }

  // ---------- the drawing pad ----------
  // size the pad so the colours, sizes and I'm done button all fit on screen below it
  function fitPad(canvas) {
    var wrap = canvas.parentNode, box = wrap.parentNode;
    if (!wrap || !box) return;
    wrap.style.width = '100%';
    var top = wrap.getBoundingClientRect().top + window.scrollY, below = 0, el = wrap.nextElementSibling;
    while (el) { if (el.offsetParent !== null) below += el.getBoundingClientRect().height + 12; el = el.nextElementSibling; }
    var avail = window.innerHeight - top - below - 8;
    var w = Math.max(200, Math.min(wrap.getBoundingClientRect().width, avail));
    wrap.style.width = Math.floor(w) + 'px';
  }

  function bindPad(s, root, send) {
    var g = s.game;
    var canvas = root.querySelector('#pad');
    if (!canvas) return;
    fitPad(canvas);
    if (local.id !== g.myDrawing) {
      local.id = g.myDrawing;
      local.strokes = (WCS.drawings[g.myDrawing] || []).slice();
    }
    var ctx2d = canvas.getContext('2d');
    var k = 1;
    function redraw() { WCS.paint(canvas, local.strokes); k = canvas.width / 1000; }
    redraw();
    if (g.done) return;

    var cur = null, pid = null;
    function pos(e) {
      var r = canvas.getBoundingClientRect();
      return [Math.max(0, Math.min(1000, Math.round((e.clientX - r.left) / r.width * 1000))),
        Math.max(0, Math.min(1000, Math.round((e.clientY - r.top) / r.height * 1000)))];
    }
    // draw just the newest piece of the stroke (same curve WCS.paintStroke makes)
    function segment(st) {
      var p = st.p, m = p.length / 2;
      WCS.strokeStyle(ctx2d, st, k);
      if (m < 3) return;
      var j = m - 2; // control point index
      var sx = j === 1 ? p[0] : (p[2 * j - 2] + p[2 * j]) / 2, sy = j === 1 ? p[1] : (p[2 * j - 1] + p[2 * j + 1]) / 2;
      var ex = (p[2 * j] + p[2 * j + 2]) / 2, ey = (p[2 * j + 1] + p[2 * j + 3]) / 2;
      ctx2d.beginPath();
      ctx2d.moveTo(sx * k, sy * k);
      ctx2d.quadraticCurveTo(p[2 * j] * k, p[2 * j + 1] * k, ex * k, ey * k);
      ctx2d.stroke();
    }
    function finishPiece(st) {
      var p = st.p, m = p.length / 2;
      WCS.strokeStyle(ctx2d, st, k);
      if (m === 1) { ctx2d.beginPath(); ctx2d.arc(p[0] * k, p[1] * k, ctx2d.lineWidth / 2, 0, Math.PI * 2); ctx2d.fill(); return; }
      var sx = m === 2 ? p[0] : (p[p.length - 4] + p[p.length - 2]) / 2, sy = m === 2 ? p[1] : (p[p.length - 3] + p[p.length - 1]) / 2;
      ctx2d.beginPath();
      ctx2d.moveTo(sx * k, sy * k);
      ctx2d.lineTo(p[p.length - 2] * k, p[p.length - 1] * k);
      ctx2d.stroke();
    }
    function add(e) {
      var q = pos(e), p = cur.p;
      var dx = q[0] - p[p.length - 2], dy = q[1] - p[p.length - 1];
      if (dx * dx + dy * dy < 9) return; // ignore tiny jitters (keeps the data small)
      p.push(q[0], q[1]);
      segment(cur);
    }
    function down(e) {
      if (cur || (e.button != null && e.button > 0)) return;
      e.preventDefault();
      pid = e.pointerId;
      try { canvas.setPointerCapture(pid); } catch (x) { /* ignore */ }
      var q = pos(e);
      cur = { c: local.color, s: local.size, p: [q[0], q[1]] };
    }
    function move(e) {
      if (!cur || e.pointerId !== pid) return;
      e.preventDefault();
      var list = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      if (list && list.length) for (var i = 0; i < list.length; i++) add(list[i]); else add(e);
    }
    function up(e) {
      if (!cur || e.pointerId !== pid) return;
      e.preventDefault();
      finishPiece(cur);
      local.strokes.push(cur);
      send('stroke', cur);
      cur = null; pid = null;
    }
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    // stop the page scrolling / zooming / bouncing under the finger (iOS needs this as well as touch-action)
    ['touchstart', 'touchmove', 'touchend'].forEach(function (t) { canvas.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false }); });

    root.querySelector('#undoBtn').addEventListener('click', function () {
      if (!local.strokes.length) return;
      local.strokes.pop();
      send('undo');
      redraw();
    });
    var pal = root.querySelectorAll('[data-color-i]');
    for (var i = 0; i < pal.length; i++) pal[i].addEventListener('click', function () {
      local.color = +this.getAttribute('data-color-i');
      for (var j = 0; j < pal.length; j++) pal[j].classList.toggle('on', pal[j] === this);
    });
    var sz = root.querySelectorAll('[data-size-i]');
    for (var n = 0; n < sz.length; n++) sz[n].addEventListener('click', function () {
      local.size = +this.getAttribute('data-size-i');
      for (var j = 0; j < sz.length; j++) sz[j].classList.toggle('on', sz[j] === this);
    });
  }

  function after(s, u, root, send) {
    if (s.game.phase === 'draw' && s.game.artist) bindPad(s, root, send);
  }

  // after a reconnect, make sure the server has everything we drew
  function resync(s, send) {
    var g = s.game;
    if (g && g.phase === 'draw' && g.artist && local.id === g.myDrawing && local.strokes.length) send('sync', local.strokes);
  }
  // the server's copy of our drawing (e.g. after a page reload): use it if we have nothing locally
  function onDrawing(id, strokes) {
    if (id === local.id && !local.strokes.length && strokes.length) {
      local.strokes = strokes.slice();
      var pad = document.getElementById('pad');
      if (pad) WCS.paint(pad, local.strokes);
    } else if (id !== local.id && WCS.lastState && WCS.lastState.game && WCS.lastState.game.myDrawing === id) {
      local.id = id; local.strokes = strokes.slice();
      var pad2 = document.getElementById('pad');
      if (pad2) WCS.paint(pad2, local.strokes);
    }
  }

  function cue(s) {
    var p = s.game.phase;
    if (p === 'draw') return { sound: 'whoosh' };
    if (p === 'guessReveal') return { sound: 'flip', buzz: 60 };
    if (p === 'show' || p === 'guess') return { sound: 'pop' };
    if (p === 'vote') return { sound: 'pop' };
    if (p === 'results') return { sound: 'fanfare', buzz: [80, 60, 80] };
    return null;
  }


  function goal(s) {
    var g = s.game, duel = s.cur.showdown, role = s.cur.role;
    if (g.phase === 'draw') {
      if (duel && role !== 'contestant') return 'The duellists are drawing the same prompt. Next you <b>vote for the best drawing</b>.';
      return duel ? 'Draw the prompt <b>better than your rival</b>. Every audience vote: <b>' + WCS.meta.duelPts + ' points</b>.'
        : 'Draw it so people can <b>guess it</b>. Best drawings get <b>+100 per vote</b>.';
    }
    if (g.phase === 'guess') return g.mine ? 'This is <b>your</b> drawing. You get <b>+50</b> for every player who guesses it right.' : '<b>Which prompt was this drawing?</b> Right guess: <b>+100</b>.';
    if (g.phase === 'guessReveal') return 'Right guess: <b>+100</b>. The artist gets <b>+50</b> per right guess.';
    if (g.phase === 'show') return 'Have a look at everyone\'s drawings. Next you <b>vote for your favourite</b>.';
    if (g.phase === 'vote') return 'Vote for your <b>favourite drawing</b> (not your own). Each vote: <b>+' + (duel ? WCS.meta.duelPts : 100) + '</b> to the artist.';
    return 'The votes are in!';
  }

  WCS.register('doodleDuel', { goal: goal, phone: phone, host: host, keep: keep, after: after, cue: cue, resync: resync, onDrawing: onDrawing });
})();
