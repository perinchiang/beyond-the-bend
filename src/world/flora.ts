import * as THREE from 'three';
import { Rng } from '../core/rng';
import { noise2, smoothstep } from '../core/noise';

/**
 * Procedural model generators for broadleaf trees, conifers and meadow cover.
 *
 * Each broadleaf canopy is a cluster of lobes, every lobe a dark inner core
 * wrapped in hundreds of small leaf "dabs" (real polygons, no alpha textures). The dabs carry
 * volume normals (pointing out of the lobe rather than out of the card), so the whole crown
 * shades as one soft painted form while its silhouette stays stippled and organic.
 */

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

const tmpA = new V(), tmpB = new V(), tmpC = new V();

function randUnit(rng: Rng, out = new V()): THREE.Vector3 {
  const y = rng.range(-1, 1), a = rng.range(0, Math.PI * 2), r = Math.sqrt(1 - y * y);
  return out.set(Math.cos(a) * r, y, Math.sin(a) * r);
}

/** A single leaf dab: a teardrop kite (long tip, short heel) spanned by two in-plane axes. */
function leaf(b: Builder, c: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3, len: number, wid: number, shade: THREE.Vector3, color: THREE.Color, sway: number) {
  const i0 = b.vert(tmpA.copy(c).addScaledVector(u, len * 0.62), shade, color, sway);
  const i1 = b.vert(tmpA.copy(c).addScaledVector(v, wid * 0.5).addScaledVector(u, -len * 0.06), shade, color, sway);
  const i2 = b.vert(tmpA.copy(c).addScaledVector(u, -len * 0.38), shade, color, sway);
  const i3 = b.vert(tmpA.copy(c).addScaledVector(v, -wid * 0.5).addScaledVector(u, -len * 0.06), shade, color, sway);
  b.tri(i0, i1, i2);
  b.tri(i0, i2, i3);
}

function leafFacing(b: Builder, rng: Rng, c: THREE.Vector3, facing: THREE.Vector3, len: number, wid: number, shade: THREE.Vector3, color: THREE.Color, sway: number) {
  const u = randUnit(rng, tmpB).cross(facing).normalize();
  const v = tmpC.copy(facing).cross(u).normalize();
  leaf(b, c, u.clone(), v.clone(), len, wid, shade, color, sway);
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

interface Lobe { c: THREE.Vector3; r: THREE.Vector3 }

export interface FoliagePalette {
  core: string; low: string; high: string; glint: string; trunk: string; trunkDark: string;
}

export const FOLIAGE: Record<string, FoliagePalette> = {
  oak: { core: '#2c6140', low: '#3d7c46', high: '#8bb84e', glint: '#b4cf5e', trunk: '#7a5642', trunkDark: '#5a3e33' },
  lime: { core: '#4d803d', low: '#639444', high: '#b0cc5c', glint: '#d2de74', trunk: '#7a5642', trunkDark: '#5a3e33' },
  plum: { core: '#6a3547', low: '#8a4350', high: '#c46a5a', glint: '#dc8a6a', trunk: '#6d4a3a', trunkDark: '#523a30' },
  fir: { core: '#22503f', low: '#2c634a', high: '#58945a', glint: '#7eaf62', trunk: '#5e4336', trunkDark: '#47332b' },
};

function dressLobes(b: Builder, rng: Rng, lobes: Lobe[], pal: FoliagePalette, opts: { density: number; leaf: [number, number]; core: number; lump: number; swayBase: number; yMin: number; yMax: number }) {
  const core = C(pal.core), low = C(pal.low), high = C(pal.high), glint = C(pal.glint);
  const centre = new V();
  lobes.forEach((l) => centre.add(l.c));
  centre.multiplyScalar(1 / lobes.length);
  const span = Math.max(0.001, opts.yMax - opts.yMin);

  lobes.forEach((l, li) => {
    // The core carries the same light-to-dark gradient as the leaves (a shade deeper), so gaps
    // between dabs read as foliage depth rather than as a ball showing through.
    blob(b, l.c, l.r.clone().multiplyScalar(opts.core), 1, opts.lump, li * 3.7 + rng.next() * 9, (d, p) => {
      const t = (p.y - opts.yMin) / span;
      return core.clone().lerp(low, smoothstep(0.0, 0.5, t + d.y * 0.25)).lerp(high, smoothstep(0.45, 1.1, t * 0.75 + d.y * 0.3) * 0.7);
    }, opts.swayBase * 0.6);
  });

  const dir = new V(), p = new V(), q = new V(), facing = new V(), shade = new V(), out = new V(), jitter = new V();
  const col = new THREE.Color();
  lobes.forEach((l, li) => {
    const count = Math.round(opts.density * l.r.x * l.r.z);
    for (let i = 0; i < count; i++) {
      randUnit(rng, dir);
      if (dir.y < -0.3 || (dir.y < 0.1 && rng.next() < 0.45)) continue; // favour what an elevated camera sees
      p.copy(dir).multiply(l.r).multiplyScalar(rng.range(0.9, 1.1)).add(l.c);
      // drop leaves buried inside a neighbouring lobe
      let buried = false;
      for (let k = 0; k < lobes.length && !buried; k++) {
        if (k === li) continue;
        q.copy(p).sub(lobes[k].c).divide(lobes[k].r);
        if (q.lengthSq() < 0.74) buried = true;
      }
      if (buried) continue;
      out.copy(p).sub(centre).normalize();
      facing.copy(dir).multiplyScalar(0.55).addScaledVector(UP, 0.5).addScaledVector(randUnit(rng, jitter), 0.5).normalize();
      shade.copy(dir).multiplyScalar(0.7).addScaledVector(out, 0.38).addScaledVector(UP, 0.2).normalize();
      const t = (p.y - opts.yMin) / span;
      col.copy(low).lerp(high, smoothstep(0.1, 0.95, t * 0.75 + rng.gauss() * 0.17 + dir.y * 0.3));
      const roll = rng.next();
      if (roll < 0.12) col.lerp(glint, 0.6);
      else if (roll < 0.24) col.lerp(core, 0.45);
      if (dir.y < 0.05) col.multiplyScalar(0.84);
      const len = rng.range(opts.leaf[0], opts.leaf[1]) * (rng.next() < 0.14 ? 1.5 : 1);
      leafFacing(b, rng, p, facing, len, len * rng.range(0.5, 0.95), shade.clone(), col.clone(), opts.swayBase + t * 0.9);
    }
  });
}

export function makeBroadleaf(seed: number, pal: FoliagePalette): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const b = new Builder();
  const trunkH = rng.range(2.3, 3.1), R = rng.range(2.9, 3.6);
  const lean = new V(rng.range(-0.5, 0.5), 0, rng.range(-0.5, 0.5));
  const tc = C(pal.trunk), td = C(pal.trunkDark);
  tube(b, [
    { p: new V(0, -0.3, 0), r: 0.5, c: tc },
    { p: new V(0, 0.25, 0), r: 0.34, c: tc },
    { p: new V(lean.x * 0.35, trunkH * 0.6, lean.z * 0.35), r: 0.25, c: td.clone().lerp(tc, 0.4) },
    { p: new V(lean.x, trunkH + R * 0.6, lean.z), r: 0.13, c: td },
  ], 7);
  // two visible limbs
  for (let i = 0; i < 2; i++) {
    const a = rng.range(0, Math.PI * 2);
    tube(b, [
      { p: new V(lean.x * 0.3, trunkH * 0.55, lean.z * 0.3), r: 0.14, c: tc },
      { p: new V(lean.x * 0.3 + Math.cos(a) * R * 0.5, trunkH + R * 0.25, lean.z * 0.3 + Math.sin(a) * R * 0.5), r: 0.06, c: td },
    ], 5);
  }
  const lobes: Lobe[] = [{ c: new V(lean.x, trunkH + R * 0.74, lean.z), r: new V(R, R * 0.82, R) }];
  const k = rng.int(3, 5), a0 = rng.range(0, 6.28);
  for (let i = 0; i < k; i++) {
    const a = a0 + (i / k) * Math.PI * 2 + rng.range(-0.35, 0.35), dist = R * rng.range(0.66, 0.9), r = R * rng.range(0.5, 0.7);
    lobes.push({ c: new V(lean.x + Math.cos(a) * dist, trunkH + R * rng.range(0.32, 0.7), lean.z + Math.sin(a) * dist), r: new V(r, r * 0.84, r) });
  }
  const rt = R * rng.range(0.5, 0.62);
  lobes.push({ c: new V(lean.x + rng.range(-0.6, 0.6), trunkH + R * 1.42, lean.z + rng.range(-0.6, 0.6)), r: new V(rt, rt * 0.86, rt) });
  let yMin = Infinity, yMax = -Infinity;
  lobes.forEach((l) => { yMin = Math.min(yMin, l.c.y - l.r.y * 0.5); yMax = Math.max(yMax, l.c.y + l.r.y); });
  dressLobes(b, rng, lobes, pal, { density: 104, leaf: [0.34, 0.58], core: 0.9, lump: 0.16, swayBase: 0.25, yMin, yMax });
  return b.build();
}

export function makeConifer(seed: number, pal: FoliagePalette): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const b = new Builder();
  const H = rng.range(10.5, 13.5), R = rng.range(2.3, 2.9), tiers = 7;
  const tc = C(pal.trunk), td = C(pal.trunkDark);
  const core = C(pal.core), low = C(pal.low), high = C(pal.high), glint = C(pal.glint);
  tube(b, [
    { p: new V(0, -0.3, 0), r: 0.36, c: td },
    { p: new V(0, 0.3, 0), r: 0.24, c: tc },
    { p: new V(0, H * 0.9, 0), r: 0.04, c: td },
  ], 6);
  const p = new V(), u = new V(), v = new V(), facing = new V(), shade = new V(), radial = new V(), n = new V();
  const col = new THREE.Color();
  for (let i = 0; i < tiers; i++) {
    const f = i / (tiers - 1);
    const y0 = 1.5 + f * (H - 3.4);
    const rT = R * (1 - f * 0.8) * rng.range(0.92, 1.08);
    const tierH = ((H - 1.5) / tiers) * 1.5;
    // dark inner cone
    const sides = 8, apex = b.vert(p.set(0, y0 + tierH, 0), UP, core.clone().lerp(low, f * 0.4), 0.2);
    const ring: number[] = [];
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2 + i;
      n.set(Math.cos(a), 0.55, Math.sin(a)).normalize();
      ring.push(b.vert(p.set(Math.cos(a) * rT * 0.8, y0 - 0.05, Math.sin(a) * rT * 0.8), n, core, 0.2));
    }
    for (let s = 0; s < sides; s++) b.tri(apex, ring[(s + 1) % sides], ring[s]);
    // drooping boughs: elongated dabs laid radially on the tier
    const count = Math.round(40 + rT * 70);
    for (let k = 0; k < count; k++) {
      const a = rng.range(0, Math.PI * 2), rho = rT * Math.sqrt(rng.range(0.1, 1.15));
      radial.set(Math.cos(a), 0, Math.sin(a));
      const t = Math.min(1, rho / rT);
      p.copy(radial).multiplyScalar(rho).setY(y0 + tierH * (1 - t) * 0.82 + rng.range(-0.06, 0.1));
      u.copy(radial).addScaledVector(UP, -0.5 - t * 0.25).normalize();
      facing.copy(radial).multiplyScalar(0.5).addScaledVector(UP, 0.8).normalize();
      v.copy(facing).cross(u).normalize();
      shade.copy(radial).multiplyScalar(0.62).addScaledVector(UP, 0.62).normalize();
      col.copy(low).lerp(high, smoothstep(0.3, 1.0, t * 0.8 + f * 0.35 + rng.gauss() * 0.15));
      const roll = rng.next();
      if (roll < 0.1) col.lerp(glint, 0.6);
      else if (roll < 0.28) col.lerp(core, 0.55);
      const len = rng.range(0.5, 0.82) * (1 - f * 0.2);
      leaf(b, p, u.clone(), v.clone(), len, len * rng.range(0.4, 0.55), shade.clone(), col.clone(), 0.3 + f * 0.7);
    }
  }
  // spire
  for (let k = 0; k < 10; k++) {
    const a = rng.range(0, 6.28);
    radial.set(Math.cos(a), 0, Math.sin(a));
    p.copy(radial).multiplyScalar(rng.range(0.05, 0.3)).setY(H - rng.range(0.1, 1.3));
    u.copy(UP).addScaledVector(radial, 0.35).normalize();
    v.copy(radial).cross(u).normalize();
    shade.copy(radial).multiplyScalar(0.6).addScaledVector(UP, 0.6).normalize();
    leaf(b, p, u.clone(), v.clone(), 0.7, 0.3, shade.clone(), high.clone().lerp(glint, rng.next() * 0.5), 1);
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
