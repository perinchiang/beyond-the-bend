import * as THREE from 'three';
import { Rng } from '../core/rng';
import { noise2, smoothstep } from '../core/noise';
import { paintMaterial, type PaintShared } from '../render/paint';
import { Builder, makeConifer, paintedShrub, tube, woodlandBrushes } from './flora';

const V = THREE.Vector3;
const TAU = Math.PI * 2;

// Keep the UV layout of the bark and the fan of thorn branches. Oil leaves
// and fir boughs use a loaded flat brush with a split, dragged-out end.
function oilBrushes() {
  const atlas = woodlandBrushes();
  const canvas = atlas.image as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const rng = new Rng(551);
  for (const cell of [1, 2, 3]) {
    const ox = (cell % 2) * 128, oy = cell === 1 ? 128 : 0;
    ctx.clearRect(ox, oy, 128, 128);
    ctx.save();
    ctx.translate(ox + 64, oy + 64);
    const stroke = (x: number, y: number, length: number, thickness: number, angle: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      for (let i = 0; i < 15; i++) {
        const t = i / 14;
        const extent = length * (0.65 + 0.34 * Math.sin(Math.PI * t));
        const start = -extent * rng.range(0.45, 0.53), end = extent * rng.range(0.4, 0.57);
        const offset = (t - 0.5) * thickness;
        const bend = thickness * 0.15;
        const grey = rng.int(221, 255);
        ctx.strokeStyle = `rgb(${grey},${grey},${grey})`;
        ctx.lineWidth = thickness * rng.range(0.10, 0.16);
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(start, offset + bend);
        ctx.quadraticCurveTo(-extent * 0.05, offset - bend, end, offset);
        ctx.stroke();
      }
      ctx.restore();
    };
    if (cell === 1) {
      stroke(-4, 5, 102, 46, -0.16);
      stroke(15, -13, 68, 20, -0.25);
      stroke(33, 14, 33, 8, -0.16);
    } else if (cell === 2) {
      stroke(-5, 4, 107, 32, -0.04);
      for (let i = 0; i < 6; i++) {
        const x = -32 + 12 * i;
        stroke(x, -9, 46 - i * 2, 11, -0.4);
        stroke(x + 6, 12, 36 - i * 2, 13, 0.41);
      }
    } else {
      stroke(-8, 4, 87, 9, -0.06);
      for (const [x, y, a, len] of [[-24,-8,-0.39,42],[-10,11,0.3,45],[7,-9,-0.48,42],[23,8,0.22,35],[38,-2,-0.18,26]]) {
        stroke(x, y, len, 18, a);
      }
    }
    ctx.restore();
  }
  return atlas;
}

class OilBody extends Builder {
  private uv: number[] = [];
  override vert(p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color, sway = 0) {
    this.uv.push(0.016, 0.016);
    return super.vert(p, n, c, sway);
  }
  stamp(p: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3, n: THREE.Vector3, ink: THREE.Color) {
    const k = this.pos.length / 3;
    for (const [x,y] of [[-1,-1], [1,-1], [1,1], [-1,1]]) {
      super.vert(p.clone().addScaledVector(u,x).addScaledVector(v,y), n, ink, 0.25);
      this.uv.push(0.75 + x * 0.24, 0.25 + y * 0.24);
    }
    this.tri(k,k+1,k+2); this.tri(k,k+2,k+3);
  }
  override build() {
    const g = super.build();
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

const crownProfiles = {
  oak: { size: [4.3,2.75,3.55], y: 5.62, ink: ['#405952','#75844c','#c0b961'] },
  lime: { size: [2.95,3.68,2.8], y: 6.30, ink: ['#536e62','#849350','#d3c678'] },
  plum: { size: [3.51,2.41,2.7], y: 4.76, ink: ['#624953','#985959','#cd8676'] },
  birch: { size: [2.33,3.15,2.84], y: 7.42, ink: ['#596f5a','#98a859','#d1cb79'] },
};

function oilTree(seed: number, kind: keyof typeof crownProfiles, lowSpec: boolean) {
  const b = new OilBody(), rng = new Rng(seed);
  const profile = crownProfiles[kind], [rx, ry, rz] = profile.size;
  const [cool, body, warm] = profile.ink.map(c => new THREE.Color(c));
  if (kind !== 'birch') {
    const base = new THREE.Color('#7f7764'), bark = new THREE.Color('#b3a28a');
    const limb = (rings: number[][]) => tube(b, rings.map(([x,y,z,r]) => ({
      p: new V(x,y,z), r, c: bark.clone().lerp(base, 1 - smoothstep(0, 1.9, y)),
    })), 12);
    limb([[0,-0.26,0,0.43],[0.02,0.22,0,0.34],[-0.05,2.3,0.10,0.24],[0.17,3.9,0.13,0.18],[0.33,5.52,0.28,0.075]]);
    limb([[-0.05,2.75,0.12,0.15],[-0.56,3.53,0.13,0.11],[-1.48,4.58,-0.2,0.05]]);
    // A few planes of pale and dark cambium at driving scale.
    for (let i = 0; i < 19; i++) {
      const a = rng.range(0, TAU), y = rng.range(0.35, 2.95);
      const n = new V(Math.cos(a), 0, Math.sin(a)), r = 0.34 - y * 0.041;
      const p = new V(-0.02 + n.x*r, y, 0.045*y + n.z*r);
      b.stamp(p, new V(0.014, rng.range(0.10,0.34), -0.012),
        new V(-n.z,0,n.x).multiplyScalar(rng.range(0.022,0.060)), n,
        new THREE.Color(i % 4 === 0 ? '#7b6a60' : '#c6b698'));
    }
  }
  const centre = new V(0.1, profile.y, 0.05);
  const surface = (n: THREE.Vector3) => {
    const a = Math.atan2(n.z, n.x), h = n.y;
    const ring = Math.sqrt(Math.max(0,1-h*h));
    const shoulder = (0.12 * Math.sin(3*a + seed + 1.8*h) + 0.05 * Math.cos(6*a + seed*0.7 - 3*h)) * ring;
    const edge = noise2(3.2*n.x + h*1.8,3.3*n.z - h*1.4,seed);
    // Lower branch fans splay out on one flank, with cut-ins exposing air
    // underneath. A lifted leader gives the other shoulder a different slope.
    const fork = Math.pow(0.5 + 0.5*Math.cos(3*a+seed+1.4*h), 3);
    const waist = Math.exp(-9 * (h + 0.39) ** 2);
    const elbow = smoothstep(-0.28,0.85,n.x - 0.23*n.z);
    const lip = 0.33 * elbow * (1 - h*h);
    const radius = 1 + 1.6*shoulder + 0.16*edge + lip - 0.42*fork*waist;
    return new V(n.x*rx*radius + h*0.74,
      h*ry + (0.57*Math.sin(2*a+seed) + 0.31*Math.sin(5*a+1.7*h))*ring
        - 0.91*elbow + 0.99*fork*waist + 0.32*n.z,
      n.z*rz*radius + h*0.49).add(centre);
  };
  const tone = (n: THREE.Vector3) => {
    const field = n.y + n.x * 0.32 + n.z * 0.18 + 0.24*noise2(n.x*2+n.y*2, n.z*3, seed);
    return cool.clone().lerp(body,smoothstep(-0.37,0.0,field)).lerp(warm,0.88*smoothstep(0.27,0.68,field));
  };
  const latitude = lowSpec ? 12 : 18, longitude = lowSpec ? 22 : 30;
  for (let j = 0; j <= latitude; j++) {
    const phi = j * Math.PI / latitude;
    for (let i = 0; i < longitude; i++) {
      const a = TAU * i / longitude;
      const n = new V(Math.sin(phi)*Math.cos(a), Math.cos(phi), Math.sin(phi)*Math.sin(a));
      if (kind !== 'birch') b.vert(surface(n),n,tone(n),0.24);
    }
  }
  const first = b.pos.length / 3 - (latitude + 1) * longitude;
  for (let j = 0; kind !== 'birch' && j < latitude; j++) for (let i = 0; i < longitude; i++) {
    const a = first + longitude*j + i, d = first + longitude*j + (i+1)%longitude;
    if (j > 0) b.tri(a,d,a+longitude);
    if (j+1 < latitude) b.tri(d,d+longitude,a+longitude);
  }

  // Group brush marks along the outer surface. The lit shoulder and the
  // shadow share each tree's own light field, including the irregular fringe.
  // Birch is a veil of paint around its white leader. Irregular groups of
  // suspended marks leave passages through the crown to the meadow behind.
  const count = kind === 'birch' ? (lowSpec ? 430 : 650) : (lowSpec ? 125 : 180);
  const rake = new V(0.71,0.46,-0.38).normalize();
  for (let i = 0; i < count; i++) {
    const h = 1 - 2*(i+0.5)/count, a = i*2.39996 + seed;
    const r = Math.sqrt(1-h*h);
    const n = new V(Math.cos(a)*r,h,Math.sin(a)*r);
    const along = rake.clone().addScaledVector(n,-rake.dot(n));
    if (along.lengthSq() < 0.03) along.set(-n.z,0,n.x);
    along.normalize().applyAxisAngle(n,0.36*Math.sin(2*a + 3*h + seed) + rng.range(-0.17,0.17));
    const cross = n.clone().cross(along).normalize();
    const p = surface(n);
    const birch = kind === 'birch';
    if (birch) {
      const space = noise2(n.x*1.5+h*2.1,n.z*2.3,seed);
      if (space < -0.22 && h < 0.42) continue;
      p.lerp(centre,rng.range(0.02,0.56));
    } else {
      p.addScaledVector(n,rng.range(0.008,0.10));
      if (n.y < -0.38 && noise2(n.x*2,n.z*2,seed) < 0.16) continue;
    }
    const s = birch ? rng.range(0.31,0.84) : rng.range(0.32,0.82);
    const pigment = tone(n).multiplyScalar(rng.range(0.90,1.10));
    b.stamp(p,along.multiplyScalar(s),cross.multiplyScalar(s*rng.range(0.53,0.81)),n,pigment);
  }
  return b.build();
}

// Felled slabs sit on a common dipping bed, with a long top plane and
// shorter end break. Duplicate face vertices preserve the plane changes.
function oilStone(variant: number) {
  const b = new Builder(), rng = new Rng(919 + variant);
  const cap = new THREE.Color('#c7bca3'), side = new THREE.Color('#928795'), foot = new THREE.Color('#767c65');
  const outline = [[-0.95,-0.53],[-0.60,-0.96],[0.60,-0.93],[0.96,-0.36],[0.82,0.74],[0.18,1.0],[-0.82,0.85]];
  const slab = (cx: number, cz: number, w: number, l: number, h: number) => {
    const rim = outline.map(([x,z]) => new V(cx+x*w*rng.range(0.90,1.04), 0, cz+z*l*rng.range(0.89,1.06)));
    for (const p of rim) p.y = h + 0.23*(p.x-cx) - 0.116*(p.z-cz);
    const centre = new V(cx,h,cz), up = new V(-0.23,1,0.116).normalize();
    // The eroded bevel is narrow on the broken end, broad on the
    // weather-facing shoulder. Keep the sloping top and rim continuous.
    const shoulder = rim.map(p => p.clone().lerp(centre,rng.range(0.14,0.32)));
    const lip = rim.map(p => p.clone().setY(p.y - h*rng.range(0.21,0.40)));
    const lower = rim.map(p => new V(cx+(p.x-cx)*1.12-0.06, -0.26, cz+(p.z-cz)*1.14+0.03));
    for (let i = 0; i < rim.length; i++) {
      const j = (i+1)%rim.length;
      const k = b.vert(centre,up,cap);
      b.vert(shoulder[j],up,cap); b.vert(shoulder[i],up,cap); b.tri(k,k+1,k+2);
      const strip = (lo: THREE.Vector3[], hi: THREE.Vector3[], bottom: THREE.Color, top: THREE.Color) => {
        const n = hi[i].clone().sub(lo[i]).cross(hi[j].clone().sub(lo[i])).normalize();
        const f = b.vert(lo[i],n,bottom);
        b.vert(hi[i],n,top); b.vert(hi[j],n,top); b.vert(lo[j],n,bottom);
        b.tri(f,f+1,f+2); b.tri(f,f+2,f+3);
      };
      const broken = side.clone().lerp(cap,0.22 + 0.12*Math.sin(2*i+variant));
      strip(lip,shoulder,broken,cap);
      strip(lower,lip,foot,broken);
    }
  };
  const h = [0.54,0.66,0.34][variant];
  slab(-0.16,-0.19,0.65,1.09,h);
  slab(0.39,0.25,0.47,0.88,h*0.68);
  slab(0.70,0.55,0.37,0.69,h*0.39);
  return b.build();
}

export function createOilLibrary(lowSpec: boolean) {
  return {
    oak: [oilTree(11,'oak',lowSpec),oilTree(12,'oak',lowSpec)],
    lime: [oilTree(21,'lime',lowSpec),oilTree(22,'lime',lowSpec)],
    plum: [oilTree(31,'plum',lowSpec)],
    fir: [makeConifer(41),makeConifer(42)],
    birch: [oilTree(53,'birch',lowSpec)],
    bush: [paintedShrub(61,false,lowSpec),paintedShrub(62,false,lowSpec)],
    bloom: [paintedShrub(71,true,lowSpec)],
    rock: [oilStone(0),oilStone(1),oilStone(2)],
  };
}

// Drag broad marks across each surface in object space. All three scales
// use mipmapped paint, so moving the camera leaves the strokes in place.
const oilPigment = /* glsl */ `
  vec2 face = vec2(vPigment.x + vPigment.z*0.61, vPigment.y + 0.36*vPigment.z - 0.18*vPigment.x);
  vec4 broad = texture2D(uNoise, face * vec2(0.10,0.14));
  vec2 flow = face + 0.16*(broad.rg-0.5);
  vec4 drag = texture2D(uNoise, flow * vec2(0.12,0.12));
  vec2 strokes = texture2D(uStrokes,flow * vec2(0.083,0.12)).rg;
  float shoulder = smoothstep(0.34,0.63,broad.r + 0.16*(drag.a-0.5));
  diffuseColor.rgb *= mix(vec3(0.81,0.87,1.01),vec3(1.10,1.03,0.91),shoulder);
  diffuseColor.rgb *= 1.0 + (drag.a-0.5)*0.17 - 0.11*strokes.r + 0.13*strokes.g;
`;

export function oilMaterials(shared: PaintShared, swayVertex: string) {
  const vertexPars = 'varying vec3 vPigment;';
  const vertexMain = 'vPigment = position;';
  const foliage = paintMaterial(new THREE.MeshLambertMaterial({
    map: oilBrushes(), vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.4, alphaToCoverage: true,
  }), shared, { key: 'oil-foliage', vertexPars: vertexPars + 'attribute float aSway;',
    vertexMain: vertexMain + swayVertex, fragPars: vertexPars, fragColor: oilPigment, lensFade: true, volumeNormals: true });
  const stone = paintMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), shared,
    { key: 'oil-stone', vertexPars, vertexMain, fragPars: vertexPars, fragColor: oilPigment + `
      float moss = (1.0-smoothstep(0.02,0.22,vPigment.y + 0.15*(broad.g-0.5)));
      diffuseColor.rgb = mix(diffuseColor.rgb,vec3(0.28,0.30,0.14),0.55*moss);
      float scrape = smoothstep(0.58,0.80,drag.a) * smoothstep(0.43,0.61,broad.r);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.63,0.56,0.43), 0.30*scrape);
    ` });
  return { foliage, stone };
}
