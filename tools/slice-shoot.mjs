// Screenshots and frame times from the running graybox slice (needs the dev server + Chrome).
//   node tools/slice-shoot.mjs [name=json ...]
//   each shot: { spawn: '1'..'7', view: 0|1|2, drive: seconds of autopilot before the picture, query: 'extra=1' }
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.env.BTB_URL ?? 'http://127.0.0.1:5186/beyond-the-bend/slice/';
const OUT = process.env.BTB_OUT ?? 'shots/slice';
const W = Number(process.env.BTB_W ?? 1600), H = Number(process.env.BTB_H ?? 900);
const defaults = {
  straight: { spawn: '1', drive: 14 },
  wye: { spawn: '2', drive: 4 },
  jump: { spawn: '3', drive: 9 },
  pass_foot: { spawn: '4', drive: 10 },
  summit: { spawn: '5', drive: 5 },
  summit_high: { spawn: '5', drive: 5, view: 2 },
  gravel: { spawn: '6', drive: 8 },
  north: { spawn: '7', drive: 6, view: 1 },
};
const shots = {};
for (const a of process.argv.slice(2)) {
  const i = a.indexOf('=');
  if (i < 0) shots[a] = defaults[a] ?? {}; else shots[a.slice(0, i)] = JSON.parse(a.slice(i + 1));
}
if (!Object.keys(shots).length) Object.assign(shots, defaults);
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
let failed = false;
for (const [name, s] of Object.entries(shots)) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  await page.goto(`${BASE}?spawn=${s.spawn ?? '1'}&view=${s.view ?? 0}&mute=1&stats=1${s.hud === false ? '&hud=0' : ''}${s.query ? '&' + s.query : ''}`);
  try {
    await page.waitForFunction(() => window.__slice?.ready, null, { timeout: 60000 });
  } catch { console.log(`${name}: did not start`, logs); failed = true; await page.close(); continue; }
  const info = await page.evaluate(async (seconds) => {
    const s = window.__slice;
    if (seconds > 0) s.setAutopilot(true);
    const frames = [];
    const t0 = performance.now();
    let top = 0;
    await new Promise((done) => {
      const tick = () => {
        frames.push(s.frameMs());
        top = Math.max(top, s.vehicle.speed * 3.6);
        if (performance.now() - t0 > seconds * 1000) done(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    frames.sort((a, b) => a - b);
    const q = (p) => +frames[Math.min(frames.length - 1, Math.floor(frames.length * p))].toFixed(1);
    const v = s.vehicle, r = s.renderer.info.render;
    return { buildMs: Math.round(s.buildMs), frames: frames.length, p50: q(0.5), p95: q(0.95), worst: q(1), kmh: Math.round(v.speed * 3.6), topKmh: Math.round(top),
      pos: [Math.round(v.position.x), Math.round(v.position.y), Math.round(v.position.z)], calls: r.calls, tris: r.triangles };
  }, s.drive ?? 0);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(name.padEnd(12), JSON.stringify(info), logs.length ? `\n  ${logs.slice(0, 6).join('\n  ')}` : '');
  if (logs.some((l) => l.startsWith('pageerror'))) failed = true;
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
