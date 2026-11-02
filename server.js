// titan-ar bridge: reads Minecraft player positions over RCON (vanilla, no mods)
// and streams them to the phone over a WebSocket. Also serves the AR web page.
//
//   node server.js --mock                 fake player walking in a circle (no Minecraft needed)
//   node server.js                        real Minecraft server via RCON
//
// Env vars (real mode): RCON_HOST (127.0.0.1), RCON_PORT (25575), RCON_PASSWORD (required)
// Env var: PORT (8080) for the web page.

import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const MOCK = process.argv.includes('--mock');
const POLL_MS = 100; // 10 updates/second

// ---------- static file server ----------
// POST /api/tagtest-log : save a tag-test recording (JSON) to ./logs/tagtest-<ISO time>.json (max 20 MB)
function handleTagtestLog(req, res) {
  const MAX = 20 * 1024 * 1024, chunks = []; let size = 0, dead = false;
  const reply = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  req.on('data', (c) => {
    if (dead) return;
    size += c.length;
    if (size > MAX) { dead = true; reply(413, { ok: false, error: 'too large (max 20 MB)' }); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    if (dead) return;
    const body = Buffer.concat(chunks);
    try { JSON.parse(body.toString('utf8')); } catch { reply(400, { ok: false, error: 'body is not valid JSON' }); return; }
    const name = `tagtest-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const dir = path.join(__dirname, 'logs');
    try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), body); }
    catch (e) { reply(500, { ok: false, error: e.message }); return; }
    reply(200, { ok: true, path: 'logs/' + name });
  });
  req.on('error', () => {});
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain' };
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/tagtest-log') { handleTagtestLog(req, res); return; }
  const reqPath = decodeURIComponent(req.url.split('?')[0]);
  const urlPath = reqPath === '/' ? '/index.html' : reqPath;
  const file = path.join(__dirname, 'public', path.normalize(urlPath));
  if (!file.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------- run log (one JSON line per event; survives page reloads) ----------
const LOG_DIR = path.join(__dirname, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const logFile = path.join(LOG_DIR, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
const logStream = fs.createWriteStream(logFile);
function logEvent(obj) { logStream.write(JSON.stringify({ ts: Date.now(), ...obj }) + '\n'); }
console.log(`[log] writing ${logFile}`);

// latest pose of the phone, already converted to Minecraft coordinates by the page
let latestPose = null, lastSentPose = null;
function onClientMessage(text) {
  let m; try { m = JSON.parse(text); } catch { return; }
  if (m.type === 'pose') { latestPose = { ...m, recv: Date.now() }; logEvent({ k: 'pose', x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: m.pitch }); }
  else if (m.type === 'log') logEvent({ k: 'page', ...m });
}

// ---------- minimal WebSocket server (server -> phone only, no dependencies) ----------
const clients = new Set();
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
               `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  clients.add(socket);
  console.log(`[ws] phone connected (${clients.size} client(s))`);
  let inbuf = Buffer.alloc(0);
  socket.on('data', (d) => { // browser -> server frames are masked
    inbuf = Buffer.concat([inbuf, d]);
    while (inbuf.length >= 2) {
      const op = inbuf[0] & 0x0f, masked = inbuf[1] & 0x80; let len = inbuf[1] & 0x7f, off = 2;
      if (len === 126) { if (inbuf.length < 4) break; len = inbuf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (inbuf.length < 10) break; len = Number(inbuf.readBigUInt64BE(2)); off = 10; }
      const maskAt = off; if (masked) off += 4;
      if (inbuf.length < off + len) break;
      const payload = Buffer.from(inbuf.subarray(off, off + len));
      if (masked) for (let i = 0; i < len; i++) payload[i] ^= inbuf[maskAt + (i & 3)];
      inbuf = inbuf.subarray(off + len);
      if (op === 0x8) { socket.end(); return; }
      if (op === 0x1) onClientMessage(payload.toString('utf8'));
    }
  });
  const drop = () => clients.delete(socket);
  socket.on('close', drop); socket.on('error', drop);
});
function frame(text) {
  const payload = Buffer.from(text);
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x81, n])
    : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255])
    : (() => { const h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); return h; })();
  return Buffer.concat([head, payload]);
}
function broadcast(msg) {
  const data = frame(JSON.stringify(msg));
  for (const s of clients) if (!s.destroyed) s.write(data);
}

// ---------- RCON client (Source RCON protocol, used by vanilla Minecraft) ----------
class Rcon {
  constructor(host, port, password) {
    Object.assign(this, { host, port, password });
    this.nextId = 1; this.pending = new Map(); this.buf = Buffer.alloc(0); this.queue = Promise.resolve();
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.sock = net.connect(this.port, this.host);
      this.sock.on('data', (d) => this.#onData(d));
      this.sock.on('error', reject);
      this.sock.on('close', () => { for (const p of this.pending.values()) p.reject(new Error('RCON closed')); this.pending.clear(); });
      this.sock.on('connect', async () => {
        try {
          const id = await this.#send(3, this.password, true);
          if (id === -1) throw new Error('RCON auth failed: wrong rcon.password');
          resolve();
        } catch (e) { reject(e); }
      });
    });
  }
  #packet(id, type, body) {
    const b = Buffer.from(body, 'utf8');
    const p = Buffer.alloc(14 + b.length);
    p.writeInt32LE(10 + b.length, 0); p.writeInt32LE(id, 4); p.writeInt32LE(type, 8);
    b.copy(p, 12); // two trailing zero bytes already there
    return p;
  }
  #send(type, body, isAuth = false) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, isAuth });
      this.sock.write(this.#packet(id, type, body));
    });
  }
  #onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 4) {
      const len = this.buf.readInt32LE(0);
      if (this.buf.length < 4 + len) break;
      const id = this.buf.readInt32LE(4);
      const type = this.buf.readInt32LE(8);
      const body = this.buf.toString('utf8', 12, 4 + len - 2);
      this.buf = this.buf.subarray(4 + len);
      if (id === -1) { // auth failure
        const p = [...this.pending.values()].find((x) => x.isAuth);
        if (p) { p.resolve(-1); this.pending.clear(); }
        continue;
      }
      const p = this.pending.get(id);
      if (!p) continue;
      if (p.isAuth && type !== 2) continue; // skip the empty response sent before auth reply
      this.pending.delete(id);
      p.resolve(p.isAuth ? id : body);
    }
  }
  // Serialize commands so responses never interleave.
  command(cmd) {
    const run = this.queue.then(() => this.#send(2, cmd));
    this.queue = run.catch(() => {});
    return run;
  }
}

// ---------- parsers for vanilla command output ----------
export function parseList(text) {
  // "There are 2 of a max of 20 players online: Steve, Alex"
  const i = text.indexOf(':');
  if (i === -1) return [];
  return text.slice(i + 1).split(',').map((s) => s.trim()).filter(Boolean);
}
export function parseNumbers(text) {
  // "Steve has the following entity data: [12.5d, 64.0d, -3.2d]"
  const m = text.match(/\[([^\]]*)\]/);
  if (!m) return null;
  const nums = m[1].split(',').map((s) => parseFloat(s));
  return nums.every(Number.isFinite) ? nums : null;
}

async function pollReal() {
  const host = process.env.RCON_HOST || '127.0.0.1';
  const port = Number(process.env.RCON_PORT || 25575);
  let password = process.env.RCON_PASSWORD;
  if (!password) { try { password = fs.readFileSync(path.join(__dirname, 'mcserver', 'rcon.password'), 'utf8').trim(); } catch {} }
  if (!password) { console.error('Set RCON_PASSWORD (same as rcon.password in server.properties)'); process.exit(1); }

  for (;;) {
    let rcon;
    try {
      rcon = new Rcon(host, port, password);
      await rcon.connect();
      console.log(`[rcon] connected to Minecraft at ${host}:${port}`);
      const skin = process.env.TITAN_SKIN || 'zFAKA';
      await rcon.command('kill @e[type=minecraft:item_display,tag=titan]');
      await rcon.command(`summon item_display 0 -50 0 {Tags:["titan"],teleport_duration:3,transformation:{left_rotation:[0f,0f,0f,1f],right_rotation:[0f,0f,0f,1f],translation:[0f,0f,0f],scale:[1.2f,1.2f,1.2f]},item:{id:"minecraft:player_head",count:1,components:{"minecraft:profile":{name:"${skin}"}}},item_display:"head"}`);
      console.log(`[titan] head summoned with skin ${skin}`);
      let tpBusy = false;
      const tpTimer = setInterval(async () => {
        if (tpBusy || !latestPose || latestPose === lastSentPose || Date.now() - latestPose.recv > 2000) return;
        tpBusy = true; const p = lastSentPose = latestPose;
        try { await rcon.command(`tp @e[tag=titan,limit=1] ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)} ${p.yaw.toFixed(1)} ${p.pitch.toFixed(1)}`); } catch {}
        tpBusy = false;
      }, 100);
      rcon.sock.on('close', () => clearInterval(tpTimer));
      for (;;) {
        const t0 = Date.now();
        const names = parseList(await rcon.command('list'));
        const players = [];
        for (const name of names) {
          const pos = parseNumbers(await rcon.command(`data get entity ${name} Pos`));
          const rot = parseNumbers(await rcon.command(`data get entity ${name} Rotation`));
          if (pos) players.push({ name, x: pos[0], y: pos[1], z: pos[2], yaw: rot ? rot[0] : 0 });
        }
        broadcast({ type: 'players', players, t: Date.now() });
        await new Promise((r) => setTimeout(r, Math.max(0, POLL_MS - (Date.now() - t0))));
      }
    } catch (e) {
      console.error(`[rcon] ${e.message}. Retrying in 3 s (is the Minecraft server running with enable-rcon=true?)`);
      try { rcon?.sock?.destroy(); } catch {}
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

function pollMock() {
  // A fake player walking a 4-block circle around Minecraft (0, 64, 0).
  console.log('[mock] fake player "MockSteve" circling around Minecraft XYZ (0, 64, 0)');
  setInterval(() => {
    const a = (Date.now() / 4000) % (Math.PI * 2);
    const x = 8 + Math.cos(a) * 2, z = 8 + Math.sin(a) * 2;
    // yaw: 0 = facing +z (south), 90 = facing -x (west). Face along the walking direction.
    const dx = -Math.sin(a), dz = Math.cos(a);
    const yaw = (Math.atan2(-dx, dz) * 180) / Math.PI;
    broadcast({ type: 'players', players: [{ name: 'MockSteve', x, y: -60, z, yaw }], t: Date.now() });
  }, POLL_MS);
}

server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`\nAR page:  open on your phone ->  ${ips.map((ip) => `http://${ip}:${PORT}`).join('  or  ') || `http://<your-mac-ip>:${PORT}`}`);
  console.log('(Your phone and Mac must be on the same Wi-Fi.)\n');
  if (MOCK) pollMock(); else pollReal();
});
