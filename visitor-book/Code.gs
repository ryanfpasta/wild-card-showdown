// WILD CARD SHOWDOWN - VISITOR BOOK (Google Apps Script)
// Paste this whole file into Extensions > Apps Script of a new Google Sheet. See SETUP.txt.
// It adds one row per game to the sheet, and emails the whole book to the sheet's owner
// (your own Google account) when you press "Email it to me" on the site's /book page.

// 1) Change this to your own secret word. Put the SAME word in Render as VISITOR_BOOK_KEY.
const SECRET = 'change-me-to-a-secret-word';

// 2) true = email you every time a game is logged. false = no alerts.
const ALERT_EACH_GAME = true;

const COLUMNS = ['When', 'Games played', 'Rounds', 'Players', 'Winner', 'Scores', 'Ended early', 'Table'];

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return reply({ ok: false, error: 'bad request' }); }
  if (SECRET === 'change-me-to-a-secret-word' || body.key !== SECRET) return reply({ ok: false, error: 'wrong secret word' });
  const sheet = book();
  if (body.action === 'log') {
    const g = body.entry || {};
    sheet.appendRow([new Date(g.when || Date.now()), g.games, g.rounds, g.players, g.winner, g.scores, g.endedEarly ? 'yes' : '', g.table]);
    if (ALERT_EACH_GAME) alertNewGame(g);
    return reply({ ok: true });
  }
  if (body.action === 'list') return reply({ ok: true, rows: rows(sheet) });
  if (body.action === 'email') return reply({ ok: true, count: emailBook(sheet) });
  return reply({ ok: false, error: 'unknown action' });
}

function doGet() { return reply({ ok: true, hello: 'Visitor book is running' }); }

function book() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Visitor book') || ss.insertSheet('Visitor book');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold');
    sheet.getRange('A:A').setNumberFormat('ddd d mmm yyyy, h:mm am/pm');
  }
  return sheet;
}

function rows(sheet) {
  const n = sheet.getLastRow() - 1;
  if (n < 1) return [];
  const tz = Session.getScriptTimeZone();
  return sheet.getRange(2, 1, n, COLUMNS.length).getValues().map(r => r.map((v, i) =>
    i === 0 && v instanceof Date ? Utilities.formatDate(v, tz, 'EEE d MMM yyyy, h:mm a') : String(v)));
}

function emailBook(sheet) {
  const list = rows(sheet);
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const cell = 'style="border:1px solid #ccc;padding:6px;text-align:left;vertical-align:top"';
  const html = '<h2>Wild Card Showdown - visitor book</h2><p>' + list.length + ' game(s), newest first.</p>' +
    '<table style="border-collapse:collapse;font-family:sans-serif;font-size:13px"><tr>' +
    COLUMNS.map(c => '<th ' + cell + '>' + c + '</th>').join('') + '</tr>' +
    list.slice().reverse().map(r => '<tr>' + r.map(v => '<td ' + cell + '>' + esc(v) + '</td>').join('') + '</tr>').join('') +
    '</table><p><a href="' + SpreadsheetApp.getActiveSpreadsheet().getUrl() + '">Open the Google Sheet</a></p>';
  const csv = [COLUMNS].concat(list).map(r => r.map(v => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v).join(',')).join('\r\n');
  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    subject: 'Wild Card Showdown visitor book (' + list.length + ' games)',
    htmlBody: html,
    attachments: [Utilities.newBlob(csv, 'text/csv', 'visitor-book.csv')],
  });
  return list.length;
}

function alertNewGame(g) {
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(),
    'Wild Card Showdown: new game played' + (g.winner ? ' (winner: ' + g.winner + ')' : ''),
    'Games: ' + g.games + '\nRounds: ' + g.rounds + '\nPlayers: ' + g.players + '\nScores: ' + g.scores +
    (g.endedEarly ? '\nEnded early: yes' : '') + '\n\nThe whole book: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl());
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Run this once from the editor (select "setup" then Run) to create the sheet and grant permissions.
function setup() { book(); Logger.log('Ready. Now Deploy > New deployment > Web app.'); }
