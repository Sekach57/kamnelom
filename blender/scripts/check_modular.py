"""Phase 1 step 2 checks on the assembled modular dwarf: all 6 dwarf.glb clips + the 4 dwarf_moves.glb clips, inspection only.

  blender -b blender/src/dwarf_modular.blend --python blender/scripts/check_modular.py -- intersect OUT.json
  blender -b blender/src/dwarf_modular.blend --python blender/scripts/check_modular.py -- render OUT_DIR [clip ...]
  blender -b blender/src/dwarf_modular.blend --python blender/scripts/check_modular.py -- validate

Every clip is applied the way the game does it: the clip's node tracks (translation / rotation / scale by NODE NAME) replace the local
transform of the dwarf.glb skeleton, forward kinematics gives each joint's world matrix, and that matrix is written to the pose bone
(K = constant glTF-node -> Blender-bone offset taken from the rest pose). So the 4 skinless dwarf_moves.glb clips play on the dwarf
armature without touching bone names, rest pose or the clips themselves. Nothing is saved.

intersect: per frame, triangle-triangle overlap (BVH) between body regions that are not meant to touch. Pairs that overlap in the rest
           pose by design (neck inside head, pad over the sleeve, ...) are listed in EXEMPT. Prints / writes every hit.
render:    key frames (start, windup, impact, end) x front/side/top, 540 px Workbench, written as PNG for compose_clip_sheet.py.
validate:  checks the retarget maths against Blender's own evaluation of the 6 native actions.
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
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
import render_preview as rp  # noqa: E402
import verify_glb as vg  # noqa: E402

FPS = 24
NATIVE = ['swing_ready', 'swing_hit', 'squat_ready', 'squat_hit', 'pushup_ready', 'pushup_hit']
MOVES = ['idle_to_push_up', 'push_up_to_idle', 'Slow_Orc_Walk', 'Male_Bend_Over_Pick_Up']
IMPACT = {'swing_hit': 0.5, 'squat_hit': 0.4, 'pushup_hit': 0.6}  # IMPACT table in dist/scene3d.js line 63 (seconds into the strike clip)
HAMMER_CLIPS = {'swing_ready', 'swing_hit'}

arm = bpy.data.objects['Armature']
C4 = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # glTF (x, y, z) -> Blender (x, -z, y)

# ------------------------------------------------------------------------------------------------------------ clip data
gd = vg.Gltf(os.path.join(ROOT, 'blender', 'originals', 'dwarf.glb'))
gm = vg.Gltf(os.path.join(ROOT, 'blender', 'originals', 'dwarf_moves.glb'))
rig = vg.Rig(gd)
rig_m = vg.Rig(gm)


def clip_channels(name):
    """channels keyed by (dwarf node index, path); dwarf_moves tracks are matched to the dwarf skeleton by node name"""
    if name in NATIVE:
        anim = next(a for a in gd.j['animations'] if a['name'] == name)
        return rig.sample_channels(anim)
    anim = next(a for a in gm.j['animations'] if a['name'] == name)
    out = {}
    for (ni, path), v in rig_m.sample_channels(anim).items():
        nm = rig_m.name[ni]
        if nm in rig.byname:
            out[(rig.byname[nm], path)] = v
    return out


def clip_times(ch):
    dur = max(float(v[0][-1]) for v in ch.values())
    n = int(math.floor(dur * FPS + 1e-6)) + 1
    ts = [k / FPS for k in range(n)]
    if dur - ts[-1] > 1e-4:
        ts.append(dur)
    return ts


def to_blender(M):
    return C4 @ Matrix(M.tolist()) @ C4.inverted()


# constant offset K per bone between the glTF node frame and the Blender bone frame (rest pose)
arm.data.pose_position = 'REST'
bpy.context.view_layer.update()
W_rest, _ = rig.pose({}, 0.0)
ARM_INV = arm.matrix_world.inverted()
BONE_ORDER = []
K = {}
REST_ARM = {}
for b in arm.data.bones:
    REST_ARM[b.name] = b.matrix_local.copy()  # armature space
for b in arm.data.bones:  # parents first
    BONE_ORDER.append(b)
BONE_ORDER.sort(key=lambda b: len(b.parent_recursive))
for b in BONE_ORDER:
    ni = rig.byname[b.name]
    Mn = ARM_INV @ to_blender(W_rest[ni])
    K[b.name] = Mn.inverted() @ REST_ARM[b.name]
    head_err = (Mn.translation - REST_ARM[b.name].translation).length
    assert head_err < 2e-3, (b.name, head_err)  # node frame and bone head agree, so the axis conversion is right


def set_pose_from_channels(ch, t):
    W, _ = rig.pose(ch, t)
    pose_world = {}
    for b in BONE_ORDER:
        ni = rig.byname[b.name]
        target = ARM_INV @ to_blender(W[ni]) @ K[b.name]
        if b.parent:
            rel = REST_ARM[b.parent.name].inverted() @ REST_ARM[b.name]
            basis = rel.inverted() @ pose_world[b.parent.name].inverted() @ target
        else:
            basis = REST_ARM[b.name].inverted() @ target
        pose_world[b.name] = target
        arm.pose.bones[b.name].matrix_basis = basis
    arm.data.pose_position = 'POSE'
    bpy.context.view_layer.update()


def reset_pose():
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


# ------------------------------------------------------------------------------------------------------------ regions
PARTS = [o for o in bpy.data.objects if o.name.startswith('part_')]


def region_of(part, tag, bone):
    n = part.name
    if n in ('part_head_round', 'part_helmet_none'):
        return 'HEAD'
    if n == 'part_beard_long':
        return 'BEARD'
    if n == 'part_torso_plate':
        return {'neck': 'NECK', 'chest': 'CHEST', 'belly': 'BELLY', 'belt': 'BELT'}[tag]
    if n == 'part_legs_base':
        if tag == 'pelvis':
            return 'PELVIS'
        return ('THIGH_' if bone.endswith('UpLeg') else 'SHIN_') + bone[0]
    side = lambda s: s + '_' + bone[0]  # noqa: E731  (L / R from Left* / Right*)
    if n == 'part_shoulders_plate':
        return side('PAD')
    if n == 'part_arms_base':
        return side('FARM' if bone.endswith('ForeArm') else 'UARM')
    if n == 'part_gloves_fist':
        return side('HAND')
    if n == 'part_boots_leather':
        return side('BOOT')
    raise KeyError(n)


EXEMPT = set()


def ex(a, b):
    EXEMPT.add(frozenset((a, b)))


for a, b in [('HEAD', 'BEARD'), ('HEAD', 'NECK'), ('BEARD', 'NECK'), ('NECK', 'CHEST'), ('CHEST', 'BELLY'), ('BELLY', 'BELT'),
             ('BELT', 'PELVIS'), ('BELLY', 'PELVIS')]:
    ex(a, b)
for s in 'LR':
    for a, b in [('CHEST', 'PAD'), ('PAD', 'UARM'), ('CHEST', 'UARM'), ('UARM', 'FARM'), ('FARM', 'HAND'), ('THIGH', 'SHIN'),
                 ('SHIN', 'BOOT'), ('PELVIS', 'THIGH'), ('BELT', 'THIGH'), ('NECK', 'PAD'),
                 ('BELLY', 'THIGH'), ('NECK', 'UARM')]:  # last two: touch already in the rest pose (thick thigh / sleeve next to belly / neck)
        ex(a + ('' if a in ('CHEST', 'PELVIS', 'BELT', 'NECK', 'BELLY') else '_' + s), b + ('' if b in ('CHEST', 'PELVIS', 'BELT', 'NECK', 'BELLY') else '_' + s))

# triangles of each object grouped by region (rigid pieces: all vertices of a triangle share one bone and one piece id)
REG_TRIS = {}  # region -> list of (object, tri index array)
for ob in PARTS:
    me = ob.data
    tags = {int(k): v for k, v in ob['piece_tags'].items()}
    piece = np.zeros(len(me.vertices), int)
    me.attributes['piece'].data.foreach_get('value', piece)
    names = {g.index: g.name for g in ob.vertex_groups}
    bone_of = []
    for v in me.vertices:
        bone_of.append(names[max(v.groups, key=lambda g: g.weight).group])
    me.calc_loop_triangles()
    tv = np.zeros(len(me.loop_triangles) * 3, int)
    me.loop_triangles.foreach_get('vertices', tv)
    tv = tv.reshape(-1, 3)
    byreg = {}
    for ti, tri in enumerate(tv):
        r = region_of(ob, tags[int(piece[tri[0]])], bone_of[tri[0]])
        byreg.setdefault(r, []).append(ti)
    for r, lst in byreg.items():
        REG_TRIS.setdefault(r, []).append((ob, np.array(lst)))
REGIONS = sorted(REG_TRIS)
# the beard is not part of the check (user decision, step 2 redo): every pair with BEARD is dropped
BODY = [r for r in REGIONS if r != 'BEARD']
PAIRS = [(a, b) for i, a in enumerate(BODY) for b in BODY[i + 1:] if frozenset((a, b)) not in EXEMPT]
# the hammer (render / check only) against every body region, except the grip: the handle sits in the fists and along the forearms
HAMMER_GRIP_EXEMPT = ['HAND_L', 'HAND_R', 'FARM_L', 'FARM_R']
PAIRS += [('HAMMER', r) for r in BODY if r not in HAMMER_GRIP_EXEMPT]


HAM = {'bone': None, 'hand': None, 'mode': None, 'centre': None, 'k': None}
GAME_USED_FRAMES = {'Male_Bend_Over_Pick_Up': (0, 70)}  # PICK = {from 0, to 2.9 s} in dist/scene3d.js: only the first 2.9 s of the clip are played
HAND_HAMMER_FRAMES = (29, 70)  # PICK.grab 1.2 s: from there the hammer is in the hand (hmode 'hand'); before that it lies on the floor


def init_hammers():
    """two render-only hammers: one on bone Hammer (swing clips), one placed like the game's 'hand' mode (pick-up clip)"""
    set_pose_from_channels(clip_channels_cache['swing_ready'], 0.0)
    HAM['bone'] = rp.add_render_hammer(arm)
    h = rp.add_render_hammer(arm)
    pts = [Vector(c) for c in h.bound_box]
    lo = Vector((min(q[i] for q in pts) for i in range(3)))
    hi = Vector((max(q[i] for q in pts) for i in range(3)))
    HAM['centre'], HAM['k'] = (lo + hi) / 2, rp.HAMMER_LEN / max(hi - lo)
    h.parent = None
    HAM['hand'] = h
    for o in (HAM['bone'], HAM['hand']):
        o.hide_render = o.hide_viewport = True


def place_hand_hammer():
    """scene3d.js placeHammer(), hmode 'hand': p = RightHand + axis * .4 * L, axis = (.1, -1, .3) in game axes; q = basisQuat(axis, (1,0,0)) * HAMMER_FIX"""
    hand = arm.matrix_world @ arm.pose.bones['RightHand'].head
    ya = Vector((0.1, -1.0, 0.3)).normalized()
    z = Vector((1, 0, 0)).cross(ya).normalized()
    x = ya.cross(z)
    F = Matrix(((x.x, ya.x, z.x), (x.y, ya.y, z.y), (x.z, ya.z, z.z)))
    c3 = C4.to_3x3()
    Fb = c3 @ F @ c3.inverted()
    p = hand + (c3 @ ya) * (0.4 * rp.HAMMER_LEN)
    HAM['hand'].matrix_world = Matrix.Translation(p) @ Fb.to_4x4() @ rp.HAMMER_FIX @ Matrix.Scale(HAM['k'], 4) @ Matrix.Translation(-HAM['centre'])


def hammer_mode(clip, k):
    if clip in HAMMER_CLIPS:
        return 'bone'
    if clip == 'Male_Bend_Over_Pick_Up' and HAND_HAMMER_FRAMES[0] <= k <= HAND_HAMMER_FRAMES[1]:
        return 'hand'
    return None


def set_frame(clip, k, t):
    set_pose_from_channels(clip_channels_cache[clip], t)
    if HAM['bone'] is None:
        return
    mode = hammer_mode(clip, k)
    HAM['mode'] = mode
    for key in ('bone', 'hand'):
        HAM[key].hide_render = HAM[key].hide_viewport = (mode != key)
    if mode == 'hand':
        place_hand_hammer()
        bpy.context.view_layer.update()


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


def region_bvhs():
    cache, out, verts_of = {}, {}, {}
    for r in BODY:
        verts, tris, off = [], [], 0
        for ob, idx in REG_TRIS[r]:
            if ob.name not in cache:
                cache[ob.name] = eval_world(ob)
            co, tv = cache[ob.name]
            sub = tv[idx]
            used = np.unique(sub)
            remap = {int(u): i + off for i, u in enumerate(used)}
            verts.extend(co[used].tolist())
            tris.extend([tuple(remap[int(x)] for x in t) for t in sub])
            off += len(used)
        out[r] = BVHTree.FromPolygons(verts, tris, all_triangles=True)
        verts_of[r] = np.array(verts)
    if HAM['mode']:
        co, tv = eval_world(HAM[HAM['mode']])
        out['HAMMER'] = BVHTree.FromPolygons(co.tolist(), [tuple(int(i) for i in t) for t in tv], all_triangles=True)
        verts_of['HAMMER'] = co
    return out, verts_of


def depth(bva, va, bvb, vb):
    """deepest point of one region inside the other: vertices of A near B that lie behind B's nearest face, distance to that face (and the reverse)"""
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


def pair_hits():
    bv, vv = region_bvhs()
    res = {}
    for a, b in PAIRS:
        if a not in bv or b not in bv:
            continue
        n = len(bv[a].overlap(bv[b]))
        if n:
            res[a + '|' + b] = (n, depth(bv[a], vv[a], bv[b], vv[b]))
    return res


clip_channels_cache = {c: clip_channels(c) for c in NATIVE + MOVES}


def cmd_validate():
    worst = 0.0
    for name in NATIVE:
        act = bpy.data.actions[name]
        arm.animation_data.action = act
        arm.animation_data.action_slot = act.slots[0]
        arm.data.pose_position = 'POSE'
        for fr in (0, 7, 13, 24, 30):
            if fr > act.frame_range[1]:
                continue
            bpy.context.scene.frame_set(fr)
            ref = {pb.name: pb.matrix.copy() for pb in arm.pose.bones}
            ch = clip_channels_cache[name]
            # drop the action so the pose comes only from set_pose_from_channels
            arm.animation_data.action = None
            set_pose_from_channels(ch, fr / FPS)
            err = max((pb.matrix.translation - ref[pb.name].translation).length for pb in arm.pose.bones)
            rerr = max(np.abs(np.array(pb.matrix.to_3x3()) - np.array(ref[pb.name].to_3x3())).max() for pb in arm.pose.bones)
            worst = max(worst, err)
            print('VALIDATE %-13s f%-3d max joint position diff %.6f m, max rotation matrix diff %.5f' % (name, fr, err, rerr))
            arm.animation_data.action = act
            arm.animation_data.action_slot = act.slots[0]
    print('VALIDATE worst position diff', worst)


def cmd_intersect(out):
    reset_pose()
    arm.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    init_hammers()
    reset_pose()
    base = pair_hits()
    print('REST BASELINE', base)
    report = {'baseline_rest': {k: list(v) for k, v in base.items()}, 'regions': BODY, 'checked_pairs': len(PAIRS),
              'excluded': {'beard': 'all pairs with BEARD', 'hammer_grip': HAMMER_GRIP_EXEMPT,
                           'designed_overlaps': sorted('|'.join(sorted(e)) for e in EXEMPT)}, 'clips': {}}
    for clip in NATIVE + MOVES:
        ts = clip_times(clip_channels_cache[clip])
        hits = {}
        for k, t in enumerate(ts):
            set_frame(clip, k, t)
            for pr, (n, d) in pair_hits().items():
                hits.setdefault(pr, []).append((k, n, d))
        summ = {}
        lim = GAME_USED_FRAMES.get(clip)
        for pr, lst in hits.items():
            frames = [k for k, _, _ in lst]
            w = max(lst, key=lambda x: x[2])
            summ[pr] = {'frames': len(frames), 'first': frames[0], 'last': frames[-1], 'max_tri_pairs': max(n for _, n, _ in lst),
                        'max_depth_cm': round(w[2] * 100, 2), 'worst_frame': w[0],
                        'frames_in_game_range': (sum(1 for f in frames if lim[0] <= f <= lim[1]) if lim else len(frames)),
                        'frame_list': frames if len(frames) <= 40 else frames[:40] + ['...']}
        report['clips'][clip] = {'frames': len(ts), 'intersections': summ}
        print('CLIP %-24s frames %-4d pairs with overlap: %d %s' % (clip, len(ts), len(summ), json.dumps({p: (v['frames'], v['max_depth_cm']) for p, v in summ.items()})))
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    json.dump(report, open(out, 'w'), indent=1)
    print('WROTE', out)


def key_frames(clip, ts):
    n = len(ts) - 1
    if clip in IMPACT:
        imp = min(n, int(round(IMPACT[clip] * FPS)))
        return [0, imp // 2, imp, n]
    if clip in GAME_USED_FRAMES:  # start, hammer grabbed (1.2 s), middle of the lift, end of the played segment (2.9 s)
        return [0, HAND_HAMMER_FRAMES[0], 50, GAME_USED_FRAMES[clip][1]]
    return [0, n // 3, (2 * n) // 3, n]


def cmd_render(outdir, only):
    sc = bpy.context.scene
    outdir = os.path.abspath(outdir)
    reset_pose()
    sc.frame_set(0)
    os.makedirs(outdir, exist_ok=True)
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'MATERIAL'
    sc.display.shading.show_object_outline = False
    sc.render.film_transparent = False
    if not sc.world:
        sc.world = bpy.data.worlds.new('w')
    sc.render.image_settings.file_format = 'PNG'
    sc.render.resolution_x = sc.render.resolution_y = 540
    cams = {v: rp.add_view_camera(v, None) for v in ('front', 'side', 'top')}
    for c in cams.values():
        c.data.ortho_scale = 2.2
    init_hammers()
    for clip in (only or NATIVE + MOVES):
        ts = clip_times(clip_channels_cache[clip])
        kf = key_frames(clip, ts)
        for i, f in enumerate(kf):
            set_frame(clip, f, ts[f])
            for v, cam in cams.items():
                sc.camera = cam
                sc.render.filepath = os.path.join(outdir, '%s_%d_f%03d_%s.png' % (clip, i, f, v))
                bpy.ops.render.render(write_still=True)
        print('RENDERED', clip, kf)


def cmd_portrait(outprefix):
    """portrait() in dist/scene3d.js: PerspectiveCamera(fov 22 vertical, aspect 1), at head + (0, .06, 1.05) in game axes, looking at head + (0, .02, 0).
    Game (x, y up, z towards the viewer) -> Blender (x, -z, y). Pose: swing_ready, first frame. Lights are a Blender approximation of
    the game's hemisphere + directional light (position from the code, colours/intensity by eye); the camera is exact."""
    sc = bpy.context.scene
    reset_pose()
    set_pose_from_channels(clip_channels_cache['swing_ready'], 0.0)
    head = arm.matrix_world @ arm.pose.bones['Head'].head
    cd = bpy.data.cameras.new('portrait_cam')
    cd.type = 'PERSP'
    cd.sensor_fit = 'VERTICAL'
    cd.angle_y = math.radians(22)
    cd.clip_start, cd.clip_end = 0.05, 10
    cam = bpy.data.objects.new('portrait_cam', cd)
    sc.collection.objects.link(cam)
    cam.location = head + Vector((0, -1.05, 0.06))
    target = head + Vector((0, 0, 0.02))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    ld = bpy.data.lights.new('sun', 'SUN')
    ld.energy = 3.0
    ld.color = (1.0, 0.89, 0.74)
    sun = bpy.data.objects.new('sun', ld)
    sc.collection.objects.link(sun)
    sun.rotation_euler = Vector((1.5, -3.0, 2.0)).to_track_quat('Z', 'Y').to_euler()  # light comes from game (1.5, 2, 3)
    sc.world = bpy.data.worlds.new('pw')
    sc.world.use_nodes = True
    bg = next(n for n in sc.world.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs['Color'].default_value = (0.55, 0.57, 0.68, 1)
    bg.inputs['Strength'].default_value = 1.0
    for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
        try:
            sc.render.engine = eng
            break
        except TypeError:
            pass
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'
    for px in (512, 96):
        sc.render.resolution_x = sc.render.resolution_y = px
        sc.render.filepath = os.path.abspath('%s_%d.png' % (outprefix, px))
        bpy.ops.render.render(write_still=True)
    print('PORTRAIT camera', tuple(cam.location), 'target', tuple(target), 'engine', sc.render.engine)


if __name__ == '__main__':
    a = sys.argv[sys.argv.index('--') + 1:]
    if a[0] == 'validate':
        cmd_validate()
    elif a[0] == 'intersect':
        cmd_intersect(a[1])
    elif a[0] == 'portrait':
        cmd_portrait(a[1])
    elif a[0] == 'render':
        cmd_render(a[1], a[2:])
