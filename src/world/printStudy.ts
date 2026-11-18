import * as THREE from 'three';
import { Rng } from '../core/rng';
import { paintMaterial, type PaintShared } from '../render/paint';
import { Builder, tube } from './flora';

const V = THREE.Vector3;
const UP = new V(0, 1, 0);
const TAU = Math.PI * 2;
type Species = 'oak' | 'lime' | 'plum' | 'birch';

const foliage = {
  oak: '#528258', lime: '#839a52', plum: '#ab6359', birch: '#91a455',
  fir: '#407d6d', thorn: '#597e56',
};
const ink = (hex: string) => new THREE.Color(hex);

class Block extends Builder {
  // 0: wood, 1: leaves, 2: stone. Vertex colours carry each block's middle ink.
  surface = 0;
  private surfaces: number[] = [];
  override vert(p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color, sway = 0) {
    this.surfaces.push(this.surface);
    return super.vert(p, n, c, sway);
  }
  override build() {
    const geometry = super.build();
    geometry.setAttribute('aSurface', new THREE.Float32BufferAttribute(this.surfaces, 1));
    return geometry;
  }
}

// A single carved leaf with a bellied stroke and a pinched end. Its wide
// central facet stays legible when a twig passes the camera at speed.
function leaf(b: Block, p: THREE.Vector3, along: THREE.Vector3, wing: THREE.Vector3,
  n: THREE.Vector3, pigment: THREE.Color, sway: number) {
  const outline = [[0,0],[0.20,-0.65],[0.55,-0.94],[0.83,-0.49],[1,0.15],[0.61,0.93],[0.27,0.86]];
  const first = b.pos.length / 3;
  for (const [u, v] of outline) {
    const at = p.clone().addScaledVector(along, u).addScaledVector(wing, v);
    at.y += 0.09 * Math.sin(Math.PI * u) * along.length();
    b.vert(at, n, pigment, sway);
  }
  for (let i = 1; i < outline.length - 1; i++) b.tri(first, first + i, first + i + 1);
}

function bole(b: Block, path: number[][], colour: string) {
  b.surface = 0;
  tube(b, path.map(([x,y,z,r]) => ({p: new V(x,y,z), r, c: ink(colour)})), 9);
}

// Outline lobes and low skirts are cut into a connected crown. Detached
// impressions sit on short outer shoots, with real windows between them.
function canopy(b: Block, rng: Rng, centre: THREE.Vector3, size: THREE.Vector3,
  kind: Species, lean: number) {
  const pigment = ink(foliage[kind]);
  b.surface = 1;
  const phase = rng.range(0, TAU);
  const slender = kind === 'birch';
  const segments = 44, belts = 14;
  const surface = (angle: number, latitude: number) => {
    const h = Math.sin(latitude), r = Math.cos(latitude);
    const scallop = 0.5 + 0.5 * Math.cos(6 * angle + 1.15 * Math.sin(3 * angle + phase) + phase + h * 1.3);
    const bite = Math.pow(1 - scallop, 5);
    const radius = r * (1 + 0.22 * Math.sin(3 * angle + phase + h * 1.25)
      + 0.08 * Math.cos(5 * angle - h) - bite * 0.13
      + 0.025 * Math.sin(14 * angle + 4 * h));
    const x = radius * Math.cos(angle), z = radius * Math.sin(angle);
    const y = h + r * (0.09 * Math.cos(2 * angle + phase) + 0.19 * bite
      - 0.16 * scallop * (1 - h)) + 0.10 * x;
    const body = slender ? 0.53 : 0.64;
    const point = new V(x * size.x * body + lean * h, (0.30 + y * 0.67) * size.y,
      z * size.z * body).add(centre);
    const normal = new V(x, 1.22 * h + 0.08, z).normalize();
    return {point, normal};
  };
  const start = b.pos.length / 3;
  for (let j = 0; j <= belts; j++) {
    const lat = Math.PI * (j / belts - 0.5);
    for (let i = 0; i < segments; i++) {
      const {point, normal} = surface(i * TAU / segments, lat);
      b.vert(point, normal, pigment, 0.23);
    }
  }
  for (let j = 0; j < belts; j++) for (let i = 0; i < segments; i++) {
    const a = start + j * segments + i, d = start + j * segments + (i + 1) % segments;
    b.tri(a, a + segments, d + segments);
    b.tri(a, d + segments, d);
  }

  // The lower crown is a fan of independently hung boughs. Leave real
  // air between the light-leaking slots and the high central shoulder.
  const groups = slender ? 11 : 13;
  for (let g = 0; g < groups; g++) {
    const a = phase + g * 2.39996 + rng.range(-0.12, 0.12);
    const radial = new V(Math.cos(a), 0, Math.sin(a));
    const side = new V(-radial.z, 0, radial.x);
    const tier = g / (groups - 1);
    const reach = (1.10 - 0.40 * tier + 0.12 * Math.sin(a * 3 + phase))
      * Math.hypot(size.x * radial.x, size.z * radial.z);
    const spread = reach * rng.range(slender ? 0.20 : 0.25, slender ? 0.33 : 0.48);
    const rootY = centre.y + size.y * (tier * 0.87 - 0.19);
    const droop = size.y * rng.range(slender ? 0.55 : 0.23, slender ? 0.94 : 0.61);
    const bend = reach * rng.range(-0.26, 0.27);
    const run = [0, 0.18, 0.32, 0.43, 0.55, 0.65, 0.78, 0.84, 0.94, 1.0];
    const widths = [0.16, 0.57, 0.86, 1, 0.65, 0.98, 0.74, 0.38, 0.54, 0.08];
    const first = b.pos.length / 3;
    for (let k = 0; k < run.length; k++) {
      const t = run[k];
      const rib = centre.clone().addScaledVector(radial,reach*(0.13+0.93*t))
        .addScaledVector(side,bend*t*t);
      rib.y = rootY + size.y * 0.15 * Math.sin(Math.PI*t) - droop*t*t;
      const n = radial.clone().multiplyScalar(0.27+0.72*t).setY(0.54+0.53*tier-0.66*t).normalize();
      const width = spread * widths[k];
      const thickness = size.y * (slender ? 0.14 : 0.22) * widths[k];
      const crest = rib.clone().setY(rib.y+thickness);
      const left = rib.clone().addScaledVector(side,-width);
      const right = rib.clone().addScaledVector(side,width*(0.86+0.14*Math.sin(7*t+a)));
      right.y -= 0.12*width;
      for (const p of [left,crest,right,rib.clone().setY(rib.y-thickness*0.40)]) {
        b.vert(p,n,pigment,0.23);
      }
      if (k > 0) for (let face = 0; face < 4; face++) {
        const idx = first + (k-1)*4, next = (face+1)%4;
        b.tri(idx+face,idx+4+face,idx+4+next);
        b.tri(idx+face,idx+4+next,idx+next);
      }
    }
    // A few pointed end impressions spring from the edges of the hanging plate.
    for (let k = 0; k < 3; k++) {
      const t = 0.69 + k * 0.105;
      const wing = (k%2 ? -1 : 1);
      const origin = centre.clone().addScaledVector(radial, reach*(0.13+0.93*t))
        .addScaledVector(side,bend*t*t + wing*spread*0.32);
      origin.y = rootY + size.y*0.15*Math.sin(Math.PI*t) - droop*t*t;
      const tip = radial.clone().multiplyScalar(0.22*reach).addScaledVector(side,wing*spread*0.56);
      tip.y = -droop*0.48;
      leaf(b,origin,tip,side.clone().multiplyScalar(0.15*spread),radial,pigment,0.23);
    }
  }
}

function tree(seed: number, kind: Species) {
  const b = new Block(), rng = new Rng(seed);
  if (kind === 'birch') {
    // The separately instanced bark follows the existing three-limbed birch.
    canopy(b,rng,new V(0.33,7.31,0.36),new V(1.70,2.64,1.95),kind,0.39);
    canopy(b,rng,new V(-0.48,5.34,-2.0),new V(1.29,1.34,1.46),kind,0.23);
  } else {
    const wood = kind === 'plum' ? '#826855' : '#877952';
    bole(b,[[0,-0.32,0,0.44],[0.06,0.27,0,0.34],[-0.10,2.63,0.08,0.24],[0.39,4.34,0.13,0.18],[0.63,6.33,-0.12,0.06]],wood);
    bole(b,[[-0.06,2.79,0.08,0.15],[-0.86,3.62,-0.07,0.095],[-1.29,4.48,-0.20,0.03]],wood);
    const size = kind === 'lime' ? new V(2.9,3.23,2.58) : kind === 'plum' ? new V(3.18,2.10,2.58) : new V(3.91,2.51,3.03);
    const height = kind === 'lime' ? 6.13 : kind === 'oak' ? 5.72 : 4.95;
    canopy(b,rng,new V(0.07,height,-0.08),size,kind,rng.range(0.19,0.62));
  }
  return b.build();
}

function fir(seed: number) {
  const rng = new Rng(seed), b = new Block();
  const height = rng.range(11.1,12.4);
  bole(b,[[0,-0.25,0,0.28],[-0.10,2.0,0.02,0.24],[0.16,height*0.67,0,0.13],[0.26,height,0.05,0.025]],'#796e54');
  b.surface = 1;
  const pigment = ink(foliage.fir);
  // Each bough is one folded, notched silhouette; lower boughs are sparse
  // enough for their tips to overlap sky on the far side of the leader.
  for (let j = 0; j < 47; j++) {
    const t = j / 47, a = 2.39996 * j + seed;
    const r = (3.28 - 3.15 * t) * rng.range(0.81,1.12);
    const radial = new V(Math.cos(a),0,Math.sin(a));
    const across = new V(-radial.z,0,radial.x);
    const root = new V(0.26*t,2.1+(height-2.1)*t,0);
    const axis = radial.clone().multiplyScalar(r);
    const n = radial.clone().multiplyScalar(0.7).add(UP).normalize();
    const first = b.pos.length / 3;
    for (const [reach,width,fall] of [[0,0,0],[0.36,-0.26,0.09],[0.77,-0.32,0.37],[0.67,-0.11,0.23],[1,0,0.42],[0.76,0.14,0.25],[0.82,0.27,0.36],[0.31,0.25,0.05],[0.43,0,-0.12]]) {
      const p = root.clone().addScaledVector(axis,reach).addScaledVector(across,width*r);
      p.y -= fall * (r + 0.25);
      b.vert(p,n,pigment,0.28);
    }
    for (let k=0;k<8;k++) b.tri(first+8,first+k,first+(k+1)%8);
  }
  return b.build();
}

function shrub(seed: number, bloom: boolean) {
  const rng = new Rng(seed), b = new Block(), pigment = ink(foliage.thorn), flower = ink('#ead49b');
  for (let i=0;i<8;i++) {
    const a = i*2.39996 + seed, length = rng.range(0.62,1.42);
    const radial = new V(Math.cos(a),0,Math.sin(a)), side = new V(-radial.z,0,radial.x);
    const height = rng.range(0.76,1.34);
    const locus = (t: number) => radial.clone().multiplyScalar(length*t).setY(height*(2.35*t-1.55*t*t));
    b.surface = 0;
    tube(b,[0,0.38,0.75,1].map(t=>({p:locus(t),r:0.038-0.031*t,c:ink('#665d42')})),5);
    b.surface = 1;
    for (let k=0;k<9;k++) {
      const t = 0.29+k*0.088, sign = k%2 ? -1 : 1;
      const extent = length*(0.40-0.17*t);
      const direction = side.clone().multiplyScalar(sign*extent).addScaledVector(radial,0.18);
      direction.y = rng.range(0.07,0.17);
      const wing = radial.clone().multiplyScalar(0.10+0.03*Math.sin(Math.PI*t));
      wing.y = rng.range(0.02,0.095);
      leaf(b,locus(t),direction,wing,new V(radial.x,0.2+t,radial.z).normalize(),pigment,0.20);
    }
    if (bloom && i%3===0) {
      const p = locus(0.89);
      for (let petal=0;petal<4;petal++) {
        const a = petal*Math.PI/2;
        leaf(b,p,new V(Math.cos(a)*0.09,0.045,Math.sin(a)*0.09),new V(-Math.sin(a)*0.042,0.018,Math.cos(a)*0.042),UP,flower,0.20);
      }
    }
  }
  return b.build();
}

function stone(variant: number) {
  const b = new Block(), rng = new Rng(910 + variant);
  b.surface = 2;
  const stoneInk = ink('#82949a');
  // Split slabs share one sloping bed line. Top and vertical break meet in
  // a clean edge, even when this footprint is reduced to a few screen pixels.
  const slab = (x:number,z:number,w:number,l:number,h:number) => {
    const outline = [[-1,-0.43],[-0.64,-0.85],[0.48,-1],[0.91,-0.72],[0.96,0.24],[0.36,0.93],[-0.60,0.82],[-0.98,0.51]];
    const top = outline.map(([u,v]) => new V(x+w*u, h*(0.85+0.17*u-0.13*v), z+l*v));
    const foot = top.map(p => new V(x+(p.x-x)*rng.range(1.00,1.13)+0.09,-0.27,z+(p.z-z)*1.09));
    const face = (points: THREE.Vector3[], colour: THREE.Color) => {
      const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize();
      const first = b.pos.length / 3;
      for (const point of points) b.vert(point,normal,colour);
      for (let k=1; k+1<points.length; k++) b.tri(first,first+k,first+k+1);
    };
    const cap = ink('#a9b4ad'), shelf = ink('#899e9f'), split = ink('#566f7b');
    // Saw one oblique step clear across the cap. Its vertical riser and the
    // lower landing are visible from above as well as on the approach.
    const bedLine = (p: THREE.Vector3) => (p.z-z)/l + 0.54*(p.x-x)/w - 0.11;
    const upper: THREE.Vector3[] = [], lower: THREE.Vector3[] = [];
    const riser: THREE.Vector3[] = [];
    for (let i=0;i<top.length;i++) {
      const a=top[i], c=top[(i+1)%top.length], da=bedLine(a), dc=bedLine(c);
      (da<0 ? lower : upper).push(a);
      if ((da<0)!==(dc<0)) {
        const cut=a.clone().lerp(c,da/(da-dc));
        lower.push(cut); upper.push(cut); riser.push(cut);
      }
    }
    const onLanding = (p: THREE.Vector3) => p.clone().setY(p.y-0.29*h);
    face(upper.slice().reverse(),cap);
    face(lower.map(onLanding).reverse(),shelf);
    face([riser[0],riser[1],onLanding(riser[1]),onLanding(riser[0])],split);
    for (let i=0;i<top.length;i++) {
      const end=(i+1)%top.length;
      const a=top[i], c=top[end], da=bedLine(a), dc=bedLine(c);
      const wall = (p:THREE.Vector3,q:THREE.Vector3,loP:THREE.Vector3,loQ:THREE.Vector3,onShelf:boolean) => {
        const hiP=onShelf ? onLanding(p) : p, hiQ=onShelf ? onLanding(q) : q;
        face([hiP,hiQ,loQ,loP],stoneInk);
      };
      if ((da<0)===(dc<0)) wall(a,c,foot[i],foot[end],da<0);
      else {
        const t=da/(da-dc), cut=a.clone().lerp(c,t), base=foot[i].clone().lerp(foot[end],t);
        wall(a,cut,foot[i],base,da<0); wall(cut,c,base,foot[end],dc<0);
      }
    }
  };
  const rise = [0.54,0.65,0.40][variant];
  slab(-0.19,-0.05,0.56+variant*0.08,1.12,rise);
  slab(0.49,0.17,0.32,0.73,rise*0.52);
  slab(-0.58,0.61,0.28,0.54,rise*0.35);
  return b.build();
}

export function printTuft(seed: number) {
  const b = new Block(), rng = new Rng(seed), white = ink('#fff8d9');
  for (let j=0;j<4;j++) {
    const h = rng.range(0.14,0.32);
    const p = new V(j*0.092-0.18,0,rng.range(-0.10,0.10));
    leaf(b,p,new V(h*(0.26+0.45*j),h,rng.range(-0.10,0.08)),new V(0.034,0.004,0.031),UP,white,0.28);
  }
  return b.build();
}

export function createPrintLibrary() {
  return {
    oak: [tree(11,'oak'),tree(12,'oak')], lime: [tree(21,'lime'),tree(22,'lime')],
    plum: [tree(31,'plum')], fir: [fir(41),fir(42)], birch: [tree(352,'birch')],
    bush: [shrub(61,false),shrub(62,false)], bloom: [shrub(71,true)],
    rock: [stone(0),stone(1),stone(2)],
  };
}

export function createPrintMaterial(shared: PaintShared, swayVertex: string) {
  return paintMaterial(new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide}),shared,{
    key:'relief-print-blocks', lensFade:true,
    vertexPars:'attribute float aSway, aSurface; varying float vSurface, vKey; varying vec3 vBlock;',
    vertexMain: `
      ${swayVertex}
      vSurface = aSurface;
      vBlock = position;
      vec3 outward = normal;
      #ifdef USE_INSTANCING
        outward = mat3(instanceMatrix) * outward;
      #endif
      vKey = dot(normalize(mat3(modelMatrix) * outward), vec3(0.50,0.49,-0.75));
    `,
    fragPars:'varying float vSurface, vKey; varying vec3 vBlock;',
    fragLight: `
      vec2 grainUV = vec2(vBlock.x * 0.77 + vBlock.z * 0.49, vBlock.y + vBlock.z * 0.24);
      vec4 grain = texture2D(uNoise,grainUV*0.095);
      float wood = 1.0-step(0.5,vSurface), stone = step(1.5,vSurface);
      float edge = vKey + (grain.g-0.5)*mix(0.55,0.025,stone);
      float feather = max(0.008, fwidth(edge));
      float mid = smoothstep(-0.23-feather,-0.23+feather,edge);
      float sun = smoothstep(0.46-feather,0.46+feather,edge);
      vec3 pigment = diffuseColor.rgb;
      vec3 shadeInk = pigment*vec3(0.35,0.48,0.60) + vec3(0.010,0.025,0.034);
      vec3 sunInk = mix(pigment, vec3(0.74,0.73,0.34),0.36);
      sunInk = mix(sunInk,vec3(0.51,0.59,0.55),stone);
      vec3 printInk = mix(mix(shadeInk,pigment,mid),sunInk,sun);

      // Occasional gouges expose the next ink along a boundary. They sit on
      // the object, and the print's mip chain softens them into its main value.
      vec2 gougeUV = mix(grainUV*vec2(0.14,0.26),grainUV*vec2(0.18,0.69),stone);
      float cut = texture2D(uStrokes,gougeUV).r;
      float cuts = smoothstep(0.23,0.46,cut) * smoothstep(0.46,0.67,grain.r) * (1.0-sun);
      printInk = mix(printInk, mix(pigment,sunInk,0.57),cuts*(1.0-wood)*0.78);
      float nick = texture2D(uNoise,grainUV*vec2(0.94,0.19)).r;
      printInk = mix(printInk,shadeInk,wood*smoothstep(0.71,0.78,nick)*0.72);

      // Keep the flat overprint across the curved hull and let cast shadows
      // and the slow cloud shadow ground it alongside the terrain.
      float direct = dot(reflectedLight.directDiffuse,vec3(0.28,0.58,0.14)) /
                     max(dot(pigment,vec3(0.28,0.58,0.14)),0.005);
      reflectedLight.directDiffuse = printInk*(0.88+0.12*clamp(direct,0.0,1.0));
      reflectedLight.indirectDiffuse = vec3(0.0);
    `,
  });
}
