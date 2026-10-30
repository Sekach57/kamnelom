"""Phase 1, approach 4 with Meshy parts: the ORIGINAL char1 plus three Meshy-generated rigid parts (already generated, this script never calls Meshy).

  blender -b blender/src/dwarf.blend --python blender/scripts/build_meshy_parts.py
  blender -b blender/src/dwarf_meshy.blend --python blender/scripts/export_glb.py -- tmp/p5/dwarf_meshy.glb

Reads blender/meshy/<slot>/refine_*.glb and blender/src/dwarf.blend (neither is changed), writes blender/src/dwarf_meshy.blend. Idempotent.
For every part: import, bake the node transform into the vertices, drop stray components (found by welded vertex positions, the mesh itself
is not welded so UVs stay intact), cut, rotate / scale / place on char1 (measurements: head 0.164 x 0.274 x 0.336 m, hair top z 1.30,
brow z 1.19, mouth z ~1.11, char1 beard z 1.0-1.14), decimate to <= 1500 triangles (per side for the shoulders), shrink the texture to
256 px, skin 100% to ONE existing bone. char1, bones and clips are not touched; the Meshy texture and materials are kept (no recolouring).

  part_helmet_miner         Head                      shards below the brim removed
  part_beard_braid          Head                      only the long lower part, turned so the braids face the front, top below the mouth
  part_shoulders_leather    LeftShoulder / RightShoulder   ONE mesh with two vertex groups: left = mirror image of the right piece
"""
import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'blender', 'src', 'dwarf_meshy.blend')
MAX_TRIS = 1500
TEX_PX = 256

arm = bpy.data.objects['Armature']
char1 = bpy.data.objects['char1']
PARENT_INV = char1.matrix_parent_inverse.copy()
arm.data.pose_position = 'REST'
bpy.context.view_layer.update()
HEADS = {b.name: Vector(arm.matrix_world @ b.head_local) for b in arm.data.bones}
S_ARM = 1.0 / arm.scale.x  # metres -> armature space (char1 vertices are in centimetres)


def import_part(slot, fname):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, 'blender', 'meshy', slot, fname))
    new = [o for o in bpy.data.objects if o not in before]
    ob = next(o for o in new if o.type == 'MESH')
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.transform(bm, matrix=ob.matrix_world, verts=bm.verts)  # bake the node transform
    mat = ob.data.materials[0]
    for o in new:
        bpy.data.objects.remove(o)
    return bm, mat


def components(bm):
    """component id per vertex, welding vertices that share a position (the Meshy mesh is split along UV seams)"""
    key = {}
    parent = []

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    ids = {}
    for v in bm.verts:
        k = tuple(np.round(np.array(v.co) * 1e4).astype(int))
        if k not in key:
            key[k] = len(parent)
            parent.append(len(parent))
        ids[v.index] = key[k]
    for f in bm.faces:
        r = [find(ids[v.index]) for v in f.verts]
        for x in r[1:]:
            parent[find(x)] = find(r[0])
    return {i: find(ids[i]) for i in ids}


def drop_faces(bm, pred):
    kill = [f for f in bm.faces if pred(f)]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')


def tri_count(bm):
    return sum(len(f.verts) - 2 for f in bm.faces)


def decimate_to(bm, name, target):
    """collapse decimation through a temporary object (keeps UVs); returns a new bmesh"""
    n = tri_count(bm)
    if n <= target:
        return bm
    me = bpy.data.meshes.new(name + '_tmp')
    bm.to_mesh(me)
    ob = bpy.data.objects.new(name + '_tmp', me)
    bpy.context.scene.collection.objects.link(ob)
    mod = ob.modifiers.new('d', 'DECIMATE')
    mod.ratio = target / n * 0.98
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    out = bmesh.new()
    out.from_mesh(me2)
    bpy.data.meshes.remove(me2)
    bmesh.ops.triangulate(out, faces=out.faces)
    return out


def make_object(name, bm, bones_of_verts, mat, bones):
    """bm in metres (world); skin every vertex 100% to the bone bones_of_verts(vertex)"""
    dl = bm.verts.layers.deform.verify()
    for v in bm.verts:
        v[dl][bones.index(bones_of_verts(v))] = 1.0
    bmesh.ops.transform(bm, matrix=Matrix.Scale(S_ARM, 4), verts=bm.verts)  # armature space, like char1
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = False
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for b in bones:
        ob.vertex_groups.new(name=b)
    ob.parent = arm
    ob.matrix_parent_inverse = PARENT_INV
    ob.modifiers.new('Armature', 'ARMATURE').object = arm
    print('PART', name, 'tris', sum(len(p.vertices) - 2 for p in me.polygons), 'verts', len(me.vertices))
    return ob


def shrink_texture(mat, new_name):
    mat.name = new_name
    img = next(n.image for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE')
    img.name = new_name + '_baseColor'
    img.scale(TEX_PX, TEX_PX)
    img.file_format = 'JPEG'
    tmp = os.path.join(ROOT, 'tmp', 'p5', 'tex_' + new_name + '.jpg')  # write the small version and pack THAT, so the exporter embeds 256 px data
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    img.filepath_raw = tmp
    img.save()
    node = next(n for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE')
    small = bpy.data.images.load(tmp, check_existing=False)  # a fresh image: the old one keeps its packed 2048 px data
    small.name = new_name + '_baseColor_256'
    small.pack()
    node.image = small
    bpy.data.images.remove(img)
    img = small
    return img


def place(bm, scale, rot_z=0.0, rot_x=0.0, offset=(0, 0, 0), anchor=(0, 0, 0)):
    """scale about `anchor` (mesh units), rotate about z (and x), then move the anchor to `offset` (metres)"""
    M = Matrix.Translation(Vector(offset)) @ Matrix.Rotation(rot_z, 4, 'Z') @ Matrix.Rotation(rot_x, 4, 'X') @ Matrix.Scale(scale, 4) @ \
        Matrix.Translation(-Vector(anchor))
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)


# ------------------------------------------------------------------------------------------------------------ helmet
bm, mat = import_part('helmet_miner', 'refine_01a18dd4.glb')
# The shards are welded into the helmet surface (a single connected component), so they are found by position and by colour: the helmet is
# steel blue / white rivets / a brass lamp, the shards are brown. A face goes if it is below the brim, or brown and in the lower brim zone.
img0 = next(n.image for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE')
px = np.empty(img0.size[0] * img0.size[1] * 4, dtype=np.float32)
img0.pixels.foreach_get(px)
px = px.reshape(img0.size[1], img0.size[0], 4)
uvl = bm.loops.layers.uv.active
BRIM_BOTTOM = -0.40  # mesh units


def face_brown(f):
    u = sum(l[uvl].uv.x for l in f.loops) / len(f.loops)
    v = sum(l[uvl].uv.y for l in f.loops) / len(f.loops)
    r, g, b = px[min(img0.size[1] - 1, max(0, int(v * img0.size[1]))), min(img0.size[0] - 1, max(0, int(u * img0.size[0]))), :3]
    return r > b + 0.12 and r > g * 1.08 and g < 0.5


def helmet_shard(f):
    z = sum(v.co.z for v in f.verts) / len(f.verts)
    zlow = min(v.co.z for v in f.verts)
    rad = max(math.hypot(v.co.x, v.co.y) for v in f.verts)
    return z < BRIM_BOTTOM or (zlow < BRIM_BOTTOM + 0.12 and face_brown(f)) or (rad > 0.82 and z < -0.2)


drop_faces(bm, helmet_shard)
H_SCALE = 0.170  # brim diameter 1.56 units -> 0.24 m for a head 0.164 wide / hair 0.19 deep
place(bm, H_SCALE, offset=(0.0, -0.020, 1.200), anchor=(0.0, 0.0, BRIM_BOTTOM))
bm = decimate_to(bm, 'helmet', MAX_TRIS)
shrink_texture(mat, 'mat_meshy_helmet_miner')
make_object('part_helmet_miner', bm, lambda v: 'Head', mat, ['Head'])

# ------------------------------------------------------------------------------------------------------------ beard
bm, mat = import_part('beard_braid', 'refine_01a18dd2.glb')
CUT_Z = 0.00  # mesh units: everything above (cavity for the head, ears, top of the hair mass) is dropped
drop_faces(bm, lambda f: sum(v.co.z for v in f.verts) / len(f.verts) > CUT_Z)
ymin_front = max(v.co.y for v in bm.verts)  # the braids face +Y in the file: they are turned to the front (-Y) below
B_SCALE = 0.250
place(bm, B_SCALE, rot_z=math.pi, offset=(0.0, 0.0, 1.085), anchor=(0.0, 0.0, CUT_Z))
FRONT_Y = -0.165  # front surface of the new beard (char1's beard front is at about -0.14)
dy = FRONT_Y - min(v.co.y for v in bm.verts)
bmesh.ops.translate(bm, vec=(0, dy, 0), verts=bm.verts)
bm = decimate_to(bm, 'beard', MAX_TRIS)
shrink_texture(mat, 'mat_meshy_beard_braid')
make_object('part_beard_braid', bm, lambda v: 'Head', mat, ['Head'])

# ------------------------------------------------------------------------------------------------------------ shoulders
bm, mat = import_part('shoulders_leather', 'refine_01a18dd4.glb')
S_SCALE = 0.19
SH_CUT_Z = -0.05  # mesh units: keep the upper cup (shoulder cap), drop the lower body of the half breastplate
drop_faces(bm, lambda f: sum(v.co.z for v in f.verts) / len(f.verts) < SH_CUT_Z)
a = HEADS['RightArm']
# the strap / high end of the file piece is at -x: for the RIGHT shoulder (x < 0) it is outboard already
place(bm, S_SCALE, offset=(a.x - 0.05, a.y + 0.01, a.z + 0.00), anchor=(-0.6, 0.0, 0.1))
MID_CLEAR = -0.105  # metres: the breastplate half of the file piece would cross the chest centre and meet its mirror image; cut it off here
drop_faces(bm, lambda f: sum(v.co.x for v in f.verts) / len(f.verts) > MID_CLEAR)
bm = decimate_to(bm, 'shoulder', MAX_TRIS)
right = bm
left = bm.copy()
bmesh.ops.transform(left, matrix=Matrix.Diagonal((-1, 1, 1, 1)), verts=left.verts)
bmesh.ops.reverse_faces(left, faces=left.faces)  # mirrored copy: flip the normals back
dl_r = right.verts.layers.deform.verify()
n_r = len(right.verts)
mesh_r = bpy.data.meshes.new('sh_r')
right.to_mesh(mesh_r)
mesh_l = bpy.data.meshes.new('sh_l')
left.to_mesh(mesh_l)
joined = bmesh.new()
joined.from_mesh(mesh_r)
side = ['Right'] * len(joined.verts)
joined.from_mesh(mesh_l)
joined.verts.index_update()
side += ['Left'] * (len(joined.verts) - len(side))
joined.verts.index_update()
joined.verts.ensure_lookup_table()
shrink_texture(mat, 'mat_meshy_shoulders_leather')
make_object('part_shoulders_leather', joined, lambda v: side[v.index] + 'Shoulder', mat, ['LeftShoulder', 'RightShoulder'])
for m in (mesh_r, mesh_l):
    bpy.data.meshes.remove(m)
right.free()
left.free()

sc = bpy.context.scene
arm.data.pose_position = 'POSE'
arm.animation_data.action = bpy.data.actions['swing_ready']
arm.animation_data.action_slot = arm.animation_data.action.slots[0]
sc.frame_set(0)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=True)
print('SAVED', OUT)
