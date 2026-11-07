/* Bluff Club - phone + host screens */
(function () {
  'use strict';
  var WCS = window.WCS, esc = WCS.esc;

  function qcard(g, small) {
    return '<div class="card qcard bluff' + (small ? ' small' : '') + '"><span class="corner">True story</span>' + esc(g.q) + '</div>';
  }

  function options(s, u) {
    var g = s.game;
    return '<div class="options">' + g.options.map(function (o) {
      if (g.canVote && !o.mine) return '<button class="option" data-a="vote" data-v="' + o.i + '" data-num="1">' + esc(o.text) + '</button>';
      return '<div class="option' + (o.mine ? ' mine' : '') + (g.myVote === o.i ? ' voted' : '') + '">' + esc(o.text) + (o.mine ? '<small>your fake</small>' : '') + '</div>';
    }).join('') + '</div>';
  }

  function reveal(s, u) {
    var g = s.game;
    return '<div class="bluff-reveal">' + g.options.map(function (o, n) {
      var who = o.pickers.length ? o.pickers.map(function (id) { return u.av(id, 'small'); }).join('') : '<small>nobody</small>';
      var label;
      if (o.truth) label = '<span class="truth-stamp">THE TRUTH</span>' + (o.pickers.length ? '' : '<small>Nobody found it!</small>');
      else if (o.house) label = '<span class="lie">House lie</span>';
      else label = '<span class="lie">Fake by</span> ' + o.authors.map(function (id) { return u.who(id); }).join(' ') +
        (o.pickers.length && g.points[o.authors[0]] ? '' : '');
      var pts = '';
      if (o.truth) pts = o.pickers.map(function (id) { return g.points[id] ? '<span class="pts">' + u.name(id) + ' +' + g.points[id] + '</span>' : ''; }).join(' ');
      else if (o.pickers.length) pts = o.authors.map(function (id) { return g.points[id] ? '<span class="pts">' + u.name(id) + ' +' + g.points[id] + '</span>' : ''; }).join(' ');
      return '<div class="bopt' + (o.truth ? ' truth' : '') + (g.myVote === o.i ? ' myvote' : '') + '" style="animation-delay:' + (n * 1.2) + 's">' +
        '<div class="btext">' + esc(o.text) + '</div><div class="bwho">' + label + '</div><div class="bpick">Picked by: ' + who + '</div>' +
        (pts ? '<div class="bpts">' + pts + '</div>' : '') + '</div>';
    }).join('') + '</div>';
  }

  function phone(s, u) {
    var g = s.game;
    if (g.phase === 'write') {
      var h = u.timer() + qcard(g);
      if (!s.inRound) return h + u.spectating() + u.waiting();
      if (!g.writer) return h + '<p class="hint">The duellists are writing fakes. Can you spot the truth?</p>' + u.waiting();
      if (g.myFake) return h + '<div class="card acard"><span class="corner">Your fake answer</span>' + esc(g.myFake) + '<div><span class="stamp">LOCKED IN</span></div></div><p class="hint">Waiting for everyone else&hellip;</p>' + u.waiting();
      return h + '<div class="card acard"><span class="corner">Your fake answer</span>' +
        '<input type="text" id="fake" maxlength="' + g.maxLen + '" autocomplete="off" enterkeyhint="done" placeholder="Something believable&hellip;"></div>' +
        '<button class="btn" id="submitFake">Lock in my fake</button>' + u.waiting();
    }
    if (g.phase === 'vote') {
      var hv = u.timer() + qcard(g, true);
      if (g.canVote) return hv + '<h2>Which one is real?</h2>' + options(s, u);
      if (!g.voter) return hv + '<p class="hint">The audience is hunting for the truth&hellip;</p>' + options(s, u) + u.waiting();
      return hv + '<p class="hint">' + (g.myVote != null ? 'Locked in. Waiting for the others&hellip;' : 'Watching this round.') + '</p>' + options(s, u) + u.waiting();
    }
    if (g.phase === 'reveal') return qcard(g, true) + reveal(s, u) + u.timer();
    return '';
  }

  function host(s, u) {
    var g = s.game;
    if (g.phase === 'write') return '<div class="host-status">Write a believable fake answer on your phone</div>' + u.timer() + qcard(g) + u.waiting();
    if (g.phase === 'vote') return '<div class="host-status">Which one is real? Vote on your phone</div>' + qcard(g, true) + options(s, u) + u.timer() + u.waiting();
    if (g.phase === 'reveal') return qcard(g, true) + reveal(s, u);
    return '';
  }

  function keep(s) {
    var g = s.game;
    if (g.phase === 'write' && g.canWrite) return 'bc-write:' + s.round;
    return null;
  }

  function after(s, u, root, send) {
    var inp = root.querySelector('#fake');
    if (!inp) return;
    var key = 'wcs.fake.' + s.code + '.' + s.gameKey + '.' + s.round;
    try { inp.value = sessionStorage.getItem(key) || ''; } catch (e) { /* ignore */ }
    inp.addEventListener('input', function () { try { sessionStorage.setItem(key, inp.value); } catch (e) { /* ignore */ } });
    var go = function () {
      var text = inp.value.trim();
      if (!text) return WCS.toast('Write a fake answer first!');
      WCS.sfx('pop');
      send('fake', text);
    };
    root.querySelector('#submitFake').addEventListener('click', go);
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  }

  function cue(s) {
    var p = s.game.phase;
    if (p === 'vote') return { sound: 'pop' };
    if (p === 'reveal') {
      var n = s.game.options.length;
      for (var i = 0; i < n - 1; i++) WCS.sfx('tap', i * 1.2);
      return { sound: 'ding', delay: (n - 1) * 1.2 + 0.3, buzz: [0, Math.round((n - 1) * 1200), 80, 60, 80] };
    }
    return null;
  }


  function goal(s) {
    var g = s.game, duel = s.cur.showdown, role = s.cur.role;
    if (g.phase === 'write') {
      if (duel && role !== 'contestant') return 'The duellists are writing fakes. Next you <b>find the REAL answer</b>.';
      return 'Write a <b>FAKE</b> answer that <b>sounds real</b>. Don\'t write the truth! <b>+' + (duel ? WCS.meta.duelPts : 50) + '</b> for everyone who falls for it.';
    }
    if (g.phase === 'vote') {
      if (duel && role === 'contestant' && !g.voter) return 'Hope the audience falls for your fake: <b>' + WCS.meta.duelPts + ' points</b> each.';
      return 'Pick the <b>REAL</b> answer. Finding the truth: <b>+100</b>. You can\'t pick your own fake.';
    }
    return 'Which one was true? <b>+100</b> for the truth, <b>+50</b> to each faker per player fooled.';
  }

  WCS.register('bluffClub', { goal: goal, phone: phone, host: host, keep: keep, after: after, cue: cue });
})();
