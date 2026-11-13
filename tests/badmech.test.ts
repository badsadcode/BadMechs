import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { Matrix4, Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { calibrateGait } from '../src/controller/calibrate';
import { RigWalker } from '../src/controller/walker';
import { generate } from '../src/core/families';
import { worldMatrices } from '../src/core/kinematics';
import { defaultRecipe, Family, FAMILIES } from '../src/core/recipe';
import { validate } from '../src/core/validate';
import { exportGlb } from '../src/export/gltf';
import { buildPackage } from '../src/export/package';
import { rigSidecar, sidecarRestWorld } from '../src/export/rig';
import { exportObj, exportUsda } from '../src/export/static';
import { loadGlb } from './helpers';

const require = createRequire(import.meta.url);
const gltfValidator = require('gltf-validator');
const fams = FAMILIES.map((f) => f.id) as Family[];
const SEEDS = [1, 2, 3, 4];

describe('generation', () => {
  it.each(fams)('%s is deterministic for a given recipe', (f) => {
    const a = generate(defaultRecipe(f, 42)).mech;
    const b = generate(defaultRecipe(f, 42)).mech;
    expect(JSON.stringify(a.nodes)).toBe(JSON.stringify(b.nodes));
    expect(JSON.stringify(a.actuators)).toBe(JSON.stringify(b.actuators));
  });

  it('different seeds give genuinely different machines', () => {
    const sigs = new Set<string>();
    for (const f of fams) for (const s of SEEDS) {
      const m = generate(defaultRecipe(f, s)).mech;
      sigs.add(`${f}:${m.nodes.length}:${m.stats.height}:${m.nodes.filter((n) => n.joint).length}`);
    }
    expect(sigs.size).toBeGreaterThan(fams.length * 2);
  });

  it('re-rolling one subsystem leaves the others untouched', () => {
    const r = { ...defaultRecipe('biped', 7301), role: 'combat' as const };
    const a = generate(r).mech;
    const b = generate({ ...r, rerolls: { 'arms.L': 1, 'arms.L.style': 1 } }).mech;
    const legs = (m: typeof a) => JSON.stringify(m.nodes.filter((n) => n.system.startsWith('leg')));
    expect(legs(b)).toBe(legs(a));
  });

  it('pinned overrides win over the dice', () => {
    const r = { ...defaultRecipe('biped', 5), overrides: { 'legs.style': 'digitigrade', 'arms.L.tool': 'drill' } };
    const { mech, options } = generate(r);
    expect(mech.legs[0].style).toBe('digitigrade');
    expect(options.find((o) => o.key === 'arms.L.tool')?.value).toBe('drill');
    expect(mech.nodes.some((n) => n.name === 'arm_L_drill_spin')).toBe(true);
  });
});

describe('mechanical validity', () => {
  for (const f of fams)
    for (const s of SEEDS)
      it(`${f}#${s}: no validation errors, feet on the ground, pistons buildable`, () => {
        const { mech } = generate(defaultRecipe(f, s));
        const rep = validate(mech);
        const errors = rep.checks.filter((c) => c.severity === 'error');
        expect(errors, JSON.stringify(errors)).toHaveLength(0);
        const rest = worldMatrices(mech, {});
        for (const leg of mech.legs) {
          const c = new Vector3(...leg.contactOffset).applyMatrix4(rest.get(leg.footNode)!);
          expect(Math.abs(c.y)).toBeLessThan(0.03);
        }
        for (const a of mech.actuators) expect(a.barrelLength + a.rodLength).toBeGreaterThan(a.maxLength);
        // single-joint sweeps are clash-free after limit fitting
        expect(rep.clashes).toHaveLength(0);
      });

  it('every joint limit brackets the rest pose', () => {
    for (const f of fams) {
      const { mech } = generate(defaultRecipe(f, 9));
      for (const n of mech.nodes) if (n.joint) expect(n.joint.min <= 1e-9 && n.joint.max >= -1e-9 && n.joint.min < n.joint.max, n.name).toBe(true);
    }
  });

  it('exosuit harness fits a human-sized pilot; colossus has walkable space', () => {
    const exo = generate(defaultRecipe('exosuit', 3)).mech;
    expect(exo.stats.height).toBeGreaterThan(1.9);
    expect(exo.stats.height).toBeLessThan(3.2);
    const colo = generate(defaultRecipe('colossus', 9000)).mech;
    expect(colo.interiors.some((i) => i.walkable && i.max[1] - i.min[1] >= 1.9)).toBe(true);
  });
});

describe('exports', () => {
  it.each(fams)('%s GLB passes the Khronos glTF validator with zero errors and warnings', async (f) => {
    const { mech } = generate(defaultRecipe(f, 3));
    for (const lod of [0, 2] as const) {
      const rep = await gltfValidator.validateBytes(exportGlb(mech, { lod }));
      expect(rep.issues.numErrors).toBe(0);
      expect(rep.issues.numWarnings).toBe(0);
    }
  });

  it.each(fams)('%s GLB round-trips through three.js GLTFLoader with identical pivots', async (f) => {
    const { mech } = generate(defaultRecipe(f, 2));
    const { scene } = await loadGlb(exportGlb(mech));
    scene.updateMatrixWorld(true);
    const rest = worldMatrices(mech, {});
    const byName = new Map<string, Object3D>();
    scene.traverse((o) => byName.set(o.name, o));
    for (const n of mech.nodes) {
      const o = byName.get(n.name);
      expect(o, n.name).toBeDefined();
      const got = new Vector3().setFromMatrixPosition(o!.matrixWorld);
      const want = new Vector3().setFromMatrixPosition(rest.get(n.name)!);
      expect(got.distanceTo(want), n.name).toBeLessThan(1e-4);
      if (n.joint) expect(o!.userData.badmech?.joint?.axis).toBe(n.joint.axis);
    }
  });

  it('rig sidecar alone reconstructs the rest pose', () => {
    const { mech } = generate(defaultRecipe('octopod', 4));
    const rig = JSON.parse(JSON.stringify(rigSidecar(mech)));
    const fromRig = sidecarRestWorld(rig);
    const rest = worldMatrices(mech, {});
    for (const n of mech.nodes) {
      const a = new Vector3().setFromMatrixPosition(fromRig.get(n.name)!);
      const b = new Vector3().setFromMatrixPosition(rest.get(n.name)!);
      expect(a.distanceTo(b)).toBeLessThan(1e-3);
    }
    expect(rig.schema).toBe('badmech-rig/1');
    expect(rig.legs).toHaveLength(8);
    expect(rig.gait.groups.flat()).toHaveLength(8);
  });

  it('OBJ is clearly labelled static, USDA declares metres + Y-up', () => {
    const { mech } = generate(defaultRecipe('biped', 1));
    const { obj, mtl } = exportObj(mech, 'x');
    expect(obj).toMatch(/STATIC GEOMETRY ONLY/);
    expect(mtl).toMatch(/newmtl BM_Paint_Primary/);
    const usda = exportUsda(mech);
    expect(usda).toMatch(/metersPerUnit = 1/);
    expect(usda).toMatch(/upAxis = "Y"/);
    expect(usda).toMatch(/double jointMin/);
  });

  it('full package contains every promised file', () => {
    const r = defaultRecipe('quadruped', 404);
    const { mech, fits } = generate(r);
    const { files, base } = buildPackage(mech, r, fits, readFileSync('tools/blender_bridge.py', 'utf8'));
    const names = Object.keys(files).map((p) => p.replace(`${base}/`, ''));
    for (const want of ['.glb', '_LOD1.glb', '_LOD2.glb', '_collision.glb', '.rig.json', '.usda', '.obj', '.mtl', '.badmech.json', '.validation.json']) expect(names).toContain(base + want);
    expect(names).toContain('README.txt');
    expect(names).toContain('blender_bridge.py');
    const recipe = JSON.parse(new TextDecoder().decode(files[`${base}/${base}.badmech.json`]));
    expect(JSON.stringify(generate(recipe).mech.nodes)).toBe(JSON.stringify(mech.nodes));
  });
});

describe('animation readiness: the reference controller walks the EXPORTED file', () => {
  it.each(fams)('%s walks with feet tracking their targets', async (f) => {
    const { mech } = generate(defaultRecipe(f, 1));
    const v = calibrateGait(mech);
    const { scene } = await loadGlb(exportGlb(mech));
    const rig = JSON.parse(JSON.stringify(rigSidecar(mech)));
    const w = new RigWalker(scene, rig);
    const fps = 30;
    let max = 0;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < fps * rig.gait.cycleSeconds * 3; i++) {
      w.update(1 / fps);
      if (i < fps * rig.gait.cycleSeconds) continue;
      for (const e of w.footErrors()) {
        max = Math.max(max, e);
        sum += e;
        n++;
      }
      // the controller never pushes a joint past its exported limit
      for (const j of rig.joints) if (!j.continuous) expect(w.angles.get(j.name)! >= j.min - 1e-6 && w.angles.get(j.name)! <= j.max + 1e-6, j.name).toBe(true);
    }
    expect(w.distance).toBeGreaterThan(rig.gait.strideLength);
    expect(sum / n).toBeLessThan(0.02);
    expect(max).toBeLessThan(Math.max(0.05, mech.stats.height * 0.006));
    expect(v.maxFootErrorM).toBeLessThan(Math.max(0.05, mech.stats.height * 0.006));
  });

  it('piston aim constraint keeps barrel and rod pointing at each other while walking', async () => {
    const { mech } = generate(defaultRecipe('quadruped', 404));
    const { scene } = await loadGlb(exportGlb(mech));
    const rig = JSON.parse(JSON.stringify(rigSidecar(mech)));
    const w = new RigWalker(scene, rig);
    for (let i = 0; i < 40; i++) w.update(1 / 30);
    for (const a of rig.actuators) {
      const base = w.obj.get(a.baseNode)!;
      const end = w.obj.get(a.endNode)!;
      const pb = base.getWorldPosition(new Vector3());
      const pe = end.getWorldPosition(new Vector3());
      const zb = new Vector3(0, 0, 1).transformDirection(base.matrixWorld);
      expect(zb.dot(pe.clone().sub(pb).normalize())).toBeGreaterThan(0.999);
      const len = pb.distanceTo(pe);
      expect(len).toBeLessThan(a.barrelLength + a.rodLength);
    }
    void Matrix4;
  });
});
