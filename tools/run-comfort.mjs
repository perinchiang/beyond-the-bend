import { build } from 'vite';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
await build({ configFile: false, logLevel: 'error', build: { target: 'es2022', outDir: 'test-results/comfort', emptyOutDir: true, lib: { entry: 'tools/comfort-metrics.ts', formats: ['es'], fileName: 'metrics' }, minify: false } });
const { cameraMetrics, terrainMetrics, lensMetrics } = await import(pathToFileURL(path.resolve('test-results/comfort/metrics.js')).href);
const camera = cameraMetrics();
const terrain = terrainMetrics();
for (const [name, m] of Object.entries(camera)) {
  assert.equal(m.maxLag, 0, name + ' horizontal camera lag');
  // one damped spring: never faster than the car turns, never abrupt, never past the car
  if (name.startsWith('drive/')) {
    assert.ok(m.peakRate <= m.carPeakRate + 0.01, name + ' view never turns faster than the car');
    assert.ok(m.peakAccel <= 75, name + ' yaw acceleration');
    assert.ok(Math.abs(m.finalYawError) < 22, name + ' car stays near the view axis');
  }
}
for (const name of ['drive/gentle', 'drive/sharp', 'drive/esses']) assert.ok(camera[name].aheadVisible[35] >= .99, name + ' upcoming road visibility');
assert.ok(camera['drive/sharp'].totalYaw <= 90.05, 'camera turns through the corner once, without overshoot');
assert.ok(camera['drive/straight'].totalYaw === 0, 'no view rotation on a straight');
assert.ok(Math.abs(terrain.meanBowl12m) < .1, 'mean roadside cross-section');
assert.ok(terrain.maxBowl12m.bowl < .2, 'maximum 12m roadside bowl');
assert.equal(terrain.bothRaisedOver25cm, 0, 'raised verges on both sides');
// The lens: land must recede (drawn smaller with distance) and a turn must read as a pan,
// not as a turntable. The parallel projection it replaces is measured alongside for contrast.
const lens = lensMetrics(), flat = lensMetrics(true);
for (const [name, m] of Object.entries(lens)) {
  assert.ok(Math.abs(flat[name].farScale - 1) < 1e-3, name + ' flat-lens reference draws far and near alike');
  assert.ok(m.farScale < 0.7, name + ' far ground is drawn smaller than near ground');
  assert.ok(m.edgeSwing < flat[name].edgeSwing * 0.9, name + ' screen edges sweep less in a turn than under the flat lens');
  assert.ok(m.reachAhead > flat[name].reachAhead, name + ' sees further ahead than the flat lens');
}
assert.ok(lens.Close.reachAhead > 100, 'Close view looks out over the countryside');
console.log(JSON.stringify({ camera, lens, flatLensReference: flat, terrain }, null, 2));
