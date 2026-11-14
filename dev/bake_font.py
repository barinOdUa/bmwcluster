"""Bake the glyphs barin-fuel draws into tools/barin-fuel/glyphs.json.

The head unit runs Node 8 with no font rasteriser, so the few characters the readout needs are rendered here,
once, into 8-bit alpha masks. Two sizes: `num` for the figure, `unit` for "l/100km".

    uv run --no-project --with pillow python dev/bake_font.py [font.ttf] [weight]

Default font: dev/font-src/Inter.ttf (SIL OFL 1.1, from github.com/google/fonts ofl/inter), weight 600.
"""
import base64
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'tools', 'barin-fuel', 'glyphs.json')

# px, measured off the car photo: the stock outside temperature is about 29 px cap height on the 1920x720 panel
SIZES = {'num': 44, 'unit': 26}
CHARS = {'num': '0123456789.-°', 'unit': '0123456789./-klmpgLUS '}


def oil_can(height):
    """An oil can, the warning-light kind: body, cap, handle on the left, spout up to the right, a drop under it.
    Drawn 4x and scaled down for smooth edges; returns the mask's entry for glyphs.json (top = its height)."""
    s = 4
    w4, h4 = 192, 112
    img = Image.new('L', (w4, h4), 0)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((50, 48, 140, 100), radius=8, fill=255)            # body
    d.rectangle((82, 36, 100, 48), fill=255)                               # neck
    d.rounded_rectangle((70, 28, 112, 38), radius=4, fill=255)             # cap
    d.line([(52, 58), (24, 46), (18, 64), (52, 80)], fill=255, width=9, joint='curve')   # handle
    d.polygon([(138, 60), (180, 42), (186, 52), (138, 82)], fill=255)      # spout
    d.ellipse((176, 70, 190, 92), fill=255)                                # drop
    w = round(w4 * height / h4)
    small = img.resize((w, height), Image.LANCZOS)
    return {'adv': w, 'w': w, 'h': height, 'ox': 0, 'top': height,
            'a': base64.b64encode(small.tobytes()).decode()}


def load(path, size, weight):
    font = ImageFont.truetype(path, size)
    try:
        axes = font.get_variation_axes()
        values = []
        for a in axes:
            name = a.get('name', b'')
            name = name.decode() if isinstance(name, bytes) else str(name)
            if name.lower().startswith('weight'):
                values.append(weight)
            elif name.lower().startswith('optical'):
                values.append(max(a['minimum'], min(a['maximum'], size)))
            else:
                values.append(a['default'])
        font.set_variation_by_axes(values)
    except (OSError, AttributeError):
        pass  # not a variable font
    return font


def bake(font, chars):
    ascent, descent = font.getmetrics()
    glyphs = {}
    for ch in chars:
        adv = font.getlength(ch)
        l, t, r, b = font.getbbox(ch, anchor='ls')
        w, h = max(0, r - l), max(0, b - t)
        data = ''
        if w and h:
            img = Image.new('L', (w, h), 0)
            ImageDraw.Draw(img).text((-l, -t), ch, font=font, fill=255, anchor='ls')
            data = base64.b64encode(img.tobytes()).decode()
        # ox: left of the mask from the pen; top: top of the mask above the baseline (positive = up)
        glyphs[ch] = {'adv': round(adv, 2), 'w': w, 'h': h, 'ox': l, 'top': -t, 'a': data}
    return {'size': font.size, 'ascent': ascent, 'descent': descent, 'glyphs': glyphs}


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'font-src', 'Inter.ttf')
    weight = float(sys.argv[2]) if len(sys.argv) > 2 else 600
    out = {'font': os.path.basename(path), 'weight': weight}
    for key, size in SIZES.items():
        out[key] = bake(load(path, size, weight), CHARS[key])
    out['icons'] = {'oil': oil_can(30)}
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote', OUT, os.path.getsize(OUT), 'bytes')


if __name__ == '__main__':
    main()
