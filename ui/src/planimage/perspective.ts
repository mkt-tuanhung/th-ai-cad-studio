/**
 * Phone photos of a printed plan: the sheet's four corners (found automatically, the user can drag them), the
 * perspective correction (a homography from those corners to an upright rectangle), and deskew (the small rotation
 * that squares the drawing's lines with the image axes). Pure TypeScript on RGBA / grey arrays.
 */
import { close, components, grayOf, inkMask, otsuOf, type Gray, type Mask } from './raster'

export type Pt = [number, number]

/** 3 × 3 homography (row major, h[8] = 1) mapping `src[i]` → `dst[i]` (4 point pairs, DLT with h33 = 1). */
export function homography(src: Pt[], dst: Pt[]): number[] {
  const A: number[][] = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  // Gaussian elimination with partial pivoting on the 8 × 9 augmented matrix
  for (let c = 0; c < 8; c++) {
    let p = c
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r
    ;[A[c], A[p]] = [A[p], A[c]]
    if (Math.abs(A[c][c]) < 1e-12) throw new Error('degenerate corners')
    for (let r = 0; r < 8; r++) {
      if (r === c) continue
      const f = A[r][c] / A[c][c]
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k]
    }
  }
  return [...A.map((r, i) => r[8] / A[i][i]), 1]
}

export function applyH(H: number[], p: Pt): Pt {
  const w = H[6] * p[0] + H[7] * p[1] + H[8]
  return [(H[0] * p[0] + H[1] * p[1] + H[2]) / w, (H[3] * p[0] + H[4] * p[1] + H[5]) / w]
}

export function invertH(H: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = H
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-15) throw new Error('singular homography')
  const inv = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det)
  return inv.map((v) => v / inv[8])
}

/**
 * Resamples an RGBA image through `Hinv` (output px → source px), bilinear; outside the source is white.
 * Used for the perspective correction and for the deskew rotation (an affine H).
 */
export function warpRGBA(src: Uint8ClampedArray | Uint8Array, sw: number, sh: number, Hinv: number[], ow: number, oh: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(ow * oh * 4)
  for (let y = 0; y < oh; y++)
    for (let x = 0; x < ow; x++) {
      const X = x + 0.5, Y = y + 0.5
      const wq = Hinv[6] * X + Hinv[7] * Y + Hinv[8]
      const sx = (Hinv[0] * X + Hinv[1] * Y + Hinv[2]) / wq - 0.5, sy = (Hinv[3] * X + Hinv[4] * Y + Hinv[5]) / wq - 0.5
      const o = (y * ow + x) * 4
      const x0 = Math.floor(sx), y0 = Math.floor(sy)
      if (x0 < -1 || y0 < -1 || x0 >= sw || y0 >= sh) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 255; continue }
      const fx = sx - x0, fy = sy - y0
      for (let ch = 0; ch < 4; ch++) {
        const at = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= sw || yy >= sh ? 255 : src[(yy * sw + xx) * 4 + ch])
        const v = at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy
        out[o + ch] = v
      }
    }
  return out
}

/** Output size of the corrected sheet: the longer of the opposite edges; `aspect` (h / w) when given. */
export function sheetSize(c: Pt[], aspect?: number | null): { w: number; h: number } {
  const d = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])
  let w = Math.max(d(c[0], c[1]), d(c[3], c[2])), h = Math.max(d(c[0], c[3]), d(c[1], c[2]))
  if (aspect) { if (h / w > aspect) w = h / aspect; else h = w * aspect }
  return { w: Math.round(w), h: Math.round(h) }
}

/** A-series paper (1 : √2) when the corrected sheet is within 10 % of it (portrait or landscape), else null. */
export function paperAspect(c: Pt[]): number | null {
  const { w, h } = sheetSize(c)
  const r = h / w
  for (const a of [Math.SQRT2, 1 / Math.SQRT2]) if (Math.abs(r / a - 1) < 0.1) return a
  return null
}

/**
 * The sheet's corners in a photo (TL, TR, BR, BL): the largest bright region (paper) of a downscaled image,
 * its extreme points along the diagonals. Null when the paper fills the picture (a scan, a PDF page) or nothing
 * plausible is found — the picture is then used as it is.
 */
export function detectSheet(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, dbg?: Record<string, unknown>): Pt[] | null {
  const f = Math.max(1, Math.ceil(Math.max(w, h) / 700))
  const sw = Math.ceil(w / f), sh = Math.ceil(h / f)
  const small = new Uint8Array(sw * sh)
  const full = grayOf(rgba, w, h)
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++) {
      let s = 0, n = 0
      for (let yy = y * f; yy < Math.min(h, (y + 1) * f); yy++) for (let xx = x * f; xx < Math.min(w, (x + 1) * f); xx++) { s += full.d[yy * w + xx]; n++ }
      small[y * sw + x] = s / Math.max(1, n)
    }
  const g: Gray = { w: sw, h: sh, d: small }
  const t = otsuOf(g)
  // paper = bright; the ink on it is closed over by taking the bright region's outer extreme points only
  const bright: Mask = inkMask({ w: sw, h: sh, d: small.map((v) => 255 - v) }, 255 - t)
  // the paper as one region: the drawing's lines on it closed over
  const paper = close(bright, 9)
  if (dbg) Object.assign(dbg, { t, sw, sh })
  const { label, stats } = components(paper, 4)
  if (!stats.length) return null
  const big = stats.reduce((a, b) => (b.area > a.area ? b : a))
  if (big.area < 0.2 * sw * sh) return null
  let tl: Pt = [0, 0], tr: Pt = [0, 0], br: Pt = [0, 0], bl: Pt = [0, 0]
  let a = Infinity, b = -Infinity, c = -Infinity, d = -Infinity
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++) {
      if (label[y * sw + x] !== big.id) continue
      if (x + y < a) { a = x + y; tl = [x, y] }
      if (x - y > b) { b = x - y; tr = [x + 1, y] }
      if (x + y > c) { c = x + y; br = [x + 1, y + 1] }
      if (y - x > d) { d = y - x; bl = [x, y + 1] }
    }
  const pts: Pt[] = [tl, tr, br, bl].map(([x, y]) => [x * f, y * f])
  // every corner at the picture's corner: the paper fills the picture (a scan, a PDF page)
  const img: Pt[] = [[0, 0], [w, 0], [w, h], [0, h]]
  if (pts.every((p, i) => Math.abs(p[0] - img[i][0]) <= 0.04 * w && Math.abs(p[1] - img[i][1]) <= 0.04 * h)) return null
  // plausibility: a convex quadrilateral covering a fair part of the picture
  const area = Math.abs(pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % 4][1] - pts[(i + 1) % 4][0] * p[1], 0)) / 2
  if (area < 0.2 * w * h || !convex(pts)) return null
  return pts
}

export function convex(p: Pt[]): boolean {
  let sign = 0
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], c = p[(i + 2) % p.length]
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
    if (Math.abs(z) < 1e-9) continue
    if (!sign) sign = Math.sign(z)
    else if (Math.sign(z) !== sign) return false
  }
  return true
}

/**
 * Skew of a line drawing (degrees, within ±maxDeg): the rotation that makes the ink's horizontal and vertical
 * projection profiles sharpest (sum of squared bin counts), coarse 0.5° then fine 0.05°. Positive = the drawing
 * is turned counter-clockwise in the image (y down) and must be turned back clockwise.
 */
export function skewAngle(m: Mask, maxDeg = 8): number {
  // a sample of the ink pixels (up to 150 000)
  const pts: number[] = []
  let n = 0
  for (let i = 0; i < m.d.length; i++) if (m.d[i]) n++
  const step = Math.max(1, Math.floor(n / 150000))
  let k = 0
  for (let i = 0; i < m.d.length; i++) if (m.d[i] && k++ % step === 0) pts.push(i % m.w, Math.floor(i / m.w))
  if (pts.length < 200) return 0
  const cx = m.w / 2, cy = m.h / 2
  const L = Math.ceil(Math.hypot(m.w, m.h)) + 4
  const hx = new Float64Array(L), hy = new Float64Array(L)
  const score = (deg: number) => {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
    hx.fill(0); hy.fill(0)
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i] - cx, y = pts[i + 1] - cy
      const rx = x * c - y * s, ry = x * s + y * c
      hy[Math.floor(ry + L / 2)]++
      hx[Math.floor(rx + L / 2)]++
    }
    let v = 0
    for (let i = 0; i < L; i++) v += hx[i] * hx[i] + hy[i] * hy[i]
    return v
  }
  let best = 0, bs = score(0)
  for (let d = -maxDeg; d <= maxDeg + 1e-9; d += 0.5) { const s = score(d); if (s > bs) { bs = s; best = d } }
  const c0 = best
  for (let d = c0 - 0.5; d <= c0 + 0.5 + 1e-9; d += 0.05) { const s = score(d); if (s > bs) { bs = s; best = d } }
  return Math.round(best * 100) / 100
}

/** Homography of a rotation by `deg` about the image centre (output keeps the size). */
export function rotationH(deg: number, w: number, h: number): number[] {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
  const cx = w / 2, cy = h / 2
  // p' = R (p − c) + c
  return [c, -s, cx - c * cx + s * cy, s, c, cy - s * cx - c * cy, 0, 0, 1]
}
