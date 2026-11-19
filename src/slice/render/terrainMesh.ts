import * as THREE from 'three';
import { noise2, pfbm2, smoothstep } from '../../core/noise';
import { CELL, GRID_N, World } from '../world/world';
import { Biome, WATER_LEVEL, WORLD_HALF, biomeAt } from '../world/terrain';
import { Look, surfaceMaterial } from './looks';

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
  material: THREE.MeshLambertMaterial | THREE.MeshToonMaterial;
  private tiles: { mesh: THREE.Mesh; geos: THREE.BufferGeometry[]; cx: number; cz: number; lod: number }[] = [];
  /** Triangles in the tiles at their current detail (before frustum culling). */
  triangles = 0;

  constructor(world: World, look: Look) {
    const N = GRID_N, h = world.height;
    // Colour and normal for every grid vertex, shared by the tiles that touch it.
    const col = new Uint8Array(N * N * 3), nor = new Int8Array(N * N * 3), plains = new Uint8Array(N * N);
    const G = look.ground, graybox = G.grid > 0;
    const P = {
      meadow: new THREE.Color(G.meadow), forest: new THREE.Color(G.forest), hillGrass: new THREE.Color(G.hillGrass),
      rock: new THREE.Color(G.rock), high: new THREE.Color(G.high), sand: new THREE.Color(G.sand), earth: new THREE.Color(G.earth),
    };
    const hillCol = new THREE.Color();
    const b: Biome = { mountain: 0, forest: 0 }, c = new THREE.Color(), v = new THREE.Vector3();
    const at = (ix: number, iz: number) => h[Math.min(N - 1, Math.max(0, iz)) * N + Math.min(N - 1, Math.max(0, ix))];
    for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
      const i = iz * N + ix, x = ix * CELL - WORLD_HALF, z = iz * CELL - WORLD_HALF, y = h[i];
      const sx = (at(ix + 1, iz) - at(ix - 1, iz)) / (2 * CELL), sz = (at(ix, iz + 1) - at(ix, iz - 1)) / (2 * CELL);
      v.set(-sx, 1, -sz).normalize();
      nor[i * 3] = Math.round(v.x * 127); nor[i * 3 + 1] = Math.round(v.y * 127); nor[i * 3 + 2] = Math.round(v.z * 127);
      biomeAt(x, z, b);
      const slope = Math.hypot(sx, sz), rd = world.roadDist[i];
      if (graybox) {
        // Plains: a patchwork of fields, so there is something to measure speed against.
        const f = noise2(x / 210 + 3.7, z / 210 - 8.2, 77), g = noise2(x / 520 - 1.1, z / 520 + 4.3, 78);
        c.copy(f > 0.12 ? C.fieldB : f < -0.14 ? C.fieldC : C.fieldA).lerp(C.fieldA, 0.15 + 0.15 * g);
        c.lerp(C.forest, b.forest * 0.9);
        c.lerp(C.rock, b.mountain).lerp(C.high, b.mountain * smoothstep(110, 215, y));
        c.multiplyScalar(1 - 0.22 * smoothstep(0.22, 0.7, slope));
        c.lerp(C.sand, 1 - smoothstep(WATER_LEVEL + 0.4, WATER_LEVEL + 3.5, y));
        if (rd < 250) c.lerp(C.earth, 0.8 * (1 - smoothstep(1, 6, rd)));
      } else {
        // Meadow on the plains (the shader lays field parcels over it), darker floor under the
        // forest, and on anything steep or on the massif: grass, then rock, then pale high ground.
        const hill = Math.max(b.mountain, smoothstep(0.1, 0.28, slope));
        hillCol.copy(P.hillGrass).lerp(P.rock, smoothstep(0.3, 0.52, slope)).lerp(P.high, b.mountain * smoothstep(120, 215, y));
        c.copy(P.meadow).lerp(P.forest, b.forest).lerp(hillCol, hill);
        const shore = smoothstep(WATER_LEVEL + 0.4, WATER_LEVEL + 3.5, y);
        c.lerp(P.sand, 1 - shore);
        const verge = rd < 250 ? smoothstep(1, 5, rd) : 1;
        c.lerp(P.earth, 0.85 * (1 - verge));
        plains[i] = Math.round(255 * (1 - b.forest) * (1 - hill) * smoothstep(WATER_LEVEL + 2, WATER_LEVEL + 6, y) * (rd < 250 ? smoothstep(2, 7, rd) : 1));
      }
      col[i * 3] = Math.round(c.r * 255); col[i * 3 + 1] = Math.round(c.g * 255); col[i * 3 + 2] = Math.round(c.b * 255);
    }

    this.material = surfaceMaterial(look, { vertexColors: true, side: THREE.DoubleSide });
    const uniforms = {
      uNoise: { value: washTexture() },
      uField: { value: G.fields.map((f) => new THREE.Color(f)) },
      uHedge: { value: new THREE.Color(G.hedge) },
      uParcels: { value: G.parcels }, uRows: { value: G.rows }, uWash: { value: G.wash }, uGrid: { value: G.grid },
    };
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aPlains;\nvarying vec2 vXZ;\nvarying float vPlains;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvXZ = (modelMatrix * vec4(position, 1.0)).xz;\nvPlains = aPlains;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec2 vXZ;
          varying float vPlains;
          uniform sampler2D uNoise;
          uniform vec3 uField[5];
          uniform vec3 uHedge;
          uniform float uParcels, uRows, uWash, uGrid;
          float gridLine(vec2 p, float cell) {
            vec2 q = p / cell, w = fwidth(q);
            vec2 a = abs(fract(q - 0.5) - 0.5) / max(w, vec2(1e-5));
            return (1.0 - min(min(a.x, a.y), 1.0)) * (1.0 - smoothstep(0.15, 0.6, max(w.x, w.y)));
          }
          float h21(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.y); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            vec3 broad = texture2D(uNoise, vXZ / 620.0).rgb, fine = texture2D(uNoise, vXZ / 83.0).rgb;
            if (uParcels > 0.0 && vPlains > 0.004) {
              // Field parcels: a skewed, slightly warped brick pattern, one crop colour each,
              // a hedge line between them and rows in about half of them.
              vec2 size = vec2(105.0, 165.0);
              vec2 cell = (mat2(0.9397, -0.3420, 0.3420, 0.9397) * vXZ + (broad.rg - 0.5) * 50.0) / size;
              cell.y += 0.5 * mod(floor(cell.x), 2.0);
              vec2 id = floor(cell), f = fract(cell);
              float h = h21(id + 7.0);
              vec3 crop = h < 0.26 ? uField[0] : h < 0.5 ? uField[1] : h < 0.68 ? uField[2] : h < 0.86 ? uField[3] : uField[4];
              vec2 de = min(f, 1.0 - f) * size;
              float edge = min(de.x, de.y), fw = fwidth(edge) + 1e-4;
              float hedge = (1.0 - smoothstep(1.4, 1.4 + fw * 1.5, edge)) * (1.0 - smoothstep(2.5, 9.0, fw));
              float rc = f.x * size.x / 3.2, rfw = fwidth(rc);
              float stripe = smoothstep(-rfw, rfw, abs(fract(rc) - 0.5) - 0.25);
              float rows = uRows * step(0.45, h21(id + 31.0)) * (1.0 - smoothstep(0.2, 0.6, rfw));
              crop *= mix(1.0, mix(0.86, 1.05, stripe), rows);
              diffuseColor.rgb = mix(diffuseColor.rgb, mix(crop, uHedge, hedge), vPlains * uParcels);
            }
            if (uWash > 0.0) {
              // Two tones with a brushy edge between them, then finer mottling and a slow
              // warm-to-cool drift, as if laid down in overlapping washes.
              float dab = smoothstep(0.47, 0.53, broad.b + (fine.r - 0.5) * 0.45);
              diffuseColor.rgb *= 1.0 + uWash * (mix(-0.085, 0.075, dab) + (fine.g - 0.5) * 0.13);
              diffuseColor.rgb += uWash * (broad.g - 0.5) * vec3(0.09, 0.03, -0.07);
            }
            diffuseColor.rgb *= 1.0 - uGrid * (0.22 * gridLine(vXZ, 100.0) + 0.09 * gridLine(vXZ, 20.0));
          }`);
    };

    const indices = STRIDES.map(indexFor);
    const count = V * V + 4 * V;
    for (let tz = 0; tz < TILES; tz++) for (let tx = 0; tx < TILES; tx++) {
      const pos = new Float32Array(count * 3), tn = new Int8Array(count * 3), tc = new Uint8Array(count * 3), tp = new Uint8Array(count);
      const x0 = tx * TILE, z0 = tz * TILE;
      let lo = Infinity, hi = -Infinity;
      const put = (o: number, ix: number, iz: number, drop: number) => {
        const i = iz * N + ix;
        pos[o * 3] = ix * CELL - WORLD_HALF; pos[o * 3 + 1] = h[i] - drop; pos[o * 3 + 2] = iz * CELL - WORLD_HALF;
        tn[o * 3] = nor[i * 3]; tn[o * 3 + 1] = nor[i * 3 + 1]; tn[o * 3 + 2] = nor[i * 3 + 2];
        tc[o * 3] = col[i * 3]; tc[o * 3 + 1] = col[i * 3 + 1]; tc[o * 3 + 2] = col[i * 3 + 2];
        tp[o] = plains[i];
        if (!drop) { lo = Math.min(lo, h[i]); hi = Math.max(hi, h[i]); }
      };
      for (let iz = 0; iz < V; iz++) for (let ix = 0; ix < V; ix++) put(iz * V + ix, x0 + ix, z0 + iz, 0);
      const S = V * V;
      for (let t = 0; t < V; t++) {
        put(S + t, x0 + t, z0, SKIRT); put(S + V + t, x0 + t, z0 + TILE, SKIRT);
        put(S + 2 * V + t, x0, z0 + t, SKIRT); put(S + 3 * V + t, x0 + TILE, z0 + t, SKIRT);
      }
      const aPos = new THREE.BufferAttribute(pos, 3), aNor = new THREE.BufferAttribute(tn, 3, true), aCol = new THREE.BufferAttribute(tc, 3, true);
      const aPlains = new THREE.BufferAttribute(tp, 1, true);
      const cx = (x0 + TILE / 2) * CELL - WORLD_HALF, cz = (z0 + TILE / 2) * CELL - WORLD_HALF;
      const sphere = new THREE.Sphere(new THREE.Vector3(cx, (lo + hi) / 2, cz), Math.hypot(TILE * CELL * Math.SQRT1_2, (hi - lo) / 2 + SKIRT));
      const geos = indices.map((index) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', aPos); g.setAttribute('normal', aNor); g.setAttribute('color', aCol); g.setAttribute('aPlains', aPlains);
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

let wash: THREE.DataTexture | undefined;
/** Three independent channels of tileable noise, for parcel warping and painted washes. */
function washTexture(): THREE.DataTexture {
  if (wash) return wash;
  const S = 256, data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, o = (y * S + x) * 4;
    for (let k = 0; k < 3; k++) data[o + k] = Math.round(255 * Math.min(1, Math.max(0, 0.5 + 0.62 * pfbm2(u, v, 4, 4, 4, 300 + k * 17))));
    data[o + 3] = 255;
  }
  wash = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  wash.wrapS = wash.wrapT = THREE.RepeatWrapping;
  wash.minFilter = THREE.LinearMipmapLinearFilter; wash.magFilter = THREE.LinearFilter;
  wash.generateMipmaps = true;
  wash.needsUpdate = true;
  return wash;
}
