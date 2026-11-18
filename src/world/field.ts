import * as THREE from 'three';
import type { Track } from './track';

// Four remembered wheel positions keep a passing gust on the plants after the car leaves.
export function riceField(track: Track, low: boolean) {
  const wake = Array.from({ length: 4 }, () => new THREE.Vector4(1000, 1000, -100, 0));
  const rows = low ? 8 : 13;
  const start = track.at(74);
  function bed(x: number, z: number) {
    const dx = x-start.x, dz = z-start.z;
    const along = dx*start.tx + dz*start.tz;
    const across = Math.abs(dz*start.tx - dx*start.tz);
    const row = Math.max(0,(across-5.65)/0.9);
    const margin = Math.min(across-4.95, 5.65+rows*0.9-across,
      along-row*0.56-2.4*Math.sin(row*0.81), 75-along-row*0.78+1.8*Math.sin(row));
    return THREE.MathUtils.smoothstep(margin, -0.55, 1.15);
  }
  let last = -1,
    slot = 0;
  function update(x: number, z: number, speed: number, time: number) {
    if (time - last < 0.14) return;
    last = time;
    wake[slot].set(x, z, time, Math.min(1, Math.abs(speed) / 17));
    slot = (slot + 1) % wake.length;
  }
  return { wake, bed, update };
}

export type RiceField = ReturnType<typeof riceField>;
