/* Card Culprit - phone + host screens */
(function () {
  'use strict';
  var WCS = window.WCS, esc = WCS.esc;

  function qcard(g, small) {
    return '<div class="card qcard' + (small ? ' small' : '') + '"><span class="corner">Question</span>' + esc(g.prompt) + '</div>';
  }
  function acard(text, placeholder, corner, extra) {
    return '<div class="card acard' + (placeholder ? ' placeholder' : '') + '"><span class="corner">' + corner + '</span>' + esc(text) + (extra || '') + '</div>';
  }

  function revealCard(s, u) {
    var c = s.game.card;
    var author = u.player(c.authorId);
    var back = '<div class="reveal-back"><span class="by">Written by</span>' + u.av(author, 'big') +
      '<span class="author">' + esc(author ? author.name : '?') + '</span><span class="quote">&ldquo;' + esc(c.text) + '&rdquo;</span></div>';
    return WCS.flipCard(acard(c.text, c.placeholder, 'Who wrote this?'), back, 'reveal');
  }

  function results(s, u) {
    var c = s.game.card;
    var rows = c.guesses.map(function (g) {
      var right = g[1] === c.authorId;
      var pts = right ? (c.points[g[0]] ? '+' + c.points[g[0]] : '') : '';
      return '<li class="' + (right ? 'right' : '') + (g[0] === s.you ? ' me' : '') + '">' + u.av(g[0], 'small') +
        '<span class="txt">' + u.name(g[0]) + ' guessed ' + u.name(g[1]) + '</span><span class="pts">' + pts + '</span></li>';
    }).join('');
    return '<ul class="results">' + (rows || '<li><span class="txt">Nobody guessed in time.</span></li>') + '</ul>';
  }

  function entries(s, u, vote) {
    var g = s.game;
    return '<div class="entries">' + g.entries.map(function (e) {
      var info = '';
      if (!vote) {
        info = '<div class="entry-by">' + u.who(e.authorId) + ' <b>' + e.voters.length + ' vote' + (e.voters.length === 1 ? '' : 's') + '</b> ' + (g.points[e.authorId] ? '<span class="pts">+' + g.points[e.authorId] + '</span>' : '') + '</div>';
      }
      var inner = '<span class="corner">' + (e.mine ? 'Your answer' : 'Answer ' + String.fromCharCode(65 + e.i)) + '</span>' + esc(e.text) + info;
      if (vote && g.canVote && !e.mine && !e.placeholder) return '<button class="card acard pickable" data-a="vote" data-v="' + e.i + '" data-num="1">' + inner + '</button>';
      return '<div class="card acard' + (e.placeholder ? ' placeholder' : '') + (g.myVote === e.i ? ' voted' : '') + '">' + inner + '</div>';
    }).join('') + '</div>';
  }

  function phone(s, u) {
    var g = s.game;
    if (g.phase === 'answer') {
      var head = u.timer() + qcard(g);
      if (!s.inRound) return head + u.spectating() + u.waiting();
      if (!g.writer) return head + '<p class="hint">The duellists are writing. Get ready to vote for the best answer!</p>' + u.waiting();
      if (g.myAnswer) return head + acard(g.myAnswer, false, 'Your answer', '<div><span class="stamp">LOCKED IN</span></div>') + '<p class="hint">Waiting for everyone else&hellip;</p>' + u.waiting();
      return head +
        '<div class="card acard"><span class="corner">Your answer</span>' +
        '<textarea id="answer" maxlength="' + WCS.meta.maxAnswer + '" rows="4" placeholder="Be honest. Or don\'t." enterkeyhint="done"></textarea>' +
        '<span class="count" id="count"></span></div>' +
        '<button class="btn" id="submitAnswer">Lock it in</button>' + u.waiting();
    }
    if (g.phase === 'guess') {
      var c = g.card;
      var h = '<div class="sub">Card ' + (c.index + 1) + ' of ' + c.total + '</div>' + u.timer() + qcard(g, true) + acard(c.text, c.placeholder, 'Who wrote this?');
      if (c.mine) return h + '<h2>This one\'s yours.</h2><p class="hint">Keep a straight face&hellip;</p>' + u.waiting();
      if (!s.inRound) return h + u.spectating() + u.waiting();
      if (c.canGuess) {
        return h + '<div class="choices">' + c.choices.map(function (id) {
          return '<button class="choice" data-a="guess" data-v="' + id + '">' + u.av(id, 'small') + '<span>' + u.name(id) + '</span></button>';
        }).join('') + '</div>';
      }
      if (c.myGuess) return h + '<p class="hint">You picked <b>' + u.name(c.myGuess) + '</b>. Waiting for the others&hellip;</p>' + u.waiting();
      return h + '<p class="hint">Time\'s up!</p>';
    }
    if (g.phase === 'reveal') {
      var c2 = g.card, mine = c2.points[s.you] || 0, you = '';
      if (c2.mine) {
        var fooled = c2.guesses.filter(function (x) { return x[1] !== c2.authorId; }).length;
        you = c2.placeholder ? 'Silence is not a strategy.' : fooled ? 'You fooled <b>' + fooled + '</b>! +' + mine : 'Busted. Everyone knew it was you.';
      } else if (c2.myGuess) you = c2.myGuess === c2.authorId ? 'Nailed it! <b>+' + mine + '</b>' : 'Fooled you!';
      return '<div class="sub">Card ' + (c2.index + 1) + ' of ' + c2.total + '</div>' + revealCard(s, u) +
        (you ? '<div class="youbox">' + you + '</div>' : '') + results(s, u) + u.timer();
    }
    if (g.phase === 'vote') {
      var hv = u.timer() + qcard(g, true);
      if (g.canVote) return hv + '<h2>Vote for the best answer</h2>' + entries(s, u, true);
      return hv + '<p class="hint">' + (g.myVote != null ? 'Vote locked in.' : 'The audience is voting&hellip;') + '</p>' + entries(s, u, true) + u.waiting();
    }
    if (g.phase === 'results') return qcard(g, true) + '<h2>The audience has spoken</h2>' + entries(s, u, false) + u.timer();
    return '';
  }

  function host(s, u) {
    var g = s.game;
    if (g.phase === 'answer') return '<div class="host-status">Write your answers on your phones</div>' + u.timer() + qcard(g) + u.waiting();
    if (g.phase === 'guess') {
      var c = g.card;
      return '<div class="host-status">Card ' + (c.index + 1) + ' of ' + c.total + ' &middot; Who wrote this?</div>' + qcard(g, true) +
        acard(c.text, c.placeholder, 'Who wrote this?') + u.timer() + u.waiting();
    }
    if (g.phase === 'reveal') {
      var c2 = g.card, right = c2.guesses.filter(function (x) { return x[1] === c2.authorId; }).length;
      return '<div class="host-status">Card ' + (c2.index + 1) + ' of ' + c2.total + '</div>' + qcard(g, true) + revealCard(s, u) +
        '<div class="host-status center">' + right + ' guessed right, ' + (c2.guesses.length - right) + ' fooled</div>';
    }
    if (g.phase === 'vote') return '<div class="host-status">Audience: vote for the best answer</div>' + qcard(g, true) + entries(s, u, true) + u.timer() + u.waiting();
    if (g.phase === 'results') return qcard(g, true) + entries(s, u, false);
    return '';
  }

  function keep(s) {
    var g = s.game;
    if (g.phase === 'answer' && g.canAnswer) return 'cc-answer:' + s.round;
    return null;
  }

  function after(s, u, root, send) {
    var ta = root.querySelector('#answer');
    if (!ta) return;
    var count = root.querySelector('#count');
    var key = 'wcs.draft.' + s.code + '.' + s.round;
    try { ta.value = sessionStorage.getItem(key) || ''; } catch (e) { /* ignore */ }
    var upd = function () {
      var left = WCS.meta.maxAnswer - ta.value.length;
      count.textContent = left;
      count.classList.toggle('low', left <= 15);
      try { sessionStorage.setItem(key, ta.value); } catch (e) { /* ignore */ }
    };
    ta.addEventListener('input', upd);
    upd();
    root.querySelector('#submitAnswer').addEventListener('click', function () {
      var text = ta.value.trim();
      if (!text) return WCS.toast('Write something first!');
      WCS.sfx('pop');
      send('answer', text);
      ta.blur();
    });
  }

  function cue(s) {
    var p = s.game.phase;
    if (p === 'reveal') return { sound: 'flip', delay: 0.4, buzz: [0, 450, 60] };
    if (p === 'results') return { sound: 'fanfare', buzz: 80 };
    if (p === 'guess' || p === 'vote') return { sound: 'pop' };
    return null;
  }


  // the always-on "what am I trying to do?" banner
  function goal(s) {
    var g = s.game, duel = s.cur.showdown, role = s.cur.role;
    if (duel) {
      if (g.phase === 'answer') return role === 'contestant' ? 'Write the <b>best, funniest answer</b>. The audience picks a winner.' : 'The duellists are writing. Next you <b>vote for the best answer</b>.';
      if (g.phase === 'vote') return role === 'contestant' ? 'Hope the audience likes yours: <b>' + WCS.meta.duelPts + ' points per vote</b>.' : 'Vote for the <b>best answer</b>.';
      return 'The audience has spoken.';
    }
    if (g.phase === 'answer') return 'Answer the question. Later everyone <b>guesses who wrote each answer</b>, so be sneaky: <b>+50 for every player you fool</b>.';
    if (g.phase === 'guess') return g.card && g.card.mine ? 'This is <b>your</b> answer. Keep a straight face: <b>+50 for every player you fool</b>.' : '<b>Guess who wrote this answer.</b> Right guess: <b>+100</b>.';
    if (g.phase === 'reveal') return 'Who really wrote it? <b>+100</b> for a right guess, <b>+50</b> to the writer per player fooled.';
    return '';
  }

  WCS.register('cardCulprit', { goal: goal, phone: phone, host: host, keep: keep, after: after, cue: cue });
})();
