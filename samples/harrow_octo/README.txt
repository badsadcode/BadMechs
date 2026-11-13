BadMech export package: Harrow Octo
=========================================

Units: metres · Up: +Y · Forward (mech faces): +Z · Right-handed (glTF convention)
Height 5.58 m · octopod · medium

FILES
  harrow_octo.glb              Full articulated mech (LOD0). Hierarchy, pivots, PBR materials, skinned
                           flex hoses, interiors. Joint metadata in node extras ("badmech").
  harrow_octo_LOD1.glb         Same hierarchy, greebles removed.
  harrow_octo_LOD2.glb         Same hierarchy, silhouette only, no interiors.
  harrow_octo_collision.glb    Same hierarchy with box collision proxies (COL_<body>_<n>).
  harrow_octo.rig.json         THE CONTRACT: joints/axes/limits, leg & arm chains, piston aim
                           constraints, hoses, mounts, interiors, gait hints, collision boxes.
  harrow_octo.usda             Articulated Xform hierarchy + meshes + UsdPreviewSurface materials.
                           Joint data as customData. No skinned hoses.
  harrow_octo.obj / .mtl       STATIC geometry only, rest pose, world space. No rig. No hierarchy.
  harrow_octo.badmech.json     Editable source recipe. Load it in BadMech to get this exact mech back.
  harrow_octo.validation.json  Automated checks run at export time.
  blender_bridge.py        blender -b -P blender_bridge.py -- harrow_octo.glb
                           → harrow_octo.blend + harrow_octo.fbx (+ re-import check report)

ENGINE NOTES (details: docs/ENGINE_IMPORT.md in the BadMech repo)
  Godot 4   Import the .glb. Godot faces -Z, so rotate the root 180° about Y (or just treat
            +Z as forward in your controller). Nodes keep names; joint data is in node meta
            when "Import > Meta" is on, otherwise read harrow_octo.rig.json.
  Unity     Import the .glb with glTFast or the .fbx from the bridge. Unity flips X on import
            (left-handed); axes in the rig file are glTF-space – mirror X for Unity space.
  Unreal    Import the .fbx (from the bridge) as Skeletal Mesh, or the .glb via the glTF
            importer. Unreal is Z-up, cm: the importer converts.
  Blender   Import the .glb or open the .blend from the bridge.

Pistons: after posing joints, aim each actuator's baseNode +Z at endNode and vice versa.
Hoses: skinned to 2 bones each in GLB/FBX/.blend; they follow automatically.
