BadMech export package: Tick Exo
======================================

Units: metres · Up: +Y · Forward (mech faces): +Z · Right-handed (glTF convention)
Height 2.22 m · exosuit · exosuit

FILES
  tick_exo.glb              Full articulated mech (LOD0). Hierarchy, pivots, PBR materials, skinned
                           flex hoses, interiors. Joint metadata in node extras ("badmech").
  tick_exo_LOD1.glb         Same hierarchy, greebles removed.
  tick_exo_LOD2.glb         Same hierarchy, silhouette only, no interiors.
  tick_exo_collision.glb    Same hierarchy with box collision proxies (COL_<body>_<n>).
  tick_exo.rig.json         THE CONTRACT: joints/axes/limits, leg & arm chains, piston aim
                           constraints, hoses, mounts, interiors, gait hints, collision boxes.
  tick_exo.usda             Articulated Xform hierarchy + meshes + UsdPreviewSurface materials.
                           Joint data as customData. No skinned hoses.
  tick_exo.obj / .mtl       STATIC geometry only, rest pose, world space. No rig. No hierarchy.
  tick_exo.badmech.json     Editable source recipe. Load it in BadMech to get this exact mech back.
  tick_exo.validation.json  Automated checks run at export time.
  blender_bridge.py        blender -b -P blender_bridge.py -- tick_exo.glb
                           → tick_exo.blend + tick_exo.fbx (+ re-import check report)

ENGINE NOTES (details: docs/ENGINE_IMPORT.md in the BadMech repo)
  Godot 4   Import the .glb. Godot faces -Z, so rotate the root 180° about Y (or just treat
            +Z as forward in your controller). Nodes keep names; joint data is in node meta
            when "Import > Meta" is on, otherwise read tick_exo.rig.json.
  Unity     Import the .glb with glTFast or the .fbx from the bridge. Unity flips X on import
            (left-handed); axes in the rig file are glTF-space – mirror X for Unity space.
  Unreal    Import the .fbx (from the bridge) as Skeletal Mesh, or the .glb via the glTF
            importer. Unreal is Z-up, cm: the importer converts.
  Blender   Import the .glb or open the .blend from the bridge.

Pistons: after posing joints, aim each actuator's baseNode +Z at endNode and vice versa.
Hoses: skinned to 2 bones each in GLB/FBX/.blend; they follow automatically.
