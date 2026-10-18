#!/usr/bin/env python3
"""Measures a plotted PDF of MD CAD AI STUDIO (V24-035): page size (MediaBox) against the ISO sheet, and the length of
the check ruler (cad/plot.ts rulerPrims: a horizontal 100 mm paper line and a model bar of 1000*m/scale mm) as the PDF
really draws them — content streams decompressed, the current transformation matrix (q/Q/cm) applied to every
m/l segment. Python standard library only.

usage: check-pdf-ruler.py <file.pdf> <paper,scale> [<paper,scale> ...]   (one per page, e.g. A3,0 A1,0 A0,50 A4,100;
       scale 0 = page without a ruler)
Prints JSON; exit 1 when a ruler is missing or off by more than 0.01 mm, or a page differs from the sheet by > 0.5 pt.
"""
import json
import re
import sys
import zlib

PAPERS = {'A4': (297, 210), 'A3': (420, 297), 'A2': (594, 420), 'A1': (841, 594), 'A0': (1189, 841), 'A1P': (594, 841), 'A0P': (841, 1189)}
PT = 72 / 25.4  # points per mm


def objects(data):
    out = {}
    for m in re.finditer(rb'(\d+) 0 obj(.*?)endobj', data, re.S):
        out[int(m.group(1))] = m.group(2)
    return out


def stream_of(body, objs):
    m = re.search(rb'stream\r?\n', body)
    if not m:
        return b''
    raw = body[m.end():]
    raw = raw[: raw.rfind(b'endstream')]
    head = body[: m.start()]
    if b'/FlateDecode' in head:
        try:
            return zlib.decompressobj().decompress(raw)
        except zlib.error:
            return b''
    return raw


def mul(a, b):
    # PDF matrices [a b c d e f]; result = a × b (apply a, then b)
    return [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
            a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]]


def segments(content):
    """Straight segments (in points, page space) of every path: m → l → l …"""
    toks = re.findall(rb'[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?|[A-Za-z*\'"]+|\[|\]|<<|>>|/[^\s/\[\]()<>]+|\([^)]*\)', content)
    ctm, stack, nums, segs, cur = [1, 0, 0, 1, 0, 0], [], [], [], None
    def tr(x, y):
        return (ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5])
    for t in toks:
        if re.fullmatch(rb'[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?', t):
            nums.append(float(t))
            continue
        op = t.decode('latin1')
        if op == 'q':
            stack.append(ctm[:])
        elif op == 'Q':
            ctm = stack.pop() if stack else [1, 0, 0, 1, 0, 0]
        elif op == 'cm' and len(nums) >= 6:
            ctm = mul(nums[-6:], ctm)
        elif op == 'm' and len(nums) >= 2:
            cur = tr(*nums[-2:])
        elif op == 'l' and len(nums) >= 2 and cur:
            p = tr(*nums[-2:])
            segs.append((cur, p))
            cur = p
        nums = []
    return segs


def main():
    path, specs = sys.argv[1], sys.argv[2:]
    data = open(path, 'rb').read()
    objs = objects(data)
    pages = []
    for n in sorted(objs):
        b = objs[n]
        if re.search(rb'/Type\s*/Page\b', b):
            mb = [float(x) for x in re.search(rb'/MediaBox\s*\[([^\]]+)\]', b).group(1).split()]
            refs = [int(x) for x in re.findall(rb'(\d+) 0 R', re.search(rb'/Contents\s*(\[[^\]]*\]|\d+ 0 R)', b).group(1))]
            content = b''.join(stream_of(objs[r], objs) for r in refs if r in objs)
            pages.append({'obj': n, 'mediabox': mb, 'segs': segments(content)})
    out, ok = [], True
    for i, pg in enumerate(pages):
        spec = specs[i] if i < len(specs) else None
        paper, scale = (spec.split(',') + ['0'])[:2] if spec else (None, '0')
        scale = float(scale)
        w_pt, h_pt = pg['mediabox'][2] - pg['mediabox'][0], pg['mediabox'][3] - pg['mediabox'][1]
        row = {'page': i + 1, 'mediabox_pt': [round(w_pt, 3), round(h_pt, 3)], 'size_mm': [round(w_pt / PT, 3), round(h_pt / PT, 3)], 'segments': len(pg['segs'])}
        if paper:
            W, H = PAPERS[paper]
            row['paper'] = paper
            row['sheet_mm'] = [W, H]
            row['size_error_mm'] = [round(w_pt / PT - W, 3), round(h_pt / PT - H, 3)]
            row['size_ok_0_5pt'] = abs(w_pt - W * PT) <= 0.5 and abs(h_pt - H * PT) <= 0.5
            ok &= row['size_ok_0_5pt']
        if scale > 0:
            horiz = [((a, b), abs(b[0] - a[0]) / PT) for a, b in pg['segs'] if abs(a[1] - b[1]) < 1e-3]
            ruler = [L for _, L in horiz if abs(L - 100) < 0.5]
            m = 1 if 1000 / scale >= 10 else 10 if 1000 / scale >= 1 else 100
            model_mm = m * 1000 / scale
            bar = [L for _, L in horiz if abs(L - model_mm) < 0.5]
            row['ruler_mm'] = round(ruler[0], 4) if ruler else None
            row['model_bar_expected_mm'] = model_mm
            row['model_bar_mm'] = round(bar[0], 4) if bar else None
            row['ruler_ok_0_01mm'] = bool(ruler) and abs(ruler[0] - 100) <= 0.01 and bool(bar) and abs(bar[0] - model_mm) <= 0.01
            ok &= row['ruler_ok_0_01mm']
        out.append(row)
    print(json.dumps({'file': path, 'pages': out, 'ok': bool(ok)}, indent=1))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
