import * as THREE from 'three';
import { PropBuilder } from './flora';
import type { PaintShared } from '../render/paint';
import { paintMaterial } from '../render/paint';

// Local +v follows the road over the bridge. The brook runs down the shallow fold along +u.
const X = 2.67,
  Z = -57.24,
  FX = 0.8824,
  FZ = -0.4705;
const flow = (u: number) => 1.45 * Math.sin(u * 0.19) + 0.44 * Math.sin(u * 0.47);
const waterY = (u: number) => -1.02 - u * 0.014;
const halfWidth = (u: number) => 2.05 + 0.55 * Math.sin(u * 0.18 + 0.8);
const uAt = (x: number, z: number) => (x - X) * FZ - (z - Z) * FX;
const vAt = (x: number, z: number) => (x - X) * FX + (z - Z) * FZ;
const wx = (u: number, v: number) => X + FX * v + FZ * u;
const wz = (u: number, v: number) => Z + FZ * v - FX * u;
export function shorePoint(u: number, offset: number) {
  const v = flow(u) + halfWidth(u) * offset;
  return { x: wx(u, v), z: wz(u, v) };
}
export function brookBed(x: number, z: number, land: number) {
  if (Math.abs(x - X) > 19 || Math.abs(z - Z) > 26) return land;
  const u = uAt(x, z),
    v = vAt(x, z);
  const d = Math.abs(v - flow(u)) / halfWidth(u);
  const carved =
    (1 - THREE.MathUtils.smoothstep(d, 0.59, 1.86)) * (1 - THREE.MathUtils.smoothstep(Math.abs(u), 17, 23));
  return THREE.MathUtils.lerp(land, Math.min(land, waterY(u) - 0.51), carved);
}
export function bridgeSurface(x: number, z: number) {
  return (
    Math.abs(x - X) < 9 && Math.abs(z - Z) < 9 && Math.abs(uAt(x, z)) <= 3.69 && Math.abs(vAt(x, z)) <= 5.2
  );
}
export function wetBank(x: number, z: number) {
  if (Math.abs(x - X) > 17 || Math.abs(z - Z) > 23) return false;
  const u = uAt(x, z);
  return Math.abs(u) < 20 && Math.abs(vAt(x, z) - flow(u)) < halfWidth(u) * 1.34;
}

export function drawMillBridge(props: PropBuilder, level: number) {
  const frame = new THREE.Matrix4().makeRotationY(Math.atan2(FX, FZ)).setPosition(X, level, Z);
  const local = new THREE.Matrix4(),
    oak = new THREE.Color('#927957'),
    joint = new THREE.Color('#6f6354');
  const stone = new THREE.Color('#969386'),
    pale = new THREE.Color('#b5a384');
  function beam(w: number, h: number, d: number, u: number, y: number, v: number, tint: THREE.Color) {
    local.makeTranslation(u, y, v).premultiply(frame);
    props.box(w, h, d, local, tint);
  }
  for (const v of [-4.7, 4.7]) beam(7.3, 1.65, 0.9, 0, -0.99, v, stone);
  for (const u of [-3.1, 0, 3.1]) beam(0.42, 0.52, 10.2, u, -0.32, 0, joint);
  for (let i = 0; i < 26; i++) beam(7.42, 0.17, 0.394, 0, -0.085, -5 + i * 0.4, i % 6 === 2 ? pale : oak);
  for (const u of [-3.58, 3.58]) {
    for (const v of [-4.8, -1.6, 1.6, 4.8]) beam(0.19, 1.27, 0.19, u, 0.49, v, joint);
    beam(0.16, 0.15, 9.93, u, 1, 0, pale);
    beam(0.09, 0.11, 9.72, u, 0.55, 0, oak);
  }
}

export function brookWater(shared: PaintShared) {
  const vertices: number[] = [],
    indices: number[] = [];
  for (let i = 0; i <= 96; i++) {
    const u = -24 + i * 0.5;
    for (const side of [-1, 1]) {
      const v = flow(u) + side * halfWidth(u) * 1.6;
      vertices.push(wx(u, v), waterY(u), wz(u, v));
    }
    if (i) {
      const k = i * 2;
      indices.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = paintMaterial(
    new THREE.MeshLambertMaterial({ color: '#81a79c', side: THREE.DoubleSide }),
    shared,
    {
      key: 'mill-brook',
      fragColor: `vec2 stream=vWorldPos.xz;
      float wash=texture2D(uNoise,stream*0.20).g;
      float glint=smoothstep(0.72,0.78,texture2D(uNoise,stream*vec2(0.36,1.5)+vec2(uTime*0.038,0.)).r);
      diffuseColor.rgb=mix(diffuseColor.rgb*0.75,diffuseColor.rgb*1.09,wash);
      diffuseColor.rgb+=vec3(0.11,0.12,0.10)*glint;`,
    },
  );
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'Mill brook';
  return mesh;
}
