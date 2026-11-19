import { ASPHALT } from './ground';
import type { Vehicle } from './vehicle/vehicle';

/**
 * Placeholder driving sound, synthesised: engine pitch from rpm (so gear changes are audible),
 * tyre squeal from slip (so the grip limit is audible), gravel rumble and wind from speed.
 * It exists because handling cannot be judged in silence; it is not the game's sound design.
 */
export class SliceAudio {
  private ctx?: AudioContext;
  private engine?: { a: OscillatorNode; b: OscillatorNode; gain: GainNode; filter: BiquadFilterNode };
  private squeal?: GainNode;
  private rumble?: GainNode;
  private wind?: GainNode;
  muted = false;

  /** 'none' before the first gesture, then the audio context's state. */
  get state(): string { return this.ctx?.state ?? 'none'; }

  /**
   * Call on every input gesture. Browsers only let sound start from one; a context created
   * from a gesture they do not count (some do not count gamepad buttons) stays suspended, so
   * later gestures try again.
   */
  start() {
    if (this.muted) return;
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = this.ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const voice = (type: BiquadFilterType, freq: number, q: number) => {
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = noise; src.loop = true; f.type = type; f.frequency.value = freq; f.Q.value = q; g.gain.value = 0;
      src.connect(f).connect(g).connect(master); src.start();
      return g;
    };
    this.squeal = voice('bandpass', 1150, 5);
    this.rumble = voice('lowpass', 420, 0.5);
    this.wind = voice('bandpass', 600, 0.4);
    const a = ctx.createOscillator(), b = ctx.createOscillator(), gain = ctx.createGain(), filter = ctx.createBiquadFilter();
    a.type = 'sawtooth'; b.type = 'square'; filter.type = 'lowpass'; gain.gain.value = 0;
    a.connect(filter); b.connect(filter); filter.connect(gain).connect(master);
    a.start(); b.start();
    this.engine = { a, b, gain, filter };
  }

  update(v: Vehicle, throttle: number, paused: boolean) {
    const ctx = this.ctx, e = this.engine;
    if (!ctx || !e) return;
    const t = ctx.currentTime, set = (p: AudioParam, x: number, tc = 0.05) => p.setTargetAtTime(x, t, tc);
    if (paused) { for (const g of [e.gain, this.squeal!, this.rumble!, this.wind!]) set(g.gain, 0); return; }
    const hz = (v.rpm / 60) * 2; // four-cylinder firing frequency
    set(e.a.frequency, hz, 0.03); set(e.b.frequency, hz / 2, 0.03);
    set(e.filter.frequency, 350 + throttle * 1900 + v.rpm * 0.25);
    set(e.gain.gain, 0.05 + 0.11 * throttle);
    const speed = Math.abs(v.speed);
    let slip = 0, gravel = 0, grounded = 0;
    for (const w of v.wheels) {
      if (!w.contact) continue;
      grounded++;
      if (w.surface !== ASPHALT) gravel++; else slip = Math.max(slip, w.slip);
    }
    set(this.squeal!.gain, speed > 4 ? Math.min(0.2, Math.max(0, slip - 0.5) * 0.45) : 0);
    set(this.rumble!.gain, grounded ? Math.min(0.3, (gravel / 4) * speed * 0.012) : 0);
    set(this.wind!.gain, Math.min(0.16, (speed / 62) ** 2 * 0.16), 0.2);
  }
}
