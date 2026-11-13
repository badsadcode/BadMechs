import { strToU8, zipSync } from 'fflate';
import type { Mech } from '../core/model';
import type { MechRecipe } from '../core/recipe';
import { validate } from '../core/validate';
import type { LimitFit } from '../core/validate';
import { exportGlb } from './gltf';
import { rigSidecar } from './rig';
import { exportObj, exportUsda } from './static';

export function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'mech';
}

export const PACKAGE_README = (base: string, mech: Mech) => `BadMech export package: ${mech.name}
${'='.repeat(30 + mech.name.length)}

Units: metres · Up: +Y · Forward (mech faces): +Z · Right-handed (glTF convention)
Height ${mech.stats.height} m · ${mech.family} · ${mech.stats.sizeClass}

FILES
  ${base}.glb              Full articulated mech (LOD0). Hierarchy, pivots, PBR materials, skinned
                           flex hoses, interiors. Joint metadata in node extras ("badmech").
  ${base}_LOD1.glb         Same hierarchy, greebles removed.
  ${base}_LOD2.glb         Same hierarchy, silhouette only, no interiors.
  ${base}_collision.glb    Same hierarchy with box collision proxies (COL_<body>_<n>).
  ${base}.rig.json         THE CONTRACT: joints/axes/limits, leg & arm chains, piston aim
                           constraints, hoses, mounts, interiors, gait hints, collision boxes.
  ${base}.usda             Articulated Xform hierarchy + meshes + UsdPreviewSurface materials.
                           Joint data as customData. No skinned hoses.
  ${base}.obj / .mtl       STATIC geometry only, rest pose, world space. No rig. No hierarchy.
  ${base}.badmech.json     Editable source recipe. Load it in BadMech to get this exact mech back.
  ${base}.validation.json  Automated checks run at export time.
  blender_bridge.py        blender -b -P blender_bridge.py -- ${base}.glb
                           → ${base}.blend + ${base}.fbx (+ re-import check report)

ENGINE NOTES (details: docs/ENGINE_IMPORT.md in the BadMech repo)
  Godot 4   Import the .glb. Godot faces -Z, so rotate the root 180° about Y (or just treat
            +Z as forward in your controller). Nodes keep names; joint data is in node meta
            when "Import > Meta" is on, otherwise read ${base}.rig.json.
  Unity     Import the .glb with glTFast or the .fbx from the bridge. Unity flips X on import
            (left-handed); axes in the rig file are glTF-space – mirror X for Unity space.
  Unreal    Import the .fbx (from the bridge) as Skeletal Mesh, or the .glb via the glTF
            importer. Unreal is Z-up, cm: the importer converts.
  Blender   Import the .glb or open the .blend from the bridge.

Pistons: after posing joints, aim each actuator's baseNode +Z at endNode and vice versa.
Hoses: skinned to 2 bones each in GLB/FBX/.blend; they follow automatically.
`;

export interface PackageFiles {
  [path: string]: Uint8Array;
}

export function buildPackage(mech: Mech, recipe: MechRecipe, fits: LimitFit[], bridgeSource: string): { files: PackageFiles; base: string } {
  const base = slug(mech.name);
  const files: PackageFiles = {};
  files[`${base}/${base}.glb`] = exportGlb(mech, { lod: 0, recipe });
  files[`${base}/${base}_LOD1.glb`] = exportGlb(mech, { lod: 1, recipe });
  files[`${base}/${base}_LOD2.glb`] = exportGlb(mech, { lod: 2, recipe });
  files[`${base}/${base}_collision.glb`] = exportGlb(mech, { collisionOnly: true, recipe, embedRig: false });
  const report = validate(mech, { randomPoses: 30 });
  files[`${base}/${base}.rig.json`] = strToU8(JSON.stringify(rigSidecar(mech, recipe, { limitFits: fits.map((f) => ({ ...f })) }), null, 1));
  files[`${base}/${base}.usda`] = strToU8(exportUsda(mech, 0));
  const { obj, mtl } = exportObj(mech, base, 0);
  files[`${base}/${base}.obj`] = strToU8(obj);
  files[`${base}/${base}.mtl`] = strToU8(mtl);
  files[`${base}/${base}.badmech.json`] = strToU8(JSON.stringify(recipe, null, 2));
  files[`${base}/${base}.validation.json`] = strToU8(JSON.stringify({ checks: report.checks, counts: report.counts, clashes: report.clashes.slice(0, 50) }, null, 2));
  files[`${base}/README.txt`] = strToU8(PACKAGE_README(base, mech));
  files[`${base}/blender_bridge.py`] = strToU8(bridgeSource);
  return { files, base };
}

export function zipPackage(files: PackageFiles): Uint8Array {
  return zipSync(files, { level: 6 });
}
