/**
 * BIM model (and Interior design data) from the recognised plans (src/bim/fromCad.ts).
 *
 * Deterministic: levels from the plans' elevations, walls / openings / rooms / columns / slabs / grids /
 * furniture from the recognised geometry. Quantities are left to the model's own formulas (wall area and volume
 * from length × height × thickness, room area from its outline). The plans are aligned on a grid intersection
 * they share (or on the corner of their walls) so storeys stack. The result replaces nothing by itself: the
 * caller commits it as ONE undoable edit after the user approved the preview.
 */
import type { BimModel, Column, Component, GridLine, Level, Opening, Room, Slab, Stair, Wall, WallType } from './model'
import type { Cabinet, Item, ItemCategory, Room as InteriorRoom } from '../interior/model'
import { MATERIALS } from '../interior/model'
import { interiorPoint, wallLine, type FurnKind, type RecFurniture, type Recognition } from './fromCad'
import type { P2 } from './model'
import { wallEnds } from './geometry'

export interface PlanPick {
  rec: Recognition
  levelName: string
  elevation: number
  /** Roof plan: its walls are parapets (parapetH high) and its footprint is the roof deck. */
  roof: boolean
}

export interface BuildOptions {
  /** Storey height used above the highest plan (mm). */
  storeyH: number
  slabT: number
  parapetH: number
  /** Roof slab over the highest plan when no roof plan is picked. */
  roofSlab: boolean
  furniture: boolean
}
export const DEFAULT_BUILD: BuildOptions = { storeyH: 3300, slabT: 120, parapetH: 900, roofSlab: true, furniture: true }

/** Localised names written into the model (data, in the user's language). */
export interface BuildNames {
  roofLevel: string
  room: (n: number) => string
  wallExt: (t: number) => string
  wallInt: (t: number) => string
  curtain: (t: number) => string
  door: string
  doubleDoor: string
  opening: string
  window: string
  furniture: Record<FurnKind, string>
}

/** Default heights of furniture blocks (mm) — a plan has none. */
export const FURN_H: Record<FurnKind, number> = {
  sofa: 800, bed: 500, wardrobe: 2400, tvCabinet: 500, island: 900, kitchen: 850, fridge: 1800, dining: 750, desk: 750,
  nightstand: 550, coffeeTable: 420, chair: 850, table: 750, altar: 1270, shoeCabinet: 1000, shelf: 1800, cabinet: 900,
  wc: 750, basin: 850, shower: 2100, bathtub: 550, washer: 850, plant: 1200, bench: 450, rug: 15, light: 300, other: 800,
}

export interface Alignment {
  method: 'grid' | 'extent'
  /** Grid labels of the shared intersection (method 'grid'). */
  grid: [string, string] | null
  /** Per plan: the drawing point that becomes the model origin. */
  origins: P2[]
}

/** Grid positions of a plan: label → x of the north–south grids, label → y of the east–west ones. */
function gridAxes(rec: Recognition) {
  const v = new Map<string, number>(), h = new Map<string, number>()
  for (const g of rec.grids) {
    const dx = Math.abs(g.b[0] - g.a[0]), dy = Math.abs(g.b[1] - g.a[1])
    if (dx < 0.02 * dy) v.set(g.label, (g.a[0] + g.b[0]) / 2)
    else if (dy < 0.02 * dx) h.set(g.label, (g.a[1] + g.b[1]) / 2)
  }
  return { v, h }
}

/** Origins that stack the plans: a grid intersection all of them carry, else the lower-left corner of their walls. */
export function alignPlans(recs: Recognition[]): Alignment {
  const axes = recs.map(gridAxes)
  const common = (k: 'v' | 'h') => [...(axes[0]?.[k].keys() ?? [])].filter((l) => axes.every((a) => a[k].has(l))).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  const gv = common('v')[0], gh = common('h')[0]
  if (recs.length && gv !== undefined && gh !== undefined) return { method: 'grid', grid: [gv, gh], origins: axes.map((a) => [a.v.get(gv)!, a.h.get(gh)!]) }
  return {
    method: 'extent',
    grid: null,
    origins: recs.map((r) => {
      const pts = r.walls.flatMap((w) => { const l = wallLine(w); return [l.a, l.b] })
      return pts.length ? [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))] : [r.region.box.x0, r.region.box.y0]
    }),
  }
}

const r1 = (v: number) => Math.round(v * 10) / 10

export interface BuildResult {
  model: BimModel
  align: Alignment
  counts: { levels: number; walls: number; doors: number; windows: number; rooms: number; columns: number; slabs: number; components: number; grids: number; stairs: number }
}

export function buildBimModel(picks: PlanPick[], opt: BuildOptions, names: BuildNames): BuildResult {
  const sorted = [...picks].sort((a, b) => a.elevation - b.elevation)
  const align = alignPlans(sorted.map((p) => p.rec))
  const levels: Level[] = sorted.map((p, i) => ({ id: `L${i + 1}`, name: p.levelName, elevation: Math.round(p.elevation) }))
  const top = sorted[sorted.length - 1]
  if (top && !top.roof) levels.push({ id: `L${levels.length + 1}`, name: names.roofLevel, elevation: Math.round(top.elevation + opt.storeyH) })

  const types = new Map<string, WallType>()
  const typeFor = (t: number, ext: boolean, curtain: boolean) => {
    const id = `${curtain ? 'CW' : ext ? 'E' : 'I'}${t}`
    if (!types.has(id))
      types.set(id, curtain
        ? { id, family: 'Curtain Wall', name: names.curtain(t), thickness: t, structure: 'Aluminium mullions + glazing', finishExt: 'Anodised aluminium', finishInt: 'Anodised aluminium', description: 'From CAD plan (glazing)' }
        : { id, family: 'Basic Wall', name: ext ? names.wallExt(t) : names.wallInt(t), thickness: t, structure: 'Masonry - Brick', finishExt: ext ? 'Paint - Light Gray' : 'Paint - White', finishInt: 'Paint - White', description: 'From CAD plan' })
    return id
  }

  const walls: Wall[] = [], doors: Opening[] = [], windows: Opening[] = [], rooms: Room[] = [], columns: Column[] = []
  const slabs: Slab[] = [], components: Component[] = [], grids: GridLine[] = []
  let nd = 0, nw = 0, nf = 0
  const usedMarks = new Set<string>()
  const markOr = (m: string | null, prefix: string, n: number) => {
    // tags may repeat (a door type used several times): keep the tag, make the id unique
    if (m) { usedMarks.add(m); return m }
    let k = n, mk = `${prefix}${k}`
    while (usedMarks.has(mk)) mk = `${prefix}${++k}`
    usedMarks.add(mk)
    return mk
  }

  sorted.forEach((p, li) => {
    const lv = levels[li]
    const above = levels[li + 1]
    const [ox, oy] = align.origins[li]
    const T = (q: P2): P2 => [r1(q[0] - ox), r1(q[1] - oy)]
    const storey = above ? above.elevation - lv.elevation : opt.parapetH
    const wallIds: string[] = []
    p.rec.walls.forEach((w) => {
      const id = `W${walls.length + 1}`
      wallIds.push(id)
      const { a } = wallLine(w)
      const [x, y] = T(a)
      const roofWall = p.roof || !above
      walls.push({
        id, category: 'wall', mark: id, typeId: typeFor(w.t, w.ext, !!w.curtain),
        baseLevel: lv.id, baseOffset: 0, topLevel: roofWall ? lv.id : above.id, topOffset: roofWall ? opt.parapetH : 0,
        length: r1(w.s1 - w.s0), x, y, angle: Math.round((Math.atan2(w.uy, w.ux) * 180) / Math.PI * 1000) / 1000,
      })
    })
    for (const o of p.rec.openings) {
      const w = p.rec.walls[o.wall]
      if (!w || w.curtain) continue
      const host = walls.find((x) => x.id === wallIds[o.wall])!
      const hostH = p.roof || !above ? opt.parapetH : storey
      const width = r1(o.s1 - o.s0)
      const offset = r1(o.s0 - w.s0)
      if (o.kind === 'window') {
        const sill = Math.min(o.sill, Math.max(0, hostH - 300))
        const height = Math.max(200, Math.min(o.height, hostH - sill - 100))
        nw++
        windows.push({ id: `window-${nw}`, category: 'window', mark: markOr(o.mark, 'WN', nw), family: 'Fixed', type: `${Math.round(width)} x ${Math.round(height)}mm`, hostWall: host.id, offset, width, height, sill })
      } else {
        const height = Math.max(200, Math.min(o.height, hostH - 100))
        nd++
        const family = o.kind === 'opening' ? names.opening : width > 1200 ? names.doubleDoor : names.door
        doors.push({ id: `door-${nd}`, category: 'door', mark: markOr(o.mark, o.kind === 'opening' ? 'LM' : 'D', nd), family, type: `${Math.round(width)} x ${Math.round(height)}mm`, hostWall: host.id, offset, width, height, sill: 0 })
      }
    }
    p.rec.rooms.forEach((r, k) => {
      const num = r.number ?? `${li + 1}${String(k + 1).padStart(2, '0')}`
      rooms.push({ id: `room-${lv.id}-${k + 1}`, category: 'room', number: num, name: r.name ?? names.room(k + 1), level: lv.id, area: r.area, outline: r.outline.map(T) })
    })
    if (!p.roof && above)
      for (const c of p.rec.columns) {
        const [x, y] = T([c.x, c.y])
        columns.push({ id: `C${columns.length + 1}`, category: 'column', mark: `C${columns.length + 1}`, level: lv.id, topLevel: above.id, x, y, w: Math.round(c.w), d: Math.round(c.d), ...(c.round ? { round: true } : {}) })
      }
    if (p.rec.footprint) slabs.push({ id: `S${slabs.length + 1}`, category: 'slab', mark: `S${slabs.length + 1}`, kind: 'floor', level: lv.id, offset: 0, thickness: opt.slabT, outline: p.rec.footprint.map(T) })
    if (!grids.length)
      for (const g of p.rec.grids) grids.push({ id: `grid-${grids.length + 1}`, category: 'grid', label: g.label, a: T(g.a), b: T(g.b) })
    if (opt.furniture)
      for (const f of p.rec.furniture) {
        nf++
        const [x, y] = T([f.x, f.y])
        components.push({ id: `F${nf}`, category: 'component', mark: `F${nf}`, name: names.furniture[f.kind], level: lv.id, x, y, w: f.w, d: f.d, h: FURN_H[f.kind], rot: f.rot })
      }
  })
  // roof slab over the highest plan when there is no roof plan
  if (top && !top.roof && opt.roofSlab && top.rec.footprint) {
    const [ox, oy] = align.origins[sorted.length - 1]
    slabs.push({ id: `S${slabs.length + 1}`, category: 'slab', mark: `S${slabs.length + 1}`, kind: 'roof', level: levels[levels.length - 1].id, offset: 0, thickness: opt.slabT, outline: top.rec.footprint.map((q) => [r1(q[0] - ox), r1(q[1] - oy)] as P2) })
  }
  const { stairs, landings } = stairsFrom(sorted, align.origins, levels, walls, types, slabs)
  slabs.push(...landings)
  const model: BimModel = { levels, wallTypes: [...types.values()], walls, doors, windows, rooms, columns, slabs, stairs, railings: [], components, grids, annotations: [] }
  return { model, align, counts: { levels: levels.length, walls: walls.length, doors: doors.length, windows: windows.length, rooms: rooms.length, columns: columns.length, slabs: slabs.length, components: components.length, grids: grids.length, stairs: stairs.length } }
}

/* ---------------- stairs ---------------- */

/** One flight seen on one or more plans, in model coordinates: run axis `n`, across axis `d`, extents along both. */
interface FlightCluster {
  n: P2
  d: P2
  s0: number
  s1: number
  t0: number
  t1: number
  going: number
  /** up along +n (1) or −n (−1); 0 unknown */
  up: 1 | -1 | 0
  /** plan indices (sorted) the flight is drawn on */
  seen: Set<number>
  lines: number
}

const dot = (a: P2, b: P2) => a[0] * b[0] + a[1] * b[1]

/**
 * Stairs from the flights recognised on the plans. A flight is drawn on each plan it is seen from (the lower
 * plan shows it cut by a break line, the upper one in full), so the flights of all plans are put together by
 * their footprint first. A storey gets a stair when the flights are drawn on both its plan and the plan above.
 * Two flights side by side going opposite ways are a U stair: flight 1 (the one drawn on the lower plan),
 * a landing at its top as deep as the space up to the wall beyond, flight 2 back to the upper floor. Riser
 * height = storey height / the risers drawn (both flights), when that is a normal riser (140…200 mm); else the
 * storey is divided in risers ≤ 175 mm. The upper floor slab gets the stair well cut out.
 */
export function stairsFrom(sorted: PlanPick[], origins: P2[], levels: Level[], walls: Wall[], types: Map<string, WallType>, slabs: Slab[]): { stairs: Stair[]; landings: Slab[] } {
  const cl: FlightCluster[] = []
  sorted.forEach((p, li) => {
    const [ox, oy] = origins[li]
    for (const f of p.rec.flights ?? []) {
      // the run axis pointing to +x (or +y when the run is along y)
      const sg = Math.abs(f.dir[0]) > Math.abs(f.dir[1]) ? Math.sign(f.dir[0]) : Math.sign(f.dir[1])
      const n: P2 = [f.dir[0] * sg, f.dir[1] * sg], d: P2 = [n[1], -n[0]]
      const a: P2 = [f.a[0] - ox, f.a[1] - oy]
      const ta = dot(a, n), sa = dot(a, d)
      const t0 = sg > 0 ? ta : ta - f.run, t1 = t0 + f.run
      const s0 = sa - f.width / 2, s1 = sa + f.width / 2
      const up = (f.up * sg) as 1 | -1 | 0
      const c = cl.find((x) => Math.abs(dot(x.n, n)) > 0.999 && Math.min(x.s1, s1) - Math.max(x.s0, s0) > 0.8 * Math.min(x.s1 - x.s0, f.width) && Math.min(x.t1, t1) - Math.max(x.t0, t0) > -300)
      if (!c) { cl.push({ n, d, s0, s1, t0, t1, going: f.going, up, seen: new Set([li]), lines: f.lines }); continue }
      c.t0 = Math.min(c.t0, t0)
      c.t1 = Math.max(c.t1, t1)
      if (f.lines > c.lines) { c.s0 = s0; c.s1 = s1; c.going = f.going; c.lines = f.lines }
      if (!c.up) c.up = up
      c.seen.add(li)
    }
  })
  const linesOf = (c: FlightCluster) => Math.round((c.t1 - c.t0) / c.going) + 1
  // U pairs: side by side (a well under 400 mm), overlapping runs, not both known to go the same way
  const used = new Set<FlightCluster>()
  const systems: FlightCluster[][] = []
  for (const a of cl) {
    if (used.has(a)) continue
    const b = cl.find((x) => x !== a && !used.has(x) && Math.abs(dot(x.n, a.n)) > 0.999 && Math.min(Math.abs(x.s0 - a.s1), Math.abs(a.s0 - x.s1)) < 400 && Math.min(x.t1, a.t1) - Math.max(x.t0, a.t0) > 0.5 * Math.min(x.t1 - x.t0, a.t1 - a.t0) && !(x.up && a.up && x.up === a.up))
    used.add(a)
    if (b) { used.add(b); systems.push([a, b]) } else systems.push([a])
  }
  const stairs: Stair[] = [], landings: Slab[] = []
  let no = 0
  const at = (c: FlightCluster, s: number, t: number): P2 => [r1(c.d[0] * s + c.n[0] * t), r1(c.d[1] * s + c.n[1] * t)]
  const rect = (c: FlightCluster, s0: number, s1: number, t0: number, t1: number): P2[] => [at(c, s0, t0), at(c, s1, t0), at(c, s1, t1), at(c, s0, t1)]
  const ang = (v: P2) => Math.round((Math.atan2(v[1], v[0]) * 180) / Math.PI * 1000) / 1000
  for (let li = 0; li + 1 < sorted.length; li++) {
    if (sorted[li].roof) continue
    const lv = levels[li], above = levels[li + 1]
    const H = above.elevation - lv.elevation
    if (H <= 0) continue
    for (const sys of systems) {
      if (!sys.some((c) => c.seen.has(li)) || !sys.some((c) => c.seen.has(li + 1))) continue
      // flight 1: the one drawn on the lowest plan (the start of the stair)
      const [c1, c2] = sys.length === 2 && Math.min(...sys[1].seen) < Math.min(...sys[0].seen) ? [sys[1], sys[0]] : [sys[0], sys[1]]
      const u1 = (c1.up || (c2 ? -c2.up : 0) || 1) as 1 | -1
      let k1 = linesOf(c1), k2 = c2 ? linesOf(c2) : 0
      let riser = H / (k1 + k2)
      if (riser < 140 || riser > 200) {
        const N = Math.ceil(H / 175), r1n = c1.t1 - c1.t0, r2n = c2 ? c2.t1 - c2.t0 : 0
        k1 = c2 ? Math.max(1, Math.round((N * r1n) / (r1n + r2n))) : N
        k2 = N - k1
        riser = H / N
      }
      no++
      const flight = (c: FlightCluster, u: 1 | -1, base: number, k: number, mark: string): Stair => {
        const tb = u > 0 ? c.t0 : c.t1
        const [x, y] = at(c, (c.s0 + c.s1) / 2, tb)
        return { id: `stair-${stairs.length + 1}`, category: 'stair', mark, baseLevel: lv.id, topLevel: above.id, x, y, angle: ang([c.n[0] * u, c.n[1] * u]), length: r1(c.t1 - c.t0), width: r1(c.s1 - c.s0), baseOffset: r1(base), rise: r1(k * riser), risers: k }
      }
      stairs.push(flight(c1, u1, 0, k1, `ST${no}`))
      let well = rect(c1, c1.s0, c1.s1, c1.t0, c1.t1)
      if (c2) {
        // landing at the top of flight 1 across both flights, up to the wall beyond (else as deep as a flight is wide)
        const te = u1 > 0 ? c1.t1 : c1.t0
        const S0 = Math.min(c1.s0, c2.s0), S1 = Math.max(c1.s1, c2.s1)
        let D = Infinity
        for (const w of walls) {
          if (w.baseLevel !== lv.id) continue
          const { a: wa, dir: wu } = wallEnds(w)
          if (Math.abs(dot(wu, c1.n)) > 0.05) continue
          const tw = dot(wa, c1.n)
          const ws0 = dot(wa, c1.d), ws1 = ws0 + w.length * dot(wu, c1.d)
          if (Math.min(Math.max(ws0, ws1), S1) - Math.max(Math.min(ws0, ws1), S0) < 0.5 * (S1 - S0)) continue
          const dist = (tw - te) * u1 - (types.get(w.typeId)?.thickness ?? 200) / 2
          if (dist >= 600 && dist <= 3000) D = Math.min(D, dist)
        }
        if (!Number.isFinite(D)) D = Math.max(1000, c1.s1 - c1.s0)
        const z = k1 * riser
        const out = rect(c1, S0, S1, te, te + u1 * D)
        landings.push({ id: `landing-${landings.length + 1}`, category: 'slab', mark: `LD${landings.length + 1}`, kind: 'floor', level: lv.id, offset: r1(z), thickness: 100, outline: out, landing: true })
        stairs.push(flight(c2, (-u1) as 1 | -1, z, k2, `ST${no}b`))
        well = rect(c1, S0, S1, Math.min(c1.t0, c2.t0, te + u1 * D), Math.max(c1.t1, c2.t1, te + u1 * D))
      }
      // the stair well through the floor above
      const up = slabs.find((s) => s.level === above.id && s.kind === 'floor' && !s.landing)
      if (up) up.openings = [...(up.openings ?? []), well]
    }
  }
  return { stairs, landings }
}

/** Two models side by side: the imported levels become extra levels (renamed if their elevation is taken). */
export function mergeModels(base: BimModel, add: BimModel): BimModel {
  const used = new Set(base.levels.map((l) => l.id))
  const lmap = new Map<string, string>()
  const levels = [...base.levels]
  for (const l of add.levels) {
    const same = base.levels.find((b) => Math.abs(b.elevation - l.elevation) < 1)
    if (same) { lmap.set(l.id, same.id); continue }
    let id = l.id, k = 1
    while (used.has(id)) id = `${l.id}-${++k}`
    used.add(id)
    lmap.set(l.id, id)
    levels.push({ ...l, id })
  }
  levels.sort((a, b) => a.elevation - b.elevation)
  const pre = `cad${Date.now().toString(36)}-`
  const L = (id: string) => lmap.get(id) ?? id
  const typeIds = new Set(base.wallTypes.map((t) => t.id))
  const wallTypes = [...base.wallTypes, ...add.wallTypes.filter((t) => !typeIds.has(t.id))]
  const W = (id: string) => pre + id
  return {
    ...base,
    levels,
    wallTypes,
    walls: [...base.walls, ...add.walls.map((w) => ({ ...w, id: W(w.id), baseLevel: L(w.baseLevel), topLevel: L(w.topLevel) }))],
    doors: [...base.doors, ...add.doors.map((o) => ({ ...o, id: pre + o.id, hostWall: W(o.hostWall) }))],
    windows: [...base.windows, ...add.windows.map((o) => ({ ...o, id: pre + o.id, hostWall: W(o.hostWall) }))],
    rooms: [...base.rooms, ...add.rooms.map((r) => ({ ...r, id: pre + r.id, level: L(r.level) }))],
    columns: [...base.columns, ...add.columns.map((c) => ({ ...c, id: pre + c.id, level: L(c.level), topLevel: L(c.topLevel) }))],
    slabs: [...base.slabs, ...add.slabs.map((s) => ({ ...s, id: pre + s.id, level: L(s.level) }))],
    components: [...base.components, ...add.components.map((c) => ({ ...c, id: pre + c.id, level: L(c.level) }))],
    grids: base.grids.length ? base.grids : add.grids,
  }
}

/* ================================================================ interior */

const CATEGORY: Partial<Record<FurnKind, ItemCategory>> = {
  sofa: 'sofas', bed: 'beds', wardrobe: 'cabinet', tvCabinet: 'cabinet', kitchen: 'cabinet', island: 'cabinet', shoeCabinet: 'cabinet',
  shelf: 'cabinet', cabinet: 'cabinet', altar: 'cabinet', dining: 'tables', desk: 'tables', coffeeTable: 'tables', table: 'tables',
  nightstand: 'tables', chair: 'chairs', bench: 'chairs', plant: 'decor', rug: 'rugs', light: 'lighting',
}
const MATERIAL: Record<ItemCategory, string> = {
  sofas: 'Fabric - Beige', beds: 'Fabric - Linen', tables: 'Wood - Oak', chairs: 'Fabric - Taupe', cabinet: 'Wood - Walnut', decor: 'Wood - Ash Light', rugs: 'Fabric - Linen', lighting: 'Metal - Brass',
}
/** Parametric cabinets the cut list / nesting / CNC can produce: shelves and door width per kind. */
export const CABINET_SPEC: Partial<Record<FurnKind, { shelves: number; doorW: number }>> = {
  wardrobe: { shelves: 4, doorW: 500 }, tvCabinet: { shelves: 1, doorW: 800 }, kitchen: { shelves: 1, doorW: 600 }, island: { shelves: 1, doorW: 600 },
  shoeCabinet: { shelves: 4, doorW: 450 }, shelf: { shelves: 4, doorW: 0 }, cabinet: { shelves: 2, doorW: 500 }, altar: { shelves: 1, doorW: 600 },
}

export interface InteriorBuild {
  rooms: InteriorRoom[]
  items: Item[]
  cabinets: Cabinet[]
  /** Furniture left out of the cut list (size outside what a carcass cabinet can be) and blocks not furniture. */
  notCabinet: number
  skipped: number
}

const inside = (p: P2, poly: P2[]) => {
  let r = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) r = !r
  }
  return r
}

/**
 * Interior design data of one plan (same origin as its BIM level): rooms with ceiling height = storey − slab,
 * furniture grouped per room and size (placements kept), cabinets as parametric carcasses for the cut list.
 */
export function buildInterior(model: BimModel, levelId: string, furniture: RecFurniture[], origin: P2, names: BuildNames): InteriorBuild {
  const lv = model.levels.find((l) => l.id === levelId)
  const above = [...model.levels].sort((a, b) => a.elevation - b.elevation).find((l) => lv && l.elevation > lv.elevation)
  const slab = model.slabs.find((s) => s.level === above?.id)?.thickness ?? 120
  const ceiling = Math.max(2200, Math.min(6000, (above && lv ? above.elevation - lv.elevation : 3000) - slab))
  const rooms: InteriorRoom[] = model.rooms
    .filter((r) => r.level === levelId && r.outline && r.outline.length >= 3)
    .map((r) => ({ id: r.id, name: r.name, outline: r.outline!.map(([x, y]) => ({ x, y })), ceilingHeight: ceiling, floorFinish: 'Porcelain Tile - Beige', wallFinish: 'Paint - Warm White', ceilingFinish: 'Gypsum - White' }))
  const roomOf = (p: P2): string | null => {
    const r = rooms.find((x) => inside(p, x.outline.map((q) => [q.x, q.y] as P2)))
    if (r) return r.id
    let best: string | null = null, bd = 2000
    for (const x of rooms) {
      const ip = interiorPoint(x.outline.map((q) => [q.x, q.y] as P2))
      const d = Math.hypot(ip[0] - p[0], ip[1] - p[1])
      if (d < bd) { bd = d; best = x.id }
    }
    return best
  }
  const groups = new Map<string, Item>()
  const cabinets: Cabinet[] = []
  let notCabinet = 0, skipped = 0
  const mats = new Set(MATERIALS.map((m) => m.name))
  for (const f of furniture) {
    const cat = CATEGORY[f.kind]
    if (!cat) { skipped++; continue }
    const spec = CABINET_SPEC[f.kind]
    // a cabinet's length runs along its local x (its back against the wall)
    const swap = !!spec && f.d > f.w
    const at = { x: r1(f.x - origin[0]), y: r1(f.y - origin[1]), rot: swap ? f.rot + 90 : f.rot }
    const room = roomOf([at.x, at.y])
    if (!room) { skipped++; continue }
    // the cut list counts each cabinet definition once, so every cabinet instance is its own item
    const key = spec ? `cab|${groups.size}` : `${f.kind}|${f.w}|${f.d}|${room}`
    const g = groups.get(key)
    if (g) { g.qty++; g.at!.push(at); continue }
    const material = mats.has(MATERIAL[cat]) ? MATERIAL[cat] : MATERIALS[0].name
    const item: Item = { id: `cad-i${groups.size + 1}`, name: names.furniture[f.kind], category: cat, room, w: f.w, d: f.d, h: FURN_H[f.kind], material, qty: 1, status: 'placed', at: [at] }
    if (spec) {
      const w = Math.max(f.w, f.d), d = Math.min(f.w, f.d), h = FURN_H[f.kind]
      const doors = spec.doorW ? Math.max(1, Math.min(12, Math.round(w / spec.doorW))) : 0
      const ok = w >= 300 && w <= 6000 && d >= 250 && d <= 900 && h >= 300 && h <= 2800 && (!doors || w / doors >= 250)
      if (ok) {
        const id = `cad-c${cabinets.length + 1}`
        const board = cat === 'cabinet' && f.kind === 'kitchen' ? 'MFC 18 - Oak' : 'MFC 18 - Walnut'
        cabinets.push({ id, name: names.furniture[f.kind], room, w, d, h, t: 18, shelves: spec.shelves, doors, board, front: board })
        item.cabinet = id
        item.w = w
        item.d = d
      } else notCabinet++
    }
    groups.set(key, item)
  }
  return { rooms, items: [...groups.values()], cabinets, notCabinet, skipped }
}
