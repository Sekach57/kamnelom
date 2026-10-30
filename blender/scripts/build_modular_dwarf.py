"""Phase 1 step 2: the modular dwarf, ONE variant per slot, modelled from scratch as flat-shaded low-poly (approach 2).

  blender -b blender/src/dwarf.blend --python blender/scripts/build_modular_dwarf.py

Reads blender/src/dwarf.blend (never saves over it), drops the Meshy mesh `char1` and its 2048 px texture, builds the parts below as
separate skinned meshes on the SAME armature and saves blender/src/dwarf_modular.blend. The script is idempotent: it always starts from
dwarf.blend and rewrites dwarf_modular.blend. Export afterwards with the normal pipeline:

  blender -b blender/src/dwarf_modular.blend --python blender/scripts/export_glb.py -- tmp/p1/dwarf_modular.glb

Rules kept: the 24 bones + Hammer are not touched (no new, renamed or moved bones, rest pose unchanged); every vertex has weight 1.0
on exactly one of the existing bones (rigid parts; joints are covered by overlapping balls, cuffs and plates). Colours only through
Principled BSDF base colours (no textures, no vertex colours).

Slots (object name = part_<slot>_<variant>):
  head    part_head_round        Head                      face: skull, jaw, nose, brow, eyes, ears
  beard   part_beard_long        Head
  helmet  part_helmet_none       Head                      "no helmet, just hair" (mat_hair), so hair colours work
  torso   part_torso_plate       neck/Spine/Spine01/Hips   neck, chest plate, belly plate, collar, belt
  boots   part_boots_leather     Foot/ToeBase
  shoulders part_shoulders_plate Left/RightShoulder
  gloves  part_gloves_fist       Left/RightHand            fist, no fingers
Fixed base layers (not swappable slots, a body needs them): part_arms_base (sleeves + forearms), part_legs_base (pelvis + trousers).
"""
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'blender', 'src', 'dwarf_modular.blend')

arm = bpy.data.objects['Armature']
char1 = bpy.data.objects['char1']
PARENT_INV = char1.matrix_parent_inverse.copy()
arm.data.pose_position = 'REST'
bpy.context.view_layer.update()
BONES = [b.name for b in arm.data.bones]
BONE_HEADS = {b.name: Vector(arm.matrix_world @ b.head_local) for b in arm.data.bones}


def P(name):
    return BONE_HEADS[name].copy()


# ---------------------------------------------------------------------------------------------------------------- materials
# base colours are LINEAR values (what glTF stores). The game multiplies material.color by a tint, so skin / hair / metal are light and
# neutral on purpose; cloth, leather and eye are plain mid / dark colours.
MATERIALS = {
    'mat_skin': (0.93, 0.72, 0.60),
    'mat_hair': (0.85, 0.85, 0.85),
    'mat_metal': (0.78, 0.80, 0.84),
    'mat_cloth': (0.80, 0.76, 0.70),
    'mat_leather': (0.07, 0.04, 0.022),
    'mat_eye': (0.015, 0.012, 0.012),
}

# remove the Meshy mesh, its material and the texture so nothing of it can reach the export
mesh_old = char1.data
bpy.data.objects.remove(char1, do_unlink=True)
bpy.data.meshes.remove(mesh_old)
for m in list(bpy.data.materials):
    bpy.data.materials.remove(m)
for im in list(bpy.data.images):
    bpy.data.images.remove(im)

MATS = {}
for name, rgb in MATERIALS.items():
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.diffuse_color = (*rgb, 1)  # viewport / Workbench only
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = 0.8
    MATS[name] = m


# ---------------------------------------------------------------------------------------------------------------- builders
class Part:
    def __init__(self, name, bones, mats):
        self.name, self.bones, self.mats = name, list(bones), list(mats)
        self.bm = bmesh.new()
        self.dl = self.bm.verts.layers.deform.verify()
        self.tl = self.bm.verts.layers.int.new('piece')  # piece id, only used by the intersection check (not exported: no '_' prefix)
        self.tags = {}

    def _done(self, before, bone, mat, tag=None):
        new = [v for v in self.bm.verts if v not in before]
        gi = self.bones.index(bone)
        tid = self.tags.setdefault(tag or bone, len(self.tags) + 1)
        for v in new:
            v[self.dl][gi] = 1.0
            v[self.tl] = tid
        mi = self.mats.index(mat)
        for f in {f for v in new for f in v.link_faces}:
            f.material_index = mi
            f.smooth = False

    def ellipsoid(self, bone, mat, c, r, seg=10, rings=6, rot=None, tag=None):
        before = set(self.bm.verts)
        res = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=rings, radius=1.0)
        S = Matrix.Diagonal((*r, 1.0))
        R = (rot or Matrix.Identity(3)).to_4x4()
        bmesh.ops.transform(self.bm, matrix=Matrix.Translation(c) @ R @ S, verts=res['verts'])
        self._done(before, bone, mat, tag)

    def box(self, bone, mat, c, size, bevel=0.008, rot=None, tag=None):
        """size = (x, y, z) extents; rot = 3x3 rotation applied about the centre."""
        before = set(self.bm.verts)
        res = bmesh.ops.create_cube(self.bm, size=1.0)
        bmesh.ops.transform(self.bm, matrix=Matrix.Diagonal((*size, 1.0)), verts=res['verts'])
        if bevel > 0:
            edges = list({e for v in res['verts'] for e in v.link_edges})
            bmesh.ops.bevel(self.bm, geom=edges, offset=bevel, segments=1, affect='EDGES', profile=0.5)
        verts = [v for v in self.bm.verts if v not in before]
        R = (rot or Matrix.Identity(3)).to_4x4()
        bmesh.ops.transform(self.bm, matrix=Matrix.Translation(c) @ R, verts=verts)
        self._done(before, bone, mat, tag)

    def frustum(self, bone, mat, p0, p1, r0, r1, seg=8, tag=None, ysc=1.0):
        before = set(self.bm.verts)
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        res = bmesh.ops.create_cone(self.bm, cap_ends=True, segments=seg, radius1=r0, radius2=r1, depth=d.length)
        rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
        bmesh.ops.transform(self.bm, matrix=Matrix.Translation((p0 + p1) / 2) @ rot @ Matrix.Diagonal((1.0, ysc, 1.0, 1.0)), verts=res['verts'])
        self._done(before, bone, mat, tag)

    def loft(self, bone, mat, rings, n=8, tag=None):
        """rings: list of (z, cx, cy, rx, ry) elliptical cross sections, top to bottom, joined into a closed faceted solid."""
        before = set(self.bm.verts)
        rows = []
        for z, cx, cy, rx, ry in rings:
            rows.append([self.bm.verts.new((cx + rx * math.cos(2 * math.pi * k / n), cy + ry * math.sin(2 * math.pi * k / n), z))
                         for k in range(n)])
        faces = [self.bm.faces.new(rows[0][::-1]), self.bm.faces.new(rows[-1])]
        for a, b in zip(rows, rows[1:]):
            for k in range(n):
                faces.append(self.bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k])))
        bmesh.ops.recalc_face_normals(self.bm, faces=faces)
        self._done(before, bone, mat, tag)

    def to_object(self):
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        if self.bones == ['Head']:  # head, beard and hair ride a little higher on the neck: more room to the shoulders when the head tips
            bmesh.ops.translate(self.bm, vec=(0, 0, HEAD_UP), verts=self.bm.verts)
        # parts are modelled in metres (world units). The armature object has scale 0.01 and char1 had an identity parent inverse,
        # so its vertices live in armature space (centimetres): scale up so the new parts follow the same convention.
        bmesh.ops.transform(self.bm, matrix=Matrix.Scale(1.0 / arm.scale.x, 4), verts=self.bm.verts)
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for p in me.polygons:
            p.use_smooth = False
        for mn in self.mats:
            me.materials.append(MATS[mn])
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        for b in self.bones:  # same order as the deform layer indices
            ob.vertex_groups.new(name=b)
        ob.parent = arm
        ob.matrix_parent_inverse = PARENT_INV
        ob['piece_tags'] = {str(v): k for k, v in self.tags.items()}
        mod = ob.modifiers.new('Armature', 'ARMATURE')
        mod.object = arm
        return ob


def yaw_rot(d):
    """Rotation about Z that turns local +Y into the horizontal direction d."""
    return Matrix.Rotation(math.atan2(-d.x, d.y), 3, 'Z')


def align_rot(d, local=(0, 0, 1)):
    return Vector(local).rotation_difference(Vector(d).normalized()).to_matrix()


parts = []
HEAD_UP = 0.018

# ---------------------------------------------------------------------------------------------------------------- head
HC = Vector((0.0, -0.005, 1.150))  # head centre; a little over-sized per the spec
p = Part('part_head_round', ['Head'], ['mat_skin', 'mat_hair', 'mat_eye'])
p.ellipsoid('Head', 'mat_skin', HC, (0.076, 0.110, 0.108), seg=10, rings=7)  # skull
p.ellipsoid('Head', 'mat_skin', HC + Vector((0, -0.025, -0.055)), (0.070, 0.088, 0.066), seg=10, rings=5)  # jaw / cheeks
p.box('Head', 'mat_skin', HC + Vector((0, -0.132, -0.012)), (0.036, 0.052, 0.062), bevel=0.007)  # nose
p.box('Head', 'mat_hair', HC + Vector((0, -0.116, 0.030)), (0.150, 0.034, 0.026), bevel=0.006)  # brow ridge
for sx in (-1, 1):
    p.box('Head', 'mat_eye', HC + Vector((sx * 0.036, -0.114, 0.008)), (0.022, 0.024, 0.020), bevel=0.003)
    p.box('Head', 'mat_skin', HC + Vector((sx * 0.075, 0.0, -0.01)), (0.016, 0.030, 0.050), bevel=0.005)  # ears
parts.append(p)

# ---------------------------------------------------------------------------------------------------------------- beard
p = Part('part_beard_long', ['Head'], ['mat_hair'])
p.loft('Head', 'mat_hair', [
    (1.100, 0.0, -0.060, 0.074, 0.060),
    (1.060, 0.0, -0.086, 0.072, 0.058),
    (1.010, 0.0, -0.126, 0.068, 0.036),
    (0.985, 0.0, -0.131, 0.050, 0.030),
    (0.962, 0.0, -0.131, 0.026, 0.022),
    (0.945, 0.0, -0.128, 0.008, 0.010),
])
for sx in (-1, 1):  # moustache
    p.box('Head', 'mat_hair', Vector((sx * 0.034, -0.133, 1.103)), (0.052, 0.030, 0.026), bevel=0.005,
          rot=Matrix.Rotation(sx * 0.35, 3, 'Y'))
parts.append(p)

# ---------------------------------------------------------------------------------------------------------------- helmet slot: "no helmet, hair"
p = Part('part_helmet_none', ['Head'], ['mat_hair'])
p.ellipsoid('Head', 'mat_hair', Vector((0.0, 0.010, 1.186)), (0.084, 0.106, 0.104), seg=10, rings=6)  # cap of hair
p.ellipsoid('Head', 'mat_hair', Vector((0.0, 0.070, 1.120)), (0.084, 0.060, 0.088), seg=10, rings=5)  # back and nape
for sx in (-1, 1):
    p.box('Head', 'mat_hair', Vector((sx * 0.066, 0.020, 1.160)), (0.030, 0.100, 0.090), bevel=0.005)  # sideburns above the ears
p.box('Head', 'mat_hair', Vector((0.0, -0.095, 1.262)), (0.080, 0.080, 0.034), bevel=0.008, rot=Matrix.Rotation(0.3, 3, 'X'))  # fringe tuft
parts.append(p)

# ---------------------------------------------------------------------------------------------------------------- torso (armour slot)
p = Part('part_torso_plate', ['neck', 'Spine', 'Spine01', 'Hips'], ['mat_skin', 'mat_metal', 'mat_leather'])
# The swing / squat clips hold both fists and forearms in front of the belt, so the body is shallow in front-to-back and sits
# BEHIND the bone line: the front face is at y ~ 0 (bones are at y 0.00 .. 0.05, the fists at y -0.07 .. -0.15).
p.frustum('neck', 'mat_skin', Vector((0.0, 0.020, 1.000)), Vector((0.0, 0.020, 1.085)), 0.068, 0.064, seg=8, tag='neck')  # short, thick neck
p.ellipsoid('Spine', 'mat_metal', Vector((0.0, 0.020, 0.925)), (0.140, 0.170, 0.092), seg=10, rings=6, tag='chest')  # chest plate
p.frustum('Spine', 'mat_metal', Vector((0.0, 0.025, 1.015)), Vector((0.0, 0.025, 1.050)), 0.105, 0.070, seg=10, tag='neck')  # collar
p.ellipsoid('Spine01', 'mat_metal', Vector((0.0, 0.010, 0.805)), (0.182, 0.185, 0.085), seg=10, rings=6, tag='belly')  # belly plate
p.frustum('Hips', 'mat_leather', Vector((0.0, 0.025, 0.722)), Vector((0.0, 0.025, 0.768)), 0.190, 0.190, seg=12, tag='belt', ysc=0.85)  # belt
p.box('Hips', 'mat_metal', Vector((0.0, -0.140, 0.745)), (0.060, 0.022, 0.050), bevel=0.005, tag='belt')  # buckle
parts.append(p)

# ---------------------------------------------------------------------------------------------------------------- fixed base layers
p = Part('part_arms_base', ['LeftArm', 'LeftForeArm', 'RightArm', 'RightForeArm'], ['mat_cloth', 'mat_skin'])
for s in ('Left', 'Right'):
    a, f, h = P(s + 'Arm'), P(s + 'ForeArm'), P(s + 'Hand')
    p.ellipsoid(s + 'Arm', 'mat_cloth', a, (0.080,) * 3, seg=8, rings=5)  # shoulder ball (covered by the pad)
    p.frustum(s + 'Arm', 'mat_cloth', a, f, 0.088, 0.138, seg=8)  # sleeve
    p.ellipsoid(s + 'Arm', 'mat_cloth', f, (0.108,) * 3, seg=8, rings=5)  # elbow ball
    p.ellipsoid(s + 'ForeArm', 'mat_skin', f, (0.098,) * 3, seg=8, rings=5)
    p.frustum(s + 'ForeArm', 'mat_skin', f, h, 0.098, 0.084, seg=8)  # bare forearm
parts.append(p)

p = Part('part_legs_base', ['Hips', 'LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'RightLeg'], ['mat_cloth'])
p.ellipsoid('Hips', 'mat_cloth', Vector((0.0, 0.030, 0.690)), (0.240, 0.150, 0.085), seg=10, rings=6, tag='pelvis')
BACK = Vector((0.0, 0.035, 0.0))
for s in ('Left', 'Right'):
    u, k, f = P(s + 'UpLeg') + BACK, P(s + 'Leg') + BACK * 0.5, P(s + 'Foot')
    p.ellipsoid(s + 'UpLeg', 'mat_cloth', u, (0.108,) * 3, seg=8, rings=5)  # hip ball
    p.frustum(s + 'UpLeg', 'mat_cloth', u, k, 0.108, 0.096, seg=8)  # thigh
    p.ellipsoid(s + 'UpLeg', 'mat_cloth', k, (0.096,) * 3, seg=8, rings=5)  # knee ball
    p.ellipsoid(s + 'Leg', 'mat_cloth', k, (0.096,) * 3, seg=8, rings=5)
    p.frustum(s + 'Leg', 'mat_cloth', k, f, 0.096, 0.076, seg=8)  # shin
parts.append(p)

# ---------------------------------------------------------------------------------------------------------------- boots
p = Part('part_boots_leather', ['LeftFoot', 'LeftToeBase', 'RightFoot', 'RightToeBase'], ['mat_leather'])
for s in ('Left', 'Right'):
    k, f, t = P(s + 'Leg'), P(s + 'Foot'), P(s + 'ToeBase')
    sd = (f - k).normalized()
    p.frustum(s + 'Foot', 'mat_leather', f + sd * 0.040, f + sd * 0.008, 0.078, 0.074, seg=8)  # ankle cuff
    fd = Vector((t.x - f.x, t.y - f.y, 0.0)).normalized()
    heel = Vector((f.x, f.y, 0.0)) - fd * 0.050
    mid = heel + fd * 0.070
    p.box(s + 'Foot', 'mat_leather', Vector((mid.x, mid.y, 0.050)), (0.084, 0.114, 0.100), bevel=0.010, rot=yaw_rot(fd))
    tc = Vector((t.x, t.y, 0.0)) + fd * 0.012
    p.box(s + 'ToeBase', 'mat_leather', Vector((tc.x, tc.y, 0.036)), (0.082, 0.062, 0.072), bevel=0.010, rot=yaw_rot(fd))
parts.append(p)

# ---------------------------------------------------------------------------------------------------------------- shoulder pads
p = Part('part_shoulders_plate', ['LeftShoulder', 'RightShoulder'], ['mat_metal'])
for s, sx in (('Left', 1), ('Right', -1)):
    a = P(s + 'Arm')
    p.ellipsoid(s + 'Shoulder', 'mat_metal', a + Vector((sx * 0.030, 0.004, 0.004)), (0.056, 0.058, 0.040), seg=10, rings=5)
    p.ellipsoid(s + 'Shoulder', 'mat_metal', a + Vector((sx * 0.046, 0.004, -0.018)), (0.044, 0.050, 0.036), seg=8, rings=4)  # lower lame
parts.append(p)

# ---------------------------------------------------------------------------------------------------------------- gloves (fist, no fingers)
p = Part('part_gloves_fist', ['LeftHand', 'RightHand'], ['mat_leather'])
for s in ('Left', 'Right'):
    f, h = P(s + 'ForeArm'), P(s + 'Hand')
    d = (h - f).normalized()
    p.frustum(s + 'Hand', 'mat_leather', h - d * 0.018, h + d * 0.010, 0.058, 0.056, seg=8)  # cuff over the wrist
    p.box(s + 'Hand', 'mat_leather', h + d * 0.036, (0.082, 0.088, 0.088), bevel=0.012, rot=align_rot(d, (0, 0, 1)))  # fist
parts.append(p)

# ---------------------------------------------------------------------------------------------------------------- commit
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
