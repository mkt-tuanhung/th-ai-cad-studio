/**
 * Elevations and sections of the building made by the one command (desktop only): the same OCCT hidden-line
 * drawings as BIM → Project Browser (src/bim/drawing2d.ts) — the four elevations and two sections through the
 * middle of the building, one along each axis. Elevations are named by the grid lines they show, as Vietnamese
 * drawings are ("Mặt đứng trục 1-4"); without grids by the side they face. Each sheet is A3 at 1:100, or at the
 * next standard scale when the building does not fit.
 */
import type { HostApi } from '../services/host'
import type { CadDocument } from '../cad/types'
import type { BimModel } from '../bim/model'
import { bimExtras, nativeBuildingModel } from '../bim/scene'
import { drawingDocument, nativeRequest, VIEW, type DrawingReq, type Face, type NativeDrawing } from '../bim/drawing2d'
import { plotPage } from '../cad/plot'

export interface ViewWords {
  /** "{a}", "{b}": the first and last grid seen */
  elevAxes: string
  elevFace: Record<Face, string>
  /** "{n}" */
  section: string
}
export interface HouseView {
  title: string
  kind: 'elev' | 'section'
  doc: CadDocument
  /** a section: where its plane cuts (a plane of constant `axis` at `at` mm) and the way it looks (+1: towards
   *  +axis) — drawn on the floor plans */
  cut?: { axis: 'x' | 'y'; at: number; look: 1 | -1; label: string }
}
export interface HouseViews {
  views: HouseView[]
  ms: number
  error?: string
}

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''))

/** The grid labels seen from `face`, left to right (grids that run towards the viewer). */
export function gridsSeen(m: BimModel, face: Face): string[] {
  const v = VIEW[face]
  return (m.grids ?? [])
    .filter((g) => {
      const dx = g.b[0] - g.a[0], dy = g.b[1] - g.a[1]
      const L = Math.hypot(dx, dy) || 1
      return Math.abs((dx / L) * v.toViewer[0] + (dy / L) * v.toViewer[1]) >= 0.99
    })
    .map((g) => ({ label: g.label, u: g.a[0] * v.xDir[0] + g.a[1] * v.xDir[1] }))
    .sort((a, b) => a.u - b.u)
    .map((g) => g.label)
}

export function viewRequests(m: BimModel, w: ViewWords): DrawingReq[] {
  const elev = (['front', 'right', 'back', 'left'] as Face[]).map((face): DrawingReq => {
    const g = gridsSeen(m, face)
    return { kind: 'elev', face, title: g.length >= 2 ? fill(w.elevAxes, { a: g[0], b: g[g.length - 1] }) : w.elevFace[face] }
  })
  const st = stairSection(m)
  // 1-1 along the stair (as Vietnamese drawing sets do) when there is one, 2-2 across it through the middle;
  // without stairs: 1-1 a plane of constant y seen from the south, 2-2 a plane of constant x seen from the west
  if (st) return [...elev, { kind: 'section', ...st, title: fill(w.section, { n: 1 }) }, { kind: 'section', ...(st.axis === 'x' ? { axis: 'y', face: 'front' } : { axis: 'x', face: 'left' }), title: fill(w.section, { n: 2 }) }]
  return [...elev, { kind: 'section', axis: 'y', face: 'front', title: fill(w.section, { n: 1 }) }, { kind: 'section', axis: 'x', face: 'left', title: fill(w.section, { n: 2 }) }]
}

/**
 * The section along the first flight of the lowest stair: the plane through the flight's centre line, parallel
 * to its run, seen from the side away from the other flight of a U stair (that flight is then seen beyond the cut
 * one, the landing between them). Null without a stair square to the axes.
 */
export function stairSection(m: BimModel): { axis: 'x' | 'y'; at: number; face: Face } | null {
  const lv = (id: string) => m.levels.find((l) => l.id === id)?.elevation ?? 0
  const first = [...m.stairs].filter((s) => !s.spiral).sort((a, b) => lv(a.baseLevel) - lv(b.baseLevel) || (a.baseOffset ?? 0) - (b.baseOffset ?? 0))[0]
  if (!first) return null
  const a = ((((first.angle % 180) + 180) % 180) + 0.5) | 0
  if (a !== 0 && a !== 90 && a !== 180) return null
  // run along x → a plane of constant y; run along y → a plane of constant x
  const axis: 'x' | 'y' = a === 90 ? 'x' : 'y'
  const at = axis === 'x' ? first.x : first.y
  const other = m.stairs.find((s) => s !== first && s.baseLevel === first.baseLevel)
  const side = other ? Math.sign((axis === 'x' ? other.x : other.y) - at) : 1
  // look towards the other flight: the viewer stands on the opposite side
  const face: Face = axis === 'x' ? (side < 0 ? 'right' : 'left') : side < 0 ? 'back' : 'front'
  return { axis, at, face }
}

const SCALES = [100, 125, 150, 200, 250, 500]

export async function houseViews(host: HostApi, m: BimModel, w: ViewWords): Promise<HouseViews> {
  const t0 = Date.now()
  const key = 'auto-views'
  const load = await host.scene3dLoadBim(key, JSON.stringify(nativeBuildingModel(m)), JSON.stringify(bimExtras(m)))
  if (!load.ok) return { views: [], ms: Date.now() - t0, error: load.error ?? 'scene' }
  const b = (await host.scene3dCommand(key, JSON.stringify({ cmd: 'bounds' }))).bounds ?? [0, 0, 0, 0, 0, 0]
  const views: HouseView[] = []
  let error: string | undefined
  for (const r of viewRequests(m, w)) {
    const req = nativeRequest(r, b)
    const nd = (await host.scene3dCommand(key, JSON.stringify(req))) as unknown as { ok: boolean; error?: string } & NativeDrawing
    if (!nd.ok) { error = error ?? nd.error ?? 'HLR'; continue }
    const cutAt = 'at' in req ? req.at : undefined
    let doc: CadDocument | null = null
    for (const scale of SCALES) {
      doc = drawingDocument(m, r, nd, cutAt, { name: r.title, scale })
      if (plotPage(doc, 'A3').scale <= scale) break
    }
    const ax = r.axis === 'x' ? 0 : 1
    const look = (-VIEW[r.face].toViewer[ax] || 1) as 1 | -1
    if (doc) views.push({ title: r.title, kind: r.kind, doc, ...(cutAt !== undefined && r.axis ? { cut: { axis: r.axis, at: cutAt, look, label: String(views.filter((v) => v.cut).length + 1) } } : {}) })
  }
  return { views, ms: Date.now() - t0, ...(error ? { error } : {}) }
}
