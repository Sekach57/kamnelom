"""Stage 1 of the new swing clips: BLOCKING (key poses only, linear between keys, no easing, no breathing).

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

KEY_FRAMES = [0, 6, 12, 14, 20, 48]
LAST = 48

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


REBOUND_DZ, REBOUND_PITCH = 0.075, 9.0  # frame 20: hammer translated up and the head end pitched up about the right grip


def rebound_pose():
    pose = Pose({n: OLD12_B[n] for n in ('Hips', 'Spine02', 'Spine01', 'Spine', 'neck', 'Head', 'head_end', 'headfront', 'LeftShoulder', 'RightShoulder')})
    # the body gives back: chest rolls back a few degrees, hips come up 1.5 cm, head follows
    pose.add_local_rot('Spine02', (-3, 0, 0))
    pose.add_local_rot('Spine01', (-4, 0, 0))
    pose.add_local_rot('Spine', (-3, 0, 0))
    pose.add_local_rot('Head', (3, 0, 0))
    pose.B['Hips'] = trans(V((0, 0.012, 0.015)) * CM) @ OLD12_B['Hips'] if False else pose.B['Hips']
    grip = (H12 @ GRIP_POS['Right']).copy()
    hw = trans(V((0, 0, REBOUND_DZ * CM))) @ about(grip, Matrix.Rotation(math.radians(-REBOUND_PITCH), 3, 'X')) @ H12
    diag = finish_pose(pose, hw, POLE_OLD)
    return pose, diag


def make_poses():
    ready_h = hammer_matrix(*READY_HAMMER, roll=READY_ROLL)
    wind_h = hammer_matrix(*WIND_HAMMER, roll=WIND_ROLL)
    poses, diags = {}, {}
    poses[0], diags[0] = keyed_pose(READY, ready_h, POLE_OUT)
    poses[6], diags[6] = keyed_pose(WIND, wind_h, POLE_HIGH)
    poses[12], diags[12] = impact_pose()
    poses[14] = poses[12]
    diags[14] = diags[12]
    poses[20], diags[20] = rebound_pose()
    poses[48] = poses[0]
    diags[48] = diags[0]
    return poses, diags


# --------------------------------------------------------------------------------------------------------- build actions
def make_action(name, keys, poses):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    slot = act.slots.new('OBJECT', 'Armature')
    arm.animation_data.action = act
    arm.animation_data.action_slot = slot
    prev = {}
    for f in keys:
        for n in NAMES:
            pb = arm.pose.bones[n]
            pb.matrix_basis = poses[f].B[n]
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


def report(poses, diags):
    for f in KEY_FRAMES:
        pose = poses[f]
        hw = unscale(pose.P('Hammer'))
        head = hw @ Vector((0, 0.246 * CM, 0))
        el = {s: tuple(round(c / CM, 3) for c in pose.P(s + 'ForeArm').translation) for s in ('Left', 'Right')}
        print('POSE f%02d hammer centre %s dir %s head-block %s elbowL %s elbowR %s reach_err L %.2f R %.2f cm, leg_err L %.2f R %.2f cm' % (
            f, tuple(round(c / CM, 3) for c in hw.translation), tuple(round(c, 2) for c in (hw.to_3x3() @ V((0, 1, 0)))),
            tuple(round(c / CM, 3) for c in head), el['Left'], el['Right'], diags[f]['reach_err_Left'], diags[f]['reach_err_Right'],
            diags[f]['leg_err_Left'], diags[f]['leg_err_Right']))


def main():
    poses, diags = make_poses()
    report(poses, diags)
    if PRINT_ONLY:
        return
    for a in list(bpy.data.actions):
        if a.name in ('swing_ready', 'swing_hit'):
            bpy.data.actions.remove(a)
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    make_action('swing_ready', [0, LAST], poses)
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    make_action('swing_hit', KEY_FRAMES, poses)
    arm.animation_data.action = bpy.data.actions['swing_ready']
    arm.animation_data.action_slot = bpy.data.actions['swing_ready'].slots[0]
    scene.frame_start, scene.frame_end = 0, LAST
    scene.frame_set(0)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=True)
    print('SAVED', OUT, [(a.name, a.use_fake_user, tuple(a.frame_range)) for a in bpy.data.actions])


main()
