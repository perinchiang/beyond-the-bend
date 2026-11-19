import * as THREE from 'three';
import { newGroundSample } from './ground';
import type { Vehicle } from './vehicle/vehicle';
import type { World } from './world/world';

/**
 * Three views. The default is a low chase camera: on a 2 km straight at 200 km/h the driver
 * needs to see the horizon, and the landscape is the point of the game. The high view keeps the
 * earlier diorama feel for the pass and for looking at a slide from above.
 */
export const VIEWS = ['Chase', 'Far chase', 'High'] as const;

const CHASE = [
  { dist: 7.8, height: 2.75, ahead: 9, lookUp: 1.3, fov: 58, fovFast: 74 },
  { dist: 11.5, height: 4.4, ahead: 11, lookUp: 1.3, fov: 54, fovFast: 68 },
];
const HIGH = { dist: 135, pitch: 50 * (Math.PI / 180), fov: 32 };
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class SliceCamera {
  camera = new THREE.PerspectiveCamera(60, 1, 0.6, 9000);
  view = 0;
  private yaw = 0;
  private y = 0;
  private fov = 60;
  private shake = 0;
  private started = false;
  private gs = newGroundSample();
  private look = new THREE.Vector3();

  constructor(private world: World) {}

  cycle() { this.view = (this.view + 1) % VIEWS.length; }
  /** Jump straight to the car's pose (after a teleport or reset). */
  snap() { this.started = false; }
  resize(w: number, h: number) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  update(dt: number, v: Vehicle) {
    const speed = Math.hypot(v.velocity.x, v.velocity.z), high = this.view === 2;
    // Follow where the car is going more than where it points, so a slide shows as a slide.
    let goal = v.heading;
    if (!high && v.speed > 4) goal += THREE.MathUtils.clamp(wrap(Math.atan2(v.velocity.x, v.velocity.z) - v.heading), -0.7, 0.7) * 0.6;
    if (!this.started) { this.yaw = goal; this.y = v.position.y; this.started = true; }
    this.yaw += wrap(goal - this.yaw) * ease(dt, high ? 2.4 : 5.5);
    this.y += (v.position.y - this.y) * ease(dt, v.airborne ? 4 : 9);
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw), fast = smooth(18, 64, speed);
    const cam = this.camera;
    let fov: number;
    if (high) {
      const d = HIGH.dist, ahead = 8 + 0.25 * speed;
      cam.position.set(v.position.x - sy * d * Math.cos(HIGH.pitch), this.y + d * Math.sin(HIGH.pitch), v.position.z - cy * d * Math.cos(HIGH.pitch));
      this.look.set(v.position.x + sy * ahead, this.y, v.position.z + cy * ahead);
      fov = HIGH.fov;
    } else {
      const p = CHASE[this.view], d = p.dist + 1.3 * fast;
      cam.position.set(v.position.x - sy * d, this.y + p.height, v.position.z - cy * d);
      const floor = this.world.sample(cam.position.x, cam.position.z, this.gs).y + 0.9;
      if (cam.position.y < floor) cam.position.y = floor;
      this.look.set(v.position.x + sy * p.ahead, this.y + p.lookUp, v.position.z + cy * p.ahead);
      fov = p.fov + (p.fovFast - p.fov) * fast;
    }
    this.shake = Math.max(this.shake * Math.exp(-dt * 9), Math.min(0.35, v.impact * 0.035));
    if (this.shake > 0.003) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
    }
    cam.lookAt(this.look);
    this.fov += (fov - this.fov) * ease(dt, 4);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }
}
