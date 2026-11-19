// Headless facts about the graybox map: road lengths, straights, bend radii, grades, junctions.
import { World, RoadHit } from '../src/slice/world/world';

export function buildWorld() {
  const t0 = performance.now();
  const world = World.build();
  return { world, buildMs: Math.round(performance.now() - t0) };
}

/** What a bend of this radius asks of a 230 km/h car with about 1.2 g of grip. */
export const bendClass = (r: number) => r >= 420 ? 'flat' : r >= 250 ? 'lift' : r >= 160 ? 'light brake' : r >= 60 ? 'brake' : r >= 30 ? 'slow' : 'hairpin';

export function networkReport(world: World) {
  const hit = {} as RoadHit;
  return world.roads.map((road) => {
    const straights: number[] = [];
    let run = 0;
    // On a loop, start counting inside a bend so no straight is split across the start.
    let first = 0;
    if (road.closed) while (first < road.n - 1 && Math.abs(road.k[first]) < 1 / 3000) first++;
    for (let j = 0; j < road.n; j++) {
      const i = (first + j) % road.n;
      if (Math.abs(road.k[i]) < 1 / 3000) run += road.step;
      else { if (run >= 300) straights.push(Math.round(run)); run = 0; }
    }
    if (run >= 300) straights.push(Math.round(run));
    const uniq = straights;
    let maxGrade = 0, minY = Infinity, maxY = -Infinity, junction = 0;
    for (let i = 0; i < road.n; i++) {
      maxGrade = Math.max(maxGrade, Math.abs(road.grade[i]));
      minY = Math.min(minY, road.y[i]); maxY = Math.max(maxY, road.y[i]);
      junction += road.junction[i];
    }
    const ends = road.closed || road.index === 0 ? [] : [0, road.n - 1].map((i) => {
      if (!world.nearestRoad(road.x[i], road.z[i], 40, hit, null, road.index)) return { on: 'nothing', offset: NaN, step: NaN };
      return { on: hit.road.def.id, offset: +hit.dist.toFixed(2), step: +(road.y[i] - (hit.road.y[hit.i] + hit.road.grade[hit.i] * hit.along)).toFixed(3) };
    });
    return {
      id: road.def.id, lengthM: Math.round(road.length), straights: uniq.sort((a, b) => b - a),
      maxGradePct: +(maxGrade * 100).toFixed(1), minY: +minY.toFixed(1), maxY: +maxY.toFixed(1),
      bends: road.bends.map((b) => ({ r: b.radius, deg: Math.round(b.deflection * 57.2958), kind: bendClass(b.radius) })),
      junctionM: Math.round(junction * road.step), ends,
    };
  });
}

// ---- driving the real map with the test driver -------------------------------------------------
import { Vehicle, VehicleInput } from '../src/slice/vehicle/vehicle';
import { Autopilot, BRISK, DriverStyle } from '../src/slice/autopilot';
import type { Road } from '../src/slice/world/world';

/** Plans early and never brakes harder than 35 %: the "lift or a light brake" claim for the ring. */
export const GENTLE: DriverStyle = { ...BRISK, lateral: 9.5, braking: 2.6, maxBrake: 0.35 };

export interface RunReport {
  finished: boolean; seconds: number; avgKmh: number; topKmh: number; minKmh: number;
  /** Furthest the car's centre got from the centre line (m), and time spent off the pavement (s). */
  maxOffsetM: number; offPavementS: number;
  maxBrake: number; airS: number; longestAirS: number; resets: number;
  bends: { r: number; deg: number; entryKmh: number; minKmh: number; brake: number }[];
}

/** Drive one road end to end (or one lap of a closed road) with the given style. */
export function driveRoad(world: World, road: Road, dir: 1 | -1, style: DriverStyle = BRISK, startFrac = 0, limitS = 900): RunReport {
  const v = new Vehicle(world, world), pilot = new Autopilot(world, style);
  const n = road.n, start = road.closed ? Math.floor(n * startFrac) : dir > 0 ? 6 : n - 7;
  const pose = world.poseOn(road, start, dir < 0);
  v.reset(pose.x, pose.z, pose.heading);
  pilot.setRoute(road, dir, start);
  const input: VehicleInput = { throttle: 0, brake: 0, steer: 0, handbrake: false, digital: false };
  const dt = 1 / 120, hit = {} as RoadHit;
  let t = 0, travelled = 0, top = 0, min = Infinity, maxOff = 0, off = 0, air = 0, airRun = 0, longestAir = 0, resets = 0, lastI = start, laps = 0;
  const bends = road.bends.map((b) => ({ r: b.radius, deg: Math.round(b.deflection * 57.2958), entryKmh: 0, minKmh: Infinity, brake: 0, i0: Math.floor(b.s0 / road.step), i1: Math.ceil(b.s1 / road.step) }));
  let finished = false;
  while (t < limitS) {
    pilot.drive(v, input);
    v.update(dt, input);
    t += dt;
    const kmh = v.speed * 3.6;
    travelled += Math.abs(v.speed) * dt;
    top = Math.max(top, kmh);
    if (travelled > 600) min = Math.min(min, kmh); // ignore the standing start
    if (v.airborne) { air += dt; airRun += dt; longestAir = Math.max(longestAir, airRun); } else airRun = 0;
    if (world.nearestRoad(v.position.x, v.position.z, 40, hit, road)) {
      maxOff = Math.max(maxOff, hit.dist);
      if (hit.dist > road.def.halfWidth) off += dt;
    } else { resets++; const p = world.poseOn(road, pilot.i); v.reset(p.x, p.z, dir < 0 ? p.heading + Math.PI : p.heading); }
    for (const b of bends) {
      const inside = pilot.i >= b.i0 && pilot.i <= b.i1;
      if (!inside) { if (b.minKmh === Infinity) b.entryKmh = kmh; continue; }
      b.minKmh = Math.min(b.minKmh, kmh);
    }
    // Braking counts towards the bend it was for: the next one ahead.
    if (input.brake > 0) {
      let next = null as (typeof bends)[number] | null, gap = Infinity;
      for (const b of bends) {
        const ahead = dir > 0 ? (b.i1 - pilot.i + (road.closed ? n : 0)) % (road.closed ? n : 1e9) : (pilot.i - b.i0 + (road.closed ? n : 0)) % (road.closed ? n : 1e9);
        if (ahead >= 0 && ahead < gap) { gap = ahead; next = b; }
      }
      if (next) next.brake = Math.max(next.brake, input.brake);
    }
    if (road.closed) {
      if (dir > 0 ? pilot.i < lastI - n / 2 : pilot.i > lastI + n / 2) laps++;
      lastI = pilot.i;
      if (laps >= 1 && (dir > 0 ? pilot.i >= start : pilot.i <= start)) { finished = true; break; }
    } else if (pilot.finished) { finished = true; break; }
    if (!Number.isFinite(v.position.x + v.position.y + v.speed)) break;
  }
  return {
    finished, seconds: +t.toFixed(1), avgKmh: Math.round((travelled / t) * 3.6), topKmh: Math.round(top), minKmh: Math.round(min),
    maxOffsetM: +maxOff.toFixed(2), offPavementS: +off.toFixed(1), maxBrake: +Math.max(0, ...bends.map((b) => b.brake)).toFixed(2),
    airS: +air.toFixed(2), longestAirS: +longestAir.toFixed(2), resets,
    bends: bends.map(({ r, deg, entryKmh, minKmh, brake }) => ({ r, deg, entryKmh: Math.round(entryKmh), minKmh: Math.round(minKmh), brake: +brake.toFixed(2) })),
  };
}
export const __debug = { Vehicle, Autopilot };
