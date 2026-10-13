"""Build a talking-face avatar (.glb) with Blender + MPFB, headless.

Usage:
  blender.exe --background --python blender/make_avatar.py -- <output.glb> [preset]

Presets are defined in PRESETS below. Needs MPFB 2.0.18+ and the asset packs
makehuman_system_assets, visemes02 and faceunits01 installed.
"""

import os
import sys

import bpy

from bl_ext.user_default.mpfb.services import (ExportService, FaceService, HumanService, LocationService,
                                               ObjectService, TargetService)

PRESETS = {
    "ona": {
        "macro": {"gender": 0.0, "age": 0.5, "muscle": 0.45, "weight": 0.45, "proportions": 0.6,
                  "height": 0.45, "cupsize": 0.5, "firmness": 0.5,
                  "race": {"asian": 0.05, "caucasian": 0.9, "african": 0.05}},
        "skin": "skins/young_caucasian_female/young_caucasian_female.mhmat",
        "assets": [
            ("Eyes", "eyes/high-poly/high-poly.mhclo"),
            ("Eyebrows", "eyebrows/eyebrow010/eyebrow010.mhclo"),
            ("Eyelashes", "eyelashes/eyelashes02/eyelashes02.mhclo"),
            ("Teeth", "teeth/teeth_base/teeth_base.mhclo"),
            ("Tongue", "tongue/tongue01/tongue01.mhclo"),
            ("Hair", "hair/bob02/bob02.mhclo"),
            ("Clothes", "clothes/female_casualsuit01/female_casualsuit01.mhclo"),
            ("Clothes", "clothes/shoes02/shoes02.mhclo"),
        ],
    },
}

# MPFB "default" rig bone -> name used by talking-face-avatars.html (Ready Player Me style).
BONE_RENAMES = {
    "head": "Head",
    "neck01": "Neck",
    "eye.L": "LeftEye",
    "eye.R": "RightEye",
    "upperarm01.L": "LeftArm",
    "upperarm01.R": "RightArm",
    "lowerarm01.L": "LeftForeArm",
    "lowerarm01.R": "RightForeArm",
}


# Assets that need alpha cut-out (glTF MASK). Everything else is exported opaque:
# glTF BLEND on skin/eyes/teeth breaks depth sorting in three.js (mouth shows through the face).
CUTOUT_ASSET_TYPES = ("Hair", "Eyebrows", "Eyelashes", "Eyes")  # Eyes: transparent cornea over the iris.


def asset_name(rel):
    return os.path.basename(rel).split(".")[0]


def make_opaque(objs, cutout_names):
    for obj in objs:
        if obj.type != "MESH":
            continue
        for mat in obj.data.materials:
            if mat is None or not mat.use_nodes or any(n in mat.name for n in cutout_names):
                continue
            for node in mat.node_tree.nodes:
                alpha = node.inputs.get("Alpha") if node.type == "BSDF_PRINCIPLED" else None
                if alpha is None:
                    continue
                for link in list(alpha.links):
                    mat.node_tree.links.remove(link)
                alpha.default_value = 1.0


def set_cutout_alpha_mode(glb_path, cutout_names, cutoff=0.5):
    """The glTF exporter writes BLEND for any connected alpha; switch hair-like materials to MASK."""
    import json
    import struct
    with open(glb_path, "rb") as f:
        raw = f.read()
    json_len = struct.unpack("<I", raw[12:16])[0]
    gltf = json.loads(raw[20:20 + json_len])
    for mat in gltf.get("materials", []):
        if any(n in mat.get("name", "") for n in cutout_names):
            mat["alphaMode"] = "MASK"
            mat["alphaCutoff"] = cutoff
    chunk = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    chunk += b" " * (-len(chunk) % 4)
    rest = raw[20 + json_len:]
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(chunk) + len(rest))
    out += struct.pack("<II", len(chunk), 0x4E4F534A) + chunk + rest
    with open(glb_path, "wb") as f:
        f.write(out)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not argv:
        raise SystemExit("Usage: ... -- <output.glb> [preset]")
    out_path = os.path.abspath(argv[0])
    preset = PRESETS[argv[1] if len(argv) > 1 else "ona"]
    data = LocationService.get_user_data()

    if not FaceService.is_faceunits01_installed(True):
        raise SystemExit("faceunits01 asset pack is not installed")

    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    basemesh = HumanService.create_human(macro_detail_dict=preset["macro"])
    TargetService.reapply_macro_details(basemesh)
    HumanService.add_builtin_rig(basemesh, "default")
    HumanService.set_character_skin(os.path.join(data, preset["skin"]), basemesh, skin_type="GAMEENGINE")
    for asset_type, rel in preset["assets"]:
        HumanService.add_mhclo_asset(os.path.join(data, rel), basemesh, asset_type=asset_type,
                                     material_type="GAMEENGINE")

    export_root = ExportService.create_character_copy(basemesh, name_suffix="_export")
    new_basemesh = ObjectService.find_object_of_type_amongst_nearest_relatives(export_root)
    TargetService.bake_targets(new_basemesh)
    FaceService.load_targets(new_basemesh, load_microsoft_visemes=False,
                             load_meta_visemes=True, load_arkit_faceunits=True)
    FaceService.interpolate_targets(new_basemesh)
    ExportService.bake_modifiers_remove_helpers(new_basemesh, bake_masks=True, bake_subdiv=False,
                                                remove_helpers=True, also_proxy=True)
    for obj in [new_basemesh] + [o for o in bpy.data.objects if o.parent == new_basemesh.parent]:
        for mod in [m for m in obj.modifiers if m.type in ("MASK", "SUBSURF")]:
            obj.modifiers.remove(mod)

    rig = export_root if export_root.type == "ARMATURE" else ObjectService.find_object_of_type_amongst_nearest_relatives(
        new_basemesh, "Skeleton")
    for old, new in BONE_RENAMES.items():
        bone = rig.data.bones.get(old)
        if bone is None:
            raise SystemExit("Missing bone " + old)
        bone.name = new  # Blender also renames the matching vertex groups.

    export_objs = [rig] + [o for o in bpy.data.objects if o.parent == rig]
    for obj in bpy.data.objects:
        obj.select_set(obj in export_objs)
    bpy.context.view_layer.objects.active = rig

    cutout_names = [asset_name(rel) for t, rel in preset["assets"] if t in CUTOUT_ASSET_TYPES]
    make_opaque(export_objs, cutout_names)

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB", use_selection=True,
                              export_morph=True, export_skins=True, export_animations=False,
                              export_image_format="JPEG")
    set_cutout_alpha_mode(out_path, cutout_names)

    print("AVATAR objects:", [(o.name, o.type) for o in export_objs])
    print("AVATAR written:", out_path, os.path.getsize(out_path) // 1024, "KB")


main()
