"""New game hammer: hard, faceted low-poly sledge, built with bpy only (no generation, no textures). Idempotent.

  blender -b --python blender/scripts/build_hammer.py                 # builds blender/src/hammer_new.blend and exports tmp/hammer_new/hammer.glb
  blender -b blender/src/hammer_new.blend --python blender/scripts/build_hammer.py -- render OUT_DIR   # renders for hammer_sheet.py

Axes: modelled directly in the convention of the OLD hammer.glb (measured on its Blender import): mesh -X runs from the butt of the handle
to the head, the strike axis is mesh +/-Z (strike-face normal), mesh Y is the thin side. After the glTF Y-up conversion (x, y, z) -> (x, z, -y)
that is: handle along glTF X (head at -X), strike axis along glTF Y (the old file has its 1.18 wide head on glTF Y too), thin side on glTF Z.
dist/scene3d.js placeHammer() is fitted to that orientation, so the new file is drop-in. The code scales the bounding box's longest side to
HAMMER_LEN (0.72) and centres the box, so everything here is built at 0.72 already: the handle (the longest part) sets the box, centred on 0.

Parts (metres == model units, handle length 0.72, nothing sticks out past the handle ends):
  mat_wood        octagonal handle, diameter 0.035, x -0.356 .. +0.36
  mat_steel       head 0.11 (along the handle) x 0.22 (strike axis) x 0.11, chamfered, centre x = -0.26
  mat_steel_face  the two end faces of the head (the strike faces), lighter
  mat_iron        two bands on the handle at the head and a wedge in the top end (x -0.36 .. -0.348)
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BLEND = os.path.join(ROOT, 'blender', 'src', 'hammer_new.blend')
GLB = os.path.join(ROOT, 'tmp', 'hammer_new', 'hammer.glb')

LEN = 0.72
R_HANDLE = 0.0175
X_TOP, X_BUTT = -LEN / 2, LEN / 2
HEAD_X, HEAD_LEN, HEAD_W, HEAD_T = -0.26, 0.11, 0.22, 0.11  # centre along the handle, size along handle / strike axis / thin side
MATS = {  # name: (base colour, roughness)
    'mat_steel': ((0.16, 0.17, 0.20, 1), 0.55),
    'mat_steel_face': ((0.66, 0.68, 0.72, 1), 0.45),
    'mat_iron': ((0.07, 0.07, 0.08, 1), 0.6),
    'mat_wood': ((0.50, 0.30, 0.13, 1), 0.8),
}
ORDER = ['mat_steel', 'mat_steel_face', 'mat_iron', 'mat_wood']


def make_materials():
    out = []
    for name in ORDER:
        col, rough = MATS[name]
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        bsdf.inputs['Base Color'].default_value = col
        bsdf.inputs['Metallic'].default_value = 0.0  # the game has no environment map: metallic surfaces would render black
        bsdf.inputs['Roughness'].default_value = rough
        m.diffuse_color = col  # Workbench preview colour
        out.append(m)
    return out


def along_x(bm, verts, x):
    """cylinder made along Z -> along X, centred at x"""
    bmesh.ops.rotate(bm, verts=verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, 'Y'))
    bmesh.ops.translate(bm, verts=verts, vec=(x, 0, 0))


def build_mesh():
    bm = bmesh.new()
    seen = set()

    def new_faces():
        fs = [f for f in bm.faces if f not in seen]
        seen.update(fs)
        return fs

    # handle (wood)
    top = -0.356
    r = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=8, radius1=R_HANDLE, radius2=R_HANDLE, depth=X_BUTT - top)
    along_x(bm, r['verts'], (X_BUTT + top) / 2)
    for f in new_faces():
        f.material_index = 3
    # head (steel + lighter strike faces), chamfered
    r = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, verts=r['verts'], vec=(HEAD_LEN, HEAD_T, HEAD_W))
    bmesh.ops.translate(bm, verts=r['verts'], vec=(HEAD_X, 0, 0))
    edges = list({e for v in r['verts'] for e in v.link_edges})
    bmesh.ops.bevel(bm, geom=edges, offset=0.010, segments=1, affect='EDGES')
    for f in new_faces():
        f.normal_update()
        f.material_index = 1 if abs(f.normal.z) > 0.99 else 0
    # bands on the handle at the head (iron)
    for x in (HEAD_X + HEAD_LEN / 2 + 0.014, HEAD_X - HEAD_LEN / 2 - 0.014):
        r = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=8, radius1=0.028, radius2=0.028, depth=0.02)
        along_x(bm, r['verts'], x)
        for f in new_faces():
            f.material_index = 2
    # wedge in the top end (iron), flush with the handle end
    r = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, verts=r['verts'], vec=(0.012, 0.008, 0.030))
    bmesh.ops.translate(bm, verts=r['verts'], vec=(-LEN / 2 + 0.006, 0, 0))
    for f in new_faces():
        f.material_index = 2
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('hammer')
    bm.to_mesh(me)
    bm.free()
    for m in make_materials():
        me.materials.append(m)
    for p in me.polygons:
        p.use_smooth = False
    return me


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    me = build_mesh()
    ob = bpy.data.objects.new('hammer', me)
    bpy.context.scene.collection.objects.link(ob)
    xs = [v.co.x for v in me.vertices]
    assert abs(min(xs) + LEN / 2) < 1e-6 and abs(max(xs) - LEN / 2) < 1e-6, (min(xs), max(xs))  # the handle sets the box, centred
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=BLEND, compress=True)
    os.makedirs(os.path.dirname(GLB), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=GLB, export_format='GLB', export_yup=True, export_apply=True, export_animations=False,
                              export_cameras=False, export_lights=False, export_skins=False, export_extras=False)
    print('BUILT', BLEND, 'EXPORTED', GLB, os.path.getsize(GLB), 'tris', sum(len(p.vertices) - 2 for p in me.polygons))


def render(outdir):
    """upright hammer (handle vertical, head on top: mesh -X -> world +Z, strike normal -> world +X); 4 views for hammer_sheet.py"""
    outdir = os.path.abspath(outdir)
    os.makedirs(outdir, exist_ok=True)
    sc = bpy.context.scene
    ob = bpy.data.objects['hammer']
    ob.rotation_euler = (0, math.radians(90), 0)
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'MATERIAL'
    sc.display.shading.show_object_outline = False
    sc.render.film_transparent = False
    sc.render.resolution_x = sc.render.resolution_y = 540
    sc.render.image_settings.file_format = 'PNG'
    w = bpy.data.worlds.new('w')
    w.color = (0.30, 0.30, 0.32)
    sc.world = w
    sc.display.shading.background_type = 'WORLD'
    cd = bpy.data.cameras.new('c')
    cd.type = 'ORTHO'
    cd.ortho_scale = 0.9
    cam = bpy.data.objects.new('c', cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    views = {  # name: (camera location, euler, extra roll of the hammer about the view axis)
        'front': ((10, 0, 0), (math.pi / 2, 0, math.pi / 2), 0),   # looks along -X: down the strike-face normal
        'side': ((0, -10, 0), (math.pi / 2, 0, 0), 0),             # looks along +Y
        'top': ((0, 0, 10), (0, 0, 0), 0),                         # looks down onto the head
        'tilt': ((10, 0, 0), (math.pi / 2, 0, math.pi / 2), 38),   # front view rolled like the hammer in the game
    }
    for name, (loc, eul, roll) in views.items():
        cam.location, cam.rotation_euler = loc, eul
        ob.rotation_euler = (math.radians(roll), math.radians(90), 0) if roll else (0, math.radians(90), 0)
        sc.render.filepath = os.path.join(outdir, 'hammer_%s.png' % name)
        bpy.ops.render.render(write_still=True)
        print('RENDERED', name)


if __name__ == '__main__':
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if a and a[0] == 'render':
        render(a[1])
    else:
        build()
