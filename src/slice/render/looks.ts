import * as THREE from 'three';

/**
 * An art direction for the slice, as data: palette, light, sky, tree shapes, ground treatment
 * and finishing pass. The same map, car and camera are drawn through whichever look is chosen
 * (`?look=`), so candidates can be compared on the same stretch of road.
 *
 * Everything a look uses is generated in code. Nothing here is final: these are studies for
 * Patrick to choose between, mix, or reject.
 */
export interface Look {
  id: string;
  name: string;
  /** Lambert = soft continuous shading; toon = light in hard steps. */
  shading: 'lambert' | 'toon';
  light: {
    /** Direction the sunlight travels. */
    dir: [number, number, number];
    sun: string; sunPower: number;
    /** Fill light from above and below: together these are the colour of the shadows. */
    sky: string; ground: string; fill: number;
  };
  sky: {
    zenith: string; horizon: string; glow: string; glowAmount: number;
    /** How quickly the horizon colour gives way to the zenith colour (lower = sooner). */
    curve: number;
    /** Cloud cover 0..1, edge softness, 1 = long horizontal bars instead of puffs, and how ragged the outline is (0 = round puffs). */
    cloud: number; cloudSoft: number; cloudBars: number; cloudDetail: number;
    cloudLight: string; cloudShade: string;
  };
  /** `bands` > 0 quantises the haze so far hills separate into flat layers. */
  fog: { color: string; near: number; far: number; bands: number };
  ground: {
    meadow: string;
    /** Five crop colours for the field parcels on the plains. */
    fields: [string, string, string, string, string];
    hedge: string;
    forest: string; hillGrass: string; rock: string; high: string; sand: string; earth: string;
    /** 0..1: how strongly the plains are divided into parcels, and how visible crop rows are. */
    parcels: number; rows: number;
    /** 0..1: broad painted washes and brush-edge breakup of the ground colour. */
    wash: number;
    /** Graybox measuring grid. */
    grid: number;
  };
  road: { tarmac: string; mountain: string; gravel: string; shoulder: string; line: string };
  trees: {
    style: 'cone' | 'tiered' | 'soft' | 'simple';
    /** Faceted (per-face light) or smooth crowns. */
    faceted: boolean;
    conifer: string[]; broadleaf: string[];
    /** Occasional odd-coloured tree, and how often (0..1). */
    accent: string[]; accentShare: number;
    trunk: string; trunkBroadleaf: string;
    shadow: string; shadowOpacity: number;
  };
  /** Roadside growth and stones; null in the graybox. */
  verge: { grass: string[]; bush: string[]; rock: string } | null;
  water: string;
  post: { saturation: number; contrast: number; tint: string; vignette: number; grain: number; posterize: number } | null;
}

const GRAYBOX: Look = {
  id: 'graybox', name: 'Graybox', shading: 'lambert',
  light: { dir: [-0.52, -0.62, 0.59], sun: '#fff3de', sunPower: 2.5, sky: '#e2ecf5', ground: '#b7b0a0', fill: 1.25 },
  sky: { zenith: '#9fbfd8', horizon: '#dfe6ea', glow: '#fff0cc', glowAmount: 0.22, curve: 0.55, cloud: 0, cloudSoft: 0.1, cloudBars: 0, cloudDetail: 1, cloudLight: '#ffffff', cloudShade: '#dde4ea' },
  fog: { color: '#dfe6ea', near: 700, far: 6800, bands: 0 },
  ground: {
    meadow: '#cdd0b9', fields: ['#cdd0b9', '#dcd4a6', '#b4c4a2', '#cdd0b9', '#dcd4a6'], hedge: '#a8b79c',
    forest: '#a8b79c', hillGrass: '#b9b2a8', rock: '#b9b2a8', high: '#d6d1cb', sand: '#dcd6c0', earth: '#c4b9a2',
    parcels: 0, rows: 0, wash: 0, grid: 1,
  },
  road: { tarmac: '#4b4e57', mountain: '#555861', gravel: '#b7a482', shoulder: '#bdb19a', line: '#ecebe2' },
  trees: {
    style: 'cone', faceted: true, conifer: ['#6f8c79'], broadleaf: ['#9db389'], accent: [], accentShare: 0,
    trunk: '#7a6a5b', trunkBroadleaf: '#7a6a5b', shadow: '#3a4558', shadowOpacity: 0.3,
  },
  verge: null,
  water: '#9fc0cf',
  post: null,
};

/**
 * A · Flat: bright midday, saturated colour blocks, faceted trees, violet shadows.
 * A toy landscape: every object is one or two flat colours and reads at a glance.
 */
const FLAT: Look = {
  id: 'flat', name: 'A · Flat', shading: 'lambert',
  light: { dir: [-0.5, -0.66, 0.56], sun: '#fff2d6', sunPower: 2.7, sky: '#cfe0ff', ground: '#b3a2d0', fill: 1.5 },
  sky: { zenith: '#3f90dc', horizon: '#c6e9f4', glow: '#fff3c9', glowAmount: 0.3, curve: 0.5, cloud: 0.37, cloudSoft: 0.02, cloudBars: 0, cloudDetail: 0.42, cloudLight: '#ffffff', cloudShade: '#cfe0f4' },
  fog: { color: '#c6e9f4', near: 900, far: 7200, bands: 0 },
  ground: {
    meadow: '#9fd45c', fields: ['#f0cf58', '#8fd05a', '#62ba50', '#f5e296', '#e0ad6a'], hedge: '#3f9a4c',
    forest: '#55a551', hillGrass: '#a9cf68', rock: '#c2ad94', high: '#e4d9c6', sand: '#f3e3ad', earth: '#e0bd8a',
    parcels: 1, rows: 0.55, wash: 0.12, grid: 0,
  },
  road: { tarmac: '#474b5e', mountain: '#50546a', gravel: '#e6bd7c', shoulder: '#e2c594', line: '#fff8e4' },
  trees: {
    style: 'tiered', faceted: true, conifer: ['#2f9461', '#3aa56b', '#27855a'], broadleaf: ['#66c653', '#86d45a', '#52b84f'],
    accent: ['#f39a3b', '#f4cf4a', '#e96b4f'], accentShare: 0.09,
    trunk: '#7d5237', trunkBroadleaf: '#8a5c3d', shadow: '#4b3f8f', shadowOpacity: 0.34,
  },
  verge: { grass: ['#8fcf58', '#aede62', '#7cc452'], bush: ['#4fae4f', '#6cc154', '#3f9a4c'], rock: '#cbb9a2' },
  water: '#46b4e8',
  post: { saturation: 1.1, contrast: 1.04, tint: '#ffffff', vignette: 0.22, grain: 0, posterize: 0 },
};

/**
 * B · Gouache: soft afternoon, muted pigments, painted washes on the ground, round crowns on
 * pale trunks, warm haze. It continues the ground treatment Patrick approved in the diorama.
 */
const GOUACHE: Look = {
  id: 'gouache', name: 'B · Gouache', shading: 'lambert',
  light: { dir: [-0.56, -0.56, 0.61], sun: '#ffe6bd', sunPower: 2.5, sky: '#dfe8f0', ground: '#cdb794', fill: 1.35 },
  sky: { zenith: '#6fabd0', horizon: '#f6ecd4', glow: '#fff0cf', glowAmount: 0.3, curve: 0.3, cloud: 0.38, cloudSoft: 0.12, cloudBars: 0, cloudDetail: 0.55, cloudLight: '#fffaee', cloudShade: '#ebe4d6' },
  fog: { color: '#f1e8d2', near: 800, far: 6400, bands: 0 },
  ground: {
    meadow: '#bccf7f', fields: ['#e6cf7e', '#b3cb78', '#96b870', '#eee0a2', '#d6ae7c'], hedge: '#7f9f66',
    forest: '#86a86c', hillGrass: '#c0c984', rock: '#cdb896', high: '#e2d6c0', sand: '#ecdfbc', earth: '#dcc294',
    parcels: 0.75, rows: 0, wash: 1, grid: 0,
  },
  road: { tarmac: '#605f69', mountain: '#696771', gravel: '#d6b784', shoulder: '#dcc59a', line: '#f6efdc' },
  trees: {
    style: 'soft', faceted: false, conifer: ['#5b9279', '#6aa07e', '#4f8773'], broadleaf: ['#8fb56c', '#a5c074', '#7fa868'],
    accent: ['#dcc068', '#cf8f62'], accentShare: 0.08,
    trunk: '#8f7a66', trunkBroadleaf: '#e3dccb', shadow: '#5c6a86', shadowOpacity: 0.26,
  },
  verge: { grass: ['#b4c97a', '#c9d488', '#a3bf72'], bush: ['#86ad6c', '#a2bd74', '#7a9f68'], rock: '#cfc0a6' },
  water: '#8fc3d0',
  post: { saturation: 1.1, contrast: 1.04, tint: '#fffaf0', vignette: 0.24, grain: 0.022, posterize: 0 },
};

/**
 * C · Print: low golden sun, five or six inks, light in hard steps, haze in flat layers so
 * the hills stack like a travel poster. The most graphic of the three.
 */
const PRINT: Look = {
  id: 'print', name: 'C · Print', shading: 'toon',
  light: { dir: [-0.78, -0.33, 0.53], sun: '#ffd9a0', sunPower: 2.7, sky: '#bfd6d6', ground: '#6f7f9a', fill: 1.05 },
  sky: { zenith: '#4a90a6', horizon: '#fbe2b4', glow: '#ffe9b4', glowAmount: 0.55, curve: 0.5, cloud: 0.36, cloudSoft: 0.015, cloudBars: 1, cloudDetail: 0.2, cloudLight: '#fff3d6', cloudShade: '#f6cf9a' },
  fog: { color: '#f9dcb0', near: 500, far: 5400, bands: 6 },
  ground: {
    meadow: '#d8c070', fields: ['#ecd27a', '#c6ae5c', '#86a56c', '#f3e2a0', '#c08a58'], hedge: '#3f6f66',
    forest: '#5f9072', hillGrass: '#b9b468', rock: '#b9825e', high: '#e6c79a', sand: '#f1deaa', earth: '#dcb478',
    parcels: 0.85, rows: 0.35, wash: 0, grid: 0,
  },
  road: { tarmac: '#33454f', mountain: '#3a4c56', gravel: '#d9a968', shoulder: '#d7b077', line: '#fff0cc' },
  trees: {
    style: 'simple', faceted: false, conifer: ['#2c5f5c', '#356b62', '#27534f'], broadleaf: ['#3f7a68', '#4d8a6c', '#356a5e'],
    accent: ['#c8643c', '#e0a13f'], accentShare: 0.1,
    trunk: '#3b3a3f', trunkBroadleaf: '#4a403c', shadow: '#2a4a5a', shadowOpacity: 0.42,
  },
  verge: { grass: ['#cdb866', '#e9d27c', '#a8ae68'], bush: ['#3f7a68', '#356a5e', '#4d8a6c'], rock: '#b9825e' },
  water: '#5aa7a8',
  post: { saturation: 1.05, contrast: 1.06, tint: '#fff7ea', vignette: 0.3, grain: 0.03, posterize: 0 },
};

export const LOOKS: Look[] = [GRAYBOX, FLAT, GOUACHE, PRINT];
export const lookById = (id: string | null): Look => LOOKS.find((l) => l.id === id) ?? GRAYBOX;

export const sunDirection = (look: Look) => new THREE.Vector3(...look.light.dir).normalize();

let gradient: THREE.DataTexture | undefined;
/** Surface material in the look's shading model. */
export function surfaceMaterial(look: Look, params: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial | THREE.MeshToonMaterial {
  if (look.shading !== 'toon') return new THREE.MeshLambertMaterial(params);
  if (!gradient) {
    // Three flat tones: shade, half-light, light.
    gradient = new THREE.DataTexture(new Uint8Array([120, 120, 196, 255]), 4, 1, THREE.RedFormat);
    gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
  }
  const { flatShading: _flat, ...rest } = params;
  return new THREE.MeshToonMaterial({ ...rest, gradientMap: gradient } as THREE.MeshToonMaterialParameters);
}

/** With `bands`, haze thickens in steps: distant ground separates into flat layers. */
export function applyFogBands(look: Look) {
  if (!look.fog.bands) return;
  const n = look.fog.bands.toFixed(1);
  const chunk = THREE.ShaderChunk.fog_fragment;
  const patched = chunk.replace('gl_FragColor.rgb = mix(', `fogFactor = mix(fogFactor, floor(fogFactor * ${n} + 0.5) / ${n}, 0.8);\n\tgl_FragColor.rgb = mix(`);
  if (patched === chunk) console.warn('[slice] fog bands not applied (three.js fog chunk changed)');
  THREE.ShaderChunk.fog_fragment = patched;
}
