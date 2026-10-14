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
import { boxOf, norm, segsOf, type Box } from './fromCad'
import { cross, gridsIn } from './structure'

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
  const texts = doc.entities.filter((e): e is Txt => e.kind === 'text')
  const titles = texts.filter((t) => /MAT BANG MAI|ROOF PLAN|MB MAI/.test(norm(t.value)))
  const roofEnts = doc.entities.filter((e) => ROOF_LAYER.test(norm(e.layer)) && e.kind !== 'text')
  const mg = (lab: string) => m.grids.find((g) => g.label === lab)
  const modelO = alignGrid && mg(alignGrid[0]) && mg(alignGrid[1]) ? cross(mg(alignGrid[0])!, mg(alignGrid[1])!) : null
  const top = [...m.levels].sort((a, b) => b.elevation - a.elevation)[0]
  for (const title of titles) {
    // the roof drawing over its title, across its width
    const mine = roofEnts.filter((e) => { const b = boxOf(e); return b.y0 > title.p.y - 500 && b.y0 < title.p.y + 25000 && b.x1 > title.p.x - 20000 && b.x0 < title.p.x + 20000 })
    if (!mine.length) continue
    const box = mine.map(boxOf).reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }))
    const words = texts.filter((t) => inBox(t.p, box, 1500))
    const slope = words.map((t) => parseSlope(t.value)).find((v) => v !== null) ?? null
    // none written, or a drainage fall ("i = 2%"): a flat roof — pitched roofs are well over 5°
    if (slope === null || slope < 5) continue
    const closed = mine.filter((e): e is Extract<Entity, { kind: 'polyline' }> => e.kind === 'polyline' && e.closed && e.pts.length >= 4)
    const outer = closed.sort((a, b) => { const A = boxOf(a), B = boxOf(b); return (B.x1 - B.x0) * (B.y1 - B.y0) - (A.x1 - A.x0) * (A.y1 - A.y0) })[0]
    const ob = outer ? boxOf(outer) : box
    const approx = !outer || outer.pts.length !== 4
    // hip or gable: the words, else a ridge line reaching both ends of the outline
    const w = norm(words.map((t) => t.value).join(' '))
    const said: PitchedRoof['kind'] | null = /(\b2 MAI\b|HAI MAI|GABLE)/.test(w) ? 'gable' : /(\b4 MAI\b|BON MAI|HIP)/.test(w) ? 'hip' : null
    let kind: PitchedRoof['kind'] = said ?? 'hip'
    if (!said) {
      const along = ob.x1 - ob.x0 >= ob.y1 - ob.y0
      const ridge = mine.flatMap(segsOf).some(([a, b]) => along
        ? Math.abs(a.y - b.y) < 20 && Math.abs((a.y + b.y) / 2 - (ob.y0 + ob.y1) / 2) < 150 && Math.min(a.x, b.x) < ob.x0 + 150 && Math.max(a.x, b.x) > ob.x1 - 150
        : Math.abs(a.x - b.x) < 20 && Math.abs((a.x + b.x) / 2 - (ob.x0 + ob.x1) / 2) < 150 && Math.min(a.y, b.y) < ob.y0 + 150 && Math.max(a.y, b.y) > ob.y1 - 150)
      if (ridge) kind = 'gable'
    }
    // placed by grid 1 / A
    const grids = gridsIn(doc.entities.filter((e) => /(GRID|AXIS|\bTRUC\b)/.test(norm(e.layer))), texts, box)
    const gv = alignGrid ? grids.find((x) => x.label === alignGrid[0]) : undefined, gh = alignGrid ? grids.find((x) => x.label === alignGrid[1]) : undefined
    const planO = gv && gh ? cross(gv, gh) : null
    if (!planO || !modelO) { warnings.push(`roofNoPlace:${title.value}`); continue }
    const T = (x: number, y: number): P2 => [Math.round(x - planO[0] + modelO[0]), Math.round(y - planO[1] + modelO[1])]
    roofs.push({ id: `roof-${roofs.length + 1}`, category: 'roof', mark: `R${roofs.length + 1}`, level: top.id, outline: [T(ob.x0, ob.y0), T(ob.x1, ob.y0), T(ob.x1, ob.y1), T(ob.x0, ob.y1)], kind, slope: Math.round(slope * 100) / 100, ...(approx ? { approx: true } : {}) })
    if (approx) warnings.push(`roofApprox:${title.value}`)
  }
  return { roofs, warnings }
}

/** The roof's rectangle: long axis u, its length L and width W, the corner it starts from, rise of the ridge. */
export function roofFrame(r: PitchedRoof) {
  const [a, b, , d] = r.outline
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), ad = Math.hypot(d[0] - a[0], d[1] - a[1])
  const long = ab >= ad
  const L = long ? ab : ad, W = long ? ad : ab
  const u: P2 = long ? [(b[0] - a[0]) / ab, (b[1] - a[1]) / ab] : [(d[0] - a[0]) / ad, (d[1] - a[1]) / ad]
  const v: P2 = long ? [(d[0] - a[0]) / ad, (d[1] - a[1]) / ad] : [(b[0] - a[0]) / ab, (b[1] - a[1]) / ab]
  const t = Math.tan((r.slope * Math.PI) / 180)
  return { o: a, u, v, L, W, h: (W / 2) * t, tan: t }
}

/** Roof quantities: covering area along the slopes, ridge and hip lengths. */
export function roofQuantities(r: PitchedRoof) {
  const f = roofFrame(r)
  const cos = Math.cos((r.slope * Math.PI) / 180)
  const ridge = r.kind === 'gable' ? f.L : Math.max(0, f.L - f.W)
  const hip = r.kind === 'hip' ? 4 * Math.hypot(f.W / 2, f.W / 2, f.h) : 0
  return { area: (f.L * f.W) / cos / 1e6, ridge: ridge / 1000, hips: hip / 1000, gableWalls: r.kind === 'gable' ? (f.W * f.h) / 1e6 : 0 }
}
