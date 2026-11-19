// Graybox car handling: measures the force-based vehicle (src/slice/vehicle) on analytic test
// grounds and fails if it stops meeting the driving targets. No browser needed.
//   node tools/slice-handling.mjs            report + checks
//   node tools/slice-handling.mjs --only=jump,drift   run some groups (no pass/fail summary for the rest)
import { build } from 'vite';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

await build({ configFile: false, logLevel: 'error', build: { target: 'es2022', outDir: 'test-results/slice-handling', emptyOutDir: true, lib: { entry: 'tools/slice-handling-metrics.ts', formats: ['es'], fileName: 'metrics' }, minify: false } });
const m = await import(pathToFileURL(path.resolve('test-results/slice-handling/metrics.js')).href);
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const want = (g) => !only.length || only.includes(g);

const fails = [];
let checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) fails.push(msg); };
const within = (v, a, b, msg) => ok(v >= a && v <= b, `${msg} — got ${v}, want ${a}..${b}`);
const show = (title, rows) => {
  console.log(title);
  for (const [name, v] of Object.entries(rows)) console.log('  ' + name.padEnd(34) + Object.entries(v).map(([a, b]) => `${a} ${b}`).join(' · '));
};

if (want('rest')) {
  const rest = m.atRest();
  show('at rest', { 'standing still 2 s': rest });
  within(rest.originY, -0.01, 0.01, 'model origin sits on the ground at rest');
  within(rest.wheelY, 0.325, 0.345, 'wheel centre at wheel-radius height');
  ok(rest.creepM < 0.02, 'does not creep on flat ground');
}

if (want('straight')) {
  const s = m.straightLine(), lift = m.liftOff(), gravel = m.straightLine(m.GRAVEL);
  show('1-2 straight line', { asphalt: s, 'lift at 180 km/h': lift, gravel });
  within(s.topKmh, 225, 235, 'top speed');
  within(s.zeroTo100S, 5, 6, '0-100 km/h');
  within(s.from100To200S, 14, 20, '100-200 km/h');
  ok(s.brake100M <= 40 && s.brake100DevM < 0.3, `100-0 within 40 m and straight — ${s.brake100M} m, ${s.brake100DevM} m off line`);
  ok(s.brake200M <= 160 && s.brake200DevM < 0.5, `200-0 within 160 m and straight — ${s.brake200M} m`);
  within(lift.liftG, 0.2, 0.35, 'lifting at 180 km/h slows the car');
  ok(gravel.topKmh >= 180, `gravel top speed at least 180 km/h — ${gravel.topKmh}`);
}

if (want('grip')) {
  const g40 = m.maxLateral(40), g110 = m.maxLateral(110), k420 = m.keyboardRing(420), k110 = m.keyboardRing(110, 132), a110 = m.keyboardRing(110);
  show('3 grip on rings', { 'max, R=40': g40, 'max, R=110': g110, 'keys, R=420 flat out': k420, 'keys, R=110 at 132': k110, 'keys, R=110 flat out': a110 });
  within(g40.maxLatG, 1.15, 1.45, 'max lateral g, R=40');
  within(g110.maxLatG, 1.15, 1.45, 'max lateral g, R=110');
  ok(k420.avgKmh >= 200 && k420.worstLaneErrM <= 2.5, `keys hold R=420 flat out at 200+ km/h within 2.5 m — ${k420.avgKmh} km/h, ${k420.worstLaneErrM} m`);
  ok(k110.avgKmh >= 125 && k110.avgKmh <= 140 && k110.worstLaneErrM <= 2.5, `keys hold R=110 at 125-140 km/h within 2.5 m — ${k110.avgKmh} km/h, ${k110.worstLaneErrM} m`);
}

if (want('bends')) {
  const lift = m.bend(260, 60, 215, 'lift', 150), brake = m.bend(175, 70, 220, 'brake', 170);
  const liftK = m.bend(260, 60, 215, 'lift', 150, true), brakeK = m.bend(175, 70, 220, 'brake', 170, true);
  show('4 design-speed bends', { 'R=260 60°, lift 150 m before': lift, 'R=175 70°, 35% brake 170 m before': brake, 'same, keys: R=260': liftK, 'same, keys: R=175': brakeK });
  ok(lift.worstLaneErrM <= 4, `R=260 bend from 215 km/h on a lift stays within 4 m — ${lift.worstLaneErrM}`);
  ok(brake.worstLaneErrM <= 4, `R=175 bend from 220 km/h on a light brake stays within 4 m — ${brake.worstLaneErrM}`);
  ok(liftK.worstLaneErrM <= 4 && brakeK.worstLaneErrM <= 4, `the same two bends on keys stay within 4 m — ${liftK.worstLaneErrM}, ${brakeK.worstLaneErrM}`);
}

if (want('keys')) {
  const taps = { '150 km/h, 80 ms tap': m.tap(150, 80), '150 km/h, 150 ms tap': m.tap(150, 150), '150 km/h, 400 ms press': m.tap(150, 400), '80 km/h, 150 ms tap': m.tap(80, 150), '220 km/h, 150 ms tap': m.tap(220, 150) };
  const held = { '100 km/h held': m.heldKey(100), '200 km/h held': m.heldKey(200) };
  show('5 keyboard taps and held keys', { ...taps, ...held });
  ok(taps['150 km/h, 80 ms tap'].sidewaysM < 0.8, 'an 80 ms tap at 150 km/h moves the car less than 0.8 m');
  ok(taps['150 km/h, 150 ms tap'].sidewaysM < 2, 'a 150 ms tap at 150 km/h moves the car less than 2 m');
  ok(taps['150 km/h, 400 ms press'].sidewaysM > 2.5, 'a long press still changes lane');
  const h = held['200 km/h held'];
  ok(h.maxSideslipDeg < 8, `a held key at 200 km/h never spins the car — sideslip ${h.maxSideslipDeg}°`);
  ok(h.straightenS <= 0.7 && h.overshoots <= 1, `straightens within 0.7 s of release, at most one overshoot — ${h.straightenS} s, ${h.overshoots}`);
  ok(h.to90pctS <= 0.6, `a held key responds within 0.6 s — ${h.to90pctS}`);
}

if (want('stability')) {
  const s = m.highSpeedStability();
  show('6 high-speed stability', { '220 km/h, hands off, 20 s': s });
  ok(s.headingRmsDeg < 0.5 && s.driftM < 6, `hands off at 220 km/h over ripples: heading wobble under 0.5°, little drift — ${s.headingRmsDeg}°, ${s.driftM} m`);
}

if (want('drift')) {
  const d = m.drift(), dh = m.drift(undefined, 0.6), e = m.driftEsses(), f = m.forgiveness();
  show('7-8 drifting and forgiveness', { 'handbrake, then key held + throttle': d, 'same on 60% throttle': dh, 'R=40 esses with handbrake flicks': e, 'left at 60° sideslip, no input': f });
  ok(d.to20degS > 0 && d.to20degS <= 0.7, `handbrake + steer reaches 20° of slide within 0.7 s — ${d.to20degS}`);
  ok(d.inBandS >= 2 && d.maxDeg < 80, `the slide is held at 15-45° for 2 s without spinning — ${d.inBandS} s, max ${d.maxDeg}°`);
  ok(d.recoverS > 0 && d.recoverS <= 1.5, `straight again within 1.5 s of letting go — ${d.recoverS}`);
  ok(dh.maxDeg < 80, `part throttle does not spin it either — ${dh.maxDeg}°`);
  ok(e.finished && e.maxSideslipDeg < 80 && e.worstLaneErrM <= 6.5, `slides through the R=40 esses without spinning or leaving the verge — max ${e.maxSideslipDeg}°, ${e.worstLaneErrM} m`);
  ok(f.straightS > 0 && f.straightS <= 2.5 && !f.endedBackwards, `recovers from 60° with no input within 2.5 s — ${f.straightS} s`);
}

if (want('jump')) {
  const j160 = m.jump(160), j200 = m.jump(200), j225 = m.jump(225), sl = m.slopes();
  show('9 crest and slopes', { 'crest at 160 km/h': j160, 'crest at 200 km/h': j200, 'crest at 225 km/h': j225, slopes: sl });
  // The first target here (40-70 m) came from a ballistic estimate that ignored suspension
  // droop and downforce, both of which keep the wheels down for the first part of the crest.
  within(j200.airM, 25, 70, 'flight at 200 km/h');
  ok(j200.pitchMinDeg >= -12 && j200.pitchMaxDeg <= 12, `pitch stays within ±12° in the air — ${j200.pitchMinDeg}..${j200.pitchMaxDeg}`);
  ok(j200.speedLostPct < 12, `loses under 12% speed — ${j200.speedLostPct}`);
  ok(j200.hops === 0 && j200.rebounds <= 2, `lands and settles within one rebound — hops ${j200.hops}, swings ${j200.rebounds}`);
  ok(j200.offLineM < 1 && j200.headingDeg < 2, `needs no steering after landing — ${j200.offLineM} m, ${j200.headingDeg}°`);
  ok(j225.hops === 0 && j225.speedLostPct < 12 && j225.pitchMinDeg >= -12, 'the same at 225 km/h');
  ok(sl.slide10pctNoseUpM < 0.1 && sl.slide10pctSidewaysM < 0.1, `holds on a 10% slope — ${sl.slide10pctNoseUpM} m, ${sl.slide10pctSidewaysM} m in 5 s`);
  ok(sl.climb12pctAfter8sKmh > 80, `climbs a 12% grade — ${sl.climb12pctAfter8sKmh} km/h after 8 s`);
}

if (want('grass')) {
  const g = m.grass();
  show('10 grass', { 'off the asphalt at 150 km/h': g });
  within(g.oneSecondLostPct, 5, 15, 'a second on the grass costs');
  ok(g.oneSecondPeakDecelG < 0.6 && g.firstMetresDecelG < 0.25, `no yank — peak ${g.oneSecondPeakDecelG} g, ${g.firstMetresDecelG} g in the first metres`);
  ok(g.steerLatG > 0.3, `still steers on grass — ${g.steerLatG} g`);
  ok(g.clip03sLostPct < 3, `clipping the grass costs little — ${g.clip03sLostPct}%`);
}

if (want('obstacle')) {
  const head = m.obstacle(0), glance = m.obstacle(1.0), rob = m.robustness();
  show('11-12 obstacles and robustness', { 'head-on, 80 km/h': head, 'glancing, 80 km/h': glance, 'random inputs and frame times': rob });
  ok(head.finite && head.maxHeightM < 0.2 && head.furthestZ < 40 && head.minKmh < 15, `head-on: stops, no launch, no tunnelling — z ${head.furthestZ}, height ${head.maxHeightM}`);
  ok(glance.finite && glance.endKmh > 30 && glance.headingDeg < 60 && glance.maxHeightM < 0.2, `glancing: deflects and keeps moving — ${glance.endKmh} km/h, ${glance.headingDeg}°`);
  ok(rob.finite && rob.maxSpeedKmh < 400 && rob.maxHeightM < 60, `random inputs for 60 s stay finite and sane — ${rob.maxSpeedKmh} km/h`);
}

if (want('gravel')) {
  const gb = m.gravelBend(), gd = m.drift(m.GRAVEL), gm = m.maxLateral(120, m.GRAVEL);
  show('gravel', { 'R=120 at 100 km/h: lift, turn in, drive out': gb, 'handbrake drift on gravel': gd, 'max grip, R=120': gm });
  within(gb.maxSideslipDeg, 8, 30, 'gravel bend slide angle');
  ok(gb.slidingS >= 1 && !gb.spun && gb.worstLaneErrM <= 3.25, `the slide is held on the road without spinning — ${gb.slidingS} s, ${gb.worstLaneErrM} m`);
  ok(gb.straightAfterExitS > 0 && gb.straightAfterExitS < 2, `straight within 2 s of the exit — ${gb.straightAfterExitS}`);
}

if (want('mountain')) {
  const a = m.hairpin(false), b = m.hairpin(true), c = m.climbEsses(false), ck = m.climbEsses(true);
  show('mountain', { 'hairpin R=22 150°, brake and steer': a, 'hairpin, handbrake from 70': b, '9% climb, R=55 esses, stick': c, '9% climb, R=55 esses, keys': ck });
  ok(a.worstLaneErrM <= 3.25 && a.exit3sKmh > 60, `hairpin on the brakes: on the road, pulls away — ${a.worstLaneErrM} m, ${a.exit3sKmh} km/h`);
  ok(b.worstLaneErrM <= 3.25 && b.exit3sKmh > 60, `hairpin on the handbrake: on the road, pulls away — ${b.worstLaneErrM} m, ${b.exit3sKmh} km/h`);
  ok(c.finished && c.minKmh >= 75 && c.worstLaneErrM <= 3.25, `climbing esses hold 75+ km/h on the road — min ${c.minKmh}, ${c.worstLaneErrM} m`);
  ok(ck.finished && ck.worstLaneErrM <= 3.25, `the same on keys stays on the road — ${ck.worstLaneErrM} m`);
}

console.log('');
if (fails.length) {
  console.log(`${fails.length} of ${checks} checks failed:`);
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log(`slice handling: ${checks} checks passed`);
