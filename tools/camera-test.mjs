// Camera system checks: vehicle independence, input gating, framing, transition smoothness, yaw lag.
// Requires the dev server (npm run dev) and a local Google Chrome.   node tools/camera-test.mjs
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${process.env.BTB_URL ?? 'http://127.0.0.1:5183/beyond-the-bend/'}?hud=0&dpr=1&t=20`);
await page.waitForFunction(() => window.__btb?.ready);

// 1. the camera cannot influence the vehicle
const phys = await page.evaluate(() => {
  const a = window.__btb.simulate(false);
  const b = window.__btb.simulate(true);
  return { a, b, same: JSON.stringify(a) === JSON.stringify(b) };
});
console.log('physics identical with/without camera churn:', phys.same);
if (!phys.same) console.log(JSON.stringify(phys));

// 2. driving mode ignores orbit / zoom / pan
const ignored = await page.evaluate(() => {
  const b = window.__btb, r = b.rig;
  b.view({ s: 100, mode: 'drive', preset: 1 });
  const s0 = { yaw: r.yaw, pitch: r.pitch, view: r.viewHeight };
  r.orbit(1.2, 0.4); r.zoom(2.5); r.panBy(40, 40);
  return { before: s0, after: { yaw: r.yaw, pitch: r.pitch, view: r.viewHeight }, same: JSON.stringify(s0) === JSON.stringify({ yaw: r.yaw, pitch: r.pitch, view: r.viewHeight }) };
});
console.log('driving mode ignores orbit/zoom/pan:', ignored.same);

// 3. presets + framing, and that the car sits below screen centre
const shots = [
  ['drive_normal', { s: 100, mode: 'drive', preset: 1 }],
  ['drive_high', { s: 100, mode: 'drive', preset: 0 }],
  ['drive_close', { s: 100, mode: 'drive', preset: 2 }],
  ['drive_corner', { s: 470, mode: 'drive', preset: 1 }],
  ['drive_corner_close', { s: 470, mode: 'drive', preset: 2 }],
  ['free_photo', { s: 100, x: -20, z: 60, yaw: 30, pitch: 50, zoom: 80 }],
];
for (const [name, v] of shots) {
  const f = await page.evaluate((v) => {
    const b = window.__btb;
    b.view(v);
    b.renderer.info.reset();
    const carP = b.car.position.clone().project(b.rig.camera);
    return { sx: +((carP.x * 0.5 + 0.5) * 1600).toFixed(0), sy: +((0.5 - carP.y * 0.5) * 900).toFixed(0) };
  }, v);
  await page.waitForTimeout(350);
  await page.screenshot({ path: `shots/${name}.png` });
  console.log(name.padEnd(20), 'car on screen at', f);
}

// 4. transitions at a fixed 60 Hz step: peak speeds, and that motion starts and ends gently
const smooth = await page.evaluate(() => {
  const b = window.__btb, r = b.rig, dt = 1 / 60;
  const run = (label, action, steps = 150) => {
    const rec = [];
    action();
    for (let i = 0; i < steps; i++) { r.update(dt, b.car.position, b.car.heading); rec.push({ yaw: r.yaw, pitch: r.pitch, view: r.viewHeight, tx: r.target.x, tz: r.target.z }); }
    let peakPitch = 0, peakYaw = 0, peakZoom = 0, peakPan = 0;
    for (let i = 1; i < rec.length; i++) {
      peakPitch = Math.max(peakPitch, Math.abs(rec[i].pitch - rec[i - 1].pitch) / dt * 57.3);
      peakYaw = Math.max(peakYaw, Math.abs(rec[i].yaw - rec[i - 1].yaw) / dt * 57.3);
      peakZoom = Math.max(peakZoom, Math.abs(Math.log(rec[i].view / rec[i - 1].view)) / dt);
      peakPan = Math.max(peakPan, Math.hypot(rec[i].tx - rec[i - 1].tx, rec[i].tz - rec[i - 1].tz) / dt);
    }
    const first = Math.abs(rec[1].pitch - rec[0].pitch) / dt * 57.3 + Math.abs(rec[1].yaw - rec[0].yaw) / dt * 57.3;
    const last = Math.abs(rec.at(-1).pitch - rec.at(-2).pitch) / dt * 57.3 + Math.abs(rec.at(-1).yaw - rec.at(-2).yaw) / dt * 57.3;
    return `${label.padEnd(26)} peak tilt ${peakPitch.toFixed(0)} deg/s · peak yaw ${peakYaw.toFixed(0)} deg/s · peak zoom ${(peakZoom * 100).toFixed(0)} %/s · peak slide ${peakPan.toFixed(0)} m/s · first-step ${first.toFixed(1)} deg/s · settled ${last.toFixed(2)} deg/s  → pitch ${(r.pitch * 57.3).toFixed(1)} view ${r.viewHeight.toFixed(1)}`;
  };
  b.view({ s: 100, mode: 'drive', preset: 1 });
  const out = [];
  out.push(run('V: Normal -> Close', () => r.cyclePreset()));
  out.push(run('V: Close -> High', () => r.cyclePreset()));
  out.push(run('V: High -> Normal', () => r.cyclePreset()));
  out.push(run('C: Driving -> Free', () => r.toggleMode(), 60));
  r.orbit(2.4, 0.3); r.zoom(1.8);
  out.push(run('(free: orbit 137°, zoom)', () => {}, 90));
  out.push(run('C: Free -> Driving', () => r.toggleMode(), 240));
  return out;
});
for (const l of smooth) console.log(l);

// 5. cornering: how far does the car's tail swing from the camera axis?
const lag = await page.evaluate(async () => {
  const b = window.__btb, r = b.rig;
  b.view({ s: 470, mode: 'drive', preset: 1 });
  let worst = 0;
  for (let i = 0; i < 240; i++) {
    b.car.update(1 / 60, { throttle: 1, steer: i > 90 && i < 150 ? 1 : 0, brake: false });
    r.update(1 / 60, b.car.position, b.car.heading);
    let e = b.car.heading + Math.PI - r.yaw; e = Math.atan2(Math.sin(e), Math.cos(e));
    worst = Math.max(worst, Math.abs(e));
  }
  return worst * 57.3;
});
console.log('worst yaw lag behind car during a turn:', lag.toFixed(1), 'deg');
for (const l of logs) console.log(l);
await browser.close();
