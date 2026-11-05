/* Wild Card Showdown - hub visuals shared by the phones and the host screen
   (twist cards, game cards, the leaderboard, awards, podium). */
(function () {
  'use strict';
  var WCS = window.WCS, esc = WCS.esc;

  WCS.twistCard = function (t, big) {
    var d = WCS.meta && WCS.meta.twists[t];
    if (!d) return '';
    return '<div class="twist-face' + (big ? ' big' : '') + '"><span class="corner">Wild card</span><div class="ticon">' + d.icon + '</div><div class="tname">' + esc(d.name) + '</div><div class="tdesc">' + esc(d.desc) + '</div></div>';
  }
  WCS.cardBack = function () { return '<div class="card-back"><span>WILD<br>CARD</span></div>'; };

  WCS.gameCard = function (id, cls) {
    if (!id) return '<div class="gamecard mystery ' + (cls || '') + '"><div class="gi spin">❓</div><b>Mystery game</b><small>Revealed at the last second&hellip;</small></div>';
    var g = WCS.game(id);
    return '<div class="gamecard gp-' + id + ' ' + (cls || '') + '"><div class="gi">' + g.icon + '</div><b>' + esc(g.name) + '</b><small>' + esc(g.tagline) + '</small></div>';
  }

  WCS.settingsSummary = function (state) {
    var s = state.settings, m = WCS.meta;
    var games = s.games.map(function (id) { var g = WCS.game(id); return g ? g.icon + ' ' + esc(g.name) : id; }).join(', ');
    var twist = m ? m.twistLevels[s.twistFreq].name : '';
    var mode = s.mode === 'single' ? 'Just one game' : s.mode === 'rotation' ? 'All three in rotation' : 'Custom mix';
    return '<div class="summary"><div><b>' + mode + ':</b> ' + games + '</div>' +
      '<div><b>' + s.rounds + ' rounds</b> &middot; Wild cards: ' + esc(twist) + '</div>' +
      (s.games.indexOf('doodleDuel') >= 0 ? '<div>Drawing timer: ' + fmtSecs(s.drawSecs) + (s.doodleGuess ? ' &middot; with guessing round' : '') + '</div>' : '') +
      '<div>Finale: Final Wager' + (s.showdown ? ' + Showdown Duel' : '') + '</div></div>';
  };
  function fmtSecs(n) { return Math.floor(n / 60) + ':' + ('0' + n % 60).slice(-2); }
  WCS.fmtSecs = fmtSecs;

  // ----- leaderboard -----
  WCS.eventsHtml = function (b, uu) {
    var ev = (b.events || []).map(function (e) {
      if (e.type === 'steal') return '<li>🦝 <b>' + uu.name(e.to) + '</b> stole <b>' + e.amount + '</b> points from ' + uu.name(e.from) + '!</li>';
      if (e.type === 'stealFail') return '<li>🦝 ' + (e.reason === 'leader' ? uu.name(e.id) + ' topped the round but is already the leader. Nothing to steal!' : 'A tie at the top: the Steal fizzled.') + '</li>';
      if (e.type === 'wager') return '<li>' + (e.won ? '💰 <b>' + uu.name(e.id) + '</b> won their bet: <b>+' + e.amount + '</b>' : '💸 ' + uu.name(e.id) + ' lost their bet: <b>-' + e.amount + '</b>') + '</li>';
      return '';
    });
    var badges = (b.badgeChanges || []).map(function (c) {
      var d = WCS.badge(c.badge);
      return d ? '<li class="unlock">🔓 <b>' + uu.name(c.to) + '</b> unlocked <span class="bdg big">' + d.icon + ' ' + esc(d.name) + '</span>' + (c.from ? ' <small>(from ' + uu.name(c.from) + ')</small>' : '') + '</li>' : '';
    });
    var all = ev.concat(badges).join('');
    return all ? '<ul class="events">' + all + '</ul>' : '';
  };

  WCS.boardHtml = function (b, uu, opts) {
    var rows = b.rows.slice();
    var prevOrder = rows.slice().sort(function (x, y) { return (y.score - y.delta) - (x.score - x.delta) || rows.indexOf(x) - rows.indexOf(y); });
    return '<ul class="players board' + (opts && opts.animate ? ' anim' : '') + '">' + rows.map(function (r, i) {
      var p = uu.player(r.id);
      if (!p) return '';
      var from = prevOrder.indexOf(r) - i;
      var move = r.prevRank == null ? '<span class="mv new">new</span>' : r.rank < r.prevRank ? '<span class="mv up">▲' + (r.prevRank - r.rank) + '</span>' : r.rank > r.prevRank ? '<span class="mv down">▼' + (r.rank - r.prevRank) + '</span>' : '<span class="mv same">&ndash;</span>';
      return '<li data-from="' + from + '" class="' + (r.id === uu.s.you ? 'me ' : '') + (r.rank === 1 && r.score > 0 ? 'lead' : '') + '">' +
        '<span class="rank">' + r.rank + '</span>' + WCS.avatar(p) +
        '<span class="pname"><span class="nm">' + WCS.pname(p) + '</span>' + (p.badges && p.badges.length ? '<span class="bdgs">' + WCS.badgeIcons(p) + '</span>' : '') + '</span>' + move +
        '<span class="score" data-count="' + r.score + '" data-start="' + (r.score - r.delta) + '">' + (opts && opts.animate ? r.score - r.delta : r.score) + '</span>' +
        (r.delta ? '<span class="delta' + (r.delta < 0 ? ' neg' : '') + '">' + (r.delta > 0 ? '+' : '') + r.delta + '</span>' : '<span class="delta"></span>') + '</li>';
    }).join('') + '</ul>';
  };

  // slide rows from their old places into the new order, and count the scores up
  WCS.animateBoard = function (root, delay) {
    var list = root.querySelector('.board.anim');
    if (!list) return;
    var lis = list.querySelectorAll('li');
    if (!lis.length) return;
    var h = lis[0].offsetHeight + 8;
    for (var i = 0; i < lis.length; i++) { lis[i].style.transition = 'none'; lis[i].style.transform = 'translateY(' + (parseInt(lis[i].getAttribute('data-from'), 10) * h) + 'px)'; }
    list.offsetHeight; // reflow
    setTimeout(function () {
      list.classList.add('go');
      for (var j = 0; j < lis.length; j++) { lis[j].style.transition = ''; lis[j].style.transform = ''; }
      var sc = list.querySelectorAll('[data-count]');
      var t0 = Date.now();
      (function step() {
        var k = Math.min(1, (Date.now() - t0) / 900);
        for (var n = 0; n < sc.length; n++) {
          var a = +sc[n].getAttribute('data-start'), b = +sc[n].getAttribute('data-count');
          sc[n].textContent = Math.round(a + (b - a) * k);
        }
        if (k < 1) requestAnimationFrame(step);
      })();
    }, delay);
  };

  // ----- awards show -----
  WCS.awardHtml = function (a, uu, big) {
    var front = '<div class="award-front"><span class="corner">And the award for</span><div class="aicon">' + a.icon + '</div><div class="aname">' + esc(a.name) + '</div><div class="adesc">' + esc(a.desc) + '</div><div class="goes">goes to&hellip;</div></div>';
    var back = '<div class="award-back"><div class="aicon small">' + a.icon + ' ' + esc(a.name) + '</div><div class="chips-row">' + a.winners.map(function (id) { return uu.av(id, 'big'); }).join('') + '</div>' +
      '<div class="wname">' + a.winners.map(function (id) { return uu.name(id); }).join(' &amp; ') + '</div><div class="adetail">' + esc(a.detail || '') + '</div></div>';
    return WCS.flipCard(front, back, 'award' + (big ? ' big' : ''));
  };

  WCS.podium = function (uu) {
    var sorted = uu.s.players.slice().sort(function (a, b) { return b.score - a.score; });
    var top = sorted.slice(0, 3);
    var order = [top[1], top[0], top[2]];
    return '<div class="podium">' + order.map(function (p, i) {
      if (!p) return '<div class="step empty"></div>';
      var place = [2, 1, 3][i];
      return '<div class="step p' + place + '">' + uu.av(p, place === 1 ? 'big' : '') + '<b>' + WCS.pname(p) + '</b><span>' + p.score + '</span><div class="block">' + place + '</div></div>';
    }).join('') + '</div>';
  };

})();
