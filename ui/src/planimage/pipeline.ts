/**
 * Plan picture pipeline in the browser (v2.4 "Ảnh mặt bằng → nội thất 3D"): read the file (PNG / JPEG / WebP, a PDF
 * page rendered by pdf.js), correct a phone photo (the sheet's corners → upright rectangle, deskew), clean it
 * (shadow gradient, noise, contrast), read the text (Tesseract OCR, offline), recognise the plan (recognize.ts).
 * Everything runs locally; nothing is applied — the caller shows the result for review (PlanImageReview).
 */
import { ocrWords } from '../cad/vectorize'
import { pdfPageCount, renderPdfPage } from '../cad/pdfImport'
import { detectSheet, homography, invertH, paperAspect, rotationH, sheetSize, skewAngle, warpRGBA, type Pt } from './perspective'
import { DEFAULT_PREP, inkOf, type PrepOptions } from './preprocess'
import { and, components, minus, open, or, type Gray, type Mask } from './raster'
import { readSparse, readTextLines, textInkOf, textLineBoxes } from './textlines'
import { barrierOf, recognizePlan, type PlanGraph, type PWord } from './recognize'

export interface Picture { rgba: Uint8ClampedArray; w: number; h: number }

export const IMAGE_EXT = /\.(png|jpe?g|webp)$/i
export const isPlanPicture = (f: { name: string; type?: string }) => IMAGE_EXT.test(f.name) || /\.pdf$/i.test(f.name) || /^image\/(png|jpeg|webp)$/.test(f.type ?? '') || f.type === 'application/pdf'
export const isPdf = (f: { name: string; type?: string }) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf'

const loadImage = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('image')); im.src = src })

/** Pixels of a picture source (largest side limited to `max` px). */
export function pixelsOf(el: CanvasImageSource & { width: number; height: number }, max = 6000): Picture {
  const k = Math.min(1, max / Math.max(el.width, el.height))
  const w = Math.round(el.width * k), h = Math.round(el.height * k)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.fillStyle = '#fff'
  g.fillRect(0, 0, w, h)
  g.drawImage(el, 0, 0, w, h)
  return { rgba: g.getImageData(0, 0, w, h).data, w, h }
}

export function canvasOf(p: Picture): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = p.w
  c.height = p.h
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(p.rgba), p.w, p.h), 0, 0)
  return c
}
export const srcOf = (p: Picture, type = 'image/png', q?: number) => canvasOf(p).toDataURL(type, q)

export interface Loaded extends Picture { name: string; kind: 'image' | 'pdf'; page: number | null; pages: number; dpi: number | null }

/** Number of pages of a PDF (1 for an image). */
export async function pagesOf(file: File): Promise<number> {
  return isPdf(file) ? pdfPageCount(new Uint8Array(await file.arrayBuffer())) : 1
}

/** The picture of an image file, or of page `page` of a PDF rendered at `dpi`. */
export async function loadPicture(file: File, page = 1, dpi = 150): Promise<Loaded> {
  if (isPdf(file)) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const pages = await pdfPageCount(bytes)
    const r = await renderPdfPage(bytes, page, dpi)
    const im = await loadImage(r.src)
    return { ...pixelsOf(im), name: file.name, kind: 'pdf', page, pages, dpi }
  }
  const url = URL.createObjectURL(file)
  try {
    const im = await loadImage(url)
    return { ...pixelsOf(im), name: file.name, kind: 'image', page: null, pages: 1, dpi: null }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export interface Correction {
  /** the sheet's corners TL, TR, BR, BL in the picture (null: use the picture as it is) */
  corners: Pt[] | null
  /** snap the corrected sheet to A-series proportions (1 : √2) when it is within 10 % */
  paper: boolean
  deskew: boolean
}

/** The sheet's corners found in a photo (null for a scan / a PDF page). */
export const findCorners = (p: Picture) => detectSheet(p.rgba, p.w, p.h)

/** Perspective correction (from the corners) then deskew. */
export function correct(p: Picture, c: Correction): Picture & { skew: number; aspect: number | null } {
  let out: Picture = p
  let aspect: number | null = null
  if (c.corners) {
    aspect = c.paper ? paperAspect(c.corners) : null
    const { w, h } = sheetSize(c.corners, aspect)
    const H = homography(c.corners, [[0, 0], [w, 0], [w, h], [0, h]])
    out = { rgba: warpRGBA(p.rgba, p.w, p.h, invertH(H), w, h), w, h }
  }
  let skew = 0
  if (c.deskew) {
    const { ink } = inkOf(out.rgba, out.w, out.h, { normalize: true, denoise: false })
    skew = skewAngle(ink)
    // rotate by the skew (output px → source px: the inverse rotation)
    if (Math.abs(skew) >= 0.05) out = { rgba: warpRGBA(out.rgba, out.w, out.h, rotationH(-skew, out.w, out.h), out.w, out.h), w: out.w, h: out.h }
  }
  return { ...out, skew, aspect }
}

export interface AnalyseOptions {
  /** scale estimate for the size thresholds (px per metre) */
  pxPerM: number
  /** a photo (soft focus): the walls are looked for in the darkest ink only */
  photo?: boolean
  ocr: boolean
  prep?: PrepOptions
  onStep?: (step: 'clean' | 'walls' | 'ocr' | 'rooms', pct?: number) => void
}

const tick = () => new Promise((r) => setTimeout(r, 0))

/** OCR of the plan area (with the title under it), enlarged so that room names are ~30 px high. */
export async function readWords(p: Picture, ink: Uint8Array, box: PlanGraph['box'], pxPerM: number, onPct?: (n: number) => void): Promise<PWord[]> {
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0
  const x0 = Math.max(0, Math.floor(box.x0 - 0.2 * bw)), x1 = Math.min(p.w, Math.ceil(box.x1 + 0.2 * bw))
  const y0 = Math.max(0, Math.floor(box.y0 - 0.15 * bh)), y1 = Math.min(p.h, Math.ceil(box.y1 + 0.35 * bh))
  const f = Math.max(1, Math.min(3, Math.round(30 / Math.max(4, 0.3 * pxPerM))))
  const w = (x1 - x0) * f, h = (y1 - y0) * f
  const src = canvasOf(p)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.imageSmoothingQuality = 'high'
  g.fillStyle = '#fff'
  g.fillRect(0, 0, w, h)
  g.drawImage(src, x0, y0, x1 - x0, y1 - y0, 0, 0, w, h)
  // the ink of the crop, enlarged (text / graphics separation pass)
  const m = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = ink[(y0 + Math.floor(y / f)) * p.w + x0 + Math.floor(x / f)]
  const words = await ocrWords(c, m, w, h, onPct)
  return words.map((wd) => ({ text: wd.text.trim(), conf: Math.round(wd.confidence), x0: x0 + wd.bbox.x0 / f, y0: y0 + wd.bbox.y0 / f, x1: x0 + wd.bbox.x1 / f, y1: y0 + wd.bbox.y1 / f })).filter((wd) => wd.text && wd.y1 - wd.y0 >= 3)
}

/**
 * The text of the plan area (with the title under it): letters out of the line work (the wall bands removed),
 * chained into lines, each line read alone.
 */
export async function readPlanText(gray: Gray, ink: Mask, first: PlanGraph, k: number, onPct?: (n: number) => void): Promise<PWord[]> {
  const box = first.box, pxPerM = first.pxPerM
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0
  const x0 = Math.max(0, Math.floor(box.x0 - 0.25 * bw)), x1 = Math.min(ink.w, Math.ceil(box.x1 + 0.25 * bw))
  const y0 = Math.max(0, Math.floor(box.y0 - 0.15 * bh)), y1 = Math.min(ink.h, Math.ceil(box.y1 + 0.4 * bh))
  const cw = x1 - x0, ch = y1 - y0
  const crop: Mask = { w: cw, h: ch, d: new Uint8Array(cw * ch) }
  const cg: Gray = { w: cw, h: ch, d: new Uint8Array(cw * ch) }
  for (let y = y0; y < y1; y++) { crop.d.set(ink.d.subarray(y * ink.w + x0, y * ink.w + x1), (y - y0) * cw); cg.d.set(gray.d.subarray(y * ink.w + x0, y * ink.w + x1), (y - y0) * cw) }
  const maxH = Math.max(12, Math.round(0.75 * pxPerM))
  // not text: the walls and columns found (their rectangles, a little wider), and long straight runs
  const walls: Mask = { w: cw, h: ch, d: new Uint8Array(cw * ch) }
  {
    const b = barrierOf({ walls: first.walls.map((w) => ({ ...w, t: w.t + 4 })), columns: first.columns.map((c) => ({ ...c, w: c.w + 4, d: c.d + 4 })) }, first.box)
    for (let y = 0; y < b.m.h; y++) for (let x = 0; x < b.m.w; x++) {
      const X = x + b.ox - x0, Y = y + b.oy - y0
      if (b.m.d[y * b.m.w + x] && X >= 0 && Y >= 0 && X < cw && Y < ch) walls.d[Y * cw + X] = 1
    }
  }
  const longRun = Math.max(Math.round(1.2 * maxH), Math.round(0.9 * pxPerM))
  const minH = Math.max(4, Math.round(0.07 * pxPerM))
  // the letter height first (walls out), then thick ink longer than a letter out too (solid furniture, hatching
  // blobs) — a bold letter's own strokes are shorter than the letter and stay
  const h0 = textLineBoxes(textInkOf(crop, and(walls, crop), longRun), minH, maxH).letterH
  const text = textInkOf(crop, and(or(walls, bigBands(crop, k, 1.2 * h0)), crop), longRun)
  const { lines, letters, letterH } = textLineBoxes(text, minH, maxH)
  const mode = (globalThis as unknown as { __planOcrMode?: string }).__planOcrMode ?? 'sparse'
  // enlarged so that the typical letter is ~30 px high (Tesseract's comfortable size)
  const f = Math.max(1, Math.min(3, 30 / Math.max(5, letterH)))
  ;(globalThis as unknown as { __planOcrMeta?: unknown }).__planOcrMeta = { letterH, f, lines: lines.length, maxH }
  const words = mode === 'lines' ? await readTextLines(cg, minus(crop, letters), lines, onPct) : await readSparse(cg, minus(crop, letters), f, onPct)
  return words.map((w) => ({ ...w, x0: w.x0 + x0, x1: w.x1 + x0, y0: w.y0 + y0, y1: w.y1 + y0 }))
}

/** Clean → walls (first pass, to find the plan) → OCR of the plan area → full recognition with the words. */
export async function analyse(p: Picture, opt: AnalyseOptions): Promise<PlanGraph & { words: PWord[]; threshold: number; ink: Mask; dark: Mask | undefined }> {
  opt.onStep?.('clean')
  await tick()
  const { ink, threshold, gray, dark } = inkOf(p.rgba, p.w, p.h, opt.prep ?? DEFAULT_PREP)
  opt.onStep?.('walls')
  await tick()
  const dbg: Record<string, unknown> = {}
  const useDark = opt.photo ? dark : undefined
  const first = recognizePlan({ ink, dark: useDark, words: [] }, { pxPerM: opt.pxPerM, debug: dbg })
  let words: PWord[] = []
  if (opt.ocr && first.walls.length) {
    opt.onStep?.('ocr', 0)
    words = await readPlanText(gray, ink, first, Number(dbg.k ?? 5), (n) => opt.onStep?.('ocr', n))
  }
  opt.onStep?.('rooms')
  await tick()
  const g = words.length ? recognizePlan({ ink, dark: useDark, words }, { pxPerM: first.pxPerM }) : first
  return { ...g, words, threshold, ink, dark: useDark }
}

/** The recognition again at another scale (after the user's calibration), the text already read kept. */
export function recognizeAt(ink: Mask, dark: Mask | undefined, words: PWord[], pxPerM: number): PlanGraph {
  return recognizePlan({ ink, dark, words }, { pxPerM })
}

/** Thick ink that is not a letter: band components longer than `minLen` (bold strokes of a letter are short). */
function bigBands(m: Mask, k: number, minLen: number): Mask {
  const b = open(m, k)
  const { label, stats } = components(b, 8)
  const out: Mask = { w: m.w, h: m.h, d: new Uint8Array(m.d.length) }
  for (let i = 0; i < label.length; i++) { const st = label[i] >= 0 ? stats[label[i]] : null; if (st && Math.max(st.x1 - st.x0, st.y1 - st.y0) + 1 >= minLen) out.d[i] = 1 }
  return out
}
