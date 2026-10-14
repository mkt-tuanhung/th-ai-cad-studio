/**
 * Bill of quantities of the BIM model, by code from the elements' own geometry (the one-command package and
 * its report). Per level and in total:
 *  - foundations (from the structural drawings): pile caps, tie beams — m³; piles — number;
 *  - reinforced concrete: floor slabs net of their openings, the roof, landings, columns, beams under the slab
 *    (b × (h − slab) × clear span between the columns), stair flights (step profile with its waist × width) — m³;
 *  - formwork: slab soffits (the lowest floor lies on the ground: edges only) and edges, beam sides and bottoms,
 *    tie beam sides, column faces, pile cap sides, stair soffits and risers — m²;
 *  - reinforcement: an ESTIMATE, concrete volume × a usual steel ratio per kind of element (REBAR, kg/m³), said
 *    so on every line — the bar schedules of the structural design replace it;
 *  - masonry by wall thickness: wall area net of doors and windows, and its volume (columns inside walls are not
 *    deducted) — m², m³; curtain walls apart (glazing, m²);
 *  - plaster and paint: inside and outside faces (a wall on the outline of its level's floor slab has one face
 *    out, a balcony parapet two, other walls two faces in) — m²;
 *  - floor finishes: room areas (double-height voids left out) — m²;
 *  - doors and windows: number and area; railings: length (along their slope) — m.
 * Every line has a stable `key` (a price list matches on it, src/auto/package.ts).
 */
import { levelOf, typeOf, wallHeight, type BimModel, type P2 } from './model'
import { polyArea, segDist, wallEnds } from './geometry'
import { stairFlight, stairProfile } from './scene'
import { roofQuantities } from './roof'

/** Usual steel ratios (kg of bars per m³ of concrete) for the estimate. */
export const REBAR = { footing: 80, tie: 120, column: 150, beam: 160, slab: 90, stair: 100 } as const
export type RebarKind = keyof typeof REBAR

export interface BoqWords {
  groups: { foundation: string; concrete: string; formwork: string; rebar: string; masonry: string; roof: string; finishes: string; openings: string; railings: string }
  items: {
    slab: string; roof: string; landing: string; column: string; stair: string; beam: string
    footing: string; tie: string; piles: string // "{s}" pile section
    wall: string // "{t}" thickness
    wallVol: string // "{t}"
    glazing: string
    plasterIn: string; plasterOut: string; paintIn: string; paintOut: string; floor: string
    doors: string; doorsArea: string; windows: string; windowsArea: string
    railing: string
    roofCover: string; roofRidge: string; roofHips: string; roofGable: string
    fwSlab: string; fwBeam: string; fwTie: string; fwColumn: string; fwFooting: string; fwStair: string
    rebar: string // "{what}", "{k}" kg/m³
    rebarOf: Record<RebarKind, string>
  }
  units: { m3: string; m2: string; m: string; pcs: string; kg: string }
  all: string
}

export interface BoqRow {
  key: string
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

const perim = (o: P2[]) => o.reduce((a, p, i) => a + Math.hypot(o[(i + 1) % o.length][0] - p[0], o[(i + 1) % o.length][1] - p[1]), 0)

export function boq(m: BimModel, w: BoqWords): BoqRow[] {
  const levels = [...m.levels].sort((a, b) => a.elevation - b.elevation)
  const rows = new Map<string, BoqRow>()
  const add = (key: string, group: string, item: string, unit: string, level: string, q: number) => {
    if (!(q > 0)) return
    const r = rows.get(key) ?? { key, group, item, unit, byLevel: {}, total: 0 }
    r.byLevel[level] = (r.byLevel[level] ?? 0) + q
    r.total += q
    rows.set(key, r)
  }
  const G = w.groups, I = w.items, U = w.units
  const lvName = (id: string) => levelOf(m, id)?.name ?? id
  const lowest = levels[0]?.id
  // concrete volumes by kind of element, for the steel estimate
  const conc = (kind: RebarKind, level: string, v: number) => { add(`rebar:${kind}`, G.rebar, fill(I.rebar, { what: I.rebarOf[kind], k: REBAR[kind] }), U.kg, level, v * REBAR[kind]) }
  const slabT = (lv: string) => m.slabs.find((s) => s.level === lv && s.kind === 'floor' && !s.landing)?.thickness ?? 0
  // foundations
  for (const f of m.footings ?? []) {
    const lv = lvName(f.level), H = f.top - f.bottom
    const v = (f.w * f.d * H) / 1e9
    add('footing', G.foundation, I.footing, U.m3, lv, v)
    conc('footing', lv, v)
    add('fw:footing', G.formwork, I.fwFooting, U.m2, lv, (2 * (f.w + f.d) * H) / 1e6)
    if (f.piles) add(`piles:${f.pileSize ?? 0}`, G.foundation, fill(I.piles, { s: f.pileSize ? `${f.pileSize}×${f.pileSize}` : '' }), U.pcs, lv, f.piles)
  }
  // beams: the clear span between the columns they frame into; floor beams under their slab only
  for (const b of m.beams ?? []) {
    const lv = lvName(b.level)
    const t = (b.angle * Math.PI) / 180, u: P2 = [Math.cos(t), Math.sin(t)]
    const ends: P2[] = [[b.x, b.y], [b.x + u[0] * b.length, b.y + u[1] * b.length]]
    const cut = ends.reduce((a, e) => {
      const c = m.columns.find((k) => Math.abs(k.x - e[0]) <= k.w / 2 + 30 && Math.abs(k.y - e[1]) <= k.d / 2 + 30)
      return a + (c ? (Math.abs(u[0]) * c.w + Math.abs(u[1]) * c.d) / 2 : 0)
    }, 0)
    const L = Math.max(0, b.length - cut)
    if (b.tie) {
      const v = (b.b * b.h * L) / 1e9
      add('tie', G.foundation, I.tie, U.m3, lv, v)
      conc('tie', lv, v)
      add('fw:tie', G.formwork, I.fwTie, U.m2, lv, (2 * b.h * L) / 1e6)
    } else {
      const d = Math.max(0, b.h - slabT(b.level))
      const v = (b.b * d * L) / 1e9
      add('beam', G.concrete, I.beam, U.m3, lv, v)
      conc('beam', lv, v)
      add('fw:beam', G.formwork, I.fwBeam, U.m2, lv, ((2 * d + b.b) * L) / 1e6)
    }
  }
  for (const s of m.slabs) {
    if (s.kind === 'ceiling' || s.outline.length < 3) continue
    const holes = s.openings ?? []
    const A = (polyArea(s.outline) - holes.reduce((a, o) => a + polyArea(o), 0)) / 1e6
    const lv = lvName(s.level)
    const v = (A * s.thickness) / 1000
    add(s.landing ? 'landing' : s.kind === 'roof' ? 'roof' : 'slab', G.concrete, s.landing ? I.landing : s.kind === 'roof' ? I.roof : I.slab, U.m3, lv, v)
    conc(s.landing ? 'stair' : 'slab', lv, v)
    const edges = ((perim(s.outline) + holes.reduce((a, o) => a + perim(o), 0)) * s.thickness) / 1e6
    add('fw:slab', G.formwork, I.fwSlab, U.m2, lv, (s.level === lowest && s.kind === 'floor' && !s.landing ? 0 : A) + edges)
  }
  for (const c of m.columns) {
    const h = wallHeight(m, { baseLevel: c.level, topLevel: c.topLevel, baseOffset: 0, topOffset: 0 } as BimModel['walls'][number])
    const A = c.round ? (Math.PI * c.w * c.w) / 4 : c.w * c.d
    const lv = lvName(c.level), v = (A * h) / 1e9
    add('column', G.concrete, I.column, U.m3, lv, v)
    conc('column', lv, v)
    add('fw:column', G.formwork, I.fwColumn, U.m2, lv, ((c.round ? Math.PI * c.w : 2 * (c.w + c.d)) * h) / 1e6)
  }
  for (const st of m.stairs) {
    const { n, riser } = stairFlight(m, st)
    const lv = lvName(st.baseLevel)
    if (st.spiral) {
      // treads 60 mm and the newel post
      const s = st.spiral, ring = (Math.abs(s.sweep) / 360) * Math.PI * (s.r1 * s.r1 - s.r0 * s.r0)
      const v = (ring * 60 + Math.PI * Math.max(60, s.r0) ** 2 * n * riser) / 1e9
      add('stair', G.concrete, I.stair, U.m3, lv, v)
      conc('stair', lv, v)
      continue
    }
    const v = (polyArea(stairProfile(st, n, riser)) * st.width) / 1e9
    add('stair', G.concrete, I.stair, U.m3, lv, v)
    conc('stair', lv, v)
    add('fw:stair', G.formwork, I.fwStair, U.m2, lv, ((Math.hypot(st.length, n * riser) + n * riser) * st.width) / 1e6)
  }
  for (const r of m.roofs ?? []) {
    const q = roofQuantities(r), lv = lvName(r.level)
    add('roofCover', G.roof, I.roofCover, U.m2, lv, q.area)
    add('roofRidge', G.roof, I.roofRidge, U.m, lv, q.ridge)
    if (q.hips) add('roofHips', G.roof, I.roofHips, U.m, lv, q.hips)
    if (q.gableWalls) add('roofGable', G.roof, I.roofGable, U.m2, lv, q.gableWalls)
  }
  // walls
  for (const x of m.walls) {
    const t = typeOf(m, x)
    const H = wallHeight(m, x)
    if (H <= 0) continue
    const ops = [...m.doors, ...m.windows].filter((o) => o.hostWall === x.id).reduce((a, o) => a + o.width * Math.min(o.height, H), 0)
    const net = Math.max(0, x.length * H - ops) / 1e6
    const lv = lvName(x.baseLevel)
    if (t?.family === 'Curtain Wall') { add('glazing', G.openings, I.glazing, U.m2, lv, (x.length * H) / 1e6); continue }
    const th = t?.thickness ?? 200
    add(`wall:${th}`, G.masonry, fill(I.wall, { t: th }), U.m2, lv, net)
    add(`wallVol:${th}`, G.masonry, fill(I.wallVol, { t: th }), U.m3, lv, (net * th) / 1000)
    const out = exterior(m, x) ? (x.topLevel === x.baseLevel ? 2 : 1) : 0
    add('plasterIn', G.finishes, I.plasterIn, U.m2, lv, net * (2 - out))
    add('plasterOut', G.finishes, I.plasterOut, U.m2, lv, net * out)
    add('paintIn', G.finishes, I.paintIn, U.m2, lv, net * (2 - out))
    add('paintOut', G.finishes, I.paintOut, U.m2, lv, net * out)
  }
  for (const r of m.rooms) if (!r.void) add('floor', G.finishes, I.floor, U.m2, lvName(r.level), r.area)
  // openings
  const host = (id: string) => m.walls.find((x) => x.id === id)
  for (const o of m.doors) { const lv = lvName(host(o.hostWall)?.baseLevel ?? ''); add('doors', G.openings, I.doors, U.pcs, lv, 1); add('doorsArea', G.openings, I.doorsArea, U.m2, lv, (o.width * o.height) / 1e6) }
  for (const o of m.windows) { const lv = lvName(host(o.hostWall)?.baseLevel ?? ''); add('windows', G.openings, I.windows, U.pcs, lv, 1); add('windowsArea', G.openings, I.windowsArea, U.m2, lv, (o.width * o.height) / 1e6) }
  for (const r of m.railings) {
    let L = 0
    for (let i = 0; i + 1 < r.pts.length; i++) L += Math.hypot(r.pts[i + 1][0] - r.pts[i][0], r.pts[i + 1][1] - r.pts[i][1], (r.z?.[i + 1] ?? 0) - (r.z?.[i] ?? 0))
    add('railing', G.railings, I.railing, U.m, lvName(r.level), L / 1000)
  }
  // in the order of the groups, then as found
  const order = [G.foundation, G.concrete, G.formwork, G.rebar, G.masonry, G.roof, G.finishes, G.openings, G.railings]
  return [...rows.values()].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group)).map((r) => ({ ...r, byLevel: Object.fromEntries(levels.map((l) => [l.name, r.byLevel[l.name] ?? 0]).filter(([, v]) => (v as number) > 0)) }))
}

/** A price list read from a CSV: per BOQ key (or item text) the unit price. Columns found by their header
 *  (key / mã, item / hạng mục, price / đơn giá); numbers with "." or "," thousands are read. */
export function readPrices(text: string): Map<string, number> {
  const rows = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => {
    const out: string[] = []
    let cur = '', q = false
    for (const ch of l) {
      if (ch === '"') q = !q
      else if ((ch === ',' || ch === ';') && !q) { out.push(cur); cur = '' }
      else cur += ch
    }
    out.push(cur)
    return out.map((c) => c.trim())
  })
  const head = (rows[0] ?? []).map((h) => h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd'))
  const kc = head.findIndex((h) => /^(key|ma)$/.test(h)), ic = head.findIndex((h) => /(item|hang muc)/.test(h)), pc = head.findIndex((h) => /(price|don gia)/.test(h))
  const out = new Map<string, number>()
  if (pc < 0) return out
  for (const r of rows.slice(1)) {
    const raw = (r[pc] ?? '').replace(/\s/g, '')
    if (!raw) continue
    // "1.250.000" / "1,250,000" thousands; "1250000.5" decimals
    const v = /^\d{1,3}([.,]\d{3})+$/.test(raw) ? Number(raw.replace(/[.,]/g, '')) : Number(raw.replace(',', '.'))
    if (!Number.isFinite(v)) continue
    if (kc >= 0 && r[kc]) out.set(r[kc], v)
    if (ic >= 0 && r[ic]) out.set(`item:${r[ic].toLowerCase()}`, v)
  }
  return out
}

export const priceOf = (prices: Map<string, number>, r: BoqRow) => prices.get(r.key) ?? prices.get(`item:${r.item.toLowerCase()}`)

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
