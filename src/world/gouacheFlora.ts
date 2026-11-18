import * as THREE from 'three';
import { Rng } from '../core/rng';
import { smoothstep } from '../core/noise';
import { paintMaterial, type PaintShared } from '../render/paint';
import { Builder, makeConifer, paintedShrub, tube, woodlandBrushes } from './flora';

const V = THREE.Vector3;
const TAU = Math.PI * 2;
type Kind = 'oak' | 'lime' | 'plum' | 'birch';
const profiles = {
  oak: { y: 5.77, size: [4.08, 2.66, 3.48], inks: ['#537776','#8da875','#c5cb8d'] },
  lime: { y: 6.09, size: [3.05, 3.36, 2.82], inks: ['#5d8176','#a8ba7e','#dbd798'] },
  plum: { y: 5.12, size: [3.38, 2.48, 2.80], inks: ['#916976','#c48375','#e6b393'] },
  birch: { y: 7.20, size: [2.28, 2.85, 2.66], inks: ['#749185','#aabf87','#e1dca3'] },
};

// Opaque leaf prints made with a short round brush, with the flatter heel of
// the brush under the curled tip. The atlas retains the original bark cell.
function leafAtlas() {
  const atlas = woodlandBrushes();
  const g = (atlas.image as HTMLCanvasElement).getContext('2d')!;
  const press = (x: number, y: number, w: number, h: number, angle: number, gray: number) => {
    g.save();
    g.translate(x, y);
    g.rotate(angle);
    g.scale(w, h);
    g.fillStyle = `rgb(${gray},${gray},${gray})`;
    g.beginPath();
    g.moveTo(-0.96, 0.13);
    g.bezierCurveTo(-1.02,-0.50, -0.40,-0.95, 0.09,-0.87);
    g.bezierCurveTo(0.54,-0.84, 0.94,-0.39, 1,0.09);
    g.bezierCurveTo(0.61,0.64, 0.24,0.92, -0.26,0.85);
    g.bezierCurveTo(-0.68,0.90, -0.90,0.67, -0.96,0.13);
    g.fill();
    g.restore();
  };
  for (const cell of [1,2,3]) {
    const ox = 128 * (cell % 2), oy = cell === 1 ? 128 : 0;
    g.clearRect(ox, oy, 128, 128);
    g.save();
    g.translate(ox+64, oy+64);
    if (cell === 1) {
      // The three overlapping bellies fuse into one scalloped edge.
      press(-19, 7, 33, 23, -0.12, 235);
      press(6, -4, 39, 29, -0.36, 247);
      press(28,-13,24,18,-0.54,255);
      press(39,15,9,5,-0.31,249);
    } else if (cell === 2) {
      press(-7, 0, 50, 12, 0.01, 228);
      for (let j=0;j<5;j++) {
        const x = -35 + 17*j, reach = 23 - j*2.2;
        press(x, -8, reach, 8.5, -0.61, 246);
        press(x+6, 9, reach*0.84, 7.2, 0.42, 239);
      }
    } else {
      press(-6,0,45,3,-0.04,220);
      for (const [x,y,w,h,a] of [[-28,-7,15,8,-0.55],[-16,8,17,9,0.52],[-4,-7,17,9,-0.41],[11,7,17,8,0.48],[25,-5,15,9,-0.42],[39,0,10,6,0.02]]) {
        press(x,y,w,h,a,249);
      }
    }
    g.restore();
  }
  return atlas;
}

class Crown extends Builder {
  private uv: number[] = [];
  override vert(p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color, sway = 0) {
    // The white gutter is reserved for the solid wood geometry.
    this.uv.push(0.012,0.012);
    return super.vert(p,n,c,sway);
  }
  dab(p: THREE.Vector3, across: THREE.Vector3, up: THREE.Vector3, n: THREE.Vector3, pigment: THREE.Color) {
    const first = this.pos.length / 3;
    for (const [x,y] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
      super.vert(p.clone().addScaledVector(across,x).addScaledVector(up,y), n, pigment, 0.36);
      this.uv.push(0.75+x*0.24, 0.25+y*0.24);
    }
    this.tri(first, first+1, first+2);
    this.tri(first, first+2, first+3);
  }
  override build() {
    const geo = super.build();
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv,2));
    return geo;
  }
}

function bole(b: Crown, kind: Kind) {
  const bark = new THREE.Color(kind === 'plum' ? '#977b77' : '#9b8975');
  const side = new THREE.Color('#7d7269');
  const limb = (path: number[][]) => tube(b, path.map(([x,y,z,r]) =>
    ({p:new V(x,y,z),r,c:bark.clone().lerp(side, 0.4*(1-smoothstep(0,2,y)))})), 11);
  limb([[0,-0.2,0,0.42],[-0.05,0.45,0.02,0.33],[0.03,2.0,0.07,0.25],
    [0.23,3.43,0.23,0.19],[0.13,4.73,0.43,0.12],[-0.10,5.81,0.44,0.04]]);
  limb([[0.18,3.20,0.2,0.14],[-0.54,3.82,-0.09,0.1],[-1.31,4.60,-0.25,0.045]]);
}

function tree(seed: number, kind: Kind, lowSpec: boolean) {
  const rng = new Rng(seed), b = new Crown(), profile = profiles[kind];
  const [shadow, mid, light] = profile.inks.map(hex => new THREE.Color(hex));
  const [rx, ry, rz] = profile.size;
  const slender = kind === 'birch';
  if (!slender) bole(b,kind);

  // Pads hang on fans of twigs. Overlapping their upper ends unifies the
  // crown; progressively separated lower fans leave true windows of air.
  const cloud = (anchor: THREE.Vector3, size: THREE.Vector3, count: number, stroke: number) => {
    const phase = rng.range(0,TAU);
    for (let i=0;i<count;i++) {
      const h = 1 - 2*(i+0.5)/count;
      const a = phase + i*2.399963 + rng.range(-0.12,0.12);
      const ring = Math.sqrt(1-h*h);
      const facing = new V(ring*Math.cos(a),h,ring*Math.sin(a));
      const stretch = 0.83 + 0.12*Math.cos(3*a+h+phase) + rng.range(-0.12,0.13);
      const p = facing.clone().multiply(size).multiplyScalar(stretch).add(anchor);
      const leafN = new V((p.x-0.2)/rx, (p.y-profile.y)/ry, p.z/rz).normalize();
      const swing = 0.53 + leafN.y*0.33 + leafN.x*0.10 - leafN.z*0.13;
      const shade = shadow.clone().lerp(mid,smoothstep(0.19,0.57,swing));
      shade.lerp(light,smoothstep(0.51,0.88,swing) * 0.86);
      shade.multiplyScalar(rng.range(0.92,1.065));
      const tangent = new V(-Math.sin(a),0,Math.cos(a));
      tangent.applyAxisAngle(facing, rng.range(-0.51,0.48));
      const up = facing.clone().cross(tangent);
      const half = stroke*rng.range(0.67,1.12);
      b.dab(p, tangent.multiplyScalar(half), up.multiplyScalar(half*rng.range(0.72,1.05)), leafN, shade);
    }
  };
  const centre = new V(0.12,profile.y,0.16);
  const quality = lowSpec ? 0.78 : 1;
  // The taller birch carries two airy sprays around its existing white fork.
  if (slender) {
    cloud(new V(0.34,8.28,0.22),new V(1.85,2.35,1.74),Math.round(112*quality),0.69);
    cloud(new V(-0.49,5.74,-1.98),new V(1.15,1.36,1.46),Math.round(54*quality),0.57);
    cloud(new V(0.16,6.76,2.04),new V(1.38,1.57,1.24),Math.round(61*quality),0.63);
  } else {
    cloud(centre.clone().add(new V(0.27,ry*0.26,0.05)),new V(rx*0.77,ry*0.84,rz*0.73),Math.round(155*quality),0.94);
    const fans = 8;
    for (let i=0;i<fans;i++) {
      const a = seed + TAU*i/fans + rng.range(-0.19,0.19);
      const reach = rng.range(0.49,0.85);
      const anchor = centre.clone().add(new V(rx*reach*Math.cos(a), ry*rng.range(-0.48,0.31), rz*reach*Math.sin(a)));
      cloud(anchor,new V(rx*rng.range(0.36,0.50), ry*rng.range(0.37,0.54), rz*rng.range(0.35,0.51)),
        Math.round(37*quality),rng.range(0.70,0.87));
    }
  }
  return b.build();
}

export function createGouachePlants(lowSpec: boolean) {
  return {
    oak: [tree(11,'oak',lowSpec),tree(12,'oak',lowSpec)],
    lime: [tree(21,'lime',lowSpec),tree(22,'lime',lowSpec)],
    plum: [tree(31,'plum',lowSpec)],
    fir: [makeConifer(41),makeConifer(42)], birch: [tree(53,'birch',lowSpec)],
    bush: [paintedShrub(61,false,lowSpec),paintedShrub(62,false,lowSpec)],
    bloom: [paintedShrub(71,true,lowSpec)],
  };
}

export function gouacheFoliageMaterial(shared: PaintShared, swayVertex: string) {
  return paintMaterial(new THREE.MeshLambertMaterial({
    map: leafAtlas(), vertexColors:true, side:THREE.DoubleSide, alphaTest:0.40, alphaToCoverage:true,
  }),shared,{
    key:'gouache-foliage', volumeNormals:true, lensFade:true,
    vertexPars:'attribute float aSway; varying vec3 vSheet; varying float vLeaves;',
    vertexMain:`vSheet = position; vLeaves = aSway; ${swayVertex}`,
    fragPars:'varying vec3 vSheet; varying float vLeaves;',
    fragColor:`
      vec2 page = vec2(vSheet.x + 0.37*vSheet.z, vSheet.y + 0.61*vSheet.z);
      vec4 tooth = texture2D(uNoise, page*0.22);
      float foliage = smoothstep(0.0,0.20,vLeaves);
      // Two broad, slightly irregular coats meet along a soft, opaque ridge.
      float overlap = smoothstep(0.50,0.64,tooth.r + 0.12*(tooth.g-0.5));
      diffuseColor.rgb *= mix(vec3(0.94,0.97,1.02),vec3(1.065,1.035,0.98),overlap);
      vec4 grain = texture2D(uNoise, page*vec2(0.91,0.62));
      float nick = smoothstep(0.65,0.74,grain.r) * (1.0-foliage);
      diffuseColor.rgb *= 1.0 - 0.29*nick;
      diffuseColor.rgb += vec3(0.022,0.019,0.021)*foliage;
    `,
    fragLight:`
      reflectedLight.directDiffuse *= 0.78;
      reflectedLight.indirectDiffuse += diffuseColor.rgb*0.22;
    `,
  });
}
