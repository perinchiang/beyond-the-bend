import { ASPHALT, GRASS, GRAVEL, SHOULDER } from './ground';
import type { Vehicle } from './vehicle/vehicle';
import { SPAWNS } from './world/network';
import { LAKE, MOUNTAIN, WORLD_HALF } from './world/terrain';
import type { World } from './world/world';

const SURFACE: Record<number, string> = { [ASPHALT]: 'tarmac', [SHOULDER]: 'shoulder', [GRASS]: 'grass', [GRAVEL]: 'gravel' };
const ROAD_STYLE = { main: ['#3f434c', 3.2], link: ['#3f434c', 2.2], mountain: ['#9a5a3a', 2.4], gravel: ['#a58d5c', 2.4] } as const;

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Speed, gear, revs, map, messages and (optionally) frame-time figures. Plain DOM over the canvas. */
export class Hud {
  private speed = el('speed'); private gear = el('gear'); private revs = el('revs');
  private toastEl = el('toast'); private statsEl = el('stats'); private mapEl = el<HTMLCanvasElement>('map');
  private status = el('status'); private help = el('help');
  private base!: HTMLCanvasElement;
  private big = false;
  private toastUntil = 0;
  private frames: number[] = [];
  showStats = false;

  constructor(private world: World) { this.drawBase(); this.sizeMap(); }

  setStatus(text: string) { this.status.textContent = text; this.status.hidden = !text; }
  toggleHelp() { this.help.hidden = !this.help.hidden; }
  toggleMap() { this.big = !this.big; this.sizeMap(); }
  toast(text: string, seconds = 2.6) { this.toastEl.textContent = text; this.toastEl.classList.add('on'); this.toastUntil = performance.now() + seconds * 1000; }

  private sizeMap() {
    const px = this.big ? Math.min(innerWidth, innerHeight) * 0.82 : 210, dpr = Math.min(2, devicePixelRatio);
    this.mapEl.classList.toggle('big', this.big);
    this.mapEl.style.width = this.mapEl.style.height = `${px}px`;
    this.mapEl.width = this.mapEl.height = Math.round(px * dpr);
  }

  /** Roads, lake and massif drawn once; the car arrow is added on top every frame. */
  private drawBase() {
    const S = 1024, c = this.base = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!, k = S / (WORLD_HALF * 2), at = (v: number) => (v + WORLD_HALF) * k;
    g.fillStyle = 'rgba(236,233,222,0.92)'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#b9d0da'; g.beginPath(); g.arc(at(LAKE.x), at(LAKE.z), LAKE.sigma * 0.92 * k, 0, 7); g.fill();
    for (const [r, a] of [[900, 0.1], [600, 0.12], [330, 0.16]]) { g.fillStyle = `rgba(120,105,90,${a})`; g.beginPath(); g.arc(at(MOUNTAIN.x), at(MOUNTAIN.z), r * k, 0, 7); g.fill(); }
    g.lineJoin = g.lineCap = 'round';
    for (const road of [...this.world.roads].reverse()) {
      const [color, width] = ROAD_STYLE[road.def.kind];
      g.strokeStyle = color; g.lineWidth = width; g.beginPath();
      for (let i = 0; i < road.n; i += 3) g.lineTo(at(road.x[i]), at(road.z[i]));
      if (road.closed) g.closePath(); else g.lineTo(at(road.x[road.n - 1]), at(road.z[road.n - 1]));
      g.stroke();
    }
    g.font = '600 20px ui-rounded, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const s of SPAWNS) {
      const p = this.world.spawnPose(s);
      g.fillStyle = '#f4f1e6'; g.beginPath(); g.arc(at(p.x), at(p.z), 14, 0, 7); g.fill();
      g.fillStyle = '#3a3a40'; g.fillText(s.key, at(p.x), at(p.z) + 1);
    }
  }

  update(v: Vehicle, info: { view: string; autopilot: boolean; paused: boolean; device: string; frameMs: number; calls: number; triangles: number; terrainTris: number; best: number }) {
    const kmh = Math.abs(v.speed) * 3.6;
    this.speed.textContent = String(Math.round(kmh));
    this.gear.textContent = v.gear < 0 ? 'R' : String(v.gear);
    this.revs.style.width = `${Math.min(100, (v.rpm / 7200) * 100).toFixed(1)}%`;
    this.revs.classList.toggle('red', v.rpm > 6500);
    if (this.toastUntil && performance.now() > this.toastUntil) { this.toastEl.classList.remove('on'); this.toastUntil = 0; }

    const m = this.mapEl, g = m.getContext('2d')!, k = m.width / (WORLD_HALF * 2);
    g.clearRect(0, 0, m.width, m.height);
    g.drawImage(this.base, 0, 0, m.width, m.height);
    g.save();
    g.translate((v.position.x + WORLD_HALF) * k, (v.position.z + WORLD_HALF) * k);
    g.rotate(-v.heading); // heading 0 faces +Z, which is down the map
    const a = this.big ? 9 : 7 * Math.min(2, devicePixelRatio);
    g.fillStyle = '#e4472f'; g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, a * 1.5); g.lineTo(a, -a); g.lineTo(0, -a * 0.4); g.lineTo(-a, -a); g.closePath(); g.fill(); g.stroke();
    g.restore();

    this.frames.push(info.frameMs);
    if (this.frames.length > 240) this.frames.shift();
    this.statsEl.hidden = !this.showStats;
    if (this.showStats) {
      const sorted = [...this.frames].sort((x, y) => x - y), pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
      const w = v.wheels, surf = SURFACE[w[0].surface] ?? '?';
      this.statsEl.textContent =
        `frame ${pick(0.5).toFixed(1)} ms median · ${pick(0.95).toFixed(1)} ms p95 · ${(1000 / pick(0.5)).toFixed(0)} fps\n`
        + `${info.calls} draw calls · ${(info.triangles / 1000).toFixed(0)}k triangles drawn · terrain ${(info.terrainTris / 1000).toFixed(0)}k\n`
        + `${info.view}${info.autopilot ? ' · autopilot' : ''}${info.paused ? ' · paused' : ''} · ${info.device}\n`
        + `lateral ${v.lateralG.toFixed(2)} g · long ${v.longG.toFixed(2)} g · slip angle ${(v.sideslip * 57.3).toFixed(0)}°\n`
        + `${surf}${v.airborne ? ' · airborne' : ''} · ${v.rpm.toFixed(0)} rpm · best ${info.best.toFixed(0)} km/h\n`
        + `x ${v.position.x.toFixed(0)}  z ${v.position.z.toFixed(0)}  y ${v.position.y.toFixed(1)}`;
    }
  }
}
