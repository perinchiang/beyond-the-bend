import * as THREE from 'three';
import { type PaintShared, paintMaterial } from '../render/paint';
import { Rng } from '../core/rng';
import { Builder } from './flora';

const V = THREE.Vector3;
const up = new V(0, 1, 0);
const cap = new THREE.Color('#c3b59b');
const shoulder = new THREE.Color('#aea898');
const bed = new THREE.Color('#87949a');
const cleft = new THREE.Color('#79888b');

// An exposed bank in a few horizontal brushloads. The two outside ends taper
// into the earth. The high shoulder sits behind a wide inclined front plane.
export function gouacheStone(variant: number) {
  const b = new Builder(), rng = new Rng(4801 + variant);
  const face = (points: THREE.Vector3[], expected: THREE.Vector3, pigment: THREE.Color) => {
    const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize();
    const reverse = normal.dot(expected) < 0;
    if (reverse) normal.negate();
    const first = b.pos.length / 3;
    for (const point of points) b.vert(point, normal, pigment);
    for (let i = 1; i < points.length - 1; i++) {
      if (reverse) b.tri(first, first + i + 1, first + i);
      else b.tri(first, first + i, first + i + 1);
    }
  };

  const shelf = (x: number, z: number, length: number, width: number, height: number) => {
    const ends = [-1, -0.68, 0.27, 0.72, 1];
    const widths = [0.31, 0.96, 1, 0.72, 0.30];
    const heights = [0.17, 0.85, 1, 0.58, 0.12];
    const sections = ends.map((u, i) => {
      const cx = x + length * u;
      const cz = z + (0.18 * u + rng.range(-0.06, 0.06)) * width;
      const reach = widths[i] * width;
      const y = height * heights[i];
      return [
        new V(cx, -0.24, cz - reach),
        new V(cx + 0.03, y * 0.55, cz - reach * 0.86),
        new V(cx + 0.01, y, cz - reach * 0.12),
        new V(cx - 0.02, y * 0.76, cz + reach * 0.59),
        new V(cx + 0.03, y * 0.40, cz + reach * 0.90),
        new V(cx + 0.05, -0.24, cz + reach * 1.04),
      ];
    });
    const normals = [new V(0,0,-1), up, up, new V(0,0.6,1), new V(0,0,1)];
    const pigments = [cleft, shoulder, cap, shoulder, bed];
    for (let i = 1; i < sections.length; i++) {
      const a = sections[i - 1], d = sections[i];
      for (let j = 0; j < pigments.length; j++) {
        const colour = pigments[j].clone().multiplyScalar(rng.range(0.96, 1.02));
        face([a[j], d[j], d[j + 1], a[j + 1]], normals[j], colour);
      }
    }
    face(sections[0], new V(-1,0,0), cleft);
    face(sections[sections.length - 1], new V(1,0,0), bed);
  };
  const height = [0.43, 0.51, 0.36][variant];
  shelf(-0.19, -0.24, 1.12, 0.63, height);
  shelf(0.26, 0.37, 0.87, 0.40, height * 0.56);
  shelf(-0.79, 0.48, 0.39, 0.26, height * 0.30);
  return b.build();
}

export function gouacheStoneMaterial(shared: PaintShared) {
  return paintMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), shared, {
    key: 'gouache-stone',
    vertexPars: 'varying vec3 vLedge;',
    vertexMain: 'vLedge = position;',
    fragPars: 'varying vec3 vLedge;',
    fragColor: `
      vec2 paper = vec2(vLedge.x + 0.24 * vLedge.z, vLedge.z + 0.72 * vLedge.y);
      vec4 pigment = texture2D(uNoise, paper * vec2(0.16, 0.26));
      float lightDab = smoothstep(0.49, 0.63, pigment.g + 0.12 * pigment.a);
      vec3 chalk = diffuseColor.rgb * vec3(1.04,1.02,0.97) + vec3(0.035);
      diffuseColor.rgb = mix(diffuseColor.rgb, chalk, lightDab * 0.68);
      // A broken green underpainting resurfaces where the stone is buried.
      float foot = 1.0 - smoothstep(0.035, 0.21, vLedge.y + 0.11 * (pigment.r - 0.5));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.24,0.30,0.19), 0.64 * foot);
    `,
  });
}

// Three strokes from a flat brush, each curving over at its blunt end. The
// same grass grows in the verge and where the apron meets the stone.
export function gouacheTuft(seed: number) {
  const b = new Builder(), rng = new Rng(875 + seed);
  const root = new THREE.Color('#c1c7af'), tip = new THREE.Color('#fff6d5');
  for (let i = 0; i < 3; i++) {
    const angle = i * 0.94 - 0.8 + rng.range(-0.32, 0.32);
    const run = new V(Math.cos(angle), 0, Math.sin(angle));
    const across = new V(-run.z, 0, run.x);
    const start = new V((i - 1) * 0.09, -0.015, rng.range(-0.07, 0.07));
    const h = rng.range(0.15, 0.30), reach = h * rng.range(1.1, 1.75);
    const width = rng.range(0.024, 0.049);
    const first = b.pos.length / 3;
    for (const [t, height, halfWidth] of [[0, 0, 0.53], [0.32, 0.72, 1], [0.76, 1, 0.68], [1, 0.94, 0.10]]) {
      const p = start.clone().addScaledVector(run, reach * t);
      p.y += height * h;
      const colour = root.clone().lerp(tip, t);
      b.vert(p.clone().addScaledVector(across, -width * halfWidth), up, colour, t * 0.43);
      b.vert(p.addScaledVector(across, width * halfWidth), up, colour, t * 0.43);
    }
    for (let k = first; k < first + 6; k += 2) {
      b.tri(k, k + 1, k + 2);
      b.tri(k + 1, k + 3, k + 2);
    }
  }
  return b.build();
}
