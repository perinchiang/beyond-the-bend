// Headless measurements of the graybox car (src/slice/vehicle). Analytic test grounds, a
// path-following driver with a stick or with keys, and one function per question. Run through
// tools/slice-handling.mjs, which prints the numbers and asserts on them.
import { Vehicle, VehicleInput, VehicleSpec } from '../src/slice/vehicle/vehicle';
import { ASPHALT, GRASS, GRAVEL, SHOULDER, Ground, GroundSample, Obstacle, Obstacles } from '../src/slice/ground';

const G = 9.81, DT = 1 / 120, DEG = Math.PI / 180;
const kmh = (v: number) => v * 3.6, ms = (k: number) => k / 3.6;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const r = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
let SPEC: Partial<VehicleSpec> = {};
const TR = (...a: unknown[]) => { if ((globalThis as any).__trace) console.log(...a); };
const TRC = (t: number, c: Vehicle, f: { s: number; lat: number }, every = 24) => { if ((globalThis as any).__trace && Math.round(t * 120) % every === 0) console.log(Math.round(t * 100) / 100, 's', Math.round(f.s), 'lat', Math.round(f.lat * 100) / 100, 'v', Math.round(c.speed * 36) / 10, 'slip', Math.round(c.sideslip / (Math.PI / 180)), 'yaw', Math.round(c.yawRate / (Math.PI / 180)), 'in', Math.round(c.steerInput * 100) / 100, 'g', c.gear); };
/** Run every metric with spec overrides (tuning experiments). */
export function useSpec(s: Partial<VehicleSpec>) { SPEC = s; }
const car = (g: Ground, o: Obstacles | null = null) => new Vehicle(g, o, SPEC);

// ---------------------------------------------------------------- grounds
const flat = (surface = ASPHALT): Ground => ({
  sample(_x, _z, o) { o.y = 0; o.nx = 0; o.ny = 1; o.nz = 0; o.surface = surface; return o; },
});
/** Height from a function with an analytic gradient. */
const field = (f: (x: number, z: number) => [number, number, number], surface: (x: number, z: number) => number = () => ASPHALT): Ground => ({
  sample(x, z, o) {
    const [y, gx, gz] = f(x, z);
    const l = Math.hypot(gx, 1, gz);
    o.y = y; o.nx = -gx / l; o.ny = 1 / l; o.nz = -gz / l; o.surface = surface(x, z);
    return o;
  },
});
const bumpy = (amp: number) => field((x, z) => {
  const a = amp / 2;
  return [
    a * Math.sin(0.35 * x + 1) * Math.sin(0.21 * z) + a * Math.sin(0.13 * z + 0.07 * x),
    a * 0.35 * Math.cos(0.35 * x + 1) * Math.sin(0.21 * z) + a * 0.07 * Math.cos(0.13 * z + 0.07 * x),
    a * 0.21 * Math.sin(0.35 * x + 1) * Math.cos(0.21 * z) + a * 0.13 * Math.cos(0.13 * z + 0.07 * x),
  ];
});
/** A road profile along +Z from grade knots [z, grade]; flat across. */
function profile(knots: [number, number][]): Ground {
  const step = 0.25, z0 = knots[0][0], z1 = knots[knots.length - 1][0];
  const n = Math.ceil((z1 - z0) / step) + 1, ys = new Float64Array(n), gs = new Float64Array(n);
  const grade = (z: number) => {
    if (z <= z0) return knots[0][1];
    for (let i = 1; i < knots.length; i++) if (z < knots[i][0]) {
      const [a, ga] = knots[i - 1], [b, gb] = knots[i];
      return ga + ((gb - ga) * (z - a)) / (b - a);
    }
    return knots[knots.length - 1][1];
  };
  for (let i = 0; i < n; i++) { gs[i] = grade(z0 + i * step); if (i) ys[i] = ys[i - 1] + ((gs[i] + gs[i - 1]) / 2) * step; }
  return {
    sample(_x, z, o) {
      const f = clamp((z - z0) / step, 0, n - 1.001), i = Math.floor(f), t = f - i;
      const g = gs[i] + (gs[i + 1] - gs[i]) * t, l = Math.hypot(g, 1);
      o.y = ys[i] + (ys[i + 1] - ys[i]) * t + (z < z0 ? (z - z0) * gs[0] : z > z1 ? (z - z1) * gs[n - 1] : 0);
      o.nx = 0; o.ny = 1 / l; o.nz = -g / l; o.surface = ASPHALT;
      return o;
    },
  };
}
/** A jump: sag up to +grade, hold, a crest of `len` metres over to -grade, hold, sag back. The map's is 5% and 25 m. */
const crest = (len = 25, g = 0.05): [number, number][] => [[0, 0], [300, 0], [375, g], [435, g], [435 + len, -g], [495 + len, -g], [570 + len, 0], [1400, 0]];

interface Path { n: number; step: number; x: Float64Array; z: Float64Array; h: Float64Array; k: Float64Array; y: Float64Array; grade: number }
/** Segments of [length, curvature] (+ = left), starting at the origin heading +Z. */
function makePath(segs: [number, number][], grade = 0, step = 0.5): Path {
  let total = 0;
  for (const s of segs) total += s[0];
  const n = Math.floor(total / step) + 1;
  const p: Path = { n, step, x: new Float64Array(n), z: new Float64Array(n), h: new Float64Array(n), k: new Float64Array(n), y: new Float64Array(n), grade };
  let x = 0, z = 0, h = 0, si = 0, acc = 0;
  for (let i = 0; i < n; i++) {
    while (si < segs.length - 1 && i * step >= acc + segs[si][0]) { acc += segs[si][0]; si++; }
    const k = segs[si][1];
    p.x[i] = x; p.z[i] = z; p.h[i] = h; p.k[i] = k; p.y[i] = i * step * grade;
    const hm = h + (k * step) / 2;
    x += Math.sin(hm) * step; z += Math.cos(hm) * step; h += k * step;
  }
  return p;
}
interface Near { i: number; lat: number; s: number }
/** Nearest sample around a moving hint; lat is + to the left of the centre line. */
function nearest(p: Path, x: number, z: number, hint: { i: number }, out: Near): Near {
  let best = hint.i, bd = Infinity;
  const a = Math.max(0, hint.i - 30), b = Math.min(p.n - 1, hint.i + 90);
  for (let i = a; i <= b; i++) { const d = (p.x[i] - x) ** 2 + (p.z[i] - z) ** 2; if (d < bd) { bd = d; best = i; } }
  hint.i = best;
  const h = p.h[best], dx = x - p.x[best], dz = z - p.z[best];
  out.i = best; out.lat = dx * Math.cos(h) - dz * Math.sin(h); out.s = best * p.step + dx * Math.sin(h) + dz * Math.cos(h);
  return out;
}
function pathGround(p: Path, half: number, road = ASPHALT, shoulder = 2.5): Ground {
  const hint = { i: 0 }, nr: Near = { i: 0, lat: 0, s: 0 };
  return {
    sample(x: number, z: number, o: GroundSample) {
      nearest(p, x, z, hint, nr);
      const h = p.h[nr.i], g = p.grade, l = Math.hypot(g, 1);
      o.y = nr.s * g; o.nx = (-g * Math.sin(h)) / l; o.ny = 1 / l; o.nz = (-g * Math.cos(h)) / l;
      const d = Math.abs(nr.lat);
      o.surface = d <= half ? road : d <= half + shoulder ? SHOULDER : GRASS;
      return o;
    },
  };
}

// ---------------------------------------------------------------- drivers
const WHEELBASE = 2.42;
interface Follow { hint: { i: number }; nr: Near; lat: number; s: number; i: number }
const newFollow = (): Follow => ({ hint: { i: 0 }, nr: { i: 0, lat: 0, s: 0 }, lat: 0, s: 0, i: 0 });
/** Pure pursuit: the steering (driver-named, + = right) that aims at a point ahead on the path. */
function aim(p: Path, c: Vehicle, f: Follow, look = 0.5): number {
  const pos = c.position;
  nearest(p, pos.x, pos.z, f.hint, f.nr);
  f.lat = f.nr.lat; f.s = f.nr.s; f.i = f.nr.i;
  const v = Math.max(c.speed, 3), Ld = clamp(v * look, 5, 45);
  const j = Math.min(p.n - 1, f.nr.i + Math.round(Ld / p.step));
  const dx = p.x[j] - pos.x, dz = p.z[j] - pos.z, dist = Math.hypot(dx, dz) || 1;
  const a = wrap(Math.atan2(dx, dz) - c.heading);
  const delta = Math.atan((WHEELBASE * 2 * Math.sin(a)) / dist) * (1 + (v * v) / (34 * 34));
  return clamp(-delta / c.maxSteerAngle(v), -1, 1);
}
/** Keys instead of a stick: all-or-nothing, decided every 50 ms from what was seen `reaction` seconds ago. */
function keys(reaction = 0.2) {
  const seen: number[] = [];
  let key = 0, next = 0;
  return (t: number, want: number, c: Vehicle): number => {
    seen.push(want);
    const delayed = seen[Math.max(0, seen.length - 1 - Math.round(reaction / DT))];
    if (t >= next) {
      next = t + 0.05;
      const est = c.steerInput;
      // press until the wheel is wound on as far as wanted, let go once it is clearly past that
      // press until the wheel is wound on as far as wanted; a wanted full lock is simply held
      if (Math.abs(delayed) < 0.05) key = 0;
      else if (delayed * est < 0) key = Math.abs(delayed) > 0.12 ? Math.sign(delayed) : 0;
      else key = Math.abs(delayed) > 0.9 || Math.abs(delayed) - Math.abs(est) > 0.05 ? Math.sign(delayed) : 0;
    }
    return key;
  };
}
const hold = (c: Vehicle, target: number) => clamp(0.3 + (target - c.speed) * 0.4, 0, 1);
function sim(c: Vehicle, T: number, ctl: (t: number) => VehicleInput, each?: (t: number) => boolean | void) {
  for (let t = 0; t < T - 1e-9; t += DT) { c.update(DT, ctl(t)); if (each && each(t + DT) === false) break; }
}
const IN = (throttle = 0, brake = 0, steer = 0, handbrake = false, digital = false): VehicleInput => ({ throttle, brake, steer, handbrake, digital });
const pitchDeg = (c: Vehicle) => { const q = c.quaternion; return Math.asin(clamp(2 * (q.y * q.z - q.w * q.x), -1, 1)) / DEG; };

// ---------------------------------------------------------------- 1, 2: straight line
export function straightLine(surface = ASPHALT) {
  const c = car(flat(surface));
  let t100 = 0, t200 = 0;
  sim(c, 75, () => IN(1), (t) => { if (!t100 && c.speed >= ms(100)) t100 = t; if (!t200 && c.speed >= ms(200)) t200 = t; });
  const top = c.speed;
  const stop = (v0: number) => {
    c.reset(0, 0, 0, ms(v0));
    let dev = 0;
    sim(c, 20, () => IN(0, 1), () => { dev = Math.max(dev, Math.abs(c.position.x)); return c.speed > 0.3; });
    return { m: r(c.position.z, 1), dev: r(dev, 2) };
  };
  const b100 = stop(100), b200 = stop(200);
  return { topKmh: r(kmh(top), 1), zeroTo100S: r(t100), from100To200S: r(t200 - t100), brake100M: b100.m, brake100DevM: b100.dev, brake200M: b200.m, brake200DevM: b200.dev };
}
export function liftOff() {
  const c = car(flat());
  c.reset(0, 0, 0, ms(180));
  sim(c, 1, () => IN(1));
  const v0 = c.speed;
  sim(c, 0.6, () => IN(0));
  const first = (v0 - c.speed) / 0.6 / G, v1 = c.speed;
  sim(c, 3, () => IN(0));
  return { liftG: r(first, 3), lostIn3sKmh: r(kmh(v1 - c.speed), 1) };
}

// ---------------------------------------------------------------- 3: grip on rings
function ring(R: number, laps: number, half = 4, surface = ASPHALT) {
  const p = makePath([[2 * Math.PI * R * laps, 1 / R]]);
  return { p, g: pathGround(p, half, surface) };
}
/** Speed up slowly round a ring until the car can no longer hold the line. */
export function maxLateral(R: number, surface = ASPHALT) {
  const { p, g } = ring(R, R < 60 ? 14 : 6, 4, surface);
  const c = car(g), f = newFollow();
  const start = Math.sqrt(0.7 * G * R);
  c.reset(0, 0, 0, start);
  let best = 0, bestV = 0, slip = 0;
  sim(c, 60, (t) => IN(hold(c, start + t * 0.4), 0, aim(p, c, f)), (t) => {
    if (Math.abs(f.lat) > 2.5) return false;
    if (t > 3 && Math.abs(f.lat) < 1.5) { const a = (c.speed * c.speed) / R / G; if (a > best) { best = a; bestV = c.speed; slip = Math.abs(c.sideslip) / DEG; } }
  });
  return { maxLatG: r(best), atKmh: r(kmh(bestV), 1), sideslipDeg: r(slip, 1) };
}
/** A keyboard driver round a ring, flat out or at a target speed. */
export function keyboardRing(R: number, targetKmh = Infinity, half = 4, surface = ASPHALT) {
  const { p, g } = ring(R, 5, half, surface);
  const c = car(g), f = newFollow(), kb = keys();
  const tgt = ms(targetKmh);
  c.reset(0, 0, 0, Math.min(tgt, Math.sqrt(1.0 * G * R)));
  let worst = 0, sum = 0, n = 0, flips = 0, last = 0;
  sim(c, 30, (t) => {
    const k = kb(t, aim(p, c, f), c);
    if (k && last && k !== last) flips++;
    if (k) last = k;
    return IN(c.speed < tgt ? 1 : 0, 0, k, false, true);
  }, (t) => { if (t > 6) { worst = Math.max(worst, Math.abs(f.lat)); sum += c.speed; n++; } if (Math.round(t / DT) % 30 === 0) TR(r(t), 'v', r(kmh(c.speed), 1), 'lat', r(f.lat), 'in', r(c.steerInput), 'latG', r(c.lateralG), 'slip', r(c.sideslip / DEG, 1), 'gear', c.gear); });
  return { avgKmh: r(kmh(sum / n), 1), worstLaneErrM: r(worst), latG: r(((sum / n) ** 2) / R / G), leftRightFlips: flips };
}

// ---------------------------------------------------------------- 4: design-speed bends
export function bend(R: number, deg: number, entryKmh: number, mode: 'lift' | 'brake', before: number, useKeys = false, half = 4) {
  const lead = 500, arc = R * deg * DEG;
  const p = makePath([[lead, 0], [arc, 1 / R], [500, 0]]);
  const c = car(pathGround(p, half)), f = newFollow(), kb = keys();
  c.reset(0, lead - 330, 0, ms(entryKmh));
  f.hint.i = Math.round((lead - 330) / p.step);
  let worst = 0, vIn = 0, vMin = 99, maxSlip = 0, peakBrake = 0;
  sim(c, 30, (t) => {
    const want = aim(p, c, f), st = useKeys ? kb(t, want, c) : want;
    const s = f.s;
    let thr = 1, brk = 0;
    if (s > lead - before && s < lead + arc) {
      thr = 0;
      if (mode === 'brake' && s < lead) brk = 0.35;
    }
    peakBrake = Math.max(peakBrake, brk);
    return IN(thr, brk, st, false, useKeys);
  }, () => {
    if (!vIn && f.s >= lead) vIn = c.speed;
    if (f.s > lead - 20 && f.s < lead + arc + 60) { worst = Math.max(worst, Math.abs(f.lat)); vMin = Math.min(vMin, c.speed); maxSlip = Math.max(maxSlip, Math.abs(c.sideslip) / DEG); }
    return f.s < lead + arc + 120;
  });
  return { entryKmh: r(kmh(vIn), 1), minKmh: r(kmh(vMin), 1), worstLaneErrM: r(worst), maxSideslipDeg: r(maxSlip, 1), brake: peakBrake };
}

// ---------------------------------------------------------------- 5: keyboard taps and held keys
export function tap(speedKmh: number, tapMs: number) {
  const c = car(flat()), v = ms(speedKmh);
  c.reset(0, 0, 0, v);
  sim(c, 1.5, () => IN(hold(c, v)));
  const x0 = c.position.x, h0 = c.heading;
  sim(c, 1, (t) => IN(hold(c, v), 0, t < tapMs / 1000 ? 1 : 0, false, true));
  return { sidewaysM: r(Math.abs(c.position.x - x0)), headingDeg: r(Math.abs(wrap(c.heading - h0)) / DEG, 2) };
}
export function heldKey(speedKmh: number) {
  const c = car(flat()), v = ms(speedKmh);
  c.reset(0, 0, 0, v);
  sim(c, 1.5, () => IN(hold(c, v)));
  let slip = 0, lat = 0, yaw = 0, t90 = 0;
  sim(c, 1.5, () => IN(hold(c, v), 0, 1, false, true), (t) => {
    slip = Math.max(slip, Math.abs(c.sideslip) / DEG); lat = Math.max(lat, Math.abs(c.lateralG)); yaw = Math.max(yaw, Math.abs(c.yawRate) / DEG);
    void t;
  });
  const steady = Math.abs(c.lateralG);
  // response time: rerun and time 90% of the steady lateral g
  const c2 = car(flat());
  c2.reset(0, 0, 0, v);
  sim(c2, 1.5, () => IN(hold(c2, v)));
  sim(c2, 1.5, () => IN(hold(c2, v), 0, 1, false, true), (t) => { if (!t90 && Math.abs(c2.lateralG) >= 0.9 * steady) t90 = t; });
  // release
  let settle = 0, quietFor = 0, flips = 0, sign = Math.sign(c.yawRate);
  sim(c, 3, () => IN(hold(c, v), 0, 0, false, true), (t) => {
    const y = c.yawRate / DEG;
    if (Math.abs(y) > 1 && Math.sign(y) !== sign) { flips++; sign = Math.sign(y); }
    if (Math.abs(y) < 1.5) { quietFor += DT; if (!settle && quietFor >= 0.3) settle = t - 0.3; } else { quietFor = 0; settle = 0; }
  });
  return { maxSideslipDeg: r(slip, 1), latG: r(lat), yawDegS: r(yaw, 1), to90pctS: r(t90), straightenS: r(settle), overshoots: flips };
}

// ---------------------------------------------------------------- 6: high-speed stability
export function highSpeedStability() {
  const c = car(bumpy(0.08)), v = ms(220);
  c.reset(0, 0, 0, v);
  let sq = 0, n = 0;
  sim(c, 20, () => IN(hold(c, v)), () => { sq += c.heading ** 2; n++; });
  return { driftM: r(Math.abs(c.position.x)), headingRmsDeg: r(Math.sqrt(sq / n) / DEG, 3), speedKmh: r(kmh(c.speed), 1) };
}

// ---------------------------------------------------------------- 7, 8: drifting and forgiveness
export function drift(surface = ASPHALT, throttle = 1) {
  const c = car(flat(surface));
  c.reset(0, 0, 0, ms(80));
  sim(c, 0.5, () => IN(0.6));
  let tStart = 0;
  sim(c, 0.7, () => IN(0.6, 0, -1, true, true), (t) => { if (!tStart && Math.abs(c.sideslip) > 20 * DEG) tStart = t; });
  // hold it: throttle down, key held towards the corner (or tapped by a simple drift driver)
  let inBand = 0, maxSlip = 0, minSlip = 99, minV = 99;
  const T = 3;
  sim(c, T, () => IN(throttle, 0, -1, false, true), (t) => {
    const b = Math.abs(c.sideslip) / DEG;
    maxSlip = Math.max(maxSlip, b); minV = Math.min(minV, c.speed);
    if (Math.round(t / DT) % 24 === 0) TR(r(t), 'slip', r(c.sideslip / DEG, 1), 'v', r(kmh(c.speed), 1), 'yaw', r(c.yawRate / DEG, 0), 'in', r(c.steerInput), 'steer', r(c.wheels[0].steer / DEG, 1), 'gear', c.gear);
    if (t > 0.3) minSlip = Math.min(minSlip, b);
    if (b >= 15 && b <= 45) inBand += DT;
  });
  let tOut = 0;
  sim(c, 3, () => IN(0.3, 0, 0, false, true), (t) => { if (!tOut && Math.abs(c.sideslip) < 5 * DEG) tOut = t; return !tOut; });
  return { to20degS: r(tStart), inBandS: r(inBand), minDeg: r(minSlip, 1), maxDeg: r(maxSlip, 1), minKmh: r(kmh(minV), 1), recoverS: r(tOut) };
}
/**
 * A keyboard driver who is happy to slide. On the straights it steers by taps. In a bend it holds
 * the key towards the corner, lets go when the car is heading for the inside, and steers the
 * line with the throttle (lift when running wide) — how a long slide is driven on keys.
 */
interface Slide { prev: number; rate: number; turn: number }
const newSlide = (): Slide => ({ prev: 0, rate: 0, turn: 0 });
function slider(p: Path, c: Vehicle, f: Follow, kb: ReturnType<typeof keys>, t: number, cruise: number, st: Slide): VehicleInput {
  const want = aim(p, c, f, 0.5), turn = Math.sign(p.k[Math.min(p.n - 1, f.i + 8)]);
  const inside = f.lat * turn; // + = inside of the bend
  if (turn !== st.turn) { st.turn = turn; st.prev = inside; st.rate = 0; }
  st.rate += ((inside - st.prev) / DT - st.rate) * 0.15; st.prev = inside;
  if (turn) {
    const pred = inside + st.rate * PRED;
    const key = pred > 0.5 ? 0 : -turn;
    return IN(c.speed > cruise * 1.06 ? 0.1 : clamp(0.7 + 0.35 * pred, 0.15, 1), 0, key, false, true);
  }
  return IN(clamp((cruise - c.speed) * 0.5, 0, 1), 0, kb(t, want, c), false, true);
}
export function driftEsses() {
  const R = 40, p = makePath([[80, 0], [50, 1 / R], [50, -1 / R], [50, 1 / R], [120, 0]]);
  const c = car(pathGround(p, 4)), f = newFollow(), kb = keys(0.15), sl = newSlide();
  c.reset(0, 10, 0, ms(64));
  f.hint.i = 20;
  let maxSlip = 0, worst = 0, flick = 0, lastSeg = 0, minV = 99, sliding = 0;
  const done = { v: false };
  sim(c, 20, (t) => {
    const s = f.s + 6; // act a little early
    const seg = s < 80 ? 0 : s < 130 ? 1 : s < 180 ? 2 : s < 230 ? 3 : 4;
    if (seg !== lastSeg && seg >= 1 && seg <= 3) { flick = t + 0.2; lastSeg = seg; }
    const inp = slider(p, c, f, kb, t, ms(64), sl);
    if (t < flick) { inp.handbrake = true; inp.steer = seg === 2 ? 1 : -1; }
    return inp;
  }, (t) => {
    TRC(t, c, f, 12);
    const b = Math.abs(c.sideslip) / DEG;
    maxSlip = Math.max(maxSlip, b); worst = Math.max(worst, Math.abs(f.lat)); minV = Math.min(minV, c.speed);
    if (b > 10 && f.s > 80 && f.s < 240) sliding += DT;
    if (f.s > 290) { done.v = true; return false; }
  });
  return { finished: done.v, maxSideslipDeg: r(maxSlip, 1), slidingS: r(sliding), worstLaneErrM: r(worst), minKmh: r(kmh(minV), 1) };
}
export function forgiveness() {
  const c = car(flat()), v = ms(80), a = 60 * DEG;
  c.reset(0, 0, 0, v);
  c.setMotion(Math.sin(a) * v, Math.cos(a) * v, 0);
  let maxSlip = 0, t5 = 0, quiet = 0, back = false;
  sim(c, 5, () => IN(0, 0, 0, false, true), (t) => {
    const vx = c.velocity.x, vz = c.velocity.z, sp = Math.hypot(vx, vz);
    const ang = sp > 1 ? Math.abs(wrap(Math.atan2(vx, vz) - c.heading)) / DEG : 0;
    maxSlip = Math.max(maxSlip, ang);
    if (ang > 100) back = true;
    if (ang < 5 && Math.abs(c.yawRate) < 6 * DEG) { quiet += DT; if (!t5 && quiet > 0.25) t5 = t - 0.25; } else { quiet = 0; t5 = 0; }
  });
  return { straightS: r(t5), maxAngleDeg: r(maxSlip, 1), endedBackwards: back, endKmh: r(kmh(c.speed), 1) };
}

// ---------------------------------------------------------------- 9: crest jump and slopes
export function jump(speedKmh: number, crestLen = 25, grade = 0.05) {
  const c = car(profile(crest(crestLen, grade))), v = ms(speedKmh);
  c.reset(0, 60, 0, v);
  let air = 0, airStartZ = 0, bestT = 0, bestM = 0, pMin = 99, pMax = -99, vBefore = 0, landT = 0, vAfter = 0, hops = 0, maxImpact = 0, xAfter = 0, hAfter = 0, osc = 0, lastSign = 0;
  let wasAir = false;
  sim(c, 30, () => IN(hold(c, v)), (t) => {
    const z = c.position.z;
    if (!vBefore && z > 430) vBefore = c.speed;
    maxImpact = Math.max(maxImpact, c.impact);
    if (c.airborne) {
      if (!wasAir) { air = 0; airStartZ = z; if (landT) hops++; }
      air += DT;
      if (!landT) { const pd = pitchDeg(c); pMin = Math.min(pMin, pd); pMax = Math.max(pMax, pd); }
      if (air > bestT) { bestT = air; bestM = z - airStartZ; }
    } else if (wasAir && !landT && air > 0.08) landT = t;
    wasAir = c.airborne;
    if (landT && t > landT + 0.15 && t < landT + 2.5) {
      const m = (c.wheels[0].compression + c.wheels[1].compression + c.wheels[2].compression + c.wheels[3].compression) / 4;
      const sg = m > 0.02 ? 1 : m < -0.02 ? -1 : 0;
      if (sg && sg !== lastSign) { if (lastSign) osc++; lastSign = sg; }
    }
    if (landT && !vAfter && t >= landT + 1) { vAfter = c.speed; xAfter = Math.abs(c.position.x); hAfter = Math.abs(c.heading) / DEG; }
    return z < 900;
  });
  return {
    airS: r(bestT), airM: r(bestM, 1), pitchMinDeg: r(pMin === 99 ? 0 : pMin, 1), pitchMaxDeg: r(pMax === -99 ? 0 : pMax, 1),
    speedLostPct: r(vAfter ? (1 - vAfter / vBefore) * 100 : 0, 1), hops, rebounds: osc, impactMs: r(maxImpact, 1), offLineM: r(xAfter), headingDeg: r(hAfter, 2),
  };
}
export function slopes() {
  const up = field((_x, z) => [0.1 * z, 0, 0.1]);
  const c = car(up);
  c.reset(0, 0, 0);
  sim(c, 5, () => IN());
  const along = Math.abs(c.position.z);
  c.reset(0, 0, Math.PI / 2);
  sim(c, 5, () => IN());
  const across = Math.abs(c.position.z);
  const c2 = car(field((_x, z) => [0.12 * z, 0, 0.12]));
  c2.reset(0, 0, 0);
  sim(c2, 8, () => IN(1));
  return { slide10pctNoseUpM: r(along, 3), slide10pctSidewaysM: r(across, 3), climb12pctAfter8sKmh: r(kmh(c2.speed), 1) };
}

// ---------------------------------------------------------------- 10: grass
export function grass() {
  const strip = (len: number) => field(() => [0, 0, 0], (_x, z) => (z > 200 && z < 200 + len ? GRASS : ASPHALT));
  const v = ms(150);
  const run = (len: number) => {
    const c = car(strip(len));
    c.reset(0, 120, 0, v);
    let vIn = 0, vOut = 0, peak = 0, first = 0;
    sim(c, 6, () => IN(1), () => {
      const z = c.position.z;
      if (!vIn && z >= 200) vIn = c.speed;
      if (z >= 200 && z < 200 + len + 5) peak = Math.max(peak, -c.longG);
      if (vIn && !first && z >= 204) first = -c.longG;
      if (!vOut && z >= 200 + len) { vOut = c.speed; return false; }
    });
    return { lostPct: r((1 - vOut / vIn) * 100, 1), peakDecelG: r(peak), decelAfter4mG: r(first) };
  };
  const one = run(v * 1.0), clip = run(v * 0.3);
  // steering on grass
  const c = car(flat(GRASS));
  c.reset(0, 0, 0, ms(100));
  let lat = 0;
  sim(c, 1.5, () => IN(0.6, 0, 1, false, true), () => { lat = Math.max(lat, Math.abs(c.lateralG)); });
  // staying out there
  const c3 = car(flat(GRASS));
  c3.reset(0, 0, 0, v);
  sim(c3, 20, () => IN(1));
  return { oneSecondLostPct: one.lostPct, oneSecondPeakDecelG: one.peakDecelG, firstMetresDecelG: one.decelAfter4mG, clip03sLostPct: clip.lostPct, steerLatG: r(lat), flatOutOnGrassKmh: r(kmh(c3.speed), 1) };
}

// ---------------------------------------------------------------- 11: obstacles
const posts = (list: Obstacle[]): Obstacles => ({
  near(x, z, radius, out) {
    let n = 0;
    for (const o of list) if ((o.x - x) ** 2 + (o.z - z) ** 2 < (radius + o.r) ** 2) out[n++] = o;
    return n;
  },
});
export function obstacle(offset: number) {
  const c = car(flat(), posts([{ x: offset, z: 40, r: 0.35 }]));
  c.reset(0, 0, 0, ms(80));
  let maxY = 0, maxZ = 0, hit = 0, finite = true, minV = 99;
  sim(c, 3, () => IN(0.5), () => {
    const p = c.position;
    if (!Number.isFinite(p.x + p.y + p.z + c.speed + c.heading)) finite = false;
    maxY = Math.max(maxY, Math.abs(p.y)); maxZ = Math.max(maxZ, p.z); hit = Math.max(hit, c.impact); minV = Math.min(minV, Math.abs(c.speed));
  });
  return { finite, impactMs: r(hit, 1), maxHeightM: r(maxY, 3), furthestZ: r(maxZ, 1), endKmh: r(kmh(c.speed), 1), minKmh: r(kmh(minV), 1), headingDeg: r(Math.abs(c.heading) / DEG, 1) };
}

// ---------------------------------------------------------------- 12: robustness
export function robustness() {
  let seed = 12345;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const list: Obstacle[] = [];
  for (let i = 0; i < 400; i++) list.push({ x: (rnd() - 0.5) * 600, z: (rnd() - 0.5) * 600, r: 0.2 + rnd() * 0.6 });
  const hills = field((x, z) => [3 * Math.sin(x / 17) * Math.cos(z / 23) + 0.3 * Math.sin(x / 2.1), (3 / 17) * Math.cos(x / 17) * Math.cos(z / 23) + (0.3 / 2.1) * Math.cos(x / 2.1), (-3 / 23) * Math.sin(x / 17) * Math.sin(z / 23)],
    (x, z) => ((Math.floor(x / 30) + Math.floor(z / 30)) & 3));
  const c = car(hills, posts(list));
  const dts = [0, 1 / 30, 0.25, 1 / 60, 1 / 144, 0.001];
  let finite = true, maxV = 0, maxY = 0, t = 0, n = 0, inp = IN();
  while (t < 60) {
    const dt = n % 7 === 6 ? rnd() * 0.1 : dts[n % 6];
    if (n % 20 === 0) inp = IN(rnd() < 0.7 ? rnd() : 0, rnd() < 0.2 ? rnd() : 0, rnd() * 2 - 1, rnd() < 0.15, rnd() < 0.5);
    c.update(dt, inp);
    const p = c.position, q = c.quaternion;
    if (!Number.isFinite(p.x + p.y + p.z + q.x + q.y + q.z + q.w + c.speed + c.heading + c.rpm + c.sideslip + c.yawRate)) finite = false;
    for (const w of c.wheels) if (!Number.isFinite(w.x + w.y + w.z + w.compression + w.spin + w.slip + w.steer)) finite = false;
    maxV = Math.max(maxV, Math.hypot(c.velocity.x, c.velocity.y, c.velocity.z)); maxY = Math.max(maxY, Math.abs(p.y));
    t += Math.max(dt, 1 / 240); n++;
  }
  return { finite, calls: n, maxSpeedKmh: r(kmh(maxV), 1), maxHeightM: r(maxY, 1) };
}

// ---------------------------------------------------------------- gravel
let FLICK_AT = 6, FLICK_TO = 5, PRED = 1.0;
export function tuneDriver(a: number, b: number, c: number) { FLICK_AT = a; FLICK_TO = b; PRED = c; }
export function gravelBend(entryKmh = 100) {
  const R = 120, lead = 250, arc = R * 100 * DEG;
  const p = makePath([[lead, 0], [arc, 1 / R], [300, 0]]);
  const c = car(pathGround(p, 3.25, GRAVEL)), f = newFollow(), kb = keys();
  c.reset(0, lead - 120, 0, ms(entryKmh));
  f.hint.i = Math.round((lead - 120) / p.step);
  let maxSlip = 0, inBand = 0, worst = 0, minV = 99, tExit = 0, tEnd = 0, spun = false, vSum = 0, n = 0;
  let flicked = false, t0 = 0;
  const sl = newSlide();
  sim(c, 30, (t) => {
    const s = f.s;
    // turn in on a lifted throttle until the tail steps out, then drive it out on the throttle
    if (s > lead + FLICK_AT && !flicked) {
      if (!t0) t0 = t;
      if (Math.abs(c.sideslip) > FLICK_TO * DEG || t - t0 > 0.7) flicked = true;
      else { aim(p, c, f); return IN(0, 0, -1, false, true); }
    }
    return slider(p, c, f, kb, t, ms(entryKmh), sl);
  }, (t) => {
    const b = Math.abs(c.sideslip) / DEG, s = f.s;
    TRC(t, c, f);
    if (s > lead && s < lead + arc) { maxSlip = Math.max(maxSlip, b); worst = Math.max(worst, Math.abs(f.lat)); minV = Math.min(minV, c.speed); vSum += Math.hypot(c.velocity.x, c.velocity.z); n++; if (b >= 8 && b <= 30) inBand += DT; }
    if (b > 70) spun = true;
    if (!tEnd && s >= lead + arc) tEnd = t;
    if (tEnd && !tExit && b < 5) tExit = t - tEnd + DT;
    return s < lead + arc + 150;
  });
  return { maxSideslipDeg: r(maxSlip, 1), slidingS: r(inBand), worstLaneErrM: r(worst), avgKmh: r(kmh(vSum / Math.max(n, 1)), 1), minKmh: r(kmh(minV), 1), straightAfterExitS: r(tExit), spun };
}

// ---------------------------------------------------------------- mountain
let HB_BEFORE = 10, HB_ENTRY = 70, HB_OFF = 10, HB_THR = 0.6;
export function tuneHairpin(a: number, b: number, c: number, d: number) { HB_BEFORE = a; HB_ENTRY = b; HB_OFF = c; HB_THR = d; }
export function hairpin(handbrake: boolean) {
  const R = 22, lead = 200, arc = R * 150 * DEG;
  const p = makePath([[lead, 0], [arc, 1 / R], [200, 0]]);
  const c = car(pathGround(p, 3.25)), f = newFollow();
  c.reset(0, 60, 0, ms(90));
  f.hint.i = 120;
  let worst = 0, vApex = 99, tEnd = 0, vOut = 0, maxSlip = 0, vIn = 0, hbUntil = 0;
  const entry = ms(handbrake ? HB_ENTRY : 45);
  sim(c, 40, (t) => {
    const s = f.s, v = c.speed;
    let st = aim(p, c, f, handbrake ? 0.35 : 0.45), thr = 1, brk = 0, hb = false;
    // brake so that the speed at the corner is `entry`
    const dist = lead - s;
    if (dist > (handbrake ? HB_BEFORE : 0)) { const vAllow = Math.sqrt(entry * entry + 2 * 7 * Math.max(dist - 3, 0)); if (v > vAllow) { thr = 0; brk = clamp((v - vAllow) * 0.6, 0.1, 1); } }
    else if (s < lead + arc * 0.75) {
      if (handbrake) {
        const off = Math.abs(wrap(p.h[Math.min(p.n - 1, f.i + 24)] - c.heading)) / DEG; // how far the nose is behind the road 12 m ahead
        if (!hbUntil) hbUntil = t + 1.1;
        hb = t < hbUntil && off > HB_OFF && v > 7;
        if (hb) st = -1;
        thr = hb ? 0.3 : v > ms(46) ? 0 : clamp(HB_THR + 0.3 * f.lat, 0.1, 0.8);
      } else thr = v < entry ? 0.6 : 0;
    }
    return IN(thr, brk, st, hb, false);
  }, (t) => {
    const s = f.s;
    TRC(t, c, f);
    if (!vIn && s >= lead) vIn = c.speed;
    if (s > lead - 10 && s < lead + arc + 40) { worst = Math.max(worst, Math.abs(f.lat)); maxSlip = Math.max(maxSlip, Math.abs(c.sideslip) / DEG); }
    if (s > lead && s < lead + arc) vApex = Math.min(vApex, c.speed);
    if (!tEnd && s >= lead + arc) tEnd = t;
    if (tEnd && !vOut && t >= tEnd + 3) { vOut = c.speed; return false; }
  });
  return { entryKmh: r(kmh(vIn), 1), minKmh: r(kmh(vApex), 1), worstLaneErrM: r(worst), maxSideslipDeg: r(maxSlip, 1), cornerS: r(tEnd ? tEnd : 0), exit3sKmh: r(kmh(vOut), 1) };
}
export function climbEsses(useKeys = false) {
  const R = 55, segs: [number, number][] = [[60, 0]];
  for (let i = 0; i < 10; i++) segs.push([60, (i % 2 ? -1 : 1) / R]);
  segs.push([80, 0]);
  const p = makePath(segs, 0.09);
  const c = car(pathGround(p, 3.25)), f = newFollow(), kb = keys();
  c.reset(0, 5, 0, ms(80));
  f.hint.i = 10;
  let worst = 0, sum = 0, n = 0, minV = 99, done = false, maxSlip = 0;
  sim(c, 60, (t) => {
    const want = aim(p, c, f, useKeys ? 0.7 : 0.4);
    return IN(c.speed < ms(useKeys ? 82 : 88) ? 1 : 0.2, 0, useKeys ? kb(t, want, c) : want, false, useKeys);
  }, (t) => {
    const s = f.s;
    TRC(t, c, f);
    if (s > 60 && s < 660) { worst = Math.max(worst, Math.abs(f.lat)); sum += c.speed; n++; minV = Math.min(minV, c.speed); maxSlip = Math.max(maxSlip, Math.abs(c.sideslip) / DEG); }
    if (s > 670) { done = true; return false; }
  });
  return { finished: done, avgKmh: r(kmh(sum / Math.max(n, 1)), 1), minKmh: r(kmh(minV), 1), worstLaneErrM: r(worst), maxSideslipDeg: r(maxSlip, 1) };
}

/** Rest state: ride height, loads and drawing data, to check the model sits where the art expects. */
export function atRest() {
  const c = car(flat());
  c.reset(0, 0, 0);
  sim(c, 2, () => IN());
  const w = c.wheels;
  return { originY: r(c.position.y, 4), wheelY: r(w[0].y, 3), rearWheelY: r(w[2].y, 3), frontLeftX: r(w[0].x, 3), frontZ: r(w[0].z, 3), rearZ: r(w[2].z, 3), compression: r(w[0].compression, 4), creepM: r(Math.hypot(c.position.x, c.position.z), 4), rpm: r(c.rpm, 0), gear: c.gear };
}
export { GRAVEL };
