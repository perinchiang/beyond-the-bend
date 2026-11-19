/**
 * What the vehicle needs to know about the world. The world (terrain + road network) implements
 * this; tests implement it analytically.
 *
 * Conventions shared by the whole slice (they match three.js, so `rotation.y = heading` works):
 *   X east, Y up, Z south, metres, SI units.
 *   Heading h is a rotation about +Y:  forward = (sin h, 0, cos h),  LEFT = (cos h, 0, -sin h).
 *   A positive yaw rate (h increasing) therefore turns LEFT.
 *   Body frame: +X left, +Y up, +Z forward.
 *   Player input is named from the driver's seat: steer +1 = right, -1 = left. The vehicle
 *   converts that to its internal sign.
 */
export const ASPHALT = 0, SHOULDER = 1, GRASS = 2, GRAVEL = 3;

export interface GroundSample {
  /** Surface height (m). */
  y: number;
  /** Unit surface normal. */
  nx: number; ny: number; nz: number;
  /** ASPHALT | SHOULDER | GRASS | GRAVEL */
  surface: number;
}

export interface Ground {
  sample(x: number, z: number, out: GroundSample): GroundSample;
}

/** A solid vertical cylinder: tree trunk, rock, bollard. */
export interface Obstacle { x: number; z: number; r: number }

export interface Obstacles {
  /** Fill `out` with obstacles whose centre lies within `radius` of (x, z); returns the count. */
  near(x: number, z: number, radius: number, out: Obstacle[]): number;
}

export const newGroundSample = (): GroundSample => ({ y: 0, nx: 0, ny: 1, nz: 0, surface: GRASS });
