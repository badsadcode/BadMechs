/**
 * Reference procedural walk controller.
 *
 * Deliberately knows NOTHING about BadMech's generator: it only reads a loaded scene graph
 * (e.g. the exported GLB through any glTF loader) plus the badmech-rig/1 sidecar. If this can
 * make every family walk, an engine-side controller can too. Port it to GDScript / C# / C++
 * by translating ~250 lines of vector math.
 *
 *   gait clock → per-leg swing/stance → foot targets → CCD IK on hinge joints (limits respected)
 *   → foot levelling (ankle joints) → body bob → piston aim constraints. Hoses are skinned.
 */
import { Object3D, Quaternion, Vector3 } from 'three';
import type { RigSidecar } from '../export/rig';

type Joint = RigSidecar['joints'][number];
type Leg = RigSidecar['legs'][number];

const LEVELERS = new Set(['ankle-pitch', 'ankle-roll', 'foot-pitch']);
const NO_IK = new Set(['hip-yaw']);

interface LegState {
  leg: Leg;
  reach: string[];
  level: string[];
  planted: Vector3;
  lift: Vector3;
  swinging: boolean;
  /** foot orientation relative to the mech root at rest */
  footRel: Quaternion;
  /** foot pivot relative to contact, in foot-local space */
  pivotFromContact: Vector3;
}

export interface WalkOptions {
  speedScale?: number;
  /** 0..1 fraction of the cycle a foot spends in the air */
  swing?: number;
}

export class RigWalker {
  readonly obj = new Map<string, Object3D>();
  private rest = new Map<string, Quaternion>();
  private restPos = new Map<string, Vector3>();
  private joints = new Map<string, Joint>();
  readonly angles = new Map<string, number>();
  private legs: LegState[] = [];
  private t = 0;
  private root: Object3D;
  private body: Object3D;
  private bodyRestY: number;
  readonly swing: number;
  readonly speed: number;
  distance = 0;

  constructor(
    scene: Object3D,
    readonly rig: RigSidecar,
    opts: WalkOptions = {},
  ) {
    scene.traverse((o) => {
      if (o.name && !this.obj.has(o.name)) this.obj.set(o.name, o);
    });
    for (const n of rig.nodes) {
      const o = this.obj.get(n.name);
      if (!o) throw new Error(`RigWalker: node '${n.name}' missing from scene`);
      this.rest.set(n.name, o.quaternion.clone());
      this.restPos.set(n.name, o.position.clone());
    }
    for (const j of rig.joints) {
      this.joints.set(j.name, j);
      this.angles.set(j.name, 0);
    }
    this.root = this.obj.get(rig.rootNode)!;
    this.body = this.obj.get(rig.bodyNode)!;
    this.bodyRestY = this.body.position.y;
    this.swing = opts.swing ?? (rig.legs.length === 2 ? 0.4 : 0.45);
    this.speed = (rig.gait.strideLength / ((1 - this.swing) * rig.gait.cycleSeconds)) * (opts.speedScale ?? 1);

    this.root.updateMatrixWorld(true);
    const rootQ = this.root.getWorldQuaternion(new Quaternion());
    for (const leg of rig.legs) {
      const foot = this.obj.get(leg.footNode)!;
      const contact = this.contactWorld(leg);
      const footQ = foot.getWorldQuaternion(new Quaternion());
      this.legs.push({
        leg,
        reach: leg.joints.filter((j) => !LEVELERS.has(this.joints.get(j)!.kind) && !NO_IK.has(this.joints.get(j)!.kind)),
        level: leg.joints.filter((j) => LEVELERS.has(this.joints.get(j)!.kind)),
        planted: contact.clone(),
        lift: contact.clone(),
        swinging: false,
        footRel: rootQ.clone().invert().multiply(footQ),
        pivotFromContact: new Vector3(...(leg.contactOffset as [number, number, number])).negate(),
      });
    }
  }

  setJoint(name: string, a: number) {
    const j = this.joints.get(name)!;
    const v = j.continuous ? a : Math.min(j.max, Math.max(j.min, a));
    this.angles.set(name, v);
    const o = this.obj.get(name)!;
    o.quaternion.copy(this.rest.get(name)!).multiply(new Quaternion().setFromAxisAngle(new Vector3(...(j.axisVector as [number, number, number])), v));
  }

  private contactWorld(leg: Leg) {
    return new Vector3(...(leg.contactOffset as [number, number, number])).applyMatrix4(this.obj.get(leg.footNode)!.matrixWorld);
  }

  /** Where a leg's foot would rest if the mech were standing at its current root transform. */
  private homeContact(leg: Leg, ahead: number) {
    const p = new Vector3(...(leg.restContact as [number, number, number]));
    p.z += ahead;
    return p.applyMatrix4(this.root.matrixWorld);
  }

  update(dt: number) {
    const g = this.rig.gait;
    this.t += dt;
    const cyc = g.cycleSeconds;
    const stride = g.strideLength;

    // root advances along its +Z
    const step = this.speed * dt;
    this.distance += step;
    this.root.position.add(new Vector3(0, 0, step).applyQuaternion(this.root.quaternion));

    // body bob (twice per cycle for bipeds, gentler for many legs)
    const bobAmp = g.stepHeight * (this.rig.legs.length === 2 ? 0.25 : 0.1);
    this.body.position.y = this.bodyRestY - bobAmp * 0.5 + bobAmp * 0.5 * Math.cos((4 * Math.PI * this.t) / cyc);
    this.root.updateMatrixWorld(true);

    const rootQ = this.root.getWorldQuaternion(new Quaternion());
    for (const ls of this.legs) {
      const ph = (((this.t / cyc + ls.leg.gaitPhase) % 1) + 1) % 1;
      const inSwing = ph < this.swing;
      let target: Vector3;
      if (inSwing) {
        if (!ls.swinging) {
          ls.swinging = true;
          ls.lift.copy(ls.planted);
        }
        const s = ph / this.swing;
        const land = this.homeContact(ls.leg, stride / 2);
        const e = s * s * (3 - 2 * s);
        target = ls.lift.clone().lerp(land, e);
        target.y = land.y * e + ls.lift.y * (1 - e) + Math.sin(Math.PI * s) * g.stepHeight;
        ls.planted.copy(target);
      } else {
        if (ls.swinging) ls.swinging = false;
        target = ls.planted.clone();
      }
      // foot pivot target: keep the foot level and aligned with the body heading
      const footQ = rootQ.clone().multiply(ls.footRel);
      const pivotTarget = target.clone().add(ls.pivotFromContact.clone().applyQuaternion(footQ));
      this.solveReach(ls, pivotTarget);
      this.level(ls, footQ);
    }

    // arms swing opposite to legs (bipeds), everything else holds
    for (const arm of this.rig.arms) {
      const sh = arm.joints.find((j) => this.joints.get(j)?.kind === 'shoulder-pitch');
      if (sh) this.setJoint(sh, 0.18 * Math.sin((2 * Math.PI * this.t) / cyc + (arm.side === 'L' ? 0 : Math.PI)));
    }
    this.root.updateMatrixWorld(true);
    this.aimPistons();
  }

  private solveReach(ls: LegState, target: Vector3) {
    const foot = this.obj.get(ls.leg.footNode)!;
    const pE = new Vector3();
    const pJ = new Vector3();
    const axis = new Vector3();
    const qW = new Quaternion();
    // gentle pull back toward rest keeps CCD out of weird local minima
    for (const jn of ls.reach) this.setJoint(jn, this.angles.get(jn)! * 0.97);
    this.obj.get(ls.reach[0])!.updateMatrixWorld(true);
    for (let it = 0; it < 14; it++) {
      for (let i = ls.reach.length - 1; i >= 0; i--) {
        const jn = ls.reach[i];
        const jo = this.obj.get(jn)!;
        const j = this.joints.get(jn)!;
        jo.getWorldPosition(pJ);
        foot.getWorldPosition(pE);
        axis.set(...(j.axisVector as [number, number, number])).applyQuaternion(jo.getWorldQuaternion(qW)).normalize();
        const e = pE.sub(pJ);
        const t = target.clone().sub(pJ);
        e.sub(axis.clone().multiplyScalar(e.dot(axis)));
        t.sub(axis.clone().multiplyScalar(t.dot(axis)));
        if (e.lengthSq() < 1e-10 || t.lengthSq() < 1e-10) continue;
        const ang = Math.atan2(axis.dot(new Vector3().crossVectors(e, t)), e.dot(t));
        this.setJoint(jn, this.angles.get(jn)! + ang);
        jo.updateMatrixWorld(true);
      }
      if (foot.getWorldPosition(pE).distanceTo(target) < 0.002) break;
    }
  }

  private level(ls: LegState, want: Quaternion) {
    const foot = this.obj.get(ls.leg.footNode)!;
    const qW = new Quaternion();
    for (const jn of ls.level) {
      const jo = this.obj.get(jn)!;
      const j = this.joints.get(jn)!;
      const cur = foot.getWorldQuaternion(new Quaternion());
      const delta = want.clone().multiply(cur.invert());
      if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
      const axis = new Vector3(...(j.axisVector as [number, number, number])).applyQuaternion(jo.getWorldQuaternion(qW)).normalize();
      const ang = 2 * Math.atan2(delta.x * axis.x + delta.y * axis.y + delta.z * axis.z, delta.w);
      this.setJoint(jn, this.angles.get(jn)! + ang);
      jo.updateMatrixWorld(true);
    }
  }

  private aimPistons() {
    const a = new Vector3();
    const b = new Vector3();
    for (const act of this.rig.actuators) {
      const base = this.obj.get(act.baseNode)!;
      const end = this.obj.get(act.endNode)!;
      base.position.copy(this.restPos.get(act.baseNode)!);
      end.position.copy(this.restPos.get(act.endNode)!);
      base.quaternion.copy(this.rest.get(act.baseNode)!);
      end.quaternion.copy(this.rest.get(act.endNode)!);
      base.updateMatrixWorld(true);
      end.updateMatrixWorld(true);
      base.getWorldPosition(a);
      end.getWorldPosition(b);
      aimZ(base, b);
      aimZ(end, a);
    }
  }

  /** Foot-to-target error after the last update (metres), for tests. */
  footErrors(): number[] {
    return this.legs.map((ls) => {
      const c = this.contactWorld(ls.leg);
      return c.distanceTo(ls.planted);
    });
  }
}

const _z = new Vector3(0, 0, 1);
export function aimZ(o: Object3D, targetWorld: Vector3) {
  const p = o.getWorldPosition(new Vector3());
  const qW = o.getWorldQuaternion(new Quaternion());
  const cur = _z.clone().applyQuaternion(qW);
  const want = targetWorld.clone().sub(p).normalize();
  if (!isFinite(want.x)) return;
  const newW = new Quaternion().setFromUnitVectors(cur, want).multiply(qW);
  const parentW = o.parent ? o.parent.getWorldQuaternion(new Quaternion()) : new Quaternion();
  o.quaternion.copy(parentW.invert().multiply(newW));
  o.updateMatrixWorld(true);
}
