"""Convert a SpellDirector caster rig (<id>.caster.glb) to FBX for Unity.

Run it with Blender (3.6 or later), not plain Python:

    blender -b -P tools/blender_glb_to_fbx.py -- <in.glb> [out.fbx]

The FBX keeps the mixamorig bone names, the socket empties on the bones, the
spell's points and the baked casting animation. In Unity: select the FBX,
Rig > Animation Type: Humanoid, Avatar Definition: Create From This Model,
Apply. The bones map to the Humanoid avatar on their own (they are Mixamo's
names), so the clip retargets onto any Humanoid character.

Unity can also import the .glb directly with the glTFast package; FBX is the
surest route to a Humanoid avatar.
"""

import sys
from pathlib import Path


def main(argv: list[str]) -> int:
    args = argv[argv.index("--") + 1:] if "--" in argv else []
    if not args:
        print(__doc__)
        return 2
    src = Path(args[0]).resolve()
    dst = Path(args[1]).resolve() if len(args) > 1 else src.with_suffix(".fbx")
    import bpy  # only inside Blender

    bpy.ops.wm.read_factory_settings(use_empty=True)
    # Keep the bones as they are in the file (rest rotations are the identity):
    # the animation then comes through unchanged.
    bpy.ops.import_scene.gltf(filepath=str(src), bone_heuristic="TEMPERANCE")
    arm = next((o for o in bpy.context.scene.objects if o.type == "ARMATURE"), None)
    if arm is None:
        print("No skeleton found in", src)
        return 1
    # The action takes the spell's name (the glTF animation's name).
    if arm.animation_data and arm.animation_data.action:
        name = arm.animation_data.action.name.split("|")[-1]
        arm.animation_data.action.name = name
        # The FBX take (Unity's clip name) comes from the scene's name.
        bpy.context.scene.name = name
    scene = bpy.context.scene
    if arm.animation_data and arm.animation_data.action:
        start, end = arm.animation_data.action.frame_range
        scene.frame_start, scene.frame_end = int(start), int(end)
    bpy.ops.export_scene.fbx(
        filepath=str(dst),
        use_selection=False,
        object_types={"ARMATURE", "MESH", "EMPTY"},
        add_leaf_bones=False,
        bake_anim=True,
        bake_anim_use_all_actions=False,
        bake_anim_use_nla_strips=False,
        bake_anim_simplify_factor=0.0,
        apply_scale_options="FBX_SCALE_ALL",
        axis_forward="-Z",
        axis_up="Y",
    )
    print("Wrote", dst)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
