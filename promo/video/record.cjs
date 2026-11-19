// Records an ~18 s multi-scene gameplay video, frame by frame on a virtual clock (30 fps, 1920x1080).
// Usage: dev server on :5199 (npx vite --port 5199), then: node promo/video/record.cjs <framesDir>
// Then encode (see the ffmpeg lines at the bottom of this file).
const { chromium } = require(process.env.HOME + '/Work/mercury-web/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2];
const FPS = 30;
const DT = 1000 / FPS;

// Virtual time: rAF, performance.now, Date.now, timers and CSS animations all advance only when we step.
const VT = `(() => {
  const realRAF = window.requestAnimationFrame.bind(window);
  const realNow = performance.now.bind(performance);
  const realDate = Date.now.bind(Date);
  const realST = window.setTimeout.bind(window), realCT = window.clearTimeout.bind(window);
  const realSI = window.setInterval.bind(window), realCI = window.clearInterval.bind(window);
  const V = { on: false, t: 0, raf: [], timers: new Map(), id: 1e7 };
  window.__vt = V;
  performance.now = () => (V.on ? V.t : realNow());
  Date.now = () => (V.on ? V.base + V.t : realDate());
  window.requestAnimationFrame = (cb) => { if (!V.on) return realRAF(cb); V.raf.push(cb); return ++V.id; };
  window.setTimeout = (fn, ms = 0, ...a) => { if (!V.on) return realST(fn, ms, ...a); const id = ++V.id; V.timers.set(id, { due: V.t + (ms || 0), fn, a }); return id; };
  window.clearTimeout = (id) => { if (V.timers.has(id)) V.timers.delete(id); else realCT(id); };
  window.setInterval = (fn, ms = 0, ...a) => { if (!V.on) return realSI(fn, ms, ...a); const id = ++V.id; V.timers.set(id, { due: V.t + ms, fn, a, every: Math.max(1, ms) }); return id; };
  window.clearInterval = (id) => { if (V.timers.has(id)) V.timers.delete(id); else realCI(id); };
  V.enable = () => { V.t = realNow(); V.base = realDate() - V.t; V.on = true; };
  V.step = (ms) => {
    V.t += ms;
    for (const [id, tm] of [...V.timers]) {
      if (tm.due > V.t || !V.timers.has(id)) continue;
      if (tm.every) tm.due += tm.every; else V.timers.delete(id);
      if (typeof tm.fn === 'function') tm.fn(...tm.a);
    }
    for (const a of document.getAnimations()) {
      if (a.playState === 'running') a.pause();
      if (a.playState === 'paused') a.currentTime = (a.currentTime || 0) + ms;
    }
    const q = V.raf; V.raf = [];
    for (const cb of q) cb(V.t);
  };
})();`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: ['--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.addInitScript(VT);
  await p.goto('http://localhost:5199/');
  await p.waitForFunction(() => window.dbg && window.dbg.menu, null, { timeout: 60000 });
  await p.waitForTimeout(3000); // real time: assets, title fade-in

  await p.evaluate(() => window.__vt.enable());
  const step = (n = 1) => p.evaluate(([n, dt]) => { for (let i = 0; i < n; i++) window.__vt.step(dt); }, [n, DT]);
  const skip = (s) => step(Math.round(s * FPS));
  const counters = {};
  const rec = async (seg, s) => {
    counters[seg] = counters[seg] || 0;
    const n = Math.round(s * FPS);
    for (let i = 0; i < n; i++) {
      await step(1);
      const f = path.join(OUT, `${seg}_${String(counters[seg]++).padStart(5, '0')}.jpg`);
      await p.screenshot({ path: f, type: 'jpeg', quality: 93 });
    }
    console.log(`  ${seg}: ${counters[seg]} frames`);
  };
  const caption = () => p.evaluate(() => document.querySelector('.intro-cine .cine-caption')?.textContent || '');
  const waitCaption = async (prefix, maxS = 30) => {
    for (let i = 0; i < maxS * FPS; i++) {
      if ((await caption()).startsWith(prefix)) return true;
      await step(1);
    }
    return false;
  };
  const press = async (key) => { await p.keyboard.down(key); await step(2); await p.keyboard.up(key); await step(1); };

  // 1 + 5: the title screen (opening and closing shots, continuous orbit)
  await skip(0.5);
  await rec('1', 2.0);
  await rec('5', 2.5);

  // 2: free roam -> intro, three captioned shots
  await p.evaluate(() => window.dbg.menu.activate(1));
  for (const cap of ['Arrêt', 'Nid-de-poule', 'Agence']) {
    if (!(await waitCaption(cap))) { console.log('missing shot', cap); continue; }
    await skip(0.3);
    await rec('2', 2.0);
  }

  // 3: skip the rest of the intro; the car drives itself (traffic AI) and the welcome Canada Post van comes up the street
  await press('Escape');
  for (let i = 0; i < 6 * FPS; i++) {
    if (await p.evaluate(() => !window.dbg.world.controlLocked)) break;
    await step(1);
  }
  await p.evaluate(() => {
    const d = window.dbg;
    const pc = d.game.sims.find((s) => s.constructor.name === 'PlayerController');
    const D = [...d.traffic.drivers.values()][0].constructor;
    const lane = d.city.nearestLanePoint(d.world.player.pos).lane;
    const drv = new D(d.world, d.world.player, lane);
    drv.speedMul = 1.15;
    window.__auto = drv;
    pc.update = () => drv.drive();
  });
  // Start the scene when the van is close enough to read, coming up the street
  const vanDist = () => p.evaluate(() => {
    const d = window.dbg, pl = d.world.player;
    const vans = d.world.cars.filter((c) => !c.removed && c.look.style === 'postvan');
    let best = Infinity;
    for (const v of vans) {
      const dx = v.pos.x - pl.pos.x, dz = v.pos.z - pl.pos.z;
      if (dx * Math.sin(pl.yaw) + dz * Math.cos(pl.yaw) > 0) best = Math.min(best, Math.hypot(dx, dz));
    }
    return best;
  });
  for (let i = 0; i < 8 * FPS && (await vanDist()) > 48; i++) await step(1);
  console.log('van at', Math.round(await vanDist()), 'm');
  await rec('3', 4.0);

  // 4: SPVM chase: a cruiser behind, everything witnessed, a few offenses
  const st = await p.evaluate(() => {
    const d = window.dbg;
    const pl = d.world.player;
    const f = { x: Math.sin(pl.yaw), z: Math.cos(pl.yaw) };
    const h = d.city.nearestLanePoint({ x: pl.pos.x - f.x * 18, z: pl.pos.z - f.z * 18 });
    d.police.spawn(h.lane, h.pos);
    d.police.witnessAll = true;
    window.__auto.speedMul = 1.4;
    for (const kind of ['redLight', 'speeding', 'redLight', 'wrongWay'])
      d.world.events.emit({ type: 'offense', kind, pos: { x: pl.pos.x, z: pl.pos.z }, witnessed: false });
    return { heat: d.heat.value };
  });
  await skip(0.8);
  console.log('chase', st, await p.evaluate(() => ({ pursuers: window.dbg.police.pursuers, heat: window.dbg.heat.value })));
  await rec('4', 3.5);

  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });

// Encode (segments sort 1..5 by file name; 2-pass to ~12 MB, standard range for phones / messaging apps):
//   VF="fade=t=in:st=0:d=0.3,fade=t=out:st=17.4:d=0.6,scale=in_range=full:out_range=tv,format=yuv420p"
//   ffmpeg -framerate 30 -pattern_type glob -i 'frames/*.jpg' -vf "$VF" -c:v libx264 -preset slow -b:v 5500k -pass 1 -an -f mp4 /dev/null
//   ffmpeg -framerate 30 -pattern_type glob -i 'frames/*.jpg' -vf "$VF" -c:v libx264 -preset slow -b:v 5500k -maxrate 8M -bufsize 11M \
//     -pass 2 -profile:v high -level 4.1 -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 -movflags +faststart out.mp4
