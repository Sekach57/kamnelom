"""Stage 1 checks for the new swing clips, run on blender/src/dwarf_swing.blend (inspection only, nothing is saved).

  blender -b blender/src/dwarf_swing.blend --python blender/scripts/swing_check.py -- render OUT_DIR [frames,...]
  blender -b blender/src/dwarf_swing.blend --python blender/scripts/swing_check.py -- clip OUT.json [frames,...]
  blender -b blender/src/dwarf_swing.blend --python blender/scripts/swing_check.py -- numbers OUT.json

render:  swing_hit key frames + OLD swing_hit_v1 frame 12, front / side / top, 540 px Workbench, hammer attached for render only.
clip:    "clipping map": per key frame, pairs of body zones (and the hammer) whose triangles overlap, with the deepest vertex in cm.
         Zones = char1 triangles grouped by the dominant bone of their vertices (as check_overlay.py). Excluded: chain pairs that touch
         by design (HEAD|TORSO, UARM|FARM, FARM|HAND, TORSO|THIGH, THIGH|SHIN, TORSO|SHIN, all same side) and the hammer against
         HAND / FARM (the grip). UARM|TORSO, FARM|TORSO, FARM|HEAD, HAND|HEAD, HAND_L|HAND_R are checked. char1 weights are blurred, so
         depths between neighbouring zones are noisy: every pair is also measured in the REST pose (baseline) and in the old
         swing_ready frame 0; compare with those, not with zero.
numbers: hammer head world position old vs new, rebound rise, Hips / feet drift, frame 0 vs 48 angle, bone list.
"""
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import render_preview as rp  # noqa: E402

arm = bpy.data.objects['Armature']
scene = bpy.context.scene
CHAR1 = bpy.data.objects['char1']
KEYS = [0, 6, 12, 14, 20, 48]


def use(action, frame):
    a = bpy.data.actions[action]
    arm.animation_data.action = a
    arm.animation_data.action_slot = a.slots[0]
    arm.data.pose_position = 'POSE'
    scene.frame_set(frame)
    bpy.context.view_layer.update()


def rest():
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    arm.data.pose_position = 'REST'
    bpy.context.view_layer.update()


# ------------------------------------------------------------------------------------------------------------ render
def cmd_render(outdir, frames):
    outdir = os.path.abspath(outdir)
    os.makedirs(outdir, exist_ok=True)
    sc = scene
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
        c.data.ortho_scale = 2.6
        if c.location.z < 5:
            c.location.z += 0.15
    use('swing_hit', 0)
    rp.add_render_hammer(arm)
    jobs = [('swing_hit', f, 'swing_hit_f%03d' % f) for f in frames] + [('swing_hit_v1', 12, 'old_swing_hit_f012')]
    for act, f, tag in jobs:
        use(act, f)
        for v, cam in cams.items():
            sc.camera = cam
            sc.render.filepath = os.path.join(outdir, '%s_%s.png' % (tag, v))
            bpy.ops.render.render(write_still=True)
        print('RENDERED', tag)


# ------------------------------------------------------------------------------------------------------------ clipping
ZONE = {'HEAD': ['neck', 'Head', 'head_end', 'headfront'], 'TORSO': ['Hips', 'Spine', 'Spine01', 'Spine02']}
for s, S in (('Left', 'L'), ('Right', 'R')):
    ZONE['UARM_' + S] = [s + 'Shoulder', s + 'Arm']
    ZONE['FARM_' + S] = [s + 'ForeArm']
    ZONE['HAND_' + S] = [s + 'Hand']
    ZONE['THIGH_' + S] = [s + 'UpLeg']
    ZONE['SHIN_' + S] = [s + 'Leg', s + 'Foot', s + 'ToeBase']
BONE_REGION = {b: r for r, bs in ZONE.items() for b in bs}
REGIONS = list(ZONE)


def ex(a, b):
    return frozenset((a, b))


EXEMPT = {ex('HEAD', 'TORSO')}
for S in 'LR':
    EXEMPT |= {ex('UARM_' + S, 'FARM_' + S), ex('FARM_' + S, 'HAND_' + S), ex('TORSO', 'THIGH_' + S), ex('THIGH_' + S, 'SHIN_' + S), ex('TORSO', 'SHIN_' + S)}
GRIP = ['HAND_L', 'HAND_R', 'FARM_L', 'FARM_R']
PAIRS = [(a, b) for i, a in enumerate(REGIONS) for b in REGIONS[i + 1:] if ex(a, b) not in EXEMPT]
PAIRS += [('HAMMER', r) for r in REGIONS if r not in GRIP]


def eval_world(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    e = ob.evaluated_get(dg)
    me = e.to_mesh()
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    M = np.array(ob.matrix_world)
    co = co @ M[:3, :3].T + M[:3, 3]
    me.calc_loop_triangles()
    tv = np.zeros(len(me.loop_triangles) * 3, int)
    me.loop_triangles.foreach_get('vertices', tv)
    e.to_mesh_clear()
    return co, tv.reshape(-1, 3)


def char_regions():
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
    out = {}
    for ti, t in enumerate(tv):
        c = [vreg[i] for i in t]
        out.setdefault(max(set(c), key=c.count), []).append(ti)
    return {r: np.array(v) for r, v in out.items()}


CHAR_TRIS = char_regions()
# BEARD: HEAD-zone triangles that hang below the chin in front of the chest (rest pose centroid z < 1.03 m, y < -0.03 m). The beard is soft
# and char1 has it welded to the head, so it is taken out of every pair (the earlier modular check dropped the beard too).
_rest_co = None


def split_beard():
    global _rest_co
    rest()
    co, tv = eval_world(CHAR1)
    cen = co[tv].mean(1)
    head = CHAR_TRIS['HEAD']
    sel = (cen[head, 2] < 1.03) & (cen[head, 1] < -0.03)
    CHAR_TRIS['BEARD'] = head[sel]
    CHAR_TRIS['HEAD'] = head[~sel]
    print('BEARD triangles', int(sel.sum()), 'of', len(head), 'HEAD-zone triangles')


split_beard()


def bvhs(ham):
    out, verts = {}, {}
    co, tv = eval_world(CHAR1)
    for r, idx in CHAR_TRIS.items():
        sub = tv[idx]
        used = np.unique(sub)
        remap = {int(u): i for i, u in enumerate(used)}
        out[r] = BVHTree.FromPolygons(co[used].tolist(), [tuple(remap[int(x)] for x in t) for t in sub], all_triangles=True)
        verts[r] = co[used]
    if ham is not None:
        co, tv = eval_world(ham)
        out['HAMMER'] = BVHTree.FromPolygons(co.tolist(), [tuple(int(i) for i in t) for t in tv], all_triangles=True)
        verts['HAMMER'] = co
    return out, verts


def depth(bva, va, bvb, vb):
    best = 0.0
    for bv, vs, bo in ((bvb, va, vb), (bva, vb, va)):
        lo, hi = bo.min(0) - 0.02, bo.max(0) + 0.02
        sel = vs[np.all((vs >= lo) & (vs <= hi), axis=1)]
        for v in sel:
            vv = Vector(v)
            loc, nor, _, d = bv.find_nearest(vv)
            if loc is not None and (vv - loc).dot(nor) < 0:
                best = max(best, d)
    return best


def hits(ham):
    bv, vv = bvhs(ham)
    res = {}
    for a, b in PAIRS:
        if a not in bv or b not in bv:
            continue
        n = len(bv[a].overlap(bv[b]))
        if n:
            res[a + '|' + b] = (n, round(depth(bv[a], vv[a], bv[b], vv[b]) * 100, 2))
    return res


def hammer_vs_body(ham):
    """hammer vertices inside the closed char1 mesh (ray parity, 3 directions, majority) with the depth to the nearest body surface
    and the zone of that surface: {zone: (n vertices, max depth cm)}. Handle vertices in the fists are not excluded here: the grip
    zones (HAND / FARM) are reported but only the others count."""
    co, tv = eval_world(CHAR1)
    bv = BVHTree.FromPolygons(co.tolist(), [tuple(int(i) for i in t) for t in tv], all_triangles=True)
    zone_of = {}
    for r, idx in CHAR_TRIS.items():
        for t in idx:
            zone_of[int(t)] = r
    hv, _ = eval_world(ham)
    dirs = [Vector(d).normalized() for d in ((0.31, 0.52, 0.80), (-0.61, 0.23, 0.76), (0.12, -0.71, 0.69))]
    out = {}
    for v in hv[::3]:
        vv = Vector(v)
        votes = 0
        for d in dirs:
            cnt, o = 0, vv + d * 1e-4
            while True:
                loc, nor, idx, dist = bv.ray_cast(o, d)
                if loc is None:
                    break
                cnt += 1
                o = loc + d * 1e-4
            votes += cnt % 2
        if votes >= 2:
            loc, nor, idx, dist = bv.find_nearest(vv)
            z = zone_of.get(int(idx), '?')
            n, m = out.get(z, (0, 0.0))
            out[z] = (n + 1, max(m, round(dist * 100, 2)))
    return out


def cmd_clip(out, frames):
    ham = rp.add_render_hammer(arm)
    rest()
    ham.hide_viewport = True
    base_rest = hits(None)
    ham.hide_viewport = False
    use('swing_ready_v1', 0)
    base_old = hits(ham)
    res = {'note': 'depth in cm; value = [n triangle pairs, deepest vertex]. baselines: rest pose (no hammer) and old swing_ready frame 0 (with hammer)',
           'excluded': {'chain_pairs': sorted('|'.join(sorted(e)) for e in EXEMPT), 'hammer_grip': GRIP},
           'baseline_rest': base_rest, 'baseline_old_swing_ready_f0': base_old, 'frames': {}}
    for f in frames:
        use('swing_hit', f)
        res['frames'][f] = hits(ham)
        print('CLIP f%d' % f, res['frames'][f])
    use('swing_hit_v1', 12)
    res['frames']['old_f12'] = hits(ham)
    res['hammer_inside_body'] = {}
    rest()
    ham.hide_viewport = False
    for tag, act, f in [('rest_pose_hammer_at_f0_of_new', 'swing_hit', 0)] + [('f%d' % f, 'swing_hit', f) for f in frames] + [('old_f12', 'swing_hit_v1', 12), ('old_ready_f0', 'swing_ready_v1', 0)]:
        use(act, f)
        res['hammer_inside_body'][tag] = hammer_vs_body(ham)
        print('HAMMER_IN_BODY', tag, res['hammer_inside_body'][tag])
    json.dump(res, open(out, 'w'), indent=1)
    print('BASE rest', base_rest)
    print('BASE old ready', base_old)
    print('WROTE', out)


# ------------------------------------------------------------------------------------------------------------ numbers
def bone_world(n):
    return (arm.matrix_world @ arm.pose.bones[n].matrix).to_translation()


def cmd_numbers(out):
    ham = rp.add_render_hammer(arm)
    me = ham.data
    local = np.array([v.co[:] for v in me.vertices])
    head_idx = np.where(local[:, 0] < -0.30)[0]   # iron head block (mesh -X = bone +Y end)
    butt_idx = np.where(local[:, 0] > 0.90)[0]    # butt end of the handle
    ML = np.array(ham.matrix_parent_inverse)

    def hammer_pts(act, f):
        use(act, f)
        M = np.array(ham.matrix_world)
        w = local @ M[:3, :3].T + M[:3, 3]
        hb = w[head_idx]
        centre = (hb.min(0) + hb.max(0)) / 2
        pb = arm.matrix_world @ arm.pose.bones['Hammer'].matrix
        xa = np.array(pb.to_3x3().normalized() @ Vector((1, 0, 0)))
        return centre, centre + xa * 0.224, w[butt_idx].mean(0), xa

    R = {}
    c_old, face_old, butt_old, x_old = hammer_pts('swing_hit_v1', 12)
    c_new, face_new, butt_new, x_new = hammer_pts('swing_hit', 12)
    R['impact_head_centre_old_m'] = c_old.round(4).tolist()
    R['impact_head_centre_new_m'] = c_new.round(4).tolist()
    R['impact_head_delta_cm'] = round(float(np.linalg.norm(c_new - c_old)) * 100, 3)
    R['impact_strike_face_centre_delta_cm'] = round(float(np.linalg.norm(face_new - face_old)) * 100, 3)
    R['impact_face_normal_angle_deg'] = round(math.degrees(math.acos(max(-1, min(1, float(x_old @ x_new))))), 3)
    for f in (14, 20):
        c, face, butt, x = hammer_pts('swing_hit', f)
        R['f%d_head_centre_m' % f] = c.round(4).tolist()
        R['f%d_head_rise_cm' % f] = round(float(c[2] - c_new[2]) * 100, 2)
        R['f%d_handle_end_rise_cm' % f] = round(float(butt[2] - butt_new[2]) * 100, 2)
        R['f%d_head_shift_forward_cm' % f] = round(float(-(c[1] - c_new[1])) * 100, 2)
    for act in ('swing_hit', 'swing_ready'):
        n = int(round(bpy.data.actions[act].frame_range[1])) + 1
        hips, feet, path = [], {s: [] for s in ('LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase')}, []
        for f in range(n):
            use(act, f)
            hips.append(bone_world('Hips'))
            for s in feet:
                feet[s].append(bone_world(s))
            path.append(hammer_pts(act, f)[0])
        d = {'frames': n, 'hips_xy_drift_m': round(max(math.hypot(h.x - hips[0].x, h.y - hips[0].y) for h in hips), 4)}
        for s, pts in feet.items():
            d['%s_xy_drift_m' % s] = round(max(math.hypot(p.x - pts[0].x, p.y - pts[0].y) for p in pts), 4)
            d['%s_z_lift_m' % s] = round(max(p.z - pts[0].z for p in pts), 4)
            d['%s_z_drop_m' % s] = round(max(pts[0].z - p.z for p in pts), 4)
        d['head_centre_z_m_every_6_frames'] = {f: round(float(path[f][2]), 3) for f in range(0, n, 6)}
        R[act] = d

    def quats(act, f):
        use(act, f)
        return {pb.name: pb.matrix_basis.to_quaternion() for pb in arm.pose.bones}, {pb.name: pb.matrix_basis.translation.copy() for pb in arm.pose.bones}

    def maxdiff(a, b):
        return [round(max(math.degrees(2 * math.acos(min(1.0, abs(a[0][n].dot(b[0][n]))))) for n in a[0]), 5), round(max((a[1][n] - b[1][n]).length for n in a[1]), 6)]

    q = {k: quats(*k) for k in (('swing_hit', 0), ('swing_hit', 48), ('swing_ready', 0), ('swing_ready', 48))}
    R['swing_hit_f0_vs_f48_[max bone deg, max loc]'] = maxdiff(q[('swing_hit', 0)], q[('swing_hit', 48)])
    R['swing_ready_f0_vs_f48_[max bone deg, max loc]'] = maxdiff(q[('swing_ready', 0)], q[('swing_ready', 48)])
    R['swing_ready_f0_vs_swing_hit_f0_[max bone deg, max loc]'] = maxdiff(q[('swing_ready', 0)], q[('swing_hit', 0)])
    R['bones'] = [b.name for b in arm.data.bones]
    json.dump(R, open(out, 'w'), indent=1, default=float)
    print(json.dumps(R, indent=1, default=float))


if __name__ == '__main__':
    a = sys.argv[sys.argv.index('--') + 1:]
    fr = [int(x) for x in a[2].split(',')] if len(a) > 2 else KEYS
    if a[0] == 'render':
        cmd_render(a[1], fr)
    elif a[0] == 'clip':
        cmd_clip(a[1], fr)
    elif a[0] == 'ham':  # quick: hammer vs body only
        h = rp.add_render_hammer(arm)
        for f in fr:
            use('swing_hit', f)
            print('HAM f%d' % f, hammer_vs_body(h))
    elif a[0] == 'numbers':
        cmd_numbers(a[1])
