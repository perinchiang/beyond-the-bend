import * as THREE from 'three';
import { buildTrack } from './world/track';
import { buildHeightField } from './world/heightfield';
import { WORLD_HALF } from './world/heightfield';
import { buildTerrain } from './world/terrain';
import { buildRoad } from './world/road';
import { buildScatter } from './world/scatter';
import { PAL, createPaintShared, stabiliseShadowFilter } from './render/paint';
import { PostFX } from './render/post';
import { CameraRig, DRIVE_PRESETS, DEFAULT_PRESET } from './camera';
import { Car } from './vehicle/car';
import { TouchControls } from './input/touch';

const params = new URLSearchParams(location.search);
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

// ---- light: one warm low sun, cool sky fill, a little green bounce ----
const SUN_DIR = new THREE.Vector3(0.50, 0.60, -0.63).normalize(); // direction towards the sun
const sun = new THREE.DirectionalLight(new THREE.Color(PAL.sun), Math.PI * 0.86);
sun.castShadow = true;
const SHADOW_SIZE = lowSpec ? 1024 : 2048;
sun.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.06;
sun.shadow.radius = 2.2;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(new THREE.Color(PAL.sky), new THREE.Color(PAL.bounce), Math.PI * 0.62);
scene.add(hemi);

// ---- world ----
const track = buildTrack();
const hf = buildHeightField(track);
scene.add(buildTerrain(hf, shared));
scene.add(buildRoad(track, shared));
const scatter = buildScatter(track, hf, shared, lowSpec);
scene.add(scatter.group);

const car = new Car(hf, shared);
scene.add(car.root);

const rig = new CameraRig();
const post = new PostFX(renderer, lowSpec ? 10 : 16, num('msaa', 4));
renderer.info.autoReset = false;
post.setTilt(num('tilt', lowSpec ? 0 : 1));

// ---- start pose ----
const startS = num('s', 232);
function placeAt(s: number) {
  const t = track.at(s);
  car.place(t.x - t.tz * -1.65, t.z + t.tx * -1.65, Math.atan2(t.tx, t.tz));
}
placeAt(startS);
// Camera: Driving / Normal by default. `?cam=free` (optionally with yaw, pitch, zoom, x, z) starts in photo mode.
const lens = { focus: 0.47, inner: 0.17 };
function initCamera() {
  if (params.get('cam') === 'free' || params.has('x')) {
    const fixed = params.has('x') && params.has('z') ? new THREE.Vector3(num('x', 0), hf.height(num('x', 0), num('z', 0)), num('z', 0)) : undefined;
    rig.setFree(num('yaw', 38), num('pitch', 47), num('zoom', 46), fixed);
  } else rig.setDrive(THREE.MathUtils.clamp(Math.round(num('preset', DEFAULT_PRESET)), 0, DRIVE_PRESETS.length - 1));
  rig.update(0, car.position, car.heading, true);
  lens.focus = rig.mode === 'drive' ? 0.57 : 0.47;
  lens.inner = rig.mode === 'drive' ? 0.27 : 0.17;
}
initCamera();

// ---- input ----
const keys = new Set<string>();
const hud = document.getElementById('hud')!;
const hudCam = document.getElementById('hud-cam')!;
const toast = document.getElementById('toast')!;
if (params.get('hud') === '0') { hud.classList.add('hidden'); toast.classList.add('off'); }
const touch = new TouchControls(
  () => { rig.toggleMode(); announceCamera(); },
  () => { rig.cyclePreset(); announceCamera(); },
);
let toastTimer = 0;
function announceCamera(hint?: string) {
  touch.updateCamera(rig.mode, rig.preset.name);
  const label = rig.mode === 'drive' ? `Driving camera · ${rig.preset.name}` : 'Free camera';
  hudCam.innerHTML = rig.mode === 'drive'
    ? `<b>C</b> — free camera &nbsp;·&nbsp; <b>V</b> — view: <b>${rig.preset.name}</b> <i>(${DRIVE_PRESETS.map((p) => p.name).join(' / ')})</i>`
    : `<b>C</b> — driving camera &nbsp;·&nbsp; <b>drag</b> / <b>Q E</b> — orbit &nbsp;·&nbsp; <b>R F</b> — tilt &nbsp;·&nbsp; <b>wheel</b> / <b>Z X</b> — zoom &nbsp;·&nbsp; <b>shift-drag</b> — pan`;
  toast.textContent = hint ?? label;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 1600);
}
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyH') hud.classList.toggle('hidden');
  if (e.code === 'KeyT') post.setTilt(post.tilt > 0 ? 0 : 1);
  if (e.code === 'KeyC') { rig.toggleMode(); announceCamera(); }
  if (e.code === 'KeyV') announceCamera(rig.cyclePreset() ? undefined : 'View presets belong to the driving camera — press C');
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); drag = null; });
document.addEventListener('visibilitychange', () => { if (document.hidden) { keys.clear(); drag = null; } });
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
function fitShadow() {
  const ground = rig.viewHeight / Math.sin(rig.pitch);
  const ext = THREE.MathUtils.clamp(Math.max(rig.viewWidth, ground) * 0.6 + 12, 16, 150);
  // quantise the extent so zooming does not continuously re-scale texels
  const half = Math.pow(2, Math.ceil(Math.log2(ext) * 4) / 4);
  const texel = (half * 2) / SHADOW_SIZE;
  const c = rig.target;
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
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  shared.uTime.value = fixedTime >= 0 ? fixedTime : now / 1000;
  renderer.info.reset();

  const input = {
    throttle: THREE.MathUtils.clamp(Math.max(touch.input.throttle, keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0), -1, 1),
    steer: THREE.MathUtils.clamp(touch.input.steer + (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0), -1, 1),
    brake: keys.has('Space') || touch.input.brake,
  };
  car.update(dt, input);
  rig.orbit(((keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0)) * dt * 1.4, ((keys.has('KeyR') ? 1 : 0) - (keys.has('KeyF') ? 1 : 0)) * dt * 0.9);
  if (keys.has('KeyZ')) rig.zoom(Math.exp(-dt * 1.3));
  if (keys.has('KeyX')) rig.zoom(Math.exp(dt * 1.3));

  // The camera only reads the car's pose; it never writes anything back to the vehicle.
  rig.update(dt, car.position, car.heading);
  fitShadow();
  post.setZoom(rig.viewHeight);
  // Lens focus: photo mode keeps the band around mid-frame; driving slides it up the screen
  // so the car and the road ahead of it stay crisp. Eased, like every other camera change.
  const kl = 1 - Math.exp(-dt * 3);
  lens.focus += ((rig.mode === 'drive' ? 0.57 : 0.47) - lens.focus) * kl;
  lens.inner += ((rig.mode === 'drive' ? 0.27 : 0.17) - lens.inner) * kl;
  post.setFocus(lens.focus, lens.inner);
  post.render(scene, rig.camera);

  if (showStats) {
    frames++; acc += dt;
    if (acc > 0.5) {
      const info = renderer.info;
      stats.textContent = `${(frames / acc).toFixed(0)} fps · ${info.render.calls} calls · ${(info.render.triangles / 1000).toFixed(0)}k tris · dpr ${pixelRatio.toFixed(2)}`;
      frames = 0; acc = 0;
    }
  }
  requestAnimationFrame(frame);
}

car.load(import.meta.env.BASE_URL + 'models/car.glb').catch((e) => console.warn('[car] model not loaded', e)).finally(() => {
  placeAt(startS);
  initCamera();
  announceCamera();
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
      if (o.s !== undefined) { const t = track.at(o.s); const l = o.lane ?? -1.65; car.place(t.x - t.tz * l, t.z + t.tx * l, Math.atan2(t.tx, t.tz)); }
      if (o.mode === 'drive') rig.setDrive(o.preset ?? DEFAULT_PRESET);
      else rig.setFree(o.yaw ?? 38, o.pitch ?? 47, o.zoom ?? 46, o.x !== undefined && o.z !== undefined ? new THREE.Vector3(o.x, o.y ?? hf.height(o.x, o.z), o.z) : undefined);
      if (o.time !== undefined) fixedTime = o.time;
      rig.update(0, car.position, car.heading, true);
      lens.focus = rig.mode === 'drive' ? 0.57 : 0.47;
      lens.inner = rig.mode === 'drive' ? 0.27 : 0.17;
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
