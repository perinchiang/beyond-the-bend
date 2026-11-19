// Hold the camera still and move only the sun. A baked gold stripe would stay put.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 320 } });
  const base = process.env.BTB_URL ?? 'http://127.0.0.1:5183/beyond-the-bend/';
  await page.goto(base + '?hud=0&t=20&dpr=1');
  const specimen = 'Postal orchard: openBirch';
  await page.waitForFunction(name => window.__btb?.scene.getObjectByName('scatter').children
    .some(m => m.geometry?.name === name && m.material.map.image?.naturalWidth > 0), specimen);

  const [left, right] = await page.evaluate(name => {
    const { scene, rig, sun, renderer } = window.__btb;
    const source = scene.getObjectByName('scatter').children.find(m => m.geometry?.name === name);
    // Use the game's instanced shader, without scenery contributing to the measurement.
    const stage = new scene.constructor();
    const crown = new source.constructor(source.geometry, source.material, 1);
    crown.setMatrixAt(0, source.matrix.clone().identity());
    const sky = scene.children.find(o => o.isHemisphereLight).clone();
    const key = sun.clone();
    key.castShadow = false;
    key.target.position.set(0, 7, 0);
    stage.add(crown, sky, key, key.target);
    const camera = rig.camera.clone();
    camera.aspect = 1; camera.fov = 32;
    camera.position.set(0, 7.4, 13.5);
    camera.lookAt(0, 7.1, 0);
    camera.updateProjectionMatrix();
    renderer.setClearColor(0x000000);

    function sunlitCentre(side) {
      key.position.set(side, 7.54, .25);
      renderer.render(stage, camera);
      const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const rgba = new Uint8Array(w*h*4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);

      const leaves = [];
      let minX = w, maxX = 0, sum = 0;
      for (let i=0; i<w*h; i++) {
        const r = rgba[i*4], g = rgba[i*4+1], b = rgba[i*4+2];
        if (r+g+b < 30) continue; // black background
        const x = i % w, luminance = .30*r + .59*g + .11*b;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        leaves.push([x, luminance]); sum += luminance;
      }
      const mean = sum/leaves.length;
      let weight = 0, xSum = 0;
      for (const [x, luminance] of leaves) {
        const light = Math.max(0, luminance-mean);
        weight += light; xSum += x*light;
      }
      return (xSum/weight-minX)/(maxX-minX);
    }
    return [sunlitCentre(-1), sunlitCentre(1)];
  }, specimen);
  console.log('Sunlit centre across the crown:', left.toFixed(2), '→', right.toFixed(2));
  assert.ok(right-left > .125, 'the sunlit plane must move across at least one eighth of the crown');
} finally {
  await browser.close();
}
