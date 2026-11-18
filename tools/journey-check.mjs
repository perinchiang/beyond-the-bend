import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-angle=metal', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage({ viewport: { width: 812, height: 375 }, hasTouch: true, isMobile: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const ready = () => page.waitForFunction(() => window.__btb?.car.isReady);
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('btb-journey-v1')));
  const go = (s) => page.evaluate((s) => window.__btb.view({ s, mode: 'drive' }), s);
  const act = (label) => page.getByRole('button', { name: label, exact: true }).click();
  async function changeMap(label, region) {
    await act(label);
    await page.waitForURL((url) => url.searchParams.get('route') === region);
    await ready();
  }
  async function saveMatches(values) {
    await page.waitForFunction((values) => {
      const saved = JSON.parse(localStorage.getItem('btb-journey-v1'));
      return Object.entries(values).every(([k, v]) => saved?.[k] === v);
    }, values);
  }

  await page.goto(process.env.BTB_URL ?? 'http://127.0.0.1:5183/beyond-the-bend/');
  await ready();
  if (process.env.BTB_BUILD)
    assert.equal(await page.locator('#build-id').textContent(), 'Build ' + process.env.BTB_BUILD);
  await act('Take station parcel');
  await saveMatches({ job: 'parcel' });
  await page.reload();
  await ready();
  await saveMatches({ job: 'parcel' });
  await go(335);
  await act('Deliver parcel');
  await saveMatches({ delivered: true, coins: 100, job: null });
  await page.reload();
  await ready();
  await go(335);
  await page.getByRole('button', { name: 'Take village mail' }).waitFor();
  assert.equal((await state()).coins, 100);
  await act('Pause');
  await act('Buy Field Scout · 60 coins');
  await act('Touring engine · 40 coins');
  await saveMatches({ coins: 0, scout: true, equipped: true, tuned: true });
  await page.locator('#guide-toggle').uncheck();
  await saveMatches({ guide: false });
  await page.locator('#guide-toggle').check();
  await act('Resume drive');
  await act('Take village mail');
  await go(29);
  await act('Deliver timetables');
  await saveMatches({ coins: 35, job: null });
  for (const [i, s] of [78, 103, 154].entries()) {
    await go(s);
    await saveMatches({ rice: i + 1 });
  }
  await changeMap('Enter Cedar Pass', 'forest');
  const passes = [
    ['Enter Snowbell Ridge', 'snow'],
    ['Enter Glacier Shelf', 'glacier'],
    ['Enter Ember Caldera', 'volcano'],
    ['Enter Market Town', 'market'],
    ['Enter Sunset Arcade', 'arcade'],
    ['Back to village', null],
  ];
  for (const [label, region] of passes) {
    // Drive the entire outward leg against the production surface and vehicle physics.
    const run = await page.evaluate(() => {
      const { car, track, hf } = window.__btb;
      let s = 0,
        maxDistance = 0,
        steps = 0;
      for (; s < track.length * 0.42 - 1 && steps < 12000; steps++) {
        const p = track.at(s);
        const forward = (car.x - p.x) * p.tx + (car.z - p.z) * p.tz;
        s += Math.max(-0.4, Math.min(0.5, forward));
        const q = track.at(s + 5.5);
        const angle = Math.atan2(q.x - car.x, q.z - car.z) - car.heading;
        const steer = Math.max(-1, Math.min(1, 2.4 * Math.atan2(Math.sin(angle), Math.cos(angle))));
        car.update(1 / 60, { throttle: car.speed < 10 ? 0.75 : 0.25, steer, brake: false });
        maxDistance = Math.max(maxDistance, hf.roadDist(car.x, car.z));
      }
      car.speed = 0;
      return { region: track.region, s, steps, maxDistance };
    });
    assert.ok(run.steps < 12000 && run.maxDistance < 3.3, JSON.stringify(run));
    console.log(run.region, Math.round(run.s) + ' m', 'maximum road offset', run.maxDistance.toFixed(2) + ' m');
    await changeMap(label, region);
  }
  await saveMatches({ rice: 3, visits: 6, coins: 35, equipped: true });
  await go(227);
  await changeMap('Enter hill sprint', 'circuit');
  await act('Start hill sprint');
  for (const [i, f] of [0.08, 0.16, 0.24].entries()) {
    await go(await page.evaluate((f) => window.__btb.track.length * f, f));
    if (i < 2)
      await page.waitForFunction(
        (i) => document.querySelector('#destination').textContent.startsWith('Gate ' + (i + 2)),
        i,
      );
  }
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('btb-journey-v1')).best > 0);
  assert.deepEqual(errors, []);
  console.log(
    'Parcel, return mail, reload, purchases, rice gates, six regional routes and hill sprint passed.',
  );
} finally {
  await browser.close();
}
