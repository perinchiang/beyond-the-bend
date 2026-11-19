import { ASPHALT, GRASS, GRAVEL, SHOULDER, Ground, Obstacle, Obstacles, newGroundSample } from '../ground';

/**
 * Force-based car for the graybox slice: a 6-DOF rigid body on four sprung raycast wheels,
 * slip-angle tyres with a friction circle, a geared engine, and a few driving aids that make
 * it holdable on a keyboard. No three.js here, so it runs headless (tools/slice-handling.mjs).
 *
 * Conventions (see ../ground.ts): heading h = rotation about +Y, forward = (sin h, 0, cos h),
 * LEFT = (cos h, 0, -sin h), positive yaw rate turns left. Body frame: +X left, +Y up, +Z forward.
 * `VehicleInput.steer` is driver-named: +1 = right.
 */

export interface VehicleInput {
  /** 0..1 */
  throttle: number;
  /** 0..1. Held at a standstill with no throttle it selects reverse and becomes the reverse throttle. */
  brake: number;
  /** -1..1, + = right */
  steer: number;
  handbrake: boolean;
  /** true when steer comes from keys/buttons (all-or-nothing): the wheel is wound on progressively. */
  digital?: boolean;
}

export interface WheelState {
  /** World position of the wheel centre. */
  x: number; y: number; z: number;
  /** Suspension travel from static rest, + = compressed (m). */
  compression: number;
  contact: boolean;
  /** Steer angle for drawing (rad, + = left). Clamped to ±0.61; the physics may use more while a slide is being caught. */
  steer: number;
  /** Accumulated rolling angle (rad). */
  spin: number;
  /** 0 = gripping, about 0.5 = at the limit (squeal), 1+ = sliding. */
  slip: number;
  /** ASPHALT | SHOULDER | GRASS | GRAVEL under this wheel. */
  surface: number;
}

/** How one kind of ground treats a tyre. */
export interface TyreSurface {
  /** Peak grip (g). Higher = more cornering and braking. */
  mu: number;
  /** Slip angle at peak grip (deg). Higher = the car slides at bigger, lazier angles before it lets go. */
  peakDeg: number;
  /** Grip kept far beyond the peak (0..1). Lower = a slide is harder to gather up. */
  tail: number;
  /** Rolling drag coefficient. Higher = slower on this surface. */
  roll: number;
  /** How readily the driven wheels spin up here (1 = tarmac). Higher = the throttle swings the tail out more. */
  spin: number;
}

export interface VehicleSpec {
  // ---- body ----
  /** kg. Heavier = lazier to accelerate and stop, calmer over bumps. */
  mass: number;
  /** kg·m². Higher yaw inertia = slower to start and stop rotating. */
  inertiaYaw: number; inertiaPitch: number; inertiaRoll: number;
  wheelbase: number; track: number; wheelRadius: number;
  /** Centre-of-gravity height (m). Higher = more dive, squat and lean. */
  cgHeight: number;
  /** Share of weight on the front axle. Higher = more understeer, steadier in a straight line. */
  frontWeight: number;
  /** Body half-length and half-width used against obstacles (m). */
  halfLength: number; halfWidth: number;

  // ---- suspension ----
  /** Ride frequency (Hz). Higher = stiffer, flatter, harsher over crests. */
  rideFreqFront: number; rideFreqRear: number;
  /** Damping ratios. Higher bump = less dive on landing; higher rebound = settles sooner, less float. */
  dampBump: number; dampRebound: number;
  /** Free suspension length and compression travel before the bump stop (m). */
  suspLength: number; bumpTravel: number;
  /** Bump stop stiffness as a multiple of the spring. */
  bumpStopRate: number;
  /** Anti-roll bar rates (N/m). More front = more understeer, more rear = more rotation. */
  antiRollFront: number; antiRollRear: number;
  /** Share of cornering roll / braking pitch torque removed (0..1). Higher = flatter body, cannot roll over. */
  antiRoll: number; antiPitch: number;

  // ---- tyres ----
  surfaces: TyreSurface[];
  /** Per-axle grip multipliers. Rear above front = stable; equal or lower = tail-happy. */
  gripFront: number; gripRear: number;
  /** How much rear side grip the throttle uses up (0..1). Higher = easier power slides. */
  powerSlide: number;
  /** Share of the rear tyres' grip that full throttle spends on wheelspin once the car is already sliding (0..1).
   *  Higher = a drift is easier to keep going on the throttle but runs wider; 0 = slides die out by themselves. */
  driftPower: number;
  /** Side grip kept under hard braking (0..1 of the circle used). Lower = more steerable on the brakes. */
  brakeSlide: number;
  /** Grip of a locked (handbrake) rear tyre relative to a rolling one. */
  handbrakeGrip: number;
  /** Grass: seconds to bog down / to free itself, and drag per m/s of speed (1/s) when fully bogged. */
  grassIn: number; grassOut: number; grassDrag: number;

  // ---- engine and gears ----
  torqueRpm: number[]; torqueNm: number[];
  idleRpm: number; redlineRpm: number;
  /** Revs the clutch holds when pulling away. Higher = punchier launch. */
  launchRpm: number;
  gears: number[]; reverseGear: number; finalDrive: number;
  /** Torque multiplier per gear. Lower first numbers = gentler launch. */
  gearTorque: number[];
  driveEfficiency: number;
  /** Share of drive sent to the front axle. Lower = more rear-driven, more power oversteer. */
  driveFront: number;
  shiftUpRpm: number; kickdownRpm: number; shiftDownRpm: number;
  /** Revs at which it changes up when you are only holding a steady speed. Lower = quieter cruising,
   *  but the car is then a gear higher when you lift for the next bend: less engine braking and
   *  less rotation. 5200 made the gravel lift-and-turn-in slide run 0.5 m wider, so it is kept high. */
  cruiseUpRpm: number;
  /** Seconds of torque cut per shift. */
  shiftTime: number;
  /** Engine braking torque (N·m) at idle and extra at the redline. Higher = slows more when you lift. */
  engineBrake: number; engineBrakeRev: number;

  // ---- aero and brakes ----
  /** Drag area Cd·A (m²). Higher = lower top speed and more slowing when you lift. */
  dragArea: number;
  /** Downforce area (m²). Higher = more grip at speed. */
  downforceArea: number;
  /** Full-pedal braking demand (g) and front share. */
  brakeG: number; brakeFront: number;

  // ---- steering ----
  /** Front wheel angle at parking speed (rad). */
  steerLock: number;
  /** Cornering (m/s²) that full lock asks for at speed. Higher = a held key turns harder, closer to a slide. */
  steerGrip: number;
  /** Extra lock beyond that (rad): how far past peak grip a held key pushes the front tyres. */
  steerExtra: number;
  /** Keyboard steering: lock fractions per second winding on / unwinding. Lower in = gentler taps. */
  steerInRate: number; steerOutRate: number;
  /** Smoothing of an analog stick (s). */
  analogSteerTau: number;

  // ---- driving aids ----
  /** How fully the front wheels are turned into a slide for you (0..1). 0 = you countersteer yourself. */
  counterSteer: number;
  /** Slide angle (rad) where your steering into a drift runs out. Higher = bigger drift angles on a held key. */
  driftAngle: number;
  /** Steering lock (rad) available while sliding, at any speed. Higher = drifts can be held at higher speeds. */
  driftLock: number;
  /** Yaw damping (1/s). Higher = calmer, more on rails; lower = looser, more tail wag. */
  yawDamp: number;
  /** Share of that damping kept while you are deliberately drifting. */
  driftDamp: number;
  /** While sliding on the throttle, how firmly the slide angle is held steady (1/s).
   *  Higher = drifts settle at an angle and stay there; lower = the tail swings and needs catching. */
  driftHold: number;
  /** Airborne: how firmly the nose follows the flight path, and how fast tumbling is damped. */
  airLevel: number; airDamp: number;

  // ---- obstacles ----
  restitution: number; obstacleFriction: number;
}

export const DEFAULT_SPEC: VehicleSpec = {
  mass: 1200, inertiaYaw: 1600, inertiaPitch: 1500, inertiaRoll: 450,
  wheelbase: 2.42, track: 1.5, wheelRadius: 0.335, cgHeight: 0.45, frontWeight: 0.52,
  halfLength: 2.0, halfWidth: 0.85,

  rideFreqFront: 1.8, rideFreqRear: 1.9, dampBump: 0.5, dampRebound: 0.85,
  suspLength: 0.30, bumpTravel: 0.12, bumpStopRate: 5,
  antiRollFront: 14000, antiRollRear: 9000, antiRoll: 0.55, antiPitch: 0.3,

  surfaces: [
    /* ASPHALT  */ { mu: 1.30, peakDeg: 7, tail: 0.88, roll: 0.012, spin: 1 },
    /* SHOULDER */ { mu: 1.00, peakDeg: 9, tail: 0.92, roll: 0.03, spin: 1.2 },
    /* GRASS    */ { mu: 0.75, peakDeg: 11, tail: 0.94, roll: 0.03, spin: 1.3 },
    /* GRAVEL   */ { mu: 0.90, peakDeg: 12, tail: 0.96, roll: 0.03, spin: 1.5 },
  ],
  gripFront: 1.0, gripRear: 1.06, powerSlide: 0.92, driftPower: 0.76, brakeSlide: 0.75, handbrakeGrip: 0.85,
  grassIn: 0.4, grassOut: 0.25, grassDrag: 0.17,

  torqueRpm: [1000, 2000, 3000, 4500, 6000, 7000, 7500],
  torqueNm: [200, 270, 300, 310, 290, 255, 225],
  idleRpm: 900, redlineRpm: 7500, launchRpm: 3200,
  gears: [3.15, 2.05, 1.50, 1.19, 1.03, 0.92], reverseGear: 3.0, finalDrive: 3.9,
  gearTorque: [0.69, 0.87, 1, 1, 1, 1],
  driveEfficiency: 0.9, driveFront: 0.35,
  shiftUpRpm: 7000, kickdownRpm: 6300, shiftDownRpm: 4200, cruiseUpRpm: 6400, shiftTime: 0.14,
  engineBrake: 50, engineBrakeRev: 80,

  dragArea: 1.0, downforceArea: 0.6, brakeG: 1.25, brakeFront: 0.62,

  steerLock: 0.56, steerGrip: 12.8, steerExtra: 0.045,
  steerInRate: 3.6, steerOutRate: 6.5, analogSteerTau: 0.05,

  counterSteer: 1.0, driftAngle: 0.9, driftLock: 0.122, yawDamp: 2.5, driftDamp: 0.15, driftHold: 5, airLevel: 6, airDamp: 2.5,

  restitution: 0.15, obstacleFriction: 0.4,
};

const G = 9.81, RHO = 1.2, H = 1 / 240, MAX_STEPS = 16, RAY_UP = 1.0;
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const sstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export class Vehicle {
  readonly spec: VehicleSpec;
  /** World position of the model origin: centre of the wheelbase, at ground level when at rest. */
  readonly position = { x: 0, y: 0, z: 0 };
  /** Body orientation for a model whose forward is +Z and up is +Y. */
  readonly quaternion = { x: 0, y: 0, z: 0, w: 1 };
  readonly velocity = { x: 0, y: 0, z: 0 };
  /** FL, FR, RL, RR */
  readonly wheels: WheelState[] = [];
  heading = 0;
  /** Signed forward speed (m/s). */
  speed = 0;
  /** rad/s, + = turning left. */
  yawRate = 0;
  /** rad. + = the car is travelling towards its own left (nose points right of the direction of travel). 0 when slow. */
  sideslip = 0;
  rpm = 900;
  /** -1 reverse, 1..N */
  gear = 1;
  /** No wheel touching the ground. */
  airborne = false;
  /** Felt acceleration in g: + = to the left / forwards. */
  lateralG = 0; longG = 0;
  /** Strength (m/s) of the hardest obstacle or landing hit during the last update, else 0. */
  impact = 0;
  /** Current keyboard/stick steering after wind-on, driver-named (+ = right), -1..1. */
  steerInput = 0;

  // rigid body: CoG position, orientation, linear and angular velocity (world)
  private px = 0; private py = 0; private pz = 0;
  private qx = 0; private qy = 0; private qz = 0; private qw = 1;
  private vx = 0; private vy = 0; private vz = 0;
  private wx = 0; private wy = 0; private wz = 0;
  private acc = 0;
  private shiftT = 0;
  private wasAir = false;
  private flipT = 0;
  private grounded = 1;
  private betaPrev = 0;
  private betaOk = false;
  private gs = newGroundSample();
  private nearList: Obstacle[] = [];
  private nearN = 0;
  private bog = new Float64Array(4);
  private lastT = new Float64Array(4);
  private comp = new Float64Array(4);
  private compV = new Float64Array(4);
  private hit = new Uint8Array(4);
  private rcx = new Float64Array(4); private rcy = new Float64Array(4); private rcz = new Float64Array(4);
  private cnx = new Float64Array(4); private cny = new Float64Array(4); private cnz = new Float64Array(4);
  private surf = new Uint8Array(4);
  private wSteer = new Float64Array(4);
  private tyB = new Float64Array(4); private tyC = new Float64Array(4); private tyPeak = new Float64Array(4);

  // derived from the spec
  private a = 0; private b = 0; private hyF = 0; private hyR = 0;
  private kF = 0; private kR = 0; private cbF = 0; private crF = 0; private cbR = 0; private crR = 0;
  private xsF = 0; private xsR = 0; private fzF = 0; private fzR = 0;
  private cgZ = 0;

  constructor(private ground: Ground, private obstacles: Obstacles | null = null, spec: Partial<VehicleSpec> = {}) {
    this.spec = { ...DEFAULT_SPEC, ...spec };
    for (let i = 0; i < 4; i++) this.wheels.push({ x: 0, y: 0, z: 0, compression: 0, contact: true, steer: 0, spin: 0, slip: 0, surface: ASPHALT });
    this.configure();
    this.reset(0, 0, 0);
  }

  /** Recompute derived constants after editing `spec` in place. */
  configure() {
    const s = this.spec;
    this.a = s.wheelbase * (1 - s.frontWeight);
    this.b = s.wheelbase * s.frontWeight;
    this.cgZ = s.wheelbase * (s.frontWeight - 0.5);
    const mF = (s.mass * s.frontWeight) / 2, mR = (s.mass * (1 - s.frontWeight)) / 2;
    const wF = 2 * Math.PI * s.rideFreqFront, wR = 2 * Math.PI * s.rideFreqRear;
    this.kF = mF * wF * wF; this.kR = mR * wR * wR;
    this.cbF = 2 * s.dampBump * mF * wF; this.crF = 2 * s.dampRebound * mF * wF;
    this.cbR = 2 * s.dampBump * mR * wR; this.crR = 2 * s.dampRebound * mR * wR;
    this.xsF = G / (wF * wF); this.xsR = G / (wR * wR);
    this.fzF = mF * G; this.fzR = mR * G;
    this.hyF = s.wheelRadius + s.suspLength - this.xsF - s.cgHeight;
    this.hyR = s.wheelRadius + s.suspLength - this.xsR - s.cgHeight;
    for (let i = 0; i < s.surfaces.length && i < 4; i++) {
      const t = s.surfaces[i];
      const C = 2 - (2 * Math.asin(clamp(t.tail, 0.3, 0.999))) / Math.PI;
      const peak = (t.peakDeg * Math.PI) / 180;
      this.tyC[i] = C; this.tyPeak[i] = peak; this.tyB[i] = Math.tan(Math.PI / (2 * C)) / peak;
    }
  }

  /** Largest front-wheel angle (rad) the driver's steering reaches at this speed (m/s). */
  maxSteerAngle(speed: number): number {
    const s = this.spec, v = Math.max(Math.abs(speed), 1);
    return Math.min(s.steerLock, Math.atan((s.wheelbase * s.steerGrip) / (v * v)) + s.steerExtra);
  }

  /** Put the car on the ground at (x, z) facing `heading`, optionally already rolling, and clear all state. */
  reset(x: number, z: number, heading: number, speed = 0) {
    const s = this.spec, g = this.ground.sample(x, z, this.gs);
    // basis: up = ground normal, forward = heading projected onto the ground
    let ux = g.nx, uy = g.ny, uz = g.nz;
    if (!(uy > 0.3)) { ux = 0; uy = 1; uz = 0; }
    let fx = Math.sin(heading), fy = 0, fz = Math.cos(heading);
    const d = fx * ux + fy * uy + fz * uz;
    fx -= ux * d; fy -= uy * d; fz -= uz * d;
    const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    const lx = uy * fz - uz * fy, ly = uz * fx - ux * fz, lz = ux * fy - uy * fx;
    // rotation matrix columns (l, u, f) -> quaternion
    const m00 = lx, m11 = uy, m22 = fz, tr = m00 + m11 + m22;
    if (tr > 0) {
      const k = Math.sqrt(tr + 1) * 2;
      this.qw = k / 4; this.qx = (uz - fy) / k; this.qy = (fx - lz) / k; this.qz = (ly - ux) / k;
    } else if (m00 > m11 && m00 > m22) {
      const k = Math.sqrt(1 + m00 - m11 - m22) * 2;
      this.qw = (uz - fy) / k; this.qx = k / 4; this.qy = (ux + ly) / k; this.qz = (fx + lz) / k;
    } else if (m11 > m22) {
      const k = Math.sqrt(1 + m11 - m00 - m22) * 2;
      this.qw = (fx - lz) / k; this.qx = (ux + ly) / k; this.qy = k / 4; this.qz = (fy + uz) / k;
    } else {
      const k = Math.sqrt(1 + m22 - m00 - m11) * 2;
      this.qw = (ly - ux) / k; this.qx = (fx + lz) / k; this.qy = (fy + uz) / k; this.qz = k / 4;
    }
    this.px = x + ux * s.cgHeight + fx * this.cgZ;
    this.py = g.y + uy * s.cgHeight + fy * this.cgZ;
    this.pz = z + uz * s.cgHeight + fz * this.cgZ;
    this.vx = fx * speed; this.vy = fy * speed; this.vz = fz * speed;
    this.wx = this.wy = this.wz = 0;
    this.acc = 0; this.shiftT = 0; this.steerInput = 0; this.wasAir = false; this.flipT = 0;
    this.bog.fill(0); this.impact = 0; this.lateralG = 0; this.longG = 0;
    for (let i = 0; i < 4; i++) { this.lastT[i] = s.wheelRadius + s.suspLength - (i < 2 ? this.xsF : this.xsR); this.wheels[i].spin = 0; this.wheels[i].slip = 0; }
    this.gear = 1;
    if (speed < -0.5) this.gear = -1;
    else for (let gi = 0; gi < s.gears.length - 1; gi++) {
      if ((speed / s.wheelRadius) * s.gears[gi] * s.finalDrive * 9.5493 > s.shiftUpRpm - 400) this.gear = gi + 2;
    }
    this.rpm = s.idleRpm;
    this.step(0, IDLE);
    this.publish();
  }

  /** Override the motion (tests, teleports): world velocity on the ground plane and yaw rate. */
  setMotion(vx: number, vz: number, yawRate = 0) {
    this.vx = vx; this.vz = vz; this.vy = 0;
    this.wx = 0; this.wy = yawRate; this.wz = 0;
    this.publish();
  }

  /** Advance by a frame of any length. Physics runs in fixed 1/240 s steps. */
  update(dt: number, input: VehicleInput) {
    this.impact = 0;
    if (!(dt > 0)) { this.publish(); return; }
    const gx = this.px, gy = this.py, gz = this.pz, g0 = this.qx, g1 = this.qy, g2 = this.qz, g3 = this.qw;
    if (this.obstacles) {
      const reach = 4 + Math.hypot(this.vx, this.vz) * Math.min(dt, MAX_STEPS * H);
      this.nearN = this.obstacles.near(this.px, this.pz, reach, this.nearList);
    } else this.nearN = 0;
    this.acc = Math.min(this.acc + dt, MAX_STEPS * H);
    while (this.acc >= H) { this.step(H, input); this.acc -= H; }
    const sum = this.px + this.py + this.pz + this.vx + this.vy + this.vz + this.wx + this.wy + this.wz + this.qx + this.qy + this.qz + this.qw;
    if (!Number.isFinite(sum)) {
      // never hand NaN to the game: fall back to where this frame started, at rest
      this.px = gx; this.py = gy; this.pz = gz; this.qx = g0; this.qy = g1; this.qz = g2; this.qw = g3;
      if (!Number.isFinite(gx + gy + gz + g0 + g1 + g2 + g3)) { this.px = this.py = this.pz = 0; this.qx = this.qy = this.qz = 0; this.qw = 1; }
      this.vx = this.vy = this.vz = this.wx = this.wy = this.wz = 0;
    }
    this.publish();
  }

  private publish() {
    const s = this.spec, qx = this.qx, qy = this.qy, qz = this.qz, qw = this.qw;
    const uX = 2 * (qx * qy - qw * qz), uY = 1 - 2 * (qx * qx + qz * qz), uZ = 2 * (qy * qz + qw * qx);
    const fX = 2 * (qx * qz + qw * qy), fY = 2 * (qy * qz - qw * qx), fZ = 1 - 2 * (qx * qx + qy * qy);
    const lX = 1 - 2 * (qy * qy + qz * qz), lY = 2 * (qx * qy + qw * qz), lZ = 2 * (qx * qz - qw * qy);
    const p = this.position, q = this.quaternion, v = this.velocity;
    p.x = this.px - uX * s.cgHeight - fX * this.cgZ;
    p.y = this.py - uY * s.cgHeight - fY * this.cgZ;
    p.z = this.pz - uZ * s.cgHeight - fZ * this.cgZ;
    q.x = qx; q.y = qy; q.z = qz; q.w = qw;
    v.x = this.vx; v.y = this.vy; v.z = this.vz;
    this.heading = Math.atan2(fX, fZ);
    const vF = this.vx * fX + this.vy * fY + this.vz * fZ, vL = this.vx * lX + this.vy * lY + this.vz * lZ;
    this.speed = vF;
    this.yawRate = this.wx * uX + this.wy * uY + this.wz * uZ;
    this.sideslip = Math.hypot(vF, vL) > 2 ? Math.atan2(vL, Math.abs(vF)) : 0;
  }

  private step(h: number, inp: VehicleInput) {
    const s = this.spec, ground = this.ground, gs = this.gs;
    const qx = this.qx, qy = this.qy, qz = this.qz, qw = this.qw;
    const lX = 1 - 2 * (qy * qy + qz * qz), lY = 2 * (qx * qy + qw * qz), lZ = 2 * (qx * qz - qw * qy);
    const uX = 2 * (qx * qy - qw * qz), uY = 1 - 2 * (qx * qx + qz * qz), uZ = 2 * (qy * qz + qw * qx);
    const fX = 2 * (qx * qz + qw * qy), fY = 2 * (qy * qz - qw * qx), fZ = 1 - 2 * (qx * qx + qy * qy);
    const vx = this.vx, vy = this.vy, vz = this.vz, wx = this.wx, wy = this.wy, wz = this.wz;
    const vF = vx * fX + vy * fY + vz * fZ, vL = vx * lX + vy * lY + vz * lZ;
    const spd = Math.hypot(vx, vy, vz);
    const yawR = wx * uX + wy * uY + wz * uZ;

    // ---------------- driver ----------------
    let thr = clamp(inp.throttle, 0, 1), brk = clamp(inp.brake, 0, 1);
    if (!(thr >= 0)) thr = 0;
    if (!(brk >= 0)) brk = 0;
    if (this.gear > 0) { if (vF < 0.5 && brk > 0.1 && thr < 0.05) this.gear = -1; }
    else if (vF > -0.5 && thr > 0.1 && brk < 0.05) this.gear = 1;
    if (this.gear < 0) { const t = thr; thr = brk; brk = t; }
    const hand = !!inp.handbrake;
    if (thr < 0.02 && brk < 0.02 && Math.abs(vF) < 0.4) brk = 0.4; // hold on a slope

    let st = clamp(inp.steer, -1, 1);
    if (!(st >= -1)) st = 0;
    if (h > 0) {
      if (inp.digital) {
        const into = st * this.steerInput >= 0 && Math.abs(st) > Math.abs(this.steerInput);
        const r = (into ? s.steerInRate : s.steerOutRate) * h;
        this.steerInput += clamp(st - this.steerInput, -r, r);
      } else this.steerInput += (st - this.steerInput) * (1 - Math.exp(-h / s.analogSteerTau));
    }
    const aV = Math.abs(vF);
    const lock = this.maxSteerAngle(aV);
    // sideslip at the centre of gravity and at the front axle (+ = moving to the car's left)
    const moving = sstep(3, 8, vF);
    const beta = vF > 1 ? Math.atan2(vL, vF) : 0;
    const fvx = vx + (wy * fZ - wz * fY) * this.a, fvy = vy + (wz * fX - wx * fZ) * this.a, fvz = vz + (wx * fY - wy * fX) * this.a;
    const fLong = fvx * fX + fvy * fY + fvz * fZ, fLat = fvx * lX + fvy * lY + fvz * lZ;
    const betaF = fLong > 1 ? Math.atan2(fLat, fLong) : 0;
    const betaDot = h > 0 && vF > 1 && this.betaOk ? (beta - this.betaPrev) / h : 0;
    this.betaPrev = beta; this.betaOk = vF > 1;
    // The driver's own steering (+ = left). Steering further into a slide runs out at driftAngle,
    // so a held key settles at a drift angle instead of spinning.
    // "Sliding" is measured against the slip angle where the rear tyres peak on this surface,
    // so a loose surface is allowed its bigger everyday angles before the aids step in.
    const pk = (this.tyPeak[this.surf[2] & 3] + this.tyPeak[this.surf[3] & 3]) / 2;
    const aB = Math.abs(beta);
    const alphaR = vF > 1 ? Math.abs(Math.atan2(vL - yawR * this.b, vF)) : 0;
    const sliding = moving * sstep(0.75 * pk, 1.7 * pk, aB);
    let dP = -this.steerInput * lock;
    const into = dP * beta < 0;
    if (into) {
      if (lock < s.driftLock) dP *= 1 + (s.driftLock / lock - 1) * sliding;
      dP *= 1 - moving * sstep(0.8 * pk, s.driftAngle + 2 * (pk - 0.122), aB);
    } else dP *= 1 - 0.6 * sliding; // the wheels are already being turned into the slide: your own countersteer only helps a little
    // Turn the front wheels into the slide (what a driver's hands do) once the rear is past its peak.
    const dA = s.counterSteer * moving * sstep(0.8 * pk, 1.6 * pk, alphaR) * clamp(betaF, -1.25, 1.25);
    const delta = dP + dA;
    const intent = hand ? 1 : (into ? 1 : 0) * sstep(0.2, 0.6, thr) * sstep(0.15, 0.5, Math.abs(this.steerInput));

    // ---------------- engine and gears ----------------
    let gearRatio = this.gear > 0 ? s.gears[this.gear - 1] : s.reverseGear;
    let rpmW = (aV / s.wheelRadius) * gearRatio * s.finalDrive * 9.5493;
    if (this.shiftT > 0) this.shiftT -= h;
    else if (this.gear > 0 && h > 0) {
      // Flat out it revs right out; holding a steady speed on part throttle it changes up early.
      // Fully lifted it keeps the gear, so lifting for a bend still gives engine braking.
      // Never mid-corner or mid-slide: a change there would cut the drive the driver is balancing on.
      const cruising = thr > 0.05 && thr < 0.6 && brk < 0.05 && Math.abs(this.sideslip) < 0.05 && Math.abs(this.lateralG) < 0.35;
      if (rpmW > (cruising ? s.cruiseUpRpm : s.shiftUpRpm) && this.gear < s.gears.length && vF > 0) { this.gear++; this.shiftT = s.shiftTime; }
      else if (this.gear > 1) {
        const lower = (rpmW * s.gears[this.gear - 2]) / gearRatio;
        if (lower < (thr > 0.5 || brk > 0.2 ? s.kickdownRpm : s.shiftDownRpm)) { this.gear--; this.shiftT = s.shiftTime; }
      }
      gearRatio = s.gears[this.gear - 1];
      rpmW = (aV / s.wheelRadius) * gearRatio * s.finalDrive * 9.5493;
    }
    const ratio = gearRatio * s.finalDrive;
    const first = this.gear === 1 || this.gear === -1;
    const rpmE = Math.max(rpmW, first ? s.idleRpm + (s.launchRpm - s.idleRpm) * thr : s.idleRpm);
    let tq = 0;
    {
      const R = s.torqueRpm, T = s.torqueNm, n = R.length;
      if (rpmE <= R[0]) tq = T[0];
      else if (rpmE >= R[n - 1]) tq = T[n - 1];
      else for (let i = 1; i < n; i++) if (rpmE < R[i]) { tq = T[i - 1] + ((T[i] - T[i - 1]) * (rpmE - R[i - 1])) / (R[i] - R[i - 1]); break; }
    }
    const limiter = 1 - sstep(s.redlineRpm - 250, s.redlineRpm, rpmW);
    const gscale = this.gear > 0 ? s.gearTorque[this.gear - 1] ?? 1 : s.gearTorque[0] ?? 1;
    const dir = this.gear < 0 ? -1 : 1;
    const driveF = (dir * tq * thr * limiter * gscale * (this.shiftT > 0 ? 0.1 : 1) * ratio * s.driveEfficiency) / s.wheelRadius;
    const ebF = thr < 0.05 && aV > 1 ? ((s.engineBrake + (s.engineBrakeRev * Math.min(rpmW, s.redlineRpm)) / s.redlineRpm) * ratio) / s.wheelRadius : 0;
    const brakeF = brk * s.brakeG * s.mass * G;
    this.rpm += (Math.min(rpmE, s.redlineRpm) - this.rpm) * (h > 0 ? 1 - Math.exp(-h / 0.05) : 1);

    // ---------------- forces ----------------
    let Fx = 0, Fy = -s.mass * G, Fz = 0; // world force
    let Tx = 0, Ty = 0, Tz = 0; // world torque about the CoG (everything except tyre grip)
    let tTx = 0, tTy = 0, tTz = 0; // torque from tyre grip, reshaped below
    let gFx = 0, gFy = 0, gFz = 0; // felt (non-gravity) force

    // aero
    {
      const k = 0.5 * RHO * s.dragArea * spd;
      const dn = 0.5 * RHO * s.downforceArea * vF * vF * this.grounded;
      const ax = -k * vx - uX * dn, ay = -k * vy - uY * dn, az = -k * vz - uZ * dn;
      Fx += ax; Fy += ay; Fz += az; gFx += ax; gFy += ay; gFz += az;
    }

    // wheels, pass 1: find the ground under each wheel
    const halfT = s.track / 2, free = s.suspLength + s.wheelRadius;
    let contacts = 0;
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      const hx = (i & 1) === 0 ? halfT : -halfT, hy = front ? this.hyF : this.hyR, hz = front ? this.a : -this.b;
      const rx = lX * hx + uX * hy + fX * hz, ry = lY * hx + uY * hy + fY * hz, rz = lZ * hx + uZ * hy + fZ * hz;
      const ox = this.px + rx + uX * RAY_UP, oy = this.py + ry + uY * RAY_UP, oz = this.pz + rz + uZ * RAY_UP;
      let t = RAY_UP + this.lastT[i], ok = false, dn = -1;
      for (let k = 0; k < 2; k++) {
        const sx = ox - uX * t, sz = oz - uZ * t;
        ground.sample(sx, sz, gs);
        dn = -(uX * gs.nx + uY * gs.ny + uZ * gs.nz);
        if (!(dn < -0.15)) { ok = false; break; }
        t = ((sx - ox) * gs.nx + (gs.y - oy) * gs.ny + (sz - oz) * gs.nz) / dn;
        ok = Number.isFinite(t);
        if (!ok) break;
      }
      const tH = t - RAY_UP;
      const x = free - tH; // compression from fully extended
      this.surf[i] = gs.surface;
      if (ok && x > 0) {
        this.hit[i] = 1; contacts++;
        this.comp[i] = x;
        this.lastT[i] = clamp(tH, 0, free);
        const cx = rx - uX * tH, cy = ry - uY * tH, cz = rz - uZ * tH;
        this.rcx[i] = cx; this.rcy[i] = cy; this.rcz[i] = cz;
        this.cnx[i] = gs.nx; this.cny[i] = gs.ny; this.cnz[i] = gs.nz;
        const pvx = vx + wy * cz - wz * cy, pvy = vy + wz * cx - wx * cz, pvz = vz + wx * cy - wy * cx;
        this.compV[i] = (pvx * gs.nx + pvy * gs.ny + pvz * gs.nz) / dn;
      } else {
        this.hit[i] = 0; this.comp[i] = 0; this.compV[i] = 0; this.lastT[i] = free;
      }
    }
    if (contacts > 0 && this.wasAir) {
      // closing speed with the ground on touchdown
      let n = 0, c = 0;
      for (let i = 0; i < 4; i++) if (this.hit[i]) { c += this.compV[i]; n++; }
      if (n && c / n > this.impact) this.impact = c / n;
    }
    this.wasAir = contacts === 0;
    this.airborne = contacts === 0;
    this.grounded = contacts / 4;

    // wheels, pass 2: suspension and tyres
    const mw = s.mass / 4;
    const spinOut = s.driftPower * thr * moving * sstep(0.75 * pk, 1.6 * pk, aB);
    const cosD = Math.cos(delta), sinD = Math.sin(delta);
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i], front = i < 2;
      const sf = this.surf[i] < 4 ? this.surf[i] : GRASS;
      // grass grabs gradually and lets go quickly
      const onGrass = this.hit[i] && sf === GRASS ? 1 : 0;
      if (h > 0) this.bog[i] += (onGrass - this.bog[i]) * (1 - Math.exp(-h / (onGrass > this.bog[i] ? s.grassIn : s.grassOut)));
      const xs = front ? this.xsF : this.xsR;
      const xc = clamp(this.comp[i], 0, xs + s.bumpTravel + 0.04);
      w.compression = xc - xs;
      w.contact = this.hit[i] === 1;
      w.surface = sf;
      w.steer = front ? clamp(delta, -0.61, 0.61) : 0;
      // wheel centre, for drawing
      {
        const hx = (i & 1) === 0 ? halfT : -halfT, hy = (front ? this.hyF : this.hyR) - (s.suspLength - xc), hz = front ? this.a : -this.b;
        w.x = this.px + lX * hx + uX * hy + fX * hz; w.y = this.py + lY * hx + uY * hy + fY * hz; w.z = this.pz + lZ * hx + uZ * hy + fZ * hz;
      }
      if (!this.hit[i]) { w.slip *= 0.9; w.spin += ((hand && !front ? 0 : vF) / s.wheelRadius) * h; continue; }

      const x = this.comp[i], xv = this.compV[i];
      const k = front ? this.kF : this.kR;
      const other = this.comp[i ^ 1];
      let fz = k * x + (xv > 0 ? (front ? this.cbF : this.cbR) : front ? this.crF : this.crR) * xv
        + (front ? s.antiRollFront : s.antiRollRear) * (x - other);
      const over = x - (xs + s.bumpTravel);
      if (over > 0) fz += k * s.bumpStopRate * over;
      const fzStatic = front ? this.fzF : this.fzR;
      fz = clamp(fz, 0, fzStatic * 7);
      const nx = this.cnx[i], ny = this.cny[i], nz = this.cnz[i];
      const cx = this.rcx[i], cy = this.rcy[i], cz = this.rcz[i];
      // normal force
      {
        const ax = nx * fz, ay = ny * fz, az = nz * fz;
        Fx += ax; Fy += ay; Fz += az; gFx += ax; gFy += ay; gFz += az;
        Tx += cy * az - cz * ay; Ty += cz * ax - cx * az; Tz += cx * ay - cy * ax;
      }
      // wheel axes on the ground plane
      let ax = front ? fX * cosD + lX * sinD : fX, ay = front ? fY * cosD + lY * sinD : fY, az = front ? fZ * cosD + lZ * sinD : fZ;
      const dd = ax * nx + ay * ny + az * nz;
      ax -= nx * dd; ay -= ny * dd; az -= nz * dd;
      const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
      const bx = ny * az - nz * ay, by = nz * ax - nx * az, bz = nx * ay - ny * ax; // wheel-left
      const pvx = vx + wy * cz - wz * cy, pvy = vy + wz * cx - wx * cz, pvz = vz + wx * cy - wy * cx;
      const vLong = pvx * ax + pvy * ay + pvz * az, vLat = pvx * bx + pvy * by + pvz * bz;

      const ts = s.surfaces[sf];
      const fMax = ts.mu * (front ? s.gripFront : s.gripRear) * fz;
      let fLon = 0, fSide = 0, slip = 0;
      if (fMax > 1) {
        const stopCap = h > 0 ? (0.7 * mw) / h : 0;
        if (hand && !front) {
          // locked wheel: plain sliding friction against the direction of travel
          const vm = Math.hypot(vLong, vLat);
          const f = Math.min(fMax * s.handbrakeGrip, stopCap * vm);
          if (vm > 1e-4) { fLon = (-f * vLong) / vm; fSide = (-f * vLat) / vm; }
          slip = vm > 1 ? 1 : vm;
        } else {
          const share = front ? s.driveFront / 2 : (1 - s.driveFront) / 2;
          const drive = driveF * share;
          const resist = brakeF * (front ? s.brakeFront / 2 : (1 - s.brakeFront) / 2) + ebF * share
            + fz * ts.roll + this.bog[i] * s.grassDrag * Math.abs(vLong) * mw;
          const res = -Math.sign(vLong) * Math.min(resist, stopCap * Math.abs(vLong));
          const req = drive + res;
          fLon = clamp(req, -fMax, fMax);
          let u = Math.abs(drive) > Math.abs(res) ? Math.min(1, (Math.abs(req) / fMax) * (front ? 1 : ts.spin)) * s.powerSlide : Math.min(1, Math.abs(req) / fMax) * s.brakeSlide;
          if (!front && spinOut > u) u = spinOut;
          const cap = fMax * Math.sqrt(1 - u * u);
          const alpha = Math.atan2(vLat, Math.max(Math.abs(vLong), 1.5));
          fSide = -cap * Math.sin(this.tyC[sf] * Math.atan(this.tyB[sf] * alpha));
          const sc = stopCap * Math.abs(vLat);
          if (fSide > sc) fSide = sc; else if (fSide < -sc) fSide = -sc;
          slip = Math.max(Math.min(1.5, (0.5 * Math.abs(alpha)) / this.tyPeak[sf]), Math.abs(req) > fMax ? Math.min(1, 0.6 + 0.4 * (Math.abs(req) / fMax - 1)) : 0)
            * sstep(0.5, 3, Math.abs(vLong) + Math.abs(vLat));
        }
      }
      w.slip += (slip - w.slip) * 0.25;
      w.spin += ((hand && !front ? 0 : vLong) / s.wheelRadius) * h;
      const tx = ax * fLon + bx * fSide, ty = ay * fLon + by * fSide, tz = az * fLon + bz * fSide;
      Fx += tx; Fy += ty; Fz += tz; gFx += tx; gFy += ty; gFz += tz;
      tTx += cy * tz - cz * ty; tTy += cz * tx - cx * tz; tTz += cx * ty - cy * tx;
    }
    // tyre grip leans and pitches the body less than it really would: flatter, and it cannot trip over
    {
      const tl = tTx * lX + tTy * lY + tTz * lZ, tu = tTx * uX + tTy * uY + tTz * uZ, tf = tTx * fX + tTy * fY + tTz * fZ;
      const p = tl * (1 - s.antiPitch), r = tf * (1 - s.antiRoll);
      Tx += lX * p + uX * tu + fX * r; Ty += lY * p + uY * tu + fY * r; Tz += lZ * p + uZ * tu + fZ * r;
    }

    // body touching the ground (hard landings, upside down)
    {
      const low = contacts < 4 || uY < 0.5 || this.comp[0] + this.comp[1] + this.comp[2] + this.comp[3] > 4 * (this.xsF + s.bumpTravel * 0.8);
      if (low) {
        const yb = -(s.cgHeight - 0.15), n = uY < 0.5 ? 8 : 4;
        for (let i = 0; i < n; i++) {
          const top = i >= 4;
          const hx = ((i & 1) === 0 ? 1 : -1) * (top ? 0.5 : 0.75), hy = top ? 0.9 : yb, hz = ((i & 2) === 0 ? 1 : -1) * (top ? 0.5 : 1.85);
          const rx = lX * hx + uX * hy + fX * hz, ry = lY * hx + uY * hy + fY * hz, rz = lZ * hx + uZ * hy + fZ * hz;
          ground.sample(this.px + rx, this.pz + rz, gs);
          const pen = (gs.y - (this.py + ry)) * gs.ny;
          if (pen <= 0) continue;
          const pvx = vx + wy * rz - wz * ry, pvy = vy + wz * rx - wx * rz, pvz = vz + wx * ry - wy * rx;
          const vn = pvx * gs.nx + pvy * gs.ny + pvz * gs.nz;
          const fn = clamp(150000 * pen - 9000 * vn, 0, s.mass * G * 6);
          const txv = pvx - gs.nx * vn, tyv = pvy - gs.ny * vn, tzv = pvz - gs.nz * vn;
          const tv = Math.hypot(txv, tyv, tzv), ff = (-0.45 * fn) / Math.max(tv, 0.5);
          const ax = gs.nx * fn + txv * ff, ay = gs.ny * fn + tyv * ff, az = gs.nz * fn + tzv * ff;
          Fx += ax; Fy += ay; Fz += az; gFx += ax; gFy += ay; gFz += az;
          Tx += ry * az - rz * ay; Ty += rz * ax - rx * az; Tz += rx * ay - ry * ax;
          if (-vn > this.impact) this.impact = -vn;
        }
      }
    }

    // ---------------- driving aids (torques) ----------------
    // yaw damper towards the turn the steering asks for
    if (contacts >= 2) {
      const vch = 34;
      const want = clamp((vF * Math.tan(dP)) / (s.wheelbase * (1 + (vF * vF) / (vch * vch))), -s.steerGrip / Math.max(aV, 5), s.steerGrip / Math.max(aV, 5));
      const k = s.yawDamp * s.inertiaYaw * sstep(5, 15, aV) * (1 - (1 - s.driftDamp) * intent) * (contacts / 4);
      // ... and, in a slide, towards keeping the slide angle where it is
      const kb = hand ? 0 : s.driftHold * s.inertiaYaw * moving * sstep(0.75 * pk, 1.6 * pk, aB) * (0.25 + 0.75 * thr) * (contacts / 4);
      const t = -k * (yawR - want) + kb * clamp(betaDot, -3, 3);
      Tx += uX * t; Ty += uY * t; Tz += uZ * t;
    }
    // in the air: point the nose along the flight path, level the roll, damp tumbling
    if (contacts === 0) {
      let px_ = 0, rl = 0;
      if (spd > 5 && vF > 0) {
        // rotation that takes forward onto the velocity direction, pitch component only
        const ex = (fY * vz - fZ * vy) / spd, ey = (fZ * vx - fX * vz) / spd, ez = (fX * vy - fY * vx) / spd;
        px_ = ex * lX + ey * lY + ez * lZ;
      }
      // roll that takes the body's up onto world up
      rl = -uZ * fX + uX * fZ;
      const wl = wx * lX + wy * lY + wz * lZ, wu = yawR, wf = wx * fX + wy * fY + wz * fZ;
      const tp = s.inertiaPitch * (s.airLevel * s.airLevel * px_ - 2 * s.airLevel * wl);
      const tr = s.inertiaRoll * (s.airLevel * s.airLevel * rl - 2 * s.airLevel * wf);
      const tyw = -s.inertiaYaw * s.airDamp * wu;
      Tx += lX * tp + fX * tr + uX * tyw; Ty += lY * tp + fY * tr + uY * tyw; Tz += lZ * tp + fZ * tr + uZ * tyw;
    }
    // never stay on the roof or a side
    if (uY < 0.55) {
      this.flipT += h;
      const k = s.inertiaRoll * 30 * sstep(0.15, 0.6, this.flipT) * (1 - sstep(0.3, 0.55, uY));
      // axis that rotates up onto world up: u × Y
      const ax = -uZ, az = uX;
      Tx += ax * k - wx * s.inertiaRoll * 3; Ty += -wy * s.inertiaYaw * 2; Tz += az * k - wz * s.inertiaRoll * 3;
      Fy += s.mass * 2 * sstep(0.3, 0.9, this.flipT); // a small lift so the roof does not drag
    } else this.flipT = 0;

    if (!(h > 0)) return;

    // felt acceleration
    {
      const k = 1 - Math.exp(-h / 0.06), m = s.mass * G;
      this.lateralG += ((gFx * lX + gFy * lY + gFz * lZ) / m - this.lateralG) * k;
      this.longG += ((gFx * fX + gFy * fY + gFz * fZ) / m - this.longG) * k;
    }

    // ---------------- integrate ----------------
    const im = 1 / s.mass;
    this.vx = vx + Fx * im * h; this.vy = vy + Fy * im * h; this.vz = vz + Fz * im * h;
    // angular: body frame, diagonal inertia (x = pitch axis, y = yaw, z = roll)
    let wl = wx * lX + wy * lY + wz * lZ, wu = wx * uX + wy * uY + wz * uZ, wf = wx * fX + wy * fY + wz * fZ;
    const tl = Tx * lX + Ty * lY + Tz * lZ, tu = Tx * uX + Ty * uY + Tz * uZ, tf = Tx * fX + Ty * fY + Tz * fZ;
    const Ip = s.inertiaPitch, Iy = s.inertiaYaw, Ir = s.inertiaRoll;
    const dl = (tl - (wu * wf * (Ir - Iy))) / Ip, du = (tu - (wf * wl * (Ip - Ir))) / Iy, df = (tf - (wl * wu * (Iy - Ip))) / Ir;
    wl += dl * h; wu += du * h; wf += df * h;
    const wm = Math.hypot(wl, wu, wf);
    if (wm > 12) { const k = 12 / wm; wl *= k; wu *= k; wf *= k; }
    const nwx = lX * wl + uX * wu + fX * wf, nwy = lY * wl + uY * wu + fY * wf, nwz = lZ * wl + uZ * wu + fZ * wf;
    this.wx = nwx; this.wy = nwy; this.wz = nwz;
    const vm = Math.hypot(this.vx, this.vy, this.vz);
    if (vm > 110) { const k = 110 / vm; this.vx *= k; this.vy *= k; this.vz *= k; }
    this.px += this.vx * h; this.py += this.vy * h; this.pz += this.vz * h;
    const hh = 0.5 * h;
    let nqx = qx + hh * (nwx * qw + nwy * qz - nwz * qy), nqy = qy + hh * (nwy * qw + nwz * qx - nwx * qz);
    let nqz = qz + hh * (nwz * qw + nwx * qy - nwy * qx), nqw = qw - hh * (nwx * qx + nwy * qy + nwz * qz);
    const ql = Math.hypot(nqx, nqy, nqz, nqw) || 1;
    nqx /= ql; nqy /= ql; nqz /= ql; nqw /= ql;
    this.qx = nqx; this.qy = nqy; this.qz = nqz; this.qw = nqw;

    if (this.nearN) this.collide();
  }

  /** Push the car's footprint out of nearby cylinders and bounce it off them. */
  private collide() {
    const s = this.spec;
    const qx = this.qx, qy = this.qy, qz = this.qz, qw = this.qw;
    let fX = 2 * (qx * qz + qw * qy), fZ = 1 - 2 * (qx * qx + qy * qy);
    const fl = Math.hypot(fX, fZ);
    if (fl < 1e-3) return;
    fX /= fl; fZ /= fl;
    const lX = fZ, lZ = -fX; // left on the ground plane
    // footprint centre: middle of the wheelbase
    const ox = this.px - fX * this.cgZ, oz = this.pz - fZ * this.cgZ;
    for (let i = 0; i < this.nearN; i++) {
      const o = this.nearList[i];
      const dx = o.x - ox, dz = o.z - oz;
      const a = dx * fX + dz * fZ, b = dx * lX + dz * lZ; // obstacle in the car's frame
      // The footprint is a rounded capsule, so an off-centre hit glances off instead of stopping the car dead.
      const seg = s.halfLength - s.halfWidth;
      const ca = clamp(a, -seg, seg);
      let na = a - ca, nb = b;
      const dist = Math.hypot(na, nb);
      const pen = s.halfWidth + o.r - dist;
      if (pen <= 0) continue;
      if (dist > 1e-6) { na /= dist; nb /= dist; } else { na = 0; nb = 1; }
      const cb = nb * s.halfWidth;
      const cax = ca + na * s.halfWidth;
      // normal from car to obstacle, world
      const nx = fX * na + lX * nb, nz = fZ * na + lZ * nb;
      // contact point relative to the CoG (ground plane)
      const rx = fX * (cax - this.cgZ) + lX * cb, rz = fZ * (cax - this.cgZ) + lZ * cb;
      const cvx = this.vx + this.wy * rz, cvz = this.vz - this.wy * rx; // v + ω×r, ω = (0, wy, 0)
      const vn = cvx * nx + cvz * nz;
      this.px -= nx * pen; this.pz -= nz * pen;
      if (vn <= 0) continue;
      const rn = rz * nx - rx * nz; // (r × n)·Y
      const jn = ((1 + s.restitution) * vn) / (1 / s.mass + (rn * rn) / s.inertiaYaw);
      const tx = -nz, tz = nx;
      const vt = cvx * tx + cvz * tz;
      const rt = rz * tx - rx * tz;
      const jt = clamp(vt / (1 / s.mass + (rt * rt) / s.inertiaYaw), -s.obstacleFriction * jn, s.obstacleFriction * jn);
      const ix = -nx * jn - tx * jt, iz = -nz * jn - tz * jt;
      this.vx += ix / s.mass; this.vz += iz / s.mass;
      this.wy += (rz * ix - rx * iz) / s.inertiaYaw;
      if (vn > this.impact) this.impact = vn;
    }
  }
}

const IDLE: VehicleInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

export { ASPHALT, SHOULDER, GRASS, GRAVEL };
