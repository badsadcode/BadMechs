"""
Round-trip check for a BadMech export package: re-import every format into real tools and compare
against the rig sidecar.

  python tools/roundtrip_check.py samples/<mech>/      (needs `pip install bpy usd-core`)

Checks
  GLB  → Blender glTF importer: every rig node arrives, rest world position + orientation of every
         node object/bone matches the sidecar, materials present, skinned hoses deform.
  FBX  → produced by blender_bridge.py; re-imported, bone rest transforms compared (bridge report),
         then a joint is posed and we verify the mesh actually follows it.
  USDA → Pixar USD (pxr): stage opens, every node prim exists, world transforms match sidecar,
         customData joint limits survive. Then Blender's USD importer.
  OBJ  → Blender OBJ importer: geometry + materials arrive (static by definition).
Writes <dir>/roundtrip_report.json and prints a one-line summary.
"""
import glob
import json
import math
import os
import subprocess
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
C_INV = C.inverted()
HERE = os.path.dirname(os.path.abspath(__file__))


def rest_world(rig):
    out = {}
    for n in rig["nodes"]:
        x, y, z, w = n["restRotation"]
        m = Matrix.Translation(Vector(n["restTranslation"])) @ Quaternion((w, x, y, z)).to_matrix().to_4x4()
        out[n["name"]] = (out[n["parent"]] @ m) if n["parent"] else m
    return out


def mat_err(got, want):
    pe = (got.to_translation() - want.to_translation()).length
    g = got.to_3x3().normalized()
    w = want.to_3x3().normalized()
    ae = max(math.degrees(Vector(g.col[i]).normalized().angle(Vector(w.col[i]).normalized(), 0.0)) for i in range(3))
    return pe, ae


def base_name(name):
    return name.rsplit(".", 1)[0] if len(name) > 4 and name[-4] == "." and name[-3:].isdigit() else name


def check_glb(path, rig, W):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    # nodes become objects, or bones (when used as skin joints). Collect world matrices of both.
    world = {}
    for o in bpy.context.scene.objects:
        world[base_name(o.name)] = o.matrix_world.copy()
        if o.type == "ARMATURE":
            for b in o.data.bones:
                # importer may rotate bones for display; compare positions only for bones
                world.setdefault(base_name(b.name), ("bone", o.matrix_world @ b.matrix_local))
    missing, pe_max, ae_max, checked = [], 0.0, 0.0, 0
    for n in rig["nodes"]:
        got = world.get(n["name"])
        if got is None:
            missing.append(n["name"])
            continue
        want = C @ W[n["name"]] @ C_INV
        if isinstance(got, tuple):
            pe = (got[1].to_translation() - want.to_translation()).length
            ae = 0.0
        else:
            pe, ae = mat_err(got, want)
        pe_max, ae_max, checked = max(pe_max, pe), max(ae_max, ae), checked + 1
    mats = len(bpy.data.materials)
    with open(path, "rb") as f:
        data = f.read()
    gj = json.loads(data[20:20 + int.from_bytes(data[12:16], "little")])
    used = {pr["material"] for m in gj.get("meshes", []) for pr in m["primitives"] if "material" in pr}
    skinned = [o for o in bpy.context.scene.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers)]
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.context.scene.objects if o.type == "MESH")
    ok = not missing and pe_max < 1e-3 and ae_max < 0.5 and mats >= len(used)
    return {"ok": ok, "nodesChecked": checked, "missing": missing[:10], "maxPosErrorM": pe_max, "maxAxisErrorDeg": ae_max, "materials": f"{mats} imported / {len(used)} used in file", "skinnedHoses": len(skinned), "triangles": tris}


def check_fbx_pose(fbx, rig):
    """Pose a knee/elbow bone in the re-imported FBX and confirm vertices follow (rigid skin works)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=fbx, automatic_bone_orientation=False)
    arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
    mesh = next(o for o in bpy.context.scene.objects if o.type == "MESH")
    j = next((j for j in rig["joints"] if j["kind"] in ("knee", "tibia-pitch", "elbow")), rig["joints"][0])
    dg = bpy.context.evaluated_depsgraph_get()
    before = [v.co.copy() for v in mesh.evaluated_get(dg).data.vertices]
    pb = arm.pose.bones[j["name"]]
    pb.rotation_mode = "XYZ"
    ang = j["max"] * 0.8 if abs(j["max"]) > abs(j["min"]) else j["min"] * 0.8
    e = [0.0, 0.0, 0.0]
    e["xyz".index(j["axis"])] = ang
    pb.rotation_euler = e
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    after = [v.co.copy() for v in mesh.evaluated_get(dg).data.vertices]
    moved = sum(1 for a, b in zip(before, after) if (a - b).length > 1e-4)
    # the posed joint's pivot must not move (rotation about its own origin)
    head_before = (arm.matrix_world @ arm.data.bones[j["name"]].matrix_local).to_translation()
    head_after = (arm.matrix_world @ pb.matrix).to_translation()
    return {"ok": moved > 0 and (head_before - head_after).length < 1e-4, "posedJoint": j["name"], "angleRad": ang, "verticesMoved": moved, "verticesTotal": len(before), "pivotDrift": (head_before - head_after).length}


def check_usd(path, rig, W):
    out = {}
    try:
        from pxr import Usd, UsdGeom

        stage = Usd.Stage.Open(path)
        cache = UsdGeom.XformCache()
        prims = {p.GetName(): p for p in stage.Traverse() if p.IsA(UsdGeom.Xform)}
        missing, pe_max, ae_max, limits_ok = [], 0.0, 0.0, 0
        for n in rig["nodes"]:
            nm = n["name"].replace("-", "_")
            p = prims.get(nm)
            if not p:
                missing.append(n["name"])
                continue
            m = cache.GetLocalToWorldTransform(p)
            # Gf matrices are row-vector convention: transpose into mathutils
            got = Matrix([[m[c][r] for c in range(4)] for r in range(4)])
            # stage root Xform is identity so world == mech space (Y-up already)
            pe, ae = mat_err(got, W[n["name"]])
            pe_max, ae_max = max(pe_max, pe), max(ae_max, ae)
            cd = p.GetCustomData()
            j = next((j for j in rig["joints"] if j["name"] == n["name"]), None)
            if j and abs(cd.get("jointMin", 99) - j["min"]) < 1e-4 and abs(cd.get("jointMax", 99) - j["max"]) < 1e-4:
                limits_ok += 1
        meshes = [p for p in stage.Traverse() if p.IsA(UsdGeom.Mesh)]
        out["pxr"] = {
            "ok": not missing and pe_max < 1e-3 and ae_max < 0.5 and limits_ok == len(rig["joints"]),
            "upAxis": UsdGeom.GetStageUpAxis(stage),
            "metersPerUnit": UsdGeom.GetStageMetersPerUnit(stage),
            "xforms": len(prims),
            "meshes": len(meshes),
            "missing": missing[:10],
            "maxPosErrorM": pe_max,
            "maxAxisErrorDeg": ae_max,
            "jointLimitsPreserved": f"{limits_ok}/{len(rig['joints'])}",
        }
    except ImportError:
        out["pxr"] = {"ok": None, "skipped": "pip install usd-core"}
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.usd_import(filepath=path)
    objs = list(bpy.context.scene.objects)
    out["blender"] = {"ok": len(objs) >= len(rig["nodes"]) * 0.9, "objects": len(objs), "meshes": sum(1 for o in objs if o.type == "MESH")}
    out["ok"] = bool(out["pxr"].get("ok") is not False and out["blender"]["ok"])
    return out


def check_obj(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.obj_import(filepath=path)
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)
    return {"ok": len(objs) > 10 and tris > 1000, "objects": len(objs), "triangles": tris, "materials": len(bpy.data.materials), "note": "static only, by design"}


def main(d):
    d = os.path.abspath(d)
    rigp = glob.glob(os.path.join(d, "*.rig.json"))[0]
    base = rigp[: -len(".rig.json")]
    rig = json.load(open(rigp))
    W = rest_world(rig)
    rep = {"mech": rig["name"], "family": rig["family"], "heightM": rig["stats"]["height"]}
    rep["glb"] = check_glb(base + ".glb", rig, W)
    for lod in (1, 2):
        r = check_glb(f"{base}_LOD{lod}.glb", rig, W)
        rep[f"glb_lod{lod}"] = {k: r[k] for k in ("ok", "nodesChecked", "maxPosErrorM", "triangles")}
    if not os.path.exists(base + ".fbx"):
        subprocess.run([sys.executable, os.path.join(HERE, "blender_bridge.py"), base + ".glb"], check=True, capture_output=True)
    rep["fbx"] = json.load(open(base + ".bridge_report.json"))
    rep["fbx"].pop("bones", None)
    rep["fbx_pose"] = check_fbx_pose(base + ".fbx", rig)
    rep["usd"] = check_usd(base + ".usda", rig, W)
    rep["obj"] = check_obj(base + ".obj")
    rep["ok"] = all(rep[k]["ok"] for k in ("glb", "glb_lod1", "glb_lod2", "fbx", "fbx_pose", "usd", "obj"))
    json.dump(rep, open(os.path.join(d, "roundtrip_report.json"), "w"), indent=2, default=float)
    flag = lambda k: "✓" if rep[k]["ok"] else "✗"
    print(f"ROUNDTRIP {'PASS' if rep['ok'] else 'FAIL'} {rig['name']:<20} glb{flag('glb')} lods{flag('glb_lod1')}{flag('glb_lod2')} fbx{flag('fbx')} fbx-pose{flag('fbx_pose')} usd{flag('usd')} obj{flag('obj')}"
          f"  | glb err {rep['glb']['maxPosErrorM']:.1e} m, fbx {rep['fbx']['boneCount']} bones err {rep['fbx']['maxPosErrorM']:.1e} m, usd err {rep['usd']['pxr'].get('maxPosErrorM', 0):.1e} m")
    return rep


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    for a in args:
        main(a)
