import * as THREE from 'three';
import { Rng } from '../core/rng';
import { paintMaterial, type PaintShared } from '../render/paint';
import type { Track } from './track';
import type { HeightField } from './heightfield';

// Four remembered wheel positions keep a passing gust on the plants after the car leaves.
export function riceField(track: Track, hf: HeightField, shared: PaintShared, low: boolean) {
  const wake = Array.from({ length: 4 }, () => new THREE.Vector4(1000, 1000, -100, 0));
  const rng = new Rng(118);
  const material = paintMaterial(
    new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, vertexColors: true, emissive: '#565029' }),
    shared,
    {
      key: 'rice-wind',
      uniforms: { uWake: { value: wake } },
      vertexPars: 'uniform vec4 uWake[4];',
      vertexMain: `
      vec2 root = instanceMatrix[3].xz;
      float tip = smoothstep(0.04,0.8,position.y);
      float wind = sin(root.x * 0.31 + root.y * 0.17 - uTime * 1.9);
      transformed.x += tip * (0.08 + 0.09 * wind);
      for(int i=0;i<4;i++){
        vec2 d=root-uWake[i].xy;
        float gust=(1.0-smoothstep(0.1,5.6,length(d))) * exp(-max(0.0,uTime-uWake[i].z)*3.3)*uWake[i].w;
        transformed.xz += tip * (d / max(1.0,length(d))) * gust * 0.55;
        transformed.y -= tip * gust * 0.12;
      }`,
    },
  );
  const geo = new THREE.BufferGeometry(),
    vertices: number[] = [],
    colors: number[] = [];
  function blade(points: number[], tint: string) {
    vertices.push(...points);
    const c = new THREE.Color(tint);
    for (let i = 0; i < 3; i++) colors.push(c.r, c.g, c.b);
  }
  for (const dx of [-0.19, 0, 0.19]) {
    blade([dx - 0.10, 0, 0, dx + 0.10, 0, 0.04, dx * 1.8, 0.68, 0.14], '#a9ac68');
    blade([dx * 1.8, 0.68, 0.14, dx * 1.8 + 0.09, 0.72, 0.15, dx * 2 + 0.28, 0.49, 0.26], '#d6ac54');
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const normals = new Float32Array(vertices.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  const plots: THREE.Matrix4[] = [],
    pose = new THREE.Object3D();
  const rows = low ? 8 : 13;
  const start = track.at(74);
  function bed(x: number, z: number) {
    const dx = x-start.x, dz = z-start.z;
    const along = dx*start.tx + dz*start.tz;
    const across = Math.abs(dz*start.tx - dx*start.tz);
    const row = Math.max(0,(across-5.65)/0.9);
    const margin = Math.min(across-4.95, 5.65+rows*0.9-across,
      along-row*0.56-2.4*Math.sin(row*0.81), 75-along-row*0.78+1.8*Math.sin(row));
    return THREE.MathUtils.smoothstep(margin, -0.55, 1.15);
  }
  for (let s = 74; s < 149; s += low ? 1.15 : 0.82)
    for (const side of [-1, 1]) {
      const t = track.at(s);
      for (let row = 0; row < rows; row++) {
        if (s < 74 + row * 0.56 + 2.4*Math.sin(row*0.81) ||
            s > 149 - row * 0.78 + 1.8*Math.sin(row)) continue;
        const offset = side * (5.65 + row * 0.9 + rng.range(-0.12, 0.12));
        const x = t.x - t.tz * offset,
          z = t.z + t.tx * offset;
        if (hf.roadDist(x, z) < 4.85) continue;
        pose.position.set(x, hf.height(x, z) - 0.03, z);
        pose.rotation.y = rng.range(-1.0, 1.35);
        pose.scale.setScalar(rng.range(0.88, 1.18));
        pose.updateMatrix();
        plots.push(pose.matrix.clone());
      }
    }
  const mesh = new THREE.InstancedMesh(geo, material, plots.length);
  plots.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.receiveShadow = true;
  let last = -1,
    slot = 0;
  function update(x: number, z: number, speed: number, time: number) {
    if (time - last < 0.14) return;
    last = time;
    wake[slot].set(x, z, time, Math.min(1, Math.abs(speed) / 17));
    slot = (slot + 1) % wake.length;
  }
  return { mesh, bed, update };
}
