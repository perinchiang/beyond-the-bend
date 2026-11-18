import { regions, titles } from '../journey/progress';
import { MILL_X, MILL_Z } from '../world/cedar';
import type { Track } from '../world/track';
import { STATION_S, TOWN_EXIT_S } from '../world/station';
import './drivingHud.css';

export function createDrivingHud(track: Track, scenic: boolean, teleport: (s: number) => void, changeMap: (url: URL) => void) {
  const root = document.getElementById('drive-hud')!;
  const panel = document.getElementById('map-panel')!;
  const toggle = document.getElementById('map-toggle')!;
  const travel = document.querySelector<HTMLSelectElement>('#travel')!;
  const speed = document.getElementById('speed')!;
  const marker = document.getElementById('map-car')!;

  // In the north-up map one SVG unit is one metre. Only the car moves.
  const line = track.samples.filter((_, i) => i % 6 === 0)
    .map(t => t.x.toFixed(1) + ',' + t.z.toFixed(1)).join(' L');
  document.getElementById('map-road')!.setAttribute('d', 'M' + line + ' Z');
  if (track.lane) {
    const lanes = [track.lane, track.cedar].flatMap(lane => {
      if (!lane) return [];
      const points = lane.points.filter((_, i, path) => i % 4 === 0 || i === path.length - 1);
      return ['M' + points.map(p => p.x.toFixed(1) + ',' + p.z.toFixed(1)).join(' L')];
    });
    document.getElementById('map-lane')!.setAttribute('d', lanes.join(' '));
    if (track.cedar) {
      const mill = document.getElementById('mill-pin')!;
      mill.setAttribute('transform', 'translate(' + MILL_X + ' ' + MILL_Z + ')');
      mill.setAttribute('visibility', 'visible');
    }
  }
  toggle.addEventListener('click', (event) => {
    if (event.detail > 0) toggle.blur();
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    toggle.setAttribute('aria-label', panel.hidden ? 'Expand minimap' : 'Collapse minimap');
    toggle.textContent = panel.hidden ? 'Map ▾' : 'Map ▴';
  });

  document.getElementById('build-id')!.textContent = 'Build ' + import.meta.env.VITE_BUILD_ID;
  const stops: Record<string, number> = { town: TOWN_EXIT_S, fork: 100, bend: 227, station: STATION_S, circuit: 0, forest: track.cedar ? track.length + 8 : 0 };
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
    if (key === 'forest') url.searchParams.set('route', 'forest');
    else if (nextScenic) url.searchParams.delete('route');
    else url.searchParams.set('route', key);
    url.searchParams.set('s', String(stops[key] ?? 0));
    if (key === 'forest') url.searchParams.delete('s');
    changeMap(url);
  });

  let lastUpdate = -Infinity;
  function update(now: number, x: number, z: number, heading: number, metresPerSecond: number) {
    if (root.hidden || now - lastUpdate < 80) return;
    lastUpdate = now;
    speed.textContent = String(Math.round(Math.abs(metresPerSecond) * 3.6));
    if (!panel.hidden) marker.setAttribute('transform', `translate(${x} ${z}) rotate(${180 - heading * 180 / Math.PI})`);
  }
  const debugTravel = new URLSearchParams(location.search).get('debug') === '1';
  function hide(hidden: boolean) {
    root.hidden = hidden;
    travel.hidden = hidden || !debugTravel;
  }
  return { update, hide, travel };
}
