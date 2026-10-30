"""Approach 4 prototype checks (char1 + overlays), same clip pipeline / hammer / depth logic as check_modular.py.

  blender -b blender/src/dwarf_overlay.blend --python blender/scripts/check_overlay.py -- intersect OUT.json [baseline]
  blender -b blender/src/dwarf_overlay.blend --python blender/scripts/check_overlay.py -- render OUT_DIR [clip ...] [baseline]
  blender -b blender/src/dwarf_overlay.blend --python blender/scripts/check_overlay.py -- portrait OUT_PREFIX

`baseline` hides the overlays: char1 alone on the same clips with the same checker. Regions are triangles of char1 grouped by the
dominant bone of their vertices (char1 is ONE welded mesh, so its own beard / hair / pauldrons stay inside the region of the bone
they are weighted to; they cannot be excluded separately). Overlays: HELMET, BEARD (the overlay), PAD_L, PAD_R.
Allowed (designed contact): the char1 triangles that touch or lie within 3 cm of an overlay in the REST pose are that overlay's seat
(helmet-head/hair, beard-head/beard/chest, pads-shoulder/upper arm/torso); overlap with the seat is ignored. Everything else involving
an overlay (any other char1 triangle, other overlays, hammer) is a violation, depth = deepest char1 vertex inside the overlay.
Char1-internal pairs are not changed by the overlays: they are measured in the baseline run; neighbouring chain pairs are excluded.
Hammer: swing_* on bone Hammer, pick-up in 'hand' mode from frame 29 (as in check_modular.py); grip pairs HAMMER-HAND/FARM excluded.
"""
import json
import os
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

# check_modular.py builds regions from every object called part_*; hide the overlays from it while it is imported
_ren = {}
for ob in list(bpy.data.objects):
    if ob.name.startswith('part_'):
        _ren[ob.name] = ob
        ob.name = 'ovl_' + ob.name
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_modular as cm  # noqa: E402
for ob in _ren.values():
    ob.name = ob.name[4:]

arm, rp = cm.arm, cm.rp
OVERLAYS = {n: bpy.data.objects[n] for n in bpy.data.objects.keys() if n.startswith('part_')}
CHAR1 = bpy.data.objects['char1']

ZONE = {'HEAD': ['neck', 'Head', 'head_end', 'headfront'], 'TORSO': ['Hips', 'Spine', 'Spine01', 'Spine02']}
for s, S in (('Left', 'L'), ('Right', 'R')):
    ZONE['UARM_' + S] = [s + 'Shoulder', s + 'Arm']
    ZONE['FARM_' + S] = [s + 'ForeArm']
    ZONE['HAND_' + S] = [s + 'Hand']
    ZONE['THIGH_' + S] = [s + 'UpLeg']
    ZONE['SHIN_' + S] = [s + 'Leg', s + 'Foot', s + 'ToeBase']
BONE_REGION = {b: r for r, bs in ZONE.items() for b in bs}
CHAR_REGIONS = list(ZONE)
OVL_REGIONS = ['HELMET', 'BEARD', 'PAD_L', 'PAD_R']

# triangle -> region for char1
me = CHAR1.data
names = {g.index: g.name for g in CHAR1.vertex_groups}
vreg = []
for v in me.vertices:
    w = {}
    for g in v.groups:
        w[names[g.group]] = w.get(names[g.group], 0) + g.weight
    b = max(w, key=w.get) if w else ''
    vreg.append(BONE_REGION.get(b, 'TORSO'))
me.calc_loop_triangles()
tv = np.zeros(len(me.loop_triangles) * 3, int)
me.loop_triangles.foreach_get('vertices', tv)
tv = tv.reshape(-1, 3)
CHAR_TRIS = {}
for ti, t in enumerate(tv):
    c = [vreg[i] for i in t]
    CHAR_TRIS.setdefault(max(set(c), key=c.count), []).append(ti)
CHAR_TRIS = {r: np.array(v) for r, v in CHAR_TRIS.items()}


def ex(a, b):
    return frozenset((a, b))


EXEMPT = {ex('HEAD', 'TORSO')}
for S in 'LR':
    EXEMPT |= {ex('TORSO', 'UARM_' + S), ex('UARM_' + S, 'FARM_' + S), ex('FARM_' + S, 'HAND_' + S), ex('TORSO', 'THIGH_' + S),
               ex('THIGH_' + S, 'SHIN_' + S), ex('TORSO', 'SHIN_' + S), ex('TORSO', 'FARM_' + S)}
GRIP = ['HAND_L', 'HAND_R', 'FARM_L', 'FARM_R']
ALLOWED = {ex('HELMET', 'HEAD'), ex('BEARD', 'HEAD'), ex('BEARD', 'TORSO'), ex('PAD_L', 'UARM_L'), ex('PAD_R', 'UARM_R'),
           ex('PAD_L', 'TORSO'), ex('PAD_R', 'TORSO')}
BASE_PAIRS = [(a, b) for i, a in enumerate(CHAR_REGIONS) for b in CHAR_REGIONS[i + 1:] if ex(a, b) not in EXEMPT]
BASE_PAIRS += [('HAMMER', r) for r in CHAR_REGIONS if r not in GRIP]
OVL_PAIRS = [(o, r) for o in OVL_REGIONS for r in CHAR_REGIONS + OVL_REGIONS if r != o and (r not in OVL_REGIONS or r > o)]
OVL_PAIRS += [('HAMMER', o) for o in OVL_REGIONS]


def region_data(with_overlays):
    out, verts_of = {}, {}

    def add(name, co, tris):
        out[name] = BVHTree.FromPolygons(co.tolist(), [tuple(int(i) for i in t) for t in tris], all_triangles=True)
        verts_of[name] = co

    co, tvv = cm.eval_world(CHAR1)
    for r, idx in CHAR_TRIS.items():
        sub = tvv[idx]
        used = np.unique(sub)
        remap = {int(u): i for i, u in enumerate(used)}
        add(r, co[used], [[remap[int(x)] for x in t] for t in sub])
    if with_overlays:
        for n, ob in OVERLAYS.items():
            co, tvv = cm.eval_world(ob)
            names_ = {g.index: g.name for g in ob.vertex_groups}
            if n == 'part_shoulders_plate':
                side = np.array([names_[max(v.groups, key=lambda g: g.weight).group].startswith('Left') for v in ob.data.vertices])
                for nm, flag in (('PAD_L', True), ('PAD_R', False)):
                    sel = np.array([side[t[0]] == flag for t in tvv])
                    sub = tvv[sel]
                    used = np.unique(sub)
                    remap = {int(u): i for i, u in enumerate(used)}
                    add(nm, co[used], [[remap[int(x)] for x in t] for t in sub])
            else:
                add('HELMET' if 'helmet' in n else 'BEARD', co, tvv)
    if cm.HAM['mode']:
        co, tvv = cm.eval_world(cm.HAM[cm.HAM['mode']])
        add('HAMMER', co, tvv)
    return out, verts_of


SEAT = {}  # overlay region -> set of global char1 triangle ids that touch / lie within SEAT_DIST of it in the REST pose (where it sits)
SEAT_DIST = 0.04
# char1 regions each overlay may sit on (BEARD also UARM: char1 weights part of the chest front to the Shoulder bones)
SEAT_REGIONS = {'HELMET': ['HEAD'], 'BEARD': ['HEAD', 'TORSO', 'UARM_L', 'UARM_R'], 'PAD_L': ['UARM_L', 'TORSO'], 'PAD_R': ['UARM_R', 'TORSO']}
TRI_REGION = {int(t): r for r, ids in CHAR_TRIS.items() for t in ids}


def compute_seats():
    arm.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    bv, _ = region_data(True)
    co, tvv = cm.eval_world(CHAR1)
    cen = co[tvv].mean(1)
    for o in OVL_REGIONS:
        ids = set()
        for ti, c in enumerate(cen):
            vv = Vector(c)
            loc, nor, _, d = bv[o].find_nearest(vv)
            if TRI_REGION.get(ti) in SEAT_REGIONS[o] and loc is not None and (d < SEAT_DIST or (vv - loc).dot(nor) < 0):
                ids.add(ti)
        SEAT[o] = ids
        print('SEAT', o, len(ids), 'of', len(tvv), 'char1 triangles')
    arm.data.pose_position = 'POSE'


def inside_depth(bv, verts):
    best = 0.0
    for v in verts:
        vv = Vector(v)
        loc, nor, _, d = bv.find_nearest(vv)
        if loc is not None and (vv - loc).dot(nor) < 0:
            best = max(best, d)
    return best


def hits_for(with_overlays, frame):
    bv, vv = region_data(with_overlays)
    res = {}
    for a, b in BASE_PAIRS:
        if a not in bv or b not in bv:
            continue
        n = len(bv[a].overlap(bv[b]))
        if n:
            d = cm.depth(bv[a], vv[a], bv[b], vv[b]) if ('HAMMER' in (a, b) or frame % 3 == 0) else None
            res[a + '|' + b] = (n, d)
    if not with_overlays:
        return res
    co, tvv = cm.eval_world(CHAR1)
    for o in OVL_REGIONS:
        if o not in bv:
            continue
        for r in CHAR_REGIONS:
            if r not in bv:
                continue
            gl = CHAR_TRIS[r]
            pairs = [(ia, ib) for ia, ib in bv[o].overlap(bv[r]) if int(gl[ib]) not in SEAT[o]]
            if pairs:
                tris = sorted({int(gl[ib]) for _, ib in pairs})
                d = max(inside_depth(bv[o], co[np.unique(tvv[tris])]), cm.depth(bv[o], vv[o], bv[r], vv[r]) if False else 0.0)
                res[o + '|' + r] = (len(pairs), d)
        for o2 in OVL_REGIONS:
            if o2 > o and o2 in bv:
                n = len(bv[o].overlap(bv[o2]))
                if n:
                    res[o + '|' + o2] = (n, cm.depth(bv[o], vv[o], bv[o2], vv[o2]))
        if 'HAMMER' in bv:
            n = len(bv['HAMMER'].overlap(bv[o]))
            if n:
                res['HAMMER|' + o] = (n, cm.depth(bv['HAMMER'], vv['HAMMER'], bv[o], vv[o]))
    return res


def cmd_intersect(out, baseline):
    cm.reset_pose()
    cm.init_hammers()
    cm.reset_pose()
    for ob in OVERLAYS.values():
        ob.hide_viewport = baseline
    report = {'mode': 'baseline (char1 only)' if baseline else 'prototype (char1 + overlays)',
              'excluded_chain_pairs': sorted('|'.join(sorted(e)) for e in EXEMPT), 'hammer_grip_excluded': GRIP,
              'allowed_overlay_pairs': sorted('|'.join(sorted(e)) for e in ALLOWED),
              'note': 'depth for char1-internal pairs is sampled every 3rd frame (counts are every frame)', 'clips': {}}
    if not baseline:
        compute_seats()
        report['seat_triangles'] = {o: len(v) for o, v in SEAT.items()}
    for clip in cm.NATIVE + cm.MOVES:
        ts = cm.clip_times(cm.clip_channels_cache[clip])
        acc = {}
        for k, t in enumerate(ts):
            cm.set_frame(clip, k, t)
            for pr, (n, d) in hits_for(not baseline, k).items():
                acc.setdefault(pr, []).append((k, n, d))
        summ = {}
        lim = cm.GAME_USED_FRAMES.get(clip)
        for pr, lst in acc.items():
            ds = [x for x in lst if x[2] is not None]
            w = max(ds, key=lambda x: x[2]) if ds else lst[0]
            a, b = pr.split('|')
            if not (a in OVL_REGIONS or b in OVL_REGIONS):
                kind = 'char1-internal'
            elif ex(a, b) in ALLOWED or ex(a, b) in {ex('BEARD', 'UARM_L'), ex('BEARD', 'UARM_R')}:
                kind = 'allowed (own seat region)'
            else:
                kind = 'VIOLATION'
            summ[pr] = {'kind': kind, 'frames': len(lst), 'first': lst[0][0], 'last': lst[-1][0], 'max_tri_pairs': max(x[1] for x in lst),
                        'max_depth_cm': round((w[2] or 0) * 100, 2), 'worst_frame': w[0],
                        'frames_in_game_range': (sum(1 for x in lst if lim[0] <= x[0] <= lim[1]) if lim else len(lst))}
        report['clips'][clip] = {'frames': len(ts), 'pairs': summ}
        print('CLIP %-24s pairs %d  violations %d' % (clip, len(summ), sum(1 for v in summ.values() if v['kind'] == 'VIOLATION')))
    json.dump(report, open(out, 'w'), indent=1)
    print('WROTE', out)


def cmd_render(outdir, only, baseline):
    sc = bpy.context.scene
    outdir = os.path.abspath(outdir)
    cm.reset_pose()
    sc.frame_set(0)
    os.makedirs(outdir, exist_ok=True)
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'TEXTURE'
    sc.display.shading.show_object_outline = False
    sc.render.film_transparent = False
    if not sc.world:
        sc.world = bpy.data.worlds.new('w')
    sc.render.image_settings.file_format = 'PNG'
    sc.render.resolution_x = sc.render.resolution_y = 540
    cams = {v: rp.add_view_camera(v, None) for v in ('front', 'side', 'top')}
    for c in cams.values():
        c.data.ortho_scale = 2.2
    cm.init_hammers()
    for ob in OVERLAYS.values():
        ob.hide_render = ob.hide_viewport = baseline
    for clip in (only or cm.NATIVE + cm.MOVES):
        ts = cm.clip_times(cm.clip_channels_cache[clip])
        kf = cm.key_frames(clip, ts)
        for i, f in enumerate(kf):
            cm.set_frame(clip, f, ts[f])
            for v, cam in cams.items():
                sc.camera = cam
                sc.render.filepath = os.path.join(outdir, '%s_%d_f%03d_%s.png' % (clip, i, f, v))
                bpy.ops.render.render(write_still=True)
        print('RENDERED', clip, kf)


if __name__ == '__main__':
    a = sys.argv[sys.argv.index('--') + 1:]
    base = 'baseline' in a
    a = [x for x in a if x != 'baseline']
    if a[0] == 'intersect':
        cmd_intersect(a[1], base)
    elif a[0] == 'render':
        cmd_render(a[1], a[2:], base)
    elif a[0] == 'portrait':
        cm.cmd_portrait(a[1])
