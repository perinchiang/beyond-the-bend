// Graybox map check: build the world headless, print what the roads are, fail on broken geometry.
//   node tools/slice-world.mjs
import { build } from 'vite';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
await build({ configFile: false, logLevel: 'error', build: { target: 'es2022', outDir: 'test-results/slice-world', emptyOutDir: true, lib: { entry: 'tools/slice-world-metrics.ts', formats: ['es'], fileName: 'metrics' }, minify: false } });
const m = await import(pathToFileURL(path.resolve('test-results/slice-world/metrics.js')).href);
const { world, buildMs } = m.buildWorld();
const report = m.networkReport(world);
console.log(`world built in ${buildMs} ms · ${world.trees.length} trees · ${report.reduce((a, r) => a + r.lengthM, 0) / 1000} km of road\n`);
for (const r of report) {
  console.log(`${r.id.padEnd(12)} ${String(r.lengthM).padStart(6)} m · height ${r.minY}..${r.maxY} m · max grade ${r.maxGradePct}% · on/near other roads ${r.junctionM} m`);
  if (r.straights.length) console.log(`  straights ≥300 m: ${r.straights.join(', ')}`);
  const kinds = {};
  for (const b of r.bends) (kinds[b.kind] ??= []).push(`R${b.r}/${Math.abs(b.deg)}°${b.deg > 0 ? 'L' : 'R'}`);
  for (const [k, v] of Object.entries(kinds)) console.log(`  ${k.padEnd(11)} ${v.join(' ')}`);
  for (const e of r.ends) console.log(`  end on ${e.on}: ${e.offset} m off its centre line, height step ${e.step} m`);
}
const by = Object.fromEntries(report.map((r) => [r.id, r]));
assert.ok(by.ring.straights[0] >= 2000, 'the ring has a straight of at least 2 km');
assert.ok(by.ring.straights[1] >= 1500, 'and a second of at least 1.5 km');
assert.ok(by.ring.bends.every((b) => b.r >= 160), 'every ring bend can be taken with a lift or a light brake');
assert.ok(by.pass.bends.filter((b) => b.r <= 80).length >= 12, 'the pass is a run of tight bends');
assert.ok(by.pass.bends.filter((b) => b.kind === 'hairpin').length === 2, 'with two hairpins');
for (const r of report) {
  assert.ok(r.minY >= 2, `${r.id} stays above the water`);
  assert.ok(r.maxGradePct <= (r.id.startsWith('pass') ? 13 : 9), `${r.id}: grade ${r.maxGradePct}% is within limits`);
  for (const e of r.ends) {
    assert.ok(e.offset < 0.6, `${r.id} ends on the centre line of ${e.on} (off by ${e.offset} m)`);
    assert.ok(Math.abs(e.step) < 0.03, `${r.id} meets ${e.on} without a step (${e.step} m)`);
  }
}
console.log('\nmap checks passed\n');

// Drive it. The driver is a simple road follower; what matters is whether each road can be
// driven the way it was designed, not the lap time.
const show = (label, r) => console.log(`${label.padEnd(26)} ${r.finished ? 'finished' : 'DID NOT FINISH'} in ${r.seconds} s · avg ${r.avgKmh} top ${r.topKmh} min ${r.minKmh} km/h · `
  + `max ${r.maxOffsetM} m from centre, ${r.offPavementS} s off the pavement · hardest brake ${r.maxBrake} · air ${r.airS} s (longest ${r.longestAirS})${r.resets ? ` · ${r.resets} RESETS` : ''}`);
const bendsLine = (r) => console.log('  ' + r.bends.map((b) => `R${b.r}:${b.entryKmh}→${b.minKmh}${b.brake ? ` b${b.brake}` : ''}`).join('  '));
const road = (id) => world.road(id);
const runs = {
  ringBrisk: m.driveRoad(world, road('ring'), 1),
  ringGentle: m.driveRoad(world, road('ring'), 1, m.GENTLE),
  ringGentleBack: m.driveRoad(world, road('ring'), -1, m.GENTLE, 0.5),
  meridian: m.driveRoad(world, road('meridian'), 1),
  lakeside: m.driveRoad(world, road('lakeside'), 1),
  lakesideBack: m.driveRoad(world, road('lakeside'), -1),
  passUp: m.driveRoad(world, road('pass'), 1),
  passDown: m.driveRoad(world, road('pass'), -1),
};
show('ring, brisk', runs.ringBrisk); bendsLine(runs.ringBrisk);
show('ring, lift/light brake', runs.ringGentle); bendsLine(runs.ringGentle);
show('ring reversed, light brake', runs.ringGentleBack);
show('meridian (jump)', runs.meridian);
show('lakeside gravel', runs.lakeside);
show('lakeside gravel, reversed', runs.lakesideBack);
show('pass, entry to north', runs.passUp); bendsLine(runs.passUp);
show('pass, reversed', runs.passDown);
for (const [name, r] of Object.entries(runs)) {
  assert.ok(r.finished && r.resets === 0, `${name}: the driver gets to the end without being put back on the road`);
  assert.ok(r.offPavementS < 1.5, `${name}: stays on the pavement (${r.offPavementS} s off)`);
}
assert.ok(runs.ringBrisk.topKmh >= 215, `the south straight is long enough to reach top speed (${runs.ringBrisk.topKmh} km/h)`);
assert.ok(runs.ringGentle.maxBrake <= 0.35 && runs.ringGentleBack.maxBrake <= 0.35, 'the whole ring can be lapped with nothing more than a light brake');
assert.ok(runs.ringGentle.minKmh >= 140, `and never drops below 140 km/h doing so (${runs.ringGentle.minKmh})`);
assert.ok(runs.meridian.longestAirS >= 0.5, `the jump on the meridian throws the car (${runs.meridian.longestAirS} s)`);
assert.ok(runs.passUp.minKmh <= 60, 'the pass has corners that need real braking');
assert.ok(runs.passUp.longestAirS < 0.3 && runs.passDown.longestAirS < 0.3, `nothing on the pass launches the car by accident (${runs.passUp.longestAirS} / ${runs.passDown.longestAirS} s)`);
assert.ok(runs.lakeside.longestAirS < 0.3 && runs.ringBrisk.longestAirS < 1.3, 'the only air on the ring is the marked jump');
console.log('\ndriving checks passed');
