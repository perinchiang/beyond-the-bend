import * as THREE from 'three';
import { Rng } from '../core/rng';
import { paintMaterial, type PaintShared } from '../render/paint';
import type { Track } from './track';
import type { HeightField } from './heightfield';

export const PASS_FRACTION = 0.42;
export const SPRINT_GATES = [0.08, 0.16, 0.24];
export const RICE_GATE = 154;
export function waysides(track: Track, hf: HeightField, shared: PaintShared) {
  const region = track.region;
  const group = new THREE.Group(),
    rng = new Rng(321);
  const geometry = {
    box: new THREE.BoxGeometry(),
    cone: new THREE.ConeGeometry(0.5, 1, 7),
    stone: new THREE.IcosahedronGeometry(0.5, 0),
    shelf: new THREE.CylinderGeometry(0.37, 0.53, 1, 5),
    head: new THREE.SphereGeometry(0.5, 6, 4),
  };
  type Kind = keyof typeof geometry;
  const batches = new Map<Kind, { matrix: THREE.Matrix4; tint: THREE.Color }[]>();
  const pose = new THREE.Object3D();
  let cx = 0,
    cz = 0,
    ground = 0,
    yaw = 0;
  function site(s: number, lateral: number) {
    const t = track.at(s);
    cx = t.x - t.tz * lateral;
    cz = t.z + t.tx * lateral;
    ground = hf.height(cx, cz);
    yaw = Math.atan2(t.tx, t.tz);
  }
  function part(
    kind: Kind,
    w: number,
    h: number,
    d: number,
    y: number,
    color: string,
    lateral = 0,
    along = 0,
    tilt = 0,
  ) {
    pose.position.set(
      cx + Math.cos(yaw) * lateral + Math.sin(yaw) * along,
      ground + y,
      cz - Math.sin(yaw) * lateral + Math.cos(yaw) * along,
    );
    pose.rotation.set(0, yaw, tilt, 'YXZ');
    pose.scale.set(w, h, d);
    pose.updateMatrix();
    if (!batches.has(kind)) batches.set(kind, []);
    batches.get(kind)!.push({ matrix: pose.matrix.clone(), tint: new THREE.Color(color) });
  }
  const walkers: THREE.Group[] = [];
  const crowdMaterial = new THREE.MeshLambertMaterial({ color: '#a46e55' });
  if (region && region !== 'forest')
    for (let s = 0; s < track.length; s += region === 'market' ? 18 : 7)
      for (const side of [-1, 1]) {
        site(s, side * rng.range(9, region === 'market' ? 14 : 32));
        if (hf.roadDist(cx, cz) < 7) continue;
        const h = rng.range(4, 10);
        switch (region) {
          case 'snow':
            part('stone', h * 1.6, h * 0.8, h * 1.2, h * 0.15, '#c3cfd4');
            part('stone', h * 1.56, h * 0.63, h * 1.18, h * 0.26, '#f0eee6');
            break;
          case 'glacier':
            part(
              'shelf',
              h * 1.2,
              h * 0.88,
              h * 0.9,
              h * 0.42,
              rng.pick(['#96bec8', '#c6dedd', '#accdd0']),
              0,
              0,
              side * 0.18,
            );
            break;
          case 'volcano':
            part('stone', h * 1.23, h * 0.85, h, h * 0.24, '#685965');
            if (rng.next() < 0.21) part('stone', h * 0.7, 0.36, h * 1.4, 0.26, '#c77e5c', 2.8);
            break;
          case 'market':
            part('box', 5, 4.2, 6.8, 1.8, '#e2cba6');
            const roof = rng.pick(['#956759', '#a67360', '#7a8580']);
            for (const edge of [-1, 1]) {
              part('box', 3.24, 0.3, 7.45, 4.56, roof, edge * 1.37, 0, -edge*0.35);
              part('box', 0.94, 1.08, 0.22, 1.95, '#798f88', edge * 1.62, -3.42);
              part('box', 1.16, 0.13, 0.35, 1.42, '#f0dbaa', edge * 1.62, -3.46);
              part('box', 0.15, 1.12, 0.25, 1.95, '#d8ba94', edge * 1.62, -3.44);
            }
            part('box', 0.62, 1.2, 0.75, 5.14, '#8b6c5a', 1.22, 1.9);
            part('box', 1.2, 2.4, 0.18, 1.2, '#816f62', 0, -3.42);
            part('box', 3.3, 0.26, 2.3, 2.8, '#ad795f', 0, -4.2);
            if (walkers.length < 14) {
              const person = new THREE.Group();
              const coat = new THREE.Mesh(geometry.cone, crowdMaterial);
              coat.scale.set(0.75, 1.2, 0.65);
              coat.position.y = 0.6;
              const face = new THREE.Mesh(geometry.head, crowdMaterial);
              face.scale.setScalar(0.43);
              face.position.y = 1.42;
              person.add(coat, face);
              site(s, side * 6.3);
              person.position.set(cx, ground, cz);
              person.userData.origin = person.position.clone();
              person.userData.yaw = yaw;
              group.add(person);
              walkers.push(person);
            }
            break;
          case 'arcade':
            part('stone', h*2.3, h*0.96, h*1.6, h*0.20, rng.pick(['#b7828b', '#ba929a', '#d59a86']), side*7);
            part('box', 0.4, 2.2, 0.42, 1.1, '#795f80');
            part('box', 1.5, 0.72, 0.32, 2.22, rng.pick(['#dd947b', '#91bfc0', '#e7c68f']));
            break;
        }
      }
  // Two painted posts frame the exit without obstructing either lane.
  const gates = region ? [track.length * PASS_FRACTION] : track.lane ? [227] :
    [0, ...SPRINT_GATES.map(fraction => track.length * fraction)];
  for (const gate of gates) for (const side of [-1, 1]) {
    site(gate, side * (region === 'arcade' ? 6.6 : 5.5));
    const sprint = !region && gate !== RICE_GATE;
    part('box', 0.34, 3, 0.35, 1.5, '#82725f');
    part('box', 1.45, 0.82, 0.24, 2.67, sprint ? '#ab755a' : '#507b75');
    part('box', 0.65, 0.14, 0.27, 2.67, '#f3e4bd', 0, 0, 0.22);
  }
  for (const [kind, items] of batches) {
    const material = paintMaterial(new THREE.MeshLambertMaterial({ flatShading: true }), shared, {
      key: 'regional-waysides',
      fragColor: `
        vec2 paper = (vWorldPos.xz + vec2(vWorldPos.y * 0.41, -vWorldPos.y * 0.6)) * 0.17;
        vec4 wash = texture2D(uNoise, paper);
        diffuseColor.rgb *= 0.91 + 0.13 * smoothstep(0.32, 0.65, wash.r) + 0.08 * wash.g;
      `,
    });
    const mesh = new THREE.InstancedMesh(geometry[kind], material, items.length);
    items.forEach(({ matrix, tint }, i) => {
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, tint);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  function update(time: number) {
    walkers.forEach((p, i) => {
      const shift = Math.sin(time * 0.57 + i) * 1.75,
        yaw = p.userData.yaw;
      p.position.copy(p.userData.origin);
      p.position.x += Math.sin(yaw) * shift;
      p.position.z += Math.cos(yaw) * shift;
      p.position.y = hf.height(p.position.x, p.position.z) + 0.035 * Math.abs(Math.sin(time * 3 + i));
    });
  }
  return { group, update };
}
