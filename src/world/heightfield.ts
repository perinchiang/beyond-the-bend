import { bridgeSurface, brookBed } from './millBrook';
import * as THREE from 'three';
import { fbm2, noise2, smoothstep, mix } from '../core/noise';
import { extraWidth, ROAD_HALF_WIDTH, Track } from './track';

export const WORLD_HALF = 200; // terrain spans [-200, 200] m on X and Z
export const PLAY_HALF = 176; // scatter / driving limit before the paper dissolve

const FIELD_RES = 0.8; // metres per cell of the road distance field
const FIELD_N = Math.round((WORLD_HALF * 2) / FIELD_RES);
const FIELD_MAX = 40; // distances are clamped to this
const VERGE = 2.2; // flat shoulder beside the asphalt (m)
const BLEND = 22; // spread road cut/fill into a broad, shallow transition (m)
const SEED = 91;

/** Natural rolling hills before the road is cut in. */
export function naturalHeight(x: number, z: number): number {
  const broad = fbm2(x / 165 + 3.1, z / 165 - 1.7, 3, SEED, 0.45);
  const mid = noise2(x / 52 + 11.3, z / 52 + 4.9, SEED + 5);
  const fine = noise2(x / 19 - 6.2, z / 19 + 8.4, SEED + 9);
  // One authored landmark: a broad rise inside the southern loop, and a dip to its west.
  const hill = Math.exp(-((x - 30) ** 2 + (z - 36) ** 2) / (2 * 46 * 46));
  const dip = Math.exp(-((x + 60) ** 2 + (z - 40) ** 2) / (2 * 38 * 38));
  return broad * 9.5 + mid * 1.7 + fine * 0.35 + hill * 5.5 - dip * 3.0;
}

export interface HeightField {
  /** Final terrain surface height (road corridor cut in). */
  height(x: number, z: number): number;
  /** Height a wheel should rest on: road surface on asphalt, terrain elsewhere. */
  surface(x: number, z: number): number;
  /** Distance to the road centre line, clamped to FIELD_MAX. */
  roadDist(x: number, z: number): number;
  /** Painted bare-earth width beyond the asphalt, also used for planting. */
  vergeWidth(x: number, z: number): number;
  normal(x: number, z: number, out: THREE.Vector3): THREE.Vector3;
  /** Road distance as a filterable texture for the terrain shader. */
  sdfTexture: THREE.DataTexture;
  fieldMax: number;
}

export function buildHeightField(track: Track, foothills = false): HeightField {
  const countryside = foothills
    ? (x: number, z: number) => naturalHeight(x, z) +
      18 * Math.exp(-(((x - 131) / 44) ** 2 + ((z + 91) / 32) ** 2))
    : (x: number, z: number) => naturalHeight(x, z) + (track.region === 'snow'
      ? 28 * Math.exp(-((x / 105) ** 2 + ((z + 28) / 64) ** 2))
      : track.region === 'volcano' ? 22 * Math.exp(-(((x - 1) / 48) ** 2 + (z / 55) ** 2)) : 0);
  const yardLevel = countryside(-44,1);
  const land = track.cedar ? (x:number,z:number) => {
    const pad = ((x+44)/13)**2 + ((z-1)/12)**2;
    return mix(yardLevel, countryside(x,z), smoothstep(0.58,1.8,pad));
  } : countryside;
  const { samples } = track;
  const n = samples.length;

  // Road profile: follow the natural hills with one short low-pass pass, removing
  // spline-scale grade changes without cutting long flat ramps into the terrain.
  let prof = samples.map((s) => land(s.x, s.z));
  // The former three 22 m passes over-smoothed the profile: it followed the hills from
  // far away, creating cut slopes that read as a continuous trench. A single, narrower
  // pass preserves broad grades while filtering spline-scale bumps.
  const win = Math.round(18 / (track.length / n));
  for (let pass = 0; pass < 1; pass++) {
    const next = new Array<number>(n);
    let acc = 0;
    for (let k = -win; k <= win; k++) acc += prof[(k + n) % n];
    for (let i = 0; i < n; i++) {
      next[i] = acc / (2 * win + 1);
      acc += prof[(i + win + 1) % n] - prof[(i - win + n) % n];
    }
    prof = next;
  }
  samples.forEach((s, i) => (s.y = prof[i] + 0.05));

  // Stamp nearest-centre-line distance and road height into a grid.
  const dist = new Float32Array(FIELD_N * FIELD_N).fill(FIELD_MAX);
  const width = new Float32Array(dist.length);
  const rh = new Float32Array(FIELD_N * FIELD_N);
  const R = Math.ceil(FIELD_MAX / FIELD_RES);
  for (const s of samples) {
    // The inside shoulder opens into a cut patch; the opposite bank grows
    // close to the asphalt. A slow wash breaks up equally curved stretches.
    const stretch = 1 + extraWidth(track, s.s) / ROAD_HALF_WIDTH;
    const wash = noise2(s.x / 31, s.z / 31, 406);
    const bend = Math.max(-1, Math.min(1, s.k * 28));
    const shoulder = (side: number) => Math.max(0.38, 0.85 + wash * 0.60
      + Math.max(0, side * bend) * 1.95 - Math.max(0, -side * bend) * 0.60);
    const leftWidth = shoulder(-1), rightWidth = shoulder(1);
    const cx = Math.floor((s.x + WORLD_HALF) / FIELD_RES), cz = Math.floor((s.z + WORLD_HALF) / FIELD_RES);
    const x0 = Math.max(0, cx - R), x1 = Math.min(FIELD_N - 1, cx + R);
    const z0 = Math.max(0, cz - R), z1 = Math.min(FIELD_N - 1, cz + R);
    for (let iz = z0; iz <= z1; iz++) {
      const wz = (iz + 0.5) * FIELD_RES - WORLD_HALF - s.z;
      for (let ix = x0; ix <= x1; ix++) {
        const wx = (ix + 0.5) * FIELD_RES - WORLD_HALF - s.x;
        const d = Math.sqrt(wx * wx + wz * wz) / stretch;
        const idx = iz * FIELD_N + ix;
        if (d < dist[idx]) {
          dist[idx] = d;
          rh[idx] = s.y;
          width[idx] = -s.tz * wx + s.tx * wz > 0 ? rightWidth : leftWidth;
        }
      }
    }
  }

  const sample = (arr: Float32Array, x: number, z: number): number => {
    const fx = Math.min(FIELD_N - 1.001, Math.max(0, (x + WORLD_HALF) / FIELD_RES - 0.5));
    const fz = Math.min(FIELD_N - 1.001, Math.max(0, (z + WORLD_HALF) / FIELD_RES - 0.5));
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const i = iz * FIELD_N + ix;
    return mix(mix(arr[i], arr[i + 1], tx), mix(arr[i + FIELD_N], arr[i + FIELD_N + 1], tx), tz);
  };

  // Both dirt roads feed planting and tyre grip. The sawmill road also cuts a
  // shallow bench across the hillside. Asphalt has priority at both junctions.
  const roads = track.lane ? dist.slice() : dist;
  const forestDist = track.cedar ? new Float32Array(dist.length).fill(FIELD_MAX) : undefined;
  const dirtDist = track.lane ? new Float32Array(dist.length).fill(FIELD_MAX) : undefined;
  const forestHeight = track.cedar ? new Float32Array(dist.length) : undefined;
  for (const lane of [track.lane, track.cedar]) for (const p of lane?.points ?? []) {
    const forest = lane === track.cedar;
    const level = forest ? land(p.x,p.z) : 0;
    const cx = Math.floor((p.x + WORLD_HALF) / FIELD_RES), cz = Math.floor((p.z + WORLD_HALF) / FIELD_RES);
    for (let iz = Math.max(0, cz - R); iz <= Math.min(FIELD_N - 1, cz + R); iz++) {
      for (let ix = Math.max(0, cx - R); ix <= Math.min(FIELD_N - 1, cx + R); ix++) {
        const d = Math.hypot((ix + 0.5) * FIELD_RES - WORLD_HALF - p.x,
          (iz + 0.5) * FIELD_RES - WORLD_HALF - p.z) + 0.45;
        const i = iz * FIELD_N + ix;
        if (dirtDist && d < dirtDist[i]) dirtDist[i] = d;
        if (forest && forestDist && forestHeight && d < forestDist[i]) {
          forestDist[i] = d;
          forestHeight[i] = level;
        }
        if (d < roads[i]) { roads[i] = d; width[i] = 0.28; }
      }
    }
  }
  const roadDist = (x: number, z: number) => sample(roads, x, z);

  const gradedHeight = (x: number, z: number): number => {
    let nat = land(x, z);
    if (forestDist && forestHeight) {
      const bank = sample(forestDist,x,z);
      if (bank < 11) nat = mix(sample(forestHeight,x,z), nat, smoothstep(2.9,11,bank));
    }
    const d = sample(dist, x, z);
    if (d >= ROAD_HALF_WIDTH + VERGE + BLEND) return nat;
    const w = 1 - smoothstep(ROAD_HALF_WIDTH + VERGE, ROAD_HALF_WIDTH + VERGE + BLEND, d);
    // Keep the terrain slightly below the asphalt so the two surfaces never z-fight.
    return mix(nat, sample(rh, x, z) - 0.09, w);
  };

  const deckLevel = gradedHeight(2.67,-57.24) + 0.045;
  const height = track.cedar ? (x:number,z:number) => brookBed(x,z,gradedHeight(x,z)) : gradedHeight;
  const surface = (x: number, z: number): number => {
    if (track.cedar && bridgeSurface(x,z)) return Math.max(deckLevel, height(x,z));
    const d = sample(dist, x, z);
    const h = height(x, z);
    if (d > ROAD_HALF_WIDTH + 1.2) return h;
    const w = 1 - smoothstep(ROAD_HALF_WIDTH + 0.4, ROAD_HALF_WIDTH + 1.2, d);
    return mix(h, sample(rh, x, z), w);
  };

  const normal = (x: number, z: number, out: THREE.Vector3): THREE.Vector3 => {
    const e = 0.9;
    return out.set(height(x - e, z) - height(x + e, z), 2 * e, height(x, z - e) - height(x, z + e)).normalize();
  };

  const channels = forestDist ? 4 : 2;
  const half = new Uint16Array(dist.length * channels);
  for (let i = 0; i < dist.length; i++) {
    half[channels * i] = THREE.DataUtils.toHalfFloat(roads[i]);
    half[channels * i + 1] = THREE.DataUtils.toHalfFloat(width[i]);
    if (dirtDist && forestDist) half[channels * i + 2] = THREE.DataUtils.toHalfFloat(dirtDist[i]);
  }
  const sdfTexture = new THREE.DataTexture(half, FIELD_N, FIELD_N, forestDist ? THREE.RGBAFormat : THREE.RGFormat, THREE.HalfFloatType);
  sdfTexture.minFilter = sdfTexture.magFilter = THREE.LinearFilter;
  sdfTexture.wrapS = sdfTexture.wrapT = THREE.ClampToEdgeWrapping;
  sdfTexture.needsUpdate = true;

  return { height, surface, roadDist, vergeWidth: (x, z) => sample(width, x, z), normal, sdfTexture, fieldMax: FIELD_MAX };
}
