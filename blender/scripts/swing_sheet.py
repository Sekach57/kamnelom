"""Contact sheet for the swing blocking (plain Python + Pillow, no Blender). Frames come from swing_check.py -- render.

  python blender/scripts/swing_sheet.py FRAMES_DIR OUT.png [--big]

Columns: swing_hit key frames 0, 6, 12, 14, 20, 48 and the OLD swing_hit frame 12 (for the impact comparison).
Rows: front / side / top at 270 px, then the same 21 views at 70 px (Crew size), all shrunk from the 540 px renders with nearest neighbour,
then the front row at 70 px x2 so it can be read. --big writes one extra PNG per column with the three 540 px views (for checking poses).
"""
import os
import sys

from PIL import Image, ImageDraw

src, out = sys.argv[1], sys.argv[2]
COLS = [('swing_hit_f%03d' % f, 'new f%d' % f) for f in (0, 6, 12, 14, 19, 48)] + [('old_swing_hit_f012', 'OLD f12')]
VIEWS = ['front', 'side', 'top']
img = {(t, v): Image.open(os.path.join(src, '%s_%s.png' % (t, v))).convert('RGB') for t, _ in COLS for v in VIEWS}
pad, lab, n = 6, 16, len(COLS)
W = n * (270 + pad) + pad
y70 = lab + 3 * (270 + pad) + pad
H = y70 + lab + 3 * 72 + 140 + 3 * pad + 10
sheet = Image.new('RGB', (W, H), (24, 24, 28))
d = ImageDraw.Draw(sheet)
d.text((pad, 2), 'swing_hit blocking, key frames; rows front / side / top at 270 px (nearest from 540); hammer attached for render only', fill=(255, 255, 255))
for c, (t, name) in enumerate(COLS):
    d.text((pad + c * (270 + pad) + 4, lab + 2), name, fill=(255, 220, 120))
    for r, v in enumerate(VIEWS):
        sheet.paste(img[(t, v)].resize((270, 270), Image.NEAREST), (pad + c * (270 + pad), lab + pad + r * (270 + pad) - (0 if r else 0)))
d.text((pad, y70), '70 px (Crew size), nearest: front / side / top per column; below the front view x2', fill=(200, 200, 200))
for c, (t, name) in enumerate(COLS):
    for r, v in enumerate(VIEWS):
        sheet.paste(img[(t, v)].resize((70, 70), Image.NEAREST), (pad + c * (270 + pad) + r * 72, y70 + lab))
    sheet.paste(img[(t, 'front')].resize((70, 70), Image.NEAREST).resize((140, 140), Image.NEAREST), (pad + c * (270 + pad), y70 + lab + 76))
sheet.save(out)
print('SHEET', out, sheet.size)
if '--big' in sys.argv:
    base = os.path.splitext(out)[0]
    for t, name in COLS:
        s = Image.new('RGB', (3 * 540, 540))
        for i, v in enumerate(VIEWS):
            s.paste(img[(t, v)], (i * 540, 0))
        s.save('%s_big_%s.png' % (base, t))
