import { ASPHALT, GRAVEL } from '../ground';
import { PI, defaultSpiral, fillet } from './alignment';
import { MOUNTAIN, macroHeight } from './terrain';

/**
 * The graybox road network. Everything here is a design decision meant to be argued with:
 *
 *   Ring      12 km loop of fast tarmac. South straight 2.6 km, north straight 1.7 km.
 *             Bends are R 480–520 (flat out), R 280–300 (lift) or R 180–220 (light brake).
 *   Meridian  north–south tarmac through the middle with two flat-out kinks and a jump,
 *             joined to the ring at both ends by R 200 wyes you can take with a light brake.
 *   Lakeside  4.5 km of gravel sweepers (R 110–250) past the lake and through the forest.
 *   Pass      narrow tarmac over the massif: esses (R 45–75) up, two hairpins (R 22) down.
 *
 * Roads earlier in the list win where two overlap: later roads take their height.
 */
export type RoadKind = 'main' | 'mountain' | 'gravel' | 'link';

export interface Feature {
  /** A crest built to launch the car: +5 % ramp, 25 m crest, -5 % landing slope. */
  type: 'jump';
  /** Centre of the crest; snapped to the nearest point of the road. */
  at: [number, number];
}

export interface RoadDef {
  id: string;
  name: string;
  kind: RoadKind;
  /** Half the paved width (m). */
  halfWidth: number;
  surface: number;
  closed: boolean;
  pis: PI[];
  /** How far the road's height averages the land it crosses (m). Longer = flatter, more cut and fill. */
  smooth: number;
  /** Width over which cut and fill ease back into the natural ground (m). */
  blend: number;
  maxGrade: number;
  features?: Feature[];
}

type P = readonly [number, number];
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const heading = (a: P, b: P) => Math.atan2(b[0] - a[0], b[1] - a[1]);
const along = (a: P, h: number, d: number): P => [a[0] + Math.sin(h) * d, a[1] + Math.cos(h) * d];
const pi = (p: P, r?: number, ls?: number): PI => ({ x: p[0], z: p[1], r, ls });

const MAIN = { kind: 'main' as const, halfWidth: 4.0, surface: ASPHALT, closed: false, smooth: 220, blend: 60, maxGrade: 0.07 };
const LINK = { ...MAIN, kind: 'link' as const, smooth: 120 };
const GRAVEL_ROAD = { kind: 'gravel' as const, halfWidth: 3.25, surface: GRAVEL, closed: false, smooth: 110, blend: 40, maxGrade: 0.08 };
const MOUNTAIN_ROAD = { kind: 'mountain' as const, halfWidth: 3.25, surface: ASPHALT, closed: false, smooth: 44, blend: 26, maxGrade: 0.10 };

/** How far before the PI a bend of radius r between these directions starts. */
const tangent = (r: number, hIn: number, hOut: number) => fillet(r, defaultSpiral(r), wrap(hOut - hIn)).T;

/**
 * A short road that leaves the line from→corner and joins the line corner→to with one bend.
 * It starts and ends a few metres into the roads it connects, lying on top of them.
 */
function link(id: string, name: string, from: P, corner: P, to: P, r: number, base: Omit<RoadDef, 'id' | 'name' | 'pis'> = LINK): RoadDef {
  const hIn = heading(from, corner), hOut = heading(corner, to);
  const t = tangent(r, hIn, hOut) + 8;
  return { ...base, id, name, pis: [pi(along(corner, hIn, -t)), pi(corner, r), pi(along(corner, hOut, t))] };
}

// ---- Ring ------------------------------------------------------------------------------------
const A: P = [-1900, 1600], B: P = [1100, 1600], C: P = [2000, 400], D: P = [1750, -800];
const E: P = [700, -1650], F: P = [-1300, -1650], G: P = [-2150, -750], H: P = [-2250, 700];

const ring: RoadDef = {
  ...MAIN, id: 'ring', name: 'Ring', closed: true,
  pis: [pi(A, 200), pi(B, 280), pi(C, 480), pi(D, 180), pi(E, 300), pi(F, 300), pi(G, 220), pi(H, 520)],
  features: [{ type: 'jump', at: [600, 1600] }],
};

// ---- Meridian --------------------------------------------------------------------------------
const MN: P = [-500, -1650], MK1: P = [-500, -700], MK2: P = [-100, 300], MS: P = [-100, 1600];
const WEST = Math.PI * 1.5, EAST = Math.PI / 2, SOUTH = 0, NORTH = Math.PI;
const wyeT = tangent(200, WEST, SOUTH) + 8;

const meridian: RoadDef = {
  ...MAIN, id: 'meridian', name: 'Meridian',
  pis: [pi(along(MN, WEST, -wyeT)), pi(MN, 200), pi(MK1, 600), pi(MK2, 600), pi(MS, 200), pi(along(MS, EAST, wyeT))],
  features: [{ type: 'jump', at: [-100, 915] }],
};
const meridianNorthB = link('meridian-n', 'Meridian north wye', [-1000, -1650], MN, MK1, 200);
const meridianSouthB = link('meridian-s', 'Meridian south wye', MK2, MS, [-700, 1600], 200);

// ---- Lakeside (gravel) -----------------------------------------------------------------------
const hGH = heading(G, H), hCD = heading(C, D);
const G1: P = along(G, hGH, 700);          // fork on the ring's west side
const G9: P = along(C, hCD, 600);          // fork on the ring's east side
const G2: P = [-1800, 230], G8: P = [1300, 250];
const lakesidePIs: [P, number][] = [
  [G1, 140], [G2, 220], [[-1300, 150], 120], [[-900, 420], 160], [[-450, 580], 200],
  [[300, 480], 250], [[800, 150], 110], [G8, 180], [G9, 160],
];
const lakeside: RoadDef = {
  ...GRAVEL_ROAD, id: 'lakeside', name: 'Lakeside',
  pis: [
    pi(along(G1, hGH, -(tangent(140, hGH, heading(G1, G2)) + 8))),
    ...lakesidePIs.map(([p, r]) => pi(p, r)),
    pi(along(G9, hCD, tangent(160, heading(G8, G9), hCD) + 8)),
  ],
};
const lakesideWestB = link('lakeside-w', 'Lakeside west fork', along(G1, hGH, 300), G1, G2, 60, { ...GRAVEL_ROAD, kind: 'link' });
const lakesideEastB = link('lakeside-e', 'Lakeside east fork', G8, G9, C, 60, { ...GRAVEL_ROAD, kind: 'link' });

// ---- Pass (mountain) -------------------------------------------------------------------------
/** Where the mountain road leaves the ring, and where it stops climbing straight on. */
const PASS_START: P = along(C, hCD, 1000);
const PASS_FOOT: P = along(PASS_START, hCD, 620);
/** Where it rejoins the north straight, heading west. */
const PASS_JOIN: P = [300, -1650];

interface TracePoint { x: number; z: number; phi: number; r: number; h: number; d: number }

/**
 * Walk round the massif keeping a constant grade on the smooth ground, so the road climbs
 * without needing a cutting. Polar angle phi is measured like a heading from the summit.
 */
function trace(start: TracePoint, sense: 1 | -1, grade: number, stop: (p: TracePoint, len: number) => boolean): TracePoint[] {
  const M = MOUNTAIN, ds = 5;
  const out: TracePoint[] = [];
  let { phi, r, h, d } = start;
  const f = (rr: number) => macroHeight(M.x + rr * Math.sin(phi), M.z + rr * Math.cos(phi)) - h;
  for (let len = 0; len < 6000; len += ds) {
    phi += (sense * ds) / r;
    h += grade * ds;
    let lo = Math.max(140, r - 60), hi = r + 60;
    if (f(lo) <= 0) r = lo; else if (f(hi) >= 0) r = hi;
    else { for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m; } r = (lo + hi) / 2; }
    d += ds;
    const p = { x: M.x + r * Math.sin(phi), z: M.z + r * Math.cos(phi), phi, r, h, d };
    out.push(p);
    if (stop(p, len + ds)) break;
  }
  return out;
}

/** PIs every `chord` metres between two distances along a traced leg, pushed alternately in and out. */
function esses(leg: TracePoint[], from: number, to: number, chord: number, amp: number, r: number, firstSign = 1): PI[] {
  const out: PI[] = [];
  let sign = firstSign;
  for (let d = from; d <= to + 1e-6; d += chord) {
    const p = leg[Math.min(leg.length - 1, Math.max(0, Math.round(d / 5) - 1))];
    const w = sign * amp;
    out.push({ x: p.x + Math.sin(p.phi) * w, z: p.z + Math.cos(p.phi) * w, r });
    sign = -sign;
  }
  return out;
}

function passRoad(): { pis: PI[]; summit: P; end: P } {
  const M = MOUNTAIN;
  const dx = PASS_FOOT[0] - M.x, dz = PASS_FOOT[1] - M.z;
  const foot: TracePoint = { x: PASS_FOOT[0], z: PASS_FOOT[1], phi: Math.atan2(dx, dz), r: Math.hypot(dx, dz), h: macroHeight(PASS_FOOT[0], PASS_FOOT[1]), d: 0 };
  const last = (leg: TracePoint[]) => leg[leg.length - 1];
  const climb = 100;
  const up = trace(foot, 1, 0.075, (p) => p.h >= foot.h + climb);
  const top = trace(last(up), 1, 0, (_, len) => len >= 150);
  const down1 = trace(last(top), 1, -0.065, (_, len) => len >= 640);
  const zed = trace(last(down1), -1, -0.065, (_, len) => len >= 300);
  const down2 = trace(last(zed), 1, -0.065, (p) => p.h <= foot.h + 6);
  const upLen = up.length * 5, down2Len = down2.length * 5;
  const q1 = last(down1), q2 = last(zed), end = last(down2);
  const pis: PI[] = [
    pi(PASS_START),
    pi(PASS_FOOT, 45),
    ...esses(up, 150, 500, 115, 24, 70, -1),
    ...esses(up, 630, 960, 82, 22, 45, 1),
    ...esses(up, 1090, upLen - 60, 115, 24, 70, 1),
    ...esses(top, 75, 75, 100, 18, 110, -1),
    ...esses(down1, 70, 430, 120, 26, 75, 1),
    { x: q1.x, z: q1.z, r: 22, ls: 10 },
    { x: q2.x, z: q2.z, r: 22, ls: 10 },
    ...esses(down2, 200, down2Len - 150, 100, 22, 60, 1),
    { x: end.x, z: end.z, r: 120 },
    pi(PASS_JOIN, 300),
    pi(along(PASS_JOIN, WEST, tangent(300, heading([end.x, end.z], PASS_JOIN), WEST) + 8)),
  ];
  const s = top[Math.floor(top.length / 2)];
  return { pis, summit: [s.x, s.z], end: [end.x, end.z] };
}

const passTrace = passRoad();
const pass: RoadDef = { ...MOUNTAIN_ROAD, id: 'pass', name: 'Pass', pis: passTrace.pis };
const passJoinB = link('pass-w', 'Pass west fork', [0, -1650], PASS_JOIN, passTrace.end, 300, { ...MOUNTAIN_ROAD, kind: 'link' });

export const ROADS: RoadDef[] = [
  ring, meridian, lakeside, pass,
  meridianNorthB, meridianSouthB, lakesideWestB, lakesideEastB, passJoinB,
];

export interface Spawn { key: string; name: string; road: string; at: [number, number]; reverse?: boolean }

/** Places worth driving to directly while testing. `at` is snapped to the named road. */
export const SPAWNS: Spawn[] = [
  { key: '1', name: 'South straight', road: 'ring', at: [-1650, 1600] },
  { key: '2', name: 'Meridian wye', road: 'ring', at: [-1000, 1600] },
  { key: '3', name: 'Jump', road: 'meridian', at: [-100, 520] },
  { key: '4', name: 'Pass: foot', road: 'ring', at: [1930, 60] },
  { key: '5', name: 'Pass: summit', road: 'pass', at: [passTrace.summit[0], passTrace.summit[1]] },
  { key: '6', name: 'Lakeside gravel', road: 'lakeside', at: [-1950, 110] },
  { key: '7', name: 'North straight', road: 'ring', at: [450, -1650] },
];
