export const regions = ['forest', 'snow', 'glacier', 'volcano', 'market', 'arcade'] as const;
export type Region = (typeof regions)[number];
export const titles: Record<Region, string> = {
  forest: 'Cedar Pass',
  snow: 'Snowbell Ridge',
  glacier: 'Glacier Shelf',
  volcano: 'Ember Caldera',
  market: 'Market Town',
  arcade: 'Sunset Arcade',
};
export type Job = 'parcel' | 'return' | null;
export interface Progress {
  job: Job;
  delivered: boolean;
  sawmill: boolean;
  coins: number;
  scout: boolean;
  equipped: boolean;
  tuned: boolean;
  rice: number;
  visits: number;
  guide: boolean;
  best: number;
  bestDrift: number;
}
const key = 'btb-journey-v1';
function initial(): Progress {
  return {
    job: null,
    delivered: false,
    sawmill: false,
    coins: 0,
    scout: false,
    equipped: false,
    tuned: false,
    rice: 0,
    visits: 0,
    guide: true,
    best: 0,
    bestDrift: 0,
  };
}
function read(): Progress {
  const p = initial();
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '{}');
    for (const k of ['delivered', 'sawmill', 'scout', 'equipped', 'tuned', 'guide'] as const)
      if (typeof raw?.[k] === 'boolean') p[k] = raw[k];
    for (const k of ['coins', 'rice', 'visits'] as const)
      if (Number.isSafeInteger(raw?.[k]) && raw[k] >= 0) p[k] = raw[k];
    for (const k of ['best', 'bestDrift'] as const) if (Number.isFinite(raw?.[k]) && raw[k] >= 0) p[k] = raw[k];
    if (raw?.job === 'parcel' || raw?.job === 'return') p.job = raw.job;
  } catch {
    /* Start a fresh logbook when storage is unavailable. */
  }
  return p;
}
export function logbook() {
  let progress = read();
  let persistent = true;
  window.addEventListener('storage', (e) => {
    if (e.key === key) progress = read();
  });
  let pending = Promise.resolve();
  function change(action: (p: Progress) => void) {
    const write = () => {
      if (persistent) progress = read();
      action(progress);
      try {
        localStorage.setItem(key, JSON.stringify(progress));
      } catch {
        persistent = false;
      }
    };
    pending = pending.then(() => (navigator.locks ? navigator.locks.request(key, write) : write()));
    return pending;
  }
  return {
    get state() {
      return progress;
    },
    change,
    get persistent() {
      return persistent;
    },
  };
}
