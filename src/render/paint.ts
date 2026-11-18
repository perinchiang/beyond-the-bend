import * as THREE from 'three';
import { pfbm2 } from '../core/noise';
import { Rng } from '../core/rng';

/**
 * "Painted Diorama" material system.
 *
 * Everything painterly is driven by two small tileable textures that are baked once at
 * start-up and sampled in WORLD space with mip-mapping + anisotropy. Because the patterns
 * are anchored to the ground (not the screen) and are band-limited by the mip chain, they
 * do not swim or shimmer when the camera moves or zooms.
 */

/** Palette — authored in sRGB, converted to linear by THREE.Color. */
export const PAL = {
  paper: '#f4eddd',
  grassLight: '#c0cf73',
  grassMid: '#94b659',
  grassDeep: '#619360',
  grassCool: '#498e7d',
  grassDry: '#e8c26a',
  dirt: '#cbb994',
  dirtDark: '#ad9c7c',
  asphalt: '#655f6b',
  asphaltLight: '#77727c',
  asphaltDark: '#4b4856',
  line: '#f1ead9',
  lineCentre: '#ecc057',
  sun: '#fff0cd',
  sky: '#b1cce2',
  bounce: '#abb598',
  haze: '#e3e2ca',
};

const col = (hex: string) => new THREE.Color(hex);

function bakeNoiseTexture(size: number): THREE.DataTexture {
  // R, G: broad fBm (two seeds) · B: fine fBm · A: anisotropic "dry brush" streaks.
  // Stored as 16-bit float with a hand-built mip chain: the terrain shader pushes these values
  // through tight thresholds, and 8-bit steps would show up as contour-line banding.
  const ch = [new Float32Array(size * size), new Float32Array(size * size), new Float32Array(size * size), new Float32Array(size * size)];
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size, i = y * size + x;
      ch[0][i] = pfbm2(u, v, 5, 5, 5, 11, 0.5);
      ch[1][i] = pfbm2(u, v, 5, 5, 5, 47, 0.5);
      ch[2][i] = pfbm2(u, v, 22, 22, 4, 83, 0.55);
      ch[3][i] = pfbm2(u, v, 5, 40, 4, 131, 0.55);
    }
  }
  let cur = new Float32Array(size * size * 4);
  for (let c = 0; c < 4; c++) {
    // Normalise each channel to mean 0.5 / std 0.2 so shader thresholds are predictable.
    let mean = 0, dev = 0;
    for (const f of ch[c]) mean += f;
    mean /= ch[c].length;
    for (const f of ch[c]) dev += (f - mean) * (f - mean);
    dev = Math.sqrt(dev / ch[c].length);
    for (let i = 0; i < ch[c].length; i++) cur[i * 4 + c] = Math.max(0, Math.min(1, 0.5 + ((ch[c][i] - mean) / dev) * 0.2));
  }
  const mipmaps: { data: Uint16Array; width: number; height: number }[] = [];
  for (let w = size; ; w >>= 1) {
    const half = new Uint16Array(cur.length);
    for (let i = 0; i < cur.length; i++) half[i] = THREE.DataUtils.toHalfFloat(cur[i]);
    mipmaps.push({ data: half, width: w, height: w });
    if (w === 1) break;
    const nw = w >> 1, next = new Float32Array(nw * nw * 4);
    for (let y = 0; y < nw; y++) for (let x = 0; x < nw; x++) for (let c = 0; c < 4; c++) {
      const i = (y * 2 * w + x * 2) * 4 + c;
      next[(y * nw + x) * 4 + c] = (cur[i] + cur[i + 4] + cur[i + w * 4] + cur[i + w * 4 + 4]) * 0.25;
    }
    cur = next;
  }
  const tex = new THREE.DataTexture(mipmaps[0].data, size, size, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mipmaps = mipmaps as unknown as THREE.DataTexture['mipmaps'];
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function bakeStrokeTexture(size: number): THREE.CanvasTexture {
  // R: dark grass ticks · G: light grass ticks · B: soft gouache dabs.
  // Drawn with Canvas2D so the marks have tapered, hand-made shapes; wrapped so it tiles.
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'lighter';
  const rng = new Rng(2024);
  const wrapped = (x: number, y: number, r: number, draw: (ox: number, oy: number) => void) => {
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const px = x + ox * size, py = y + oy * size;
      if (px < -r || px > size + r || py < -r || py > size + r) continue;
      draw(ox * size, oy * size);
    }
  };
  const k = size / 1024;

  // Blue: overlapping soft-edged dabs of varying density — the "layered gouache" body.
  for (let i = 0; i < 520; i++) {
    const x = rng.next() * size, y = rng.next() * size;
    const r = rng.range(26, 92) * k, a = rng.range(0.05, 0.16);
    const ang = rng.range(0, Math.PI), sq = rng.range(0.45, 0.9);
    wrapped(x, y, r * 1.5, (ox, oy) => {
      g.save();
      g.translate(x + ox, y + oy);
      g.rotate(ang);
      g.scale(1, sq);
      const grd = g.createRadialGradient(0, 0, r * 0.55, 0, 0, r);
      grd.addColorStop(0, `rgba(0,0,255,${a})`);
      grd.addColorStop(1, 'rgba(0,0,255,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.fill();
      g.restore();
    });
  }

  // Red / green: short tapered, slightly curved ticks, loosely following a flow direction.
  const tick = (channel: 'r' | 'g', count: number) => {
    for (let i = 0; i < count; i++) {
      const x = rng.next() * size, y = rng.next() * size;
      const flow = Math.sin(x / size * Math.PI * 2) * 0.5 + Math.cos(y / size * Math.PI * 4) * 0.4;
      const ang = -0.9 + flow + rng.gauss() * 0.55;
      const len = rng.range(18, 52) * k, wid = rng.range(2.8, 6.0) * k, bend = rng.range(-0.34, 0.34) * len;
      const a = rng.range(0.45, 1.0);
      wrapped(x, y, len, (ox, oy) => {
        g.save();
        g.translate(x + ox, y + oy);
        g.rotate(ang);
        g.fillStyle = channel === 'r' ? `rgba(255,0,0,${a})` : `rgba(0,255,0,${a})`;
        g.beginPath();
        g.moveTo(-len / 2, 0);
        g.quadraticCurveTo(0, bend - wid, len / 2, 0);
        g.quadraticCurveTo(0, bend + wid, -len / 2, 0);
        g.fill();
        g.restore();
      });
    }
  };
  tick('r', 520);
  tick('g', 360);

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export interface PaintShared {
  uNoise: THREE.IUniform<THREE.Texture>;
  uStrokes: THREE.IUniform<THREE.Texture>;
  uTime: THREE.IUniform<number>;
  uPaper: THREE.IUniform<THREE.Color>;
  uWorldHalf: THREE.IUniform<number>;
  uDirt: THREE.IUniform<THREE.Color>;
  uDirtDark: THREE.IUniform<THREE.Color>;
  uDirtWash: THREE.IUniform<number>;
  uCloud: THREE.IUniform<number>;
  /** Aerial perspective: distance from the lens where haze starts / is complete, and its strength. */
  uHaze: THREE.IUniform<THREE.Vector3>;
  uHazeColor: THREE.IUniform<THREE.Color>;
  /** Occlusion corridor in view space: vehicle roof to the road just ahead. */
  uSightStart: THREE.IUniform<THREE.Vector3>;
  uSightEnd: THREE.IUniform<THREE.Vector3>;
  uLensFade: THREE.IUniform<number>;
  [k: string]: THREE.IUniform;
}

export function createPaintShared(renderer: THREE.WebGLRenderer, worldHalf: number, lowSpec: boolean): PaintShared {
  const noise = bakeNoiseTexture(lowSpec ? 256 : 512);
  const strokes = bakeStrokeTexture(lowSpec ? 512 : 1024);
  // The camera never drops below ~22 degrees, so 2x anisotropy is all the ground ever needs;
  // higher settings only multiply texture probes once the paint minifies at wide zoom.
  const aniso = Math.min(2, renderer.capabilities.getMaxAnisotropy());
  noise.anisotropy = aniso;
  strokes.anisotropy = aniso;
  return {
    uNoise: { value: noise },
    uStrokes: { value: strokes },
    uTime: { value: 0 },
    uPaper: { value: col(PAL.paper) },
    uWorldHalf: { value: worldHalf },
    uDirt: { value: col(PAL.dirt) },
    uDirtDark: { value: col(PAL.dirtDark) },
    uDirtWash: { value: 0 },
    uCloud: { value: 0.24 },
    uHaze: { value: new THREE.Vector3(1e6, 2e6, 0) },
    uHazeColor: { value: col(PAL.haze) },
    uSightStart: { value: new THREE.Vector3() },
    uSightEnd: { value: new THREE.Vector3() },
    uLensFade: { value: 0 },
  };
}

/** GLSL shared by every painted material. */
const COMMON_FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform sampler2D uStrokes;
uniform float uTime;
uniform vec3 uPaper;
uniform float uWorldHalf;
uniform vec3 uDirt;
uniform vec3 uDirtDark;
uniform float uDirtWash;
uniform float uCloud;
uniform vec3 uHaze;
uniform vec3 uHazeColor;
uniform float uLensFade;
uniform vec3 uSightStart, uSightEnd;
varying vec3 vWorldPos;

vec2 rot2(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Slow soft cloud shadows drifting over the whole diorama (world-space, shared by all materials).
float cloudShade(vec2 p) {
  vec2 q = p / 330.0 + uTime * vec2(0.0042, 0.0019);
  vec4 n = texture2D(uNoise, q);
  float c = n.r + (n.b - 0.5) * 0.10;
  return 1.0 - smoothstep(0.54, 0.76, c) * uCloud;
}

// Bare earth / gravel shoulder — used by both the road ribbon and the terrain so they meet seamlessly.
vec3 dirtColor(vec2 p) {
  vec4 n = texture2D(uNoise, p / 8.9 + 0.27);
  vec4 m = texture2D(uNoise, p / 41.0 + 0.63);
  vec3 c = mix(uDirt, uDirtDark, smoothstep(0.38, 0.68, n.r * 0.6 + m.g * 0.4));
  return mix(c * (1.0 + (n.b - 0.5) * 0.16), uDirt, uDirtWash);
}
`;

// Test the projected car-to-road segment. Foliage behind the relevant part
// of the segment, or off to either side of it, keeps its painted silhouette.
const LENS_FADE = /* glsl */ `
if (uLensFade > 0.001 && max(uSightStart.z, uSightEnd.z) < -0.1) {
  vec3 eye = (viewMatrix * vec4(vWorldPos, 1.0)).xyz;
  float depth = -eye.z;
  vec2 a = uSightStart.xy / -uSightStart.z;
  vec2 b = uSightEnd.xy / -uSightEnd.z;
  vec2 delta = b - a;
  vec2 offset = eye.xy / depth - a;
  float t = clamp(dot(offset, delta) / max(dot(delta, delta), 0.000001), 0.0, 1.0);
  float targetDepth = 1.0 / mix(-1.0 / uSightStart.z, -1.0 / uSightEnd.z, t);
  float separation = length(offset - delta * t) * targetDepth;
  float width = mix(2.5, 1.9, t);
  float mask = (1.0 - smoothstep(width, width + 1.4, separation))
             * smoothstep(0.6, 2.0, targetDepth - depth) * uLensFade;
  if (mask > 0.0 && hash21(floor(gl_FragCoord.xy)) < mask) discard;
}
`;

export interface PaintOptions {
  /** Unique key so differently patched materials never share a compiled program. */
  key: string;
  uniforms?: Record<string, THREE.IUniform>;
  vertexPars?: string;
  /** Runs after `begin_vertex`; may modify `transformed`. */
  vertexMain?: string;
  fragPars?: string;
  /** Runs after vertex colours are applied; may modify `diffuseColor`. */
  fragColor?: string;
  /** Runs after lighting accumulation; may modify `reflectedLight`. */
  fragLight?: string;
  /** Runs last; may modify `gl_FragColor`. */
  fragFinal?: string;
  /** Use the authored normal on both faces (foliage cards are lit as a volume). */
  volumeNormals?: boolean;
  /** Dissolve this material where it stands between the lens and the car (driving views). */
  lensFade?: boolean;
}

/**
 * Patch a built-in lit material (Lambert) so it keeps Three's lighting + shadow pipeline
 * but gains world-space painting hooks. Using the stock pipeline keeps the prototype
 * cheap and portable; all stylisation happens in albedo and a few light tweaks.
 */
export function paintMaterial<T extends THREE.Material>(mat: T, shared: PaintShared, opt: PaintOptions): T {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, opt.uniforms ?? {});
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWorldPos;\nuniform float uTime;\n${opt.vertexPars ?? ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${opt.vertexMain ?? ''}`)
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          vWorldPos = (modelMatrix * wp).xyz;
        }`,
      );
    let fs = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON_FRAG}\n${opt.fragPars ?? ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${opt.lensFade ? LENS_FADE : ''}\n${opt.fragColor ?? ''}`)
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        reflectedLight.directDiffuse *= cloudShade(vWorldPos.xz);
        ${opt.fragLight ?? ''}`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        // Aerial perspective: land far beyond the focal plane pales towards the sky, so
        // distance reads as distance.
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uHazeColor, smoothstep(uHaze.x, uHaze.y, distance(cameraPosition, vWorldPos)) * uHaze.z);
        ${opt.fragFinal ?? ''}`,
      );
    if (opt.volumeNormals) {
      fs = fs.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>\nnormal = normalize(vNormal);`);
    }
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => `paint:${opt.key}`;
  return mat;
}

/**
 * Three r187's PCF filter rotates its sample disk with per-pixel screen-space noise, which
 * leaves a faint screen-anchored grain in every shadow edge. Use a fixed rotation instead so
 * penumbrae are stable in world space.
 */
export function stabiliseShadowFilter(): void {
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  const patched = chunk.replace('interleavedGradientNoise( gl_FragCoord.xy ) * PI2', '0.6');
  if (patched === chunk) console.warn('[paint] shadow filter patch did not apply (three.js chunk changed)');
  THREE.ShaderChunk.shadowmap_pars_fragment = patched;
}
