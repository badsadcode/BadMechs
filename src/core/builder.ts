import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type {
  ArmChain,
  Axis,
  ComponentKind,
  GaitHint,
  InteriorSpace,
  JointPurpose,
  LegChain,
  MaterialId,
  Mech,
  MechNode,
  Mount,
  PaletteEntry,
  Prim,
  Quat,
  Role,
  Vec3,
} from './model';
import { worldMatrices } from './kinematics';
import { shapeBounds, ShapeSpec } from './hs/shapes';
import { barrelShape, block, clevis, rodShape } from './hs/kit';
import { Rng } from './rng';

export interface JointSpec {
  axis: Axis;
  min: number; // degrees for authoring convenience
  max: number;
  purpose: JointPurpose;
  kind: string;
  maxSpeed?: number;
}

export interface NodeOpts {
  role?: Role;
  system?: string;
  rot?: Vec3; // euler radians
  joint?: JointSpec;
  component?: ComponentKind;
  tags?: string[];
}

interface PrimOpts {
  rot?: Vec3;
  hidden?: boolean;
  detail?: 0 | 1 | 2;
  collide?: boolean;
  segments?: number;
}

const DEG = Math.PI / 180;

/** Fluent handle used by family generators to hang geometry off a node. */
export class NodeRef {
  constructor(
    readonly b: Builder,
    readonly node: MechNode,
  ) {}
  get name() {
    return this.node.name;
  }

  private add(p: Prim & { hidden?: boolean }) {
    this.node.prims.push(p);
    return this;
  }
  box(pos: Vec3, size: Vec3, material: MaterialId, o: PrimOpts = {}) {
    return this.add({ kind: 'box', pos, rot: o.rot ?? [0, 0, 0], size, material, detail: o.detail ?? 0, collide: o.collide ?? true, ...(o.hidden ? { hidden: true } : {}) });
  }
  /** Box with chamfered long edges (profile in X/Y, extruded along Z) – the armour-plate workhorse. */
  chamfer(pos: Vec3, size: Vec3, c: number, material: MaterialId, o: PrimOpts = {}) {
    return this.add({ kind: 'chamfer', pos, rot: o.rot ?? [0, 0, 0], size, extra: [c], material, detail: o.detail ?? 0, collide: o.collide ?? true });
  }
  /** Tapered box: top face scaled by [sx, sz] and shifted by [ox, oz]. Sloped armour, hulls, feet. */
  taper(pos: Vec3, size: Vec3, top: [number, number], off: [number, number], material: MaterialId, o: PrimOpts = {}) {
    return this.add({ kind: 'taper', pos, rot: o.rot ?? [0, 0, 0], size, extra: [top[0], top[1], off[0], off[1]], material, detail: o.detail ?? 0, collide: o.collide ?? true });
  }
  /** Cylinder along local Y (after rot), centred at pos. */
  cyl(pos: Vec3, r: number, len: number, material: MaterialId, o: PrimOpts & { rTop?: number } = {}) {
    return this.add({ kind: 'cyl', pos, rot: o.rot ?? [0, 0, 0], size: [r, len, o.rTop ?? r], material, segments: o.segments ?? 16, detail: o.detail ?? 0, collide: o.collide ?? true });
  }
  /** Cylinder along local X – hinge pins, axles. */
  cylX(pos: Vec3, r: number, len: number, material: MaterialId, o: PrimOpts = {}) {
    return this.cyl(pos, r, len, material, { ...o, rot: [0, 0, Math.PI / 2] });
  }
  cylZ(pos: Vec3, r: number, len: number, material: MaterialId, o: PrimOpts & { rTop?: number } = {}) {
    return this.cyl(pos, r, len, material, { ...o, rot: [Math.PI / 2, 0, 0] });
  }
  /** Cylinder spanning two node-local points. */
  strut(a: Vec3, b: Vec3, r: number, material: MaterialId, o: PrimOpts = {}) {
    const va = new Vector3(...a);
    const vb = new Vector3(...b);
    const d = vb.clone().sub(va);
    const len = d.length();
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d.normalize());
    const e = new Euler().setFromQuaternion(q, 'XYZ');
    const mid = va.add(vb).multiplyScalar(0.5);
    return this.cyl([mid.x, mid.y, mid.z], r, len, material, { ...o, rot: [e.x, e.y, e.z] });
  }
  sphere(pos: Vec3, r: number, material: MaterialId, o: PrimOpts = {}) {
    return this.add({ kind: 'sphere', pos, rot: [0, 0, 0], size: [r, r, r], material, segments: o.segments ?? 14, detail: o.detail ?? 0, collide: o.collide ?? true });
  }
  /**
   * Hard-surface shape (loft / lathe / tube). Bounds are measured once so collision proxies,
   * clearance checks and stats see the real extents.
   */
  shape(pos: Vec3, spec: ShapeSpec, material: MaterialId, o: PrimOpts = {}) {
    const { min, max } = shapeBounds(spec);
    const size: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    const centre = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    return this.add({ kind: 'shape', pos, rot: o.rot ?? [0, 0, 0], size, extra: centre, shape: spec, material, detail: o.detail ?? 0, collide: o.collide ?? true });
  }
  /** A row of bolt heads / rivets. Pure greeble: never collides, first to go in LODs. */
  bolts(from: Vec3, to: Vec3, n: number, r: number, normal: Axis, material: MaterialId = 'steel') {
    const rot: Vec3 = normal === 'x' ? [0, 0, Math.PI / 2] : normal === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      this.cyl([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t], r, r * 0.8, material, { rot, detail: 2, collide: false, segments: 6 });
    }
    return this;
  }
  /** Get (or create) a component child node: separable, hideable sub-assembly of this link. */
  comp(kind: ComponentKind, suffix = ''): NodeRef {
    const name = `${this.node.name}__${kind}${suffix ? '_' + suffix : ''}`;
    const existing = this.b.find(name);
    if (existing) return existing;
    return this.b.node(name, this.node.name, [0, 0, 0], { role: 'component', component: kind, system: this.node.system });
  }
  child(name: string, pos: Vec3, opts: NodeOpts = {}) {
    return this.b.node(name, this.node.name, pos, { system: this.node.system, ...opts });
  }
}

interface PistonReq {
  name: string;
  /** the link axis the anchors run along ('y' hanging limbs, 'z' sprawled limbs / booms) */
  along?: 'y' | 'z';
  /** x of the member surface the bracket is welded to (side-mounted rams get a standoff) */
  mountA?: number;
  mountB?: number;
  linkA: string;
  anchorA: Vec3;
  linkB: string;
  anchorB: Vec3;
  radius: number;
  drives: string;
  system: string;
}

interface CableReq {
  name: string;
  from: string;
  fromOffset: Vec3;
  to: string;
  toOffset: Vec3;
  radius: number;
  system: string;
}

interface LegReq {
  name: string;
  side: 'L' | 'R' | 'C';
  index: number;
  style: LegChain['style'];
  joints: string[];
  footNode: string;
  contactOffset: Vec3;
  gaitPhase: number;
}

export class Builder {
  nodes: MechNode[] = [];
  private byName = new Map<string, NodeRef>();
  private pistons: PistonReq[] = [];
  private cableReqs: CableReq[] = [];
  private legReqs: LegReq[] = [];
  arms: ArmChain[] = [];
  mounts: Mount[] = [];
  interiors: InteriorSpace[] = [];
  maker = 'generic';
  gait: GaitHint = { type: 'biped-walk', stepHeight: 0.3, strideLength: 1, cycleSeconds: 1.6, bodyHeight: 0, groups: [] };

  constructor(
    readonly name: string,
    readonly family: string,
    readonly palette: Record<MaterialId, PaletteEntry>,
  ) {}

  find(name: string) {
    return this.byName.get(name);
  }
  get(name: string): NodeRef {
    const r = this.byName.get(name);
    if (!r) throw new Error(`BadMech builder: unknown node '${name}'`);
    return r;
  }

  node(name: string, parent: string | null, pos: Vec3, opts: NodeOpts = {}): NodeRef {
    if (this.byName.has(name)) throw new Error(`BadMech builder: duplicate node '${name}'`);
    const q = new Quaternion().setFromEuler(new Euler(...(opts.rot ?? [0, 0, 0]), 'XYZ'));
    const n: MechNode = {
      name,
      parent,
      children: [],
      role: opts.role ?? (opts.joint ? 'link' : 'group'),
      system: opts.system ?? (parent ? this.get(parent).node.system : 'root'),
      component: opts.component,
      position: [...pos] as Vec3,
      quaternion: [q.x, q.y, q.z, q.w] as Quat,
      prims: [],
      tags: opts.tags ?? [],
    };
    if (opts.joint) {
      const j = opts.joint;
      if (!(j.min <= 0 && j.max >= 0)) throw new Error(`joint ${name}: limits must bracket rest (0)`);
      n.joint = { axis: j.axis, min: j.min * DEG, max: j.max * DEG, purpose: j.purpose, kind: j.kind, maxSpeed: j.maxSpeed ?? defaultSpeed(j.purpose) };
    }
    if (parent) this.get(parent).node.children.push(name);
    this.nodes.push(n);
    const ref = new NodeRef(this, n);
    this.byName.set(name, ref);
    return ref;
  }

  piston(req: Omit<PistonReq, 'system'> & { system?: string }) {
    this.pistons.push({ ...req, system: req.system ?? this.get(req.linkA).node.system });
  }
  cable(req: Omit<CableReq, 'system'> & { system?: string }) {
    this.cableReqs.push({ ...req, system: req.system ?? this.get(req.from).node.system });
  }
  leg(req: LegReq) {
    this.legReqs.push(req);
  }

  /** Resolve pistons, cables, leg metadata and stats into a finished Mech. */
  finalize(sizeClass: string): Mech {
    const mech: Mech = {
      name: this.name,
      family: this.family,
      maker: this.maker,
      nodes: this.nodes,
      actuators: [],
      cables: [],
      legs: [],
      arms: this.arms,
      mounts: this.mounts,
      interiors: this.interiors,
      gait: this.gait,
      palette: this.palette,
      stats: { height: 0, width: 0, length: 0, estimatedMassTonnes: 0, sizeClass },
    };

    for (const p of this.pistons) this.resolvePiston(mech, p);
    for (const c of this.cableReqs) this.resolveCable(mech, c);

    const rest = worldMatrices(mech, {});
    for (const l of this.legReqs) mech.legs.push(resolveLeg(mech, l, rest));

    // stats from collidable prim bounds
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    let volume = 0;
    for (const n of mech.nodes) {
      const w = rest.get(n.name)!;
      for (const p of n.prims) {
        for (const c of primCorners(p)) {
          c.applyMatrix4(w);
          min.min(c);
          max.max(c);
        }
        if (p.collide && n.component !== 'interior') volume += primVolume(p);
      }
    }
    mech.stats.height = round(max.y - Math.min(0, min.y), 2);
    mech.stats.width = round(max.x - min.x, 2);
    mech.stats.length = round(max.z - min.z, 2);
    // armoured steel machines with lots of void: ~1.1 t per m^3 of solid-ish prim volume
    mech.stats.estimatedMassTonnes = round(volume * 1.1, 1);
    return mech;
  }

  private resolvePiston(mech: Mech, p: PistonReq) {
    const driven = mech.nodes.find((n) => n.name === p.drives)!;
    if (!driven?.joint) throw new Error(`piston ${p.name}: drives '${p.drives}' which is not a joint`);
    const j = driven.joint;
    const margin = p.radius * 2.2;
    // Keep the ram out of the steel first (this moves the anchors, so it must happen before the
    // stroke is measured and the barrel/rod are sized).
    this.clearRamPath(mech, p);

    const lengthAt = (angle: number) => {
      const w = worldMatrices(mech, { [p.drives]: angle });
      const a = new Vector3(...p.anchorA).applyMatrix4(w.get(p.linkA)!);
      const b = new Vector3(...p.anchorB).applyMatrix4(w.get(p.linkB)!);
      return a.distanceTo(b);
    };
    const span = (lo: number, hi: number) => {
      let mn = Infinity;
      let mx = -Infinity;
      for (let i = 0; i <= 24; i++) {
        const L = lengthAt(lo + ((hi - lo) * i) / 24);
        mn = Math.min(mn, L);
        mx = Math.max(mx, L);
      }
      return [mn, mx];
    };
    // A real hydraulic ram can only extend to ~1.8x its retracted length. If the joint asks for
    // more, tighten the joint limits symmetrically-ish until the ram is buildable.
    let [mn, mx] = span(j.min, j.max);
    let guard = 0;
    while (mx > 1.8 * (mn - margin) && guard++ < 40) {
      j.min *= 0.93;
      j.max *= 0.93;
      [mn, mx] = span(j.min, j.max);
    }
    const restLen = lengthAt(0);
    const barrel = Math.max(0.05, mn - margin);
    const rod = Math.max(mx - barrel * 0.85, 0.05);

    // Barrel node on link A, rod node on link B; both aimed at each other at rest.
    const rest = worldMatrices(mech, {});
    const wa = new Vector3(...p.anchorA).applyMatrix4(rest.get(p.linkA)!);
    const wb = new Vector3(...p.anchorB).applyMatrix4(rest.get(p.linkB)!);
    const qa = aimQuat(rest.get(p.linkA)!, wb.clone().sub(wa));
    const qb = aimQuat(rest.get(p.linkB)!, wa.clone().sub(wb));
    const toEuler = (q: Quaternion): Vec3 => {
      const e = new Euler().setFromQuaternion(q, 'XYZ');
      return [e.x, e.y, e.z];
    };
    const base = this.node(`${p.name}_barrel`, p.linkA, p.anchorA, { role: 'actuator', system: p.system, rot: toEuler(qa), component: 'actuator', tags: ['piston-barrel'] });
    const end = this.node(`${p.name}_rod`, p.linkB, p.anchorB, { role: 'actuator', system: p.system, rot: toEuler(qb), component: 'actuator', tags: ['piston-rod'] });
    const r = p.radius;
    // barrel (lathe-turned: end cap, body, gland nut) and chrome rod with eye, both on the
    // aim-constrained actuator nodes; clevis brackets live on the LINKS at the anchors
    base.shape([0, 0, 0], barrelShape(barrel, r), 'hazard', { collide: false });
    base.cylX([0, 0, 0], r * 0.62, r * 1.5, 'steel', { detail: 1, collide: false, segments: 10 });
    // hydraulic port on the barrel
    base.shape([0, r * 1.05, barrel * 0.18], { t: 'lathe', pts: [[0, 0], [r * 0.28, 0], [r * 0.28, r * 0.35], [r * 0.18, r * 0.42], [0, r * 0.42]], segs: 8 }, 'steel', { detail: 2, collide: false });
    end.shape([0, 0, 0], rodShape(rod, r), 'chrome', { collide: false });
    end.cylX([0, 0, 0], r * 0.5, r * 1.3, 'steel', { detail: 1, collide: false, segments: 10 });
    const towards = (v: Vec3): [number, number] => (Math.abs(v[2]) >= Math.abs(v[1]) ? [0, -v[2]] : [-v[1], 0]);
    const mount = (link: string, a: Vec3, rr: number, gap: number, mx?: number) => {
      const ref = this.get(link).comp('detail', 'mounts');
      if (mx === undefined) {
        clevis(ref, a, rr, gap, towards(a));
        return;
      }
      // side mount: short clevis + a filleted standoff block bridging to the member's flank
      clevis(ref, a, rr, gap, [0, 0]);
      const inner = a[0] - Math.sign(a[0]) * (gap / 2 + rr * 0.36);
      const len = Math.abs(inner - mx);
      if (len > 1e-3) block(ref, [(inner + mx) / 2, a[1], a[2]], [len, rr * 2.1, rr * 2.1], 'darkMetal', { r: rr * 0.4, collide: false, detail: 1 });
    };
    mount(p.linkA, p.anchorA, r * 0.85, r * 1.6, p.mountA);
    mount(p.linkB, p.anchorB, r * 0.75, r * 1.4, p.mountB);

    mech.actuators.push({
      name: p.name,
      type: 'piston',
      baseNode: base.name,
      endNode: end.name,
      baseLink: p.linkA,
      endLink: p.linkB,
      drives: p.drives,
      restLength: round(restLen, 4),
      minLength: round(mn, 4),
      maxLength: round(mx, 4),
      barrelLength: round(barrel, 4),
      rodLength: round(rod, 4),
    });
  }

  private clearRamPath(mech: Mech, p: PistonReq) {
    const j = mech.nodes.find((n) => n.name === p.drives)!.joint!;
    const solids = (link: string) => {
      const out: { node: string; prim: Prim }[] = [];
      const visit = (name: string) => {
        const n = this.get(name).node;
        for (const prim of n.prims) if (prim.collide && prim.detail === 0 && !prim.hidden) out.push({ node: name, prim });
        for (const c of n.children) if (!this.get(c).node.joint && this.get(c).node.role !== 'actuator') visit(c);
      };
      visit(link);
      return out;
    };
    const parts = [...solids(p.linkA), ...solids(p.linkB)];
    const along = p.along ?? 'y';
    const push = (a: Vec3, k: number): Vec3 => {
      const v = new Vector3(a[0], along === 'y' ? 0 : a[1], along === 'z' ? 0 : a[2]);
      if (v.lengthSq() < 1e-10) return a;
      v.normalize().multiplyScalar(k);
      return [a[0] + v.x, a[1] + v.y, a[2] + v.z];
    };
    const blocked = () => {
      for (const ang of [0, j.min, j.max]) {
        const w = worldMatrices(mech, { [p.drives]: ang });
        const A = new Vector3(...p.anchorA).applyMatrix4(w.get(p.linkA)!);
        const B = new Vector3(...p.anchorB).applyMatrix4(w.get(p.linkB)!);
        for (const { node, prim } of parts) {
          const inv = w.get(node)!.clone().multiply(primMatrix(prim)).invert();
          const h = primHalfExtents(prim).addScalar(p.radius * 0.9);
          for (let i = 1; i < 9; i++) {
            const q = A.clone().lerp(B, 0.15 + (0.7 * i) / 9).applyMatrix4(inv);
            if (Math.abs(q.x) < h.x && Math.abs(q.y) < h.y && Math.abs(q.z) < h.z) return true;
          }
        }
      }
      return false;
    };
    for (let i = 0; i < 10 && blocked(); i++) {
      p.anchorA = push(p.anchorA, p.radius * 0.8);
      p.anchorB = push(p.anchorB, p.radius * 0.8);
    }
  }

  private resolveCable(mech: Mech, c: CableReq) {
    const rest = worldMatrices(mech, {});
    const a = new Vector3(...c.fromOffset).applyMatrix4(rest.get(c.from)!);
    const b = new Vector3(...c.toOffset).applyMatrix4(rest.get(c.to)!);
    mech.cables.push({
      name: c.name,
      type: 'flex-hose',
      fromNode: c.from,
      fromOffset: c.fromOffset,
      toNode: c.to,
      toOffset: c.toOffset,
      radius: c.radius,
      slack: round(a.distanceTo(b) * 0.35 + 0.05, 3),
      meshNode: `${c.name}_skin`,
    });
  }
}

function aimQuat(parentWorld: Matrix4, dirWorld: Vector3): Quaternion {
  const pq = new Quaternion();
  parentWorld.decompose(new Vector3(), pq, new Vector3());
  const local = dirWorld.clone().normalize().applyQuaternion(pq.clone().invert());
  return new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), local);
}

function resolveLeg(mech: Mech, l: LegReq, rest: Map<string, Matrix4>): LegChain {
  const contact = new Vector3(...l.contactOffset).applyMatrix4(rest.get(l.footNode)!);
  const hip = new Vector3().setFromMatrixPosition(rest.get(l.joints[0])!);
  const restReach = hip.distanceTo(contact);
  // sample the chain's workspace for reach limits
  const rng = new Rng(`${mech.name}:${l.name}:reach`);
  let minR = restReach;
  let maxR = restReach;
  const byName = new Map(mech.nodes.map((n) => [n.name, n]));
  for (let i = 0; i < 160; i++) {
    const pose: Record<string, number> = {};
    for (const jn of l.joints) {
      const j = byName.get(jn)!.joint!;
      pose[jn] = rng.range(j.min, j.max);
    }
    const w = worldMatrices(mech, pose);
    const c = new Vector3(...l.contactOffset).applyMatrix4(w.get(l.footNode)!);
    const h = new Vector3().setFromMatrixPosition(w.get(l.joints[0])!);
    const d = h.distanceTo(c);
    minR = Math.min(minR, d);
    maxR = Math.max(maxR, d);
  }
  return {
    name: l.name,
    side: l.side,
    index: l.index,
    style: l.style,
    joints: l.joints,
    footNode: l.footNode,
    contactOffset: l.contactOffset,
    restContact: [round(contact.x, 4), round(contact.y, 4), round(contact.z, 4)],
    restReach: round(restReach, 4),
    minReach: round(minR, 4),
    maxReach: round(maxR, 4),
    gaitPhase: l.gaitPhase,
  };
}

function defaultSpeed(p: JointPurpose) {
  switch (p) {
    case 'locomotion':
      return 2.5;
    case 'aim':
      return 1.5;
    case 'torso':
      return 1.0;
    case 'access':
      return 0.8;
    default:
      return 1.8;
  }
}

export function round(v: number, d: number) {
  const k = 10 ** d;
  return Math.round(v * k) / k;
}

/** Placement of a prim's own geometry (node-local): translate(pos) * rotate(rot). */
export function primBaseMatrix(p: Prim, out = new Matrix4()): Matrix4 {
  return out.compose(new Vector3(...p.pos), new Quaternion().setFromEuler(new Euler(...p.rot, 'XYZ')), new Vector3(1, 1, 1));
}

/** Transform of a prim's (centred) bounding box, node-local. Shapes may be off-centre. */
export function primMatrix(p: Prim, out = new Matrix4()): Matrix4 {
  primBaseMatrix(p, out);
  if (p.kind === 'shape' && p.extra) out.multiply(new Matrix4().makeTranslation(p.extra[0], p.extra[1], p.extra[2]));
  return out;
}

/** Half extents of a prim's local bounding box (before primMatrix). */
export function primHalfExtents(p: Prim): Vector3 {
  switch (p.kind) {
    case 'cyl': {
      const r = Math.max(p.size[0], p.size[2]);
      return new Vector3(r, p.size[1] / 2, r);
    }
    case 'sphere':
      return new Vector3(p.size[0], p.size[0], p.size[0]);
    case 'taper': {
      const [sx, sz, ox, oz] = p.extra!;
      const hx = Math.max(p.size[0] / 2, (p.size[0] * sx) / 2 + Math.abs(ox));
      const hz = Math.max(p.size[2] / 2, (p.size[2] * sz) / 2 + Math.abs(oz));
      return new Vector3(hx, p.size[1] / 2, hz);
    }
    default:
      return new Vector3(p.size[0] / 2, p.size[1] / 2, p.size[2] / 2);
  }
}

export function primCorners(p: Prim): Vector3[] {
  const h = primHalfExtents(p);
  const m = primMatrix(p);
  const out: Vector3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) out.push(new Vector3(sx * h.x, sy * h.y, sz * h.z).applyMatrix4(m));
  return out;
}

export function primVolume(p: Prim): number {
  switch (p.kind) {
    case 'cyl':
      return Math.PI * ((p.size[0] + p.size[2]) / 2) ** 2 * p.size[1];
    case 'sphere':
      return (4 / 3) * Math.PI * p.size[0] ** 3;
    default:
      return p.size[0] * p.size[1] * p.size[2] * 0.85;
  }
}
