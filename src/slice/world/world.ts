import { smoothstep } from '../../core/noise';
import { GRASS, Ground, GroundSample, Obstacle, Obstacles, SHOULDER } from '../ground';
import { Bend, buildAlignment } from './alignment';
import { ROADS, RoadDef, Spawn } from './network';
import { Biome, WATER_LEVEL, WORLD_HALF, biomeAt, macroHeight, naturalHeight } from './terrain';

/**
 * The drivable world, with no rendering in it so tests can build and drive it headless.
 *
 *  - Roads: centre-line samples every 2 m with a height profile. On the pavement the car rides
 *    on that profile exactly; it does not depend on the terrain grid.
 *  - Terrain: a 4 m height grid of the natural ground with every road corridor cut and filled
 *    into it. Off the road the car rides on the same bilinear grid that is drawn.
 *  - Trees: solid cylinders in a spatial hash.
 */
export const CELL = 4;
export const GRID_N = (WORLD_HALF * 2) / CELL + 1;
/** Earth shoulder beside the pavement: width, and how far its outer edge dips. */
export const SHOULDER_W = 2.5, SHOULDER_DROP = 0.3;
/** The cut ground lies this far under the road surface so it never shows through. */
const UNDER = 0.12;
/** Ground is held at road level this far beyond the pavement before it starts blending out. */
const FLAT = 6;
/** Roads are never lower than this (causeway across the lake shore). */
const MIN_ROAD_Y = WATER_LEVEL + 2.2;

const HASH = 16, HASH_N = (WORLD_HALF * 2) / HASH;
const TREE_HASH = 32, TREE_HASH_N = (WORLD_HALF * 2) / TREE_HASH;

export interface Road {
  def: RoadDef;
  /** Position in the list; lower wins where roads overlap. */
  index: number;
  n: number;
  step: number;
  length: number;
  closed: boolean;
  x: Float32Array; z: Float32Array;
  /** Unit direction of travel. Left of the road is (tz, -tx). */
  tx: Float32Array; tz: Float32Array;
  /** Curvature (1/m), positive = left. */
  k: Float32Array;
  y: Float32Array;
  grade: Float32Array;
  /** 1 where another road runs on or right beside this one. */
  junction: Uint8Array;
  bends: Bend[];
}

export interface RoadHit {
  road: Road;
  /** Nearest sample, distance along the road from it, and sideways offset (+ = left). */
  i: number; along: number; lat: number;
  /** Distance from the centre line. */
  dist: number;
}

export interface Tree { x: number; z: number; y: number; r: number; height: number; kind: number }

export interface Pose { x: number; z: number; heading: number }

const hash3 = (a: number, b: number, c: number) => {
  let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 1274126177);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
};

export class World implements Ground, Obstacles {
  roads: Road[] = [];
  height = new Float32Array(GRID_N * GRID_N);
  /** Metres beyond the nearest pavement edge, clamped to 0..250; 255 = far from any road. */
  roadDist = new Uint8Array(GRID_N * GRID_N).fill(255);
  trees: Tree[] = [];

  private hashStart = new Int32Array(HASH_N * HASH_N + 1);
  private hashItems = new Int32Array(0);
  private treeStart = new Int32Array(TREE_HASH_N * TREE_HASH_N + 1);
  private treeItems = new Int32Array(0);

  // ---- queries ---------------------------------------------------------------------------

  /** Bilinear height of the terrain grid (the drawn ground, road corridors included). */
  heightAt(x: number, z: number): number {
    const fx = Math.min(GRID_N - 1.001, Math.max(0, (x + WORLD_HALF) / CELL));
    const fz = Math.min(GRID_N - 1.001, Math.max(0, (z + WORLD_HALF) / CELL));
    const ix = fx | 0, iz = fz | 0, u = fx - ix, v = fz - iz, i = iz * GRID_N + ix, h = this.height;
    return (h[i] * (1 - u) + h[i + 1] * u) * (1 - v) + (h[i + GRID_N] * (1 - u) + h[i + GRID_N + 1] * u) * v;
  }

  /** Height, normal and surface type under a point. Called for every wheel every physics step. */
  sample(x: number, z: number, out: GroundSample): GroundSample {
    const cx = Math.floor((x + WORLD_HALF) / HASH), cz = Math.floor((z + WORLD_HALF) / HASH);
    const roads = this.roads, start = this.hashStart, items = this.hashItems;
    // Best pavement hit (lowest road index, then nearest sample) and best shoulder hit.
    let pr = -1, pi = 0, pd = 1e9, pLat = 0, pAlong = 0;
    let sr = -1, si = 0, sEdge = 1e9, sAlong = 0;
    for (let dz = -1; dz <= 1; dz++) {
      const gz = cz + dz;
      if (gz < 0 || gz >= HASH_N) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const gx = cx + dx;
        if (gx < 0 || gx >= HASH_N) continue;
        const c = gz * HASH_N + gx;
        for (let q = start[c], e = start[c + 1]; q < e; q++) {
          const id = items[q], r = id >>> 16, i = id & 0xffff, road = roads[r];
          const ox = x - road.x[i], oz = z - road.z[i];
          const al = ox * road.tx[i] + oz * road.tz[i];
          if (al > road.step || al < -road.step) continue;
          const lat = ox * road.tz[i] - oz * road.tx[i], a = lat < 0 ? -lat : lat;
          const hw = road.def.halfWidth;
          if (a <= hw) {
            const d2 = ox * ox + oz * oz;
            if (pr < 0 || r < pr || (r === pr && d2 < pd)) { pr = r; pi = i; pd = d2; pLat = lat; pAlong = al; }
          } else if (a <= hw + SHOULDER_W && a - hw < sEdge) { sr = r; si = i; sEdge = a - hw; sAlong = al; }
        }
      }
    }
    if (pr >= 0) {
      const road = roads[pr], g = road.grade[pi], inv = 1 / Math.sqrt(1 + g * g);
      out.y = road.y[pi] + g * pAlong;
      out.nx = -g * road.tx[pi] * inv; out.ny = inv; out.nz = -g * road.tz[pi] * inv;
      out.surface = road.def.surface;
      return out;
    }
    const ground = this.heightAt(x, z);
    if (sr >= 0) {
      const road = roads[sr], g = road.grade[si], inv = 1 / Math.sqrt(1 + g * g);
      const ribbon = road.y[si] + g * sAlong - (SHOULDER_DROP * sEdge) / SHOULDER_W;
      out.y = ribbon > ground ? ribbon : ground;
      out.nx = -g * road.tx[si] * inv; out.ny = inv; out.nz = -g * road.tz[si] * inv;
      out.surface = SHOULDER;
      return out;
    }
    // Open ground: slope of the grid cell.
    const fx = Math.min(GRID_N - 1.001, Math.max(0, (x + WORLD_HALF) / CELL));
    const fz = Math.min(GRID_N - 1.001, Math.max(0, (z + WORLD_HALF) / CELL));
    const i = (fz | 0) * GRID_N + (fx | 0), h = this.height;
    const sx = (h[i + 1] + h[i + GRID_N + 1] - h[i] - h[i + GRID_N]) / (2 * CELL);
    const sz = (h[i + GRID_N] + h[i + GRID_N + 1] - h[i] - h[i + 1]) / (2 * CELL);
    const inv = 1 / Math.sqrt(1 + sx * sx + sz * sz);
    out.y = ground; out.nx = -sx * inv; out.ny = inv; out.nz = -sz * inv;
    out.surface = GRASS;
    return out;
  }

  /**
   * Nearest road centre line within `radius`. `only` restricts the search to one road;
   * `below` to roads with a lower index (used while building, when later roads follow earlier ones);
   * `exclude` leaves one road out.
   */
  nearestRoad(x: number, z: number, radius: number, out: RoadHit, only: Road | null = null, below = 1e9, exclude: Road | null = null): boolean {
    const reach = Math.ceil((radius + 2) / HASH);
    const cx = Math.floor((x + WORLD_HALF) / HASH), cz = Math.floor((z + WORLD_HALF) / HASH);
    let best = radius * radius, found = false;
    for (let gz = Math.max(0, cz - reach); gz <= Math.min(HASH_N - 1, cz + reach); gz++) {
      for (let gx = Math.max(0, cx - reach); gx <= Math.min(HASH_N - 1, cx + reach); gx++) {
        const c = gz * HASH_N + gx;
        for (let q = this.hashStart[c], e = this.hashStart[c + 1]; q < e; q++) {
          const id = this.hashItems[q], r = id >>> 16, i = id & 0xffff;
          if (r >= below) continue;
          const road = this.roads[r];
          if ((only && road !== only) || road === exclude) continue;
          const ox = x - road.x[i], oz = z - road.z[i], d2 = ox * ox + oz * oz;
          if (d2 < best) { best = d2; found = true; out.road = road; out.i = i; }
        }
      }
    }
    if (!found) return false;
    const road = out.road, i = out.i;
    const ox = x - road.x[i], oz = z - road.z[i];
    out.along = ox * road.tx[i] + oz * road.tz[i];
    out.lat = ox * road.tz[i] - oz * road.tx[i];
    // Past the end of an open road the distance is to its end point, not to its extended line.
    const end = !road.closed && ((i === 0 && out.along < 0) || (i === road.n - 1 && out.along > 0));
    out.dist = end ? Math.sqrt(best) : Math.abs(out.lat);
    return true;
  }

  near(x: number, z: number, radius: number, out: Obstacle[]): number {
    const reach = radius + 1;
    const x0 = Math.max(0, Math.floor((x - reach + WORLD_HALF) / TREE_HASH)), x1 = Math.min(TREE_HASH_N - 1, Math.floor((x + reach + WORLD_HALF) / TREE_HASH));
    const z0 = Math.max(0, Math.floor((z - reach + WORLD_HALF) / TREE_HASH)), z1 = Math.min(TREE_HASH_N - 1, Math.floor((z + reach + WORLD_HALF) / TREE_HASH));
    let n = 0;
    for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) {
      const c = gz * TREE_HASH_N + gx;
      for (let q = this.treeStart[c], e = this.treeStart[c + 1]; q < e; q++) {
        const t = this.trees[this.treeItems[q]];
        const dx = t.x - x, dz = t.z - z;
        if (dx * dx + dz * dz > radius * radius) continue;
        const o = out[n] ?? (out[n] = { x: 0, z: 0, r: 0 });
        o.x = t.x; o.z = t.z; o.r = t.r;
        n++;
      }
    }
    return n;
  }

  road(id: string): Road {
    const r = this.roads.find((q) => q.def.id === id);
    if (!r) throw new Error(`no road "${id}"`);
    return r;
  }

  /** Index of the sample of `road` nearest to a point. */
  nearestSample(road: Road, x: number, z: number): number {
    let best = 0, bd = Infinity;
    for (let i = 0; i < road.n; i++) {
      const d = (road.x[i] - x) ** 2 + (road.z[i] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  poseOn(road: Road, i: number, reverse = false, lane = 0): Pose {
    const h = Math.atan2(road.tx[i], road.tz[i]);
    return { x: road.x[i] + road.tz[i] * lane, z: road.z[i] - road.tx[i] * lane, heading: reverse ? h + Math.PI : h };
  }

  spawnPose(s: Spawn): Pose {
    const road = this.road(s.road);
    return this.poseOn(road, this.nearestSample(road, s.at[0], s.at[1]), s.reverse);
  }

  // ---- construction ----------------------------------------------------------------------

  static build(defs: RoadDef[] = ROADS): World {
    const w = new World();
    w.roads = defs.map((def, index) => layOut(def, index));
    w.indexRoads();
    for (const road of w.roads) w.profile(road);
    w.markJunctions();
    w.buildTerrain();
    w.plantTrees();
    return w;
  }

  private indexRoads() {
    const cell = (road: Road, i: number) =>
      Math.min(HASH_N - 1, Math.max(0, Math.floor((road.z[i] + WORLD_HALF) / HASH))) * HASH_N
      + Math.min(HASH_N - 1, Math.max(0, Math.floor((road.x[i] + WORLD_HALF) / HASH)));
    const count = new Int32Array(HASH_N * HASH_N + 1);
    let total = 0;
    for (const road of this.roads) {
      if (road.n > 0xffff) throw new Error(`${road.def.id}: too many samples for the road index`);
      for (let i = 0; i < road.n; i++) { count[cell(road, i) + 1]++; total++; }
    }
    for (let c = 0; c < HASH_N * HASH_N; c++) count[c + 1] += count[c];
    this.hashStart = count.slice();
    this.hashItems = new Int32Array(total);
    const fill = count.slice();
    for (const road of this.roads) for (let i = 0; i < road.n; i++) this.hashItems[fill[cell(road, i)]++] = (road.index << 16) | i;
  }

  /** Height profile: follow the land smoothly, take the height of any earlier road it meets. */
  private profile(road: Road) {
    const { n, step, closed, def } = road;
    const at = (a: Float64Array, i: number) => a[closed ? ((i % n) + n) % n : Math.min(n - 1, Math.max(0, i))];
    const box = (src: Float64Array, radius: number) => {
      const m = Math.max(1, Math.round(radius / step)), dst = new Float64Array(n);
      let acc = 0;
      for (let k = -m; k <= m; k++) acc += at(src, k);
      for (let i = 0; i < n; i++) { dst[i] = acc / (2 * m + 1); acc += at(src, i + m + 1) - at(src, i - m); }
      return dst;
    };
    let h = new Float64Array(n);
    // The mountain road was traced on the smooth shape of the massif; it cuts through the
    // ridges and gullies on top of that rather than riding over them.
    const land = def.kind === 'mountain' ? macroHeight : naturalHeight;
    for (let i = 0; i < n; i++) h[i] = Math.max(MIN_ROAD_Y, land(road.x[i], road.z[i]));
    // Tight bends follow the land closely (little cut and fill); straights and fast sweepers
    // average it over a long distance, because at 200 km/h a small hump is a launch ramp.
    const fast = new Float64Array(n), reach = Math.round(60 / step);
    for (let i = 0; i < n; i++) {
      let k = 0;
      for (let j = -reach; j <= reach; j += 4) k = Math.max(k, Math.abs(road.k[closed ? ((i + j) % n + n) % n : Math.min(n - 1, Math.max(0, i + j))]));
      fast[i] = 1 - smoothstep(1 / 600, 1 / 150, k);
    }
    const blendFast = box(fast, 50), wide = Math.max(def.smooth, 220);
    const tight = box(box(h, def.smooth / 2), def.smooth / 2), open = box(box(h, wide / 2), wide / 2);
    for (let i = 0; i < n; i++) h[i] = tight[i] + (open[i] - tight[i]) * blendFast[i];

    // Where an earlier road is close, ride on it.
    const pin = new Float64Array(n), hit = {} as RoadHit;
    for (let i = 0; i < n; i++) {
      if (!this.nearestRoad(road.x[i], road.z[i], 110, hit, null, road.index)) continue;
      const other = hit.road, near = other.def.halfWidth + def.halfWidth + 1;
      const p = 1 - smoothstep(near, near + 90, hit.dist);
      if (p <= 0) continue;
      pin[i] = p;
      h[i] += (other.y[hit.i] + other.grade[hit.i] * hit.along - h[i]) * p;
    }
    // Ease the free part into the pinned part, then hold the grade limit.
    for (let pass = 0; pass < 3; pass++) {
      const s = box(h, 28);
      for (let i = 0; i < n; i++) h[i] = s[i] + (h[i] - s[i]) * pin[i];
    }
    const lim = def.maxGrade * step;
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < n; i++) {
        const d = h[i] - h[i - 1];
        if (d > lim) h[i] -= (d - lim) * (1 - pin[i]); else if (d < -lim) h[i] += (-lim - d) * (1 - pin[i]);
      }
      for (let i = n - 2; i >= 0; i--) {
        const d = h[i] - h[i + 1];
        if (d > lim) h[i] -= (d - lim) * (1 - pin[i]); else if (d < -lim) h[i] += (-lim - d) * (1 - pin[i]);
      }
    }
    // Round off what the grade limit left behind: a kink in the grade is a ramp at speed.
    for (let pass = 0; pass < 2; pass++) {
      const s = box(h, 14);
      for (let i = 0; i < n; i++) h[i] = s[i] + (h[i] - s[i]) * pin[i];
    }
    for (const f of def.features ?? []) {
      if (f.type !== 'jump') continue;
      const c = this.nearestSample(road, f.at[0], f.at[1]);
      const reach = Math.ceil(JUMP_HALF / step) + 1;
      for (let k = -reach; k <= reach; k++) {
        const i = closed ? ((c + k) % n + n) % n : c + k;
        if (i >= 0 && i < n) h[i] += jumpHeight(k * step);
      }
    }
    for (let i = 0; i < n; i++) road.y[i] = h[i];
    for (let i = 0; i < n; i++) {
      const a = closed ? (i - 1 + n) % n : Math.max(0, i - 1), b = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
      road.grade[i] = (h[b] - h[a]) / ((b === a ? 1 : (b - a + n) % n) * step);
    }
  }

  private markJunctions() {
    const hit = {} as RoadHit;
    for (const road of this.roads) {
      for (let i = 0; i < road.n; i++) {
        for (const other of this.roads) {
          if (other === road) continue;
          if (this.nearestRoad(road.x[i], road.z[i], 14, hit, other) && hit.dist < road.def.halfWidth + other.def.halfWidth + 1.5) {
            road.junction[i] = 1;
            break;
          }
        }
      }
    }
  }

  private buildTerrain() {
    const N = GRID_N, h = this.height;
    for (let iz = 0; iz < N; iz++) {
      const z = iz * CELL - WORLD_HALF;
      for (let ix = 0; ix < N; ix++) h[iz * N + ix] = naturalHeight(ix * CELL - WORLD_HALF, z);
    }
    // Every road sample pulls the ground towards its own height; the nearest one dominates,
    // so where two roads pass close together the ground between them is a smooth compromise.
    const sumW = new Float32Array(N * N), sumWH = new Float32Array(N * N), env = new Float32Array(N * N);
    for (const road of this.roads) {
      const hw = road.def.halfWidth, flat = hw + FLAT, blend = road.def.blend;
      const reach = Math.max(flat + blend, hw + 42), cells = Math.ceil(reach / CELL);
      for (let i = 0; i < road.n; i++) {
        const rx = road.x[i], rz = road.z[i], target = road.y[i] - UNDER;
        const cx = Math.round((rx + WORLD_HALF) / CELL), cz = Math.round((rz + WORLD_HALF) / CELL);
        for (let iz = Math.max(0, cz - cells); iz <= Math.min(N - 1, cz + cells); iz++) {
          const dz = iz * CELL - WORLD_HALF - rz;
          for (let ix = Math.max(0, cx - cells); ix <= Math.min(N - 1, cx + cells); ix++) {
            const dx = ix * CELL - WORLD_HALF - rx, d2 = dx * dx + dz * dz;
            if (d2 > reach * reach) continue;
            const c = iz * N + ix, d = Math.sqrt(d2);
            const edge = Math.max(0, Math.min(250, Math.round(d - hw)));
            if (edge < this.roadDist[c]) this.roadDist[c] = edge;
            const e = 1 - smoothstep(flat, flat + blend, d);
            if (e <= 0) continue;
            const wgt = 1 / ((d2 + 0.5) * (d2 + 0.5));
            sumW[c] += wgt; sumWH[c] += wgt * target;
            if (e > env[c]) env[c] = e;
          }
        }
      }
    }
    for (let c = 0; c < N * N; c++) if (env[c] > 0) h[c] += (sumWH[c] / sumW[c] - h[c]) * env[c];
  }

  private plantTrees() {
    const biome: Biome = { mountain: 0, forest: 0 }, g = new Float32Array(3);
    const clear = (x: number, z: number, margin: number) => {
      const ix = Math.round((x + WORLD_HALF) / CELL), iz = Math.round((z + WORLD_HALF) / CELL);
      if (ix < 1 || iz < 1 || ix >= GRID_N - 1 || iz >= GRID_N - 1) return false;
      return this.roadDist[iz * GRID_N + ix] >= margin;
    };
    const add = (x: number, z: number, seed: number, kind: number) => {
      const y = this.heightAt(x, z);
      if (y < WATER_LEVEL + 1.2) return;
      g[0] = this.heightAt(x + 3, z) - this.heightAt(x - 3, z); g[1] = this.heightAt(x, z + 3) - this.heightAt(x, z - 3);
      if (Math.hypot(g[0], g[1]) / 6 > 0.55) return;
      const size = 0.7 + 0.6 * hash3(seed, 11, 5);
      this.trees.push({ x, z, y, r: 0.26 + 0.16 * size, height: (kind ? 8.5 : 11) * size, kind });
    };
    // Scatter: dense in the lakeside forest, clumps on the plains, sparse on the lower massif.
    const step = 16, half = WORLD_HALF - 40;
    for (let cz = -half; cz < half; cz += step) for (let cx = -half; cx < half; cx += step) {
      const ix = Math.round(cx / step), iz = Math.round(cz / step);
      biomeAt(cx, cz, biome);
      const clump = hash3(Math.floor(cx / 160), Math.floor(cz / 160), 3) > 0.78 ? 0.45 : 0.012;
      const p = Math.max(biome.forest * 0.85, clump * (1 - biome.mountain), biome.mountain * 0.07);
      if (hash3(ix, iz, 1) > p) continue;
      const x = cx + (hash3(ix, iz, 2) - 0.5) * step * 0.9, z = cz + (hash3(ix, iz, 4) - 0.5) * step * 0.9;
      if (!clear(x, z, 7)) continue;
      add(x, z, ix * 7919 + iz, biome.forest > 0.5 || biome.mountain > 0.3 ? 0 : 1);
    }
    // Rows beside the fast tarmac: something to rush past on the long straights.
    for (const road of this.roads) {
      if (road.def.kind !== 'main') continue;
      const every = Math.round(24 / road.step);
      for (let i = 0; i < road.n; i += every) {
        if (hash3(Math.floor((i * road.step) / 420), road.index, 9) < 0.45) continue;
        if (Math.abs(road.k[i]) > 1 / 240) continue;
        for (const side of [-1, 1]) {
          if (hash3(Math.floor((i * road.step) / 420), road.index, side + 20) < 0.3) continue;
          const off = side * (road.def.halfWidth + 8);
          const x = road.x[i] + road.tz[i] * off, z = road.z[i] - road.tx[i] * off;
          if (clear(x, z, 7)) add(x, z, i * 31 + side, 1);
        }
      }
    }
    const cell = (t: Tree) =>
      Math.min(TREE_HASH_N - 1, Math.max(0, Math.floor((t.z + WORLD_HALF) / TREE_HASH))) * TREE_HASH_N
      + Math.min(TREE_HASH_N - 1, Math.max(0, Math.floor((t.x + WORLD_HALF) / TREE_HASH)));
    const count = new Int32Array(TREE_HASH_N * TREE_HASH_N + 1);
    for (const t of this.trees) count[cell(t) + 1]++;
    for (let c = 0; c < TREE_HASH_N * TREE_HASH_N; c++) count[c + 1] += count[c];
    this.treeStart = count.slice();
    this.treeItems = new Int32Array(this.trees.length);
    const fill = count.slice();
    this.trees.forEach((t, i) => { this.treeItems[fill[cell(t)]++] = i; });
  }
}

function layOut(def: RoadDef, index: number): Road {
  const a = buildAlignment(def.pis, def.closed, 2, def.id);
  const n = a.samples.length;
  const road: Road = {
    def, index, n, step: a.step, length: a.length, closed: def.closed, bends: a.bends,
    x: new Float32Array(n), z: new Float32Array(n), tx: new Float32Array(n), tz: new Float32Array(n),
    k: new Float32Array(n), y: new Float32Array(n), grade: new Float32Array(n), junction: new Uint8Array(n),
  };
  a.samples.forEach((s, i) => {
    road.x[i] = s.x; road.z[i] = s.z; road.tx[i] = Math.sin(s.h); road.tz[i] = Math.cos(s.h); road.k[i] = s.k;
  });
  return road;
}

// ---- the jump --------------------------------------------------------------------------------
// Grade (rise per metre) along the crest, as [distance from the crest, grade] knots. It climbs at
// 5 %, turns over within 25 m (a 250 m vertical radius: the car leaves the road above ~180 km/h)
// and falls away at 5 % so the landing is onto a down-slope.
const JUMP: readonly (readonly [number, number])[] = [[-147.5, 0], [-72.5, 0.05], [-12.5, 0.05], [12.5, -0.05], [72.5, -0.05], [147.5, 0]];
export const JUMP_HALF = 147.5;
const jumpGrade = (u: number) => {
  for (let i = 1; i < JUMP.length; i++) {
    if (u <= JUMP[i][0]) { const [u0, g0] = JUMP[i - 1], [u1, g1] = JUMP[i]; return g0 + ((g1 - g0) * (u - u0)) / (u1 - u0); }
  }
  return 0;
};
export function jumpHeight(u: number): number {
  if (u <= -JUMP_HALF || u >= JUMP_HALF) return 0;
  let h = 0;
  const n = Math.ceil((u + JUMP_HALF) / 0.5), e = (u + JUMP_HALF) / n;
  for (let i = 0; i < n; i++) h += jumpGrade(-JUMP_HALF + (i + 0.5) * e) * e;
  return h;
}
