/**
 * Text of a plan picture, line by line: drawings carry sparse text among line work, which whole-page OCR reads
 * poorly. The letters are found first (letter-sized ink components, accents joined to their letter), chained into
 * horizontal text lines, and each line is read alone (Tesseract, single-line mode) from a clean, enlarged picture of
 * just its letters. Offline (the bundled Vietnamese model, cad/vectorize.ts ocrWorker).
 */
import { ocrWorker } from '../cad/vectorize'
import { components, dilate, minus, runLengths, type Gray, type Mask } from './raster'
import type { PWord } from './recognize'

export interface LineBox { x0: number; y0: number; x1: number; y1: number; h: number }

/**
 * Text blocks: the letter-sized ink components (`minH`…`maxH` px high, not long, not large outlines) smeared
 * together (run-length smoothing: gaps ≤ `gapH` along a row, ≤ `gapV` down a column — letters into words, words
 * into lines, accents onto their letters); each smeared blob is a block of one or a few text lines.
 */
export function textLineBoxes(textInk: Mask, minH: number, maxH: number): { lines: LineBox[]; letters: Mask; letterH: number } {
  const { label, stats } = components(textInk, 8)
  const H = (i: number) => stats[i].y1 - stats[i].y0 + 1, Wd = (i: number) => stats[i].x1 - stats[i].x0 + 1
  const ok = stats.map((st, i) => st.area >= 2 && H(i) <= maxH && Wd(i) <= 1.6 * maxH && !(Wd(i) > 6 * H(i) && H(i) <= 3))
  const letters: Mask = { w: textInk.w, h: textInk.h, d: new Uint8Array(textInk.d.length) }
  for (let i = 0; i < label.length; i++) if (label[i] >= 0 && ok[label[i]]) letters.d[i] = 1
  // typical letter height: the median of the components of letter size
  // typical letter height: the ink-weighted median height of the letter-sized components (slivers left by the
  // line removal weigh little)
  const cand = stats.map((_, i) => i).filter((i) => ok[i] && H(i) >= minH).sort((a, b) => H(a) - H(b))
  let th = minH * 2
  if (cand.length) {
    const total = cand.reduce((a, i) => a + stats[i].area, 0)
    let acc = 0
    for (const i of cand) { acc += stats[i].area; if (acc >= total / 2) { th = H(i); break } }
  }
  const gapH = Math.max(3, Math.round(0.8 * th)), gapV = Math.max(1, Math.round(0.3 * th))
  const sm: Mask = { w: letters.w, h: letters.h, d: letters.d.slice() }
  const W = sm.w, Hh = sm.h
  for (let y = 0; y < Hh; y++) {
    let last = -1
    for (let x = 0; x < W; x++) if (letters.d[y * W + x]) { if (last >= 0 && x - last - 1 <= gapH) sm.d.fill(1, y * W + last + 1, y * W + x); last = x }
  }
  const v = sm.d.slice()
  for (let x = 0; x < W; x++) {
    let last = -1
    for (let y = 0; y < Hh; y++) if (v[y * W + x]) { if (last >= 0 && y - last - 1 <= gapV) for (let k = last + 1; k < y; k++) sm.d[k * W + x] = 1; last = y }
  }
  const blobs = components(sm, 8)
  const lines: LineBox[] = []
  for (const st of blobs.stats) {
    const bw = st.x1 - st.x0 + 1, bh = st.y1 - st.y0 + 1
    if (bh < minH || bh > 4 * maxH || bw < 0.8 * minH) continue
    // ink of letters inside (not a smear of dots)
    let n = 0
    for (let y = st.y0; y <= st.y1; y++) for (let x = st.x0; x <= st.x1; x++) n += letters.d[y * W + x]
    if (n < 0.08 * bw * bh || n < 12) continue
    lines.push({ x0: st.x0, y0: st.y0, x1: st.x1 + 1, y1: st.y1 + 1, h: Math.min(bh, th) })
  }
  return { lines, letters, letterH: th }
}

/** Ink of the text only: the wall bands (with a margin) and every long straight run (dimension lines, room
 *  boundaries, grid lines running through a label) taken out. */
export function textInkOf(ink: Mask, bands: Mask, longRun: number): Mask {
  const out = minus(ink, dilate(bands, 3))
  const { hr, vr } = runLengths(out)
  for (let i = 0; i < out.d.length; i++) if (out.d[i] && (hr[i] >= longRun || vr[i] >= longRun)) out.d[i] = 0
  return out
}

/**
 * Reads each text line alone: the picture's own grey pixels of its letters (other ink whitened), enlarged smoothly
 * to ~34 px letters, Tesseract in single-line mode. Words come back in picture px with their confidence.
 */
export async function readTextLines(gray: Gray, notText: Mask | null, lines: LineBox[], onPct?: (n: number) => void): Promise<PWord[]> {
  if (!lines.length) return []
  const worker = await ocrWorker()
  const out: PWord[] = []
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '6' as never, preserve_interword_spaces: '1' })
    let k = 0
    for (const L of lines) {
      onPct?.(Math.round((100 * k++) / lines.length))
      const f = Math.max(1, Math.min(5, 36 / Math.max(4, L.h)))
      const m = Math.max(2, Math.round(0.4 * L.h))
      const bx0 = Math.max(0, L.x0 - m), by0 = Math.max(0, L.y0 - m), bx1 = Math.min(gray.w, L.x1 + m), by1 = Math.min(gray.h, L.y1 + m)
      const W = bx1 - bx0, H = by1 - by0
      // the picture's grey in the line's box; the ink known not to be text (wall bands, long lines) whitened
      const keep = new Uint8Array(W * H)
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (by0 + y) * gray.w + bx0 + x
        keep[y * W + x] = notText && notText.d[i] ? 0 : 1
      }
      const src = document.createElement('canvas')
      src.width = W
      src.height = H
      const sg = src.getContext('2d')!
      const img = sg.createImageData(W, H)
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const v = keep[y * W + x] ? gray.d[(by0 + y) * gray.w + bx0 + x] : 255
        const o = (y * W + x) * 4
        img.data[o] = img.data[o + 1] = img.data[o + 2] = v
        img.data[o + 3] = 255
      }
      sg.putImageData(img, 0, 0)
      const c = document.createElement('canvas')
      const pad = 12
      c.width = Math.round(W * f) + 2 * pad
      c.height = Math.round(H * f) + 2 * pad
      const g = c.getContext('2d')!
      g.fillStyle = '#fff'
      g.fillRect(0, 0, c.width, c.height)
      g.imageSmoothingEnabled = true
      g.imageSmoothingQuality = 'high'
      g.drawImage(src, pad, pad, W * f, H * f)
      const r = await worker.recognize(c)
      const dbgArr = (globalThis as unknown as { __planOcrDebug?: { src: string; text: string }[] }).__planOcrDebug
      if (dbgArr && dbgArr.length < 400) dbgArr.push({ src: c.toDataURL(), text: r.data.text })
      type Wd = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }
      const tl = (r.data as unknown as { lines?: { words: Wd[] }[] }).lines ?? [{ words: r.data.words as Wd[] }]
      tl.forEach((ln, li) => {
        for (const wd of ln.words) {
          const t = wd.text.trim()
          if (!t) continue
          out.push({ line: (k - 1) * 100 + li, text: t, conf: Math.round(wd.confidence), x0: bx0 + (wd.bbox.x0 - pad) / f, y0: by0 + (wd.bbox.y0 - pad) / f, x1: bx0 + (wd.bbox.x1 - pad) / f, y1: by0 + (wd.bbox.y1 - pad) / f })
        }
      })
    }
  } finally {
    await worker.terminate()
  }
  onPct?.(100)
  return out
}

/**
 * Sparse-text OCR of a whole area (Tesseract page mode 11, "as much text as possible in no order"): the picture's
 * grey with the ink that is not text whitened, enlarged smoothly by `f`. Words in picture px with their OCR line.
 */
export async function readSparse(gray: Gray, notText: Mask | null, f: number, onPct?: (n: number) => void): Promise<PWord[]> {
  const W = gray.w, H = gray.h
  const src = document.createElement('canvas')
  src.width = W
  src.height = H
  const sg = src.getContext('2d')!
  const img = sg.createImageData(W, H)
  for (let i = 0; i < W * H; i++) {
    const v = notText && notText.d[i] ? 255 : gray.d[i]
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v
    img.data[i * 4 + 3] = 255
  }
  sg.putImageData(img, 0, 0)
  const c = document.createElement('canvas')
  c.width = Math.round(W * f)
  c.height = Math.round(H * f)
  const g = c.getContext('2d')!
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  g.drawImage(src, 0, 0, c.width, c.height)
  const worker = await ocrWorker(onPct)
  const out: PWord[] = []
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '11' as never, preserve_interword_spaces: '1' })
    const r = await worker.recognize(c)
    const dbgArr = (globalThis as unknown as { __planOcrDebug?: { src: string; text: string }[] }).__planOcrDebug
    if (dbgArr) dbgArr.push({ src: c.toDataURL('image/jpeg', 0.7), text: r.data.text })
    type Wd = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }
    const tl = (r.data as unknown as { lines?: { words: Wd[] }[] }).lines ?? [{ words: r.data.words as Wd[] }]
    tl.forEach((ln, li) => {
      for (const wd of ln.words) {
        const t = wd.text.trim()
        if (!t) continue
        out.push({ line: li, text: t, conf: Math.round(wd.confidence), x0: wd.bbox.x0 / f, y0: wd.bbox.y0 / f, x1: wd.bbox.x1 / f, y1: wd.bbox.y1 / f })
      }
    })
  } finally {
    await worker.terminate()
  }
  return out
}
