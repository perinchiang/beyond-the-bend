import { chromium } from 'playwright-core';
import fs from 'node:fs';

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const context = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${process.env.BTB_URL ?? 'http://127.0.0.1:5183/beyond-the-bend/'}?s=100`);
  await page.waitForFunction(() => window.__btb?.ready && window.__btb.car.isReady, null, { timeout: 60000 });
  const source = fs.readFileSync(new URL('./mobile-check.mjs', import.meta.url), 'utf8')
    .replace('export default async function checkMobileControls()', 'async function checkMobileControls()') + String.fromCharCode(10) + 'return await checkMobileControls();';
  const result = await page.evaluate(code => Object.getPrototypeOf(async function () {}).constructor(code)(), source);
  if (errors.length) throw new Error('Browser errors: ' + errors.join('; '));
  fs.mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/mobile-landscape.png' });
  console.log(JSON.stringify({ ...result, consoleErrors: errors }, null, 2));
} finally {
  await browser.close();
}
