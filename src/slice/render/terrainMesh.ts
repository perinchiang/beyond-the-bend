import * as THREE from 'three';
import { noise2, smoothstep } from '../../core/noise';
import { CELL, GRID_N, World } from '../world/world';
import { Biome, WATER_LEVEL, WORLD_HALF, biomeAt } from '../world/terrain';

/**
 * The terrain grid drawn as 256 m tiles. Each tile owns one vertex buffer at full resolution
 * (4 m) and is drawn through one of five shared index buffers that skip vertices (4 → 64 m),
 * chosen by distance from the camera. Skirts hanging from the tile edges hide the cracks
 * between neighbours at different detail.
 */
const TILE = 64, V = TILE + 1, TILES = (GRID_N - 1) / TILE;
const STRIDES = [1, 2, 4, 8, 16];
/** Distance (m) from the camera to a tile centre beyond which the next coarser level is used. */
const LOD_AT = [620, 1250, 2300, 3700];
const SKIRT = 24;

// Graybox palette: neutral, light, only different enough to tell the three regions apart.
const C = {
  fieldA: new THREE.Color('#cdd0b9'), fieldB: new THREE.Color('#dcd4a6'), fieldC: new THREE.Color('#b4c4a2'),
  forest: new THREE.Color('#a8b79c'), rock: new THREE.Color('#b9b2a8'), high: new THREE.Color('#d6d1cb'),
  sand: new THREE.Color('#dcd6c0'), earth: new THREE.Color('#c4b9a2'),
};

function indexFor(stride: number): THREE.BufferAttribute {
  const idx: number[] = [];
  for (let iz = 0; iz < TILE; iz += stride) for (let ix = 0; ix < TILE; ix += stride) {
    const a = iz * V + ix, b = a + stride, c = a + stride * V, d = c + stride;
    idx.push(a, c, b, b, c, d);
  }
  const S = V * V;
  const edge = [(t: number) => t, (t: number) => TILE * V + t, (t: number) => t * V, (t: number) => t * V + TILE];
  for (let e = 0; e < 4; e++) for (let t = 0; t < TILE; t += stride) {
    const g0 = edge[e](t), g1 = edge[e](t + stride), k0 = S + e * V + t, k1 = S + e * V + t + stride;
    idx.push(g0, g1, k0, g1, k1, k0);
  }
  return new THREE.BufferAttribute(new Uint16Array(idx), 1);
}

export class TerrainMesh {
  group = new THREE.Group();
  material: THREE.MeshLambertMaterial;
  private tiles: { mesh: THREE.Mesh; geos: THREE.BufferGeometry[]; cx: number; cz: number; lod: number }[] = [];
  /** Triangles in the tiles at their current detail (before frustum culling). */
  triangles = 0;

  constructor(world: World) {
    const N = GRID_N, h = world.height;
    // Colour and normal for every grid vertex, shared by the tiles that touch it.
    const col = new Uint8Array(N * N * 3), nor = new Int8Array(N * N * 3);
    const b: Biome = { mountain: 0, forest: 0 }, c = new THREE.Color(), v = new THREE.Vector3();
    const at = (ix: number, iz: number) => h[Math.min(N - 1, Math.max(0, iz)) * N + Math.min(N - 1, Math.max(0, ix))];
    for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
      const i = iz * N + ix, x = ix * CELL - WORLD_HALF, z = iz * CELL - WORLD_HALF, y = h[i];
      const sx = (at(ix + 1, iz) - at(ix - 1, iz)) / (2 * CELL), sz = (at(ix, iz + 1) - at(ix, iz - 1)) / (2 * CELL);
      v.set(-sx, 1, -sz).normalize();
      nor[i * 3] = Math.round(v.x * 127); nor[i * 3 + 1] = Math.round(v.y * 127); nor[i * 3 + 2] = Math.round(v.z * 127);
      biomeAt(x, z, b);
      // Plains: a patchwork of fields, so there is something to measure speed against.
      const f = noise2(x / 210 + 3.7, z / 210 - 8.2, 77), g = noise2(x / 520 - 1.1, z / 520 + 4.3, 78);
      c.copy(f > 0.12 ? C.fieldB : f < -0.14 ? C.fieldC : C.fieldA).lerp(C.fieldA, 0.15 + 0.15 * g);
      c.lerp(C.forest, b.forest * 0.9);
      c.lerp(C.rock, b.mountain).lerp(C.high, b.mountain * smoothstep(110, 215, y));
      c.multiplyScalar(1 - 0.22 * smoothstep(0.22, 0.7, Math.hypot(sx, sz)));
      c.lerp(C.sand, 1 - smoothstep(WATER_LEVEL + 0.4, WATER_LEVEL + 3.5, y));
      const rd = world.roadDist[i];
      if (rd < 250) c.lerp(C.earth, 0.8 * (1 - smoothstep(1, 6, rd)));
      col[i * 3] = Math.round(c.r * 255); col[i * 3 + 1] = Math.round(c.g * 255); col[i * 3 + 2] = Math.round(c.b * 255);
    }

    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    // Faint 100 m and 20 m grid lines: scale and speed stay readable on bare ground.
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vGridXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGridXZ = (modelMatrix * vec4(position, 1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec2 vGridXZ;
          float gridLine(vec2 p, float cell) {
            vec2 q = p / cell, w = fwidth(q);
            vec2 a = abs(fract(q - 0.5) - 0.5) / max(w, vec2(1e-5));
            return (1.0 - min(min(a.x, a.y), 1.0)) * (1.0 - smoothstep(0.15, 0.6, max(w.x, w.y)));
          }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.rgb *= 1.0 - 0.22 * gridLine(vGridXZ, 100.0) - 0.09 * gridLine(vGridXZ, 20.0);`);
    };

    const indices = STRIDES.map(indexFor);
    const count = V * V + 4 * V;
    for (let tz = 0; tz < TILES; tz++) for (let tx = 0; tx < TILES; tx++) {
      const pos = new Float32Array(count * 3), tn = new Int8Array(count * 3), tc = new Uint8Array(count * 3);
      const x0 = tx * TILE, z0 = tz * TILE;
      let lo = Infinity, hi = -Infinity;
      const put = (o: number, ix: number, iz: number, drop: number) => {
        const i = iz * N + ix;
        pos[o * 3] = ix * CELL - WORLD_HALF; pos[o * 3 + 1] = h[i] - drop; pos[o * 3 + 2] = iz * CELL - WORLD_HALF;
        tn[o * 3] = nor[i * 3]; tn[o * 3 + 1] = nor[i * 3 + 1]; tn[o * 3 + 2] = nor[i * 3 + 2];
        tc[o * 3] = col[i * 3]; tc[o * 3 + 1] = col[i * 3 + 1]; tc[o * 3 + 2] = col[i * 3 + 2];
        if (!drop) { lo = Math.min(lo, h[i]); hi = Math.max(hi, h[i]); }
      };
      for (let iz = 0; iz < V; iz++) for (let ix = 0; ix < V; ix++) put(iz * V + ix, x0 + ix, z0 + iz, 0);
      const S = V * V;
      for (let t = 0; t < V; t++) {
        put(S + t, x0 + t, z0, SKIRT); put(S + V + t, x0 + t, z0 + TILE, SKIRT);
        put(S + 2 * V + t, x0, z0 + t, SKIRT); put(S + 3 * V + t, x0 + TILE, z0 + t, SKIRT);
      }
      const aPos = new THREE.BufferAttribute(pos, 3), aNor = new THREE.BufferAttribute(tn, 3, true), aCol = new THREE.BufferAttribute(tc, 3, true);
      const cx = (x0 + TILE / 2) * CELL - WORLD_HALF, cz = (z0 + TILE / 2) * CELL - WORLD_HALF;
      const sphere = new THREE.Sphere(new THREE.Vector3(cx, (lo + hi) / 2, cz), Math.hypot(TILE * CELL * Math.SQRT1_2, (hi - lo) / 2 + SKIRT));
      const geos = indices.map((index) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', aPos); g.setAttribute('normal', aNor); g.setAttribute('color', aCol);
        g.setIndex(index);
        g.boundingSphere = sphere;
        return g;
      });
      const mesh = new THREE.Mesh(geos[4], this.material);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      this.tiles.push({ mesh, geos, cx, cz, lod: 4 });
    }
    this.group.matrixAutoUpdate = false;
  }

  /** Pick each tile's detail from the camera position. Cheap; call every frame. */
  update(camX: number, camZ: number, bias = 1) {
    let tris = 0;
    for (const t of this.tiles) {
      const d = Math.hypot(t.cx - camX, t.cz - camZ) / bias;
      const lod = d < LOD_AT[0] ? 0 : d < LOD_AT[1] ? 1 : d < LOD_AT[2] ? 2 : d < LOD_AT[3] ? 3 : 4;
      if (lod !== t.lod) { t.lod = lod; t.mesh.geometry = t.geos[lod]; }
      tris += t.geos[lod].index!.count / 3;
    }
    this.triangles = tris;
  }
}
