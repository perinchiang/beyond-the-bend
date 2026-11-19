import { roadGuide } from './journey/navigation';
import { postalCounter } from './journey/postalCounter';
import { journeyDrive } from './journey/drive';
import { regions } from './journey/progress';
import { riceField } from './world/field';
import { createPostalPaint } from './world/postalPaint';
import { brookWater } from './world/millBrook';
import { waysides } from './world/waysides';
import * as THREE from 'three';
import { stationJourney, TOWN_EXIT_S } from './world/station';
import { buildTrack, roadPoint } from './world/track';
import { buildHeightField } from './world/heightfield';
import { WORLD_HALF } from './world/heightfield';
import { buildTerrain } from './world/terrain';
import { buildRoad } from './world/road';
import { buildScatter } from './world/scatter';
import { PAL, createPaintShared, stabiliseShadowFilter } from './render/paint';
import { readStyleStudy } from './render/styleStudy';
import { PostFX } from './render/post';
import { CameraRig, DRIVE_PRESETS, DEFAULT_PRESET } from './camera';
import { Car } from './vehicle/car';
import { drivingAudio } from './audio/driving';
import { createDrivingHud } from './input/drivingHud';
import { TouchControls } from './input/touch';

const params = new URLSearchParams(location.search);
const styleParam = params.get('study');
const previewStudy = readStyleStudy(styleParam);
const study = styleParam === 'original' ? undefined : previewStudy ?? 'gouache';
const num = (k: string, d: number) => (params.has(k) ? Number(params.get(k)) : d);
const mobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
const lowSpec = params.get('q') === 'low' || (params.get('q') !== 'high' && mobile);

const t0 = performance.now();
const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.setClearColor(new THREE.Color(PAL.paper));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = true;
renderer.toneMapping = THREE.NoToneMapping;
stabiliseShadowFilter();

const scene = new THREE.Scene();
const shared = createPaintShared(renderer, WORLD_HALF, lowSpec);

if (study) shared.uDirtWash.value = { print: 0.86, oil: 0.40, gouache: 0.66 }[study];
if (study === 'print') {
  shared.uDirt.value.set('#d6b781');
  shared.uDirtDark.value.set('#ccb082');
} else if (study === 'gouache') {
  shared.uDirt.value.set('#d6c2a3');
  shared.uDirtDark.value.set('#c5aa92');
}

if (!styleParam && ['snow', 'glacier'].includes(params.get('route') ?? '')) {
  shared.uDirt.value.set('#d5dedc');
  shared.uDirtDark.value.set('#acbdc5');
}
// ---- light: one warm low sun, cool sky fill, a little green bounce ----
const SUN_DIR = new THREE.Vector3(0.50, 0.49, -0.75).normalize(); // direction towards the sun
const sun = new THREE.DirectionalLight(new THREE.Color(PAL.sun), Math.PI * 1.12);
sun.castShadow = true;
const SHADOW_SIZE = lowSpec ? 1024 : 2048;
sun.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.06;
sun.shadow.radius = 2.2;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(new THREE.Color(PAL.sky), new THREE.Color(PAL.bounce), Math.PI * 0.68);
scene.add(hemi);

// ---- world ----
const region = !styleParam ? regions.find(id => id !== 'forest' && id === params.get('route')) : undefined;
const scenic = !styleParam && !region && params.get('route') !== 'circuit';
const track = buildTrack(region ?? (scenic ? 'foothill' : 'circuit'));
document.body.classList.toggle('arcade', region === 'arcade');
const journey = scenic ? stationJourney(track) : undefined;
const postal = journey && study === 'gouache' ? createPostalPaint(journey.postOffice,journey.villageSites) : undefined;
const hf = buildHeightField(track, scenic);
const landmarks = !styleParam ? waysides(track, hf, shared) : undefined;
if (landmarks) scene.add(landmarks.group);
const field = scenic ? riceField(track, lowSpec) : undefined;
if (track.cedar) scene.add(brookWater(shared));
const guide = roadGuide(track, hf);
scene.add(guide.mesh);
const scatter = region && region !== 'forest' ? { group: new THREE.Group(), patches: [], stats: { region } } : buildScatter(track, hf, shared, lowSpec, study, journey, field?.bed, postal);
scene.add(buildTerrain(hf, shared, scatter.patches, study, region, Boolean(track.cedar), journey?.paving, field, postal));
scene.add(buildRoad(track, shared, study, track.cedar ? hf.sdfTexture : undefined, postal));
scene.add(scatter.group);

const car = new Car(hf, shared);
scene.add(car.root);

const rig = new CameraRig();
rig.ortho = params.get('lens') === 'ortho'; // parallel projection, for capture tools only
const post = new PostFX(renderer, lowSpec ? 10 : 16, num('msaa', 4));
renderer.info.autoReset = false;
post.setTilt(num('tilt', lowSpec ? 0 : 1));

// ---- start pose ----
const startS = params.get('route') === 'forest' && track.cedar ? track.length + 8 : num('s', region ? 0 : scenic ? TOWN_EXIT_S : previewStudy ? 470 : styleParam ? 232 : 0);
function placeAt(s: number) {
  const t = roadPoint(track, s);
  car.place(t.x - t.tz * -1.65, t.z + t.tx * -1.65, Math.atan2(t.tx, t.tz));
}
placeAt(startS);
// Driving starts Close on the station road and in art previews. `?cam=free` (optionally with yaw, pitch, zoom, x, z) starts in photo mode.
const lens = { focus: 0.47, inner: 0.17, fade: 0 };
function initCamera() {
  if (params.get('cam') === 'free' || params.has('x')) {
    const fixed = params.has('x') && params.has('z') ? new THREE.Vector3(num('x', 0), hf.height(num('x', 0), num('z', 0)), num('z', 0)) : undefined;
    rig.setFree(num('yaw', 38), num('pitch', 47), num('zoom', 46), fixed);
  } else rig.setDrive(THREE.MathUtils.clamp(Math.round(num('preset', scenic || region || previewStudy ? 2 : DEFAULT_PRESET)), 0, DRIVE_PRESETS.length - 1));
  rig.update(0, car.position, car.heading, true);
  lens.focus = rig.mode === 'drive' ? 0.57 : 0.47;
  lens.inner = rig.mode === 'drive' ? 0.27 : 0.17;
  lens.fade = rig.mode === 'drive' && !rig.ortho ? 1 : 0;
}
initCamera();

// ---- input ----
const audio = drivingAudio(document.querySelector<HTMLInputElement>('#sound-toggle')!);
const pauseMenu = document.querySelector<HTMLDialogElement>('#pause-menu')!;
const pauseButton = document.querySelector<HTMLButtonElement>('#pause-toggle')!;
let pausedAt = document.hidden ? performance.now() : null;
let pausedTime = 0;
function drivingTime() {
  return (pausedAt ?? performance.now()) - pausedTime;
}
function syncPause() {
  const now = performance.now();
  if (pauseMenu.open || counter.open || document.hidden) {
    pausedAt ??= now;
  } else if (pausedAt !== null) {
    pausedTime += now - pausedAt;
    last = now;
    pausedAt = null;
  }
}
const keys = new Set<string>();
const hud = document.getElementById('hud')!;
const hudCam = document.getElementById('hud-cam')!;
const toast = document.getElementById('toast')!;
if (params.get('hud') === '0') { hud.classList.add('hidden'); toast.classList.add('off'); }
const touch = new TouchControls(
  () => { rig.toggleMode(); announceCamera(); },
  () => { rig.cyclePreset(); announceCamera(); },
);
const counter = postalCounter(open => {
  keys.clear();
  touch.reset();
  drag = null;
  audio.setPaused(open || pauseMenu.open);
  syncPause();
}, () => {
  const office = journey!.postOffice;
  return new THREE.Vector3(office.x, hf.height(office.x, office.z) + 2, office.z).project(rig.camera).x > 0;
});
const trip = journeyDrive(track, car, scenic, !styleParam && !region && !scenic, message => announceCamera(message), drivingTime, counter, journey?.showParcel);
const drivingHud = createDrivingHud(track, scenic, s => {
  keys.clear();
  touch.reset();
  placeAt(s);
  rig.setDrive();
  rig.update(0, car.position, car.heading, true);
  trip.reset();
  announceCamera();
}, trip.travel);
drivingHud.hide(params.get('hud') === '0');
let toastTimer = 0;
function announceCamera(hint?: string, showToast = true) {
  touch.updateCamera(rig.mode, rig.preset.name);
  const label = rig.mode === 'drive' ? `Driving camera · ${rig.preset.name}` : 'Free camera';
  hudCam.innerHTML = rig.mode === 'drive'
    ? `<b>C</b> — free camera &nbsp;·&nbsp; <b>V</b> — view: <b>${rig.preset.name}</b> <i>(${DRIVE_PRESETS.map((p) => p.name).join(' / ')})</i>`
    : `<b>C</b> — driving camera &nbsp;·&nbsp; <b>drag</b> / <b>Q E</b> — orbit &nbsp;·&nbsp; <b>R F</b> — tilt &nbsp;·&nbsp; <b>wheel</b> / <b>Z X</b> — zoom &nbsp;·&nbsp; <b>shift-drag</b> — pan`;
  if (!showToast) return;
  toast.textContent = hint ?? label;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 1600);
}
pauseButton.addEventListener('click', () => {
  keys.clear();
  touch.reset();
  drag = null;
  audio.setPaused(true);
  pauseMenu.showModal();
  syncPause();
});
document.getElementById('resume-drive')!.addEventListener('click', () => pauseMenu.close());
pauseMenu.addEventListener('close', () => {
  syncPause();
  audio.setPaused(false);
  pauseButton.blur();
});
addEventListener('keydown', (e) => {
  if (counter.open && e.code === 'KeyE') {
    if (!e.repeat) void counter.confirm();
    return;
  }
  if (pausedAt !== null || e.repeat || e.target instanceof HTMLSelectElement) return;
  if (e.target instanceof HTMLButtonElement && (e.code === 'Space' || e.code === 'Enter')) return;
  if (e.target instanceof HTMLButtonElement &&
      ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'].includes(e.code)) {
    e.target.blur();
  }
  if (e.code === 'KeyE' && rig.mode === 'drive') trip.interact();
  keys.add(e.code);
  if (e.code === 'KeyH') {
    hud.classList.toggle('hidden');
    drivingHud.hide(hud.classList.contains('hidden'));
  }
  if (e.code === 'KeyT') post.setTilt(post.tilt > 0 ? 0 : 1);
  if (e.code === 'KeyC') { rig.toggleMode(); announceCamera(); }
  if (e.code === 'KeyV') announceCamera(rig.cyclePreset() ? undefined : 'View presets belong to the driving camera — press C');
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); drag = null; });
document.addEventListener('visibilitychange', () => { syncPause(); if (document.hidden) { keys.clear(); drag = null; } });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); rig.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
let drag: { pointerId: number; x: number; y: number; pan: boolean } | null = null;
canvas.addEventListener('pointerdown', (e) => { if (drag) return; drag = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 2 }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!drag || drag.pointerId !== e.pointerId) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  // In Driving mode these calls are ignored by the rig: the player cannot orbit, tilt, zoom or pan.
  if (drag.pan) {
    const mpp = rig.viewHeight / innerHeight;
    rig.panBy(-dx * mpp, (-dy * mpp) / Math.sin(rig.pitch));
  } else rig.orbit(-dx * 0.006, dy * 0.005);
});
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
  canvas.addEventListener(event, e => { if (drag?.pointerId === e.pointerId) drag = null; });
}
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---- resize ----
let pixelRatio = 1;
function resize() {
  const w = innerWidth, h = innerHeight;
  // cap the internal resolution: plenty for a painted look, and keeps big retina panels fluid
  const budget = lowSpec ? 1.6e6 : params.get('q') === 'high' ? 4.2e6 : 3.0e6;
  pixelRatio = Math.min(devicePixelRatio || 1, mobile ? 1.5 : 2, Math.sqrt(budget / (w * h)));
  pixelRatio = mobile ? Math.min(pixelRatio, Math.max(0.5, num('dpr', pixelRatio) || pixelRatio)) : num('dpr', pixelRatio);
  if (region === 'arcade') pixelRatio = Math.min(pixelRatio, 0.6);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  post.setSize(Math.round(w * pixelRatio), Math.round(h * pixelRatio));
  rig.setAspect(w / h);
}
addEventListener('resize', resize);
resize();

// ---- shadow frustum follows the view and snaps to texels so shadow edges never crawl ----
const lightRight = new THREE.Vector3(), lightUp = new THREE.Vector3(), tmp = new THREE.Vector3();
lightRight.crossVectors(new THREE.Vector3(0, 1, 0), SUN_DIR).normalize();
lightUp.crossVectors(SUN_DIR, lightRight).normalize();
const seen = new THREE.Vector3();
function fitShadow() {
  // cover the patch of ground the lens can see, plus room for shadows cast into it
  const ext = THREE.MathUtils.clamp(rig.footprint(seen) + 12, 16, 150);
  // quantise the extent so zooming does not continuously re-scale texels
  const half = Math.pow(2, Math.ceil(Math.log2(ext) * 4) / 4);
  const texel = (half * 2) / SHADOW_SIZE;
  const c = seen;
  const r = Math.round(c.dot(lightRight) / texel) * texel, u = Math.round(c.dot(lightUp) / texel) * texel, f = c.dot(SUN_DIR);
  tmp.copy(lightRight).multiplyScalar(r).addScaledVector(lightUp, u).addScaledVector(SUN_DIR, f);
  sun.target.position.copy(tmp);
  sun.position.copy(tmp).addScaledVector(SUN_DIR, 260);
  const sc = sun.shadow.camera;
  if (sc.right !== half) {
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 10; sc.far = 520;
    sc.updateProjectionMatrix();
  }
  sun.target.updateMatrixWorld();
}

// ---- loop ----
const stats = document.getElementById('stats')!;
const showStats = params.has('stats');
let last = performance.now(), frames = 0, acc = 0, fixedTime = params.has('t') ? num('t', 0) : -1;
let lastInteract = false;
function frame(now: number) {
  const pad = Array.from(navigator.getGamepads?.() ?? []).find(p => p?.mapping === 'standard');
  const interact = Boolean(pad?.buttons[0]?.pressed);
  const pressed = interact && !lastInteract;
  lastInteract = interact;
  if (pausedAt !== null) {
    if (pressed && counter.open && !document.hidden) void counter.confirm();
    requestAnimationFrame(frame);
    return;
  }
  const frameSeconds = Math.max(0, (now - last) / 1000);
  // Bound catch-up after a long stall. Normal slow frames get the full driving time.
  const dt = Math.min(frameSeconds, 0.5);
  last = now;
  shared.uTime.value = fixedTime >= 0 ? fixedTime : (now - pausedTime) / 1000;
  renderer.info.reset();

  if (pressed && rig.mode === 'drive') trip.interact();
  if (counter.open) {
    requestAnimationFrame(frame);
    return;
  }
  const axis = pad?.axes[0] ?? 0;
  const stick = Math.abs(axis) < 0.12 ? 0 : Math.sign(axis) * (Math.abs(axis) - 0.12) / 0.88;
  const input = {
    throttle: THREE.MathUtils.clamp(Math.max(pad?.buttons[7]?.value ?? 0, touch.input.throttle, keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0), -1, 1),
    // The vehicle's positive steering angle is its visual left turn in the driving view.
    // Keep controls named from the player's perspective: left input must turn left on screen.
    steer: -THREE.MathUtils.clamp(stick + touch.input.steer + (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0), -1, 1),
    brake: Math.max(Number(keys.has('Space')), Number(touch.input.brake), pad?.buttons[6]?.value ?? 0),
    handbrake: keys.has('ShiftLeft') || keys.has('ShiftRight') || touch.input.handbrake || pad?.buttons[2]?.pressed,
  };
  const steps = Math.max(1, Math.ceil(dt * 60));
  const step = dt / steps;
  for (let i = 0; i < steps; i++) {
    car.update(step, input);
    trip.recordSlide(step);
  }
  trip.update(now);
  audio.update(now, car.speed, input.throttle, car.grassBlend, trip.music);
  rig.fieldReveal = trip.music === 1 || trip.music === 2 ? 1 : 0;
  guide.mesh.material.opacity += ((rig.fieldReveal ? 0.23 : 0.74) - guide.mesh.material.opacity) * (1 - Math.exp(-dt * 2));
  guide.update(now, car.x, car.z, car.speed, trip.goal);
  field?.update(car.x, car.z, car.speed, shared.uTime.value);
  landmarks?.update(shared.uTime.value);
  rig.orbit(((keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0)) * dt * 1.4, ((keys.has('KeyR') ? 1 : 0) - (keys.has('KeyF') ? 1 : 0)) * dt * 0.9);
  if (keys.has('KeyZ')) rig.zoom(Math.exp(-dt * 1.3));
  if (keys.has('KeyX')) rig.zoom(Math.exp(dt * 1.3));

  // The camera only reads the car's pose; it never writes anything back to the vehicle.
  rig.update(dt, car.position, car.heading);
  fitShadow();
  shared.uHaze.value.set(rig.distance * 1.15, rig.distance * 3.4, rig.ortho ? 0 : num('haze', 0.42));
  // Driving only: photo mode keeps its foreground.
  lens.fade += ((rig.mode === 'drive' && !rig.ortho ? 1 : 0) - lens.fade) * (1 - Math.exp(-dt * 3));
  shared.uLensFade.value = lens.fade;
  const sightStart = shared.uSightStart.value.copy(car.position);
  sightStart.y += 0.95;
  shared.uSightEnd.value.set(car.position.x + 10 * Math.sin(car.heading), car.position.y + 0.4,
    car.position.z + 10 * Math.cos(car.heading)).applyMatrix4(rig.camera.matrixWorldInverse);
  sightStart.applyMatrix4(rig.camera.matrixWorldInverse);
  post.setZoom(rig.viewHeight);
  // Lens focus: photo mode keeps the band around mid-frame; driving slides it up the screen
  // so the car and the road ahead of it stay crisp. Eased, like every other camera change.
  const kl = 1 - Math.exp(-dt * 3);
  lens.focus += ((rig.mode === 'drive' ? 0.57 : 0.47) - lens.focus) * kl;
  lens.inner += ((rig.mode === 'drive' ? 0.27 : 0.17) - lens.inner) * kl;
  post.setFocus(lens.focus, lens.inner);
  post.render(scene, rig.camera);
  drivingHud.update(now, car.x, car.z, car.heading, car.speed);

  if (showStats) {
    frames++; acc += frameSeconds;
    if (acc > 0.5) {
      const info = renderer.info;
      stats.textContent = `${(frames / acc).toFixed(0)} fps · ${info.render.calls} calls · ${(info.render.triangles / 1000).toFixed(0)}k tris · dpr ${pixelRatio.toFixed(2)}`;
      frames = 0; acc = 0;
    }
  }
  requestAnimationFrame(frame);
}

car.load(canvas.dataset.model ?? import.meta.env.BASE_URL + 'models/car.glb').catch((e) => console.warn('[car] model not loaded', e)).finally(() => {
  drivingHud.travel.disabled = false;
  placeAt(startS);
  initCamera();
  announceCamera(undefined, false);
  console.info(`[btb] world built in ${(performance.now() - t0).toFixed(0)} ms`, scatter.stats);
  // hooks for automated screenshots
  (window as any).__btb = {
    ready: true, touch, rig, car, track, post, hf, renderer, scene, sun,
    /** GPU-synchronous timing of n frames, in ms per frame. */
    bench(n = 40) {
      const gl = renderer.getContext();
      const px = new Uint8Array(4);
      const t = performance.now();
      for (let i = 0; i < n; i++) { post.render(scene, rig.camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
      return (performance.now() - t) / n;
    },
    /** Pose the scene for a capture. Free camera by default; `mode: 'drive'` uses a driving preset. */
    view(o: { s?: number; x?: number; y?: number; z?: number; yaw?: number; pitch?: number; zoom?: number; lane?: number; time?: number; mode?: 'drive' | 'free'; preset?: number }) {
      if (o.s !== undefined) { const t = roadPoint(track, o.s); const l = o.lane ?? -1.65; car.place(t.x - t.tz * l, t.z + t.tx * l, Math.atan2(t.tx, t.tz)); }
      if (o.mode === 'drive') rig.setDrive(o.preset ?? DEFAULT_PRESET);
      else rig.setFree(o.yaw ?? 38, o.pitch ?? 47, o.zoom ?? 46, o.x !== undefined && o.z !== undefined ? new THREE.Vector3(o.x, o.y ?? hf.height(o.x, o.z), o.z) : undefined);
      if (o.time !== undefined) fixedTime = o.time;
      rig.update(0, car.position, car.heading, true);
      lens.focus = rig.mode === 'drive' ? 0.57 : 0.47;
      lens.inner = rig.mode === 'drive' ? 0.27 : 0.17;
      lens.fade = rig.mode === 'drive' && !rig.ortho ? 1 : 0;
      announceCamera();
    },
    /**
     * Deterministic check that the camera cannot influence the vehicle: replays a fixed input
     * script at a fixed timestep and returns the car's final state. With `cameraChaos` the rig is
     * updated every step while modes and presets are switched constantly.
     */
    simulate(cameraChaos: boolean, steps = 900, dt = 1 / 60) {
      placeAt(startS);
      rig.setDrive(DEFAULT_PRESET);
      for (let i = 0; i < steps; i++) {
        const t = i * dt;
        car.update(dt, { throttle: t < 11 ? 1 : -1, steer: Math.sin(t * 1.3) > 0.55 ? 1 : Math.sin(t * 1.3) < -0.6 ? -1 : 0, brake: t > 13.5 });
        if (cameraChaos) {
          if (i % 37 === 0) rig.toggleMode();
          if (i % 23 === 0) rig.cyclePreset();
          rig.orbit(0.05, -0.01); rig.zoom(1.01); rig.panBy(0.3, -0.2);
          rig.update(dt, car.position, car.heading);
        }
      }
      return { x: car.x, z: car.z, heading: car.heading, speed: car.speed, y: car.position.y };
    },
  };
  requestAnimationFrame((t) => { last = t; frame(t); });
});
