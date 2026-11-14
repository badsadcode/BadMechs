/**
 * Cabins: where the pilot sits. Each type is a different OBJECT, not a different visor:
 *
 *   pod        faceted multi-pane glass bulb on an armoured tub, heavy frame bars (A-73, Lynx)
 *   greenhouse boxy excavator cab: big flat panes, roof overhang, guard bars (Ostrava)
 *   bunker     heavy armoured box, thin vision-slit band, periscopes (Volkov)
 *   ball       faceted ball "head" with an octagonal eye window; the cab itself is a yaw joint
 *   tandem     long teardrop canopy over two seats in a row (scouts)
 *   hood       the original arched hood (kept; buildCabin is not used for it)
 *
 * Interior space, floor, rear bulkhead and the hidden collision walls are shared (built by
 * cockpit()), so validation and collision work identically for every type.
 */
import type { NodeRef } from './builder';
import type { MaterialId } from './model';
import type { Rng } from './rng';
import type { P2 } from './hs/profile';
import type { V3 } from './hs/mesh';
import type { Section } from './hs/shapes';
import { block } from './hs/kit';

export type CabinType = 'hood' | 'pod' | 'greenhouse' | 'bunker' | 'ball' | 'tandem';
export const CABINS: CabinType[] = ['hood', 'pod', 'greenhouse', 'bunker', 'ball', 'tandem'];

export interface CabinDims {
  iw: number;
  ih: number;
  idp: number;
  t: number;
  armor: MaterialId;
  frame: MaterialId;
  rng: Rng;
}

/** Frame bars along chosen longitudinal edges of a lofted capsule, plus a ring at each section. */
function frameBars(ref: NodeRef, prof: P2[], secs: Section[], edges: number[], r: number, mat: MaterialId, rings = true) {
  const at = (k: number, s: Section): V3 => {
    const [x, y] = prof[k];
    return [x * (s.sx ?? 1) * 1.01 + (s.ox ?? 0), y * (s.sy ?? 1) + (s.oy ?? 0) + (y > 0 ? r * 0.2 : 0), s.z];
  };
  for (const k of edges) ref.shape([0, 0, 0], { t: 'tube', path: secs.map((s) => at(k, s)), r, segs: 6 }, mat, { detail: 1, collide: false });
  if (rings)
    for (const s of secs) {
      const loop = prof.map((_, k) => at(k, s));
      ref.shape([0, 0, 0], { t: 'tube', path: [...loop, loop[0]], r, segs: 6 }, mat, { detail: 1, collide: false });
    }
}

export function buildCabin(pod: NodeRef, type: Exclude<CabinType, 'hood'>, d: CabinDims) {
  const { iw, ih, idp, t } = d;
  const shell = pod.comp('cockpit', 'shell');
  const glass = pod.comp('glass');
  const frame = pod.comp('cockpit', 'frame');
  const W = iw / 2 + t * 1.6;
  const Ht = ih + t * 1.6;
  const fr = Math.max(0.025, t * 0.55);

  // armoured tub up to the sill: side plates + a sloped chin, faceted
  const tub = (sill: number, chin = 0.25) => {
    for (const sx of [-1, 1]) block(shell, [sx * (W - t * 0.6), sill / 2, 0], [t * 1.2, sill, idp + t * 2], d.armor, { r: t * 0.4, top: [0.8, 1], collide: false });
    block(shell, [0, sill / 2, idp / 2 + t * 0.6], [W * 2, sill, t * 1.2 + idp * chin * 0.2], d.armor, { r: t * 0.4, top: [1, 0.6], shift: [0, -idp * chin * 0.1], collide: false });
  };

  if (type === 'pod') {
    const sill = ih * 0.32;
    tub(sill);
    // hexagonal greenhouse bulb above the sill, faceted nose
    const prof: P2[] = [
      [W, sill],
      [W, sill + (Ht - sill) * 0.5],
      [W * 0.6, Ht],
      [-W * 0.6, Ht],
      [-W, sill + (Ht - sill) * 0.5],
      [-W, sill],
    ];
    const secs: Section[] = [
      { p: { k: 'pts', pts: prof }, z: -idp / 2 - t },
      { p: { k: 'pts', pts: prof }, z: idp * 0.12 },
      { p: { k: 'pts', pts: prof }, z: idp / 2 + idp * 0.22, sx: 0.66, sy: 0.82, oy: sill * 0.15 },
    ];
    glass.shape([0, 0, 0], { t: 'loft', sections: secs }, 'glass', { collide: false });
    frameBars(frame, prof, secs, [1, 2, 3, 4], fr, d.frame);
    // armoured roof plate over the back half (the hatch sits in it) + mid mullions
    block(shell, [0, Ht + t * 0.5, -idp * 0.22], [W * 1.25, t, idp * 0.62], d.armor, { r: t * 0.3, top: [0.85, 0.9], collide: false });
    for (const sx of [-0.33, 0.33]) frame.shape([0, 0, 0], { t: 'tube', path: [[sx * W * 1.2, Ht, idp * 0.12], [sx * W * 0.8, Ht * 0.82 + sill * 0.15, idp / 2 + idp * 0.22]], r: fr * 0.7, segs: 6 }, d.frame, { detail: 1, collide: false });
  } else if (type === 'tandem') {
    const sill = ih * 0.3;
    tub(sill, 0.4);
    // long teardrop canopy: low tail, tall middle, pointed nose
    const prof: P2[] = [
      [W * 0.92, sill],
      [W * 0.86, sill + (Ht - sill) * 0.6],
      [W * 0.42, Ht],
      [-W * 0.42, Ht],
      [-W * 0.86, sill + (Ht - sill) * 0.6],
      [-W * 0.92, sill],
    ];
    const secs: Section[] = [
      { p: { k: 'pts', pts: prof }, z: -idp / 2 - t, sx: 0.8, sy: 0.75, oy: sill * 0.25 },
      { p: { k: 'pts', pts: prof }, z: -idp * 0.25 },
      { p: { k: 'pts', pts: prof }, z: idp * 0.18 },
      { p: { k: 'pts', pts: prof }, z: idp / 2 + idp * 0.2, sx: 0.45, sy: 0.6, oy: sill * 0.4 },
    ];
    glass.shape([0, 0, 0], { t: 'loft', sections: secs }, 'glass', { collide: false });
    frameBars(frame, prof, secs, [2, 3], fr, d.frame);
    // spine fairing behind the canopy
    block(shell, [0, Ht * 0.86, -idp / 2 - t * 2], [W * 0.9, Ht * 0.3, t * 3], d.armor, { r: t * 0.4, top: [0.6, 0.8], collide: false });
  } else if (type === 'greenhouse') {
    const sill = ih * 0.38;
    tub(sill, 0.1);
    const c = t * 1.2;
    const prof: P2[] = [
      [W, sill],
      [W, Ht - c],
      [W - c, Ht],
      [-W + c, Ht],
      [-W, Ht - c],
      [-W, sill],
    ];
    const secs: Section[] = [
      { p: { k: 'pts', pts: prof }, z: -idp / 2 - t },
      { p: { k: 'pts', pts: prof }, z: 0 },
      { p: { k: 'pts', pts: prof }, z: idp / 2 + t * 0.5 },
    ];
    glass.shape([0, 0, 0], { t: 'loft', sections: secs }, 'glass', { collide: false });
    frameBars(frame, prof, secs, [0, 1, 2, 3, 4, 5], fr * 1.1, d.frame);
    // central front mullion, flat roof with overhang, guard bars across the windscreen
    frame.shape([0, 0, 0], { t: 'tube', path: [[0, sill, idp / 2 + t * 0.5], [0, Ht, idp / 2 + t * 0.5]], r: fr, segs: 6 }, d.frame, { detail: 1, collide: false });
    block(shell, [0, Ht + t * 0.6, t], [W * 2 + t * 2, t * 1.2, idp + t * 4], d.armor, { r: t * 0.3, top: [0.96, 0.96], collide: false });
    const gz = idp / 2 + t * 2.2;
    for (const y of [0.35, 0.6, 0.85]) frame.shape([0, 0, 0], { t: 'tube', path: [[-W * 0.95, sill + (Ht - sill) * y, gz], [W * 0.95, sill + (Ht - sill) * y, gz]], r: fr * 0.6, segs: 6 }, 'darkMetal', { detail: 1, collide: false });
    for (const sx of [-1, 1]) frame.shape([0, 0, 0], { t: 'tube', path: [[sx * W * 0.95, sill, idp / 2 + t], [sx * W * 0.95, sill + (Ht - sill) * 0.2, gz], [sx * W * 0.95, Ht * 0.95, gz], [sx * W * 0.95, Ht, idp / 2 + t]], r: fr * 0.7, segs: 6 }, 'darkMetal', { detail: 1, collide: false });
    // wiper blade
    frame.box([W * 0.3, sill + (Ht - sill) * 0.18, idp / 2 + t * 0.62], [W * 0.7, 0.02, 0.012], 'rubber', { detail: 2, collide: false, rot: [0, 0, 0.35] });
  } else if (type === 'bunker') {
    // heavy octagonal armour box, front chamfered; no big glass at all
    const c = Math.min(W, Ht) * 0.32;
    const prof: P2[] = [
      [W, 0],
      [W, Ht - c],
      [W - c, Ht],
      [-W + c, Ht],
      [-W, Ht - c],
      [-W, 0],
    ];
    const secs: Section[] = [
      { p: { k: 'pts', pts: prof }, z: -idp / 2 - t },
      { p: { k: 'pts', pts: prof }, z: idp * 0.28 },
      { p: { k: 'pts', pts: prof }, z: idp / 2 + t * 2.5, sx: 0.86, sy: 0.84, oy: Ht * 0.08 },
    ];
    shell.shape([0, 0, 0], { t: 'loft', sections: secs, bevel: t * 0.4 }, d.armor, { collide: false });
    // vision slit band wrapping the front, and its frame
    const ey = ih * 0.74;
    glass.shape([0, 0, 0], { t: 'loft', sections: [{ p: { k: 'rect', w: W * 1.66, h: ih * 0.07 }, z: idp / 2 + t * 2.5 - 0.01, oy: ey }, { p: { k: 'rect', w: W * 1.66, h: ih * 0.07 }, z: idp / 2 + t * 2.5 + t * 0.4, oy: ey }] }, 'glass', { collide: false });
    for (const dy of [-1, 1]) block(frame, [0, ey + dy * ih * 0.06, idp / 2 + t * 2.7], [W * 1.74, ih * 0.035, t * 0.6], 'darkMetal', { r: t * 0.1, detail: 1, collide: false });
    for (const sx of [-1, 1]) glass.box([sx * (W + 0.006), ey, idp * 0.12], [0.02, ih * 0.06, idp * 0.4], 'glass', { detail: 1, collide: false });
    // periscopes on the roof
    for (const sx of [-0.45, 0.45]) {
      block(frame, [sx * W, Ht + t * 1.4, idp * 0.12], [W * 0.32, t * 2.8, t * 2.4], 'darkMetal', { r: t * 0.2, collide: false, detail: 1 });
      frame.box([sx * W, Ht + t * 1.8, idp * 0.12 + t * 1.22], [W * 0.24, t * 1.1, 0.012], 'glass', { detail: 1, collide: false });
    }
    frame.bolts([-W * 0.8, Ht * 0.92, idp / 2 + t * 2.2], [W * 0.8, Ht * 0.92, idp / 2 + t * 2.2], 7, t * 0.4, 'z');
  } else if (type === 'ball') {
    // faceted ball head (8-sided lathe), centred over the floor, eye window to the front
    const R = Math.max(iw, ih, idp) * 0.74 + t;
    const cy = ih * 0.5;
    const pts: P2[] = [];
    const rings = 6;
    for (let i = 0; i <= rings; i++) {
      const a = -Math.PI / 2 + (i / rings) * Math.PI;
      pts.push([Math.max(0, Math.cos(a) * R), cy + Math.sin(a) * R]);
    }
    pts[0][0] = 0;
    pts[pts.length - 1][0] = 0;
    shell.shape([0, 0, 0], { t: 'lathe', pts, segs: 8 }, d.armor, { collide: false });
    // eye: octagonal window with a raised rim and a brow
    const ez = R * 0.9;
    const ey = cy + R * 0.12;
    const oct = (r: number) => ({ k: 'ngon' as const, r, n: 8, rot: Math.PI / 8 });
    glass.shape([0, ey, 0], { t: 'loft', sections: [{ p: oct(R * 0.42), z: ez - t * 3 }, { p: oct(R * 0.42), z: ez + t * 0.3 }] }, 'glass', { collide: false });
    // octagonal rim RING around the window (an 8-sided lathe band, open in the middle)
    frame.shape([0, ey, ez - t * 0.6], { t: 'lathe', axis: 'z', segs: 8, pts: [[R * 0.41, -t * 1.2], [R * 0.52, -t * 1.2], [R * 0.54, t * 0.2], [R * 0.5, t * 0.9], [R * 0.43, t * 0.9], [R * 0.41, t * 0.2]] }, d.frame, { collide: false });
    block(frame, [0, ey + R * 0.5, ez - R * 0.12], [R * 1.1, t * 1.4, R * 0.5], d.armor, { r: t * 0.4, top: [0.8, 0.6], collide: false });
    // neck collar
    shell.shape([0, 0, 0], { t: 'lathe', segs: 12, pts: [[0, -t * 3], [R * 0.55, -t * 3], [R * 0.6, -t], [R * 0.5, t], [0, t]] }, 'darkMetal', { collide: false });
  }
}

/** Interior furniture per cabin type, at true human scale. */
export function cabinInterior(int: NodeRef, type: CabinType, iw: number, ih: number, idp: number) {
  const seat = (z: number) => {
    int.box([0, 0.25, z], [0.55, 0.12, 0.5], 'interior');
    int.box([0, 0.65, z - 0.27], [0.55, 0.75, 0.1], 'interior', { rot: [-0.18, 0, 0] });
    int.box([0, 0.12, z], [0.2, 0.25, 0.2], 'darkMetal');
    for (const sx of [-1, 1]) int.box([sx * 0.31, 0.42, z + 0.02], [0.07, 0.07, 0.36], 'darkMetal', { detail: 1, collide: false });
  };
  const screen = (x: number, y: number, z: number, w: number, h: number, yaw = 0, tilt = -0.25) => {
    int.box([x, y, z], [w, h, 0.03], 'emissive', { rot: [tilt, yaw, 0], detail: 1, collide: false });
    int.box([x, y, z - 0.02], [w + 0.04, h + 0.04, 0.02], 'darkMetal', { rot: [tilt, yaw, 0], detail: 1, collide: false });
  };
  const sticks = (z: number) => {
    for (const sx of [-1, 1]) int.cyl([sx * 0.32, 0.45, z + 0.13], 0.025, 0.25, 'rubber', { detail: 1, collide: false, segments: 6 });
  };
  if (type === 'tandem') {
    for (const z of [-idp * 0.22, idp * 0.2]) {
      seat(z);
      sticks(z);
      int.box([0, 0.55, z + 0.5], [iw * 0.7, 0.1, 0.25], 'interior', { rot: [-0.35, 0, 0] });
      screen(0, 0.72, z + 0.56, iw * 0.45, 0.22);
    }
    return;
  }
  const sz = -idp * 0.18;
  seat(sz);
  if (type === 'pod' || type === 'ball' || type === 'hood') {
    // wraparound consoles
    int.box([0, 0.5, idp * 0.3], [iw * 0.85, 0.12, 0.35], 'interior', { rot: [-0.35, 0, 0] });
    screen(0, 0.72, idp * 0.38, iw * 0.55, 0.28);
    for (const sx of [-1, 1]) {
      int.box([sx * iw * 0.38, 0.55, idp * 0.05], [0.18, 0.1, idp * 0.45], 'interior', { rot: [0, 0, sx * 0.4] });
      screen(sx * iw * 0.36, 0.78, idp * 0.12, 0.22, 0.18, -sx * 0.6);
    }
    sticks(sz);
  } else if (type === 'greenhouse') {
    // excavator style: low dash, big levers, pedals, side control box
    int.box([0, 0.38, idp * 0.32], [iw * 0.8, 0.2, 0.2], 'interior');
    for (const sx of [-1, 1]) {
      int.cyl([sx * 0.18, 0.62, idp * 0.12], 0.02, 0.5, 'steel', { rot: [0.25, 0, 0], detail: 1, collide: false, segments: 6 });
      int.sphere([sx * 0.18, 0.86, idp * 0.18], 0.04, 'rubber', { detail: 1, collide: false, segments: 8 });
      int.box([sx * 0.15, 0.06, idp * 0.22], [0.12, 0.04, 0.2], 'steel', { detail: 2, collide: false });
    }
    int.box([iw * 0.36, 0.45, sz], [0.18, 0.3, 0.4], 'interior');
    screen(iw * 0.3, 0.95, idp * 0.3, 0.2, 0.15, -0.3, -0.1);
  } else if (type === 'bunker') {
    // no windows: a wall of screens, and a periscope eyepiece
    for (let i = -1; i <= 1; i++) screen(i * iw * 0.3, 0.85, idp * 0.42, iw * 0.27, 0.22, -i * 0.25, -0.05);
    for (let i = -1; i <= 1; i += 2) screen(i * iw * 0.2, 1.1, idp * 0.4, iw * 0.25, 0.14, -i * 0.15, 0.2);
    int.box([0, 0.5, idp * 0.3], [iw * 0.85, 0.12, 0.35], 'interior', { rot: [-0.35, 0, 0] });
    int.cyl([0, Math.min(ih - 0.1, 1.25), idp * 0.1], 0.05, 0.25, 'darkMetal', { detail: 1, collide: false, segments: 8 });
    sticks(sz);
  }
}
