# Titan AR

See Minecraft players walking around your real house, through your phone camera.

- `server.js` runs on the Mac. It reads player positions from a vanilla Minecraft server (RCON, no mods) and streams them to the phone. It also serves the AR page. No `npm install` needed.
- `public/index.html` is the AR page (WebXR + three.js) that runs in Chrome on the phone.

Requirements: Node.js 18+ on the Mac, Chrome on an ARCore phone, both on the same Wi-Fi.

---

## Test 2: does the AR alignment hold? (1 evening, no Minecraft needed)

1. **Mac:** install Node.js if `node -v` fails (`brew install node`, or the installer from nodejs.org).
2. **Mac:** unzip, open Terminal in the `titan-ar` folder, run:
   ```
   node server.js --mock
   ```
   It prints a line like `open on your phone -> http://192.168.1.23:8080`. Note that address.
3. **Phone:** turn the VPN off (it can block access to your Mac on the home network).
4. **Phone:** WebXR only runs on secure pages, so tell Chrome to trust your Mac's address:
   - Open `chrome://flags` in Chrome.
   - Search **insecure origins treated as secure**.
   - Paste the address from step 2 (e.g. `http://192.168.1.23:8080`), set it to **Enabled**, tap **Relaunch**.
5. **Floor:** put two pieces of tape in an X on the floor, **exactly 1 m apart**. Call them A and B.
6. **Phone:** open the address, keep the default numbers, tap **Start AR**, allow the camera.
7. Sweep the phone slowly over the floor until a white ring appears. Put the ring on mark A, tap. Put it on mark B, tap.
8. A red cube sits on A, a blue cube on B, and a fake player "MockSteve" (≈45 cm tall) walks a 1 m circle around A.

**Pass:** walk around the room for a minute and come back. The red cube is still on the tape (within ~5–10 cm).
**Fail:** it slides off by 30 cm+ → tracking on this phone isn't good enough; tell Claude what you saw.

## Test 3: see a real Minecraft player in your room (1 weekend)

1. **Java 21** on the Mac (needed by Minecraft 1.20.5+): `brew install openjdk@21`, or the free Temurin 21 installer from adoptium.net.
2. **Server:** download `server.jar` from minecraft.net/download/server (same version as your game). Put it in its own folder, then in Terminal there:
   ```
   java -jar server.jar --nogui
   ```
   It stops right away. Open `eula.txt`, change `eula=false` to `eula=true`.
3. Open `server.properties` and set:
   ```
   enable-rcon=true
   rcon.password=pick-a-password
   rcon.port=25575
   level-type=minecraft\:flat
   ```
   Start it again: `java -Xmx4G -jar server.jar --nogui`.
4. **Game:** in Minecraft Java → Multiplayer → Add Server → address `localhost` → join.
5. Pick two spots in the world, e.g. put a red wool block and a blue wool block **4 blocks apart** on the ground. Stand on each and write down the **XYZ** line from F3 (y is your feet).
6. **Bridge:** in another Terminal, in `titan-ar`:
   ```
   RCON_PASSWORD=pick-a-password node server.js
   ```
   It should say `[rcon] connected`.
7. **Phone:** open the page, type the A and B numbers from step 5, Start AR, tap tape A then tape B.
8. Ask a friend (or your brother) to play on the laptop/Mac while you look through the phone. 4 blocks ↔ 1 m means players appear ~45 cm tall.

**Pass:** the little figure moves through your real room where they are in Minecraft, with less than a second of delay.

## Step 4: your real house

1. Build the house world (scan → Blender → ObjToSchematic → WorldEdit paste), at a known scale, e.g. 10 blocks per metre.
2. Use two real spots that are easy to find in both worlds as A and B, e.g. two door frames or room corners, ideally 3+ m apart (further apart = less rotation error).
3. Same steps as test 3, with the house world instead of the flat world.

## Troubleshooting

- Page doesn't load on the phone: same Wi-Fi? VPN off? Mac firewall blocking node (System Settings → Network → Firewall)?
- "not a secure context": redo the chrome://flags step with the exact address including `http://` and the port.
- No ring appears: more light, aim at a floor with some texture (a rug, a tape mark), move slowly.
- `[rcon] ... Retrying`: server not running, `enable-rcon=true` missing, or wrong password.

## Support

If this project is useful to you, you can support my work:

[![Support me on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/zfaka)
