"""Contact sheet + numbers from the in-game hammer renders of tools/hammer_shot.cjs (plain Python + Pillow + numpy).

  python blender/scripts/hammer_game_sheet.py FRAMES_DIR OUT.png NAME[,NAME...] [labels=old,v1,v2]

Rows: pose (swing_ready f0, swing_hit f6, swing_hit f12) x scale (native = game pixels, k=3, gnome ~70 px tall; close = 1:1 canvas, ~210 px).
Columns: one per hammer name. Cells are crops around the gnome, nearest neighbour, no Workbench: this is the game's own renderer and palette.
Also prints per cell (native only) the head in game pixels: projected box w x h, pixels of the hammer that lie inside the head box
(difference of the render with and without the hammer), mean luminance of those pixels vs what they cover (gnome / floor / boulder).
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

src, out, names = sys.argv[1], sys.argv[2], sys.argv[3].split(',')
meta = json.load(open(os.path.join(src, 'meta.json')))
POSES = [('ready0', 'swing_ready f0'), ('hit6', 'swing_hit f6'), ('hit12', 'swing_hit f12 (impact)')]
SC = [('native', 'native: game pixels (k=3)'), ('close', 'close 1:1 (k=1)')]
CROP = (260, 90, 760, 450)  # css px box around the gnome (and the hammer at the impact)
W, H = CROP[2] - CROP[0], CROP[3] - CROP[1]
lab = 16
sheet = Image.new('RGB', (len(names) * (W + 4) + 4, 3 * 2 * (H + lab + 4) + 4), (20, 20, 24))
d = ImageDraw.Draw(sheet)
lum = lambda a: a[..., 0] * .3 + a[..., 1] * .59 + a[..., 2] * .11
rows = []
for pi, (pk, pl) in enumerate(POSES):
    for si, (sk, sl) in enumerate(SC):
        y = 4 + (pi * 2 + si) * (H + lab + 4)
        for ci, n in enumerate(names):
            x = 4 + ci * (W + 4)
            base = '%s_%s_%s' % (n, pk, sk)
            im = Image.open(os.path.join(src, base + '.png')).convert('RGB')
            sheet.paste(im.crop(CROP), (x, y + lab))
            d.text((x + 2, y + 2), '%s | %s | %s' % (n, pl, sl), fill=(255, 220, 120))
            if sk == 'native':
                m = meta[base]
                k = m['k']
                A = np.asarray(im, float)[k // 2::k, k // 2::k]
                B = np.asarray(Image.open(os.path.join(src, base + '_nohammer.png')).convert('RGB'), float)[k // 2::k, k // 2::k]
                mask = (np.abs(A - B).max(-1) > 10)
                hb = m['headBoxGamePx']
                if hb:
                    yy, xx = np.mgrid[0:mask.shape[0], 0:mask.shape[1]]
                    inb = (xx >= hb['x0'] - 1) & (xx <= hb['x1'] + 1) & (yy >= hb['y0'] - 1) & (yy <= hb['y1'] + 1)
                    hm = mask & inb
                    la, lb = lum(A)[hm], lum(B)[hm]
                    rows.append((n, pk, '%.0fx%.0f' % (hb['w'], hb['h']), int(hm.sum()), round(float(la.mean()), 1) if hm.any() else None,
                                 round(float(lb.mean()), 1) if hm.any() else None, round(float(np.percentile(la, 90)), 1) if hm.any() else None))
                else:
                    rows.append((n, pk, 'n/a (no steel material)', int(mask.sum()), None, None, None))
sheet.save(out)
print('SHEET', out, sheet.size)
print('%-5s %-6s %-12s %-10s %-9s %-9s %-9s' % ('name', 'pose', 'head box px', 'head px', 'L head', 'L behind', 'L p90'))
for r in rows:
    print('%-5s %-6s %-12s %-10s %-9s %-9s %-9s' % r)
