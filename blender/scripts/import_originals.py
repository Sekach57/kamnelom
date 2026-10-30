"""Phase 0: import the four original game assets into blender/src/*.blend (idempotent).

  blender -b --python blender/scripts/import_originals.py

Reads blender/originals/{dwarf,dwarf_moves,hammer,boulder}.glb, rebuilds each .blend from an empty factory scene,
and saves blender/src/<name>.blend. Running it again gives the same files (modulo file timestamps).

Every action gets a Fake User (docs/BLENDER_PIPELINE.md, section 2). The scene is 24 fps, frame range = longest action.
dwarf.blend also gets the preview cameras that copy the game cameras (see add_preview_cameras).
"""
import math
import os
import sys

import bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.dirname(__file__))
ASSETS = ['dwarf', 'dwarf_moves', 'hammer', 'boulder']

# --- game camera, copied from dist/scene3d.js (not eyeballed) -------------------------------------------------------
# line 181: camera = new THREE.OrthographicCamera(-5, 5, 3, -3, .1, 80)           -> near .1, far 80
# line 182: ELEV = opts.elev ?? (group ? .8 : .52), AZ = 0                          -> elevation in radians, azimuth 0
# line 283: V = group ? max(7.4, 8.2/aspect) : max(7.2, 6.2/aspect)                  -> visible world height (aspect 1: 7.2 solo, 8.2 group)
#           camera.top = V/2, camera.bottom = -V/2, left/right = +-V/2*aspect
# line 288: target (tx, ty) = solo (.5, .9), group (0, .2); position = target + 30 * (sin(az)cos(el), sin(el), cos(az)cos(el)); lookAt(tx, ty, 0)
# line 234: gnome scale on screen: solo 1.6, group 1.3 (Gnome model.scale = scale * look.w/h; look.w/h ~ 1 +-10%)
# BUILD (dist/build3d.js 298-299) uses solo mode with a free camera (state.el/state.az), pixelH 400; not reproduced here.
# Three.js is Y up and looks down -Z from +Z; glTF import maps three (x, y, z) -> Blender (x, -z, y).
# The .blend keeps the dwarf at scale 1 (export must not change), so the camera is expressed in MODEL units: everything / S.
GAME_CAMS = {
    #  name             elevation  V (aspect 1)  target (x, y) game units  gnome scale S
    'preview_cam_solo': dict(el=0.52, V=7.2, tx=0.5, ty=0.9, S=1.6),
    'preview_cam_group': dict(el=0.8, V=8.2, tx=0.0, ty=0.2, S=1.3),
}
RENDER_PX = 270  # square preview render; games renders ~270 px high in career (opts.pixelH), 300 in group


def add_preview_cameras():
    scene = bpy.context.scene
    cams = {}
    for name, c in GAME_CAMS.items():
        cam_data = bpy.data.cameras.new(name)
        cam_data.type = 'ORTHO'
        cam_data.sensor_fit = 'AUTO'  # square render: ortho_scale = visible height = width
        cam_data.ortho_scale = c['V'] / c['S']
        cam_data.clip_start, cam_data.clip_end = 0.1 / c['S'], 80 / c['S']
        obj = bpy.data.objects.new(name, cam_data)
        scene.collection.objects.link(obj)
        dist = 30 / c['S']
        tx, ty = c['tx'] / c['S'], c['ty'] / c['S']
        # three: pos = (tx, ty + sin(el)*30, cos(el)*30)  ->  Blender: (tx, -cos(el)*30, ty + sin(el)*30)
        obj.location = Vector((tx, -math.cos(c['el']) * dist, ty + math.sin(c['el']) * dist))
        obj.rotation_euler = (math.pi / 2 - c['el'], 0.0, 0.0)  # looks +Y and down by `el`
        # self-check: the optical axis must pass through the target (tx, 0, ty) in Blender coordinates
        bpy.context.view_layer.update()
        fwd = obj.matrix_world.to_quaternion() @ Vector((0, 0, -1))
        to_target = (Vector((tx, 0, ty)) - obj.location).normalized()
        assert (fwd - to_target).length < 1e-5, (name, fwd, to_target)
        cam_data['game_source'] = 'dist/scene3d.js lines 181-182, 283, 288; elev=%s V=%s target=(%s,%s) gnomeScale=%s' % (
            c['el'], c['V'], c['tx'], c['ty'], c['S'])
        cams[name] = obj
    scene.camera = cams['preview_cam_solo']
    scene.render.resolution_x = scene.render.resolution_y = RENDER_PX
    scene.render.resolution_percentage = 100
    return cams


def build(name):
    src = os.path.join(ROOT, 'blender', 'originals', name + '.glb')
    out = os.path.join(ROOT, 'blender', 'src', name + '.blend')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    scene = bpy.context.scene
    scene.render.fps = 24
    scene.render.fps_base = 1.0
    last = 1
    for act in bpy.data.actions:
        act.use_fake_user = True
        last = max(last, int(math.ceil(act.frame_range[1])))
    scene.frame_start, scene.frame_end = 0, last
    if name == 'dwarf':
        add_preview_cameras()
    bpy.context.preferences.filepaths.save_version = 0  # no .blend1 backup files
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
    print('SAVED', out, 'objects=%d actions=%d' % (len(bpy.data.objects), len(bpy.data.actions)))


if __name__ == '__main__':
    for n in ASSETS:
        build(n)
