import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Axis, Mech, MechNode, Pose, Vec3 } from './model';

export const AXIS_VEC: Record<Axis, Vector3> = {
  x: new Vector3(1, 0, 0),
  y: new Vector3(0, 1, 0),
  z: new Vector3(0, 0, 1),
};

const _q = new Quaternion();
const _qa = new Quaternion();

/** Local matrix of a node in a given pose (joint angles clamped to limits). */
export function localMatrix(node: MechNode, angle: number, out = new Matrix4()): Matrix4 {
  _q.set(node.quaternion[0], node.quaternion[1], node.quaternion[2], node.quaternion[3]);
  if (node.joint && angle !== 0) {
    _qa.setFromAxisAngle(AXIS_VEC[node.joint.axis], angle);
    _q.multiply(_qa);
  }
  return out.compose(new Vector3(...node.position), _q, ONE);
}
const ONE = new Vector3(1, 1, 1);

export function clampAngle(node: MechNode, a: number): number {
  if (!node.joint) return 0;
  return Math.min(node.joint.max, Math.max(node.joint.min, a));
}

/**
 * World matrices for every node. Nodes are stored parent-before-child, which the
 * builder guarantees, so a single pass suffices.
 */
export function worldMatrices(mech: Mech, pose: Pose = {}, root?: Matrix4): Map<string, Matrix4> {
  const out = new Map<string, Matrix4>();
  const tmp = new Matrix4();
  for (const n of mech.nodes) {
    const a = n.joint ? clampAngle(n, pose[n.name] ?? 0) : 0;
    localMatrix(n, a, tmp);
    const m = new Matrix4();
    if (n.parent) m.multiplyMatrices(out.get(n.parent)!, tmp);
    else if (root) m.multiplyMatrices(root, tmp);
    else m.copy(tmp);
    out.set(n.name, m);
  }
  // Pistons are aim-constrained; resolve them after the rigid pass.
  applyActuatorAim(mech, out);
  return out;
}

const _p1 = new Vector3();
const _p2 = new Vector3();

/**
 * Re-orients piston barrel/rod nodes so their +Z axes point at each other, keeping their
 * anchor positions. This is the same constraint an engine controller applies (see RIG_SPEC).
 */
export function applyActuatorAim(mech: Mech, world: Map<string, Matrix4>) {
  for (const act of mech.actuators) {
    const mb = world.get(act.baseNode)!;
    const me = world.get(act.endNode)!;
    _p1.setFromMatrixPosition(mb);
    _p2.setFromMatrixPosition(me);
    aimZ(mb, _p1, _p2);
    aimZ(me, _p2, _p1);
  }
}

const _up = new Vector3();
const _z = new Vector3();
const _x = new Vector3();
const _y = new Vector3();
function aimZ(m: Matrix4, from: Vector3, to: Vector3) {
  _z.subVectors(to, from);
  if (_z.lengthSq() < 1e-12) return;
  _z.normalize();
  // keep the existing local Y as an up hint so barrels don't roll
  _up.set(m.elements[4], m.elements[5], m.elements[6]).normalize();
  if (Math.abs(_up.dot(_z)) > 0.98) _up.set(m.elements[0], m.elements[1], m.elements[2]).normalize();
  _x.crossVectors(_up, _z).normalize();
  _y.crossVectors(_z, _x).normalize();
  m.makeBasis(_x, _y, _z);
  m.setPosition(from);
}

export function worldPos(world: Map<string, Matrix4>, node: string, offset: Vec3 = [0, 0, 0]): Vector3 {
  return new Vector3(...offset).applyMatrix4(world.get(node)!);
}

/** Parent/child index for fast subtree queries. */
export function subtreeOf(mech: Mech, name: string): Set<string> {
  const byName = new Map(mech.nodes.map((n) => [n.name, n]));
  const out = new Set<string>();
  const stack = [name];
  while (stack.length) {
    const n = stack.pop()!;
    out.add(n);
    for (const c of byName.get(n)!.children) stack.push(c);
  }
  return out;
}

/** Nearest ancestor (inclusive) that is a link/root, i.e. the rigid body a node moves with. */
export function rigidBodyOf(mech: Mech, name: string, byName = new Map(mech.nodes.map((n) => [n.name, n]))): string {
  let n = byName.get(name)!;
  while (n.parent && !(n.joint || n.role === 'root' || n.role === 'actuator')) n = byName.get(n.parent)!;
  return n.name;
}
