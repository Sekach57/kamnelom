"""GIF and ribbons from the in-game frames of tools/swing_anim_shot.cjs (plain Python + Pillow).

  python blender/scripts/swing_game_media.py FRAMES_DIR OUT_DIR

writes OUT_DIR/swing_hit_game.gif (49 frames, 24 fps, game pixels x3 = the game's own pixel size), swing_hit_ribbon.png (12 frames) and
swing_transition_ribbon.png (Male_Bend_Over_Pick_Up end -> swing_raise -> swing_ready, 12 frames). Cells are crops around the dwarf, nearest.
"""
import json
import os
import sys

from PIL import Image, ImageDraw

src, out = sys.argv[1], sys.argv[2]
K = 3
CROP = (300, 100, 740, 440)  # css px around the dwarf and the hammer


def cell(name):
    return Image.open(os.path.join(src, name)).convert('RGB').crop(CROP)


frames = [cell('hit_%02d.png' % f) for f in range(49)]
q = [f.quantize(colors=64, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for f in frames]
q[0].save(os.path.join(out, 'swing_hit_game.gif'), save_all=True, append_images=q[1:], duration=[42] * 49, loop=0, optimize=False)
print('GIF', os.path.getsize(os.path.join(out, 'swing_hit_game.gif')))


def ribbon(images, labels, path, cols=6):
    w, h = images[0].size
    w2, h2 = w * 2 // 3, h * 2 // 3
    rows = (len(images) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * (w2 + 4) + 4, rows * (h2 + 18) + 4), (20, 20, 24))
    d = ImageDraw.Draw(sheet)
    for i, (im, lab) in enumerate(zip(images, labels)):
        x, y = 4 + (i % cols) * (w2 + 4), 4 + (i // cols) * (h2 + 18)
        d.text((x + 2, y + 2), lab, fill=(255, 220, 120))
        sheet.paste(im.resize((w2, h2), Image.NEAREST), (x, y + 16))
    sheet.save(path)
    print('RIBBON', path, sheet.size)


hit_idx = [0, 3, 6, 8, 10, 12, 14, 16, 19, 25, 34, 48]
ribbon([frames[i] for i in hit_idx], ['swing_hit f%d' % i for i in hit_idx], os.path.join(out, 'swing_hit_ribbon.png'))
tr = json.load(open(os.path.join(src, 'trans.json')))
ribbon([cell('trans_%02d.png' % i) for i in range(len(tr))],
       ['%s %s' % ('pickup' if c.startswith('Male') else c, ('%.1fs' % t) if c.startswith('Male') else ('f%d' % round(t * 24))) for c, t, _ in tr],
       os.path.join(out, 'swing_transition_ribbon.png'))
