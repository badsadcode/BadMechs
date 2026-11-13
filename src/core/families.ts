import { Builder } from './builder';
import type { MaterialId, Mech, Vec3 } from './model';
import { makePalette } from './palette';
import { arm, ArmTool, cockpit, ladder, lightPod, missileRack, SegStyle, segmentOut, sprawlLeg, uprightLeg, vents } from './parts';
import { fitJointLimits, LimitFit } from './validate';
import { GenCtx, MechRecipe, mechName, ResolvedOption } from './recipe';

export interface GenResult {
  mech: Mech;
  options: ResolvedOption[];
  /** joint limits narrowed by the clearance fitter */
  fits: LimitFit[];
}

export function generate(recipe: MechRecipe): GenResult {
  const ctx = new GenCtx(recipe);
  const b = new Builder(mechName(recipe), recipe.family, makePalette(recipe.scheme));
  let sizeClass: string;
  switch (recipe.family) {
    case 'biped':
      sizeClass = biped(ctx, b, 'standard');
      break;
    case 'exosuit':
      sizeClass = biped(ctx, b, 'exo');
      break;
    case 'colossus':
      sizeClass = colossus(ctx, b);
      break;
    case 'quadruped':
      sizeClass = quadruped(ctx, b, false);
      break;
    case 'hexapod':
      sizeClass = multiLeg(ctx, b, 6);
      break;
    case 'octopod':
      sizeClass = multiLeg(ctx, b, 8);
      break;
    default:
      throw new Error(`unknown family ${recipe.family}`);
  }
  const mech = b.finalize(sizeClass);
  const fits = fitJointLimits(mech);
  return { mech, options: ctx.options, fits };
}

function style(ctx: GenCtx, slot: string, plating: number, lattice: boolean, armor: MaterialId = 'paint', accent: MaterialId = 'hazard'): SegStyle {
  return { armor, accent, plating, lattice, rng: ctx.rng(slot + '.style') };
}

const isFighter = (r: string) => r === 'combat' || r === 'scout';

// ─────────────────────────────────────────────────────────────── biped ──

function biped(ctx: GenCtx, b: Builder, mode: 'standard' | 'exo' | 'colossus', H0?: number): string {
  const r = ctx.recipe;
  const exo = mode === 'exo';
  const colo = mode === 'colossus';
  const fighter = isFighter(r.role);
  const weight = exo
    ? 'exo'
    : colo
      ? 'colossal'
      : ctx.choice('body.weight', 'Weight class', 'body', ['light', 'medium', 'heavy', 'assault'] as const, r.role === 'scout' ? [6, 2, 0.5, 0] : fighter ? [1, 3, 3, 2] : [1, 3, 2, 0.5]);
  const baseH = H0 ?? (exo ? 2.6 : ({ light: 7, medium: 9.5, heavy: 11.5, assault: 13, colossal: 28 } as Record<string, number>)[weight]);
  const H = baseH * r.scale;
  const bulk = Math.min(1, Math.max(0, r.bulk + (weight === 'heavy' ? 0.12 : weight === 'assault' ? 0.25 : weight === 'light' ? -0.15 : 0)));
  const plating = exo ? 0.25 + bulk * 0.3 : fighter ? 0.55 + bulk * 0.45 : 0.3 + bulk * 0.4;
  const lattice = exo || ctx.flag('frame.lattice', 'Open lattice frame', 'body', r.role === 'industrial' || r.role === 'salvage' ? 0.45 : 0.08);
  const hydraulics = ctx.flag('frame.hydraulics', 'Exposed hydraulics', 'legs', exo ? 0.95 : fighter ? 0.55 : 0.9);
  const legStyle = exo ? 'plantigrade' : ctx.choice('legs.style', 'Leg style', 'legs', ['plantigrade', 'digitigrade'] as const, r.role === 'scout' ? [1, 3] : [3, 1.4]);
  const foot = ctx.choice('legs.foot', 'Foot', 'legs', ['flat', 'claw', 'hoof'] as const, legStyle === 'digitigrade' ? [1, 3, 0.5] : [4, 1, 1]);
  const legStyleS = style(ctx, 'legs', plating, lattice);

  const root = b.node('root', null, [0, 0, 0], { role: 'root', system: 'root' });
  const pelvis = root.child('pelvis', [0, 0, 0], { role: 'link', system: 'torso', tags: ['body'] });

  // ── legs
  const lw = H * (exo ? 0.085 : 0.075) * (0.85 + bulk * 0.5);
  const ld = lw * 1.12;
  const hipW = H * (exo ? 0.11 : 0.11) * (0.9 + bulk * 0.35);
    // exosuit legs are sized around a human leg inside them (pilot hip ≈ 1.0–1.1 m)
  const lens = exo ? [0.5, 0.5] : legStyle === 'digitigrade' ? [H * 0.2, H * 0.24, H * 0.15] : [H * 0.235, H * 0.235];
  const phis = legStyle === 'digitigrade' ? [40, -36, 12] : [16 + bulk * 6, -(16 + bulk * 6)];
  let drop = 0;
  const legs: { id: string; res: ReturnType<typeof uprightLeg> }[] = [];
  for (const [id, side] of [
    ['L', 1],
    ['R', -1],
  ] as const) {
    const res = uprightLeg(b, 'pelvis', [side * hipW, 0, 0], {
      id,
      side,
      lens,
      phis,
      w: lw,
      d: ld,
      foot,
      footLen: H * (foot === 'claw' ? 0.17 : 0.15) * (0.9 + bulk * 0.3),
      footW: lw * (foot === 'hoof' ? 1.1 : 1.35),
      footH: H * 0.035,
      style: legStyleS,
      hydraulics,
      phase: id === 'L' ? 0 : 0.5,
      legStyle,
    });
    drop = res.drop;
    legs.push({ id, res });
  }
  pelvis.node.position[1] = drop;
  for (const { id, res } of legs)
    b.leg({ name: `leg_${id}`, side: id as 'L' | 'R', index: 0, style: legStyle, joints: res.joints, footNode: res.foot, contactOffset: res.contact, gaitPhase: id === 'L' ? 0 : 0.5 });

  // pelvis geometry: hip girder
  const pf = pelvis.comp('frame');
  pf.chamfer([0, 0, 0], [hipW * 2 - lw * 0.4, H * 0.06, ld * 1.3], H * 0.012, 'darkMetal', { rot: [0, 0, 0] });
  pf.cyl([0, H * 0.04, 0], H * 0.06, H * 0.05, 'steel', { segments: 20 }); // torso twist bearing
  const pa = pelvis.comp('armor');
  if (plating > 0.3) {
    pa.taper([0, -H * 0.02, ld * 0.75], [hipW * 1.1, H * 0.09, H * 0.025], [0.8, 1], [0, 0], 'paint');
    pa.bolts([-hipW * 0.4, H * 0.015, ld * 0.78 + H * 0.013], [hipW * 0.4, H * 0.015, ld * 0.78 + H * 0.013], 5, H * 0.003, 'z');
  }

  // ── torso
  const twist = fighter ? 75 : 45;
  const torso = pelvis.child('torso', [0, H * 0.055, 0], { system: 'torso', joint: { axis: 'y', min: -twist, max: twist, purpose: 'torso', kind: 'torso-twist' } });
  const tw = H * (exo ? 0.2 : 0.3) * (0.85 + bulk * 0.45);
  const th = H * (exo ? 0.17 : 0.2) * (0.9 + bulk * 0.25);
  const td = H * (exo ? 0.12 : 0.2) * (0.85 + bulk * 0.35);
  const cockpitStyle = exo
    ? 'cage'
    : ctx.choice('cockpit.style', 'Cockpit', 'cockpit', ['canopy', 'armored', 'bubble'] as const, r.role === 'scout' ? [2, 0.5, 2] : fighter ? [2, 2, 0.6] : [1.5, 0.6, 2]);
  const cockpitPos = exo ? 'center' : ctx.choice('cockpit.position', 'Cockpit position', 'cockpit', ['center', 'offset', 'high'] as const, [3, 1, 1.4]);

  const tf = torso.comp('frame');
  const ta = torso.comp('armor');
  // torso spine / body core (behind the cockpit zone)
  let cockpitAt: Vec3;
  // exosuit: a harness cage around the pilot's torso; their legs go down into the mech's thighs
  const iw = exo ? 0.62 : Math.max(1.05, H * 0.11);
  const ih = exo ? 0.95 : Math.max(1.32, H * 0.1);
  const idp = exo ? 0.5 : Math.max(1.3, H * 0.11);
  const wall = exo ? 0.04 : Math.max(0.06, H * 0.009);
  if (exo) {
    // exosuit: the pilot stands in a cage between hips and shoulders; the "torso" is a backpack frame
    tf.chamfer([0, th * 0.5, -td * 0.55], [tw * 0.9, th * 1.3, td * 0.5], 0.05, 'darkMetal');
    tf.box([0, th * 1.15, -td * 0.5], [tw * 1.2, th * 0.14, td * 0.6], 'steel');
    vents(torso, [0, th * 0.6, -td * 0.82], tw * 0.5, th * 0.5, 'z', -1);
    ta.taper([0, th * 0.6, -td * 0.88], [tw * 0.85, th * 0.9, 0.05], [0.8, 1], [0, 0], 'paint', { detail: 1 });
    cockpitAt = [0, 0.02, -td * 0.3 + idp / 2 + 0.03];
  } else {
    const coreZ = -td * 0.18;
    if (colo) {
      // hollow core: walls, floor and roof so the machinery deck inside is real space
      const cw = tw * 0.85;
      const ch = th * 0.95;
      const cd = td * 0.7;
      const t = 0.25;
      const cy = th * 0.45;
      tf.box([0, cy - ch / 2 + t / 2, coreZ], [cw, t, cd], 'darkMetal');
      tf.box([0, cy + ch / 2 - t / 2, coreZ], [cw, t, cd], 'darkMetal');
      for (const sx of [-1, 1]) tf.box([sx * (cw / 2 - t / 2), cy, coreZ], [t, ch, cd], 'darkMetal');
      tf.box([0, cy, coreZ - cd / 2 + t / 2], [cw, ch, t], 'darkMetal');
      tf.box([0, cy, coreZ + cd / 2 - t / 2], [cw, ch, t], 'darkMetal');
    } else tf.chamfer([0, th * 0.45, coreZ], [tw * 0.85, th * 0.95, td * 0.7], th * 0.1, 'darkMetal');
    // shoulder yoke
    tf.chamfer([0, th * 0.85, coreZ], [tw * 1.15, th * 0.22, td * 0.5], th * 0.06, 'darkMetal');
    // armour shell around the core, top deck + flanks + back
    ta.taper([0, th * 1.0, coreZ], [tw * 0.95, th * 0.14, td * 0.8], [0.85, 0.85], [0, 0], 'paint');
    for (const sx of [-1, 1]) {
      ta.chamfer([sx * tw * 0.47, th * 0.48, coreZ], [tw * 0.12, th * 0.8, td * 0.8], th * 0.05, 'paint', { rot: [0, 0, 0] });
      ta.bolts([sx * (tw * 0.53 + 0.005), th * 0.8, coreZ - td * 0.3], [sx * (tw * 0.53 + 0.005), th * 0.8, coreZ + td * 0.3], 6, H * 0.003, 'x');
      if (ctx.rng('torso').chance(0.7)) ta.box([sx * (tw * 0.53 + 0.004), th * 0.4, coreZ], [0.01, th * 0.18, td * 0.3], 'hazard', { detail: 1, collide: false });
    }
    ta.taper([0, th * 0.55, coreZ - td * 0.38], [tw * 0.8, th * 0.85, td * 0.1], [0.9, 1], [0, 0], 'paint2');
    vents(torso, [tw * 0.2, th * 0.55, coreZ - td * 0.44], tw * 0.25, th * 0.4, 'z', -1);
    vents(torso, [-tw * 0.2, th * 0.55, coreZ - td * 0.44], tw * 0.25, th * 0.4, 'z', -1);
    // reactor pack / backpack
    if (ctx.flag('torso.backpack', 'Reactor backpack', 'torso', 0.6)) {
      const bp = torso.comp('equipment', 'reactor');
      bp.chamfer([0, th * 0.6, coreZ - td * 0.58], [tw * 0.6, th * 0.7, td * 0.3], th * 0.06, 'paint2');
      for (const sx of [-1, 1]) bp.cyl([sx * tw * 0.2, th * 1.15, coreZ - td * 0.62], H * 0.018, th * 0.5, 'darkMetal', { segments: 10, detail: 1 });
    }
    const front = coreZ + td * 0.35;
    const cx = cockpitPos === 'offset' ? (ctx.rng('cockpit').chance(0.5) ? 1 : -1) * tw * 0.18 : 0;
    const cy = cockpitPos === 'high' ? th * 0.55 : th * 0.2;
    cockpitAt = [cx, cy, front + idp / 2 + wall * 1.2];
    if (cockpitPos === 'high') {
      // neck mount for a high "head" cockpit
      tf.chamfer([cx, th * 0.75, front], [iw * 0.6, th * 0.3, idp * 0.6], 0.05, 'darkMetal');
    }
    // lights
    lightPod(torso, [tw * 0.38, th * 0.85, front + td * 0.05], H * 0.012);
    lightPod(torso, [-tw * 0.38, th * 0.85, front + td * 0.05], H * 0.012);
  }

  cockpit(b, 'torso', cockpitAt, {
    style: cockpitStyle,
    iw,
    ih,
    id: idp,
    wall,
    armor: 'paint',
    hatch: exo ? 'none' : ctx.choice('cockpit.hatch', 'Cockpit hatch', 'cockpit', ['top', 'rear'] as const),
    rng: ctx.rng('cockpit'),
  });
  if (!exo) {
    // cockpit armour cheeks merge the pod into the torso
    const ca = b.get('cockpit').comp('armor');
    for (const sx of [-1, 1]) ca.taper([sx * (iw / 2 + wall * 1.5), ih * 0.45, -idp * 0.05], [wall * 2, ih * 0.9, idp * 0.95], [1, 0.8], [0, -idp * 0.05], 'paint');
  }

  // ── arms
  const armless = !exo && !colo && fighter && ctx.flag('arms.none', 'Armless (weapon pods)', 'arms', 0.12);
  const armW = H * (exo ? 0.065 : 0.06) * (0.85 + bulk * 0.5);
  // every tool is pickable; the role only changes the odds
  const tools: ArmTool[] = ['cannon', 'rotary', 'missile', 'gripper', 'claw', 'drill', 'shield'];
  const weights = fighter ? [3, 3, 2, 1, 0.3, 0, 0.6] : [0.3, 0, 0, 3, 2, 1.5, 0];
  if (!armless) {
    const toolL = ctx.choice('arms.L.tool', 'Left arm tool', 'arms.L', tools, weights);
    const sym = ctx.flag('arms.symmetric', 'Symmetric arms', 'arms', fighter ? 0.35 : 0.6);
    const toolR = sym ? toolL : ctx.choice('arms.R.tool', 'Right arm tool', 'arms.R', tools, weights);
    const shoulderY = exo ? th * 1.05 : th * 0.8;
    const shoulderX = exo ? tw * 0.5 + armW * 1.6 : tw * 0.5 + armW * 0.85;
    for (const [id, side, tool] of [
      ['L', 1, toolL],
      ['R', -1, toolR],
    ] as const) {
      arm(b, 'torso', [side * shoulderX, shoulderY, exo ? -td * 0.1 : -td * 0.15], {
        id,
        side,
        upper: H * (exo ? 0.2 : 0.19),
        fore: H * (exo ? 0.17 : 0.17),
        w: armW,
        d: armW * 1.15,
        tool,
        style: style(ctx, `arms.${id}`, plating, lattice),
        hydraulics,
      });
    }
  }
  // ── shoulder weapon pods
  if (!exo && (fighter || armless)) {
    const pods = armless ? 2 : ctx.int('pods.count', 'Shoulder pods', 'pods', 0, 2);
    const podSize = H * 0.1 * (0.8 + bulk * 0.4);
    const top = th * 1.07;
    if (pods === 1) missileRack(b, 'torso', [ctx.rng('pods').chance(0.5) ? tw * 0.3 : -tw * 0.3, top, -td * 0.25], 'C', podSize, style(ctx, 'pods', plating, false));
    if (pods === 2) for (const [id, sx] of [['L', 1], ['R', -1]] as const) missileRack(b, 'torso', [sx * tw * 0.32, top, -td * 0.25], id, podSize, style(ctx, 'pods', plating, false));
  }
  if (!exo && ctx.flag('torso.antenna', 'Antenna mast', 'torso', 0.6)) {
    torso.comp('detail').cyl([-tw * 0.35, th * 1.4, -td * 0.4], H * 0.003, th * 0.8, 'steel', { segments: 5, detail: 2, collide: false });
  }
  if (!exo && H > 8.5) {
    // boarding ladder up the back of the left thigh is silly; real mechs kneel. Put it on the torso flank.
    ladder(torso, tw * 0.56 + 0.05, -td * 0.05, -th * 0.2, th * 0.95);
    b.mounts.push({ name: 'boarding_ladder', node: 'torso', type: 'ladder', note: 'kneel pose brings the ladder base within reach' });
  }

  b.gait = {
    type: 'biped-walk',
    stepHeight: H * 0.06,
    strideLength: H * 0.22 * (legStyle === 'digitigrade' ? 1.2 : 1),
    cycleSeconds: 1.1 + H * 0.06,
    bodyHeight: drop,
    groups: [['leg_L'], ['leg_R']],
  };
  return exo ? 'exosuit' : colo ? 'colossal' : weight;
}

// ───────────────────────────────────────────────────────────── colossus ──

function colossus(ctx: GenCtx, b: Builder): string {
  const frame = ctx.choice('colossus.frame', 'Colossus frame', 'body', ['quad', 'biped'] as const, [2, 1]);
  if (frame === 'biped') {
    const cls = biped(ctx, b, 'colossus');
    addDeckInterior(ctx, b, 'torso');
    return cls;
  }
  return quadruped(ctx, b, true);
}

/** Walkable machinery deck inside a big hull: floor, walls kept clear, ladder, machinery blocks, door. */
function addDeckInterior(ctx: GenCtx, b: Builder, parent: string) {
  const torso = b.get(parent);
  // Deck sits behind the cockpit, inside the torso core volume
  const r = ctx.recipe;
  const H = 28 * r.scale;
  const deckW = H * 0.2;
  const deckD = H * 0.1;
  const deckY = H * 0.035;
  const deck = torso.child('deck_machinery', [0, deckY, -H * 0.055], { role: 'group', system: 'interior', component: 'interior' });
  const f = deck.comp('interior');
  f.box([0, -0.05, 0], [deckW, 0.1, deckD], 'floor');
  // machinery blocks along the walls, leaving a 1.2 m aisle
  for (const sx of [-1, 1]) {
    f.box([sx * (deckW / 2 - 0.6), 1.0, 0], [1.0, 2.0, deckD * 0.8], 'interior');
    f.box([sx * (deckW / 2 - 0.6), 1.6, deckD * 0.4 + 0.01], [0.5, 0.3, 0.02], 'emissive', { detail: 1, collide: false });
  }
  f.box([0, 2.6, 0], [deckW, 0.08, 0.3], 'steel', { detail: 1, collide: false }); // cable tray
  ladder(deck, 0, -deckD / 2 + 0.25, 0, 2.6, 0.5);
  b.interiors.push({ name: 'machinery_deck', node: deck.name, min: [-deckW / 2 + 1.1, 0, -deckD / 2], max: [deckW / 2 - 1.1, 2.4, deckD / 2], walkable: true, kind: 'machinery' });
}

// ──────────────────────────────────────────────────────────── quadruped ──

function quadruped(ctx: GenCtx, b: Builder, colossal: boolean): string {
  const r = ctx.recipe;
  const fighter = isFighter(r.role);
  const legKind = ctx.choice('legs.kind', 'Leg layout', 'legs', ['sprawl', 'upright'] as const, colossal ? [1, 2] : [2, 1.2]);
  const H = (colossal ? 24 : legKind === 'sprawl' ? 7.5 : 8.5) * r.scale;
  const bulk = r.bulk;
  const plating = fighter ? 0.6 + bulk * 0.3 : 0.25 + bulk * 0.35;
  const lattice = !fighter && ctx.flag('frame.lattice', 'Open lattice frame', 'body', 0.4);
  const hydraulics = ctx.flag('frame.hydraulics', 'Exposed hydraulics', 'legs', 0.85);
  const bodyL = H * (colossal ? 0.95 : 0.85) * (0.9 + bulk * 0.25);
  const bodyW = H * 0.5 * (0.85 + bulk * 0.3);
  const bodyH = H * (colossal ? 0.3 : 0.2) * (0.9 + bulk * 0.3);

  const root = b.node('root', null, [0, 0, 0], { role: 'root', system: 'root' });
  const body = root.child('body', [0, 0, 0], { role: 'link', system: 'body', tags: ['body'] });
  const st = style(ctx, 'legs', plating, lattice);

  const ids = [
    ['FL', 1, 1],
    ['FR', -1, 1],
    ['RL', 1, -1],
    ['RR', -1, -1],
  ] as const;
  const phases: Record<string, number> = { FL: 0, RR: 0.5 * 0 + 0.0, FR: 0.5, RL: 0.5 };
  let drop = 0;
  const legsOut: { id: string; joints: string[]; foot: string; contact: Vec3 }[] = [];
  if (legKind === 'upright') {
    const lw = H * 0.07 * (0.85 + bulk * 0.4);
    const qfoot = ctx.choice('legs.foot', 'Foot', 'legs', ['flat', 'hoof', 'claw'] as const, [2, 2, 1]);
    for (const [id, side, fz] of ids) {
      // front knees point back, rear hocks point forward: classic mammal/hauler arrangement
      const phis = fz > 0 ? [-16, 18] : [16, -18];
      const res = uprightLeg(b, 'body', [side * bodyW * 0.42, -bodyH * 0.3, fz * bodyL * 0.36], {
        id,
        side,
        lens: [H * 0.27, H * 0.27],
        phis,
        w: lw,
        d: lw * 1.15,
        foot: qfoot,
        footLen: H * 0.12,
        footW: lw * 1.4,
        footH: H * 0.035,
        style: st,
        hydraulics,
        phase: phases[id],
        legStyle: 'mammal',
      });
      drop = res.drop + bodyH * 0.3;
      legsOut.push({ id, joints: res.joints, foot: res.foot, contact: res.contact });
    }
  } else {
    const lw = H * 0.06 * (0.85 + bulk * 0.4);
    for (const [id, side, fz] of ids) {
      const yaw = side * (fz > 0 ? Math.PI * 0.27 : Math.PI * 0.73);
      const res = sprawlLeg(b, 'body', [side * bodyW * 0.45, -bodyH * 0.1, fz * bodyL * 0.38], {
        id,
        side,
        yaw,
        lens: [H * 0.08, H * 0.36, H * 0.5],
        elev: [0, 38, -72],
        w: lw,
        h: lw * 1.3,
        footR: H * 0.04,
        style: st,
        hydraulics,
        phase: phases[id],
      });
      drop = res.drop + bodyH * 0.1;
      legsOut.push({ id, joints: res.joints, foot: res.foot, contact: res.contact });
    }
  }
  body.node.position[1] = drop;
  for (const l of legsOut) b.leg({ name: `leg_${l.id}`, side: l.id.endsWith('L') ? 'L' : 'R', index: l.id.startsWith('F') ? 0 : 1, style: legKind === 'upright' ? 'mammal' : 'insect', joints: l.joints, footNode: l.foot, contactOffset: l.contact, gaitPhase: phases[l.id] });

  // ── hull
  const fr = body.comp('frame');
  const ar = body.comp('armor');
  const deckTop = bodyH * 0.5;
  if (colossal) {
    // hollow hull so the machinery bay is real space
    const cw = bodyW * 0.85;
    const ch = bodyH * 0.8;
    const cd = bodyL * 0.95;
    const t = 0.3;
    fr.box([0, -ch / 2 + t / 2, 0], [cw, t, cd], 'darkMetal');
    fr.box([0, ch / 2 - t / 2, 0], [cw, t, cd], 'darkMetal');
    for (const sx of [-1, 1]) fr.box([sx * (cw / 2 - t / 2), 0, 0], [t, ch, cd], 'darkMetal');
    for (const sz of [-1, 1]) fr.box([0, 0, sz * (cd / 2 - t / 2)], [cw, ch, t], 'darkMetal');
  } else fr.chamfer([0, 0, 0], [bodyW * 0.85, bodyH * 0.8, bodyL * 0.95], bodyH * 0.12, 'darkMetal');
  for (const sx of [-1, 1]) {
    fr.box([sx * bodyW * 0.45, -bodyH * 0.1, 0], [bodyW * 0.1, bodyH * 0.5, bodyL * 0.9], 'steel'); // side rails / leg girders
    ar.taper([sx * bodyW * 0.47, bodyH * 0.18, 0], [bodyW * 0.08, bodyH * 0.55, bodyL * 0.8], [1, 0.9], [0, 0], 'paint');
    ar.bolts([sx * (bodyW * 0.52), bodyH * 0.38, -bodyL * 0.35], [sx * (bodyW * 0.52), bodyH * 0.38, bodyL * 0.35], 10, H * 0.003, 'x');
  }
  ar.box([0, deckTop - bodyH * 0.06, 0], [bodyW * 0.95, bodyH * 0.12, bodyL * 0.97], 'paint'); // deck plate
  vents(body, [0, deckTop + 0.02, -bodyL * 0.38], bodyW * 0.4, bodyL * 0.12, 'y');

  // ── cab
  const cabStyle = ctx.choice('cockpit.style', 'Cockpit', 'cockpit', ['canopy', 'armored', 'bubble'] as const, fighter ? [1, 2, 0.5] : [2, 0.5, 1.5]);
  const iw = Math.max(1.4, H * (colossal ? 0.12 : 0.15));
  const ih = Math.max(1.5, H * (colossal ? 0.1 : 0.14));
  const idp = Math.max(1.4, H * (colossal ? 0.1 : 0.14));
  cockpit(b, 'body', [0, deckTop, bodyL * 0.5 - idp * 0.45], { style: cabStyle, iw, ih, id: idp, wall: Math.max(0.07, H * 0.008), armor: 'paint', hatch: 'rear', rng: ctx.rng('cockpit') });
  lightPod(body, [bodyW * 0.36, 0, bodyL * 0.48], H * 0.015);
  lightPod(body, [-bodyW * 0.36, 0, bodyL * 0.48], H * 0.015);
  ladder(body, bodyW * 0.51, bodyL * 0.15, -drop + H * 0.05 > -bodyH ? -bodyH * 0.4 : -bodyH * 0.4, deckTop);
  b.mounts.push({ name: 'side_ladder', node: 'body', type: 'ladder' });

  // ── mission kit on the deck
  const kit = colossal ? 'decks' : ctx.choice('deck.kit', 'Deck equipment', 'deck', ['cargo', 'crane', 'turret', 'sensor'] as const, fighter ? [0.3, 0.2, 3, 1] : [2.5, 2.5, 0.3, 1]);
  const kitZ = -bodyL * 0.12;
  if (kit === 'cargo' || kit === 'crane') {
    const cargo = body.comp('equipment', 'cargo');
    const cw = bodyW * 0.8;
    const cl = bodyL * 0.45;
    cargo.box([0, deckTop + 0.04, kitZ], [cw, 0.08, cl], 'floor');
    for (const sx of [-1, 1]) cargo.box([sx * cw * 0.5, deckTop + 0.4, kitZ], [0.06, 0.7, cl], 'hazard', { detail: 1 });
    const rng = ctx.rng('deck.crates');
    const crates = rng.int(2, 5);
    for (let i = 0; i < crates; i++) {
      const s = rng.range(0.7, 1.4) * H * 0.07;
      cargo.box([rng.range(-cw * 0.35, cw * 0.35), deckTop + 0.08 + s / 2, kitZ + rng.range(-cl * 0.35, cl * 0.35)], [s * rng.range(1, 1.6), s, s], rng.pick(['paint2', 'darkMetal', 'hazard'] as const), { collide: false, detail: 1 });
    }
    b.mounts.push({ name: 'cargo_bed', node: 'body', type: 'cargo' });
  }
  if (kit === 'crane') crane(ctx, b, 'body', [bodyW * 0.25, deckTop, -bodyL * 0.38], H, st);
  if (kit === 'turret') {
    const yaw = body.child('turret_yaw', [0, deckTop, kitZ], { system: 'turret', joint: { axis: 'y', min: -150, max: 150, purpose: 'aim', kind: 'turret-yaw' } });
    const tr = yaw.comp('weapon');
    tr.cyl([0, H * 0.03, 0], bodyW * 0.3, H * 0.06, 'darkMetal', { segments: 24 });
    tr.chamfer([0, H * 0.09, -H * 0.02], [bodyW * 0.45, H * 0.07, bodyW * 0.5], H * 0.015, 'paint');
    const pitch = yaw.child('turret_pitch', [0, H * 0.1, bodyW * 0.15], { joint: { axis: 'x', min: -35, max: 10, purpose: 'aim', kind: 'turret-pitch' } });
    for (const sx of [-1, 1]) pitch.comp('weapon').cylZ([sx * H * 0.025, 0, H * 0.18], H * 0.012, H * 0.35, 'steel', { segments: 12 });
    pitch.comp('weapon').box([0, 0, 0], [H * 0.1, H * 0.05, H * 0.08], 'darkMetal');
    b.mounts.push({ name: 'turret', node: pitch.name, type: 'weapon' });
  }
  if (kit === 'sensor') {
    const yaw = body.child('sensor_yaw', [0, deckTop, kitZ], { system: 'sensor', joint: { axis: 'y', min: -180, max: 180, purpose: 'aim', kind: 'sensor-yaw' }, tags: ['continuous'] });
    const sg = yaw.comp('equipment');
    sg.cyl([0, H * 0.08, 0], H * 0.01, H * 0.16, 'steel', { segments: 8 });
    sg.cyl([0, H * 0.17, 0], H * 0.07, H * 0.015, 'paint2', { rTop: H * 0.02, segments: 18 });
    b.mounts.push({ name: 'sensor_dish', node: yaw.name, type: 'sensor' });
  }
  if (kit === 'decks') {
    // colossal hauler: a walkable deck house on the hull, entered by the side ladder
    const house = body.child('deck_house', [0, deckTop, -bodyL * 0.15], { role: 'group', system: 'interior' });
    const hw = bodyW * 0.7;
    const hh = 2.6;
    const hd = bodyL * 0.45;
    const t = 0.15;
    const sh = house.comp('armor');
    for (const sx of [-1, 1]) sh.box([(sx * (hw - t)) / 2, hh / 2, 0], [t, hh, hd], 'paint');
    sh.box([0, hh / 2, -hd / 2 + t / 2], [hw, hh, t], 'paint');
    // front wall with a door opening (two wall halves + lintel)
    for (const sx of [-1, 1]) sh.box([sx * (hw / 4 + 0.5), hh / 2, hd / 2 - t / 2], [hw / 2 - 1.0, hh, t], 'paint');
    sh.box([0, hh - 0.25, hd / 2 - t / 2], [2.0, 0.5, t], 'paint');
    sh.box([0, hh + t / 2, 0], [hw, t, hd], 'paint2');
    const fl = house.comp('interior');
    fl.box([0, 0.03, 0], [hw - 2 * t, 0.06, hd - 2 * t], 'floor');
    for (const sx of [-1, 1]) fl.box([sx * (hw / 2 - 0.7), 0.9, -hd * 0.1], [0.9, 1.8, hd * 0.6], 'interior');
    fl.box([0, 2.3, 0], [0.3, 0.06, hd * 0.8], 'emissive', { detail: 1, collide: false });
    const door = house.child('deck_house_door', [-1.0, 0, hd / 2], { role: 'hatch', joint: { axis: 'y', min: 0, max: 105, purpose: 'access', kind: 'door' } });
    door.comp('armor').box([0.5, 1.05, 0.03], [1.0, 2.1, 0.06], 'paint2');
    b.interiors.push({ name: 'deck_house', node: house.name, min: [-hw / 2 + t, 0.06, -hd / 2 + t], max: [hw / 2 - t, hh, hd / 2 - t], walkable: true, kind: 'deck' });
    b.mounts.push({ name: 'deck_house_door', node: door.name, type: 'entry' });
    // internal crawlway from deck house down into the hull machinery bay
    const bay = body.child('hull_machinery_bay', [0, -bodyH * 0.2, -bodyL * 0.1], { role: 'group', system: 'interior', component: 'interior' });
    bay.comp('interior').box([0, -0.03, 0], [bodyW * 0.4, 0.06, bodyL * 0.4], 'floor');
    ladder(bay, 0, -bodyL * 0.15, 0, bodyH * 0.7, 0.5);
    b.interiors.push({ name: 'hull_machinery_bay', node: bay.name, min: [-bodyW * 0.2, 0, -bodyL * 0.2], max: [bodyW * 0.2, Math.min(2.2, bodyH * 0.6), bodyL * 0.2], walkable: true, kind: 'machinery' });
  }

  b.gait = {
    type: legKind === 'sprawl' ? 'quad-walk' : 'quad-trot',
    stepHeight: H * 0.07,
    strideLength: H * 0.25,
    cycleSeconds: 1.4 + H * 0.05,
    bodyHeight: drop,
    groups: [
      ['leg_FL', 'leg_RR'],
      ['leg_FR', 'leg_RL'],
    ],
  };
  return colossal ? 'colossal' : H > 9 ? 'heavy' : 'medium';
}

function crane(ctx: GenCtx, b: Builder, parent: string, at: Vec3, H: number, st: SegStyle) {
  const base = b.node('crane_slew', parent, at, { system: 'crane', joint: { axis: 'y', min: -170, max: 170, purpose: 'tool', kind: 'crane-slew' } });
  base.comp('joint-housing').cyl([0, H * 0.025, 0], H * 0.06, H * 0.05, 'darkMetal', { segments: 20 });
  base.comp('frame').box([0, H * 0.07, 0], [H * 0.07, H * 0.06, H * 0.08], 'hazard');
  const boomL = H * 0.45;
  const stickL = H * 0.35;
  const boom = base.child('crane_boom', [0, H * 0.09, 0], { rot: [-0.75, 0, 0], joint: { axis: 'x', min: -40, max: 45, purpose: 'tool', kind: 'boom-pitch' } });
  const cst = { ...st, armor: 'hazard' as MaterialId, plating: 0.4 };
  segmentOut(boom, boomL, H * 0.045, H * 0.06, cst, { housingAtEnd: H * 0.02 });
  const stick = boom.child('crane_stick', [0, 0, boomL], { rot: [1.9, 0, 0], joint: { axis: 'x', min: -60, max: 50, purpose: 'tool', kind: 'stick-pitch' } });
  segmentOut(stick, stickL, H * 0.035, H * 0.045, cst, { housingAtEnd: H * 0.016 });
  b.piston({ name: 'crane_boom_ram', linkA: 'crane_slew', anchorA: [0, H * 0.06, H * 0.05], linkB: 'crane_boom', anchorB: [0, -H * 0.04, boomL * 0.4], radius: H * 0.008, drives: 'crane_boom' });
  b.piston({ name: 'crane_stick_ram', linkA: 'crane_boom', anchorA: [0, H * 0.045, boomL * 0.55], linkB: 'crane_stick', anchorB: [0, H * 0.03, -H * 0.03], radius: H * 0.007, drives: 'crane_stick' });
  const wrist = stick.child('crane_wrist', [0, 0, stickL], { rot: [-1.2, 0, 0], joint: { axis: 'x', min: -60, max: 60, purpose: 'tool', kind: 'grab-pitch' } });
  const g = wrist.comp('equipment');
  g.box([0, 0, H * 0.02], [H * 0.04, H * 0.03, H * 0.04], 'darkMetal');
  for (const i of [0, 1]) {
    const yaw = i === 0 ? 0 : Math.PI;
    const jaw = wrist.child(`crane_jaw${i}`, [0, 0, H * 0.04], { rot: [0, yaw, 0], joint: { axis: 'x', min: -25, max: 30, purpose: 'tool', kind: 'grab-jaw' } });
    jaw.comp('frame').taper([0, H * 0.012, H * 0.03], [H * 0.035, H * 0.012, H * 0.06], [0.6, 0.4], [0, H * 0.01], 'steel', { rot: [-0.4, 0, 0] });
  }
  b.mounts.push({ name: 'crane_grab', node: wrist.name, type: 'tool' });
  b.arms.push({ name: 'crane', side: 'C', joints: ['crane_slew', 'crane_boom', 'crane_stick', 'crane_wrist'], endEffector: 'crane_wrist', tool: 'grab' });
  void ctx;
}


// ───────────────────────────────────────────────────────────── multileg ──

function multiLeg(ctx: GenCtx, b: Builder, n: 6 | 8): string {
  const r = ctx.recipe;
  const fighter = isFighter(r.role);
  const H = (n === 6 ? 6 : 7) * r.scale;
  const bulk = r.bulk;
  const plating = fighter ? 0.55 + bulk * 0.3 : 0.25 + bulk * 0.35;
  const lattice = ctx.flag('frame.lattice', 'Open lattice frame', 'body', fighter ? 0.1 : 0.35);
  const hydraulics = ctx.flag('frame.hydraulics', 'Exposed hydraulics', 'legs', 0.8);
  const bodyShape = ctx.choice('body.shape', 'Body shape', 'body', ['pod', 'saucer', 'long'] as const, [2, 1.5, 1]);
  const bodyW = H * (bodyShape === 'saucer' ? 0.75 : 0.55) * (0.9 + bulk * 0.25);
  const bodyL = H * (bodyShape === 'long' ? 1.15 : bodyShape === 'saucer' ? 0.8 : 0.85) * (0.9 + bulk * 0.2);
  const bodyH = H * 0.24 * (0.9 + bulk * 0.3);

  const root = b.node('root', null, [0, 0, 0], { role: 'root', system: 'root' });
  const body = root.child('body', [0, 0, 0], { role: 'link', system: 'body', tags: ['body'] });
  const st = style(ctx, 'legs', plating, lattice);
  const pairs = n / 2;
  const lw = H * 0.05 * (0.85 + bulk * 0.35);
  const femurElev = ctx.num('legs.femurElev', 'Knee height (deg)', 'legs', 30, 55);
  let drop = 0;
  const legNames: { name: string; id: string; side: 'L' | 'R'; idx: number; joints: string[]; foot: string; contact: Vec3 }[] = [];
  for (let i = 0; i < pairs; i++) {
    const t = pairs === 1 ? 0.5 : i / (pairs - 1); // 0 = front, 1 = rear
    const z = (0.5 - t) * bodyL * 0.78;
    const spread = (0.2 + t * 0.6) * Math.PI; // heading from forward
    for (const [sideName, side] of [
      ['L', 1],
      ['R', -1],
    ] as const) {
      const id = `${sideName}${i}`;
      const res = sprawlLeg(b, 'body', [side * bodyW * 0.42, -bodyH * 0.15, z], {
        id,
        side,
        yaw: side * spread,
        lens: [H * 0.08, H * 0.42, H * 0.6],
        elev: [0, femurElev, -75],
        w: lw,
        h: lw * 1.25,
        footR: H * 0.03,
        style: st,
        hydraulics,
        phase: 0,
      });
      drop = res.drop + bodyH * 0.15;
      legNames.push({ name: `leg_${id}`, id, side: sideName, idx: i, joints: res.joints, foot: res.foot, contact: res.contact });
    }
  }
  body.node.position[1] = drop;
  // tripod (6) / alternating tetrapod (8) gait groups
  const groupA: string[] = [];
  const groupB: string[] = [];
  for (const l of legNames) ((l.idx % 2 === 0) === (l.side === 'L') ? groupA : groupB).push(l.name);
  for (const l of legNames) b.leg({ name: l.name, side: l.side, index: l.idx, style: 'insect', joints: l.joints, footNode: l.foot, contactOffset: l.contact, gaitPhase: groupA.includes(l.name) ? 0 : 0.5 });

  // body
  const fr = body.comp('frame');
  const ar = body.comp('armor');
  fr.chamfer([0, 0, 0], [bodyW * 0.9, bodyH * 0.7, bodyL * 0.9], bodyH * 0.18, 'darkMetal');
  if (bodyShape === 'saucer') {
    ar.cyl([0, bodyH * 0.3, 0], Math.min(bodyW, bodyL) * 0.5, bodyH * 0.2, 'paint', { rTop: Math.min(bodyW, bodyL) * 0.38, segments: 28 });
  } else {
    ar.taper([0, bodyH * 0.38, 0], [bodyW * 0.92, bodyH * 0.25, bodyL * 0.88], [0.8, 0.85], [0, -bodyL * 0.02], 'paint');
  }
  for (const sx of [-1, 1]) {
    ar.chamfer([sx * bodyW * 0.44, 0, 0], [bodyW * 0.08, bodyH * 0.45, bodyL * 0.82], bodyH * 0.05, 'paint2');
    ar.bolts([sx * bodyW * 0.485, bodyH * 0.18, -bodyL * 0.35], [sx * bodyW * 0.485, bodyH * 0.18, bodyL * 0.35], 9, H * 0.004, 'x');
  }
  vents(body, [0, bodyH * 0.52, -bodyL * 0.28], bodyW * 0.35, bodyL * 0.15, 'y');
  fr.cyl([0, -bodyH * 0.42, 0], bodyW * 0.18, bodyH * 0.15, 'steel', { segments: 16, detail: 1 }); // belly hardpoint
  const cabStyle = ctx.choice('cockpit.style', 'Cockpit', 'cockpit', ['bubble', 'canopy', 'armored'] as const, fighter ? [1, 1, 2] : [2.5, 1.5, 0.5]);
  const iw = Math.max(1.2, H * 0.2);
  const ih = Math.max(1.4, H * 0.18);
  const idp = Math.max(1.35, H * 0.18);
  cockpit(b, 'body', [0, -bodyH * 0.1, bodyL * 0.45 + idp / 2 + 0.05], { style: cabStyle, iw, ih, id: idp, wall: Math.max(0.06, H * 0.01), armor: 'paint', hatch: 'top', rng: ctx.rng('cockpit') });
  for (const sx of [-1, 1]) lightPod(body, [sx * bodyW * 0.32, -bodyH * 0.1, bodyL * 0.46], H * 0.018);

  const kit = ctx.choice('deck.kit', 'Top equipment', 'deck', ['sensor', 'turret', 'cargo', 'none'] as const, fighter ? [1, 3, 0.3, 0.5] : [3, 0.4, 1.5, 1]);
  const top = bodyH * 0.5;
  if (kit === 'sensor') {
    const yaw = body.child('sensor_yaw', [0, top, -bodyL * 0.2], { system: 'sensor', joint: { axis: 'y', min: -180, max: 180, purpose: 'aim', kind: 'sensor-yaw' }, tags: ['continuous'] });
    const s = yaw.comp('equipment');
    s.cyl([0, H * 0.07, 0], H * 0.012, H * 0.14, 'steel', { segments: 8 });
    const tilt = yaw.child('sensor_tilt', [0, H * 0.14, 0], { joint: { axis: 'x', min: -60, max: 30, purpose: 'aim', kind: 'sensor-tilt' } });
    tilt.comp('equipment').cylZ([0, 0, 0], H * 0.1, H * 0.02, 'paint2', { rTop: H * 0.03, segments: 20 });
    tilt.comp('equipment').cylZ([0, 0, H * 0.06], H * 0.006, H * 0.1, 'steel', { segments: 6, detail: 1 });
    b.mounts.push({ name: 'sensor_dish', node: tilt.name, type: 'sensor' });
  } else if (kit === 'turret') {
    missileRack(b, 'body', [0, top, -bodyL * 0.15], 'C', H * 0.14, style(ctx, 'pods', plating, false));
  } else if (kit === 'cargo') {
    const c = body.comp('equipment', 'cargo');
    const rng = ctx.rng('deck.crates');
    for (let i = 0; i < 3; i++) {
      const s = H * 0.08 * rng.range(0.8, 1.3);
      c.box([rng.range(-bodyW * 0.25, bodyW * 0.25), top + s / 2, -bodyL * 0.25 + i * bodyL * 0.12], [s * 1.3, s, s], rng.pick(['paint2', 'hazard', 'darkMetal'] as const), { collide: false, detail: 1 });
    }
  }
  body.comp('detail').cyl([bodyW * 0.3, top + H * 0.15, -bodyL * 0.35], H * 0.004, H * 0.3, 'steel', { segments: 5, detail: 2, collide: false });

  b.gait = {
    type: n === 6 ? 'tripod' : 'tetrapod',
    stepHeight: H * 0.08,
    strideLength: H * 0.22,
    cycleSeconds: 1.0 + H * 0.05,
    bodyHeight: drop,
    groups: [groupA, groupB],
  };
  return H > 7 ? 'heavy' : 'medium';
}
