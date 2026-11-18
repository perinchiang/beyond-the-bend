// Capture real renders of the running prototype for visual review.
//   node tools/shoot.mjs [name=json ...]     e.g.  node tools/shoot.mjs hero='{"s":232}'
// Requires the dev server (npm run dev) and a local Google Chrome.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.env.BTB_URL ?? 'http://127.0.0.1:5183/beyond-the-bend/';
const OUT = process.env.BTB_OUT ?? 'shots';
const W = Number(process.env.BTB_W ?? 1600), H = Number(process.env.BTB_H ?? 900);
const QUERY = process.env.BTB_QUERY ?? 'route=circuit&hud=0&t=20&dpr=1';

const defaults = {
  hero: { s: 232 },
  avenue: { s: 100 },
  esses: { s: 470, yaw: 120 },
  north: { s: 690, yaw: 215, zoom: 56, pitch: 44 },
  photo: { s: 100, x: -20, z: 60, yaw: 30, pitch: 28, zoom: 72 },
  car_front: { s: 232, zoom: 8, yaw: 65, pitch: 32 },
  car_rear: { s: 232, zoom: 8, yaw: 250, pitch: 30 },
  drive_high: { s: 100, mode: 'drive', preset: 0 },
  drive_normal: { s: 100, mode: 'drive', preset: 1 },
  drive_close: { s: 100, mode: 'drive', preset: 2 },
  map: { x: 0, z: 0, yaw: 0, pitch: 89, zoom: 400 },
};
const shots = {};
for (const a of process.argv.slice(2)) {
  const i = a.indexOf('=');
  if (i < 0) shots[a] = defaults[a] ?? {};
  else shots[a.slice(0, i)] = JSON.parse(a.slice(i + 1));
}
if (!Object.keys(shots).length) Object.assign(shots, defaults);

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (['error', 'warning', 'info'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${BASE}?${QUERY}`);
await page.waitForFunction(() => window.__btb?.ready, null, { timeout: 60000 });
const gpu = await page.evaluate(() => {
  const gl = window.__btb.renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
console.log('renderer:', gpu);
for (const [name, view] of Object.entries(shots)) {
  await page.evaluate((v) => window.__btb.view(v), view);
  await page.waitForTimeout(view.wait ?? 500);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('saved', `${OUT}/${name}.png`);
}
if (process.env.BTB_PERF) {
  const fps = await page.evaluate(() => new Promise((res) => {
    let n = 0; const t0 = performance.now();
    const tick = () => { n++; if (performance.now() - t0 > 3000) res(n / 3); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }));
  const info = await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => res({ calls: window.__btb.renderer.info.render.calls, tris: window.__btb.renderer.info.render.triangles }))));
  console.log(`perf: ${fps.toFixed(1)} fps @ ${W}x${H}`, info);
}
for (const l of logs) console.log(l);
await browser.close();
