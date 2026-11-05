'use strict';
// Wild Card Showdown - phone party game hub server.
// Serves the phone client (/) and the laptop host screen (/host), and runs the
// games over WebSockets (game logic is in hub.js and games/). All state lives in memory.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { WebSocketServer } = require('ws');
const qrcode = require('qrcode-generator');
const hub = require('./hub');
const visitorBook = require('./visitorBook');

function num(v, d) { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : d; }
const BASE_PORT = num(process.env.PORT, 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- online (cloud) mode ----------
// On the laptop none of these are set, so the game behaves exactly as before (LAN mode).
// On a host like Render / Railway / Fly.io one of them is set automatically, which switches on:
//   - the QR code and join link use the site's public address (https://...)
//   - every host screen gets its own table, so different groups don't collide
const PUBLIC_URL = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
const ONLINE = !!(PUBLIC_URL || process.env.ONLINE === '1' || process.env.RENDER ||
  process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME || process.env.FLY_APP_NAME);

function publicBase(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const first = h => String(h || '').split(',')[0].trim();
  const proto = first(req.headers['x-forwarded-proto']) || 'http';
  const host = first(req.headers['x-forwarded-host']) || req.headers.host || 'localhost';
  if (!/^https?$/.test(proto) || !/^[0-9A-Za-z.:\[\]-]+$/.test(host)) return null;
  return `${proto}://${host}`;
}

// ---------- network helpers ----------
const VIRTUAL_HINT = /(vethernet|virtual|vmware|vbox|hyper-v|wsl|docker|loopback|bluetooth|tailscale|zerotier|hamachi|vpn|utun|tun|tap)/i;

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const a of ifaces[name] || []) {
      const fam = typeof a.family === 'string' ? a.family : (a.family === 4 ? 'IPv4' : 'IPv6');
      if (fam !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('169.254.')) continue; // no DHCP lease
      let rank = 50;
      if (/^192\.168\./.test(a.address)) rank = 10;
      else if (/^10\./.test(a.address)) rank = 20;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(a.address)) rank = 30;
      if (/wi-?fi|wlan|wireless/i.test(name)) rank -= 5;
      if (VIRTUAL_HINT.test(name)) rank += 100;
      out.push({ ip: a.address, name, rank });
    }
  }
  out.sort((x, y) => x.rank - y.rank);
  return out.map(({ ip, name }) => ({ ip, name }));
}

function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const m = 2; // quiet zone in modules
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
    }
  }
  const s = n + m * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges">` +
    `<rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// ---------- HTTP ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
};

let defaultRoom = hub.createRoom(true);
let actualPort = BASE_PORT;

function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  // Don't reuse connections: some Android Chrome builds retry on reused sockets and give up (ERR_TOO_MANY_RETRIES).
  res.setHeader('Connection', 'close');
  let url;
  try { url = new URL(req.url, 'http://x'); } catch (e) { res.writeHead(400); return res.end(); }
  const p = url.pathname;

  if (p === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }
  if (p === '/info') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    if (ONLINE) {
      // each host screen keeps its own table (it passes back the code it was given)
      const want = (url.searchParams.get('room') || '').toUpperCase();
      let room = hub.getRoom(want);
      if (!room) room = hub.createRoom(false);
      if (!room) return res.end(JSON.stringify({ online: true, error: 'full' }));
      room.lastActive = Date.now();
      return res.end(JSON.stringify({ online: true, publicUrl: publicBase(req), addresses: [], code: room.code }));
    }
    if (!hub.rooms.has(defaultRoom.code)) defaultRoom = hub.createRoom(true);
    return res.end(JSON.stringify({ port: actualPort, addresses: lanAddresses(), code: defaultRoom.code }));
  }
  if (p === '/qr') {
    const code = (url.searchParams.get('code') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    let link;
    if (ONLINE) {
      const base = publicBase(req);
      if (!base) { res.writeHead(400); return res.end(); }
      link = `${base}/` + (code ? `?code=${code}` : '');
    } else {
      const ip = url.searchParams.get('ip') || (lanAddresses()[0] || {}).ip || 'localhost';
      if (!/^[0-9a-zA-Z.:-]+$/.test(ip)) { res.writeHead(400); return res.end(); }
      link = `http://${ip}:${actualPort}/` + (code ? `?code=${code}` : '');
    }
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
    return res.end(qrSvg(link));
  }
  if (p === '/book' || p === '/book/') return bookPage(req, res);
  if (p === '/' || p === '/index.html') return serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
  if (p === '/host' || p === '/host/') return serveFile(res, path.join(PUBLIC_DIR, 'host.html'));

  let rel;
  try { rel = decodeURIComponent(p); } catch (e) { res.writeHead(400); return res.end(); }
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  serveFile(res, file);
});

// ---------- /book: Ryan's private visitor book (see visitorBook.js) ----------
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let badTries = 0;
setInterval(() => { badTries = 0; }, 10 * 60 * 1000).unref();

function bookHtml(body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Visitor book</title><style>
:root{color-scheme:light dark;--bg:#16121f;--card:#231c33;--ink:#f4efff;--dim:#b7acd0;--acc:#ffcc33}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 system-ui,sans-serif;padding:16px}
main{max-width:1000px;margin:0 auto}h1{margin:.2em 0 .6em}
form{background:var(--card);padding:16px;border-radius:12px;display:flex;flex-wrap:wrap;gap:10px;align-items:center}
input{font:inherit;padding:10px;border-radius:8px;border:1px solid #555;min-width:0;flex:1 1 200px}
button{font:inherit;font-weight:700;padding:10px 16px;border-radius:8px;border:0;background:var(--acc);color:#222;cursor:pointer}
button.alt{background:#8a7bb0;color:#fff}.msg{margin:14px 0;padding:12px;border-radius:10px;background:var(--card)}
.wrap{overflow-x:auto;margin-top:14px}table{border-collapse:collapse;width:100%;font-size:14px}
th,td{text-align:left;padding:8px;border-bottom:1px solid #3a3150;vertical-align:top}th{color:var(--dim)}
</style></head><body><main><h1>📖 Visitor book</h1>${body}</main></body></html>`;
}

function bookForm(note) {
  return (note ? `<div class="msg">${note}</div>` : '') +
    `<form method="post" action="/book"><input type="password" name="key" placeholder="Secret word" autocomplete="current-password" required>
<button name="action" value="show">Show the book</button><button class="alt" name="action" value="email">Email it to me</button></form>`;
}

function bookPage(req, res) {
  const done = (html, code) => {
    res.writeHead(code || 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    res.end(bookHtml(html));
  };
  if (!visitorBook.enabled()) {
    return done(bookForm(ONLINE
      ? 'The visitor book isn\'t switched on yet: VISITOR_BOOK_URL and VISITOR_BOOK_KEY need setting on Render (see visitor-book/SETUP.txt).'
      : 'On the laptop, every game is saved to <b>visitor-book.csv</b> in the game folder. Open it with Excel.'));
  }
  if (req.method !== 'POST') return done(bookForm(''));
  let raw = '';
  req.on('data', d => { raw += d; if (raw.length > 4096) req.destroy(); });
  req.on('end', async () => {
    const form = new URLSearchParams(raw);
    if (badTries >= 10) return done(bookForm('Too many wrong tries. Wait ten minutes and try again.'), 429);
    if (!visitorBook.keyOk(form.get('key'))) { badTries++; return done(bookForm('That secret word isn\'t right.'), 403); }
    try {
      if (form.get('action') === 'email') {
        const r = await visitorBook.email();
        return done(bookForm(`Sent! ${r.count} game${r.count === 1 ? '' : 's'} emailed to your Google address. Check your inbox (and spam, the first time).`));
      }
      const rows = await visitorBook.list();
      const cols = visitorBook.COLUMNS;
      const table = rows.length
        ? `<div class="wrap"><table><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr>` +
          rows.slice().reverse().map(r => `<tr>${cols.map((c, i) => `<td>${esc(r[i])}</td>`).join('')}</tr>`).join('') + '</table></div>'
        : '<div class="msg">No games in the book yet.</div>';
      done(bookForm(`${rows.length} game${rows.length === 1 ? '' : 's'} so far, newest first.`) + table);
    } catch (e) {
      done(bookForm('Couldn\'t reach the Google Sheet: ' + esc(e.message)), 502);
    }
  });
}

// ---------- WebSockets ----------
const wss = new WebSocketServer({ server, maxPayload: 512 * 1024 }); // doodles can be big-ish
wss.on('error', () => { /* handled on the http server */ });

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.ctx = { room: null, pid: null, host: false };
  ws.send(JSON.stringify(hub.meta()));

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    try { hub.handle(ws, m); } catch (e) { console.error('Error handling message', m.t, e); }
  });

  ws.on('close', () => {
    try { hub.onClose(ws); } catch (e) { console.error('Error on close', e); }
  });
});

// heartbeat: drop dead sockets (e.g. a phone that went to sleep)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* ignore */ }
  }
}, 15000).unref();

// tidy up empty tables made from phones
setInterval(hub.sweep, 60000).unref();

// ---------- start ----------
function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

function listen(port, triesLeft) {
  server.once('error', err => {
    if (err.code === 'EADDRINUSE' && triesLeft > 0 && !ONLINE) {
      console.log(`Port ${port} is busy, trying ${port + 1}...`);
      listen(port + 1, triesLeft - 1);
    } else {
      console.error('Could not start the server:', err.message);
      process.exit(1);
    }
  });
  server.listen(port, '0.0.0.0', () => {
    actualPort = port;
    if (ONLINE) {
      console.log(`Wild Card Showdown is running online on port ${port}` + (PUBLIC_URL ? ` (${PUBLIC_URL})` : ''));
      console.log('Open /host on the public address to get a table code and QR.');
      return;
    }
    const addrs = lanAddresses();
    const line = '='.repeat(56);
    console.log(line);
    console.log('  WILD CARD SHOWDOWN is running');
    console.log(line);
    console.log(`  Table code:   ${defaultRoom.code}`);
    console.log(`  Host screen:  http://localhost:${port}/host`);
    if (addrs.length) {
      console.log('  Phones join at:');
      for (const a of addrs) console.log(`     http://${a.ip}:${port}   (${a.name})`);
    } else {
      console.log('  No network found. Connect this laptop to Wi-Fi or a hotspot.');
    }
    console.log('');
    console.log('  Keep this window open while you play.');
    console.log('  Close it (or press Ctrl+C) to stop the game.');
    console.log(line);
    if (process.env.OPEN_BROWSER === '1') openBrowser(`http://localhost:${port}/host`);
  });
}

listen(BASE_PORT, 10);
