"""Render one frame through a preview camera at game size (Workbench, flat texture colour), for a quick framing check.

  blender -b blender/src/dwarf.blend --python blender/scripts/render_preview.py -- OUT.png [camera] [action] [frame]

defaults: preview_cam_solo, swing_ready, frame 0. Output is RENDER_PX square (270). Contact sheets come in phase 1.
"""
import os
import sys

import bpy

a = sys.argv[sys.argv.index('--') + 1:]
out = os.path.abspath(a[0])
cam = a[1] if len(a) > 1 else 'preview_cam_solo'
act = a[2] if len(a) > 2 else 'swing_ready'
frame = int(a[3]) if len(a) > 3 else 0
sc = bpy.context.scene
sc.camera = bpy.data.objects[cam]
arm = bpy.data.objects['Armature']
arm.animation_data.action = bpy.data.actions[act]
slots = arm.animation_data.action.slots
arm.animation_data.action_slot = slots[0]
sc.frame_set(frame)
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'FLAT'
sc.display.shading.color_type = 'TEXTURE'
sc.render.film_transparent = False
bpy.context.scene.world = bpy.data.worlds.new('w') if not bpy.context.scene.world else bpy.context.scene.world
sc.render.filepath = out
sc.render.image_settings.file_format = 'PNG'
bpy.ops.render.render(write_still=True)
print('RENDERED', out)
