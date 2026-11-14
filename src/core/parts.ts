/**
 * Reusable mechanical sub-assemblies. Every function here builds real articulated structure
 * (named joint nodes, pivots at the right places, pistons with anchors) and hangs geometry off it.
 */
import type { Builder, NodeRef } from './builder';
import type { MaterialId, Vec3 } from './model';
import type { Rng } from './rng';
import { block, clampBand, clevis, hatchPanel, hub, memberDown, memberOut, shellDown, shellOut, slewRing } from './hs/kit';
import type { Section } from './hs/shapes';
import { hoodOpening, hoodSections, pauldron } from './hs/hulls';

const D2R = Math.PI / 180;

// ───────────────────────────────────────────────────────────── segments ──

export interface SegStyle {
  armor: MaterialId;
  accent: MaterialId;
  /** 0..1 how much armour plating (0 = bare industrial frame) */
  plating: number;
  /** open lattice frame instead of a boxed beam */
  lattice: boolean;
  rng: Rng;
}

/**
 * A limb segment hanging DOWN from its pivot (along local -Y), length L.
 * w = width (X), d = depth (Z). Front is +Z.
 */
export function segmentDown(link: NodeRef, L: number, w: number, d: number, st: SegStyle, opts: { housingAtEnd?: number; tapered?: boolean } = {}) {
  const frame = link.comp('frame');
  const rng = st.rng;
  const bow = d * rng.range(-0.06, 0.1);
  if (st.lattice) {
    // twin lofted side rails + machined cross braces: open industrial frame
    for (const sx of [-1, 1]) memberDown(frame, L, { w: w * 0.2, d: d * 0.62, at: [sx * w * 0.36, 0, 0], round: 0.35, flareTop: 1.3, flareBottom: 1.2, bow });
    for (const t of [0.3, 0.55, 0.8]) block(frame, [0, -L * t, -bow * Math.sin(Math.PI * t)], [w * 0.62, w * 0.12, d * 0.26], 'steel', { r: w * 0.03, detail: 1, collide: false });
  } else {
    memberDown(frame, L, { w: w * 0.68, d: d * 0.7, flareTop: 1.3, flareBottom: 1.15, bow, pockets: st.plating < 0.55 });
  }
  // the bearing at this link's own pivot sits between the parent's fork cheeks
  hub(frame, [0, 0, 0], 'x', { r: d * 0.36, w: w * 0.62, bolts: 6 });
  // fork cheeks at the far end carry the child's bearing
  if (opts.housingAtEnd) clevis(frame, [0, -L, 0], opts.housingAtEnd * 1.05, w * 0.64, [L * 0.4, 0]);

  if (st.plating > 0.15) {
    const armor = link.comp('armor');
    const th = d * (0.08 + st.plating * 0.07);
    const len = L * (0.5 + st.plating * 0.3);
    // plates sit ON the member: its front face + a small gap + the plate's own thickness
    const front = d * 0.7 * 0.5 * 1.12;
    const side = w * 0.68 * 0.5 * 1.12;
    shellDown(armor, -L * 0.12, [0, 0, front + d * 0.03 + th + bow * 0.55], '+z', {
      len,
      width: w * rng.range(0.92, 1.08),
      span: rng.range(0.9, 1.3),
      thick: th,
      material: st.armor,
      panels: st.plating > 0.62 ? 2 : 1,
      taperStart: 1.05,
      taperEnd: rng.range(0.7, 0.95),
      belly: Math.abs(bow) * 0.4 + d * 0.03,
      inlay: st.plating > 0.5,
      inlayMaterial: rng.chance(0.35) ? 'paint2' : st.armor,
    });
    if (st.plating > 0.45) {
      for (const sx of [-1, 1]) shellDown(armor, -L * 0.2, [sx * (side + w * 0.03 + th * 0.8), 0, bow * 0.5], sx > 0 ? '+x' : '-x', { len: L * 0.5, width: d * 0.72, span: 0.6, thick: th * 0.8, material: st.armor, taperEnd: 0.8, belly: d * 0.02 });
    }
    // bolt row along the shell's upper edge
    const fz = front + d * 0.03 + th + bow * 0.55 + 0.004;
    armor.bolts([-w * 0.28, -L * 0.12 - th * 0.8, fz], [w * 0.28, -L * 0.12 - th * 0.8, fz], 4, Math.max(0.01, w * 0.022), 'z');
    if (rng.chance(0.5)) armor.box([w * 0.2, -L * 0.42, fz + d * 0.02], [w * 0.16, L * 0.1, 0.008], st.accent, { detail: 1, collide: false });
  }
  // conduit up the back, clamped to the member
  const det = link.comp('detail');
  const cr = Math.max(0.012, w * 0.035);
  const cx = w * 0.68 * 0.5 + cr * 1.2;
  det.shape([0, 0, 0], { t: 'tube', path: [[cx, -L * 0.1, -d * 0.12], [cx + cr * 0.3, -L * 0.5, -d * 0.12 + bow * 0.8], [cx, -L * 0.88, -d * 0.12]], r: cr, segs: 8 }, 'rubber', { detail: 1, collide: false });
  for (const t of [0.25, 0.7]) clampBand(det, [cx, -L * t, -d * 0.12 + bow * 0.6], cr, 'y');
  if (L > 1.2 && rng.chance(0.6)) hatchPanel(det, [-w * 0.34, -L * 0.45, -d * 0.2], d * 0.3, L * 0.18, 'darkMetal', [0, -Math.PI / 2, 0]);
}

/**
 * A segment pointing OUT along local +Z (spider / sprawled legs, cranes). Up is +Y.
 */
export function segmentOut(link: NodeRef, L: number, w: number, h: number, st: SegStyle, opts: { housingAtEnd?: number } = {}) {
  const frame = link.comp('frame');
  const rng = st.rng;
  const bow = h * rng.range(0, 0.12);
  if (st.lattice) {
    for (const sy of [-1, 1]) memberOut(frame, L, { w: w * 0.5, d: h * 0.2, at: [0, sy * h * 0.34, 0], round: 0.35, flareTop: 1.2, flareBottom: 1.15, bow });
    for (const t of [0.3, 0.55, 0.8]) block(frame, [0, bow * Math.sin(Math.PI * t), L * t], [w * 0.26, h * 0.62, w * 0.1], 'steel', { detail: 1, collide: false });
  } else {
    memberOut(frame, L, { w: w * 0.66, d: h * 0.66, flareTop: 1.25, flareBottom: 1.12, bow });
  }
  hub(frame, [0, 0, 0], 'x', { r: h * 0.36, w: w * 0.6, bolts: 6 });
  if (opts.housingAtEnd) clevis(frame, [0, 0, L], opts.housingAtEnd * 1.05, w * 0.62, [0, -L * 0.4]);
  if (st.plating > 0.15) {
    const armor = link.comp('armor');
    const th = h * (0.08 + st.plating * 0.06);
    const top = h * 0.66 * 0.5 * 1.12;
    shellOut(armor, L * 0.1, [0, top + h * 0.03 + th + bow * 0.55, 0], '+y', {
      len: L * (0.5 + st.plating * 0.3),
      width: w * rng.range(0.95, 1.1),
      span: rng.range(0.9, 1.3),
      thick: th,
      material: st.armor,
      panels: st.plating > 0.6 ? 2 : 1,
      taperStart: 0.95,
      taperEnd: rng.range(0.65, 0.9),
      belly: Math.abs(bow) * 0.4 + h * 0.03,
      inlay: st.plating > 0.5,
      inlayMaterial: rng.chance(0.35) ? 'paint2' : st.armor,
    });
    const ty = top + h * 0.03 + th + bow * 0.55 + 0.004;
    armor.bolts([-w * 0.25, ty, L * 0.15], [-w * 0.25, ty, L * 0.55], 4, Math.max(0.01, w * 0.025), 'y');
    if (rng.chance(0.6)) armor.box([w * 0.16, ty + 0.002, L * 0.4], [w * 0.2, 0.008, L * 0.12], st.accent, { detail: 1, collide: false });
  }
  const det = link.comp('detail');
  const cr = Math.max(0.012, w * 0.045);
  det.shape([0, 0, 0], { t: 'tube', path: [[w * 0.24, -h * 0.28, L * 0.12], [w * 0.26, -h * 0.32 + bow * 0.4, L * 0.5], [w * 0.24, -h * 0.28, L * 0.88]], r: cr, segs: 8 }, 'rubber', { detail: 1, collide: false });
  for (const t of [0.3, 0.7]) clampBand(det, [w * 0.25, -h * 0.3 + bow * 0.3, L * t], cr, 'z');
}

// ───────────────────────────────────────────────────────── upright legs ──

export interface UprightLegSpec {
  id: string; // L, R, FL, RR ...
  side: 1 | -1; // +X = mech's left
  lens: number[]; // segment lengths: thigh, shin, [tarsus]
  phis: number[]; // absolute pitch from straight-down, degrees, + = forward
  w: number;
  d: number;
  foot: 'flat' | 'claw' | 'hoof' | 'pad';
  footLen: number;
  footW: number;
  footH: number;
  style: SegStyle;
  hydraulics: boolean;
  /** suggested gait phase 0..1 */
  phase: number;
  legStyle: 'plantigrade' | 'digitigrade' | 'mammal';
}

export interface LegResult {
  joints: string[];
  foot: string;
  contact: Vec3;
  /** vertical distance from the attach point down to the ground at rest */
  drop: number;
}

export function uprightLeg(b: Builder, parent: string, at: Vec3, sp: UprightLegSpec): LegResult {
  const sys = `leg.${sp.id}`;
  const p = `leg_${sp.id}`;
  const joints: string[] = [];
  const s = sp.side;

  const yaw = b.node(`${p}_hip_yaw`, parent, at, { system: sys, joint: { axis: 'y', min: -25, max: 25, purpose: 'locomotion', kind: 'hip-yaw' } });
  slewRing(yaw.comp('joint-housing'), [0, sp.d * 0.15, 0], sp.d * 0.58, sp.d * 0.26);
  joints.push(yaw.name);
  const roll = yaw.child(`${p}_hip_roll`, [0, 0, 0], { joint: { axis: 'z', min: s > 0 ? -12 : -22, max: s > 0 ? 22 : 12, purpose: 'locomotion', kind: 'hip-roll' } });
  hub(roll.comp('joint-housing'), [0, 0, 0], 'z', { r: sp.d * 0.42, w: sp.d * 0.85, bolts: 8 });
  joints.push(roll.name);

  let prev = roll;
  let prevPhi = 0;
  const n = sp.lens.length;
  const names = n === 2 ? ['thigh', 'shin'] : ['thigh', 'shin', 'tarsus'];
  const kinds = n === 2 ? ['hip-pitch', 'knee'] : ['hip-pitch', 'knee', 'hock'];
  let drop = 0;
  let pos: Vec3 = [0, 0, 0];
  const links: NodeRef[] = [];
  for (let i = 0; i < n; i++) {
    const phi = sp.phis[i];
    const rel = -(phi - prevPhi); // rest rotation about X
    // limits relative to rest: allow straightening to ~straight and bending further
    let min: number, max: number;
    if (i === 0) {
      min = -55;
      max = 40;
    } else {
      const bendDir = Math.sign(rel) || 1; // direction this joint is already bent
      const toStraight = -rel * 0.92; // how far back to straight
      if (bendDir > 0) {
        min = Math.min(-3, toStraight);
        max = Math.max(5, 125 - Math.abs(rel));
      } else {
        max = Math.max(3, toStraight);
        min = Math.min(-5, -(125 - Math.abs(rel)));
      }
    }
    const link = prev.child(`${p}_${names[i]}`, pos, { rot: [rel * D2R, 0, 0], joint: { axis: 'x', min, max, purpose: 'locomotion', kind: kinds[i] } });
    const taper = 1 - i * 0.12;
    segmentDown(link, sp.lens[i], sp.w * taper, sp.d * taper, sp.style, { housingAtEnd: sp.d * 0.38 * taper });
    joints.push(link.name);
    links.push(link);
    drop += sp.lens[i] * Math.cos(phi * D2R);
    prev = link;
    prevPhi = phi;
    pos = [0, -sp.lens[i], 0];
  }

  // knee / hock pistons: barrel on the upper segment's front, rod on the lower segment's front
  if (sp.hydraulics) {
    for (let i = 1; i < n; i++) {
      const up = links[i - 1];
      const lo = links[i];
      // rams go on the OUTSIDE of the bend (long stroke, like an excavator) and on the leg's
      // outer flank, clear of the front armour; a standoff welds each bracket to the member
      const rr = Math.max(0.035, sp.w * 0.12);
      const outside = sp.phis[i] - sp.phis[i - 1] < 0 ? 1 : -1;
      const tA = 1 - (i - 1) * 0.12;
      const tB = 1 - i * 0.12;
      const sideA = sp.w * tA * 0.68 * 0.5 * 1.12;
      const sideB = sp.w * tB * 0.68 * 0.5 * 1.12;
      b.piston({
        name: `${p}_${names[i]}_ram`,
        linkA: up.name,
        anchorA: [s * (sideA + rr * 1.7), -sp.lens[i - 1] * 0.3, outside * sp.d * tA * 0.18],
        linkB: lo.name,
        anchorB: [s * (sideB + rr * 1.7), -sp.lens[i] * 0.3, outside * sp.d * tB * 0.18],
        mountA: s * sideA * 0.9,
        mountB: s * sideB * 0.9,
        radius: rr,
        drives: lo.name,
      });
    }
    // hip ram: from roll housing (above) to thigh
    b.piston({
      name: `${p}_hip_ram`,
      linkA: roll.name,
      anchorA: [-s * sp.w * 0.1, sp.d * 0.55, -sp.d * 0.55],
      linkB: links[0].name,
      anchorB: [-s * sp.w * 0.1, -sp.lens[0] * 0.35, -(sp.d * 0.35 * 1.1 + Math.max(0.035, sp.w * 0.11) * 1.6)],
      radius: Math.max(0.035, sp.w * 0.11),
      drives: links[0].name,
    });
  }
  // flex hoses over every pitch joint (skinned in exports)
  for (let i = 1; i < n; i++) {
    b.cable({ name: `${p}_${names[i]}_hose`, from: links[i - 1].name, fromOffset: [-s * sp.w * 0.32, -sp.lens[i - 1] * 0.72, -sp.d * 0.38], to: links[i].name, toOffset: [-s * sp.w * 0.32, -sp.lens[i] * 0.25, -sp.d * 0.36], radius: Math.max(0.012, sp.w * 0.035) });
  }

  // ankle pitch + roll, foot levelled
  const ankle = prev.child(`${p}_ankle`, pos, { rot: [sp.phis[n - 1] * D2R, 0, 0], joint: { axis: 'x', min: -35, max: 35, purpose: 'locomotion', kind: 'ankle-pitch' } });
  hub(ankle.comp('joint-housing'), [0, 0, 0], 'x', { r: sp.d * 0.3, w: sp.w * 0.62, bolts: 6 });
  joints.push(ankle.name);
  const foot = ankle.child(`${p}_foot`, [0, 0, 0], { joint: { axis: 'z', min: -18, max: 18, purpose: 'locomotion', kind: 'ankle-roll' } });
  joints.push(foot.name);
  const contact = buildFoot(foot, sp);
  drop += sp.footH;
  return { joints, foot: foot.name, contact, drop };
}

function buildFoot(foot: NodeRef, sp: UprightLegSpec): Vec3 {
  const { footLen: L, footW: W, footH: H } = sp;
  const fr = foot.comp('frame');
  const ar = foot.comp('armor');
  // ankle-roll cradle: bearing along Z sitting in a lofted saddle block
  hub(fr, [0, 0, 0], 'z', { r: sp.d * 0.24, w: sp.d * 0.55, bolts: 6 });
  const rr = (w: number, h: number, r: number, extra: object = {}) => ({ k: 'rect' as const, w, h, r, segs: 2, ...extra });
  switch (sp.foot) {
    case 'flat': {
      // saddle from the ankle down to the foot deck
      fr.shape([0, 0, 0], { t: 'loft', axis: 'y', sections: [{ p: rr(sp.d * 0.5, sp.d * 0.5, sp.d * 0.12), z: -sp.d * 0.1 }, { p: rr(W * 0.7, L * 0.45, W * 0.1), z: -H * 0.55 }], bevel: W * 0.03 }, 'darkMetal');
      // rubber-tread sole: heel → ball → toe, toe slightly raised
      const sole = (z: number, w: number, h: number, oy: number): Section => ({ p: rr(W * w, H * h, H * 0.08), z, oy });
      fr.shape([0, 0, 0], { t: 'loft', sections: [sole(-L * 0.42, 0.78, 0.3, -H * 0.85), sole(-L * 0.2, 0.95, 0.32, -H * 0.84), sole(L * 0.3, 1, 0.32, -H * 0.84), sole(L * 0.6, 0.86, 0.26, -H * 0.8)], bevel: H * 0.04 }, 'rubber');
      // armoured instep, then segmented toe blocks (like the A-73's): faceted, each with a
      // sloped nose and its own armour cap
      const up = (z: number, w: number, h: number, oy: number, x = 0): Section => ({ p: rr(W * w, H * h, W * 0.12, { topScale: 0.78 }), z, oy, ox: x });
      ar.shape([0, 0, 0], { t: 'loft', sections: [up(-L * 0.38, 0.88, 0.5, -H * 0.45), up(-L * 0.05, 0.96, 0.56, -H * 0.42), up(L * 0.12, 0.94, 0.5, -H * 0.44)], bevel: W * 0.03 }, sp.style.armor);
      const toes = W > 0.6 ? 3 : 2;
      const tw = W / toes;
      for (let i = 0; i < toes; i++) {
        const x = (i - (toes - 1) / 2) * tw;
        const len = L * (i === (toes - 1) / 2 || toes === 2 ? 0.5 : 0.44);
        fr.shape([0, 0, 0], { t: 'loft', sections: [up(L * 0.1, (tw * 0.9) / W, 0.44, -H * 0.62, x), up(L * 0.1 + len * 0.7, (tw * 0.92) / W, 0.4, -H * 0.66, x), up(L * 0.1 + len, (tw * 0.7) / W, 0.18, -H * 0.8, x)], bevel: W * 0.02 }, 'darkMetal');
        ar.shape([0, 0, 0], { t: 'loft', sections: [up(L * 0.14, (tw * 0.78) / W, 0.16, -H * 0.34, x), up(L * 0.1 + len * 0.62, (tw * 0.78) / W, 0.14, -H * 0.4, x), up(L * 0.1 + len * 0.85, (tw * 0.6) / W, 0.08, -H * 0.55, x)], bevel: W * 0.012 }, sp.style.armor, { detail: 1 });
      }
      fr.shape([0, 0, 0], { t: 'loft', sections: [up(-L * 0.5, 0.5, 0.3, -H * 0.6), up(-L * 0.38, 0.62, 0.46, -H * 0.55)], bevel: W * 0.02 }, 'darkMetal'); // heel spur
      ar.bolts([-W * 0.3, -H * 0.2, L * 0.13], [W * 0.3, -H * 0.2, L * 0.13], 4, Math.max(0.01, W * 0.02), 'y');
      return [0, -H, L * 0.1];
    }
    case 'claw': {
      // three forward toes + rear spur: each a curved, tapering claw loft
      fr.shape([0, 0, 0], { t: 'lathe', pts: [[0, -H * 0.75], [W * 0.38, -H * 0.75], [W * 0.42, -H * 0.6], [W * 0.3, -H * 0.15], [sp.d * 0.2, 0], [0, 0]], segs: 16 }, 'darkMetal');
      const toe = (len: number, wid: number): Section[] => [
        { p: rr(wid, H * 0.42, wid * 0.25), z: 0, oy: -H * 0.62 },
        { p: rr(wid * 0.85, H * 0.36, wid * 0.22), z: len * 0.45, oy: -H * 0.66 },
        { p: rr(wid * 0.55, H * 0.26, wid * 0.15), z: len * 0.8, oy: -H * 0.78 },
        { p: rr(wid * 0.2, H * 0.1, wid * 0.05), z: len, oy: -H * 0.94 },
      ];
      for (const a of [-30, 0, 30]) {
        const r = a * D2R;
        fr.shape([0, 0, 0], { t: 'loft', sections: toe(L * (a === 0 ? 0.62 : 0.52), W * 0.3), bevel: W * 0.015 }, 'darkMetal', { rot: [0, r, 0] });
        ar.shape([0, 0, 0], { t: 'loft', sections: [{ p: rr(W * 0.3, H * 0.12, W * 0.05, { topScale: 0.7 }), z: L * 0.06, oy: -H * 0.38 }, { p: rr(W * 0.24, H * 0.1, W * 0.04, { topScale: 0.7 }), z: L * 0.36, oy: -H * 0.45 }], bevel: W * 0.012 }, sp.style.armor, { rot: [0, r, 0] });
      }
      fr.shape([0, 0, 0], { t: 'loft', sections: toe(L * 0.36, W * 0.3), bevel: W * 0.015 }, 'darkMetal', { rot: [0, Math.PI, 0] });
      return [0, -H, L * 0.12];
    }
    case 'hoof': {
      fr.shape([0, 0, 0], { t: 'lathe', pts: [[0, -H], [W * 0.56, -H], [W * 0.58, -H * 0.86], [W * 0.5, -H * 0.8], [W * 0.46, -H * 0.3], [W * 0.3, -H * 0.05], [sp.d * 0.2, 0], [0, 0]], segs: 20 }, 'darkMetal');
      fr.shape([0, 0, 0], { t: 'lathe', pts: [[W * 0.5, -H * 0.99], [W * 0.6, -H * 0.97], [W * 0.6, -H * 0.86], [W * 0.5, -H * 0.84]], segs: 20 }, 'rubber', { detail: 1, collide: false });
      shellDown(ar, -H * 0.15, [0, 0, W * 0.5 + W * 0.1], '+z', { len: H * 0.6, width: W * 0.8, span: 1.2, thick: W * 0.07, material: sp.style.armor, taperEnd: 1.15, belly: W * 0.04 });
      return [0, -H, 0];
    }
    case 'pad':
    default: {
      fr.shape([0, 0, 0], { t: 'lathe', pts: [[0, -H], [W * 0.45, -H], [W * 0.42, -H * 0.8], [W * 0.25, -H * 0.5], [W * 0.25, 0], [0, 0]], segs: 16 }, 'darkMetal');
      return [0, -H, 0];
    }
  }
}

// ──────────────────────────────────────────────────────── sprawl legs ──

export interface SprawlLegSpec {
  id: string;
  side: 1 | -1;
  /** heading of the leg in the body's XZ plane, radians (0 = straight forward, +π/2 = left) */
  yaw: number;
  lens: number[]; // coxa, femur, tibia
  elev: number[]; // elevation of each segment in degrees (+ up)
  w: number;
  h: number;
  footR: number;
  style: SegStyle;
  hydraulics: boolean;
  phase: number;
}

export function sprawlLeg(b: Builder, parent: string, at: Vec3, sp: SprawlLegSpec): LegResult & { reachOut: number } {
  const sys = `leg.${sp.id}`;
  const p = `leg_${sp.id}`;
  const joints: string[] = [];
  const coxa = b.node(`${p}_coxa`, parent, at, { system: sys, rot: [0, sp.yaw, 0], joint: { axis: 'y', min: -28, max: 28, purpose: 'locomotion', kind: 'coxa-yaw' } });
  slewRing(coxa.comp('joint-housing'), [0, 0, 0], sp.h * 0.62, sp.h * 0.5);
  hub(coxa.comp('joint-housing'), [0, 0, 0], 'y', { r: sp.h * 0.45, w: sp.h * 1.0, bolts: 0 });
  joints.push(coxa.name);
  const names = ['femur', 'tibia', 'tarsus'];
  const kinds = ['femur-pitch', 'tibia-pitch', 'tarsus-pitch'];
  let prev: NodeRef = coxa;
  let prevElev = 0;
  let pos: Vec3 = [0, 0, sp.lens[0]];
  segmentOut(coxa, sp.lens[0], sp.w * 1.1, sp.h * 1.05, { ...sp.style, plating: sp.style.plating * 0.6 });
  let drop = 0;
  let out = sp.lens[0];
  const links: NodeRef[] = [];
  for (let i = 1; i < sp.lens.length; i++) {
    const e = sp.elev[i];
    const rel = -(e - prevElev); // rotation about X: negative raises +Z segment
    const relDeg = rel;
    const min = i === 1 ? -50 : relDeg > 0 ? -relDeg * 0.9 - 10 : -60;
    const max = i === 1 ? 35 : relDeg > 0 ? 50 : -relDeg * 0.9 + 10;
    const link = prev.child(`${p}_${names[i - 1]}`, pos, { rot: [rel * D2R, 0, 0], joint: { axis: 'x', min: Math.min(-3, min), max: Math.max(3, max), purpose: 'locomotion', kind: kinds[i - 1] } });
    const t = 1 - i * 0.15;
    segmentOut(link, sp.lens[i], sp.w * t, sp.h * t, sp.style, { housingAtEnd: sp.h * 0.36 * t });
    joints.push(link.name);
    links.push(link);
    drop -= sp.lens[i] * Math.sin(e * D2R);
    out += sp.lens[i] * Math.cos(e * D2R);
    prev = link;
    prevElev = e;
    pos = [0, 0, sp.lens[i]];
  }
  if (sp.hydraulics) {
    // femur lift ram: from coxa (below) to femur underside
    // femur lift ram: under the leg, from the coxa root to the femur's belly (excavator style)
    const rf = Math.max(0.04, sp.w * 0.18);
    const rt = Math.max(0.035, sp.w * 0.15);
    const hf = sp.h * 0.85 * 0.33 * 1.1;
    b.piston({ name: `${p}_femur_ram`, along: 'z', linkA: coxa.name, anchorA: [0, -(sp.h * 0.36 + rf * 1.6), sp.lens[0] * 0.2], linkB: links[0].name, anchorB: [0, -(hf + rf * 1.6), sp.lens[1] * 0.42], radius: rf, drives: links[0].name });
    // tibia ram on top of femur
    // tibia ram rides ABOVE the femur's armour plate
    const plateTop = hf + sp.h * 0.03 + sp.h * 0.85 * (0.08 + sp.style.plating * 0.06) * 1.2;
    if (links[1]) b.piston({ name: `${p}_tibia_ram`, along: 'z', linkA: links[0].name, anchorA: [0, plateTop + rt * 1.8, sp.lens[1] * 0.3], linkB: links[1].name, anchorB: [0, sp.h * 0.7 * 0.33 * 1.1 + rt * 1.6, sp.lens[2] * 0.2], radius: rt, drives: links[1].name });
  }
  for (let i = 1; i < links.length; i++) b.cable({ name: `${p}_${names[i]}_hose`, from: links[i - 1].name, fromOffset: [sp.w * 0.25, -sp.h * 0.3, sp.lens[i] * 0.7], to: links[i].name, toOffset: [sp.w * 0.25, -sp.h * 0.25, sp.lens[i + 1] * 0.2], radius: Math.max(0.01, sp.w * 0.04) });

  // foot: ball-jointed pad, levelled. modelled as a passive pitch joint for terrain conformance
  const lastElev = sp.elev[sp.elev.length - 1];
  const foot = prev.child(`${p}_foot`, pos, { rot: [lastElev * D2R, 0, 0], joint: { axis: 'x', min: -30, max: 30, purpose: 'locomotion', kind: 'foot-pitch' } });
  // foot local frame is level: geometry hangs down from the tip
  const fr = foot.comp('frame');
  const R = sp.footR;
  // ball-jointed foot: socket housing, tapered shank, treaded pad
  hub(fr, [0, 0, 0], 'x', { r: R * 0.5, w: sp.w * 0.5, bolts: 0 });
  fr.shape([0, 0, 0], { t: 'lathe', pts: [[0, -R * 1.4], [R, -R * 1.4], [R * 1.02, -R * 1.25], [R * 0.75, -R * 1.1], [R * 0.42, -R * 0.75], [R * 0.36, -R * 0.1], [0, -R * 0.1]], segs: 16 }, 'darkMetal');
  fr.shape([0, 0, 0], { t: 'lathe', pts: [[R * 0.7, -R * 1.42], [R * 1.08, -R * 1.4], [R * 1.08, -R * 1.26], [R * 0.9, -R * 1.2]], segs: 16 }, 'rubber', { detail: 1, collide: false });
  joints.push(foot.name);
  drop += sp.footR * 1.4;
  return { joints, foot: foot.name, contact: [0, -sp.footR * 1.4, 0], drop, reachOut: out };
}

// ──────────────────────────────────────────────────────────────── arms ──

export type ArmTool = 'gripper' | 'claw' | 'cannon' | 'rotary' | 'missile' | 'shield' | 'drill';

export interface ArmSpec {
  id: string; // L / R
  side: 1 | -1;
  upper: number;
  fore: number;
  w: number;
  d: number;
  tool: ArmTool;
  style: SegStyle;
  hydraulics: boolean;
  /** maker's shoulder armour: curved hood, octagonal shield plate, or angled slab */
  pauldron?: 'hood' | 'shield' | 'slab';
}

export function arm(b: Builder, parent: string, at: Vec3, sp: ArmSpec) {
  const p = `arm_${sp.id}`;
  const sys = `arm.${sp.id}`;
  const s = sp.side;
  const gun = sp.tool === 'cannon' || sp.tool === 'rotary' || sp.tool === 'missile';
  const joints: string[] = [];
  const sh = b.node(`${p}_shoulder_pitch`, parent, at, { system: sys, joint: { axis: 'x', min: -110, max: 50, purpose: 'manipulation', kind: 'shoulder-pitch' } });
  const shh = sh.comp('joint-housing');
  hub(shh, [s * sp.w * 0.2, 0, 0], 'x', { r: sp.d * 0.6, w: sp.w * 0.9, bolts: 10 });
  // shoulder armour, in the maker's style
  const pst = sp.pauldron ?? 'hood';
  if (sp.style.plating > 0.2) {
    const pa = sh.comp('armor');
    if (pst === 'shield') {
      // octagonal shoulder shield standing off the outer face (A-73), smaller hood over the bearing
      pauldron(pa, [s * sp.w * 0.3, -sp.d * 0.05, 0], s, sp.d * 0.66, sp.d * 1.2, sp.d * 0.12, sp.style.armor, sp.style.rng);
      const R = sp.d * (1.0 + sp.style.plating * 0.25);
      const x = s * (sp.w * 0.78 + sp.d * 0.1);
      const oct = { k: 'ngon' as const, r: R, n: 8, rot: Math.PI / 8 };
      pa.shape([x, -sp.d * 0.2, 0], { t: 'loft', axis: 'x', sections: [{ p: oct, z: -sp.d * 0.09 }, { p: oct, z: sp.d * 0.09 }], bevel: sp.d * 0.035 }, sp.style.armor);
      const inl = { k: 'ngon' as const, r: R * 0.62, n: 8, rot: Math.PI / 8 };
      pa.shape([x + s * sp.d * 0.1, -sp.d * 0.2, 0], { t: 'loft', axis: 'x', sections: [{ p: inl, z: -sp.d * 0.03 }, { p: inl, z: sp.d * 0.03 }], bevel: sp.d * 0.012 }, 'paint2', { detail: 1, collide: false });
      for (let i = 0; i < 8; i++) {
        const a = Math.PI / 8 + (i / 8) * Math.PI * 2;
        pa.cyl([x + s * sp.d * 0.1, -sp.d * 0.2 + Math.cos(a) * R * 0.82, Math.sin(a) * R * 0.82], sp.d * 0.035, sp.d * 0.04, 'steel', { rot: [0, 0, Math.PI / 2], detail: 2, collide: false, segments: 6 });
      }
    } else if (pst === 'slab') {
      // angled armour slab over the shoulder, with a stepped inlay
      block(pa, [s * sp.w * 0.42, sp.d * 0.42, 0], [sp.w * 1.25, sp.d * 0.32, sp.d * 1.9], sp.style.armor, { r: sp.d * 0.1, top: [0.72, 0.82], shift: [s * sp.w * 0.06, 0], rot: [0, 0, -s * 0.22] });
      block(pa, [s * sp.w * 0.44, sp.d * 0.6, 0], [sp.w * 0.7, sp.d * 0.08, sp.d * 1.2], 'paint2', { r: sp.d * 0.04, rot: [0, 0, -s * 0.22], detail: 1, collide: false });
      pa.bolts([s * sp.w * 0.1, sp.d * 0.58, -sp.d * 0.8], [s * sp.w * 0.1, sp.d * 0.58, sp.d * 0.8], 5, sp.w * 0.03, 'y');
    } else {
      pauldron(pa, [s * sp.w * 0.32, -sp.d * 0.05, 0], s, sp.d * (0.72 + sp.style.plating * 0.2), sp.d * (1.4 + sp.style.plating * 0.4), sp.d * 0.13, sp.style.armor, sp.style.rng);
    }
  }
  joints.push(sh.name);
  const roll = sh.child(`${p}_shoulder_roll`, [s * sp.w * 0.55, 0, 0], { joint: { axis: 'z', min: s > 0 ? -10 : -70, max: s > 0 ? 70 : 10, purpose: 'manipulation', kind: 'shoulder-roll' } });
  roll.comp('joint-housing').cylZ([0, 0, 0], sp.w * 0.32, sp.d * 0.7, 'steel');
  joints.push(roll.name);
  const up = roll.child(`${p}_upper`, [0, 0, 0], { joint: { axis: 'y', min: -40, max: 40, purpose: 'manipulation', kind: 'upper-arm-twist' } });
  segmentDown(up, sp.upper, sp.w, sp.d, sp.style, { housingAtEnd: sp.d * 0.36 });
  joints.push(up.name);
  const elbowRest = gun ? -78 : -32;
  const fore = up.child(`${p}_forearm`, [0, -sp.upper, 0], { rot: [elbowRest * D2R, 0, 0], joint: { axis: 'x', min: gun ? -45 : -95, max: gun ? 60 : 30, purpose: 'manipulation', kind: 'elbow' } });
  joints.push(fore.name);
  if (sp.hydraulics) {
    b.piston({ name: `${p}_elbow_ram`, linkA: up.name, anchorA: [0, -sp.upper * 0.25, -(sp.d * 0.35 * 1.1 + Math.max(0.03, sp.w * 0.11) * 1.6)], linkB: fore.name, anchorB: [0, -sp.fore * 0.25, -(sp.d * 0.92 * 0.35 * 1.1 + Math.max(0.03, sp.w * 0.11) * 1.6)], radius: Math.max(0.03, sp.w * 0.11), drives: fore.name });
  }
  b.cable({ name: `${p}_elbow_hose`, from: up.name, fromOffset: [-s * sp.w * 0.3, -sp.upper * 0.7, -sp.d * 0.3], to: fore.name, toOffset: [-s * sp.w * 0.3, -sp.fore * 0.3, -sp.d * 0.3], radius: Math.max(0.01, sp.w * 0.03) });

  let end = fore.name;
  if (gun) {
    end = gunArm(b, fore, sp);
  } else {
    segmentDown(fore, sp.fore, sp.w * 0.92, sp.d * 0.92, sp.style, { housingAtEnd: sp.d * 0.3 });
    const wrist = fore.child(`${p}_wrist`, [0, -sp.fore, 0], { joint: { axis: 'y', min: -120, max: 120, purpose: 'manipulation', kind: 'wrist-twist' } });
    wrist.comp('joint-housing').cyl([0, -sp.d * 0.12, 0], sp.d * 0.32, sp.d * 0.3, 'steel');
    joints.push(wrist.name);
    end = hand(b, wrist, sp);
  }
  b.arms.push({ name: p, side: sp.id.startsWith('L') ? 'L' : sp.id.startsWith('R') ? 'R' : 'C', joints, endEffector: end, tool: sp.tool });
  return { joints, end };
}

function hand(b: Builder, wrist: NodeRef, sp: ArmSpec): string {
  const p = `arm_${sp.id}`;
  const palmH = sp.d * 0.5;
  const palm = wrist.comp('frame');
  block(palm, [0, -sp.d * 0.25 - palmH / 2, 0], [sp.w * 0.95, palmH, sp.d * 0.85], 'darkMetal', { r: sp.w * 0.12, segs: 2 });
  const tip = wrist.child(`${p}_tool_tip`, [0, -sp.d * 0.25 - palmH - sp.fore * 0.3, 0], { role: 'socket' });
  if (sp.tool === 'drill') {
    const spin = wrist.child(`${p}_drill_spin`, [0, -sp.d * 0.25 - palmH, 0], { joint: { axis: 'y', min: -180, max: 180, purpose: 'tool', kind: 'spin' }, tags: ['continuous'] });
    spin.comp('equipment').cyl([0, -sp.fore * 0.25, 0], sp.w * 0.4, sp.fore * 0.5, 'steel', { rTop: 0.01, segments: 12 });
    for (let i = 0; i < 4; i++) spin.comp('equipment').box([0, -sp.fore * (0.1 + i * 0.1), 0], [sp.w * 0.8 * (1 - i * 0.2), 0.03, 0.04], 'darkMetal', { rot: [0, i * 0.8, 0], detail: 1, collide: false });
    b.mounts.push({ name: `${p}_drill`, node: spin.name, type: 'tool' });
    return tip.name;
  }
  if (sp.tool === 'shield') {
    const sh = wrist.comp('armor');
    sh.taper([sp.side * sp.w * 0.5, -sp.fore * 0.35, sp.d * 0.2], [sp.w * 0.25, sp.fore * 1.2, sp.d * 2.6], [1, 0.8], [0, 0], sp.style.armor, { rot: [0, 0, 0] });
  }
  const fingers = sp.tool === 'claw' ? 3 : 2;
  for (let i = 0; i < fingers; i++) {
    const yaw = fingers === 2 ? (i === 0 ? 0 : Math.PI) : (i * 2 * Math.PI) / 3;
    const base = wrist.child(`${p}_finger${i}`, [Math.sin(yaw) * sp.d * 0.3, -sp.d * 0.25 - palmH, Math.cos(yaw) * sp.d * 0.3], {
      rot: [0, yaw, 0],
      joint: { axis: 'x', min: -20, max: 35, purpose: 'manipulation', kind: 'finger' },
    });
    const fl = sp.fore * 0.38;
    const f = base.comp('frame');
    // finger curls inward (towards -Z of its own frame, i.e. the palm centre)
    f.cylX([0, 0, 0], sp.w * 0.1, sp.w * 0.28, 'steel');
    f.chamfer([0, -fl * 0.45, sp.w * 0.05], [sp.w * 0.22, fl * 0.9, sp.w * 0.22], 0.015, 'darkMetal', { rot: [-0.25, 0, 0] });
    f.taper([0, -fl * 0.95, -sp.w * 0.06], [sp.w * 0.2, fl * 0.3, sp.w * 0.2], [0.4, 0.4], [0, -sp.w * 0.08], sp.style.accent, { rot: [-0.5, 0, 0] });
  }
  b.mounts.push({ name: `${p}_grip`, node: tip.name, type: 'tool' });
  return tip.name;
}

function gunArm(b: Builder, fore: NodeRef, sp: ArmSpec): string {
  const p = `arm_${sp.id}`;
  const L = sp.fore * 1.25;
  const body = fore.comp('weapon');
  // receiver block hangs along the forearm (local -Y, which points forward after the elbow bend)
  block(body, [0, -L * 0.3, 0], [sp.w * 1.15, L * 0.6, sp.d * 1.1], 'darkMetal', { r: sp.w * 0.16, segs: 2, frontPanel: { inset: sp.w * 0.1, depth: sp.d * 0.06 } });
  const ar = fore.comp('armor');
  shellDown(ar, -L * 0.02, [0, 0, sp.d * 0.55 + sp.d * 0.15], '+z', { len: L * 0.55, width: sp.w * 1.1, span: 1.1, thick: sp.d * 0.12, material: sp.style.armor, panels: 2, taperEnd: 0.85, belly: sp.d * 0.05 });
  ar.bolts([-sp.w * 0.35, -L * 0.04, sp.d * 0.64], [sp.w * 0.35, -L * 0.04, sp.d * 0.64], 4, sp.w * 0.03, 'z');
  // side ammo feed / cooling jacket
  block(body, [sp.side * sp.w * 0.62, -L * 0.3, -sp.d * 0.1], [sp.w * 0.28, L * 0.42, sp.d * 0.7], 'paint2', { r: sp.w * 0.06, detail: 1, frontPanel: { inset: sp.w * 0.04, depth: sp.w * 0.03, slats: 5 }, rot: [Math.PI / 2, 0, 0] });
  const muzzle = fore.child(`${p}_muzzle`, [0, -L * 1.25, 0], { role: 'socket' });
  const W = sp.w;
  if (sp.tool === 'cannon') {
    // single heavy barrel: mantlet ring → tapered tube → fume extractor → muzzle brake
    body.shape([0, 0, 0], { t: 'lathe', segs: 20, pts: [
      [0, -L * 1.25], [W * 0.2, -L * 1.25], [W * 0.31, -L * 1.235], [W * 0.31, -L * 1.13], [W * 0.2, -L * 1.12], [W * 0.31, -L * 1.11], [W * 0.31, -L * 1.06], [W * 0.17, -L * 1.05],
      [W * 0.17, -L * 0.92], [W * 0.25, -L * 0.88], [W * 0.25, -L * 0.8], [W * 0.19, -L * 0.77], [W * 0.21, -L * 0.62], [W * 0.36, -L * 0.6], [W * 0.38, -L * 0.56], [W * 0.38, -L * 0.52], [0, -L * 0.52],
    ] }, 'steel');
    body.shape([0, 0, 0], { t: 'lathe', segs: 20, pts: [[W * 0.3, -L * 1.244], [W * 0.34, -L * 1.2], [W * 0.34, -L * 1.16], [W * 0.3, -L * 1.14]] }, 'darkMetal', { detail: 2, collide: false });
  } else if (sp.tool === 'rotary') {
    const spin = fore.child(`${p}_barrels_spin`, [0, -L * 0.6, 0], { joint: { axis: 'y', min: -180, max: 180, purpose: 'tool', kind: 'spin' }, tags: ['continuous'] });
    const bc = spin.comp('weapon');
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      bc.shape([Math.cos(a) * W * 0.25, 0, Math.sin(a) * W * 0.25], { t: 'lathe', segs: 8, pts: [[0, -L * 0.66], [W * 0.075, -L * 0.66], [W * 0.075, -L * 0.6], [W * 0.06, -L * 0.59], [W * 0.06, 0], [0, 0]] }, 'steel');
    }
    // clamp rings and the front barrel plate
    for (const y of [-0.2, -0.45]) bc.shape([0, 0, 0], { t: 'lathe', segs: 18, pts: [[W * 0.1, L * y - L * 0.02], [W * 0.36, L * y - L * 0.02], [W * 0.38, L * y], [W * 0.36, L * y + L * 0.02], [W * 0.1, L * y + L * 0.02]] }, 'darkMetal', { detail: 1 });
    bc.shape([0, 0, 0], { t: 'lathe', segs: 18, pts: [[0, -L * 0.04], [W * 0.4, -L * 0.04], [W * 0.42, -L * 0.02], [W * 0.42, L * 0.02], [0, L * 0.02]] }, 'darkMetal');
    // motor drum
    body.shape([0, 0, 0], { t: 'lathe', segs: 20, pts: [[0, -L * 0.62], [W * 0.44, -L * 0.62], [W * 0.5, -L * 0.58], [W * 0.5, -L * 0.48], [W * 0.42, -L * 0.45], [0, -L * 0.45]] }, 'darkMetal');
    b.mounts.push({ name: `${p}_rotary`, node: spin.name, type: 'weapon', note: 'barrel cluster spins on Y (continuous)' });
  } else {
    // missile box: launch face points forward (-Y in the forearm frame)
    block(body, [0, -L * 0.78, 0], [W * 1.35, sp.d * 1.35, L * 0.48], sp.style.armor, { r: W * 0.12, segs: 2, rot: [Math.PI / 2, 0, 0], frontPanel: { inset: W * 0.08, depth: W * 0.05 } });
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        body.shape([(i - 1) * W * 0.38, 0, (j - 1) * sp.d * 0.38], { t: 'lathe', segs: 10, pts: [[0, -L * 0.98], [W * 0.1, -L * 0.98], [W * 0.14, -L * 0.995], [W * 0.15, -L * 1.0], [W * 0.15, -L * 0.96], [0, -L * 0.96]] }, 'rubber', { detail: 1, collide: false });
  }
  b.mounts.push({ name: `${p}_weapon`, node: muzzle.name, type: 'weapon' });
  return muzzle.name;
}

// ─────────────────────────────────────────────────────────── cockpit ──

export interface CockpitSpec {
  style: 'canopy' | 'armored' | 'bubble' | 'cage';
  /** interior clear size, metres. Never below human scale. */
  iw: number;
  ih: number;
  id: number;
  wall: number;
  armor: MaterialId;
  hatch: 'top' | 'rear' | 'none';
  rng: Rng;
}

export const HUMAN = { sitW: 1.0, sitH: 1.3, sitD: 1.3 };

/**
 * A hollow cockpit pod, origin at the centre of its floor. Interior faces +Z.
 * Returns the node name. Registers interior space + entry hatch.
 */
export function cockpit(b: Builder, parent: string, at: Vec3, sp: CockpitSpec): string {
  // seated cockpits need sitting room; a standing exo harness only needs torso room
  const cage = sp.style === 'cage';
  const iw = Math.max(sp.iw, cage ? 0.62 : HUMAN.sitW);
  const ih = Math.max(sp.ih, cage ? 0.95 : HUMAN.sitH);
  const idp = Math.max(sp.id, cage ? 0.5 : HUMAN.sitD);
  const t = sp.wall;
  const pod = b.node('cockpit', parent, at, { system: 'cockpit', role: 'group' });
  const shell = pod.comp('cockpit', 'shell');
  if (sp.style === 'cage') {
    // open roll cage (exosuits): tubes only, the pilot is visibly inside
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) shell.cyl([(sx * iw) / 2, ih / 2, (sz * idp) / 2], 0.035, ih, 'steel', { segments: 8 });
    for (const sz of [-1, 1]) shell.cylX([0, ih, (sz * idp) / 2], 0.035, iw, 'steel', { segments: 8 });
    for (const sx of [-1, 1]) shell.cylZ([(sx * iw) / 2, ih, 0], 0.035, idp, 'steel', { segments: 8 });
    shell.box([0, -t / 2, -idp * 0.1], [iw * 0.7, t, idp * 0.6], 'darkMetal');
    shell.box([0, ih * 0.5, -idp / 2 - t / 2], [iw * 0.9, ih * 0.9, t], 'darkMetal');
  } else {
    shell.box([0, -t / 2, 0], [iw + 2 * t, t, idp + 2 * t], 'darkMetal'); // floor
    shell.box([0, ih / 2, -idp / 2 - t / 2], [iw + 2 * t, ih + t, t], 'darkMetal'); // rear bulkhead
    // arched, lofted hood = walls + roof in one hard-surface shell (hollow, open at the floor)
    const frontScale = sp.style === 'bubble' ? 0.55 : sp.style === 'canopy' ? 0.72 : 0.9;
    shell.shape([0, 0, 0], { t: 'loft', sections: hoodSections(iw, ih, t * 1.4, idp, frontScale, Math.min(iw, ih) * 0.35), bevel: t * 0.3 }, sp.armor, { collide: false });
    // proxies standing in for the hollow hood in collision + interior validation
    shell.box([0, ih + t / 2, -idp * 0.1], [iw + 2 * t, t, idp * 0.8 + 2 * t], sp.armor, { hidden: true });
    for (const sx of [-1, 1]) shell.box([(sx * (iw + t)) / 2, ih / 2, -idp * 0.05], [t, ih, idp * 0.9 + t], sp.armor, { hidden: true });
    // roof rib + side window strip
    block(shell, [0, ih + t * 1.6, -idp * 0.1], [iw * 0.3, t * 0.6, idp * 0.7], 'darkMetal', { detail: 1, collide: false });

    const glass = pod.comp('glass');
    const frame = pod.comp('cockpit', 'frame');
    // everything at the front is cut from the hood's real front opening
    const ht = t * 1.4;
    const rTop = Math.min(iw, ih) * 0.35;
    const sill = ih * 0.18;
    const front = idp / 2;
    const open = (s: number, inset = 0, y0 = sill) => ({ k: 'pts' as const, pts: hoodOpening(iw, ih, ht, s, rTop, y0, inset) });
    // sill / dashboard plate closing the bottom of the opening
    block(frame, [0, sill / 2, front + t * 0.4], [iw, sill, t * 0.8], sp.armor, { r: t * 0.3, collide: false });
    if (sp.style === 'bubble') {
      // domed glass growing out of the opening
      glass.shape([0, 0, 0], { t: 'loft', sections: [
        { p: open(frontScale, 0.004), z: front - t },
        { p: open(frontScale, 0.004), z: front + idp * 0.12, sx: 0.96, sy: 0.97 },
        { p: open(frontScale, 0.004), z: front + idp * 0.24, sx: 0.78, sy: 0.82, oy: sill * 0.4 },
        { p: open(frontScale, 0.004), z: front + idp * 0.3, sx: 0.45, sy: 0.55, oy: sill * 1.2 },
      ] }, 'glass', { collide: false });
    } else if (sp.style === 'canopy') {
      // single pane, recessed into the opening, one centre post
      glass.shape([0, 0, 0], { t: 'loft', sections: [{ p: open(frontScale, 0.004), z: front - t * 0.9 }, { p: open(frontScale, 0.004), z: front - t * 0.5 }] }, 'glass', { collide: false });
      const top = (ih + ht) * frontScale - ht;
      block(frame, [0, (sill + top) / 2, front - t * 0.45], [t * 0.5, top - sill, t * 0.5], 'darkMetal', { r: t * 0.15, detail: 1, collide: false });
    } else {
      // armoured: plate fills the opening, vision slits cut across it
      frame.shape([0, 0, 0], { t: 'loft', sections: [{ p: open(frontScale, -0.002, 0), z: front }, { p: open(frontScale, -0.002, 0), z: front + t }], bevel: t * 0.25 }, sp.armor);
      const top = (ih + ht) * frontScale - ht;
      for (const y of [0.55, 0.72]) glass.box([0, top * y, front + t + 0.006], [iw * 0.62, ih * 0.05, 0.012], 'glass', { collide: false });
      frame.bolts([-iw * 0.38, top * 0.88, front + t + 0.012], [iw * 0.38, top * 0.88, front + t + 0.012], 6, 0.022, 'z');
    }
    // roof light + antenna
    const det = pod.comp('detail');
    det.box([iw * 0.35, ih + t + 0.03, -idp * 0.3], [0.12, 0.06, 0.08], 'emissive', { detail: 1, collide: false });
    det.cyl([-iw * 0.38, ih + t + 0.45, -idp * 0.35], 0.012, 0.9, 'steel', { detail: 2, collide: false, segments: 5 });
  }
  // interior: seat, console, controls – all at true human scale
  const inn = pod.child('cockpit_interior', [0, 0, 0], { role: 'group', component: 'interior' });
  const int = inn.comp('interior');
  if (sp.style === 'cage') {
    // standing harness: back plate, shoulder yokes, hand grips. The pilot's legs go into the mech's.
    int.box([0, ih * 0.5, -idp * 0.38], [0.42, ih * 0.75, 0.06], 'interior');
    for (const sx of [-1, 1]) {
      int.box([sx * 0.18, ih * 0.82, -idp * 0.2], [0.08, 0.05, 0.36], 'rubber', { detail: 1, collide: false });
      int.cyl([sx * 0.3, ih * 0.38, idp * 0.12], 0.025, 0.14, 'rubber', { detail: 1, collide: false, segments: 6 });
    }
    int.box([0, ih * 0.15, -idp * 0.25], [0.3, 0.06, 0.18], 'interior', { detail: 1 });
    b.interiors.push({ name: 'cockpit', node: 'cockpit', min: [-iw / 2, 0, -idp / 2], max: [iw / 2, ih, idp / 2], walkable: false, kind: 'cockpit' });
    return pod.name;
  }
  int.box([0, 0.25, -idp * 0.18], [0.55, 0.12, 0.5], 'interior'); // seat pan
  int.box([0, 0.65, -idp * 0.18 - 0.27], [0.55, 0.75, 0.1], 'interior', { rot: [-0.18, 0, 0] }); // backrest
  int.box([0, 0.12, -idp * 0.18], [0.2, 0.25, 0.2], 'darkMetal'); // seat post
  int.box([0, 0.5, idp * 0.3], [iw * 0.85, 0.12, 0.35], 'interior', { rot: [-0.35, 0, 0] }); // console
  int.box([0, 0.7, idp * 0.38], [iw * 0.6, 0.3, 0.03], 'emissive', { rot: [-0.25, 0, 0], detail: 1, collide: false }); // screens
  for (const sx of [-1, 1]) int.cyl([sx * 0.32, 0.45, -idp * 0.05], 0.025, 0.25, 'rubber', { detail: 1, collide: false, segments: 6 }); // sticks
  for (const sx of [-1, 1]) int.box([sx * 0.15, 0.06, idp * 0.25], [0.12, 0.04, 0.2], 'steel', { detail: 2, collide: false }); // pedals
  b.interiors.push({ name: 'cockpit', node: 'cockpit', min: [-iw / 2, 0, -idp / 2], max: [iw / 2, ih, idp / 2], walkable: ih > 1.9, kind: 'cockpit' });

  if (sp.hatch !== 'none') {
    const top = sp.hatch === 'top';
    const hatch = pod.child('cockpit_hatch', top ? [0, ih + t, -idp * 0.5] : [iw * 0.5 + t, 0.1, -idp * 0.45], {
      role: 'hatch',
      system: 'cockpit',
      joint: top ? { axis: 'x', min: -110, max: 0, purpose: 'access', kind: 'hatch' } : { axis: 'y', min: 0, max: 100, purpose: 'access', kind: 'door' },
    });
    const hg = hatch.comp('armor');
    if (top) {
      hg.box([0, t * 0.5, idp * 0.32], [iw * 0.7, t * 0.6, idp * 0.6], sp.armor);
      hg.cylX([0, t * 0.5, 0], t * 0.4, iw * 0.5, 'steel', { detail: 1 });
      hg.box([0, t * 0.95, idp * 0.5], [0.2, 0.04, 0.04], 'hazard', { detail: 1, collide: false });
    } else {
      hg.box([0.02, ih * 0.45, idp * 0.3], [0.05, ih * 0.85, idp * 0.55], sp.armor);
    }
    b.mounts.push({ name: 'cockpit_entry', node: hatch.name, type: 'hatch' });
  }
  return pod.name;
}

// ────────────────────────────────────────────────────────── details ──

export function ladder(ref: NodeRef, x: number, z: number, y0: number, y1: number, width = 0.45) {
  const det = ref.comp('equipment', 'ladder');
  const h = y1 - y0;
  for (const sx of [-1, 1]) det.cyl([x + (sx * width) / 2, y0 + h / 2, z], 0.022, h, 'hazard', { segments: 6, collide: false, detail: 1 });
  const rungs = Math.max(2, Math.floor(h / 0.3));
  for (let i = 0; i <= rungs; i++) det.cylX([x, y0 + (i / rungs) * h, z], 0.016, width, 'steel', { segments: 6, collide: false, detail: 1 });
}

export function vents(ref: NodeRef, center: Vec3, w: number, h: number, normal: 'x' | 'z' | 'y', sign = 1) {
  const det = ref.comp('detail');
  const n = Math.max(3, Math.round(h / 0.06));
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1) - 0.5) * h;
    if (normal === 'z') det.box([center[0], center[1] + t, center[2] + sign * 0.01], [w, h / n * 0.45, 0.04], 'darkMetal', { detail: 2, collide: false, rot: [0.4 * sign, 0, 0] });
    else if (normal === 'x') det.box([center[0] + sign * 0.01, center[1] + t, center[2]], [0.04, h / n * 0.45, w], 'darkMetal', { detail: 2, collide: false, rot: [0, 0, -0.4 * sign] });
    else det.box([center[0], center[1] + 0.01, center[2] + t], [w, 0.04, h / n * 0.45], 'darkMetal', { detail: 2, collide: false });
  }
  det.box([center[0], center[1], center[2]], normal === 'z' ? [w * 1.1, h * 1.1, 0.02] : normal === 'x' ? [0.02, h * 1.1, w * 1.1] : [w * 1.1, 0.02, h * 1.1], 'rubber', { detail: 1, collide: false });
}

export function lightPod(ref: NodeRef, pos: Vec3, r: number) {
  const d = ref.comp('light');
  d.cylZ(pos, r * 1.25, r * 0.8, 'darkMetal', { detail: 1, collide: false, segments: 10 });
  d.cylZ([pos[0], pos[1], pos[2] + r * 0.42], r, 0.02, 'emissive', { detail: 1, collide: false, segments: 10 });
}

export function missileRack(b: Builder, parent: string, at: Vec3, id: string, size: number, style: SegStyle) {
  const yaw = b.node(`pod_${id}_yaw`, parent, at, { system: `pod.${id}`, joint: { axis: 'y', min: -30, max: 30, purpose: 'aim', kind: 'pod-yaw' } });
  yaw.comp('joint-housing').cyl([0, size * 0.08, 0], size * 0.3, size * 0.16, 'steel', { segments: 16 });
  const pitch = yaw.child(`pod_${id}_pitch`, [0, size * 0.3, 0], { joint: { axis: 'x', min: -45, max: 15, purpose: 'aim', kind: 'pod-pitch' } });
  const box = pitch.comp('weapon');
  block(box, [0, size * 0.25, 0], [size, size * 0.62, size * 0.9], style.armor, { r: size * 0.08, segs: 2, top: [0.92, 0.95], frontPanel: { inset: size * 0.04, depth: size * 0.03 } });
  block(box, [0, size * 0.25, -size * 0.52], [size * 0.8, size * 0.5, size * 0.14], 'darkMetal', { r: size * 0.05, detail: 1 });
  for (const sx of [-1, 1]) hub(box, [sx * size * 0.52, size * 0.25, 0], 'x', { r: size * 0.16, w: size * 0.08, bolts: 0, detail: 1, collide: false });
  const rows = 2;
  const cols = 3;
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++)
      box.shape([(i - 1) * size * 0.28, size * (0.11 + j * 0.28), 0], { t: 'lathe', axis: 'z', segs: 12, pts: [[0, size * 0.41], [size * 0.09, size * 0.41], [size * 0.115, size * 0.43], [size * 0.115, size * 0.46], [size * 0.06, size * 0.455], [0, size * 0.455]] }, j === 1 && i === 1 ? 'hazard' : 'rubber', { detail: 1, collide: false });
  box.bolts([-size * 0.45, size * 0.57, -size * 0.4], [size * 0.45, size * 0.57, -size * 0.4], 5, size * 0.02, 'y');
  b.mounts.push({ name: `pod_${id}`, node: pitch.name, type: 'weapon', note: 'missile pod, aim with yaw/pitch' });
  return pitch.name;
}
