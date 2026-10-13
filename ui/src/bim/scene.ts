/**
 * BIM elements the native building builder does not know (columns, slabs, roofs, ceilings, stairs,
 * railings, components, curtain walls) as OCCT primitives. Walls with their openings, glazing and the
 * level slabs come from the native builder (SceneView::addBuilding); curtain walls are left out of it and
 * built here as glass + mullions. Item ids are the element ids, so a click in 3D selects the element.
 */
import { boxAt, cylBetween, hex, prism, vcyl, type Prim, type Scene, type SceneItem } from '../engine3d/scene'
import { levelOf, typeOf, type BimModel } from './model'
import { wallEnds } from './geometry'

const elev = (m: BimModel, id: string) => levelOf(m, id)?.elevation ?? 0
const CONCRETE = hex('#c9c6c0'), STEEL = hex('#5b6370'), GLASS = hex('#9cc3d5'), TIMBER = hex('#b98d5f')

/** Storey height a stair climbs, its riser count and riser height (≤ 180 mm). */
export function stairRisers(m: BimModel, base: string, top: string) {
  const H = Math.max(0, elev(m, top) - elev(m, base))
  const n = Math.max(1, Math.ceil(H / 180))
  return { H, n, riser: H / n }
}

/** The flight a stair element is: where it starts (z), the height it climbs, its risers. */
export function stairFlight(m: BimModel, st: BimModel['stairs'][number]) {
  const z = elev(m, st.baseLevel) + (st.baseOffset ?? 0)
  if (st.rise !== undefined && st.rise > 0) {
    const n = st.risers ?? Math.max(1, Math.ceil(st.rise / 180))
    return { z, H: st.rise, n, riser: st.rise / n }
  }
  return { z, ...stairRisers(m, st.baseLevel, st.topLevel) }
}

export function bimExtras(m: BimModel): Scene {
  const items: SceneItem[] = []
  for (const c of m.columns) {
    const z = elev(m, c.level), h = elev(m, c.topLevel) - z
    if (h <= 0) continue
    items.push({ id: c.id, rgb: CONCRETE, parts: [c.round ? vcyl(c.x, c.y, z, c.w / 2, h) : boxAt(c.x, c.y, z, c.w, c.d, h)] })
  }
  for (const s of m.slabs) {
    if (s.outline.length < 3) continue
    const z = elev(m, s.level) + s.offset
    // floor: top at the level; roof: sits on the level; ceiling: hangs at the offset
    const z0 = s.kind === 'floor' ? z - s.thickness : z
    // holes (a stair well) cut a little past both faces
    const cuts = (s.openings ?? []).filter((o) => o.length >= 3).map((o) => prism([0, 0, z0 - 10], o, s.thickness + 20))
    items.push({ id: s.id, rgb: s.kind === 'ceiling' ? hex('#f2f1ee') : s.kind === 'roof' ? hex('#8d8a85') : CONCRETE, parts: [prism([0, 0, z0], s.outline, s.thickness)], ...(cuts.length ? { cuts } : {}) })
  }
  for (const st of m.stairs) {
    const { n, riser, z } = stairFlight(m, st)
    const t = (st.angle * Math.PI) / 180
    const ux = Math.cos(t), uy = Math.sin(t)
    // one flight = its side profile (the steps on top, a sloping waist slab of 150 mm under them) extruded
    // across the width: local x along the run, local y up, extruded towards the right of the run
    const going = st.length / n, H = n * riser
    const waist = 150 / Math.cos(Math.atan2(riser, going))
    const prof: [number, number][] = [[0, 0]]
    for (let i = 0; i < n; i++) prof.push([i * going, (i + 1) * riser], [(i + 1) * going, (i + 1) * riser])
    // the soffit: parallel to the nosings, meeting the floor in front and ending under the top tread
    const xs = Math.min(st.length / 2, Math.max(0, (waist - riser) / (riser / going)))
    prof.push([st.length, Math.max(H - 120, Math.min(H - 1, riser + H - waist))])
    if (xs > 1) prof.push([xs, 0])
    const nx = -uy * (st.width / 2), ny = ux * (st.width / 2)
    const parts: Prim[] = [{ ...prism([st.x + nx, st.y + ny, z], prof.filter((q, i, a) => i === 0 || q[0] !== a[i - 1][0] || q[1] !== a[i - 1][1]), st.width), z: [uy, -ux, 0], x: [ux, uy, 0] }]
    items.push({ id: st.id, rgb: CONCRETE, parts })
  }
  for (const r of m.railings) {
    if (r.pts.length < 2) continue
    const z = elev(m, r.level)
    const parts: Prim[] = []
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [a, b] = [r.pts[i], r.pts[i + 1]]
      // base heights at both ends: a stair rail runs parallel to the nosings
      const za = z + (r.z?.[i] ?? 0), zb = z + (r.z?.[i + 1] ?? 0)
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (L < 1) continue
      const k = Math.max(1, Math.ceil(L / 1200))
      for (let j = i === 0 ? 0 : 1; j <= k; j++) parts.push(vcyl(a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k, za + ((zb - za) * j) / k, 20, r.height))
      parts.push(cylBetween([a[0], a[1], za + r.height], [b[0], b[1], zb + r.height], 25))
      parts.push(cylBetween([a[0], a[1], za + r.height * 0.45], [b[0], b[1], zb + r.height * 0.45], 12))
    }
    items.push({ id: r.id, rgb: STEEL, mat: 'metal', parts })
  }
  for (const c of m.components) items.push({ id: c.id, rgb: TIMBER, parts: [boxAt(c.x, c.y, elev(m, c.level), c.w, c.d, c.h, c.rot)] })
  // curtain walls: a glass plane and mullions every 1.5 m, transoms at the head of each storey
  for (const w of m.walls) {
    if (typeOf(m, w)?.family !== 'Curtain Wall') continue
    const z0 = elev(m, w.baseLevel) + w.baseOffset, z1 = elev(m, w.topLevel) + w.topOffset
    if (z1 <= z0) continue
    const { a, dir } = wallEnds(w)
    const mid = (s: number): [number, number] => [a[0] + dir[0] * s, a[1] + dir[1] * s]
    const [cx, cy] = mid(w.length / 2)
    items.push({ id: w.id, rgb: GLASS, transparency: 0.6, mat: 'glass', parts: [boxAt(cx, cy, z0, w.length, 24, z1 - z0, w.angle ?? 0)] })
    const frame: Prim[] = []
    const k = Math.max(1, Math.round(w.length / 1500))
    for (let i = 0; i <= k; i++) {
      const [x, y] = mid(Math.min(w.length - 30, Math.max(30, (w.length * i) / k)))
      frame.push(boxAt(x, y, z0, 60, 120, z1 - z0, w.angle ?? 0))
    }
    for (const z of [z0, z1 - 60]) frame.push(boxAt(cx, cy, z, w.length, 120, 60, w.angle ?? 0))
    items.push({ id: `${w.id}:frame`, rgb: STEEL, mat: 'metal', parts: frame })
  }
  return { items }
}

/** The model the native builder gets: curtain walls (built above) and their openings left out. */
export function nativeBuildingModel(m: BimModel): BimModel {
  const cw = new Set(m.walls.filter((w) => typeOf(m, w)?.family === 'Curtain Wall').map((w) => w.id))
  if (!cw.size) return m
  return { ...m, walls: m.walls.filter((w) => !cw.has(w.id)), doors: m.doors.filter((o) => !cw.has(o.hostWall)), windows: m.windows.filter((o) => !cw.has(o.hostWall)) }
}

/** Load-bearing walls: a concrete structure layer (partitions are masonry, curtain walls glazing). */
export const isStructuralWall = (m: BimModel, w: BimModel['walls'][number]) => /concrete/i.test(typeOf(m, w)?.structure ?? '') && typeOf(m, w)?.family !== 'Curtain Wall'

/** 3D items the Structure discipline hides (architectural only). */
export function nonStructuralIds(m: BimModel): string[] {
  const ids: string[] = []
  for (const w of m.walls) if (!isStructuralWall(m, w)) ids.push(w.id, `${w.id}:frame`)
  for (const o of [...m.doors, ...m.windows]) ids.push(`glass:${o.id}`)
  for (const s of m.slabs) if (s.kind === 'ceiling') ids.push(s.id)
  for (const x of [...m.railings, ...m.components]) ids.push(x.id)
  return ids
}
