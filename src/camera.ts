import * as THREE from 'three';

/**
 * Two camera modes on one long "miniature lens":
 *
 *  - Driving: an elevated chase view locked behind the car. The player cannot orbit; they
 *    only pick one of three presets. The view turns with the car through one critically
 *    damped spring, so steering taps are filtered out and a corner is a single smooth sweep.
 *  - Free / photo: orbit, tilt, zoom and pan at will. It tracks the car's position but
 *    ignores its heading, so a composition holds while the car moves through it.
 *
 * The lens is a real (perspective) telephoto, not a parallel projection. A parallel view has
 * no vanishing point and no size falloff, and the eye — which always assumes perspective —
 * explains that by tipping the ground up: far land reads as a slope rising towards the
 * viewer, the road as the floor of a bowl, and a turn as a turntable spinning under the car
 * with the edges of the screen sweeping fastest. With a real lens the land lies flat and
 * recedes, and a turn reads as the camera swinging round behind the car.
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
  /** Vertical field of view (degrees). The steep High view gets a little more lens so land still recedes. */
  fov: number;
}

/** Vertical field of view of the lens (degrees): long enough to keep the miniature look. */
export const LENS_FOV = 30;

export const DRIVE_PRESETS: readonly DrivePreset[] = [
  { name: 'High', pitch: 55, view: 66, anchor: 0.13, yawTime: 0.60, fov: 36 },
  { name: 'Normal', pitch: 40, view: 44, anchor: 0.18, yawTime: 0.52, fov: LENS_FOV },
  { name: 'Close', pitch: 22, view: 24, anchor: 0.23, yawTime: 0.45, fov: LENS_FOV },
];
export const DEFAULT_PRESET = 1;

const DEG = Math.PI / 180;
const PITCH_MIN = 22 * DEG, PITCH_MAX = 89 * DEG;
const VIEW_MIN = 9, VIEW_MAX = 230;
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
  private persp = new THREE.PerspectiveCamera(LENS_FOV, 1, 1, 2000);
  private flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 900);
  /** Parallel projection, kept for capture tools that need pixel-exact pans. Not used in play. */
  ortho = false;
  /** Vertical field of view (degrees); eases between presets, held as-is by the free camera. */
  fov = DRIVE_PRESETS[DEFAULT_PRESET].fov;
  /** Point on the ground at the centre of the screen. */
  target = new THREE.Vector3();
  yaw = 0;
  pitch = DRIVE_PRESETS[DEFAULT_PRESET].pitch * DEG;
  viewHeight = DRIVE_PRESETS[DEFAULT_PRESET].view;
  mode: CameraMode = 'drive';
  presetIndex = DEFAULT_PRESET;
  fieldReveal = 0;

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
  private vFov = { v: 0 };
  private vLead = { v: 0 };
  private vPanX = { v: 0 };
  private vPanY = { v: 0 };
  private vYaw = { v: 0 };
  private aspect = 1;

  get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera { return this.ortho ? this.flat : this.persp; }
  get preset(): DrivePreset { return DRIVE_PRESETS[this.presetIndex]; }
  get viewWidth() { return this.viewHeight * this.aspect; }
  /** Distance from the lens to the focal point: `viewHeight` is what the lens frames there. */
  get distance() { return this.ortho ? 400 : this.viewHeight / (2 * Math.tan((this.fov * DEG) / 2)); }
  setAspect(a: number) { this.aspect = a; }

  /**
   * Smallest circle on the ground plane through the focal point that holds everything the
   * lens can see (rays near the horizon are cut off at `maxReach`). Returns its radius.
   */
  footprint(centre: THREE.Vector3, maxReach = 240): number {
    const sp = Math.sin(this.pitch), cp = Math.cos(this.pitch);
    let aFar: number, aNear: number, wFar: number, wNear: number; // along the view / half width
    if (this.ortho) {
      aFar = this.viewHeight / (2 * sp); aNear = -aFar; wFar = wNear = this.viewWidth / 2;
    } else {
      const t = Math.tan((this.fov * DEG) / 2), dist = this.distance, h = dist * sp;
      const edge = (e: number): [number, number] => {
        const k = h / Math.max(sp - e * t * cp, 1e-3);
        const a = Math.min((cp + e * t * sp) * k - dist * cp, maxReach);
        return [a, t * this.aspect * Math.min(k, (a + dist * cp) / Math.max(cp + e * t * sp, 1e-3))];
      };
      [aFar, wFar] = edge(1);
      [aNear, wNear] = edge(-1);
    }
    const c = THREE.MathUtils.clamp((aFar * aFar + wFar * wFar - aNear * aNear - wNear * wNear) / (2 * (aFar - aNear)), aNear, aFar);
    centre.set(this.target.x - Math.sin(this.yaw) * c, this.target.y, this.target.z - Math.cos(this.yaw) * c);
    return Math.max(Math.hypot(aFar - c, wFar), Math.hypot(c - aNear, wNear));
  }

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
    }
    this.vYaw.v = 0;
    this.vPanX.v = this.vPanY.v = 0;
    this.vPitch.v = this.vView.v = this.vFov.v = 0;
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
    this.fov = LENS_FOV;
    this.pan.set(0, 0);
    this.panNow.set(0, 0);
    this.fixed = fixed ? fixed.clone() : null;
  }

  setDrive(presetIndex = this.presetIndex) {
    this.vYaw.v = 0;
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
      const view = p.view * (1 + this.fieldReveal * 0.12);
      const pitchGoal = p.pitch * DEG;
      // Sit behind the car, taking the short way round.
      const yawGoal = this.yaw + wrapAngle(carHeading + Math.PI - this.yaw);
      if (snap) {
        this.yaw = yawGoal;
        this.vYaw.v = 0;
        this.pitch = pitchGoal;
        this.viewHeight = view;
        this.fov = p.fov;
        this.vPitch.v = this.vView.v = this.vFov.v = 0;
      } else {
        // One critically damped spring from rest to rest: it cannot overshoot, it has no
        // threshold at which the landscape suddenly starts or stops turning, and it passes
        // only a fraction of a quick steering correction on to the view.
        // A big swing — returning from the free camera, or a spin on the grass — is taken
        // more slowly still, so the landscape never whips round.
        const far = THREE.MathUtils.smoothstep(Math.abs(yawGoal - this.yaw), 40 * DEG, 140 * DEG);
        this.yaw = smoothDamp(this.yaw, yawGoal, this.vYaw, p.yawTime * (1 + 1.2 * far), dt);
        this.pitch = smoothDamp(this.pitch, pitchGoal, this.vPitch, MOVE_TIME, dt);
        this.viewHeight = Math.exp(smoothDamp(Math.log(this.viewHeight), Math.log(view), this.vView, MOVE_TIME, dt)); // zoom in log space
        this.fov = smoothDamp(this.fov, p.fov, this.vFov, MOVE_TIME, dt);
      }
      // Put the car below centre so more road shows ahead of it. Through a real lens the
      // ground nearer the camera is magnified, which the second term accounts for.
      const lens = this.ortho ? 0 : 2 * p.anchor * Math.tan((p.fov * DEG) / 2) * Math.cos(pitchGoal);
      leadGoal = (p.anchor * view) / (Math.sin(pitchGoal) + lens);
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
    const dist = this.distance;
    if (c instanceof THREE.OrthographicCamera) {
      const hh = this.viewHeight / 2, hw = hh * this.aspect;
      c.left = -hw; c.right = hw; c.top = hh; c.bottom = -hh;
    } else {
      c.fov = this.fov;
      c.aspect = this.aspect;
      c.near = Math.max(0.5, dist * 0.05);
      c.far = dist + 900;
    }
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    c.position.set(
      this.target.x + Math.sin(this.yaw) * cp * dist,
      this.target.y + sp * dist,
      this.target.z + Math.cos(this.yaw) * cp * dist,
    );
    c.up.set(0, 1, 0);
    c.lookAt(this.target);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
  }
}
