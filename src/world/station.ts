import * as THREE from 'three';
import { PropBuilder } from './flora';
import type { HeightField } from './heightfield';
import type { Track } from './track';

export const TOWN_EXIT_S = 29;
export const STATION_S = 335;

export function stationJourney(track: Track) {
  const stop = track.at(STATION_S);
  const sites = [
    { s: 12, offset: 10, width: 5.2, depth: 6.2 },
    { s: 22, offset: -10.5, width: 5.8, depth: 7 },
    { s: 36, offset: 9.2, width: 5, depth: 6 },
    { s: 49, offset: -11.4, width: 5.6, depth: 5.8 },
    { s: STATION_S, offset: -10, width: 6, depth: 14 },
  ].map(site => {
    const t = track.at(site.s);
    return { ...site, x: t.x - t.tz * site.offset, z: t.z + t.tx * site.offset,
      yaw: Math.atan2(t.tx, t.tz) };
  });

  function keepClear(x: number, z: number) {
    return sites.some(site => Math.hypot(x - site.x, z - site.z) < site.depth / 2 + 4);
  }

  function draw(props: PropBuilder, hf: HeightField) {
    const ivory = new THREE.Color('#ebd9ac'), shade = new THREE.Color('#7a8178');
    const terracotta = new THREE.Color('#ad6957'), tile = new THREE.Color('#87625b');
    const timber = new THREE.Color('#806953'), slate = new THREE.Color('#637774');
    const frame = new THREE.Matrix4(), matrix = new THREE.Matrix4();
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: THREE.Color, tilt = 0) => {
      matrix.makeRotationZ(tilt).setPosition(x, y, z).premultiply(frame);
      props.box(w, h, d, matrix, c);
    };
    // Bound hay bales give the long straight a middle distance between the
    // hedge opening and the first glimpse of the clock tower.
    const straw = new THREE.Color('#ceac70'), twine = new THREE.Color('#aa8e62');
    for (const [distance, offset, angle] of [[111, 14, 0.18], [119, 16, -0.1], [158, 11, 0.3], [163, 13, 0]]) {
      const t = track.at(distance), x = t.x - t.tz * offset, z = t.z + t.tx * offset;
      frame.makeRotationY(angle).setPosition(x, hf.height(x, z), z);
      box(2.5, 1.15, 1.45, 0, 0.52, 0, straw);
      for (const side of [-1, 1]) box(0.06, 1.18, 1.48, side * 0.7, 0.52, 0, twine);
    }
    for (const [index, site] of sites.entries()) {
      const { x, z, width: w, depth: d } = site;
      frame.makeRotationY(site.yaw).setPosition(x, hf.height(x, z), z);
      const station = site.s === STATION_S;
      const h = station ? 3.6 : 2.9 + index % 2 * 0.4;
      const roof = station ? slate : index % 2 ? tile : terracotta;
      const front = Math.sign(site.offset);
      box(w, h + 1, d, 0, h / 2 - 0.5, 0, ivory);
      // Stacked, narrowing gable courses fill both ends beneath the eaves.
      for (let i = 0; i < 6; i++) {
        box(w * (1 - (i + 0.5) / 6), w / 24, d, 0, h + w * (i + 0.5) / 24, 0, ivory);
      }
      for (const side of [-1, 1]) {
        const run = w / 2 + 0.45;
        box(run * Math.sqrt(1.25) + 0.14, 0.24, d + 0.9, side * run / 2, h + w / 4 - run / 4, 0, roof, -side * Math.atan(0.5));
      }
      box(0.12, 2.25, 1.1, front * w / 2, 1.1, 0, timber);
      for (const side of [-1, 1]) box(0.14, 1.15, 1.25, front * w / 2, 1.8, side * d * 0.31, shade);
      box(w + 0.08, 1.85, d + 0.1, 0, -0.55, 0, timber);
      if (!station) {
        for (const side of [-1, 1]) {
          const wx = side * w / 4, wz = -d / 2 - 0.04;
          box(1.02, 1.16, 0.13, wx, 1.65, wz, timber);
          box(0.78, 0.92, 0.14, wx, 1.65, wz - 0.03, shade);
          box(1.18, 0.12, 0.27, wx, 1.07, wz, ivory);
        }
        box(0.65, 0.6, 0.12, 0, h + 0.32, -d / 2, shade);
        box(0.7, 2, 0.78, -0.8, h + 1, d / 4, tile);
        continue;
      }
      // Low platform and canopy face the lane. The clock faces oncoming cars.
      box(2.9, 1.15, d + 2, front * (w / 2 + 1.15), -0.25, 0, shade);
      box(3.2, 0.28, d + 1.6, front * (w / 2 + 1.2), 3, 0, slate);
      for (const along of [-5.8, 0, 5.8]) box(0.17, 2.8, 0.17, front * (w / 2 + 2.5), 1.65, along, timber);
      box(3.2, 8.8, 3.2, 0, 4.15, -d / 2, ivory);
      box(3.7, 0.4, 3.7, 0, 8.65, -d / 2, slate);
      box(2.6, 0.5, 2.6, 0, 9, -d / 2, slate);
      const face = -d / 2 - 1.65;
      box(3.35, 1.65, 3.35, 0, -0.35, -d / 2, timber);
      box(3.3, 0.16, 3.3, 0, 5.75, -d / 2, timber);
      box(1.4, 2.35, 0.14, 0, 1.5, face, timber);
      box(0.96, 1.12, 0.15, 0, 1.85, face - 0.045, shade);
      box(1.82, 0.16, 0.95, 0, 2.8, face - 0.32, slate);
      box(1.8, 0.7, 1.05, 0, 0.04, face - 0.38, shade);
      box(1.8, 1.8, 0.12, 0, 7.25, face, timber);
      box(1.5, 1.5, 0.14, 0, 7.25, face - 0.035, ivory);
      box(0.11, 0.56, 0.12, 0, 7.5, face - 0.12, slate);
      box(0.45, 0.1, 0.12, 0.18, 7.25, face - 0.12, slate);
    }
  }

  function atStation(x: number, z: number) {
    const dx = x - stop.x, dz = z - stop.z;
    return Math.abs(dx * stop.tx + dz * stop.tz) <= 8 &&
      Math.abs(-dx * stop.tz + dz * stop.tx) <= 6;
  }
  return { keepClear, draw, atStation };
}
export type StationJourney = ReturnType<typeof stationJourney>;
