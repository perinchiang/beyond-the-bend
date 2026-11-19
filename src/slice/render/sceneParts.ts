import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GRAVEL, newGroundSample } from '../ground';
import { JUMP_HALF, Road, RoadHit, SHOULDER_DROP, SHOULDER_W, World } from '../world/world';
import { LAKE, WATER_LEVEL, WORLD_HALF } from '../world/terrain';

/** Direction the sunlight travels (unit). Low enough for long shadows, high enough to model the hills. */
export const SUN_DIR = new THREE.Vector3(-0.52, -0.62, 0.59).normalize();
export const SKY = { horizon: new THREE.Color('#dfe6ea'), zenith: new THREE.Color('#9fbfd8') };

const ROAD_COL = {
  main: new THREE.Color('#4b4e57'), mountain: new THREE.Color('#555861'), link: new THREE.Color('#4b4e57'),
  gravel: new THREE.Color('#b7a482'), shoulder: new THREE.Color('#bdb19a'), line: new THREE.Color('#ecebe2'),
};

// ---- roads -----------------------------------------------------------------------------------

/** Pavement and shoulders of every road as one mesh, plus the painted lines as another. */
export function buildRoads(world: World): THREE.Group {
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const lpos: number[] = [], lidx: number[] = [];
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
    if (road.def.surface === GRAVEL) continue;
    // Lines: solid at both edges, dashed down the middle. At a junction a line stops only
    // where it would run across another road's pavement.
    const crosses = (q: number, o: number) => road.junction[q] === 1
      && world.nearestRoad(road.x[q] + road.tz[q] * o, road.z[q] - road.tx[q] * o, 12, hit, null, 1e9, road)
      && hit.dist < hit.road.def.halfWidth - 0.05;
    const strip = (offset: number, width: number, on: (i: number) => boolean) => {
      for (let i = 0; i < quads; i++) {
        const j = (i + 1) % road.n;
        if (!on(i) || crosses(i, offset) || crosses(j, offset)) continue;
        const v = lpos.length / 3;
        for (const q of [i, j]) for (const o of [offset + width / 2, offset - width / 2]) {
          lpos.push(road.x[q] + road.tz[q] * o, road.y[q] + 0.02, road.z[q] - road.tx[q] * o);
        }
        lidx.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
      }
    };
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
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
  mesh.receiveShadow = true;
  const lgeo = new THREE.BufferGeometry();
  lgeo.setAttribute('position', new THREE.Float32BufferAttribute(lpos, 3));
  lgeo.setIndex(lidx);
  lgeo.computeVertexNormals();
  const lines = new THREE.Mesh(lgeo, new THREE.MeshLambertMaterial({ color: ROAD_COL.line, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
  lines.receiveShadow = true;
  for (const m of [mesh, lines]) { m.frustumCulled = false; m.matrixAutoUpdate = false; group.add(m); }
  group.matrixAutoUpdate = false;
  return group;
}

// ---- trees, posts, markers -------------------------------------------------------------------

function tinted(g: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex), n = out.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  out.setAttribute('color', new THREE.BufferAttribute(a, 3));
  out.deleteAttribute('uv');
  return out;
}

/** Trees of unit height: 0 = conifer, 1 = broadleaf. */
function treeGeometries(): THREE.BufferGeometry[] {
  const conifer = mergeGeometries([
    tinted(new THREE.CylinderGeometry(0.02, 0.03, 0.24, 5).translate(0, 0.12, 0), '#7a6a5b'),
    tinted(new THREE.ConeGeometry(0.2, 0.84, 7).translate(0, 0.62, 0), '#6f8c79'),
  ]);
  const broadleaf = mergeGeometries([
    tinted(new THREE.CylinderGeometry(0.026, 0.038, 0.42, 5).translate(0, 0.21, 0), '#7a6a5b'),
    tinted(new THREE.IcosahedronGeometry(0.34, 1).scale(1, 0.86, 1).translate(0, 0.68, 0), '#9db389'),
  ]);
  conifer.computeVertexNormals(); broadleaf.computeVertexNormals();
  return [conifer, broadleaf];
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
  /** Hide tree batches far from the camera. */
  update(camX: number, camZ: number): void;
}

export function buildProps(world: World): Props {
  const group = new THREE.Group();
  const BATCH = 512, NB = (WORLD_HALF * 2) / BATCH;
  const geos = treeGeometries();
  const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const shadowMat = new THREE.MeshBasicMaterial({ color: '#3a4558', alphaMap: blobTexture(), transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const buckets = new Map<number, number[]>();
  world.trees.forEach((t, i) => {
    const key = (Math.floor((t.z + WORLD_HALF) / BATCH) * NB + Math.floor((t.x + WORLD_HALF) / BATCH)) * 2 + t.kind;
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(i);
  });
  const batches: { x: number; z: number; meshes: THREE.Object3D[] }[] = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), tilt = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), nrm = new THREE.Vector3(), gs = newGroundSample();
  // Shadows fall away from the sun, along the ground.
  const sunYaw = Math.atan2(SUN_DIR.x, SUN_DIR.z), reach = Math.hypot(SUN_DIR.x, SUN_DIR.z) / -SUN_DIR.y;
  for (const [key, list] of buckets) {
    const kind = key % 2, cell = (key - kind) / 2;
    const trees = new THREE.InstancedMesh(geos[kind], treeMat, list.length);
    const shadows = new THREE.InstancedMesh(shadowGeo, shadowMat, list.length);
    list.forEach((ti, n) => {
      const t = world.trees[ti];
      q.setFromAxisAngle(up, (ti * 2.399) % (Math.PI * 2));
      m4.compose(p.set(t.x, t.y - 0.2, t.z), q, s.setScalar(t.height));
      trees.setMatrixAt(n, m4);
      const crown = (kind ? 0.68 : 0.42) * t.height, len = crown + t.height * 0.55 * reach;
      const cx = t.x + SUN_DIR.x / -SUN_DIR.y * t.height * 0.3, cz = t.z + SUN_DIR.z / -SUN_DIR.y * t.height * 0.3;
      world.sample(cx, cz, gs);
      tilt.setFromUnitVectors(up, nrm.set(gs.nx, gs.ny, gs.nz));
      q.setFromAxisAngle(up, sunYaw).premultiply(tilt);
      m4.compose(p.set(cx, gs.y + 0.05, cz), q, s.set(crown, 1, len));
      shadows.setMatrixAt(n, m4);
    });
    for (const m of [trees, shadows]) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); m.matrixAutoUpdate = false; group.add(m); }
    shadows.renderOrder = 1;
    const bx = (cell % NB + 0.5) * BATCH - WORLD_HALF, bz = (Math.floor(cell / NB) + 0.5) * BATCH - WORLD_HALF;
    batches.push({ x: bx, z: bz, meshes: [trees, shadows] });
  }

  // Marker posts every 50 m on both sides, and tall orange posts either side of each jump.
  const posts: THREE.Matrix4[] = [], pylons: THREE.Matrix4[] = [];
  const stand = (list: THREE.Matrix4[], road: Road, i: number, off: number) => {
    const x = road.x[i] + road.tz[i] * off, z = road.z[i] - road.tx[i] * off;
    list.push(new THREE.Matrix4().makeTranslation(x, world.sample(x, z, gs).y, z));
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
  }
  const instanced = (geo: THREE.BufferGeometry, color: string, list: THREE.Matrix4[]) => {
    const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color }), list.length);
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
      for (const b of batches) {
        const d = Math.hypot(b.x - camX, b.z - camZ);
        b.meshes[0].visible = d < 3000;
        b.meshes[1].visible = d < 1500;
      }
    },
  };
}

// ---- sky, water, light -----------------------------------------------------------------------

export function buildSky(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { uHorizon: { value: SKY.horizon }, uZenith: { value: SKY.zenith }, uSun: { value: SUN_DIR.clone().negate() } },
    vertexShader: /* glsl */ `varying vec3 vDir; void main() { vDir = position; vec4 p = projectionMatrix * mat4(mat3(modelViewMatrix)) * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uHorizon, uZenith, uSun; varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float t = pow(clamp(d.y, 0.0, 1.0), 0.55);
        vec3 c = mix(uHorizon, uZenith, t);
        c += vec3(1.0, 0.93, 0.8) * 0.22 * pow(max(dot(d, uSun), 0.0), 6.0);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), mat);
  sky.frustumCulled = false; sky.renderOrder = -10;
  return sky;
}

export function buildWater(): THREE.Mesh {
  const size = LAKE.sigma * 3.2;
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: '#9fc0cf', transparent: true, opacity: 0.88 }),
  );
  water.position.set(LAKE.x, WATER_LEVEL, LAKE.z);
  water.updateMatrix(); water.matrixAutoUpdate = false;
  return water;
}
