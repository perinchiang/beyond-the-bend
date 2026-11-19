import * as THREE from 'three';
import { paintMaterial, type PaintShared } from '../render/paint';
import { Builder, tube } from './flora';
import { birchTrunk } from './paintedFlora';
import type { PostalPaint } from './postalPaint';
import foliageUrl from '../art/postal-orchard.webp?inline';

const V = THREE.Vector3;
type Cut = 'drape' | 'shelf' | 'leader' | 'hedge';
const birchHabits = ['sweptBirch', 'openBirch', 'tallBirch'] as const;
type Habit = typeof birchHabits[number] | 'oak' | 'lime' | 'hedge';
type XYZ = readonly [number, number, number];
type Bough = readonly [Cut, centre: XYZ, radii: XYZ, pigment: number, reach: number, mirrored?: boolean];
const cells: Record<Cut, readonly [number, number]> = {
  drape: [0, .5], shelf: [.5, .5], leader: [.5, 0], hedge: [0, 0],
};

// The sockets follow the forks of the trunk. A birch opens below its leader;
// the oak reaches out in shelves, while the lime closes around its tall centre.
const crowns: Record<Habit, readonly Bough[]> = {
  sweptBirch: [
    ['drape', [-.56, 6.05, -1.68], [1.89, 1.64, 1.98], .86, .38],
    ['drape', [.21, 6.74, 1.54], [1.97, 1.77, 1.89], .91, .29, true],
    ['shelf', [.35, 7.91, .24], [2.66, 2.11, 2.41], 1.0, .39, true],
  ],
  openBirch: [
    ['drape', [-.65, 6.07, -1.62], [2.10, 1.63, 1.89], .84, .32],
    ['shelf', [.11, 6.66, 1.57], [1.93, 1.49, 2.03], .88, .39, true],
    ['drape', [.34, 7.77, .25], [2.50, 2.20, 2.31], .99, .13, true],
  ],
  tallBirch: [
    ['drape', [-.57, 5.96, -1.63], [1.72, 1.41, 1.77], .83, .34],
    ['shelf', [.18, 6.63, 1.61], [1.88, 1.48, 1.91], .90, .27],
    ['leader', [.35, 7.82, .28], [2.07, 2.43, 2.02], 1.0, .17],
  ],
  oak: [
    ['shelf', [-1.60, 5.08, -.47], [2.40, 1.38, 2.01], .80, .43, true],
    ['drape', [.82, 5.49, 1.44], [2.13, 1.72, 1.88], .86, .36],
    ['shelf', [.26, 6.64, .07], [3.20, 2.02, 2.64], .98, .20],
  ],
  lime: [
    ['drape', [-1.30, 5.20, -.48], [1.74, 1.71, 1.63], .84, .24, true],
    ['shelf', [.70, 5.30, 1.32], [1.98, 1.37, 1.76], .91, .26],
    ['leader', [.28, 6.47, .14], [2.69, 2.99, 2.48], 1.0, .12, true],
  ],
  hedge: [['hedge', [.03, .54, .03], [1.10, .65, .91], .76, .08]],
};

// Bow each painted cut around its branch tip. Its lean is a vector in tree
// space; the camera and the sun both see the corresponding projected outline.
const attributes = 'attribute float aSway; attribute vec3 aBud, aRadii, aStamp;';
const expand = /* glsl */ `
  if (aSway > .1) {
    mat3 basis = mat3(viewMatrix * modelMatrix * instanceMatrix);
    vec3 across = normalize(vec3(basis[0].x, basis[1].x, basis[2].x));
    vec3 up = normalize(vec3(basis[0].y, basis[1].y, basis[2].y));
    vec3 front = normalize(cross(across, up));
    bool hedge = vMapUv.x < .5 && vMapUv.y < .5;
    vec2 p = aStamp.xy;
    if (hedge) p.x += p.y * aStamp.z;
    float dome = (1. - p.x*p.x) * (1. - p.y*p.y);
    // A deep cap hides the ends of the twigs inside the crown at a grazing view.
    float bulge = hedge ? .34*dome : .80*sqrt(max(0., dome));
    transformed = aBud + across*p.x*length(across*aRadii) + up*p.y*length(up*aRadii)
      + front*bulge*length(front*aRadii);
    if (!hedge) transformed.xz += normal.xz * aStamp.z * p.y;
  }
`;

class BoughBuilder extends Builder {
  private uv: number[] = [];
  private bud: number[] = [];
  private radii: number[] = [];
  private stamp: number[] = [];
  private bounds = new THREE.Box3();

  override vert(p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color, sway=0) {
    this.uv.push(.25, .75); // opaque texel for the wood in the shadow pass
    this.bud.push(0, 0, 0); this.radii.push(0, 0, 0); this.stamp.push(0, 0, 0);
    this.bounds.expandByPoint(p);
    return super.vert(p, n, c, sway);
  }

  spray([cut, xyz, radii, pigment, reach, mirrored]: Bough, core: THREE.Vector3) {
    const [u0, v0] = cells[cut], base = this.pos.length / 3;
    const col = new THREE.Color(pigment, pigment, pigment);
    const centre = new V(...xyz);
    const outward = cut === 'hedge' ? new V(0, 1, 0)
      : centre.clone().sub(core).add(new V(0, .47, 0)).normalize();
    const extent = Math.max(...radii)*1.45 + reach;
    this.bounds.expandByPoint(centre.clone().addScalar(extent));
    this.bounds.expandByPoint(centre.clone().addScalar(-extent));
    for (let j=0; j<=3; j++) for (let i=0; i<=3; i++) {
      const u=i/3, v=j/3;
      super.vert(centre, outward, col, .46);
      this.bud.push(...xyz); this.radii.push(...radii); this.stamp.push(2*u-1, 2*v-1, reach);
      this.uv.push(u0+.006+.488*(mirrored ? 1-u : u), v0+.006+.488*v);
    }
    for (let j=0; j<3; j++) for (let i=0; i<3; i++) {
      const k = base+4*j+i;
      this.tri(k, k+1, k+4); this.tri(k+1, k+5, k+4);
    }
  }

  override build() {
    const g=super.build();
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aBud', new THREE.Float32BufferAttribute(this.bud, 3));
    g.setAttribute('aRadii', new THREE.Float32BufferAttribute(this.radii, 3));
    g.setAttribute('aStamp', new THREE.Float32BufferAttribute(this.stamp, 3));
    g.boundingBox = this.bounds; g.boundingSphere = this.bounds.getBoundingSphere(new THREE.Sphere());
    return g;
  }
}

function tree(habit: Habit) {
  const b = new BoughBuilder();
  const broad = habit==='oak' || habit==='lime';
  if (broad) {
    const bark = new THREE.Color('#b2a184'), foot = new THREE.Color('#827b68');
    const limb=(points:number[][])=>tube(b,points.map(([x,y,z,r])=>({p:new V(x,y,z),r,c:y<1?foot:bark})),9);
    limb([[0,-.27,0,.36],[-.16,1,0,.28],[.05,3.2,.12,.21],[.30,4.5,.32,.12],[.65,5.5,.49,.045]]);
    limb([[.05,2.75,.10,.16],[-.75,4.12,-.37,.11],[-1.43,4.9,-.43,.045]]);
    limb([[.13,3.23,.15,.14],[.28,4.12,1.06,.085],[.30,4.9,1.6,.032]]);
  }
  const core = new V(.12, broad ? 5.40 : 6.52, .16);
  for (const bough of crowns[habit]) b.spray(bough, core);
  const g = b.build();
  g.name = 'Postal orchard: ' + habit;
  return g;
}

// The scan supplies the torn edge and thickness of a brushstroke, not the
// direction of the sun. Combine a rounded face with the bough's outward normal;
// the bright plane then stays on the sunny side even when the driver turns.
const leafPaint = /* glsl */ `
  bool hedge = vMapUv.x < .5 && vMapUv.y < .5;
  if (vLeaf < .1) {
    diffuseColor.rgb = vColor.rgb;
  } else if (hedge) {
    diffuseColor.rgb = mix(diffuseColor.rgb*vec3(.74,.83,.78), vec3(.09,.16,.096), .28);
  } else {
    float dry = smoothstep(.32, .64, texture2D(uCrownGrain, vStroke).g);
    float pigment = mix(sampledDiffuseColor.r, dry, .19);
    vec2 p = vDisk*vec2(1.02,.92);
    vec3 face = vec3(p, sqrt(max(.065, 1.-dot(p,p))));
    vec3 boughNormal = normalize(face + normalize(vNormal)*.60);
    float sunlight = 0.;
    #if NUM_DIR_LIGHTS > 0
      sunlight = dot(boughNormal, directionalLights[0].direction);
    #endif
    float sky = dot(boughNormal, viewMatrix[1].xyz);
    float mark = .22 + .48*pigment + .31*sunlight + .22*sky;
    float edge = max(.05, fwidth(mark));
    vec3 ink = mix(vec3(.094,.149,.106), vec3(.240,.299,.141),
                   smoothstep(.29-edge,.29+edge,mark));
    ink = mix(ink, vec3(.50,.49,.177), smoothstep(.62-edge,.62+edge,mark));
    ink = mix(ink, vec3(.78,.64,.221), smoothstep(.86-edge,.86+edge,mark));
    diffuseColor.rgb = vColor.rgb * ink * (.84+.26*pigment) * (.95+.095*dry);
  }
`;

export function postalOrchard(shared: PaintShared, sway: string, postal: PostalPaint) {
  const map = new THREE.TextureLoader().load(foliageUrl);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 2;
  const surface = { map, side:THREE.DoubleSide, alphaTest:.43 };
  const varyings = 'varying float vLeaf; varying vec2 vDisk, vStroke;';
  const material = paintMaterial(new THREE.MeshLambertMaterial({...surface, vertexColors:true, alphaToCoverage:true}), shared, {
    key:'postal-orchard', volumeNormals:true, lensFade:true,
    uniforms: { uCrownGrain: postal.uniforms.uPostalPigment },
    vertexPars:attributes+varyings, vertexMain:`
      vLeaf=aSway; vDisk=aStamp.xy;
      ${expand}
      vStroke = vec2(dot(transformed.xz,vec2(.80,.41))+.29*transformed.y,
                     transformed.y-.41*transformed.z)/4.9 + instanceMatrix[3].xz*.072;
      ${sway}`,
    fragPars:varyings+'uniform sampler2D uCrownGrain;', fragColor:leafPaint,
    fragLight:`if (vLeaf>.1 && !hedge) {
      reflectedLight.directDiffuse *= .20;
      reflectedLight.indirectDiffuse = reflectedLight.indirectDiffuse*.28 + diffuseColor.rgb*.78;
    } else if (vLeaf>.1) {
      reflectedLight.directDiffuse *= .28;
      reflectedLight.indirectDiffuse += diffuseColor.rgb*vec3(.54,.53,.49);
    } else { reflectedLight.indirectDiffuse += diffuseColor.rgb*.21; }`,
  });
  const depth = new THREE.MeshDepthMaterial({...surface, depthPacking:THREE.RGBADepthPacking});
  depth.onBeforeCompile = shader => {
    shader.uniforms.uTime = shared.uTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;\n'+attributes)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n'+expand+sway);
  };
  depth.customProgramCacheKey = ()=>'postal-orchard-depth';
  const birches = birchHabits.map(tree);
  function birchAt(x: number, z: number) {
    const bay = Math.floor(postal.alongRoad(x,z)/9.5);
    return birches[THREE.MathUtils.euclideanModulo(bay, birches.length)];
  }
  // End the leader inside the paint, below the notch in the cut silhouette.
  return { material, depth, birchAt, trunk:birchTrunk(8.48), oak:tree('oak'), lime:tree('lime'), hedge:tree('hedge') };
}
