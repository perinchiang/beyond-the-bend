import * as THREE from 'three';
import type { StyleStudy } from '../render/styleStudy';
import { ROAD_HALF_WIDTH, ROAD_SKIRT, Track } from './track';
import { PAL, PaintShared, paintMaterial } from '../render/paint';

const DASH_PERIOD = 9; // metres between centre-line dashes

/**
 * The road is real geometry: a ribbon swept along the spline with exact lateral
 * coordinates, so edge lines and dashes stay razor-clean at any zoom (Art-of-Rally
 * readability). The paint on it is world-space, matching the terrain's treatment.
 */
export function buildRoad(track: Track, shared: PaintShared, study?: StyleStudy): THREE.Mesh {
  const { samples, length } = track;
  const n = samples.length;
  const hw = ROAD_HALF_WIDTH;
  const lat = [-(hw + ROAD_SKIRT), -hw, -hw * 0.5, 0, hw * 0.5, hw, hw + ROAD_SKIRT];
  const drop = [-0.16, 0, 0, 0, 0, 0, -0.16]; // shoulders dip under the terrain so no seam shows
  const cols = lat.length;
  const vScale = (Math.round(length / DASH_PERIOD) * DASH_PERIOD) / length; // dashes close the loop cleanly

  const pos = new Float32Array((n + 1) * cols * 3);
  const nor = new Float32Array((n + 1) * cols * 3);
  const uv = new Float32Array((n + 1) * cols * 3);
  const t3 = new THREE.Vector3(), l3 = new THREE.Vector3(), n3 = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    const s = samples[i % n];
    const prev = samples[(i - 1 + n) % n], next = samples[(i + 1) % n];
    const dy = (next.y - prev.y) / (2 * (length / n));
    t3.set(s.tx, dy, s.tz).normalize();
    l3.set(-s.tz, 0, s.tx);
    n3.crossVectors(l3, t3).normalize();
    if (n3.y < 0) n3.negate();
    for (let c = 0; c < cols; c++) {
      const j = i * cols + c;
      pos[j * 3] = s.x + l3.x * lat[c];
      pos[j * 3 + 1] = s.y + drop[c];
      pos[j * 3 + 2] = s.z + l3.z * lat[c];
      nor[j * 3] = n3.x; nor[j * 3 + 1] = n3.y; nor[j * 3 + 2] = n3.z;
      uv[j * 3] = lat[c];
      uv[j * 3 + 2] = s.k;
      uv[j * 3 + 1] = (i === n ? length : s.s) * vScale;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i++) for (let c = 0; c < cols - 1; c++) {
    const a = i * cols + c, b = a + 1, d = a + cols, e = d + 1;
    idx.push(a, b, d, b, e, d);
  }
  // Make sure the ribbon faces up regardless of spline direction.
  {
    const a = new THREE.Vector3().fromArray(pos, idx[0] * 3), b = new THREE.Vector3().fromArray(pos, idx[1] * 3), c = new THREE.Vector3().fromArray(pos, idx[2] * 3);
    if (b.sub(a).cross(c.sub(a)).y < 0) for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('aRoad', new THREE.BufferAttribute(uv, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();

  const C = (hex: string) => ({ value: new THREE.Color(hex) });
  const mat = paintMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff }), shared, {
    key: study ? `road-${study}` : 'road',
    uniforms: {
      uHalfRoad: { value: hw },
      uDash: { value: DASH_PERIOD },
      cAsphalt: C(PAL.asphalt), cAsphaltLight: C(PAL.asphaltLight), cAsphaltDark: C(PAL.asphaltDark),
      cLine: C(PAL.line), cCentre: C(PAL.lineCentre),
    },
    vertexPars: /* glsl */ `attribute vec3 aRoad;\nvarying vec3 vRoad;`,
    vertexMain: /* glsl */ `vRoad = aRoad;`,
    fragPars: /* glsl */ `
      uniform float uHalfRoad, uDash;
      uniform vec3 cAsphalt, cAsphaltLight, cAsphaltDark, cLine, cCentre;
      varying vec3 vRoad;
    `,
    fragColor: /* glsl */ `
      {
        vec2 p = vWorldPos.xz;
        float d = abs(vRoad.x), s = vRoad.y;
        vec4 nA = texture2D(uNoise, p / 67.0 + 0.41);
        vec4 nC = texture2D(uNoise, p / 7.9 + 0.17);
        vec4 nL = texture2D(uNoise, vec2(vRoad.x / 11.0, s / 71.0));   // strokes pulled along the lane
        float dab = texture2D(uStrokes, p / 29.0 + 0.2).b;

        // Asphalt: a cool violet-grey wash, sun-bleached in broad patches.
        vec3 a = mix(cAsphalt, cAsphaltLight, smoothstep(0.38, 0.66, nA.r + (dab - 0.3) * 0.12) * 0.5);
        // Tyre-polished lanes and a slightly darker crown / gutters.
        float lane = exp(-pow((d - 1.62) / 0.72, 2.0));
        a = mix(a, cAsphaltLight * 1.06, lane * 0.34);
        a = mix(a, cAsphaltDark, smoothstep(0.56, 0.82, nL.a) * 0.30);
        a = mix(a, cAsphaltDark, smoothstep(uHalfRoad - 0.9, uHalfRoad, d) * 0.22);
        // Dust drifting in from the verge.
        vec3 earth = dirtColor(p);
        float cut = clamp(sign(vRoad.x) * vRoad.z * 28.0, 0.0, 1.0);
        float dust = smoothstep(uHalfRoad - 0.38 - cut * 0.74, uHalfRoad + 0.1, d + (nC.g - 0.5) * 0.5);
        a = mix(a, earth * 0.92, dust * (0.2 + cut * 0.34));
        a *= 1.0 + (nC.b - 0.5) * 0.10 + (dab - 0.3) * 0.025;

        ${study === 'print' ? `
          a = mix(vec3(0.138, 0.144, 0.19), vec3(0.153, 0.16, 0.205),
                  smoothstep(0.65, 0.67, nA.r + 0.06 * nL.r));
          a = mix(a, earth, dust * 0.16);
        ` : ''}

        // Painted markings — anti-aliased analytically, lightly worn by the same paint noise.
        float aw = fwidth(vRoad.x) * 1.1 + 0.004;
        float wear = smoothstep(0.26, 0.52, nC.r * 0.55 + nA.g * 0.45);
        float edgeLine = 1.0 - smoothstep(0.075 - aw, 0.075 + aw, abs(d - (uHalfRoad - 0.44)));
        a = mix(a, cLine, edgeLine * mix(0.42, 0.94, wear));
        float ds = fract(s / uDash) * uDash;
        float al = fwidth(s) * 1.1 + 0.004;
        float dashMask = smoothstep(0.0, al * 2.0, ds) * (1.0 - smoothstep(3.0 - al * 2.0, 3.0, ds));
        float centre = (1.0 - smoothstep(0.07 - aw, 0.07 + aw, d)) * dashMask;
        a = mix(a, cCentre, centre * mix(0.40, 0.92, wear));

        // Crumbling edge where asphalt meets the earth shoulder.
        float wob = (nC.g - 0.5) * 0.26 + (nA.b - 0.5) * 0.30;
        float sh = smoothstep(uHalfRoad - 0.05, uHalfRoad + 0.05, d + wob);
        diffuseColor.rgb = mix(a, earth, sh);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'road';
  return mesh;
}
