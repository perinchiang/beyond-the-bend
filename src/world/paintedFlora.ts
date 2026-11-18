import * as THREE from 'three';
import { Rng } from '../core/rng';
import { PaintShared, paintMaterial } from '../render/paint';
import { Builder, blob, tube } from './flora';

// Surveyed feet of the existing birch and stone on the right of the southern avenue.
export const STUDY_TREE = new THREE.Vector2(-11.74, 120.79);
export const STUDY_STONE = new THREE.Vector2(-12.05, 118.89);
const V = THREE.Vector3;
const C = (hex: string) => new THREE.Color(hex);

// Four original brush impressions. Their interiors join up; the last marks
// fall away from the body of the stroke. Leave a gutter around each impression.
function leafBrushes() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const rng = new Rng(713);
  for (let cell = 0; cell < 4; cell++) {
    ctx.save();
    ctx.translate(64 + 128 * (cell % 2), 60 + 128 * Math.floor(cell / 2));
    ctx.rotate((cell - 1.5) * 0.16);
    const mark = (x: number, y: number, w: number, h: number, angle: number, value: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.scale(w, h);
      ctx.fillStyle = `rgb(${value},${value},${value})`;
      ctx.beginPath();
      ctx.moveTo(-1, 0.12);
      ctx.bezierCurveTo(-0.72, -0.55, 0.06, -1.12, 0.73, -0.62);
      ctx.bezierCurveTo(1.23, -0.08, 0.67, 0.65, 0.05, 0.88);
      ctx.quadraticCurveTo(-0.65, 1.13, -1, 0.12);
      ctx.fill();
      ctx.restore();
    };
    if (cell === 3) {
      // A separate, open brush for the extremities: a curved terminal twig
      // and paired leaf marks with paper showing between them.
      ctx.strokeStyle = '#bdbdbd';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-21, -41);
      ctx.quadraticCurveTo(15, -4, 12, 48);
      ctx.stroke();
      for (let k = 0; k < 13; k++) {
        const t = k / 12, x = -20 + 55 * t - 24 * t * t, y = -38 + 81 * t;
        const side = k % 2 ? -1 : 1;
        mark(x + side * 6, y, 8 - t * 3, 4 - t, side * 0.62, rng.int(225, 255));
      }
      ctx.restore();
      continue;
    }
    for (const [x,y,w,h] of [[-12,-5,21,16],[8,0,21,17],[1,12,17,19],[17,18,12,13]]) {
      mark(x, y, w, h, -0.65, 233);
    }
    for (let i = 0; i < 72; i++) {
      const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next());
      const x = Math.cos(a) * d * 45, y = Math.sin(a) * d * 41 + 0.22 * x;
      let size = rng.range(3.4, 8.7) * (1.18 - 0.32 * d);
      mark(x, y, size, size * 0.68, a * 0.38 + 0.72, rng.int(216, 255));
    }
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Each volume is placed by hand around a fork. The open slot between the low
// lateral bough and the high leader stays visible from the driving approach.
const crowns = [
  [-0.55, 5.45, -1.85, 1.30, 1.13, 1.48],
  [-0.77, 5.07, -2.82, 0.75, 0.88, 0.63],
  [0.24, 6.92, 1.10, 1.68, 1.63, 1.63],
  [0.12, 6.61, 2.28, 1.08, 1.22, 1.15],
  [0.08, 5.87, 2.96, 0.62, 1.04, 0.67],
  [0.63, 8.15, 0.48, 1.40, 1.58, 1.41],
  [0.45, 9.15, -0.04, 0.94, 1.28, 0.97],
  [1.19, 7.20, -0.94, 1.07, 1.12, 1.02],
];

type BrushPalette = readonly [string, string, string];
function crownGeometry(volumes: number[][], seed: number, palette: BrushPalette, density: number, brushSize: number, shrub?: { flowering: boolean }) {
  const b = new Builder(), uv: number[] = [], rng = new Rng(seed);
  const [cool, mid, lit] = palette.map(C);
  for (const [x, y, z, rx, ry, rz] of volumes) {
    if (shrub) {
      // A low mass underneath the open sprays holds the shrub together in motion.
      // Sample the opaque centre of one impression for these inner vertices.
      const first = b.pos.length / 3;
      blob(b, new V(x, y * 0.59, z + 0.12 * rz), new V(rx * 0.58, ry * 0.53, rz * 0.61), 1, 0.27, seed,
        dir => cool.clone().lerp(mid, 0.16 + 0.20 * dir.y), 0.20);
      for (let i = first; i < b.pos.length / 3; i++) uv.push(0.25, 0.76);
    }
    const count = Math.ceil(rx * rz * density);
    for (let i = 0; i < count; i++) {
      const h = 1 - (2 * i + 1) / count, a = i * 2.39996 + rng.range(-0.17, 0.17);
      const ring = Math.sqrt(1 - h * h);
      const n = new V(Math.cos(a) * ring, h, Math.sin(a) * ring);
      const fringe = i % 5 === 0;
      const radius = rng.range(0.73, 1.03) + 0.19 * Math.sin(a * 3 + h * 2 + z)
        + 0.13 * Math.cos(a * 5 - h * 3 + x) + (fringe ? 0.23 : 0);
      const centre = new V(x + n.x * rx * radius, y + n.y * ry * radius, z + n.z * rz * radius);
      centre.z += 0.42 * h * rz;
      centre.y -= brushSize * (0.28 + (fringe ? 0.32 : 0)) * ring * (1 + Math.sin(a * 3 + z));
      const normal = n.clone().add(new V(0, 0.27, 0)).normalize();
      const u = new V(-Math.sin(a), 0, Math.cos(a));
      u.applyAxisAngle(n, rng.range(-0.7, 0.7));
      const v = n.clone().cross(u).applyAxisAngle(u, rng.range(-0.65, 0.65));
      if (fringe && v.y < 0) v.negate();
      let size = rng.range(0.40, 0.61) * brushSize;
      const light = THREE.MathUtils.clamp(0.48 + 0.24 * h - 0.19 * n.z + 0.12 * n.x + 0.08 * Math.sin(centre.z * 2 + centre.y), 0, 1);
      const pigment = cool.clone().lerp(mid, Math.min(1, light * 1.7)).lerp(lit, Math.max(0, light - 0.45) * 1.75);
      // Sun-facing sprays flower together at the ends of the long bough.
      if (shrub?.flowering && centre.z > 0.25 && h > 0.25 && i % 5 === 1) {
        size *= 0.58;
        centre.addScaledVector(n, 0.16);
        pigment.set('#eddcb8');
      }
      const cell = fringe ? 3 : rng.int(0, 2), first = b.pos.length / 3;
      for (const [dx, dy] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
        b.vert(centre.clone().addScaledVector(u, dx * size).addScaledVector(v, dy * size),
          normal, pigment, 0.65 + (centre.y - 4) * 0.09);
        uv.push((cell % 2 + 0.5 + dx * 0.49) / 2, (Math.floor(cell / 2) + 0.5 + dy * 0.49) / 2);
      }
      b.tri(first, first + 1, first + 2);
      b.tri(first, first + 2, first + 3);
    }
  }
  const g = b.build();
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

export function birchCrown(lowSpec: boolean) {
  return crownGeometry(crowns, 352, ['#668765', '#acc45f', '#e3df86'], lowSpec ? 66 : 106, lowSpec ? 1.11 : 1);
}

export function paintedShrub(seed: number, flowering: boolean, lowSpec: boolean) {
  // A sloping bank of stems, with a low trailing end and light between sprays.
  const height = seed % 2 === 0 ? 0.76 : 0.95;
  const volumes = [[0, height * 0.7, 0, 0.86, height * 0.65, 1.14],
    [-0.28, height * 0.88, 0.65, 0.56, height * 0.61, 0.77],
    [0.27, height * 0.39, -0.84, 0.55, height * 0.46, 0.63],
    [-0.48, height * 0.31, 1.18, 0.37, height * 0.36, 0.40]];
  return crownGeometry(volumes, seed, flowering ? ['#526f5e','#88a75d','#cfcd83'] :
    ['#486e59','#749758','#b6c775'], lowSpec ? 64 : 100, lowSpec ? 0.78 : 0.68, { flowering });
}

export function birchTrunk() {
  const b = new Builder(), bark = C('#e7ddba'), warm = C('#c2b898'), twig = C('#786e5b');
  const limb = (points: number[][], sides: number) => tube(b,
    points.map(([x,y,z,r]) => ({ p: new V(x,y,z), r, c: r > 0.16 ? bark : r > 0.08 ? warm : twig })), sides);
  limb([[0,-0.20,0,0.33],[0,0.22,0,0.26],[0.08,2.1,0.05,0.22],[0.22,3.6,0.19,0.18],
    [0.21,5.4,0.50,0.145],[0.50,7.2,0.48,0.10],[0.45,9.3,0,0.035]], 14);
  limb([[0.15,2.98,0.15,0.145],[-0.12,3.82,-0.61,0.12],[-0.52,4.5,-1.52,0.09],[-0.77,5.5,-2.55,0.04]], 9);
  limb([[0.22,4.52,0.33,0.14],[0.18,5.19,1.28,0.11],[0.11,5.93,2.04,0.08],[0.08,6.57,2.74,0.035]], 9);
  limb([[0.26,5.62,0.50,0.11],[0.81,6.28,0.03,0.085],[1.19,7.25,-0.94,0.035]], 7);
  return b.build();
}

export function paintedLeafMaterials(shared: PaintShared, swayVertex: string) {
  const woodMat = paintMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), shared, {
    key: 'birch-bark', lensFade: true,
    vertexPars: 'varying vec3 vBark;', vertexMain: 'vBark = position;',
    fragPars: 'varying vec3 vBark;',
    fragColor: `
      float stripe = texture2D(uNoise, vec2(dot(vBark.xz, vec2(0.7, 0.9)) * 0.72, vBark.y * 1.17)).r;
      float nick = smoothstep(0.65, 0.72, stripe) * (1.0 - smoothstep(3.0, 5.7, vBark.y));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.14, 0.14, 0.105), 0.78 * nick);
    `,
  });
  const leaves = paintMaterial(new THREE.MeshLambertMaterial({
    map: leafBrushes(), vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.42, alphaToCoverage: true,
  }), shared, { key: 'leaf-brushes', volumeNormals: true, lensFade: true,
    vertexPars: 'attribute float aSway;', vertexMain: swayVertex });
  return { bark: woodMat, leaves };
}

// One low fieldstone with a sloping ochre top, a lavender break and mossy foot.
export function fieldstone(variant: number) {
  const b = new Builder();
  const ring = [[-0.78,-0.92],[-0.19,-1.32],[0.48,-0.96],[0.74,0.05],[0.55,0.93],[-0.2,1.23],[-0.71,0.55]];
  const top = [[-0.55,0.29,-0.65],[-0.16,0.39,-0.96],[0.32,0.46,-0.66],
    [0.46,0.53,-0.03],[0.28,0.36,0.69],[-0.18,0.21,0.94],[-0.53,0.20,0.35]]
    .map(([x,y,z]) => new V(x,y,z));
  const face = (a: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, pigment: THREE.Color) => {
    const n = c.clone().sub(a).cross(d.clone().sub(a)).normalize();
    const ids = [a,c,d].map(p => {
      const weathered = new V(p.x * 0.9, p.y * 2.8 + 0.25, p.z * 0.7).normalize();
      const moss = 0.72 * (1 - THREE.MathUtils.smoothstep(p.y + p.z * 0.07, 0, 0.37));
      return b.vert(p, weathered.lerp(n, 0.46).normalize(), pigment.clone().lerp(C('#89965b'), moss));
    });
    b.tri(ids[0], ids[1], ids[2]);
  };
  const lip = top.map((p, i) => new V(
    0.37 * ring[i][0] + 0.63 * p.x, p.y * 0.73, 0.37 * ring[i][1] + 0.63 * p.z));
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length, a = new V(ring[i][0], -0.14, ring[i][1]), d = new V(ring[j][0], -0.14, ring[j][1]);
    const side = C(i < 3 ? '#a09a99' : '#8f9395');
    face(a, lip[i], lip[j], side); face(a, lip[j], d, side);
    const bevel = side.clone().lerp(C('#c6bea6'), 0.52);
    face(lip[i], top[i], top[j], bevel); face(lip[i], top[j], lip[j], bevel);
    face(top[j], top[i], new V(0.04, 0.51, -0.07), C(i < 3 ? '#bdb8a5' : '#c9c1aa'));
  }
  // Three tufts grow along the damp seam. Their bases fall inside the
  // footprint so the first blades emerge from behind the stone.
  const rng = new Rng(194);
  for (const [x,z] of [[-0.63,-0.51],[-0.49,0.74],[0.30,0.92]]) {
    for (let blade = 0; blade < 8; blade++) {
      const angle = rng.range(0, Math.PI * 2);
      const u = new V(Math.cos(angle), 0, Math.sin(angle));
      const side = new V(-u.z, 0, u.x);
      const root = new V(x + rng.range(-0.15, 0.15), -0.04, z + rng.range(-0.12, 0.12));
      const tip = root.clone().addScaledVector(u, rng.range(0.14, 0.36));
      tip.y += rng.range(0.19, 0.38);
      const normal = new V(0, 1, 0);
      const i = b.vert(root.clone().addScaledVector(side, -0.035), normal, C('#69854f'));
      b.vert(root.clone().addScaledVector(side, 0.035), normal, C('#69854f'));
      b.vert(tip, normal, C('#a7af63'));
      b.tri(i, i + 1, i + 2);
      b.tri(i + 2, i + 1, i);
    }
  }
  const stone = b.build();
  // Outcrops, flat slabs and rounded shoulders retain different profiles at driving scale.
  if (variant === 1) stone.scale(1.20, 1.42, 0.83);
  if (variant === 2) stone.scale(0.88, 0.78, 1.18);
  return stone;
}
