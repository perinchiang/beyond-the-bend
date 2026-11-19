import { fbm2, noise2, smoothstep } from '../../core/noise';

/** The slice is a 5.1 km square: X east, Z south, metres. */
export const WORLD_HALF = 2560;
/** Height of the lake surface. */
export const WATER_LEVEL = 0;

/** The massif in the north-east: a broad cone the mountain road winds round. */
export const MOUNTAIN = { x: 1850, z: -1850, height: 250, sigma: 520 };
/** The lake in the west that the gravel road skirts. */
export const LAKE = { x: -1450, z: -250, depth: 42, sigma: 380 };

const SEED = 417;

const mountainAt = (x: number, z: number) => {
  const r2 = (x - MOUNTAIN.x) ** 2 + (z - MOUNTAIN.z) ** 2;
  return Math.exp(-r2 / (MOUNTAIN.sigma * MOUNTAIN.sigma));
};

/**
 * Large-scale shape only: rolling plains, the massif, the lake basin and the hills that close
 * the horizon at the edge of the map. Roads are laid out against this, so it has no fine noise.
 */
export function macroHeight(x: number, z: number): number {
  const plains = 13 * fbm2(x / 1000 + 7.3, z / 1000 - 2.1, 3, SEED, 0.5);
  const lakeR2 = (x - LAKE.x) ** 2 + (z - LAKE.z) ** 2;
  const lake = LAKE.depth * Math.exp(-lakeR2 / (2 * LAKE.sigma * LAKE.sigma));
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const rim = smoothstep(2330, 2560, edge);
  const border = rim * rim * (150 + 70 * noise2(x / 420 + 1.7, z / 420 + 9.2, SEED + 3));
  // Flatten the plains noise towards the lake so the shore is a clean line.
  const calm = 1 - 0.75 * Math.exp(-lakeR2 / (2 * (LAKE.sigma * 1.5) ** 2));
  return 26 + plains * calm + MOUNTAIN.height * mountainAt(x, z) - lake + border;
}

/** Ground as it would be without any road: the macro shape plus smaller undulation. */
export function naturalHeight(x: number, z: number): number {
  const m = mountainAt(x, z);
  const mid = 2.2 * noise2(x / 240 - 3.3, z / 240 + 5.6, SEED + 5);
  const fine = 0.5 * noise2(x / 62 + 8.1, z / 62 - 1.4, SEED + 9);
  // Ridges and gullies on the massif, fading out towards its foot and its smooth summit.
  const ridged = 1 - Math.abs(noise2(x / 170 + 2.2, z / 170 - 7.7, SEED + 13));
  const rock = 4 * m * (1 - m) * 18 * (ridged - 0.55);
  return macroHeight(x, z) + mid + fine + rock;
}

export interface Biome {
  /** 0 on the plains .. 1 on the massif. */
  mountain: number;
  /** 0 .. 1 in the lakeside forest. */
  forest: number;
}

/** Where the three test regions are. Used for graybox tint and tree density only. */
export function biomeAt(x: number, z: number, out: Biome): Biome {
  out.mountain = smoothstep(0.06, 0.3, mountainAt(x, z));
  // Forest: a broad band round the lake and along the gravel road east of it.
  const band = Math.exp(-(((x + 1150) / 1150) ** 2) - ((z - 120) / 620) ** 2);
  const patch = 0.5 + 0.5 * noise2(x / 380 + 4.4, z / 380 + 0.9, SEED + 21);
  out.forest = smoothstep(0.35, 0.6, band * (0.75 + 0.5 * patch)) * (1 - out.mountain);
  return out;
}
