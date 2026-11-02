# START HERE (handoff 2026-10-23)
Decision: track the Redmi WITHOUT ARCore/camera tracking (its camera/IMU clocks desync). Read the 2 bottom sections:
- "Room scan pipeline v2" (S1-S9): video -> COLMAP 4 poses -> AprilTag scale -> Depth Anything 3 dense -> Open3D walls -> Cubify boxes -> rules fill -> 10 cm occupancy grid -> Minecraft blocks.
- "Camera-free tracking" (C0-C8): native app titan-sense + Mac particle filter fusing learned odometry, phone<->Mac chirp range, phone sonar echoes, magnetic map, MacBook camera, room map. Kill rule: held-out p50 > 50 cm -> used Quest 2 / Pixel 6a.
Next session: user plugs Redmi (USB debugging) -> C0 caps, C1 high-beep test; meanwhile C2 install (brew colmap, uv env torch/open3d/opencv/sounddevice). Printing AprilTags + filming (C4/S1) later.
Tools on Mac (checked 2026-10-23): adb, Android SDK 35-37 + NDK, gradle, java, uv, ffmpeg, node. Missing: colmap, torch.

# Titan AR plan (from research on 2026-10-22)

Goal: see live Minecraft Java players walk through the real house on a Redmi Note 14 5G.
Done = player figure stays within ~10 cm of where it should be after walking the house for 1 minute, <1 s delay.

Fact levels: [2src] two sources, [lead] one source or unverified, [test] must be measured on the phone.

## Design (one pick)
WebXR + three.js in Chrome (already built). Alignment by fitting 3-5 tapped floor points (rigid + scale, least squares), re-fitted every 20-30 s. Positions from a tiny Fabric server mod over WebSocket (RCON only for the first test). Stay off native Android unless persistent anchors across sessions are needed.

## Steps (each has a check)
1. Phone ready. Check: `adb devices` lists the phone; Chrome opens `http://localhost:8080` after `adb reverse tcp:8080 tcp:8080`. [2src for localhost=secure; ws://localhost = lead/test]
2. Mock test, tape X 1 m apart (README Test 2). Check: red cube within 10 cm after 1 min walk. [test] Also log: plane-detection, anchors, depth, raw-camera-access availability.
3. Multi-point fit: tap 3-5 known points, Umeyama fit, refit every 20-30 s. Check: re-run step 2 over a bigger area (3+ m). [lead]
4. Real Minecraft on flat world (README Test 3), RCON, 1 player. Check: figure moves with <1 s delay. NOTE: Java version unverified. A source says current Minecraft is 26.x and needs Java 25; README says 21. Check the version before installing. [lead]
5. Fabric mod pushing x,y,z,yaw at 10 Hz over WebSocket; page draws ~100-150 ms in the past, interpolates, snaps on teleport. Why: RCON threading bug MC-72390 [2src], cost per player. [lead on exact API names]
6. House world: decide hand-build vs scan (needs house size + furniture or walls). Scale 1 block = 10 cm to 1 m. Check: second tape measurement not used for scaling matches within 5 cm. [lead]
7. Extras: depth occlusion (Chrome shipped [2src], test on phone); AprilTag via raw-camera-access if drift is still too big [lead].

## Round 2 (whole-approach + alignment research)
- Whole approaches compared: WebXR (easiest, days) vs Unity AR Foundation (better tracking, 1-2 weeks, unverified occlusion) vs native Kotlin vs Quest/Vivecraft (no passthrough found, needs hardware) vs Wi-Fi RTT/UWB (1-2 m, too coarse) vs 2D minimap (hours, not AR). No existing app does live Java players in a real house. Verdict: stay on WebXR; go Unity only if tracking/occlusion demands it. [lead, pages partly opened]
- ARCore anchors reliable within ~8 m [lead]: re-anchor per room in a whole house.
- Phone checked 2026-10-22: Chrome 156, ARCore 1.57. Past the Chrome 147/148 raw-camera + three.js crash. [checked]
- Calibration to build: tap A (origin), tap B (rotation), scale from block size or card chain (178 mm for 2 cards), nudge sliders (x/z 1 cm, yaw 0.5 deg, scale %), save calibration. Marker via apriltag-js-standalone only later. [lead]

## Negative results so far
- mkcert HTTPS: Android mostly ignores user CAs, sources disagree. Skip.
- Cloud Anchors/Geospatial: not useful for one house on the web; Azure anchors (Minecraft Earth) were retired, don't depend on a cloud service.
- Chunker: only Java<->Bedrock conversion, not mesh to blocks.
- Splat-to-mesh tools are CUDA-first; skip on the Mac.
- Query protocol has no positions.

## BLOCKED
(none)

## Status 2026-10-22 (MVP phase A)
- Done: Mac server 26.3 flat world + RCON; head item_display follows tp at 10 Hz (user confirmed); bridge now receives `pose` from the page and moves the head; run log in `logs/run-*.jsonl` (poses, marker, answers, tracking-lost, 1 s ticks).
- Flat-world calibration defaults: A=(0,-60,0), B=(1,0), 1 block = 1 m. Run: `node server.js` (reads mcserver/rcon.password).
- Open: does the head follow the real phone (needs the user's eyes); drift test Yes/No ladder; marker offset bug vs drift (read the log).
- Next: house scan -> blocks (phase B), AprilTag re-anchoring only if drift is real.

## Room scan pipeline v2 (researched 2026-10-23)
Input: 2-3 min slow phone video (4K30, 3 passes: chest, high, low), mirror covered, 4-8 AprilTags + 2 taped distances, a few printed sheets on blank walls. Output: metric room model + per-frame camera poses (tracker ground truth) + occupancy grid + Minecraft blocks.
S1. Frames: `ffmpeg -i in.mp4 -vf fps=1.5 -q:v 2 frames/%05d.jpg` (~250 frames). Check: count, no blur (Laplacian variance filter).
S2. Poses + sparse cloud: COLMAP 4.x (`brew install colmap`; GLOMAP merged in as `global_mapper`), ALIKED or SIFT, sequential + loop matching; fallback incremental `mapper`. [2src: COLMAP 4.0 release + brew formula] Check: >= 95% frames registered.
S3. Scale: triangulate AprilTag corners -> one Sim(3) scale. Check: second tape distance within 3 cm.
S4. Dense: Depth Anything 3 (Apache weights: DA3Metric/Base/Small; MPS ~3.8 img/s [lead]) per frame, aligned to COLMAP scale, TSDF fused in Open3D -> mesh. Fills blank walls COLMAP can't. Check: wall flatness RMS < 3 cm.
S5. Shell: Open3D floor plane -> z-up; Manhattan frame; RANSAC walls -> closed polygon; ceiling plane; doors/windows = holes in wall density. Check: wall-to-wall distance vs tape within 5 cm.
S6. Furniture: Apple Cubify Anything (RGB model, `--device mps`) on keyframes -> 3D boxes, fused; manual box edits for misses. Check: every big item (bed, wardrobe, dresser, nightstands, desk) has a box.
S7. Fill unseen parts by rules (not AI generation): close wall lines, extend ceiling, extrude boxes to floor (covers under-bed). Generative tools (Marble ~$1.20/world, HunyuanWorld) invent rooms, not yours: visuals only, never geometry.
S8. Occupancy grid for the tracker: 0.1 m voxels; free / occupied / unknown (unknown != free).
S9. Minecraft: downsample to 1 block = chosen size, block by class (floor planks, walls concrete, furniture wool by colour) -> `.mcfunction` (verified on 26.3) or mcschematic `.schem`. Check: walk the world, compare with the photo.
Rejected and why: Gaussian splats (2 h on Mac, splat->mesh tools CUDA-only, not needed); phone scan apps (need ARCore or give no poses); MASt3R-SLAM/SpatialLM/HunyuanWorld (CUDA-only, unverified on Mac; SpatialLM worth one rented-GPU cross-check later); panorama layout nets (need full 360 equirect, Android partial pano likely fails); semantic scene completion (~32 mIoU, too weak).
Risks: COLMAP breaks on blank walls/mirror (mitigate: texture sheets, cover mirror, DA3/VGGT poses as fallback); scale error (4+ tags spread out, 2 tape checks).

## Camera-free tracking on the Redmi (gap pass 2026-10-23, v2)
Goal: in the bedroom first, the Redmi knows its position (p50 <= 30 cm, p90 <= 50 cm) and heading (<= 5 deg) live (< 200 ms) with ARCore and camera tracking OFF. Only the phone + the MacBook. Then the head in Minecraft follows it, and players are drawn over the phone's camera picture (camera used as a display only).
Assumptions: one real person in the room (the Titan); other players are remote in Minecraft. Bedroom first, house later (repeat per room).

### Why this design (evidence)
- Hard limit (proof): IMU alone cannot observe absolute position or yaw (VINS: global position + yaw unobservable; bias gives t^2 error). So absolute signals are required; every other choice below is about which ones.
- Phone sonar trained per room: ELF-SLAM 0.1 m median living room, 0.5 m office, 0.7-1.7 m untrained [lead: 1 paper, no code].
- Phone<->Mac two-way chirp ranging (BeepBeep, sample counting, no clock sync): 1-2 cm [2src].
- Magnetic map per room + sequence model: 0.21 m [lead]; 0.5-0.8 m with PDR [2src].
- Learned inertial odometry (RoNIN code + weights, fine-tune): ~0.3 m per 5 s [2src].
- MacBook camera (fixed, sees most of the bedroom): body/foot keypoints + floor plane -> x,y when visible; "not visible" = negative info [estimate].
- Rejected (measured >= 1 m or not available): WiFi RSSI, BLE, WiFi RTT (Redmi not on list), light sensor, earbuds (no IMU, HFP mic can't hear ultrasound), WiFi CSI (needs ESP32s).

### Design (one pick)
Phone: one native Android app `titan-sense` (Kotlin; SensorManager + AAudio/Oboe UNPROCESSED + Camera2). Same app for recording and for play. Streams to the Mac over WiFi UDP: IMU 200 Hz, game rotation vector, magnetometer uncalibrated 100 Hz, barometer, chirp echo profiles, chirp arrival sample indices. Records video only in training/test sessions.
Mac: Python (uv) `tracker/`: particle filter (2000 particles, 10 Hz) over the scanned room's floor map.
- Motion: fine-tuned RoNIN-style network on IMU windows.
- Corrections: Mac range, echo-profile -> position network, magnetic map (Gaussian-process map of the 3-axis world-frame field), Mac-camera foot position or "not in view", walls/furniture (particles inside furniture die), barometer height.
- Heading: game rotation vector, yaw offset estimated by the filter from the magnetic map + track + Mac-camera body direction.
- Output: `{"type":"pose",x,y,z,yaw,pitch}` JSON into server.js (same message the page sends now).
Sound schedule (TDMA, Mac is the clock master over UDP): 100 ms frame = phone sonar chirp 0-20 ms (18-20 kHz), phone ranging chirp 30-50 ms, Mac ranging chirp 60-80 ms (19-21 kHz). Kills interference between the 3 sounds.
Ground truth: the room-scan video. Same recording = Minecraft map + training labels + test set. GLOMAP (inside COLMAP) gives camera poses; scale from a tape-measured distance; time offset video<->IMU fitted by cross-correlating gyro with visual rotation. The MacBook webcam's pose: add one webcam frame to the same reconstruction.
Scorecard: every signal is judged on a held-out walk (never trained on). Keep a signal only if held-out p50 improves.

### Steps (each has a check; do in order, C2-C3 can run in parallel)
C0. Phone capabilities. `adb shell dumpsys sensorservice`, `pm list features`, app query for UNPROCESSED. Check: file `logs/caps.txt` lists accel/gyro/mag/baro max rates, UNPROCESSED yes/no. If no barometer -> drop height signal (not critical).
C1. Sound band test (Mac script + titan-sense v0). Mac plays a 16-22 kHz sweep; phone records; phone plays and records itself. Check: SNR >= 15 dB at 19-20 kHz on both paths; you say whether you hear it. Fail at 19-20 kHz -> move band down to 17-19 kHz; fail there too -> drop sound, keep magnetic + odometry + Mac camera.
C2. Install tools: `brew install colmap` (has GLOMAP global mapper), `uv` env with torch (MPS), opencv, numpy, scipy, open3d, sounddevice. Check: `colmap -h` and `python -c "import torch; print(torch.backends.mps.is_available())"` -> True.
C3. titan-sense v1 recorder: video 1080p30 + all sensors + chirps, one clock (elapsedRealtimeNanos, audio frame position mapped to it). Mac side records its own chirps + webcam with a shared UDP time sync. Check: 2-minute test file; gyro vs visual-rotation offset residual < 5 ms; audio sample timestamps monotonic.
C4. Record the room: print 6-10 AprilTags, tape 2 distances. 3 scan passes + 20-30 min of normal play-like walking (crouch, turn, sidestep), split 80/20 by walk, holding the phone as in the game. Check: GLOMAP registers >= 95% of frames; second tape distance within 3 cm.
C5. Scorecard harness `tracker/eval.py`: run any signal set on the held-out walk, print p50/p90/heading error/latency. Check: runs on a dummy "IMU only" baseline and prints numbers (expect metres: proves the harness sees drift).
C6. Add signals one at a time, each a separate commit with its score: (a) fine-tuned odometry + room walls, (b) + Mac range, (c) + magnetic map, (d) + echo network, (e) + Mac camera, (f) + barometer. Check: table of held-out p50/p90 after each; signals that don't help are removed.
C7. Live: titan-sense play mode streams; tracker runs at 10 Hz; pose -> server.js -> Minecraft head. Check: end-to-end latency < 200 ms (timestamp in log); a new walk with video recorded for truth meets p50 <= 30 cm.
C8. AR view: titan-sense draws players over the camera preview using tracker pose + camera intrinsics (Camera2 focal length, checked against a measured object). Check: screenshot with a test marker drawn on a tape mark lands within 10 cm.
Kill rule: if C6 with all signals gives held-out p50 > 50 cm -> BLOCKED; fall back to used Quest 2 or Pixel 6a. Decide with numbers, not hopes.

### Gaps closed in this pass
- Logger had no single tool for video + IMU + mag + baro + chirps -> own app (needed for play mode anyway).
- 3 sounds interfering -> TDMA schedule with the Mac as master.
- "Camera off" vs AR overlay -> camera on as a display only, not for tracking.
- Mac webcam position unknown -> register one webcam frame in the same reconstruction.
- How much training data -> start 20-30 min, measure held-out p50 vs data size; record more only if the curve is still dropping.
- Phone held differently -> record in the game hold; the echo and odometry nets take orientation as input.
- Untested remain (only real use can close): Redmi mic response above 18 kHz (C1), sonar accuracy on this phone (C6d), magnetic stability in this room (C6c), whether chirps bother anyone.
