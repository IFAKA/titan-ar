// Moves a floating player head in a circle around (cx,cz) for 20 s at 10 Hz. usage: node tools/headtest.mjs [SkinName]
import net from 'node:net'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const pw = fs.readFileSync(path.join(dir, '../mcserver/rcon.password'), 'utf8').trim();
const skin = process.argv[2] || 'zFAKA';
const pkt = (id, type, body) => { const b = Buffer.from(body); const p = Buffer.alloc(14 + b.length); p.writeInt32LE(10 + b.length, 0); p.writeInt32LE(id, 4); p.writeInt32LE(type, 8); b.copy(p, 12); return p; };
const s = net.connect(25575, '127.0.0.1'); let id = 2, ready = false, buf = Buffer.alloc(0), replies = [];
const send = (c) => s.write(pkt(id++, 2, c));
s.on('data', (d) => { if (process.env.DBG) console.log('data', d.length); buf = Buffer.concat([buf, d]); while (buf.length >= 4 && buf.length >= 4 + buf.readInt32LE(0)) { const len = buf.readInt32LE(0); const type = buf.readInt32LE(8); const body = buf.toString('utf8', 12, 4 + len - 2); buf = buf.subarray(4 + len); if (!ready) { if (type === 2) { ready = true; run(); } } else if (body) replies.push(body); } });
s.write(pkt(1, 3, pw));
function run() {
  send('kill @e[type=minecraft:item_display,tag=titan]');
  send(`summon item_display 7.5 -57 14.5 {Tags:["titan"],teleport_duration:3,transformation:{left_rotation:[0f,0f,0f,1f],right_rotation:[0f,0f,0f,1f],translation:[0f,0f,0f],scale:[1.5f,1.5f,1.5f]},item:{id:"minecraft:player_head",count:1,components:{"minecraft:profile":{name:"${skin}"}}},item_display:"head"}`);
  const t0 = Date.now(); const timer = setInterval(() => {
    const t = (Date.now() - t0) / 1000; if (t > (+process.env.DUR || 20)) { clearInterval(timer); console.log('replies seen:', [...new Set(replies)].slice(0, 5)); s.end(); return; }
    const a = t * 0.8; const x = 7.5 + 5 * Math.cos(a), z = 8.5 + 5 * Math.sin(a);
    const yaw = (a * 180 / Math.PI + 90) % 360 - 180; // roughly face the direction of travel
    send(`tp @e[tag=titan,limit=1] ${x.toFixed(2)} -57 ${z.toFixed(2)} ${yaw.toFixed(1)} 0`);
  }, 100);
}
setTimeout(() => process.exit(0), 100000);
