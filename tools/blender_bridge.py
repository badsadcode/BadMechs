"""
BadMech → Blender bridge.

Turns a BadMech GLB (+ its .rig.json sidecar) into:
  <base>.blend   inspection/edit file: a clean armature with one bone per moving part,
                 a rigidly-skinned mesh (each part 100% on its bone, hoses blended over 2 bones),
                 bone custom properties carrying joint axis/limits, and Blender bone rotation limits.
  <base>.fbx     the same skeletal mesh for Unreal / Unity / anything that wants FBX.
  <base>.bridge_report.json   round-trip check: the FBX is re-imported and every bone's rest
                 position/orientation is compared against the rig sidecar.

Usage (Blender):        blender -b -P blender_bridge.py -- path/to/mech.glb [--out DIR]
Usage (bpy as module):  python blender_bridge.py path/to/mech.glb [--out DIR]

Why rebuild an armature instead of exporting the glTF import as-is? Game engines import moving
rigid parts most reliably as a skeletal mesh with rigid weights. The glTF importer only turns
skin joints into bones, so the hierarchy would come out half bones / half empties.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

# glTF (+Y up, +Z fwd) → Blender (+Z up): the same basis change the glTF importer applies.
C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
C_INV = C.inverted()


def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else argv[1:]
    glb = None
    out = None
    i = 0
    while i < len(argv):
        if argv[i] == "--out":
            out = argv[i + 1]
            i += 2
            continue
        glb = argv[i]
        i += 1
    if not glb:
        raise SystemExit("usage: blender -b -P blender_bridge.py -- mech.glb [--out DIR]")
    return os.path.abspath(glb), os.path.abspath(out or os.path.dirname(os.path.abspath(glb)))


def load_rig(glb):
    base = os.path.splitext(glb)[0]
    side = base + ".rig.json"
    if os.path.exists(side):
        with open(side) as f:
            return json.load(f)
    # fall back to the copy embedded in the GLB's scene extras
    with open(glb, "rb") as f:
        data = f.read()
    jlen = int.from_bytes(data[12:16], "little")
    gj = json.loads(data[20:20 + jlen])
    return gj["scenes"][0]["extras"]["badmech"]


def rest_world(rig):
    """Rest world matrices (glTF space) straight from the sidecar."""
    out = {}
    for n in rig["nodes"]:
        t = Vector(n["restTranslation"])
        x, y, z, w = n["restRotation"]
        m = Matrix.Translation(t) @ Quaternion((w, x, y, z)).to_matrix().to_4x4()
        if n["parent"]:
            m = out[n["parent"]] @ m
        out[n["name"]] = m
    return out


def base_name(name):
    # Blender appends .001 etc. on collisions
    return name.rsplit(".", 1)[0] if len(name) > 4 and name[-4] == "." and name[-3:].isdigit() else name


def bone_nodes(rig):
    """Every node that moves on its own: root, body, joints, piston barrel/rod nodes."""
    out = []
    for n in rig["nodes"]:
        if n["parent"] is None or n["role"] in ("link", "actuator", "hatch") or any(j["name"] == n["name"] for j in rig["joints"]):
            out.append(n["name"])
    return out


def main():
    glb, out_dir = parse_args()
    os.makedirs(out_dir, exist_ok=True)
    rig = load_rig(glb)
    stem = os.path.splitext(os.path.basename(glb))[0]
    nodes = {n["name"]: n for n in rig["nodes"]}
    joints = {j["name"]: j for j in rig["joints"]}
    W = rest_world(rig)
    bones = bone_nodes(rig)
    bone_set = set(bones)

    def owner_bone(name):
        while name and name not in bone_set:
            name = nodes[name]["parent"]
        return name

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    imported = list(bpy.context.scene.objects)
    col_imp = bpy.data.collections.new("BM_Imported_glTF")
    bpy.context.scene.collection.children.link(col_imp)
    for o in imported:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        col_imp.objects.link(o)

    col = bpy.data.collections.new("BM_" + rig["name"].replace(" ", "_"))
    bpy.context.scene.collection.children.link(col)

    # ── armature
    arm_data = bpy.data.armatures.new(rig["name"] + "_Armature")
    arm = bpy.data.objects.new(rig["name"] + "_Rig", arm_data)
    col.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    size = max(0.05, rig["stats"]["height"] * 0.03)
    for name in bones:
        eb = arm_data.edit_bones.new(name)
        eb.head = (0, 0, 0)
        eb.tail = (0, size, 0)
        # bone matrix == node rest world (converted to Blender space). Bone local Y == node local Y.
        eb.matrix = C @ W[name] @ C_INV
        p = nodes[name]["parent"]
        pb = owner_bone(p) if p else None
        if pb:
            eb.parent = arm_data.edit_bones[pb]
        eb.use_deform = True
    bpy.ops.object.mode_set(mode="POSE")
    for name in bones:
        pb = arm.pose.bones[name]
        pb.rotation_mode = "XYZ"
        j = joints.get(name)
        if j:
            # one free axis, limited like the rig says
            pb["bm_axis"] = j["axis"]
            pb["bm_min"] = j["min"]
            pb["bm_max"] = j["max"]
            pb["bm_kind"] = j["kind"]
            pb["bm_purpose"] = j["purpose"]
            lock = {"x": (False, True, True), "y": (True, False, True), "z": (True, True, False)}[j["axis"]]
            pb.lock_rotation = lock
            if not j["continuous"]:
                c = pb.constraints.new("LIMIT_ROTATION")
                c.owner_space = "LOCAL"
                c.use_limit_x = c.use_limit_y = c.use_limit_z = True
                for ax in "xyz":
                    lo, hi = (j["min"], j["max"]) if ax == j["axis"] else (0.0, 0.0)
                    setattr(c, "min_" + ax, lo)
                    setattr(c, "max_" + ax, hi)
        else:
            pb.lock_rotation = (True, True, True)
            if name != rig["rootNode"] and name != rig["bodyNode"] and nodes[name]["role"] != "actuator":
                pb.lock_location = (True, True, True)
    bpy.ops.object.mode_set(mode="OBJECT")

    # ── rigidly skinned mesh: copy every imported mesh, weight it to its owning bone
    parts = []
    for o in imported:
        if o.type != "MESH":
            continue
        nm = base_name(o.name)
        mesh = o.data.copy()
        mesh.transform(o.matrix_world)
        ob = bpy.data.objects.new(nm + "_part", mesh)
        col.objects.link(ob)
        ob.vertex_groups.clear()
        if nm.endswith("_skin") and o.vertex_groups:
            # hose: keep its 2-bone weights (group names are the joint node names)
            # weights live in the mesh data; recreate the groups in the same order so indices match
            for vg in sorted(o.vertex_groups, key=lambda g: g.index):
                ob.vertex_groups.new(name=base_name(vg.name))
        else:
            ob_bone = owner_bone(nm) if nm in nodes else rig["rootNode"]
            vg = ob.vertex_groups.new(name=ob_bone)
            vg.add(range(len(mesh.vertices)), 1.0, "REPLACE")
        parts.append(ob)

    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = rig["name"] + "_Mesh"
    body.parent = arm
    mod = body.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    arm["badmech_rig_schema"] = rig["schema"]
    arm["badmech_rig_json"] = json.dumps({k: rig[k] for k in ("legs", "arms", "actuators", "cables", "mounts", "gait", "coordinateSystem")})

    # hide the raw import (kept for inspection)
    bpy.context.view_layer.layer_collection.children[col_imp.name].exclude = True

    blend = os.path.join(out_dir, stem + ".blend")
    fbx = os.path.join(out_dir, stem + ".fbx")
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    body.select_set(True)
    bpy.ops.export_scene.fbx(
        filepath=fbx,
        use_selection=True,
        object_types={"ARMATURE", "MESH"},
        add_leaf_bones=False,
        bake_anim=False,
        primary_bone_axis="Y",
        secondary_bone_axis="X",
        axis_forward="-Z",
        axis_up="Y",
        apply_unit_scale=True,
        mesh_smooth_type="FACE",
    )

    report = check_fbx(fbx, rig, W, bones)
    report["blend"] = os.path.basename(blend)
    report["fbx"] = os.path.basename(fbx)
    with open(os.path.join(out_dir, stem + ".bridge_report.json"), "w") as f:
        json.dump(report, f, indent=2)
    print("BADMECH_BRIDGE_REPORT " + json.dumps({k: v for k, v in report.items() if k != "bones"}))
    return report


def check_fbx(fbx, rig, W, bones):
    """Re-import the FBX into an empty scene and compare bone rest transforms with the sidecar."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=fbx, automatic_bone_orientation=False, primary_bone_axis="Y", secondary_bone_axis="X")
    arms = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    out = {"ok": True, "bones": {}, "boneCount": 0, "missingBones": [], "maxPosErrorM": 0.0, "maxAxisErrorDeg": 0.0}
    if not arms:
        out["ok"] = False
        out["error"] = "no armature in FBX"
        return out
    arm = arms[0]
    out["boneCount"] = len(arm.data.bones)
    out["meshCount"] = len(meshes)
    out["triangles"] = sum(sum(len(p.vertices) - 2 for p in m.data.polygons) for m in meshes)
    out["vertexGroups"] = len(meshes[0].vertex_groups) if meshes else 0
    for name in bones:
        b = arm.data.bones.get(name)
        if not b:
            out["missingBones"].append(name)
            continue
        got = arm.matrix_world @ b.matrix_local
        want = C @ W[name] @ C_INV
        pos_err = (got.to_translation() - want.to_translation()).length
        gq = got.to_3x3().normalized()
        wq = want.to_3x3().normalized()
        ax_err = 0.0
        for i in range(3):
            a = Vector(gq.col[i]).normalized()
            w = Vector(wq.col[i]).normalized()
            ax_err = max(ax_err, math.degrees(a.angle(w, 0.0)))
        out["bones"][name] = {"posErr": round(pos_err, 6), "axisErrDeg": round(ax_err, 4)}
        out["maxPosErrorM"] = max(out["maxPosErrorM"], pos_err)
        out["maxAxisErrorDeg"] = max(out["maxAxisErrorDeg"], ax_err)
    out["ok"] = not out["missingBones"] and out["maxPosErrorM"] < 1e-3 and out["maxAxisErrorDeg"] < 0.5
    return out


if __name__ == "__main__":
    main()
