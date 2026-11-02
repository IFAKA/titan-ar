/* roompose.js - tag map -> camera pose in WORLD coordinates. Pure functions, UMD (node + browser).

   WORLD frame: X right, Y up, Z toward the viewer (right-handed). Metres.
   TAG frame (PoseMath / marker-pose): origin at tag centre, x right, y down, z into the tag face.
   CAMERA frame (PoseMath): x right, y down, z forward.

   Tag map entry: {"pos":[x,y,z], "yaw_deg":0, "pitch_deg":0, "roll_deg":0, "size_mm":120}
     Default orientation: tag stands vertical (on a wall / screen) and its face points to +Z,
     so its right edge is world +X and its top edge is world +Y.
     yaw_deg   turns the facing direction about world Y (right-hand rule; +90 = face points to +X).
     pitch_deg turns about world X (-90 = tag lying flat on the floor, face up).
     roll_deg  spins the tag in its own plane (right-hand rule about its facing normal).
     Applied in the order yaw, pitch, roll.
   Map: {"size_mm":120, "tags":{"0":{...},"1":{...}}}  size_mm is the default black-square edge.

   Camera yaw/pitch/roll reported: yaw 0 = looking toward -Z (at a tag wall), + = turning left (CCW from above);
   pitch + = looking up; roll + = right side of the phone down. */
(function (root) {
  "use strict";
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const T = R => [0, 1, 2].map(i => [R[0][i], R[1][i], R[2][i]]);
  const mul = (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
  const mulv = (A, v) => A.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  const Rx = a => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
  const Ry = a => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
  const Rz = a => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
  const UPRIGHT = [[1, 0, 0], [0, -1, 0], [0, 0, -1]]; // tag frame -> world for a vertical tag facing +Z

  function tagRotation(spec) {
    const y = (spec.yaw_deg || 0) * D2R, p = (spec.pitch_deg || 0) * D2R, r = (spec.roll_deg || 0) * D2R;
    // roll acts in the tag plane: about the facing normal (world Z before yaw/pitch), applied to the upright tag
    return mul(mul(Ry(y), Rx(p)), mul(Rz(r), UPRIGHT));
  }

  function parseMap(input) {
    const m = typeof input === "string" ? JSON.parse(input) : input;
    if (!m || typeof m !== "object" || !m.tags || typeof m.tags !== "object") throw new Error('map needs a "tags" object');
    const defSize = m.size_mm === undefined ? 120 : Number(m.size_mm);
    if (!(defSize > 0)) throw new Error("size_mm must be > 0");
    const tags = {};
    for (const [k, v] of Object.entries(m.tags)) {
      const id = Number(k);
      if (!Number.isInteger(id) || id < 0) throw new Error("bad tag id " + k);
      if (!Array.isArray(v.pos) || v.pos.length !== 3 || !v.pos.every(Number.isFinite)) throw new Error("tag " + k + ": pos must be [x,y,z] in metres");
      const size_mm = v.size_mm === undefined ? defSize : Number(v.size_mm);
      if (!(size_mm > 0)) throw new Error("tag " + k + ": size_mm must be > 0");
      tags[id] = { id, pos: v.pos.slice(), R_wt: tagRotation(v), size_m: size_mm / 1000 };
    }
    return { size_m: defSize / 1000, tags };
  }

  // PoseMath pose {R,t} (p_cam = R p_tag + t) + tag placement -> camera pose in world.
  function cameraFromTag(pose, tag) {
    const R_wc = mul(tag.R_wt, T(pose.R));              // camera -> world
    const o = mulv(R_wc, pose.t);                       // = R_wt R^T t
    return { R_wc, pos: [tag.pos[0] - o[0], tag.pos[1] - o[1], tag.pos[2] - o[2]] };
  }

  function rotToQuat(R) { // [w,x,y,z]
    const tr = R[0][0] + R[1][1] + R[2][2];
    let w, x, y, z;
    if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = s / 4; x = (R[2][1] - R[1][2]) / s; y = (R[0][2] - R[2][0]) / s; z = (R[1][0] - R[0][1]) / s; }
    else if (R[0][0] > R[1][1] && R[0][0] > R[2][2]) { const s = Math.sqrt(1 + R[0][0] - R[1][1] - R[2][2]) * 2; w = (R[2][1] - R[1][2]) / s; x = s / 4; y = (R[0][1] + R[1][0]) / s; z = (R[0][2] + R[2][0]) / s; }
    else if (R[1][1] > R[2][2]) { const s = Math.sqrt(1 + R[1][1] - R[0][0] - R[2][2]) * 2; w = (R[0][2] - R[2][0]) / s; x = (R[0][1] + R[1][0]) / s; y = s / 4; z = (R[1][2] + R[2][1]) / s; }
    else { const s = Math.sqrt(1 + R[2][2] - R[0][0] - R[1][1]) * 2; w = (R[1][0] - R[0][1]) / s; x = (R[0][2] + R[2][0]) / s; y = (R[1][2] + R[2][1]) / s; z = s / 4; }
    const n = Math.hypot(w, x, y, z); return [w / n, x / n, y / n, z / n];
  }
  function quatToRot(q) {
    const [w, x, y, z] = q;
    return [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]];
  }
  // Weighted quaternion average (Markley): dominant eigenvector of sum w q q^T, by power iteration.
  function averageQuats(qs, ws) {
    let best = 0; for (let i = 1; i < qs.length; i++) if (ws[i] > ws[best]) best = i;
    const ref = qs[best];
    const aligned = qs.map(q => (q[0] * ref[0] + q[1] * ref[1] + q[2] * ref[2] + q[3] * ref[3]) < 0 ? q.map(v => -v) : q);
    const M = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
    aligned.forEach((q, k) => { for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) M[i][j] += ws[k] * q[i] * q[j]; });
    let v = ref.slice();
    for (let it = 0; it < 50; it++) {
      const nv = M.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2] + r[3] * v[3]);
      const n = Math.hypot(...nv); v = nv.map(a => a / n);
    }
    return v;
  }

  function eulerWorld(R_wc) { // camera orientation -> yaw/pitch/roll in degrees (see header)
    const f = [R_wc[0][2], R_wc[1][2], R_wc[2][2]];
    const r = [R_wc[0][0], R_wc[1][0], R_wc[2][0]];
    const u = [-R_wc[0][1], -R_wc[1][1], -R_wc[2][1]];
    return {
      yaw: Math.atan2(-f[0], -f[2]) * R2D,
      pitch: Math.asin(Math.max(-1, Math.min(1, f[1]))) * R2D,
      roll: Math.atan2(-r[1], u[1]) * R2D,
    };
  }
  const angDiff = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };

  // obs: [{id, pose:{R,t}, error}] (pose already estimated with that tag's size). Unknown ids are ignored.
  function fuse(obs, map) {
    const used = [], seen = new Map();
    for (const o of obs) { // the detector can report one tag twice: keep the lowest-error one
      const prev = seen.get(o.id); if (prev && prev.error <= o.error) continue; seen.set(o.id, o);
    }
    for (const o of seen.values()) {
      const tag = map.tags[o.id]; if (!tag) continue;
      const cam = cameraFromTag(o.pose, tag);
      const dist = Math.hypot(...o.pose.t);
      used.push({ id: o.id, dist, error: o.error, weight: 1 / (dist * dist), pos: cam.pos, R_wc: cam.R_wc, q: rotToQuat(cam.R_wc) });
    }
    if (!used.length) return null;
    const W = used.reduce((s, u) => s + u.weight, 0);
    const pos = [0, 1, 2].map(i => used.reduce((s, u) => s + u.weight * u.pos[i], 0) / W);
    const q = averageQuats(used.map(u => u.q), used.map(u => u.weight));
    const R_wc = quatToRot(q);
    const perTag = used.map(u => ({ id: u.id, dist: u.dist, error: u.error, weight: u.weight / W, pos: u.pos,
      dev_mm: Math.hypot(u.pos[0] - pos[0], u.pos[1] - pos[1], u.pos[2] - pos[2]) * 1000 }));
    return { pos, q, R_wc, ...eulerWorld(R_wc), perTag, n: used.length };
  }

  // samples: [[x,y,z] metres] -> mean, per-axis std and 3D std (mm), max jitter = max distance from mean (mm)
  function stats(samples) {
    const n = samples.length; if (!n) return null;
    const mean = [0, 1, 2].map(i => samples.reduce((s, p) => s + p[i], 0) / n);
    const varr = [0, 1, 2].map(i => samples.reduce((s, p) => s + (p[i] - mean[i]) ** 2, 0) / n);
    const dists = samples.map(p => Math.hypot(p[0] - mean[0], p[1] - mean[1], p[2] - mean[2]));
    return { n, mean, std_axis_mm: varr.map(v => Math.sqrt(v) * 1000), std_mm: Math.sqrt(varr[0] + varr[1] + varr[2]) * 1000, max_jitter_mm: Math.max(...dists) * 1000 };
  }

  // ---- Gauss-Newton / Levenberg-Marquardt polish of a PoseMath pose on the 4 corner reprojection error.
  // POSIT alone leaves 0.1-3 px of error (mm-cm of position); this brings the noise-free error to ~0.
  // corners: [{x,y}] in the order of PoseMath.model (TL,TR,BR,BL); pinhole K {fx,fy,cx,cy} (no distortion).
  function rodrigues(w) {
    const th = Math.hypot(w[0], w[1], w[2]); if (th < 1e-14) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const [x, y, z] = w.map(a => a / th), c = Math.cos(th), s = Math.sin(th), C = 1 - c;
    return [[c + x * x * C, x * y * C - z * s, x * z * C + y * s], [y * x * C + z * s, c + y * y * C, y * z * C - x * s], [z * x * C - y * s, z * y * C + x * s, c + z * z * C]];
  }
  function lmPose(corners, size, K, pose) {
    const h = size / 2, M = [[-h, -h, 0], [h, -h, 0], [h, h, 0], [-h, h, 0]];
    const resid = (R, t) => {
      const r = [];
      for (let i = 0; i < 4; i++) {
        const q = mulv(R, M[i]); q[0] += t[0]; q[1] += t[1]; q[2] += t[2];
        if (q[2] <= 1e-6) return null;
        r.push(K.fx * q[0] / q[2] + K.cx - corners[i].x, K.fy * q[1] / q[2] + K.cy - corners[i].y);
      }
      return r;
    };
    const cost = r => r.reduce((s, v) => s + v * v, 0);
    let R = pose.R, t = pose.t.slice(), r = resid(R, t); if (!r) return pose;
    let c = cost(r), lambda = 1e-3;
    for (let it = 0; it < 30; it++) {
      const J = []; // 8x6, numeric
      for (let k = 0; k < 6; k++) {
        const e = 1e-6, w = [0, 0, 0], t2 = t.slice(); if (k < 3) w[k] = e; else t2[k - 3] += e;
        const r2 = resid(mul(rodrigues(w), R), t2); if (!r2) return pose;
        J.push(r2.map((v, i) => (v - r[i]) / e));
      }
      const A = [0, 1, 2, 3, 4, 5].map(i => [0, 1, 2, 3, 4, 5].map(j => J[i].reduce((s, v, n) => s + v * J[j][n], 0)));
      const g = J.map(col => col.reduce((s, v, n) => s + v * r[n], 0));
      let improved = false;
      for (let tries = 0; tries < 8 && !improved; tries++) {
        const Aug = A.map((row, i) => [...row.map((v, j) => v + (i === j ? lambda * (A[i][i] + 1e-9) : 0)), -g[i]]);
        const dx = solve6(Aug); if (!dx) { lambda *= 10; continue; }
        const R2 = mul(rodrigues(dx.slice(0, 3)), R), t2 = [t[0] + dx[3], t[1] + dx[4], t[2] + dx[5]];
        const r2 = resid(R2, t2);
        if (r2 && cost(r2) < c) { const dc = c - cost(r2); R = R2; t = t2; r = r2; c = cost(r2); lambda = Math.max(lambda / 10, 1e-9); improved = true; if (dc < 1e-14) it = 99; }
        else lambda *= 10;
      }
      if (!improved) break;
    }
    return { R, t, error: Math.sqrt(c / 4), alternativeError: pose.alternativeError === undefined ? null : pose.alternativeError };
  }
  // Planar pose has two look-alike solutions (flip ambiguity); POSIT may hand us the wrong branch, so also start
  // from rotated copies and keep the lowest reprojection error.
  function refinePose(corners, size, K, pose) {
    let best = lmPose(corners, size, K, pose);
    if (best.error > 0.05) {
      for (const [ax, deg] of [[0, 35], [0, -35], [1, 35], [1, -35], [0, 70], [0, -70], [1, 70], [1, -70]]) {
        const a = deg * D2R, Rd = ax === 0 ? Rx(a) : Ry(a);
        const cand = lmPose(corners, size, K, { R: mul(pose.R, Rd), t: pose.t, alternativeError: pose.alternativeError });
        if (cand.error < best.error - 1e-9) best = cand;
      }
    }
    return best;
  }
  function solve6(M) { // Gaussian elimination on 6x7 augmented matrix
    const n = 6; M = M.map(r => r.slice());
    for (let i = 0; i < n; i++) {
      let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
      if (Math.abs(M[p][i]) < 1e-18) return null; [M[i], M[p]] = [M[p], M[i]];
      for (let k = i + 1; k < n; k++) { const f = M[k][i] / M[i][i]; for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j]; }
    }
    const x = Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
    return x;
  }

  // ---- JOINT solve: ONE camera pose (6 DOF) from the corners of ALL visible tags together.
  // Per-tag poses are noisy along the tag's tilt-ambiguous direction and averaging them turns that into lateral error;
  // here every corner (4 per tag, world positions from the map incl. tag yaw/pitch/roll/size) votes in one fit.
  // observations: [{id, corners:[{x,y}x4] (order TL,TR,BR,BL as the detector gives), pose?:{R,t} (per-tag PoseMath pose, used as an init)}]
  // K: {fx,fy,cx,cy}. opts: {huber:px (default 2), dropFactor (default 3), dropMinPx (default 2.5)}
  // Returns {pos, R_wc, q, yaw, pitch, roll, rmsPx, nTags, nCorners, weak, ids, droppedIds, perTagRms} or null.
  function worldCorners(tag) {
    const h = tag.size_m / 2, M = [[-h, -h, 0], [h, -h, 0], [h, h, 0], [-h, h, 0]];
    return M.map(m => { const w = mulv(tag.R_wt, m); return [tag.pos[0] + w[0], tag.pos[1] + w[1], tag.pos[2] + w[2]]; });
  }
  function huberCost(r, delta) { // r: flat [u,v,u,v...] residuals -> {cost, w[]} per corner
    let cost = 0; const w = [];
    for (let i = 0; i < r.length; i += 2) {
      const n = Math.hypot(r[i], r[i + 1]);
      if (n <= delta) { cost += 0.5 * n * n; w.push(1); } else { cost += delta * (n - 0.5 * delta); w.push(delta / n); }
    }
    return { cost, w };
  }
  function jointLM(pts, px, K, R_cw, c, delta, maxIt) {
    const resid = (Rc, cc) => {
      const r = [];
      for (let i = 0; i < pts.length; i++) {
        const P = pts[i], q = mulv(Rc, [P[0] - cc[0], P[1] - cc[1], P[2] - cc[2]]);
        if (q[2] <= 1e-6) return null;
        r.push(K.fx * q[0] / q[2] + K.cx - px[i].x, K.fy * q[1] / q[2] + K.cy - px[i].y);
      }
      return r;
    };
    let r = resid(R_cw, c); if (!r) return null;
    let hc = huberCost(r, delta), lambda = 1e-3;
    for (let it = 0; it < (maxIt || 40); it++) {
      const J = [];
      for (let k = 0; k < 6; k++) {
        const e = 1e-6, w = [0, 0, 0], c2 = c.slice(); if (k < 3) w[k] = e; else c2[k - 3] += e;
        const r2 = resid(k < 3 ? mul(rodrigues(w), R_cw) : R_cw, c2); if (!r2) return null;
        J.push(r2.map((v, i) => (v - r[i]) / e));
      }
      const wt = i => hc.w[i >> 1];
      const A = [0, 1, 2, 3, 4, 5].map(i => [0, 1, 2, 3, 4, 5].map(j => J[i].reduce((s, v, n) => s + wt(n) * v * J[j][n], 0)));
      const g = J.map(col => col.reduce((s, v, n) => s + wt(n) * v * r[n], 0));
      let improved = false, step = 0;
      for (let tries = 0; tries < 10 && !improved; tries++) {
        const Aug = A.map((row, i) => [...row.map((v, j) => v + (i === j ? lambda * (A[i][i] + 1e-9) : 0)), -g[i]]);
        const dx = solve6(Aug); if (!dx) { lambda *= 10; continue; }
        const R2 = mul(rodrigues(dx.slice(0, 3)), R_cw), c2 = [c[0] + dx[3], c[1] + dx[4], c[2] + dx[5]];
        const r2 = resid(R2, c2), h2 = r2 && huberCost(r2, delta);
        if (r2 && h2.cost < hc.cost) { step = hc.cost - h2.cost; R_cw = R2; c = c2; r = r2; hc = h2; lambda = Math.max(lambda / 10, 1e-9); improved = true; }
        else lambda *= 10;
      }
      if (!improved || step < 1e-12) break;
    }
    return { R_cw, c, r, cost: hc.cost };
  }
  function solveJoint(observations, map, K, opts) {
    opts = opts || {};
    const delta = opts.huber || 2, dropFactor = opts.dropFactor || 3, dropMin = opts.dropMinPx || 2.5;
    const seen = new Map();
    for (const o of observations) { // one observation per id: keep the lowest-error one if given
      if (!map.tags[o.id] || !o.corners || o.corners.length !== 4) continue;
      const prev = seen.get(o.id); if (prev && (prev.error === undefined || o.error === undefined || prev.error <= o.error)) continue; seen.set(o.id, o);
    }
    let obs = [...seen.values()];
    if (!obs.length) return null;
    const build = list => {
      const pts = [], px = [], owner = [];
      for (const o of list) { const wc = worldCorners(map.tags[o.id]); for (let i = 0; i < 4; i++) { pts.push(wc[i]); px.push(o.corners[i]); owner.push(o.id); } }
      return { pts, px, owner };
    };
    // init candidates (R_cw, c)
    const inits = (list, pts, px) => {
      const out = [];
      const add = (R_wc, pos) => out.push([T(R_wc), pos.slice()]);
      let fx = null;
      const withPose = list.filter(o => o.pose);
      if (withPose.length) {
        try { fx = fuse(withPose.map(o => ({ id: o.id, pose: o.pose, error: o.error || 0 })), map); } catch (e) { fx = null; }
        if (fx) add(fx.R_wc, fx.pos);
        for (const o of withPose) { const cam = cameraFromTag(o.pose, map.tags[o.id]); add(cam.R_wc, cam.pos); }
      }
      return { out, fx };
    };
    const run = list => {
      const { pts, px, owner } = build(list);
      const { out } = inits(list, pts, px);
      if (!out.length) return null;
      let best = null;
      const tryInit = (R, c) => { const s = jointLM(pts, px, K, R, c, delta); if (s && (!best || s.cost < best.cost)) best = s; };
      for (const [R, c] of out) tryInit(R, c);
      // few tags or poor fit: also start from flipped copies (planar tilt ambiguity), turning about the tag centroid
      if (best && (list.length < 2 || Math.sqrt(best.r.reduce((s, v) => s + v * v, 0) / pts.length / 2) > 1.5)) {
        const cen = [0, 1, 2].map(i => pts.reduce((s, p) => s + p[i], 0) / pts.length), base = out.slice();
        for (const [R0, c0] of base) for (const [ax, deg] of [[0, 35], [0, -35], [1, 35], [1, -35], [0, 70], [0, -70], [1, 70], [1, -70]]) {
          const Q = ax === 0 ? Rx(deg * D2R) : Ry(deg * D2R); // world rotation of the whole camera about the tag cluster centre
          const d = mulv(Q, [c0[0] - cen[0], c0[1] - cen[1], c0[2] - cen[2]]);
          tryInit(T(mul(Q, T(R0))), [cen[0] + d[0], cen[1] + d[1], cen[2] + d[2]]);
        }
      }
      return best && { ...best, pts, px, owner };
    };
    let sol = run(obs), dropped = [];
    if (!sol) return null;
    const tagRms = (s, list) => list.map(o => { let a = 0, n = 0; for (let i = 0; i < s.owner.length; i++) if (s.owner[i] === o.id) { a += s.r[2 * i] ** 2 + s.r[2 * i + 1] ** 2; n++; } return { id: o.id, rms: Math.sqrt(a / n) }; });
    if (obs.length >= 3) { // drop tags whose own residual is far above the median, then re-solve
      const rs = tagRms(sol, obs), med = rs.map(x => x.rms).sort((a, b) => a - b)[rs.length >> 1];
      const keep = rs.filter(x => x.rms <= Math.max(dropFactor * med, dropMin)).map(x => x.id);
      if (keep.length >= 2 && keep.length < obs.length) {
        dropped = rs.filter(x => !keep.includes(x.id)).map(x => x.id);
        const s2 = run(obs.filter(o => keep.includes(o.id))); if (s2) { sol = s2; obs = obs.filter(o => keep.includes(o.id)); }
        else dropped = [];
      }
    }
    // drop single corners > dropFactor x median residual (floor dropMin) by down-weighting through Huber already; report plain RMS of all kept
    const n = sol.owner.length, rmsPx = Math.sqrt(sol.r.reduce((s, v) => s + v * v, 0) / n / 2);
    const R_wc = T(sol.R_cw);
    return { pos: sol.c, R_wc, q: rotToQuat(R_wc), ...eulerWorld(R_wc), rmsPx, nTags: obs.length, nCorners: n, weak: obs.length < 2,
      ids: obs.map(o => o.id), droppedIds: dropped, perTagRms: tagRms(sol, obs) };
  }

  const api = { solveJoint, refinePose, tagRotation, parseMap, cameraFromTag, rotToQuat, quatToRot, averageQuats, eulerWorld, angDiff, fuse, stats };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.RoomPose = api;
})(typeof window !== "undefined" ? window : this);
