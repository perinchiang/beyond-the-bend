import { GRAVEL } from './ground';
import type { Vehicle, VehicleInput } from './vehicle/vehicle';
import type { Road, RoadHit, World } from './world/world';

/**
 * A simple driver that follows a road: steers at a point ahead, and slows for the bends it can
 * see coming. It exists to test the map (can every bend be taken the way it was designed?) and
 * to let the slice drive itself for screenshots and frame-time runs. It is not opponent AI.
 */
export interface DriverStyle {
  /** Cornering the driver is willing to use on tarmac / gravel (m/s²). */
  lateral: number; lateralGravel: number;
  /** Braking the driver plans for (m/s²). */
  braking: number;
  /** Hardest brake input allowed (0..1): 0 = lift only, 0.35 = light brake, 1 = anything. */
  maxBrake: number;
  /** Never exceed this speed (m/s). */
  topSpeed: number;
}
export const BRISK: DriverStyle = { lateral: 9.5, lateralGravel: 5.8, braking: 6.5, maxBrake: 1, topSpeed: 90 };

export class Autopilot {
  road!: Road;
  dir: 1 | -1 = 1;
  /** Sample index the car was last beside. */
  i = 0;
  /** Largest brake input used since the last reset of this field. */
  brakeUsed = 0;
  private hit = {} as RoadHit;

  constructor(private world: World, public style: DriverStyle = BRISK) {}

  /** Follow whichever road the car is on, in the direction it faces. Returns false if none is near. */
  attach(v: Vehicle, only: Road | null = null): boolean {
    if (!this.world.nearestRoad(v.position.x, v.position.z, 60, this.hit, only)) return false;
    this.setRoute(this.hit.road, Math.sin(v.heading) * this.hit.road.tx[this.hit.i] + Math.cos(v.heading) * this.hit.road.tz[this.hit.i] >= 0 ? 1 : -1, this.hit.i);
    return true;
  }
  setRoute(road: Road, dir: 1 | -1, i: number) { this.road = road; this.dir = dir; this.i = i; }

  private index(i: number) { const r = this.road; return r.closed ? ((i % r.n) + r.n) % r.n : Math.min(r.n - 1, Math.max(0, i)); }

  /** True once an open road has been driven to its end. */
  get finished() { const r = this.road; return !r.closed && (this.dir > 0 ? this.i >= r.n - 4 : this.i <= 3); }

  drive(v: Vehicle, out: VehicleInput): VehicleInput {
    const road = this.road, s = this.style, x = v.position.x, z = v.position.z;
    // Track progress: nearest sample within a window ahead of the last one.
    let best = this.i, bd = Infinity;
    for (let k = -4; k <= 40; k++) {
      const j = this.index(this.i + k * this.dir), d = (road.x[j] - x) ** 2 + (road.z[j] - z) ** 2;
      if (d < bd) { bd = d; best = j; }
    }
    this.i = best;
    const speed = Math.max(0, v.speed), step = road.step;
    // Steer: aim at a point further ahead the faster we go.
    const reach = Math.min(48, Math.max(7, 5 + speed * 0.55));
    const t = this.index(best + Math.round(reach / step) * this.dir);
    const dx = road.x[t] - x, dz = road.z[t] - z, sh = Math.sin(v.heading), ch = Math.cos(v.heading);
    const fwd = dx * sh + dz * ch, left = dx * ch - dz * sh;
    const want = (2 * left) / Math.max(1, fwd * fwd + left * left); // curvature to reach it, + = left
    const have = speed > 3 ? v.yawRate / speed : want;
    const most = Math.min(0.26, 11 / Math.max(1, speed * speed));
    out.steer = -Math.min(1, Math.max(-1, (want + 0.6 * (want - have)) / most));
    out.digital = false;
    // Speed: the slowest bend within braking distance sets the pace.
    const grip = road.def.surface === GRAVEL ? s.lateralGravel : s.lateral;
    const horizon = (speed * speed) / (2 * s.braking) + 50;
    let target = s.topSpeed;
    for (let d = 0; d < horizon; d += step * 2) {
      const j = this.index(best + Math.round(d / step) * this.dir);
      const bend = Math.sqrt(grip / Math.max(1e-4, Math.abs(road.k[j])));
      const now = Math.sqrt(bend * bend + 2 * s.braking * 0.8 * Math.max(0, d - 8));
      if (now < target) target = now;
    }
    if (this.finished) target = 0;
    out.handbrake = false;
    if (speed < target - 0.8) { out.throttle = 1; out.brake = 0; }
    else if (speed > target + 1.2) { out.throttle = 0; out.brake = Math.min(s.maxBrake, Math.max(0, (speed - target - 1.2) / 5)); }
    else { out.throttle = 0.35; out.brake = 0; }
    if (out.brake > this.brakeUsed) this.brakeUsed = out.brake;
    return out;
  }
}
