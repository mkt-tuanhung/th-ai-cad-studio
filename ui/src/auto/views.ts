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
  /** a section: where its plane cuts (a plane of constant `axis` at `at` mm) — drawn on the floor plans */
  cut?: { axis: 'x' | 'y'; at: number; label: string }
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
  // 1-1: a plane of constant y seen from the south; 2-2: a plane of constant x seen from the west
  return [...elev, { kind: 'section', axis: 'y', face: 'front', title: fill(w.section, { n: 1 }) }, { kind: 'section', axis: 'x', face: 'left', title: fill(w.section, { n: 2 }) }]
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
    if (doc) views.push({ title: r.title, kind: r.kind, doc, ...(cutAt !== undefined && r.axis ? { cut: { axis: r.axis, at: cutAt, label: String(views.filter((v) => v.cut).length + 1) } } : {}) })
  }
  return { views, ms: Date.now() - t0, ...(error ? { error } : {}) }
}
