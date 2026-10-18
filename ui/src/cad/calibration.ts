/**
 * Scale calibration of imported drawings (images, scanned / vector PDF pages) — v2.4 SP12, V24-017 / 019 / 020.
 *
 * A reference is a distance measured on the source (picture pixels, or drawing units of an import) and the true
 * distance the user typed or a dimension text read by OCR says. One reference fixes the scale; with two or more
 * the scale is the least-squares fit through the origin and the residual (RMS of the misfits, mm) says how well
 * the references agree. Nothing here guesses a scale: no reference → no calibration.
 */
import type { Entity, Vec2 } from './types'

export type RefMethod = 'two-point' | 'ocr-dimension' | 'entity-reference'

/** One calibration reference. `a`/`b` and `measured` are in source units (px for a picture, mm of the current
 *  drawing for an entity reference); `refDistance` is the true length in mm. */
export interface CalRef {
  id: string
  method: RefMethod
  a: Vec2
  b: Vec2
  measured: number
  refDistance: number
  /** The dimension text that gave the distance (OCR reference). */
  text?: string
}

export interface ScaleFit {
  /** True mm per source unit. */
  k: number
  /** RMS of (k·measured − true) in mm over the references; null with a single reference (nothing to compare). */
  residual: number | null
  /** Largest absolute misfit (mm), null with one reference. */
  maxErr: number | null
  perRef: { id: string; fitted: number; err: number; errPct: number }[]
}

/** Least-squares scale through the origin: k = Σ m·t / Σ m². Null when there is no usable reference. */
export function solveScale(refs: Pick<CalRef, 'id' | 'measured' | 'refDistance'>[]): ScaleFit | null {
  const ok = refs.filter((r) => r.measured > 1e-9 && r.refDistance > 0 && Number.isFinite(r.measured) && Number.isFinite(r.refDistance))
  if (!ok.length) return null
  let mt = 0, mm = 0
  for (const r of ok) {
    mt += r.measured * r.refDistance
    mm += r.measured * r.measured
  }
  const k = mt / mm
  const perRef = ok.map((r) => {
    const fitted = k * r.measured
    return { id: r.id, fitted, err: fitted - r.refDistance, errPct: ((fitted - r.refDistance) / r.refDistance) * 100 }
  })
  const residual = ok.length > 1 ? Math.sqrt(perRef.reduce((a, p) => a + p.err * p.err, 0) / ok.length) : null
  const maxErr = ok.length > 1 ? Math.max(...perRef.map((p) => Math.abs(p.err))) : null
  return { k, residual, maxErr, perRef }
}

/**
 * A dimension value written on a drawing, in mm: "3600", "3.600" / "3,600" (thousands), "3600mm", "3.6m" / "3,6 m".
 * Plain one- or two-digit numbers (level numbers, room numbers) are not dimensions.
 */
export function parseDimensionText(raw: string): number | null {
  const s = raw.trim().replace(/\s+/g, '').replace(/^[([{]|[)\]}]$/g, '')
  let m = /^(\d{1,3}(?:[.,]\d{3})+)(?:mm)?$/i.exec(s)
  if (m) return Number(m[1].replace(/[.,]/g, ''))
  m = /^(\d{3,6})(?:mm)?$/i.exec(s)
  if (m) return Number(m[1])
  m = /^(\d{1,3}[.,]\d{1,3})m$/i.exec(s)
  if (m) return Math.round(Number(m[1].replace(',', '.')) * 1000)
  return null
}

export interface Segment {
  entityId: string
  a: Vec2
  b: Vec2
  len: number
}

/** Straight pieces of lines and polylines (dimension lines come out of the vectoriser as these). */
export function segmentsOf(entities: Entity[]): Segment[] {
  const out: Segment[] = []
  const push = (id: string, a: Vec2, b: Vec2) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len > 1e-9) out.push({ entityId: id, a, b, len })
  }
  for (const e of entities) {
    if (e.kind === 'line') push(e.id, e.a, e.b)
    else if (e.kind === 'polyline') {
      for (let i = 0; i + 1 < e.pts.length; i++) push(e.id, e.pts[i], e.pts[i + 1])
      if (e.closed && e.pts.length > 2) push(e.id, e.pts[e.pts.length - 1], e.pts[0])
    } else if (e.kind === 'dimension') push(e.id, e.a, e.b)
  }
  return out
}

/** Centre of a text entity: the OCR box when known, else the usual estimate (0.6 × height per character). */
export function textCentre(e: Extract<Entity, { kind: 'text' }>): Vec2 {
  const bb = e.src?.bbox
  if (bb) return { x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2 }
  const w = e.value.length * e.height * 0.6
  const c = Math.cos(e.rotation), s = Math.sin(e.rotation)
  const dx = e.align === 'center' ? 0 : w / 2, dy = e.height / 2
  return { x: e.p.x + dx * c - dy * s, y: e.p.y + dx * s + dy * c }
}

export interface DimensionCheck {
  textId: string
  text: string
  /** Value written (mm). */
  value: number
  segment: Segment
  /** Measured length of the dimensioned segment (mm, in the drawing as it is now). */
  measured: number
  delta: number
  ok: boolean
}

export interface DimTolerance {
  /** Absolute tolerance (mm). */
  mm: number
  /** Relative tolerance (% of the written value). The larger of the two applies. */
  pct: number
}
export const DIM_TOLERANCE: DimTolerance = { mm: 10, pct: 1 }

/**
 * Dimension texts and the segment each one dimensions: the nearest line / polyline piece, parallel to the text
 * (within 10°), long enough (≥ 2 text heights), whose span the text centre falls in, at most 3 text heights away.
 * `ok` compares the written value with the segment as drawn now (the caller decides whether the drawing is
 * calibrated — without a calibration the comparison means nothing, see checkDimensions).
 */
export function dimensionTexts(entities: Entity[], tol: DimTolerance = DIM_TOLERANCE): DimensionCheck[] {
  const segs = segmentsOf(entities)
  const out: DimensionCheck[] = []
  for (const e of entities) {
    if (e.kind !== 'text') continue
    const value = parseDimensionText(e.value)
    if (value === null) continue
    const c = textCentre(e)
    const dir = { x: Math.cos(e.rotation), y: Math.sin(e.rotation) }
    let best: { s: Segment; d: number } | null = null
    for (const s of segs) {
      if (s.len < 2 * e.height) continue
      const ux = (s.b.x - s.a.x) / s.len, uy = (s.b.y - s.a.y) / s.len
      if (Math.abs(ux * dir.x + uy * dir.y) < Math.cos((10 * Math.PI) / 180)) continue
      const t = ((c.x - s.a.x) * ux + (c.y - s.a.y) * uy) / s.len
      if (t < -0.02 || t > 1.02) continue
      const d = Math.abs((c.x - s.a.x) * uy - (c.y - s.a.y) * ux)
      if (d > 3 * e.height) continue
      if (!best || d < best.d) best = { s, d }
    }
    if (!best) continue
    const measured = best.s.len
    const delta = measured - value
    out.push({ textId: e.id, text: e.value, value, segment: best.s, measured, delta, ok: Math.abs(delta) <= Math.max(tol.mm, (tol.pct / 100) * value) })
  }
  return out
}

/** Scales geometry about `o` (calibration applies one factor to the whole import). */
export function scaleEntity(e: Entity, k: number, o: Vec2 = { x: 0, y: 0 }): Entity {
  const P = (p: Vec2): Vec2 => ({ x: o.x + (p.x - o.x) * k, y: o.y + (p.y - o.y) * k })
  const src = e.src?.bbox ? { ...e.src, bbox: { x0: o.x + (e.src.bbox.x0 - o.x) * k, y0: o.y + (e.src.bbox.y0 - o.y) * k, x1: o.x + (e.src.bbox.x1 - o.x) * k, y1: o.y + (e.src.bbox.y1 - o.y) * k } } : e.src
  const x = (src ? { ...e, src } : e) as Entity
  switch (x.kind) {
    case 'line':
      return { ...x, a: P(x.a), b: P(x.b) }
    case 'polyline':
      return { ...x, pts: x.pts.map(P) }
    case 'circle':
      return { ...x, c: P(x.c), r: x.r * k }
    case 'arc':
      return { ...x, c: P(x.c), r: x.r * k }
    case 'text':
      return { ...x, p: P(x.p), height: x.height * k }
    case 'dimension':
      return { ...x, a: P(x.a), b: P(x.b), offset: x.offset * k, textHeight: x.textHeight * k }
  }
}

/** Calibration candidates from dimension texts: each gives (measured on the drawing, value written). */
export function ocrReferences(entities: Entity[], unitsPerSourceUnit = 1): CalRef[] {
  return dimensionTexts(entities).map((d) => ({
    id: `ocr-${d.textId}`,
    method: 'ocr-dimension' as const,
    a: { x: d.segment.a.x / unitsPerSourceUnit, y: d.segment.a.y / unitsPerSourceUnit },
    b: { x: d.segment.b.x / unitsPerSourceUnit, y: d.segment.b.y / unitsPerSourceUnit },
    measured: d.measured / unitsPerSourceUnit,
    refDistance: d.value,
    text: d.text,
  }))
}

/** "1 px = 0.8467 mm" style number with enough digits. */
export const fmtK = (k: number) => (k >= 100 ? k.toFixed(1) : k >= 1 ? k.toFixed(3) : k.toPrecision(4))
