// Watch the game being driven: an in-page autopilot follows the road through the real input
// path while frames are captured at a steady cadence, then tiled into a filmstrip.
//   node tools/observe.mjs name=lap preset=1 s=232 frames=12 every=400 speed=22
// Requires the dev server and a local Google Chrome; `magick` tiles the strip when available.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const arg = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=')));
const BASE = process.env.BTB_URL ?? 'http://127.0.0.1:5183/beyond-the-bend/';
const OUT = process.env.BTB_OUT ?? 'shots/observe';
const W = Number(arg.w ?? 1280), H = Number(arg.h ?? 720);
const name = arg.name ?? 'drive';
const preset = Number(arg.preset ?? 1), startS = Number(arg.s ?? 232);
const frames = Number(arg.frames ?? 12), every = Number(arg.every ?? 400), speed = Number(arg.speed ?? 22);
const warm = Number(arg.warm ?? 2500);

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${BASE}?hud=0&dpr=1&${arg.query ?? ''}`);
await page.waitForFunction(() => window.__btb?.ready, null, { timeout: 60000 });
await page.evaluate(({ preset, startS, speed }) => {
  const b = window.__btb, { track, car, touch } = b;
  b.view({ s: startS, mode: 'drive', preset });
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  let s = startS;
  const pilot = () => {
    // nearest centre-line point, searched around the last known arc length
    let best = 1e9, bs = s;
    for (let d = -6; d <= 30; d += 0.5) {
      const p = track.at(s + d), e = (p.x - car.x) ** 2 + (p.z - car.z) ** 2;
      if (e < best) { best = e; bs = s + d; }
    }
    s = bs;
    const look = 7 + Math.abs(car.speed) * 0.55, lane = -1.65;
    const t = track.at(s + look), tx = t.x - t.tz * lane, tz = t.z + t.tx * lane;
    const err = wrap(Math.atan2(tx - car.x, tz - car.z) - car.heading);
    let kMax = 0;
    for (let d = 0; d < 45; d += 3) kMax = Math.max(kMax, Math.abs(track.at(s + d).k));
    const vGoal = Math.min(speed, Math.sqrt(7 / Math.max(kMax, 1e-3)));
    touch.input.steer = -Math.max(-1, Math.min(1, err * 3.2));
    touch.input.throttle = car.speed < vGoal ? 1 : 0;
    touch.input.brake = car.speed > vGoal + 3;
    requestAnimationFrame(pilot);
  };
  requestAnimationFrame(pilot);
  window.__pilot = { get s() { return s; } };
}, { preset, startS, speed });
await page.waitForTimeout(warm);
const files = [];
const log = [];
for (let i = 0; i < frames; i++) {
  const t0 = Date.now();
  const f = path.join(OUT, `${name}-${String(i).padStart(2, '0')}.png`);
  await page.screenshot({ path: f });
  files.push(f);
  log.push(await page.evaluate(() => { const b = window.__btb; return { s: +(window.__pilot.s % b.track.length).toFixed(0), v: +b.car.speed.toFixed(1), yaw: +(b.rig.yaw * 57.2958).toFixed(1), y: +b.car.position.y.toFixed(2) }; }));
  await page.waitForTimeout(Math.max(0, every - (Date.now() - t0)));
}
console.log(log.map((l, i) => `${i}: s=${l.s} v=${l.v} yaw=${l.yaw} y=${l.y}`).join('\n'));
await browser.close();
try {
  const cols = Number(arg.cols ?? 4);
  const strip = path.join(OUT, `${name}.jpg`);
  const rows = [];
  for (let i = 0; i < files.length; i += cols) rows.push('(', ...files.slice(i, i + cols), '-resize', arg.tile ?? '640x360', '-bordercolor', '#222', '-border', '2', '+append', ')');
  execFileSync('magick', [...rows, '-background', '#222', '-append', '-quality', '82', strip]);
  console.log('strip', strip);
} catch { console.log('magick not available — frames left untiled'); }
