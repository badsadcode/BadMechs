/**
 * Mech Factory: manufacturers and their design languages.
 *
 * Architecture comes from the maker, paint from the operator (idea borrowed from BadShip's
 * shipyards). A maker biases the generator's choices (torso, cockpit, legs, feet, tools,
 * hydraulics…), shifts proportions (stance, feet, torso), and adds one SIGNATURE element you can
 * recognise across a battlefield. Pinned choices in a recipe still win over any bias.
 */
import type { Family } from './recipe';

export type Signature = 'sensor-head' | 'springs' | 'rails' | 'brow' | 'none';
export type PauldronStyle = 'hood' | 'shield' | 'slab';

export interface Maker {
  id: string;
  name: string;
  motto: string;
  /** how likely this maker is to have built a mech of each family */
  families: Partial<Record<Family, number>>;
  /** multipliers on choice weights: option key → choice → multiplier */
  choices: Record<string, Record<string, number>>;
  /** replace flag probabilities: option key → p */
  flags: Record<string, number>;
  /** clamp integer options: option key → [min, max] */
  ints: Record<string, [number, number]>;
  shape: {
    /** hip / stance width multiplier */
    stance: number;
    /** foot length/width multiplier */
    foot: number;
    torsoW: number;
    torsoH: number;
    /** added to recipe bulk / plating (−0.3 … 0.3) */
    bulk: number;
    plating: number;
    pauldron: PauldronStyle;
  };
  signature: Signature;
  /** the maker's house paint, used unless the operator (recipe) picks one */
  scheme: string;
  /** model designation pattern */
  naming: (n: number, base: string) => string;
}

export const GENERIC: Maker = {
  id: 'generic',
  name: 'Unbranded',
  motto: 'Somebody built it. Probably.',
  families: {},
  choices: {},
  flags: {},
  ints: {},
  shape: { stance: 1, foot: 1, torsoW: 1, torsoH: 1, bulk: 0, plating: 0, pauldron: 'hood' },
  signature: 'none',
  scheme: 'olive',
  naming: (_n, base) => base,
};

export const MAKERS: Maker[] = [
  {
    id: 'bastion',
    name: 'Bastion Works',
    motto: 'Bolted, braced, and bigger than yours.',
    families: { biped: 5, colossus: 1.5, quadruped: 1 },
    choices: {
      'body.weight': { light: 0.2, medium: 0.8, heavy: 2.5, assault: 2.5 },
      'torso.arch': { bulwark: 4, tower: 2.5, hunch: 0.1, wedge: 0.4, asym: 0.6 },
      'cockpit.style': { canopy: 3, armored: 1.5, bubble: 0.1 },
      'cockpit.position': { embedded: 6, center: 1, offset: 0.3, high: 0.2 },
      'legs.style': { plantigrade: 4, digitigrade: 0.6 },
      'legs.foot': { flat: 5, claw: 0.4, hoof: 0.3 },
      'arms.L.tool': { rotary: 3, missile: 2.5, cannon: 2, gripper: 0.2, shield: 0.4, claw: 0.1, drill: 0 },
      'arms.R.tool': { rotary: 3, missile: 2.5, cannon: 2, gripper: 0.2, shield: 0.4, claw: 0.1, drill: 0 },
      'legs.kind': { upright: 3, sprawl: 0.5 },
      'deck.kit': { turret: 4, sensor: 1, cargo: 0.3, crane: 0.1 },
    },
    flags: { 'frame.lattice': 0.02, 'frame.hydraulics': 0.85, 'torso.backpack': 0.9, 'arms.none': 0.05, 'arms.symmetric': 0.2, 'torso.antenna': 0.9 },
    ints: { 'pods.count': [1, 2] },
    shape: { stance: 1.28, foot: 1.35, torsoW: 1.15, torsoH: 0.92, bulk: 0.15, plating: 0.15, pauldron: 'shield' },
    signature: 'sensor-head',
    scheme: 'olive',
    naming: (n) => `A-${String(10 + (n % 90)).padStart(2, '0')}`,
  },
  {
    id: 'lynx',
    name: 'Lynx Dynamics',
    motto: 'Gone before the dust settles.',
    families: { biped: 5, hexapod: 2, exosuit: 1.2 },
    choices: {
      'body.weight': { light: 4, medium: 1.5, heavy: 0.2, assault: 0 },
      'torso.arch': { hunch: 5, wedge: 1.5, bulwark: 0.2, tower: 0.2, asym: 0.6 },
      'cockpit.style': { canopy: 2.5, bubble: 2, armored: 0.2 },
      'cockpit.position': { center: 3, embedded: 1, offset: 0.6, high: 1 },
      'legs.style': { digitigrade: 6, plantigrade: 0.4 },
      'legs.foot': { claw: 5, flat: 0.8, hoof: 0.4 },
      'arms.L.tool': { rotary: 2.5, cannon: 2, missile: 1.2, gripper: 0.6, shield: 0.2, claw: 0.2, drill: 0 },
      'arms.R.tool': { rotary: 2.5, cannon: 2, missile: 1.2, gripper: 0.6, shield: 0.2, claw: 0.2, drill: 0 },
      'body.shape': { pod: 3, long: 2, saucer: 0.5, chassis: 0.3 },
      'deck.kit': { sensor: 4, turret: 1, cargo: 0.3, none: 0.5 },
    },
    flags: { 'frame.lattice': 0.05, 'frame.hydraulics': 0.9, 'torso.backpack': 0.4, 'arms.none': 0.1, 'arms.symmetric': 0.3, 'torso.antenna': 1 },
    ints: { 'pods.count': [0, 1] },
    shape: { stance: 1.0, foot: 1.0, torsoW: 0.9, torsoH: 1.05, bulk: -0.15, plating: -0.05, pauldron: 'hood' },
    signature: 'springs',
    scheme: 'scout',
    naming: (n) => `${['Lynx', 'Caracal', 'Ocelot', 'Serval', 'Margay'][n % 5]} S${1 + (n % 7)}`,
  },
  {
    id: 'ostrava',
    name: 'Ostrava Heavy Industries',
    motto: 'Built to lift. Painted so you see it coming.',
    families: { exosuit: 3, quadruped: 3, colossus: 2, biped: 2, hexapod: 1.2 },
    choices: {
      'body.weight': { light: 0.3, medium: 2, heavy: 2, assault: 0.3 },
      'torso.arch': { bulwark: 3, hunch: 1, wedge: 0.5, tower: 0.6, asym: 0.4 },
      'cockpit.style': { bubble: 3, canopy: 2.5, armored: 0.1 },
      'cockpit.position': { center: 3, embedded: 2, high: 0.5, offset: 0.4 },
      'legs.style': { plantigrade: 4, digitigrade: 0.5 },
      'legs.foot': { flat: 4, hoof: 1.5, claw: 0.5 },
      'arms.L.tool': { gripper: 3, claw: 2.5, drill: 2, cannon: 0.1, rotary: 0, missile: 0, shield: 0 },
      'arms.R.tool': { gripper: 3, claw: 2.5, drill: 2, cannon: 0.1, rotary: 0, missile: 0, shield: 0 },
      'legs.kind': { sprawl: 2, upright: 2 },
      'deck.kit': { crane: 4, cargo: 3, sensor: 0.5, turret: 0, none: 0.3 },
      'body.shape': { chassis: 4, pod: 1, long: 0.5, saucer: 0.2 },
    },
    flags: { 'frame.lattice': 0.55, 'frame.hydraulics': 1, 'torso.backpack': 0.7, 'arms.none': 0, 'arms.symmetric': 0.4, 'torso.antenna': 0.5 },
    ints: { 'pods.count': [0, 0] },
    shape: { stance: 1.15, foot: 1.25, torsoW: 1.05, torsoH: 1.1, bulk: 0.05, plating: -0.12, pauldron: 'slab' },
    signature: 'rails',
    scheme: 'industrial',
    naming: (n) => `OHI-${100 + ((n * 37) % 900)} ${['Mule', 'Ox', 'Badger', 'Tick', 'Yak'][n % 5]}`,
  },
  {
    id: 'volkov',
    name: 'Volkov-Rhee Ordnance',
    motto: 'Angles deflect. Arguments too.',
    families: { biped: 3, quadruped: 3, octopod: 2, hexapod: 1 },
    choices: {
      'body.weight': { light: 0.5, medium: 2, heavy: 2, assault: 1 },
      'torso.arch': { wedge: 4, asym: 3, bulwark: 0.6, tower: 0.4, hunch: 0.2 },
      'cockpit.style': { armored: 4, canopy: 1, bubble: 0.1 },
      'cockpit.position': { embedded: 3, offset: 1.5, center: 1, high: 0.2 },
      'legs.style': { plantigrade: 2, digitigrade: 2 },
      'legs.foot': { flat: 2, claw: 2, hoof: 0.3 },
      'arms.L.tool': { cannon: 3, missile: 2, rotary: 1.5, shield: 1, gripper: 0.2, claw: 0.1, drill: 0 },
      'arms.R.tool': { cannon: 3, missile: 2, rotary: 1.5, shield: 1, gripper: 0.2, claw: 0.1, drill: 0 },
      'legs.kind': { upright: 2, sprawl: 2 },
      'deck.kit': { turret: 5, sensor: 0.6, cargo: 0.1, crane: 0 },
      'body.shape': { long: 3, chassis: 2, pod: 0.6, saucer: 0.2 },
    },
    flags: { 'frame.lattice': 0.02, 'frame.hydraulics': 0.5, 'torso.backpack': 0.6, 'arms.none': 0.15, 'arms.symmetric': 0.15, 'torso.antenna': 0.6 },
    ints: { 'pods.count': [0, 2] },
    shape: { stance: 1.12, foot: 1.1, torsoW: 1.12, torsoH: 0.86, bulk: 0.1, plating: 0.12, pauldron: 'slab' },
    signature: 'brow',
    scheme: 'warcamo',
    naming: (n) => `VR-${10 + ((n * 13) % 80)} ${['Grudge', 'Harrow', 'Rook', 'Wrecker', 'Anvil'][n % 5]}`,
  },
];

export const ALL_MAKERS = [GENERIC, ...MAKERS];
export const makerById = (id: string | undefined) => ALL_MAKERS.find((m) => m.id === id) ?? GENERIC;
