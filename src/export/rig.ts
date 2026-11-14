/**
 * badmech.rig.json – the machine-readable contract between BadMech and engine-side controllers.
 * Every format we export loses something; this sidecar never does. Spec: docs/RIG_SPEC.md
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import { round } from '../core/builder';
import { worldMatrices } from '../core/kinematics';
import type { Mech, Vec3 } from '../core/model';
import type { MechRecipe } from '../core/recipe';
import { rigidBodies } from '../core/validate';

export const RIG_SCHEMA = 'badmech-rig/1';

export interface CollisionBox {
  body: string;
  center: Vec3;
  rotation: [number, number, number, number];
  halfExtents: Vec3;
}

export function collisionBoxes(mech: Mech, maxPerBody = 4): CollisionBox[] {
  const out: CollisionBox[] = [];
  for (const b of rigidBodies(mech).values()) {
    const shapes = [...b.shapes].sort((x, y) => y.volume - x.volume).slice(0, maxPerBody);
    for (const s of shapes) {
      const p = new Vector3();
      const q = new Quaternion();
      s.local.decompose(p, q, new Vector3());
      out.push({ body: b.name, center: v3(p), rotation: [round(q.x, 5), round(q.y, 5), round(q.z, 5), round(q.w, 5)], halfExtents: v3(s.half) });
    }
  }
  return out;
}

function v3(v: Vector3): Vec3 {
  return [round(v.x, 4), round(v.y, 4), round(v.z, 4)];
}

export function rigSidecar(mech: Mech, recipe?: MechRecipe, extra: Record<string, unknown> = {}) {
  const rest = worldMatrices(mech, {});
  const nodes = mech.nodes.map((n) => {
    const w = rest.get(n.name)!;
    const wp = new Vector3().setFromMatrixPosition(w);
    return {
      name: n.name,
      parent: n.parent,
      role: n.role,
      system: n.system,
      component: n.component ?? null,
      restTranslation: n.position.map((x) => round(x, 5)),
      restRotation: n.quaternion.map((x) => round(x, 6)),
      restWorldPosition: v3(wp),
      tags: n.tags,
    };
  });
  const joints = mech.nodes
    .filter((n) => n.joint)
    .map((n) => {
      const j = n.joint!;
      const axisVec = j.axis === 'x' ? [1, 0, 0] : j.axis === 'y' ? [0, 1, 0] : [0, 0, 1];
      const w = rest.get(n.name)!;
      const worldAxis = new Vector3(...(axisVec as Vec3)).transformDirection(w);
      return {
        name: n.name,
        type: 'revolute',
        axis: j.axis,
        axisVector: axisVec,
        restWorldAxis: v3(worldAxis),
        min: round(j.min, 5),
        max: round(j.max, 5),
        minDeg: round((j.min * 180) / Math.PI, 2),
        maxDeg: round((j.max * 180) / Math.PI, 2),
        continuous: n.tags.includes('continuous'),
        purpose: j.purpose,
        kind: j.kind,
        maxSpeed: j.maxSpeed,
        system: n.system,
      };
    });
  const bodyNode = mech.nodes.find((n) => n.tags.includes('body'))!;
  return {
    schema: RIG_SCHEMA,
    generator: 'BadMech',
    name: mech.name,
    family: mech.family,
    maker: mech.maker,
    coordinateSystem: {
      units: 'metres',
      up: '+Y',
      forward: '+Z',
      right: '-X',
      handedness: 'right',
      note: 'glTF convention. Mech faces +Z; its left side is +X.',
    },
    rotationConvention: 'local = restRotation * axisAngle(axisVector, angle); angle 0 = rest pose; limits in radians relative to rest',
    rootNode: mech.nodes[0].name,
    bodyNode: bodyNode.name,
    stats: mech.stats,
    nodes,
    joints,
    legs: mech.legs,
    arms: mech.arms,
    actuators: mech.actuators.map((a) => ({
      ...a,
      constraint: 'mutual-aim',
      aimAxis: '+Z',
      upHint: '+Y (keep previous local Y)',
      note: 'Each frame after posing: rotate baseNode so its +Z points at endNode, and endNode so its +Z points at baseNode. Positions never change.',
    })),
    cables: mech.cables.map((c) => ({ ...c, deformation: 'skinned (2 bones: fromNode, toNode) in glTF/FBX/.blend; absent from OBJ/USD' })),
    mounts: mech.mounts,
    interiors: mech.interiors,
    gait: mech.gait,
    collision: { shape: 'box', note: 'Boxes are in the local space of `body` (a rigid body = joint node or root/body link).', boxes: collisionBoxes(mech) },
    lods: [
      { level: 0, note: 'full detail incl. greebles, interiors' },
      { level: 1, note: 'cosmetic greebles removed, radial segments halved' },
      { level: 2, note: 'silhouette only, interiors removed' },
    ],
    recipe: recipe ?? null,
    ...extra,
  };
}

export type RigSidecar = ReturnType<typeof rigSidecar>;

/** Helper used by controllers & tests: rest world matrix of a node from sidecar data alone. */
export function sidecarRestWorld(rig: RigSidecar): Map<string, Matrix4> {
  const out = new Map<string, Matrix4>();
  for (const n of rig.nodes) {
    const m = new Matrix4().compose(new Vector3(...(n.restTranslation as Vec3)), new Quaternion(...(n.restRotation as [number, number, number, number])), new Vector3(1, 1, 1));
    if (n.parent) m.premultiply(out.get(n.parent)!);
    out.set(n.name, m);
  }
  return out;
}
