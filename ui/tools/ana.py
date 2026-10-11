# anaglyph overlay: mockup -> red channel, capture -> green+blue. Aligned = gray; mockup-only = red; capture-only = cyan
import sys
from PIL import Image, ImageOps
m, c, x0, y0, x1, y1, sc, out = sys.argv[1], sys.argv[2], *map(int, sys.argv[3:8]), sys.argv[8]
A = ImageOps.autocontrast(Image.open(m).convert('L').crop((x0,y0,x1,y1)))
B = ImageOps.autocontrast(Image.open(c).convert('L').crop((x0,y0,x1,y1)))
o = Image.merge('RGB', (A, B, B)).resize(((x1-x0)*sc,(y1-y0)*sc), Image.LANCZOS)
o.save(out)
