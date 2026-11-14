import { Rng, subSeed } from './rng';
import { GENERIC, Maker } from './makers';

export type Family = 'biped' | 'quadruped' | 'hexapod' | 'octopod' | 'exosuit' | 'colossus';
export type MechRole = 'combat' | 'industrial' | 'scout' | 'salvage' | 'hauler' | 'explorer';

export const FAMILIES: { id: Family; label: string; blurb: string }[] = [
  { id: 'biped', label: 'Biped', blurb: 'Two legs, a torso, opinions.' },
  { id: 'quadruped', label: 'Quadruped', blurb: 'Four legs, heavy platform, cargo or cannons.' },
  { id: 'hexapod', label: 'Hexapod', blurb: 'Six legs, tripod gait, goes anywhere.' },
  { id: 'octopod', label: 'Octopod', blurb: 'Eight legs. Noor approves.' },
  { id: 'exosuit', label: 'Exosuit', blurb: 'Pilot-sized. You wear it.' },
  { id: 'colossus', label: 'Colossus', blurb: 'Walking building with decks inside.' },
];

/**
 * The editable source design. Saving this file (.badmech.json) is enough to regenerate the
 * exact same mech; exported meshes are just a by-product.
 */
export interface MechRecipe {
  format: 'badmech-recipe';
  /** 1 = pre-factory recipes (always 'Unbranded', regenerate exactly as before); 2 = Mech Factory */
  version: 1 | 2;
  name: string;
  family: Family;
  role: MechRole;
  seed: number;
  /** overall scale multiplier on the family's base size (0.7 – 1.4) */
  scale: number;
  /** 0 = lean, 1 = bulky */
  bulk: number;
  /** paint scheme id, or 'auto' = the maker's house paint */
  scheme: string;
  /** per-subsystem re-roll counters: bump one to re-roll only that subsystem */
  rerolls: Record<string, number>;
  /** explicit user choices, keyed by option key, win over random picks */
  overrides: Record<string, string | number | boolean>;
}

export function defaultRecipe(family: Family = 'biped', seed = 1): MechRecipe {
  return {
    format: 'badmech-recipe',
    version: 2,
    name: '',
    family,
    role: family === 'quadruped' ? 'hauler' : family === 'hexapod' || family === 'octopod' ? 'explorer' : family === 'exosuit' ? 'industrial' : 'combat',
    seed,
    scale: 1,
    bulk: 0.5,
    scheme: 'auto',
    rerolls: {},
    overrides: {},
  };
}

export interface ResolvedOption {
  key: string;
  slot: string;
  value: string | number | boolean;
  choices?: readonly string[];
  min?: number;
  max?: number;
  overridden: boolean;
  label: string;
}

/**
 * Generation context: hands out deterministic per-slot random streams and records every
 * decision it makes, so the UI can show "what got picked" and let the user pin any of it.
 */
export class GenCtx {
  readonly options: ResolvedOption[] = [];
  private rngs = new Map<string, Rng>();
  /** the manufacturer whose design language biases every choice below */
  maker: Maker = GENERIC;
  constructor(readonly recipe: MechRecipe) {}

  rng(slot: string): Rng {
    let r = this.rngs.get(slot);
    if (!r) {
      r = new Rng(subSeed(this.recipe.seed, slot, this.recipe.rerolls[slot] ?? 0));
      this.rngs.set(slot, r);
    }
    return r;
  }

  choice<T extends string>(key: string, label: string, slot: string, choices: readonly T[], weights?: number[]): T {
    const r = this.rng(slot);
    let pick: T;
    const bias = this.maker.choices[key];
    if (bias) {
      const w = choices.map((c, i) => (weights ? weights[i] : 1) * (bias[c] ?? 1));
      if (w.some((x) => x > 0)) weights = w;
    }
    if (weights) {
      const total = weights.reduce((a, b) => a + b, 0);
      let x = r.next() * total;
      pick = choices[choices.length - 1];
      for (let i = 0; i < choices.length; i++) {
        x -= weights[i];
        if (x <= 0) {
          pick = choices[i];
          break;
        }
      }
    } else pick = r.pick(choices);
    const o = this.recipe.overrides[key];
    const overridden = typeof o === 'string' && (choices as readonly string[]).includes(o);
    const value = overridden ? (o as T) : pick;
    this.options.push({ key, slot, value, choices, overridden, label });
    return value;
  }

  num(key: string, label: string, slot: string, min: number, max: number): number {
    const r = this.rng(slot).range(min, max);
    const o = this.recipe.overrides[key];
    const overridden = typeof o === 'number';
    const value = overridden ? Math.min(max, Math.max(min, o as number)) : r;
    this.options.push({ key, slot, value, min, max, overridden, label });
    return value;
  }

  int(key: string, label: string, slot: string, min: number, max: number): number {
    const lim = this.maker.ints[key];
    const lo = lim ? Math.max(min, lim[0]) : min;
    const hi = lim ? Math.min(max, lim[1]) : max;
    const r = this.rng(slot).int(lo, Math.max(lo, hi));
    const o = this.recipe.overrides[key];
    const overridden = typeof o === 'number';
    const value = overridden ? Math.round(Math.min(max, Math.max(min, o as number))) : r;
    this.options.push({ key, slot, value, min, max, overridden, label });
    return value;
  }

  flag(key: string, label: string, slot: string, p: number): boolean {
    const r = this.rng(slot).chance(this.maker.flags[key] ?? p);
    const o = this.recipe.overrides[key];
    const overridden = typeof o === 'boolean';
    const value = overridden ? (o as boolean) : r;
    this.options.push({ key, slot, value, overridden, label });
    return value;
  }
}

const NAME_A = ['Lynx', 'Bastion', 'Grudge', 'Mule', 'Harrow', 'Kestrel', 'Anvil', 'Tick', 'Brute', 'Warden', 'Cricket', 'Sulk', 'Gloom', 'Rook', 'Mantis', 'Ox', 'Wrecker', 'Badger', 'Hulk', 'Strider'];
const NAME_B = ['', 'Mk II', 'S1', 'A-73', 'M-47', 'A-07', 'XL', 'Mod 3', 'Prototype', 'Heavy', 'Field', 'Rev B'];

export function mechName(recipe: MechRecipe, maker: Maker = GENERIC): string {
  if (recipe.name) return recipe.name;
  const r = new Rng(subSeed(recipe.seed, 'name'));
  const b = r.pick(NAME_B);
  const base = b ? `${r.pick(NAME_A)} ${b}` : r.pick(NAME_A);
  return maker.naming(Math.floor(r.next() * 1e6), base);
}
