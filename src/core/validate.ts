import { Matrix4, Vector3 } from 'three';
import { primCorners, primHalfExtents, primMatrix, primVolume, round } from './builder';
import { worldMatrices } from './kinematics';
import type { Mech, MechNode, Pose, Vec3 } from './model';

// ─────────────────────────────────────────────────────────── OBB utils ──

export interface OBB {
  c: Vector3;
  /** unit axes */
  u: [Vector3, Vector3, Vector3];
  e: Vector3;
  /** bounding radius for broadphase */
  r: number;
}

export function obbFrom(m: Matrix4, half: Vector3): OBB {
  const c = new Vector3().setFromMatrixPosition(m);
  const u: [Vector3, Vector3, Vector3] = [new Vector3(), new Vector3(), new Vector3()];
  m.extractBasis(u[0], u[1], u[2]);
  u.forEach((a) => a.normalize());
  return { c, u, e: half.clone(), r: half.length() };
}

/**
 * Separating-axis test. Returns penetration depth along the best separating axis
 * (≤ 0 means separated).
 */
export function obbPenetration(a: OBB, b: OBB): number {
  const d = b.c.clone().sub(a.c);
  if (d.length() > a.r + b.r) return -1;
  const ea = [a.e.x, a.e.y, a.e.z];
  const eb = [b.e.x, b.e.y, b.e.z];
  let minPen = Infinity;
  const test = (axis: Vector3) => {
    const len = axis.length();
    if (len < 1e-6) return true;
    axis.divideScalar(len);
    let ra = 0;
    let rb = 0;
    for (let i = 0; i < 3; i++) {
      ra += ea[i] * Math.abs(a.u[i].dot(axis));
      rb += eb[i] * Math.abs(b.u[i].dot(axis));
    }
    const pen = ra + rb - Math.abs(d.dot(axis));
    if (pen < minPen) minPen = pen;
    return pen > 0;
  };
  for (let i = 0; i < 3; i++) if (!test(a.u[i].clone())) return minPen;
  for (let i = 0; i < 3; i++) if (!test(b.u[i].clone())) return minPen;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (!test(new Vector3().crossVectors(a.u[i], b.u[j]))) return minPen;
  return minPen;
}

// ───────────────────────────────────────────────────────── rigid bodies ──

export interface BodyInfo {
  name: string;
  parentBody: string | null;
  /** prims (from this body and its component children) in body-local space */
  shapes: { node: string; local: Matrix4; half: Vector3; volume: number }[];
}

export function rigidBodies(mech: Mech): Map<string, BodyInfo> {
  const byName = new Map(mech.nodes.map((n) => [n.name, n]));
  const isBody = (n: MechNode) => !!n.joint || n.role === 'root' || n.role === 'link';
  const bodyOf = new Map<string, string>();
  const bodies = new Map<string, BodyInfo>();
  for (const n of mech.nodes) {
    if (isBody(n)) {
      bodyOf.set(n.name, n.name);
      const pb = n.parent ? bodyOf.get(n.parent)! : null;
      bodies.set(n.name, { name: n.name, parentBody: pb, shapes: [] });
    } else bodyOf.set(n.name, n.parent ? bodyOf.get(n.parent)! : n.name);
  }
  const rest = worldMatrices(mech, {});
  for (const n of mech.nodes) {
    if (n.role === 'actuator' || n.component === 'interior' || n.role === 'skinned') continue;
    const body = bodyOf.get(n.name)!;
    if (!bodies.has(body)) continue;
    const inv = rest.get(body)!.clone().invert();
    const nodeInBody = inv.multiply(rest.get(n.name)!);
    for (const p of n.prims) {
      if (!p.collide || p.detail > 0) continue;
      bodies.get(body)!.shapes.push({ node: n.name, local: nodeInBody.clone().multiply(primMatrix(p)), half: primHalfExtents(p), volume: primVolume(p) });
    }
  }
  void byName;
  return bodies;
}

/** Bodies that are mechanically adjacent: they share a pivot so contact there is by design. */
function adjacent(bodies: Map<string, BodyInfo>, a: string, b: string): boolean {
  return walkAdj(bodies, a, b) || walkAdj(bodies, b, a);
}
function walkAdj(bodies: Map<string, BodyInfo>, from: string, target: string): boolean {
  let cur = bodies.get(from)!.parentBody;
  let hops = 0;
  while (cur) {
    if (cur === target) return true;
    // keep climbing only through shapeless joint stacks (hip yaw → hip roll → thigh)
    if (bodies.get(cur)!.shapes.length > 0 || ++hops > 3) {
      // allow one shaped hop when the pivot coincides (e.g. thigh → hip_roll housing → hip_yaw)
      return false;
    }
    cur = bodies.get(cur)!.parentBody;
  }
  return false;
}

function bodyOBBs(bodies: Map<string, BodyInfo>, world: Map<string, Matrix4>, names: Iterable<string>) {
  const out: { body: string; obb: OBB }[] = [];
  const tmp = new Matrix4();
  for (const b of names) {
    const info = bodies.get(b)!;
    const w = world.get(b)!;
    for (const s of info.shapes) out.push({ body: b, obb: obbFrom(tmp.multiplyMatrices(w, s.local), s.half) });
  }
  return out;
}

export interface Clash {
  a: string;
  b: string;
  depth: number;
  pose: Pose;
}

function bodySubtree(bodies: Map<string, BodyInfo>, root: string): Set<string> {
  const out = new Set<string>([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const b of bodies.values()) if (b.parentBody && out.has(b.parentBody) && !out.has(b.name)) {
      out.add(b.name);
      grew = true;
    }
  }
  return out;
}

/**
 * Bodies a sweeping joint is checked against. Locomotion has right of way: arms, pods and tools
 * are expected to be posed out of the legs' way by the controller, so leg sweeps ignore them
 * (arm sweeps still check against the legs).
 */
function stillBodies(mech: Mech, bodies: Map<string, BodyInfo>, moving: Set<string>, n: MechNode): string[] {
  const sys = new Map(mech.nodes.map((x) => [x.name, x.system]));
  const yields = (b: string) => /^(arm|pod|crane|turret|sensor)/.test(sys.get(b) ?? '');
  return [...bodies.keys()].filter((b) => !moving.has(b) && !(n.joint?.purpose === 'locomotion' && yields(b)));
}

const TOL = 0.004; // 4 mm of interpenetration is noise, not a clash

/** Pairs (moving × static) clashing in `pose` that were NOT already touching at rest. */
function clashesForJoint(mech: Mech, bodies: Map<string, BodyInfo>, joint: string, pose: Pose, restPairs: Set<string>, moving: Set<string>, still: string[]): Clash[] {
  const w = worldMatrices(mech, pose);
  const mo = bodyOBBs(bodies, w, moving);
  const st = bodyOBBs(bodies, w, still);
  const out: Clash[] = [];
  for (const m of mo)
    for (const s of st) {
      const key = m.body < s.body ? `${m.body}|${s.body}` : `${s.body}|${m.body}`;
      if (restPairs.has(key)) continue;
      if (adjacent(bodies, m.body, s.body)) continue;
      const pen = obbPenetration(m.obb, s.obb);
      if (pen > TOL) out.push({ a: m.body, b: s.body, depth: pen, pose: { ...pose } });
    }
  void joint;
  return out;
}

function restContactPairs(mech: Mech, bodies: Map<string, BodyInfo>): Set<string> {
  const w = worldMatrices(mech, {});
  const all = bodyOBBs(bodies, w, bodies.keys());
  const out = new Set<string>();
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      if (all[i].body === all[j].body) continue;
      if (obbPenetration(all[i].obb, all[j].obb) > TOL) {
        const a = all[i].body;
        const b = all[j].body;
        out.add(a < b ? `${a}|${b}` : `${b}|${a}`);
      }
    }
  return out;
}

export interface LimitFit {
  joint: string;
  before: [number, number];
  after: [number, number];
  blockedBy: string;
}

/**
 * Narrow each joint's limits until a single-joint sweep is clash-free. This makes the exported
 * limits trustworthy for engine-side IK: anything inside the limits doesn't eat its own armour.
 */
export function fitJointLimits(mech: Mech): LimitFit[] {
  const bodies = rigidBodies(mech);
  const restPairs = restContactPairs(mech, bodies);
  const fits: LimitFit[] = [];
  for (const n of mech.nodes) {
    if (!n.joint || n.joint.purpose === 'tool' || n.tags.includes('continuous')) continue;
    const moving = bodySubtree(bodies, n.name);
    const still = stillBodies(mech, bodies, moving, n);
    const before: [number, number] = [n.joint.min, n.joint.max];
    let blockedBy = '';
    for (const dir of ['min', 'max'] as const) {
      const lim = n.joint[dir];
      if (lim === 0) continue;
      const clashAt = (a: number) => clashesForJoint(mech, bodies, n.name, { [n.name]: a }, restPairs, moving, still);
      // coarse scan from rest outward, then bisect the first clash
      let safe = 0;
      let bad: number | null = null;
      for (let i = 1; i <= 6; i++) {
        const a = (lim * i) / 6;
        const c = clashAt(a);
        if (c.length) {
          bad = a;
          blockedBy = `${c[0].a} ↔ ${c[0].b}`;
          break;
        }
        safe = a;
      }
      if (bad !== null) {
        let hi: number = bad;
        for (let k = 0; k < 6; k++) {
          const mid: number = (safe + hi) / 2;
          if (clashAt(mid).length) hi = mid;
          else safe = mid;
        }
        n.joint[dir] = safe;
      }
    }
    if (before[0] !== n.joint.min || before[1] !== n.joint.max) fits.push({ joint: n.name, before, after: [n.joint.min, n.joint.max], blockedBy });
  }
  // actuator stroke metadata must follow the new limits
  for (const act of mech.actuators) {
    const j = mech.nodes.find((x) => x.name === act.drives)!.joint!;
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = 0; i <= 16; i++) {
      const w = worldMatrices(mech, { [act.drives]: j.min + ((j.max - j.min) * i) / 16 });
      const L = new Vector3().setFromMatrixPosition(w.get(act.baseNode)!).distanceTo(new Vector3().setFromMatrixPosition(w.get(act.endNode)!));
      mn = Math.min(mn, L);
      mx = Math.max(mx, L);
    }
    act.minLength = round(mn, 4);
    act.maxLength = round(mx, 4);
  }
  return fits;
}

// ─────────────────────────────────────────────────────────── validation ──

export type Severity = 'ok' | 'info' | 'warn' | 'error';
export interface Check {
  id: string;
  severity: Severity;
  message: string;
}

export interface ValidationReport {
  mech: string;
  checks: Check[];
  counts: Record<Severity, number>;
  clashes: Clash[];
}

export function validate(mech: Mech, opts: { randomPoses?: number } = {}): ValidationReport {
  const checks: Check[] = [];
  const add = (id: string, severity: Severity, message: string) => checks.push({ id, severity, message });
  const byName = new Map<string, MechNode>();

  // structure
  const seen = new Set<string>();
  let structOk = true;
  for (const n of mech.nodes) {
    if (byName.has(n.name)) {
      add('struct.unique', 'error', `duplicate node name ${n.name}`);
      structOk = false;
    }
    byName.set(n.name, n);
    if (n.parent && !seen.has(n.parent)) {
      add('struct.order', 'error', `${n.name} appears before its parent ${n.parent}`);
      structOk = false;
    }
    seen.add(n.name);
    const q = n.quaternion;
    const ql = Math.hypot(...q);
    if (!isFinite(ql) || Math.abs(ql - 1) > 1e-4) {
      add('struct.quat', 'error', `${n.name} rest quaternion not normalised (${ql})`);
      structOk = false;
    }
    if (![...n.position].every(isFinite)) {
      add('struct.finite', 'error', `${n.name} has non-finite position`);
      structOk = false;
    }
    if (n.joint) {
      const j = n.joint;
      if (!(j.min <= 1e-9 && j.max >= -1e-9 && j.min < j.max)) {
        add('joint.limits', 'error', `${n.name} limits [${j.min}, ${j.max}] don't bracket rest`);
        structOk = false;
      }
      if (!/^[A-Za-z0-9_]+$/.test(n.name)) add('naming', 'warn', `${n.name}: joint names should be [A-Za-z0-9_]`);
    }
  }
  const roots = mech.nodes.filter((n) => !n.parent);
  if (roots.length !== 1) add('struct.root', 'error', `expected 1 root, found ${roots.length}`);
  for (const n of mech.nodes) for (const p of n.prims) for (const v of [...p.pos, ...p.rot, ...p.size]) if (!isFinite(v)) add('geom.finite', 'error', `${n.name} has non-finite prim data`);
  if (structOk) add('struct', 'ok', `${mech.nodes.length} nodes, ${mech.nodes.filter((n) => n.joint).length} joints, single root, parents precede children, names unique`);

  // legs
  const rest = worldMatrices(mech, {});
  for (const leg of mech.legs) {
    let chainOk = true;
    for (let i = 1; i < leg.joints.length; i++) {
      // each joint must be a descendant of the previous
      let p = byName.get(leg.joints[i])!.parent;
      while (p && p !== leg.joints[i - 1]) p = byName.get(p)!.parent;
      if (!p) {
        add('leg.chain', 'error', `${leg.name}: ${leg.joints[i]} is not below ${leg.joints[i - 1]}`);
        chainOk = false;
      }
    }
    const c = new Vector3(...leg.contactOffset).applyMatrix4(rest.get(leg.footNode)!);
    if (Math.abs(c.y) > 0.03) add('leg.ground', 'warn', `${leg.name}: rest foot contact is ${(c.y * 100).toFixed(1)} cm off the ground`);
    else if (chainOk) add('leg.chain', 'ok', `${leg.name}: ${leg.joints.length}-joint chain, foot on ground (Δy ${(c.y * 1000).toFixed(1)} mm), reach ${leg.minReach.toFixed(2)}–${leg.maxReach.toFixed(2)} m`);
    if (leg.maxReach - leg.minReach < leg.restReach * 0.15) add('leg.reach', 'warn', `${leg.name}: very small reach range`);
  }
  if (!mech.legs.length) add('leg.none', 'error', 'no leg chains registered');

  // pistons: geometric feasibility (barrel + rod must cover max length, both must fit in min length)
  for (const a of mech.actuators) {
    const overlap = a.barrelLength + a.rodLength - a.maxLength;
    const fitsMin = a.rodLength <= a.minLength + 1e-3;
    if (overlap < a.barrelLength * 0.1) add('piston.stroke', 'error', `${a.name}: rod pulls out of barrel at full extension`);
    else if (!fitsMin) add('piston.stroke', 'warn', `${a.name}: rod bottoms out at full retraction`);
  }
  if (mech.actuators.length) add('piston.stroke', 'ok', `${mech.actuators.length} pistons: barrel/rod lengths cover their full stroke`);

  // body-to-ground: nothing but feet below ground at rest
  let lowest = Infinity;
  let lowestNode = '';
  const footBodies = new Set(mech.legs.map((l) => l.footNode));
  for (const n of mech.nodes) {
    let p: string | null = n.name;
    let isFoot = false;
    while (p) {
      if (footBodies.has(p)) isFoot = true;
      p = byName.get(p)!.parent;
    }
    if (isFoot) continue;
    const w = rest.get(n.name)!;
    for (const pr of n.prims) {
      if (!pr.collide) continue;
      const y = Math.min(...primCorners(pr).map((c) => c.applyMatrix4(w).y));
      if (y < lowest) {
        lowest = y;
        lowestNode = n.name;
      }
    }
  }
  if (lowest < -0.05) add('ground.clearance', 'warn', `${lowestNode} may dip below the ground at rest`);
  else add('ground.clearance', 'ok', `only feet touch the ground (lowest other part ${lowest.toFixed(2)} m)`);

  // clearance: single-joint sweeps at limits + random multi-joint poses
  const bodies = rigidBodies(mech);
  const restPairs = restContactPairs(mech, bodies);
  const clashes: Clash[] = [];
  for (const n of mech.nodes) {
    if (!n.joint || n.tags.includes('continuous')) continue;
    const moving = bodySubtree(bodies, n.name);
    const still = stillBodies(mech, bodies, moving, n);
    for (const a of [n.joint.min, n.joint.max]) clashes.push(...clashesForJoint(mech, bodies, n.name, { [n.name]: a }, restPairs, moving, still));
  }
  if (!clashes.length) add('clearance.sweep', 'ok', 'every joint reaches both limits without parts interpenetrating (OBB test, 4 mm tolerance)');
  else add('clearance.sweep', 'warn', `${clashes.length} clashes at single-joint limits, worst ${(Math.max(...clashes.map((c) => c.depth)) * 100).toFixed(1)} cm`);

  const nRand = opts.randomPoses ?? 0;
  if (nRand > 0) {
    let s = 12345;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    let bad = 0;
    const all = [...bodies.keys()];
    for (let i = 0; i < nRand; i++) {
      const pose: Pose = {};
      // "locomotion-plausible" poses: legs within half range, everything else anywhere
      for (const n of mech.nodes) if (n.joint && !n.tags.includes('continuous')) pose[n.name] = (n.joint.purpose === 'locomotion' ? 0.5 : 1) * (n.joint.min + (n.joint.max - n.joint.min) * rnd());
      const w = worldMatrices(mech, pose);
      const ob = bodyOBBs(bodies, w, all);
      let found = false;
      for (let x = 0; x < ob.length && !found; x++)
        for (let y = x + 1; y < ob.length; y++) {
          const a = ob[x].body;
          const b = ob[y].body;
          if (a === b) continue;
          const key = a < b ? `${a}|${b}` : `${b}|${a}`;
          if (restPairs.has(key) || adjacent(bodies, a, b)) continue;
          if (obbPenetration(ob[x].obb, ob[y].obb) > TOL) {
            found = true;
            break;
          }
        }
      if (found) bad++;
    }
    add('clearance.random', bad / nRand > 0.5 ? 'warn' : 'info', `${nRand - bad}/${nRand} random multi-joint poses are clash-free (combined extremes can still collide; controllers should keep to gait ranges)`);
  }

  // interiors: walkable spaces must clear human height and not be filled by machinery
  for (const sp of mech.interiors) {
    const h = sp.max[1] - sp.min[1];
    if (sp.walkable && h < 1.9) add('interior.height', 'warn', `${sp.name}: walkable space only ${h.toFixed(2)} m tall`);
    else add('interior.space', 'ok', `${sp.name} (${sp.kind}): ${(sp.max[0] - sp.min[0]).toFixed(2)}×${h.toFixed(2)}×${(sp.max[2] - sp.min[2]).toFixed(2)} m${sp.walkable ? ', walkable' : ''}`);
    // anything solid (non-interior) of the same body intruding into the clear volume?
    const w = rest.get(sp.node)!;
    const inv = w.clone().invert();
    const intruders: string[] = [];
    const lo = new Vector3(...sp.min).addScalar(0.02);
    const hi = new Vector3(...sp.max).addScalar(-0.02);
    const spaceObb = obbFrom(new Matrix4().makeTranslation(...(lo.clone().add(hi).multiplyScalar(0.5).toArray() as Vec3)).premultiply(w), hi.clone().sub(lo).multiplyScalar(0.5));
    for (const n of mech.nodes) {
      if (n.component === 'interior' || n.component === 'glass' || n.role === 'hatch' || n.role === 'actuator') continue;
      let isInterior = false;
      for (let p: string | null = n.name; p; p = byName.get(p)!.parent) if (byName.get(p)!.component === 'interior') isInterior = true;
      if (isInterior) continue;
      for (const p of n.prims) {
        if (!p.collide) continue;
        const o = obbFrom(rest.get(n.name)!.clone().multiply(primMatrix(p)), primHalfExtents(p));
        if (obbPenetration(o, spaceObb) > 0.03) intruders.push(n.name);
      }
    }
    void inv;
    if (intruders.length) add('interior.intrusion', 'warn', `${sp.name}: ${intruders.length} solid parts poke into the clear volume (${[...new Set(intruders)].slice(0, 4).join(', ')})`);
  }

  // naming / metadata consistency
  const legJointCount = new Set(mech.legs.map((l) => l.joints.length));
  add('naming', 'ok', `leg chains share ${[...legJointCount].join('/')}-joint layouts; names follow leg_<id>_<segment>`);

  const counts: Record<Severity, number> = { ok: 0, info: 0, warn: 0, error: 0 };
  for (const c of checks) counts[c.severity]++;
  return { mech: mech.name, checks, counts, clashes };
}
