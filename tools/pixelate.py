"""
Turn a photo into an 8-bit style sprite for the landing page.

Two steps, both classic:
  1. Downsample with a box filter (each output pixel is the mean of the
     input pixels it covers), so there is no aliasing shimmer.
  2. Quantise to a small palette with Floyd-Steinberg dithering: each
     pixel's rounding error is pushed onto its unvisited neighbours
     (7/16 right, 3/16 down-left, 5/16 down, 1/16 down-right), so smooth
     gradients become a checkerboard texture instead of flat bands.

The browser scales the result back up with `image-rendering: pixelated`
(nearest neighbour), which keeps every pixel a crisp square.

Usage: python3 tools/pixelate.py IN OUT --box L T H [--width 96] [--colours 24]
                                 [--aspect 6/7] [--mirror] [--saturation 1.0]
  --box gives the crop: left, top and height in source pixels; the width
  follows from --aspect (width / height), e.g. 210/297 for A4 portrait.
"""
import argparse
from fractions import Fraction
from PIL import Image, ImageEnhance, ImageOps

p = argparse.ArgumentParser()
p.add_argument("src"); p.add_argument("dst")
p.add_argument("--box", nargs=3, type=int, required=True, metavar=("L", "T", "H"))
p.add_argument("--width", type=int, default=96)
p.add_argument("--colours", type=int, default=24)
p.add_argument("--mirror", action="store_true")
p.add_argument("--saturation", type=float, default=1.0)
p.add_argument("--aspect", type=Fraction, default=Fraction(6, 7))
a = p.parse_args()

left, top, height = a.box
im = Image.open(a.src).convert("RGB").crop((left, top, left + round(height * a.aspect), top + height))
if a.mirror:
    im = ImageOps.mirror(im)
if a.saturation != 1.0:
    im = ImageEnhance.Color(im).enhance(a.saturation)

small = im.resize((a.width, round(a.width / a.aspect)), Image.Resampling.BOX)
small.quantize(colors=a.colours, dither=Image.Dither.FLOYDSTEINBERG).save(a.dst, optimize=True)
print(f"{a.dst}: {small.width}x{small.height}, {a.colours} colours")
