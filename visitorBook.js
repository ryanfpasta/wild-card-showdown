'use strict';
// VISITOR BOOK - a private log of every game played (when, which games, who played, final scores).
//
// Where it goes:
//   - If VISITOR_BOOK_URL is set (the address of the Google Apps Script web app described in
//     visitor-book/SETUP.txt), each finished game is added as a row to Ryan's Google Sheet.
//     That survives Render restarts and redeploys, and costs nothing.
//   - Otherwise (e.g. on the laptop), each game is added to visitor-book.csv next to server.js.
//
// VISITOR_BOOK_KEY is a secret word shared with the Apps Script, so nobody else can write to or
// read the book. The /book page on the site asks for the same word before it shows or emails it.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const URL_ = (process.env.VISITOR_BOOK_URL || '').trim();
const KEY = (process.env.VISITOR_BOOK_KEY || '').trim();
const CSV_FILE = path.join(__dirname, 'visitor-book.csv');
const COLUMNS = ['When', 'Games played', 'Rounds', 'Players', 'Winner', 'Scores', 'Ended early', 'Table'];

const pending = [];   // entries that couldn't be sent yet (Google hiccup); retried with the next one

function enabled() { return !!(URL_ && KEY); }

function keyOk(k) {
  if (!KEY) return false;
  const a = crypto.createHash('sha256').update(String(k || '')).digest();
  const b = crypto.createHash('sha256').update(KEY).digest();
  return crypto.timingSafeEqual(a, b);
}

async function call(body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetch(URL_, {
      method: 'POST', redirect: 'follow', signal: ctl.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // plain text keeps Apps Script happy
      body: JSON.stringify(Object.assign({ key: KEY }, body)),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) {
      // Google sends an HTML page when the script crashed, isn't authorised, or the address is wrong
      const msg = (text.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
      const err = (text.match(/(?:Error|Exception)[^<]{0,200}/) || [])[0] || '';
      console.log('Visitor book: unexpected reply', res.status, res.url, text.slice(0, 500));
      throw new Error(`Google sent back a page instead of the book (status ${res.status}${msg ? ', "' + msg.trim() + '"' : ''}${err ? ': ' + err.trim() : ''}). Check the /exec address on Render, and that "setup" was run once in the script editor.`);
    }
    if (!data.ok) throw new Error(data.error || 'the script said no');
    return data;
  } finally { clearTimeout(timer); }
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function writeCsv(entry) {
  try {
    const fresh = !fs.existsSync(CSV_FILE);
    const when = new Date(entry.when).toLocaleString();
    const row = [when, entry.games, entry.rounds, entry.players, entry.winner, entry.scores, entry.endedEarly ? 'yes' : '', entry.table];
    fs.appendFileSync(CSV_FILE, (fresh ? COLUMNS.join(',') + '\r\n' : '') + row.map(csvCell).join(',') + '\r\n');
  } catch (e) { console.log('Visitor book: could not write visitor-book.csv:', e.message); }
}

async function flush() {
  while (pending.length) {
    try { await call({ action: 'log', entry: pending[0] }); pending.shift(); }
    catch (e) { console.log('Visitor book: will retry later -', e.message); return; }
  }
}

// called by the hub when a game reaches the final screen
function record(entry) {
  if (!enabled()) return writeCsv(entry);
  if (pending.length < 200) pending.push(entry);
  flush();
}

async function list() { await flush(); return (await call({ action: 'list' })).rows || []; }
async function email() { await flush(); return call({ action: 'email' }); }

module.exports = { record, list, email, enabled, keyOk, COLUMNS, pendingCount: () => pending.length };
