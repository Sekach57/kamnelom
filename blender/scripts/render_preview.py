"""Render one frame through a preview camera at game size (Workbench, flat texture colour), for a quick framing check.

  blender -b blender/src/dwarf.blend --python blender/scripts/render_preview.py -- OUT.png [camera] [action] [frame] [opt=value ...]

defaults: preview_cam_solo, swing_ready, frame 0. Output is RENDER_PX square (270) unless px=N is given.
Options (after the positional arguments):
  hammer=1       show hammer.glb in the hands, RENDER ONLY (see add_render_hammer). Meant for swing_* clips.
  px=N           square render size, e.g. px=810 for a closer look
  view=front|side|top   use a temporary ortho camera instead of `camera` (frames the whole dwarf)
The session is never saved and nothing here is called by export_glb.py, so the hammer cannot reach dwarf.glb.
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HAMMER_LEN = 0.72  # dist/scene3d.js line 8, model units along the longest side of hammer.glb
HAMMER_NAME = 'RENDER_ONLY_hammer'

# Orientation of the hammer in the game (dist/scene3d.js 163): q = q_node(Hammer) * HAMMER_FIX, HAMMER_FIX = Rz(-90 deg) in three.js.
# Expressed in Blender: q_node = q_bone * Rx(-90) (measured from dwarf.glb node rest rotation vs the imported bone matrix,
# so the glTF node frame equals the Blender bone frame turned -90 deg about X), and Rz_three(-90) = Ry_blender(+90).
# Net, hammer.glb mesh axes (Blender space): -X (butt -> head) = bone +Y, +Z (strike face normal) = bone +X.
BONE_TO_NODE = Matrix.Rotation(-math.pi / 2, 4, 'X')
HAMMER_FIX = Matrix.Rotation(math.pi / 2, 4, 'Y')


def add_render_hammer(arm):
    """Import originals/hammer.glb and parent it to bone `Hammer` of `arm`. Returns the hammer object. Never save after this."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, 'blender', 'originals', 'hammer.glb'))
    new = [o for o in bpy.data.objects if o not in before]
    h = next(o for o in new if o.type == 'MESH')
    for o in new:
        if o is not h:
            bpy.data.objects.remove(o)
    h.name = HAMMER_NAME
    # same centring as the game: bounding-box centre of the mesh goes to the bone origin, longest side scaled to HAMMER_LEN
    pts = [Vector(c) for c in h.bound_box]
    lo = Vector((min(p[i] for p in pts) for i in range(3)))
    hi = Vector((max(p[i] for p in pts) for i in range(3)))
    centre, ext = (lo + hi) / 2, hi - lo
    k = HAMMER_LEN / max(ext)
    pose_bone, bone = arm.pose.bones['Hammer'], arm.data.bones['Hammer']
    bpy.context.view_layer.update()
    # bone parenting in Blender puts the child origin at the bone TAIL: parent_inverse maps the world pose we want
    # (bone head, game orientation) to that frame, so the hammer follows the bone through the animation.
    head_world = arm.matrix_world @ pose_bone.matrix  # bone head, with the armature's 0.01 scale in it
    rot = head_world.to_3x3().normalized().to_4x4()
    want = Matrix.Translation(head_world.translation) @ rot @ BONE_TO_NODE @ HAMMER_FIX @ Matrix.Scale(k, 4) @ Matrix.Translation(-centre)
    h.parent, h.parent_type, h.parent_bone = arm, 'BONE', 'Hammer'
    bone_parent = arm.matrix_world @ pose_bone.matrix @ Matrix.Translation((0, bone.length, 0))
    h.matrix_parent_inverse = bone_parent.inverted() @ want
    return h


def add_view_camera(view, arm_mesh):
    cam_data = bpy.data.cameras.new('tmp_view_cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 2.0
    cam = bpy.data.objects.new('tmp_view_cam', cam_data)
    bpy.context.scene.collection.objects.link(cam)
    c = Vector((0.0, 0.0, 0.65))  # about the middle of the 1.3 unit dwarf
    d = {'front': ((0, -1, 0), (math.pi / 2, 0, 0)),
         'side': ((1, 0, 0), (math.pi / 2, 0, math.pi / 2)),
         'top': ((0, 0, 1), (0, 0, 0))}[view]
    cam.location = c + Vector(d[0]) * 10
    cam.rotation_euler = d[1]
    return cam


def main():
    a = sys.argv[sys.argv.index('--') + 1:]
    pos = [x for x in a if '=' not in x]
    opt = dict(x.split('=', 1) for x in a if '=' in x)
    out = os.path.abspath(pos[0])
    cam = pos[1] if len(pos) > 1 else 'preview_cam_solo'
    act = pos[2] if len(pos) > 2 else 'swing_ready'
    frame = int(pos[3]) if len(pos) > 3 else 0
    sc = bpy.context.scene
    arm = bpy.data.objects['Armature']
    arm.animation_data.action = bpy.data.actions[act]
    arm.animation_data.action_slot = arm.animation_data.action.slots[0]
    sc.frame_set(frame)
    if opt.get('hammer') == '1':
        add_render_hammer(arm)
        sc.frame_set(frame)
    sc.camera = add_view_camera(opt['view'], None) if 'view' in opt else bpy.data.objects[cam]
    if 'px' in opt:
        sc.render.resolution_x = sc.render.resolution_y = int(opt['px'])
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'FLAT'
    sc.display.shading.color_type = 'TEXTURE'
    sc.render.film_transparent = False
    bpy.context.scene.world = bpy.data.worlds.new('w') if not bpy.context.scene.world else bpy.context.scene.world
    sc.render.filepath = out
    sc.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)
    print('RENDERED', out, 'hammer' if opt.get('hammer') == '1' else '')


if __name__ == '__main__':
    main()
