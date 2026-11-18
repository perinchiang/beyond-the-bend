import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const base = process.env.BTB_URL ?? 'http://127.0.0.1:5183/beyond-the-bend/';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });

async function checkSession(blockBoth) {
  const page = await browser.newPage();
  await page.addInitScript(blockBoth => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage || blockBoth) throw new DOMException('Storage full', 'QuotaExceededError');
      setItem.call(this, key, value);
    };
  }, blockBoth);
  const debug = new URL(base);
  debug.searchParams.set('debug', '1');
  await page.goto(debug.href);
  const act = name => page.getByRole('button', { name, exact: true }).click();
  const travel = page.locator('#travel');
  await act('Take station parcel');
  await travel.selectOption('station');
  await act('Deliver parcel');
  await page.waitForFunction(() => document.querySelector('#journal').textContent.startsWith('Session only · 100 coins'));
  await travel.selectOption('bend');
  await act('Enter hill sprint');
  await act('Start hill sprint');
  await act('Pause');
  assert.match(await page.locator('#journal').innerText(), /Session only · 100 coins.*Station parcel delivered/);
  await act('Buy Field Scout · 60 coins');
  await act('Return to the village');
  await page.reload();
  await page.getByRole('button', { name: 'Take station parcel' }).waitFor();
  await act('Pause');
  assert.match(await page.locator('#journal').innerText(), /Session only · 40 coins · Field Scout.*Station parcel delivered/);
  await page.close();
}

// Drive the real frame loop at 10 Hz while controlling wall time, including time in the pause menu.
async function checkClock() {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const nativeFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => {
      if (window.__btb?.ready) {
        window.nextGameFrame = callback;
        return 1;
      }
      return nativeFrame(callback);
    };
  });
  const url = new URL(base);
  url.searchParams.set('route', 'circuit');
  url.searchParams.set('stats', '1');
  await page.goto(url.href);
  await page.waitForFunction(() => window.nextGameFrame, null, { polling: 50 });
  const result = await page.evaluate(async () => {
    const { car } = window.__btb;
    let now = performance.now();
    Object.defineProperty(performance, 'now', { value: () => now });
    const frame = () => { now += 100; window.nextGameFrame(now); };
    frame();
    const update = car.update.bind(car);
    let simulated = 0, longestStep = 0;
    car.update = (dt, ...args) => {
      simulated += dt;
      longestStep = Math.max(longestStep, dt);
      return update(dt, ...args);
    };
    document.querySelector('#road-action').click();
    for (let i = 0; i < 10; i++) frame();
    document.querySelector('#pause-toggle').click();
    for (let i = 0; i < 30; i++) frame();
    const dialog = document.querySelector('#pause-menu');
    const closed = new Promise(resolve => dialog.addEventListener('close', resolve, { once: true }));
    document.querySelector('#resume-drive').click();
    await closed;
    for (let i = 0; i < 10; i++) frame();
    return { simulated, longestStep, race: document.querySelector('#destination').textContent,
      stats: document.querySelector('#stats').textContent };
  });
  assert.ok(Math.abs(result.simulated - 2) < 1e-6, JSON.stringify(result));
  assert.ok(result.longestStep <= 1 / 60 + 1e-8);
  assert.match(result.race, /Gate 1\/3 · 2\.0 s/);
  assert.match(result.stats, /^10 fps/);
  await page.close();
}

try {
  await checkSession(false);
  await checkSession(true);
  await checkClock();
  console.log('Temporary logbook across maps and reloads, 10 fps driving, sprint timing and pause passed.');
} finally {
  await browser.close();
}
