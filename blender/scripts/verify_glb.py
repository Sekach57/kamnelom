#!/usr/bin/env python3
"""Checks a Dwarf Gym .glb against the pipeline invariants (docs/BLENDER_PIPELINE.md, section 1 and 3).

Runs without Blender: it parses the glTF itself and does forward kinematics on the animation data.

  verify_glb.py FILE [FILE...] [--compare ORIGINAL] [--fps 24] [--json]

Prints a JSON report per file. Exit code 1 if an invariant is violated. A file compressed with EXT_meshopt_compression
can only be inspected for structure (animation data is usually compressed too): the report says so.
Units are glTF world units (the armature node scale included); the floor plane is XZ (glTF is Y up).
"""
import argparse, json, struct, sys
import numpy as np

BONES = ['Hips', 'Spine', 'Spine01', 'Spine02', 'neck', 'Head', 'head_end', 'headfront',
         'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
         'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase', 'Hammer']
# Meshy library clips: they walk / change posture, so drift and foot sliding are expected (the game moves the root itself).
EXEMPT = {'Slow_Orc_Walk', 'idle_to_push_up', 'push_up_to_idle', 'Male_Bend_Over_Pick_Up', 'swing_raise'}
HIPS_DRIFT_MAX, FOOT_SLIDE_MAX, POSE_DIFF_MAX_DEG, FLOOR_BAND = 0.01, 0.01, 1.0, 0.03
DTYPE = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT2': 4, 'MAT3': 9, 'MAT4': 16}


def load(path):
    data = open(path, 'rb').read()
    magic, ver, total = struct.unpack_from('<4sII', data, 0)
    if magic != b'glTF':
        raise ValueError('not a GLB: ' + path)
    j, binchunk, off = None, b'', 12
    while off < len(data):
        n, t = struct.unpack_from('<I4s', data, off)
        body = data[off + 8: off + 8 + n]
        if t == b'JSON':
            j = json.loads(body)
        elif t == b'BIN\0':
            binchunk = body
        off += 8 + n
    return j, binchunk, len(data)


class Gltf:
    def __init__(self, path):
        self.path = path
        self.j, self.bin, self.size = load(path)
        self.compressed = 'EXT_meshopt_compression' in (self.j.get('extensionsUsed') or []) or \
                          'KHR_draco_mesh_compression' in (self.j.get('extensionsUsed') or [])

    def view(self, i):
        v = self.j['bufferViews'][i]
        return self.bin[v.get('byteOffset', 0): v.get('byteOffset', 0) + v['byteLength']]

    def accessor(self, i):
        a = self.j['accessors'][i]
        if 'bufferView' not in a:
            return np.zeros((a['count'], NCOMP[a['type']]), DTYPE[a['componentType']])
        v = self.j['bufferViews'][a['bufferView']]
        if 'extensions' in v and 'EXT_meshopt_compression' in v['extensions']:
            raise ValueError('compressed')
        dt, n = np.dtype(DTYPE[a['componentType']]), NCOMP[a['type']]
        base = v.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = v.get('byteStride') or dt.itemsize * n
        raw = np.frombuffer(self.bin, np.uint8)
        out = np.empty((a['count'], n), dt)
        for k in range(a['count']):
            out[k] = np.frombuffer(raw[base + k * stride: base + k * stride + dt.itemsize * n], dt)
        return out


def image_size(blob):
    if blob[:8] == b'\x89PNG\r\n\x1a\n':
        return struct.unpack('>II', blob[16:24])
    if blob[:2] == b'\xff\xd8':
        i = 2
        while i < len(blob) - 9:
            if blob[i] != 0xFF:
                i += 1
                continue
            m = blob[i + 1]
            if m in (0xC0, 0xC1, 0xC2):
                h, w = struct.unpack('>HH', blob[i + 5: i + 9])
                return w, h
            i += 2 + struct.unpack('>H', blob[i + 2: i + 4])[0]
    return None


def structure(g):
    j = g.j
    rep = {'bytes': g.size, 'compressed': g.compressed, 'extensionsUsed': j.get('extensionsUsed', [])}
    meshes = []
    for mi, m in enumerate(j.get('meshes', [])):
        tris, prims = 0, []
        for p in m['primitives']:
            if 'indices' in p:
                c = j['accessors'][p['indices']]['count']
            else:
                c = j['accessors'][p['attributes']['POSITION']]['count']
            tris += c // 3
            prims.append({'material': (j['materials'][p['material']].get('name') if 'material' in p else None),
                          'morphTargets': len(p.get('targets', []))})
        meshes.append({'name': m.get('name'), 'triangles': tris, 'primitives': prims,
                       'morphNames': (m.get('extras') or {}).get('targetNames')})
    rep['meshes'] = meshes
    rep['totalTriangles'] = sum(m['triangles'] for m in meshes)
    tex = []
    for i, im in enumerate(j.get('images', [])):
        size = None
        if 'bufferView' in im and not g.compressed:
            size = image_size(g.view(im['bufferView']))
        elif 'bufferView' in im:
            size = image_size(g.view(im['bufferView']))
        tex.append({'name': im.get('name'), 'mime': im.get('mimeType'), 'px': size,
                    'bytes': j['bufferViews'][im['bufferView']]['byteLength'] if 'bufferView' in im else None})
    rep['textures'] = tex
    rep['materials'] = [m.get('name') for m in j.get('materials', [])]
    # where the bytes go: images / mesh attributes+indices / animation / skin / other
    use = {}
    def mark(ai, tag):
        a = j['accessors'][ai]
        if 'bufferView' in a:
            use.setdefault(a['bufferView'], tag)
    for m in j.get('meshes', []):
        for p in m['primitives']:
            for ai in p['attributes'].values(): mark(ai, 'geometry')
            if 'indices' in p: mark(p['indices'], 'geometry')
            for t in p.get('targets', []):
                for ai in t.values(): mark(ai, 'morphs')
    for an in j.get('animations', []):
        for s in an['samplers']:
            mark(s['input'], 'animation'); mark(s['output'], 'animation')
    for s in j.get('skins', []):
        if 'inverseBindMatrices' in s: mark(s['inverseBindMatrices'], 'skin')
    for im in j.get('images', []):
        if 'bufferView' in im: use[im['bufferView']] = 'textures'
    split = {}
    for i, v in enumerate(j.get('bufferViews', [])):
        tag = use.get(i, 'other')
        split[tag] = split.get(tag, 0) + v['byteLength']
    rep['bytesByKind'] = split
    # skeleton
    names = [n.get('name') for n in j.get('nodes', [])]
    joints = []
    for s in j.get('skins', []):
        joints += [names[k] for k in s['joints']]
    joints = list(dict.fromkeys(joints))
    rep['bones'] = joints
    rep['bonesMissing'] = [b for b in BONES if b not in joints and b != 'Hammer' or (b == 'Hammer' and b not in names)]
    rep['bonesExtra'] = [b for b in joints if b not in BONES]
    rep['animations'] = [{'name': a.get('name'),
                          'seconds': None if g.compressed else round(max(float(g.accessor(s['input']).max()) for s in a['samplers']), 4)}
                         for a in j.get('animations', [])]
    return rep


# ---------------- forward kinematics ----------------
def qmul(a, b):
    x1, y1, z1, w1 = a; x2, y2, z2, w2 = b
    return np.array([w1*x2 + x1*w2 + y1*z2 - z1*y2, w1*y2 - x1*z2 + y1*w2 + z1*x2,
                     w1*z2 + x1*y2 - y1*x2 + z1*w2, w1*w2 - x1*x2 - y1*y2 - z1*z2])

def slerp(a, b, t):
    d = float(np.dot(a, b))
    if d < 0: b, d = -b, -d
    if d > 0.9995:
        r = a + t * (b - a)
        return r / np.linalg.norm(r)
    th = np.arccos(d)
    return (np.sin((1 - t) * th) * a + np.sin(t * th) * b) / np.sin(th)

def trs(t, q, s):
    x, y, z, w = q
    R = np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                  [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
                  [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])
    M = np.eye(4); M[:3, :3] = R * np.asarray(s); M[:3, 3] = t
    return M

def qangle(a, b):
    d = abs(float(np.dot(a / np.linalg.norm(a), b / np.linalg.norm(b))))
    return float(np.degrees(2 * np.arccos(min(1.0, d))))


class Rig:
    def __init__(self, g):
        j = g.j
        self.g = g
        self.nodes = j['nodes']
        self.name = [n.get('name') for n in self.nodes]
        self.parent = {}
        for i, n in enumerate(self.nodes):
            for c in n.get('children', []): self.parent[c] = i
        self.byname = {n: i for i, n in enumerate(self.name) if n}
        self.rest = []
        for n in self.nodes:
            if 'matrix' in n:
                M = np.array(n['matrix']).reshape(4, 4).T
                self.rest.append((M[:3, 3].copy(), None, None, M))
            else:
                self.rest.append((np.array(n.get('translation', [0, 0, 0]), float), np.array(n.get('rotation', [0, 0, 0, 1]), float),
                                  np.array(n.get('scale', [1, 1, 1]), float), None))
        self.order = self._topo()

    def _topo(self):
        out, seen = [], set()
        def visit(i):
            if i in seen: return
            if i in self.parent: visit(self.parent[i])
            seen.add(i); out.append(i)
        for i in range(len(self.nodes)): visit(i)
        return out

    def sample_channels(self, anim):
        ch = {}
        for c in anim['channels']:
            tgt = c['target']
            if 'node' not in tgt or tgt['path'] not in ('translation', 'rotation', 'scale'): continue
            s = anim['samplers'][c['sampler']]
            times = self.g.accessor(s['input'])[:, 0].astype(float)
            vals = self.g.accessor(s['output']).astype(float)
            if s.get('interpolation') == 'CUBICSPLINE': vals = vals[1::3]
            ch[(tgt['node'], tgt['path'])] = (times, vals, s.get('interpolation', 'LINEAR'))
        return ch

    @staticmethod
    def at(ch, t, rot):
        times, vals, interp = ch
        if t <= times[0]: return vals[0]
        if t >= times[-1]: return vals[-1]
        k = int(np.searchsorted(times, t, 'right')) - 1
        f = (t - times[k]) / (times[k + 1] - times[k])
        if interp == 'STEP': return vals[k]
        return slerp(vals[k] / np.linalg.norm(vals[k]), vals[k + 1] / np.linalg.norm(vals[k + 1]), f) if rot else vals[k] + (vals[k + 1] - vals[k]) * f

    def pose(self, ch, t):
        """returns (world matrices by node index, local quaternions by node index)"""
        W, Q = {}, {}
        for i in self.order:
            tr, q, s, M = self.rest[i]
            if M is not None:
                local = M; Q[i] = np.array([0, 0, 0, 1.0])
            else:
                if (i, 'translation') in ch: tr = self.at(ch[(i, 'translation')], t, False)
                if (i, 'rotation') in ch: q = self.at(ch[(i, 'rotation')], t, True)
                if (i, 'scale') in ch: s = self.at(ch[(i, 'scale')], t, False)
                local = trs(tr, q, s); Q[i] = np.asarray(q, float)
            W[i] = (W[self.parent[i]] @ local) if i in self.parent else local
        return W, Q


def clip_metrics(rig, anim, fps):
    ch = rig.sample_channels(anim)
    dur = max(float(v[0][-1]) for v in ch.values()) if ch else 0.0
    n = int(round(dur * fps)) + 1
    ts = [min(dur, k / fps) for k in range(n)]
    hips, lf, rf = rig.byname.get('Hips'), rig.byname.get('LeftFoot'), rig.byname.get('RightFoot')
    joints = [rig.byname[b] for b in BONES if b in rig.byname]
    P, Qs = [], []
    for t in ts:
        W, Q = rig.pose(ch, t)
        P.append({i: W[i][:3, 3].copy() for i in joints}); Qs.append({i: Q[i] for i in joints})
    res = {'frames': n, 'seconds': round(dur, 4), 'hammerAnimated': any(rig.name[k[0]] == 'Hammer' for k in ch)}
    if hips is not None:
        h = np.array([p[hips] for p in P])
        # root motion = where the clip ends up relative to where it started; the excursion in between is body motion (a squat lowers and leans the hips)
        res['hipsDriftXZ'] = round(float(np.hypot(h[-1, 0] - h[0, 0], h[-1, 2] - h[0, 2])), 4)
        res['hipsExcursionXZ'] = round(float(np.max(np.hypot(h[:, 0] - h[0, 0], h[:, 2] - h[0, 2]))), 4)
    slide = {}
    for nm, f in (('LeftFoot', lf), ('RightFoot', rf)):
        if f is None: continue
        pos = np.array([p[f] for p in P]); floor = pos[:, 1].min()
        on = pos[:, 1] < floor + FLOOR_BAND
        worst, start = 0.0, None
        for k in range(n + 1):
            if k < n and on[k]:
                if start is None: start = k
            elif start is not None:
                seg = pos[start:k]
                worst = max(worst, float(np.max(np.hypot(seg[:, 0] - seg[0, 0], seg[:, 2] - seg[0, 2]))))
                start = None
        slide[nm] = round(worst, 4)
    res['footSlideXZ'] = slide
    res['_P'], res['_Q'] = P, Qs
    return res


def analyse(g, fps):
    rep = structure(g)
    clips, fails = {}, []
    if rep['bonesExtra']: fails.append('extra bones: %s' % rep['bonesExtra'])
    if rep['bonesMissing'] and rep['bones']: fails.append('missing bones: %s' % rep['bonesMissing'])
    if g.compressed:
        rep['note'] = 'compressed file: structure only, animations not analysed'
        rep['invariants'] = {'ok': not fails, 'violations': fails}
        return rep, {}
    rig = Rig(g)
    raw = {}
    for a in g.j.get('animations', []):
        raw[a['name']] = clip_metrics(rig, a, fps)
    for name, m in raw.items():
        entry = {k: v for k, v in m.items() if not k.startswith('_')}
        entry['checked'] = name not in EXEMPT
        entry['violations'] = []
        if entry['checked']:
            if m.get('hipsDriftXZ', 0) > HIPS_DRIFT_MAX: entry['violations'].append('Hips drift %.4f > %s' % (m['hipsDriftXZ'], HIPS_DRIFT_MAX))
            for f, v in m['footSlideXZ'].items():
                if v > FOOT_SLIDE_MAX: entry['violations'].append('%s slide %.4f > %s' % (f, v, FOOT_SLIDE_MAX))
            if abs(m['frames'] / fps - m['seconds']) > 1.5 / fps + 1e-6: entry['violations'].append('length is not a whole number of frames')
            if '_hit' in name:
                ready = name.split('_hit')[0] + '_ready'
                if ready in raw:
                    r = raw[ready]; worst = 0.0
                    for first_last, (qa, qb) in {'first': (m['_Q'][0], r['_Q'][0]), 'last': (m['_Q'][-1], r['_Q'][0])}.items():
                        for i in qa:
                            if rig.name[i] == 'Hips': pass
                            worst = max(worst, qangle(qa[i], qb[i]))
                    entry['readyPoseDiffDeg'] = round(worst, 3)
                    if worst > POSE_DIFF_MAX_DEG: entry['violations'].append('first/last pose differs from %s by %.2f deg' % (ready, worst))
                else:
                    entry['violations'].append('no %s to compare with' % ready)
        for v in entry['violations']: fails.append('%s: %s' % (name, v))
        clips[name] = entry
    rep['clips'] = clips
    rep['invariants'] = {'ok': not fails, 'violations': fails}
    return rep, raw


def compare(rig_new, raw_new, rig_old, raw_old):
    out = {'clipsOnlyInOld': sorted(set(raw_old) - set(raw_new)), 'clipsOnlyInNew': sorted(set(raw_new) - set(raw_old)), 'clips': {}}
    for name in sorted(set(raw_new) & set(raw_old)):
        a, b = raw_old[name], raw_new[name]
        e = {'framesOld': a['frames'], 'framesNew': b['frames']}
        if a['frames'] == b['frames']:
            names = [n for n in BONES if n in rig_old.byname and n in rig_new.byname]
            pd, qd = 0.0, 0.0
            for k in range(a['frames']):
                for n in names:
                    pd = max(pd, float(np.linalg.norm(a['_P'][k][rig_old.byname[n]] - b['_P'][k][rig_new.byname[n]])))
                    qd = max(qd, qangle(a['_Q'][k][rig_old.byname[n]], b['_Q'][k][rig_new.byname[n]]))
            e['maxJointPosDiff'] = round(pd, 5); e['maxLocalRotDiffDeg'] = round(qd, 4)
            e['identical'] = pd < 1e-3 and qd < 0.1
        else:
            e['identical'] = False
        out['clips'][name] = e
    out['allIdentical'] = not out['clipsOnlyInOld'] and not out['clipsOnlyInNew'] and all(c['identical'] for c in out['clips'].values())
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='+'); ap.add_argument('--compare'); ap.add_argument('--fps', type=float, default=24)
    args = ap.parse_args()
    ok = True
    old = None
    if args.compare:
        go = Gltf(args.compare); _, raw_old = analyse(go, args.fps); old = (Rig(go), raw_old)
    for f in args.files:
        g = Gltf(f)
        rep, raw = analyse(g, args.fps)
        rep['file'] = f
        if old and raw:
            rep['compare'] = compare(Rig(g), raw, old[0], old[1])
            if not rep['compare']['allIdentical']: ok = False
        ok = ok and rep['invariants']['ok']
        print(json.dumps(rep, indent=1, ensure_ascii=False))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
