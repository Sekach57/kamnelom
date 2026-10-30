"""Export a blender/src/*.blend to glTF Binary with the project settings (docs/BLENDER_PIPELINE.md, section 1.6).

  blender -b blender/src/dwarf.blend --python blender/scripts/export_glb.py -- OUT.glb

Settings: .glb, +Y up, Apply Modifiers, every Action = one clip (export_animation_mode ACTIONS), no cameras/lights,
no compression (Meshopt is a separate gltf-transform step in phase 6). Fixed names in the file come from the
bone / action names in the .blend, so the clip list is checked after export, not before.
"""
import os
import sys

import bpy

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if not argv:
    sys.exit('usage: blender -b FILE.blend --python export_glb.py -- OUT.glb')
out = os.path.abspath(argv[0])
os.makedirs(os.path.dirname(out), exist_ok=True)

for act in bpy.data.actions:  # ACTIONS mode exports every action; Fake User keeps unassigned ones alive in the .blend
    assert act.use_fake_user, 'action without Fake User: ' + act.name

bpy.ops.export_scene.gltf(
    filepath=out,
    export_format='GLB',
    export_yup=True,
    export_apply=True,
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_cameras=False,
    export_lights=False,
    export_skins=True,
    export_def_bones=False,
    export_extras=False,
    export_image_format='AUTO',
    export_force_sampling=True,
    export_optimize_animation_size=True,
)
print('EXPORTED', out, os.path.getsize(out))
