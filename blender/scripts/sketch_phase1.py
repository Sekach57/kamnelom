"""Phase 1 step 1: throwaway sketch renders for the modular-dwarf proposal. Rough on purpose. Never saves anything.

  blender -b blender/src/dwarf.blend --python blender/scripts/sketch_phase1.py -- cut|scratch OUT_PREFIX [action] [frame]

  cut      approach 1: copy of char1 with the head-weighted triangles deleted + a new rough head / beard / helmet on `Head`
  scratch  approach 2: everything rebuilt from low-poly primitives, rigid 100% weight per part on the existing bones
Writes OUT_PREFIX_solo.png (preview_cam_solo, 270 px), OUT_PREFIX_group.png (preview_cam_group, 270 px, Crew scale),
OUT_PREFIX_front.png (front view 700 px, for reading the design). The hammer is shown in the hands (render only, see render_preview.py).
blender/src/*.blend, dist/ and blender/originals are only read. compose_sheet.py turns the three PNGs into one sheet.
"""
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import render_preview as rp  # noqa: E402

a = sys.argv[sys.argv.index('--') + 1:]
mode, prefix = a[0], os.path.abspath(a[1])
act = a[2] if len(a) > 2 else 'swing_ready'
frame = int(a[3]) if len(a) > 3 else 0
arm = bpy.data.objects['Armature']
sc = bpy.context.scene
arm.data.pose_position = 'REST'
bpy.context.view_layer.update()


def bone_pos(name):
    return arm.matrix_world @ arm.data.bones[name].head_local


def mat(name, rgb):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED').inputs['Base Color'].default_value = (*rgb, 1)
    return m


MATS = {
    'mat_skin': mat('mat_skin', (0.86, 0.60, 0.45)),
    'mat_hair': mat('mat_hair', (0.78, 0.33, 0.12)),
    'mat_metal': mat('mat_metal', (0.62, 0.64, 0.70)),
    'mat_cloth': mat('mat_cloth', (0.36, 0.22, 0.12)),
    'mat_leather': mat('mat_leather', (0.22, 0.14, 0.09)),
}
parts = []  # (name, bone, material, bmesh)


def new_part(name, bone, matname):
    bm = bmesh.new()
    parts.append((name, bone, matname, bm))
    return bm


def ellipsoid(name, bone, matname, centre, radii, seg=10, rings=7):
    bm = new_part(name, bone, matname)
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
    bmesh.ops.scale(bm, vec=radii, verts=bm.verts)
    bmesh.ops.translate(bm, vec=centre, verts=bm.verts)
    return bm


def box(name, bone, matname, centre, size):
    bm = new_part(name, bone, matname)
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    bmesh.ops.translate(bm, vec=centre, verts=bm.verts)
    return bm


def limb(name, bone, matname, p0, p1, r0, r1, seg=8):
    """Tapered cylinder from p0 to p1 (radius r0 at p0)."""
    bm = new_part(name, bone, matname)
    d = Vector(p1) - Vector(p0)
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r0, radius2=r1, depth=d.length)
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation((Vector(p0) + Vector(p1)) / 2) @ rot, verts=bm.verts)
    return bm


def build_head_parts():
    """Rough replacement head for approach 1 and 2 (identical on purpose, so the sketches differ only in the body)."""
    hc = Vector((0, 0.03, 1.14))
    limb('neck', 'neck', 'mat_skin', (0, 0.05, 1.0), (0, 0.05, 1.10), 0.06, 0.055)
    ellipsoid('head', 'Head', 'mat_skin', hc, (0.125, 0.13, 0.13))  # a bit bigger than life, per the spec
    box('nose', 'Head', 'mat_skin', hc + Vector((0, -0.14, -0.02)), (0.035, 0.05, 0.06))
    for sx in (-1, 1):
        box('eye%d' % sx, 'Head', 'mat_leather', hc + Vector((sx * 0.045, -0.125, 0.02)), (0.025, 0.02, 0.02))
    ellipsoid('brow', 'Head', 'mat_hair', hc + Vector((0, -0.115, 0.05)), (0.105, 0.03, 0.02))
    # beard: wedge from the cheeks down to the belt, flattened front to back
    bm = limb('beard', 'Head', 'mat_hair', hc + Vector((0, -0.08, -0.34)), hc + Vector((0, -0.09, -0.07)), 0.015, 0.13)
    bmesh.ops.scale(bm, vec=(1.0, 0.55, 1.0), verts=bm.verts, space=Matrix.Translation(-(hc + Vector((0, -0.09, -0.2)))))
    # helmet: dome + brim + spike (sits above the brows so the face stays readable)
    ellipsoid('helmet_dome', 'Head', 'mat_metal', hc + Vector((0, 0.035, 0.075)), (0.14, 0.145, 0.10), rings=6)
    limb('helmet_brim', 'Head', 'mat_metal', hc + Vector((0, 0.0, 0.075)), hc + Vector((0, 0.0, 0.095)), 0.17, 0.15, seg=12)
    limb('helmet_spike', 'Head', 'mat_metal', hc + Vector((0, 0.035, 0.16)), hc + Vector((0, 0.035, 0.24)), 0.03, 0.005)


def build_body_parts():
    P = bone_pos
    box('pelvis', 'Hips', 'mat_cloth', (0, 0.02, 0.70), (0.31, 0.22, 0.17))
    box('apron', 'Hips', 'mat_leather', (0, -0.075, 0.55), (0.24, 0.03, 0.36))
    ellipsoid('belly', 'Spine02', 'mat_metal', (0, -0.015, 0.84), (0.17, 0.15, 0.12))
    ellipsoid('chest', 'Spine', 'mat_metal', (0, 0.02, 0.98), (0.17, 0.13, 0.11))
    for s, side in (('Left', 1), ('Right', -1)):
        ellipsoid(s + 'Pauldron', s + 'Shoulder', 'mat_metal', (side * 0.175, 0.04, 1.05), (0.085, 0.085, 0.07))
        limb(s + 'UpperArm', s + 'Arm', 'mat_skin', P(s + 'Arm'), P(s + 'ForeArm'), 0.055, 0.047)
        limb(s + 'ForeArm', s + 'ForeArm', 'mat_leather', P(s + 'ForeArm'), P(s + 'Hand'), 0.05, 0.042)
        d = (P(s + 'Hand') - P(s + 'ForeArm')).normalized()
        ellipsoid(s + 'Fist', s + 'Hand', 'mat_metal', P(s + 'Hand') + d * 0.045, (0.055, 0.055, 0.055), seg=8, rings=5)
        limb(s + 'Thigh', s + 'UpLeg', 'mat_cloth', P(s + 'UpLeg'), P(s + 'Leg'), 0.085, 0.065)
        limb(s + 'Shin', s + 'Leg', 'mat_metal', P(s + 'Leg'), P(s + 'Foot'), 0.07, 0.055)
        f = P(s + 'Foot')
        box(s + 'Boot', s + 'Foot', 'mat_leather', (f.x + 0.015 * side, f.y - 0.04, 0.06), (0.11, 0.2, 0.12))
        box(s + 'BootCap', s + 'ToeBase', 'mat_leather', (P(s + 'ToeBase').x, P(s + 'ToeBase').y - 0.03, 0.04), (0.11, 0.1, 0.08))


def commit_parts(tag):
    objs = []
    for name, bone, matname, bm in parts:
        me = bpy.data.meshes.new('sk_' + name)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new('sk_%s_%s' % (tag, name), me)
        sc.collection.objects.link(ob)
        me.materials.append(MATS[matname])
        for p in me.polygons:
            p.use_smooth = False
        vg = ob.vertex_groups.new(name=bone)
        vg.add(list(range(len(me.vertices))), 1.0, 'REPLACE')  # 100% on one of the 24 existing bones
        m = ob.modifiers.new('Armature', 'ARMATURE')
        m.object = arm
        objs.append(ob)
    return objs


ZONES = {'head': ['neck', 'Head', 'head_end', 'headfront']}
if mode == 'cut':
    # delete every triangle of char1 whose vertices are mostly head-zone weighted (the same rule the analysis uses)
    ob = bpy.data.objects['char1']
    names = {g.index: g.name for g in ob.vertex_groups}
    me = ob.data
    zone = ZONES['head']
    is_head = np.zeros(len(me.vertices), dtype=bool)
    for v in me.vertices:
        s = {}
        for g in v.groups:
            s[names[g.group]] = s.get(names[g.group], 0) + g.weight
        if s and sum(w for n, w in s.items() if n in zone) > 0.5:
            is_head[v.index] = True
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    kill = [f for f in bm.faces if sum(is_head[v.index] for v in f.verts) >= 2]
    n0 = len(bm.faces)
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(me)
    bm.free()
    print('CUT: removed %d of %d faces' % (len(kill), n0))
    build_head_parts()
else:
    ob = bpy.data.objects['char1']
    ob.hide_render = True
    ob.hide_viewport = True
    build_body_parts()
    build_head_parts()
commit_parts(mode)

# pose, hammer, render
arm.data.pose_position = 'POSE'
arm.animation_data.action = bpy.data.actions[act]
arm.animation_data.action_slot = arm.animation_data.action.slots[0]
sc.frame_set(frame)
rp.add_render_hammer(arm)
sc.frame_set(frame)
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'TEXTURE'
sc.display.shading.show_object_outline = True
sc.render.film_transparent = False
if not sc.world:
    sc.world = bpy.data.worlds.new('w')
sc.render.image_settings.file_format = 'PNG'


def render(path, cam, px=270):
    sc.camera = cam
    sc.render.resolution_x = sc.render.resolution_y = px
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('RENDERED', path)


render(prefix + '_solo.png', bpy.data.objects['preview_cam_solo'])
render(prefix + '_group.png', bpy.data.objects['preview_cam_group'])
render(prefix + '_front.png', rp.add_view_camera('front', None), 700)
