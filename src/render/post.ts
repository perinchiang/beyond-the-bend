import * as THREE from 'three';

/**
 * Post chain: "miniature lens" + gentle grade + output conversion.
 *
 * Looking down at the ground from behind the car, distance from the focal plane grows
 * steadily with screen height, so a blur that grows away from a horizontal focal band is a
 * very cheap stand-in for depth of field. The blur itself is computed at half resolution
 * (a quarter of the pixels) and blended in — affordable on integrated and mobile GPUs —
 * and the whole lens can be switched off.
 */
const COC = /* glsl */ `
  uniform float uBlur, uFocus, uInner;
  float cocAt(float y) { return smoothstep(uInner, uInner + 0.39, abs(y - uFocus)) * uBlur; }
`;

export class PostFX {
  private sceneRT: THREE.WebGLRenderTarget;
  private blurRT: THREE.WebGLRenderTarget;
  private quad: THREE.Mesh;
  private fsScene = new THREE.Scene();
  private fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private blurMat: THREE.ShaderMaterial;
  private finalMat: THREE.ShaderMaterial;
  private w = 4;
  private h = 4;
  tilt = 1;
  /** 1 at the default zoom; shrinks when zoomed out so wide views stay crisp. */
  zoomScale = 1;

  constructor(private renderer: THREE.WebGLRenderer, taps: number, samples = 4) {
    // 8-bit sRGB targets: half the bandwidth of float buffers, and because the GPU encodes on
    // write and decodes on read, MSAA resolve and the blur still blend in linear light.
    const opts = { type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.sceneRT = new THREE.WebGLRenderTarget(4, 4, { ...opts, samples, depthBuffer: true });
    this.blurRT = new THREE.WebGLRenderTarget(4, 4, { ...opts, depthBuffer: false });
    const vertexShader = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
    const shared = { uBlur: { value: 0 }, uFocus: { value: 0.47 }, uInner: { value: 0.17 }, uTexel: { value: new THREE.Vector2() } };

    this.blurMat = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false, defines: { TAPS: taps }, vertexShader,
      uniforms: { tScene: { value: this.sceneRT.texture }, ...shared },
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D tScene;
        uniform vec2 uTexel;
        varying vec2 vUv;
        ${COC}
        void main() {
          float coc = cocAt(vUv.y);
          vec3 acc = texture2D(tScene, vUv).rgb;
          // golden-angle disc with a fixed pattern: identical every frame, so nothing crawls
          for (int i = 0; i < TAPS; i++) {
            float fi = float(i) + 0.5;
            float r = sqrt(fi / float(TAPS)) * coc;
            float a = fi * 2.39996323;
            acc += texture2D(tScene, vUv + vec2(cos(a), sin(a)) * r * uTexel).rgb;
          }
          gl_FragColor = vec4(acc / float(TAPS + 1), 1.0);
        }
      `,
    });

    this.finalMat = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false, vertexShader,
      uniforms: { tScene: { value: this.sceneRT.texture }, tBlur: { value: this.blurRT.texture }, ...shared },
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D tScene, tBlur;
        varying vec2 vUv;
        ${COC}

        vec3 toSRGB(vec3 c) {
          return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
        }

        void main() {
          vec3 c = texture2D(tScene, vUv).rgb;
          float coc = cocAt(vUv.y);
          if (coc > 0.05) c = mix(c, texture2D(tBlur, vUv).rgb, smoothstep(0.05, 1.6, coc));

          // soft shoulder so sunlit whites roll off instead of clipping
          vec3 over = max(c - 0.78, 0.0);
          c = min(c, 0.78) + 0.22 * (1.0 - exp(-over / 0.22));

          vec3 s = toSRGB(c);
          float l = dot(s, vec3(0.299, 0.587, 0.114));
          s = mix(s, s * s * (3.0 - 2.0 * s), 0.15);                   // gentle contrast
          s = mix(s, vec3(0.20, 0.28, 0.36), (1.0 - smoothstep(0.0, 0.42, l)) * 0.22); // cool blue-grey shade
          s = mix(s, s * vec3(1.03, 1.0, 0.94), smoothstep(0.55, 0.95, l) * 0.6);      // highlights lean warm
          vec2 v = (vUv - 0.5) * vec2(1.0, 0.86);
          float vig = smoothstep(0.42, 0.98, length(v) * 1.35);
          s = mix(s, s * vec3(0.86, 0.83, 0.87), vig * 0.5);
          gl_FragColor = vec4(s, 1.0);
        }
      `,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.finalMat);
    this.quad.frustumCulled = false;
    this.fsScene.add(this.quad);
  }

  private sync() {
    const blur = (this.h / 1080) * 7.5 * this.tilt * this.zoomScale;
    for (const m of [this.blurMat, this.finalMat]) {
      m.uniforms.uBlur.value = blur;
      m.uniforms.uTexel.value.set(1 / this.w, 1 / this.h);
    }
  }

  setSize(w: number, h: number) {
    this.w = w; this.h = h;
    this.sceneRT.setSize(w, h);
    this.blurRT.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    this.sync();
  }

  setTilt(v: number) { this.tilt = v; this.sync(); }

  /** Where the sharp band sits (0 = bottom of screen, 1 = top) and its half-height. */
  setFocus(centre: number, inner: number) {
    for (const m of [this.blurMat, this.finalMat]) {
      m.uniforms.uFocus.value = centre;
      m.uniforms.uInner.value = inner;
    }
  }

  setZoom(viewHeight: number) {
    const z = THREE.MathUtils.clamp(46 / viewHeight, 0.12, 1.25);
    if (Math.abs(z - this.zoomScale) < 0.002) return;
    this.zoomScale = z;
    this.sync();
  }

  render(scene: THREE.Scene, camera: THREE.Camera) {
    const r = this.renderer;
    r.setRenderTarget(this.sceneRT);
    r.render(scene, camera);
    if (this.tilt > 0) {
      this.quad.material = this.blurMat;
      r.setRenderTarget(this.blurRT);
      r.render(this.fsScene, this.fsCam);
    }
    this.quad.material = this.finalMat;
    r.setRenderTarget(null);
    r.render(this.fsScene, this.fsCam);
  }
}
