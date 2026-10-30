"""Swing clips: key poses, in-betweens, swing_ready breathing and the swing_raise transition (stage 2; stage 1 was blocking only).

  blender -b --python blender/scripts/swing_blocking.py            # builds blender/src/dwarf_swing.blend from blender/src/dwarf.blend
  blender -b --python blender/scripts/swing_blocking.py -- print   # same, but only prints the diagnostics, saves nothing

Idempotent: it always starts from blender/src/dwarf.blend (never modified) and writes blender/src/dwarf_swing.blend.
The old actions are kept as swing_ready_v1 / swing_hit_v1 (Fake User). export_glb.py drops every action named *_v1 from the
session before exporting, so the .glb has exactly the six clip names of originals/dwarf.glb.

Spec (user request, explicit change of invariant 3 for these two clips):
  swing_hit   49 frames (0..48) at 24 fps = 2.0 s. 0-6 wind-up, 6-12 strike, 12 IMPACT (IMPACT.swing stays 0.5 s), 12-14 hold,
              14-20 rebound (hammer up 15-20 cm, body gives back, feet planted), 20-48 return to the stance (48 == 0).
  swing_ready 49 frames loop, hammer on the shoulder behind the head, fists on the handle, elbows out. Frame 0 == frame 48 ==
              swing_hit frames 0 / 48 (same pose function, so bit-identical). Breathing goes here later (see BREATHING NOTE).

How the poses are made (no IK constraints in the .blend, nothing to bake): this script holds a tiny forward-kinematics engine
in armature space (cm). A pose = hips offset + local rotations of the spine chain / neck / head / clavicles + the world pose of
the Hammer bone. Arms are solved analytically (two-bone IK with an elbow pole) so that both fists sit on the handle with the grip
offsets measured from the OLD swing_hit frame 12; legs are solved the same way to keep both feet exactly where they were in
old swing_ready frame 0 (planted). The result is written as plain keyframes on location / rotation_quaternion / scale of all 25 bones.
Frame 12 uses the OLD frame-12 Hammer world matrix, so the impact geometry is the same by construction.
"""
import math
import os
import sys

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'blender', 'src', 'dwarf.blend')
OUT = os.path.join(ROOT, 'blender', 'src', 'dwarf_swing.blend')
PRINT_ONLY = 'print' in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
CM = 100.0  # world metres -> armature space (the armature object is scaled 0.01)

# BREATHING NOTE (stage 2): swing_ready gets its light breathing as small Spine02/Spine01/Spine/shoulder pitch + Hammer bob keys at
# frames 12, 24, 36 on top of the frame-0 pose, with frame 48 == frame 0 kept exactly. Not done in this stage.

KEY_FRAMES = [0, 6, 12, 14, 19, 48]  # rebound peak on frame 19 (0.79 s): the visible blow ends before MIN_GAP = 0.8 s
LAST = 48
RAISE_LAST = 16  # swing_raise: 17 frames, 0.71 s

bpy.ops.wm.open_mainfile(filepath=SRC)
arm = bpy.data.objects['Armature']
scene = bpy.context.scene
for old in ('swing_ready', 'swing_hit'):
    bpy.data.actions[old].name = old + '_v1'
    bpy.data.actions[old + '_v1'].use_fake_user = True

# --------------------------------------------------------------------------------------------------------- FK engine
REST = {b.name: b.matrix_local.copy() for b in arm.data.bones}
PAR = {b.name: (b.parent.name if b.parent else None) for b in arm.data.bones}
NAMES = list(REST)
ORDER = sorted(NAMES, key=lambda n: len(arm.data.bones[n].parent_recursive))


def rel(n):
    return REST[PAR[n]].inverted() @ REST[n] if PAR[n] else REST[n].copy()


REL = {n: rel(n) for n in NAMES}
REL_INV = {n: REL[n].inverted() for n in NAMES}


class Pose:
    def __init__(self, basis=None):
        self.B = {n: Matrix.Identity(4) for n in NAMES}
        if basis:
            for n, m in basis.items():
                self.B[n] = m.copy()

    def P(self, n):
        chain = []
        while n:
            chain.append(n)
            n = PAR[n]
        m = None
        for c in reversed(chain):
            m = (m @ REL[c] @ self.B[c]) if m is not None else (REL[c] @ self.B[c])
        return m

    def set_world(self, n, target):
        par = self.P(PAR[n]) if PAR[n] else Matrix.Identity(4)
        self.B[n] = REL_INV[n] @ par.inverted() @ target

    def set_local_rot(self, n, deg, extra=None):
        """rotation of bone n about its head, axes = the armature axes at rest (X pitch: + leans the bone tip forward = -Y; Y roll; Z twist)"""
        r = Euler([math.radians(a) for a in deg], 'XYZ').to_matrix()
        rr = REST[n].to_3x3().normalized()
        self.B[n] = (rr.inverted() @ r @ rr).to_4x4()

    def add_local_rot(self, n, deg):
        r = Euler([math.radians(a) for a in deg], 'XYZ').to_matrix()
        rr = REST[n].to_3x3().normalized()
        self.B[n] = (rr.inverted() @ r @ rr).to_4x4() @ self.B[n]


def rot4(m3):
    return m3.to_4x4()


def trans(v):
    return Matrix.Translation(v)


def about(point, m3):
    return trans(point) @ m3.to_4x4() @ trans(-point)


def two_bone(pose, upper, lower, end, target, pole, end_rot=None, ref=None):
    """analytic two-bone IK in armature space. Returns the reach error in cm (0 when the target is reachable).
    ref: optional local bases (matrix_basis) the bones start from; the bone is turned by the shortest arc from there, so the twist (roll)
    of the limb stays that of the reference pose (arms: the old impact pose, so frames 12 / 14 / 20 and the old clip share their roll)."""
    ref = ref or {}
    pose.B[upper] = ref.get(upper, Matrix.Identity(4)).copy()
    pose.B[lower] = ref.get(lower, Matrix.Identity(4)).copy()
    P0 = pose.P(upper)
    S = P0.translation.copy()
    a = (REST[lower].translation - REST[upper].translation).length
    b = (REST[end].translation - REST[lower].translation).length
    to = target - S
    dist = to.length
    err = max(0.0, dist - (a + b))
    D = min(dist, a + b - 1e-4)
    u = to.normalized()
    x = (a * a - b * b + D * D) / (2 * D)
    h = math.sqrt(max(a * a - x * x, 0.0))
    n = pole - u * pole.dot(u)
    n = n.normalized() if n.length > 1e-6 else Vector((0, 0, 1)).cross(u).normalized()
    E = S + u * x + n * h
    for bone, nxt, goal in ((upper, lower, E), (lower, end, target)):
        pose.B[bone] = ref.get(bone, Matrix.Identity(4)).copy()
        P0 = pose.P(bone)
        v_loc = (REST[bone].inverted() @ REST[nxt]).translation.normalized()
        d0 = P0.to_3x3() @ v_loc
        d1 = (goal - P0.translation).normalized()
        R = d0.rotation_difference(d1).to_matrix() @ P0.to_3x3()
        pose.set_world(bone, trans(P0.translation) @ R.to_4x4())
    pose.B[end] = Matrix.Identity(4)
    if end_rot is not None:
        pe = pose.P(end)
        pose.set_world(end, trans(pe.translation) @ end_rot.to_4x4())
    return err


def hammer_matrix(butt, d, zhint=Vector((-1, 0, 0)), roll=0.0):
    """Hammer bone world matrix (armature space, cm) from the butt position (m) and the handle direction butt -> head.
    Bone +Y = d, bone +Z = the hint made perpendicular (the fists sit on +Z (right) / -Z (left)), bone +X = Y x Z = strike-face normal."""
    y = d.normalized()
    z = (zhint - y * zhint.dot(y)).normalized()
    x = y.cross(z)
    if roll:
        rr = Matrix.Rotation(math.radians(roll), 3, y)
        x, z = rr @ x, rr @ z
    r = Matrix(((x.x, y.x, z.x), (x.y, y.y, z.y), (x.z, y.z, z.z)))
    return trans((butt + y * 0.36) * CM) @ r.to_4x4()


# --------------------------------------------------------------------------------------------------------- old clips
def old_pose(action, frame):
    a = bpy.data.actions[action]
    arm.animation_data.action = a
    arm.animation_data.action_slot = a.slots[0]
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    return {pb.name: pb.matrix_basis.copy() for pb in arm.pose.bones}, {pb.name: pb.matrix.copy() for pb in arm.pose.bones}


OLD12_B, OLD12_P = old_pose('swing_hit_v1', 12)
OLD0_B, OLD0_P = old_pose('swing_ready_v1', 0)


def unscale(m):
    t, q, s = m.decompose()
    return trans(t) @ q.to_matrix().to_4x4()


H12 = unscale(OLD12_P['Hammer'])
GRIP_POS, GRIP_ROT = {}, {}
for side in ('Right', 'Left'):  # fist wrist position / orientation in the hammer frame, taken from the old impact pose
    hand = unscale(OLD12_P[side + 'Hand'])
    local = H12.inverted() @ hand
    GRIP_POS[side], GRIP_ROT[side] = local.translation.copy(), local.to_3x3()
FOOT_P = {n: unscale(OLD0_P[n]) for n in ('LeftFoot', 'RightFoot')}  # planted feet (old swing_ready frame 0)
FOOT_B = {n: OLD0_B[n].copy() for n in ('LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase')}
ELBOW12 = {s: OLD12_P[s + 'ForeArm'].translation.copy() for s in ('Left', 'Right')}


def pole_from_old(side):
    """direction in which the old impact pose bends the elbow away from the shoulder-wrist line"""
    S = OLD12_P[side + 'Arm'].translation
    T = OLD12_P[side + 'Hand'].translation
    E = OLD12_P[side + 'ForeArm'].translation
    u = (T - S).normalized()
    p = (E - S) - u * (E - S).dot(u)
    return p.normalized()


# --------------------------------------------------------------------------------------------------------- pose recipes
SPINE = ('Spine02', 'Spine01', 'Spine')  # bottom -> top; Spine is the chest, neck / clavicles hang under it


def build_pose(p):
    """p: dict with hips (dx,dy,dz m), hips_rot, spine (3 x deg xyz), neck, head, clav_l, clav_r, hammer (butt m, dir), poles (L, R)"""
    pose = Pose()
    for n in ('Hips',):
        h = REST['Hips'].translation
        target = trans(Vector(p['hips']) * CM) @ about(h, Euler([math.radians(a) for a in p.get('hips_rot', (0, 0, 0))], 'XYZ').to_matrix()) @ REST['Hips']
        pose.B['Hips'] = REST['Hips'].inverted() @ target
    for n, deg in zip(SPINE, p['spine']):
        pose.set_local_rot(n, deg)
    pose.set_local_rot('neck', p.get('neck', (0, 0, 0)))
    pose.set_local_rot('Head', p.get('head', (0, 0, 0)))
    pose.set_local_rot('LeftShoulder', p.get('clav_l', (0, 0, 0)))
    pose.set_local_rot('RightShoulder', p.get('clav_r', (0, 0, 0)))
    return pose


def finish_pose(pose, hammer_world, poles, knee_out=0.25):
    """Hammer bone, both arms (fists on the handle), both legs (planted feet). Returns a dict of diagnostics (errors in cm)."""
    diag = {}
    pose.set_world('Hammer', hammer_world)
    hw = hammer_world
    for side, gname in (('Left', 'Left'), ('Right', 'Right')):
        T = hw @ GRIP_POS[gname]
        diag['reach_err_' + side] = two_bone(pose, side + 'Arm', side + 'ForeArm', side + 'Hand', T, poles[side], hw.to_3x3() @ GRIP_ROT[gname], ref=OLD12_B)
    for side in ('Left', 'Right'):
        sgn = 1 if side == 'Left' else -1
        pole = Vector((sgn * knee_out, -1.0, 0.0))
        foot = FOOT_P[side + 'Foot']
        diag['leg_err_' + side] = two_bone(pose, side + 'UpLeg', side + 'Leg', side + 'Foot', foot.translation, pole, foot.to_3x3())
        pose.B[side + 'ToeBase'] = FOOT_B[side + 'ToeBase'].copy()
    return diag


def keyed_pose(p, hammer_world, poles):
    pose = build_pose(p)
    diag = finish_pose(pose, hammer_world, poles)
    return pose, diag


V = Vector
POLE_OUT = {'Left': V((1, 0.1, 0.1)), 'Right': V((-1, 0.1, 0.1))}
POLE_HIGH = {'Left': V((1, -0.1, 0.5)), 'Right': V((-1, -0.1, 0.5))}
POLE_OLD = {'Left': pole_from_old('Left'), 'Right': pole_from_old('Right')}

# READY: hammer on the right shoulder, head of the hammer behind the head, fists near the butt in front of the chest, elbows out
READY = dict(hips=(0, 0.012, -0.020), hips_rot=(0, 0, 0), spine=((0, 0, 0), (-3, 0, 0), (-4, 0, 0)), neck=(2, 0, 0), head=(2, 0, 0),
             clav_l=(0, 0, 0), clav_r=(0, 0, 0))
READY_HAMMER = (V((-0.05, -0.26, 0.90)), V((-0.20, 0.62, 0.76)))
# roll of the hammer about its handle (deg). The hammer mesh has a leather strap on the bone -X side; with roll 0 it hangs into the chest /
# shoulder in the ready pose. 35 / 30 deg was the best of 0, 20, 35, 45, 60, 90, 120, 150, 180 (180 is cleaner but would spin the hammer
# 180 deg about its handle between frames 6 and 12). Roll goes back to 0 at the impact (old frame-12 matrix).
READY_ROLL = 35.0
WIND_ROLL = 30.0
# WIND-UP (frame 6): torso rolled back, hammer cocked above and behind the head, elbows high and out
WIND = dict(hips=(0, -0.025, -0.020), hips_rot=(-4, 0, 0), spine=((-6, 0, 0), (-7, 0, 0), (-7, 0, 0)), neck=(6, 0, 0), head=(8, 0, 0),
            clav_l=(0, 0, -10), clav_r=(0, 0, 10))
WIND_HAMMER = (V((-0.02, -0.20, 1.30)), V((-0.04, 0.92, 0.34)))


def impact_pose():
    """frame 12 / 14: body = old swing_hit frame 12 (copied bones), hammer = old frame-12 Hammer matrix, arms re-solved"""
    pose = Pose({n: OLD12_B[n] for n in ('Hips', 'Spine02', 'Spine01', 'Spine', 'neck', 'Head', 'head_end', 'headfront', 'LeftShoulder', 'RightShoulder')})
    diag = finish_pose(pose, H12, POLE_OLD)
    return pose, diag



# --------------------------------------------------------------------------------------------------------- key poses (stage 2)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import verify_glb as vg  # noqa: E402
import numpy as np  # noqa: E402,F401

READY_VARIANTS = {  # (butt m, handle direction): hammer on the right shoulder, right fist near the butt, left fist 0.216 m along the handle
    'a': (V((-0.05, -0.26, 0.90)), V((-0.20, 0.62, 0.76))),
    'b': (V((-0.10, -0.30, 0.96)), V((-0.16, 0.66, 0.74))),
    'c': (V((-0.02, -0.30, 1.00)), V((-0.30, 0.62, 0.72))),
    'd': (V((-0.08, -0.34, 1.04)), V((-0.22, 0.70, 0.68))),
    'e': (V((-0.08, -0.34, 0.98)), V((-0.22, 0.66, 0.72))),
    'f': (V((-0.10, -0.37, 1.01)), V((-0.24, 0.66, 0.70))),
    'g': (V((-0.06, -0.33, 0.94)), V((-0.20, 0.62, 0.76))),
}
READY_HAMMER = READY_VARIANTS[os.environ.get('READY', 'e')]
POLE_OUT = {'Left': V((1, 0.1, 0.1)), 'Right': V((-1, 0.1, 0.1))}
WIND_HAMMER = (V((-0.02, -0.20, 1.30)), V((-0.04, 0.92, 0.34)))
POLE_HIGH = {'Left': V((1, -0.1, 0.5)), 'Right': V((-1, -0.1, 0.5))}
BODY_BONES = ('Hips', 'Spine02', 'Spine01', 'Spine', 'neck', 'Head', 'head_end', 'headfront', 'LeftShoulder', 'RightShoulder')
REBOUND_DZ, REBOUND_PITCH = 0.075, 9.0


class Key:
    """a key pose: local bases of the body bones, hammer (butt position m + handle direction, roll 0), elbow poles"""

    def __init__(self, body, butt, d, poles):
        self.body, self.butt, self.d, self.poles = {n: body[n].copy() for n in BODY_BONES}, butt.copy(), d.normalized(), poles


def key_from_pose(pose, hammer_world, poles):
    y = (hammer_world.to_3x3() @ V((0, 1, 0))).normalized()
    return Key(pose.B, hammer_world.translation / CM - y * 0.36, y, poles)


def make_keys():
    keys = {}
    keys[0] = key_from_pose(build_pose(READY), hammer_matrix(*READY_HAMMER), POLE_OUT)
    keys[6] = key_from_pose(build_pose(WIND), hammer_matrix(*WIND_HAMMER), POLE_HIGH)
    p12, _ = impact_pose()
    keys[12] = key_from_pose(p12, H12, POLE_OLD)
    keys[14] = keys[12]
    p19 = Pose({n: OLD12_B[n] for n in BODY_BONES})
    p19.add_local_rot('Spine02', (-3, 0, 0))
    p19.add_local_rot('Spine01', (-4, 0, 0))
    p19.add_local_rot('Spine', (-3, 0, 0))
    p19.add_local_rot('Head', (3, 0, 0))
    grip = (H12 @ GRIP_POS['Right']).copy()
    h19 = trans(V((0, 0, REBOUND_DZ * CM))) @ about(grip, Matrix.Rotation(math.radians(-REBOUND_PITCH), 3, 'X')) @ H12
    keys[19] = key_from_pose(p19, h19, POLE_OLD)
    keys[48] = keys[0]
    return keys


# easing of each segment of swing_hit: (frame a, frame b, ease, swing direction of the handle in the YZ plane (0 = shortest), grip bulge m)
ease_io = lambda t: t * t * (3 - 2 * t)  # noqa: E731
ease_in = lambda t: t ** 2.2  # noqa: E731
ease_out = lambda t: 1 - (1 - t) ** 2.5  # noqa: E731
ease_io5 = lambda t: t * t * t * (t * (6 * t - 15) + 10)  # noqa: E731
SEGMENTS = [(0, 6, ease_io, 0, V((0, 0, 0))), (6, 12, ease_in, +1, V((0, -0.04, 0.05))), (12, 14, lambda t: 0.0, 0, V((0, 0, 0))),
            (14, 19, ease_out, 0, V((0, 0, 0))), (19, 48, ease_io5, -1, V((0, -0.02, 0.03)))]


def lerp_basis(a, b, t):
    ta, qa, _ = a.decompose()
    tb, qb, _ = b.decompose()
    return trans(ta.lerp(tb, t)) @ qa.slerp(qb, t).to_matrix().to_4x4()


def arc_dir(d0, d1, t, direction):
    """handle direction swung in the YZ plane (angle th = atan2(z, y)), the x part blended linearly; direction +1 / -1 / 0 (shortest)"""
    a0, a1 = math.degrees(math.atan2(d0.z, d0.y)), math.degrees(math.atan2(d1.z, d1.y))
    if direction == 0:
        delta = ((a1 - a0 + 180) % 360) - 180
    elif direction > 0:
        delta = (a1 - a0) % 360
    else:
        delta = -((a0 - a1) % 360)
    x = d0.x + (d1.x - d0.x) * t
    s = math.sqrt(max(0.0, 1 - x * x))
    a = math.radians(a0 + delta * t)
    return V((x, s * math.cos(a), s * math.sin(a)))


def frame_state(k0, k1, t, direction, bulge):
    body = {n: lerp_basis(k0.body[n], k1.body[n], t) for n in BODY_BONES}
    d = arc_dir(k0.d, k1.d, t, direction)
    butt = k0.butt.lerp(k1.butt, t) + bulge * (4 * t * (1 - t))
    poles = {s: k0.poles[s].lerp(k1.poles[s], t) for s in ('Left', 'Right')}
    return body, butt, d, poles


def solve_frame(body, butt, d, poles, extra=None):
    pose = Pose(body)
    if extra:
        extra(pose)
    diag = finish_pose(pose, hammer_matrix(butt, d), poles)
    return pose, diag


def swing_hit_frames(keys):
    out = []
    for f in range(0, LAST + 1):
        a, b, ease, direction, bulge = next(s for s in SEGMENTS if s[0] <= f <= s[1] and (f < s[1] or s[1] == LAST))
        t = ease((f - a) / (b - a))
        body, butt, d, poles = frame_state(keys[a], keys[b], t, direction, bulge)
        out.append(solve_frame(body, butt, d, poles))
    return out


def swing_ready_frames(keys):
    out = []
    k = keys[0]
    for f in range(0, LAST + 1):
        s = math.sin(2 * math.pi * f / LAST)  # one slow breath per loop; frames 0 and 48 are identical

        def extra(pose, s=s):
            pose.add_local_rot('Spine02', (0.5 * s, 0, 0))
            pose.add_local_rot('Spine01', (0.7 * s, 0, 0))
            pose.add_local_rot('Spine', (0.8 * s, 0, 0))
            pose.add_local_rot('LeftShoulder', (0, 0, -1.2 * s))
            pose.add_local_rot('RightShoulder', (0, 0, 1.2 * s))
        out.append(solve_frame(k.body, k.butt + V((0, 0, 0.004 * s)), k.d, k.poles, extra))
    return out


# --------------------------------------------------------------------------------------------------------- swing_raise
gm = vg.Gltf(os.path.join(ROOT, 'blender', 'originals', 'dwarf_moves.glb'))
gd = vg.Gltf(os.path.join(ROOT, 'blender', 'originals', 'dwarf.glb'))
rig, rig_m = vg.Rig(gd), vg.Rig(gm)
C4 = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # glTF (x, y, z) -> Blender (x, -z, y)
CM3 = Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0)))  # Blender vector -> three.js / glTF vector
PICK_TO = 2.9  # PICK.to in dist/scene3d.js: where Male_Bend_Over_Pick_Up stops when he is about to swing


def pickup_pose(t=PICK_TO):
    """local bases of the 24 bones at second t of Male_Bend_Over_Pick_Up (dwarf_moves.glb tracks applied to the dwarf skeleton by node NAME,
    same retarget as check_modular.py: node frame -> bone frame by the constant offset K measured in the rest pose)"""
    anim = next(a for a in gm.j['animations'] if a['name'] == 'Male_Bend_Over_Pick_Up')
    ch = {}
    for (ni, path), v in rig_m.sample_channels(anim).items():
        nm = rig_m.name[ni]
        if nm in rig.byname:
            ch[(rig.byname[nm], path)] = v
    W_rest, _ = rig.pose({}, 0.0)
    W, _ = rig.pose(ch, t)
    arm_inv = arm.matrix_world.inverted()

    def conv(M):
        return C4 @ Matrix(M.tolist()) @ C4.inverted()
    pose = Pose()
    for n in ORDER:
        if n == 'Hammer':
            continue
        ni = rig.byname[n]
        K = (arm_inv @ conv(W_rest[ni])).inverted() @ REST[n]
        pose.set_world(n, arm_inv @ conv(W[ni]) @ K)
    return pose


def game_hand_hammer(pose):
    """Hammer bone world matrix (armature space, cm) that makes the Hammer-bone placement equal placeHammer()'s 'hand' mode:
    p = RightHand + 0.4 L * axis(.1,-1,.3), q = basisQuat(axis, (1,0,0)) * HAMMER_FIX (three.js axes); converted with the measured relation
    mesh rotation = R_bone * Rx(-90) * Ry(90) (render_preview.py). Returns (matrix, handle direction in Blender axes)."""
    hand_t = CM3 @ (pose.P('RightHand').translation / CM)
    axis = V((0.1, -1, 0.3)).normalized()
    z = V((1, 0, 0)).cross(axis).normalized()
    x = axis.cross(z)
    Q = Matrix(((x.x, axis.x, z.x), (x.y, axis.y, z.y), (x.z, axis.z, z.z)))
    M = Q @ Matrix.Rotation(math.radians(-90), 3, 'Z')
    mesh_B = CM3.inverted() @ M @ CM3
    fix = Matrix.Rotation(math.radians(-90), 3, 'X') @ Matrix.Rotation(math.radians(90), 3, 'Y')
    R_bone = mesh_B @ fix.inverted()
    centre_t = hand_t + axis * (0.4 * 0.72)
    return trans((CM3.inverted() @ centre_t) * CM) @ R_bone.to_4x4(), CM3.inverted() @ axis


def swing_raise_frames(keys):
    p_start = pickup_pose()
    h_start, d_start = game_hand_hammer(p_start)
    p_end, _ = solve_frame(keys[0].body, keys[0].butt, keys[0].d, keys[0].poles)
    y0 = (h_start.to_3x3() @ V((0, 1, 0))).normalized()
    butt0 = h_start.translation / CM - y0 * 0.36
    base = hammer_matrix(butt0, y0).to_3x3()
    z_b, z_s = base.col[2], h_start.to_3x3().col[2]
    roll0 = math.atan2(z_b.cross(z_s).dot(y0), z_b.dot(z_s))  # roll of the start hammer about its handle vs the roll-0 frame
    out = []
    for f in range(RAISE_LAST + 1):
        e = ease_io(f / RAISE_LAST)
        B = {n: lerp_basis(p_start.B[n], p_end.B[n], e) for n in NAMES if n != 'Hammer'}
        d = arc_dir(y0, keys[0].d, e, -1)
        butt = butt0.lerp(keys[0].butt, e) + V((0, -0.06, 0.12)) * (4 * e * (1 - e))
        hw = hammer_matrix(butt, d) @ Matrix.Rotation(roll0 * (1 - e), 4, 'Y')
        pose = Pose(B)
        zero = {'reach_err_Left': 0.0, 'reach_err_Right': 0.0, 'leg_err_Left': 0.0, 'leg_err_Right': 0.0}
        if f == 0:
            pose.set_world('Hammer', h_start)
            out.append((pose, zero))
            continue
        if f == RAISE_LAST:
            out.append((p_end, zero))
            continue
        fk = {n: pose.B[n].copy() for n in ('LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand')}
        pose.set_world('Hammer', hw)
        diag = dict(zero)
        for side in ('Left', 'Right'):
            diag['reach_err_' + side] = two_bone(pose, side + 'Arm', side + 'ForeArm', side + 'Hand', hw @ GRIP_POS[side], keys[0].poles[side],
                                                 hw.to_3x3() @ GRIP_ROT[side], ref=OLD12_B)
        wr, wl = ease_io(min(1.0, f / 7.0)), ease_io(min(1.0, max(0.0, (f - 5) / 8.0)))  # right fist is on the handle from the start, the left one joins later
        for n, m in fk.items():
            w = wl if n.startswith('Left') else wr
            pose.B[n] = lerp_basis(m, pose.B[n], w)
        for side in ('Left', 'Right'):  # real distance of the wrist to the grip point (cm) after the blend
            diag['reach_err_' + side] = (pose.P(side + 'Hand').translation - (hw @ GRIP_POS[side])).length
        out.append((pose, diag))
    return out


# --------------------------------------------------------------------------------------------------------- actions
def make_action_frames(name, frames):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    slot = act.slots.new('OBJECT', 'Armature')
    arm.animation_data.action = act
    arm.animation_data.action_slot = slot
    prev = {}
    for f, (pose, _) in enumerate(frames):
        for n in NAMES:
            pb = arm.pose.bones[n]
            pb.matrix_basis = pose.B[n]
            q = pb.rotation_quaternion.copy()
            if n in prev:
                q.make_compatible(prev[n])
            pb.rotation_quaternion = q
            prev[n] = q.copy()
            pb.keyframe_insert('location', frame=f, group=n)
            pb.keyframe_insert('rotation_quaternion', frame=f, group=n)
            pb.keyframe_insert('scale', frame=f, group=n)
    for layer in act.layers:
        for strip in layer.strips:
            for cb in strip.channelbags:
                for fc in cb.fcurves:
                    for kp in fc.keyframe_points:
                        kp.interpolation = 'LINEAR'
    return act


def reset_pose():
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)


def main():
    keys = make_keys()
    clips = {'swing_hit': swing_hit_frames(keys), 'swing_ready': swing_ready_frames(keys), 'swing_raise': swing_raise_frames(keys)}
    for name, fr in clips.items():
        worst = {k: max(d[k] for _, d in fr) for k in fr[0][1]}
        print('IKERR', name, {k: round(v, 3) for k, v in worst.items()}, 'frames', len(fr))
        print('IKFRAMES', name, [(i, round(d['reach_err_Left'], 1), round(d['reach_err_Right'], 1)) for i, (_, d) in enumerate(fr) if max(d['reach_err_Left'], d['reach_err_Right']) > 0.5])
    for f in KEY_FRAMES:
        pose, dg = clips['swing_hit'][f]
        hw = unscale(pose.P('Hammer'))
        print('POSE f%02d hammer centre %s head-block %s  reach L %.2f R %.2f cm' % (f, tuple(round(c / CM, 3) for c in hw.translation),
              tuple(round(c / CM, 3) for c in (hw @ Vector((0, 0.25 * CM, 0)))), dg['reach_err_Left'], dg['reach_err_Right']))
    if PRINT_ONLY:
        return
    for a in list(bpy.data.actions):
        if a.name in clips:
            bpy.data.actions.remove(a)
    for name, fr in clips.items():
        reset_pose()
        make_action_frames(name, fr)
    arm.animation_data.action = bpy.data.actions['swing_ready']
    arm.animation_data.action_slot = bpy.data.actions['swing_ready'].slots[0]
    scene.frame_start, scene.frame_end = 0, LAST
    scene.frame_set(0)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=True)
    print('SAVED', OUT, [(a.name, a.use_fake_user, tuple(a.frame_range)) for a in bpy.data.actions])


main()
