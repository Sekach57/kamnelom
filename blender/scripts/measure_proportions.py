"""Body measurements per zone in the REST pose, for char1 (blender/src/dwarf.blend) and for the modular dwarf (dwarf_modular.blend).

  blender -b blender/src/dwarf.blend --python blender/scripts/measure_proportions.py -- OUT.json
  blender -b blender/src/dwarf_modular.blend --python blender/scripts/measure_proportions.py -- OUT.json
  python blender/scripts/measure_proportions.py --table char1.json new.json      (plain Python, prints the comparison table)

Zones are the same ones analyze_dwarf_mesh.py uses (bone -> zone); a vertex belongs to the zone of its dominant bone (char1: summed weights).
Units: metres. Girth = 2 x radial distance (95th percentile) of the zone's vertices around the bone axis, middle half of the segment.
"""
import json
import sys

ZONES = {
    'head': ['neck', 'Head', 'head_end', 'headfront'],
    'torso': ['Hips', 'Spine', 'Spine01', 'Spine02'],
    'armL': ['LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand'],
    'armR': ['RightShoulder', 'RightArm', 'RightForeArm', 'RightHand'],
    'legL': ['LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase'],
    'legR': ['RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'],
}


def measure():
    import bpy
    import numpy as np
    arm = bpy.data.objects['Armature']
    IS_CHAR1 = 'char1' in bpy.data.objects
    for pb in arm.pose.bones:
        pb.location, pb.rotation_quaternion, pb.scale = (0, 0, 0), (1, 0, 0, 0), (1, 1, 1)
    if arm.animation_data:
        arm.animation_data.action = None
    arm.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    bone_zone = {b: z for z, bs in ZONES.items() for b in bs}
    pts, zone, bone, edges = [], [], [], []
    off = 0
    for ob in bpy.data.objects:
        if ob.type != 'MESH' or not (ob.name == 'char1' or ob.name.startswith('part_')):
            continue
        e = ob.evaluated_get(dg)
        me = e.to_mesh()
        names = {g.index: g.name for g in ob.vertex_groups}
        co = np.empty(len(me.vertices) * 3)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        M = np.array(ob.matrix_world)
        co = co @ M[:3, :3].T + M[:3, 3]
        src = ob.data.vertices
        for i in range(len(me.vertices)):
            s = {}
            for g in src[i].groups:
                s[names[g.group]] = s.get(names[g.group], 0) + g.weight
            zs = {}
            for n, w in s.items():
                if n in bone_zone:
                    zs[bone_zone[n]] = zs.get(bone_zone[n], 0) + w
            zone.append(max(zs, key=zs.get) if zs else 'none')
            bone.append(max(s, key=s.get) if s else '')
        pts.append(co)
        ee = np.empty(len(me.edges) * 2, dtype=int)
        me.edges.foreach_get('vertices', ee)
        edges.append(ee.reshape(-1, 2) + off)
        off += len(co)
        e.to_mesh_clear()
    P = np.vstack(pts)
    E = np.vstack(edges)
    zone, bone = np.array(zone), np.array(bone)
    zone = np.where(np.isin(bone, ['LeftShoulder', 'RightShoulder']), 'clav', zone)  # clavicle bones: the sides of the chest, kept out of the arm zones
    H = {n: np.array(arm.matrix_world @ b.head_local) for n, b in arm.data.bones.items()}

    def ext(sel, ax, q=0.0):
        if not sel.any():
            return 0.0
        v = P[sel][:, ax]
        return float(np.percentile(v, 100 - q) - np.percentile(v, q))

    def cut(axis_o, axis_d, t_val, zones):
        """points where mesh edges cross the plane through axis_o + t*axis_d normal to axis_d (axis_d unit); only edges in `zones`"""
        s_ = (P - axis_o) @ axis_d - t_val
        a_, b_ = E[:, 0], E[:, 1]
        m = (s_[a_] * s_[b_] < 0) & (np.isin(zone[a_], zones) | np.isin(zone[b_], zones))
        a_, b_ = a_[m], b_[m]
        f = (s_[a_] / (s_[a_] - s_[b_]))[:, None]
        return P[a_] + (P[b_] - P[a_]) * f

    R = {'height': float(P[:, 2].max() - P[:, 2].min())}
    sh = (np.abs(P[:, 2] - 1.043) < 0.03) & (zone != 'head') & (zone != 'legL') & (zone != 'legR')
    R['shoulder_width (z 1.01-1.07, torso+arms)'] = ext(sh, 0)
    Z = np.array([0, 0, 1.0])
    for nm, h, zs in (('chest z0.93 (torso+clavicle zone)', 0.93, ['torso', 'clav']), ('waist z0.84', 0.84, ['torso']), ('hips z0.74', 0.74, ['torso', 'legL', 'legR'])):
        c = cut(np.zeros(3), Z, h, zs)
        R['torso %s width' % nm] = float(np.percentile(c[:, 0], 98) - np.percentile(c[:, 0], 2))  # 2..98 percentile: ignores stray beard / hair tips
        R['torso %s depth' % nm] = float(np.percentile(c[:, 1], 98) - np.percentile(c[:, 1], 2))

    def girth(zn, a, b):
        """limb diameter: cross-section at 40 / 50 / 60 % of the bone segment; vertices from the axis outwards until the first radial gap > 2 cm"""
        p0, p1 = H[a], H[b]
        d = p1 - p0
        L = np.linalg.norm(d)
        d /= L
        out = []
        for t in (0.4, 0.5, 0.6):
            c = cut(p0, d, t * L, [zn])
            rad = np.linalg.norm((c - p0) - np.outer((c - p0) @ d, d), axis=1)
            r = np.sort(rad[rad < 0.2])
            if len(r) < 3:
                continue
            if IS_CHAR1:  # one blob mesh: stop at the first radial gap so neighbouring armour / body is not counted
                gaps = np.where(np.diff(r) > 0.02)[0]
                out.append(2 * r[:(gaps[0] + 1 if len(gaps) else len(r))].max())
            else:  # separate rigid parts (balls at the joints sit inside the limb): the outermost shell of the zone is the limb
                out.append(2 * r.max())
        return float(np.mean(out)) if out else 0.0

    R['upper arm girth'] = girth('armL', 'LeftArm', 'LeftForeArm')
    R['forearm girth'] = girth('armL', 'LeftForeArm', 'LeftHand')
    R['thigh girth'] = girth('legL', 'LeftUpLeg', 'LeftLeg')
    R['shin girth'] = girth('legL', 'LeftLeg', 'LeftFoot')
    hd = zone == 'head'
    R['head width'], R['head depth'], R['head height'] = ext(hd, 0), ext(hd, 1), ext(hd, 2)
    ft = (bone == 'LeftFoot') | (bone == 'LeftToeBase')
    R['foot length (y)'], R['foot width (x)'], R['foot height (z)'] = ext(ft, 1), ext(ft, 0), ext(ft, 2)
    fist = (bone == 'LeftHand')
    R['hand/fist size x'], R['hand/fist size y'], R['hand/fist size z'] = ext(fist, 0), ext(fist, 1), ext(fist, 2)
    c = cut(np.zeros(3), Z, 1.015, ['torso', 'head'])
    c = c[np.abs(c[:, 0]) < 0.12]
    R['neck slice z1.015 width'], R['neck slice z1.015 depth'] = float(np.ptp(c[:, 0])), float(np.ptp(c[:, 1]))
    R['neck bone length (Head-neck, bones)'] = float(np.linalg.norm(H['Head'] - H['neck']))
    return R


if __name__ == '__main__':
    if '--table' in sys.argv:
        a, b = (json.load(open(f)) for f in sys.argv[sys.argv.index('--table') + 1:][:2])
        print('%-44s %8s %8s %8s' % ('measure (m)', 'char1', 'new', 'dev %'))
        for k in a:
            d = (b[k] - a[k]) / a[k] * 100 if a[k] else 0
            print('%-44s %8.3f %8.3f %+7.0f%s' % (k, a[k], b[k], d, '' if abs(d) <= 10 else '  <--'))
    else:
        out = sys.argv[sys.argv.index('--') + 1]
        json.dump(measure(), open(out, 'w'), indent=1)
        print('MEASURED', out)
