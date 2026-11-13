BadMech export package: Grudge A-73
=========================================

Units: metres · Up: +Y · Forward (mech faces): +Z · Right-handed (glTF convention)
Height 10.59 m · biped · heavy

FILES
  grudge_a_73.glb              Full articulated mech (LOD0). Hierarchy, pivots, PBR materials, skinned
                           flex hoses, interiors. Joint metadata in node extras ("badmech").
  grudge_a_73_LOD1.glb         Same hierarchy, greebles removed.
  grudge_a_73_LOD2.glb         Same hierarchy, silhouette only, no interiors.
  grudge_a_73_collision.glb    Same hierarchy with box collision proxies (COL_<body>_<n>).
  grudge_a_73.rig.json         THE CONTRACT: joints/axes/limits, leg & arm chains, piston aim
                           constraints, hoses, mounts, interiors, gait hints, collision boxes.
  grudge_a_73.usda             Articulated Xform hierarchy + meshes + UsdPreviewSurface materials.
                           Joint data as customData. No skinned hoses.
  grudge_a_73.obj / .mtl       STATIC geometry only, rest pose, world space. No rig. No hierarchy.
  grudge_a_73.badmech.json     Editable source recipe. Load it in BadMech to get this exact mech back.
  grudge_a_73.validation.json  Automated checks run at export time.
  blender_bridge.py        blender -b -P blender_bridge.py -- grudge_a_73.glb
                           → grudge_a_73.blend + grudge_a_73.fbx (+ re-import check report)

ENGINE NOTES (details: docs/ENGINE_IMPORT.md in the BadMech repo)
  Godot 4   Import the .glb. Godot faces -Z, so rotate the root 180° about Y (or just treat
            +Z as forward in your controller). Nodes keep names; joint data is in node meta
            when "Import > Meta" is on, otherwise read grudge_a_73.rig.json.
  Unity     Import the .glb with glTFast or the .fbx from the bridge. Unity flips X on import
            (left-handed); axes in the rig file are glTF-space – mirror X for Unity space.
  Unreal    Import the .fbx (from the bridge) as Skeletal Mesh, or the .glb via the glTF
            importer. Unreal is Z-up, cm: the importer converts.
  Blender   Import the .glb or open the .blend from the bridge.

Pistons: after posing joints, aim each actuator's baseNode +Z at endNode and vice versa.
Hoses: skinned to 2 bones each in GLB/FBX/.blend; they follow automatically.
