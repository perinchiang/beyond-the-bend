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
  returned: boolean;
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
    returned: false,
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
function decode(text: string | null): Progress {
  const p = initial();
  try {
    const raw = JSON.parse(text || '{}');
    for (const k of ['delivered', 'returned', 'sawmill', 'scout', 'equipped', 'tuned', 'guide'] as const)
      if (typeof raw?.[k] === 'boolean') p[k] = raw[k];
    for (const k of ['coins', 'rice', 'visits'] as const)
      if (Number.isSafeInteger(raw?.[k]) && raw[k] >= 0) p[k] = raw[k];
    for (const k of ['best', 'bestDrift'] as const) if (Number.isFinite(raw?.[k]) && raw[k] >= 0) p[k] = raw[k];
    if (raw?.job === 'parcel' || raw?.job === 'return') p.job = raw.job;
  } catch {
    /* Keep defaults for unreadable saves. */
  }
  return p;
}
export function logbook() {
  // Both storage APIs can be blocked. The browsing context still carries its
  // name across the game's same-tab, same-path map changes (including file URLs).
  const prefix = key + ':' + location.pathname + ':';
  let persistent = true;
  let progress = initial();
  function refresh() {
    try { progress = decode(localStorage.getItem(key)); } catch { /* Keep the current copy. */ }
  }
  function restore() {
    let session = window.name.startsWith(prefix) ? window.name.slice(prefix.length) : null;
    try { session ??= sessionStorage.getItem(key); } catch { /* Storage denied. */ }
    persistent = session === null;
    if (session !== null) progress = decode(session);
    else refresh();
  }
  restore();
  window.addEventListener('pageshow', (e) => { if (e.persisted) restore(); });
  window.addEventListener('storage', (e) => {
    if (persistent && e.key === key && e.storageArea === localStorage) refresh();
  });
  let pending = Promise.resolve();
  function change(action: (p: Progress) => void) {
    const write = () => {
      if (persistent) refresh();
      action(progress);
      const snapshot = JSON.stringify(progress);
      if (persistent) {
        try {
          localStorage.setItem(key, snapshot);
          return;
        } catch {
          persistent = false;
        }
      }
      try {
        sessionStorage.setItem(key, snapshot);
        if (window.name.startsWith(prefix)) window.name = '';
      } catch {
        window.name = prefix + snapshot;
      }
    };
    pending = pending.then(async () => {
      if (persistent && navigator.locks) {
        let entered = false;
        try {
          await navigator.locks.request(key, () => {
            entered = true;
            write();
          });
          return;
        } catch (error) {
          if (entered) throw error;
          // Some private browsing contexts expose Locks but deny the request.
        }
      }
      write();
    });
    return pending;
  }
  return {
    async travel(url: URL) {
      await pending;
      location.assign(url.href);
    },
    get state() {
      return progress;
    },
    change,
    get persistent() {
      return persistent;
    },
  };
}
