/* Wild Card Showdown - the big screen (laptop / TV): QR code, table code, and a big view of every phase */
(function () {
  'use strict';
  var WCS = window.WCS, esc = WCS.esc;

  var main = document.getElementById('main');
  var wrap = document.getElementById('wrap');
  var banner = document.getElementById('banner');
  var pausedEl = document.getElementById('pausedHost');
  var soundBtn = document.getElementById('soundBtn');
  var info = null, state = null, ws = null, retry = 0, viewKey = '', lastCue = '';
  var IP_STORE = 'wcs.hostip';
  var ROOM_STORE = 'wcs.hostroom'; // online mode: keep this screen's table across refreshes

  function getIp() { try { return localStorage.getItem(IP_STORE); } catch (e) { return null; } }
  function setIp(ip) { try { localStorage.setItem(IP_STORE, ip); } catch (e) { /* ignore */ } }
  function getRoom() { try { return sessionStorage.getItem(ROOM_STORE) || ''; } catch (e) { return ''; } }
  function setRoom(c) { try { sessionStorage.setItem(ROOM_STORE, c); } catch (e) { /* ignore */ } }

  // browsers only allow sound after a click on the page
  soundBtn.addEventListener('click', function () {
    setTimeout(function () { WCS.sfx('ding'); soundBtn.classList.add('hidden'); }, 50);
  });

  // ---------- join panel ----------
  function loadInfo() {
    return fetch('/info?room=' + encodeURIComponent(getRoom()), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      info = d;
      if (d.online) return showOnline(d);
      var sel = document.getElementById('adapter');
      var saved = getIp();
      var ips = d.addresses.map(function (a) { return a.ip; });
      var ip = ips.indexOf(saved) >= 0 ? saved : ips[0];
      sel.innerHTML = d.addresses.map(function (a) {
        return '<option value="' + esc(a.ip) + '"' + (a.ip === ip ? ' selected' : '') + '>' + esc(a.ip) + '  (' + esc(a.name) + ')</option>';
      }).join('');
      document.getElementById('adapterBox').classList.toggle('hidden', d.addresses.length < 2);
      document.getElementById('noNet').classList.toggle('hidden', d.addresses.length > 0);
      sel.onchange = function () { setIp(sel.value); showJoin(sel.value); };
      document.getElementById('code').textContent = d.code;
      showJoin(ip || 'localhost');
    });
  }

  // online mode: one public address, no network picker or Wi-Fi tips
  function showOnline(d) {
    if (d.error) { document.getElementById('url').textContent = 'Too many tables open right now - refresh in a minute.'; return; }
    setRoom(d.code);
    document.getElementById('code').textContent = d.code;
    document.getElementById('adapterBox').classList.add('hidden');
    document.getElementById('noNet').classList.add('hidden');
    document.getElementById('tips').classList.add('hidden');
    banner.textContent = 'Lost connection to the game server. Reconnecting...';
    var base = d.publicUrl || (location.protocol + '//' + location.host);
    document.getElementById('url').textContent = base.replace(/^https?:\/\//, '');
    document.getElementById('qr').src = '/qr?code=' + d.code + '&t=' + Date.now();
  }

  function showJoin(ip) {
    var portPart = info.port === 80 ? '' : ':' + info.port;
    document.getElementById('url').textContent = ip + portPart;
    document.getElementById('qr').src = '/qr?ip=' + encodeURIComponent(ip) + '&code=' + info.code + '&t=' + Date.now();
  }

  // ---------- live state ----------
  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    ws.onopen = function () {
      retry = 0;
      banner.classList.add('hidden');
      // the server may have restarted with a new table code
      loadInfo().then(function () { ws.send(JSON.stringify({ t: 'host', code: info.code })); });
    };
    ws.onmessage = function (ev) {
      var m = JSON.parse(ev.data);
      if (m.t === 'meta') WCS.meta = m;
      else if (m.t === 'state') {
        state = m;
        WCS.checkNewGame(m);
        WCS.lastHostState = m;
        WCS.setClock(m);
        render();
      } else if (m.t === 'drawing') {
        WCS.drawings[m.id] = m.strokes;
        var list = document.querySelectorAll('canvas[data-drawing="' + m.id + '"]');
        for (var i = 0; i < list.length; i++) WCS.paint(list[i], m.strokes);
      } else if (m.t === 'error' && m.code === 'noroom') {
        loadInfo().then(function () { ws.send(JSON.stringify({ t: 'host', code: info.code })); });
      }
    };
    ws.onclose = function () {
      banner.classList.remove('hidden');
      setTimeout(connect, Math.min(5000, 500 * Math.pow(2, retry++)));
    };
  }

  function u() { return WCS.helpers(state, true); }

  function roundLabel(s) {
    if (s.cur && s.cur.showdown) return 'Showdown Duel';
    if (s.cur && s.cur.finale) return 'The Finale';
    return 'Round ' + s.round + ' of ' + s.rounds;
  }

  function keyFor(s) {
    var copy = {};
    for (var k in s) if (k !== 'msLeft' && k !== 'players') copy[k] = s[k];
    copy.pl = s.players.map(function (p) { return [p.id, p.name, p.real, p.avatar, p.color, p.score, p.connected, p.badges.join()]; });
    return JSON.stringify(copy);
  }

  function lobby(s, uu) {
    var n = s.players.filter(function (p) { return p.connected; }).length;
    var need = Math.max(0, s.minPlayers - n);
    var list = s.players.length ? '<ul class="players host-grid">' + s.players.map(function (p) {
      return '<li>' + WCS.avatar(p) + '<span class="pname">' + WCS.pname(p) + (p.id === s.dealerId ? '<span class="crown">DEALER</span>' : '') + '</span>' +
        (p.connected ? '' : '<span class="offline">away</span>') + '</li>';
    }).join('') + '</ul>' : '<p class="host-status">Nobody here yet. Scan the code with your phone camera.</p>';
    var games = (WCS.meta ? WCS.meta.games : []).map(function (g) {
      var on = s.settings.games.indexOf(g.id) >= 0;
      return '<div class="gamecard gp-' + g.id + (on ? '' : ' off') + '"><div class="gi">' + g.icon + '</div><b>' + esc(g.name) + '</b><small>' + esc(g.tagline) + '</small></div>';
    }).join('');
    void games;
    return '<div id="howtoBox">' + WCS.howtoHtml(s) + '</div>' +
      '<h2>At the table (' + s.players.length + '/' + s.maxPlayers + ')</h2>' + list + WCS.settingsSummary(s) +
      '<p class="host-status">' + (need ? 'Need ' + need + ' more player' + (need > 1 ? 's' : '') + ' to start.' :
        (s.dealerId ? uu.name(s.dealerId) + ' is the dealer and starts the game from their phone.' : '')) + '</p>';
  }

  function intro(s, uu) {
    var c = s.cur;
    var html = '<div class="host-status">' + roundLabel(s) + '</div>';
    if (c.showdown) {
      return html + '<div class="bigtitle">⚔️ Showdown Duel</div><div class="versus">' + c.contestants.map(function (id) { return '<div>' + uu.av(id, 'big') + '<b>' + uu.name(id) + '</b></div>'; }).join('<span class="vs">VS</span>') + '</div>' +
        (c.stage === 'hidden' ? WCS.gameCard(null) : WCS.gameCard(c.gameId, 'reveal') + WCS.rulesCardHtml(s) + '<p class="host-status center">Everyone else is the audience.</p>');
    }
    html += c.finale ? '<div class="bigtitle">🏁 The Finale</div><p class="host-status center">Points &times;' + WCS.meta.finaleMult + ' and every wager is on the line.</p>' : '<div class="bigtitle">Round ' + s.round + '</div>';
    html += '<div class="host-intro">';
    if (c.twist) {
      html += WCS.flipCard(WCS.cardBack(), WCS.twistCard(c.twist, true), 'twist', c.stage === 'shown' && c.twist === 'mystery');
    }
    html += (c.stage === 'hidden' ? WCS.gameCard(null) : WCS.gameCard(c.gameId, c.finale || c.twist === 'mystery' ? 'reveal' : '')) + '</div>';
    if (c.stage !== 'hidden') html += WCS.rulesCardHtml(s);
    if (c.twist === 'underdog' && c.underdogs && c.underdogs.length) html += '<p class="host-status center">Scoring double: ' + c.underdogs.map(function (id) { return uu.who(id, ''); }).join(' ') + '</p>';
    return html;
  }

  function play(s, uu) {
    var mod = WCS.games[s.cur.gameId], gm = WCS.game(s.cur.gameId);
    var tw = s.cur.twist ? WCS.meta.twists[s.cur.twist] : null;
    var head = '<div class="gamestrip big"><span>' + gm.icon + ' ' + esc(gm.name) + ' &middot; ' + roundLabel(s) + '</span>' +
      (tw ? '<span class="twistchip">' + tw.icon + ' ' + esc(tw.name) + '</span>' : '') +
      (s.cur.finale ? '<span class="twistchip">&times;' + WCS.meta.finaleMult + ' Finale</span>' : '') + '</div>';
    var rk = s.round + (s.cur.showdown ? 's' : '');
    if (rulesShownFor !== rk) { rulesShownFor = rk; rulesUntil = Date.now() + 9000; }
    var pop = Date.now() < rulesUntil ? '<div class="rules-pop" id="rulesPop">' + WCS.rulesCardHtml(s) + '</div>' : '';
    return head + pop + WCS.goalBanner(s, true).replace('🎯 Your goal', '🎯 Goal') + (mod && s.game ? mod.host(s, uu) : '');
  }
  var rulesShownFor = '', rulesUntil = 0;
  setInterval(function () { var p = document.getElementById('rulesPop'); if (p && Date.now() > rulesUntil) p.classList.add('gone'); }, 500);

  function scores(s, uu) {
    var b = s.board;
    var title = b.showdown ? '⚔️ Showdown results' : b.finale ? '🏁 Final round results' : 'Round ' + b.round + ' results';
    var drum = (s.totalMs || 0) - (s.msLeft || 0) < 1500;
    return '<h2>' + title + '</h2>' + (drum ? '<div class="drumroll" id="drumroll">🥁 Drumroll&hellip;</div>' : '') +
      WCS.boardHtml(b, uu, { animate: drum }) + '<div class="after-drum' + (drum ? ' wait' : '') + '">' + WCS.eventsHtml(b, uu) + '</div>' + uu.timer();
  }

  function wager(s, uu) {
    return '<div class="bigtitle">💰 Final Wager</div><p class="host-status center">The last round is worth &times;' + s.wager.mult +
      ' points. Everyone is secretly betting some of their points.<br>Finish in the top half of the final round to win your bet, or lose it.</p>' + uu.timer() + uu.waiting();
  }

  function recap(s, uu) {
    return '<div class="host-status">Award ' + (s.recap.idx + 1) + ' of ' + s.recap.total + '</div><div class="bigtitle">🏆 The Awards</div>' + WCS.awardHtml(s.recap.award, uu, true);
  }

  function final(s, uu) {
    var w = (s.winners || []).map(uu.player).filter(Boolean);
    var awards = (s.awards || []).filter(function (a) { return a.id !== 'champion'; }).map(function (a) {
      return '<li>' + a.icon + ' <b>' + esc(a.name) + '</b> ' + a.winners.map(function (id) { return uu.who(id); }).join(' ') + '</li>';
    }).join('');
    var sorted = s.players.slice().sort(function (a, b) { return b.score - a.score; });
    return '<div class="winner"><div class="wname">👑 ' + w.map(function (p) { return WCS.pname(p); }).join(' &amp; ') + (w.length > 1 ? ' share the crown!' : ' wins!') + '</div></div>' +
      WCS.podium(uu) + '<div class="host-split"><ul class="players">' + sorted.map(function (p, i) {
        return '<li><span class="rank">' + (i + 1) + '</span>' + WCS.avatar(p) + '<span class="pname">' + WCS.pname(p) + '</span><span class="score">' + p.score + '</span></li>';
      }).join('') + '</ul>' + (awards ? '<ul class="events">' + awards + '</ul>' : '') + '</div>' +
      '<p class="host-status">The dealer can tap "Play again" on their phone.</p>';
  }

  function render() {
    var s = state;
    var key = keyFor(s);
    if (key !== viewKey) {
      viewKey = key;
      var uu = u();
      var html = ({ lobby: lobby, intro: intro, play: play, scores: scores, wager: wager, recap: recap, final: final }[s.phase] || lobby)(s, uu);
      main.className = 'host-main ' + (s.cur && s.cur.gameId ? 'theme-' + s.cur.gameId : '');
      main.innerHTML = html;
      wrap.classList.toggle('compact', s.phase !== 'lobby');
      document.getElementById('tips').classList.toggle('hidden', s.phase !== 'lobby' || !!(info && info.online));
      var tv = document.getElementById('tvTipBox');
      tv.classList.toggle('hidden', s.phase !== 'lobby');
      if (s.phase === 'lobby' && !tv.innerHTML) tv.innerHTML = WCS.tvTipHtml(info && info.online);
      if (s.phase === 'intro') WCS.runFlips(main, 700);
      if (s.phase === 'recap') WCS.runFlips(main, 1900);
      if (s.phase === 'scores') {
        WCS.animateBoard(main, 1700);
        setTimeout(function () {
          var d = document.getElementById('drumroll'); if (d) d.classList.add('hidden');
          var a = main.querySelector('.after-drum.wait'); if (a) a.classList.remove('wait');
        }, 1700);
      }
      WCS.paintAll(main);
    } else {
      var w = document.getElementById('waiting');
      if (w) w.innerHTML = WCS.waitingChips(s);
    }
    pausedEl.classList.toggle('hidden', !s.paused);
    WCS.tick();
    cue(s);
  }

  function cue(s) {
    var g = s.game;
    var k = [s.phase, s.round, s.cur ? s.cur.stage + s.cur.showdown : '', g ? g.phase : '', g && g.card ? g.card.index : '', g && g.index != null ? g.index : '', s.recap ? s.recap.idx : ''].join('|');
    if (k === lastCue) return;
    var first = !lastCue;
    lastCue = k;
    if (first) return;
    if (s.phase === 'intro') {
      if (s.cur.stage === 'shown' && (s.cur.finale || s.cur.twist === 'mystery' || s.cur.showdown)) WCS.sfx('flip');
      else if (s.cur.twist) { WCS.sfx('whoosh'); WCS.sfx('flip', 0.7); }
      else WCS.sfx('whoosh');
    } else if (s.phase === 'play') {
      var mod = WCS.games[s.cur.gameId], c = mod && mod.cue ? mod.cue(s) : null;
      if (c && c.sound) WCS.sfx(c.sound, c.delay);
    } else if (s.phase === 'scores') { WCS.sfx('drum'); WCS.sfx('ding', 1.75); }
    else if (s.phase === 'wager') WCS.sfx('cash');
    else if (s.phase === 'recap') { WCS.sfx('drum'); WCS.sfx('fanfare', 1.75); }
    else if (s.phase === 'final') WCS.sfx('fanfare');
  }

  WCS.noBuzz = true;
  loadInfo().catch(function () { /* connect() retries */ });
  connect();
})();
