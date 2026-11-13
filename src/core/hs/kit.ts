/**
 * Hard-surface kit: mid-level mechanical assemblies built on the shape kernel.
 * Each function places geometry around a mechanical fact (a pivot, an axis, an anchor, a load
 * path) rather than decorating at random.
 */
import type { NodeRef } from '../builder';
import type { Axis, MaterialId, Vec3 } from '../model';
import type { P2 } from './profile';
import type { ProfileSpec, Section, ShapeSpec } from './shapes';

const PI = Math.PI;

// ─────────────────────────────────────────────────────────── bearings ──

export interface HubOpts {
  /** outer housing radius */
  r: number;
  /** total width along the axis */
  w: number;
  housing?: MaterialId;
  cap?: MaterialId;
  bolts?: number;
  detail?: 0 | 1 | 2;
  collide?: boolean;
}

/**
 * Bearing hub centred on a pivot, spinning about `axis` — housing ring, raised races, end caps
 * with a centre boss, and a bolt circle on each face. Built from one lathe outline.
 */
export function hub(ref: NodeRef, pos: Vec3, axis: Axis, o: HubOpts) {
  const { r, w } = o;
  const h = w / 2;
  const c = Math.min(r * 0.12, h * 0.25);
  // outline (radius, along-axis) from centre-face outward and around: symmetric about 0
  const pts: P2[] = [
    [0, -h - r * 0.08],
    [r * 0.28, -h - r * 0.08],
    [r * 0.34, -h - r * 0.02],
    [r * 0.62, -h],
    [r * 0.66, -h + c * 0.4],
    [r * 0.8, -h + c * 0.4],
    [r - c, -h + c * 0.4],
    [r, -h + c * 1.4],
    [r, h - c * 1.4],
    [r - c, h - c * 0.4],
    [r * 0.8, h - c * 0.4],
    [r * 0.66, h - c * 0.4],
    [r * 0.62, h],
    [r * 0.34, h + r * 0.02],
    [r * 0.28, h + r * 0.08],
    [0, h + r * 0.08],
  ];
  ref.shape(pos, { t: 'lathe', pts, segs: 20, axis }, o.housing ?? 'darkMetal', { detail: o.detail ?? 0, collide: o.collide ?? true });
  // centre pin caps
  const pin: P2[] = [
    [0, -h - r * 0.16],
    [r * 0.18, -h - r * 0.16],
    [r * 0.22, -h - r * 0.08],
    [r * 0.22, h + r * 0.08],
    [r * 0.18, h + r * 0.16],
    [0, h + r * 0.16],
  ];
  ref.shape(pos, { t: 'lathe', pts: pin, segs: 14, axis }, o.cap ?? 'steel', { detail: 1, collide: false });
  const nb = o.bolts ?? 8;
  if (nb > 0) boltCircle(ref, pos, axis, r * 0.72, nb, r * 0.07, h);
}

/** Hex bolt heads on both faces of a hub. */
export function boltCircle(ref: NodeRef, pos: Vec3, axis: Axis, rr: number, n: number, br: number, faceOff: number) {
  for (const side of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * PI * 2;
      const u = Math.cos(a) * rr;
      const v = Math.sin(a) * rr;
      const along = side * (faceOff + br * 0.25);
      const p: Vec3 = axis === 'x' ? [pos[0] + along, pos[1] + u, pos[2] + v] : axis === 'y' ? [pos[0] + u, pos[1] + along, pos[2] + v] : [pos[0] + u, pos[1] + v, pos[2] + along];
      ref.shape(p, { t: 'loft', sections: [{ p: { k: 'ngon', r: br, n: 6 }, z: -br * 0.25 }, { p: { k: 'ngon', r: br * 0.8, n: 6 }, z: br * 0.25 }], cap: side > 0 ? 'end' : 'start', axis, smooth: 20 }, 'steel', { detail: 2, collide: false });
    }
  }
}

/** Slewing ring for vertical yaw joints: flat toothed ring with a bolt circle. */
export function slewRing(ref: NodeRef, pos: Vec3, r: number, h: number) {
  const pts: P2[] = [
    [r * 0.5, -h / 2],
    [r * 0.95, -h / 2],
    [r, -h * 0.3],
    [r, h * 0.3],
    [r * 0.95, h / 2],
    [r * 0.5, h / 2],
    [r * 0.5, -h / 2],
  ];
  ref.shape(pos, { t: 'lathe', pts, segs: 28, axis: 'y' }, 'steel', { collide: true });
  boltCircle(ref, [pos[0], pos[1], pos[2]], 'y', r * 0.72, 12, r * 0.05, h / 2);
}

// ─────────────────────────────────────────────────────── limb members ──

export interface MemberOpts {
  /** cross-section width (X) and depth (front-back) at the waist */
  w: number;
  d: number;
  /** flare at the two ends, as a factor (wraps the bearings) */
  flareTop?: number;
  flareBottom?: number;
  /** corner radius as fraction of min(w,d) */
  round?: number;
  material?: MaterialId;
  /** shift the waist forward/back (Z) – banana-shaped limbs */
  bow?: number;
  /** lightening cut-outs (recessed) on the sides */
  pockets?: boolean;
  detail?: 0 | 1 | 2;
  /** offset of the member's axis from the node origin */
  at?: Vec3;
}

/**
 * The main structural member of a limb segment, hanging from the pivot along -Y for length L:
 * a lofted box-section that flares around both bearings and waists in the middle, with filleted
 * edges — the "bone" every other part bolts to.
 */
export function memberDown(ref: NodeRef, L: number, o: MemberOpts) {
  const ft = o.flareTop ?? 1.15;
  const fb = o.flareBottom ?? 1.05;
  const rr = (o.round ?? 0.28) * Math.min(o.w, o.d);
  const sec = (z: number, s: number, dz = 0): Section => ({ p: { k: 'rect', w: o.w * s, h: o.d * s, r: rr * s, segs: 3 }, z, oy: -dz });
  const bow = o.bow ?? 0;
  const spec: ShapeSpec = {
    t: 'loft',
    axis: 'y',
    sections: [sec(0, ft * 0.8), sec(-L * 0.06, ft), sec(-L * 0.22, 0.92, bow * 0.6), sec(-L * 0.5, 0.82, bow), sec(-L * 0.78, 0.92, bow * 0.6), sec(-L * 0.94, fb), sec(-L, fb * 0.8)],
    smooth: 32,
  };
  ref.shape(o.at ?? [0, 0, 0], spec, o.material ?? 'darkMetal', { detail: o.detail ?? 0 });
  if (o.pockets) {
    // recessed lightening pockets on both flanks (as thin recessed plates)
    for (const sx of [-1, 1]) {
      ref.shape([sx * o.w * 0.42, -L * 0.5, -bow], {
        t: 'loft',
        axis: 'x',
        sections: [{ p: { k: 'rect', w: o.d * 0.5, h: L * 0.42, r: o.d * 0.12, segs: 2 }, z: -o.w * 0.06 }, { p: { k: 'rect', w: o.d * 0.5, h: L * 0.42, r: o.d * 0.12, segs: 2 }, z: o.w * 0.06 }],
        bevel: o.w * 0.02,
        recess: [{ at: sx > 0 ? 'end' : 'start', inset: o.d * 0.05, depth: o.w * 0.06 }],
      }, o.material ?? 'darkMetal', { detail: 1, collide: false, rot: [0, 0, 0] });
    }
  }
}

/** Same member, pointing OUT along +Z (spider legs, booms). Up is +Y. */
export function memberOut(ref: NodeRef, L: number, o: MemberOpts) {
  const ft = o.flareTop ?? 1.15;
  const fb = o.flareBottom ?? 1.05;
  const rr = (o.round ?? 0.28) * Math.min(o.w, o.d);
  const bow = o.bow ?? 0;
  const sec = (z: number, s: number, dy = 0): Section => ({ p: { k: 'rect', w: o.w * s, h: o.d * s, r: rr * s, segs: 3 }, z, oy: dy });
  ref.shape(o.at ?? [0, 0, 0], { t: 'loft', sections: [sec(0, ft * 0.8), sec(L * 0.06, ft), sec(L * 0.25, 0.9, bow * 0.6), sec(L * 0.5, 0.8, bow), sec(L * 0.75, 0.88, bow * 0.6), sec(L * 0.94, fb), sec(L, fb * 0.8)], smooth: 32 }, o.material ?? 'darkMetal', { detail: o.detail ?? 0 });
}

// ──────────────────────────────────────────────────────── armour shells ──

export interface ShellOpts {
  /** length along the segment */
  len: number;
  /** chord width of the plate */
  width: number;
  /** curvature: angular span of the arc (radians); 0.6 = flattish, 1.6 = wraps */
  span: number;
  thick: number;
  material: MaterialId;
  /** split into n panels with seams between them */
  panels?: number;
  gap?: number;
  /** scale of the plate cross-section at start / end (taper) */
  taperStart?: number;
  taperEnd?: number;
  /** sweep the plate outward (+) at the middle */
  belly?: number;
  bevel?: number;
  detail?: 0 | 1 | 2;
  collide?: boolean;
}

/** Curved band profile: outer arc + inner arc, chamfered at the band ends. CCW. */
function bandProfile(R: number, span: number, t: number, segs: number, c: number): ProfileSpec {
  const pts: P2[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = -span / 2 + (span * i) / segs;
    pts.push([Math.sin(a) * R, Math.cos(a) * R - R]);
  }
  for (let i = segs; i >= 0; i--) {
    const a = -span / 2 + (span * i) / segs;
    pts.push([Math.sin(a) * (R - t), Math.cos(a) * (R - t) - R]);
  }
  // CCW: outer arc runs left→right on top… reverse to make it CCW
  pts.reverse();
  const radii = pts.map((_, i) => (i === 0 || i === segs || i === segs + 1 || i === pts.length - 1 ? c : 0));
  return { k: 'pts', pts, r: radii, segs: 1 };
}

/**
 * Curved armour shell running along local -Y from y=y0, facing `face` (+Z front / -Z back /
 * ±X sides). Split into panels with real gaps: seams you can see, edges that catch light.
 */
export function shellDown(ref: NodeRef, y0: number, at: Vec3, face: '+z' | '-z' | '+x' | '-x', o: ShellOpts) {
  const n = o.panels ?? 1;
  const gap = o.gap ?? o.thick * 0.5;
  const segs = 8;
  const plen = (o.len - gap * (n - 1)) / n;
  const rotY = face === '+z' ? 0 : face === '-z' ? PI : face === '+x' ? PI / 2 : -PI / 2;
  for (let i = 0; i < n; i++) {
    const zs = -(plen + gap) * i;
    const t0 = lerp(o.taperStart ?? 1, o.taperEnd ?? 1, i / n);
    const t1 = lerp(o.taperStart ?? 1, o.taperEnd ?? 1, (i + 1) / n);
    const bel = o.belly ?? 0;
    const prof = bandProfile(o.width / (2 * Math.sin(o.span / 2)), o.span, o.thick, segs, o.thick * 0.45);
    // loft along -Y. AXIS 'y' maps profile (x, y) → (x, -z): so profile +y bulges toward -Z;
    // we flip the profile Y via sy = -1 so the plate bulges toward +Z (then rotate to face).
    const mid = (a: number, b: number) => (a + b) / 2;
    const bulgeAt = (u: number) => bel * Math.sin(PI * u);
    const u0 = i / n;
    const u1 = (i + 1) / n;
    const um = mid(u0, u1);
    const sections: Section[] = [
      { p: prof, z: zs, sx: t0, sy: -1, oy: -bulgeAt(u0) },
      { p: prof, z: zs - plen / 2, sx: mid(t0, t1), sy: -1, oy: -bulgeAt(um) },
      { p: prof, z: zs - plen, sx: t1, sy: -1, oy: -bulgeAt(u1) },
    ];
    ref.shape([at[0], at[1] + y0, at[2]], { t: 'loft', axis: 'y', sections, bevel: o.bevel ?? o.thick * 0.35, smooth: 28 }, o.material, { rot: [0, rotY, 0], detail: o.detail ?? 0, collide: o.collide ?? true });
  }
}

/** Same idea, along +Z (for sprawled legs / booms): plate on top (+y) by default. */
export function shellOut(ref: NodeRef, z0: number, at: Vec3, face: '+y' | '-y' | '+x' | '-x', o: ShellOpts) {
  const n = o.panels ?? 1;
  const gap = o.gap ?? o.thick * 0.5;
  const plen = (o.len - gap * (n - 1)) / n;
  const rotZ = face === '+y' ? 0 : face === '-y' ? PI : face === '+x' ? -PI / 2 : PI / 2;
  const prof = bandProfile(o.width / (2 * Math.sin(o.span / 2)), o.span, o.thick, 8, o.thick * 0.45);
  for (let i = 0; i < n; i++) {
    const zs = z0 + (plen + gap) * i;
    const t0 = lerp(o.taperStart ?? 1, o.taperEnd ?? 1, i / n);
    const t1 = lerp(o.taperStart ?? 1, o.taperEnd ?? 1, (i + 1) / n);
    const bel = o.belly ?? 0;
    const b = (u: number) => bel * Math.sin(PI * u);
    const sections: Section[] = [
      { p: prof, z: zs, sx: t0, oy: b(i / n) },
      { p: prof, z: zs + plen / 2, sx: (t0 + t1) / 2, oy: b((i + 0.5) / n) },
      { p: prof, z: zs + plen, sx: t1, oy: b((i + 1) / n) },
    ];
    ref.shape(at, { t: 'loft', sections, bevel: o.bevel ?? o.thick * 0.35, smooth: 28 }, o.material, { rot: [0, 0, rotZ], detail: o.detail ?? 0, collide: o.collide ?? true });
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ─────────────────────────────────────────────────────────── blocks ──

export interface BlockOpts {
  /** fillet/chamfer radius */
  r?: number;
  segs?: number;
  /** top face scale (x, z) */
  top?: [number, number];
  /** top face shift (x, z) */
  shift?: [number, number];
  bevel?: number;
  /** recessed panel on +Z face (front) */
  frontPanel?: { inset: number; depth: number; slats?: number };
  backPanel?: { inset: number; depth: number; slats?: number };
  detail?: 0 | 1 | 2;
  collide?: boolean;
  rot?: Vec3;
}

/**
 * A machined block / housing: filleted rounded-rect cross-section lofted front→back with a
 * taper, bevelled faces and optional recessed (or louvred) panels. Size = [w, h, d].
 */
export function block(ref: NodeRef, pos: Vec3, size: Vec3, material: MaterialId, o: BlockOpts = {}) {
  const [w, h, d] = size;
  const r = o.r ?? Math.min(w, h) * 0.12;
  const segs = o.segs ?? 2;
  const top = o.top ?? [1, 1];
  const shift = o.shift ?? [0, 0];
  // loft along Z: profile in XY. "top" scaling applies to the profile's top edge (topScale) and
  // the depth taper is expressed by scaling the back section.
  const prof = (s: number): ProfileSpec => ({ k: 'rect', w, h, r, segs, topScale: top[0], topShift: shift[0] * s });
  const rec: { at: 'start' | 'end'; inset: number; depth: number; slats?: number }[] = [];
  if (o.frontPanel) rec.push({ at: 'end', ...o.frontPanel });
  if (o.backPanel) rec.push({ at: 'start', ...o.backPanel });
  const spec: ShapeSpec = {
    t: 'loft',
    sections: [
      { p: prof(1), z: -d / 2, sx: 1, sy: 1, oy: 0 },
      { p: prof(1), z: d / 2, sx: top[1], sy: top[1], oy: shift[1] - (h * (1 - top[1])) / 2 },
    ],
    bevel: o.bevel ?? Math.min(w, h, d) * 0.06,
    recess: rec,
    smooth: 30,
  };
  ref.shape(pos, spec, material, { detail: o.detail ?? 0, collide: o.collide ?? true, rot: o.rot });
}

/** Louvred vent grille: recessed frame with slanted slats, facing +Z unless rotated. */
export function grille(ref: NodeRef, pos: Vec3, w: number, h: number, depth: number, material: MaterialId = 'darkMetal', rot: Vec3 = [0, 0, 0]) {
  const slats = Math.max(3, Math.round(h / Math.max(0.035, depth * 0.9)));
  ref.shape(pos, {
    t: 'loft',
    sections: [
      { p: { k: 'rect', w, h, r: Math.min(w, h) * 0.08, segs: 2 }, z: -depth },
      { p: { k: 'rect', w, h, r: Math.min(w, h) * 0.08, segs: 2 }, z: 0 },
    ],
    bevel: depth * 0.25,
    recess: [{ at: 'end', inset: Math.min(w, h) * 0.07, depth: depth * 0.7, slats }],
  }, material, { detail: 1, collide: false, rot });
}

/** Access hatch: a thin recessed-outline panel with a pull handle. Facing +Z unless rotated. */
export function hatchPanel(ref: NodeRef, pos: Vec3, w: number, h: number, material: MaterialId, rot: Vec3 = [0, 0, 0]) {
  const t = Math.max(0.01, Math.min(w, h) * 0.05);
  ref.shape(pos, {
    t: 'loft',
    sections: [
      { p: { k: 'rect', w, h, r: Math.min(w, h) * 0.12, segs: 2 }, z: -t },
      { p: { k: 'rect', w, h, r: Math.min(w, h) * 0.12, segs: 2 }, z: 0 },
    ],
    bevel: t * 0.3,
    recess: [{ at: 'end', inset: t * 0.6, depth: t * 0.35 }],
  }, material, { detail: 1, collide: false, rot });
}

// ─────────────────────────────────────────────────────── hydraulics ──

/** Lathe outline for a hydraulic barrel along +Z from 0 to L (clevis end at 0). */
export function barrelShape(L: number, r: number): ShapeSpec {
  const pts: P2[] = [
    [0, 0],
    [r * 0.75, 0],
    [r * 0.95, r * 0.25],
    [r * 1.12, r * 0.6],
    [r * 1.12, r * 1.3],
    [r, r * 1.45],
    [r, L - r * 1.1],
    [r * 1.14, L - r * 0.9],
    [r * 1.14, L - r * 0.25],
    [r * 0.62, L - r * 0.05],
    [r * 0.62, L],
    [0, L],
  ];
  return { t: 'lathe', pts, segs: 16, axis: 'z' };
}

export function rodShape(L: number, r: number): ShapeSpec {
  const rr = r * 0.52;
  const pts: P2[] = [
    [0, 0],
    [r * 0.55, 0],
    [r * 0.7, r * 0.35],
    [r * 0.7, r * 0.75],
    [rr, r * 1.0],
    [rr, L],
    [0, L],
  ];
  return { t: 'lathe', pts, segs: 14, axis: 'z' };
}

/** Clevis eye lug around a pin along X, plate in the YZ plane, tab pointing to `toward` (YZ). */
export function clevis(ref: NodeRef, pos: Vec3, r: number, gapW: number, toward: [number, number], material: MaterialId = 'darkMetal') {
  const len = Math.hypot(toward[0], toward[1]) || 1;
  const ang = Math.atan2(toward[0], toward[1]); // in YZ plane, from +Z toward +Y
  // the tab runs all the way into the structure it is welded to
  const L = Math.max(r * 1.4, len * 0.95);
  // teardrop: circle around the pin + a tapered tab toward the mount surface (profile in XY, x=along tab)
  const pts: P2[] = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const a = PI / 2 + (i / n) * PI;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  pts.push([L, -r * 0.8], [L, r * 0.8]);
  for (const sx of [-1, 1]) {
    ref.shape([pos[0] + sx * (gapW / 2 + r * 0.18), pos[1], pos[2]], {
      t: 'loft',
      axis: 'x',
      sections: [
        { p: { k: 'pts', pts }, z: -r * 0.18 },
        { p: { k: 'pts', pts }, z: r * 0.18 },
      ],
      bevel: r * 0.05,
      smooth: 30,
    }, material, { detail: 1, collide: false, rot: [PI - ang, 0, 0] });
  }
  // pin
  ref.shape(pos, { t: 'lathe', pts: [[0, -gapW / 2 - r * 0.5], [r * 0.45, -gapW / 2 - r * 0.5], [r * 0.45, gapW / 2 + r * 0.5], [0, gapW / 2 + r * 0.5]], segs: 10, axis: 'x' }, 'steel', { detail: 2, collide: false });
}

/** Clamp band around a hose / conduit at a point (detail 2). */
export function clampBand(ref: NodeRef, pos: Vec3, r: number, axis: Axis) {
  ref.shape(pos, { t: 'lathe', pts: [[r * 1.05, -r * 0.35], [r * 1.35, -r * 0.3], [r * 1.35, r * 0.3], [r * 1.05, r * 0.35]], segs: 10, axis }, 'steel', { detail: 2, collide: false });
}
