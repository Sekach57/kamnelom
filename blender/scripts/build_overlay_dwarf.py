"""Phase 1, approach 4 prototype: the ORIGINAL char1 (mesh, texture, weights, bones, rest pose, clips untouched) plus rigid overlays.

  blender -b blender/src/dwarf.blend --python blender/scripts/build_overlay_dwarf.py

Reads blender/src/dwarf.blend (never saves over it), adds ONE variant per slot as separate skinned meshes on the same armature and saves
blender/src/dwarf_overlay.blend. Idempotent: always starts from dwarf.blend. Export with the normal pipeline:

  blender -b blender/src/dwarf_overlay.blend --python blender/scripts/export_glb.py -- tmp/p4/dwarf_overlay.glb

  part_helmet_miner      100% Head                       dome + brim + crest + lamp, mat_metal, sits over char1's hair
  part_beard_long        100% Head                       a little bigger / longer than char1's beard, mat_hair
  part_shoulders_plate   100% LeftShoulder / RightShoulder   domed plate + lame per side, mat_metal

Faceted low-poly with bevels, colour only through Principled BSDF base colours (light neutral, no textures). Coordinates are written in
metres (world) and scaled to armature space (x100) like char1's own vertices. Overlay sizes come from the char1 head / shoulder
measurements (head about 0.15 wide, 0.22 deep, hair top at z 1.30, brow z 1.19, beard z 1.0 .. 1.14).
"""
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'blender', 'src', 'dwarf_overlay.blend')
arm = bpy.data.objects['Armature']
char1 = bpy.data.objects['char1']
PARENT_INV = char1.matrix_parent_inverse.copy()
arm.data.pose_position = 'REST'
bpy.context.view_layer.update()
HEADS = {b.name: Vector(arm.matrix_world @ b.head_local) for b in arm.data.bones}

MATS = {}
for name, rgb in {'mat_metal': (0.78, 0.80, 0.84), 'mat_hair': (0.85, 0.85, 0.85)}.items():
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.diffuse_color = (*rgb, 1)
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = 0.8
    MATS[name] = m


class Part:
    def __init__(self, name, bones, mat):
        self.name, self.bones, self.mat = name, list(bones), mat
        self.bm = bmesh.new()
        self.dl = self.bm.verts.layers.deform.verify()

    def _done(self, before, bone):
        new = [v for v in self.bm.verts if v not in before]
        for v in new:
            v[self.dl][self.bones.index(bone)] = 1.0
        for f in {f for v in new for f in v.link_faces}:
            f.smooth = False

    def ellipsoid(self, bone, c, r, seg=10, rings=6):
        before = set(self.bm.verts)
        res = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=rings, radius=1.0)
        bmesh.ops.transform(self.bm, matrix=Matrix.Translation(c) @ Matrix.Diagonal((*r, 1.0)), verts=res['verts'])
        self._done(before, bone)

    def box(self, bone, c, size, bevel=0.006, rot=None):
        before = set(self.bm.verts)
        res = bmesh.ops.create_cube(self.bm, size=1.0)
        bmesh.ops.transform(self.bm, matrix=Matrix.Diagonal((*size, 1.0)), verts=res['verts'])
        if bevel > 0:
            bmesh.ops.bevel(self.bm, geom=list({e for v in res['verts'] for e in v.link_edges}), offset=bevel, segments=1,
                            affect='EDGES', profile=0.5)
        verts = [v for v in self.bm.verts if v not in before]
        bmesh.ops.transform(self.bm, matrix=Matrix.Translation(c) @ (rot or Matrix.Identity(3)).to_4x4(), verts=verts)
        self._done(before, bone)

    def loft(self, bone, rings, n=12):
        """rings: (z, cx, cy, rx, ry) elliptical sections, top to bottom, closed faceted solid"""
        before = set(self.bm.verts)
        rows = [[self.bm.verts.new((cx + rx * math.cos(2 * math.pi * k / n), cy + ry * math.sin(2 * math.pi * k / n), z))
                 for k in range(n)] for z, cx, cy, rx, ry in rings]
        faces = [self.bm.faces.new(rows[0][::-1]), self.bm.faces.new(rows[-1])]
        for a, b in zip(rows, rows[1:]):
            for k in range(n):
                faces.append(self.bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k])))
        bmesh.ops.recalc_face_normals(self.bm, faces=faces)
        self._done(before, bone)

    def to_object(self):
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        bmesh.ops.transform(self.bm, matrix=Matrix.Scale(1.0 / arm.scale.x, 4), verts=self.bm.verts)  # armature space, like char1
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for p in me.polygons:
            p.use_smooth = False
        me.materials.append(MATS[self.mat])
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        for b in self.bones:
            ob.vertex_groups.new(name=b)
        ob.parent = arm
        ob.matrix_parent_inverse = PARENT_INV
        ob.modifiers.new('Armature', 'ARMATURE').object = arm
        return ob


parts = []

# helmet: faceted dome over the hair, rim above the brow (brow z 1.19, eyes 1.17), brim, crest, front lamp. Head centre (0, -0.02, 1.23).
p = Part('part_helmet_miner', ['Head'], 'mat_metal')
p.loft('Head', [
    (1.345, 0.0, -0.020, 0.030, 0.036),
    (1.325, 0.0, -0.020, 0.066, 0.080),
    (1.295, 0.0, -0.020, 0.094, 0.112),
    (1.260, 0.0, -0.020, 0.098, 0.120),
    (1.230, 0.0, -0.020, 0.102, 0.124),
    (1.222, 0.0, -0.020, 0.102, 0.124),
])
p.loft('Head', [  # brim: a flat flange, wider at the front
    (1.232, 0.0, -0.035, 0.112, 0.140),
    (1.212, 0.0, -0.035, 0.112, 0.140),
])
p.box('Head', Vector((0.0, -0.020, 1.335)), (0.026, 0.200, 0.036), bevel=0.006)  # crest
p.box('Head', Vector((0.0, -0.150, 1.270)), (0.050, 0.034, 0.044), bevel=0.007)  # lamp
p.box('Head', Vector((0.0, -0.172, 1.270)), (0.030, 0.014, 0.028), bevel=0.004)  # lamp lens
parts.append(p)

# long beard: a little wider and longer than char1's (front y -0.14, widest +-0.088, tip z 1.00); starts under the mouth (z 1.10)
p = Part('part_beard_long', ['Head'], 'mat_hair')
p.loft('Head', [
    (1.100, 0.0, -0.066, 0.086, 0.080),
    (1.065, 0.0, -0.082, 0.096, 0.080),
    (1.020, 0.0, -0.100, 0.098, 0.066),
    (0.965, 0.0, -0.112, 0.082, 0.052),
    (0.915, 0.0, -0.118, 0.056, 0.040),
    (0.865, 0.0, -0.118, 0.026, 0.026),
    (0.835, 0.0, -0.116, 0.006, 0.010),
], n=10)
parts.append(p)

# shoulder pads: a domed plate over the shoulder + a lower lame, outside char1's own pauldrons
p = Part('part_shoulders_plate', ['LeftShoulder', 'RightShoulder'], 'mat_metal')
for s, sx in (('Left', 1), ('Right', -1)):
    a = HEADS[s + 'Arm']
    p.ellipsoid(s + 'Shoulder', a + Vector((sx * 0.050, 0.012, 0.060)), (0.098, 0.088, 0.066), seg=10, rings=5)
    p.ellipsoid(s + 'Shoulder', a + Vector((sx * 0.085, 0.012, -0.010)), (0.066, 0.078, 0.050), seg=8, rings=4)
parts.append(p)

for part in parts:
    ob = part.to_object()
    print('PART', ob.name, 'verts', len(ob.data.vertices), 'tris', sum(len(q.vertices) - 2 for q in ob.data.polygons))

sc = bpy.context.scene
arm.data.pose_position = 'POSE'
arm.animation_data.action = bpy.data.actions['swing_ready']
arm.animation_data.action_slot = arm.animation_data.action.slots[0]
sc.frame_set(0)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=True)
print('SAVED', OUT)
