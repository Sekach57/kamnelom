"""Meshy text-to-3D client for the Dwarf Gym accessory parts, with hard spending caps.

Usage (from the repo root, `python -I blender/scripts/meshy_gen.py ...`):
  balance                  free; prints credit balance only
  preview <slug>           POST a preview (counts toward the caps)
  refine  <slug>           POST a refine for the latest SUCCEEDED preview of <slug>
  poll    <slug>           wait for the latest task of <slug>, download glb + thumbnail
  status                   print the ledger summary

The API key is read from .env (MESHY_API_KEY) and is never printed or written anywhere.
State lives in blender/meshy/ledger.json (task ids, credits, attempt counts). The model
files land in blender/meshy/<slug>/. Caps: 3 previews per item, 24 paid POSTs in total.
"""
import json, os, sys, time, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'blender', 'meshy')
LEDGER = os.path.join(OUT, 'ledger.json')
API = 'https://api.meshy.ai/openapi'
MAX_PREVIEWS_PER_ITEM, MAX_POSTS_TOTAL = 3, 24
TAIL = ' Single object, isolated, no character, no head, centered.'
STYLE = ' Dark fantasy, stocky chunky proportions, hand-painted stylized game asset, worn weathered look.'
ITEMS = {
    # attempt 1 read as a skull mask (eyes, nose) with debris: attempt 2 forbids faces and describes a hard hat
    'helmet_miner': 'Dwarf miner hard hat: a smooth iron hemispherical dome with a short brim all round, one small brass lamp mounted on the front centre, riveted seams, hollow open underneath. Only the helmet, no face, no eyes, no nose, no skull, no debris.' + STYLE + TAIL,
    'helmet_round': 'Round steel dwarf helmet with a nose guard, battered polished steel, riveted band.' + STYLE + TAIL,
    'helmet_horned': 'Dwarf horned helmet, battered dark iron cap with two curved horns.' + STYLE + TAIL,
    'beard_braid': 'Long braided dwarf beard as a separate wearable piece, thick auburn-brown hair, two braids tied with iron rings, hanging straight down, flat back.' + STYLE + ' No face.' + TAIL,
    'beard_forked': 'Short forked dwarf beard as a separate wearable piece, dark grey hair, split into two points, flat back.' + STYLE + ' No face.' + TAIL,
    'beard_wide': 'Wide thick bushy dwarf beard as a separate wearable piece, red-brown hair, broad and full, flat back.' + STYLE + ' No face.' + TAIL,
    # attempt 1 was a rivetted ball: attempt 2 asks for a shallow curved band
    'shoulders_leather': 'One dwarf leather shoulder guard shaped like a shallow curved band, a quarter of a cylinder about three times wider than it is thick, flat open underside, three overlapping leather layers with brass rivets along the edge. Not a sphere, not a ball, not a shield.' + STYLE + TAIL,
    'shoulders_plate': 'One dwarf steel plate pauldron, layered curved plates, compact and close-fitting, flat and thick, not a sphere, worn dark steel.' + STYLE + TAIL,
}
PREVIEW = {'mode': 'preview', 'model_type': 'standard', 'ai_model': 'meshy-6', 'should_remesh': True,
           'topology': 'triangle', 'target_polycount': 1500, 'target_formats': ['glb'], 'pose_mode': ''}
REFINE = {'mode': 'refine', 'enable_pbr': False, 'texture_resolution': '2k', 'target_formats': ['glb']}


def key():
    for line in open(os.path.join(ROOT, '.env'), encoding='utf-8'):
        line = line.strip()
        if line.startswith('MESHY_API_KEY='):
            return line.split('=', 1)[1].strip().strip('"\'')
    sys.exit('MESHY_API_KEY not found in .env')


def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, headers={'Authorization': 'Bearer ' + key(), 'Content-Type': 'application/json'},
                                 data=None if body is None else json.dumps(body).encode())
    try:
        return json.load(urllib.request.urlopen(req, timeout=60))
    except urllib.error.HTTPError as e:
        sys.exit('HTTP %s on %s %s: %s' % (e.code, method, path, e.read().decode('utf-8', 'replace')[:400]))


def load():
    return json.load(open(LEDGER, encoding='utf-8')) if os.path.exists(LEDGER) else {'posts': 0, 'credits': 0, 'tasks': []}


def save(led):
    os.makedirs(OUT, exist_ok=True)
    json.dump(led, open(LEDGER, 'w', encoding='utf-8'), indent=1)


def latest(led, slug, kind=None, ok=False):
    for t in reversed(led['tasks']):
        if t['slug'] == slug and (kind is None or t['kind'] == kind) and (not ok or t.get('status') == 'SUCCEEDED'):
            return t
    sys.exit('no matching task for ' + slug)


def post(led, slug, kind, body):
    if led['posts'] >= MAX_POSTS_TOTAL:
        sys.exit('cap reached: %d paid POSTs already' % led['posts'])
    if kind == 'preview' and sum(1 for t in led['tasks'] if t['slug'] == slug and t['kind'] == 'preview') >= MAX_PREVIEWS_PER_ITEM:
        sys.exit('cap reached: %d previews already for %s' % (MAX_PREVIEWS_PER_ITEM, slug))
    led['posts'] += 1  # count before the call: a request that fails midway still might have been charged
    save(led)
    tid = call('POST', '/v2/text-to-3d', body)['result']
    led['tasks'].append({'slug': slug, 'kind': kind, 'id': tid, 'status': 'PENDING', 'prompt': body.get('prompt')})
    save(led)
    print('%s %s task %s created (posts used: %d/%d)' % (slug, kind, tid, led['posts'], MAX_POSTS_TOTAL))


def poll(led, slug):
    t = latest(led, slug)
    while True:
        d = call('GET', '/v2/text-to-3d/' + t['id'])
        t['status'], t['progress'] = d['status'], d.get('progress')
        if d['status'] in ('SUCCEEDED', 'FAILED', 'CANCELED'):
            break
        print('  %s %s %s%%' % (slug, d['status'], d.get('progress')), flush=True)
        time.sleep(15)
    t['consumed_credits'] = d.get('consumed_credits')
    led['credits'] = sum(x.get('consumed_credits') or 0 for x in led['tasks'])
    if d['status'] == 'SUCCEEDED':
        folder = os.path.join(OUT, slug)
        os.makedirs(folder, exist_ok=True)
        stem = '%s_%s' % (t['kind'], t['id'][:8])
        files = {'glb': (d.get('model_urls') or {}).get('glb'), 'thumb': d.get('thumbnail_url')}
        for what, url in files.items():
            if url:
                ext = '.glb' if what == 'glb' else '.png'
                urllib.request.urlretrieve(url, os.path.join(folder, stem + ('_thumb' if what == 'thumb' else '') + ext))
        t['files'] = stem
    else:
        t['error'] = (d.get('task_error') or {}).get('message')
    save(led)
    print('%s %s %s credits=%s' % (slug, t['kind'], t['status'], t.get('consumed_credits')))


def main(argv):
    cmd = argv[1]
    led = load()
    if cmd == 'balance':
        d = call('GET', '/v1/balance')
        print({k: d.get(k) for k in ('balance', 'monthly_credits', 'permanent_credits')})
    elif cmd == 'status':
        print(json.dumps({'posts': led['posts'], 'credits': led['credits'], 'tasks': [{k: t.get(k) for k in ('slug', 'kind', 'id', 'status', 'consumed_credits')} for t in led['tasks']]}, indent=1))
    elif cmd == 'preview':
        slug = argv[2]
        post(led, slug, 'preview', dict(PREVIEW, prompt=ITEMS[slug]))
    elif cmd == 'refine':
        slug = argv[2]
        post(led, slug, 'refine', dict(REFINE, preview_task_id=latest(led, slug, 'preview', ok=True)['id']))
    elif cmd == 'poll':
        poll(led, argv[2])
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main(sys.argv)
