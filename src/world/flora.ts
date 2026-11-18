import * as THREE from 'three';
import { Rng } from '../core/rng';
import { noise2, smoothstep } from '../core/noise';

const V = THREE.Vector3;
const UP = new V(0, 1, 0);
const C = (hex: string) => new THREE.Color(hex);

export class Builder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  sway: number[] = [];
  idx: number[] = [];

  vert(p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color, sway = 0): number {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.col.push(c.r, c.g, c.b);
    this.sway.push(sway);
    return this.pos.length / 3 - 1;
  }
  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sway, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const ICO = [new THREE.IcosahedronGeometry(1, 0), new THREE.IcosahedronGeometry(1, 1), new THREE.IcosahedronGeometry(1, 2)];

/** Lumpy ellipsoid with smooth outward normals. */
export function blob(b: Builder, c: THREE.Vector3, radii: THREE.Vector3, detail: number, lump: number, seed: number, colorAt: (dir: THREE.Vector3, p: THREE.Vector3) => THREE.Color, sway = 0) {
  const src = ICO[detail].getAttribute('position');
  const p = new V(), d = new V();
  for (let i = 0; i < src.count; i += 3) {
    const ids: number[] = [];
    for (let k = 0; k < 3; k++) {
      d.fromBufferAttribute(src, i + k).normalize();
      const f = 1 + lump * noise2(d.x * 1.9 + d.y * 1.3 + seed, d.z * 1.9 - d.y * 0.7 + seed * 0.37, 7);
      p.copy(d).multiply(radii).multiplyScalar(f).add(c);
      ids.push(b.vert(p, d, colorAt(d, p), sway));
    }
    b.tri(ids[0], ids[1], ids[2]);
  }
}

/** Tapered tube through a list of rings — trunks and branches. */
export function tube(b: Builder, rings: { p: THREE.Vector3; r: number; c: THREE.Color }[], sides: number) {
  const base: number[] = [];
  const n = new V(), p = new V();
  rings.forEach((ring, ri) => {
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2 + ri * 0.3;
      n.set(Math.cos(a), 0.15, Math.sin(a)).normalize();
      p.set(ring.p.x + Math.cos(a) * ring.r, ring.p.y, ring.p.z + Math.sin(a) * ring.r);
      const i = b.vert(p, n, ring.c, 0);
      if (s === 0) base.push(i);
    }
  });
  for (let ri = 0; ri < rings.length - 1; ri++) for (let s = 0; s < sides; s++) {
    const a = base[ri] + s, a2 = base[ri] + ((s + 1) % sides), c = base[ri + 1] + s, c2 = base[ri + 1] + ((s + 1) % sides);
    b.tri(a, c, a2);
    b.tri(a2, c, c2);
  }
}

// Four mipmapped cells: solid pigment for wood and crown interiors, a leafy
// margin, a flat fir bough and a flowering-thorn shoot. Transparent gutters
// keep neighbouring impressions apart as the camera pulls away.
export function woodlandBrushes() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const rng = new Rng(830);
  ctx.fillStyle = 'white';
  ctx.fillRect(0,128,128,128);
  for (let cell=1; cell<=3; cell++) {
    ctx.save();
    ctx.translate(64+128*(cell%2),64+128*(cell<2 ? 1 : 0));
    const mark = (x:number, y:number, rx:number, ry:number, angle:number, grey:number) => {
      ctx.fillStyle = `rgb(${grey},${grey},${grey})`;
      ctx.beginPath();
      ctx.ellipse(x,y,rx,ry,angle,0,Math.PI*2);
      ctx.fill();
    };
    ctx.lineWidth = cell === 2 ? 3.4 : 2.3;
    ctx.strokeStyle = '#c3c3c3';
    ctx.beginPath(); ctx.moveTo(-47,7); ctx.quadraticCurveTo(2,-9,46,-2); ctx.stroke();
    if (cell === 1) {
      for (let i=0;i<49;i++) {
        const a=rng.range(0,6.28), r=Math.sqrt(rng.next());
        const x=Math.cos(a)*r*45, y=Math.sin(a)*r*36;
        mark(x,y, rng.range(6,13),rng.range(3.7,7.4),0.42+0.006*x,rng.int(220,255));
      }
    } else {
      const pairs = cell === 2 ? 21 : 7;
      for (let i=0;i<pairs;i++) for (const sign of [-1,1]) {
        const t=(i+rng.range(-0.25,0.25))/pairs, x=-44+85*t;
        const spread=(cell === 2 ? 27 : 19)*(0.42+0.65*Math.sin(t*Math.PI));
        const endX=x+10+9*t, endY=-2+spread*sign;
        const angle=Math.atan2(endY+2,endX-x);
        mark((endX+x)/2,endY/2-1,Math.hypot(endX-x,endY+2)*0.61,
          cell === 2 ? rng.range(3,5.5) : rng.range(6,9),angle,rng.int(216,254));
      }
    }
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

class Woodland extends Builder {
  private uv: number[] = [];
  override vert(p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color, sway = 0) {
    this.uv.push(0.25,0.25);
    return super.vert(p,n,c,sway);
  }
  impression(p: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3, cell: number, normal: THREE.Vector3, ink: THREE.Color) {
    const k = this.pos.length / 3;
    for (const [x,y] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
      super.vert(p.clone().addScaledVector(u,x).addScaledVector(v,y),normal,ink,0.32);
      this.uv.push((cell%2 + 0.5 + 0.49*x)*0.5,(Math.floor(cell/2)+0.5+0.49*y)*0.5);
    }
    this.tri(k,k+1,k+2); this.tri(k,k+2,k+3);
  }
  override build() {
    const g = super.build();
    g.setAttribute('uv',new THREE.Float32BufferAttribute(this.uv,2));
    return g;
  }
}

type TreeKind = 'oak' | 'lime' | 'plum';

// Pigments describe the connected underside, body and lit shoulder of a spray.
const inks = {
  oak: ['#41665c', '#709153', '#abc36a'],
  lime: ['#547e66', '#9db664', '#ccce79'],
  plum: ['#754859', '#a5575b', '#cf8070'],
  fir: ['#345c59', '#528473', '#91af81'],
  thorn: ['#436e62', '#73905a', '#acb975'],
};

function branch(b: Builder, points: number[][], dark: THREE.Color, light: THREE.Color) {
  tube(b, points.map(([x,y,z,r], i) => ({ p: new V(x,y,z), r, c: i === 0 ? dark : light })), 7);
}

/** One continuous gouache mass with scallops around its rim. Its small satellite
 * marks share the parent's lighting, so they don't turn into a ring of beads. */
function spray(b: Woodland, rng: Rng, centre: THREE.Vector3, size: THREE.Vector3, ink: THREE.Color[], lowSpec: boolean) {
  const seed = rng.range(0, 70);
  const shade = (d: THREE.Vector3) => {
    const t = d.y + d.x * 0.19 + 0.14 * Math.sin(4 * d.z + seed);
    return ink[0].clone().lerp(ink[1], smoothstep(-0.65, 0.10, t))
      .lerp(ink[2], 0.78 * smoothstep(0.24, 0.80, t));
  };
  blob(b, centre, size.clone().multiplyScalar(0.92), 2, 0.22, seed, shade, 0.23);
  const count = Math.ceil(size.x * size.z * (lowSpec ? 13 : 21));
  for (let i = 0; i < count; i++) {
    const a = i * 2.39996 + seed, h = 1 - (2*i+1)/count;
    const r = Math.sqrt(1-h*h);
    const d = new V(Math.cos(a)*r,h,Math.sin(a)*r);
    const wobble = 0.09 * Math.sin(3*a + 2*h + seed) + 0.07 * Math.cos(5*a-h);
    const p = d.clone().multiply(size).multiplyScalar(0.99+wobble).add(centre);
    const u = new V(-Math.sin(a),rng.range(-0.32,0.32),Math.cos(a)).normalize();
    const v = d.clone().cross(u).normalize().applyAxisAngle(u,rng.range(-0.46,0.46));
    const scale = rng.range(0.34,0.59) * Math.sqrt(size.x);
    b.impression(p,u.multiplyScalar(scale),v.multiplyScalar(scale*0.78),1,d,shade(d));
  }
}

// Branch tips in metres, followed by the three crown radii. Leaving one
// unfilled wedge between arms gives each species a readable fork in silhouette.
const canopies: Record<TreeKind, number[][]> = {
  oak: [[-2.7,4.5,0.2,2.35,1.25,2.05],[2.2,5.4,0.9,2.9,1.62,2.4],
    [0.9,6.85,-1.2,2.85,1.8,2.05],[-1.2,5.6,-1.65,1.9,1.24,1.66],[2.8,4.35,-1.15,1.4,0.76,1.35]],
  lime: [[-1.5,4.8,-0.75,1.76,1.52,1.8],[1.15,5.8,0.65,2.2,2.12,2.0],
    [-0.55,7.35,0.2,2.05,2.12,1.88],[0.55,8.65,-0.2,1.39,1.43,1.33]],
  plum: [[-2.0,3.65,0.15,1.95,1.0,1.55],[1.4,4.65,1.35,2.35,1.4,1.95],
    [0.2,6.0,-0.65,2.6,1.48,2.0],[2.85,4.95,-0.9,1.36,0.84,1.32]],
};

export function makeBroadleaf(seed: number, kind: TreeKind, lowSpec: boolean) {
  const rng = new Rng(seed), b = new Woodland(), ink = inks[kind].map(C);
  const dark = C('#625147'), wood = C('#90735a');
  branch(b, [[0,-0.3,0,0.48],[0.15,0.5,0.02,0.36],[-0.16,2.1,0.12,0.25],[0.39,3.8,0.05,0.16]], dark, wood);
  for (const [x,y,z,rx,ry,rz] of canopies[kind]) {
    const tip = new V(x + rng.range(-0.27, 0.27), y, z + rng.range(-0.27, 0.27));
    branch(b, [[-0.14,2.0,0.12,0.22],[x * 0.43,y * 0.71,z * 0.34,0.15],[tip.x,y,tip.z,0.048]], dark, wood);
    spray(b, rng, tip, new V(rx,ry,rz), ink, lowSpec);
  }
  return b.build();
}

export function makeConifer(seed: number) {
  const rng = new Rng(seed), b = new Woodland(), ink = inks.fir.map(C);
  const height = rng.range(11, 13), wood = C('#866e59');
  branch(b, [[0,-0.3,0,0.34],[0,1.6,0.04,0.23],[-0.16,height*0.6,0,0.12],[0.24,height,0,0.025]], C('#5a4c40'), wood);
  // Alternate long and short boughs around the leader. Each has a raised
  // shoulder and an outboard tip, with sky showing between the lower boughs.
  for (let j = 0; j < 43; j++) {
    const t = j / 43, a = j * 2.39996 + seed;
    const reach = (3.15 - 2.73*t) * rng.range(0.83,1.08);
    const y = 2.1 + t*(height-2.0);
    const radial = new V(Math.cos(a),0,Math.sin(a));
    const across = new V(-radial.z,0,radial.x);
    const n = radial.clone().multiplyScalar(0.48).add(UP).normalize();
    const base = ink[0].clone().lerp(ink[1],0.50+0.4*t);
    for (const side of [-1,0,1]) {
      const p = radial.clone().multiplyScalar(reach*(side === 0 ? 0.55 : 0.49));
      p.y = y + (side === 0 ? 0.18 : 0);
      p.addScaledVector(across,side*reach*0.16);
      const axis = radial.clone().addScaledVector(across,side*0.54).multiplyScalar(reach*0.76);
      axis.y = -(0.44 + reach*0.24);
      const wing = across.clone().multiplyScalar(reach*0.44+0.11);
      wing.y = 0.23 * side;
      b.impression(p,axis,wing,2,n,base.clone().lerp(ink[2],side===0 ? 0.23 : 0.06));
    }
  }
  return b.build();
}

// Arching thorn shoots carry overlapping pairs of leaves. Each leaf has a
// lifted tip. The brush impression carries the smaller paired leaflets.
export function paintedShrub(seed: number, flowering: boolean, lowSpec: boolean) {
  const b = new Woodland(), rng = new Rng(seed), ink = inks.thorn.map(C);
  const wood = C('#877556'), flower = C('#f0dfaf');
  const stems = lowSpec ? 8 : 11;
  for (let i = 0; i < stems; i++) {
    const a = i * 2.39996 + 0.35 * seed, length = rng.range(0.61, 1.32);
    const along = new V(Math.cos(a) * length,0,Math.sin(a) * length * 1.24 + 0.19);
    const across = new V(-along.z,0,along.x).normalize();
    const height = rng.range(0.75,1.36), rise = (t: number) => height * (2.28*t - 1.58*t*t);
    const locus = (t: number) => along.clone().multiplyScalar(t).setY(rise(t) - 0.025);
    tube(b, [0,0.32,0.67,1].map(t => ({ p: locus(t), r: 0.032 - 0.024*t, c: wood })), 5);
    for (let j = 0; j < 8; j++) {
      const t = 0.15 + j * 0.115, extent = (0.32 + 0.22*Math.sin(Math.PI*t)) * (1.18 - 0.47*t);
      for (const sign of [-1,1]) {
        const root = locus(t + 0.021*sign);
        const axis = across.clone().multiplyScalar(sign*extent).addScaledVector(along, 0.29*extent);
        axis.y = extent * rng.range(0.10,0.58);
        const wing = new V(-axis.z,0,axis.x).normalize().multiplyScalar(extent * 0.31);
        const pigment = ink[0].clone().lerp(ink[1], 0.10 + 0.68*t)
          .lerp(ink[2], 0.80 * smoothstep(0.54,1.0,root.y + 0.23 * along.x));
        const n = new V(along.x*0.54,0.65 + t*0.46,along.z*0.54).normalize();
        const centre = root.clone().addScaledVector(axis,0.48);
        wing.y = sign * extent * rng.range(0.08,0.24);
        b.impression(centre,axis.multiplyScalar(0.81),wing.multiplyScalar(1.48),3,n,pigment);
      }
    }
    if (flowering && i % 3 === 0) {
      const end = locus(0.92);
      for (let j = 0; j < 5; j++) {
        const p = end.clone().add(new V(rng.range(-0.12,0.12),rng.range(0.015,0.08),rng.range(-0.11,0.11)));
        blob(b,p,new V(0.043,0.026,0.047),0,0.14,j,() => flower,0.4);
      }
    }
  }
  return b.build();
}

/** Low bent strokes that share a prevailing lean. The wider belly catches light
 * just above the soil, leaving a finer tip against the ground behind it. */
export function makeTuft(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed), b = new Builder();
  const root = new THREE.Color(0.80, 0.84, 0.78), body = new THREE.Color(1, 1, 0.93);
  const tip = new THREE.Color(1.12, 1.1, 0.96);
  for (let i = 0; i < 6; i++) {
    const a = rng.range(-0.85, 0.85), h = rng.range(0.13, 0.38);
    const run = new V(Math.cos(a), 0, Math.sin(a)).multiplyScalar(h * rng.range(0.8, 1.45));
    const side = new V(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(rng.range(0.023, 0.043));
    const foot = new V(rng.range(-0.27, 0.27), 0, rng.range(-0.14, 0.14));
    const joint = foot.clone().addScaledVector(run, 0.39); joint.y = h * 0.72;
    const end = foot.clone().add(run); end.y = h;
    const n = new V(0.08, 1, 0.18).normalize();
    const k = b.vert(foot.clone().sub(side), n, root, 0);
    b.vert(foot.clone().add(side), n, root, 0);
    b.vert(joint.clone().addScaledVector(side, 0.66), n, body, 0.36);
    b.vert(joint.clone().addScaledVector(side, -0.66), n, body, 0.36);
    b.vert(end, n, tip, 0.67);
    b.tri(k, k+1, k+2); b.tri(k, k+2, k+3); b.tri(k+3, k+2, k+4);
  }
  return b.build();
}

/** A tiny flower head: a flat hexagonal dab. Colour comes from the instance. */
export function makeFlower(): THREE.BufferGeometry {
  const b = new Builder();
  const w = new THREE.Color(1, 1, 1);
  const p = new V();
  const c = b.vert(p.set(0, 0.02, 0), UP, w, 1);
  const ring: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2, r = i % 2 ? 1 : 0.72;
    ring.push(b.vert(p.set(Math.cos(a) * r, 0, Math.sin(a) * r), UP, w, 1));
  }
  for (let i = 0; i < 6; i++) b.tri(c, ring[(i + 1) % 6], ring[i]);
  return b.build();
}

/** Simple vertex-coloured box helper for roadside props (world-space, merged into one mesh). */
export class PropBuilder extends Builder {
  private m = new THREE.Matrix4();
  private nm = new THREE.Matrix3();
  box(sx: number, sy: number, sz: number, matrix: THREE.Matrix4, color: THREE.Color, top?: THREE.Color) {
    this.m.copy(matrix);
    this.nm.getNormalMatrix(this.m);
    const faces: [number[], number[]][] = [
      [[1, 0, 0], [0, 1, 0]], [[-1, 0, 0], [0, 1, 0]], [[0, 1, 0], [0, 0, 1]],
      [[0, -1, 0], [0, 0, 1]], [[0, 0, 1], [0, 1, 0]], [[0, 0, -1], [0, 1, 0]],
    ];
    const n = new V(), u = new V(), v = new V(), p = new V(), half = new V(sx / 2, sy / 2, sz / 2);
    for (const [fn, fu] of faces) {
      n.fromArray(fn); u.fromArray(fu); v.crossVectors(n, u);
      const wn = n.clone().applyMatrix3(this.nm).normalize();
      const ids: number[] = [];
      for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        p.copy(n).addScaledVector(u, a).addScaledVector(v, c).multiply(half).applyMatrix4(this.m);
        const localY = n.y + u.y * a + v.y * c; // upper half of the box takes the `top` colour
        ids.push(this.vert(p, wn, top && localY > 0 ? top : color, 0));
      }
      this.tri(ids[0], ids[1], ids[2]);
      this.tri(ids[0], ids[2], ids[3]);
    }
  }
}
