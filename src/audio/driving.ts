// One continuous engine voice and two filtered noise bands. All three share
// a smoothed master so surface changes, throttle release and mute stay quiet.
function makeVoices(ctx: AudioContext) {
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  const engine = ctx.createOscillator();
  const harmonics = new Float32Array([0, 1, 0.56, 0.32, 0.18, 0.12, 0.07, 0.05, 0.03]);
  engine.setPeriodicWave(ctx.createPeriodicWave(new Float32Array(harmonics.length), harmonics));
  engine.frequency.value = 39;
  const motor = ctx.createGain();
  motor.gain.value = 0.06;
  engine.connect(motor).connect(master);

  // A short repeating irregularity gives the idle a soft thrum.
  const wobble = ctx.createOscillator();
  const depth = ctx.createGain();
  wobble.frequency.value = 6.4;
  depth.gain.value = 1.1;
  wobble.connect(depth).connect(engine.frequency);

  const noise = ctx.createBufferSource();
  const length = ctx.sampleRate * 3;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) samples[i] = Math.random() * 2 - 1;
  noise.buffer = buffer;
  noise.loop = true;

  // Give the grass its own loop of soft, uneven swishes. Both envelope
  // frequencies complete whole cycles across the buffer, including the seam.
  const brush = ctx.createBufferSource();
  const rustle = ctx.createBuffer(1, length, ctx.sampleRate);
  const grain = rustle.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const phase = 2 * Math.PI * i / length;
    const swell = 0.5 + 0.5 * Math.sin(13 * phase + 2 * Math.sin(5 * phase));
    grain[i] = samples[i] * (0.25 + 0.75 * swell);
  }
  brush.buffer = rustle;
  brush.loop = true;

  function noiseBand(source: AudioBufferSourceNode, frequency: number, q: number) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const volume = ctx.createGain();
    volume.gain.value = 0;
    source.connect(filter).connect(volume).connect(master);
    return { filter, volume };
  }
  const tyres = noiseBand(noise, 460, 0.65);
  const leaves = noiseBand(brush, 2100, 0.8);
  engine.start();
  wobble.start();
  noise.start();
  brush.start();

  function mix(speed: number, throttle: number, grass: number) {
    const t = ctx.currentTime, roll = Math.min(1, Math.abs(speed) / 27);
    const load = speed * throttle < 0 ? 0 : Math.abs(throttle);
    engine.frequency.setTargetAtTime(39 + 64 * roll + 17 * load, t, 0.16);
    motor.gain.setTargetAtTime(0.065 + 0.09 * load + 0.035 * roll, t, 0.1);
    tyres.filter.frequency.setTargetAtTime(420 + 500 * roll, t, 0.16);
    tyres.volume.gain.setTargetAtTime(roll * (0.19 - 0.12 * grass), t, 0.1);
    leaves.volume.gain.setTargetAtTime(Math.sqrt(roll) * grass * 0.33, t, 0.11);
  }
  return { master, mix };
}

export function drivingAudio(muteSwitch: HTMLInputElement) {
  const key = 'btb-sound-muted';
  let muted = false;
  try { muted = localStorage.getItem(key) === '1'; } catch { /* Private storage is optional. */ }
  let paused = false;
  let ctx: AudioContext | undefined;
  let voices: ReturnType<typeof makeVoices> | undefined;
  const supported = typeof AudioContext !== 'undefined';

  function volume() {
    if (ctx && voices) voices.master.gain.setTargetAtTime(muted ? 0 : 0.70, ctx.currentTime, 0.025);
  }
  function unlock() {
    if (!supported || muted || paused || document.hidden || ctx?.state === 'running') return;
    if (!ctx) {
      ctx = new AudioContext();
      voices = makeVoices(ctx);
      volume();
    }
    void ctx.resume().catch(() => { /* A later user gesture can retry. */ });
  }
  function gesture(event: Event) {
    if (!(event.target instanceof Element && event.target.closest('#pause-toggle, #pause-menu'))) unlock();
  }
  for (const event of ['keydown', 'pointerdown', 'touchend']) {
    window.addEventListener(event, gesture, { capture: true, passive: true });
  }
  muteSwitch.checked = muted;
  muteSwitch.disabled = !supported;
  muteSwitch.addEventListener('change', () => {
    muted = muteSwitch.checked;
    try { localStorage.setItem(key, muted ? '1' : '0'); } catch { /* Session-only preference. */ }
    volume();
  });
  function setPaused(value: boolean) {
    paused = value;
    if (paused && ctx) void ctx.suspend().catch(() => {});
    else if (!paused) unlock();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && ctx) void ctx.suspend().catch(() => {});
    else if (ctx) unlock();
  });

  let lastMix = -Infinity;
  function update(now: number, speed: number, throttle: number, grass: number) {
    if (!ctx || !voices || ctx.state !== 'running' || muted || now - lastMix < 40) return;
    lastMix = now;
    voices.mix(speed, throttle, grass);
  }
  return { update, setPaused };
}
