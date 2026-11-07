/* Wild Card Showdown - phone client (vanilla JS, no build step).
   The hub screens (join, lobby, setup, intro, leaderboard, wager, recap, final) live here;
   each game's own screens live in public/games/<id>.js. */
(function () {
  'use strict';
  var WCS = window.WCS, esc = WCS.esc;

  var app = document.getElementById('app');
  var banner = document.getElementById('banner');
  var toastEl = document.getElementById('toast');
  var sheetEl = document.getElementById('sheet');
  var STORE = 'wcs.session';
  var LOOK_STORE = 'wcs.look';

  var params = new URLSearchParams(location.search);
  var urlCode = (params.get('code') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

  var ws = null, session = load(STORE), state = null, viewKey = '', pending = null;
  var retry = 0, retryTimer = null, needSync = false, lastCue = '';
  var joinError = '', peek = null;
  var look = load(LOOK_STORE) || { name: '', avatar: null, color: null };
  var form = { code: urlCode };
  var wagerPick = null, renderedAt = 0;

  function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  function drop(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { toastEl.classList.add('hidden'); }, 3400);
  }
  function sendMsg(obj) {
    if (ws && ws.readyState === 1) { ws.send(JSON.stringify(obj)); return true; }
    return false;
  }
  function sendGame(a, v) { if (!sendMsg({ t: 'game', a: a, v: v })) toast('Not connected. Hang on...'); }
  function u() { return WCS.helpers(state, false); }
  function isDealer() { return state && state.dealerId === state.you; }
  function inGame() { return state && state.phase !== 'lobby' && state.phase !== 'final'; }

  // ---------- connection ----------
  function connect() {
    clearTimeout(retryTimer);
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    ws = new WebSocket(proto + location.host);
    ws.onopen = function () {
      retry = 0;
      banner.classList.add('hidden');
      if (pending) { sendMsg(pending); pending = null; }
      else if (session) sendMsg({ t: 'rejoin', code: session.code, playerId: session.playerId, token: session.token });
      else if (form.code && form.code.length === 4) sendMsg({ t: 'peek', code: form.code });
    };
    ws.onmessage = function (ev) {
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      onMessage(m);
    };
    ws.onclose = function () {
      ws = null;
      if (session) banner.classList.remove('hidden');
      var delay = Math.min(5000, 500 * Math.pow(2, retry++));
      retryTimer = setTimeout(connect, session ? delay : delay * 2);
    };
    ws.onerror = function () { /* onclose follows */ };
  }

  function onMessage(m) {
    if (m.t === 'meta') { WCS.meta = m; if (!state) render(true); return; }
    if (m.t === 'joined') {
      var fresh = !session || session.playerId !== m.playerId;
      session = { code: m.code, playerId: m.playerId, token: m.token };
      save(STORE, session);
      look = { name: m.name, real: m.real, avatar: m.avatar, color: m.color };
      save(LOOK_STORE, look);
      if (urlCode !== m.code) { urlCode = m.code; history.replaceState(null, '', '/?code=' + m.code); }
      needSync = !fresh;
      return;
    }
    if (m.t === 'state') {
      state = m;
      if (!state || state.gameKey !== m.gameKey) wagerPick = null;
      WCS.checkNewGame(m);
      WCS.lastState = m;
      WCS.setClock(m);
      render();
      if (needSync) {
        needSync = false;
        var mod = state.phase === 'play' && state.cur && WCS.games[state.cur.gameId];
        if (mod && mod.resync) mod.resync(state, sendGame);
      }
      return;
    }
    if (m.t === 'drawing') {
      WCS.drawings[m.id] = m.strokes;
      var mod2 = state && state.cur && WCS.games[state.cur.gameId];
      if (mod2 && mod2.onDrawing) mod2.onDrawing(m.id, m.strokes, state);
      var list = document.querySelectorAll('canvas[data-drawing="' + m.id + '"]');
      for (var i = 0; i < list.length; i++) WCS.paint(list[i], m.strokes);
      return;
    }
    if (m.t === 'peek') { peek = m; if (!state) render(true); return; }
    if (m.t === 'shuffled') {
      var realEl = document.getElementById('real');
      var keepReal = realEl ? realEl.value : look.real;
      look = { name: m.name, real: keepReal, avatar: m.avatar, color: m.color };
      if (sheetLook) sheetLook.real = keepReal;
      WCS.sfx('pop');
      if (!state) render(true); else openLookSheet(true);
      return;
    }
    if (m.t === 'error') {
      if (m.code === 'nosession') {
        session = null; state = null; drop(STORE);
        banner.classList.add('hidden');
        joinError = m.msg;
        sendMsg({ t: 'peek', code: form.code });
        render(true);
      } else if (!state) { joinError = m.msg; render(true); }
      else { toast(m.msg); WCS.sfx('wrong'); WCS.buzz(120); }
      return;
    }
    if (m.t === 'kicked') {
      session = null; state = null; drop(STORE);
      joinError = 'The dealer removed you from the table.';
      closeSheet();
      render(true);
    }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && (!ws || ws.readyState > 1)) { retry = 0; connect(); }
  });
  window.addEventListener('pageshow', function () { if (!ws || ws.readyState > 1) { retry = 0; connect(); } });

  WCS.onWarn = function () {
    if (state && state.phase === 'play') toast('10 seconds left!');
  };

  // ---------- rendering ----------
  function gameMod() { return state && state.cur && state.cur.gameId ? WCS.games[state.cur.gameId] : null; }

  function keyFor(s) {
    if (!s) return 'join:' + joinError + JSON.stringify(peek) + JSON.stringify(look) + !!WCS.meta;
    var mod = gameMod();
    if (s.phase === 'play' && mod && mod.keep) {
      var k = mod.keep(s);
      if (k) return 'keep:' + k + ':' + s.paused + ':' + s.dealerId;
    }
    if (s.phase === 'wager' && s.wager && s.wager.canWager) return 'wager:' + s.round + ':' + s.paused;
    var copy = {};
    for (var key in s) if (key !== 'msLeft' && key !== 'players') copy[key] = s[key];
    // player list without the "done" ticks (those are patched in place)
    copy.pl = s.players.map(function (p) { return [p.id, p.name, p.real, p.avatar, p.color, p.score, p.connected, p.inRound, p.badges.join()]; });
    return JSON.stringify(copy);
  }

  function render(force) {
    var key = keyFor(state);
    if (force || key !== viewKey) {
      viewKey = key;
      var html;
      if (!state) html = joinScreen();
      else html = ({
        lobby: lobbyScreen, intro: introScreen, play: playScreen, scores: scoresScreen,
        wager: wagerScreen, recap: recapScreen, final: finalScreen,
      }[state.phase] || lobbyScreen)();
      app.innerHTML = '<div class="screen ' + themeClass() + '">' + html + '</div>' + pausedOverlay();
      renderedAt = Date.now();
      afterRender();
    }
    patch();
    WCS.tick();
    if (state) cue();
  }

  function themeClass() {
    var g = state && state.cur && state.cur.gameId;
    return g ? 'theme-' + g : '';
  }

  function patch() {
    var w = document.getElementById('waiting');
    if (w && state) w.innerHTML = WCS.waitingChips(state);
    var mod = gameMod();
    if (state && state.phase === 'play' && mod && mod.patch) mod.patch(state, u());
    var gb = app.querySelector('.goal');
    if (gb && state && state.phase === 'play') { var fresh = WCS.goalBanner(state); if (fresh && gb.outerHTML !== fresh) gb.outerHTML = fresh; }
  }

  // sounds + vibration when something new happens
  function cue() {
    var s = state, g = s.game;
    var k = [s.phase, s.round, s.cur ? s.cur.stage + s.cur.showdown : '', g ? g.phase : '', g && g.card ? g.card.index : '', g && g.index != null ? g.index : '', s.recap ? s.recap.idx : ''].join('|');
    if (k === lastCue) return;
    var first = !lastCue;
    lastCue = k;
    if (first) return;
    if (s.phase === 'intro') {
      if (s.cur.stage === 'shown' && (s.cur.finale || (s.cur.twist === 'mystery') || s.cur.showdown)) { WCS.sfx('flip'); WCS.buzz(50); }
      else if (s.cur.twist) { WCS.sfx('whoosh'); WCS.sfx('flip', 0.7); WCS.buzz([0, 700, 60]); }
      else WCS.sfx('whoosh');
    } else if (s.phase === 'play') {
      var mod = gameMod(), c = mod && mod.cue ? mod.cue(s) : null;
      if (c) { if (c.sound) WCS.sfx(c.sound, c.delay); if (c.buzz) WCS.buzz(c.buzz); }
    } else if (s.phase === 'scores') { WCS.sfx('drum'); WCS.sfx('ding', 1.75); WCS.buzz([0, 1700, 80]); }
    else if (s.phase === 'wager') WCS.sfx('cash');
    else if (s.phase === 'recap') { WCS.sfx('drum'); WCS.sfx('fanfare', 1.75); WCS.buzz([0, 1800, 100, 60, 100]); }
    else if (s.phase === 'final') { WCS.sfx('fanfare'); WCS.buzz([100, 60, 100, 60, 200]); }
  }

  function topbar(left) {
    var right = '<button class="iconbtn" id="muteBtn" aria-label="Sound">' + (WCS.isMuted() ? '🔇' : '🔊') + '</button>';
    if (isDealer() && inGame()) right += '<button class="iconbtn dealerbtn" id="dealerBtn">Dealer ⚙</button>';
    return '<div class="topbar"><span>' + (left || '') + '</span><span class="tb-right">Table <b>' + esc(state.code) + '</b>' + right + '</span></div>';
  }

  function roundLabel() {
    if (state.cur && state.cur.showdown) return 'Showdown Duel';
    if (state.cur && state.cur.finale) return 'Final round';
    return 'Round ' + state.round + ' of ' + state.rounds;
  }

  function pausedOverlay() {
    if (!state || !state.paused) return '';
    return '<div class="paused-overlay"><div class="paused-box"><div class="big">⏸</div><h2>Paused</h2>' +
      (isDealer() ? '<button class="btn" id="resumeBtn">Resume</button>' : '<p class="hint">The dealer paused the game.</p>') + '</div></div>';
  }

  // ---------- identity picker (join screen + "change my look") ----------
  function lookPicker(lk, takenBy) {
    var t = takenBy || { avatars: [], colors: [] };
    var meta = WCS.meta;
    if (!meta) return '<p class="hint">Loading&hellip;</p>';
    var col = colorHex(lk.color);
    var preview = '<div class="look-preview"><span class="av big" style="--c:' + (col || '#555') + '"><i>' + esc(lk.avatar || '?') + '</i></span></div>';
    var avatars = meta.avatars.map(function (a) {
      var taken = t.avatars.indexOf(a) >= 0;
      return '<button type="button" class="pick-av' + (a === lk.avatar ? ' on' : '') + '" data-avatar="' + esc(a) + '"' + (taken ? ' disabled' : '') + '>' + esc(a) + '</button>';
    }).join('');
    var colors = meta.colors.map(function (c) {
      var taken = t.colors.indexOf(c.id) >= 0;
      return '<button type="button" class="pick-col' + (c.id === lk.color ? ' on' : '') + '" data-color="' + c.id + '" style="--c:' + c.hex + '" title="' + esc(c.name) + '"' + (taken ? ' disabled' : '') + '></button>';
    }).join('');
    return preview +
      '<label for="real">Your real name</label>' +
      '<input type="text" id="real" maxlength="' + (meta.maxReal || 14) + '" autocapitalize="words" autocomplete="given-name" enterkeyhint="next" value="' + esc(lk.real || '') + '" placeholder="e.g. Ryan">' +
      '<label for="name">Your character name</label>' +
      '<div class="name-row"><input type="text" id="name" maxlength="' + meta.maxName + '" autocapitalize="words" autocomplete="off" enterkeyhint="done" value="' + esc(lk.name || '') + '" placeholder="e.g. Captain Bluffbeard">' +
      '<button type="button" class="btn small shuffle" id="shuffleBtn">🎲 Shuffle me</button></div>' +
      '<p class="hint small-hint">Everyone sees both, like <b>' + esc(lk.name || 'Sneaky Walrus') + '</b> (' + esc(lk.real || 'Ryan') + ').</p>' +
      '<label>Pick an avatar</label><div class="pick-grid">' + avatars + '</div>' +
      '<label>Pick your card colour</label><div class="pick-grid colors">' + colors + '</div>';
  }

  function colorHex(id) {
    var l = (WCS.meta && WCS.meta.colors) || [];
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i].hex;
    return null;
  }

  function fixLook(lk, t) {
    // drop choices someone else already has
    if (!WCS.meta) return;
    if (t && lk.avatar && t.avatars.indexOf(lk.avatar) >= 0) lk.avatar = null;
    if (t && lk.color && t.colors.indexOf(lk.color) >= 0) lk.color = null;
    var freeA = WCS.meta.avatars.filter(function (a) { return !t || t.avatars.indexOf(a) < 0; });
    var freeC = WCS.meta.colors.filter(function (c) { return !t || t.colors.indexOf(c.id) < 0; });
    if (!lk.avatar && freeA.length) lk.avatar = freeA[Math.floor(Math.random() * freeA.length)];
    if (!lk.color && freeC.length) lk.color = freeC[Math.floor(Math.random() * freeC.length)].id;
  }

  // ---------- screens ----------
  function joinScreen() {
    var t = peek && peek.ok && peek.code === form.code ? peek.taken : null;
    fixLook(look, t);
    var status = '';
    if (peek && peek.code === form.code && form.code.length === 4) {
      if (!peek.ok) status = '<p class="hint warn">No table with that code yet. Check the big screen.</p>';
      else if (peek.full) status = '<p class="hint warn">That table is full.</p>';
      else if (peek.phase !== 'lobby') status = '<p class="hint">A game is on. You\'ll be dealt in at the next round.</p>';
    }
    return '<h1 class="logo">Wild Card <span>Showdown</span></h1>' +
      '<p class="tagline">Three games. One table. Nobody\'s safe.</p>' +
      '<form id="joinForm" autocomplete="off" class="stack">' +
        '<div><label for="code">Table code</label>' +
        '<input type="text" id="code" class="code" maxlength="4" autocapitalize="characters" autocomplete="off" spellcheck="false" value="' + esc(form.code || '') + '" placeholder="ABCD"></div>' +
        status +
        lookPicker(look, t) +
        '<button class="btn" type="submit">Join the table</button>' +
      '</form>' +
      (joinError ? '<p class="hint warn">' + esc(joinError) + '</p>' : '') +
      '<button class="linkbtn" id="createBtn" type="button">No big screen? Start a new table from this phone</button>';
  }

  function playerRows(opts) {
    var me = state.you;
    return '<ul class="players">' + state.players.map(function (p) {
      var mine = p.id === me;
      var btn = '';
      if (mine && opts.edit) btn = '<button class="kick" data-look="1">Change look</button>';
      else if (isDealer() && opts.manage) btn = '<button class="kick" data-manage="' + p.id + '">Edit</button>';
      return '<li class="' + (mine ? 'me' : '') + '">' + WCS.avatar(p) +
        '<span class="pname">' + WCS.pname(p) + (mine ? ' <span class="tag">(you)</span>' : '') +
        (p.id === state.dealerId ? '<span class="crown">DEALER</span>' : '') +
        (!p.connected ? ' <span class="tag">away</span>' : '') + '</span>' + btn + '</li>';
    }).join('') + '</ul>';
  }

  function seg(name, options, value, disabled) {
    return '<div class="seg' + (options.length > 4 ? ' wrap' : '') + '">' + options.map(function (o) {
      return '<button type="button" data-set="' + name + '" data-val="' + esc(JSON.stringify(o.v)) + '" class="' + (JSON.stringify(o.v) === JSON.stringify(value) ? 'on' : '') + '"' + (disabled ? ' disabled' : '') + '>' + o.label + '</button>';
    }).join('') + '</div>';
  }

  function toggle(name, value, label, sub) {
    return '<button type="button" class="toggle' + (value ? ' on' : '') + '" data-toggle="' + name + '"><span class="tgl"></span><span><b>' + label + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</span></button>';
  }

  function dealerSetup() {
    var s = state.settings, m = WCS.meta;
    if (!m) return '';
    var gameCards = m.games.map(function (g) {
      var on = s.mode === 'single' ? s.single === g.id : s.mode === 'mix' ? !!s.mix[g.id] : true;
      var attr = s.mode === 'single' ? 'data-single="' + g.id + '"' : s.mode === 'mix' ? 'data-mix="' + g.id + '"' : 'disabled';
      return '<button type="button" class="gamepick' + (on ? ' on' : '') + ' gp-' + g.id + '" ' + attr + '><span class="gi">' + g.icon + '</span><span><b>' + esc(g.name) + '</b><small>' + esc(g.tagline) + '</small></span><span class="tick">' + (on ? '✓' : '') + '</span></button>';
    }).join('');
    var hasDoodle = s.games.indexOf('doodleDuel') >= 0;
    return '<div class="setup"><h3>Dealer setup</h3>' +
      '<label>What are we playing?</label>' +
      seg('mode', [{ v: 'single', label: 'One game' }, { v: 'rotation', label: 'All three' }, { v: 'mix', label: 'Custom mix' }], s.mode) +
      '<div class="gamepicks">' + gameCards + '</div>' +
      '<label>Rounds</label>' + seg('rounds', m.roundChoices.map(function (n) { return { v: n, label: String(n) }; }), s.rounds) +
      '<label>Wild card twists</label>' + seg('twistFreq', m.twistLevels.map(function (l) { return { v: l.id, label: l.name.replace('Every round', 'Always') }; }), s.twistFreq) +
      (hasDoodle ? '<label>Drawing timer</label>' + seg('drawSecs', m.drawChoices.map(function (n) { return { v: n, label: WCS.fmtSecs(n) }; }), s.drawSecs) +
        toggle('doodleGuess', s.doodleGuess, 'Doodle guessing round', 'Everyone guesses which prompt each drawing was') : '') +
      toggle('showdown', s.showdown, 'Showdown Duel finale', 'Top players go head to head; everyone else votes') +
      '</div>';
  }

  function lobbyScreen() {
    var connected = state.players.filter(function (p) { return p.connected; }).length;
    var need = Math.max(0, state.minPlayers - connected);
    var controls;
    if (isDealer()) {
      controls = dealerSetup() +
        '<button class="btn" id="startBtn"' + (need ? ' disabled' : '') + '>' +
        (need ? 'Waiting for ' + need + ' more player' + (need > 1 ? 's' : '') : 'Deal the cards!') + '</button>';
    } else {
      controls = WCS.settingsSummary(state) +
        '<p class="hint">' + (need ? 'Waiting for ' + need + ' more player' + (need > 1 ? 's' : '') + '&hellip;' : 'Waiting for ' + u().name(state.dealerId) + ' to deal&hellip;') + '</p>';
    }
    return topbar(state.players.length + ' / ' + state.maxPlayers + ' players') +
      '<h2>At the table</h2>' + playerRows({ edit: true, manage: true }) + controls +
      '<button class="linkbtn" id="leaveBtn">Leave table</button>';
  }

  function introScreen() {
    var c = state.cur, uu = u();
    var html = topbar(roundLabel());
    if (c.showdown) {
      html += '<div class="bigtitle">⚔️ Showdown Duel</div>' +
        '<div class="versus">' + c.contestants.map(function (id) { return '<div>' + uu.av(id, 'big') + '<b>' + uu.name(id) + '</b></div>'; }).join('<span class="vs">VS</span>') + '</div>' +
        '<p class="hint center">' + (c.role === 'contestant' ? 'You\'re in the duel! Every audience vote is worth ' + WCS.meta.duelPts + ' points.' : c.role === 'audience' ? 'You\'re the audience. Your votes decide it.' : '') + '</p>' +
        (c.stage === 'hidden' ? WCS.gameCard(null) : WCS.gameCard(c.gameId, 'reveal') + '<p class="hint center">' + esc(WCS.game(c.gameId).duelRule) + '</p>');
      return html;
    }
    if (c.finale) {
      html += '<div class="bigtitle">🏁 The Finale</div><p class="hint center">Points &times;' + WCS.meta.finaleMult + ' and every wager is on the line.</p>';
    } else {
      html += '<div class="bigtitle">Round ' + state.round + '</div>';
    }
    if (c.twist) {
      html += WCS.flipCard(WCS.cardBack(), WCS.twistCard(c.twist, true), 'twist', c.stage === 'shown' && c.twist === 'mystery');
      if (c.twist === 'underdog' && c.underdogs && c.underdogs.length) {
        html += '<p class="hint center">Scoring double: ' + c.underdogs.map(function (id) { return uu.who(id); }).join(' ') + '</p>';
      }
    }
    html += c.stage === 'hidden' ? WCS.gameCard(null) : WCS.gameCard(c.gameId, c.finale || c.twist === 'mystery' ? 'reveal' : '');
    if (!state.inRound) html += '<p class="hint">You\'ll be dealt in next round.</p>';
    return html;
  }

  function playScreen() {
    var mod = gameMod(), g = state.game, uu = u();
    var head = topbar(roundLabel());
    var tw = state.cur.twist ? WCS.meta.twists[state.cur.twist] : null;
    var gm = WCS.game(state.cur.gameId);
    head += '<div class="gamestrip"><span>' + gm.icon + ' ' + esc(gm.name) + '</span>' +
      (tw ? '<span class="twistchip">' + tw.icon + ' ' + esc(tw.name) + '</span>' : '') +
      (state.cur.finale ? '<span class="twistchip">&times;' + WCS.meta.finaleMult + ' Finale</span>' : '') + '</div>';
    if (!mod || !g) return head + '<p class="hint">Loading&hellip;</p>';
    return head + WCS.goalBanner(state) + mod.phone(state, uu);
  }

  function scoresScreen() {
    var b = state.board, uu = u();
    var title = b.showdown ? '⚔️ Showdown results' : b.finale ? '🏁 Final round results' : 'Round ' + b.round + ' results';
    var drum = (state.totalMs || 0) - (state.msLeft || 0) < 1500;
    return topbar('Leaderboard') + '<h2>' + title + '</h2>' +
      (drum ? '<div class="drumroll" id="drumroll">🥁 Drumroll&hellip;</div>' : '') +
      WCS.boardHtml(b, uu, { animate: drum }) + '<div class="after-drum' + (drum ? ' wait' : '') + '">' + WCS.eventsHtml(b, uu) + '</div>' +
      (isDealer() ? '<button class="btn" id="nextBtn">' + nextLabel() + '</button>' : '<p class="hint">' + nextLabel() + ' soon&hellip;</p>') + uu.timer();
  }

  function nextLabel() {
    var b = state.board;
    if (b && b.showdown) return 'On to the awards';
    if (state.round >= state.rounds) return state.settings.showdown ? 'On to the Showdown' : 'On to the awards';
    if (state.round === state.rounds - 1) return 'Final Wager';
    return 'Next round';
  }

  // ----- final wager -----
  function wagerScreen() {
    var w = state.wager, uu = u();
    var html = topbar('Final Wager') + '<div class="bigtitle">💰 Final Wager</div>' +
      '<p class="hint center">The last round is worth <b>&times;' + w.mult + '</b> points. Bet some of your points in secret: finish in the <b>top half</b> of the final round to win your bet, otherwise you lose it.</p>';
    if (w.canWager) {
      if (wagerPick == null || wagerPick > w.max) wagerPick = Math.round(w.max / 4 / 10) * 10;
      var chips = [0, 0.25, 0.5, 0.75, 1].map(function (f) {
        var n = f === 1 ? w.max : Math.round(w.max * f / 10) * 10;
        return '<button type="button" class="chipbtn" data-wager="' + n + '">' + (f === 1 ? 'ALL IN' : f === 0 ? 'Nothing' : Math.round(f * 100) + '%') + '</button>';
      }).join('');
      html += '<div class="wagerbox"><div class="have">You have <b>' + w.max + '</b> points</div>' +
        '<div class="bet" id="betNum">' + wagerPick + '</div>' +
        '<input type="range" id="betRange" min="0" max="' + w.max + '" step="' + (w.max >= 100 ? 10 : 1) + '" value="' + wagerPick + '"' + (w.max ? '' : ' disabled') + '>' +
        '<div class="chiprow">' + chips + '</div></div>' +
        '<button class="btn" id="betBtn">Lock in my bet</button>';
    } else if (w.mine != null) {
      html += '<div class="wagerbox"><div class="have">You bet</div><div class="bet">' + w.mine + '</div><span class="stamp">LOCKED IN</span></div><p class="hint">Waiting for everyone else&hellip;</p>';
    } else {
      html += '<p class="hint">You\'re watching this one.</p>';
    }
    return html + uu.timer() + uu.waiting();
  }

  function recapScreen() {
    var r = state.recap, uu = u();
    return topbar('Awards ' + (r.idx + 1) + ' of ' + r.total) + '<div class="bigtitle">🏆 The Awards</div>' + WCS.awardHtml(r.award, uu) +
      (isDealer() ? '<button class="btn" id="nextBtn">' + (r.idx + 1 < r.total ? 'Next award' : 'Final standings') + '</button>' : '');
  }

  function finalScreen() {
    var uu = u();
    var winners = (state.winners || []).map(uu.player).filter(Boolean);
    var iWon = (state.winners || []).indexOf(state.you) >= 0;
    var sorted = state.players.slice().sort(function (a, b) { return b.score - a.score; });
    var awards = (state.awards || []).filter(function (a) { return a.id !== 'champion'; }).map(function (a) {
      return '<li>' + a.icon + ' <b>' + esc(a.name) + '</b> ' + a.winners.map(function (id) { return uu.who(id); }).join(' ') + '</li>';
    }).join('');
    return topbar('Game over') +
      '<div class="winner"><div class="wname">👑 ' + winners.map(function (p) { return WCS.pname(p); }).join(' &amp; ') + '</div><div>' + (winners.length > 1 ? 'share the crown!' : 'wins Wild Card Showdown!') + (iWon ? ' Well played.' : '') + '</div></div>' +
      WCS.podium(uu) +
      '<ul class="players">' + sorted.map(function (p, i) {
        return '<li class="' + (p.id === state.you ? 'me' : '') + '"><span class="rank">' + (i + 1) + '</span>' + WCS.avatar(p) + '<span class="pname">' + WCS.pname(p) + '</span><span class="score">' + p.score + '</span></li>';
      }).join('') + '</ul>' +
      (awards ? '<h3>Awards</h3><ul class="events">' + awards + '</ul>' : '') +
      (isDealer() ? '<button class="btn" id="againBtn">Play again</button>' : '<p class="hint">Waiting for ' + uu.name(state.dealerId) + ' to start another game&hellip;</p>');
  }

  // ---------- sheets (dealer menu, change look, rename) ----------
  function openSheet(html) {
    sheetEl.innerHTML = '<div class="sheet-back" data-close="1"></div><div class="sheet-body">' + html + '<button class="linkbtn" data-close="1">Close</button></div>';
    sheetEl.classList.remove('hidden');
  }
  function closeSheet() { sheetEl.classList.add('hidden'); sheetEl.innerHTML = ''; }

  var sheetLook = null;
  function openLookSheet(keep) {
    var me = u().me();
    if (!me) return;
    if (!keep || !sheetLook) sheetLook = { name: me.name, real: me.real, avatar: me.avatar, color: me.colorId };
    else if (keep) { sheetLook = { name: look.name, real: look.real || me.real, avatar: look.avatar, color: look.color }; }
    var t = { avatars: [], colors: [] };
    state.players.forEach(function (p) { if (p.id !== state.you) { t.avatars.push(p.avatar); t.colors.push(p.colorId); } });
    openSheet('<h3>Your look</h3><div id="lookArea">' + lookPicker(sheetLook, t) + '</div><button class="btn" id="saveLook">Save</button>');
    sheetEl.dataset.kind = 'look';
  }

  function openManage(id) {
    var p = u().player(id);
    if (!p) return;
    openSheet('<h3>' + WCS.avatar(p) + ' ' + esc(p.name) + '</h3><label>Rename</label>' +
      '<input type="text" id="renameInput" maxlength="' + WCS.meta.maxName + '" value="' + esc(p.name) + '">' +
      '<button class="btn" data-rename="' + id + '">Save name</button>' +
      (id !== state.you ? '<button class="btn danger" data-kick="' + id + '">Remove from the table</button>' : ''));
    sheetEl.dataset.kind = 'manage';
  }

  function openDealerMenu() {
    var paused = state.paused;
    openSheet('<h3>Dealer controls</h3>' +
      '<button class="btn" data-dealer="' + (paused ? 'resume' : 'pause') + '">' + (paused ? '▶ Resume' : '⏸ Pause') + '</button>' +
      '<button class="btn secondary" data-dealer="skip">⏭ Skip ahead</button>' +
      (state.phase === 'intro' || state.phase === 'play' ? '<button class="btn secondary" data-dealer="skipRound">⏩ Skip the rest of this round</button>' : '') +
      '<label>Players</label>' + playerRows({ manage: true }) +
      '<button class="btn danger" data-dealer="endGame">End the game now</button>');
    sheetEl.dataset.kind = 'dealer';
  }

  sheetEl.addEventListener('click', function (e) {
    var t = e.target.closest('[data-close],button');
    if (!t) return;
    if (t.dataset.close) return closeSheet();
    if (t.dataset.avatar || t.dataset.color) {
      if (t.disabled) return;
      var nameEl = document.getElementById('name');
      if (nameEl) sheetLook.name = nameEl.value;
      var rEl = document.getElementById('real');
      if (rEl) sheetLook.real = rEl.value;
      if (t.dataset.avatar) sheetLook.avatar = t.dataset.avatar;
      if (t.dataset.color) sheetLook.color = t.dataset.color;
      WCS.sfx('tap');
      var area = document.getElementById('lookArea');
      var tk = { avatars: [], colors: [] };
      state.players.forEach(function (p) { if (p.id !== state.you) { tk.avatars.push(p.avatar); tk.colors.push(p.colorId); } });
      area.innerHTML = lookPicker(sheetLook, tk);
      return;
    }
    if (t.id === 'shuffleBtn') { sendMsg({ t: 'shuffle' }); return; }
    if (t.id === 'saveLook') {
      var n = document.getElementById('name');
      var rr = document.getElementById('real');
      sendMsg({ t: 'look', name: n ? n.value : sheetLook.name, real: rr ? rr.value : sheetLook.real, avatar: sheetLook.avatar, color: sheetLook.color });
      closeSheet();
      return;
    }
    if (t.dataset.rename) {
      var v = document.getElementById('renameInput').value.trim();
      if (v) sendMsg({ t: 'rename', id: t.dataset.rename, name: v });
      closeSheet();
      return;
    }
    if (t.dataset.kick) { sendMsg({ t: 'kick', id: t.dataset.kick }); closeSheet(); return; }
    if (t.dataset.manage) { openManage(t.dataset.manage); return; }
    if (t.dataset.dealer) {
      var a = t.dataset.dealer;
      if (a === 'endGame' && !t.dataset.sure) { t.dataset.sure = '1'; t.textContent = 'Tap again to end the game'; return; }
      sendMsg({ t: a, step: state.step });
      closeSheet();
    }
  });

  // ---------- events ----------
  function afterRender() {
    var root = app;
    var f = document.getElementById('joinForm');
    if (f) {
      var codeEl = document.getElementById('code');
      var nameEl = document.getElementById('name');
      if (nameEl) nameEl.addEventListener('input', function () { look.name = nameEl.value; });
      var realEl = document.getElementById('real');
      if (realEl) realEl.addEventListener('input', function () { look.real = realEl.value; });
      codeEl.addEventListener('input', function () {
        codeEl.value = codeEl.value.toUpperCase().replace(/[^A-Z]/g, '');
        form.code = codeEl.value;
        if (form.code.length === 4) sendMsg({ t: 'peek', code: form.code });
      });
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        look.name = (nameEl ? nameEl.value : look.name || '').trim();
        look.real = (realEl ? realEl.value : look.real || '').trim();
        form.code = codeEl.value.trim().toUpperCase();
        if (!look.real) { joinError = 'Type your real name first.'; return render(true); }
        if (!look.name) { joinError = 'Pick a character name (or tap Shuffle me).'; return render(true); }
        if (form.code.length !== 4) { joinError = 'The table code is 4 letters (it\'s on the big screen).'; return render(true); }
        joinError = '';
        save(LOOK_STORE, look);
        go({ t: 'join', name: look.name, real: look.real, code: form.code, avatar: look.avatar, color: look.color });
      });
      document.getElementById('createBtn').addEventListener('click', function () {
        look.name = (nameEl ? nameEl.value : '').trim();
        look.real = (realEl ? realEl.value : '').trim();
        if (!look.real || !look.name) { joinError = 'Type your real name and a character name first, then start a table.'; return render(true); }
        joinError = '';
        go({ t: 'create', name: look.name, real: look.real, avatar: look.avatar, color: look.color });
      });
    }

    var range = document.getElementById('betRange');
    if (range) {
      range.addEventListener('input', function () { wagerPick = +range.value; document.getElementById('betNum').textContent = wagerPick; });
    }

    if (state && state.phase === 'play') {
      var mod = gameMod();
      if (mod && mod.after) mod.after(state, u(), root, sendGame);
    }
    if (state && state.phase === 'intro') WCS.runFlips(root, 700);
    if (state && state.phase === 'recap') WCS.runFlips(root, 1900);
    if (state && state.phase === 'scores') {
      WCS.animateBoard(root, 1700);
      setTimeout(function () {
        var d = document.getElementById('drumroll'); if (d) d.classList.add('hidden');
        var a = root.querySelector('.after-drum.wait'); if (a) a.classList.remove('wait');
      }, 1700);
    }
    WCS.paintAll(root);
  }

  function go(msg) {
    pending = msg;
    if (ws && ws.readyState === 1) { sendMsg(msg); pending = null; }
    else connect();
  }

  app.addEventListener('click', function (e) {
    var t = e.target.closest('button');
    if (!t || t.disabled) return;
    if (!state) {
      var ne = document.getElementById('name'), re = document.getElementById('real');
      if (ne) look.name = ne.value;
      if (re) look.real = re.value;
      if (t.dataset.avatar) { look.avatar = t.dataset.avatar; WCS.sfx('tap'); return render(true); }
      if (t.dataset.color) { look.color = t.dataset.color; WCS.sfx('tap'); return render(true); }
      if (t.id === 'shuffleBtn') { sendMsg({ t: 'shuffle', code: form.code }); return; }
      return;
    }
    if (t.id === 'muteBtn') { WCS.setMuted(!WCS.isMuted()); t.textContent = WCS.isMuted() ? '🔇' : '🔊'; if (!WCS.isMuted()) WCS.sfx('pop'); return; }
    if (t.id === 'dealerBtn') return openDealerMenu();
    if (t.id === 'resumeBtn') return sendMsg({ t: 'resume' });
    if (t.dataset.look) return openLookSheet(false);
    if (t.dataset.manage) return openManage(t.dataset.manage);
    if (t.dataset.set) {
      var patch = {}; patch[t.dataset.set] = JSON.parse(t.dataset.val);
      return sendMsg({ t: 'settings', patch: patch });
    }
    if (t.dataset.toggle) {
      var p2 = {}; p2[t.dataset.toggle] = !state.settings[t.dataset.toggle];
      return sendMsg({ t: 'settings', patch: p2 });
    }
    if (t.dataset.single) return sendMsg({ t: 'settings', patch: { single: t.dataset.single } });
    if (t.dataset.mix) {
      var mix = {}; mix[t.dataset.mix] = !state.settings.mix[t.dataset.mix];
      return sendMsg({ t: 'settings', patch: { mix: mix } });
    }
    if (t.dataset.wager != null) {
      wagerPick = +t.dataset.wager;
      var r = document.getElementById('betRange'); if (r) r.value = wagerPick;
      document.getElementById('betNum').textContent = wagerPick;
      WCS.sfx('tap');
      return;
    }
    if (t.id === 'betBtn') { WCS.sfx('cash'); return sendMsg({ t: 'wager', amount: wagerPick || 0 }); }
    if (t.dataset.a) {
      var v = t.dataset.v;
      if (t.dataset.num) v = parseInt(v, 10);
      if (t.dataset.bool) v = v === '1';
      t.classList.add('picked');
      WCS.sfx('pop'); WCS.buzz(20);
      return sendGame(t.dataset.a, v);
    }
    if (t.id === 'startBtn') return sendMsg({ t: 'start' });
    if (t.id === 'nextBtn') { t.disabled = true; return sendMsg({ t: 'next', step: state.step }); }
    if (t.id === 'againBtn') return sendMsg({ t: 'playAgain' });
    if (t.id === 'leaveBtn') {
      sendMsg({ t: 'leave' });
      session = null; state = null; drop(STORE);
      joinError = '';
      sendMsg({ t: 'peek', code: form.code });
      return render(true);
    }
  });

  // expose a few things the game modules use
  WCS.toast = toast;
  WCS.send = sendMsg;

  // ---------- start ----------
  if (session && urlCode && session.code !== urlCode) { session = null; drop(STORE); }
  if (session) { app.innerHTML = '<div class="screen"><h1 class="logo">Wild Card <span>Showdown</span></h1><p class="hint">Getting your seat back&hellip;</p></div>'; }
  else render(true);
  connect();
})();
