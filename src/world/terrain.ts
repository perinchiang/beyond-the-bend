import { regionalGround } from './routes';
import type { Region } from '../journey/progress';
import * as THREE from 'three';
import type { StyleStudy } from '../render/styleStudy';
import { HeightField, WORLD_HALF } from './heightfield';
import { ROAD_HALF_WIDTH } from './track';
import { PAL, PaintShared, paintMaterial } from '../render/paint';

import { STUDY_STONE } from './paintedFlora';
import { groundGrassPaint, meadowMasks } from './meadow';

const SEGMENTS = 320; // 1.25 m cells — plenty for gentle hills, light enough for mobile

/** Distance (m) inside which the diorama starts dissolving into paper. Negative = safely inside. */
export function edgeDistance(x: number, z: number): number {
  const qx = Math.abs(x) - (WORLD_HALF - 34), qz = Math.abs(z) - (WORLD_HALF - 34);
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}

export interface GroundPatch { x: number; z: number; radius: number }

export function buildTerrain(hf: HeightField, shared: PaintShared, patches: GroundPatch[], study?: StyleStudy, region?: Region, cedar = false, paving?: (x: number, z: number) => number, riceBed?: (x: number, z: number) => number): THREE.Mesh {
  const n = SEGMENTS + 1;
  const step = (WORLD_HALF * 2) / SEGMENTS;
  const h = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
    h[iz * n + ix] = hf.height(ix * step - WORLD_HALF, iz * step - WORLD_HALF);
  }
  const at = (ix: number, iz: number) => h[Math.min(n - 1, Math.max(0, iz)) * n + Math.min(n - 1, Math.max(0, ix))];

  const pos = new Float32Array(n * n * 3);
  const groundPaint = new Float32Array(n * n * 2);
  const nor = new Float32Array(n * n * 3);
  const form = new Float32Array(n * n); // +crest / -hollow, used as painted form shading
  const K = 7; // curvature probe radius in cells (~9 m)
  const v = new THREE.Vector3();
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
    const i = iz * n + ix;
    pos[i * 3] = ix * step - WORLD_HALF;
    pos[i * 3 + 1] = h[i];
    pos[i * 3 + 2] = iz * step - WORLD_HALF;
    v.set(at(ix - 1, iz) - at(ix + 1, iz), 2 * step, at(ix, iz - 1) - at(ix, iz + 1)).normalize();
    nor[i * 3] = v.x; nor[i * 3 + 1] = v.y; nor[i * 3 + 2] = v.z;
    if (paving) groundPaint[2*i] = paving(pos[i*3], pos[i*3+2]);
    if (riceBed) groundPaint[2*i+1] = riceBed(pos[i*3], pos[i*3+2]);
    const ring = (at(ix - K, iz) + at(ix + K, iz) + at(ix, iz - K) + at(ix, iz + K)
      + at(ix - K, iz - K) + at(ix + K, iz + K) + at(ix - K, iz + K) + at(ix + K, iz - K)) / 8;
    form[i] = Math.max(-1, Math.min(1, (h[i] - ring) / 0.55));
  }
  // Stain the ground vertices at planting time; the wash follows the hill and
  // is lit by the same sun as the surrounding meadow.
  const understory = new Float32Array(n * n);
  for (const { x, z, radius } of patches) {
    const cx = (x + WORLD_HALF) / step, cz = (z + WORLD_HALF) / step;
    const cells = radius / step;
    for (let iz = Math.max(0, Math.floor(cz - cells)); iz <= Math.min(n - 1, cz + cells); iz++) {
      for (let ix = Math.max(0, Math.floor(cx - cells)); ix <= Math.min(n - 1, cx + cells); ix++) {
        const d = ((ix - cx) ** 2 + (iz - cz) ** 2) / (cells * cells);
        const i = iz * n + ix;
        understory[i] = Math.max(understory[i], Math.max(0, 1 - d) ** 2);
      }
    }
  }
  const idx = new Uint32Array(SEGMENTS * SEGMENTS * 6);
  let k = 0;
  for (let iz = 0; iz < SEGMENTS; iz++) for (let ix = 0; ix < SEGMENTS; ix++) {
    const a = iz * n + ix, b = a + 1, c = a + n, d = c + 1;
    idx[k++] = a; idx[k++] = c; idx[k++] = b;
    idx[k++] = b; idx[k++] = c; idx[k++] = d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('aGroundPaint', new THREE.BufferAttribute(groundPaint, 2));
  geo.setAttribute('aForm', new THREE.BufferAttribute(form, 1));
  geo.setAttribute('aUnderstory', new THREE.BufferAttribute(understory, 1));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();

  const C = (hex: string) => ({ value: new THREE.Color(hex) });
  const meadow = study === 'gouache' ? {
    grassLight: '#c2c891', grassMid: '#a0b586', grassDeep: '#789884', grassCool: '#729c94', grassDry: '#e4c586',
  } : study === 'print' ? {
    grassLight: '#c7c983', grassMid: '#9db789', grassDeep: '#729b81', grassCool: '#568977', grassDry: '#e8bf69',
  } : PAL;
  const palette = region ? regionalGround[region] : [meadow.grassLight, meadow.grassMid, meadow.grassDeep, meadow.grassCool, meadow.grassDry];
  const groundGrass = cedar && study === 'gouache';
  const mat = paintMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff }), shared, {
    key: groundGrass ? 'terrain-gouache-ground-grass' : study ? `terrain-${study}` : 'terrain',
    uniforms: {
      uStudyStone: { value: STUDY_STONE },
      uSdf: { value: hf.sdfTexture },
      uHalfRoad: { value: ROAD_HALF_WIDTH },
      cLight: C(palette[0]),
      cMid: C(palette[1]),
      cDeep: C(palette[2]),
      cCool: C(palette[3]),
      cDry: C(palette[4]),
    },
    vertexPars: /* glsl */ `attribute vec2 aGroundPaint; varying vec2 vGroundPaint; attribute float aForm, aUnderstory; varying float vUnderstory;\nvarying float vForm;`,
    vertexMain: /* glsl */ `vGroundPaint = aGroundPaint; vForm = aForm; vUnderstory = aUnderstory;`,
    fragPars: /* glsl */ `
      varying vec2 vGroundPaint;
      uniform vec2 uStudyStone;
      uniform sampler2D uSdf;
      uniform float uHalfRoad;
      uniform vec3 cLight, cMid, cDeep, cCool, cDry;
      varying float vForm;
      varying float vUnderstory;
      float gEdge;
      ${meadowMasks}
      ${groundGrass ? groundGrassPaint : ''}
    `,
    fragColor: /* glsl */ `
      {
        vec2 p = vWorldPos.xz;

        // --- Layer 1: broad gouache washes. Few tones, large calm shapes; brush dabs (not
        //     wiggly noise) nibble at the outlines so edges feel laid down by hand.
        //     Six texture reads feed every layer below (channels are reused deliberately —
        //     this shader covers the whole screen, so reads are the budget that matters).
        vec4 w0 = texture2D(uNoise, p / 240.0 + 0.13);
        vec2 pw = p + (w0.rg - 0.5) * 24.0;
        vec4 nA = texture2D(uNoise, pw / 330.0 + vec2(0.37, 0.71));
        vec4 nB = texture2D(uNoise, p / 83.0 + vec2(0.91, 0.23));
        vec4 nC = texture2D(uNoise, rot2(p, 0.5) / 9.7);
        vec4 s1 = texture2D(uStrokes, p / 29.0);
        vec4 s2 = texture2D(uStrokes, rot2(p, 1.1) / 43.0 + 0.37);
        float dab = s2.b, dab2 = s1.b;
        float brushEdge = (dab - 0.3) * 0.075 + (dab2 - 0.3) * 0.04;

        float lightP = smoothstep(0.565, 0.615, nA.r + brushEdge + (nB.g - 0.5) * 0.05);
        float deepP = smoothstep(0.595, 0.645, nA.g + brushEdge + (nB.r - 0.5) * 0.05);
        vec3 g = mix(cMid, cLight, lightP * 0.80);
        g = mix(g, cDeep, deepP * 0.74);

        // Field-sized colour masses fixed to the map: a straw meadow inside
        // the sweep, a cooler allée and a green opening between them.
        float cutEdge = (w0.g - 0.5) * 3.5 + (s1.g - 0.3) * 0.8;
        vec2 fields = meadowMasks(p, cutEdge);
        g = mix(g, mix(cDry, cLight, 0.06 + 0.15*nB.r), fields.x * 0.92);
        g = mix(g, mix(cCool, cDeep, 0.25 + 0.30*nB.g), fields.y * 0.72);
        // Broad overlapping mower passes follow the southern headland and
        // taper out at its grassy margin. Other fields keep their open wash.
        float arc = p.y + 0.115 * p.x + 0.0017 * (p.x + 24.0) * (p.x + 24.0);
        float swath = sin(arc * 0.52 + 0.55*nB.r + 0.18*dab);
        float cut = smoothstep(-0.78,0.62,swath) * fields.x;
        g = mix(g, cLight * vec3(0.94,0.95,0.85), cut * (0.55 + 0.12*nB.g));
        // --- Layer 2: quiet medium variation — cool drifts and long wind-swept dry bands.
        g = mix(g, cCool, smoothstep(0.56, 0.78, nB.b) * 0.15);
        float dryBand = smoothstep(0.60, 0.80, nA.a);
        g = mix(g, cDry, dryBand * 0.20 * (1.0 - deepP));

        // --- Layer 3: painted form. Crests catch warm light, hollows hold cool pigment.
        g = mix(g, cLight * 1.03, clamp(vForm, 0.0, 1.0) * 0.30);
        g = mix(g, cCool * 0.94, clamp(-vForm, 0.0, 1.0) * 0.34);

        // --- Layer 4: brush work. Soft dabs, then short ticks that read as blades of grass.
        g *= 1.0 + (dab - 0.30) * 0.10 + (dab2 - 0.30) * 0.06;
        float tickD = max(s1.r, s2.r * 0.85) * (0.45 + 0.55 * smoothstep(0.36, 0.60, nB.r));
        float tickL = max(s1.g, s2.g * 0.85) * (0.40 + 0.60 * smoothstep(0.40, 0.64, nB.g));
        g = mix(g, g * vec3(0.66, 0.80, 0.74), tickD * (0.46 - 0.19*fields.x));
        g = mix(g, g * 1.17 + vec3(0.03, 0.04, 0.0), tickL * (0.48 - 0.18*fields.x));

        // --- Layer 5: paper tooth and dry-brush streaks (finest scale, mip-filtered).
        g *= 1.0 + (nC.b - 0.5) * 0.085 + (nC.a - 0.5) * 0.075;

        ${study === 'oil' ? `
          // A long bristle dragged along the hillside, with breaks in its paint load.
          vec2 drag = rot2(p, -0.36) / vec2(42.0, 24.0);
          float bristle = texture2D(uNoise, drag + 0.08 * nB.rg).a;
          float loaded = smoothstep(0.46, 0.82, nB.g);
          g = mix(g, mix(cDry, cLight, 0.42), 0.26 * loaded * smoothstep(0.47, 0.68, bristle));
        ` : study === 'gouache' ? `
          // Overlapping passes of an opaque flat brush; keep the field boundaries readable.
          vec4 scumble = texture2D(uStrokes, rot2(p, -0.34) / vec2(53.0, 36.0) + 0.04 * nB.rg);
          float loaded = smoothstep(0.12, 0.31, scumble.b) * smoothstep(0.34, 0.68, nB.g);
          g = mix(g, mix(cLight, cDry, fields.x * 0.8), loaded * 0.25);
          g = mix(g, cCool, smoothstep(0.54, 0.72, nA.g) * (1.0 - fields.x) * 0.20);
        ` : study === 'print' ? `
          // Separately cut colour plates follow the field boundaries. Broad regions of
          // unbroken ink keep the small cuts concentrated along banks and hollows.
          float hollow = nA.g + 0.16 * nB.r - 0.10 * vForm;
          g = mix(cMid, cDeep, 0.81 * smoothstep(0.62, 0.64, hollow));
          g = mix(g, cLight, smoothstep(0.66, 0.68, nA.r + 0.09*vForm));
          g = mix(g, cDry, smoothstep(0.34, 0.42, fields.x));
          g = mix(g, cLight, fields.x * 0.38 * smoothstep(0.78, 0.86, swath));
          g = mix(g, cCool, smoothstep(0.48, 0.56, fields.y));
          float cuts = smoothstep(0.54, 0.66, s1.r) * smoothstep(0.53, 0.73, nB.r);
          g = mix(g, cDry, cuts * 0.18);
        ` : ''}

        float understoryWash = smoothstep(0.03, 0.94, vUnderstory);
        g = mix(g, cCool * 0.82, understoryWash * (0.38 + 0.09 * s2.b));
        ${groundGrass ? `
          float footprint = max(fwidth(p.x), fwidth(p.y));
          g *= 1.0 + groundGrass(p, nB.r, footprint) * (1.0 - vGroundPaint.y);
        ` : ''}
        float fieldEdge = smoothstep(0.12,0.92,vGroundPaint.y+(nC.r-0.5)*0.14);
        float lightBand = smoothstep(0.27,0.65,nA.g+0.18*dab);
        vec3 crop = mix(cMid*vec3(0.73,0.72,0.44),cDry*vec3(0.87,0.92,0.68),lightBand);
        g = mix(g,crop,fieldEdge*0.87);
        // --- Road shoulder: trodden dry grass, then bare earth meeting the asphalt.
        vec2 verge = texture2D(uSdf, p / (2.0 * uWorldHalf) + 0.5).rg;
        if (verge.x < uHalfRoad + 7.0) {
          float edge = verge.x - uHalfRoad - verge.y;
          float brush = (nC.b - 0.5) * 0.48 + (s1.g - 0.3) * 0.35;
          float turf = smoothstep(-0.18, 0.78, edge + brush);
          float straw = 1.0 - smoothstep(-0.1, 1.65, edge + (nB.r - 0.5) * 0.7);
          g = mix(g, cDry, straw * 0.50);
          g = mix(dirtColor(p), g, turf);
        }

        ${cedar ? `
        float laneDist = texture2D(uSdf,p/(2.0*uWorldHalf)+0.5).b - 0.45;
        float dirtLane = 1.0 - smoothstep(2.65,3.65,laneDist + (nC.g - 0.5)*0.48);
        float grooves = 1.0-smoothstep(0.10,0.50,abs(laneDist-1.02+(nB.g-0.5)*0.43));
        vec3 clay = mix(dirtColor(p)*vec3(0.88,0.79,0.69),cDry,0.10);
        clay = mix(clay,clay*0.72,grooves*(0.54+0.36*nC.g));
        float crown = (1.0-smoothstep(0.12,0.82,laneDist))*smoothstep(0.30,0.68,nB.r);
        clay = mix(clay,cMid*0.80,crown*0.46);
        g = mix(g,clay,dirtLane*0.93);
        float gravel = smoothstep(0.10,0.96,vGroundPaint.x+(nC.r-0.50)*0.17);
        g = mix(g, mix(dirtColor(p),cDry,0.23)*(0.90+0.16*dab),gravel);
        vec2 yard = (p-vec2(-43.0,1.0))/vec2(13.5,12.0);
        float apron = 1.0-smoothstep(0.66,1.2,length(yard)+(nC.r-0.5)*0.16);
        g = mix(g,dirtColor(p)*mix(0.88,1.04,dab),apron*0.94);
        ` : ''}
        // A few long pigment washes settle the study stone into the turf.
        vec2 foot = p - uStudyStone;
        if (abs(foot.x) < 4.8 && abs(foot.y) < 3.2) {
          vec2 along = rot2(foot, -0.26);
          float torn = (s1.b - 0.30) * 0.22 + (nC.r - 0.5) * 0.30;
          float hollow = 1.0 - smoothstep(0.42, 1.05, length((along - vec2(0.30,0.43)) / vec2(3.5,1.78)) + torn);
          float straw = 1.0 - smoothstep(0.30, 1.0, length((along + vec2(0.56,0.89)) / vec2(2.71,0.65)) + torn);
          float contact = 1.0 - smoothstep(0.45, 1.55, length(foot / vec2(1.1,0.70)));
          g = mix(g, cCool * 0.83, hollow * 0.51);
          g = mix(g, cDry, straw * 0.48);
          g *= 1.0 - contact * 0.22;
        }
        diffuseColor.rgb = g;

        // --- Diorama edge: the world dissolves into paper through growing stippled holes.
        vec2 q = abs(p) - (uWorldHalf - 34.0);
        float e = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
        gEdge = smoothstep(4.0, 22.0, e + (w0.b - 0.5) * 22.0 + (nB.a - 0.5) * 9.0);
        if (gEdge > 0.0) {
          vec2 sp = rot2(p, 0.47) / 0.62;
          vec2 cell = floor(sp);
          vec2 f = fract(sp) - 0.5 + (vec2(hash21(cell), hash21(cell + 17.3)) - 0.5) * 0.5;
          float grow = clamp(gEdge * 1.25 + (hash21(cell + 5.1) - 0.5) * 0.45, 0.0, 1.2);
          if (length(f) < grow * 0.86) discard;
        }
      }
    `,
    fragFinal: /* glsl */ `gl_FragColor.rgb = mix(gl_FragColor.rgb, uPaper, smoothstep(0.15, 0.95, gEdge) * 0.55);`,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'terrain';
  return mesh;
}
