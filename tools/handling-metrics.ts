import { Car } from '../src/vehicle/car';
import { buildTrack, ROAD_HALF_WIDTH } from '../src/world/track';
import { buildHeightField, HeightField } from '../src/world/heightfield';

/**
 * Handling measurements at a fixed 60 Hz step, with keyboard-style (all-or-nothing) inputs.
 * Everything here drives the real `Car` class; nothing is re-implemented.
 */
const DT = 1 / 60, DEG = 180 / Math.PI;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** A flat world with one straight road along +Z, for isolating the vehicle from the track. */
function straightWorld(): HeightField {
  return { height: () => 0, surface: () => 0, roadDist: (x: number) => Math.min(40, Math.abs(x)), normal: (_x, _z, out) => out.set(0, 1, 0), sdfTexture: null as never, fieldMax: 40 };
}
const newCar = (hf: HeightField) => new Car(hf, {} as never);

/** One short key tap while cruising: how far does it turn the car and push it across the road? */
export function tapResponse() {
  const out: Record<string, object> = {};
  for (const speed of [8, 15, 22, 27]) for (const tap of [0.08, 0.15, 0.3]) {
    const car = newCar(straightWorld());
    car.place(0, -140, 0); car.speed = speed;
    let peakYaw = 0, peakLat = 0, prevH = 0, x1 = 0;
    for (let i = 0; i < 90; i++) {
      car.speed = speed; // hold the speed so only steering is measured
      car.update(DT, { throttle: 1, steer: i * DT < tap ? 1 : 0, brake: false });
      const rate = (car.heading - prevH) / DT; prevH = car.heading;
      peakYaw = Math.max(peakYaw, Math.abs(rate)); peakLat = Math.max(peakLat, Math.abs(rate) * speed);
      if (i === 59) x1 = car.x;
    }
    out[`${speed}m/s tap ${Math.round(tap * 1000)}ms`] = { headingDeg: +(car.heading * DEG).toFixed(1), sidewaysAfter1s: +Math.abs(x1).toFixed(2), peakYawDegS: +(peakYaw * DEG).toFixed(0), peakLatG: +(peakLat / 9.81).toFixed(2) };
  }
  return out;
}

/** Key held down: how hard and how quickly does the car turn, and how quickly does it straighten? */
export function holdResponse() {
  const out: Record<string, object> = {};
  for (const speed of [4, 8, 12, 16, 20, 24, 27]) {
    const car = newCar(straightWorld());
    car.place(0, 0, 0);
    const rates: number[] = [];
    let prevH = 0;
    for (let i = 0; i < 240; i++) {
      car.speed = speed; car.x = 0; car.z = 0; // spin on the spot of the map, speed held
      car.update(DT, { throttle: 1, steer: i < 150 ? 1 : 0, brake: false });
      rates.push(Math.abs(wrap(car.heading - prevH)) / DT); prevH = car.heading;
    }
    const steady = rates[149];
    const t = (f: number) => rates.findIndex((r) => r >= steady * f) * DT;
    const settle = rates.slice(150).findIndex((r) => r <= steady * 0.1) * DT;
    out[`${speed}m/s`] = { yawDegS: +(steady * DEG).toFixed(0), radiusM: +(speed / steady).toFixed(1), latG: +(steady * speed / 9.81).toFixed(2), to50pct: +t(0.5).toFixed(2), to90pct: +t(0.9).toFixed(2), straightenS: +settle.toFixed(2) };
  }
  return out;
}

/** Leaving the asphalt at speed with the throttle held, then coming back. */
export function grassExcursion() {
  const out: Record<string, object> = {};
  const cases: [string, number, number][] = [
    ['two wheels on the verge 1.0s', ROAD_HALF_WIDTH + 0.3, 1.0],
    ['clip the grass 0.4s', ROAD_HALF_WIDTH + 2.5, 0.4],
    ['cut a corner 1.0s', ROAD_HALF_WIDTH + 4, 1.0],
    ['wide run-off 3.0s', ROAD_HALF_WIDTH + 8, 3.0],
    ['stay on grass 10s', ROAD_HALF_WIDTH + 12, 10],
  ];
  for (const [name, offset, secs] of cases) {
    const car = newCar(straightWorld());
    car.place(0, -150, 0);
    for (let i = 0; i < 600; i++) { car.z = -150; car.update(DT, { throttle: 1, steer: 0, brake: false }); } // settle at road top speed
    const v0 = car.speed;
    let firstStep = 0, vMin = v0, peakDecel = 0, prev = v0;
    const n = Math.round(secs / DT);
    for (let i = 0; i < n; i++) {
      car.x = offset; car.z = -150; car.heading = 0;
      car.update(DT, { throttle: 1, steer: 0, brake: false });
      if (i === 0) firstStep = v0 - car.speed;
      peakDecel = Math.max(peakDecel, (prev - car.speed) / DT); prev = car.speed;
      vMin = Math.min(vMin, car.speed);
    }
    const vExit = car.speed;
    let recover = -1;
    for (let i = 0; i < 1200; i++) {
      car.x = 0; car.z = -150; car.heading = 0;
      car.update(DT, { throttle: 1, steer: 0, brake: false });
      vMin = Math.min(vMin, car.speed);
      if (recover < 0 && car.speed >= v0 * 0.95) { recover = i * DT; break; }
    }
    out[name] = { roadSpeed: +v0.toFixed(1), speedLeavingGrass: +vExit.toFixed(1), lostPct: +((1 - vExit / v0) * 100).toFixed(0), firstFrameLoss: +firstStep.toFixed(2), peakDecelG: +(peakDecel / 9.81).toFixed(2), backTo95pctS: +recover.toFixed(2) };
  }
  // for scale: what the brake pedal does
  const car = newCar(straightWorld());
  car.place(0, -150, 0); car.speed = 27;
  car.update(DT, { throttle: 0, steer: 0, brake: true });
  out['(brake pedal, for scale)'] = { peakDecelG: +((27 - car.speed) / DT / 9.81).toFixed(2) };
  return out;
}

/**
 * Laps of the real road by a keyboard driver. It aims at a point ahead in its lane and
 * steers the way people do with keys: a tap whose length grows with how far off the aim is
 * (`tapGain`, seconds per radian), then a pause to see what the tap did. A or D is always
 * fully down or fully up. Like a person it acts on what it saw `react` seconds ago and its
 * shortest tap is 80 ms. `lift` is the cornering effort (m/s²) it slows down for; Infinity
 * never lifts. `lookBase` / `lookGain` set how far ahead it aims (m, and s of travel).
 */
export function keyboardLap(lift: number, react = 0.2, tapGain = 2, lookBase = 6, lookGain = 0.5, laps = 1) {
  const track = buildTrack(), hf = buildHeightField(track);
  const car = newCar(hf);
  const lane = -1.65, t0 = track.at(0);
  car.place(t0.x - t0.tz * lane, t0.z + t0.tx * lane, Math.atan2(t0.tx, t0.tz));
  const seen: number[] = []; // what the driver saw, `react` seconds ago
  let s = 0, key = 0, pressLeft = 0, pause = 0, presses = 0, off = 0, steps = 0, dev2 = 0, devMax = 0, wob2 = 0, minV = 99, flips = 0, lastKey = 0, deep = 0;
  const goal = track.length * laps;
  let travelled = 0, prevS = 0;
  while (travelled < goal && steps < 60 * 400) {
    let best = 1e9, bs = s;
    for (let d = -6; d <= 30; d += 0.5) { const p = track.at(s + d), e = (p.x - car.x) ** 2 + (p.z - car.z) ** 2; if (e < best) { best = e; bs = s + d; } }
    s = bs; travelled += s - prevS; prevS = s;
    const look = lookBase + Math.abs(car.speed) * lookGain;
    const a = track.at(s + look), ax = a.x - a.tz * lane, az = a.z + a.tx * lane;
    const err = wrap(Math.atan2(ax - car.x, az - car.z) - car.heading);
    seen.push(err);
    const sawErr = seen.length > react / DT ? seen.shift()! : 0;
    if (key !== 0) { pressLeft -= DT; if (pressLeft <= 0) { key = 0; pause = 0.12; } }
    else if ((pause -= DT) <= 0 && Math.abs(sawErr) > 0.02) {
      key = Math.sign(sawErr); pressLeft = Math.min(0.6, Math.max(0.08, tapGain * Math.abs(sawErr)));
      presses++; if (lastKey && key !== lastKey) flips++; lastKey = key;
    }
    let kMax = 0; for (let d = 0; d < 50; d += 2.5) kMax = Math.max(kMax, Math.abs(track.at(s + d).k));
    const vGoal = Math.sqrt(lift / Math.max(kMax, 1e-4));
    car.update(DT, { throttle: car.speed < vGoal ? 1 : 0, steer: key, brake: car.speed > vGoal + 3 });
    const here = track.at(s), rd = hf.roadDist(car.x, car.z);
    const lat = (car.x - here.x) * -here.tz + (car.z - here.z) * here.tx - lane;
    dev2 += lat * lat; devMax = Math.max(devMax, Math.abs(lat));
    const hErr = wrap(car.heading - Math.atan2(here.tx, here.tz)); wob2 += hErr * hErr;
    if (rd > ROAD_HALF_WIDTH) off++;
    if (rd > ROAD_HALF_WIDTH + 3) deep++;
    if (steps > 300) minV = Math.min(minV, car.speed);
    steps++;
  }
  return {
    finished: travelled >= goal, lapTimeS: +(steps * DT / laps).toFixed(1), avgSpeed: +(travelled / (steps * DT)).toFixed(1), slowest: +minV.toFixed(1),
    keyPressesPerLap: Math.round(presses / laps), leftRightFlipsPerLap: Math.round(flips / laps),
    laneErrorRmsM: +Math.sqrt(dev2 / steps).toFixed(2), laneErrorMaxM: +devMax.toFixed(2), headingWobbleRmsDeg: +(Math.sqrt(wob2 / steps) * DEG).toFixed(1),
    offAsphaltPct: +(100 * off / steps).toFixed(1), deepGrassPct: +(100 * deep / steps).toFixed(1),
  };
}

/**
 * The same driver, allowed to find the aiming distance that suits the car — as a person
 * does within a lap or two. What is left is how well the car itself can be placed.
 */
export function bestKeyboardLap(lift: number, react = 0.2) {
  let best: ReturnType<typeof keyboardLap> & { driver?: string } | null = null;
  for (const tapGain of [0.4, 0.8, 1.5, 3, 6]) for (const base of [4, 8]) for (const gain of [0.4, 0.7, 1.0]) {
    const r = keyboardLap(lift, react, tapGain, base, gain);
    if (r.finished && (!best || r.laneErrorRmsM < best.laneErrorRmsM)) best = { ...r, driver: `tap ${tapGain}s/rad, aim ${base}m+${gain}s` };
  }
  return best!;
}

/** Straight-line performance, which the steering and grass work must leave alone. */
export function straightLine() {
  const car = newCar(straightWorld());
  car.place(0, -150, 0);
  let t20 = -1, i = 0;
  for (; i < 900; i++) { car.z = -150; car.update(DT, { throttle: 1, steer: 0, brake: false }); if (t20 < 0 && car.speed >= 20) t20 = (i + 1) * DT; }
  const top = car.speed;
  let dist = 0, t = 0;
  while (car.speed > 0.05 && t < 10) { const z = car.z; car.update(DT, { throttle: 0, steer: 0, brake: true }); dist += car.z - z; t += DT; }
  return { zeroTo20S: +t20.toFixed(2), topSpeed: +top.toFixed(2), brakeFromTopM: +dist.toFixed(1), brakeFromTopS: +t.toFixed(2) };
}

/** How tight the road actually is. */
export function trackCorners() {
  const track = buildTrack();
  const radii = track.samples.map((p) => 1 / Math.max(Math.abs(p.k), 1e-6)).sort((a, b) => a - b);
  const q = (f: number) => +radii[Math.floor(radii.length * f)].toFixed(1);
  return { tightestRadiusM: q(0), p05: q(0.05), p25: q(0.25), median: q(0.5), tighterThan20mPct: +(100 * radii.filter((r) => r < 20).length / radii.length).toFixed(1), tighterThan30mPct: +(100 * radii.filter((r) => r < 30).length / radii.length).toFixed(1) };
}
