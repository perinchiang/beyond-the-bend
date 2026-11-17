/**
 * Gradient noise helpers.
 *  - `noise2` / `fbm2`: non-periodic, used for terrain height and placement masks.
 *  - `pnoise2` / `pfbm2`: periodic, used to bake tileable paint textures.
 */

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}

const G = new Float32Array(32);
for (let i = 0; i < 16; i++) {
  const a = (i / 16) * Math.PI * 2;
  G[i * 2] = Math.cos(a);
  G[i * 2 + 1] = Math.sin(a);
}

function grad(ix: number, iy: number, seed: number, dx: number, dy: number): number {
  const g = (hash2(ix, iy, seed) & 15) * 2;
  return G[g] * dx + G[g + 1] * dy;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Perlin gradient noise, roughly in [-1, 1]. */
export function noise2(x: number, y: number, seed = 0): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const u = fade(fx), v = fade(fy);
  const a = grad(x0, y0, seed, fx, fy);
  const b = grad(x0 + 1, y0, seed, fx - 1, fy);
  const c = grad(x0, y0 + 1, seed, fx, fy - 1);
  const d = grad(x0 + 1, y0 + 1, seed, fx - 1, fy - 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v) * 1.42;
}

export function fbm2(x: number, y: number, octaves: number, seed = 0, gain = 0.5, lac = 2.03): number {
  let amp = 1, sum = 0, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise2(x * f, y * f, seed + o * 17);
    norm += amp;
    amp *= gain;
    f *= lac;
  }
  return sum / norm;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Periodic Perlin noise: tiles with period (px, py) in lattice units. */
export function pnoise2(x: number, y: number, px: number, py: number, seed = 0): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const u = fade(fx), v = fade(fy);
  const xa = mod(x0, px), xb = mod(x0 + 1, px), ya = mod(y0, py), yb = mod(y0 + 1, py);
  const a = grad(xa, ya, seed, fx, fy);
  const b = grad(xb, ya, seed, fx - 1, fy);
  const c = grad(xa, yb, seed, fx, fy - 1);
  const d = grad(xb, yb, seed, fx - 1, fy - 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v) * 1.42;
}

/** Periodic fBm over the unit square; `fx`/`fy` are base lattice frequencies (integers). */
export function pfbm2(u: number, v: number, fx: number, fy: number, octaves: number, seed = 0, gain = 0.5): number {
  let amp = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * pnoise2(u * fx, v * fy, fx, fy, seed + o * 31);
    norm += amp;
    amp *= gain;
    fx *= 2;
    fy *= 2;
  }
  return sum / norm;
}

export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const saturate = (x: number) => clamp(x, 0, 1);
export const mix = lerp;
export function smoothstep(a: number, b: number, x: number): number {
  const t = saturate((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
