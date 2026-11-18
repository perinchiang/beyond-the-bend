import * as THREE from 'three';
import { paintMaterial, type PaintShared } from '../render/paint';
import { Builder, tube } from './flora';
import boughsUrl from '../art/postal-boughs.webp?inline';

const V = THREE.Vector3;
type Habit = 'birch' | 'broad' | 'hedge';
type Brush = 'wide' | 'slim' | 'hedge';
const cell: Record<Brush, readonly [number, number]> = { wide:[0,.5], slim:[.5,.5], hedge:[0,0] };

// Each stamp is a section of an ellipsoid, rooted at a real branch tip. Its
// projected size comes from its three radii. Using the same expansion in the
// shadow camera gives the sun its own silhouette instead of shadowing a card
// that's turned edge-on. All three boughs retain parallax on the return drive.
const stampAttributes = 'attribute float aSway; attribute vec3 aBud, aRadii; attribute vec2 aStamp;';
const expandStamp = /* glsl */ `
  if (aSway > .1) {
    mat3 basis = mat3(viewMatrix * modelMatrix * instanceMatrix);
    vec3 across = normalize(vec3(basis[0].x,basis[1].x,basis[2].x));
    vec3 up = normalize(vec3(basis[0].y,basis[1].y,basis[2].y));
    vec3 front = normalize(cross(across,up));
    float bulge = .34*(1.-aStamp.x*aStamp.x)*(1.-aStamp.y*aStamp.y);
    transformed = aBud + across*aStamp.x*length(across*aRadii)
      + up*aStamp.y*length(up*aRadii) + front*bulge*length(front*aRadii);
  }
`;

class BoughBuilder extends Builder {
  private uv: number[] = [];
  private bud: number[] = [];
  private radii: number[] = [];
  private stamp: number[] = [];
  private bounds = new THREE.Box3();

  override vert(p: THREE.Vector3,n: THREE.Vector3,c: THREE.Color,sway=0) {
    this.uv.push(.75,.25); // solid wood uses the white atlas cell
    this.bud.push(0,0,0); this.radii.push(0,0,0); this.stamp.push(0,0);
    this.bounds.expandByPoint(p);
    return super.vert(p,n,c,sway);
  }
  spray(brush:Brush, x:number,y:number,z:number, rx:number,ry:number,rz:number, strength:number, tilt=0) {
    const [u0,v0]=cell[brush], base=this.pos.length/3;
    const col=new THREE.Color(strength,strength,strength);
    const centre=new V(x,y,z);
    const extent=Math.max(rx,ry,rz)*1.45;
    this.bounds.expandByPoint(centre.clone().addScalar(extent));
    this.bounds.expandByPoint(centre.clone().addScalar(-extent));
    for(let j=0;j<=3;j++) for(let i=0;i<=3;i++) {
      const u=i/3,v=j/3, h=2*v-1;
      super.vert(centre,new V(0,1,0),col,.46);
      this.bud.push(x,y,z); this.radii.push(rx,ry,rz); this.stamp.push(2*u-1+tilt*h,h);
      this.uv.push(u0+.006+.488*u,v0+.006+.488*v);
    }
    for(let j=0;j<3;j++) for(let i=0;i<3;i++) {
      const k=base+4*j+i;
      this.tri(k,k+1,k+4); this.tri(k+1,k+5,k+4);
    }
  }
  override build() {
    const g=super.build();
    g.setAttribute('uv',new THREE.Float32BufferAttribute(this.uv,2));
    g.setAttribute('aBud',new THREE.Float32BufferAttribute(this.bud,3));
    g.setAttribute('aRadii',new THREE.Float32BufferAttribute(this.radii,3));
    g.setAttribute('aStamp',new THREE.Float32BufferAttribute(this.stamp,2));
    g.boundingBox=this.bounds; g.boundingSphere=this.bounds.getBoundingSphere(new THREE.Sphere());
    return g;
  }
}

function tree(habit: Habit, round=false) {
  const b = new BoughBuilder();
  if(habit==='birch') {
    b.spray('wide',-.53,6.18,-1.59,1.76,1.51,1.73,.61,-.19);
    b.spray('wide',.19,6.70,1.45,1.74,1.60,1.72,.78,.09);
    if (round) b.spray('wide',.19,7.80,.39,2.58,2.51,2.37,.90,-.14);
    else b.spray('slim',.29,7.90,.33,2.33,2.60,2.29,.96,.07);
  } else if(habit==='broad') {
    const bark=new THREE.Color('#b2a184'), foot=new THREE.Color('#827b68');
    const limb=(points:number[][])=>tube(b,points.map(([x,y,z,r])=>({p:new V(x,y,z),r,c:y<1?foot:bark})),9);
    limb([[0,-.27,0,.36],[-.16,1,0,.28],[.05,3.2,.12,.21],[.30,4.5,.32,.12],[.65,5.5,.49,.045]]);
    limb([[.05,2.75,.10,.16],[-.75,4.12,-.37,.11],[-1.43,4.9,-.43,.045]]);
    limb([[.13,3.23,.15,.14],[.28,4.12,1.06,.085],[.30,4.9,1.6,.032]]);
    b.spray('wide',-1.35,5.01,-.55,2.12,1.69,2,.61,-.09);
    b.spray('hedge',.85,5.45,1.49,2.21,1.42,2.03,.73,.09);
    b.spray('wide',.19,6.48,.16,3.13,2.84,2.89,.97);
  } else {
    b.spray('hedge',.03,.54,.03,1.10,.65,.91,.76,.08);
  }
  return b.build();
}

export function postalOrchard(shared: PaintShared,sway: string) {
  const map = new THREE.TextureLoader().load(boughsUrl);
  map.colorSpace=THREE.SRGBColorSpace;
  map.anisotropy=2;
  const surface={ map,side:THREE.DoubleSide,alphaTest:.43 };
  const material=paintMaterial(new THREE.MeshLambertMaterial({...surface,vertexColors:true,alphaToCoverage:true}),shared,{
    key:'postal-orchard',volumeNormals:true,lensFade:true,
    vertexPars:stampAttributes+'varying float vLeaf;',
    vertexMain:`vLeaf=aSway; ${expandStamp} ${sway}`,fragPars:'varying float vLeaf;',
    fragColor:`if(vMapUv.y<.50 && vMapUv.x<.50) {
      diffuseColor.rgb = mix(diffuseColor.rgb*vec3(.74,.83,.78),vec3(.09,.16,.096),.28);
    }`,
    fragLight:`if(vLeaf>.1) {
      reflectedLight.directDiffuse *= .28;
      reflectedLight.indirectDiffuse += diffuseColor.rgb*vec3(.54,.53,.49);
    } else { reflectedLight.indirectDiffuse += diffuseColor.rgb*.21; }`,
  });
  const depth = new THREE.MeshDepthMaterial({...surface,depthPacking:THREE.RGBADepthPacking});
  depth.onBeforeCompile = shader => {
    shader.uniforms.uTime=shared.uTime;
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform float uTime;\n'+stampAttributes)
      .replace('#include <begin_vertex>','#include <begin_vertex>\n'+expandStamp+sway);
  };
  depth.customProgramCacheKey=()=>'postal-orchard-depth';
  return {material,depth,birch:tree('birch'),roundBirch:tree('birch',true),broad:tree('broad'),hedge:tree('hedge')};
}
