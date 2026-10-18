/**
 * Raster → CAD vectors for scanned / photographed line drawings, fully offline.
 *
 * Lines: classic image processing — Otsu binarisation, speckle removal, Zhang–Suen thinning to a
 * one-pixel skeleton, tracing the skeleton into chains between end points and junctions,
 * Ramer–Douglas–Peucker simplification, circle fitting on closed chains, optional snapping of nearly
 * horizontal / vertical segments. Text: Tesseract LSTM OCR (tesseract.js, models vie + eng from
 * tessdata_fast, bundled in /ocr) — recognised words become TEXT and their pixels are removed before
 * the line tracing. Units: `mmPerPx` (scan dpi × drawing scale); y up as in CAD.
 * What it is not: an AI "understanding" of the drawing — hatching, arrows and dimension values come out
 * as plain geometry / text, and a poor scan gives broken lines. The result is a starting point to correct.
 */
import type { Entity, Vec2 } from './types'
import { OCR_CONFIDENT } from './importReview'

export interface VectorizeOptions {
  mmPerPx: number
  /** Snap segments within 3° of horizontal / vertical. */
  ortho: boolean
  /** Recognise text (Tesseract). */
  ocr: boolean
  onStep?: (step: 'binarize' | 'ocr' | 'thin' | 'trace', pct?: number) => void
}

export interface VectorizeResult {
  /** Every word Tesseract returned (kept or not), for the record. */
  allWords?: { text: string; conf: number; h: number }[]
  entities: Entity[]
  counts: { lines: number; polylines: number; circles: number; texts: number }
  /** Size used (px, after an eventual downscale) and the threshold chosen. */
  w: number
  h: number
  threshold: number
  ms: number
  words: { text: string; conf: number }[]
  /** Words kept for review (confidence below OCR_CONFIDENT), on layer SCAN-TEXT-REVIEW. */
  review: { text: string; conf: number }[]
}

const MAX_SIDE = 5000

/** Otsu's threshold of an 8-bit grey image. */
export function otsu(grey: Uint8Array): number {
  const hist = new Array(256).fill(0)
  for (const v of grey) hist[v]++
  const total = grey.length
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0, wB = 0, best = 0, t = 127
  for (let i = 0; i < 256; i++) {
    wB += hist[i]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += i * hist[i]
    const mB = sumB / wB, mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) (best = between), (t = i)
  }
  return t
}

/** Zhang–Suen thinning in place (1 = ink). */
export function thin(m: Uint8Array, w: number, h: number) {
  const del: number[] = []
  let changed = true
  while (changed) {
    changed = false
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0
      for (let y = 1; y < h - 1; y++)
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x
          if (!m[i]) continue
          const p2 = m[i - w], p3 = m[i - w + 1], p4 = m[i + 1], p5 = m[i + w + 1], p6 = m[i + w], p7 = m[i + w - 1], p8 = m[i - 1], p9 = m[i - w - 1]
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
          if (b < 2 || b > 6) continue
          const a = (+(!p2 && p3)) + (+(!p3 && p4)) + (+(!p4 && p5)) + (+(!p5 && p6)) + (+(!p6 && p7)) + (+(!p7 && p8)) + (+(!p8 && p9)) + (+(!p9 && p2))
          if (a !== 1) continue
          if (pass === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue
          del.push(i)
        }
      if (del.length) changed = true
      for (const i of del) m[i] = 0
    }
  }
}

const N8 = (w: number) => [-w - 1, -w, -w + 1, 1, w + 1, w, w - 1, -1]

/** Skeleton → pixel chains between end points / junctions, plus closed loops. */
export function trace(m: Uint8Array, w: number, h: number): { pts: number[]; closed: boolean; ends?: [Vec2 | null, Vec2 | null] }[] {
  const off = N8(w)
  // node = end point or junction by the crossing number (0→1 transitions around the pixel): staircase
  // pixels of a diagonal have three neighbours but are not junctions
  const ring = [-w, -w + 1, 1, w + 1, w, w - 1, -1, -w - 1]
  const crossings = (i: number) => {
    let c = 0
    for (let k = 0; k < 8; k++) if (!m[i + ring[k]] && m[i + ring[(k + 1) % 8]]) c++
    return c
  }
  const isNode = new Uint8Array(m.length)
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (m[i] && crossings(i) !== 2) isNode[i] = 1 }
  const used = new Uint8Array(m.length) // non-node pixels already in a chain
  const chains: { pts: number[]; closed: boolean; ends?: [Vec2 | null, Vec2 | null] }[] = []
  const walk = (start: number, first: number) => {
    const pts = [start, first]
    let prev = start, cur = first
    while (!isNode[cur]) {
      used[cur] = 1
      let next = -1
      // a pixel that also touches the previous one belongs to another branch at a crossing (going straight on
      // is preferred): taken only when there is no other way
      let side = -1
      const px = prev % w, py = (prev - px) / w
      for (const o of off) {
        const j = cur + o
        if (j === start && pts.length > 3) { next = j; break } // back at the start: a closed loop
        if (m[j] && j !== prev && (isNode[j] || !used[j]) && !(pts.length > 2 && j === pts[pts.length - 3])) {
          if (isNode[j]) { next = j; break }
          const jx = j % w, jy = (j - jx) / w
          if (Math.abs(jx - px) <= 1 && Math.abs(jy - py) <= 1) side = j
          else next = j
        }
      }
      if (next < 0) next = side
      if (next < 0) break
      // staircase pixels next to both this pixel and the next one are part of this chain too — not when the next
      // one is a junction: the pixels around a junction are the first pixels of its other branches
      if (!isNode[next]) for (const o of off) { const j = cur + o; if (m[j] && !isNode[j] && j !== next && Math.abs((j % w) - (next % w)) <= 1 && Math.abs(Math.floor(j / w) - Math.floor(next / w)) <= 1) used[j] = 1 }
      pts.push(next)
      prev = cur
      cur = next
      if (cur === start) break
    }
    return pts
  }
  for (let i = 0; i < m.length; i++) {
    if (!isNode[i]) continue
    for (const o of off) {
      const j = i + o
      if (!m[j] || used[j]) continue
      if (isNode[j]) { if (j > i) chains.push({ pts: [i, j], closed: false }); continue }
      chains.push({ pts: walk(i, j), closed: false })
    }
  }
  // loops without any node (rectangles, circles drawn alone)
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || used[i] || isNode[i]) continue
    let next = -1
    for (const o of off) if (m[i + o]) { next = i + o; break }
    if (next < 0) continue
    used[i] = 1
    const pts = walk(i, next)
    if (pts.length >= 8) chains.push({ pts, closed: pts[pts.length - 1] === i })
  }
  // junction clusters (node pixels ≤ 2 px apart): a chain ending at one ends at the cluster's centre — a line
  // meeting a cross / tick / corner keeps its full length instead of stopping a pixel or two short
  const label = new Int32Array(m.length).fill(-1)
  const cent: Vec2[] = []
  for (let i = 0; i < m.length; i++) {
    if (!isNode[i] || label[i] >= 0) continue
    const id = cent.length
    const st = [i]
    label[i] = id
    let sx = 0, sy = 0, n = 0
    while (st.length) {
      const k = st.pop()!
      sx += k % w; sy += Math.floor(k / w); n++
      // nodes up to 2 px apart are one junction (thinning leaves a crossing as a small group of node pixels)
      const kx = k % w, ky = (k - kx) / w
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = kx + dx, y = ky + dy
        if (x < 0 || y < 0 || x >= w || y >= h) continue
        const j = y * w + x
        if (isNode[j] && label[j] < 0) { label[j] = id; st.push(j) }
      }
    }
    cent.push({ x: sx / n, y: sy / n })
  }
  for (const ch of chains) {
    if (ch.closed) continue
    const a = ch.pts[0], b = ch.pts[ch.pts.length - 1]
    ;(ch as { ends?: [Vec2 | null, Vec2 | null] }).ends = [isNode[a] ? cent[label[a]] : null, isNode[b] ? cent[label[b]] : null]
  }
  return chains as { pts: number[]; closed: boolean; ends?: [Vec2 | null, Vec2 | null] }[]
}

/** Ramer–Douglas–Peucker. */
export function rdp(p: Vec2[], eps: number): Vec2[] {
  if (p.length < 3) return p
  const a = p[0], b = p[p.length - 1]
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy)
  let best = -1, at = 0
  for (let i = 1; i < p.length - 1; i++) {
    const d = L < 1e-9 ? Math.hypot(p[i].x - a.x, p[i].y - a.y) : Math.abs(dy * p[i].x - dx * p[i].y + b.x * a.y - b.y * a.x) / L
    if (d > best) (best = d), (at = i)
  }
  if (best <= eps) return [a, b]
  return [...rdp(p.slice(0, at + 1), eps).slice(0, -1), ...rdp(p.slice(at), eps)]
}

/** Least-squares circle (Kåsa); null when the points are not on a circle within `tol`. */
export function fitCircle(p: Vec2[], tol: number): { c: Vec2; r: number } | null {
  if (p.length < 12) return null
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0
  for (const { x, y } of p) {
    const z = x * x + y * y
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z
  }
  const n = p.length
  // solve [sxx sxy sx; sxy syy sy; sx sy n] [a b c] = [sxz syz sz]  →  centre (a/2, b/2)
  const M = [[sxx, sxy, sx, sxz], [sxy, syy, sy, syz], [sx, sy, n, sz]]
  for (let i = 0; i < 3; i++) {
    let piv = i
    for (let k = i + 1; k < 3; k++) if (Math.abs(M[k][i]) > Math.abs(M[piv][i])) piv = k
    ;[M[i], M[piv]] = [M[piv], M[i]]
    if (Math.abs(M[i][i]) < 1e-12) return null
    for (let k = 0; k < 3; k++) if (k !== i) { const f = M[k][i] / M[i][i]; for (let j = i; j < 4; j++) M[k][j] -= f * M[i][j] }
  }
  const a = M[0][3] / M[0][0], b = M[1][3] / M[1][1], c = M[2][3] / M[2][2]
  const cx = a / 2, cy = b / 2, r = Math.sqrt(c + cx * cx + cy * cy)
  if (!Number.isFinite(r) || r < 4) return null
  let err = 0
  for (const q of p) err += (Math.hypot(q.x - cx, q.y - cy) - r) ** 2
  return Math.sqrt(err / n) <= tol ? { c: { x: cx, y: cy }, r } : null
}

/**
 * Text / graphics separation for OCR: an image with only the letter-sized ink components (bounding box
 * at most `maxSide` px); walls, frames, circles and long lines are left out so they do not merge with words.
 */
function textOnly(m: Uint8Array, w: number, h: number, maxSide: number): ImageData {
  const out = new ImageData(w, h)
  out.data.fill(255)
  const seen = new Uint8Array(m.length)
  const stack: number[] = []
  const comp: number[] = []
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || seen[i]) continue
    comp.length = 0
    stack.push(i)
    seen[i] = 1
    let x0 = w, y0 = h, x1 = 0, y1 = 0
    while (stack.length) {
      const k = stack.pop()!
      comp.push(k)
      const x = k % w, y = (k - x) / w
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        const j = yy * w + xx
        if (m[j] && !seen[j]) (seen[j] = 1), stack.push(j)
      }
    }
    if (Math.max(x1 - x0, y1 - y0) > maxSide) continue
    for (const k of comp) out.data[k * 4] = out.data[k * 4 + 1] = out.data[k * 4 + 2] = 0
  }
  return out
}

/** Removes ink components smaller than `min` pixels (speckle). */
function despeckle(m: Uint8Array, w: number, h: number, min: number) {
  const seen = new Uint8Array(m.length)
  const stack: number[] = []
  const comp: number[] = []
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || seen[i]) continue
    comp.length = 0
    stack.push(i)
    seen[i] = 1
    while (stack.length) {
      const k = stack.pop()!
      comp.push(k)
      const x = k % w, y = (k - x) / w
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        const j = yy * w + xx
        if (m[j] && !seen[j]) (seen[j] = 1), stack.push(j)
      }
    }
    if (comp.length < min) for (const k of comp) m[k] = 0
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

/**
 * Clears a recognised word's box from the line image — except rows / columns of ink that run straight through the
 * whole box and go on outside it on both sides: those are lines (a dimension line, a wall) the word box overlaps,
 * and cutting them would break the line in two (v2.4: dimension lines must keep their true length).
 */
export function eraseBox(m: Uint8Array, w: number, h: number, bx0: number, by0: number, bx1: number, by1: number) {
  const x0 = Math.max(0, bx0), y0 = Math.max(0, by0), x1 = Math.min(w - 1, bx1), y1 = Math.min(h - 1, by1)
  const keepRow = new Uint8Array(y1 - y0 + 1), keepCol = new Uint8Array(x1 - x0 + 1)
  for (let y = y0; y <= y1; y++) {
    if (x0 < 2 || x1 > w - 3 || !m[y * w + x0 - 2] || !m[y * w + x1 + 2]) continue
    let full = true
    for (let x = x0; x <= x1 && full; x++) full = !!m[y * w + x]
    if (full) keepRow[y - y0] = 1
  }
  for (let x = x0; x <= x1; x++) {
    if (y0 < 2 || y1 > h - 3 || !m[(y0 - 2) * w + x] || !m[(y1 + 2) * w + x]) continue
    let full = true
    for (let y = y0; y <= y1 && full; y++) full = !!m[y * w + x]
    if (full) keepCol[x - x0] = 1
  }
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!keepRow[y - y0] && !keepCol[x - x0]) m[y * w + x] = 0
}

/** The offline Tesseract worker (worker, core and the Vietnamese model bundled in /ocr). */
export async function ocrWorker(onPct?: (pct: number) => void) {
  const { createWorker } = await import('tesseract.js')
  // Vietnamese model only: it reads Latin text too, and adding English drops the diacritics of capitals
  return createWorker('vie', 1, {
    workerPath: '/ocr/worker.min.js',
    corePath: '/ocr',
    langPath: '/ocr/lang',
    gzip: false,
    workerBlobURL: false,
    logger: (l: { status: string; progress: number }) => l.status === 'recognizing text' && onPct?.(Math.round(l.progress * 100)),
  })
}

/** One OCR word: text, Tesseract confidence (0–100), box in picture px. */
export type OcrWord = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }

/**
 * Tesseract LSTM OCR of a picture (offline: worker, core and the Vietnamese model from /ocr), two passes — the page
 * as it is, and letter-sized ink only (text / graphics separation, `m` = the ink mask, 1 = ink); where both find a
 * word at the same place the more confident reading is kept. Shared by Scan to CAD and the plan-image recogniser.
 */
export async function ocrWords(canvas: HTMLCanvasElement, m: Uint8Array, w: number, h: number, onPct?: (pct: number) => void): Promise<OcrWord[]> {
  const worker = await ocrWorker(onPct)
  const ocrCanvas = document.createElement('canvas')
  ocrCanvas.width = w
  ocrCanvas.height = h
  ocrCanvas.getContext('2d')!.putImageData(textOnly(m, w, h, Math.max(80, Math.round(Math.max(w, h) * 0.04))), 0, 0)
  const passes: OcrWord[][] = []
  try {
    for (const img of [canvas, ocrCanvas]) passes.push(((await worker.recognize(img)).data.words as OcrWord[]).filter((x) => x.text.trim()))
  } finally {
    await worker.terminate()
  }
  const iou = (a: OcrWord['bbox'], b: OcrWord['bbox']) => {
    const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)), iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0))
    const inter = ix * iy, u = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter
    return u > 0 ? inter / u : 0
  }
  const merged: OcrWord[] = []
  for (const wd of passes.flat()) {
    const same = merged.findIndex((x) => iou(x.bbox, wd.bbox) > 0.3)
    if (same < 0) merged.push(wd)
    else if (wd.confidence > merged[same].confidence) merged[same] = wd
  }
  return merged.map((x) => ({ text: x.text, confidence: x.confidence, bbox: { x0: x.bbox.x0, y0: x.bbox.y0, x1: x.bbox.x1, y1: x.bbox.y1 } }))
}

export async function vectorize(source: CanvasImageSource & { width: number; height: number }, opts: VectorizeOptions): Promise<VectorizeResult> {
  const t0 = performance.now()
  const k = Math.min(1, MAX_SIDE / Math.max(source.width, source.height))
  const w = Math.round(source.width * k), h = Math.round(source.height * k)
  const mm = opts.mmPerPx / k
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(source, 0, 0, w, h)
  opts.onStep?.('binarize')
  await tick()
  const px = ctx.getImageData(0, 0, w, h).data
  const grey = new Uint8Array(w * h)
  for (let i = 0; i < grey.length; i++) grey[i] = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000
  const threshold = otsu(grey)
  const m = new Uint8Array(w * h)
  for (let i = 0; i < m.length; i++) m[i] = grey[i] < threshold ? 1 : 0
  for (let x = 0; x < w; x++) (m[x] = 0), (m[(h - 1) * w + x] = 0)
  for (let y = 0; y < h; y++) (m[y * w] = 0), (m[y * w + w - 1] = 0)
  despeckle(m, w, h, 6)

  const base = { color: 'ByLayer', linetype: 'ByLayer', lineweight: 'ByLayer', transparency: 0 } as const
  const entities: Entity[] = []
  const counts = { lines: 0, polylines: 0, circles: 0, texts: 0 }
  const words: { text: string; conf: number }[] = []
  const review: { text: string; conf: number }[] = []
  let allWords: VectorizeResult['allWords']
  let n = 0
  const W = (x: number, y: number): Vec2 => ({ x: x * mm, y: (h - y) * mm })

  // ---- text: OCR, then clear the recognised words from the line image
  if (opts.ocr) {
    opts.onStep?.('ocr', 0)
    const merged = await ocrWords(canvas, m, w, h, (pct) => opts.onStep?.('ocr', pct))
    allWords = merged.map((x) => ({ text: x.text, conf: Math.round(x.confidence), h: x.bbox.y1 - x.bbox.y0 }))
    for (const wd of merged) {
      const text = wd.text.trim()
      const { x0, y0, x1, y1 } = wd.bbox
      const bh = y1 - y0
      const cls = classifyWord(text, wd.confidence, wd.bbox, w, h)
      if (cls === 'drop') continue
      const conf = Math.round(wd.confidence)
      // v2.4: an uncertain reading is kept for review (own layer, confidence on the entity), never silently dropped;
      // its pixels stay in the line image (it may be part of the drawing, not text)
      const src = { id: '', confidence: conf / 100, bbox: { x0: x0 * mm, y0: (h - y1) * mm, x1: x1 * mm, y1: (h - y0) * mm } }
      if (cls === 'review') {
        review.push({ text, conf })
        entities.push({ ...base, id: `scan${++n}`, kind: 'text', layer: 'SCAN-TEXT-REVIEW', p: W(x0, y1), height: bh * mm * 0.72, value: text, rotation: 0, align: 'left', src: { ...src, reviewRequired: true } })
        counts.texts++
        continue
      }
      words.push({ text, conf })
      entities.push({ ...base, id: `scan${++n}`, kind: 'text', layer: 'SCAN-TEXT', p: W(x0, y1), height: bh * mm * 0.72, value: text, rotation: 0, align: 'left', src })
      counts.texts++
      eraseBox(m, w, h, x0 - 1, y0 - 1, x1 + 1, y1 + 1)
    }
  }

  // ---- lines
  opts.onStep?.('thin')
  await tick()
  thin(m, w, h)
  opts.onStep?.('trace')
  await tick()
  for (const ch of trace(m, w, h)) {
    let pts = ch.pts.map((i) => ({ x: i % w, y: Math.floor(i / w) }))
    if (ch.ends?.[0]) pts[0] = ch.ends[0]
    if (ch.ends?.[1]) pts[pts.length - 1] = ch.ends[1]
    if (pts.length < 4 && !ch.closed) {
      const L = Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y)
      if (L < 3) continue
    }
    if (ch.closed) {
      const circ = fitCircle(pts, 1.2)
      if (circ) {
        entities.push({ ...base, id: `scan${++n}`, kind: 'circle', layer: 'SCAN-LINES', c: W(circ.c.x, circ.c.y), r: circ.r * mm })
        counts.circles++
        continue
      }
    }
    pts = rdp(pts, 1.3)
    if (ch.closed && pts.length > 2 && pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y) pts = pts.slice(0, -1)
    if (opts.ortho)
      for (let i = 0; i + 1 < pts.length; i++) {
        const dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y
        const a = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI) % 180
        if (a < 3 || a > 177) pts[i + 1] = { ...pts[i + 1], y: pts[i].y }
        else if (Math.abs(a - 90) < 3) pts[i + 1] = { ...pts[i + 1], x: pts[i].x }
      }
    const wp = pts.map((p) => W(p.x, p.y))
    if (wp.length === 2 && !ch.closed) {
      entities.push({ ...base, id: `scan${++n}`, kind: 'line', layer: 'SCAN-LINES', a: wp[0], b: wp[1] })
      counts.lines++
    } else if (wp.length >= 2) {
      entities.push({ ...base, id: `scan${++n}`, kind: 'polyline', layer: 'SCAN-LINES', pts: wp, closed: ch.closed && wp.length > 2 })
      counts.polylines++
    }
  }
  return { entities, counts, w, h, threshold, ms: Math.round(performance.now() - t0), words, review, allWords }
}

/**
 * What to do with an OCR word: 'keep' (confident text), 'review' (letter-sized text read with confidence below
 * OCR_CONFIDENT — kept, flagged for the user), 'drop' (not text: empty, no letter / digit, too small, taller
 * than 12 % of the page or wider than 60 % — a line or a frame).
 */
export function classifyWord(text: string, confidence: number, bbox: { x0: number; y0: number; x1: number; y1: number }, w: number, h: number): 'keep' | 'review' | 'drop' {
  const bh = bbox.y1 - bbox.y0
  if (!text.trim() || bh < 6 || bh > h * 0.12 || bbox.x1 - bbox.x0 > w * 0.6 || !/[\p{L}\p{N}]/u.test(text)) return 'drop'
  return confidence < OCR_CONFIDENT ? 'review' : 'keep'
}
