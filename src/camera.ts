import * as THREE from 'three';

/**
 * Two camera modes on one orthographic "miniature lens":
 *
 *  - Driving: an elevated chase view locked behind the car. The player cannot orbit; they
 *    only pick one of three presets. A heading dead zone absorbs small corrections;
 *    larger turns use a damped, speed-limited yaw without catch-up acceleration.
 *  - Free / photo: orbit, tilt, zoom and pan at will. It tracks the car's position but
 *    ignores its heading, so a composition holds while the car moves through it.
 *
 * The rig only ever READS the car's pose. Nothing here feeds back into the vehicle.
 */

export type CameraMode = 'drive' | 'free';

export interface DrivePreset {
  name: string;
  /** Elevation above the horizon (degrees). */
  pitch: number;
  /** Visible height of the view on the focal plane (metres) — smaller is closer. */
  view: number;
  /** How far below screen centre the car sits, as a fraction of screen height. */
  anchor: number;
  /** Time constant (s) of the damped yaw follow. Longer is lazier; the wide view turns the gentlest. */
  yawTime: number;
}

export const DRIVE_PRESETS: readonly DrivePreset[] = [
  { name: 'High', pitch: 58, view: 66, anchor: 0.13, yawTime: 0.40 },
  { name: 'Normal', pitch: 45, view: 44, anchor: 0.17, yawTime: 0.32 },
  { name: 'Close', pitch: 28, view: 24, anchor: 0.20, yawTime: 0.26 },
];
export const DEFAULT_PRESET = 1;

const DEG = Math.PI / 180;
const PITCH_MIN = 22 * DEG, PITCH_MAX = 89 * DEG;
const VIEW_MIN = 9, VIEW_MAX = 230;
// Let the car turn within the frame before rotating the landscape. The rate and
// acceleration caps prevent a large heading error from triggering a catch-up whip.
const YAW_DEAD_ZONE = 12 * DEG;
const YAW_MAX_RATE = 48 * DEG;
const YAW_MAX_ACCEL = 42 * DEG;
/** Time constant (s) for preset and mode changes: tilt, zoom and framing glide rather than cut. */
const MOVE_TIME = 0.42;

const ZERO2 = new THREE.Vector2();
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (rate: number, dt: number, snap: boolean) => (snap ? 1 : 1 - Math.exp(-dt * rate));

/**
 * Critically damped spring (the classic "SmoothDamp"). Unlike a plain exponential ease it starts
 * from rest, so a camera change accelerates in and settles out with no visible kick.
 */
function smoothDamp(cur: number, goal: number, vel: { v: number }, time: number, dt: number): number {
  if (dt <= 0) return cur;
  const omega = 2 / time, x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - goal, temp = (vel.v + omega * change) * dt;
  vel.v = (vel.v - omega * temp) * decay;
  return goal + (change + temp) * decay;
}

export class CameraRig {
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 900);
  /** Point on the ground at the centre of the screen. */
  target = new THREE.Vector3();
  yaw = 0;
  pitch = DRIVE_PRESETS[DEFAULT_PRESET].pitch * DEG;
  viewHeight = DRIVE_PRESETS[DEFAULT_PRESET].view;
  mode: CameraMode = 'drive';
  presetIndex = DEFAULT_PRESET;

  // free-camera goals
  private yawT = 0;
  private pitchT = this.pitch;
  private viewT = this.viewHeight;
  private pan = new THREE.Vector2(); // free-camera offset from the car (world X/Z)
  private panNow = new THREE.Vector2();
  private fixed: THREE.Vector3 | null = null; // photo target detached from the car (tools only)

  private focus = new THREE.Vector3(); // exact horizontal follow, filtered ground elevation
  private lead = 0; // metres the view centre sits ahead of the car
  private vPitch = { v: 0 };
  private vView = { v: 0 };
  private vLead = { v: 0 };
  private vPanX = { v: 0 };
  private vPanY = { v: 0 };
  private driveYaw = 0; // unwrapped heading goal, held inside the dead zone
  private yawRate = 0;
  private aspect = 1;

  get preset(): DrivePreset { return DRIVE_PRESETS[this.presetIndex]; }
  get viewWidth() { return this.viewHeight * this.aspect; }
  setAspect(a: number) { this.aspect = a; }

  setMode(mode: CameraMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'free') {
      // Start the free camera exactly where the driving camera is — same angle, same framing.
      // Nothing moves; the player simply gains control. (The driving look-ahead becomes pan.)
      this.yawT = this.yaw;
      this.pitchT = this.pitch;
      this.viewT = this.viewHeight;
      this.pan.set(-Math.sin(this.yaw) * this.lead, -Math.cos(this.yaw) * this.lead);
      this.panNow.copy(this.pan);
      this.lead = 0;
      this.vLead.v = 0;
    } else this.driveYaw = this.yaw;
    this.yawRate = 0;
    this.vPanX.v = this.vPanY.v = 0;
    this.vPitch.v = this.vView.v = 0;
    this.fixed = null;
  }

  toggleMode(): CameraMode {
    this.setMode(this.mode === 'drive' ? 'free' : 'drive');
    return this.mode;
  }

  /** Next driving preset. Ignored (returns null) outside Driving mode. */
  cyclePreset(): DrivePreset | null {
    if (this.mode !== 'drive') return null;
    this.presetIndex = (this.presetIndex + 1) % DRIVE_PRESETS.length;
    return this.preset;
  }

  // ---- free-camera controls: all of these are no-ops in Driving mode ----
  orbit(dYaw: number, dPitch: number) {
    if (this.mode !== 'free') return;
    this.yawT += dYaw;
    this.pitchT = THREE.MathUtils.clamp(this.pitchT + dPitch, PITCH_MIN, PITCH_MAX);
  }

  zoom(factor: number) {
    if (this.mode !== 'free') return;
    this.viewT = THREE.MathUtils.clamp(this.viewT * factor, VIEW_MIN, VIEW_MAX);
  }

  /** Slide the view across the ground, in screen-space metres. */
  panBy(dx: number, dy: number) {
    if (this.mode !== 'free') return;
    const wx = Math.cos(this.yaw) * dx + Math.sin(this.yaw) * dy;
    const wz = -Math.sin(this.yaw) * dx + Math.cos(this.yaw) * dy;
    if (this.fixed) { this.fixed.x += wx; this.fixed.z += wz; }
    else { this.pan.x += wx; this.pan.y += wz; }
  }

  /** Free camera with an explicit pose; optionally detached from the car (used by capture tools). */
  setFree(yawDeg: number, pitchDeg: number, view: number, fixed?: THREE.Vector3) {
    this.mode = 'free';
    this.yaw = this.yawT = yawDeg * DEG;
    this.pitch = this.pitchT = pitchDeg * DEG;
    this.viewHeight = this.viewT = view;
    this.pan.set(0, 0);
    this.panNow.set(0, 0);
    this.fixed = fixed ? fixed.clone() : null;
  }

  setDrive(presetIndex = this.presetIndex) {
    this.driveYaw = this.yaw;
    this.yawRate = 0;
    this.mode = 'drive';
    this.presetIndex = presetIndex;
    this.fixed = null;
  }

  /**
   * @param carPos     car position (read only)
   * @param carHeading car heading in radians, forward = (sin h, 0, cos h) (read only)
   * @param snap       jump straight to the goal pose (initial placement, capture tools)
   */
  update(dt: number, carPos: THREE.Vector3, carHeading: number, snap = false) {
    let leadGoal = 0;

    if (this.mode === 'drive') {
      const p = this.preset;
      const pitchGoal = p.pitch * DEG;
      // Sit behind the car, taking the short way round.
      if (snap) {
        this.yaw += wrapAngle(carHeading + Math.PI - this.yaw);
        this.driveYaw = this.yaw;
        this.yawRate = 0;
        this.pitch = pitchGoal;
        this.viewHeight = p.view;
        this.vPitch.v = this.vView.v = 0;
      } else {
        const headingYaw = carHeading + Math.PI;
        const error = wrapAngle(headingYaw - this.driveYaw);
        if (Math.abs(error) > YAW_DEAD_ZONE) this.driveYaw = headingYaw - Math.sign(error) * YAW_DEAD_ZONE;
        const yawError = wrapAngle(this.driveYaw - this.yaw);
        // Critically damped angular follow with explicit acceleration and rate ceilings.
        // Damping uses current angular velocity, so the camera sheds speed before the target
        // instead of snapping or swinging past it.
        const omega = 2 / p.yawTime;
        const acceleration = THREE.MathUtils.clamp(omega * omega * yawError - 3.2 * omega * this.yawRate, -YAW_MAX_ACCEL, YAW_MAX_ACCEL);
        this.yawRate = THREE.MathUtils.clamp(this.yawRate + acceleration * dt, -YAW_MAX_RATE, YAW_MAX_RATE);
        this.yaw += this.yawRate * dt;
        this.pitch = smoothDamp(this.pitch, pitchGoal, this.vPitch, MOVE_TIME, dt);
        this.viewHeight = Math.exp(smoothDamp(Math.log(this.viewHeight), Math.log(p.view), this.vView, MOVE_TIME, dt)); // zoom in log space
      }
      // Put the car below centre so more road shows ahead of it.
      leadGoal = (p.anchor * p.view) / Math.sin(pitchGoal);
    } else {
      const k = ease(7, dt, snap);
      this.yaw += (this.yawT - this.yaw) * k;
      this.pitch += (this.pitchT - this.pitch) * k;
      this.viewHeight *= Math.pow(this.viewT / this.viewHeight, k);
    }
    if (snap) { this.lead = leadGoal; this.vLead.v = 0; }
    else this.lead = smoothDamp(this.lead, leadGoal, this.vLead, MOVE_TIME, dt);
    // Follow horizontal position immediately. World-space follow lag translates scenery
    // beneath the player even in Free mode; only smooth vertical grade changes.
    if (snap) this.focus.copy(carPos);
    else this.focus.y += (carPos.y - this.focus.y) * ease(10, dt, false);
    this.focus.x = carPos.x;
    this.focus.z = carPos.z;
    const panGoal = this.mode === 'free' ? this.pan : ZERO2;
    if (snap) this.panNow.copy(panGoal);
    else if (this.mode === 'free') this.panNow.lerp(panGoal, ease(12, dt, false)); // direct, responsive panning
    else this.panNow.set(smoothDamp(this.panNow.x, 0, this.vPanX, MOVE_TIME, dt), smoothDamp(this.panNow.y, 0, this.vPanY, MOVE_TIME, dt));

    if (this.fixed) this.target.lerp(this.fixed, ease(8, dt, snap));
    else {
      // Keep camera framing offsets independent of the car absolute follow position.
      this.target.set(
        this.focus.x - Math.sin(this.yaw) * this.lead + this.panNow.x,
        this.focus.y,
        this.focus.z - Math.cos(this.yaw) * this.lead + this.panNow.y,
      );
    }

    const c = this.camera;
    const hh = this.viewHeight / 2, hw = hh * this.aspect;
    c.left = -hw; c.right = hw; c.top = hh; c.bottom = -hh;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    c.position.set(
      this.target.x + Math.sin(this.yaw) * cp * 400,
      this.target.y + sp * 400,
      this.target.z + Math.cos(this.yaw) * cp * 400,
    );
    c.up.set(0, 1, 0);
    c.lookAt(this.target);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
  }
}
