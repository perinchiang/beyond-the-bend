import * as THREE from 'three';
import type { Look } from './looks';

/**
 * The finishing pass of a look: saturation, contrast, tint, vignette, paper grain and optional
 * tone steps. The scene is drawn into a multisampled buffer and resolved through one full-screen
 * quad; the graybox look skips all of this and draws straight to the screen.
 *
 * The buffer is 8-bit sRGB, as in the diorama's post chain: the GPU encodes on write and decodes
 * on read, so blending stays in linear light without needing float render targets, which are
 * not dependable on phones.
 */
export class SlicePost {
  private target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace, samples: 4, depthBuffer: true });
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.ShaderMaterial;

  constructor(private renderer: THREE.WebGLRenderer, post: NonNullable<Look['post']>) {
    this.material = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: {
        tScene: { value: this.target.texture },
        uSaturation: { value: post.saturation }, uContrast: { value: post.contrast }, uTint: { value: new THREE.Color(post.tint) },
        uVignette: { value: post.vignette }, uGrain: { value: post.grain }, uPosterize: { value: post.posterize },
      },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene;
        uniform vec3 uTint;
        uniform float uSaturation, uContrast, uVignette, uGrain, uPosterize;
        varying vec2 vUv;
        float hash(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.y); }
        void main() {
          vec3 c = texture2D(tScene, vUv).rgb;
          c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, uSaturation);
          c = (c - 0.2) * uContrast + 0.2;
          c *= uTint;
          vec2 q = vUv - 0.5;
          c *= 1.0 - uVignette * smoothstep(0.12, 0.62, dot(q, q) * 1.9);
          // Paper tooth: fixed to the screen like the sheet a picture is painted on.
          c *= 1.0 + uGrain * (hash(floor(gl_FragCoord.xy * 0.75)) + hash(floor(gl_FragCoord.xy * 0.31) + 91.0) - 1.0);
          if (uPosterize > 0.0) { vec3 s = sqrt(max(c, 0.0)); c = mix(c, pow(floor(s * uPosterize + 0.5) / uPosterize, vec3(2.0)), 0.6); }
          gl_FragColor = vec4(max(c, 0.0), 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const tri = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    tri.frustumCulled = false;
    this.scene.add(tri);
  }

  setSize(width: number, height: number, pixelRatio: number) {
    this.target.setSize(Math.max(1, Math.round(width * pixelRatio)), Math.max(1, Math.round(height * pixelRatio)));
  }

  render(scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }
}
