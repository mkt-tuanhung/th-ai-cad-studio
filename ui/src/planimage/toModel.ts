/**
 * Recognised plan picture → the SAME intermediate the DWG/DXF recogniser produces (bim/fromCad.ts `Recognition`,
 * millimetres, y up), so the downstream builders (BIM, Interior, cut list, elevations, package) run unchanged; plus
 * a CAD 2D record of what was recognised (walls, doors, windows, columns, rooms, names) with the picture as its
 * underlay and the import provenance (calibrated or REVIEW REQUIRED, cad/importReview.ts).
 *
 * Scale: `k` mm per picture px — the user's calibration, or the nominal dpi × scale (then the source is unscaled,
 * REVIEW REQUIRED, manufacturing blocked, exactly like Scan to CAD).
 */
import { DEFAULT_REC, parseElevationEx, shoelace, storeyOf, type RecColumn, type RecOpening, type RecRoom, type RecWall, type RecWarning, type Recognition } from '../bim/fromCad'
import type { P2 } from '../bim/model'
import type { CalRef } from '../cad/calibration'
import { buildImport } from '../cad/importReview'
import { addSource } from '../cad/provenance'
import { createBlankDocument } from '../cad/seed'
import type { CadDocument, Entity, Vec2 } from '../cad/types'
import type { PlanGraph, Pt } from './recognize'

/** Standard wall thicknesses (mm) a measured one snaps to when within 12 %. */
const STD_T = [100, 110, 150, 200, 220, 250, 300]
export function snapThickness(mm: number): number {
  const r = Math.max(40, Math.round(mm / 10) * 10)
  let best = r, bd = Infinity
  for (const s of STD_T) { const d = Math.abs(mm - s) / s; if (d <= 0.12 && d < bd) { bd = d; best = s } }
  return Math.min(DEFAULT_REC.tMax, best)
}

const r1 = (v: number) => Math.round(v * 10) / 10

export interface ModelInput {
  graph: PlanGraph
  /** mm per picture px */
  k: number
  /** level name when the title gives none ("Tầng 1") */
  levelName: string
}

/** Picture px → model mm (y up). */
export const toMm = (g: Pick<PlanGraph, 'h'>, k: number) => (p: Pt): P2 => [r1(p[0] * k), r1((g.h - p[1]) * k)]

export function toRecognition({ graph: g, k }: ModelInput): Recognition {
  const M = toMm(g, k)
  const walls: RecWall[] = []
  const openings: RecOpening[] = []
  const index = new Map<string, number>()
  for (const w of g.walls) {
    const a = M(w.a), b = M(w.b)
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy)
    if (L < 100) continue
    // the axis points along +x or +y (as the CAD recogniser has it): reversed when needed
    const flip = Math.abs(dx) >= Math.abs(dy) ? dx < 0 : dy < 0
    const [p, q] = flip ? [b, a] : [a, b]
    const ux = (q[0] - p[0]) / L, uy = (q[1] - p[1]) / L
    const s0 = ux * p[0] + uy * p[1]
    index.set(w.id, walls.length)
    walls.push({ ux, uy, c: r1(-uy * p[0] + ux * p[1]), s0: r1(s0), s1: r1(s0 + L), t: snapThickness(w.t * k), ext: w.ext, ...(w.curtain ? { curtain: true } : {}) })
    for (const o of g.openings.filter((x) => x.wall === w.id)) {
      const lenPx = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1
      // along the picture wall from a (px) → along the model axis (mm); reversed walls count from the other end
      const f0 = o.s0 / lenPx, f1 = o.s1 / lenPx
      const [m0, m1] = flip ? [1 - f1, 1 - f0] : [f0, f1]
      const kind = o.kind
      openings.push({
        wall: walls.length - 1, kind, s0: r1(s0 + m0 * L), s1: r1(s0 + m1 * L),
        height: kind === 'window' ? DEFAULT_REC.winH : kind === 'door' ? DEFAULT_REC.doorH : DEFAULT_REC.openingH,
        sill: kind === 'window' ? DEFAULT_REC.winSill : 0, mark: o.mark, why: ['picture', ...o.why],
      })
    }
  }
  const columns: RecColumn[] = g.columns.map((c) => { const [x, y] = M([c.x, c.y]); return { x, y, w: Math.round(c.w * k), d: Math.round(c.d * k), round: false } })
  const rooms: RecRoom[] = g.rooms.map((r) => {
    const outline = r.outline.map(M)
    // y flips: keep the outline counter-clockwise as drawn in CAD
    if (shoelace(outline) < 0) outline.reverse()
    return { name: r.name, number: r.number, outline, area: Math.round((r.areaPx * k * k) / 1e4) / 100 }
  })
  const pts = walls.length ? g.walls.flatMap((w) => [M(w.a), M(w.b)]) : [M([g.box.x0, g.box.y1]), M([g.box.x1, g.box.y0])]
  const box = { x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])) }
  const [order, levelName] = g.title ? storeyOf(g.title) : [null, null]
  const el = g.title ? parseElevationEx(g.title) : null
  const warnings: RecWarning[] = []
  if (!walls.length) warnings.push({ code: 'noWalls' })
  const unnamed = rooms.filter((r) => !r.name).length
  if (unnamed) warnings.push({ code: 'unnamedRooms', n: unnamed })
  const noSym = openings.filter((o) => o.kind === 'opening').length
  if (noSym) warnings.push({ code: 'openingsNoSymbol', n: noSym })
  const closed = g.notes.find((n) => n.startsWith('gapsClosedVirtual:'))
  if (closed) warnings.push({ code: 'gapsClosedVirtual', n: Number(closed.split(':')[1]) })
  void index
  return {
    region: { id: 'plan-1', box, title: g.title, elevation: el ? el.value : null, kind: order === 99 ? 'roof' : 'plan', order, levelName },
    frame: { angle: 0, pivot: [0, 0] },
    walls, openings, columns, rooms,
    footprint: g.footprint ? (() => { const f = g.footprint.map(M); if (shoelace(f) < 0) f.reverse(); return f })() : null,
    furniture: [], grids: [], flights: [], warnings,
  }
}

/* ---------------------------------------------------------------- CAD 2D record */

export const PLAN_LAYERS = [
  { name: 'IMG-WALL', color: '#1f2937', lineweight: 0.5 },
  { name: 'IMG-DOOR', color: '#16a34a', lineweight: 0.25 },
  { name: 'IMG-WINDOW', color: '#0891b2', lineweight: 0.25 },
  { name: 'IMG-COLUMN', color: '#dc2626', lineweight: 0.35 },
  { name: 'IMG-ROOM', color: '#ca8a04', lineweight: 0.18 },
  { name: 'IMG-TEXT', color: '#2563eb', lineweight: 0.18 },
] as const

export interface RecordInput {
  graph: PlanGraph
  file: string
  page: number | null
  kind: 'image' | 'pdf'
  /** nominal placement (what the user selected: dpi × drawing scale) */
  nominal: { dpi: number; scale: number; mmPerPx: number }
  /** calibration references in picture px; empty = not calibrated */
  refs: CalRef[]
  /** the (corrected) picture, for the underlay */
  picture: { src: string; w: number; h: number } | null
}

/**
 * The recognised plan as CAD 2D geometry at the nominal scale, then calibrated (or kept unscaled, REVIEW REQUIRED)
 * by the import review — the same rules as Scan to CAD. Room names keep their OCR confidence (a doubtful one is a
 * review item); a name the user typed counts as confirmed.
 */
export function planRecord(inp: RecordInput): CadDocument {
  const g = inp.graph
  const k0 = inp.nominal.mmPerPx
  const P = (p: Pt): Vec2 => ({ x: p[0] * k0, y: (g.h - p[1]) * k0 })
  const base = { color: 'ByLayer', linetype: 'ByLayer', lineweight: 'ByLayer', transparency: 0 } as const
  const ents: Entity[] = []
  let n = 0
  const id = () => `img${++n}`
  const rect = (a: Pt, b: Pt, t: number, s0 = 0, s1?: number): Vec2[] => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux, e = s1 ?? L
    const q = (s: number, o: number): Pt => [a[0] + ux * s + nx * o, a[1] + uy * s + ny * o]
    return [q(s0, -t / 2), q(e, -t / 2), q(e, t / 2), q(s0, t / 2)].map(P)
  }
  for (const w of g.walls) {
    const ops = g.openings.filter((o) => o.wall === w.id).sort((p, q) => p.s0 - q.s0)
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])
    let s = 0
    // the wall body between its openings (closed outlines, as walls are drawn)
    for (const o of [...ops, { s0: L, s1: L } as { s0: number; s1: number }]) {
      if (o.s0 - s > 0.5 && !w.curtain) ents.push({ ...base, id: id(), kind: 'polyline', layer: 'IMG-WALL', pts: rect(w.a, w.b, w.t, s, o.s0), closed: true })
      s = Math.max(s, o.s1)
    }
    if (w.curtain) ents.push({ ...base, id: id(), kind: 'polyline', layer: 'IMG-WINDOW', pts: rect(w.a, w.b, w.t), closed: true })
    for (const o of ops) {
      const dx = (w.b[0] - w.a[0]) / (L || 1), dy = (w.b[1] - w.a[1]) / (L || 1)
      const A: Pt = [w.a[0] + dx * o.s0, w.a[1] + dy * o.s0], B: Pt = [w.a[0] + dx * o.s1, w.a[1] + dy * o.s1]
      if (o.kind === 'window') {
        for (const off of [-w.t / 2, 0, w.t / 2]) ents.push({ ...base, id: id(), kind: 'line', layer: 'IMG-WINDOW', a: P([A[0] - dy * off, A[1] + dx * off]), b: P([B[0] - dy * off, B[1] + dx * off]) })
      } else if (o.kind === 'door') {
        // leaf open at the hinge (start), its swing as an arc
        const r = (o.s1 - o.s0) * k0
        const h = P(A), e = P(B)
        const ang = Math.atan2(e.y - h.y, e.x - h.x)
        ents.push({ ...base, id: id(), kind: 'line', layer: 'IMG-DOOR', a: h, b: { x: h.x + r * Math.cos(ang + Math.PI / 2), y: h.y + r * Math.sin(ang + Math.PI / 2) } })
        ents.push({ ...base, id: id(), kind: 'arc', layer: 'IMG-DOOR', c: h, r, start: ang, end: ang + Math.PI / 2 })
      } else ents.push({ ...base, id: id(), kind: 'line', layer: 'IMG-DOOR', a: P(A), b: P(B) })
    }
  }
  for (const c of g.columns) ents.push({ ...base, id: id(), kind: 'polyline', layer: 'IMG-COLUMN', closed: true, filled: true, pts: [[c.x - c.w / 2, c.y - c.d / 2], [c.x + c.w / 2, c.y - c.d / 2], [c.x + c.w / 2, c.y + c.d / 2], [c.x - c.w / 2, c.y + c.d / 2]].map((p) => P(p as Pt)) })
  const th = 0.25 * g.pxPerM
  for (const r of g.rooms) {
    ents.push({ ...base, id: id(), kind: 'polyline', layer: 'IMG-ROOM', pts: r.outline.map(P), closed: true })
    if (r.name) ents.push({ ...base, id: id(), kind: 'text', layer: 'IMG-TEXT', p: P([r.seed[0], r.seed[1] + th / 2]), height: th * k0, value: r.name, rotation: 0, align: 'center', src: { id: '', confidence: Math.min(1, r.nameConf) } })
  }
  if (g.title) ents.push({ ...base, id: id(), kind: 'text', layer: 'IMG-TEXT', p: P([g.box.x0, g.box.y1 + 0.8 * g.pxPerM]), height: 0.4 * g.pxPerM * k0, value: g.title, rotation: 0, align: 'left', src: { id: '', confidence: 1 } })

  const r = buildImport({ kind: inp.kind, file: inp.file, page: inp.page, entities: ents, nominal: inp.nominal, refs: inp.refs })
  const d0 = createBlankDocument(`${inp.file.replace(/\.[^.]+$/, '')}${inp.page ? ` p${inp.page}` : ''}.dwg`)
  d0.layers = [...d0.layers, ...PLAN_LAYERS.map((l) => ({ name: l.name, color: l.color, visible: true, locked: false, linetype: 'Continuous' as const, lineweight: l.lineweight }))]
  d0.currentLayer = 'IMG-WALL'
  d0.entities = r.entities
  if (inp.picture) {
    const mmPerPx = r.mmPerPx
    d0.underlay = { name: inp.file, src: inp.picture.src, natW: inp.picture.w, natH: inp.picture.h, crop: { x: 0, y: 0, w: inp.picture.w, h: inp.picture.h }, origin: { x: 0, y: inp.picture.h * mmPerPx }, mmPerPx, drawIndex: 0 }
  }
  return { ...addSource(d0, r.source, r.review), dirty: false, source: 'new' }
}
