"""Contact sheet of the new hammer (plain Python + Pillow). Input: PNGs from build_hammer.py -- render.

  python blender/scripts/hammer_sheet.py FRAMES_DIR OUT.png

Columns: front (along the strike-face normal), side, top, tilted like in the game. Row 1: 270 px, row 2: 70 px (Crew size) and the same x3,
all from the 540 px renders with nearest neighbour.
"""
import os
import sys

from PIL import Image, ImageDraw

src, out = sys.argv[1], sys.argv[2]
V = [('front', 'front (along strike normal)'), ('side', 'side'), ('top', 'top'), ('tilt', 'tilted 38 deg, as in the game')]
im = {k: Image.open(os.path.join(src, 'hammer_%s.png' % k)).convert('RGB') for k, _ in V}
pad, lab = 6, 16
W = len(V) * (270 + pad) + pad
sheet = Image.new('RGB', (W, lab + 270 + pad + lab + 210 + 2 * pad), (24, 24, 28))
d = ImageDraw.Draw(sheet)
for i, (k, name) in enumerate(V):
    x = pad + i * (270 + pad)
    d.text((x, 2), name + ' - 270 px', fill=(255, 220, 120))
    sheet.paste(im[k].resize((270, 270), Image.NEAREST), (x, lab))
    y = lab + 270 + pad
    d.text((x, y), '70 px, then x3', fill=(200, 200, 200))
    s = im[k].resize((70, 70), Image.NEAREST)
    sheet.paste(s, (x, y + lab))
    sheet.paste(s.resize((210, 210), Image.NEAREST), (x + 76, y + lab - 0))
sheet = sheet.crop((0, 0, W, lab + 270 + pad + lab + 214))
sheet.save(out)
print('SHEET', out, sheet.size)
