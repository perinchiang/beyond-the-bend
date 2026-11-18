import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HeightField } from '../world/heightfield';
import { ROAD_HALF_WIDTH } from '../world/track';
import { edgeDistance } from '../world/terrain';
import { PaintShared, paintMaterial } from '../render/paint';

/**
 * The car model is authored by a Blender Python script (tools/blender/build_car.py) and
 * imported as GLB. Colours live here, keyed by material name, so the livery can be tuned
 * without re-exporting. Model convention: +X forward, +Y up, wheels are separate nodes
 * named wheel_fl / wheel_fr / wheel_rl / wheel_rr with their origin on the axle.
 */

const LIVERY: Record<string, { color: string; emissive?: string; kind?: 'paint' | 'glass' | 'flat' }> = {
  paint: { color: '#e4573a', kind: 'paint' },
  paint_roof: { color: '#f3ecdc', kind: 'paint' },
  stripe: { color: '#f3ecdc', kind: 'paint' },
  stripe_dark: { color: '#23505c', kind: 'paint' },
  trim: { color: '#2b2a30' },
  underbody: { color: '#232228' },
  glass: { color: '#2c3e4e', kind: 'glass' },
  light_head: { color: '#fff6d8', emissive: '#8a8468' },
  light_tail: { color: '#d8322c', emissive: '#5a0d0c' },
  light_amber: { color: '#f2a23a', emissive: '#5a3508' },
  lamp_pod: { color: '#f4f1e6', emissive: '#6b6858' },
  tire: { color: '#2a292d' },
  rim: { color: '#f1ece0', kind: 'paint' },
  metal: { color: '#8f9198' },
  flap: { color: '#c93a2c' },
  plate: { color: '#f2eedf' },
};

export interface CarInput { throttle: number; steer: number; brake: number | boolean; handbrake?: boolean }

const WHEELBASE = 2.42;
const TRACK = 1.5;
const WHEEL_RADIUS = 0.335;

// ---- handling ----
const TOP_SPEED = 27; // m/s on asphalt
/** Front-wheel angle at full lock (rad): what a held key reaches at parking speeds. */
const STEER_LOCK = 0.56;
/**
 * Cornering (m/s²) that full lock asks for once the car is moving. Above walking pace the
 * lock shrinks with speed squared so that a held key always means "this much cornering",
 * not "this much wheel angle" — the same input gives the same push at 10 m/s and at 27.
 */
const GRIP = 20;
/**
 * Keys are all-or-nothing, so the wheel is wound on at a steady rate and unwound faster.
 * A quick tap therefore only reaches a fraction of the lock (a nudge), a held key gets all
 * of it in about a third of a second, and letting go straightens the car promptly.
 */
const STEER_IN = 3.6; // lock fractions per second while turning in
const STEER_OUT = 6.5; // ... and while coming back towards centre
/** However slow the car is going, a held key never spins it faster than this (rad/s). */
const YAW_MAX = 1.4;
/** The body takes a moment to follow the front wheels: a little weight, no snap. */
const YAW_LAG = 0.06; // s
/** Grass begins just past the verge and is "deep" a couple of metres further out. */
const GRASS_START = ROAD_HALF_WIDTH + 0.6, GRASS_FULL = ROAD_HALF_WIDTH + 3.0;
/** The car bogs down gradually and frees itself quickly, so clipping a corner costs little. */
const GRASS_IN = 0.7, GRASS_OUT = 0.25; // s
const ROAD_DRAG = 0.35, GRASS_DRAG = 0.27, COAST_DRAG = 0.55; // 1/s
/** Grass is a little looser under the tyres. */
const GRASS_GRIP = 0.85;
const smoothstep = (a: number, b: number, x: number) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export class Car {
  root = new THREE.Group();
  /** Tilts with the ground; holds body + wheels. */
  private chassis = new THREE.Group();
  private body = new THREE.Group();
  private wheels: { pivot: THREE.Group; spin: THREE.Object3D; front: boolean }[] = [];
  private blob: THREE.Mesh;

  x = 0;
  z = 0;
  heading = 0;
  speed = 0;
  private scout = false;
  private tuned = false;
  bonusRun = false;
  ice = 0;
  slip = 0;
  private paint?: THREE.MeshLambertMaterial;
  equip(scout: boolean, tuned: boolean) {
    this.scout = scout;
    this.tuned = tuned;
    this.paint?.color.set(scout ? '#487e85' : LIVERY.paint.color);
    this.body.scale.set(scout ? 1.09 : 1, scout ? 1.10 : 1, 1);
  }
  private steer = 0; // front-wheel angle driving the motion (rad)
  private steerIn = 0; // how far the wheel is wound on, -1..1
  private curve = 0; // path curvature the body is actually following (1/m)
  get grassBlend() { return this.grass; }
  private grass = 0; // 0 on the road .. 1 bogged down in grass
  private spinAngle = 0;
  private roll = 0;
  private pitch = 0;
  private yaw = new THREE.Quaternion();
  private tilt = new THREE.Quaternion();
  private groundY = 0;
  private upSm = new THREE.Vector3(0, 1, 0);
  private ready = false;

  constructor(private hf: HeightField, private shared: PaintShared) {
    this.root.add(this.chassis);
    this.chassis.add(this.body);
    // Soft contact shadow: grounds the car even where the shadow map is too coarse.
    const blobMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      uniforms: { uColor: { value: new THREE.Color('#1c2440') } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying vec2 vUv;
        void main(){
          vec2 p = (vUv - 0.5) * 2.0;
          // rounded-rectangle falloff matching the car's footprint
          vec2 q = abs(p) - vec2(0.50, 0.46);
          float d = length(max(q, 0.0));
          float a = (1.0 - smoothstep(0.0, 0.48, d)) * 0.50;
          gl_FragColor = vec4(uColor, a);
        }`,
    });
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 2.9).rotateX(-Math.PI / 2), blobMat);
    this.blob.position.y = 0.035;
    this.blob.rotation.y = -Math.PI / 2;
    this.blob.renderOrder = 2;
    this.chassis.add(this.blob);
  }

  async load(url: string): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(url);
    const model = gltf.scene;
    const mats = new Map<string, THREE.Material>();
    const materialFor = (name: string): THREE.Material => {
      let m = mats.get(name);
      if (m) return m;
      const def = LIVERY[name] ?? { color: '#ff00ff' };
      if (!LIVERY[name]) console.warn(`[car] no livery entry for material "${name}"`);
      const base = new THREE.MeshLambertMaterial({ color: def.color, emissive: def.emissive ?? '#000000' });
      if (name === 'paint') this.paint = base;
      const normalVarying = {
        vertexPars: 'varying vec3 vWorldNormal;',
        vertexMain: 'vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);',
      };
      if (def.kind === 'paint') {
        // Painted-toy finish: no specular, just a soft sky sheen on upward faces and a faint rim.
        m = paintMaterial(base, this.shared, {
          key: 'car-paint', ...normalVarying,
          fragPars: 'varying vec3 vWorldNormal;',
          fragColor: /* glsl */ `
            {
              vec3 wn = normalize(vWorldNormal);
              float sky = smoothstep(0.35, 1.0, wn.y);
              diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.55 + vec3(0.50, 0.52, 0.55), sky * 0.16);
              diffuseColor.rgb *= mix(0.90, 1.0, smoothstep(-0.6, 0.3, wn.y));
            }`,
        });
      } else if (def.kind === 'glass') {
        // Stylised glass: dark tint that picks up a band of sky on slanted panes.
        m = paintMaterial(base, this.shared, {
          key: 'car-glass', ...normalVarying,
          fragPars: 'varying vec3 vWorldNormal;',
          fragColor: /* glsl */ `
            {
              vec3 wn = normalize(vWorldNormal);
              float sky = smoothstep(0.15, 0.85, wn.y);
              float streak = smoothstep(0.35, 0.65, fract(vWorldPos.y * 1.7 + dot(wn.xz, vec2(0.7, 0.4)) * 0.6));
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.50, 0.66, 0.80), sky * 0.62 + streak * 0.07);
            }`,
        });
      } else {
        m = paintMaterial(base, this.shared, { key: 'car-flat' });
      }
      mats.set(name, m);
      return m;
    };

    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.material as THREE.Material | THREE.Material[];
      mesh.material = Array.isArray(src) ? src.map((s) => materialFor(s.name)) : materialFor(src.name);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });

    // Re-seat the model: +X (model forward) -> +Z (rig forward).
    this.body.rotation.y = -Math.PI / 2;
    const wheelNodes: THREE.Object3D[] = [];
    model.traverse((o) => { if (/^wheel_(fl|fr|rl|rr)$/.test(o.name)) wheelNodes.push(o); });
    this.body.add(model);
    model.updateMatrixWorld(true);
    for (const w of wheelNodes) {
      const pivot = new THREE.Group();
      pivot.position.copy(w.position);
      w.parent!.add(pivot);
      w.position.set(0, 0, 0);
      pivot.add(w);
      this.wheels.push({ pivot, spin: w, front: /_f[lr]$/.test(w.name) });
    }
    this.equip(this.scout, this.tuned);
    this.ready = true;
  }

  /** Teleport and clear every smoothed state, so repeated placements are deterministic. */
  place(x: number, z: number, heading: number) {
    this.x = x; this.z = z; this.heading = heading; this.speed = 0;
    this.steer = 0; this.steerIn = 0; this.curve = 0; this.grass = 0; this.slip = 0;
    this.roll = 0; this.pitch = 0; this.spinAngle = 0;
    this.groundY = this.hf.surface(x, z);
    this.upSm.set(0, 1, 0);
    this.update(0, { throttle: 0, steer: 0, brake: false }, true);
  }

  /** Deliberately simple arcade motion: enough to tour the scene, not a handling model. */
  update(dt: number, input: CarInput, snap = false) {
    // Surface: asphalt and verge are free; grass slows the car, but only as it sinks in.
    const ground = smoothstep(GRASS_START, GRASS_FULL, this.hf.roadDist(this.x, this.z));
    this.grass += (ground - this.grass) * (snap ? 1 : 1 - Math.exp(-dt / (ground > this.grass ? GRASS_IN : GRASS_OUT)));

    const power = (this.scout ? 1.22 : 1) * (this.tuned ? 1.12 : 1) * (this.bonusRun ? 1.5 : 1);
    const top = TOP_SPEED * (this.scout ? 1.06 : 1) * (this.bonusRun ? 1.32 : 1);
    const brake = THREE.MathUtils.clamp(Number(input.brake), 0, 1);
    if (input.throttle > 0) this.speed += (this.speed < 0 ? 22 : 11 * power) * dt * input.throttle;
    else if (input.throttle < 0) this.speed += (this.speed > 0 ? 24 : 7) * dt * input.throttle;
    if (brake) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 30 * brake * dt);
    const drag = ROAD_DRAG + GRASS_DRAG * this.grass + (input.throttle === 0 ? COAST_DRAG : 0);
    this.speed -= this.speed * drag * dt;
    this.speed = THREE.MathUtils.clamp(this.speed, -8, top + 2);
    if (this.speed > top) this.speed -= (this.speed - top) * 3 * dt;
    if (Math.abs(this.speed) < 0.03 && input.throttle === 0) this.speed = 0;

    // Steering: wind the wheel towards the key, faster when heading back to centre.
    const want = THREE.MathUtils.clamp(input.steer, -1, 1);
    const turningIn = want * this.steerIn >= 0 && Math.abs(want) > Math.abs(this.steerIn);
    const step = (turningIn ? STEER_IN : STEER_OUT) * dt;
    this.steerIn += THREE.MathUtils.clamp(want - this.steerIn, -step, step);
    const grip = GRIP * (1 - 0.28 * this.ice) * (1 - (1 - GRASS_GRIP) * this.grass);
    const v = Math.max(Math.abs(this.speed), 0.1);
    const lock = Math.min(STEER_LOCK, Math.atan((WHEELBASE * YAW_MAX) / v), Math.atan((WHEELBASE * grip) / (v * v)));
    this.steer = this.steerIn * lock;
    this.curve += (Math.tan(this.steer) / WHEELBASE - this.curve) * (snap ? 1 : 1 - Math.exp(-dt / YAW_LAG));
    const slide = input.handbrake && this.speed > 5 ? this.steerIn * smoothstep(5, 14, this.speed) : 0;
    this.slip += (slide * 0.48 - this.slip) * (1 - Math.exp(-dt * (slide ? 5 : 7)));
    if (input.handbrake) this.speed *= Math.exp(-dt * 0.52);
    const yawRate = this.speed * this.curve * (1 + Math.abs(this.slip));
    this.heading += yawRate * dt;
    const fx = Math.sin(this.heading - this.slip), fz = Math.cos(this.heading - this.slip);
    let nx = this.x + fx * this.speed * dt, nz = this.z + fz * this.speed * dt;
    // soft wall at the paper edge
    const ed = edgeDistance(nx, nz);
    if (ed > -5) {
      const g = 0.5;
      const gx = edgeDistance(nx + g, nz) - edgeDistance(nx - g, nz), gz = edgeDistance(nx, nz + g) - edgeDistance(nx, nz - g);
      const gl = Math.hypot(gx, gz) || 1;
      nx -= (gx / gl) * (ed + 5);
      nz -= (gz / gl) * (ed + 5);
      this.speed *= 1 - Math.min(1, dt * 3);
    }
    this.x = nx; this.z = nz;

    // Rest the four contact patches on the ground and derive height + tilt.
    const rx = fz, rz = -fx; // right vector
    const h = (lf: number, lr: number) => this.hf.surface(this.x + fx * lf + rx * lr, this.z + fz * lf + rz * lr);
    const a = WHEELBASE / 2, b = TRACK / 2;
    const hFL = h(a, -b), hFR = h(a, b), hRL = h(-a, -b), hRR = h(-a, b);
    const y = (hFL + hFR + hRL + hRR) / 4;
    const up = new THREE.Vector3(
      -(((hFR + hRR) - (hFL + hRL)) / (2 * TRACK)) * rx - (((hFL + hFR) - (hRL + hRR)) / (2 * WHEELBASE)) * fx,
      1,
      -(((hFR + hRR) - (hFL + hRL)) / (2 * TRACK)) * rz - (((hFL + hFR) - (hRL + hRR)) / (2 * WHEELBASE)) * fz,
    ).normalize();
    const k = snap ? 1 : 1 - Math.exp(-dt * 14);
    this.groundY += (y - this.groundY) * k;
    this.upSm.lerp(up, k).normalize();

    this.root.position.set(this.x, this.groundY, this.z);
    this.yaw.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.heading);
    this.tilt.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, this.upSm);
    this.chassis.quaternion.copy(this.tilt).multiply(this.yaw);

    // A little body language: lean out of corners, squat under power.
    const lat = THREE.MathUtils.clamp(yawRate * this.speed * 0.006, -0.07, 0.07);
    const lon = THREE.MathUtils.clamp(input.throttle * 0.018 - (brake * 0.03 * Math.sign(this.speed)), -0.04, 0.04);
    const kb = snap ? 1 : 1 - Math.exp(-dt * 6);
    this.roll += (lat - this.roll) * kb;
    this.pitch += (-lon - this.pitch) * kb;
    // model frame: X = forward (roll axis), Z = lateral (pitch axis)
    this.body.rotation.set(this.roll, -Math.PI / 2, this.pitch, 'YXZ');

    this.spinAngle += (this.speed * dt) / WHEEL_RADIUS;
    for (const w of this.wheels) {
      // Shown wheel angle keeps its familiar range, so a key press stays readable at speed.
      w.pivot.rotation.y = w.front ? this.steerIn * THREE.MathUtils.lerp(0.56, 0.11, Math.min(1, Math.abs(this.speed) / 26)) : 0;
      w.spin.rotation.z = -this.spinAngle;
    }
  }

  get position() { return this.root.position; }
  get isReady() { return this.ready; }
}
