// node tools/replay_tagtest.mjs <logs/tagtest-....json> [--maxrms 4]
// Replays a tagtest recording (raw detected corner pixels, titan-tagtest-rec-v1) through both estimators
// (per-tag average vs joint) and prints position mean, std per axis, 3D std and max jitter for each.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'vendor', 'tags');
const PoseMath = require(path.join(dir, 'pose.js')), POS = require(path.join(dir, 'posit1.js')).POS, RP = require(path.join(dir, 'roompose.js'));

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const mi = args.indexOf('--maxrms'), maxRms = mi >= 0 ? Number(args[mi + 1]) : 4;
if (!file) { console.error('usage: node tools/replay_tagtest.mjs <logfile> [--maxrms 4]'); process.exit(1); }
let rec = JSON.parse(fs.readFileSync(file, 'utf8'));
if (rec.last_recording) rec = rec.last_recording;        // an Export JSON log also works
if (!rec.frames || !rec.K || !rec.map) { console.error('not a titan-tagtest recording (need frames, K, map)'); process.exit(1); }
const map = RP.parseMap(rec.map), K = rec.K;

const P = [], J = [], Jrms = [], weak = { n: 0 }; let frames = 0, usable = 0, dropped = 0;
for (const fr of rec.frames) {
  frames++;
  const poseObs = [], jobs = [];
  for (const [k, c] of Object.entries(fr.tags)) {
    const id = Number(k), tag = map.tags[id]; if (!tag) continue;
    const corners = c.map(p => ({ x: p[0], y: p[1] }));
    try {
      const e = RP.refinePose(corners, tag.size_m, K, PoseMath.estimate(corners, tag.size_m, K, POS.Posit));
      if (e.error > maxRms) continue;
      poseObs.push({ id, pose: e, error: e.error }); jobs.push({ id, corners, pose: e, error: e.error });
    } catch (e) { /* unusable tag */ }
  }
  const f = RP.fuse(poseObs, map); if (!f) continue;
  usable++; P.push(f.pos);
  const j = RP.solveJoint(jobs, map, K);
  if (j) { J.push(j.pos); Jrms.push(j.rmsPx); if (j.weak) weak.n++; dropped += j.droppedIds.length; }
}
const f1 = (a, d = 2) => a.map(x => x.toFixed(d)).join(' ');
function show(name, S) {
  const s = RP.stats(S); if (!s) { console.log(name.padEnd(18), 'no fixes'); return; }
  console.log(`${name.padEnd(18)} n=${s.n}  mean(m) ${f1(s.mean, 4)}  std x/y/z mm ${f1(s.std_axis_mm, 1)}  std3D ${s.std_mm.toFixed(1)} mm  max jitter ${s.max_jitter_mm.toFixed(1)} mm`);
}
console.log(`${path.basename(file)}: ${frames} frames, ${usable} usable, kind ${rec.kind || '?'}, image ${rec.image}, f=${K.fx.toFixed(0)} px`);
show('per-tag average', P);
show('joint', J);
if (Jrms.length) console.log(`joint rms ${(Jrms.reduce((a, b) => a + b, 0) / Jrms.length).toFixed(2)} px mean, weak(1-tag) frames ${weak.n}, dropped tags ${dropped}`);
