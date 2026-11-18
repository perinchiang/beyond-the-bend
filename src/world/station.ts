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
    { s: STATION_S, offset: -12.5, width: 6, depth: 14 },
  ].map(site => {
    const t = track.at(site.s);
    return { ...site, x: t.x - t.tz * site.offset, z: t.z + t.tx * site.offset,
      yaw: Math.atan2(t.tx, t.tz) };
  });

  const villageSites = sites.slice(0,-1);
  const postOffice = sites[2], stationSite = sites[4];
  const parcel = new THREE.Group();
  parcel.name = 'station-parcel';
  const counter = new THREE.Vector3(), trolley = new THREE.Vector3();
  // Each yard touches the shoulder and tapers at its ends, following its building's orientation.
  const courts = [postOffice, stationSite].map(site => {
    const t = track.at(site.s);
    return { x: site.x, z: site.z, tx: t.tx, tz: t.tz, offset: site.offset,
      length: site === postOffice ? 6.7 : 14.5 };
  });
  function paving(x: number, z: number) {
    let mask = 0;
    for (const c of courts) {
      const dx = x - c.x, dz = z - c.z;
      const along = dx * c.tx + dz * c.tz;
      const across = (dx * c.tz - dz * c.tx) / c.offset;
      const d = Math.max(Math.abs(along) / c.length, Math.abs(across - 0.34) / 0.50);
      mask = Math.max(mask, 1 - THREE.MathUtils.smoothstep(d, 0.76, 1.06));
    }
    return mask;
  }
  function showParcel(inTransit: boolean, delivered: boolean) {
    parcel.visible = !inTransit;
    parcel.position.copy(delivered ? trolley : counter);
    parcel.rotation.y = delivered ? stationSite.yaw : postOffice.yaw;
  }

  function keepClear(x: number, z: number) {
    return paving(x, z) > 0.15 || sites.some(site => Math.hypot(x - site.x, z - site.z) < site.depth / 2 + 4);
  }

  function draw(props: PropBuilder, hf: HeightField, material: THREE.Material, cottagePaint?: THREE.Material) {
    const cottages = cottagePaint ? new PropBuilder() : props;
    let shapes = props;
    const ivory = new THREE.Color('#ebd9ac'), shade = new THREE.Color('#7a8178');
    const terracotta = new THREE.Color('#ad6957'), tile = new THREE.Color('#87625b');
    const timber = new THREE.Color('#806953'), slate = new THREE.Color('#637774');
    const frame = new THREE.Matrix4(), matrix = new THREE.Matrix4();
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: THREE.Color, tilt = 0) => {
      matrix.makeRotationZ(tilt).setPosition(x, y, z).premultiply(frame);
      shapes.box(w, h, d, matrix, c);
    };
    const postal = new THREE.Color('#a44838'), cream = new THREE.Color('#f1dfa8');
    const canopy = new THREE.Color('#547c74'), dark = new THREE.Color('#4e5149');
    const warmLime = new THREE.Color('#f2d59e'), blueGlass = new THREE.Color('#60757d');
    const tileLight = new THREE.Color('#bc704c'), tileShade = new THREE.Color('#a4664c');
    const eave = new THREE.Color('#796653'), step = new THREE.Color('#958672');
    // The enamel blade can be recognised on the return trip as well.
    function envelope(x: number, y: number, z: number, w: number, face = -1) {
      box(w, w * 0.65, 0.10, x, y, z, cream);
      for (const side of [-1, 1])
        box(w * 0.53, w * 0.082, 0.04, x + side * w * 0.22, y + w * 0.045, z + face * 0.07, postal, side * 0.49);
    }
    const packageProps = new PropBuilder(), identity = new THREE.Matrix4();
    packageProps.box(1.15, 0.77, 0.83, identity, new THREE.Color('#ad814e'), new THREE.Color('#d6ad69'));
    packageProps.box(0.11, 0.79, 0.85, identity, cream);
    packageProps.box(1.17, 0.79, 0.075, identity, cream);
    packageProps.box(0.34, 0.20, 0.03, identity.makeTranslation(-0.25,0.08,-0.425), postal);
    const packageMesh = new THREE.Mesh(packageProps.build(), material);
    packageMesh.castShadow = packageMesh.receiveShadow = true;
    parcel.add(packageMesh);
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
      shapes = station ? props : cottages;
      const painted = Boolean(cottagePaint) && !station;
      const wall = painted ? warmLime : ivory;
      const h = station ? 3.6 : 2.9 + index % 2 * 0.4;
      const roof = station ? slate : painted ? (index % 2 ? tileShade : tileLight) : (index % 2 ? tile : terracotta);
      const front = Math.sign(site.offset);
      box(w, h + 1, d, 0, h / 2 - 0.5, 0, wall);
      if (painted) {
        // One plaster face, with a brush-width of shade beneath each verge.
        // The band follows the pitch on both approaches rather than lighting
        // one side with a camera-facing decal.
        for (const end of [-1,1]) {
          const n = new THREE.Vector3(0,0,end).transformDirection(frame);
          const face = (points: number[][], colour: THREE.Color, lift=0) => {
            const first=shapes.pos.length/3;
            for (const [x,y] of points)
              shapes.vert(new THREE.Vector3(x,y,end*(d/2+.006+lift)).applyMatrix4(frame),n,colour);
            for(let j=1;j<points.length-1;j++) {
              const [a,b,c]=[points[0],points[j],points[j+1]];
              const winding=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
              if (winding*end>0) shapes.tri(first,first+j,first+j+1);
              else shapes.tri(first,first+j+1,first+j);
            }
          };
          face([[-w/2,h],[w/2,h],[0,h+w/4]],wall);
          for (const side of [-1,1]) {
            const shadow = side<0 ? new THREE.Color('#cbb98f') : new THREE.Color('#b9ae8d');
            face([[0,h+w/4],[side*w/2,h],[side*w/2,h-.19],[0,h+w/4-.35]],shadow,.013);
          }
        }
      } else for (let i = 0; i < 6; i++) {
        box(w * (1 - (i + 0.5) / 6), w / 24, d, 0, h + w * (i + 0.5) / 24, 0, wall);
      }
      for (const side of [-1, 1]) {
        const run = w / 2 + 0.45;
        if (painted) {
          // A single cool underside is more legible in Close than rows of tiles.
          box(run*Math.sqrt(1.25)+.08,.19,d+.82,side*run/2,h+w/4-run/4-.16,0,eave,-side*Math.atan(.5));
        }
        box(run * Math.sqrt(1.25) + 0.14, 0.24, d + 0.9, side * run / 2, h + w / 4 - run / 4, 0, roof, -side * Math.atan(0.5));
      }
      box(0.12, 2.25, 1.1, front * w / 2, 1.1, 0, timber);
      for (const side of [-1, 1]) box(0.14, 1.15, 1.25, front * w / 2, 1.8, side * d * 0.31, shade);
      if (painted) box(w+.06,1.76,d+.07,0,-.71,0,new THREE.Color('#827e69'));
      else box(w+.08,1.85,d+.1,0,-.55,0,timber);
      if (site === postOffice) {
        // A little covered counter faces the road; the enamel blade faces the approach.
        box(2.3, 0.26, 5.1, 3.25, 2.65, 0, canopy, -0.10);
        for (const z of [-2.15, 2.15]) box(0.18, 2.66, 0.18, 4.08, 1.29, z, timber);
        box(2.12, 0.18, 4.82, 3.32, 0.08, 0, shade);
        box(0.87, 0.84, 2.08, 3.30, 0.49, -3.20, canopy);
        box(1.13, 0.13, 2.22, 3.30, 0.97, -3.20, timber);
        counter.set(3.30, 1.42, -3.45).applyMatrix4(frame);
        const signX = painted ? 3.29 : 2.64, signY = painted ? 3.39 : 3.22, signZ = painted ? -3.07 : -2.81;
        if (painted) {
          // The blade projects past the end of the awning. Its two irons
          // are most visible when the driver looks back from the station.
          for (const x of [signX-.64, signX+.64]) {
            box(.14,.14,.94,x,2.63,signZ+.34,slate);
            box(.14,.32,.14,x,2.74,signZ+.03,slate);
          }
        }
        box(painted ? 2.10 : 1.93, 1.32, 0.19, signX, signY, signZ, postal);
        envelope(signX, signY, signZ-.12, painted ? 1.58 : 1.29);
        if (painted) envelope(signX,signY,signZ+.12,1.58,1);
        // Kerbside pillar box: projecting cap, letter slot and collection plate.
        box(1.02, 0.19, 0.88, 4.87, 0.10, -2.92, dark);
        box(0.86, 1.58, 0.74, 4.87, 0.93, -2.92, postal);
        box(1.02, 0.20, 0.88, 4.87, 1.79, -2.92, postal);
        box(0.61, 0.12, 0.05, 4.87, 1.37, -3.31, dark);
        box(0.39, 0.32, 0.05, 4.87, 0.91, -3.31, cream);
      }
      if (!station) {
        for (const end of (painted ? [-1,1] : [-1])) for (const side of [-1,1]) {
          const wx = side*w/4, wz = end*(d/2+.04);
          box(1.02,1.16,.13,wx,1.65,wz,timber);
          box(.78,.92,.14,wx,1.65,wz+end*(painted ? .065 : .03),painted ? blueGlass : shade);
          box(1.18,.12,.27,wx,1.07,wz,painted ? step : ivory);
        }
        box(0.65, 0.6, 0.12, 0, h + 0.32, -d / 2, shade);
        box(0.7, 2, 0.78, -0.8, h + 1, d / 4, tile);
        continue;
      }
      // A slatted luggage trolley at the near end of the platform.
      const cartX = -6.05, cartZ = 4.25;
      for (const x of [-0.44, 0.44]) for (const z of [-0.79, 0.79])
        box(0.17, 0.41, 0.40, cartX+x, 0.22, cartZ+z, dark);
      box(1.23, 0.23, 2.31, cartX, 0.51, cartZ, timber);
      for (const x of [-0.49, 0.49]) box(0.10, 0.84, 0.12, cartX+x, 0.92, cartZ+1.02, slate);
      box(1.06, 0.12, 0.13, cartX, 1.31, cartZ+1.02, slate);
      trolley.set(cartX, 1.02, cartZ-0.2).applyMatrix4(frame);
      // White end brackets mark the gravel pull-in. The long edge stays open to the road.
      for (const along of [-8.9, 8.9]) {
        for (const [x, w, d, z] of [[-7.75, 1.85, 0.14, along],
          [-6.88, 0.14, 0.95, along-Math.sign(along)*0.41]]) {
          const point = new THREE.Vector3(x, 0, z).applyMatrix4(frame);
          box(w, 0.035, d, x, hf.height(point.x,point.z)-frame.elements[13]+0.035, z, cream);
        }
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
    shapes = props;
    // A platform clock repeats the tower face one bend before the stopping place.
    const t = track.at(STATION_S - 27);
    const x = t.x + t.tz * 5.3, z = t.z - t.tx * 5.3;
    frame.makeRotationY(Math.atan2(t.tx,t.tz)).setPosition(x, hf.height(x,z), z);
    box(0.36, 3.35, 0.36, 0, 1.66, 0, slate);
    box(1.77, 1.77, 0.30, 0, 3.25, 0, canopy);
    box(1.43, 1.43, 0.11, 0, 3.25, -0.18, cream);
    box(0.11, 0.57, 0.07, 0, 3.49, -0.26, dark);
    box(0.44, 0.11, 0.07, 0.16, 3.25, -0.26, dark);
    if (cottagePaint) {
      const mesh = new THREE.Mesh(cottages.build(),cottagePaint);
      mesh.name = 'Painted postal village';
      mesh.castShadow = mesh.receiveShadow = true;
      return mesh;
    }
  }

  function atStation(x: number, z: number) {
    const dx = x - stop.x, dz = z - stop.z;
    return Math.abs(dx * stop.tx + dz * stop.tz) <= 8 &&
      Math.abs(-dx * stop.tz + dz * stop.tx) <= 6;
  }
  return { postOffice, villageSites, keepClear, paving, draw, atStation, parcel, showParcel };
}
export type StationJourney = ReturnType<typeof stationJourney>;
