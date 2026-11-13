/**
 * Reusable mechanical sub-assemblies. Every function here builds real articulated structure
 * (named joint nodes, pivots at the right places, pistons with anchors) and hangs geometry off it.
 */
import type { Builder, NodeRef } from './builder';
import type { MaterialId, Vec3 } from './model';
import type { Rng } from './rng';
import { block, clampBand, clevis, hatchPanel, hub, memberDown, memberOut, shellDown, shellOut } from './hs/kit';

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
    shellDown(armor, -L * 0.12, [0, 0, d * 0.34 - bow * 0.5], '+z', {
      len,
      radius: w * (1.1 + rng.range(0, 0.6)),
      span: rng.range(1.0, 1.5),
      thick: th,
      material: st.armor,
      panels: st.plating > 0.62 ? 2 : 1,
      taperStart: 1.05,
      taperEnd: rng.range(0.7, 0.95),
      belly: d * rng.range(0.03, 0.12),
    });
    if (st.plating > 0.45) {
      for (const sx of [-1, 1]) shellDown(armor, -L * 0.2, [sx * (w * 0.38), 0, -bow * 0.5], sx > 0 ? '+x' : '-x', { len: L * 0.5, radius: d * 1.6, span: 0.7, thick: th * 0.8, material: st.armor, taperEnd: 0.8, belly: d * 0.03 });
    }
    // bolt row along the shell's upper edge
    armor.bolts([-w * 0.3, -L * 0.12 - th * 0.6, d * 0.34 + th * 0.6], [w * 0.3, -L * 0.12 - th * 0.6, d * 0.34 + th * 0.6], 4, Math.max(0.01, w * 0.022), 'z');
    if (rng.chance(0.5)) armor.box([w * 0.22, -L * 0.42, d * 0.34 + th * 1.05], [w * 0.16, L * 0.1, 0.008], st.accent, { detail: 1, collide: false });
  }
  // conduit up the back, clamped to the member
  const det = link.comp('detail');
  const cr = Math.max(0.012, w * 0.035);
  det.shape([0, 0, 0], { t: 'tube', path: [[w * 0.2, -L * 0.1, -d * 0.4], [w * 0.22, -L * 0.5, -d * 0.42 - bow * 0.4], [w * 0.2, -L * 0.88, -d * 0.4]], r: cr, segs: 8 }, 'rubber', { detail: 1, collide: false });
  for (const t of [0.25, 0.7]) clampBand(det, [w * 0.21, -L * t, -d * 0.41 - bow * 0.3], cr, 'y');
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
    shellOut(armor, L * 0.1, [0, h * 0.3 + bow * 0.5, 0], '+y', {
      len: L * (0.5 + st.plating * 0.3),
      radius: w * (1.1 + rng.range(0, 0.5)),
      span: rng.range(1.1, 1.5),
      thick: th,
      material: st.armor,
      panels: st.plating > 0.6 ? 2 : 1,
      taperStart: 0.95,
      taperEnd: rng.range(0.65, 0.9),
      belly: h * 0.06,
    });
    armor.bolts([-w * 0.28, h * 0.3 + th * 1.2, L * 0.15], [-w * 0.28, h * 0.3 + th * 1.2, L * 0.55], 4, Math.max(0.01, w * 0.025), 'y');
    if (rng.chance(0.6)) armor.box([w * 0.18, h * 0.3 + th * 1.25, L * 0.4], [w * 0.2, 0.008, L * 0.12], st.accent, { detail: 1, collide: false });
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
  yaw.comp('joint-housing').cyl([0, sp.d * 0.15, 0], sp.d * 0.55, sp.d * 0.3, 'steel', { segments: 18 });
  joints.push(yaw.name);
  const roll = yaw.child(`${p}_hip_roll`, [0, 0, 0], { joint: { axis: 'z', min: s > 0 ? -12 : -22, max: s > 0 ? 22 : 12, purpose: 'locomotion', kind: 'hip-roll' } });
  roll.comp('joint-housing').cylZ([0, 0, 0], sp.d * 0.42, sp.d * 0.9, 'darkMetal');
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
      const front = (sp.phis[i] - sp.phis[i - 1]) < 0 ? 1 : -1; // put ram on the outside of the bend
      b.piston({
        name: `${p}_${names[i]}_ram`,
        linkA: up.name,
        anchorA: [s * sp.w * 0.42, -sp.lens[i - 1] * 0.28, front * sp.d * 0.42],
        linkB: lo.name,
        anchorB: [s * sp.w * 0.42, -sp.lens[i] * 0.32, front * sp.d * 0.4],
        radius: Math.max(0.03, sp.w * 0.09),
        drives: lo.name,
      });
    }
    // hip ram: from roll housing (above) to thigh
    b.piston({
      name: `${p}_hip_ram`,
      linkA: roll.name,
      anchorA: [-s * sp.w * 0.1, sp.d * 0.55, -sp.d * 0.55],
      linkB: links[0].name,
      anchorB: [-s * sp.w * 0.1, -sp.lens[0] * 0.35, -sp.d * 0.42],
      radius: Math.max(0.03, sp.w * 0.08),
      drives: links[0].name,
    });
  }
  // flex hoses over every pitch joint (skinned in exports)
  for (let i = 1; i < n; i++) {
    b.cable({ name: `${p}_${names[i]}_hose`, from: links[i - 1].name, fromOffset: [-s * sp.w * 0.32, -sp.lens[i - 1] * 0.72, -sp.d * 0.38], to: links[i].name, toOffset: [-s * sp.w * 0.32, -sp.lens[i] * 0.25, -sp.d * 0.36], radius: Math.max(0.012, sp.w * 0.035) });
  }

  // ankle pitch + roll, foot levelled
  const ankle = prev.child(`${p}_ankle`, pos, { rot: [sp.phis[n - 1] * D2R, 0, 0], joint: { axis: 'x', min: -35, max: 35, purpose: 'locomotion', kind: 'ankle-pitch' } });
  ankle.comp('joint-housing').cylX([0, 0, 0], sp.d * 0.3, sp.w * 0.8, 'steel');
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
  fr.cylZ([0, 0, 0], sp.d * 0.24, sp.d * 0.5, 'steel');
  switch (sp.foot) {
    case 'flat': {
      // block sole + sloped toe cap + heel spur
      fr.box([0, -H * 0.82, L * 0.1], [W, H * 0.36, L * 0.95], 'rubber');
      ar.taper([0, -H * 0.45, L * 0.12], [W * 0.95, H * 0.5, L * 0.85], [0.7, 0.55], [0, -L * 0.08], sp.style.armor);
      ar.taper([0, -H * 0.62, L * 0.55], [W * 0.9, H * 0.38, L * 0.22], [0.8, 0.4], [0, -L * 0.04], 'darkMetal');
      fr.box([0, -H * 0.7, -L * 0.42], [W * 0.5, H * 0.45, L * 0.18], 'darkMetal');
      ar.bolts([-W * 0.35, -H * 0.4, L * 0.52], [W * 0.35, -H * 0.4, L * 0.52], 5, Math.max(0.012, W * 0.02), 'z');
      return [0, -H, L * 0.1];
    }
    case 'claw': {
      // three forward toes and a rear spur, each a fixed claw (no toe joints – kept simple for IK)
      for (const a of [-28, 0, 28]) {
        const r = a * D2R;
        const tx = Math.sin(r) * L * 0.42;
        const tz = Math.cos(r) * L * 0.42;
        fr.taper([tx, -H * 0.75, tz], [W * 0.28, H * 0.5, L * 0.6], [0.6, 0.5], [0, L * 0.08], 'darkMetal', { rot: [0, r, 0] });
        ar.chamfer([tx, -H * 0.45, tz * 0.85], [W * 0.26, H * 0.25, L * 0.42], 0.02, sp.style.armor, { rot: [0, r, 0] });
      }
      fr.taper([0, -H * 0.75, -L * 0.28], [W * 0.3, H * 0.5, L * 0.38], [0.6, 0.5], [0, -L * 0.05], 'darkMetal');
      fr.cyl([0, -H * 0.35, 0], W * 0.28, H * 0.7, 'steel', { segments: 12 });
      return [0, -H, L * 0.12];
    }
    case 'hoof': {
      fr.cyl([0, -H * 0.5, 0], W * 0.5, H, 'darkMetal', { rTop: W * 0.36, segments: 16 });
      fr.cyl([0, -H * 0.93, 0], W * 0.54, H * 0.14, 'rubber', { segments: 16 });
      ar.box([0, -H * 0.35, W * 0.42], [W * 0.6, H * 0.5, W * 0.12], sp.style.armor, { detail: 1 });
      return [0, -H, 0];
    }
    case 'pad':
    default: {
      fr.cyl([0, -H * 0.55, 0], W * 0.42, H * 0.9, 'darkMetal', { segments: 14 });
      fr.sphere([0, -H + W * 0.3, 0], W * 0.32, 'rubber', { segments: 12 });
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
  coxa.comp('joint-housing').cyl([0, 0, 0], sp.h * 0.6, sp.h * 1.1, 'steel', { segments: 18 });
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
    b.piston({ name: `${p}_femur_ram`, linkA: coxa.name, anchorA: [sp.w * 0.32, -sp.h * 0.55, sp.lens[0] * 0.15], linkB: links[0].name, anchorB: [sp.w * 0.32, -sp.h * 0.42, sp.lens[1] * 0.4], radius: Math.max(0.025, sp.w * 0.1), drives: links[0].name });
    // tibia ram on top of femur
    if (links[1]) b.piston({ name: `${p}_tibia_ram`, linkA: links[0].name, anchorA: [-sp.w * 0.3, sp.h * 0.55, sp.lens[1] * 0.35], linkB: links[1].name, anchorB: [-sp.w * 0.3, sp.h * 0.45, sp.lens[2] * 0.22], radius: Math.max(0.022, sp.w * 0.08), drives: links[1].name });
  }
  for (let i = 1; i < links.length; i++) b.cable({ name: `${p}_${names[i]}_hose`, from: links[i - 1].name, fromOffset: [sp.w * 0.25, -sp.h * 0.3, sp.lens[i] * 0.7], to: links[i].name, toOffset: [sp.w * 0.25, -sp.h * 0.25, sp.lens[i + 1] * 0.2], radius: Math.max(0.01, sp.w * 0.04) });

  // foot: ball-jointed pad, levelled. modelled as a passive pitch joint for terrain conformance
  const lastElev = sp.elev[sp.elev.length - 1];
  const foot = prev.child(`${p}_foot`, pos, { rot: [lastElev * D2R * -1 * -1, 0, 0], joint: { axis: 'x', min: -30, max: 30, purpose: 'locomotion', kind: 'foot-pitch' } });
  // foot local frame is level: geometry hangs down from the tip
  const fr = foot.comp('frame');
  fr.cyl([0, -sp.footR * 0.6, 0], sp.footR * 0.55, sp.footR * 1.2, 'darkMetal', { segments: 12 });
  fr.cyl([0, -sp.footR * 1.25, 0], sp.footR, sp.footR * 0.3, 'rubber', { rTop: sp.footR * 0.7, segments: 14 });
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
}

export function arm(b: Builder, parent: string, at: Vec3, sp: ArmSpec) {
  const p = `arm_${sp.id}`;
  const sys = `arm.${sp.id}`;
  const s = sp.side;
  const gun = sp.tool === 'cannon' || sp.tool === 'rotary' || sp.tool === 'missile';
  const joints: string[] = [];
  const sh = b.node(`${p}_shoulder_pitch`, parent, at, { system: sys, joint: { axis: 'x', min: -110, max: 50, purpose: 'manipulation', kind: 'shoulder-pitch' } });
  const shh = sh.comp('joint-housing');
  shh.cylX([s * sp.w * 0.2, 0, 0], sp.d * 0.62, sp.w * 0.9, 'darkMetal', { segments: 20 });
  // pauldron
  if (sp.style.plating > 0.2) {
    const pa = sh.comp('armor');
    pa.taper([s * sp.w * 0.45, sp.d * 0.35, 0], [sp.w * 1.15, sp.d * 0.55, sp.d * 1.6], [0.7, 0.8], [-s * sp.w * 0.1, 0], sp.style.armor);
    pa.bolts([s * sp.w * 0.1, sp.d * 0.66, -sp.d * 0.6], [s * sp.w * 0.1, sp.d * 0.66, sp.d * 0.6], 5, sp.w * 0.03, 'y');
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
    b.piston({ name: `${p}_elbow_ram`, linkA: up.name, anchorA: [0, -sp.upper * 0.25, -sp.d * 0.45], linkB: fore.name, anchorB: [0, -sp.fore * 0.25, -sp.d * 0.4], radius: Math.max(0.025, sp.w * 0.08), drives: fore.name });
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
  palm.chamfer([0, -sp.d * 0.25 - palmH / 2, 0], [sp.w * 0.95, palmH, sp.d * 0.85], 0.03, 'darkMetal', { rot: [Math.PI / 2, 0, 0] });
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
  body.chamfer([0, -L * 0.3, 0], [sp.w * 1.15, L * 0.6, sp.d * 1.1], sp.w * 0.12, 'darkMetal', { rot: [Math.PI / 2, 0, 0] });
  const ar = fore.comp('armor');
  ar.taper([0, -L * 0.28, sp.d * 0.62], [sp.w * 1.2, L * 0.5, sp.d * 0.25], [0.85, 1], [0, 0], sp.style.armor);
  ar.bolts([-sp.w * 0.4, -L * 0.08, sp.d * 0.76], [-sp.w * 0.4, -L * 0.5, sp.d * 0.76], 5, sp.w * 0.03, 'z');
  const muzzle = fore.child(`${p}_muzzle`, [0, -L * 1.25, 0], { role: 'socket' });
  if (sp.tool === 'cannon') {
    body.cyl([0, -L * 0.85, 0], sp.w * 0.22, L * 0.8, 'steel', { segments: 16 });
    body.cyl([0, -L * 1.2, 0], sp.w * 0.3, L * 0.14, 'darkMetal', { segments: 8, detail: 1 });
    body.cyl([0, -L * 0.6, 0], sp.w * 0.3, L * 0.12, 'darkMetal', { segments: 16, detail: 1 });
  } else if (sp.tool === 'rotary') {
    const spin = fore.child(`${p}_barrels_spin`, [0, -L * 0.6, 0], { joint: { axis: 'y', min: -180, max: 180, purpose: 'tool', kind: 'spin' }, tags: ['continuous'] });
    const bc = spin.comp('weapon');
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      bc.cyl([Math.cos(a) * sp.w * 0.26, -L * 0.32, Math.sin(a) * sp.w * 0.26], sp.w * 0.07, L * 0.64, 'steel', { segments: 8 });
    }
    bc.cyl([0, -L * 0.12, 0], sp.w * 0.4, L * 0.06, 'darkMetal', { segments: 16 });
    bc.cyl([0, -L * 0.55, 0], sp.w * 0.38, L * 0.05, 'darkMetal', { segments: 16, detail: 1 });
    body.cyl([0, -L * 0.55, 0], sp.w * 0.45, L * 0.12, 'darkMetal', { segments: 16 });
    b.mounts.push({ name: `${p}_rotary`, node: spin.name, type: 'weapon', note: 'barrel cluster spins on Y (continuous)' });
  } else {
    // missile box on the forearm
    body.box([0, -L * 0.75, 0], [sp.w * 1.3, L * 0.5, sp.d * 1.3], sp.style.armor);
    const n = 3;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) body.cyl([(i - 1) * sp.w * 0.38, -L * 1.0, (j - 1) * sp.d * 0.38], sp.w * 0.13, 0.02, 'rubber', { segments: 10, detail: 1, collide: false });
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
    shell.box([0, ih + t / 2, -idp * 0.1], [iw + 2 * t, t, idp * 0.8 + 2 * t], sp.armor); // roof (rear part)
    for (const sx of [-1, 1]) shell.box([(sx * (iw + t)) / 2, ih / 2, -idp * 0.05], [t, ih, idp * 0.9 + t], sp.armor); // sides
    shell.box([0, ih / 2, -idp / 2 - t / 2], [iw + 2 * t, ih + t, t], 'darkMetal'); // rear bulkhead
    const glass = pod.comp('glass');
    const frame = pod.comp('cockpit', 'frame');
    if (sp.style === 'bubble') {
      glass.chamfer([0, ih * 0.62, idp * 0.42], [iw + t, ih * 0.75, idp * 0.3], 0.25 * iw, 'glass', { rot: [0, 0, 0] });
      frame.box([0, ih * 0.24, idp * 0.45], [iw + 2 * t, t, idp * 0.32], sp.armor, { collide: false });
      frame.box([0, ih * 1.0, idp * 0.42], [t * 0.6, t * 0.6, idp * 0.3], 'darkMetal', { detail: 1 });
    } else if (sp.style === 'canopy') {
      // sloped glass front + frame mullions
      glass.taper([0, ih * 0.55, idp * 0.43], [iw, ih * 0.9, t * 0.5], [1, 1], [0, -idp * 0.18], 'glass', { rot: [0, 0, 0] });
      for (const sx of [-1, 0, 1]) frame.box([sx * iw * 0.33, ih * 0.55, idp * 0.43 - idp * 0.09], [t * 0.5, ih * 0.92, t * 0.6], 'darkMetal', { rot: [0.33, 0, 0], detail: 1, collide: false });
      frame.box([0, ih * 0.08, idp / 2 + t / 2], [iw + 2 * t, ih * 0.16, t], sp.armor);
    } else {
      // armoured: front plate with narrow vision slits
      frame.chamfer([0, ih * 0.5, idp / 2 + t / 2], [iw + 2 * t, ih + t, t], t, sp.armor, { rot: [0, 0, 0] });
      for (const y of [0.62, 0.78]) glass.box([0, ih * y, idp / 2 + t + 0.004], [iw * 0.75, ih * 0.06, 0.02], 'glass', { collide: false });
      frame.bolts([-iw * 0.45, ih * 0.95, idp / 2 + t + 0.01], [iw * 0.45, ih * 0.95, idp / 2 + t + 0.01], 7, 0.025, 'z');
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
  box.chamfer([0, size * 0.25, 0], [size, size * 0.62, size * 0.9], size * 0.08, style.armor);
  const rows = 2;
  const cols = 3;
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      box.cylZ([(i - 1) * size * 0.28, size * (0.1 + j * 0.28), size * 0.45], size * 0.1, 0.03, 'rubber', { segments: 10, detail: 1, collide: false });
      box.cylZ([(i - 1) * size * 0.28, size * (0.1 + j * 0.28), size * 0.455], size * 0.06, 0.02, 'hazard', { segments: 8, detail: 2, collide: false });
    }
  box.bolts([-size * 0.45, size * 0.57, -size * 0.4], [size * 0.45, size * 0.57, -size * 0.4], 5, size * 0.02, 'y');
  b.mounts.push({ name: `pod_${id}`, node: pitch.name, type: 'weapon', note: 'missile pod, aim with yaw/pitch' });
  return pitch.name;
}
