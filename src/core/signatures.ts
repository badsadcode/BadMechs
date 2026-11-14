/**
 * Manufacturer signature elements: architecture (not paint) that says "this came from that
 * factory" at a glance.
 *   sensor-head (Bastion)  articulated camera/sensor head on the hull top, lenses and a mast
 *   springs     (Lynx)     yellow coil-over shock absorbers around the leg rams + twin antennas
 *   rails       (Ostrava)  yellow safety handrails round the deck and a work-light bar on the cab
 *   brow        (Volkov)   a sloped armour brow over the cockpit + low side skirts
 */
import type { Builder } from './builder';
import type { Mech, Vec3 } from './model';
import type { Signature } from './makers';
import { block, hub } from './hs/kit';
import type { V3 } from './hs/mesh';

export interface SignatureSite {
  /** node the hull geometry belongs to (torso / body) */
  host: string;
  /** hull top y, front z, back z, half width, sideways shift (all host-local) */
  topY: number;
  frontZ: number;
  backZ: number;
  halfW: number;
  shiftX: number;
  /** mech height, for scaling */
  H: number;
  /** cockpit pod: host-local floor centre and interior size */
  cockpit?: { at: Vec3; iw: number; ih: number; idp: number; wall: number };
  /** free spot on top for a sensor head (host-local) */
  topSpot?: Vec3;
}

export function applySignature(b: Builder, sig: Signature, s: SignatureSite) {
  const host = b.get(s.host);
  const H = s.H;
  if (sig === 'sensor-head') {
    const at: Vec3 = s.topSpot ?? [s.shiftX, s.topY, s.frontZ - (s.frontZ - s.backZ) * 0.25];
    const u = H * 0.035;
    const yaw = host.child('sensor_head_yaw', at, { system: 'sensor', joint: { axis: 'y', min: -75, max: 75, purpose: 'aim', kind: 'sensor-yaw' } });
    hub(yaw.comp('joint-housing'), [0, u * 0.25, 0], 'y', { r: u * 0.9, w: u * 0.5, bolts: 6 });
    yaw.comp('frame').shape([0, 0, 0], { t: 'lathe', segs: 10, pts: [[0, 0], [u * 0.4, 0], [u * 0.4, u * 1.4], [0, u * 1.4]] }, 'darkMetal');
    const tilt = yaw.child('sensor_head_pitch', [0, u * 1.6, 0], { joint: { axis: 'x', min: -30, max: 20, purpose: 'aim', kind: 'sensor-pitch' } });
    const hd = tilt.comp('equipment');
    block(hd, [0, 0, 0], [u * 2.6, u * 1.5, u * 1.9], 'paint', { r: u * 0.3, top: [0.85, 0.9], frontPanel: { inset: u * 0.15, depth: u * 0.12 } });
    block(hd, [0, u * 0.85, -u * 0.2], [u * 1.6, u * 0.3, u * 1.2], 'darkMetal', { r: u * 0.1, detail: 1, collide: false });
    for (const [x, r, mat] of [
      [-u * 0.6, u * 0.42, 'glass'],
      [u * 0.45, u * 0.3, 'emissive'],
      [u * 0.95, u * 0.18, 'hazard'],
    ] as const) {
      hd.shape([x, 0, u * 0.95], { t: 'lathe', axis: 'z', segs: 14, pts: [[0, -u * 0.05], [r * 1.25, -u * 0.05], [r * 1.25, u * 0.12], [r, u * 0.16], [0, u * 0.14]] }, 'darkMetal', { detail: 1, collide: false });
      hd.shape([x, 0, u * 0.95], { t: 'lathe', axis: 'z', segs: 14, pts: [[0, u * 0.12], [r * 0.9, u * 0.12], [r * 0.6, u * 0.2], [0, u * 0.22]] }, mat, { detail: 1, collide: false });
    }
    hd.cyl([-u * 1.0, u * 1.5, -u * 0.5], u * 0.05, u * 2.2, 'steel', { detail: 2, collide: false, segments: 5 });
    b.mounts.push({ name: 'sensor_head', node: tilt.name, type: 'sensor', note: 'Bastion Works sensor head (yaw + pitch)' });
  } else if (sig === 'springs') {
    // Lynx twin whip antennas on the back of the hull (the coil-overs are added after pistons resolve)
    const ant = host.comp('detail', 'antennas');
    for (const sx of [-1, 1]) {
      const x = s.shiftX + sx * s.halfW * 0.45;
      const z = s.backZ + (s.frontZ - s.backZ) * 0.15;
      ant.shape([x, s.topY, z], { t: 'lathe', segs: 8, pts: [[0, 0], [H * 0.008, 0], [H * 0.008, H * 0.025], [H * 0.003, H * 0.03], [H * 0.0025, H * 0.16], [0, H * 0.165]] }, 'darkMetal', { detail: 1, collide: false });
      ant.shape([x, s.topY, z], { t: 'lathe', segs: 8, pts: [[H * 0.0035, H * 0.08], [H * 0.006, H * 0.08], [H * 0.006, H * 0.095], [H * 0.0035, H * 0.095]] }, 'hazard', { detail: 2, collide: false });
    }
  } else if (sig === 'rails') {
    // safety handrails round the top deck, on posts
    const rails = host.comp('equipment', 'rails');
    const r = Math.max(0.025, H * 0.004);
    const y = s.topY + Math.max(0.9, H * 0.05);
    const x0 = s.shiftX - s.halfW * 0.88;
    const x1 = s.shiftX + s.halfW * 0.88;
    const z0 = s.backZ + (s.frontZ - s.backZ) * 0.08;
    const z1 = s.backZ + (s.frontZ - s.backZ) * 0.7;
    const loop: V3[] = [
      [x0, y, z1],
      [x0, y, z0],
      [x1, y, z0],
      [x1, y, z1],
    ];
    rails.shape([0, 0, 0], { t: 'tube', path: loop, r, segs: 8 }, 'hazard', { detail: 1, collide: false });
    for (const p of loop) rails.shape([0, 0, 0], { t: 'tube', path: [[p[0], s.topY, p[2]], [p[0], y, p[2]]], r: r * 0.85, segs: 6 }, 'hazard', { detail: 1, collide: false });
    for (const x of [x0, x1]) rails.shape([0, 0, 0], { t: 'tube', path: [[x, s.topY, (z0 + z1) / 2], [x, y, (z0 + z1) / 2]], r: r * 0.85, segs: 6 }, 'hazard', { detail: 1, collide: false });
    // work-light bar on the cockpit roof
    if (s.cockpit) {
      const c = s.cockpit;
      const cp = b.get('cockpit');
      const lb = cp.comp('light', 'bar');
      const ly = c.ih + c.wall * 2.6;
      block(lb, [0, ly, c.idp * 0.15], [c.iw * 0.9, c.wall * 1.6, c.wall * 2], 'darkMetal', { r: c.wall * 0.3, collide: false });
      for (let i = 0; i < 4; i++) lb.box([(i - 1.5) * c.iw * 0.22, ly, c.idp * 0.15 + c.wall * 1.02], [c.iw * 0.16, c.wall * 1.1, 0.02], 'emissive', { detail: 1, collide: false });
      // grab rails either side of the canopy
      for (const sx of [-1, 1]) lb.shape([0, 0, 0], { t: 'tube', path: [[sx * (c.iw / 2 + c.wall * 2.2), c.ih * 0.25, -c.idp * 0.3], [sx * (c.iw / 2 + c.wall * 2.2), c.ih * 0.95, -c.idp * 0.3], [sx * (c.iw / 2 + c.wall * 2.2), c.ih * 0.95, c.idp * 0.3]], r, segs: 8 }, 'hazard', { detail: 1, collide: false });
    }
  } else if (sig === 'brow') {
    if (s.cockpit) {
      const c = s.cockpit;
      const cp = b.get('cockpit').comp('armor', 'brow');
      // sloped armour brow overhanging the canopy, with a stepped inlay and bolt row
      block(cp, [0, c.ih + c.wall * 2.6, c.idp * 0.28], [c.iw + c.wall * 7, c.wall * 2.4, c.idp * 0.85], 'paint', { r: c.wall * 0.6, top: [0.88, 0.7], shift: [0, -c.idp * 0.08], collide: false });
      block(cp, [0, c.ih + c.wall * 3.9, c.idp * 0.2], [c.iw * 0.7, c.wall * 0.7, c.idp * 0.45], 'paint2', { r: c.wall * 0.25, detail: 1, collide: false });
      cp.bolts([-c.iw * 0.55, c.ih + c.wall * 3.85, c.idp * 0.62], [c.iw * 0.55, c.ih + c.wall * 3.85, c.idp * 0.62], 6, c.wall * 0.35, 'y');
    }
    // low side skirts along the hull flanks
    const sk = host.comp('armor', 'skirts');
    const t = Math.max(0.05, H * 0.008);
    for (const sx of [-1, 1]) {
      const len = (s.frontZ - s.backZ) * 0.42;
      for (let i = 0; i < 2; i++) {
        const zc = s.backZ + (s.frontZ - s.backZ) * (0.28 + i * 0.44);
        block(sk, [s.shiftX + sx * (s.halfW + t * 1.6), s.topY * 0.28, zc], [t, s.topY * 0.36, len * 0.95], i ? 'paint' : 'paint2', { r: t * 0.4, top: [1, 0.85], rot: [0, 0, sx * 0.12], collide: false });
      }
    }
  }
}

/** Lynx coil-overs: a yellow spring wound round every leg ram's barrel (after pistons exist). */
export function addCoilSprings(b: Builder, mech: Mech) {
  for (const a of mech.actuators) {
    if (!/^leg_/.test(a.name)) continue;
    const base = b.get(a.baseNode);
    const r0 = a.barrelLength * 0.08;
    const R = Math.max(0.03, base.node.prims.length ? Math.max(...base.node.prims.filter((p) => p.kind === 'shape').map((p) => Math.max(p.size[0], p.size[1]) / 2)) * 1.25 : r0);
    const z0 = R * 1.1;
    const z1 = a.barrelLength * 0.95;
    const turns = Math.max(4, Math.round((z1 - z0) / (R * 0.75)));
    const path: V3[] = [];
    const n = turns * 10;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const ang = t * turns * Math.PI * 2;
      path.push([Math.cos(ang) * R, Math.sin(ang) * R, z0 + (z1 - z0) * t]);
    }
    base.shape([0, 0, 0], { t: 'tube', path, r: R * 0.14, segs: 6 }, 'hazard', { detail: 1, collide: false });
    // spring seats
    for (const z of [z0 - R * 0.1, z1]) base.shape([0, 0, z], { t: 'lathe', axis: 'z', segs: 12, pts: [[R * 0.6, -R * 0.08], [R * 1.25, -R * 0.08], [R * 1.25, R * 0.08], [R * 0.6, R * 0.08]] }, 'darkMetal', { detail: 1, collide: false });
  }
}
