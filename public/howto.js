/* Wild Card Showdown - big-screen extras: the how-to-play carousel, the per-round rules card,
   and the "put this on the TV" tip. Host screen only. */
(function () {
  'use strict';
  var WCS = window.WCS, esc = WCS.esc;
  var SKIP_STORE = 'wcs.howtoSkipped', TV_STORE = 'wcs.tvTipHidden';
  var idx = 0, auto = null, el = null;

  function get(k) { try { return localStorage.getItem(k) === '1'; } catch (e) { return false; } }
  function set(k, v) { try { localStorage.setItem(k, v ? '1' : '0'); } catch (e) { /* ignore */ } }

  function g(id) { return WCS.game(id) || { icon: '', name: id, rule: '' }; }

  function cards(state) {
    var showdown = !state || state.settings.showdown;
    var tw = WCS.meta ? WCS.meta.twists : {};
    var twists = Object.keys(tw).map(function (k) { return '<li><span>' + tw[k].icon + '</span><b>' + esc(tw[k].name) + '</b> ' + esc(tw[k].desc) + '</li>'; }).join('');
    var sample = WCS.meta ? WCS.meta.avatars.slice(0, 5).map(function (a, i) {
      return '<span class="av big" style="--c:' + WCS.meta.colors[i * 3].hex + '"><i>' + a + '</i></span>';
    }).join('') : '';
    return [
      { icon: '📱', title: 'Join on your phone', body: '<p>Point your phone camera at the <b>QR code</b> and tap the link.</p><p class="small">Or type the address on the left, then the <b>4-letter table code</b>.</p>' },
      { icon: '🃏', title: 'Pick your look', body: '<div class="howto-avs">' + sample + '</div><p>Type a name, pick an <b>emoji</b> and a <b>card colour</b>.</p><p class="small">Or tap <b>🎲 Shuffle me</b> for a random funny one.</p>' },
      { icon: g('cardCulprit').icon, title: 'Card Culprit', cls: 'gp-cardCulprit', body: '<p>Everyone answers the same question.</p><p>Answers are shown with no names. <b>Guess who wrote each one.</b></p><p class="small">+100 for a right guess &middot; +50 for every player you fool</p>' },
      { icon: g('bluffClub').icon, title: 'Bluff Club', cls: 'gp-bluffClub', body: '<p>A weird <b>true</b> fact with a blank.</p><p>Write a <b>believable fake</b> answer, then <b>find the real one</b>.</p><p class="small">+100 for finding the truth &middot; +50 each time someone picks your fake</p>' },
      { icon: g('doodleDuel').icon, title: 'Doodle Duel', cls: 'gp-doodleDuel', body: '<p>Draw your <b>secret prompt</b> with your finger.</p><p>Guess which prompt each drawing was, then <b>vote for the best</b>.</p><p class="small">Tap <b>I\'m done</b> when you finish &middot; +100 per vote</p>' },
      { icon: '🎴', title: 'Wild card twists', body: '<p>Some rounds start with a twist card:</p><ul class="howto-twists">' + twists + '</ul>' },
      { icon: '💰', title: 'The finale', body: '<p>Before the last round, everyone <b>secretly bets</b> some points.</p><p>The final round is worth <b>&times;' + (WCS.meta ? WCS.meta.finaleMult : 3) + '</b>. Top half wins the bet, bottom half loses it.</p>' +
        (showdown ? '<p class="small">Then the top players face off in the <b>Showdown Duel</b> while everyone else votes.</p>' : '') },
      { icon: '🏆', title: 'Ready?', body: '<p>Badges change hands as you play, and there\'s an <b>awards show</b> at the end.</p><p>The <b>dealer</b> (first to join) taps <b>Deal the cards!</b> on their phone.</p>' },
    ];
  }

  // ---------- the carousel ----------
  WCS.howtoHtml = function (state) {
    if (get(SKIP_STORE)) return '<button class="howto-open" id="howtoOpen">❓ How to play</button>';
    var list = cards(state);
    if (idx >= list.length) idx = 0;
    var c = list[idx];
    return '<div class="howto" id="howto">' +
      '<div class="howto-card ' + (c.cls || '') + '" key="' + idx + '"><div class="howto-icon">' + c.icon + '</div><div class="howto-text"><h3>' + esc(c.title) + '</h3>' + c.body + '</div></div>' +
      '<div class="howto-nav"><button id="howtoPrev" aria-label="Previous">◀</button>' +
      '<span class="dots">' + list.map(function (x, i) { return '<i class="' + (i === idx ? 'on' : '') + '" data-howto="' + i + '"></i>'; }).join('') + '</span>' +
      '<button id="howtoNext" aria-label="Next">▶</button><button id="howtoSkip" class="skip">Skip, we know how to play ⏭</button></div></div>';
  };

  function redraw() {
    var box = document.getElementById('howtoBox');
    if (box) { box.innerHTML = WCS.howtoHtml(WCS.lastHostState); WCS.sfx('flip'); }
  }
  function go(n) {
    var len = cards(WCS.lastHostState).length;
    idx = (n + len) % len;
    redraw();
    restart();
  }
  function restart() {
    clearInterval(auto);
    auto = setInterval(function () {
      if (!document.getElementById('howto')) return;
      idx = (idx + 1) % cards(WCS.lastHostState).length;
      var box = document.getElementById('howtoBox');
      if (box) box.innerHTML = WCS.howtoHtml(WCS.lastHostState);
    }, 12000);
  }
  restart();

  document.addEventListener('click', function (e) {
    var t = e.target.closest('#howtoPrev,#howtoNext,#howtoSkip,#howtoOpen,[data-howto],#tvTipClose,#tvTipOpen');
    if (!t) return;
    if (t.id === 'howtoPrev') go(idx - 1);
    else if (t.id === 'howtoNext') go(idx + 1);
    else if (t.dataset.howto) go(+t.dataset.howto);
    else if (t.id === 'howtoSkip') { set(SKIP_STORE, true); redraw(); }
    else if (t.id === 'howtoOpen') { set(SKIP_STORE, false); idx = 0; redraw(); restart(); }
    else if (t.id === 'tvTipClose') { set(TV_STORE, true); var b = document.getElementById('tvTipBox'); if (b) b.innerHTML = WCS.tvTipHtml(); }
    else if (t.id === 'tvTipOpen') { set(TV_STORE, false); var b2 = document.getElementById('tvTipBox'); if (b2) b2.innerHTML = WCS.tvTipHtml(); }
  });
  document.addEventListener('keydown', function (e) {
    if (!document.getElementById('howto')) return;
    if (e.key === 'ArrowRight') go(idx + 1);
    if (e.key === 'ArrowLeft') go(idx - 1);
  });

  // ---------- TV tip (host only) ----------
  WCS.tvTipHtml = function (online) {
    if (get(TV_STORE)) return '<button class="howto-open small" id="tvTipOpen">📺 TV tips</button>';
    return '<div class="tvtip"><button class="x" id="tvTipClose" aria-label="Hide">✕</button>' +
      '<div class="tvtip-title">📺 Put this screen on the TV</div>' +
      '<ol><li>Laptop and TV on the <b>same Wi-Fi</b>.</li>' +
      '<li>Press <span class="key">⊞ Win</span> + <span class="key">K</span> and pick your <b>TV or Roku</b>.</li>' +
      (online ? '' : '<li>Phones can\'t reach the laptop on that Wi-Fi? Put the <b>laptop, TV and phones</b> on a <b>phone hotspot</b> instead.</li>') +
      '<li>Backup: plug in an <b>HDMI cable</b>.</li></ol></div>';
  };

  // ---------- one-line rules card at the start of each game round ----------
  WCS.rulesCardHtml = function (state) {
    var c = state.cur;
    if (!c || !c.gameId) return '';
    var gm = g(c.gameId);
    var rule = c.showdown ? gm.duelRule : gm.rule;
    return '<div class="rulescard gp-' + c.gameId + '"><span class="ri">' + gm.icon + '</span><span><b>' + esc(gm.name) + ':</b> ' + esc(rule) + '</span></div>';
  };
})();
