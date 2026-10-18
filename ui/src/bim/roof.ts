/**
 * Pitched roofs from the roof plans ("MẶT BẰNG MÁI"), read by code: the eaves outline on the roof layers (MÁI,
 * ROOF, NGÓI, TÔN — the largest closed outline there, else the extent of its lines), the slope written on the
 * plan ("i = 35%", "30°", "độ dốc 30°"), hip or gable from the words ("4 mái" / "2 mái", "hip" / "gable") or from
 * the ridge: a line along the middle reaching both ends of the outline is a gable ridge. The plan is placed on the
 * model by grid 1 / A like the structural plans. A roof plan with no slope written, or only a drainage fall under 5°
 * ("i = 2%"), is a flat roof (not read here).
 * Geometry (src/bim/scene.ts): over the outline's rectangle, eaves on the top level.
 */
import type { CadDocument, Entity } from '../cad/types'
import type { BimModel, P2, PitchedRoof } from './model'
import { boxOf, isRoofPlanTitle, norm, scaleDoc, segsOf, unitScaleOf, type Box } from './fromCad'
import { gridsIn, planToModel } from './structure'

const ROOF_LAYER = /(ROOF|\bMAI\b|NGOI|\bTON\b)/

type Txt = Extract<Entity, { kind: 'text' }>
const inBox = (p: { x: number; y: number }, b: Box, pad = 0) => p.x >= b.x0 - pad && p.x <= b.x1 + pad && p.y >= b.y0 - pad && p.y <= b.y1 + pad

/** The slope written on a plan, in degrees (null: none). */
export function parseSlope(s: string): number | null {
  // accents off, symbols kept (norm() drops "=", "%", "°")
  const n = s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'D').toUpperCase()
  const pc = /\bI\s*=\s*(\d{1,3}(?:[.,]\d+)?)\s*%/.exec(n)
  if (pc) return (Math.atan(Number(pc[1].replace(',', '.')) / 100) * 180) / Math.PI
  const dg = /(\d{1,2}(?:[.,]\d+)?)\s*(°|DO\b)/.exec(n)
  if (dg && /(DOC|SLOPE|MAI|ROOF|°)/.test(n)) return Number(dg[1].replace(',', '.'))
  return null
}

export interface RoofRead {
  roofs: PitchedRoof[]
  warnings: string[]
}

export function readRoofs(doc: CadDocument, m: BimModel, alignGrid: [string, string] | null): RoofRead {
  const warnings: string[] = []
  const roofs: PitchedRoof[] = []
  // a drawing in metres / centimetres (no INSUNITS): read in millimetres like the plans
  const k = unitScaleOf(doc.entities)
  if (k !== 1) { doc = scaleDoc(doc, k); warnings.push(`unitsScaled:${k}`) }
  const texts = doc.entities.filter((e): e is Txt => e.kind === 'text')
  // roof plans (not the structural plan of the roof slab)
  const titles = texts.filter((t) => isRoofPlanTitle(t.value, true) && !/\bKET CAU\b|\bSTRUCT/.test(norm(t.value)))
  const roofEnts = doc.entities.filter((e) => ROOF_LAYER.test(norm(e.layer)) && e.kind !== 'text')
  const top = [...m.levels].sort((a, b) => b.elevation - a.elevation)[0]
  // ids not already in the model (roofs read from several drawings)
  const taken = new Set((m.roofs ?? []).map((r) => r.id))
  let no = 0
  const nextNo = () => { do no++; while (taken.has(`roof-${no}`)); return no }
  for (const title of titles) {
    // the roof drawing over its title, across its width
    const mine = roofEnts.filter((e) => { const b = boxOf(e); return b.y0 > title.p.y - 500 && b.y0 < title.p.y + 25000 && b.x1 > title.p.x - 20000 && b.x0 < title.p.x + 20000 })
    if (!mine.length) continue
    const box = mine.map(boxOf).reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }))
    const words = texts.filter((t) => inBox(t.p, box, 1500))
    const slope = words.map((t) => parseSlope(t.value)).find((v) => v !== null) ?? null
    // none written, or a drainage fall ("i = 2%"): a flat roof — pitched roofs are well over 5°
    if (slope === null || slope < 5) continue
    // placed by grid 1 / A, turned and moved like the structural plans (a roof plan drawn at an angle too)
    const grids = gridsIn(doc.entities.filter((e) => /(GRID|AXIS|\bTRUC\b)/.test(norm(e.layer))), texts, box)
    const pm = planToModel(grids, m, alignGrid)
    if (!pm) { warnings.push(`roofNoPlace:${title.value}`); continue }
    if (pm.skew) warnings.push(`roofSkew:${title.value}`)
    const T = (x: number, y: number): P2 => { const q = pm.T([x, y]); return [Math.round(q[0]), Math.round(q[1])] }
    const closed = mine.filter((e): e is Extract<Entity, { kind: 'polyline' }> => e.kind === 'polyline' && e.closed && e.pts.length >= 4)
    const outer = closed.sort((a, b) => { const A = boxOf(a), B = boxOf(b); return (B.x1 - B.x0) * (B.y1 - B.y0) - (A.x1 - A.x0) * (A.y1 - A.y0) })[0]
    // the eaves in the model frame: a drawn rectangle as it is (square to the model or turned), anything else by its
    // box in the model frame (flagged)
    const src: P2[] = outer ? outer.pts.map((q) => T(q.x, q.y)) : mine.flatMap((e) => segsOf(e).flatMap(([a, b]) => [T(a.x, a.y), T(b.x, b.y)]))
    const mb = { x0: Math.min(...src.map((q) => q[0])), y0: Math.min(...src.map((q) => q[1])), x1: Math.max(...src.map((q) => q[0])), y1: Math.max(...src.map((q) => q[1])) }
    const rect = outer && outer.pts.length === 4 ? asRect(src) : null
    const approx = !rect
    const outline: P2[] = rect ?? [[mb.x0, mb.y0], [mb.x1, mb.y0], [mb.x1, mb.y1], [mb.x0, mb.y1]]
    const n = nextNo()
    const roof: PitchedRoof = { id: `roof-${n}`, category: 'roof', mark: `R${n}`, level: top.id, outline, kind: 'hip', slope: Math.round(slope * 100) / 100, ...(approx ? { approx: true } : {}) }
    // hip or gable: the words, else a ridge line along the middle reaching both ends of the outline (model frame)
    const w = norm(words.map((t) => t.value).join(' '))
    const said: PitchedRoof['kind'] | null = /(\b2 MAI\b|HAI MAI|GABLE)/.test(w) ? 'gable' : /(\b4 MAI\b|BON MAI|HIP)/.test(w) ? 'hip' : null
    if (said) roof.kind = said
    else {
      const f = roofFrame(roof)
      const loc = (q: P2) => [(q[0] - f.o[0]) * f.u[0] + (q[1] - f.o[1]) * f.u[1], (q[0] - f.o[0]) * f.v[0] + (q[1] - f.o[1]) * f.v[1]]
      const ridge = mine.flatMap(segsOf).some(([a, b]) => {
        const [sa, ta] = loc(T(a.x, a.y)), [sb, tb] = loc(T(b.x, b.y))
        return Math.abs(ta - tb) < 20 && Math.abs((ta + tb) / 2 - f.W / 2) < 150 && Math.min(sa, sb) < 150 && Math.max(sa, sb) > f.L - 150
      })
      if (ridge) roof.kind = 'gable'
    }
    roofs.push(roof)
    if (approx) warnings.push(`roofApprox:${title.value}`)
  }
  return { roofs, warnings }
}

/** Four points forming a rectangle (within 1 %), counter-clockwise from the corner nearest the lower left (a rectangle
 *  square to the axes starts at its min x / min y corner); null when they are no rectangle. */
function asRect(p: P2[]): P2[] | null {
  if (p.length !== 4) return null
  const d = (a: P2, b: P2) => Math.hypot(b[0] - a[0], b[1] - a[1])
  const [a, b, c, e] = p
  const tol = 0.01 * Math.max(d(a, c), 1)
  if (d(a, b) < 1 || d(b, c) < 1 || Math.abs(d(a, c) - d(b, e)) > tol || Math.abs(d(a, b) - d(c, e)) > tol || Math.abs(d(b, c) - d(e, a)) > tol) return null
  const area = p.reduce((s, q, i) => s + q[0] * p[(i + 1) % 4][1] - p[(i + 1) % 4][0] * q[1], 0)
  const ccw = area < 0 ? [...p].reverse() : [...p]
  let k = 0
  ccw.forEach((q, i) => { if (q[0] + q[1] < ccw[k][0] + ccw[k][1] - 1e-6) k = i })
  return [...ccw.slice(k), ...ccw.slice(0, k)]
}

/** The roof's rectangle: long axis u, its length L and width W, the corner it starts from, rise of the ridge.
 *  The frame is right-handed for every orientation of the outline (u × v points up): the mass is a triangle in the
 *  plane (v, up) extruded along u (3D and IFC), so a left-handed frame — a deep plot, its long side along plan Y —
 *  would hang the roof upside down into the top storey. */
export function roofFrame(r: PitchedRoof) {
  const [a, b, , d] = r.outline
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), ad = Math.hypot(d[0] - a[0], d[1] - a[1])
  const long = ab >= ad
  const L = long ? ab : ad, W = long ? ad : ab
  const u: P2 = long ? [(b[0] - a[0]) / ab, (b[1] - a[1]) / ab] : [(d[0] - a[0]) / ad, (d[1] - a[1]) / ad]
  let v: P2 = long ? [(d[0] - a[0]) / ad, (d[1] - a[1]) / ad] : [(b[0] - a[0]) / ab, (b[1] - a[1]) / ab]
  let o: P2 = a
  if (u[0] * v[1] - u[1] * v[0] < 0) {
    // the same rectangle from its opposite long edge, across the other way: u × v up
    o = [a[0] + v[0] * W, a[1] + v[1] * W]
    v = [-v[0], -v[1]]
  }
  const t = Math.tan((r.slope * Math.PI) / 180)
  return { o, u, v, L, W, h: (W / 2) * t, tan: t }
}

/** Roof quantities: covering area along the slopes, ridge and hip lengths. */
export function roofQuantities(r: PitchedRoof) {
  const f = roofFrame(r)
  const cos = Math.cos((r.slope * Math.PI) / 180)
  const ridge = r.kind === 'gable' ? f.L : Math.max(0, f.L - f.W)
  const hip = r.kind === 'hip' ? 4 * Math.hypot(f.W / 2, f.W / 2, f.h) : 0
  return { area: (f.L * f.W) / cos / 1e6, ridge: ridge / 1000, hips: hip / 1000, gableWalls: r.kind === 'gable' ? (f.W * f.h) / 1e6 : 0 }
}
