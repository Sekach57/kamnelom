"""One contact sheet PNG per clip from the frames written by `check_modular.py -- render` (plain Python + Pillow, no Blender).

  python blender/scripts/compose_clip_sheet.py FRAMES_DIR OUT_DIR [clip ...]

Layout: 4 key frames (columns) x front / side / top (rows) at 270 px, then the same 12 views at 70 px (the Crew size), both shrunk
from the 540 px renders with nearest neighbour, like the game's pixel look. The 70 px row is also shown x2 (nearest) so it can be read.
"""
import glob
import os
import re
import sys

from PIL import Image, ImageDraw

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
VIEWS = ['front', 'side', 'top']
clips = sys.argv[3:] or sorted({re.sub(r'_\d_f\d+_front\.png$', '', os.path.basename(f)) for f in glob.glob(os.path.join(src, '*_front.png'))})
for clip in clips:
    files = sorted(glob.glob(os.path.join(src, clip + '_[0-9]_f*_front.png')))
    frames = [int(re.search(r'_f(\d+)_front', f).group(1)) for f in files]
    idx = [os.path.basename(f)[len(clip) + 1] for f in files]
    big = {v: [Image.open(os.path.join(src, '%s_%s_f%03d_%s.png' % (clip, i, fr, v))).convert('RGB') for i, fr in zip(idx, frames)]
           for v in VIEWS}
    n = len(frames)
    pad, lab = 6, 18
    W = n * (270 + pad) + pad
    H = lab + 3 * (270 + pad) + 70 + 140 + 4 * pad + 2 * lab
    sheet = Image.new('RGB', (W, H), (24, 24, 28))
    d = ImageDraw.Draw(sheet)
    d.text((pad, 3), '%s   key frames %s   views: front / side / top   (270 px, nearest from 540)' % (clip, frames), fill=(255, 255, 255))
    for r, v in enumerate(VIEWS):
        for c in range(n):
            y = lab + pad + r * (270 + pad)
            sheet.paste(big[v][c].resize((270, 270), Image.NEAREST), (pad + c * (270 + pad), y))
    y0 = lab + 3 * (270 + pad) + pad
    d.text((pad, y0), '70 px (Crew size), nearest, then x2 below', fill=(200, 200, 200))
    x = pad
    for v in VIEWS:
        for c in range(n):
            s = big[v][c].resize((70, 70), Image.NEAREST)
            sheet.paste(s, (x, y0 + lab))
            x += 70 + 2
    x = pad  # x2 row of the front view only (readability)
    for c in range(n):
        sheet.paste(big['front'][c].resize((70, 70), Image.NEAREST).resize((140, 140), Image.NEAREST), (x, y0 + lab + 70 + pad))
        x += 140 + 2
    sheet = sheet.crop((0, 0, W, y0 + lab + 70 + pad + 140 + pad))
    path = os.path.join(out, 'sheet_%s.png' % clip)
    sheet.save(path)
    print('SHEET', path, sheet.size)
