/**
 * BadMech CLI.
 *   npm run cli -- export <family> <seed> [outDir]   generate + write a full export package
 *   npm run samples                                     regenerate samples/ (reference designs)
 *   npm run cli -- recipe path/to/x.badmech.json [outDir]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../src/core/families';
import { defaultRecipe, Family, MechRecipe } from '../src/core/recipe';
import { buildPackage } from '../src/export/package';

const here = dirname(fileURLToPath(import.meta.url));
const BRIDGE = readFileSync(join(here, 'blender_bridge.py'), 'utf8');

export const SAMPLE_RECIPES: MechRecipe[] = [
  { ...defaultRecipe('biped', 7301), name: 'Grudge A-73', role: 'combat', scheme: 'olive', bulk: 0.7, overrides: { maker: 'bastion', 'body.weight': 'heavy', 'arms.L.tool': 'rotary', 'arms.R.tool': 'missile', 'pods.count': 2 } },
  { ...defaultRecipe('biped', 1001), name: 'Lynx S1', role: 'scout', scheme: 'scout', bulk: 0.2, overrides: { maker: 'lynx', 'legs.style': 'digitigrade', 'body.weight': 'light' } },
  { ...defaultRecipe('quadruped', 404), name: 'Mule Hauler', role: 'hauler', scheme: 'industrial', bulk: 0.6, overrides: { maker: 'ostrava', 'deck.kit': 'crane', 'legs.kind': 'sprawl' } },
  { ...defaultRecipe('hexapod', 66), name: 'Cricket Surveyor', role: 'explorer', scheme: 'rust', bulk: 0.45, overrides: { maker: 'lynx', 'deck.kit': 'sensor' } },
  { ...defaultRecipe('octopod', 88), name: 'Harrow Octo', role: 'combat', scheme: 'warcamo', bulk: 0.6, overrides: { maker: 'volkov' } },
  { ...defaultRecipe('exosuit', 3), name: 'Tick Exo', role: 'industrial', scheme: 'industrial', bulk: 0.5, overrides: { maker: 'ostrava' } },
  { ...defaultRecipe('colossus', 9000), name: 'Bastion Colossus', role: 'hauler', scheme: 'urban', bulk: 0.6, overrides: { maker: 'bastion', 'colossus.frame': 'quad' } },
];

function writePackage(recipe: MechRecipe, outDir: string) {
  const { mech, fits } = generate(recipe);
  const { files, base } = buildPackage(mech, recipe, fits, BRIDGE);
  for (const [p, data] of Object.entries(files)) {
    const full = join(outDir, p);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
  }
  console.log(`✓ ${mech.name.padEnd(22)} ${mech.family.padEnd(10)} ${String(mech.stats.height).padStart(6)} m  → ${join(outDir, base)}`);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'samples') {
  const out = args[0] ?? join(here, '..', 'samples');
  for (const r of SAMPLE_RECIPES) writePackage(r, out);
} else if (cmd === 'export') {
  const [family = 'biped', seed = '1', out = 'out'] = args;
  writePackage(defaultRecipe(family as Family, Number(seed)), out);
} else if (cmd === 'recipe') {
  const [path, out = 'out'] = args;
  writePackage(JSON.parse(readFileSync(path, 'utf8')), out);
} else {
  console.log('usage: cli.ts samples [dir] | export <family> <seed> [dir] | recipe <file.badmech.json> [dir]');
}
