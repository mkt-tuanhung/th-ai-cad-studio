/**
 * 2D elevations and sections of the BIM model as real drawings.
 *
 * Geometry: exact hidden-line removal by the OCCT kernel (HostBridge scene3dCommand "drawing2d") — visible
 * edges and outlines projected on the view plane, and for a section the faces the cutting plane goes
 * through (poche). Annotation from the model: level lines with their name and elevation, grid lines
 * with bubbles (grids that run towards the viewer), overall and storey dimensions, room names on
 * sections, and the drawing title. The result is a CAD document (layers A-ELEV, A-SECT-CUT, A-ANNO-…)
 * with one A3 layout at 1:100, so it opens in CAD 2D and plots / exports to PDF, DXF and DWG.
 * Drawing coordinates: u along the view's x direction, v = height (mm).
 */
import type { BimModel } from './model'
import type { CadDocument, Entity, Layer } from '../cad/types'
import { createBlankDocument } from '../cad/seed'

export type Face = 'front' | 'back' | 'left' | 'right'
export interface DrawingReq {
  kind: 'elev' | 'section'
  face: Face
  /** Section: the axis the cutting plane is perpendicular to (y: a plane of constant y). */
  axis?: 'x' | 'y'
  title: string
}

/** Camera side → the direction towards the viewer and the drawing's x (as in the 3D presets). */
export const VIEW: Record<Face, { toViewer: [number, number, number]; xDir: [number, number, number] }> = {
  front: { toViewer: [0, -1, 0], xDir: [1, 0, 0] }, // south elevation, from −Y
  back: { toViewer: [0, 1, 0], xDir: [-1, 0, 0] }, // north, from +Y
  right: { toViewer: [1, 0, 0], xDir: [0, 1, 0] }, // east, from +X
  left: { toViewer: [-1, 0, 0], xDir: [0, -1, 0] }, // west, from −X
}

export interface NativeDrawing {
  lines: number[][]
  cut: number[][]
  bounds: [number, number, number, number]
  ms: number
}

/** The kernel request: view directions, and for a section the plane through the middle of `b3` (x0 y0 z0 x1 y1 z1),
 *  keeping the half away from the viewer. */
export function nativeRequest(r: DrawingReq, b3: number[]) {
  const v = VIEW[r.face]
  if (r.kind !== 'section') return { cmd: 'drawing2d', ...v }
  const ax = r.axis === 'x' ? 0 : 1
  const mid = (b3[ax] + b3[ax + 3]) / 2
  // keep a·p + d ≥ 0 with a pointing away from the viewer
  const a = [0, 0, 0]
  a[ax] = -v.toViewer[ax] || 1
  return { cmd: 'drawing2d', ...v, cut: [a[0], a[1], a[2], -a[ax] * mid], at: mid }
}

const SCALE = 100

const LAYERS: Layer[] = [
  { name: 'A-ELEV', color: '#111827', visible: true, locked: false, linetype: 'Continuous', lineweight: 0.25 },
  { name: 'A-SECT-CUT', color: '#3f4654', visible: true, locked: false, linetype: 'Continuous', lineweight: 0.5 },
  { name: 'A-ANNO-LEVL', color: '#2563eb', visible: true, locked: false, linetype: 'Dashed', lineweight: 0.18 },
  { name: 'A-GRID', color: '#6b7280', visible: true, locked: false, linetype: 'DashDot', lineweight: 0.18 },
  { name: 'A-ANNO-DIMS', color: '#111827', visible: true, locked: false, linetype: 'Continuous', lineweight: 0.18 },
  { name: 'A-ANNO-TEXT', color: '#111827', visible: true, locked: false, linetype: 'Continuous', lineweight: 0.25 },
]

const elevText = (mm: number) => (Math.abs(mm) < 0.5 ? '±0.000' : `${mm > 0 ? '+' : '−'}${(Math.abs(mm) / 1000).toFixed(3)}`)

/** `opt.name`: the document (file) name; `opt.scale`: the sheet scale 1:N (text 2.5 mm on paper at that scale). */
export function drawingDocument(model: BimModel, r: DrawingReq, nd: NativeDrawing, cutAt?: number, opt: { name?: string; scale?: number } = {}): CadDocument {
  const scale = opt.scale ?? SCALE
  const T = 2.5 * scale
  let n = 0
  const id = () => `d2-${++n}`
  const base = { color: 'ByLayer', linetype: 'ByLayer', lineweight: 'ByLayer', transparency: 0 } as const
  const ents: Entity[] = []
  const line = (layer: string, a: [number, number], b: [number, number], lw?: Entity['lineweight']) =>
    ents.push({ ...base, ...(lw ? { lineweight: lw } : {}), id: id(), layer, kind: 'line', a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] } })
  const text = (layer: string, x: number, y: number, h: number, value: string, align: 'left' | 'center' = 'left') =>
    ents.push({ ...base, id: id(), layer, kind: 'text', p: { x, y }, height: h, value, rotation: 0, align })

  // kernel geometry
  for (const l of nd.lines) {
    const pts = []
    for (let i = 0; i + 1 < l.length; i += 2) pts.push({ x: l[i], y: l[i + 1] })
    if (pts.length === 2) ents.push({ ...base, id: id(), layer: 'A-ELEV', kind: 'line', a: pts[0], b: pts[1] })
    else ents.push({ ...base, id: id(), layer: 'A-ELEV', kind: 'polyline', pts, closed: false })
  }
  for (const c of nd.cut) {
    const pts = []
    for (let i = 0; i + 1 < c.length; i += 2) pts.push({ x: c[i], y: c[i + 1] })
    ents.push({ ...base, id: id(), layer: 'A-SECT-CUT', kind: 'polyline', pts, closed: true, filled: true })
  }

  const [u0, , u1, v1] = nd.bounds
  const v = VIEW[r.face]
  const uOf = (x: number, y: number) => x * v.xDir[0] + y * v.xDir[1]
  // ground line
  const ground = Math.min(...model.levels.map((l) => l.elevation), 0)
  line('A-ELEV', [u0 - 1500, ground], [u1 + 1500, ground], '0.50')

  // levels: dashed line, head (triangle) and name / elevation at the right
  const levels = [...model.levels].sort((a, b) => a.elevation - b.elevation)
  for (const l of levels) {
    const y = l.elevation
    line('A-ANNO-LEVL', [u0 - 1500, y], [u1 + 2500, y])
    const x = u1 + 2500
    ents.push({ ...base, id: id(), layer: 'A-ANNO-LEVL', kind: 'polyline', pts: [{ x, y }, { x: x + 250, y: y + 300 }, { x: x - 250, y: y + 300 }], closed: true, filled: true })
    text('A-ANNO-TEXT', x + 450, y + 80, T, l.name)
    text('A-ANNO-TEXT', x + 450, y - T - 120, T * 0.9, elevText(y))
  }

  // grids that run towards the viewer: vertical line + bubble with the label
  for (const g of model.grids ?? []) {
    const dx = g.b[0] - g.a[0], dy = g.b[1] - g.a[1]
    const L = Math.hypot(dx, dy) || 1
    if (Math.abs((dx / L) * v.toViewer[0] + (dy / L) * v.toViewer[1]) < 0.99) continue
    const u = uOf(g.a[0], g.a[1])
    const top = v1 + 1500
    line('A-GRID', [u, ground - 800], [u, top])
    ents.push({ ...base, id: id(), layer: 'A-GRID', kind: 'circle', c: { x: u, y: top + 450 }, r: 450 })
    text('A-ANNO-TEXT', u, top + 450 - T / 2, T * 1.2, g.label, 'center')
  }

  // dimensions: overall width under the ground line; storey heights and the top on the left
  const dim = (a: [number, number], b: [number, number], offset: number) =>
    ents.push({ ...base, id: id(), layer: 'A-ANNO-DIMS', kind: 'dimension', a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, offset, override: null, textHeight: T })
  dim([u0, ground], [u1, ground], -1400)
  const heights = [...levels.map((l) => l.elevation).filter((y) => y >= ground && y <= v1 + 1), v1]
  const marks = [...new Set(heights.map((y) => Math.round(y)))].sort((a, b) => a - b)
  for (let i = 0; i + 1 < marks.length; i++) dim([u0, marks[i]], [u0, marks[i + 1]], 1600)
  if (marks.length > 2) dim([u0, marks[0]], [u0, marks[marks.length - 1]], 3200)

  // sections: room names where the cutting plane passes through the room's outline
  if (r.kind === 'section' && cutAt !== undefined) {
    const ax = r.axis === 'x' ? 0 : 1
    for (const room of model.rooms) {
      const o = room.outline
      if (!o || o.length < 3) continue
      const lo = Math.min(...o.map((p) => p[ax])), hi = Math.max(...o.map((p) => p[ax]))
      if (cutAt <= lo || cutAt >= hi) continue
      const us = o.map((p) => uOf(p[0], p[1]))
      const lvl = model.levels.find((l) => l.id === room.level)
      if (!lvl) continue
      // number above the name, the name shrunk to the room's width (narrow rooms side by side do not overlap)
      const width = Math.max(...us) - Math.min(...us), cu = (Math.min(...us) + Math.max(...us)) / 2
      const fit = (s: string, h: number) => Math.min(h, (0.9 * width) / (0.6 * Math.max(1, s.length)))
      if (room.number) text('A-ANNO-TEXT', cu, lvl.elevation + 1100 + T * 1.4, fit(room.number, T * 0.85), room.number, 'center')
      text('A-ANNO-TEXT', cu, lvl.elevation + 1100, fit(room.name, T), room.name, 'center')
    }
  }

  // title under the drawing
  text('A-ANNO-TEXT', u0, ground - 3300, T * 1.6, r.title.toUpperCase())
  text('A-ANNO-TEXT', u0, ground - 3300 - T * 2, T, `1:${scale}`)

  const doc = createBlankDocument(opt.name ?? `Villa Riverside - ${r.title}.dwg`)
  doc.layers = [...doc.layers.filter((l) => !LAYERS.some((x) => x.name === l.name)), ...LAYERS]
  doc.currentLayer = 'A-ELEV'
  doc.entities = ents
  doc.layouts = [{ id: 'sheet', name: r.title, paper: 'A3', scale }]
  doc.source = 'bim-drawing'
  return doc
}
