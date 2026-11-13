# BadMech

**Procedural generator of mechanically coherent, animation-ready, game-ready mechs.**
*Bad Ideas Works: We Create Worlds. Badly. Now the machines can walk through them.*

BadMech builds walkers as real articulated machines — named joints with pivots, axes and limits,
leg chains for IK, hydraulic pistons with aim constraints, skinned flex hoses, cockpits and
walkable interiors — then exports them so a game-side procedural controller can make them walk
without anyone rebuilding the skeleton by hand.

- **App:** `npm install && npm run dev` (or the GitHub Pages deployment)
- **Devlog:** [`DEVLOG.md`](DEVLOG.md) (also `devlog.html` on the site)
- **Rig contract:** [`docs/RIG_SPEC.md`](docs/RIG_SPEC.md) · engine notes: [`docs/ENGINE_IMPORT.md`](docs/ENGINE_IMPORT.md)
- **Samples + round-trip results:** [`samples/`](samples/) · [`samples/ROUNDTRIP.md`](samples/ROUNDTRIP.md)

## Status (honest version)

| Area | State |
|---|---|
| Families: biped (plantigrade/digitigrade), exosuit, colossus, quadruped (upright/sprawl), hexapod, octopod | ✅ working |
| Seeded recipes, per-subsystem re-roll, pinned overrides, save/load `.badmech.json`, share links | ✅ working |
| Joint hierarchy, limits auto-fitted against self-collision, pistons sized to be buildable | ✅ working, validated |
| GLB (LOD0–2, collision proxies, skinned hoses, metadata), `.rig.json`, USDA, OBJ | ✅ working, Khronos validator clean |
| FBX + `.blend` via `tools/blender_bridge.py` (rigid-skinned skeletal mesh) | ✅ working, round-trip checked in Blender 5.3 |
| Reference walk controller (reads only GLB + rig.json) | ✅ walks every family in tests and in-app |
| Visual quality vs. the concept art | 🚧 in progress: hard-surface geometry kernel next |
| Godot / Unity / Unreal import | ⚠️ not verified in those editors (not available in the build env); glTF/FBX validated via Khronos validator, three.js and Blender |

## Commands

```bash
npm run dev            # app
npm test               # 57 tests: determinism, validity, exports, controller walks exported GLBs
npm run cli -- export hexapod 42 out/
./tools/make_samples.sh                 # needs: pip install bpy usd-core
python3 tools/blender_bridge.py out/x/x.glb   # → .blend + .fbx + bridge report
```
