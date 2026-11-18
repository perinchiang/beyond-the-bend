// Exercise the map and travel menu in the actual renderer, including cross-map loads.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const base = process.env.BTB_URL ?? 'http://127.0.0.1:5183/beyond-the-bend/';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 812, height: 375 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const ready = () => page.waitForFunction(() => window.__btb?.car.isReady && !document.querySelector('#travel').disabled);
  await page.goto(base);
  await ready();
  assert.ok(await page.locator('#travel').isHidden());
  assert.ok(await page.locator('#pause-toggle').isVisible());
  const debug = new URL(base);
  debug.searchParams.set('debug', '1');
  await page.goto(debug.href);
  await ready();
  const marker = page.locator('#map-car');
  const initial = await marker.getAttribute('transform');
  const road = await page.locator('#map-road').getAttribute('d');
  assert.ok(road.length > 100);
  const version = await page.locator('#build-id').textContent();
  if (process.env.BTB_BUILD) assert.equal(version, 'Build ' + process.env.BTB_BUILD);
  const map = page.locator('#map-toggle');
  await map.click();
  await map.focus();
  await page.keyboard.press('Space');
  assert.equal(await map.getAttribute('aria-expanded'), 'true', 'focused Map keeps keyboard activation');
  await page.keyboard.down('w');
  await page.waitForFunction(() => Number(document.querySelector('#speed').textContent) > 5);
  await page.keyboard.up('w');
  await page.keyboard.down('Space');
  await page.waitForFunction(() => window.__btb.car.speed === 0, null, { timeout: 2500 });
  await page.keyboard.up('Space');
  assert.equal(await map.getAttribute('aria-expanded'), 'true', 'braking after driving leaves Map open');
  assert.notEqual(await marker.getAttribute('transform'), initial);
  await page.locator('#map-toggle').tap();
  assert.ok(await page.locator('#map-panel').isHidden());
  assert.ok(await page.locator('#speed').isVisible());
  await page.locator('#map-toggle').tap();
  for (const [width, height] of [[812, 375], [568, 320], [320, 568]]) {
    await page.setViewportSize({ width, height });
    const controls = ['#drive-hud', '#travel', '#pause-toggle', '.touch-steering', '.touch-pedals'];
    const boxes = await Promise.all(controls.map(id => page.locator(id).boundingBox()));
    for (const [i, a] of boxes.entries()) {
      assert.ok(a && a.x >= 0 && a.y >= 0 && a.x + a.width <= width && a.y + a.height <= height, controls[i]);
      for (const b of boxes.slice(i + 1)) {
        assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, 'overlapping controls: ' + controls[i]);
      }
    }
  }
  const travel = page.locator('#travel');
  await travel.selectOption('station');
  await page.waitForFunction(() => document.querySelector('#destination').textContent.includes('village post office'));
  await page.waitForFunction(() => {
    const { track, scene } = window.__btb;
    const town = track.at(29);
    return document.querySelector('#station-pin').getAttribute('transform') === `translate(${town.x} ${town.z})`
      && scene.getObjectByName('road-guide').count > 0;
  });
  await travel.selectOption('bend');
  await page.waitForFunction(() => document.querySelector('#destination').textContent === 'Old hill road');
  await travel.selectOption('circuit');
  await page.waitForURL(url => url.searchParams.get('route') === 'circuit');
  await ready();
  assert.notEqual(await page.locator('#map-road').getAttribute('d'), road);
  await page.waitForFunction(() => document.querySelector('#destination').textContent.startsWith('Hill sprint'));
  await travel.selectOption('town');
  await page.waitForURL(url => !url.searchParams.has('route'));
  await ready();
  assert.equal(await page.locator('#map-road').getAttribute('d'), road);
  await page.keyboard.press('h');
  assert.ok(await travel.isHidden() && await page.locator('#drive-hud').isHidden());
  assert.deepEqual(errors, []);
  console.log(version, '— speed, live map, collapse, travel, both routes and three touch layouts passed');
} finally {
  await browser.close();
}
