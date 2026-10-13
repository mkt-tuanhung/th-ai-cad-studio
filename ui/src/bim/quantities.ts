/**
 * Bill of quantities of the BIM model, by code from the elements' own geometry (the one-command package and
 * its report). Per level and in total:
 *  - reinforced concrete: floor slabs net of their openings, the roof, columns, stair flights (step profile with
 *    its waist × width), landings — m³;
 *  - masonry by wall thickness: wall area net of doors and windows, and its volume (columns inside walls are not
 *    deducted) — m², m³; curtain walls apart (glazing, m²);
 *  - plaster and paint: inside and outside faces (a wall on the outline of its level's floor slab has one face
 *    out, a balcony parapet two, other walls two faces in) — m²;
 *  - floor finishes: room areas (double-height voids left out) — m²;
 *  - doors and windows: number and area; railings: length (along their slope) — m.
 */
import { levelOf, typeOf, wallHeight, type BimModel, type P2 } from './model'
import { polyArea, segDist, wallEnds } from './geometry'
import { stairFlight, stairProfile } from './scene'

export interface BoqWords {
  groups: { concrete: string; masonry: string; finishes: string; openings: string; railings: string }
  items: {
    slab: string; roof: string; landing: string; column: string; stair: string
    wall: string // "{t}" thickness
    wallVol: string // "{t}"
    glazing: string
    plasterIn: string; plasterOut: string; paintIn: string; paintOut: string; floor: string
    doors: string; doorsArea: string; windows: string; windowsArea: string
    railing: string
  }
  units: { m3: string; m2: string; m: string; pcs: string }
  all: string
}

export interface BoqRow {
  group: string
  item: string
  unit: string
  /** quantity per level name, in level order; `total` their sum */
  byLevel: Record<string, number>
  total: number
}

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''))

/** A wall with a face out: on the outline of its level's floor slab (within half its thickness + 150 mm). */
function exterior(m: BimModel, w: BimModel['walls'][number]): boolean {
  if (w.topLevel === w.baseLevel) return true // a parapet
  const sl = m.slabs.find((s) => s.level === w.baseLevel && s.kind === 'floor' && !s.landing)
  if (!sl) return false
  const { a, b } = wallEnds(w)
  const mid: P2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const t = typeOf(m, w)?.thickness ?? 200
  const o = sl.outline
  return o.some((p, i) => segDist(mid, p, o[(i + 1) % o.length]).d <= t / 2 + 150)
}

export function boq(m: BimModel, w: BoqWords): BoqRow[] {
  const levels = [...m.levels].sort((a, b) => a.elevation - b.elevation)
  const rows = new Map<string, BoqRow>()
  const add = (group: string, item: string, unit: string, level: string, q: number) => {
    if (!(q > 0)) return
    const key = `${group}|${item}|${unit}`
    const r = rows.get(key) ?? { group, item, unit, byLevel: {}, total: 0 }
    r.byLevel[level] = (r.byLevel[level] ?? 0) + q
    r.total += q
    rows.set(key, r)
  }
  const G = w.groups, I = w.items, U = w.units
  const lvName = (id: string) => levelOf(m, id)?.name ?? id
  // concrete
  for (const s of m.slabs) {
    if (s.kind === 'ceiling' || s.outline.length < 3) continue
    const A = (polyArea(s.outline) - (s.openings ?? []).reduce((a, o) => a + polyArea(o), 0)) / 1e6
    add(G.concrete, s.landing ? I.landing : s.kind === 'roof' ? I.roof : I.slab, U.m3, lvName(s.level), (A * s.thickness) / 1000)
  }
  for (const c of m.columns) {
    const h = wallHeight(m, { baseLevel: c.level, topLevel: c.topLevel, baseOffset: 0, topOffset: 0 } as BimModel['walls'][number])
    const A = c.round ? (Math.PI * c.w * c.w) / 4 : c.w * c.d
    add(G.concrete, I.column, U.m3, lvName(c.level), (A * h) / 1e9)
  }
  for (const st of m.stairs) {
    const { n, riser } = stairFlight(m, st)
    add(G.concrete, I.stair, U.m3, lvName(st.baseLevel), (polyArea(stairProfile(st, n, riser)) * st.width) / 1e9)
  }
  // walls
  for (const x of m.walls) {
    const t = typeOf(m, x)
    const H = wallHeight(m, x)
    if (H <= 0) continue
    const ops = [...m.doors, ...m.windows].filter((o) => o.hostWall === x.id).reduce((a, o) => a + o.width * Math.min(o.height, H), 0)
    const net = Math.max(0, x.length * H - ops) / 1e6
    const lv = lvName(x.baseLevel)
    if (t?.family === 'Curtain Wall') { add(G.openings, I.glazing, U.m2, lv, (x.length * H) / 1e6); continue }
    const th = t?.thickness ?? 200
    add(G.masonry, fill(I.wall, { t: th }), U.m2, lv, net)
    add(G.masonry, fill(I.wallVol, { t: th }), U.m3, lv, (net * th) / 1000)
    const out = exterior(m, x) ? (x.topLevel === x.baseLevel ? 2 : 1) : 0
    add(G.finishes, I.plasterIn, U.m2, lv, net * (2 - out))
    add(G.finishes, I.plasterOut, U.m2, lv, net * out)
    add(G.finishes, I.paintIn, U.m2, lv, net * (2 - out))
    add(G.finishes, I.paintOut, U.m2, lv, net * out)
  }
  for (const r of m.rooms) if (!r.void) add(G.finishes, I.floor, U.m2, lvName(r.level), r.area)
  // openings
  const host = (id: string) => m.walls.find((x) => x.id === id)
  for (const o of m.doors) { const lv = lvName(host(o.hostWall)?.baseLevel ?? ''); add(G.openings, I.doors, U.pcs, lv, 1); add(G.openings, I.doorsArea, U.m2, lv, (o.width * o.height) / 1e6) }
  for (const o of m.windows) { const lv = lvName(host(o.hostWall)?.baseLevel ?? ''); add(G.openings, I.windows, U.pcs, lv, 1); add(G.openings, I.windowsArea, U.m2, lv, (o.width * o.height) / 1e6) }
  for (const r of m.railings) {
    let L = 0
    for (let i = 0; i + 1 < r.pts.length; i++) L += Math.hypot(r.pts[i + 1][0] - r.pts[i][0], r.pts[i + 1][1] - r.pts[i][1], (r.z?.[i + 1] ?? 0) - (r.z?.[i] ?? 0))
    add(G.railings, I.railing, U.m, lvName(r.level), L / 1000)
  }
  // in the order of the groups, then as found
  const order = [G.concrete, G.masonry, G.finishes, G.openings, G.railings]
  return [...rows.values()].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group)).map((r) => ({ ...r, byLevel: Object.fromEntries(levels.map((l) => [l.name, r.byLevel[l.name] ?? 0]).filter(([, v]) => (v as number) > 0)) }))
}

/** Door and window schedule: one line per mark and size, with the levels it is on and how many. */
export function openingSchedule(m: BimModel): { mark: string; kind: 'door' | 'window'; family: string; width: number; height: number; sill: number; levels: string[]; count: number }[] {
  const host = (id: string) => m.walls.find((x) => x.id === id)
  const lvOrder = (n: string) => m.levels.find((l) => l.name === n)?.elevation ?? 0
  const map = new Map<string, ReturnType<typeof openingSchedule>[number]>()
  for (const o of [...m.doors, ...m.windows]) {
    const kind = o.category === 'door' ? 'door' : 'window'
    const key = `${kind}|${o.mark}|${Math.round(o.width)}|${Math.round(o.height)}|${Math.round(o.sill)}`
    const lv = levelOf(m, host(o.hostWall)?.baseLevel ?? '')?.name ?? ''
    const e = map.get(key) ?? { mark: o.mark, kind, family: o.family, width: Math.round(o.width), height: Math.round(o.height), sill: Math.round(o.sill), levels: [], count: 0 }
    e.count++
    if (lv && !e.levels.includes(lv)) e.levels.push(lv)
    map.set(key, e)
  }
  return [...map.values()].map((e) => ({ ...e, levels: e.levels.sort((a, b) => lvOrder(a) - lvOrder(b)) })).sort((a, b) => (a.kind === b.kind ? a.mark.localeCompare(b.mark, undefined, { numeric: true }) : a.kind === 'door' ? -1 : 1))
}
