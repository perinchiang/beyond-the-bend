// Objective check for "textures stay put when the camera moves".
// Renders the same world twice with the camera panned by a whole number of pixels, re-aligns
// the two frames and reports their PSNR (via ffmpeg). World-anchored, band-limited shading
// should be near-identical after re-alignment; screen-space noise or shimmering would not be.
import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const W = 1600, H = 900, SHIFT = Number(process.env.SHIFT ?? 48);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:5183/beyond-the-bend/?hud=0&dpr=1&t=20&tilt=0');
await page.waitForFunction(() => window.__btb?.ready);
fs.mkdirSync('shots', { recursive: true });
const yaw = 38, zoom = 46, x0 = 40, z0 = 96;
const mpp = zoom / H, rad = (yaw * Math.PI) / 180;
for (const [name, px] of [['a', 0], ['b', SHIFT]]) {
  const x = x0 + Math.cos(rad) * px * mpp, z = z0 - Math.sin(rad) * px * mpp;
  await page.evaluate((v) => window.__btb.view(v), { x, y: 0, z, yaw, zoom, time: 20 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `shots/stab_${name}.png` });
}
await browser.close();
// frame b shows the world shifted left by SHIFT px; compare the overlapping central region
const cw = 1000, ch = 500, cx = 300, cy = 200;
const r = spawnSync('ffmpeg', ['-hide_banner', '-i', 'shots/stab_a.png', '-i', 'shots/stab_b.png', '-lavfi',
  `[0:v]crop=${cw}:${ch}:${cx + Math.round(SHIFT)}:${cy}[a];[1:v]crop=${cw}:${ch}:${cx}:${cy}[b];[a][b]psnr`, '-f', 'null', '-'], { encoding: 'utf8' });
console.log(`pan ${SHIFT} px -> ${(r.stderr.match(/PSNR.*average:[0-9.inf]+/) ?? ['ffmpeg psnr failed'])[0]}`);
