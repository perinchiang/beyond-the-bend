import type { CarInput } from '../vehicle/car';
import './touch.css';

/** Each control owns its pointers; a second finger never steals another control. */
export class TouchControls {
  readonly input: CarInput = { throttle: 0, steer: 0, brake: false };
  private root = document.createElement('div');
  private held = new Map<number, string>();
  private throttlePointer: number | null = null;
  private throttle: HTMLElement;
  private mode: HTMLButtonElement;
  private preset: HTMLButtonElement;

  constructor(toggleCamera: () => void, cyclePreset: () => void) {
    this.root.id = 'touch-controls';
    this.root.innerHTML = `
      <div class="touch-camera">
        <button type="button" id="touch-camera" aria-label="Switch camera mode">Driving</button>
        <button type="button" id="touch-preset" aria-label="Cycle driving camera preset">Normal</button>
      </div>
      <div class="touch-steering">
        <button type="button" data-hold="left" aria-label="Steer left">◀</button>
        <button type="button" data-hold="right" aria-label="Steer right">▶</button>
      </div>
      <div class="touch-pedals">
        <button type="button" data-hold="brake" aria-label="Brake">Brake</button>
        <div id="touch-throttle" role="slider" tabindex="0" aria-label="Throttle; hold and slide up to accelerate" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <span class="throttle-fill"></span><span class="throttle-thumb"></span>
          <span class="throttle-label">Throttle<br /><output>0%</output></span>
        </div>
      </div>`;
    document.body.append(this.root);
    this.throttle = this.root.querySelector('#touch-throttle')!;
    this.mode = this.root.querySelector('#touch-camera')!;
    this.preset = this.root.querySelector('#touch-preset')!;
    this.mode.addEventListener('click', toggleCamera);
    this.preset.addEventListener('click', cyclePreset);
    this.root.addEventListener('contextmenu', e => e.preventDefault());
    this.root.querySelectorAll<HTMLButtonElement>('[data-hold]').forEach(button => {
      button.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault();
        button.setPointerCapture(e.pointerId);
        this.held.set(e.pointerId, button.dataset.hold!);
        this.updateHeld();
      });
      const release = (e: PointerEvent) => {
        this.held.delete(e.pointerId);
        this.updateHeld();
      };
      for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) button.addEventListener(event, release);
    });
    const move = (e: PointerEvent) => {
      if (e.pointerId !== this.throttlePointer) return;
      const rect = this.throttle.getBoundingClientRect();
      this.setThrottle((rect.bottom - 20 - e.clientY) / (rect.height - 40));
    };
    this.throttle.addEventListener('pointerdown', e => {
      if (e.button !== 0 || this.throttlePointer !== null) return;
      e.preventDefault();
      this.throttle.setPointerCapture(e.pointerId);
      this.throttlePointer = e.pointerId;
      move(e);
    });
    this.throttle.addEventListener('pointermove', move);
    const releaseThrottle = (e: PointerEvent) => {
      if (e.pointerId !== this.throttlePointer) return;
      this.throttlePointer = null;
      this.setThrottle(0);
    };
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) this.throttle.addEventListener(event, releaseThrottle);
    this.throttle.addEventListener('keydown', e => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      this.setThrottle(e.key === 'Home' ? 0 : e.key === 'End' ? 1 : this.input.throttle + (e.key === 'ArrowUp' ? .1 : -.1));
    });
    this.throttle.addEventListener('keyup', () => this.setThrottle(0));
    this.throttle.addEventListener('blur', () => this.setThrottle(0));
    addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });
    addEventListener('resize', () => this.reset());
  }

  private setThrottle(value: number) {
    this.input.throttle = Math.max(0, Math.min(1, value));
    const percent = Math.round(this.input.throttle * 100);
    this.throttle.style.setProperty('--throttle', String(this.input.throttle));
    this.throttle.setAttribute('aria-valuenow', String(percent));
    this.throttle.querySelector('output')!.textContent = percent + '%';
  }

  private updateHeld() {
    const values = [...this.held.values()];
    this.input.steer = Number(values.includes('right')) - Number(values.includes('left'));
    this.input.brake = values.includes('brake');
    this.root.querySelectorAll<HTMLButtonElement>('[data-hold]').forEach(button => {
      const active = values.includes(button.dataset.hold!);
      button.classList.toggle('pressed', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  reset() {
    this.held.clear(); this.throttlePointer = null;
    this.updateHeld(); this.setThrottle(0);
    this.root.querySelectorAll<HTMLElement>('[data-hold], #touch-throttle').forEach(el => {
      // Capture is released by the browser on pointer-up; cleared state ignores subsequent moves.
      el.blur();
    });
  }

  updateCamera(mode: string, preset: string) {
    this.mode.textContent = mode === 'drive' ? 'Driving' : 'Free';
    this.preset.textContent = preset;
    this.preset.disabled = mode !== 'drive';
  }
}
