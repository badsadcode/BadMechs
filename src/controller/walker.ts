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
import { Euler, Object3D, Quaternion, Vector3 } from 'three';
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

/** Anything that can answer "how high is the ground here, and which way is up?" (world space). */
export interface Ground {
  height(x: number, z: number): number;
  normal?(x: number, z: number): Vector3;
}

export interface WalkInput {
  /** -1 (reverse) … 1 (full speed ahead) */
  forward: number;
  /** -1 (right) … 1 (left) */
  turn: number;
}

export interface WalkOptions {
  speedScale?: number;
  /** 0..1 fraction of the cycle a foot spends in the air */
  swing?: number;
  /** uneven terrain; omit for flat ground at y = 0 */
  ground?: Ground;
  /** body pitch/roll follows the feet (0 = always level). Default 0.6 for ≥4 legs, 0 for bipeds */
  bodyTilt?: number;
}

const UP = new Vector3(0, 1, 0);

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
  readonly turnRate: number;
  distance = 0;
  input: WalkInput = { forward: 1, turn: 0 };
  ground: Ground | null;
  private bodyRestQ: Quaternion;
  private bodyDy = 0;
  private tiltQ = new Quaternion();
  private tiltAmt: number;

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
    this.bodyRestQ = this.body.quaternion.clone();
    this.swing = opts.swing ?? (rig.legs.length === 2 ? 0.4 : 0.45);
    this.speed = (rig.gait.strideLength / ((1 - this.swing) * rig.gait.cycleSeconds)) * (opts.speedScale ?? 1);
    this.ground = opts.ground ?? null;
    this.tiltAmt = opts.bodyTilt ?? (rig.legs.length >= 4 ? 0.6 : 0);
    // turn so the outermost feet move about as fast as when walking straight
    const rad = Math.max(0.5, ...rig.legs.map((l) => Math.hypot(l.restContact[0], l.restContact[2])));
    this.turnRate = (this.speed / rad) * 0.6;

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

  groundAt(x: number, z: number): number {
    return this.ground ? this.ground.height(x, z) : 0;
  }
  normalAt(x: number, z: number): Vector3 {
    if (!this.ground) return UP.clone();
    if (this.ground.normal) return this.ground.normal(x, z);
    const e = 0.05;
    const hx = this.ground.height(x + e, z) - this.ground.height(x - e, z);
    const hz = this.ground.height(x, z + e) - this.ground.height(x, z - e);
    return new Vector3(-hx, 2 * e, -hz).normalize();
  }

  update(dt: number) {
    const g = this.rig.gait;
    const cyc = g.cycleSeconds;
    const stride = g.strideLength;
    const f = Math.max(-1, Math.min(1, this.input.forward));
    const turn = Math.max(-1, Math.min(1, this.input.turn));
    const moving = Math.abs(f) > 0.05 || Math.abs(turn) > 0.05;
    // the gait clock only runs while moving, or to finish a step in progress when stopping
    const busy = this.legs.some((l) => l.swinging);
    const rate = moving ? Math.max(Math.abs(f), Math.abs(turn) * 0.7) : busy ? 1 : 0;
    this.t += dt * rate;

    // root: advance along +Z and yaw
    const step = this.speed * f * dt;
    this.distance += Math.abs(step);
    this.root.position.add(new Vector3(0, 0, step).applyQuaternion(this.root.quaternion));
    if (turn) this.root.quaternion.multiply(new Quaternion().setFromAxisAngle(UP, this.turnRate * turn * dt));
    this.root.updateMatrixWorld(true);

    // body height + tilt fitted to the ground under the feet' home spots
    const homes = this.legs.map((ls) => this.homeContact(ls.leg, 0));
    const hs = homes.map((p) => this.groundAt(p.x, p.z));
    const meanH = hs.reduce((a, b) => a + b, 0) / hs.length;
    const k = Math.min(1, dt * 5);
    this.bodyDy += (meanH - this.bodyDy) * k;
    if (this.tiltAmt > 0 && this.legs.length >= 4) {
      // least-squares plane through the home spots, in root-local x/z
      const loc = this.legs.map((ls) => ls.leg.restContact as [number, number, number]);
      const mx = loc.reduce((a, p) => a + p[0], 0) / loc.length;
      const mz = loc.reduce((a, p) => a + p[2], 0) / loc.length;
      let sxx = 0, szz = 0, sxh = 0, szh = 0;
      loc.forEach((p, i) => {
        sxx += (p[0] - mx) ** 2;
        szz += (p[2] - mz) ** 2;
        sxh += (p[0] - mx) * (hs[i] - meanH);
        szh += (p[2] - mz) * (hs[i] - meanH);
      });
      const slopeX = sxx > 1e-6 ? sxh / sxx : 0;
      const slopeZ = szz > 1e-6 ? szh / szz : 0;
      const want = new Quaternion().setFromEuler(new Euler(-Math.atan(slopeZ) * this.tiltAmt, 0, Math.atan(slopeX) * this.tiltAmt));
      this.tiltQ.slerp(want, k);
      this.body.quaternion.copy(this.bodyRestQ).premultiply(this.tiltQ);
    }
    const bobAmp = moving ? g.stepHeight * (this.rig.legs.length === 2 ? 0.25 : 0.1) : 0;
    this.body.position.y = this.bodyRestY + this.bodyDy - bobAmp * 0.5 + bobAmp * 0.5 * Math.cos((4 * Math.PI * this.t) / cyc);
    this.root.updateMatrixWorld(true);

    const rootQ = this.root.getWorldQuaternion(new Quaternion());
    for (const ls of this.legs) {
      const ph = (((this.t / cyc + ls.leg.gaitPhase) % 1) + 1) % 1;
      const inSwing = (moving || ls.swinging) && ph < this.swing;
      let target: Vector3;
      let nrm: Vector3;
      if (inSwing) {
        if (!ls.swinging) {
          ls.swinging = true;
          ls.lift.copy(ls.planted);
        }
        const s = ph / this.swing;
        const land = this.homeContact(ls.leg, moving ? (stride / 2) * f : 0);
        land.y = this.groundAt(land.x, land.z);
        // clear anything between lift-off and landing (rocks, step edges)
        let peak = Math.max(ls.lift.y, land.y);
        for (let i = 1; i < 6; i++) {
          const q = ls.lift.clone().lerp(land, i / 6);
          peak = Math.max(peak, this.groundAt(q.x, q.z));
        }
        const e = s * s * (3 - 2 * s);
        target = ls.lift.clone().lerp(land, e);
        const base = ls.lift.y * (1 - e) + land.y * e;
        target.y = base + Math.sin(Math.PI * s) * (g.stepHeight + Math.max(0, peak - Math.max(ls.lift.y, land.y)) * 1.15);
        ls.planted.copy(target);
        nrm = this.normalAt(land.x, land.z).lerp(UP, 1 - e).normalize();
        if (s > 0.97) ls.planted.y = land.y;
      } else {
        if (ls.swinging) {
          ls.swinging = false;
          ls.planted.y = this.groundAt(ls.planted.x, ls.planted.z);
        }
        target = ls.planted.clone();
        nrm = this.normalAt(target.x, target.z);
      }
      // foot pivot target: foot aligned with the body heading, tilted onto the ground's slope
      const footQ = new Quaternion().setFromUnitVectors(UP, nrm).multiply(rootQ).multiply(ls.footRel);
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

  /** For planted feet: gap between the foot's contact point and the ground below it (metres). */
  stanceGroundErrors(): number[] {
    return this.legs
      .filter((ls) => !ls.swinging)
      .map((ls) => {
        const c = this.contactWorld(ls.leg);
        return Math.abs(c.y - this.groundAt(c.x, c.z));
      });
  }

  /** World-space foot targets (for debug markers). */
  footTargets(): { pos: Vector3; swinging: boolean }[] {
    return this.legs.map((ls) => ({ pos: ls.planted.clone(), swinging: ls.swinging }));
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
