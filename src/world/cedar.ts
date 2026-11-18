import * as THREE from 'three';
import { PropBuilder } from './flora';
import type { HeightField } from './heightfield';
import type { Track } from './track';

export const MILL_DISTANCE = 130;
export const MILL_X = -44,
  MILL_Z = 1;

// Keep the open loading apron, and the view towards its chimney from the bend.
export function millClearing(x: number, z: number) {
  return (
    ((x - MILL_X) / 21) ** 2 + ((z - MILL_Z) / 16) ** 2 < 1 || ((x + 25) / 14) ** 2 + ((z - 10) / 9) ** 2 < 1
  );
}

export function drawSawyard(props: PropBuilder, hf: HeightField, track: Track) {
  const frame = new THREE.Matrix4(),
    m = new THREE.Matrix4();
  const c = (s: string) => new THREE.Color(s);
  const brick = c('#a56550'),
    brickCap = c('#865b50'),
    siding = c('#9b6653');
  const sage = c('#72837b'),
    tin = c('#96a195'),
    trim = c('#d7c5a1');
  const wood = c('#ac916e'),
    dark = c('#675d50'),
    shadow = c('#525c58');
  function box(w: number, h: number, d: number, x: number, y: number, z: number, col: THREE.Color, tilt = 0) {
    m.makeRotationZ(tilt).setPosition(x, y, z).premultiply(frame);
    props.box(w, h, d, m, col);
  }
  function roof(x: number, y: number, z: number, half: number, depth: number, angle: number) {
    for (const side of [-1, 1]) {
      box(
        half / Math.cos(angle) + 0.14,
        0.24,
        depth,
        x + (side * half) / 2,
        y + (Math.tan(angle) * half) / 2,
        z,
        sage,
        -side * angle,
      );
    }
    box(0.25, 0.16, depth + 0.08, x, y + Math.tan(angle) * half, z, tin);
  }
  frame.makeRotationY(0.45).setPosition(MILL_X, hf.height(MILL_X, MILL_Z), MILL_Z);
  box(6.3, 1.35, 12, 0, -0.3, 0, dark);
  box(6, 3.8, 11.8, 0, 2, 0, siding);
  for (let i = 0; i < 8; i++) {
    const width = 6 * (1 - (i + 0.5) / 8);
    box(width, 0.22, 11.8, 0, 3.93 + i * 0.195, 0, siding);
  }
  roof(0, 3.92, 0, 3.48, 12.9, 0.47);
  // Clerestory over the saw floor. The light strip and uneven roofline read from the approach.
  box(1.45, 0.9, 5.4, 0, 5.77, -0.45, trim);
  box(0.12, 0.53, 4.9, 0.74, 5.8, -0.45, shadow);
  for (const z of [-2.45, -1.45, -0.45, 0.55, 1.55]) box(0.14, 0.58, 0.1, 0.78, 5.8, z, trim);
  roof(0, 6.22, -0.45, 1.04, 5.9, 0.31);
  for (const z of [-4.2, -2.4, 1.2, 3.0]) {
    box(0.12, 1.38, 1.22, 3.03, 2.64, z, trim);
    box(0.14, 1.14, 1.01, 3.07, 2.67, z, shadow);
    box(0.17, 0.1, 1.06, 3.09, 2.57, z, wood);
  }
  box(2.4, 2.9, 0.19, 0, 1.53, 5.94, dark);
  box(2.75, 0.19, 0.47, 0, 3.05, 6.05, trim);
  // Wide siding boards and a few dark seams around the gable.
  for (let i = 0; i < 13; i++) {
    box(
      0.74,
      3.1,
      0.09,
      -2.56 + (i % 7) * 0.85,
      1.99,
      i < 7 ? 5.91 : -5.91,
      i % 3 === 0 ? c('#a06b58') : siding,
    );
  }
  box(2.7, 2.87, 0.16, 0, 1.5, 6.06, shadow);
  box(1.12, 2.77, 0.18, -1.26, 1.48, 6.18, wood);
  box(1.12, 0.13, 0.2, -1.26, 1.72, 6.2, dark, -0.66);
  box(1.56, 0.57, 0.12, 0, 4.46, 5.97, trim);
  for (const dx of [-0.54, -0.27, 0, 0.27, 0.54]) box(0.14, 0.32, 0.15, dx, 4.46, 5.99, shadow);
  // Brick boiler chimney, broad foot and a corbelled cap.
  box(2.04, 2.5, 2.04, -2.8, 1.02, 3.8, brickCap);
  box(1.54, 9.9, 1.54, -2.8, 5.0, 3.8, brick);
  box(1.7, 0.26, 1.7, -2.8, 9.65, 3.8, brickCap);
  box(1.88, 0.35, 1.88, -2.8, 10.04, 3.8, brick);
  box(1.15, 0.05, 1.15, -2.8, 10.24, 3.8, dark);
  // An open-sided drying shed. Daylight between the stacks remains visible from the road.
  box(4.4, 0.24, 6.4, 5.1, 2.75, -1.3, sage, -0.1);
  for (const z of [-4.1, 1.5]) for (const x of [3.4, 6.8]) box(0.19, 2.95, 0.19, x, 1.26, z, dark);
  for (const [x, z, layers] of [
    [5.6, -2.2, 5],
    [4.2, 0, 3],
    [1.6, 8.6, 4],
  ]) {
    for (let j = 0; j < layers; j++) {
      box(1.15, 0.19, 2.9 - (j % 2) * 0.13, x, 0.25 + j * 0.25, z + (j % 2) * 0.08, j % 3 ? wood : trim);
    }
  }

  // The roadside pile shows both bark and end grain. Each log is part of the same static mesh.
  const bark = c('#79654e'),
    end = c('#cba678'),
    heart = c('#b18b65');
  function log(x: number, y: number, z: number, r: number, length: number) {
    const sides = 9,
      n = new THREE.Vector3(),
      v = new THREE.Vector3();
    const toWorld = (
      vx: number,
      vy: number,
      vz: number,
      nx: number,
      ny: number,
      nz: number,
      color: THREE.Color,
    ) =>
      props.vert(v.set(vx, vy, vz).applyMatrix4(frame), n.set(nx, ny, nz).transformDirection(frame), color, 0);
    for (let i = 0; i < sides; i++) {
      const a = (i * Math.PI * 2) / sides,
        b = ((i + 1) * Math.PI * 2) / sides;
      const ax = Math.cos(a),
        ay = Math.sin(a),
        bx = Math.cos(b),
        by = Math.sin(b);
      const z0 = z - length / 2,
        z1 = z + length / 2;
      const A = toWorld(x + ax * r, y + ay * r, z0, ax, ay, 0, bark),
        B = toWorld(x + bx * r, y + by * r, z0, bx, by, 0, bark);
      const C = toWorld(x + ax * r, y + ay * r, z1, ax, ay, 0, bark),
        D = toWorld(x + bx * r, y + by * r, z1, bx, by, 0, bark);
      props.tri(A, B, C);
      props.tri(B, D, C);
      for (const side of [-1, 1]) {
        const faceZ = side < 0 ? z0 : z1;
        const E = toWorld(x, y, faceZ, 0, 0, side, heart);
        const F = toWorld(x + r * ax, y + r * ay, faceZ, 0, 0, side, end);
        const G = toWorld(x + r * bx, y + r * by, faceZ, 0, 0, side, end);
        if (side > 0) props.tri(E, F, G);
        else props.tri(E, G, F);
      }
    }
  }
  for (const dz of [3.8, 6.4]) box(3.0, 0.26, 0.3, 5.1, 0.16, dz, dark);
  for (let layer = 0; layer < 3; layer++)
    for (let i = 0; i < 4 - layer; i++) {
      log(
        3.93 + i * 0.75 + layer * 0.38,
        0.63 + layer * 0.64,
        5.12 + (i % 2) * 0.17,
        0.37,
        4.2 + (i % 3) * 0.45,
      );
    }
  // A sawn-board fingerpost at the actual split, facing the outgoing village road.
  const fork = track.at(track.cedar!.from - 4);
  const x = fork.x + fork.tz * 5.2,
    z = fork.z - fork.tx * 5.2;
  frame.makeRotationY(-1.16).setPosition(x, hf.height(x, z), z);
  box(0.22, 2.25, 0.22, 0, 1.05, 0, dark);
  box(2.18, 0.56, 0.16, -0.42, 2.04, 0, wood, -0.06);
  for (const k of [-1, 1]) box(0.42, 0.095, 0.19, -1.12, 2.05 + k * 0.085, 0, trim, k * 0.42);
  // Four block letters picked out in the timber. Legible in silhouette at driving resolution.
  const letters = [
    ['101', '111', '101', '101', '101'],
    ['111', '010', '010', '010', '111'],
    ['100', '100', '100', '100', '111'],
    ['100', '100', '100', '100', '111'],
  ];
  letters.forEach((glyph, i) =>
    glyph.forEach((row, j) => {
      for (let k = 0; k < row.length; k++)
        if (row[k] === '1')
          box(0.065, 0.068, 0.018, -0.77 + i * 0.31 + k * 0.065, 2.2 - j * 0.067, 0.095, trim);
    }),
  );
}
