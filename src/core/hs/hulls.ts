/**
 * Hulls: the large shapes that decide a mech's silhouette. Torso/body hulls are lofted from a
 * handful of cross-sections whose width, height, height-above-floor, top taper and corner radii
 * change front to back — that's where wedge glacis, hunched noses, tall chests and asymmetric
 * chassis come from. Then armour layers, decks and housings are added on top of the hull, not
 * intersecting it at random.
 */
import type { NodeRef } from '../builder';
import type { MaterialId, Vec3 } from '../model';
import type { Rng } from '../rng';
import type { P2 } from './profile';
import type { Section } from './shapes';
import { block, grille, hatchPanel } from './kit';

export type TorsoArch = 'bulwark' | 'hunch' | 'tower' | 'wedge' | 'asym';
export const TORSO_ARCHES: TorsoArch[] = ['bulwark', 'hunch', 'tower', 'wedge', 'asym'];

/** One hull cross-section, all fractions of the hull's nominal w/h/d. */
interface HS {
  z: number; // -0.5 (back) … 0.5 (front)
  w: number;
  h: number;
  y0: number; // bottom of the section above the hull floor
  ts: number; // top-edge scale (tumblehome)
  rt: number; // top corner radius (fraction of min(w,h))
  rb: number; // bottom corner radius
  ox?: number; // sideways shift (asymmetry)
}

const ARCH: Record<TorsoArch, HS[]> = {
  // A-73: broad armoured box, big chamfered shoulders of the hull, sloped glacis
  bulwark: [
    { z: -0.5, w: 0.8, h: 0.78, y0: 0.14, ts: 0.82, rt: 0.2, rb: 0.08 },
    { z: -0.28, w: 0.97, h: 0.97, y0: 0.03, ts: 0.86, rt: 0.2, rb: 0.08 },
    { z: 0.12, w: 1, h: 1, y0: 0, ts: 0.84, rt: 0.22, rb: 0.08 },
    { z: 0.38, w: 0.95, h: 0.82, y0: 0.04, ts: 0.78, rt: 0.24, rb: 0.08 },
    { z: 0.5, w: 0.86, h: 0.62, y0: 0.1, ts: 0.72, rt: 0.22, rb: 0.1 },
  ],
  // Lynx: rounded egg-shaped body, highest at the front where the cockpit nose hangs
  hunch: [
    { z: -0.5, w: 0.56, h: 0.5, y0: 0.32, ts: 0.8, rt: 0.42, rb: 0.32 },
    { z: -0.25, w: 0.88, h: 0.82, y0: 0.12, ts: 0.84, rt: 0.4, rb: 0.3 },
    { z: 0.08, w: 1, h: 1, y0: 0, ts: 0.86, rt: 0.38, rb: 0.28 },
    { z: 0.36, w: 0.9, h: 0.92, y0: 0.04, ts: 0.82, rt: 0.4, rb: 0.3 },
    { z: 0.5, w: 0.66, h: 0.66, y0: 0.18, ts: 0.78, rt: 0.42, rb: 0.32 },
  ],
  // A-07: tall stepped chest, narrow waist, hard chamfers
  tower: [
    { z: -0.5, w: 0.72, h: 1.05, y0: 0.05, ts: 0.9, rt: 0.1, rb: 0.06 },
    { z: -0.2, w: 0.95, h: 1.2, y0: 0, ts: 0.88, rt: 0.12, rb: 0.06 },
    { z: 0.15, w: 1, h: 1.22, y0: 0, ts: 0.84, rt: 0.12, rb: 0.06 },
    { z: 0.42, w: 0.88, h: 1.05, y0: 0.08, ts: 0.76, rt: 0.12, rb: 0.08 },
    { z: 0.5, w: 0.76, h: 0.86, y0: 0.18, ts: 0.7, rt: 0.12, rb: 0.08 },
  ],
  // low, wide, aggressively sloped front plate
  wedge: [
    { z: -0.5, w: 0.92, h: 0.74, y0: 0.16, ts: 0.9, rt: 0.12, rb: 0.08 },
    { z: -0.12, w: 1, h: 0.86, y0: 0.08, ts: 0.9, rt: 0.12, rb: 0.08 },
    { z: 0.2, w: 0.98, h: 0.62, y0: 0.14, ts: 0.88, rt: 0.12, rb: 0.08 },
    { z: 0.5, w: 0.84, h: 0.26, y0: 0.22, ts: 0.85, rt: 0.08, rb: 0.06 },
  ],
  // M-47: hull mass shifted to one side, weapon bay hung on the other
  asym: [
    { z: -0.5, w: 0.66, h: 0.8, y0: 0.12, ts: 0.84, rt: 0.18, rb: 0.08, ox: -0.12 },
    { z: -0.25, w: 0.8, h: 0.98, y0: 0.02, ts: 0.86, rt: 0.2, rb: 0.08, ox: -0.1 },
    { z: 0.12, w: 0.84, h: 1, y0: 0, ts: 0.84, rt: 0.2, rb: 0.08, ox: -0.08 },
    { z: 0.4, w: 0.78, h: 0.8, y0: 0.06, ts: 0.78, rt: 0.22, rb: 0.08, ox: -0.06 },
    { z: 0.5, w: 0.68, h: 0.62, y0: 0.12, ts: 0.74, rt: 0.2, rb: 0.08, ox: -0.05 },
  ],
};

export interface HullResult {
  /** z of the hull's front face (cockpit mounts in front of it) and the floor height there */
  frontZ: number;
  /** y of the hull top at the shoulders and at the back */
  topY: number;
  /** sideways shift of the hull mass (asym) */
  shiftX: number;
  /** z range */
  backZ: number;
  /** x half-width at the widest section */
  halfW: number;
  arch: TorsoArch;
}

/**
 * Torso hull centred at x=0 (or shifted for asym), floor at y=0, spanning z ∈ [cz-d/2, cz+d/2].
 * Layered: lofted hull shell → top deck plate → flank armour panels → rear reactor housing with
 * grilles → hatches, bolts, lights.
 */
export function torsoHull(ref: NodeRef, arch: TorsoArch, w: number, h: number, d: number, cz: number, armor: MaterialId, armor2: MaterialId, rng: Rng, hollow = false): HullResult {
  const secs = ARCH[arch];
  const mx = Math.max(...secs.map((s) => s.h));
  const prof = (s: HS) => {
    const ww = w * s.w;
    const hh = h * s.h;
    const m = Math.min(ww, hh);
    return { k: 'rect' as const, w: ww, h: hh, r: [m * s.rb, m * s.rt, m * s.rt, m * s.rb], segs: 3, topScale: s.ts };
  };
  const sections: Section[] = secs.map((s) => ({ p: prof(s), z: cz + s.z * d, oy: h * (s.y0 + s.h / 2), ox: w * (s.ox ?? 0) }));
  const frame = ref.comp('frame');
  const shell = ref.comp('armor', 'hull');
  if (hollow) {
    // colossus: the inner hull is space; just the outer skin as a thick shell made of plates
    hollowSkin(frame, w, h * mx, d, cz, 'darkMetal');
  } else {
    // inner structural core (slightly smaller), then the armour skin around it
    frame.shape([0, 0, 0], { t: 'loft', sections: sections.map((s) => ({ ...s, z: cz + (s.z - cz) * 0.9, sx: 0.9, sy: 0.9 })), bevel: Math.min(w, h) * 0.02 }, 'darkMetal');
  }
  // armour skin: split front-to-back into two shells with a seam gap → visible panel line
  const split = Math.floor(sections.length / 2);
  const gap = Math.min(w, h) * 0.012;
  const front = sections.slice(split).map((s, i) => (i === 0 ? { ...s, z: s.z + gap } : s));
  const back = sections.slice(0, split + 1).map((s, i, a) => (i === a.length - 1 ? { ...s, z: s.z - gap } : s));
  shell.shape([0, 0, 0], { t: 'loft', sections: back, bevel: Math.min(w, h) * 0.03, recess: [{ at: 'start', inset: Math.min(w, h) * 0.08, depth: d * 0.02 }] }, armor, { collide: !hollow });
  shell.shape([0, 0, 0], { t: 'loft', sections: front, bevel: Math.min(w, h) * 0.03 }, armor, { collide: !hollow });

  const widest = secs.reduce((a, s) => (s.w > a.w ? s : a), secs[0]);
  const shiftX = w * (widest.ox ?? 0);
  const topY = h * (widest.y0 + widest.h);
  const halfW = (w * widest.w) / 2;
  const fs = secs[secs.length - 1];
  const bs = secs[0];

  // layered flank plates (two panels each side), standing proud of the hull
  const pl = ref.comp('armor', 'plates');
  const plateT = Math.min(w, h) * 0.035;
  for (const sx of [-1, 1]) {
    const x = shiftX + sx * (halfW * 0.97 + plateT * 0.4);
    for (const [z0, z1] of [
      [-0.36, -0.02],
      [0.02, 0.32],
    ]) {
      block(pl, [x, h * (widest.y0 + widest.h * 0.42), cz + ((z0 + z1) / 2) * d], [plateT, h * widest.h * 0.62, (z1 - z0) * d], rng.chance(0.3) ? armor2 : armor, {
        r: plateT * 0.4,
        top: [1, 0.92],
        bevel: plateT * 0.3,
        rot: [0, sx > 0 ? 0 : Math.PI, 0],
      });
    }
    pl.bolts([x + sx * plateT * 0.55, h * (widest.y0 + widest.h * 0.72), cz - d * 0.34], [x + sx * plateT * 0.55, h * (widest.y0 + widest.h * 0.72), cz + d * 0.3], 7, Math.min(w, h) * 0.012, 'x');
  }
  // top deck plate with a recessed hatch
  block(pl, [shiftX, topY + plateT * 0.4, cz - d * 0.08], [halfW * 2 * widest.ts * 0.8, plateT, d * 0.5], armor2, { r: plateT * 0.4, bevel: plateT * 0.3 });
  hatchPanel(pl, [shiftX - halfW * 0.25, topY + plateT * 0.95, cz - d * 0.1], halfW * 0.5, d * 0.22, armor2, [-Math.PI / 2, 0, 0]);
  // rear reactor housing with louvred vents
  const rh = h * bs.h * 0.7;
  block(pl, [shiftX, h * (bs.y0 + bs.h * 0.45), cz - d * 0.5 - d * 0.06], [w * bs.w * 0.82, rh, d * 0.14], 'darkMetal', { r: rh * 0.12, backPanel: { inset: rh * 0.08, depth: d * 0.02 } });
  for (const sx of [-1, 1]) grille(pl, [shiftX + sx * w * bs.w * 0.2, h * (bs.y0 + bs.h * 0.45), cz - d * 0.5 - d * 0.13], w * bs.w * 0.3, rh * 0.62, Math.min(w, h) * 0.03, 'darkMetal', [0, Math.PI, 0]);
  // chest: a stack of faceted plates on the glacis below the cockpit, outer ones louvred
  const fz = cz + fs.z * d;
  const chestW = w * fs.w * 0.9;
  const rows = arch === 'tower' ? 3 : 2;
  for (let r = 0; r < rows; r++) {
    const y = h * (fs.y0 + 0.08 + r * 0.17);
    const ph = h * 0.15;
    const cols = r === 0 ? 3 : 2;
    for (let c = 0; c < cols; c++) {
      const cw = chestW / cols - gap * 2;
      const x = shiftX + (c - (cols - 1) / 2) * (chestW / cols);
      const vent = cols === 3 && c !== 1;
      block(pl, [x, y, fz + plateT * 0.4 - r * plateT * 0.6], [cw, ph, plateT * 1.4], c === 1 && cols === 3 ? armor2 : armor, {
        r: Math.min(cw, ph) * 0.22,
        top: [0.86, 1],
        bevel: plateT * 0.35,
        frontPanel: vent ? { inset: Math.min(cw, ph) * 0.14, depth: plateT * 0.6, slats: 4 } : { inset: Math.min(cw, ph) * 0.16, depth: plateT * 0.25 },
        collide: false,
      });
    }
  }
  // under-hull: twist bearing skirt
  block(frame, [0, h * 0.02, cz - d * 0.05], [w * 0.5, h * 0.06, d * 0.5], 'darkMetal', { r: h * 0.02, collide: false, detail: 1 });

  return { frontZ: cz + fs.z * d, topY, shiftX, backZ: cz - 0.5 * d, halfW, arch };
}

function hollowSkin(ref: NodeRef, w: number, h: number, d: number, cz: number, mat: MaterialId, y0 = 0) {
  const t = Math.max(0.2, Math.min(w, h) * 0.03);
  block(ref, [0, y0 + t / 2, cz], [w, t, d], mat, { r: t * 0.3 });
  block(ref, [0, y0 + h - t / 2, cz], [w, t, d], mat, { r: t * 0.3 });
  for (const sx of [-1, 1]) block(ref, [sx * (w / 2 - t / 2), y0 + h / 2, cz], [t, h, d], mat, { r: t * 0.3 });
  for (const sz of [-1, 1]) block(ref, [0, y0 + h / 2, cz + sz * (d / 2 - t / 2)], [w, h, t], mat, { r: t * 0.3 });
}

/**
 * Pauldron: a curved armour hood over a shoulder bearing, wrapping from the top round to the
 * outer side. Built for +X; pass side -1 to mirror. Centre = shoulder pivot.
 */
export function pauldron(ref: NodeRef, pos: Vec3, side: 1 | -1, R: number, len: number, t: number, material: MaterialId, rng: Rng) {
  const a0 = -0.55;
  const a1 = Math.PI / 2 + rng.range(0.05, 0.35); // wraps a little past the top towards the body
  const n = 3; // three folded facets
  const outer: P2[] = [];
  const inner: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    outer.push([Math.cos(a) * R, Math.sin(a) * R]);
    inner.push([Math.cos(a) * (R - t), Math.sin(a) * (R - t)]);
  }
  // CCW: outer arc goes CCW (increasing angle), back along the inner arc
  const pts: P2[] = [...outer, ...inner.reverse()];
  const radii = pts.map((_, i) => (i === 0 || i === n || i === n + 1 || i === pts.length - 1 ? t * 0.45 : 0));
  // loft along Z (front/back), the profile lives in the XY plane around the pivot
  const sec = (z: number, s: number, oy = 0): Section => ({ p: { k: 'pts', pts, r: radii, segs: 1 }, z, sx: s, sy: s, oy });
  const flare = rng.range(1.0, 1.15);
  ref.shape(pos, { t: 'loft', sections: [sec(-len / 2, 0.72, -R * 0.06), sec(-len * 0.3, flare), sec(len * 0.3, flare), sec(len / 2, 0.7, -R * 0.08)], bevel: t * 0.35 }, material, { rot: side > 0 ? [0, 0, 0] : [0, Math.PI, 0] });
  // trim strip + bolts along the lower edge
  const ex = Math.cos(a0) * (R - t / 2) * side;
  const ey = Math.sin(a0) * (R - t / 2);
  ref.bolts([pos[0] + ex, pos[1] + ey + t * 0.8, pos[2] - len * 0.35], [pos[0] + ex, pos[1] + ey + t * 0.8, pos[2] + len * 0.35], 5, t * 0.22, 'x');
}

/** Cockpit hood: an arched, hollow, lofted shell (open at the floor) – the cockpit's walls & roof. */
export function hoodSections(iw: number, ih: number, t: number, idp: number, frontScale: number, rTop: number): Section[] {
  const prof = (s: number): P2[] => {
    const W = iw / 2 + t;
    const H = ih + t;
    const r = Math.min(rTop, W * 0.9);
    // outer: bottom-right → up → arc over top → down → bottom-left; inner offset by t
    const o: P2[] = [];
    const inn: P2[] = [];
    const arc = (cx: number, cy: number, rr: number, a0: number, a1: number, out: P2[], n = 2) => {
      for (let i = 0; i <= n; i++) {
        const a = a0 + ((a1 - a0) * i) / n;
        out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
      }
    };
    o.push([W, 0]);
    arc(W - r, H * s - r, r, 0, Math.PI / 2, o);
    arc(-W + r, H * s - r, r, Math.PI / 2, Math.PI, o);
    o.push([-W, 0]);
    const ri = Math.max(0.01, r - t);
    inn.push([W - t, 0]);
    arc(W - t - ri, H * s - t - ri, ri, 0, Math.PI / 2, inn);
    arc(-W + t + ri, H * s - t - ri, ri, Math.PI / 2, Math.PI, inn);
    inn.push([-W + t, 0]);
    return [...o, ...inn.reverse()];
  };
  return [
    { p: { k: 'pts', pts: prof(1) }, z: -idp / 2 - t },
    { p: { k: 'pts', pts: prof(1) }, z: 0 },
    { p: { k: 'pts', pts: prof(frontScale) }, z: idp / 2 },
  ];
}

export type BodyArch = 'chassis' | 'pod' | 'saucer' | 'long';

/**
 * Body hulls for quadrupeds / multi-leg walkers, centred on the body origin, height h (y ∈
 * [-h/2, h/2]), length L along Z. Lofted shell + layered side armour + deck + rear grilles.
 */
export function bodyHull(ref: NodeRef, arch: BodyArch, w: number, h: number, L: number, armor: MaterialId, armor2: MaterialId, rng: Rng, hollow = false, skirts = true) {
  const shell = ref.comp('armor', 'hull');
  const frame = ref.comp('frame');
  const m = Math.min(w, h);
  if (arch === 'saucer') {
    const R = Math.min(w, L) / 2;
    shell.shape([0, 0, 0], { t: 'lathe', segs: 36, pts: [[0, -h / 2], [R * 0.62, -h / 2], [R * 0.9, -h * 0.28], [R, -h * 0.05], [R * 0.98, h * 0.08], [R * 0.82, h * 0.22], [R * 0.62, h * 0.4], [R * 0.4, h / 2], [0, h / 2]] }, armor, { collide: !hollow });
    // rim band + equipment ring
    shell.shape([0, 0, 0], { t: 'lathe', segs: 36, pts: [[R * 1.0, -h * 0.1], [R * 1.04, -h * 0.08], [R * 1.04, h * 0.04], [R * 0.99, h * 0.07]] }, armor2, { detail: 1, collide: false });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      hatchPanel(shell, [Math.sin(a) * R * 0.7, h * 0.33, Math.cos(a) * R * 0.7], R * 0.25, R * 0.14, armor2, [-Math.PI / 2 + 0.55, a, 0]);
    }
  } else {
    const S: [number, number, number, number, number, number][] =
      // z, w, h, oy, rTop, rBottom (fractions)
      arch === 'chassis'
        ? [[-0.5, 0.88, 0.7, 0.08, 0.1, 0.3], [-0.38, 1, 0.98, 0, 0.1, 0.3], [0.3, 1, 1, 0, 0.1, 0.3], [0.46, 0.96, 0.84, 0.04, 0.14, 0.32], [0.5, 0.88, 0.66, 0.1, 0.16, 0.3]]
        : arch === 'pod'
          ? [[-0.5, 0.56, 0.5, 0.06, 0.42, 0.42], [-0.32, 0.9, 0.86, 0, 0.42, 0.4], [0.1, 1, 1, 0, 0.42, 0.4], [0.38, 0.9, 0.86, 0.02, 0.42, 0.4], [0.5, 0.6, 0.58, 0.06, 0.42, 0.42]]
          : [[-0.5, 0.62, 0.6, 0.08, 0.3, 0.35], [-0.3, 0.92, 0.9, 0, 0.3, 0.35], [-0.02, 0.86, 0.84, 0.02, 0.3, 0.35], [0.24, 1, 1, 0, 0.3, 0.35], [0.5, 0.7, 0.66, 0.06, 0.32, 0.35]];
    const secs: Section[] = S.map(([z, ww, hh, oy, rt, rb]) => {
      const mm = Math.min(w * ww, h * hh);
      return { p: { k: 'rect', w: w * ww, h: h * hh, r: [mm * rb, mm * rt, mm * rt, mm * rb], segs: 3, topScale: arch === 'chassis' ? 0.96 : 0.86 }, z: z * L, oy: oy * h };
    });
    // two shells with a seam between them
    const k = Math.floor(secs.length / 2);
    const g = m * 0.012;
    shell.shape([0, 0, 0], { t: 'loft', sections: secs.slice(0, k + 1).map((s, i, a) => (i === a.length - 1 ? { ...s, z: s.z - g } : s)), bevel: m * 0.03, recess: [{ at: 'start', inset: m * 0.08, depth: L * 0.01 }] }, armor, { collide: !hollow });
    shell.shape([0, 0, 0], { t: 'loft', sections: secs.slice(k).map((s, i) => (i === 0 ? { ...s, z: s.z + g } : s)), bevel: m * 0.03 }, armor, { collide: !hollow });
    // side armour skirts in panels
    const pl = ref.comp('armor', 'plates');
    const t = m * 0.04;
    const panels = arch === 'chassis' ? 3 : 2;
    for (const sx of skirts ? [-1, 1] : [])
      for (let i = 0; i < panels; i++) {
        const z0 = -0.36 + (0.68 / panels) * i;
        const z1 = z0 + 0.68 / panels - 0.012;
        block(pl, [sx * (w * 0.5 + t * 0.2), arch === 'chassis' ? h * 0.06 : 0, ((z0 + z1) / 2) * L], [t, h * (arch === 'chassis' ? 0.58 : 0.5), (z1 - z0) * L], i === 1 && rng.chance(0.5) ? armor2 : armor, { r: t * 0.4, top: [1, 0.9], bevel: t * 0.3, rot: [0, sx > 0 ? 0 : Math.PI, 0] });
      }
    for (const sx of [-1, 1]) pl.bolts([sx * (w * 0.5 + t * 0.75), h * 0.3, -L * 0.34], [sx * (w * 0.5 + t * 0.75), h * 0.3, L * 0.3], 9, m * 0.012, 'x');
    if (arch === 'chassis') {
      block(pl, [0, h * 0.5 + t * 0.3, -L * 0.02], [w * 0.9, t, L * 0.86], armor2, { r: t * 0.4, bevel: t * 0.3 }); // deck plate
      for (const sx of [-1, 1]) block(frame, [sx * w * 0.46, -h * 0.32, 0], [w * 0.08, h * 0.3, L * 0.9], 'steel', { r: h * 0.03, frontPanel: { inset: h * 0.04, depth: w * 0.01 } }); // leg girders
    }
    grille(pl, [0, h * 0.05, -L * 0.5 - h * 0.02], w * 0.4, h * 0.4, m * 0.04, 'darkMetal', [0, Math.PI, 0]);
  }
  if (hollow) hollowSkin(frame, w * 0.9, h * 0.86, L * 0.9, 0, 'darkMetal', -h * 0.43);
}

/**
 * The hood's inner front opening (arch top, flat sill), as a closed CCW profile — so glass,
 * frames and armour plates fit the hood exactly instead of being sized by guesswork.
 */
export function hoodOpening(iw: number, ih: number, t: number, frontScale: number, rTop: number, sill: number, inset = 0): P2[] {
  const W = iw / 2 - inset;
  const top = (ih + t) * frontScale - t - inset;
  const r = Math.max(0.01, Math.min(rTop - t, W * 0.9, (top - sill) * 0.9));
  const pts: P2[] = [[W, sill]];
  const n = 2; // faceted (hexagonal-ish) window, like the A-73's canopy
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    pts.push([W - r + Math.cos(a) * r, top - r + Math.sin(a) * r]);
  }
  for (let i = 0; i <= n; i++) {
    const a = Math.PI / 2 + (i / n) * (Math.PI / 2);
    pts.push([-W + r + Math.cos(a) * r, top - r + Math.sin(a) * r]);
  }
  pts.push([-W, sill]);
  return pts;
}
