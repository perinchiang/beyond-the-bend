// The same views through every art look, tiled into one comparison sheet.
//   node tools/slice-looks.mjs [look ...]        (needs the dev server + Chrome)
// Writes shots/looks/<look>_<view>.png and shots/looks/sheet.png.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.env.BTB_URL ?? 'http://127.0.0.1:5186/beyond-the-bend/slice/';
const OUT = process.env.BTB_OUT ?? 'shots/looks';
const W = Number(process.env.BTB_W ?? 1280), H = Number(process.env.BTB_H ?? 720);
const looks = process.argv.slice(2).length ? process.argv.slice(2) : ['flat', 'gouache', 'print'];
// [name, road, x, z, camera view, reverse]
const views = (process.env.BTB_VIEWS ?? 'plains,lake,summit,hairpin').split(',');
const VIEWS = {
  plains: ['ring', 150, 1600, 0, false],
  fork: ['ring', -420, 1600, 1, false],
  forest: ['lakeside', -700, 520, 0, false],
  lake: ['lakeside', -1560, 190, 0, false],
  summit: ['pass', 1972, -2209, 0, false],
  hairpin: ['pass', 1483, -2145, 2, false],
  north: ['ring', 250, -1650, 0, true],
};
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const tiles = [];
let failed = false;
for (const look of looks) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  await page.goto(`${BASE}?look=${look}&mute=1&hud=0`);
  try { await page.waitForFunction(() => window.__slice?.ready, null, { timeout: 60000 }); }
  catch { console.log(`${look}: did not start`, logs); failed = true; await page.close(); continue; }
  for (const name of views) {
    const [road, x, z, view, reverse] = VIEWS[name];
    const stats = await page.evaluate(async ([road, x, z, view, reverse]) => {
      const s = window.__slice;
      s.rig.view = view;
      s.placeOnRoad(road, x, z, reverse);
      await new Promise((r) => setTimeout(r, 700));
      const i = s.renderer.info.render;
      return { calls: i.calls, tris: i.triangles, ms: +s.frameMs().toFixed(1) };
    }, [road, x, z, view, reverse]);
    const file = `${OUT}/${look}_${name}.png`;
    await page.screenshot({ path: file });
    tiles.push({ look, name, file });
    console.log(`${look.padEnd(8)} ${name.padEnd(8)} ${JSON.stringify(stats)}`);
  }
  if (logs.length) { console.log('  ' + [...new Set(logs)].slice(0, 6).join('\n  ')); if (logs.some((l) => l.startsWith('pageerror'))) failed = true; }
  await page.close();
}
// Contact sheet: one row per look.
const tw = Number(process.env.BTB_TILE ?? 480), th = Math.round((tw * H) / W);
const sheet = await browser.newPage({ viewport: { width: tw * views.length, height: th * looks.length }, deviceScaleFactor: 1 });
await sheet.setContent(`<body style="margin:0;display:grid;grid-template-columns:repeat(${views.length},${tw}px);background:#111">${
  tiles.map((t) => `<img width="${tw}" height="${th}" src="data:image/png;base64,${fs.readFileSync(t.file).toString('base64')}">`).join('')}</body>`);
await sheet.screenshot({ path: `${OUT}/sheet.png` });
await browser.close();
console.log(`${OUT}/sheet.png`);
process.exit(failed ? 1 : 0);
