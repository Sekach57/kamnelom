"""Phase 1 step 1: read-only analysis of the dwarf mesh `char1` (weights, zones, loose parts, head interior).

  blender -b blender/src/dwarf.blend --python blender/scripts/analyze_dwarf_mesh.py -- blender/reports/phase1_mesh_analysis.json

Does not save the .blend. Prints a short summary and writes the JSON.
"""
import json
import os
import sys
from collections import Counter, defaultdict

import bpy
import bmesh
import numpy as np

out = os.path.abspath(sys.argv[sys.argv.index('--') + 1])
ob = bpy.data.objects['char1']
bpy.data.objects['Armature'].data.pose_position = 'REST'  # analysis in the T-pose; session is never saved
bpy.context.view_layer.update()
me = ob.data
arm = bpy.data.objects['Armature']
mw = ob.matrix_world
vg_name = {g.index: g.name for g in ob.vertex_groups}

ZONES = {
    'head': ['neck', 'Head', 'head_end', 'headfront'],
    'torso': ['Hips', 'Spine', 'Spine01', 'Spine02'],
    'armL': ['LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand'],
    'armR': ['RightShoulder', 'RightArm', 'RightForeArm', 'RightHand'],
    'legL': ['LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase'],
    'legR': ['RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'],
}
bone_zone = {b: z for z, bs in ZONES.items() for b in bs}
R = {}
R['vertices'], R['triangles'] = len(me.vertices), sum(len(p.vertices) - 2 for p in me.polygons)
R['vertex_groups'] = len(ob.vertex_groups)
R['groups_not_in_skeleton'] = [g.name for g in ob.vertex_groups if g.name not in bone_zone and g.name != 'Hammer']

# --- influences per vertex ---------------------------------------------------------------------------------------
W = np.zeros((len(me.vertices), len(ob.vertex_groups)), dtype=np.float32)
for v in me.vertices:
    for g in v.groups:
        W[v.index, g.group] = g.weight
nz = (W > 1e-4).sum(1)
R['influences_per_vertex'] = {str(k): int((nz == k).sum()) for k in sorted(set(nz.tolist()))}
R['weight_sum_min_max'] = [round(float(W.sum(1).min()), 4), round(float(W.sum(1).max()), 4)]
R['weight_on_Hammer'] = float(W[:, [g.index for g in ob.vertex_groups if g.name == 'Hammer']].sum()) if 'Hammer' in ob.vertex_groups else 0.0

# --- zone share per vertex -----------------------------------------------------------------------------------------
names = [g.name for g in ob.vertex_groups]
zk = list(ZONES)
Z = np.zeros((len(me.vertices), len(zk)), dtype=np.float32)
for gi, n in enumerate(names):
    if n in bone_zone:
        Z[:, zk.index(bone_zone[n])] += W[:, gi]
dom = Z.argmax(1)
share = Z.max(1) / np.maximum(Z.sum(1), 1e-6)
R['vertices_by_dominant_zone'] = {z: int((dom == i).sum()) for i, z in enumerate(zk)}
R['vertices_zone_share'] = {'>=0.99': int((share >= 0.99).sum()), '0.9-0.99': int(((share >= 0.9) & (share < 0.99)).sum()),
                            '<0.9 (blend)': int((share < 0.9).sum())}
bone_dom = Counter(names[i] for i in W.argmax(1))
R['vertices_by_dominant_bone'] = dict(bone_dom.most_common())

# --- triangles by zone, seam triangles -----------------------------------------------------------------------------
me.calc_loop_triangles()
tz = Counter()
seam = 0
seam_pairs = Counter()
for t in me.loop_triangles:
    zs = {int(dom[i]) for i in t.vertices}
    c = Counter(int(dom[i]) for i in t.vertices).most_common(1)[0][0]
    tz[zk[c]] += 1
    if len(zs) > 1:
        seam += 1
        seam_pairs['/'.join(sorted(zk[i] for i in zs))] += 1
R['triangles_by_zone_majority'] = dict(tz)
R['seam_triangles'] = seam
R['seam_pairs'] = dict(seam_pairs.most_common())

# --- zone extents in model units (world, armature scale 0.01 included) ----------------------------------------------
P = np.array([(mw @ v.co)[:] for v in me.vertices])
R['bbox_min'], R['bbox_max'] = [round(float(x), 3) for x in P.min(0)], [round(float(x), 3) for x in P.max(0)]
R['zone_extent'] = {}
for i, z in enumerate(zk):
    m = dom == i
    if m.any():
        R['zone_extent'][z] = {'min': [round(float(x), 3) for x in P[m].min(0)], 'max': [round(float(x), 3) for x in P[m].max(0)]}

# --- does weight-zone follow geometry? vertices in the central column |x|<0.17 by height band, share by dominant zone ----
bands = [(0.0, 0.4), (0.4, 0.75), (0.75, 0.95), (0.95, 1.3)]
R['central_column_by_height'] = {}
for lo, hi in bands:
    m = (np.abs(P[:, 0]) < 0.17) & (P[:, 2] >= lo) & (P[:, 2] < hi)
    n = int(m.sum())
    R['central_column_by_height']['%.2f-%.2f' % (lo, hi)] = {'vertices': n, **{z: round(float((dom[m] == i).sum()) / max(n, 1), 2) for i, z in enumerate(zk)}}

# --- loose parts / open edges ---------------------------------------------------------------------------------------
bm = bmesh.new()
bm.from_mesh(me)
R['vertices_after_merge_by_position'] = None
bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)  # the file splits vertices on UV/normal seams
R['vertices_after_merge_by_position'] = len(bm.verts)
bm.verts.ensure_lookup_table()
seen, comps = set(), []
for v0 in bm.verts:
    if v0.index in seen:
        continue
    stack, comp = [v0], []
    seen.add(v0.index)
    while stack:
        v = stack.pop()
        comp.append(v.index)
        for e in v.link_edges:
            o = e.other_vert(v)
            if o.index not in seen:
                seen.add(o.index)
                stack.append(o)
    comps.append(comp)
comps.sort(key=len, reverse=True)
R['loose_parts'] = len(comps)
R['loose_part_sizes_top10'] = [len(c) for c in comps[:10]]
R['open_boundary_edges'] = sum(1 for e in bm.edges if e.is_boundary)
R['non_manifold_edges'] = sum(1 for e in bm.edges if not e.is_manifold and not e.is_boundary)
bm.free()

# --- head interior --------------------------------------------------------------------------------------------------
# The decisive check is the sagittal section below (plotted by the report): one outer skin only, no skull inside the beard.
head_idx = np.where(dom == zk.index('head'))[0]
hp = P[head_idx]
R['head_zone'] = {'vertices': int(len(head_idx)), 'bbox_min': [round(float(x), 3) for x in hp.min(0)], 'bbox_max': [round(float(x), 3) for x in hp.max(0)]}

# --- sagittal section x=0 (+ x=0.045 off-centre) of the head for a plot ---------------------------------------------------
sec = {}
for xc in (0.0, 0.045):
    b2 = bmesh.new()
    b2.from_mesh(me)
    bmesh.ops.transform(b2, matrix=mw, verts=b2.verts)
    g = b2.verts[:] + b2.edges[:] + b2.faces[:]
    r = bmesh.ops.bisect_plane(b2, geom=g, plane_co=(xc, 0, 0), plane_no=(1, 0, 0), clear_inner=False, clear_outer=False)
    segs = []
    for e in (x for x in r['geom_cut'] if isinstance(x, bmesh.types.BMEdge)):
        a, b = e.verts[0].co, e.verts[1].co
        if min(a.z, b.z) > 0.9:
            segs.append([round(a.y, 4), round(a.z, 4), round(b.y, 4), round(b.z, 4)])
    sec[str(xc)] = segs
    b2.free()
json.dump(sec, open(os.path.splitext(out)[0] + '_head_section.json', 'w'))

# --- UV / texture ---------------------------------------------------------------------------------------------------
uv = me.uv_layers.active.data
us = np.array([l.uv[:] for l in uv])
R['uv_range'] = [[round(float(x), 3) for x in us.min(0)], [round(float(x), 3) for x in us.max(0)]]
# UV area per zone as a share of total UV area (how much of the 2048 texture each zone uses)
area = defaultdict(float)
for t in me.loop_triangles:
    a, b, c = (np.array(uv[l].uv[:]) for l in t.loops)
    ar = abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2
    z = zk[Counter(int(dom[i]) for i in t.vertices).most_common(1)[0][0]]
    area[z] += ar
tot = sum(area.values())
R['uv_area_share_by_zone'] = {z: round(a / tot, 3) for z, a in area.items()}
R['uv_total_area_of_unit_square'] = round(tot, 3)

os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump(R, open(out, 'w'), indent=1)
print(json.dumps(R, indent=1))
