# For each named region, find ink bbox (pixels darker than bg by > thr) in mockup and capture.
import sys, json, numpy as np
from PIL import Image
m = np.asarray(Image.open(sys.argv[1]).convert('L'), dtype=np.int16)
c = np.asarray(Image.open(sys.argv[2]).convert('L'), dtype=np.int16)
regions = json.load(open(sys.argv[3]))
def box(a, r, thr, mode):
    x0,y0,x1,y1 = r; sub = a[y0:y1, x0:x1]
    bg = np.median(sub)
    mask = (bg - sub > thr) if mode=='dark' else (sub - bg > thr)
    ys, xs = np.nonzero(mask)
    if len(xs)==0: return None
    return (x0+xs.min(), y0+ys.min(), x0+xs.max()+1, y0+ys.max()+1)
for name, spec in regions.items():
    r = spec['r']; thr = spec.get('t', 60); mode = spec.get('m','dark')
    A = box(m, r, thr, mode); B = box(c, r, thr, mode)
    if not A or not B: print(f'{name:28s} mock={A} cap={B}'); continue
    d = (B[0]-A[0], B[1]-A[1], (B[2]-B[0])-(A[2]-A[0]), (B[3]-B[1])-(A[3]-A[1]))
    flag = '' if max(map(abs,d))<=1 else '  <--'
    print(f'{name:28s} mock x{A[0]} y{A[1]} w{A[2]-A[0]} h{A[3]-A[1]} | dx{d[0]:+d} dy{d[1]:+d} dw{d[2]:+d} dh{d[3]:+d}{flag}')
