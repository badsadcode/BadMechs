import { createHash } from 'node:crypto';
import type { Mech } from '../src/core/model';

/** Fingerprint of a mech's SKELETON (not its skin): names, parents, pivots, joint axes + limits. */
export function rigPrint(m: Mech): string {
  const r = (x: number) => Math.round(x * 1000) / 1000;
  const s = m.nodes
    .filter((n) => n.joint || n.role === 'root' || n.role === 'link')
    .map((n) => [n.name, n.parent, n.position.map(r), n.quaternion.map(r), n.joint ? [n.joint.axis, r(n.joint.min), r(n.joint.max)] : null]);
  return createHash('sha1').update(JSON.stringify(s)).digest('hex');
}
