// node tools/test_roompose.mjs
// 1) fusion maths with exact synthetic poses (position error must be < 1 mm)
// 2) full chain: render perspective views of real ARUCO_MIP_36h12 markers, run the real js-aruco2 detector,
//    PoseMath.estimate, RoomPose.fuse; two tags must agree with each other and with the truth.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'vendor', 'tags');
const PoseMath = require(path.join(dir, 'pose.js'));
const POS = require(path.join(dir, 'posit1.js')).POS;
const AR = require(path.join(dir, 'aruco.js')).AR;
const RP = require(path.join(dir, 'roompose.js'));

const T = R => [0, 1, 2].map(i => [R[0][i], R[1][i], R[2][i]]);
const mul = (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const mulv = (A, v) => A.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const Rx = a => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const Ry = a => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
const d2r = Math.PI / 180;
const camR = (yaw, pitch, roll = 0) => mul(mul(Ry(yaw * d2r), Rx(pitch * d2r)), [[1, 0, 0], [0, -1, 0], [0, 0, -1]]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const map = RP.parseMap({ size_mm: 100, tags: {
  0: { pos: [0, 0, 0] }, 1: { pos: [0.3, 0.02, 0], yaw_deg: 0 }, 2: { pos: [0.1, -0.3, 0.05], size_mm: 80 } } });

// pose of a tag in camera frame given a world camera pose (truth)
function truePose(R_wc, c, tag) {
  const R_ct = mul(T(R_wc), tag.R_wt);
  return { R: R_ct, t: mulv(T(R_wc), [tag.pos[0] - c[0], tag.pos[1] - c[1], tag.pos[2] - c[2]]) };
}
const est = (corners, size) => RP.refinePose(corners, size, K, PoseMath.estimate(corners, size, K, POS.Posit));
const K = { fx: 900, fy: 900, cx: 640, cy: 360 };
const views = [
  { c: [0.15, 0.05, 0.7], yaw: 5, pitch: -3 },
  { c: [-0.1, 0.2, 0.9], yaw: -12, pitch: 8 },
  { c: [0.4, -0.1, 0.6], yaw: 20, pitch: 0 },
];

// ---- 1) exact projection -> estimate -> fuse
for (const v of views) {
  const R_wc = camR(v.yaw, v.pitch);
  const obs = [0, 1, 2].map(id => {
    const tag = map.tags[id], pose = truePose(R_wc, v.c, tag);
    const corners = PoseMath.model(tag.size_m).map(p => PoseMath.project(p, pose, K));
    const e1 = est(corners, tag.size_m);
    return { id, pose: e1, error: e1.error };
  });
  for (const o of obs) { // single tag
    const f = RP.fuse([o], map);
    assert.ok(dist(f.pos, v.c) < 0.001, `single tag ${o.id} err ${dist(f.pos, v.c) * 1000} mm`);
  }
  const f = RP.fuse(obs, map);
  const e = dist(f.pos, v.c) * 1000;
  assert.ok(e < 1, `fused position error ${e} mm`);
  assert.ok(Math.abs(RP.angDiff(f.yaw, v.yaw)) < 0.1 && Math.abs(f.pitch - v.pitch) < 0.1 && Math.abs(f.roll) < 0.1, `euler ${f.yaw} ${f.pitch} ${f.roll}`);
  assert.equal(f.n, 3);
  console.log(`PASS exact  view yaw ${v.yaw}: fused err ${e.toFixed(4)} mm, yaw/pitch/roll ${f.yaw.toFixed(2)} ${f.pitch.toFixed(2)} ${f.roll.toFixed(2)}`);
}
// unknown id ignored, nothing visible -> null
assert.equal(RP.fuse([{ id: 99, pose: { R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [0, 0, 1] }, error: 0 }], map), null);
// quaternion round trip + average of identical rotations
const Rr = camR(33, -20); const Rb = RP.quatToRot(RP.rotToQuat(Rr));
Rr.flat().forEach((x, i) => assert.ok(Math.abs(x - Rb.flat()[i]) < 1e-9));
// tag orientation convention: tag on floor (pitch -90) is seen from above by a camera looking down
{
  const m2 = RP.parseMap({ tags: { 5: { pos: [0, 0, 0], pitch_deg: -90 } } });
  const R_wc = mul(Rx(-90 * d2r), [[1, 0, 0], [0, -1, 0], [0, 0, -1]]); // looking straight down
  const c = [0.1, 0.8, 0.2], pose = truePose(R_wc, c, m2.tags[5]);
  assert.ok(pose.t[2] > 0 && Math.abs(pose.t[2] - 0.8) < 1e-9, 'floor tag must be in front of a downward camera: ' + pose.t);
  const f = RP.fuse([{ id: 5, pose, error: 0 }], m2);
  assert.ok(dist(f.pos, c) < 1e-9 && Math.abs(f.pitch + 90) < 1e-6);
  console.log('PASS floor-tag convention');
}
// stats
{ const s = RP.stats([[0, 0, 0], [0.002, 0, 0], [-0.002, 0, 0], [0, 0, 0]]); assert.ok(Math.abs(s.max_jitter_mm - 2) < 1e-9 && s.std_mm > 1 && s.std_mm < 2); console.log('PASS stats'); }
// bad maps
assert.throws(() => RP.parseMap('{"tags":{"0":{"pos":[0,0]}}}'));
assert.throws(() => RP.parseMap('{}'));

// ---- 2) raster render -> real detector
const dic = new AR.Dictionary('ARUCO_MIP_36h12');
const detector = new AR.Detector({ dictionaryName: 'ARUCO_MIP_36h12', maxHammingDistance: 2 });
function grid(id) { // 10x10 cell grid (1 = white) from the generated SVG
  const g = Array.from({ length: 10 }, () => Array(10).fill(0));
  for (const m of dic.generateSVG(id).matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="(white|black)"/g)) {
    const [, x, y, w, h, col] = m;
    for (let j = +y; j < +y + +h; j++) for (let i = +x; i < +x + +w; i++) g[j][i] = col === 'white' ? 1 : 0;
  }
  return g;
}
function render(R_wc, c, ids, W = 1280, H = 720) {
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  const items = ids.map(id => { const tag = map.tags[id], p = truePose(R_wc, c, tag); const Rt = T(p.R);
    return { g: grid(id), cell: tag.size_m / 8, Rt, o: mulv(Rt, p.t.map(v => -v)) }; });
  for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) {
    let acc = 0;
    for (const [du, dv] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      let val = 255;
      const d = [(u + du - 0.5 - K.cx) / K.fx, (v + dv - 0.5 - K.cy) / K.fy, 1]; // pixel index = pixel centre
      for (const it of items) {
        const dt = mulv(it.Rt, d); if (Math.abs(dt[2]) < 1e-9) continue;
        const s = -it.o[2] / dt[2]; if (s <= 0) continue;
        const gx = Math.floor((it.o[0] + s * dt[0]) / it.cell + 5), gy = Math.floor((it.o[1] + s * dt[1]) / it.cell + 5);
        if (gx >= 0 && gx < 10 && gy >= 0 && gy < 10) { val = it.g[gy][gx] ? 255 : 0; break; }
      }
      acc += val;
    }
    const o = (v * W + u) * 4; data[o] = data[o + 1] = data[o + 2] = acc / 4;
  }
  return { width: W, height: H, data };
}
const rasterViews = [views[0], { c: [0.12, 0.03, 0.55], yaw: -8, pitch: 2 }];
for (const v of rasterViews) {
  const R_wc = camR(v.yaw, v.pitch);
  const img = render(R_wc, v.c, [0, 1]);
  const found = detector.detect(img);
  assert.deepEqual([...new Set(found.map(m => m.id))].sort(), [0, 1], 'detector must see both tags, got ' + found.map(m => m.id));
  const obs = found.map(m => { const e = est(m.corners, map.tags[m.id].size_m); return { id: m.id, pose: e, error: e.error }; });
  const fused = RP.fuse(obs, map);
  const per = fused.perTag.map(p => dist(p.pos, v.c) * 1000);
  const err = dist(fused.pos, v.c) * 1000;
  const mutual = dist(fused.perTag[0].pos, fused.perTag[1].pos) * 1000;
  console.log(`raster view yaw ${v.yaw}: per-tag err ${per.map(x => x.toFixed(1))} mm, fused err ${err.toFixed(1)} mm, tag-vs-tag ${mutual.toFixed(1)} mm`);
  assert.ok(err < 40, 'raster fused error too big: ' + err);
  assert.ok(mutual < 60, 'two tags disagree: ' + mutual);
  assert.ok(Math.abs(RP.angDiff(fused.yaw, v.yaw)) < 2 && Math.abs(fused.pitch - v.pitch) < 2);
}

// ---- 3) joint solve vs per-tag average, static synthetic camera + Gaussian corner noise (seeded)
{
  function rng(seed) { let a = seed >>> 0; const u = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    return () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u()); }
  const angleOf = (A, B) => { const M = mul(T(A), B); return Math.acos(Math.max(-1, Math.min(1, (M[0][0] + M[1][1] + M[2][2] - 1) / 2))) / d2r; };
  const phoneK = { fx: 1076, fy: 1076, cx: 360, cy: 640 }, wideK = { fx: 500, fy: 500, cx: 640, cy: 360 };
  const small = { size_mm: 62, tags: { 0: { pos: [0, 0, 0] }, 1: { pos: [0.1445, 0, 0] }, 2: { pos: [0, -0.089, 0] }, 3: { pos: [0.1445, -0.089, 0] } } };
  const big = { size_mm: 150, tags: { 0: { pos: [0, 0, 0] }, 1: { pos: [2, 0, 0] }, 2: { pos: [0, -1.5, 0] }, 3: { pos: [2, -1.5, 0] } } };
  const cases = [
    { name: '62mm  @1.0m', m: small, K: phoneK, d: 1.0, cen: [0.0722, -0.0445] },
    { name: '62mm  @2.0m', m: small, K: phoneK, d: 2.0, cen: [0.0722, -0.0445] },
    { name: '150mm @1.0m (2x1.5m spread)', m: big, K: wideK, d: 1.0, cen: [1, -0.75] },
    { name: '150mm @2.0m (2x1.5m spread)', m: big, K: wideK, d: 2.0, cen: [1, -0.75] },
  ];
  const res = {};
  for (const cs of cases) {
    const mp = RP.parseMap(cs.m), Kc = cs.K, N = 300, noise = rng(12345);
    const c = [cs.cen[0] + 0.03, cs.cen[1] + 0.02, cs.d], R_wc = camR(4, -3);
    // clean corners, checked inside the image
    const clean = Object.keys(mp.tags).map(Number).map(id => { const tag = mp.tags[id], pose = truePose(R_wc, c, tag);
      return { id, tag, pose, corners: PoseMath.model(tag.size_m).map(p => PoseMath.project(p, pose, Kc)) }; });
    const P = [], J = []; let flips = 0, jOut = 0, tagFrames = 0;
    for (let f = 0; f < N; f++) {
      const obsList = [], poseObs = [];
      for (const o of clean) {
        const corners = o.corners.map(p => ({ x: p.x + 0.7 * noise(), y: p.y + 0.7 * noise() }));
        const e = RP.refinePose(corners, o.tag.size_m, Kc, PoseMath.estimate(corners, o.tag.size_m, Kc, POS.Posit));
        tagFrames++; if (angleOf(e.R, o.pose.R) > 10) flips++;
        poseObs.push({ id: o.id, pose: e, error: e.error }); obsList.push({ id: o.id, corners, pose: e, error: e.error });
      }
      P.push(RP.fuse(poseObs, mp).pos);
      const j = RP.solveJoint(obsList, mp, Kc); J.push(j.pos);
      if (dist(j.pos, c) > 0.05) jOut++;
    }
    const sp = RP.stats(P), sj = RP.stats(J);
    const bias = s => dist(s.mean, c) * 1000;
    res[cs.name] = { sp, sj };
    console.log(`${cs.name}: per-tag-avg std ${sp.std_mm.toFixed(2)} mm (x ${sp.std_axis_mm.map(x => x.toFixed(1))}) max ${sp.max_jitter_mm.toFixed(1)} bias ${bias(sp).toFixed(1)} | joint std ${sj.std_mm.toFixed(2)} mm (x ${sj.std_axis_mm.map(x => x.toFixed(1))}) max ${sj.max_jitter_mm.toFixed(1)} bias ${bias(sj).toFixed(1)} | per-tag flips ${flips}/${tagFrames}, joint outlier frames ${jOut}/${N}`);
  }
  assert.ok(res['62mm  @1.0m'].sj.std_mm < res['62mm  @1.0m'].sp.std_mm, 'joint must beat per-tag average in 62mm @1m');
  // single visible tag still works (weak), noise-free
  const mp = RP.parseMap(small), tag = mp.tags[0], pose = truePose(camR(4, -3), [0.03, 0.02, 1], tag);
  const corners = PoseMath.model(tag.size_m).map(p => PoseMath.project(p, pose, phoneK));
  const e = RP.refinePose(corners, tag.size_m, phoneK, PoseMath.estimate(corners, tag.size_m, phoneK, POS.Posit));
  const one = RP.solveJoint([{ id: 0, corners, pose: e }], mp, phoneK);
  assert.ok(one.weak && one.nTags === 1 && one.nCorners === 4 && dist(one.pos, [0.03, 0.02, 1]) < 0.001, 'single tag joint');
  assert.equal(RP.solveJoint([{ id: 77, corners, pose: e }], mp, phoneK), null);
  console.log('PASS joint');
}
console.log('ALL PASS');
