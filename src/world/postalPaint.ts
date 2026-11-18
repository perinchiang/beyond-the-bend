import * as THREE from 'three';
import { paintMaterial, type PaintShared } from '../render/paint';
import pigmentUrl from '../art/postal-pigment.png?inline';

// The three channels are pigment impressions sampled from the approved painting:
// roof bristles, a leafy sweep, and the grassy bank. No picture of the scene is
// projected from the camera. One small, mipmapped swatch serves all the surfaces.
const WIDTH = 27, LENGTH = 45;
interface Site { x: number; z: number; yaw: number; width: number; depth: number }
export function createPostalPaint(site: Site, cottages: Site[]) {
  const pigment = new THREE.TextureLoader().load(pigmentUrl);
  pigment.wrapS = pigment.wrapT = THREE.RepeatWrapping;
  pigment.colorSpace = THREE.NoColorSpace;
  pigment.anisotropy = 2;
  const sin = Math.sin(site.yaw), cos = Math.cos(site.yaw);
  const feet = cottages.map(c => {
    const dx=c.x-site.x, dz=c.z-site.z;
    return new THREE.Vector4(dx*cos-dz*sin,dx*sin+dz*cos,c.width/2,c.depth/2);
  });
  const uniforms = {
    uPostalPigment: { value: pigment },
    uPostFeet: { value: feet },
    uPostFrame: { value: new THREE.Vector4(site.x, site.z, sin, cos) },
  };
  // x is towards the asphalt from the post-office wall; z follows the drive.
  function inOrchard(x: number, z: number) {
    const dx = x - site.x, dz = z - site.z;
    return Math.hypot((dx*cos - dz*sin - 7) / WIDTH, (dx*sin + dz*cos + 3) / LENGTH) < 1.19;
  }
  return { uniforms, inOrchard };
}
export type PostalPaint = ReturnType<typeof createPostalPaint>;

export const postalGLSL = /* glsl */ `
  uniform sampler2D uPostalPigment;
  uniform vec4 uPostFrame;
  vec2 postLocal(vec2 p) {
    vec2 d = p - uPostFrame.xy;
    return vec2(dot(d,vec2(uPostFrame.w,-uPostFrame.z)), dot(d,uPostFrame.zw));
  }
  float postWeight(vec2 q) {
    return 1.0-smoothstep(0.78,1.35,length((q-vec2(7.,-3.))/vec2(${WIDTH}.0,${LENGTH}.0)));
  }
  vec3 pigmentAt(vec2 uv) { return texture2D(uPostalPigment,uv).rgb; }
  vec3 postEarth(float bristle) {
    return mix(vec3(.61,.395,.185),vec3(.90,.67,.34),bristle);
  }
`;

// A few sunny plots and two cooler banks instead of a field of independent
// grass marks. The bent bare-earth tongue opens towards the approaching car.
export const postalGroundGLSL = (paint: PostalPaint) => /* glsl */ `
  const int POST_COTTAGES = ${paint.uniforms.uPostFeet.value.length};
  uniform vec4 uPostFeet[POST_COTTAGES];
  vec3 postGround(vec2 q, vec2 verge, vec4 broad, float form, float understory) {
    vec2 sweep = rot2(q,-0.23);
    vec3 drag = pigmentAt(sweep / vec2(5.7,8.7) + broad.rg * 0.13);
    float coat = pigmentAt(sweep / vec2(13.,19.) - broad.gr * 0.12).b;
    float torn = (drag.g-.48)*1.7 + (coat-.5)*3.4;
    vec2 a = (q-vec2(-5.,-8.))/vec2(13.,17.);
    vec2 b = (q-vec2(23.,-15.))/vec2(8.,13.);
    vec2 c = (q-vec2(2.,24.))/vec2(7.,13.);
    float bank = min(length(a), min(length(b), length(c))) + torn*0.085 + (broad.g-.5)*.26;
    float sunny = smoothstep(.77,1.02,bank);
    vec3 sage = mix(vec3(.28,.30,.12),vec3(.42,.42,.16),smoothstep(.40,.53,coat + (drag.g-.5)*.32));
    float field = smoothstep(.36,.56,broad.r + (coat-.50)*.64 + form*.10);
    vec3 straw = mix(vec3(.54,.355,.105),vec3(.83,.535,.135),field);
    float bristle=smoothstep(.34,.51,drag.g+.37*(coat-.50));
    vec3 g = mix(sage,straw,sunny) * (.845 + .12*drag.b + .27*bristle);
    g = mix(g,vec3(.24,.32,.20),understory*.36);
    float shoulder = verge.x - uHalfRoad - verge.y*.80;
    vec3 soil = postEarth(.44 + .24*(drag.r-.5));
    g = mix(soil,g,smoothstep(-.16,.94,shoulder+torn*.23));
    vec2 start = vec2(2.45,-3.25), end = vec2(7.3,-7.2), span=end-start;
    float t = clamp(dot(q-start,span)/dot(span,span),0.,1.);
    vec2 track = start + span*t + vec2(-.27,.39)*sin(t*3.14159);
    float walk = length(q-track) - mix(1.38,2.05,t);
    float yard = length((q-vec2(3.2,-1.1))/vec2(1.8,4.65))-1.;
    float sill = length((q-vec2(.45,-3.60))/vec2(3.65,1.36))-1.;
    float worn = 1.-smoothstep(-.18,.32,min(walk,min(sill*1.36,yard*1.7))+torn*.24);
    vec3 clay = mix(vec3(.73,.37,.135),vec3(.96,.60,.27),.51+.29*drag.r);
    g = mix(g,clay,worn);
    // The cool contact stroke hugs each footprint even on the sloping lots.
    float foot=0.;
    for(int i=0;i<POST_COTTAGES;i++) {
      vec2 rim=abs(q-uPostFeet[i].xy)-uPostFeet[i].zw;
      float dist=length(max(rim,0.))+min(max(rim.x,rim.y),0.);
      foot=max(foot,1.-smoothstep(.04,.72,dist+(drag.b-.5)*.25));
    }
    return mix(g,g*vec3(.55,.66,.66),foot*.76);
  }
`;

export function cottageMaterial(shared: PaintShared, paint: PostalPaint) {
  return paintMaterial(new THREE.MeshLambertMaterial({ vertexColors:true, side:THREE.DoubleSide }),shared,{
    key:'postal-cottages', uniforms:paint.uniforms,
    vertexPars:'varying vec3 vFace;',
    vertexMain:'vFace = normal;',
    fragPars: postalGLSL + 'varying vec3 vFace;',
    fragColor: /* glsl */ `
      vec2 q=postLocal(vWorldPos.xz);
      // Plaster strokes run up the walls; on the pitched roof they run down
      // the slope. Project on the face, never on the screen.
      vec2 wall = vec2(abs(dot(vFace.xz,uPostFrame.zw))>.65 ? q.x : q.y,vWorldPos.y);
      vec2 page = abs(vFace.y)>.56 ? vec2(q.x,q.y+.12*q.x) : vec2(wall.y,wall.x+.19*wall.y);
      float broad = texture2D(uNoise,page/17.).g;
      vec3 mark = pigmentAt(page/vec2(5.7,2.8)+broad*.12);
      float second = pigmentAt(page/vec2(8.6,6.5)+vec2(.31,.57)).r;
      float stroke = mix(mark.r,mark.g,.49);
      float block = smoothstep(.38,.52,pigmentAt(rot2(page,-.22)/vec2(8.7,5.6)+broad*.15).g + (mark.r-.5)*.12);
      float load = (stroke-.47)*.15 + (block-.50)*.115 + (second-.48)*.07;
      // The broken, lighter end of a stroke carries a little warm pigment.
      diffuseColor.rgb = diffuseColor.rgb*(1.+load)
          + vec3(.026,.017,.009)*smoothstep(.65,.84,mark.r);
    `,
    // Painted bounce on the unlit gable; keep real cast shadows and the
    // difference between the facing and receding roof planes.
    fragLight: `float roofFill = abs(vFace.y)>.56 ? .49 : 1.;
      reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(.43,.39,.32) * roofFill;`,
  });
}
