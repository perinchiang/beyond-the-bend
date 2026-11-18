import { regions, titles } from '../journey/progress';
import type { Track } from '../world/track';
import { STATION_S, TOWN_EXIT_S } from '../world/station';
import './drivingHud.css';

export function createDrivingHud(track: Track, scenic: boolean, teleport: (s: number) => void) {
  const root = document.getElementById('drive-hud')!;
  const panel = document.getElementById('map-panel')!;
  const toggle = document.getElementById('map-toggle')!;
  const travel = document.querySelector<HTMLSelectElement>('#travel')!;
  const speed = document.getElementById('speed')!;
  const marker = document.getElementById('map-car')!;
  const destination = document.getElementById('destination')!;
  destination.hidden = !scenic;

  // In the north-up map one SVG unit is one metre. Only the car moves.
  const line = track.samples.filter((_, i) => i % 6 === 0)
    .map(t => t.x.toFixed(1) + ',' + t.z.toFixed(1)).join(' L');
  document.getElementById('map-road')!.setAttribute('d', 'M' + line + ' Z');
  if (track.lane) {
    document.getElementById('map-lane')!.setAttribute('d', 'M' + track.lane.points
      .filter((_, i, points) => i % 4 === 0 || i === points.length - 1)
      .map(p => p.x.toFixed(1) + ',' + p.z.toFixed(1)).join(' L'));
  }
  if (scenic) {
    const station = track.at(STATION_S);
    const pin = document.getElementById('station-pin')!;
    pin.setAttribute('transform', `translate(${station.x} ${station.z})`);
    pin.setAttribute('visibility', 'visible');
  }
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    toggle.setAttribute('aria-label', panel.hidden ? 'Expand minimap' : 'Collapse minimap');
    toggle.textContent = panel.hidden ? 'Map ▾' : 'Map ▴';
  });

  document.getElementById('build-id')!.textContent = 'Build ' + import.meta.env.VITE_BUILD_ID;
  const stops: Record<string, number> = { town: TOWN_EXIT_S, fork: 100, bend: 227, station: STATION_S, circuit: 0 };
  for (const region of regions) travel.add(new Option(titles[region], region));
  travel.addEventListener('change', () => {
    const key = travel.value;
    if (!key) return;
    travel.value = '';
    travel.blur();
    const nextScenic = key in stops && key !== 'circuit';
    if ((scenic && nextScenic) || (key === 'circuit' && !track.region && !scenic) || key === track.region) {
      teleport(stops[key] ?? 0);
      return;
    }
    const url = new URL(location.href);
    for (const p of ['study', 'cam', 'x', 'z']) url.searchParams.delete(p);
    if (nextScenic) url.searchParams.delete('route');
    else url.searchParams.set('route', key);
    url.searchParams.set('s', String(stops[key] ?? 0));
    location.assign(url.href);
  });

  let lastUpdate = -Infinity;
  function update(now: number, x: number, z: number, heading: number, metresPerSecond: number) {
    if (root.hidden || now - lastUpdate < 80) return;
    lastUpdate = now;
    speed.textContent = String(Math.round(Math.abs(metresPerSecond) * 3.6));
    if (!panel.hidden) marker.setAttribute('transform', `translate(${x} ${z}) rotate(${180 - heading * 180 / Math.PI})`);
  }
  function hide(hidden: boolean) { root.hidden = travel.hidden = hidden; }
  return { update, hide, travel, destination };
}
