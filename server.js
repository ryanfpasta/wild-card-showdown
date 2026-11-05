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
  if (p === '/' || p === '/index.html') return serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
  if (p === '/host' || p === '/host/') return serveFile(res, path.join(PUBLIC_DIR, 'host.html'));

  let rel;
  try { rel = decodeURIComponent(p); } catch (e) { res.writeHead(400); return res.end(); }
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  serveFile(res, file);
});

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
