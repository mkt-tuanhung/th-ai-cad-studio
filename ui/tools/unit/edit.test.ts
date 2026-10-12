// TRIM / HATCH / OFFSET geometry (run: UNIT=edit node tools/test-cam.mjs run).
import { hatchBoundary, intersectionsWith, offsetMore, polyArea, triangulate, trimEntity } from '../../src/cad/edit'
import { toDwgAdd } from '../../src/cad/dwgWrite'
import type { CadDocument, Entity } from '../../src/cad/types'

const base = { layer: '0', color: 'ByLayer', linetype: 'ByLayer', lineweight: 'ByLayer' } as const
let n = 0
const id = () => `x${++n}`
const L = (ax: number, ay: number, bx: number, by: number): Entity => ({ ...base, id: id(), kind: 'line', a: { x: ax, y: ay }, b: { x: bx, y: by } } as Entity)

export function run() {
  const out: Record<string, unknown> = {}
  // a horizontal line crossed by two verticals: trimming the middle leaves two pieces
  const h = L(0, 0, 100, 0), v1 = L(30, -10, 30, 10), v2 = L(70, -10, 70, 10)
  const t = trimEntity(h, [h, v1, v2], { x: 50, y: 0 }, id)!
  out.lineMiddle = t.map((e) => (e.kind === 'line' ? [e.a.x, e.b.x] : null))
  const t2 = trimEntity(h, [h, v1, v2], { x: 10, y: 0 }, id)!
  out.lineEnd = t2.map((e) => (e.kind === 'line' ? [e.a.x, e.b.x] : null))
  out.nothing = trimEntity(L(0, 50, 100, 50), [v1, v2], { x: 50, y: 50 }, id)
  // a circle cut by a line through its centre: picking the top keeps the bottom half (arc from 180° to 360°)
  const c: Entity = { ...base, id: id(), kind: 'circle', c: { x: 0, y: 0 }, r: 10 } as Entity
  const cut = trimEntity(c, [c, L(-20, 0, 20, 0)], { x: 0, y: 10 }, id)!
  out.circle = cut.map((e) => (e.kind === 'arc' ? [+(e.start * 180 / Math.PI).toFixed(1), +(e.end * 180 / Math.PI).toFixed(1)] : e.kind))
  out.crossings = intersectionsWith(c, [L(-20, 0, 20, 0), L(0, -20, 0, 20)]).length
  // hatch: a point inside a 10 × 10 square finds it; area 100
  const sq: Entity = { ...base, id: id(), kind: 'polyline', closed: true, pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] } as Entity
  const ring = hatchBoundary([sq], { x: 5, y: 5 }, null)!
  out.hatchArea = Math.abs(polyArea(ring))
  // L-shaped polygon triangulates into 4 triangles of total area 75
  const Lshape = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 10 }, { x: 0, y: 10 }]
  const tris = triangulate(Lshape)
  out.triangles = tris.length
  out.triArea = tris.reduce((a, [p, q, r]) => a + Math.abs((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)) / 2, 0)
  // offset a closed square by 1 outwards → 12 × 12
  const off = offsetMore(sq, 1, { x: 20, y: 5 })!
  out.offsetArea = off.kind === 'polyline' ? Math.abs(polyArea(off.pts)) : null
  // DWG script writes the fill as SOLIDs
  const doc = { name: 'hatch', layers: [{ name: '0', color: '#111827', visible: true, locked: false, linetype: 'Continuous', lineweight: 0.25 }], entities: [{ ...sq, filled: true }] } as unknown as CadDocument
  out.dwg = toDwgAdd(doc).counts
  return out
}

export function dwgScript() {
  const sq = { ...base, id: 'h1', kind: 'polyline', closed: true, filled: true, pts: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 500 }, { x: 500, y: 500 }, { x: 500, y: 1000 }, { x: 0, y: 1000 }] }
  const doc = { name: 'hatch', layers: [{ name: '0', color: '#111827', visible: true, locked: false, linetype: 'Continuous', lineweight: 0.25 }], entities: [sq] } as unknown as CadDocument
  return toDwgAdd(doc).script
}
