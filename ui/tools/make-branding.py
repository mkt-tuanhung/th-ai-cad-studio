"""Brand assets from the approved MD CAD AI STUDIO logo (transparent PNG) — crops and a dark-background
variant only; the artwork itself is not redrawn. Run: python3 tools/make-branding.py <logo.png>
Outputs public/assets/branding/: md-logo.png (light backgrounds), md-logo-dark.png (dark backgrounds:
graphite lettering lifted to silver so it reads), md-monogram(.png|-dark.png), md-wordmark(.png|-dark.png),
md-app-icon-1024.png (macOS icon tile) and the source copy."""
import sys, os, colorsys
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

src = sys.argv[1]
out = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'branding')
os.makedirs(out, exist_ok=True)
im = Image.open(src).convert()
im.save(os.path.join(out, 'md-logo-source.png'))
W, H = im.size
SPLIT = 917  # gap between the monogram (with its construction lines) and the wordmark

def bbox(img, pad=6):
    a = np.array(img)[:, :, 3]
    ys, xs = np.where(a > 12)
    return (max(0, xs.min() - pad), max(0, ys.min() - pad), min(img.width, xs.max() + pad + 1), min(img.height, ys.max() + pad + 1))

def lift(img, word):
    """Dark-background variant: neutral graphite pixels lifted (wordmark → silver, monogram faces lighter)."""
    a = np.array(img).astype(np.float32) / 255
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    mx = np.maximum(np.maximum(r, g), b); mn = np.minimum(np.minimum(r, g), b)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    neutral = (sat < 0.22) & (mx < 0.62)
    if word:
        k = np.where(neutral, 0.72 + mx * 0.32, 1.0)  # dark grey lettering → brushed silver
        for c in (0, 1, 2):
            a[..., c] = np.where(neutral, np.clip(k * (0.94 + 0.06 * c), 0, 1), a[..., c])
    else:
        for c in (0, 1, 2):
            a[..., c] = np.where(neutral, np.clip(a[..., c] * 1.16 + 0.035, 0, 1), a[..., c])
    return Image.fromarray((a * 255).astype(np.uint8), )

top = im.crop((0, 0, W, SPLIT)); bot = im.crop((0, SPLIT, W, H))
mono = top.crop(bbox(top)); word = bot.crop(bbox(bot))
mono.save(os.path.join(out, 'md-monogram.png')); word.save(os.path.join(out, 'md-wordmark.png'))
mono_d = lift(mono, False); word_d = lift(word, True)
mono_d.save(os.path.join(out, 'md-monogram-dark.png')); word_d.save(os.path.join(out, 'md-wordmark-dark.png'))
# letters only (no underline) for small sizes, e.g. the sidebar
TEXT_END = 1026
lett = im.crop((0, SPLIT, W, TEXT_END)); lett = lett.crop(bbox(lett, 2))
lett.save(os.path.join(out, 'md-wordmark-text.png')); lift(lett, True).save(os.path.join(out, 'md-wordmark-text-dark.png'))
full = im.crop(bbox(im)); full.save(os.path.join(out, 'md-logo.png'))
dark = Image.new('RGBA', im.size, (0, 0, 0, 0))
dark.alpha_composite(lift(top, False), (0, 0)); dark.alpha_composite(lift(bot, True), (0, SPLIT))
dark.crop(bbox(im)).save(os.path.join(out, 'md-logo-dark.png'))

# macOS app icon tile (1024, Big Sur grid: 824 squircle-like rounded square, soft shadow), monogram centred
S = 1024; tile = 824; r = 186; off = (S - tile) // 2
icon = Image.new('RGBA', (S, S), (0, 0, 0, 0))
shadow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle((off, off + 14, off + tile, off + tile + 14), r, fill=(0, 0, 0, 120))
icon.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(18)))
# background: graphite → blue-black gradient, faint blueprint grid, teal glow behind the monogram
bg = np.zeros((tile, tile, 4), np.float32)
yy, xx = np.mgrid[0:tile, 0:tile] / tile
top_c = np.array([0.10, 0.13, 0.15]); bot_c = np.array([0.03, 0.05, 0.07])
for c in range(3): bg[..., c] = top_c[c] * (1 - yy) + bot_c[c] * yy
glow = np.exp(-(((xx - 0.5) ** 2) / 0.09 + ((yy - 0.52) ** 2) / 0.07))
bg[..., 0] += glow * 0.02; bg[..., 1] += glow * 0.16; bg[..., 2] += glow * 0.17
bg[..., 3] = 1
grid = ((np.round(xx * tile) % 64 == 0) | (np.round(yy * tile) % 64 == 0))
for c, v in zip(range(3), (0.12, 0.45, 0.47)): bg[..., c] = np.where(grid, bg[..., c] * 0.86 + v * 0.14, bg[..., c])
bgi = Image.fromarray((np.clip(bg, 0, 1) * 255).astype(np.uint8), )
mask = Image.new('L', (tile, tile), 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, tile - 1, tile - 1), r, fill=255)
bgi.putalpha(mask)
# thin inner bevel line
ImageDraw.Draw(bgi).rounded_rectangle((1, 1, tile - 2, tile - 2), r - 1, outline=(70, 160, 168, 90), width=3)
icon.alpha_composite(bgi, (off, off))
m = mono_d.copy(); scale = (tile * 0.93) / m.width; m = m.resize((int(m.width * scale), int(m.height * scale)), Image.LANCZOS)
icon.alpha_composite(m, ((S - m.width) // 2, (S - m.height) // 2 + 6))
icon.save(os.path.join(out, 'md-app-icon-1024.png'))
print('branding assets written to', os.path.abspath(out))
