BadMech export package: Mule Hauler
=========================================

Units: metres · Up: +Y · Forward (mech faces): +Z · Right-handed (glTF convention)
Height 6.62 m · quadruped · medium

FILES
  mule_hauler.glb              Full articulated mech (LOD0). Hierarchy, pivots, PBR materials, skinned
                           flex hoses, interiors. Joint metadata in node extras ("badmech").
  mule_hauler_LOD1.glb         Same hierarchy, greebles removed.
  mule_hauler_LOD2.glb         Same hierarchy, silhouette only, no interiors.
  mule_hauler_collision.glb    Same hierarchy with box collision proxies (COL_<body>_<n>).
  mule_hauler.rig.json         THE CONTRACT: joints/axes/limits, leg & arm chains, piston aim
                           constraints, hoses, mounts, interiors, gait hints, collision boxes.
  mule_hauler.usda             Articulated Xform hierarchy + meshes + UsdPreviewSurface materials.
                           Joint data as customData. No skinned hoses.
  mule_hauler.obj / .mtl       STATIC geometry only, rest pose, world space. No rig. No hierarchy.
  mule_hauler.badmech.json     Editable source recipe. Load it in BadMech to get this exact mech back.
  mule_hauler.validation.json  Automated checks run at export time.
  blender_bridge.py        blender -b -P blender_bridge.py -- mule_hauler.glb
                           → mule_hauler.blend + mule_hauler.fbx (+ re-import check report)

ENGINE NOTES (details: docs/ENGINE_IMPORT.md in the BadMech repo)
  Godot 4   Import the .glb. Godot faces -Z, so rotate the root 180° about Y (or just treat
            +Z as forward in your controller). Nodes keep names; joint data is in node meta
            when "Import > Meta" is on, otherwise read mule_hauler.rig.json.
  Unity     Import the .glb with glTFast or the .fbx from the bridge. Unity flips X on import
            (left-handed); axes in the rig file are glTF-space – mirror X for Unity space.
  Unreal    Import the .fbx (from the bridge) as Skeletal Mesh, or the .glb via the glTF
            importer. Unreal is Z-up, cm: the importer converts.
  Blender   Import the .glb or open the .blend from the bridge.

Pistons: after posing joints, aim each actuator's baseNode +Z at endNode and vice versa.
Hoses: skinned to 2 bones each in GLB/FBX/.blend; they follow automatically.
