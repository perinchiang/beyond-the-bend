import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GRAVEL, newGroundSample } from '../ground';
import { JUMP_HALF, GRID_N, CELL, Road, RoadHit, SHOULDER_DROP, SHOULDER_W, World } from '../world/world';
import { Biome, LAKE, WATER_LEVEL, WORLD_HALF, biomeAt } from '../world/terrain';
import { Look, sunDirection, surfaceMaterial } from './looks';

// ---- roads -----------------------------------------------------------------------------------

/** Pavement and shoulders of every road as one mesh, plus the painted lines as another. */
export function buildRoads(world: World, look: Look): THREE.Group {
  const R = look.road;
  const ROAD_COL = {
    main: new THREE.Color(R.tarmac), mountain: new THREE.Color(R.mountain), link: new THREE.Color(R.tarmac),
    gravel: new THREE.Color(R.gravel), shoulder: new THREE.Color(R.shoulder), line: new THREE.Color(R.line),
    track: new THREE.Color(R.gravel).multiplyScalar(0.88), crown: new THREE.Color(R.gravel).lerp(new THREE.Color(R.shoulder), 0.6).multiplyScalar(1.05),
  };
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const lpos: number[] = [], lcol: number[] = [], lidx: number[] = [];
  const hit = {} as RoadHit;
  for (const road of world.roads) {
    const hw = road.def.halfWidth, base = pos.length / 3;
    const paved = road.def.surface === GRAVEL ? ROAD_COL.gravel : ROAD_COL[road.def.kind];
    // Six vertices across: shoulder (2, earth), pavement (2), shoulder (2, earth). The pavement
    // edges are doubled so the colour changes sharply there.
    const offs = [hw + SHOULDER_W, hw, hw, -hw, -hw, -hw - SHOULDER_W];
    for (let i = 0; i < road.n; i++) {
      for (let k = 0; k < 6; k++) {
        const x = road.x[i] + road.tz[i] * offs[k], z = road.z[i] - road.tx[i] * offs[k];
        const outer = k === 0 || k === 5, earth = k < 2 || k > 3;
        let y = road.y[i] - (outer ? SHOULDER_DROP : 0);
        // Where this vertex lies on another road's pavement, tuck it just under that surface:
        // an earlier road for the pavement, any road for the shoulder. Edges that merely
        // coincide (the first metres of a fork) are left alone.
        if (road.junction[i] && world.nearestRoad(x, z, 12, hit, null, earth ? 1e9 : road.index, road)
          && hit.dist < hit.road.def.halfWidth - (earth ? 0.02 : -0.3)) {
          y = hit.road.y[hit.i] + hit.road.grade[hit.i] * hit.along - (earth ? 0.3 : 0.02);
        }
        pos.push(x, y, z);
        const c = earth ? ROAD_COL.shoulder : paved;
        col.push(c.r, c.g, c.b);
      }
    }
    const quads = road.closed ? road.n : road.n - 1;
    for (let i = 0; i < quads; i++) {
      const a = base + i * 6, b = base + ((i + 1) % road.n) * 6;
      for (const k of [0, 2, 4]) idx.push(a + k, a + k + 1, b + k, b + k, a + k + 1, b + k + 1);
    }
    // Lines: solid at both edges, dashed down the middle. At a junction a line stops only
    // where it would run across another road's pavement.
    const crosses = (q: number, o: number) => road.junction[q] === 1
      && world.nearestRoad(road.x[q] + road.tz[q] * o, road.z[q] - road.tx[q] * o, 12, hit, null, 1e9, road)
      && hit.dist < hit.road.def.halfWidth - 0.05;
    const strip = (offset: number, width: number, on: (i: number) => boolean, c = ROAD_COL.line) => {
      for (let i = 0; i < quads; i++) {
        const j = (i + 1) % road.n;
        if (!on(i) || crosses(i, offset) || crosses(j, offset)) continue;
        const v = lpos.length / 3;
        for (const q of [i, j]) for (const o of [offset + width / 2, offset - width / 2]) {
          lpos.push(road.x[q] + road.tz[q] * o, road.y[q] + 0.02, road.z[q] - road.tx[q] * o);
          lcol.push(c.r, c.g, c.b);
        }
        lidx.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
      }
    };
    if (road.def.surface === GRAVEL) {
      // Gravel has no paint: two worn wheel tracks, and a paler crown between them.
      if (look.verge) {
        strip(0.95, 0.75, () => true, ROAD_COL.track); strip(-0.95, 0.75, () => true, ROAD_COL.track);
        strip(0, 0.5, (i) => i % 11 < 8, ROAD_COL.crown);
      }
      continue;
    }
    strip(hw - 0.3, 0.16, () => true);
    strip(-hw + 0.3, 0.16, () => true);
    if (road.def.kind !== 'link') strip(0, 0.16, (i) => i % 6 < 2);
  }
  const group = new THREE.Group();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, surfaceMaterial(look, { vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
  mesh.receiveShadow = true;
  const lgeo = new THREE.BufferGeometry();
  lgeo.setAttribute('position', new THREE.Float32BufferAttribute(lpos, 3));
  lgeo.setAttribute('color', new THREE.Float32BufferAttribute(lcol, 3));
  lgeo.setIndex(lidx);
  lgeo.computeVertexNormals();
  const lines = new THREE.Mesh(lgeo, surfaceMaterial(look, { vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
  lines.receiveShadow = true;
  for (const m of [mesh, lines]) { m.frustumCulled = false; m.matrixAutoUpdate = false; group.add(m); }
  group.matrixAutoUpdate = false;
  return group;
}

// ---- trees, roadside growth, posts ----------------------------------------------------------

/**
 * A piece of a plant. Foliage carries a grey tone (darker below, lighter above) that is
 * multiplied by the instance's colour; wood carries its own colour and ignores the instance.
 */
function part(g: THREE.BufferGeometry, leaf: boolean, tone: (y: number) => number, wood = '#ffffff', jitter = 0): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  const pos = out.attributes.position, n = pos.count, c = new THREE.Color(wood);
  const col = new Float32Array(n * 3), mask = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (jitter) {
      // Displace by a hash of the position so coincident vertices move together.
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const h = (k: number) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + k * 19.3) * 43758.5453; return (s - Math.floor(s) - 0.5) * 2 * jitter; };
      pos.setXYZ(i, x + h(1), y + h(2) * 0.7, z + h(3));
    }
    const t = leaf ? tone(pos.getY(i)) : 1;
    col[i * 3] = leaf ? t : c.r; col[i * 3 + 1] = leaf ? t : c.g; col[i * 3 + 2] = leaf ? t : c.b;
    mask[i] = leaf ? 1 : 0;
  }
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('aLeaf', new THREE.BufferAttribute(mask, 1));
  out.deleteAttribute('uv');
  return out;
}
const ramp = (y0: number, y1: number, lo: number, hi: number) => (y: number) => lo + (hi - lo) * Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
const ball = (r: number, detail: number, x: number, y: number, z: number, sy = 1) => new THREE.IcosahedronGeometry(r, detail).scale(1, sy, 1).translate(x, y, z);

/** Trees of unit height in the look's style: [conifer, broadleaf]. */
function treeGeometries(look: Look): THREE.BufferGeometry[] {
  const T = look.trees, wood = (g: THREE.BufferGeometry, c = T.trunk) => part(g, false, () => 1, c);
  let conifer: THREE.BufferGeometry[], broadleaf: THREE.BufferGeometry[];
  if (T.style === 'tiered') {
    // Three stacked skirts, lighter towards the top; a lumpy two-ball crown on a stout trunk.
    conifer = [
      wood(new THREE.CylinderGeometry(0.028, 0.04, 0.2, 5).translate(0, 0.1, 0)),
      part(new THREE.ConeGeometry(0.26, 0.42, 7).translate(0, 0.37, 0), true, () => 0.82),
      part(new THREE.ConeGeometry(0.2, 0.38, 7).rotateY(0.4).translate(0, 0.59, 0), true, () => 0.96),
      part(new THREE.ConeGeometry(0.14, 0.38, 7).rotateY(0.9).translate(0, 0.81, 0), true, () => 1.1),
    ];
    broadleaf = [
      wood(new THREE.CylinderGeometry(0.03, 0.046, 0.44, 5).translate(0, 0.22, 0), T.trunkBroadleaf),
      part(ball(0.34, 1, 0, 0.68, 0, 0.84), true, ramp(0.45, 0.95, 0.84, 1.12), '#fff', 0.03),
      part(ball(0.2, 0, 0.2, 0.5, 0.06), true, ramp(0.35, 0.7, 0.8, 0.98), '#fff', 0.02),
    ];
  } else if (T.style === 'soft') {
    // A rounded fir turned on a lathe; a cloud of three balls on a tall pale trunk.
    const fir = [[0, 1], [0.05, 0.9], [0.115, 0.7], [0.175, 0.46], [0.19, 0.3], [0.13, 0.2], [0, 0.18]].map(([r, y]) => new THREE.Vector2(r, y));
    conifer = [
      wood(new THREE.CylinderGeometry(0.02, 0.03, 0.22, 6).translate(0, 0.11, 0)),
      part(new THREE.LatheGeometry(fir, 9), true, ramp(0.2, 1, 0.88, 1.1)),
    ];
    broadleaf = [
      wood(new THREE.CylinderGeometry(0.02, 0.032, 0.5, 6).translate(0, 0.25, 0), T.trunkBroadleaf),
      part(ball(0.27, 2, 0, 0.72, 0, 0.9), true, ramp(0.45, 0.98, 0.86, 1.1)),
      part(ball(0.19, 1, 0.18, 0.6, 0.06, 0.9), true, ramp(0.4, 0.8, 0.84, 1.02)),
      part(ball(0.2, 1, -0.16, 0.63, -0.08, 0.9), true, ramp(0.4, 0.85, 0.84, 1.04)),
    ];
  } else if (T.style === 'simple') {
    // One cone, one egg: shapes that survive being printed in two tones.
    conifer = [
      wood(new THREE.CylinderGeometry(0.016, 0.02, 0.2, 5).translate(0, 0.1, 0)),
      part(new THREE.ConeGeometry(0.19, 0.84, 10).translate(0, 0.58, 0), true, () => 1),
    ];
    broadleaf = [
      wood(new THREE.CylinderGeometry(0.018, 0.026, 0.44, 5).translate(0, 0.22, 0), T.trunkBroadleaf),
      part(ball(0.3, 2, 0, 0.68, 0, 1.12), true, () => 1),
    ];
  } else {
    conifer = [wood(new THREE.CylinderGeometry(0.02, 0.03, 0.24, 5).translate(0, 0.12, 0)), part(new THREE.ConeGeometry(0.2, 0.84, 7).translate(0, 0.62, 0), true, () => 1)];
    broadleaf = [wood(new THREE.CylinderGeometry(0.026, 0.038, 0.42, 5).translate(0, 0.21, 0)), part(ball(0.34, 1, 0, 0.68, 0, 0.86), true, () => 1)];
  }
  return [mergeGeometries(conifer), mergeGeometries(broadleaf)];
}

/** Roadside growth of unit size: a tuft of grass blades, a low bush, a stone. */
function vergeGeometries(): THREE.BufferGeometry[] {
  // Blades are lit as if they were ground (normals straight up, both faces), so they sit in
  // the meadow's own light instead of standing out as dark spikes.
  const pos: number[] = [], nor: number[] = [];
  for (let b = 0; b < 9; b++) {
    const a = b * 2.4 + 0.3, r = 0.06 + 0.07 * (b % 3), h = 0.5 + 0.5 * ((b * 37) % 5) / 4, lean = 0.16 + 0.12 * (b % 2);
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r, px = -Math.sin(a) * 0.11, pz = Math.cos(a) * 0.11;
    const tx = cx + Math.cos(a) * lean, tz = cz + Math.sin(a) * lean;
    pos.push(cx - px, 0, cz - pz, cx + px, 0, cz + pz, tx, h, tz, cx + px, 0, cz + pz, cx - px, 0, cz - pz, tx, h, tz);
    for (let v = 0; v < 6; v++) nor.push(0, 1, 0);
  }
  const blades = new THREE.BufferGeometry();
  blades.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  blades.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return [
    part(blades, true, ramp(0, 0.9, 0.78, 1.12)),
    part(ball(0.5, 1, 0, 0.3, 0, 0.72), true, ramp(0, 0.66, 0.8, 1.1), '#fff', 0.05),
    part(new THREE.IcosahedronGeometry(0.5, 0).scale(1.25, 0.7, 0.9).translate(0, 0.16, 0), true, ramp(-0.2, 0.5, 0.82, 1.06), '#fff', 0.1),
  ];
}

function blobTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!, grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.6, 'rgba(255,255,255,0.75)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export interface Props {
  group: THREE.Group;
  /** Hide batches far from the camera. */
  update(camX: number, camZ: number): void;
}

interface Item { m: THREE.Matrix4; x: number; z: number; color?: THREE.Color }
const hash = (a: number, b: number) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };

export function buildProps(world: World, look: Look): Props {
  const group = new THREE.Group();
  const BATCH = 512, NB = (WORLD_HALF * 2) / BATCH;
  const batches: { x: number; z: number; mesh: THREE.Object3D; far: number }[] = [];
  /** Draw a list of instances as one mesh per 512 m square, so off-screen squares are skipped. */
  const scatter = (items: Item[], geo: THREE.BufferGeometry, mat: THREE.Material, far: number, order = 0) => {
    const buckets = new Map<number, Item[]>();
    for (const it of items) {
      const key = Math.floor((it.z + WORLD_HALF) / BATCH) * NB + Math.floor((it.x + WORLD_HALF) / BATCH);
      (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(it);
    }
    for (const [key, list] of buckets) {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((it, n) => { mesh.setMatrixAt(n, it.m); if (it.color) mesh.setColorAt(n, it.color); });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.matrixAutoUpdate = false; mesh.renderOrder = order;
      group.add(mesh);
      batches.push({ x: (key % NB + 0.5) * BATCH - WORLD_HALF, z: (Math.floor(key / NB) + 0.5) * BATCH - WORLD_HALF, mesh, far });
    }
  };
  /** Foliage material: the instance colour tints leaves only (see `part`). */
  const plant = (faceted: boolean) => {
    const m = surfaceMaterial(look, { vertexColors: true, flatShading: faceted });
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aLeaf;')
        .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb = mix(color.rgb, vColor.rgb, aLeaf);');
    };
    return m;
  };
  const pick = (list: string[], h: number) => list[Math.min(list.length - 1, Math.floor(h * list.length))];
  const sun = sunDirection(look), T = look.trees;
  const m4 = () => new THREE.Matrix4(), q = new THREE.Quaternion(), tilt = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), nrm = new THREE.Vector3(), gs = newGroundSample();

  // Trees, and a soft shadow under each, stretched away from the sun along the ground.
  const geos = treeGeometries(look), treeMat = plant(T.faceted);
  const trees: Item[][] = [[], []], shadows: Item[] = [];
  const sunYaw = Math.atan2(sun.x, sun.z), reach = Math.min(3.2, Math.hypot(sun.x, sun.z) / -sun.y);
  world.trees.forEach((t, ti) => {
    const h1 = hash(ti, 1.7), h2 = hash(ti, 9.1);
    const color = new THREE.Color(h1 < T.accentShare && T.accent.length ? pick(T.accent, h2) : pick(t.kind ? T.broadleaf : T.conifer, h2));
    color.multiplyScalar(0.94 + 0.12 * hash(ti, 4.3));
    q.setFromAxisAngle(up, (ti * 2.399) % (Math.PI * 2));
    trees[t.kind].push({ m: m4().compose(p.set(t.x, t.y - 0.2, t.z), q, s.setScalar(t.height)), x: t.x, z: t.z, color });
    const crown = (t.kind ? 0.68 : 0.46) * t.height, len = crown + t.height * 0.55 * reach;
    const cx = t.x + (sun.x / -sun.y) * t.height * 0.3, cz = t.z + (sun.z / -sun.y) * t.height * 0.3;
    world.sample(cx, cz, gs);
    tilt.setFromUnitVectors(up, nrm.set(gs.nx, gs.ny, gs.nz));
    q.setFromAxisAngle(up, sunYaw).premultiply(tilt);
    shadows.push({ m: m4().compose(p.set(cx, gs.y + 0.05, cz), q, s.set(crown, 1, len)), x: cx, z: cz });
  });
  scatter(trees[0], geos[0], treeMat, 3000);
  scatter(trees[1], geos[1], treeMat, 3000);
  const shadowMat = new THREE.MeshBasicMaterial({ color: T.shadow, alphaMap: blobTexture(), transparent: true, opacity: T.shadowOpacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  scatter(shadows, new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), shadowMat, 1500, 1);

  // Marker posts every 50 m on both sides, and tall orange posts either side of each jump.
  const posts: THREE.Matrix4[] = [], pylons: THREE.Matrix4[] = [];
  const stand = (list: THREE.Matrix4[], road: Road, i: number, off: number) => {
    const x = road.x[i] + road.tz[i] * off, z = road.z[i] - road.tx[i] * off;
    list.push(new THREE.Matrix4().makeTranslation(x, world.sample(x, z, gs).y, z));
  };
  // Roadside growth: grass tufts, the odd bush, stones on the massif. Besides dressing the
  // verge, things passing close to the car are what make speed readable.
  const V = look.verge, tufts: Item[] = [], bushes: Item[] = [], rocks: Item[] = [];
  const biome: Biome = { mountain: 0, forest: 0 }, forestFloor = new THREE.Color(look.ground.forest);
  const offRoad = (x: number, z: number) => {
    const ix = Math.round((x + WORLD_HALF) / CELL), iz = Math.round((z + WORLD_HALF) / CELL);
    return ix > 0 && iz > 0 && ix < GRID_N - 1 && iz < GRID_N - 1 && world.roadDist[iz * GRID_N + ix] >= 2;
  };
  for (const road of world.roads) {
    if (road.def.kind === 'link') continue;
    const every = Math.round(50 / road.step);
    for (let i = 0; i < road.n; i += every) {
      if (road.junction[i]) continue;
      for (const side of [-1, 1]) stand(posts, road, i, side * (road.def.halfWidth + 1.1));
    }
    for (const f of road.def.features ?? []) {
      const c = world.nearestSample(road, f.at[0], f.at[1]);
      for (const d of [-JUMP_HALF, -12.5, 12.5, JUMP_HALF]) {
        const i = ((c + Math.round(d / road.step)) % road.n + road.n) % road.n;
        for (const side of [-1, 1]) stand(pylons, road, i, side * (road.def.halfWidth + 1.6));
      }
    }
    if (!V) continue;
    for (let i = 0; i < road.n; i++) for (let k = 0; k < 4; k++) {
      const side = k % 2 ? 1 : -1, seed = i * 4 + k + road.index * 7919, h = hash(seed, 0.3);
      if (h > 0.7) continue;
      const off = side * (road.def.halfWidth + SHOULDER_W + 0.2 + 7.5 * hash(seed, 2.1) ** 1.6);
      const x = road.x[i] + road.tz[i] * off + (hash(seed, 3.3) - 0.5) * 2, z = road.z[i] - road.tx[i] * off + (hash(seed, 5.9) - 0.5) * 2;
      if (!offRoad(x, z)) continue;
      const y = world.heightAt(x, z);
      if (y < WATER_LEVEL + 0.8) continue;
      biomeAt(x, z, biome);
      const kind = h < 0.02 ? 1 : biome.mountain > 0.45 && h < 0.12 ? 2 : biome.mountain > 0.45 && h > 0.35 ? -1 : 0;
      if (kind < 0) continue;
      const size = kind === 0 ? 0.5 + 0.65 * hash(seed, 7.7) : kind === 1 ? 1 + 1.3 * hash(seed, 7.7) : 0.6 + 1.5 * hash(seed, 7.7) ** 2;
      q.setFromAxisAngle(up, hash(seed, 8.8) * 6.283);
      const color = new THREE.Color(kind === 2 ? V.rock : pick(kind ? V.bush : V.grass, hash(seed, 6.1))).multiplyScalar(0.93 + 0.14 * hash(seed, 1.9));
      // Grass takes on the forest floor's colour under the trees, so it belongs to the ground it grows from.
      if (kind === 0) color.lerp(forestFloor, 0.55 * biome.forest);
      (kind === 0 ? tufts : kind === 1 ? bushes : rocks).push({ m: m4().compose(p.set(x, y - 0.03, z), q, s.setScalar(size)), x, z, color });
    }
  }
  if (V) {
    const [tuft, bush, rock] = vergeGeometries();
    scatter(tufts, tuft, plant(false), 450);
    scatter(bushes, bush, plant(T.faceted), 1200);
    scatter(rocks, rock, plant(true), 1200);
  }
  const instanced = (geo: THREE.BufferGeometry, color: string, list: THREE.Matrix4[]) => {
    const m = new THREE.InstancedMesh(geo, surfaceMaterial(look, { color }), list.length);
    list.forEach((mat, i) => m.setMatrixAt(i, mat));
    m.instanceMatrix.needsUpdate = true; m.frustumCulled = false; m.matrixAutoUpdate = false;
    group.add(m);
  };
  instanced(new THREE.BoxGeometry(0.12, 0.95, 0.12).translate(0, 0.47, 0), '#f1efe6', posts);
  instanced(new THREE.BoxGeometry(0.28, 3.6, 0.28).translate(0, 1.8, 0), '#e8833a', pylons);
  group.matrixAutoUpdate = false;
  return {
    group,
    update(camX, camZ) {
      for (const b of batches) b.mesh.visible = Math.hypot(b.x - camX, b.z - camZ) < b.far + 362;
    },
  };
}

// ---- sky, water ------------------------------------------------------------------------------

export function buildSky(look: Look): THREE.Mesh {
  const S = look.sky, col = (c: string) => ({ value: new THREE.Color(c) });
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: {
      uHorizon: col(S.horizon), uZenith: col(S.zenith), uGlow: col(S.glow), uCloudLight: col(S.cloudLight), uCloudShade: col(S.cloudShade),
      uSun: { value: sunDirection(look).negate() }, uGlowAmount: { value: S.glowAmount }, uCurve: { value: S.curve },
      uCloud: { value: S.cloud }, uCloudSoft: { value: S.cloudSoft }, uCloudBars: { value: S.cloudBars }, uCloudDetail: { value: S.cloudDetail },
    },
    vertexShader: /* glsl */ `varying vec3 vDir; void main() { vDir = position; vec4 p = projectionMatrix * mat4(mat3(modelViewMatrix)) * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uHorizon, uZenith, uSun, uGlow, uCloudLight, uCloudShade;
      uniform float uGlowAmount, uCurve, uCloud, uCloudSoft, uCloudBars, uCloudDetail;
      varying vec3 vDir;
      float hash(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.y); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.0; a *= 0.5; } return s / 0.9375; }
      void main() {
        vec3 d = normalize(vDir);
        float t = pow(clamp(d.y, 0.0, 1.0), uCurve);
        vec3 c = mix(uHorizon, uZenith, t);
        c += uGlow * uGlowAmount * pow(max(dot(d, uSun), 0.0), 6.0);
        if (uCloud > 0.0 && d.y > 0.015) {
          // Puffs live on a flat deck overhead; bars are laid out by compass bearing and
          // height above the horizon, so they stay level across the picture.
          vec2 deck = d.xz / (d.y + 0.14) * 1.2 + 40.0;
          vec2 bars = vec2(atan(d.x, d.z) * 1.6, d.y * 15.0) + 40.0;
          vec2 q = mix(deck, bars, uCloudBars);
          float coarse = vnoise(q) * 0.72 + vnoise(q * 2.03 + 17.0) * 0.28;
          float n = mix(coarse, fbm(q), uCloudDetail);
          float lit = vnoise(q + vec2(0.0, 0.22)) * 0.72 + vnoise((q + vec2(0.0, 0.22)) * 2.03 + 17.0) * 0.28;
          float cover = smoothstep(1.0 - uCloud, 1.0 - uCloud + uCloudSoft, n) * smoothstep(0.015, 0.16, d.y);
          vec3 cloud = mix(uCloudLight, uCloudShade, smoothstep(0.0, 0.1, lit - coarse) * (1.0 - uCloudBars));
          c = mix(c, cloud, cover);
        }
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), mat);
  sky.frustumCulled = false; sky.renderOrder = -10;
  return sky;
}

export function buildWater(look: Look): THREE.Mesh {
  const size = LAKE.sigma * 3.2;
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
    surfaceMaterial(look, { color: look.water, transparent: true, opacity: 0.9 }),
  );
  water.position.set(LAKE.x, WATER_LEVEL, LAKE.z);
  water.updateMatrix(); water.matrixAutoUpdate = false;
  return water;
}
