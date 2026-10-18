/**
 * Raster primitives for the plan-image recogniser (v2.4 "Ảnh mặt bằng → nội thất 3D"). Pure TypeScript on typed
 * arrays (no canvas): grey images, binary masks, box blur by integral image, max filter, background normalisation
 * (a photo's shadow gradient divided out), separable binary morphology (exact square / rectangle structuring
 * elements), connected components, run lengths. Image coordinates: x right, y DOWN, pixel (x, y) covers
 * [x, x + 1) × [y, y + 1).
 */

export interface Gray { w: number; h: number; d: Uint8Array }
export interface Mask { w: number; h: number; d: Uint8Array }

export const mask = (w: number, h: number): Mask => ({ w, h, d: new Uint8Array(w * h) })
export const cloneMask = (m: Mask): Mask => ({ w: m.w, h: m.h, d: m.d.slice() })

/** Luma (ITU-R 601) of RGBA pixels; transparent pixels count as white paper. */
export function grayOf(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Gray {
  const d = new Uint8Array(w * h)
  for (let i = 0; i < d.length; i++) {
    const a = rgba[i * 4 + 3] / 255
    const v = (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000
    d[i] = Math.round(v * a + 255 * (1 - a))
  }
  return { w, h, d }
}

/** Otsu's threshold of a grey image (between-class variance). */
export function otsuOf(g: Gray | Uint8Array): number {
  const d = g instanceof Uint8Array ? g : g.d
  const hist = new Float64Array(256)
  for (let i = 0; i < d.length; i++) hist[d[i]]++
  const total = d.length
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0, wB = 0, best = -1, t = 127
  for (let i = 0; i < 256; i++) {
    wB += hist[i]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += i * hist[i]
    const mB = sumB / wB, mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) { best = between; t = i }
  }
  return t
}

/** Box blur (mean over a (2r+1)² window, clipped at the borders) by an integral image. */
export function boxBlur(g: Gray, r: number): Gray {
  const { w, h } = g
  const W = w + 1
  const S = new Float64Array(W * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += g.d[y * w + x]
      S[(y + 1) * W + x + 1] = S[y * W + x + 1] + row
    }
  }
  const d = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1)
      const s = S[y1 * W + x1] - S[y0 * W + x1] - S[y1 * W + x0] + S[y0 * W + x0]
      d[y * w + x] = Math.round(s / ((y1 - y0) * (x1 - x0)))
    }
  }
  return { w, h, d }
}

/** Sliding maximum along rows then columns (square window 2r+1), O(n·r) worst case but cheap for small r. */
export function maxFilter(g: Gray, r: number): Gray {
  const { w, h } = g
  const tmp = new Uint8Array(w * h)
  const out = new Uint8Array(w * h)
  // van Herk / Gil-Werman would be O(n); a monotone deque keeps it O(n) too and is simpler
  const q = new Int32Array(Math.max(w, h))
  for (let y = 0; y < h; y++) {
    let head = 0, tail = 0
    const o = y * w
    for (let x = 0; x < w + r; x++) {
      if (x < w) {
        while (tail > head && g.d[o + q[tail - 1]] <= g.d[o + x]) tail--
        q[tail++] = x
      }
      const c = x - r
      if (c >= 0) {
        while (q[head] < c - r) head++
        tmp[o + c] = g.d[o + q[head]]
      }
    }
  }
  for (let x = 0; x < w; x++) {
    let head = 0, tail = 0
    for (let y = 0; y < h + r; y++) {
      if (y < h) {
        while (tail > head && tmp[q[tail - 1] * w + x] <= tmp[y * w + x]) tail--
        q[tail++] = y
      }
      const c = y - r
      if (c >= 0) {
        while (q[head] < c - r) head++
        out[c * w + x] = tmp[q[head] * w + x]
      }
    }
  }
  return { w, h, d: out }
}

/**
 * Paper-white normalisation: the background (local maximum, then smoothed) is divided out, so a shadow gradient
 * or uneven light of a phone photo becomes an even white page; the ink keeps its contrast to the paper around it.
 */
export function normalizeBackground(g: Gray, r = Math.max(6, Math.round(Math.min(g.w, g.h) / 120))): Gray {
  const bg = boxBlur(maxFilter(g, r), r * 2)
  const d = new Uint8Array(g.w * g.h)
  for (let i = 0; i < d.length; i++) d[i] = Math.min(255, Math.round((g.d[i] * 255) / Math.max(24, bg.d[i])))
  return { w: g.w, h: g.h, d }
}

/** Contrast stretch: the 1st…99.5th percentile spread to 0…255. */
export function stretch(g: Gray): Gray {
  const hist = new Float64Array(256)
  for (let i = 0; i < g.d.length; i++) hist[g.d[i]]++
  const n = g.d.length
  let acc = 0, lo = 0, hi = 255
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * 0.01) { lo = i; break } }
  acc = 0
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= n * 0.005) { hi = i; break } }
  if (hi - lo < 16) return g
  const d = new Uint8Array(n)
  for (let i = 0; i < n; i++) d[i] = Math.max(0, Math.min(255, Math.round(((g.d[i] - lo) * 255) / (hi - lo))))
  return { w: g.w, h: g.h, d }
}

/** 3 × 3 median (salt-and-pepper / JPEG noise). */
export function median3(g: Gray): Gray {
  const { w, h } = g
  const d = g.d.slice()
  const v = new Uint8Array(9)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      let k = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) v[k++] = g.d[(y + dy) * w + x + dx]
      // partial insertion sort up to the 5th element
      for (let i = 1; i < 9; i++) { const t = v[i]; let j = i - 1; while (j >= 0 && v[j] > t) { v[j + 1] = v[j]; j-- } v[j + 1] = t }
      d[y * w + x] = v[4]
    }
  return { w, h, d }
}

/** Ink mask: grey below `t`. */
export function inkMask(g: Gray, t: number): Mask {
  const m = mask(g.w, g.h)
  for (let i = 0; i < m.d.length; i++) m.d[i] = g.d[i] < t ? 1 : 0
  return m
}

/* ---------------------------------------------------------------- morphology (exact, separable) */

/** Erosion by a rectangle sx × sy (anchor at floor((s−1)/2)); outside the image counts as background. */
export function erode(m: Mask, sx: number, sy = sx): Mask {
  return pass(pass(m, sx, true, 'erode'), sy, false, 'erode')
}
/** Dilation by the reflected rectangle (so that dilate(erode(m)) is an exact opening). */
export function dilate(m: Mask, sx: number, sy = sx): Mask {
  return pass(pass(m, sx, true, 'dilate'), sy, false, 'dilate')
}
export const open = (m: Mask, sx: number, sy = sx) => dilate(erode(m, sx, sy), sx, sy)
export const close = (m: Mask, sx: number, sy = sx) => erode(dilate(m, sx, sy), sx, sy)

function pass(m: Mask, s: number, horiz: boolean, op: 'erode' | 'dilate'): Mask {
  if (s <= 1) return cloneMask(m)
  const { w, h } = m
  const out = mask(w, h)
  const a = Math.floor((s - 1) / 2), b = s - 1 - a
  // erosion window [i − a, i + b]; dilation (reflected) [i − b, i + a]
  const lo = op === 'erode' ? a : b, hi = op === 'erode' ? b : a
  const n = horiz ? w : h, lines = horiz ? h : w
  const pre = new Int32Array(n + 1)
  for (let l = 0; l < lines; l++) {
    const at = (i: number) => (horiz ? l * w + i : i * w + l)
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + m.d[at(i)]
    for (let i = 0; i < n; i++) {
      const i0 = i - lo, i1 = i + hi
      if (op === 'erode') {
        if (i0 < 0 || i1 >= n) continue
        if (pre[i1 + 1] - pre[i0] === s) out.d[at(i)] = 1
      } else {
        const c0 = Math.max(0, i0), c1 = Math.min(n - 1, i1)
        if (pre[c1 + 1] - pre[c0] > 0) out.d[at(i)] = 1
      }
    }
  }
  return out
}

export function and(a: Mask, b: Mask): Mask { const o = mask(a.w, a.h); for (let i = 0; i < o.d.length; i++) o.d[i] = a.d[i] & b.d[i]; return o }
export function or(a: Mask, b: Mask): Mask { const o = mask(a.w, a.h); for (let i = 0; i < o.d.length; i++) o.d[i] = a.d[i] | b.d[i]; return o }
export function minus(a: Mask, b: Mask): Mask { const o = mask(a.w, a.h); for (let i = 0; i < o.d.length; i++) o.d[i] = a.d[i] & (b.d[i] ^ 1); return o }
export const count = (m: Mask) => { let n = 0; for (let i = 0; i < m.d.length; i++) n += m.d[i]; return n }

/** Fills an axis-aligned rectangle (pixel bounds, inclusive start, exclusive end; clipped). */
export function fillRect(m: Mask, x0: number, y0: number, x1: number, y1: number, v = 1) {
  const a = Math.max(0, Math.floor(x0)), b = Math.min(m.w, Math.ceil(x1)), c = Math.max(0, Math.floor(y0)), e = Math.min(m.h, Math.ceil(y1))
  for (let y = c; y < e; y++) m.d.fill(v, y * m.w + a, y * m.w + b)
}

/** Fills a convex polygon (scanline on pixel centres). */
export function fillPoly(m: Mask, pts: [number, number][], v = 1) {
  if (pts.length < 3) return
  const ys = pts.map((p) => p[1])
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(m.h - 1, Math.ceil(Math.max(...ys)))
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5
    const xs: number[] = []
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length]
      if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) xs.push(ax + ((cy - ay) * (bx - ax)) / (by - ay))
    }
    xs.sort((p, q) => p - q)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil(xs[k] - 0.5)), b = Math.min(m.w - 1, Math.floor(xs[k + 1] - 0.5))
      if (b >= a) m.d.fill(v, y * m.w + a, y * m.w + b + 1)
    }
  }
}

/* ---------------------------------------------------------------- components, runs */

export interface CompStat { id: number; area: number; x0: number; y0: number; x1: number; y1: number; sx: number; sy: number }

/** Connected components of the 1-pixels (4- or 8-connected). label: −1 background, else component index. */
export function components(m: Mask, conn: 4 | 8 = 8, value = 1): { label: Int32Array; stats: CompStat[] } {
  const { w, h } = m
  const label = new Int32Array(w * h).fill(-1)
  const stats: CompStat[] = []
  const stack = new Int32Array(w * h)
  for (let i = 0; i < m.d.length; i++) {
    if (m.d[i] !== value || label[i] >= 0) continue
    const id = stats.length
    const st: CompStat = { id, area: 0, x0: w, y0: h, x1: -1, y1: -1, sx: 0, sy: 0 }
    let sp = 0
    stack[sp++] = i
    label[i] = id
    while (sp) {
      const k = stack[--sp]
      const x = k % w, y = (k - x) / w
      st.area++; st.sx += x; st.sy += y
      if (x < st.x0) st.x0 = x
      if (x > st.x1) st.x1 = x
      if (y < st.y0) st.y0 = y
      if (y > st.y1) st.y1 = y
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          if (conn === 4 && dx && dy) continue
          const xx = x + dx, yy = y + dy
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          const j = yy * w + xx
          if (m.d[j] === value && label[j] < 0) { label[j] = id; stack[sp++] = j }
        }
    }
    stats.push(st)
  }
  return { label, stats }
}

/** Removes 8-connected ink components smaller than `min` pixels. */
export function despeckle(m: Mask, min: number): Mask {
  const { label, stats } = components(m, 8)
  const o = cloneMask(m)
  for (let i = 0; i < o.d.length; i++) if (label[i] >= 0 && stats[label[i]].area < min) o.d[i] = 0
  return o
}

/** Length of the horizontal and the vertical run of 1-pixels through every pixel (0 off the mask). */
export function runLengths(m: Mask): { hr: Uint16Array; vr: Uint16Array } {
  const { w, h } = m
  const hr = new Uint16Array(w * h), vr = new Uint16Array(w * h)
  for (let y = 0; y < h; y++) {
    let x = 0
    while (x < w) {
      if (!m.d[y * w + x]) { x++; continue }
      let e = x
      while (e < w && m.d[y * w + e]) e++
      const L = Math.min(65535, e - x)
      for (let k = x; k < e; k++) hr[y * w + k] = L
      x = e
    }
  }
  for (let x = 0; x < w; x++) {
    let y = 0
    while (y < h) {
      if (!m.d[y * w + x]) { y++; continue }
      let e = y
      while (e < h && m.d[e * w + x]) e++
      const L = Math.min(65535, e - y)
      for (let k = y; k < e; k++) vr[k * w + x] = L
      y = e
    }
  }
  return { hr, vr }
}

/** Two-pass chamfer (3-4) distance to the nearest 0-pixel, in pixels (÷3). */
export function distanceToBackground(m: Mask): Float32Array {
  const { w, h } = m
  const INF = 1e9
  const d = new Float32Array(w * h)
  for (let i = 0; i < d.length; i++) d[i] = m.d[i] ? INF : 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!d[i]) continue
      let v = d[i]
      if (x > 0) v = Math.min(v, d[i - 1] + 3)
      else v = Math.min(v, 3)
      if (y > 0) {
        v = Math.min(v, d[i - w] + 3)
        if (x > 0) v = Math.min(v, d[i - w - 1] + 4)
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4)
      } else v = Math.min(v, 3)
      d[i] = v
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      if (!d[i]) continue
      let v = d[i]
      if (x < w - 1) v = Math.min(v, d[i + 1] + 3)
      else v = Math.min(v, 3)
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 3)
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4)
        if (x > 0) v = Math.min(v, d[i + w - 1] + 4)
      } else v = Math.min(v, 3)
      d[i] = v
    }
  for (let i = 0; i < d.length; i++) d[i] /= 3
  return d
}

/** Nearest-neighbour downscale of a mask by an integer factor (a block is ink when any of its pixels is). */
export function shrinkMask(m: Mask, f: number): Mask {
  if (f <= 1) return cloneMask(m)
  const w = Math.ceil(m.w / f), h = Math.ceil(m.h / f)
  const o = mask(w, h)
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.d[y * m.w + x]) o.d[Math.floor(y / f) * w + Math.floor(x / f)] = 1
  return o
}
