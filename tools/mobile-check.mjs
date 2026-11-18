/** Run this exported function in a loaded game's browser context (for example page.evaluate).
 * Synthetic pointer coverage: capture itself requires a real device/trusted pointer test.
 * Uses the existing __btb diagnostic hook; does not change vehicle or camera code.
 */
export default async function checkMobileControls() {
  const b = window.__btb;
  if (!b?.ready || !b.car.isReady) throw new Error('World/car not loaded');
  const results = [];
  const check = (name, ok) => { if (!ok) throw new Error(name); results.push(name); };
  const root = document.querySelector('#touch-controls');
  const throttle = root.querySelector('#touch-throttle');
  const left = root.querySelector('[data-hold="left"]');
  const right = root.querySelector('[data-hold="right"]');
  const brake = root.querySelector('[data-hold="brake"]');
  const style = document.createElement('style');
  // Show the actual coarse-pointer styles on desktop without changing application code.
  style.textContent = [...document.styleSheets].flatMap(s => [...s.cssRules])
    .filter(r => r.conditionText === '(any-pointer: coarse)')
    .map(r => [...r.cssRules].map(c => c.cssText).join(String.fromCharCode(10))).join(String.fromCharCode(10));
  document.head.append(style);
  const originals = [left, right, brake, throttle].map(el => [el, el.setPointerCapture]);
  originals.forEach(([el]) => { el.setPointerCapture = () => {}; });
  const pointer = (el, type, id, y = 0) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: id, pointerType: 'touch', button: 0, clientY: y }));
  const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
  const originalUpdate = b.car.update;
  let applied;
  b.car.update = function(dt, input, ...rest) { applied = { ...input }; return originalUpdate.call(this, dt, input, ...rest); };
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  try {
    const r = throttle.getBoundingClientRect(), y = value => r.bottom - 20 - value * (r.height - 40);
    pointer(left, 'pointerdown', 1);
    pointer(throttle, 'pointerdown', 2, y(.5));
    await frame();
    check('Simultaneous steering + 50% analog throttle reaches vehicle', applied.steer === 1 && Math.abs(applied.throttle - .5) < .01);
    pointer(throttle, 'pointermove', 2, y(.8));
    check('Dragging continuously adjusts throttle to 80%', Math.abs(b.touch.input.throttle - .8) < .01);
    pointer(throttle, 'pointerdown', 3, y(0));
    pointer(throttle, 'pointerup', 3);
    check('Second finger cannot steal active throttle', Math.abs(b.touch.input.throttle - .8) < .01);
    pointer(left, 'pointerup', 1);
    check('Steering release preserves throttle', b.touch.input.steer === 0 && b.touch.input.throttle > .79);
    pointer(brake, 'pointerdown', 4);
    await frame();
    check('Brake works with throttle held', applied.brake && applied.throttle > .79);
    pointer(brake, 'pointercancel', 4);
    pointer(throttle, 'pointerup', 2);
    check('Brake cancellation and throttle release reset input', !b.touch.input.brake && b.touch.input.throttle === 0);
    pointer(right, 'pointerdown', 5);
    pointer(right, 'lostpointercapture', 5);
    pointer(throttle, 'pointerdown', 6, y(1));
    pointer(throttle, 'pointercancel', 6);
    check('Lost capture and throttle cancellation reset input', b.touch.input.steer === 0 && b.touch.input.throttle === 0);
    pointer(left, 'pointerdown', 7);
    pointer(throttle, 'pointerdown', 8, y(1));
    window.dispatchEvent(new Event('blur'));
    pointer(throttle, 'pointermove', 8, y(1));
    check('Window blur clears holds and ignores stale finger movement', b.touch.input.steer === 0 && b.touch.input.throttle === 0);
    pointer(right, 'pointerdown', 9);
    pointer(throttle, 'pointerdown', 10, y(.4));
    window.dispatchEvent(new Event('resize'));
    check('Rotation/resize clears touch input', b.touch.input.steer === 0 && b.touch.input.throttle === 0);
    b.view({ s: 232, mode: 'drive', preset: 1 });
    document.querySelector('#pause-toggle').click();
    document.querySelector('#touch-camera').scrollIntoView({ block: 'center' });
    document.querySelector('#touch-camera').click();
    check('Touch switches to Free and disables driving presets', b.rig.mode === 'free' && document.querySelector('#touch-preset').disabled);
    document.querySelector('#touch-camera').click();
    const presets = [];
    for (let i = 0; i < 3; i++) { document.querySelector('#touch-preset').click(); presets.push(b.rig.preset.name); }
    check('Touch cycles Close / High / Normal', presets.join() === 'Close,High,Normal');
    for (const id of ['touch-camera','touch-preset']) {
      const rect = document.getElementById(id).getBoundingClientRect();
      check(id + ' fits pause menu', rect.width >= 44 && rect.height >= 44 && rect.top >= 0 && rect.bottom <= innerHeight);
    }
    document.querySelector('#resume-drive').click();
    await frame();
    key('keydown', 'KeyW'); key('keydown', 'KeyD'); await frame();
    check('Desktop W+D remains functional', applied.throttle === 1 && applied.steer === -1);
    key('keyup', 'KeyW'); key('keyup', 'KeyD'); key('keydown', 'Space'); await frame();
    check('Desktop brake and key release remain functional', applied.throttle === 0 && applied.steer === 0 && applied.brake);
    key('keyup', 'Space'); key('keydown', 'KeyC'); key('keyup', 'KeyC');
    check('Keyboard camera switching works', b.rig.mode === 'free');
    key('keydown', 'KeyC'); key('keyup', 'KeyC'); key('keydown', 'KeyV'); key('keyup', 'KeyV');
    check('Keyboard preset switching works', b.rig.preset.name === 'Close');
    check('Camera changes do not alter vehicle simulation', JSON.stringify(b.simulate(false)) === JSON.stringify(b.simulate(true)));
    b.view({ s: 232, mode: 'drive', preset: 1 });
    for (const el of [left, right, brake, throttle]) {
      const box = el.getBoundingClientRect();
      check(el.getAttribute('aria-label') + ' fits viewport and 44px target', box.x >= 0 && box.y >= 0 && box.right <= innerWidth && box.bottom <= innerHeight && box.width >= 44 && box.height >= 44);
    }
    check('Controls prevent touch gestures', getComputedStyle(throttle).touchAction === 'none' && getComputedStyle(left).touchAction === 'none');
    check('GLB loaded from repository subdirectory', performance.getEntriesByType('resource').some(r => r.name.endsWith('/beyond-the-bend/models/car.glb')));
    return { viewport: [innerWidth, innerHeight], passed: results };
  } finally {
    b.car.update = originalUpdate;
    originals.forEach(([el, fn]) => { el.setPointerCapture = fn; });
    b.touch.reset();
    for (const code of ['KeyW', 'KeyD', 'Space']) key('keyup', code);
    // Keep coarse-pointer styling visible for the subsequent screenshot; reload restores it.
  }
}
