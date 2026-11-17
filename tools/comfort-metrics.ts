import * as THREE from 'three';
import { CameraRig } from '../src/camera';
import { buildTrack } from '../src/world/track';
import { buildHeightField, naturalHeight } from '../src/world/heightfield';

const deg = 180 / Math.PI;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
export function cameraMetrics() {
  const all: Record<string, object> = {};
  for (const mode of ['drive', 'free'] as const) for (const name of ['straight', 'gentle', 'sharp', 'esses']) {
    const r = new CameraRig(); r.setAspect(852 / 393);
    const pos = new THREE.Vector3();
    if (mode === 'free') r.setFree(180, 45, 44); else r.setDrive(1);
    r.update(0, pos, 0, true);
    let yaw = r.yaw, rate = 0, totalYaw = 0, peakRate = 0, peakAccel = 0, maxSlip = 0, maxLag = 0, finalHeading = 0;
    const visibility: Record<number, number> = { 15: 0, 25: 0, 35: 0, 45: 0 };
    let frames = 0;
    const dt = 1 / 60;
    for (let i = 1; i <= 1200; i++) {
      const t = i * dt;
      const heading = name === 'straight' ? 0 : name === 'gentle' ? t * .07 : name === 'sharp' ? Math.PI / 2 * THREE.MathUtils.smoothstep(t, 5, 7) : .65 * Math.sin(t * 1.2);
      finalHeading = heading;
      const speed = t < 2 ? t * 10 : t > 16 ? Math.max(0, 20 - (t - 16) * 10) : 20;
      pos.x += Math.sin(heading) * speed * dt; pos.z += Math.cos(heading) * speed * dt;
      r.update(dt, pos, heading);
      const nextRate = wrap(r.yaw - yaw) / dt;
      totalYaw += Math.abs(wrap(r.yaw - yaw)) * deg;
      peakRate = Math.max(peakRate, Math.abs(nextRate) * deg);
      peakAccel = Math.max(peakAccel, Math.abs(nextRate - rate) / dt * deg);
      const f = (r as any).focus as THREE.Vector3;
      maxLag = Math.max(maxLag, Math.hypot(f.x - pos.x, f.z - pos.z));
      maxSlip = Math.max(maxSlip, Math.abs((f.x - pos.x) * Math.cos(r.yaw) - (f.z - pos.z) * Math.sin(r.yaw)));
      for (const distance of Object.keys(visibility).map(Number)) {
        const ahead = pos.clone().add(new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading)).multiplyScalar(distance)).project(r.camera);
        if (Math.abs(ahead.x) < .95 && Math.abs(ahead.y) < .95) visibility[distance]++;
      }
      frames++; yaw = r.yaw; rate = nextRate;
    }
    all[mode + '/' + name] = { totalYaw: +totalYaw.toFixed(2), peakRate: +peakRate.toFixed(2), peakAccel: +peakAccel.toFixed(2), finalYawError: +(wrap(finalHeading + Math.PI - r.yaw) * deg).toFixed(2), maxLag: +maxLag.toFixed(3), maxSlip: +maxSlip.toFixed(3), aheadVisible: Object.fromEntries(Object.entries(visibility).map(([m,n]) => [m, +(n / frames).toFixed(3)])) };
  }
  return all;
}
export function terrainMetrics() {
  const track = buildTrack(), hf = buildHeightField(track);
  const values: any[] = [];
  for (let s = 0; s < track.length; s += 4) {
    const p = track.at(s), nx = -p.tz, nz = p.tx;
    const probe = (d: number) => hf.height(p.x + nx * d, p.z + nz * d) - p.y;
    const left = probe(-12), right = probe(12);
    values.push({ s, cut: naturalHeight(p.x,p.z)-p.y, left, right, bowl: (left+right)/2, both: Math.min(left,right) });
  }
  const sorted = [...values].sort((a,b) => b.bowl-a.bowl);
  return { meanBowl12m: values.reduce((a,b)=>a+b.bowl,0)/values.length, maxBowl12m: sorted[0], worst: sorted.slice(0,5), bothRaisedOver25cm: values.filter(v=>v.both>.25).length, samples:values.length };
}
