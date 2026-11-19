import type { VehicleInput } from './vehicle/vehicle';

/**
 * Keyboard and standard gamepad. Driving values are polled every frame; everything else
 * (reset, camera, teleport…) is queued as a named action on the press.
 */
const KEY_ACTIONS: Record<string, string> = {
  KeyR: 'reset', KeyV: 'camera', KeyC: 'camera', KeyP: 'autopilot', KeyM: 'map', KeyH: 'help',
  Escape: 'pause', F3: 'stats', Backquote: 'stats',
};
/** Gamepad buttons (standard mapping): Y, RB, LB, View, Menu. */
const PAD_ACTIONS: Record<number, string> = { 3: 'reset', 5: 'camera', 4: 'autopilot', 8: 'map', 9: 'pause' };
const DRIVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];

export class Input {
  private keys = new Set<string>();
  private queue: string[] = [];
  private padWas: boolean[] = [];
  private padActive = false;
  /** 'keyboard' or 'gamepad': whichever steered last. */
  device = 'keyboard';

  constructor() {
    addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (DRIVE_KEYS.includes(e.code) || KEY_ACTIONS[e.code]) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      const a = KEY_ACTIONS[e.code] ?? (/^Digit[1-9]$/.test(e.code) ? `spawn:${e.code.slice(5)}` : null);
      if (a) this.queue.push(a);
      else this.queue.push('gesture');
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('pointerdown', () => this.queue.push('gesture'));
  }

  takeActions(): string[] { const q = this.queue; this.queue = []; return q; }

  read(out: VehicleInput): VehicleInput {
    const k = this.keys, on = (...codes: string[]) => codes.some((c) => k.has(c)) ? 1 : 0;
    let throttle = on('KeyW', 'ArrowUp'), brake = on('KeyS', 'ArrowDown');
    let steer = on('KeyD', 'ArrowRight') - on('KeyA', 'ArrowLeft'), handbrake = k.has('Space'), digital = true;
    const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p && p.connected && p.buttons.length > 9);
    if (pad) {
      const x = pad.axes[0] ?? 0, a = Math.abs(x);
      const stick = a < 0.1 ? 0 : Math.sign(x) * Math.pow((a - 0.1) / 0.9, 1.6);
      if (stick !== 0) { steer = stick; digital = false; this.device = 'gamepad'; }
      else if (steer !== 0) this.device = 'keyboard';
      throttle = Math.max(throttle, pad.buttons[7]?.value ?? 0);
      brake = Math.max(brake, pad.buttons[6]?.value ?? 0);
      handbrake = handbrake || !!pad.buttons[0]?.pressed || !!pad.buttons[2]?.pressed;
      for (const [b, action] of Object.entries(PAD_ACTIONS)) {
        const down = !!pad.buttons[+b]?.pressed;
        if (down && !this.padWas[+b]) this.queue.push(action);
        this.padWas[+b] = down;
      }
      // Any use of the pad counts as a first gesture too (it starts the sound), each time the
      // pad goes from idle to in use: a player may never touch the keyboard.
      const active = stick !== 0 || pad.buttons.some((q) => q.pressed || q.value > 0.1);
      if (active && !this.padActive) this.queue.push('gesture');
      this.padActive = active;
    } else {
      this.padActive = false;
      if (steer !== 0) this.device = 'keyboard';
    }
    out.throttle = throttle; out.brake = brake; out.steer = steer; out.handbrake = handbrake; out.digital = digital;
    return out;
  }
}
