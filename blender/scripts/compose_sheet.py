"""Glue the three sketch renders of one approach into one PNG (plain Python + Pillow, no Blender).

  python blender/scripts/compose_sheet.py PREFIX OUT.png "title"

Panels, left to right: the front view (design reading), the solo game camera crop (dwarf ~78 px tall, nearest x3),
the Crew-scale game camera crop (dwarf ~56 px tall, nearest x3).
"""
import sys

from PIL import Image, ImageDraw

prefix, out, title = sys.argv[1], sys.argv[2], sys.argv[3]
front = Image.open(prefix + '_front.png').convert('RGB')
solo = Image.open(prefix + '_solo.png').convert('RGB')
group = Image.open(prefix + '_group.png').convert('RGB')


def crop_up(im, box, k=3):
    return im.crop(box).resize(((box[2] - box[0]) * k, (box[3] - box[1]) * k), Image.NEAREST)


# crops are centred on the dwarf in each game camera (found by eye on the Phase 0 renders; same for every sketch)
p1 = front.crop((150, 60, 550, 620)).resize((400 * 1, 560 * 1))
p2 = crop_up(solo, (85, 70, 185, 170))
p3 = crop_up(group, (85, 70, 185, 170))
H = 560
W = p1.width + p2.width + p3.width + 40
sheet = Image.new('RGB', (W, H + 30), (30, 30, 34))
x = 10
for p in (p1, p2, p3):
    sheet.paste(p, (x, 30))
    x += p.width + 10
d = ImageDraw.Draw(sheet)
d.text((10, 8), title, fill=(255, 255, 255))
d.text((p1.width + 20, 8), 'solo cam 270 px (x3 nearest)', fill=(200, 200, 200))
d.text((p1.width + p2.width + 30, 8), 'Crew cam 270 px (x3 nearest)', fill=(200, 200, 200))
sheet.save(out)
print('SHEET', out, sheet.size)
