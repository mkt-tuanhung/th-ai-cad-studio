/**
 * Measured room survey (v2.4 SP14): a room measured on site — side lengths of the inner wall faces in order, the
 * corner angles (90° unless said otherwise), optional diagonals, wall thickness, ceiling height, doors — becomes
 * CAD 2D geometry tagged with survey provenance (status measured, tolerance). Pure; Interior space planning reads
 * the same `SurveySummary` later.
 *
 * Shape: a triangle is fixed by its sides; a quadrilateral with a diagonal is built from its two triangles (true
 * shape, no right-angle assumption) and a second diagonal is a check; otherwise the sides are traversed with the
 * corner angles and the misclosure is distributed along the perimeter (compass rule) and reported. Diagonals
 * measured are compared with the result. Nothing is invented: a door without a width stays a missing measurement.
 */
import type { Entity, Vec2 } from './types'

export interface SurveyDoor {
  /** Side index (0 = from corner 1 to corner 2). */
  side: number
  /** Distance from the side's start corner to the door's near jamb (mm); null = not measured. */
  offset: number | null
  /** Clear width (mm); null = not measured. */
  width: number | null
  height?: number | null
}

export interface SurveyInput {
  name: string
  /** Inner-face lengths (mm), counter-clockwise, side i from corner i to corner i+1. */
  sides: number[]
  /** Interior angle at corner i (degrees); null / missing = 90. */
  angles?: (number | null)[]
  diagonals?: { from: number; to: number; length: number }[]
  wallThickness: number
  ceilingHeight: number
  /** Accepted deviation (mm) for closure and diagonals. */
  tolerance: number
  doors?: SurveyDoor[]
  /** Where corner 1 goes in the drawing (mm). */
  origin?: Vec2
}

export interface SurveyResult {
  ok: boolean
  error?: 'too-few-sides' | 'bad-length' | 'inconsistent'
  /** Inner polygon (mm), counter-clockwise. */
  pts: Vec2[]
  /** Outer face of the walls. */
  outer: Vec2[]
  method: 'triangle' | 'diagonal' | 'traverse'
  /** Misclosure of the traverse before adjustment (mm); 0 when the shape is fixed by its triangles. */
  closure: number
  diagonals: { from: number; to: number; measured: number; computed: number; dev: number }[]
  /** Interior angles of the result (degrees) and the largest deviation from 90° (quadrilaterals: squareness). */
  angles: number[]
  squareness: number | null
  area: number
  perimeter: number
  withinTolerance: boolean
  /** Measurements still needed (keys like `door1.width`). */
  missing: string[]
}

export interface SurveySummary {
  input: SurveyInput
  closure: number
  maxDiagonalDev: number | null
  squareness: number | null
  area: number
  perimeter: number
  withinTolerance: boolean
  missing: string[]
}

const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI
const d2 = (a: Vec2, b: Vec2) => Math.hypot(b.x - a.x, b.y - a.y)

/** Intersection of circles (c0, r0) and (c1, r1) on the left of c0→c1 (or the right when `right`). */
function circles(c0: Vec2, r0: number, c1: Vec2, r1: number, right = false): Vec2 | null {
  const d = d2(c0, c1)
  if (d < 1e-9 || d > r0 + r1 + 1e-6 || d < Math.abs(r0 - r1) - 1e-6) return null
  const a = (r0 * r0 - r1 * r1 + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, r0 * r0 - a * a))
  const ux = (c1.x - c0.x) / d, uy = (c1.y - c0.y) / d
  const px = c0.x + a * ux, py = c0.y + a * uy
  const s = right ? -1 : 1
  return { x: px - s * h * uy, y: py + s * h * ux }
}

const signedArea = (p: Vec2[]) => p.reduce((a, q, i) => { const r = p[(i + 1) % p.length]; return a + q.x * r.y - r.x * q.y }, 0) / 2

/** Outer offset of a counter-clockwise polygon by `t` (mitred corners). */
export function offsetOutward(p: Vec2[], t: number): Vec2[] {
  const n = p.length
  const lines = p.map((a, i) => {
    const b = p[(i + 1) % n]
    const L = d2(a, b) || 1
    const nx = (b.y - a.y) / L, ny = -(b.x - a.x) / L // right normal = outward for CCW
    return { a: { x: a.x + nx * t, y: a.y + ny * t }, d: { x: (b.x - a.x) / L, y: (b.y - a.y) / L } }
  })
  return p.map((_, i) => {
    const l0 = lines[(i - 1 + n) % n], l1 = lines[i]
    const den = l0.d.x * l1.d.y - l0.d.y * l1.d.x
    if (Math.abs(den) < 1e-9) return { x: l1.a.x, y: l1.a.y }
    const s = ((l1.a.x - l0.a.x) * l1.d.y - (l1.a.y - l0.a.y) * l1.d.x) / den
    return { x: l0.a.x + l0.d.x * s, y: l0.a.y + l0.d.y * s }
  })
}

export function surveyRoom(inp: SurveyInput): SurveyResult {
  const n = inp.sides.length
  const o = inp.origin ?? { x: 0, y: 0 }
  const fail = (error: SurveyResult['error']): SurveyResult => ({ ok: false, error, pts: [], outer: [], method: 'traverse', closure: 0, diagonals: [], angles: [], squareness: null, area: 0, perimeter: 0, withinTolerance: false, missing: [] })
  if (n < 3) return fail('too-few-sides')
  if (inp.sides.some((s) => !(s > 0) || !Number.isFinite(s))) return fail('bad-length')
  const s = inp.sides
  let pts: Vec2[] | null = null
  let method: SurveyResult['method'] = 'traverse'
  let closure = 0
  const diag = (i: number, j: number) => inp.diagonals?.find((d) => (d.from === i && d.to === j) || (d.from === j && d.to === i))
  if (n === 3) {
    method = 'triangle'
    const p2 = circles({ x: 0, y: 0 }, s[2], { x: s[0], y: 0 }, s[1])
    if (!p2) return fail('inconsistent')
    pts = [{ x: 0, y: 0 }, { x: s[0], y: 0 }, p2]
  } else if (n === 4 && (diag(0, 2) || diag(1, 3))) {
    method = 'diagonal'
    const P0 = { x: 0, y: 0 }, P1 = { x: s[0], y: 0 }
    const d02 = diag(0, 2)
    if (d02) {
      const P2 = circles(P0, d02.length, P1, s[1])
      const P3 = P2 && circles(P0, s[3], P2, s[2])
      if (!P2 || !P3) return fail('inconsistent')
      pts = [P0, P1, P2, P3]
    } else {
      const d13 = diag(1, 3)!
      const P3 = circles(P0, s[3], P1, d13.length)
      const P2 = P3 && circles(P1, s[1], P3, s[2], true)
      if (!P3 || !P2) return fail('inconsistent')
      pts = [P0, P1, P2, P3]
    }
  } else {
    // traverse with the corner angles, then distribute the misclosure (compass rule)
    const ang = (i: number) => inp.angles?.[i] ?? 90
    let h = 0
    const raw: Vec2[] = [{ x: 0, y: 0 }]
    for (let i = 0; i < n; i++) {
      const p = raw[i]
      raw.push({ x: p.x + s[i] * Math.cos(h), y: p.y + s[i] * Math.sin(h) })
      h += Math.PI - rad(ang((i + 1) % n))
    }
    const end = raw[n]
    closure = Math.hypot(end.x, end.y)
    const total = s.reduce((a, b) => a + b, 0)
    let run = 0
    pts = raw.slice(0, n).map((p, i) => {
      const f = run / total
      run += s[i]
      return { x: p.x - end.x * f, y: p.y - end.y * f }
    })
  }
  if (signedArea(pts) < 0) return fail('inconsistent')
  pts = pts.map((p) => ({ x: p.x + o.x, y: p.y + o.y }))
  const diagonals = (inp.diagonals ?? [])
    .filter((d) => d.from >= 0 && d.to >= 0 && d.from < n && d.to < n && d.from !== d.to && d.length > 0)
    .map((d) => { const computed = d2(pts![d.from], pts![d.to]); return { from: d.from, to: d.to, measured: d.length, computed, dev: computed - d.length } })
  const angles = pts.map((p, i) => {
    const a = pts![(i - 1 + n) % n], b = pts![(i + 1) % n]
    const v1 = Math.atan2(a.y - p.y, a.x - p.x), v2 = Math.atan2(b.y - p.y, b.x - p.x)
    let x = deg(v1 - v2)
    while (x < 0) x += 360
    while (x >= 360) x -= 360
    return x
  })
  const squareness = n === 4 ? Math.max(...angles.map((a) => Math.abs(a - 90))) : null
  const area = signedArea(pts)
  const perimeter = pts.reduce((a, p, i) => a + d2(p, pts![(i + 1) % n]), 0)
  const withinTolerance = closure <= inp.tolerance + 1e-9 && diagonals.every((d) => Math.abs(d.dev) <= inp.tolerance + 1e-9)
  return { ok: true, pts, outer: offsetOutward(pts, inp.wallThickness), method, closure, diagonals, angles, squareness, area, perimeter, withinTolerance, missing: missingMeasurements(inp) }
}

/** Measurements the survey still needs (never filled in by a default). */
export function missingMeasurements(inp: SurveyInput): string[] {
  const out: string[] = []
  if (!(inp.ceilingHeight > 0)) out.push('ceilingHeight')
  if (!(inp.wallThickness > 0)) out.push('wallThickness')
  ;(inp.doors ?? []).forEach((d, i) => {
    if (d.offset === null || !(d.offset >= 0)) out.push(`door${i + 1}.offset`)
    if (d.width === null || !(d.width > 0)) out.push(`door${i + 1}.width`)
  })
  return out
}

export function summaryOf(inp: SurveyInput, r: SurveyResult): SurveySummary {
  return {
    input: inp, closure: r.closure, maxDiagonalDev: r.diagonals.length ? Math.max(...r.diagonals.map((d) => Math.abs(d.dev))) : null,
    squareness: r.squareness, area: r.area, perimeter: r.perimeter, withinTolerance: r.withinTolerance, missing: r.missing,
  }
}

export const SURVEY_LAYERS = [
  { name: 'SURVEY-ROOM', color: '#0f766e' },
  { name: 'SURVEY-WALL', color: '#111827' },
  { name: 'SURVEY-DOOR', color: '#b45309' },
  { name: 'SURVEY-DIM', color: '#3f4654' },
] as const

/** CAD entities of a surveyed room (inner face, outer face, side dimensions, doors, label), tagged `src`. */
export function surveyEntities(inp: SurveyInput, r: SurveyResult, sourceId: string, labels: { area: string; height: string; doorMissing: string }): Entity[] {
  if (!r.ok) return []
  let k = 0
  const id = () => `${sourceId}-${++k}`
  const base = (layer: string) => ({ id: id(), layer, color: 'ByLayer', linetype: 'ByLayer' as const, lineweight: 'ByLayer' as const, transparency: 0, src: { id: sourceId } })
  const n = r.pts.length
  const out: Entity[] = [
    { ...base('SURVEY-ROOM'), kind: 'polyline', pts: r.pts, closed: true },
    { ...base('SURVEY-WALL'), kind: 'polyline', pts: r.outer, closed: true },
  ]
  const th = Math.max(120, Math.min(300, Math.sqrt(Math.abs(r.area)) / 25))
  for (let i = 0; i < n; i++) out.push({ ...base('SURVEY-DIM'), kind: 'dimension', a: r.pts[i], b: r.pts[(i + 1) % n], offset: -(inp.wallThickness + 4 * th), override: null, textHeight: th })
  ;(inp.doors ?? []).forEach((d, i) => {
    const a = r.pts[d.side % n], b = r.pts[(d.side + 1) % n]
    const L = d2(a, b) || 1
    const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L }, nrm = { x: u.y, y: -u.x }
    const at = (t: number) => ({ x: a.x + u.x * t, y: a.y + u.y * t })
    const jamb = (t: number): Entity => { const p = at(t); return { ...base('SURVEY-DOOR'), kind: 'line', a: p, b: { x: p.x + nrm.x * inp.wallThickness, y: p.y + nrm.y * inp.wallThickness } } }
    if (d.offset !== null && d.offset >= 0) {
      out.push(jamb(d.offset))
      if (d.width && d.width > 0) out.push(jamb(d.offset + d.width))
    }
    const mid = at((d.offset ?? L / 2) + (d.width ?? 0) / 2)
    out.push({ ...base('SURVEY-DOOR'), kind: 'text', p: { x: mid.x - nrm.x * th * 2, y: mid.y - nrm.y * th * 2 }, height: th * 0.8, value: d.width && d.width > 0 ? `D${i + 1} ${Math.round(d.width)}` : `D${i + 1} ${labels.doorMissing}`, rotation: Math.atan2(u.y, u.x), align: 'center' })
  })
  const c = r.pts.reduce((a, p) => ({ x: a.x + p.x / n, y: a.y + p.y / n }), { x: 0, y: 0 })
  out.push({ ...base('SURVEY-ROOM'), kind: 'text', p: c, height: th, value: inp.name, rotation: 0, align: 'center' })
  out.push({ ...base('SURVEY-ROOM'), kind: 'text', p: { x: c.x, y: c.y - th * 1.6 }, height: th * 0.7, value: `${labels.area} ${(r.area / 1e6).toFixed(2)} m² · ${labels.height} ${inp.ceilingHeight > 0 ? Math.round(inp.ceilingHeight) : '?'} · ±${inp.tolerance}`, rotation: 0, align: 'center' })
  return out
}
