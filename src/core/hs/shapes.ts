/**
 * ShapeSpec: a small, JSON-serialisable description of a hard-surface part, turned into a mesh
 * on demand (per LOD). Shapes live inside Prims ("shape" kind), so collision proxies, clearance
 * validation, LODs and exporters treat them exactly like the old primitives.
 *
 *   loft    — cross-sections of (possibly different) profiles along an axis: tapered beams,
 *             curved armour, torso hulls, canopies. Optional chamfered caps + recessed panels.
 *   lathe   — revolve an (r, y) outline: bearings, hubs, glands, barrels, toes, domes.
 *   tube    — sweep a circle along a polyline: rails, hand-holds, roll cages.
 */
import { offset, P2, Profile, rect, RectOpts, ngon, triangulate, treatCorners } from './profile';
import { TriSoup, V3 } from './mesh';
import type { MeshData } from '../geometry';

export type ProfileSpec =
  | ({ k: 'rect'; w: number; h: number } & RectOpts)
  | { k: 'ngon'; r: number; n: number; rot?: number }
  | { k: 'pts'; pts: P2[]; r?: number | number[]; segs?: number };

export interface Section {
  p: ProfileSpec;
  z: number;
  sx?: number;
  sy?: number;
  ox?: number;
  oy?: number;
}

export interface Recess {
  /** which cap gets the panel */
  at: 'start' | 'end';
  inset: number;
  depth: number;
  /** grille slats across the recess (count) */
  slats?: number;
}

export type ShapeSpec =
  | { t: 'loft'; sections: Section[]; bevel?: number; cap?: 'both' | 'start' | 'end' | 'none'; axis?: 'x' | 'y' | 'z'; recess?: Recess[]; smooth?: number }
  | { t: 'lathe'; pts: P2[]; segs: number; axis?: 'x' | 'y' | 'z'; smooth?: number; arc?: number }
  | { t: 'tube'; path: V3[]; r: number; segs: number };

export interface ShapeLod {
  /** multiply curve segments */
  segScale: number;
  /** keep recesses / slats */
  surfaceDetail: boolean;
}
export const SHAPE_LOD: ShapeLod[] = [
  { segScale: 1, surfaceDetail: true },
  { segScale: 0.5, surfaceDetail: true },
  { segScale: 0.25, surfaceDetail: false },
];

function lodSegs(s: number | undefined, l: ShapeLod, min = 1) {
  return Math.max(min, Math.round((s ?? 1) * l.segScale));
}

export function buildProfile(p: ProfileSpec, l: ShapeLod): Profile {
  switch (p.k) {
    case 'rect':
      return rect(p.w, p.h, { ...p, segs: lodSegs(p.segs, l), edgeSegs: p.edgeSegs ? lodSegs(p.edgeSegs, l, 2) : 0 });
    case 'ngon':
      return ngon(p.r, p.n, p.rot ?? 0);
    case 'pts':
      return p.r ? treatCorners(p.pts, p.r, lodSegs(p.segs, l)) : p.pts.map((q) => [q[0], q[1]] as P2);
  }
}

const AXIS: Record<'x' | 'y' | 'z', (p: V3) => V3> = {
  z: (p) => p,
  y: (p) => [p[0], p[2], -p[1]],
  x: (p) => [p[2], p[1], -p[0]],
};

export function buildShape(s: ShapeSpec, lod = 0): MeshData {
  const l = SHAPE_LOD[lod] ?? SHAPE_LOD[0];
  switch (s.t) {
    case 'loft':
      return loft(s, l);
    case 'lathe':
      return lathe(s, l);
    case 'tube':
      return tube(s, l);
  }
}

function loft(s: Extract<ShapeSpec, { t: 'loft' }>, l: ShapeLod): MeshData {
  const soup = new TriSoup();
  // resolve sections to 3D loops
  let rings: { loop: Profile; z: number }[] = s.sections.map((sec) => {
    const base = buildProfile(sec.p, l);
    return { loop: base.map(([x, y]) => [x * (sec.sx ?? 1) + (sec.ox ?? 0), y * (sec.sy ?? 1) + (sec.oy ?? 0)] as P2), z: sec.z };
  });
  const n = rings[0].loop.length;
  for (const r of rings) if (r.loop.length !== n) throw new Error(`loft: section vertex counts differ (${n} vs ${r.loop.length})`);
  const cap = s.cap ?? 'both';
  const b = s.bevel ?? 0;
  if (b > 0) {
    const first = rings[0];
    const last = rings[rings.length - 1];
    const dir = Math.sign(last.z - first.z) || 1;
    const nr = [{ loop: offset(first.loop, -b), z: first.z }, { loop: first.loop, z: first.z + b * dir }, ...rings.slice(1, -1), { loop: last.loop, z: last.z - b * dir }, { loop: offset(last.loop, -b), z: last.z }];
    rings = cap === 'start' ? [nr[0], nr[1], ...rings.slice(1)] : cap === 'end' ? [...rings.slice(0, -1), nr[nr.length - 2], nr[nr.length - 1]] : cap === 'none' ? rings : nr;
  }
  const dir = Math.sign(rings[rings.length - 1].z - rings[0].z) || 1;
  // sides
  for (let i = 0; i < rings.length - 1; i++) {
    const A = rings[i];
    const B = rings[i + 1];
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const a: V3 = [A.loop[k][0], A.loop[k][1], A.z];
      const b2: V3 = [A.loop[k2][0], A.loop[k2][1], A.z];
      const c: V3 = [B.loop[k2][0], B.loop[k2][1], B.z];
      const d: V3 = [B.loop[k][0], B.loop[k][1], B.z];
      if (dir > 0) soup.quad(a, b2, c, d);
      else soup.quad(a, d, c, b2);
    }
  }
  const recesses = l.surfaceDetail ? s.recess ?? [] : [];
  const capRing = (r: { loop: Profile; z: number }, outward: number, rec?: Recess) => {
    // outward: +1 if cap normal = +Z
    if (!rec) {
      const tri = triangulate(r.loop);
      for (let i = 0; i < tri.length; i += 3) {
        const p = tri.slice(i, i + 3).map((j) => [r.loop[j][0], r.loop[j][1], r.z] as V3);
        if (outward > 0) soup.tri(p[0], p[1], p[2]);
        else soup.tri(p[0], p[2], p[1]);
      }
      return;
    }
    const inner = offset(r.loop, -rec.inset);
    const zIn = r.z - outward * rec.depth;
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const o1: V3 = [r.loop[k][0], r.loop[k][1], r.z];
      const o2: V3 = [r.loop[k2][0], r.loop[k2][1], r.z];
      const i1: V3 = [inner[k][0], inner[k][1], r.z];
      const i2: V3 = [inner[k2][0], inner[k2][1], r.z];
      const d1: V3 = [inner[k][0], inner[k][1], zIn];
      const d2: V3 = [inner[k2][0], inner[k2][1], zIn];
      if (outward > 0) {
        soup.quad(o1, o2, i2, i1); // rim
        soup.quad(i1, i2, d2, d1); // recess wall (faces inward)
      } else {
        soup.quad(o1, i1, i2, o2);
        soup.quad(i1, d1, d2, i2);
      }
    }
    const tri = triangulate(inner);
    for (let i = 0; i < tri.length; i += 3) {
      const p = tri.slice(i, i + 3).map((j) => [inner[j][0], inner[j][1], zIn] as V3);
      if (outward > 0) soup.tri(p[0], p[1], p[2]);
      else soup.tri(p[0], p[2], p[1]);
    }
    if (rec.slats) {
      // horizontal louvre bars inside the recess
      let minY = Infinity;
      let maxY = -Infinity;
      let minX = Infinity;
      let maxX = -Infinity;
      for (const [x, y] of inner) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      const h = (maxY - minY) / rec.slats;
      for (let i = 0; i < rec.slats; i++) {
        const y = minY + h * (i + 0.5);
        const x0 = minX + rec.inset * 0.3;
        const x1 = maxX - rec.inset * 0.3;
        const th = h * 0.28;
        const zf = zIn + outward * rec.depth * 0.85;
        const zb = zIn;
        // a slanted slat: front edge higher than back edge
        const q = (x: number, yy: number, z: number): V3 => [x, yy, z];
        const a = q(x0, y + th, zf);
        const bb = q(x1, y + th, zf);
        const c = q(x1, y - th, zb);
        const d = q(x0, y - th, zb);
        if (outward > 0) soup.quad(d, c, bb, a);
        else soup.quad(a, bb, c, d);
      }
    }
  };
  const recStart = recesses.find((r) => r.at === 'start');
  const recEnd = recesses.find((r) => r.at === 'end');
  if (cap === 'both' || cap === 'start') capRing(rings[0], -dir, recStart);
  if (cap === 'both' || cap === 'end') capRing(rings[rings.length - 1], dir, recEnd);
  const ax = AXIS[s.axis ?? 'z'];
  return soup.build(s.smooth ?? 35, ax, ax);
}

function lathe(s: Extract<ShapeSpec, { t: 'lathe' }>, l: ShapeLod): MeshData {
  const soup = new TriSoup();
  const segs = Math.max(5, Math.round(s.segs * l.segScale));
  const arc = s.arc ?? Math.PI * 2;
  const full = arc >= Math.PI * 2 - 1e-6;
  const pts = s.pts;
  const ring = (a: number) => pts.map(([r, y]) => [Math.cos(a) * r, y, Math.sin(a) * r] as V3);
  const rings: V3[][] = [];
  for (let i = 0; i <= segs; i++) rings.push(ring((i / segs) * arc));
  for (let i = 0; i < segs; i++) {
    const A = rings[i];
    const B = rings[i + 1];
    for (let k = 0; k < pts.length - 1; k++) {
      soup.quad(A[k], A[k + 1], B[k + 1], B[k]);
    }
  }
  void full;
  // y-axis spin; remap so the lathe axis is the requested local axis (default y)
  const map: Record<string, (p: V3) => V3> = { y: (p) => p, x: (p) => [p[1], -p[0], p[2]], z: (p) => [p[0], -p[2], p[1]] };
  const ax = map[s.axis ?? 'y'];
  return soup.build(s.smooth ?? 40, ax, ax);
}

function tube(s: Extract<ShapeSpec, { t: 'tube' }>, l: ShapeLod): MeshData {
  const soup = new TriSoup();
  const segs = Math.max(4, Math.round(s.segs * l.segScale));
  const P = s.path;
  let prevSide: V3 | null = null;
  const rings: V3[][] = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[Math.max(0, i - 1)];
    const b = P[Math.min(P.length - 1, i + 1)];
    let t: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const tl = Math.hypot(...t) || 1;
    t = [t[0] / tl, t[1] / tl, t[2] / tl];
    let side: V3 = prevSide ?? (Math.abs(t[1]) < 0.9 ? cross(t, [0, 1, 0]) : cross(t, [1, 0, 0]));
    const dp = side[0] * t[0] + side[1] * t[1] + side[2] * t[2];
    side = normv([side[0] - t[0] * dp, side[1] - t[1] * dp, side[2] - t[2] * dp]);
    prevSide = side;
    const bin = cross(t, side);
    const r: V3[] = [];
    for (let k = 0; k < segs; k++) {
      const an = (k / segs) * Math.PI * 2;
      const c = Math.cos(an);
      const sn = Math.sin(an);
      r.push([P[i][0] + (side[0] * c + bin[0] * sn) * s.r, P[i][1] + (side[1] * c + bin[1] * sn) * s.r, P[i][2] + (side[2] * c + bin[2] * sn) * s.r]);
    }
    rings.push(r);
  }
  for (let i = 0; i < rings.length - 1; i++)
    for (let k = 0; k < segs; k++) {
      const k2 = (k + 1) % segs;
      soup.quad(rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]);
    }
  // end caps
  for (const [ri, flip] of [
    [0, true],
    [rings.length - 1, false],
  ] as const) {
    const r = rings[ri];
    for (let k = 1; k < segs - 1; k++) {
      if (flip) soup.tri(r[0], r[k + 1], r[k]);
      else soup.tri(r[0], r[k], r[k + 1]);
    }
  }
  return soup.build(50);
}

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normv(a: V3): V3 {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** Axis-aligned bounds of a shape (LOD0) — used to centre it and to give it a collision box. */
export function shapeBounds(s: ShapeSpec): { min: V3; max: V3 } {
  const m = buildShape(s, 0);
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], m.positions[i + k]);
      max[k] = Math.max(max[k], m.positions[i + k]);
    }
  return { min, max };
}
