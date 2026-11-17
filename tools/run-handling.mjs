// Vehicle handling: measures what a key tap, a held key and a trip onto the grass do, drives
// laps with a tap-steering keyboard driver, and fails if the car stops being forgiving.
//   npm run test:handling            report + assertions
//   node tools/run-handling.mjs --search   also let the driver re-tune itself (slow; for tuning work)
import { build } from 'vite';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
await build({ configFile: false, logLevel: 'error', build: { target: 'es2022', outDir: 'test-results/handling', emptyOutDir: true, lib: { entry: 'tools/handling-metrics.ts', formats: ['es'], fileName: 'metrics' }, minify: false } });
const m = await import(pathToFileURL(path.resolve('test-results/handling/metrics.js')).href);
const search = process.argv.includes('--search');
const report = {
  track: m.trackCorners(),
  straight: m.straightLine(),
  tap: m.tapResponse(),
  hold: m.holdResponse(),
  grass: m.grassExcursion(),
  lapCareful: search ? m.bestKeyboardLap(7) : m.keyboardLap(7, 0.2, 0.8, 4, 0.7),
  lapBrisk: search ? m.bestKeyboardLap(11) : m.keyboardLap(11, 0.2, 0.8, 4, 1.0),
  lapSlowReactions: search ? m.bestKeyboardLap(9, 0.3) : m.keyboardLap(9, 0.3, 0.8, 4, 1.0),
  lapNeverLifts: m.keyboardLap(Infinity),
};
const row = (v) => Object.entries(v).map(([a, b]) => `${a} ${b}`).join(' · ');
for (const [k, v] of Object.entries(report)) {
  console.log(k);
  if (typeof Object.values(v)[0] === 'object') for (const [n, r] of Object.entries(v)) console.log('  ' + n.padEnd(30), row(r));
  else console.log('  ' + row(v));
}

const { tap, hold, grass, straight } = report;
// Straight-line performance is not part of this work and must not drift.
assert.ok(Math.abs(straight.topSpeed - 27.4) < 0.3, 'top speed on asphalt');
assert.ok(Math.abs(straight.zeroTo20S - 2.92) < 0.1, 'acceleration');
assert.ok(Math.abs(straight.brakeFromTopM - 8) < 0.5, 'braking');

// 1. Steering. A tap is a nudge, the same nudge at any speed; a held key still turns hard.
for (const v of [15, 22, 27]) {
  assert.ok(tap[`${v}m/s tap 80ms`].sidewaysAfter1s < 0.6, `${v} m/s: a quick tap moves the car less than 0.6 m`);
  assert.ok(tap[`${v}m/s tap 150ms`].sidewaysAfter1s < 1.5, `${v} m/s: a normal tap stays well inside the lane`);
  assert.ok(tap[`${v}m/s tap 150ms`].headingDeg < 6, `${v} m/s: a normal tap turns the car less than 6 degrees`);
  assert.ok(tap[`${v}m/s tap 300ms`].sidewaysAfter1s > 2, `${v} m/s: a long press still changes lane`);
}
const nudges = [15, 22, 27].map((v) => tap[`${v}m/s tap 150ms`].sidewaysAfter1s);
assert.ok(Math.max(...nudges) / Math.min(...nudges) < 1.2, 'the same tap gives the same nudge across speeds');
for (const [v, h] of Object.entries(hold)) {
  assert.ok(h.yawDegS <= 85, `${v}: a held key never spins the car faster than 85 deg/s`);
  assert.ok(h.latG <= 2.2, `${v}: cornering stays within the grip budget`);
  assert.ok(h.to90pct <= 0.4, `${v}: full response within 0.4 s — not sluggish`);
  assert.ok(h.straightenS <= 0.3, `${v}: straightens promptly on release`);
}
assert.ok(hold['12m/s'].radiusM < report.track.tightestRadiusM, 'the tightest corner can still be taken at 12 m/s');
assert.ok(hold['20m/s'].radiusM < report.track.p05 + 0.5, 'all but the tightest 5% of the road can be taken at 20 m/s');

// 2. Grass. No wall at the road edge; a brief touch is nearly free; staying out there still costs.
for (const [name, g] of Object.entries(grass)) if (!name.startsWith('(')) {
  assert.ok(g.firstFrameLoss < 0.1, `${name}: no sudden speed drop on leaving the asphalt`);
  assert.ok(g.peakDecelG < 0.5, `${name}: grass never feels like braking`);
}
assert.ok(Math.abs(grass['two wheels on the verge 1.0s'].lostPct) < 1, 'the verge is free');
assert.ok(grass['clip the grass 0.4s'].lostPct <= 3, 'clipping the grass costs almost nothing');
assert.ok(grass['cut a corner 1.0s'].lostPct <= 12, 'cutting a corner costs little');
assert.ok(grass['cut a corner 1.0s'].backTo95pctS <= 1.5, 'and is recovered quickly back on the road');
const stay = grass['stay on grass 10s'].lostPct;
assert.ok(stay >= 25 && stay <= 45, 'staying on the grass is still clearly slower than the road');

// 3. On the real road, driven with key taps by a driver with human reaction time.
assert.ok(report.lapCareful.finished && report.lapBrisk.finished && report.lapSlowReactions.finished && report.lapNeverLifts.finished, 'laps complete');
assert.ok(report.lapCareful.offAsphaltPct < 5 && report.lapCareful.laneErrorRmsM < 1, 'a careful keyboard driver stays in lane');
assert.ok(report.lapCareful.leftRightFlipsPerLap < 60 && report.lapBrisk.leftRightFlipsPerLap < 60, 'few left-right over-corrections');
assert.ok(report.lapCareful.headingWobbleRmsDeg < 7 && report.lapBrisk.headingWobbleRmsDeg < 8, 'the car does not weave');
assert.equal(report.lapBrisk.deepGrassPct, 0, 'a brisk driver never ends up deep in the grass');
console.log('\nhandling checks passed');
