import type { Car } from '../vehicle/car';
import { roadPoint, type Track } from '../world/track';
import { MILL_DISTANCE } from '../world/cedar';
import { STATION_S, TOWN_EXIT_S } from '../world/station';
import { PASS_FRACTION, RICE_GATE, SPRINT_GATES } from '../world/waysides';
import { logbook, regions, titles, type Progress, type Region } from './progress';

export function journeyDrive(
  track: Track,
  car: Car,
  village: boolean,
  circuit: boolean,
  notify: (message: string) => void,
) {
  const book = logbook(),
    region = track.region;
  const action = document.querySelector<HTMLButtonElement>('#road-action')!;
  const destination = document.querySelector<HTMLElement>('#destination')!;
  const pin = document.querySelector<SVGElement>('#station-pin')!;
  const guideToggle = document.querySelector<HTMLInputElement>('#guide-toggle')!;
  const carButton = document.querySelector<HTMLButtonElement>('#garage-car')!;
  const tune = document.querySelector<HTMLButtonElement>('#garage-tune')!;
  const journal = document.querySelector<HTMLElement>('#journal')!;
  const gate = track.length * PASS_FRACTION;
  const gates = SPRINT_GATES.map((f) => f * track.length);
  let race: { elapsed: number; drift: number; checkpoint: number } | undefined;
  let lastState: Progress | undefined, lastGoal: number | undefined;
  let pending = false,
    waitingForRice = false;
  let pendingMill = false;
  let firstPass = book.state.rice < 3;
  let music = 0,
    target: number | undefined,
    context = '',
    hint = '';
  let lastUpdate = -Infinity;
  const positionCache = new Map<number, ReturnType<typeof roadPoint>>();
  function near(s: number, radius = 12) {
    let p = positionCache.get(s);
    if (!p) {
      p = roadPoint(track, s);
      positionCache.set(s, p);
    }
    return Math.hypot(car.x - p.x, car.z - p.z) < radius;
  }
  function visit(next?: Region | 'circuit') {
    const url = new URL(location.href);
    for (const k of ['study', 'route', 's', 'x', 'z', 'cam']) url.searchParams.delete(k);
    if (next) url.searchParams.set('route', next);
    location.assign(url.href);
  }
  const passes = document.querySelector<HTMLSelectElement>('#passes')!;
  passes.onchange = () => {
    const next = regions.find((id) => id === passes.value);
    if (next) visit(next);
  };
  function garage() {
    const p = book.state;
    car.equip(p.scout && p.equipped, p.tuned);
    car.bonusRun = region === 'arcade';
    car.ice = region === 'glacier' ? 0.88 : region === 'snow' ? 0.25 : 0;
    const unlocked = p.rice >= 3 ? Math.min(regions.length, p.visits + 1) : 0;
    document.getElementById('pass-label')!.hidden = unlocked === 0;
    while (passes.options.length - 1 < unlocked) {
      const id = regions[passes.options.length - 1];
      passes.add(new Option(titles[id], id));
    }
    guideToggle.checked = p.guide;
    journal.textContent =
      (book.persistent ? '' : 'Session only · ') +
      p.coins +
      ' coins · ' +
      (p.equipped ? 'Field Scout' : 'Village Mini') +
      ' · ' +
      (p.job === 'parcel'
        ? 'Parcel for Foothill Station'
        : p.job === 'return'
          ? 'Timetables for the village'
          : p.delivered
            ? 'Station parcel delivered'
            : 'Parcel available at the village') +
      (p.visits ? ' · ' + p.visits + '/6 passes' : '');
    carButton.textContent = p.scout
      ? p.equipped
        ? 'Drive the Village Mini'
        : 'Drive the Field Scout'
      : 'Buy Field Scout · 60 coins';
    carButton.disabled = !p.scout && p.coins < 60;
    tune.textContent = p.tuned ? 'Touring engine installed' : 'Touring engine · 40 coins';
    tune.disabled = p.tuned || p.coins < 40;
  }
  async function edit(fn: (p: Progress) => void) {
    await book.change(fn);
    garage();
    lastUpdate = -Infinity;
  }
  const returnButton = document.querySelector<HTMLButtonElement>('#return-village')!;
  returnButton.hidden = !region && !circuit;
  returnButton.onclick = () => visit();
  carButton.onclick = () =>
    void edit((p) => {
      if (!p.scout && p.coins >= 60) {
        p.scout = true;
        p.coins -= 60;
        p.equipped = true;
      } else if (p.scout) p.equipped = !p.equipped;
    });
  tune.onclick = () =>
    void edit((p) => {
      if (!p.tuned && p.coins >= 40) {
        p.coins -= 40;
        p.tuned = true;
      }
    });
  guideToggle.onchange = () => {
    const value = guideToggle.checked;
    void edit((p) => {
      p.guide = value;
    });
  };
  function actionView(key: string, label: string) {
    context = key;
    hint = label;
  }
  function sense(now: number) {
    const p = book.state;
    if (lastState !== p) {
      garage();
      lastState = p;
    }
    context = '';
    hint = '';
    target = undefined;
    music = 0;
    let line = '';
    if (village) {
      const town = near(TOWN_EXIT_S),
        station = near(STATION_S);
      if (p.job === 'parcel') {
        target = STATION_S;
        line = 'Parcel → Foothill Station';
        if (station) actionView('deliver', 'Deliver parcel');
      } else if (p.job === 'return') {
        target = TOWN_EXIT_S;
        line = 'Timetables → Village';
        if (town) actionView('deliver', 'Deliver timetables');
      } else if (town) {
        line = p.delivered ? 'Village post office' : 'Mara has a parcel for the train.';
        actionView('parcel', 'Take station parcel');
      } else if (station) {
        line = 'Arrived at Foothill Station';
        if (p.delivered) actionView('return', 'Take village mail');
      } else if (!p.delivered) line = 'Foothill Station';
      if (!p.job && near(227, 11)) {
        line = 'Old hill road';
        actionView('circuit', 'Enter hill sprint');
      }
      if (p.delivered) {
        if (!p.job && !context && p.rice < 3) {
          target = p.rice === 0 ? 78 : p.rice === 1 ? 103 : RICE_GATE;
          line = 'Follow the rice road';
        }
        if (
          !waitingForRice &&
          ((p.rice === 0 && near(78, 15)) ||
            (p.rice === 1 && near(103, 15)) ||
            (p.rice === 2 && near(RICE_GATE, 14)))
        ) {
          waitingForRice = true;
          const step = p.rice;
          void edit((save) => {
            if (save.rice === step) save.rice++;
          }).finally(() => {
            waitingForRice = false;
          });
        }
        if (firstPass && p.rice === 1 && near(92, 34)) music = 1;
        if (firstPass && p.rice >= 2 && near(125, 50)) music = 2;
        if (p.rice >= 3 && !near(125, 50)) firstPass = false;
      }
      if (track.cedar && !p.job) {
        const atMill = near(track.length + MILL_DISTANCE, 18);
        if (!context && p.rice >= 3) {
          target = p.sawmill ? track.cedar.to : track.length + MILL_DISTANCE;
          line = p.sawmill ? 'Cedar Pass → North ridge' : 'Mill road → Old sawmill';
        }
        if (
          !context &&
          p.rice < 3 &&
          track.cedar.points.some(
            (point, i) => i % 16 === 0 && Math.hypot(car.x - point.x, car.z - point.z) < 9,
          )
        )
          line = 'Cedar Pass · Mill road';
        if (near(track.cedar.from, 20) && !context) line = 'Mill road ↖ · Station ahead';
        if (atMill) {
          line = 'Old sawmill · Cedar Pass';
          if (!p.sawmill && !pendingMill) {
            pendingMill = true;
            void edit((save) => {
              save.sawmill = true;
            }).finally(() => {
              pendingMill = false;
            });
          }
        }
        if (near(track.cedar.to, 13) && (p.sawmill || p.visits > 0)) {
          line = 'North ridge · Village road';
          actionView('ridge', 'Enter Snowbell Ridge');
        }
      }
    } else if (region) {
      const index = regions.indexOf(region),
        next = regions[index + 1];
      target = gate;
      line = titles[region] + ' → ' + (next ? titles[next] : 'Village');
      if (near(gate, 17)) actionView('pass', next ? 'Enter ' + titles[next] : 'Back to village');
      if (region === 'arcade') music = 3;
    } else if (circuit) {
      if (race) {
        target = gates[race.checkpoint];
        if (near(target, 10)) {
          race.checkpoint++;
          if (race.checkpoint === gates.length) {
            const seconds = race.elapsed,
              drift = race.drift;
            void edit((p) => {
              if (!p.best || seconds < p.best) p.best = seconds;
              p.bestDrift = Math.max(p.bestDrift, drift);
            });
            notify('Finish · ' + seconds.toFixed(1) + ' s · slide ' + drift.toFixed(0) + ' m');
            race = undefined;
          }
        }
        if (race) {
          target = gates[race.checkpoint];
          line = 'Gate ' + (race.checkpoint + 1) + '/3 · ' + race.elapsed.toFixed(1) + ' s';
        }
      } else {
        target = near(0, 15) ? undefined : 0;
        line = 'Hill sprint start';
        if (near(0, 15)) actionView('race', 'Start hill sprint');
        if (p.best) line += ' · ' + p.best.toFixed(1) + ' s · slide ' + p.bestDrift.toFixed(0) + ' m';
      }
    }
    if (action.textContent !== hint) action.textContent = hint;
    action.hidden = !context;
    destination.hidden = !line;
    if (destination.textContent !== line) destination.textContent = line;
    const mapGoal = target ?? (village ? STATION_S : undefined);
    if (mapGoal !== lastGoal || lastUpdate === -Infinity) {
      pin.setAttribute('visibility', mapGoal === undefined ? 'hidden' : 'visible');
      if (mapGoal !== undefined) {
        const t = roadPoint(track, mapGoal);
        pin.setAttribute('transform', `translate(${t.x} ${t.z})`);
      }
      lastGoal = mapGoal;
    }
    lastUpdate = now;
  }
  action.onclick = async () => {
    if (pending) return;
    sense(performance.now());
    const key = context;
    if (!key) return;
    pending = true;
    try {
      if (key === 'parcel' || key === 'return') {
        await edit((p) => {
          if (!p.job) p.job = key;
        });
        notify(key === 'parcel' ? 'Mara: Catch the afternoon train!' : 'Porter: Take these timetables home.');
      } else if (key === 'deliver') {
        const expected = book.state.job;
        let award = 0;
        await edit((p) => {
          if (!expected || p.job !== expected) return;
          award = expected === 'parcel' && !p.delivered ? 100 : 35;
          p.coins += award;
          p.delivered = true;
          p.job = null;
        });
        if (award)
          notify(
            (expected === 'parcel' ? 'Porter: Just in time!' : 'Mara: Our timetables!') +
              ' +' +
              award +
              ' coins',
          );
      } else if (key === 'circuit') visit('circuit');
      else if (key === 'ridge') {
        await edit((p) => {
          p.visits = Math.max(1, p.visits);
        });
        visit('snow');
      } else if (key === 'pass' && region) {
        const index = regions.indexOf(region);
        await edit((p) => {
          p.visits = Math.max(p.visits, index + 1);
        });
        visit(regions[index + 1]);
      } else if (key === 'race') race = { elapsed: 0, drift: 0, checkpoint: 0 };
      action.blur();
      sense(performance.now());
    } finally {
      pending = false;
    }
  };
  garage();
  return {
    update(dt: number, now: number) {
      if (race) {
        race.elapsed += dt;
        if (Math.abs(car.slip) > 0.09) race.drift += Math.abs(car.speed) * dt;
      }
      if (now - lastUpdate >= 95) sense(now);
    },
    get goal() {
      return book.state.guide ? target : undefined;
    },
    get music() {
      return music;
    },
    interact() {
      if (!action.hidden && !action.closest('[hidden]')) action.click();
    },
    reset() {
      race = undefined;
      lastUpdate = -Infinity;
    },
  };
}
