import { drawMillBridge, wetBank, shorePoint } from './millBrook';
import { drawSawyard, millClearing } from './cedar';
import * as THREE from 'three';
import type { StyleStudy } from '../render/styleStudy';
import { Rng } from '../core/rng';
import { fbm2, noise2, smoothstep } from '../core/noise';
import type { StationJourney } from './station';
import { HeightField } from './heightfield';
import { ROAD_HALF_WIDTH, Track } from './track';
import { edgeDistance, type GroundPatch } from './terrain';
import { PaintShared, paintMaterial } from '../render/paint';
import { woodlandBrushes, PropBuilder, makeBroadleaf, makeConifer, makeFlower, paintedShrub, makeTuft } from './flora';
import { birchCrown, birchTrunk, birchBarkMaterial, birchLeafMaterial, fieldstone, STUDY_TREE, STUDY_STONE } from './paintedFlora';
import { gouacheStone, gouacheStoneMaterial, gouacheTuft } from './gouacheGroundProps';
import { createGouachePlants, gouacheFoliageMaterial } from './gouacheFlora';
import { createOilLibrary, oilMaterials } from './oilStudy';
import { createPrintLibrary, createPrintMaterial, printTuft } from './printStudy';
import { meadowMasks } from './meadow';

const CHUNK = 100; // metres — instances are batched per chunk so off-screen groups are culled
const HW = ROAD_HALF_WIDTH;

interface Batch { geo: THREE.BufferGeometry; mats: THREE.Matrix4[]; cols: THREE.Color[] }

class Batcher {
  private map = new Map<string, Batch>();
  add(id: string, geo: THREE.BufferGeometry, m: THREE.Matrix4, c: THREE.Color) {
    const cx = Math.floor(m.elements[12] / CHUNK), cz = Math.floor(m.elements[14] / CHUNK);
    const key = `${id}|${cx}|${cz}`;
    let b = this.map.get(key);
    if (!b) this.map.set(key, (b = { geo, mats: [], cols: [] }));
    b.mats.push(m.clone());
    b.cols.push(c.clone());
  }
  flush(material: THREE.Material, cast: boolean, receive: boolean, parent: THREE.Object3D): number {
    let total = 0;
    for (const b of this.map.values()) {
      const mesh = new THREE.InstancedMesh(b.geo, material, b.mats.length);
      b.mats.forEach((m, i) => { mesh.setMatrixAt(i, m); mesh.setColorAt(i, b.cols[i]); });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      mesh.computeBoundingSphere();
      mesh.computeBoundingBox();
      parent.add(mesh);
      total += b.mats.length;
    }
    this.map.clear();
    return total;
  }
}

export interface ScatterStats { trees: number; bushes: number; rocks: number; tufts: number; flowers: number }

export function buildScatter(track: Track, hf: HeightField, shared: PaintShared, lowSpec: boolean, study?: StyleStudy, journey?: StationJourney): { group: THREE.Group; stats: ScatterStats; patches: GroundPatch[] } {
  const group = new THREE.Group();
  group.name = 'scatter';
  const rng = new Rng(7331);

  // ---------- materials ----------
  const swayVertex = /* glsl */ `
    {
      #ifdef USE_INSTANCING
        vec3 ip = instanceMatrix[3].xyz;
      #else
        vec3 ip = vec3(0.0);
      #endif
      float ph = ip.x * 0.31 + ip.z * 0.27;
      float gust = sin(uTime * 1.25 + ph) * 0.6 + sin(uTime * 2.7 + ph * 1.7 + position.y * 0.7) * 0.4;
      float flutter = sin(uTime * 4.1 + position.x * 5.3 + position.z * 4.7 + ph);
      transformed.xz += aSway * (gust * 0.045 + flutter * 0.012) * vec2(0.8, 0.6);
      transformed.y += aSway * flutter * 0.008;
    }
  `;
  const oil = study === 'oil' ? oilMaterials(shared, swayVertex) : undefined;
  const ink = study === 'print' ? createPrintMaterial(shared, swayVertex) : undefined;
  const studyLeaves = study === 'gouache' ? gouacheFoliageMaterial(shared, swayVertex) : ink ?? oil?.foliage;
  const foliageMat = studyLeaves ?? paintMaterial(new THREE.MeshLambertMaterial({ map: woodlandBrushes(), alphaTest: 0.42, alphaToCoverage: true, vertexColors: true, side: THREE.DoubleSide }), shared, {
    key: 'foliage',
    vertexPars: 'attribute float aSway;',
    vertexMain: swayVertex,
    volumeNormals: true,
    lensFade: true,
    fragColor: /* glsl */ `
      {
        // the same paper tooth as the ground, so foliage belongs to the same painting
        float n = texture2D(uNoise, vWorldPos.xz / 6.3 + vWorldPos.y * 0.13).b;
        diffuseColor.rgb *= 1.0 + (n - 0.5) * 0.14;
      }
    `,
  });
  const groundCoverMat = paintMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), shared, {
    key: 'cover',
    vertexPars: 'attribute float aSway;',
    vertexMain: swayVertex,
    volumeNormals: true,
  });
  const rockMat = study === 'gouache' ? gouacheStoneMaterial(shared) : ink ?? oil?.stone ?? paintMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), shared, {
    key: 'rock',
    vertexPars: 'varying vec3 vStone;',
    vertexMain: 'vStone = position;',
    fragPars: 'varying vec3 vStone;',
    fragColor: /* glsl */ `
      {
        vec4 grain = texture2D(uNoise, vStone.xz * 0.17 + vStone.y * 0.08);
        vec2 face = vec2(vStone.z + 0.37*vStone.x, vStone.y - 0.12*vStone.x);
        vec4 fleck = texture2D(uNoise, face * vec2(0.41,0.36));
        float bed = vStone.y - 0.13*vStone.x + 0.065*vStone.z + 0.068*(grain.r-0.5);
        float feather = max(0.012, fwidth(bed));
        float seam = 1.0 - smoothstep(0.014, 0.014 + feather, abs(bed - 0.38));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.73,0.65,0.51), seam * smoothstep(0.46,0.72,grain.g) * 0.47);
        float moss = (1.0-smoothstep(0.16,0.42,bed)) * smoothstep(0.37,0.60,grain.r);
        diffuseColor.rgb = mix(diffuseColor.rgb,vec3(0.27,0.33,0.17),moss * 0.72);
        float split = smoothstep(0.11,0.18,bed) * (1.0-smoothstep(0.26,0.37,bed+0.055*fleck.r));
        diffuseColor.rgb = mix(diffuseColor.rgb,vec3(0.27,0.22,0.28),split*(0.17+0.28*grain.r));
        float lichen = smoothstep(0.61,0.75,grain.g + 0.15*(grain.b-0.5)) * smoothstep(0.26,0.48,bed);
        diffuseColor.rgb = mix(diffuseColor.rgb,vec3(0.52,0.53,0.34),lichen*0.58);
        diffuseColor.rgb *= 0.89 + 0.13*grain.a + 0.11*smoothstep(0.37,0.65,fleck.r);
      }
    `,
  });
  const propMat = paintMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), shared, { key: 'prop' });

  // ---------- model library ----------
  const birchLeaves = studyLeaves ?? birchLeafMaterial(shared, swayVertex);
  const trunk = birchTrunk();
  const makeGrass = study === 'gouache' ? gouacheTuft : study === 'print' ? printTuft : makeTuft;
  const tufts = [1, 2, 3].map(seed => makeGrass(seed, study === 'oil'));
  const grassMat = paintMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), shared, {
    key: study ? `meadow-grass-${study}` : 'meadow-grass', vertexPars: 'attribute float aSway;', vertexMain: swayVertex, volumeNormals: true,
    fragPars: meadowMasks,
    fragColor: `
      vec2 fields = meadowMasks(vWorldPos.xz, 0.0);
      float value = dot(diffuseColor.rgb, vec3(0.30, 0.59, 0.11));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.65, 1.32, 0.54) * (0.14 + value * 0.61), fields.x * 0.91);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.54, 1.08, 0.82) * (0.10 + value * 0.67), fields.y * 0.76);
      ${study === 'gouache' ? `
        vec3 sage = mix(vec3(0.21,0.32,0.22), vec3(0.43,0.49,0.29), smoothstep(0.13,0.40,value));
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(sage, vec3(0.58,0.49,0.27), fields.x), 0.74);
      ` : study === 'print' ? `
        vec3 ink = mix(vec3(0.20,0.29,0.19), vec3(0.42,0.50,0.26), smoothstep(0.20,0.31,value));
        ink = mix(ink, vec3(0.52,0.44,0.20), fields.x);
        diffuseColor.rgb = mix(diffuseColor.rgb, ink, 0.68);
      ` : ''}
    `,
  });
  const lib = study === 'gouache' ? {
    ...createGouachePlants(lowSpec), rock: [0, 1, 2].map(gouacheStone),
  } : study === 'print' ? createPrintLibrary() : study === 'oil' ? createOilLibrary(lowSpec) : {
    oak: [makeBroadleaf(11, 'oak', lowSpec), makeBroadleaf(12, 'oak', lowSpec)],
    lime: [makeBroadleaf(21, 'lime', lowSpec), makeBroadleaf(22, 'lime', lowSpec)],
    plum: [makeBroadleaf(31, 'plum', lowSpec)],
    fir: [makeConifer(41), makeConifer(42)],
    birch: [birchCrown(lowSpec)],
    bush: [paintedShrub(61, false, lowSpec), paintedShrub(62, false, lowSpec)],
    bloom: [paintedShrub(71, true, lowSpec)],
    rock: [fieldstone(0), fieldstone(1), fieldstone(2)],
  };
  type Species = keyof typeof lib;

  const woodyPlants = new Batcher(), rocks = new Batcher(), cover = new Batcher();
  const shrubs = study ? new Batcher() : woodyPlants;
  const bark = new Batcher(), brushes = new Batcher(), grass = new Batcher();
  const patches: GroundPatch[] = [];
  const placed: { x: number; z: number; r: number }[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const tint = new THREE.Color();
  const stats: ScatterStats = { trees: 0, bushes: 0, rocks: 0, tufts: 0, flowers: 0 };

  const free = (x: number, z: number, r: number) => {
    if (track.cedar && (millClearing(x,z) || wetBank(x,z))) return false;
    if (journey?.keepClear(x, z)) return false;
    for (const o of placed) if ((o.x - x) ** 2 + (o.z - z) ** 2 < (o.r + r) ** 2) return false;
    return true;
  };
  const ok = (x: number, z: number, roadGap: number, edge = -13) => hf.roadDist(x, z) > HW + roadGap && edgeDistance(x, z) < edge;

  const put = (batch: Batcher, sp: Species, x: number, z: number, scale: number, lean = 0.04, sink = 0, jitter = 0.07) => {
    const geos = lib[sp];
    const vi = Math.floor(rng.next() * geos.length);
    e.set(rng.range(-lean, lean), rng.range(0, Math.PI * 2), rng.range(-lean, lean));
    q.setFromEuler(e);
    s.set(scale * rng.range(0.94, 1.06), scale * rng.range(0.92, 1.1), scale * rng.range(0.94, 1.06));
    p.set(x, hf.height(x, z) - sink, z);
    m.compose(p, q, s);
    const v = 1 + rng.gauss() * jitter;
    tint.setRGB(v * (1 + rng.gauss() * 0.03), v, v * (1 + rng.gauss() * 0.04));
    if (sp === 'birch') {
      // Keep the approved avenue specimen's original pose.
      if (Math.hypot(x - STUDY_TREE.x, z - STUDY_TREE.y) < 0.6) {
        m.makeTranslation(p.x, p.y, p.z);
        tint.setRGB(1, 1, 1);
      }
      bark.add('birch', trunk, m, tint);
      brushes.add('birch', geos[vi], m, tint);
    } else if (sp === 'rock' && Math.hypot(x - STUDY_STONE.x, z - STUDY_STONE.y) < 0.6) {
      m.makeTranslation(x, hf.height(x, z), z);
      tint.setRGB(1, 1, 1);
      rocks.add('rock0', geos[0], m, tint);
    } else {
      batch.add(`${sp}${vi}`, geos[vi], m, tint);
    }
    if (sp === 'rock') {
      // A staggered tuft or two catches on the broken lip. Sample the terrain
      // under each tuft so the blades stay rooted on the sloping outcrops.
      for (const [dx, dz, size] of [[0.60, -0.65, 0.78], [0.76, -0.44, 0.60], [-0.42, 0.87, 0.68]]) {
        const foot = new THREE.Vector3(dx, 0, dz).applyMatrix4(m);
        foot.y = hf.height(foot.x, foot.z) - 0.025;
        const matrix = m.clone().scale(new THREE.Vector3(size, size, size)).setPosition(foot);
        grass.add(`tuft${vi}`, tufts[vi], matrix, new THREE.Color('#91a268'));
        stats.tufts++;
      }
    }
  };

  const tree = (sp: Species, x: number, z: number, scale: number, radius = 3.2, roadGap = 7.5, edgeLimit = -13): boolean => {
    // Leave an opening in the hairpin plantation to reveal the exit meadow.
    if (Math.hypot((x - 68) / 12, (z + 136) / 15) < 1) return false;
    // Open the field beside the outgoing straight and the inside of the station bend.
    if (journey && ((x > -81 && x < 62 && z > 48 && z < 102) ||
      (x > 62 && x < 145 && z > -30 && z < 72 && hf.roadDist(x, z) < 18))) return false;
    if (!ok(x, z, roadGap, edgeLimit) || !free(x, z, radius * scale * 0.72)) return false;
    put(woodyPlants, sp, x, z, scale);
    placed.push({ x, z, r: radius * scale * 0.72 });
    stats.trees++;
    return true;
  };
  const bush = (x: number, z: number, scale: number, bloom = false) => {
    if (!ok(x, z, 2.4) || !free(x, z, 0.5)) return;
    put(shrubs, bloom ? 'bloom' : 'bush', x, z, scale, 0.06, 0.05);
    patches.push({ x, z, radius: 1.8 * scale });
    stats.bushes++;
  };
  const rock = (x: number, z: number, scale: number) => {
    if (!ok(x, z, 1.9) || !free(x, z, 0.6)) return;
    put(rocks, 'rock', x, z, scale, 0.12, 0.08 * scale, 0.05);
    placed.push({ x, z, r: 0.8 * scale });
    patches.push({ x, z, radius: 1.58 * scale });
    stats.rocks++;
  };

  // ---------- 1. composed elements ----------
  // Birch allée flanking the long southern sweep — the "postcard" stretch.
  const nearestS = (x: number, z: number) => {
    let best = 0, bd = Infinity;
    for (const t of track.samples) { const d = (t.x - x) ** 2 + (t.z - z) ** 2; if (d < bd) { bd = d; best = t.s; } }
    return best;
  };
  const along = (s0: number, s1: number, step: number, fn: (t: ReturnType<Track['at']>, i: number) => void) => {
    let i = 0;
    for (let d = s0; d < s1; d += step) fn(track.at(d), i++);
  };
  const sA = journey ? 49 : nearestS(-70, 112), sB = journey ? 65 : nearestS(48, 104);
  along(sA, sB, 9.5, (t, i) => {
    for (const side of [-1, 1]) {
      if ((i + (side > 0 ? 1 : 0)) % 7 === 3) continue; // leave the odd gap
      const off = side * (HW + 7.1 + (i % 4 === 1 ? 2.2 : 0) + rng.range(-0.5, 0.8)), j = rng.range(-1.2, 1.2);
      tree('birch', t.x - t.tz * off + t.tx * j, t.z + t.tx * off + t.tz * j, rng.range(0.85, 1.12), 1.9, 4.6);
    }
  });

  // Three approach silhouettes: the plum beyond the avenue, a stepped
  // granite spur on the second S, and a fan of firs framing the hairpin.
  const roadside = (distance: number, offset: number) => {
    const t = track.at(distance);
    return { x: t.x - t.tz * offset, z: t.z + t.tx * offset };
  };
  const plum = roadside(sB + 3, 11.5);
  tree('plum', plum.x, plum.z, 1.18);
  const spur = nearestS(52, -36);
  for (const [advance, offset, scale] of [[-5, 9.8, 1.4], [0, 10.4, 2.75], [4, 10, 2.05], [7, 8.4, 1.1]]) {
    const site = roadside(spur + advance, offset);
    rock(site.x, site.z, scale);
  }
  for (const [x, z, scale] of [[87, -139, 1.38], [91, -135, 1.12], [84, -136, 1.03], [80, -134, 0.84]]) {
    tree('fir', x, z, scale, 2.1, 4.0);
  }
  // Stagger low silhouettes behind the open southern sweep, leaving breaks
  // through which the far meadow still fades into paper.
  for (const [x, z, scale] of [[162, 94, 0.72], [166, 91, 0.94], [163, 85, 0.60], [160, 73, 0.68]]) {
    tree('lime', x, z, scale, 3.2, 7.5, 1);
  }

  if (track.cedar) {
    // Plant stands along changes in the terrain. Leave the inside of the mill bend
    // open; the chimney is visible across the apron before the road turns away.
    const stands: [number, number, number, number, Species[]][] = [
      [48, 40, 11, 7, ['birch','lime']], [18, 38, 10, 6, ['oak','birch']],
      [8, 5, 12, 14, ['fir','fir','lime']], [-8, 30, 13, 12, ['fir','oak']],
      [-52, -17, 11, 10, ['fir','fir','birch']], [-17,-18,10,9,['lime','oak']],
      [-47,-44,13,17,['fir','fir','birch']], [-5,-34,12,12,['fir','oak']],
      [-40,-150,14,12,['fir','lime']], [-4,-149,12,13,['fir','oak']],
      [26,-145,11,8,['birch','fir']], [17,-95,11,9,['birch','lime']], [38,-86,13,10,['fir','birch']],
    ];
    const plant = new Rng(451);
    for (const [x,z,r,count,mix] of stands) {
      for(let i=0; i<count*2; i++) {
        const a=plant.range(0,Math.PI*2), d=r*Math.sqrt(plant.next());
        tree(plant.pick(mix),x+Math.cos(a)*d,z+Math.sin(a)*d,plant.range(0.80,1.23),2.45,4.4);
      }
    }
    for (const [x,z,scale] of [[18,29,1.55],[19,31,1.08],[-20,-9,2.1],[-18,-11,1.5],
      [-17,-12,0.77],[35,-83,2.35],[36,-81,1.6],[36,-80,0.9]]) rock(x,z,scale);
  }

  // Authored groves: [x, z, radius, count, species mix]
  const groves: [number, number, number, number, Species[]][] = [
    [34, 44, 34, 20, ['oak', 'oak', 'lime', 'plum']], // on the landmark hill
    [87, -128, 12, 7, ['fir', 'fir', 'oak']], // inside the northern hairpin
    [96, -48, 22, 11, ['oak', 'lime', 'fir']], // between the esses
    [-100, -104, 26, 15, ['fir', 'fir', 'fir', 'oak']], // north-west fir stand
    [-20, 6, 30, 16, ['oak', 'lime', 'oak', 'plum']], // central wood
    [-96, 54, 22, 11, ['lime', 'oak', 'birch']], // western dip
    [8, 150, 26, 12, ['oak', 'fir', 'lime']], // southern backdrop
    [-10, -122, 20, 10, ['lime', 'birch', 'oak']],
    [150, -72, 18, 9, ['fir', 'oak']],
    [118, 44, 16, 8, ['oak', 'plum', 'lime']],
  ];
  for (const [gx, gz, gr, count, mix] of groves) {
    let done = 0, tries = 0;
    while (done < count && tries++ < count * 30) {
      const a = rng.range(0, Math.PI * 2), d = gr * Math.sqrt(rng.next());
      const sp = rng.pick(mix);
      const sc = sp === 'fir' ? rng.range(0.8, 1.25) : sp === 'birch' ? rng.range(0.85, 1.1) : rng.range(0.82, 1.3);
      if (tree(sp, gx + Math.cos(a) * d, gz + Math.sin(a) * d * 0.8, sc, sp === 'fir' ? 2.3 : sp === 'birch' ? 1.9 : 3.2)) done++;
    }
  }

  // ---------- 2. noise-driven background planting ----------
  for (let z = -170; z <= 170; z += 10) for (let x = -170; x <= 170; x += 10) {
    const px = x + rng.range(-4.5, 4.5), pz = z + rng.range(-4.5, 4.5);
    const dens = smoothstep(0.08, 0.42, fbm2(px / 95 + 5.5, pz / 95 - 2.5, 3, 301));
    if (rng.next() > dens * 0.8) continue;
    const cool = noise2(px / 120 - 3.3, pz / 120 + 7.7, 77);
    const roll = rng.next();
    const sp: Species = cool > 0.18 ? (roll < 0.75 ? 'fir' : 'oak') : roll < 0.5 ? 'oak' : roll < 0.84 ? 'lime' : roll < 0.93 ? 'birch' : 'plum';
    tree(sp, px, pz, rng.range(0.8, 1.25), sp === 'fir' ? 2.3 : sp === 'birch' ? 1.9 : 3.2);
  }

  // Lone specimen trees close to the road for foreground interest.
  along(0, track.length, 30, (t) => {
    if (rng.next() < 0.3) return;
    const side = rng.next() < 0.5 ? -1 : 1, off = side * (HW + rng.range(9, 17));
    tree(rng.pick<Species>(['oak', 'lime', 'oak', 'birch']), t.x - t.tz * off, t.z + t.tx * off, rng.range(0.9, 1.2));
  });

  // ---------- 3. understorey: bushes hug tree bases and the verge ----------
  if (journey) {
    for (const side of [-1, 1]) {
      for (let d = 49; d < (side < 0 ? 67 : 82); d += 1.8) {
        const site = roadside(d, side * rng.range(6.8, 7.5));
        bush(site.x, site.z, rng.range(0.9, 1.15));
      }
    }
  }
  const treeCount = placed.length;
  for (let i = 0; i < treeCount; i++) {
    const o = placed[i];
    const k = rng.next() < 0.5 ? rng.int(1, 3) : 0;
    for (let j = 0; j < k; j++) {
      const a = rng.range(0, 6.28), d = o.r + rng.range(0.6, 2.4);
      bush(o.x + Math.cos(a) * d, o.z + Math.sin(a) * d, rng.range(0.7, 1.25), rng.next() < 0.22);
    }
  }
  along(0, track.length, 11, (t) => {
    if (rng.next() < 0.42) return;
    const side = rng.next() < 0.5 ? -1 : 1, off = side * (HW + rng.range(3.0, 6.5));
    const x = t.x - t.tz * off, z = t.z + t.tx * off;
    bush(x, z, rng.range(0.7, 1.2), rng.next() < 0.3);
    if (rng.next() < 0.4) bush(x + rng.range(-1.6, 1.6), z + rng.range(-1.6, 1.6), rng.range(0.55, 0.9));
  });

  if (track.cedar) {
    const rushes = new Rng(318);
    for (const [u, side, count] of [[-18,1,22],[-10,-1,12],[-6,1,8],[8,-1,18],[15,1,26]]) {
      const foot = shorePoint(u,side*1.10);
      patches.push({ ...foot, radius: 3.1 });
      for (let i=0;i<count;i++) {
        const toe=shorePoint(u+rushes.range(-2.4,2.4),side*rushes.range(0.82,1.47));
        const size=rushes.range(1.1,2.0);
        e.set(0,rushes.range(-0.8,0.6),0);
        m.compose(p.set(toe.x,hf.height(toe.x,toe.z)-0.05,toe.z),
          q.setFromEuler(e),s.set(size,size*1.45,size));
        grass.add('brookRush'+i%3,tufts[i%3],m,tint.set('#97a877'));
      }
    }
    for (const [u,side,scale] of [[-8.5,1,1.2],[-9.6,0.9,0.7],[6.5,-1,1.4],[7.9,-1,0.75],[17,1,1.65]]) {
      const toe=shorePoint(u,side*1.16);
      put(rocks,'rock',toe.x,toe.z,scale,0.16,0.12*scale);
    }
  }

  // ---------- 4. rocks: outcrops on crests, plus a few beside the road ----------
  for (let i = 0; i < 46; i++) {
    const x = rng.range(-165, 165), z = rng.range(-165, 165);
    const crest = hf.height(x, z) - (hf.height(x + 9, z) + hf.height(x - 9, z) + hf.height(x, z + 9) + hf.height(x, z - 9)) / 4;
    if (crest < 0.12 && rng.next() < 0.75) continue;
    const k = rng.int(2, 5);
    for (let j = 0; j < k; j++) rock(x + rng.gauss() * 3.2, z + rng.gauss() * 3.2, j === 0 ? rng.range(1.2, 2.1) : rng.range(0.5, 1.2));
  }
  along(0, track.length, 24, (t) => {
    if (rng.next() < 0.5) return;
    const side = rng.next() < 0.5 ? -1 : 1, off = side * (HW + rng.range(2.6, 5));
    const x = t.x - t.tz * off, z = t.z + t.tx * off;
    rock(x, z, rng.range(0.6, 1.3));
    if (rng.next() < 0.6) rock(x + rng.range(-1.5, 1.5), z + rng.range(-1.5, 1.5), rng.range(0.4, 0.7));
  });

  // ---------- 5. ground cover: grass tufts in drifts, wildflowers in patches ----------
  const tuftDeep = new THREE.Color('#4a8a48'), tuftMid = new THREE.Color('#6fa548'), tuftLight = new THREE.Color('#b5cf62'), tuftDry = new THREE.Color('#b9c468');
  const tuftStep = lowSpec ? 2.4 : 1.6;
  for (let z = -172; z <= 172; z += tuftStep) for (let x = -172; x <= 172; x += tuftStep) {
    const px = x + rng.range(-1, 1) * tuftStep * 0.6, pz = z + rng.range(-1, 1) * tuftStep * 0.6;
    const drift = fbm2(px / 34 + 1.7, pz / 34 - 9.1, 3, 555);
    const fine = noise2(px / 7.5, pz / 7.5, 91);
    if (drift + fine * 0.3 < 0.02 + rng.next() * 0.16) continue; // tufts gather in drifts, leaving calm open paint
    if (track.cedar && (millClearing(px,pz) || wetBank(px,pz))) continue;
    const d = hf.roadDist(px, pz);
    const bank = d - HW - hf.vergeWidth(px, pz);
    if (bank < 0.38 || edgeDistance(px, pz) > -12) continue;
    if (bank < 5 && drift + fine * 0.35 < 0.15) continue;
    const tone = noise2(px / 58 + 4, pz / 58 - 6, 123) + rng.gauss() * 0.3;
    tint.copy(tone > 0.25 ? tuftLight : tone < -0.25 ? tuftDeep : tuftMid);
    if (bank < 1.65) tint.copy(tuftDry);
    tint.multiplyScalar(rng.range(0.9, 1.08));
    e.set(0, rng.range(-0.55, 0.55) + fine * 0.85, 0);
    q.setFromEuler(e);
    const sc = rng.range(0.75, 1.5) * (0.66 + 0.34 * smoothstep(0.4, 2.6, bank));
    s.set(sc, sc * rng.range(0.8, 1.3), sc);
    p.set(px, hf.height(px, pz) - 0.02, pz);
    m.compose(p, q, s);
    const vi = Math.floor(rng.next() * tufts.length);
    grass.add(`tuft${vi}`, tufts[vi], m, tint);
    stats.tufts++;
  }

  const flower = makeFlower();
  const flowerPalette = study === 'gouache' ? ['#f2e4bf', '#dfc17c', '#ceb8bc', '#d5afa0']
    : study === 'print' ? ['#e5dbad', '#d7b977', '#9eaa98', '#b1ad84']
    : study === 'oil' ? ['#e6dfba', '#d8ba6a', '#c7b5bd', '#d0b09c']
    : ['#fbf5e4', '#f4d25a', '#d3b5ee', '#f3a58f'];
  const flowerCols = flowerPalette.map((h) => new THREE.Color(h));
  const flowerPatchCount = lowSpec ? 200 : 360;
  for (let i = 0; i < flowerPatchCount; i++) {
    const cx = rng.range(-168, 168), cz = rng.range(-168, 168);
    if (fbm2(cx / 70 - 2.2, cz / 70 + 6.1, 2, 808) < -0.05) continue;
    const main = rng.pick(flowerCols), rad = rng.range(1.8, 6), count = rng.int(10, 42);
    for (let j = 0; j < count; j++) {
      const px = cx + rng.gauss() * rad, pz = cz + rng.gauss() * rad;
      if (track.cedar && (millClearing(px,pz) || wetBank(px,pz))) continue;
      if (hf.roadDist(px, pz) < HW + hf.vergeWidth(px, pz) + 0.7 || edgeDistance(px, pz) > -12) continue;
      tint.copy(rng.next() < 0.82 ? main : rng.pick(flowerCols)).multiplyScalar(rng.range(0.92, 1.0));
      const sc = rng.range(0.09, 0.17);
      e.set(rng.range(-0.3, 0.3), rng.range(0, 6.28), rng.range(-0.3, 0.3));
      q.setFromEuler(e);
      s.set(sc, sc, sc);
      p.set(px, hf.height(px, pz) + rng.range(0.16, 0.4), pz);
      m.compose(p, q, s);
      cover.add('flower', flower, m, tint);
      stats.flowers++;
    }
  }

  // Foliage casts shadows but is lit purely by its volume normals: letting leaf cards shadow
  // each other breaks the crown into noisy confetti instead of one soft painted form.
  if (track.region === 'forest') {
    for (let s = 0; s < track.length; s += lowSpec ? 8 : 5) {
      const t = track.at(s);
      for (const side of [-1, 1]) {
        const offset = side * rng.range(9, 24);
        tree('fir', t.x - t.tz * offset, t.z + t.tx * offset, rng.range(0.85, 1.32), 2.4, 4);
      }
    }
  }
  woodyPlants.flush(foliageMat, true, false, group);
  if (study) shrubs.flush(foliageMat, true, true, group);
  bark.flush(birchBarkMaterial(shared), true, false, group);
  brushes.flush(birchLeaves, true, false, group);
  grass.flush(grassMat, false, true, group);
  rocks.flush(rockMat, true, true, group);
  cover.flush(groundCoverMat, false, true, group);

  // ---------- 6. roadside furniture (one merged static mesh) ----------
  const props = new PropBuilder();
  const white = new THREE.Color('#f2ede1'), offWhite = new THREE.Color('#d9d3c6'), black = new THREE.Color('#2c2b30'), red = new THREE.Color('#d94a32');
  const wood = new THREE.Color('#9c7453'), woodLight = new THREE.Color('#c39d72'), woodDark = new THREE.Color('#77563f');
  const basis = new THREE.Matrix4(), local = new THREE.Matrix4();
  const frame = (x: number, z: number, fx: number, fz: number, y?: number) => {
    // local +Z points along (fx, fz); +Y up
    const yy = y ?? hf.height(x, z);
    return basis.makeBasis(new THREE.Vector3(fz, 0, -fx), new THREE.Vector3(0, 1, 0), new THREE.Vector3(fx, 0, fz)).setPosition(x, yy, z);
  };
  const part = (sx: number, sy: number, sz: number, ox: number, oy: number, oz: number, c: THREE.Color, top?: THREE.Color, rotZ = 0) => {
    local.makeRotationZ(rotZ).setPosition(ox, oy, oz).premultiply(basis);
    props.box(sx, sy, sz, local, c, top);
  };

  // Tight corners get chevron boards on the outside; everything else gets delineator posts.
  const tight = (t: { k: number }) => Math.abs(t.k) > 1 / 24;
  along(0, track.length, 7, (t) => {
    if (!tight(t)) return;
    const out = -Math.sign(t.k), off = out * (HW + 2.3);
    const x = t.x - t.tz * off, z = t.z + t.tx * off;
    frame(x, z, t.tz * out, -t.tx * out); // board faces the road
    part(0.07, 1.0, 0.07, -0.55, 0.5, 0, black);
    part(0.07, 1.0, 0.07, 0.55, 0.5, 0, black);
    part(1.5, 0.52, 0.05, 0, 0.98, 0, red);
    const dirSign = Math.sign(t.k) * out; // chevrons point the way the corner goes
    for (const cx of [-0.42, 0.08, 0.58]) {
      part(0.3, 0.085, 0.07, cx - 0.1 * dirSign, 1.08, 0, white, undefined, -0.8 * dirSign);
      part(0.3, 0.085, 0.07, cx - 0.1 * dirSign, 0.88, 0, white, undefined, 0.8 * dirSign);
    }
  });
  along(0, track.length, 17, (t) => {
    if (tight(t)) return;
    for (const side of [-1, 1]) {
      const off = side * (HW + 1.25);
      const x = t.x - t.tz * off, z = t.z + t.tx * off;
      if (track.lane && hf.roadDist(x, z) < HW + 0.4) continue;
      frame(x, z, t.tx, t.tz, hf.surface(x, z));
      part(0.12, 0.62, 0.07, 0, 0.31, 0, offWhite, white);
      part(0.125, 0.16, 0.075, 0, 0.7, 0, black);
      part(0.12, 0.06, 0.07, 0, 0.81, 0, white);
      part(0.06, 0.09, 0.08, 0, 0.7, 0, side > 0 ? red : white);
    }
  });

  // Weathered post-and-rail fence along two stretches.
  const fence = (s0: number, s1: number, side: number) => {
    const step = 2.5, pts: THREE.Vector3[] = [];
    for (let d = s0; d <= s1; d += step) {
      const t = track.at(d), off = side * (HW + 3.3);
      const x = t.x - t.tz * off, z = t.z + t.tx * off;
      pts.push(new THREE.Vector3(x, hf.height(x, z), z));
    }
    pts.forEach((a, i) => {
      const b = pts[Math.min(i + 1, pts.length - 1)], prev = pts[Math.max(i - 1, 0)];
      const dir = new THREE.Vector3().subVectors(b, prev).setY(0).normalize();
      frame(a.x, a.z, dir.x, dir.z, a.y);
      const lean = rng.range(-0.05, 0.05);
      part(0.14, 1.05 + rng.range(-0.06, 0.08), 0.14, 0, 0.46, 0, woodDark, wood, lean);
      if (i === pts.length - 1) return;
      if (rng.next() < 0.06) return; // a missing rail here and there
      const seg = new THREE.Vector3().subVectors(b, a), len = seg.length();
      const yaw = Math.atan2(seg.x, seg.z), pitch = -Math.atan2(seg.y, Math.hypot(seg.x, seg.z));
      for (const [h, c] of [[0.42, wood], [0.8, woodLight]] as [number, THREE.Color][]) {
        local.makeRotationFromEuler(new THREE.Euler(pitch + rng.range(-0.012, 0.012), yaw, 0, 'YXZ')).setPosition((a.x + b.x) / 2, (a.y + b.y) / 2 + h, (a.z + b.z) / 2);
        props.box(0.06, 0.11, len + 0.12, local, c, woodLight);
      }
    });
  };
  if (journey) {
    fence(43, 71, 1);
    fence(80, 113, -1);
    journey.draw(props, hf);
    if (track.cedar) {
      drawSawyard(props,hf,track);
      drawMillBridge(props,hf.surface(2.67,-57.24));
    }
  } else {
    fence(nearestS(128, 98), nearestS(150, 10), 1);
    fence(nearestS(-70, 112) - 6, nearestS(-70, 112) + 70, -1);
  }

  const propMesh = new THREE.Mesh(props.build(), propMat);
  propMesh.castShadow = true;
  propMesh.receiveShadow = true;
  propMesh.name = 'props';
  group.add(propMesh);

  return { group, stats, patches };
}
