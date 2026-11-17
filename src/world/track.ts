import * as THREE from 'three';

/**
 * The road is authored, not generated: a closed centripetal Catmull-Rom spline through
 * hand-placed control points (metres, X east / Z south). The layout was tuned for rhythm —
 * a long flowing southern sweep, a fast eastern bend, a tight right-hander into esses,
 * a northern hairpin loop, an infield dip and a snaking western return.
 */
const CONTROL: ReadonlyArray<readonly [number, number]> = [
  [-108, 104], [-45, 118], [30, 100], [96, 120], [146, 86], [152, 24], [114, -20],
  [66, -12], [46, -54], [88, -92], [108, -130], [82, -156], [44, -142], [24, -100],
  [-8, -50], [-52, -36], [-78, -72], [-58, -114], [-94, -148], [-142, -122],
  [-152, -64], [-116, -18], [-126, 30], [-152, 58], [-144, 88],
];

export const ROAD_HALF_WIDTH = 3.3; // asphalt half width (m)
export const ROAD_SKIRT = 0.5; // dirt shoulder carried by the road ribbon itself
export const TRACK_STEP = 0.5; // centre-line sample spacing (m)

export interface TrackSample {
  x: number;
  z: number;
  /** Unit tangent (direction of travel). */
  tx: number;
  tz: number;
  /** Arc length from the start (m). */
  s: number;
  /** Road surface height, filled in by the height field. */
  y: number;
  /** Signed curvature (1/m), positive = turning right in travel direction. */
  k: number;
}

export interface Track {
  samples: TrackSample[];
  length: number;
  /** Sample by arc length with wrap-around and linear interpolation. */
  at(s: number): TrackSample;
}

export function buildTrack(): Track {
  const curve = new THREE.CatmullRomCurve3(
    CONTROL.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    true,
    'centripetal',
  );
  curve.arcLengthDivisions = 4000;
  const length = curve.getLength();
  const n = Math.round(length / TRACK_STEP);
  const pts = curve.getSpacedPoints(n).slice(0, n);
  const samples: TrackSample[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const t = new THREE.Vector2(b.x - a.x, b.z - a.z).normalize();
    samples.push({ x: pts[i].x, z: pts[i].z, tx: t.x, tz: t.y, s: (i / n) * length, y: 0, k: 0 });
  }
  const W = 6;
  for (let i = 0; i < n; i++) {
    const a = samples[(i - W + n) % n], b = samples[(i + W) % n];
    const cross = a.tx * b.tz - a.tz * b.tx;
    const dot = a.tx * b.tx + a.tz * b.tz;
    samples[i].k = Math.atan2(cross, dot) / (2 * W * TRACK_STEP);
  }
  const at = (s: number): TrackSample => {
    const f = (((s % length) + length) % length) / length * n;
    const i0 = Math.floor(f) % n, i1 = (i0 + 1) % n, t = f - Math.floor(f);
    const a = samples[i0], b = samples[i1];
    const tx = a.tx + (b.tx - a.tx) * t, tz = a.tz + (b.tz - a.tz) * t;
    const l = Math.hypot(tx, tz) || 1;
    return {
      x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx: tx / l, tz: tz / l,
      s, y: a.y + (b.y - a.y) * t, k: a.k + (b.k - a.k) * t,
    };
  };
  return { samples, length, at };
}
