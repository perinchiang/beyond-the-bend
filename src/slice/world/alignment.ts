/**
 * Road centre lines the way road engineers lay them out: straight tangents between hand-placed
 * intersection points (PIs), and at every PI a bend of a chosen radius eased in and out by
 * clothoid spirals (curvature grows linearly with distance, so the steering goes on smoothly).
 *
 * This makes the design speed of every bend an input rather than an accident: R 500 m is a
 * flat-out kink, R 280 m needs a lift, R 180 m a light brake, R 22 m is a hairpin.
 *
 * Headings follow src/slice/ground.ts: h = atan2(dx, dz), forward = (sin h, cos h), and a
 * positive deflection / curvature turns LEFT.
 */
export interface PI {
  x: number; z: number;
  /** Bend radius at this PI (m). Required wherever the road changes direction. */
  r?: number;
  /** Spiral length (m); defaults to defaultSpiral(r). */
  ls?: number;
}

export interface AlignSample { s: number; x: number; z: number; h: number; k: number }

export interface Bend {
  /** Stations where the steering starts and ends (m). */
  s0: number; s1: number;
  radius: number;
  /** Total change of direction (rad), positive = left. */
  deflection: number;
  /** Index of the PI that produced it. */
  pi: number;
}

export interface Alignment {
  samples: AlignSample[];
  length: number;
  /** Actual sample spacing (m): the requested step adjusted to divide the length exactly. */
  step: number;
  closed: boolean;
  bends: Bend[];
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export const defaultSpiral = (r: number) => Math.min(110, Math.max(10, 0.35 * r));

/** End point of a clothoid running from curvature 0 to 1/R over Ls: [along the tangent, sideways]. */
function spiralEnd(R: number, Ls: number): [number, number] {
  const n = 64, h = Ls / n;
  const f = (s: number) => (s * s) / (2 * R * Ls);
  let x = 0, y = 0;
  for (let i = 0; i < n; i++) {
    const a = i * h, m = a + h / 2, b = a + h;
    x += (h / 6) * (Math.cos(f(a)) + 4 * Math.cos(f(m)) + Math.cos(f(b)));
    y += (h / 6) * (Math.sin(f(a)) + 4 * Math.sin(f(m)) + Math.sin(f(b)));
  }
  return [x, y];
}

export interface Fillet {
  /** Distance from the PI back to where the bend starts (and on to where it ends). */
  T: number;
  ls: number;
  /** Length of the constant-radius part. */
  arc: number;
}

/** Spiral–arc–spiral bend of radius R turning through `delta` radians. */
export function fillet(R: number, ls: number, delta: number): Fillet {
  const a = Math.abs(delta);
  ls = Math.min(ls, R * a * 0.999); // the two spirals may not turn further than the bend itself
  const th = ls / (2 * R);
  const [xs, ys] = spiralEnd(R, ls);
  const p = ys - R * (1 - Math.cos(th)), k = xs - R * Math.sin(th);
  return { T: (R + p) * Math.tan(a / 2) + k, ls, arc: R * (a - 2 * th) };
}

interface Piece { len: number; k0: number; k1: number }

export function buildAlignment(pis: readonly PI[], closed: boolean, step = 2, label = 'road'): Alignment {
  const n = pis.length;
  if (n < 2) throw new Error(`${label}: needs at least two points`);
  const legs = closed ? n : n - 1;
  const len: number[] = [], hd: number[] = [];
  for (let i = 0; i < legs; i++) {
    const a = pis[i], b = pis[(i + 1) % n];
    len.push(Math.hypot(b.x - a.x, b.z - a.z));
    hd.push(Math.atan2(b.x - a.x, b.z - a.z));
  }
  // One bend per PI that has a leg on both sides.
  const fil: ({ f: Fillet; R: number; delta: number } | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) continue;
    const delta = wrap(hd[i % legs] - hd[(i - 1 + legs) % legs]);
    if (Math.abs(delta) < 0.002) continue;
    const R = pis[i].r;
    if (!R) throw new Error(`${label}: PI ${i} turns ${(delta * 57.3).toFixed(1)}° but has no radius`);
    fil[i] = { f: fillet(R, pis[i].ls ?? defaultSpiral(R), delta), R, delta };
  }
  const T = (i: number) => fil[i]?.f.T ?? 0;

  const pieces: Piece[] = [];
  const bendAt: { piece: number; pi: number }[] = [];
  for (let i = 0; i < legs; i++) {
    const j = (i + 1) % n;
    const straight = len[i] - T(i) - T(j);
    if (straight < -1e-6) {
      throw new Error(`${label}: PIs ${i} and ${j} are ${len[i].toFixed(0)} m apart but their bends need `
        + `${T(i).toFixed(0)} + ${T(j).toFixed(0)} m`);
    }
    pieces.push({ len: Math.max(0, straight), k0: 0, k1: 0 });
    const b = fil[j];
    if (b && (closed || j < n - 1)) {
      const k = Math.sign(b.delta) / b.R;
      bendAt.push({ piece: pieces.length, pi: j });
      pieces.push({ len: b.f.ls, k0: 0, k1: k }, { len: b.f.arc, k0: k, k1: k }, { len: b.f.ls, k0: k, k1: 0 });
    }
  }

  // Integrate densely. Heading is exact (curvature is piecewise linear); position uses Simpson.
  let x = pis[0].x + Math.sin(hd[0]) * T(0), z = pis[0].z + Math.cos(hd[0]) * T(0);
  if (!closed) { x = pis[0].x; z = pis[0].z; }
  let h = hd[0], s = 0;
  const ds: number[] = [0], dx: number[] = [x], dz: number[] = [z], dh: number[] = [h], dk: number[] = [0];
  const pieceStart: number[] = [];
  for (const p of pieces) {
    pieceStart.push(s);
    if (p.len <= 0) continue;
    const m = Math.max(1, Math.ceil(p.len / 0.25)), e = p.len / m;
    const head = (u: number) => h + p.k0 * u + ((p.k1 - p.k0) * u * u) / (2 * p.len);
    for (let q = 0; q < m; q++) {
      const u0 = q * e, a = head(u0), b = head(u0 + e / 2), c = head(u0 + e);
      x += (e / 6) * (Math.sin(a) + 4 * Math.sin(b) + Math.sin(c));
      z += (e / 6) * (Math.cos(a) + 4 * Math.cos(b) + Math.cos(c));
      ds.push(s + u0 + e); dx.push(x); dz.push(z); dh.push(c);
      dk.push(p.k0 + ((p.k1 - p.k0) * (u0 + e)) / p.len);
    }
    h = head(p.len);
    s += p.len;
  }
  const length = s;

  const segs = Math.max(1, Math.round(length / step));
  const st = length / segs;
  const count = closed ? segs : segs + 1;
  const samples: AlignSample[] = [];
  let c = 0;
  for (let i = 0; i < count; i++) {
    const at = Math.min(length, i * st);
    while (c < ds.length - 2 && ds[c + 1] < at) c++;
    const span = ds[c + 1] - ds[c], t = span > 0 ? (at - ds[c]) / span : 0;
    samples.push({
      s: at,
      x: dx[c] + (dx[c + 1] - dx[c]) * t,
      z: dz[c] + (dz[c + 1] - dz[c]) * t,
      h: dh[c] + (dh[c + 1] - dh[c]) * t,
      k: dk[c] + (dk[c + 1] - dk[c]) * t,
    });
  }
  const bends: Bend[] = bendAt.map(({ piece, pi }) => {
    const b = fil[pi]!;
    return { s0: pieceStart[piece], s1: pieceStart[piece] + 2 * b.f.ls + b.f.arc, radius: b.R, deflection: b.delta, pi };
  });
  return { samples, length, step: st, closed, bends };
}
