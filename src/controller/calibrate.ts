import { Object3D } from 'three';
import type { Mech } from '../core/model';
import { rigSidecar } from '../export/rig';
import { RigWalker } from './walker';

/** Bare transform tree (no meshes) from the mech: enough for the controller to run. */
export function skeletonTree(mech: Mech): Object3D {
  const top = new Object3D();
  const objs = new Map<string, Object3D>();
  for (const n of mech.nodes) {
    const o = new Object3D();
    o.name = n.name;
    o.position.set(...n.position);
    o.quaternion.set(...n.quaternion);
    objs.set(n.name, o);
    (n.parent ? objs.get(n.parent)! : top).add(o);
  }
  top.updateMatrixWorld(true);
  return top;
}

export interface GaitVerification {
  maxFootErrorM: number;
  meanFootErrorM: number;
  strideScaled: number;
}

/** Walk the mech's own rig for a few cycles; returns foot tracking error. */
export function simulateGait(mech: Mech, cycles = 2.5, fps = 30): { max: number; mean: number } {
  const rig = JSON.parse(JSON.stringify(rigSidecar(mech)));
  const w = new RigWalker(skeletonTree(mech), rig);
  const frames = Math.ceil(rig.gait.cycleSeconds * cycles * fps);
  let max = 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < frames; i++) {
    w.update(1 / fps);
    if (i < fps * rig.gait.cycleSeconds * 0.6) continue; // let the first steps settle
    for (const e of w.footErrors()) {
      max = Math.max(max, e);
      sum += e;
      n++;
    }
  }
  return { max, mean: n ? sum / n : 0 };
}

/**
 * Shrink the gait hint (stride/step height) until the reference controller can actually track
 * it. Result is stored on mech.gait.verified so exported gait hints are known-achievable.
 */
export function calibrateGait(mech: Mech): GaitVerification {
  const g = mech.gait;
  if (g.verified) return g.verified;
  const tol = Math.max(0.03, mech.stats.height * 0.004);
  let scale = 1;
  let r = simulateGait(mech);
  for (let i = 0; i < 6 && r.max > tol; i++) {
    g.strideLength *= 0.85;
    g.stepHeight *= 0.9;
    scale *= 0.85;
    r = simulateGait(mech);
  }
  g.verified = { maxFootErrorM: Math.round(r.max * 1000) / 1000, meanFootErrorM: Math.round(r.mean * 10000) / 10000, strideScaled: Math.round(scale * 1000) / 1000 };
  return g.verified;
}
