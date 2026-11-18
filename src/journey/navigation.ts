import * as THREE from 'three';
import type { Track } from '../world/track';
import type { HeightField } from '../world/heightfield';

interface Node {
  x: number;
  z: number;
  links: number[];
}
export function roadGuide(track: Track, hf: HeightField) {
  const nodes: Node[] = [];
  const count = Math.ceil(track.length / 3);
  const index = (s: number) => Math.round((s / track.length) * count) % count;
  function join(a: number, b: number) {
    nodes[a].links.push(b);
    nodes[b].links.push(a);
  }
  for (let i = 0; i < count; i++) nodes.push({ ...track.at((i * track.length) / count), links: [] });
  for (let i = 0; i < count; i++) join(i, (i + 1) % count);
  let cedarStart = -1;
  for (const lane of [track.lane, track.cedar]) {
    if (!lane) continue;
    if (lane === track.cedar) cedarStart = nodes.length;
    let prev = index(lane.from);
    for (let i = 6; i < lane.points.length - 4; i += 6) {
      const p = lane.points[i];
      const id = nodes.push({ x: p.x, z: p.z, links: [] }) - 1;
      join(prev, id);
      prev = id;
    }
    join(prev, index(lane.to));
  }
  const next = new Int32Array(nodes.length);
  const distance = (a: Node, b: Node) => Math.hypot(a.x - b.x, a.z - b.z);
  function solve(end: number) {
    const dist = nodes.map(() => Infinity);
    next.fill(-1);
    dist[end] = 0;
    const queue = [end];
    while (queue.length) {
      const a = queue.pop()!;
      for (const b of nodes[a].links) {
        const d = dist[a] + distance(nodes[a], nodes[b]);
        if (d < dist[b]) {
          dist[b] = d;
          next[b] = a;
          queue.push(b);
        }
      }
    }
  }
  const shape = new THREE.Shape();
  shape.moveTo(-0.43, -0.34);
  shape.lineTo(0, 0.24);
  shape.lineTo(0.43, -0.34);
  shape.lineTo(0.43, -0.08);
  shape.lineTo(0, 0.52);
  shape.lineTo(-0.43, -0.08);
  shape.closePath();
  const mesh = new THREE.InstancedMesh(
    new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.74,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    10,
  );
  mesh.name = 'road-guide';
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.count = 0;
  const pose = new THREE.Object3D(),
    color = new THREE.Color();
  let goal = -1,
    last = -Infinity;
  function update(now: number, x: number, z: number, speed: number, target?: number) {
    if (target === undefined) {
      mesh.count = 0;
      last = -Infinity;
      return;
    }
    const end =
      target >= track.length && track.cedar && cedarStart >= 0
        ? THREE.MathUtils.clamp(
            cedarStart +
              Math.round(
                (((target - track.length) / track.cedar.length) * (track.cedar.points.length - 1)) / 6,
              ) -
              1,
            cedarStart,
            nodes.length - 1,
          )
        : index(target);
    if (end !== goal) {
      solve(end);
      goal = end;
    } else if (now - last < 95) return;
    last = now;
    let a = 0,
      nearest = Infinity;
    nodes.forEach((p, i) => {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < nearest) {
        nearest = d;
        a = i;
      }
    });
    mesh.count = 0;
    const limit = distance(nodes[a], nodes[end]) < 35 ? 4 : 10;
    for (let i = 0; i < limit && next[a] >= 0; i++) {
      const b = next[a],
        c = next[b];
      const p = nodes[a],
        q = nodes[b],
        r = nodes[c] ?? q;
      const yaw = Math.atan2(q.x - p.x, q.z - p.z);
      const delta = Math.atan2(r.x - q.x, r.z - q.z) - yaw;
      const demand = c < 0 ? 0 : (speed * speed * Math.abs(Math.sin(delta))) / Math.max(1, distance(p, q));
      if (demand > 7 || i % 2 === 0) {
        pose.position.set(q.x, hf.surface(q.x, q.z) + 0.11, q.z);
        pose.rotation.y = yaw;
        pose.updateMatrix();
        mesh.setMatrixAt(mesh.count, pose.matrix);
        mesh.setColorAt(mesh.count++, color.set(demand > 14 ? '#d65e45' : demand > 7 ? '#e7b859' : '#68b5c8'));
      }
      a = b;
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  return { mesh, update };
}
