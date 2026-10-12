/**
 * Scan to CAD for VECTOR PDFs (drawings exported from CAD / Revit / Illustrator…): the page's path
 * operators and text are read with pdf.js (offline, Apache-2.0) and turned into lines, polylines,
 * filled areas and text in millimetres at the chosen drawing scale. Nothing is guessed: a page with no
 * vector paths (a scanned / photographed sheet) yields no geometry and the caller says so — turning
 * raster images into CAD needs a vision model, which this build does not include.
 */
import type { Entity, Vec2 } from './types'

type M = [number, number, number, number, number, number]
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
]
const apply = (m: M, x: number, y: number): Vec2 => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] })

export interface PdfImport {
  pages: number
  entities: Entity[]
  layers: { name: string; color: string }[]
  counts: { lines: number; polylines: number; fills: number; texts: number }
  /** Page size in mm at 1:1. */
  paper: { w: number; h: number }
}

const PT = 25.4 / 72

async function open(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  // pdf.js takes ownership of the buffer: give it a copy
  return { pdfjs, doc: await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise }
}

/** A page rendered to PNG at `dpi` (a scanned sheet opened as an underlay). */
export async function renderPdfPage(bytes: Uint8Array, pageNo: number, dpi: number): Promise<{ src: string; w: number; h: number }> {
  const { doc } = await open(bytes)
  const page = await doc.getPage(Math.min(Math.max(1, pageNo), doc.numPages))
  const vp = page.getViewport({ scale: dpi / 72 })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(vp.width)
  canvas.height = Math.round(vp.height)
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise
  return { src: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height }
}

/** Reads page `pageNo` (1-based) of a PDF; `scale` = drawing scale denominator (100 → 1:100). */
export async function importPdf(bytes: Uint8Array, scale = 1, pageNo = 1): Promise<PdfImport> {
  const { pdfjs, doc } = await open(bytes)
  const page = await doc.getPage(Math.min(Math.max(1, pageNo), doc.numPages))
  const ops = await page.getOperatorList()
  const O = pdfjs.OPS
  const k = PT * scale
  const entities: Entity[] = []
  const layers = new Map<string, string>()
  const counts = { lines: 0, polylines: 0, fills: 0, texts: 0 }
  let n = 0
  const base = { color: 'ByLayer', linetype: 'ByLayer', lineweight: 'ByLayer', transparency: 0 } as const
  const layerOf = (hex: string) => {
    const name = `PDF-${hex.replace('#', '').toUpperCase()}`
    if (!layers.has(name)) layers.set(name, hex)
    return name
  }

  let ctm: M = [1, 0, 0, 1, 0, 0]
  const stack: { ctm: M; stroke: string; fill: string }[] = []
  let stroke = '#000000', fill = '#000000'
  let subpaths: { pts: Vec2[]; closed: boolean }[] = []
  const toMm = (p: Vec2): Vec2 => ({ x: p.x * k, y: p.y * k })

  const flush = (doStroke: boolean, doFill: boolean, close: boolean) => {
    for (const sp of subpaths) {
      const pts = sp.pts.map(toMm)
      // drop consecutive duplicates
      const clean = pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 1e-6)
      if (clean.length < 2) continue
      const closed = sp.closed || close
      if (doFill && closed && clean.length >= 3) {
        entities.push({ ...base, id: `pdf${++n}`, kind: 'polyline', layer: layerOf(fill), pts: clean, closed: true, filled: true })
        counts.fills++
      } else if (doStroke || doFill) {
        if (clean.length === 2 && !closed) {
          entities.push({ ...base, id: `pdf${++n}`, kind: 'line', layer: layerOf(stroke), a: clean[0], b: clean[1] })
          counts.lines++
        } else {
          entities.push({ ...base, id: `pdf${++n}`, kind: 'polyline', layer: layerOf(doStroke ? stroke : fill), pts: clean, closed })
          counts.polylines++
        }
      }
    }
    subpaths = []
  }

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]
    const a = ops.argsArray[i] as unknown[]
    switch (fn) {
      case O.save:
        stack.push({ ctm, stroke, fill })
        break
      case O.restore: {
        const s = stack.pop()
        if (s) ({ ctm, stroke, fill } = s)
        break
      }
      case O.transform:
        ctm = mul(a as M, ctm)
        break
      case O.paintFormXObjectBegin:
        stack.push({ ctm, stroke, fill })
        if (Array.isArray(a[0])) ctm = mul(a[0] as M, ctm)
        break
      case O.paintFormXObjectEnd: {
        const s = stack.pop()
        if (s) ({ ctm, stroke, fill } = s)
        break
      }
      case O.setStrokeRGBColor:
      case O.setStrokeColor:
        if (typeof a[0] === 'string') stroke = a[0]
        break
      case O.setFillRGBColor:
      case O.setFillColor:
        if (typeof a[0] === 'string') fill = a[0]
        break
      case O.constructPath: {
        const pathOps = a[0] as number[]
        const args = a[1] as number[]
        let j = 0
        let cur: { pts: Vec2[]; closed: boolean } | null = null
        let last: Vec2 = { x: 0, y: 0 }
        const P = (x: number, y: number) => apply(ctm, x, y)
        const bez = (p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2) => {
          for (let s = 1; s <= 8; s++) {
            const t = s / 8, u = 1 - t
            cur!.pts.push({ x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x, y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y })
          }
        }
        for (const op of pathOps) {
          if (op === O.moveTo) {
            const p = P(args[j++], args[j++])
            cur = { pts: [p], closed: false }
            subpaths.push(cur)
            last = p
          } else if (op === O.lineTo) {
            const p = P(args[j++], args[j++])
            if (!cur) subpaths.push((cur = { pts: [last], closed: false }))
            cur.pts.push(p)
            last = p
          } else if (op === O.curveTo) {
            const p1 = P(args[j++], args[j++]), p2 = P(args[j++], args[j++]), p3 = P(args[j++], args[j++])
            if (!cur) subpaths.push((cur = { pts: [last], closed: false }))
            bez(last, p1, p2, p3)
            last = p3
          } else if (op === O.curveTo2) {
            const p2 = P(args[j++], args[j++]), p3 = P(args[j++], args[j++])
            if (!cur) subpaths.push((cur = { pts: [last], closed: false }))
            bez(last, last, p2, p3)
            last = p3
          } else if (op === O.curveTo3) {
            const p1 = P(args[j++], args[j++]), p3 = P(args[j++], args[j++])
            if (!cur) subpaths.push((cur = { pts: [last], closed: false }))
            bez(last, p1, p3, p3)
            last = p3
          } else if (op === O.closePath) {
            if (cur) {
              cur.closed = true
              last = cur.pts[0]
            }
            cur = null
          } else if (op === O.rectangle) {
            const x = args[j++], y = args[j++], w = args[j++], h = args[j++]
            subpaths.push({ pts: [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)], closed: true })
            cur = null
          }
        }
        break
      }
      case O.stroke:
        flush(true, false, false)
        break
      case O.closeStroke:
        flush(true, false, true)
        break
      case O.fill:
      case O.eoFill:
        flush(false, true, true)
        break
      case O.fillStroke:
      case O.eoFillStroke:
      case O.closeFillStroke:
      case O.closeEOFillStroke:
        flush(true, true, true)
        break
      case O.endPath:
        subpaths = [] // clipping path only
        break
    }
  }

  // text runs: position and size from the text matrix (page space), rotation from its direction
  const tc = await page.getTextContent()
  for (const it of tc.items) {
    if (!('str' in it) || !it.str.trim()) continue
    const [a, b, , , e, f] = it.transform as M
    const h = Math.hypot(a, b) * k
    entities.push({ ...base, id: `pdf${++n}`, kind: 'text', layer: 'PDF-TEXT', p: { x: e * k, y: f * k }, height: h * 0.72, value: it.str, rotation: Math.atan2(b, a), align: 'left' })
    counts.texts++
  }
  if (counts.texts) layers.set('PDF-TEXT', '#111827')
  const [x0, y0, x1, y1] = page.view
  return { pages: doc.numPages, entities, layers: [...layers].map(([name, color]) => ({ name, color })), counts, paper: { w: (x1 - x0) * PT, h: (y1 - y0) * PT } }
}
