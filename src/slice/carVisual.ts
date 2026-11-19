import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LIVERY } from '../vehicle/livery';
import type { Vehicle } from './vehicle/vehicle';
import { Look, surfaceMaterial } from './render/looks';

/**
 * The existing hatchback model, flat-shaded, posed from the physics every frame: body from the
 * rigid body, each wheel from its own suspension travel, steer angle and rolling angle.
 * Model convention (tools/blender/build_car.py): +X forward, +Y up, wheel nodes wheel_fl/fr/rl/rr
 * with their origin on the axle.
 */
const ORDER = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'];

export class CarVisual {
  root = new THREE.Group();
  private body = new THREE.Group();
  private wheels: ({ pivot: THREE.Group; spin: THREE.Object3D; restY: number } | undefined)[] = [];

  constructor(private look: Look) {
    this.body.rotation.y = -Math.PI / 2; // model +X forward -> rig +Z forward
    this.root.add(this.body);
  }

  async load(url: string): Promise<void> {
    const model = (await new GLTFLoader().loadAsync(url)).scene;
    const mats = new Map<string, THREE.Material>();
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const pick = (src: THREE.Material) => {
        let m = mats.get(src.name);
        if (!m) {
          const def = LIVERY[src.name] ?? { color: '#ff00ff' };
          m = surfaceMaterial(this.look, { color: def.color, emissive: def.emissive ?? '#000000' });
          mats.set(src.name, m);
        }
        return m;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(pick) : pick(mesh.material);
      mesh.castShadow = true;
    });
    this.body.add(model);
    model.updateMatrixWorld(true);
    ORDER.forEach((name, i) => {
      const w = model.getObjectByName(name);
      if (!w) { console.warn(`[slice] car model has no ${name}`); return; }
      const pivot = new THREE.Group();
      pivot.position.copy(w.position);
      w.parent!.add(pivot);
      w.position.set(0, 0, 0);
      pivot.add(w);
      this.wheels[i] = { pivot, spin: w, restY: pivot.position.y };
    });
  }

  sync(v: Vehicle) {
    this.root.position.set(v.position.x, v.position.y, v.position.z);
    this.root.quaternion.set(v.quaternion.x, v.quaternion.y, v.quaternion.z, v.quaternion.w);
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i], s = v.wheels[i];
      if (!w || !s) continue;
      w.pivot.position.y = w.restY + THREE.MathUtils.clamp(s.compression, -0.16, 0.12);
      w.pivot.rotation.y = s.steer;
      w.spin.rotation.z = -s.spin;
    }
  }
}
