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

export interface CarInput { throttle: number; steer: number; brake: boolean }

const WHEELBASE = 2.42;
const TRACK = 1.5;
const WHEEL_RADIUS = 0.335;

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
  private steer = 0;
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
    this.ready = true;
  }

  /** Teleport and clear every smoothed state, so repeated placements are deterministic. */
  place(x: number, z: number, heading: number) {
    this.x = x; this.z = z; this.heading = heading; this.speed = 0;
    this.steer = 0; this.roll = 0; this.pitch = 0; this.spinAngle = 0;
    this.groundY = this.hf.surface(x, z);
    this.upSm.set(0, 1, 0);
    this.update(0, { throttle: 0, steer: 0, brake: false }, true);
  }

  /** Deliberately simple arcade motion: enough to tour the scene, not a handling model. */
  update(dt: number, input: CarInput, snap = false) {
    const onRoad = this.hf.roadDist(this.x, this.z) < ROAD_HALF_WIDTH + 0.6;
    const vmax = onRoad ? 27 : 15;
    if (input.throttle > 0) this.speed += (this.speed < 0 ? 22 : 11) * dt * input.throttle;
    else if (input.throttle < 0) this.speed += (this.speed > 0 ? 24 : 7) * dt * input.throttle;
    if (input.brake) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 30 * dt);
    const drag = (onRoad ? 0.35 : 1.1) + (input.throttle === 0 ? 0.55 : 0);
    this.speed -= this.speed * drag * dt;
    this.speed = THREE.MathUtils.clamp(this.speed, -8, vmax + 2);
    if (this.speed > vmax) this.speed -= (this.speed - vmax) * 3 * dt;
    if (Math.abs(this.speed) < 0.03 && input.throttle === 0) this.speed = 0;

    const maxSteer = THREE.MathUtils.lerp(0.56, 0.11, Math.min(1, Math.abs(this.speed) / 26));
    const steerT = input.steer * maxSteer;
    this.steer += (steerT - this.steer) * (1 - Math.exp(-dt * 9));
    const yawRate = (this.speed * Math.tan(this.steer)) / WHEELBASE;
    this.heading += yawRate * dt;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
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
    const lon = THREE.MathUtils.clamp(input.throttle * 0.018 - (input.brake ? 0.03 * Math.sign(this.speed) : 0), -0.04, 0.04);
    const kb = snap ? 1 : 1 - Math.exp(-dt * 6);
    this.roll += (lat - this.roll) * kb;
    this.pitch += (-lon - this.pitch) * kb;
    // model frame: X = forward (roll axis), Z = lateral (pitch axis)
    this.body.rotation.set(this.roll, -Math.PI / 2, this.pitch, 'YXZ');

    this.spinAngle += (this.speed * dt) / WHEEL_RADIUS;
    for (const w of this.wheels) {
      w.pivot.rotation.y = w.front ? this.steer : 0;
      w.spin.rotation.z = -this.spinAngle;
    }
  }

  get position() { return this.root.position; }
  get isReady() { return this.ready; }
}
