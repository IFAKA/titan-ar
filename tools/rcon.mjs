// usage: node tools/rcon.mjs "command" ["command2" ...]   (reads mcserver/rcon.password)
import net from 'node:net'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const pw = fs.readFileSync(path.join(dir, '../mcserver/rcon.password'), 'utf8').trim();
const cmds = process.argv.slice(2);
const pkt = (id, type, body) => { const b = Buffer.from(body); const p = Buffer.alloc(14 + b.length); p.writeInt32LE(10 + b.length, 0); p.writeInt32LE(id, 4); p.writeInt32LE(type, 8); b.copy(p, 12); return p; };
const s = net.connect(25575, '127.0.0.1'); let buf = Buffer.alloc(0), i = 0, authed = false;
s.on('connect', () => s.write(pkt(1, 3, pw)));
s.on('data', (d) => { buf = Buffer.concat([buf, d]);
  while (buf.length >= 4 && buf.length >= 4 + buf.readInt32LE(0)) {
    const len = buf.readInt32LE(0), id = buf.readInt32LE(4), type = buf.readInt32LE(8), body = buf.toString('utf8', 12, 4 + len - 2); buf = buf.subarray(4 + len);
    if (!authed) { if (type !== 2) continue; if (id === -1) { console.log('AUTH FAILED'); process.exit(1); } authed = true; }
    else { console.log(`> ${cmds[i - 1]}\n${body}`); }
    if (i < cmds.length) s.write(pkt(10 + i, 2, cmds[i++])); else { s.end(); }
  } });
s.on('error', (e) => { console.log('ERR', e.message); process.exit(1); });
setTimeout(() => process.exit(0), 5000);
