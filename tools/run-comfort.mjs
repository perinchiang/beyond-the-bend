import { build } from 'vite';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
await build({ configFile: false, logLevel: 'error', build: { target: 'es2022', outDir: 'test-results/comfort', emptyOutDir: true, lib: { entry: 'tools/comfort-metrics.ts', formats: ['es'], fileName: 'metrics' }, minify: false } });
const { cameraMetrics, terrainMetrics } = await import(pathToFileURL(path.resolve('test-results/comfort/metrics.js')).href);
const camera = cameraMetrics();
const terrain = terrainMetrics();
for (const [name, m] of Object.entries(camera)) {
  assert.equal(m.maxLag, 0, name + ' horizontal camera lag');
  if (name.startsWith('drive/')) {
    assert.ok(m.peakRate <= 48.01, name + ' yaw rate bound');
    assert.ok(m.peakAccel <= 42.1, name + ' yaw acceleration bound');
  }
}
for (const name of ['drive/gentle', 'drive/sharp', 'drive/esses']) assert.ok(camera[name].aheadVisible[35] >= .99, name + ' upcoming road visibility');
assert.ok(camera['drive/sharp'].totalYaw <= 90, 'camera rotation stays within the sharp corner angle');
assert.ok(Math.abs(terrain.meanBowl12m) < .1, 'mean roadside cross-section');
assert.ok(terrain.maxBowl12m.bowl < .2, 'maximum 12m roadside bowl');
assert.equal(terrain.bothRaisedOver25cm, 0, 'raised verges on both sides');
console.log(JSON.stringify({ camera, terrain }, null, 2));
