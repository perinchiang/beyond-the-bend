import * as THREE from 'three';
import { SliceAudio } from './audio';
import { Autopilot } from './autopilot';
import { SliceCamera, VIEWS } from './camera';
import { CarVisual } from './carVisual';
import { Hud } from './hud';
import { Input } from './input';
import { LOOKS, applyFogBands, lookById, sunDirection } from './render/looks';
import { SlicePost } from './render/post';
import { buildProps, buildRoads, buildSky, buildWater } from './render/sceneParts';
import { TerrainMesh } from './render/terrainMesh';
import { Vehicle, VehicleInput } from './vehicle/vehicle';
import { SPAWNS } from './world/network';
import { WORLD_HALF } from './world/terrain';
import { Pose, RoadHit, World } from './world/world';

/**
 * Graybox driving slice: a 5 km map, a road network laid out by design speed, a force-based car
 * and a low chase camera, with no art direction applied. It answers three questions before any
 * art is made: is the map the right shape, is the car good to drive, and does a world this size
 * run on the hardware a Steam release has to support.
 *
 * URL options: ?look=graybox|flat|gouache|print  ?spawn=1..7  ?at=x,z,headingDeg  ?view=0|1|2
 *              ?stats=1  ?auto=1 (autopilot)  ?dpr=<max pixel ratio>  ?shadows=0  ?mute=1  ?hud=0
 */
const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => (params.has(k) && Number.isFinite(Number(params.get(k))) ? Number(params.get(k)) : d);
const canvas = document.getElementById('view') as HTMLCanvasElement;

async function boot() {
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); // let "Building the map…" paint
  const t0 = performance.now();
  const world = World.build();
  const buildMs = performance.now() - t0;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const maxDpr = num('dpr', 2);
  const shadows = params.get('shadows') !== '0';
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  // The art direction: everything below is drawn through it.
  const look = lookById(params.get('look')), sunDir = sunDirection(look);
  applyFogBands(look);
  renderer.info.autoReset = false;
  const post = look.post ? new SlicePost(renderer, look.post) : null;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(look.fog.color, look.fog.near, look.fog.far);
  const sky = buildSky(look);
  const terrain = new TerrainMesh(world, look);
  const props = buildProps(world, look);
  scene.add(sky, terrain.group, buildRoads(world, look), props.group, buildWater(look));

  scene.add(new THREE.HemisphereLight(look.light.sky, look.light.ground, look.light.fill));
  const sun = new THREE.DirectionalLight(look.light.sun, look.light.sunPower);
  sun.castShadow = shadows;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 20, far: 320 });
  sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const vehicle = new Vehicle(world, world);
  const car = new CarVisual(look);
  scene.add(car.root);
  const rig = new SliceCamera(world);
  rig.view = Math.min(VIEWS.length - 1, Math.max(0, num('view', 0)));
  const hud = new Hud(world);
  hud.showStats = params.get('stats') === '1';
  if (params.get('hud') === '0') document.body.classList.add('nohud');
  const input = new Input(), audio = new SliceAudio(), pilot = new Autopilot(world);
  audio.muted = params.get('mute') === '1';

  const place = (p: Pose) => { vehicle.reset(p.x, p.z, p.heading); rig.snap(); };
  const teleport = (key: string) => {
    const s = SPAWNS.find((q) => q.key === key);
    if (!s) return false;
    place(world.spawnPose(s));
    if (autopilot) pilot.attach(vehicle);
    hud.toast(s.name);
    return true;
  };
  const hit = {} as RoadHit;
  /** Put the car back on the nearest road, facing the way it was roughly going. */
  const recover = () => {
    if (!world.nearestRoad(vehicle.position.x, vehicle.position.z, 600, hit)) { place(world.spawnPose(SPAWNS[0])); return; }
    const r = hit.road, i = hit.i, facing = Math.sin(vehicle.heading) * r.tx[i] + Math.cos(vehicle.heading) * r.tz[i];
    place(world.poseOn(r, i, facing < 0, facing < 0 ? 1.6 : -1.6));
    if (autopilot) pilot.attach(vehicle);
  };

  let autopilot = params.get('auto') === '1', paused = false, best = 0;
  const at = (params.get('at') ?? '').split(',').map(Number);
  if (at.length === 3 && at.every(Number.isFinite)) place({ x: at[0], z: at[1], heading: at[2] / 57.29578 });
  else place(world.spawnPose(SPAWNS.find((s) => s.key === (params.get('spawn') ?? '1')) ?? SPAWNS[0]));
  /** Reload into another look at the same place, so two looks can be compared on one view. */
  const switchLook = (id: string) => {
    const q = new URLSearchParams(location.search);
    q.set('look', id);
    q.set('at', `${vehicle.position.x.toFixed(1)},${vehicle.position.z.toFixed(1)},${(vehicle.heading * 57.29578).toFixed(1)}`);
    q.set('view', String(rig.view));
    q.delete('spawn');
    location.search = q.toString();
  };
  if (autopilot) pilot.attach(vehicle);

  // Things worth a message: jumps, slides, and the speed trap at the end of the south straight.
  const ring = world.road('ring'), trap = world.nearestSample(ring, 860, 1600);
  let airTime = 0, airX = 0, airZ = 0, slide = 0, slideCalm = 0, lastRingI = -1;
  const events = (dt: number) => {
    const kmh = Math.abs(vehicle.speed) * 3.6;
    if (kmh > best) best = kmh;
    if (vehicle.airborne) {
      if (airTime === 0) { airX = vehicle.position.x; airZ = vehicle.position.z; }
      airTime += dt;
    } else if (airTime > 0) {
      if (airTime > 0.4) hud.toast(`Jump  ${Math.hypot(vehicle.position.x - airX, vehicle.position.z - airZ).toFixed(0)} m · ${airTime.toFixed(1)} s`);
      airTime = 0;
    }
    const sliding = Math.abs(vehicle.sideslip) > 0.24 && vehicle.speed > 11 && !vehicle.airborne;
    if (sliding) { slide += vehicle.speed * dt; slideCalm = 0; }
    else if (slide > 0 && (slideCalm += dt) > 0.5) { if (slide > 30) hud.toast(`Drift  ${slide.toFixed(0)} m`); slide = 0; }
    if (world.nearestRoad(vehicle.position.x, vehicle.position.z, 8, hit, ring)) {
      if (lastRingI >= 0 && Math.abs(hit.i - lastRingI) < 60 && (lastRingI - trap) * (hit.i - trap) < 0) hud.toast(`Speed trap  ${kmh.toFixed(0)} km/h`, 3.2);
      lastRingI = hit.i;
    } else lastRingI = -1;
  };

  const resize = () => {
    renderer.setPixelRatio(Math.min(devicePixelRatio, maxDpr));
    renderer.setSize(innerWidth, innerHeight, false);
    post?.setSize(innerWidth, innerHeight, renderer.getPixelRatio());
    rig.resize(innerWidth, innerHeight);
  };
  addEventListener('resize', resize);
  resize();

  const drive: VehicleInput = { throttle: 0, brake: 0, steer: 0, handbrake: false, digital: true };
  let last = performance.now(), frameMs = 16.7;
  const frame = (now: number) => {
    const raw = now - last;
    last = now;
    frameMs = raw;
    const dt = Math.min(0.05, raw / 1000);
    for (const a of input.takeActions()) {
      audio.start();
      if (a === 'reset') recover();
      else if (a === 'camera') { rig.cycle(); hud.toast(VIEWS[rig.view], 1.2); }
      else if (a === 'look') switchLook(LOOKS[(LOOKS.indexOf(look) + 1) % LOOKS.length].id);
      else if (a === 'map') hud.toggleMap();
      else if (a === 'help') hud.toggleHelp();
      else if (a === 'stats') hud.showStats = !hud.showStats;
      else if (a === 'pause') { paused = !paused; hud.setStatus(paused ? 'Paused — Esc to continue' : ''); }
      else if (a === 'autopilot') { autopilot = !autopilot && pilot.attach(vehicle); hud.toast(autopilot ? 'Autopilot on' : 'Autopilot off', 1.2); }
      else if (a.startsWith('spawn:')) teleport(a.slice(6));
    }
    input.read(drive);
    if (autopilot) {
      if (pilot.finished) pilot.attach(vehicle);
      pilot.drive(vehicle, drive);
    }
    if (!paused) {
      vehicle.update(dt, drive);
      if (Math.max(Math.abs(vehicle.position.x), Math.abs(vehicle.position.z)) > WORLD_HALF - 45 || !Number.isFinite(vehicle.position.y)) recover();
      events(dt);
    }
    car.sync(vehicle);
    rig.update(paused ? 0 : dt, vehicle);
    const cam = rig.camera;
    terrain.update(cam.position.x, cam.position.z);
    props.update(cam.position.x, cam.position.z);
    sun.target.position.set(vehicle.position.x, vehicle.position.y, vehicle.position.z);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, -160);
    audio.update(vehicle, drive.throttle, paused);
    renderer.info.reset();
    if (post) post.render(scene, cam); else renderer.render(scene, cam);
    hud.update(vehicle, {
      view: VIEWS[rig.view], autopilot, paused, device: input.device, frameMs,
      calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, terrainTris: terrain.triangles, best,
    });
    requestAnimationFrame(frame);
  };

  try { await car.load(`${import.meta.env.BASE_URL}models/car.glb`); } catch (e) { console.warn('[slice] car model not loaded', e); }
  // Draw everything once, unculled, into a 1-pixel target so every vertex buffer and shader is
  // on the GPU before driving starts. Otherwise each tile hitches the first time it comes into view.
  {
    const unculled: THREE.Object3D[] = [];
    scene.traverse((o) => { if (o.frustumCulled) { o.frustumCulled = false; unculled.push(o); } });
    const tiny = new THREE.WebGLRenderTarget(1, 1);
    rig.update(0, vehicle);
    renderer.setRenderTarget(tiny);
    renderer.render(scene, rig.camera);
    renderer.setRenderTarget(null);
    tiny.dispose();
    for (const o of unculled) o.frustumCulled = true;
  }
  hud.setStatus('');
  if (look.id !== 'graybox') hud.toast(`${look.name}  ·  L for the next look`, 3.5);
  console.info(`[slice] map built in ${buildMs.toFixed(0)} ms: ${world.roads.reduce((a, r) => a + r.length, 0).toFixed(0)} m of road, ${world.trees.length} trees`);
  // For automated checks and screenshots.
  (window as unknown as Record<string, unknown>).__slice = {
    ready: true, world, vehicle, rig, renderer, audio, buildMs, look: look.id,
    /** Stand the car on the named road at the point nearest (x, z). */
    placeOnRoad(id: string, x: number, z: number, reverse = false) { const r = world.road(id); place(world.poseOn(r, world.nearestSample(r, x, z), reverse)); },
    teleport, recover,
    setAutopilot(on: boolean) { autopilot = on && pilot.attach(vehicle); return autopilot; },
    frameMs: () => frameMs,
  };
  requestAnimationFrame(frame);
}

boot().catch((e) => {
  console.error(e);
  const s = document.getElementById('status');
  if (s) { s.hidden = false; s.textContent = `Could not start: ${e instanceof Error ? e.message : e}`; }
});
