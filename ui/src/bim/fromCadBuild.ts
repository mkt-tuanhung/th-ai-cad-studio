/**
 * BIM model (and Interior design data) from the recognised plans (src/bim/fromCad.ts).
 *
 * Deterministic: levels from the plans' elevations, walls / openings / rooms / columns / slabs / grids /
 * furniture from the recognised geometry. Quantities are left to the model's own formulas (wall area and volume
 * from length × height × thickness, room area from its outline). The plans are aligned on a grid intersection
 * they share (or on the corner of their walls) so storeys stack. The result replaces nothing by itself: the
 * caller commits it as ONE undoable edit after the user approved the preview.
 */
import type { BimModel, Column, Component, GridLine, Level, Opening, Railing, Room, Slab, Stair, Wall, WallType } from './model'
import type { Cabinet, Item, ItemCategory, Room as InteriorRoom } from '../interior/model'
import { MATERIALS } from '../interior/model'
import { interiorPoint, norm, wallLine, type FurnKind, type RecFurniture, type Recognition } from './fromCad'
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
  /** name given to an unnamed room found to be a double-height void */
  voidRoom?: string
  /** … and to one found to be a balcony */
  balconyRoom?: string
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
  /** things built in a simplified way (winders as a landing…), "code:detail" */
  notes: string[]
  counts: { levels: number; walls: number; doors: number; windows: number; rooms: number; columns: number; slabs: number; components: number; grids: number; stairs: number; railings: number }
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
  const unnamed = new Set<string>()
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
      if (!r.name) unnamed.add(`room-${lv.id}-${k + 1}`)
      rooms.push({ id: `room-${lv.id}-${k + 1}`, category: 'room', number: num, name: r.name ?? names.room(k + 1), level: lv.id, area: r.area, outline: r.outline.map(T), ...(r.crossed ? { void: true } : {}) })
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
  const edges = balconiesAndVoids(levels, rooms, walls, types, slabs, opt.slabT, names.voidRoom ?? 'Void', unnamed, [...doors, ...windows], names.balconyRoom ?? 'Balcony')
  const { stairs, landings, railings: stairRails, notes } = stairsFrom(sorted, align.origins, levels, walls, types, slabs)
  for (const sl of [...edges.slabs, ...landings]) slabs.push({ ...sl, id: sl.landing ? sl.id : `S${slabs.length + 1}`, mark: sl.landing ? sl.mark : `S${slabs.length + 1}` })
  const railings = [...stairRails, ...edges.railings].map((r, i) => ({ ...r, id: `railing-${i + 1}`, mark: `RL${i + 1}` }))
  const model: BimModel = { levels, wallTypes: [...types.values()], walls, doors, windows, rooms, columns, slabs, stairs, railings, components, grids, annotations: [] }
  return { model, align, notes, counts: { levels: levels.length, walls: walls.length, doors: doors.length, windows: windows.length, rooms: rooms.length, columns: columns.length, slabs: slabs.length, components: components.length, grids: grids.length, stairs: stairs.length, railings: railings.length } }
}

/* ---------------- balconies, double-height voids ---------------- */

const BALCONY = /\b(BAN ?CONG|LO ?GIA|LOGGIA|BALCON(Y|IES)?|TERRACE|SAN ?THUONG|SAN ?PHOI)\b/
const VOID_IN = /\b(THONG ?TANG|DOUBLE ?HEIGHT|VOID)\b/
const VOID_ONLY = /^(O |KHOANG )?(THONG ?TANG|VOID|GIENG ?TROI|LO ?THONG ?TANG)$/
export const BALCONY_H = 1100, VOID_H = 1000

const centroid = (o: P2[]): P2 => [o.reduce((s, p) => s + p[0], 0) / o.length, o.reduce((s, p) => s + p[1], 0) / o.length]
const areaOf = (o: P2[]) => Math.abs(o.reduce((s, p, i) => s + p[0] * o[(i + 1) % o.length][1] - o[(i + 1) % o.length][0] * p[1], 0)) / 2

/**
 * Balconies and double-height voids, from the room names, as the plans draw them:
 *  - a balcony / loggia / terrace above the ground floor gets its own floor slab when it lies outside the
 *    building's footprint; a wall drawn on its outer edge (outside beyond it, no door or window in it) is its
 *    parapet, BALCONY_H high instead of a storey (a wall running on past the balcony, or with a door beside it,
 *    is split: only its stretch along the balcony becomes parapet); every other stretch of its edge with no wall gets a guard rail
 *    BALCONY_H high;
 *  - a void: a room named as one ("Ô THÔNG TẦNG", "GIẾNG TRỜI"), or the room on the floor above a room whose
 *    name says it is double height ("P. KHÁCH THÔNG TẦNG") — the floor slab is cut out under it and a guard rail
 *    VOID_H high runs on its open edges. The void room is flagged (no floor finish, no Interior room). A room the
 *    plan crosses corner to corner is a void too (flagged by the recognition, src/bim/fromCad.ts).
 *  - without a name: a room above the ground floor lying outside the floor slab of its level is a balcony.
 */
export function balconiesAndVoids(levels: Level[], rooms: Room[], walls: Wall[], types: Map<string, WallType>, slabs: Slab[], slabT: number, voidName: string, unnamed: Set<string>, openings: Opening[], balconyName = 'Balcony'): { slabs: Slab[]; railings: Railing[]; parapets: number } {
  const outSlabs: Slab[] = [], railings: Railing[] = []
  const lvIdx = (id: string) => levels.findIndex((l) => l.id === id)
  const floorOf = (lv: string) => slabs.find((s) => s.level === lv && s.kind === 'floor' && !s.landing)
  // stretches of an edge with no wall along it (wall centre line parallel, within half its thickness + 200 mm)
  const open = (lv: string, a: P2, b: P2): [number, number][] => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (L < 300) return []
    const u: P2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]
    const cov: [number, number][] = []
    for (const w of walls) {
      if (w.baseLevel !== lv) continue
      const { a: wa, dir } = wallEnds(w)
      if (Math.abs(dir[0] * u[0] + dir[1] * u[1]) < 0.98) continue
      const off = Math.abs(-(wa[0] - a[0]) * u[1] + (wa[1] - a[1]) * u[0])
      if (off > (types.get(w.typeId)?.thickness ?? 200) / 2 + 200) continue
      const p0 = (wa[0] - a[0]) * u[0] + (wa[1] - a[1]) * u[1], p1 = p0 + w.length * (dir[0] * u[0] + dir[1] * u[1])
      if (Math.max(p0, p1) <= 0 || Math.min(p0, p1) >= L) continue
      cov.push([Math.max(0, Math.min(p0, p1) - 50), Math.min(L, Math.max(p0, p1) + 50)])
    }
    cov.sort((x, y) => x[0] - y[0])
    const out: [number, number][] = []
    let s = 0
    for (const [c0, c1] of cov) { if (c0 > s) out.push([s, c0]); s = Math.max(s, c1) }
    if (s < L) out.push([s, L])
    return out.filter(([x, y]) => y - x >= 300)
  }
  // a guard rail round the open stretches of an outline, 50 mm in from its edge (the outline inset, corners where
  // the inset edges meet); stretches meeting at a corner join, round the start of the outline too
  const guard = (lv: string, o: P2[], height: number) => {
    const N = o.length
    const sgnA = o.reduce((a, p, i) => a + p[0] * o[(i + 1) % N][1] - o[(i + 1) % N][0] * p[1], 0) > 0 ? 1 : -1
    const U = o.map((a, i) => { const b = o[(i + 1) % N], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L] as P2 })
    const IN = U.map((u) => [-u[1] * sgnA, u[0] * sgnA] as P2)
    // inset vertex i: where the inset edges i−1 and i cross
    const V = o.map((p, i) => {
      const k = (i - 1 + N) % N, n1 = IN[k], n2 = IN[i], u1 = U[k], u2 = U[i]
      const det = u1[0] * u2[1] - u1[1] * u2[0]
      if (Math.abs(det) < 1e-6) return [p[0] + n2[0] * 50, p[1] + n2[1] * 50] as P2
      const a1: P2 = [p[0] + n1[0] * 50, p[1] + n1[1] * 50], a2: P2 = [p[0] + n2[0] * 50, p[1] + n2[1] * 50]
      const t = ((a2[0] - a1[0]) * u2[1] - (a2[1] - a1[1]) * u2[0]) / det
      return [a1[0] + u1[0] * t, a1[1] + u1[1] * t] as P2
    })
    const lines: P2[][] = []
    let cur: P2[] = []
    let startsAtZero = false, endsAtEnd = false
    for (let i = 0; i < N; i++) {
      const a = o[i], b = o[(i + 1) % N]
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (L < 1) continue
      const u = U[i], n = IN[i]
      const at = (s: number): P2 => (s < 1 ? V[i] : s > L - 1 ? V[(i + 1) % N] : [a[0] + u[0] * s + n[0] * 50, a[1] + u[1] * s + n[1] * 50])
      const st = open(lv, a, b)
      if (!st.length) { if (cur.length >= 2) lines.push(cur); cur = []; continue }
      st.forEach(([s0, s1]) => {
        if (!(s0 < 1 && cur.length)) { if (cur.length >= 2) lines.push(cur); cur = [at(s0)]; if (i === 0 && s0 < 1) startsAtZero = true }
        cur.push(at(s1))
        if (s1 < L - 1) { lines.push(cur); cur = [] }
        else if (i === N - 1) endsAtEnd = true
      })
    }
    if (cur.length >= 2) lines.push(cur)
    // the last stretch runs on into the first one round vertex 0
    if (startsAtZero && endsAtEnd && lines.length > 1) { const last = lines.pop()!; lines[0] = [...last, ...lines[0].slice(1)] }
    const r2 = (p: P2): P2 => [r1(p[0]), r1(p[1])]
    for (const l of lines) railings.push({ id: '', category: 'railing', mark: '', level: lv, pts: l.map(r2), height })
  }
  // parapets: walls along a balcony edge with no room beyond them
  let parapets = 0
  const inRoom = (lv: string, p: P2) => rooms.some((x) => x.level === lv && !BALCONY.test(norm(x.name)) && x.outline && x.outline.length >= 3 && inside(p, x.outline))
  // unnamed rooms: outside the floor slab of their level (above the ground floor) → balconies
  const isBalcony = new Set<Room>()
  for (const r of rooms) {
    if (!r.outline || r.outline.length < 3 || r.void) continue
    if (BALCONY.test(norm(r.name))) { isBalcony.add(r); continue }
    const fp = floorOf(r.level)
    if (lvIdx(r.level) > 0 && unnamed.has(r.id) && fp && !inside(centroid(r.outline), fp.outline)) { isBalcony.add(r); r.name = balconyName }
  }
  for (const r of rooms) {
    if (lvIdx(r.level) <= 0 || !r.outline || r.outline.length < 3 || !isBalcony.has(r)) continue
    const c = centroid(r.outline)
    for (let i = 0; i < r.outline.length; i++) {
      const a = r.outline[i], b = r.outline[(i + 1) % r.outline.length]
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (L < 300) continue
      const u: P2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]
      let n: P2 = [-u[1], u[0]]
      if ((c[0] - a[0]) * n[0] + (c[1] - a[1]) * n[1] > 0) n = [-n[0], -n[1]] // outwards
      for (const w of [...walls]) {
        if (w.baseLevel !== r.level || w.topLevel === w.baseLevel) continue
        const { a: wa, dir } = wallEnds(w)
        if (Math.abs(dir[0] * u[0] + dir[1] * u[1]) < 0.98) continue
        const t = types.get(w.typeId)?.thickness ?? 200
        if (Math.abs(-(wa[0] - a[0]) * u[1] + (wa[1] - a[1]) * u[0]) > t / 2 + 200) continue
        const p0 = (wa[0] - a[0]) * u[0] + (wa[1] - a[1]) * u[1], p1 = p0 + w.length * (dir[0] * u[0] + dir[1] * u[1])
        const lo = Math.max(0, Math.min(p0, p1)), hi = Math.min(L, Math.max(p0, p1))
        if (hi - lo < 0.5 * Math.min(L, w.length)) continue
        const m = (lo + hi) / 2, q: P2 = [a[0] + u[0] * m + n[0] * (t / 2 + 300), a[1] + u[1] * m + n[1] * (t / 2 + 300)]
        if (inRoom(r.level, q)) continue
        // the stretch along the balcony, in the wall's own length; openings in it keep the wall a storey high
        const along = (e: number) => (a[0] + u[0] * e - wa[0]) * dir[0] + (a[1] + u[1] * e - wa[1]) * dir[1]
        let s0 = Math.max(0, Math.min(along(lo), along(hi))), s1 = Math.min(w.length, Math.max(along(lo), along(hi)))
        if (s0 < 150) s0 = 0
        if (s1 > w.length - 150) s1 = w.length
        const ops = openings.filter((o) => o.hostWall === w.id)
        if (ops.some((o) => o.offset < s1 && o.offset + o.width > s0)) continue
        const w0 = { ...w }
        const piece = (from: number, to: number, parapet: boolean, id: string): Wall => ({ ...w0, id, mark: id, x: r1(wa[0] + dir[0] * from), y: r1(wa[1] + dir[1] * from), length: r1(to - from), ...(parapet ? { topLevel: w0.baseLevel, topOffset: BALCONY_H } : {}) })
        const parts: [number, number, boolean][] = [[0, s0, false], [s0, s1, true], [s1, w.length, false]].filter(([f, t]) => (t as number) - (f as number) > 1) as [number, number, boolean][]
        parts.forEach(([f, t, par], k) => {
          let id = w0.id
          if (k > 0) { let j = 1; while (walls.some((x) => x.id === `${w0.id}-${j}`)) j++; id = `${w0.id}-${j}` }
          const nw = piece(f, t, par, id)
          if (k === 0) Object.assign(w, nw)
          else walls.push(nw)
          // openings move to the piece they are in
          for (const o of ops) if (o.offset >= f - 1 && o.offset < t) { o.hostWall = id; o.offset = r1(o.offset - f) }
        })
        parapets++
      }
    }
  }
  for (const r of rooms) {
    const li = lvIdx(r.level)
    if (li <= 0 || !r.outline || r.outline.length < 3) continue
    if (isBalcony.has(r)) {
      const fp = floorOf(r.level)
      if (!fp || !inside(centroid(r.outline), fp.outline)) outSlabs.push({ id: '', category: 'slab', mark: '', kind: 'floor', level: r.level, offset: 0, thickness: slabT, outline: r.outline })
      guard(r.level, r.outline, BALCONY_H)
    }
  }
  const voids = new Set<Room>()
  for (const r of rooms) if (r.void && lvIdx(r.level) <= 0) r.void = undefined // a crossed room on the ground floor is no void
  for (const r of rooms) {
    if (!r.outline || r.outline.length < 3) continue
    const n = norm(r.name)
    if ((VOID_ONLY.test(n) || r.void) && lvIdx(r.level) > 0) { voids.add(r); if (unnamed.has(r.id)) r.name = voidName }
    else if (VOID_IN.test(n)) {
      // the room above it is the void
      const up = levels[lvIdx(r.level) + 1]
      const A = areaOf(r.outline)
      const above = up && rooms.find((x) => x.level === up.id && x.outline && x.outline.length >= 3 && inside(centroid(x.outline), r.outline!) && areaOf(x.outline) > 0.6 * A && areaOf(x.outline) < 1.5 * A)
      if (above) { voids.add(above); if (unnamed.has(above.id)) above.name = voidName }
    }
  }
  for (const v of voids) {
    v.void = true
    const fl = floorOf(v.level)
    if (fl) fl.openings = [...(fl.openings ?? []), v.outline!]
    guard(v.level, v.outline!, VOID_H)
  }
  return { slabs: outSlabs, railings, parapets }
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
 * Railings (steel, posts ≤ 1.2 m apart): on every side of a flight with no wall along it, 50 mm in from its edge
 * and parallel to the nosings, RAIL_H high — on a U stair the inner rail runs on round the landing from flight 1 to
 * flight 2 as one; on the floor where a stair ends, a guard rail GUARD_H high across the open edge of its well.
 */
export const RAIL_H = 900, GUARD_H = 1000

export function stairsFrom(sorted: PlanPick[], origins: P2[], levels: Level[], walls: Wall[], types: Map<string, WallType>, slabs: Slab[]): { stairs: Stair[]; landings: Slab[]; railings: Railing[]; notes: string[] } {
  const notes: string[] = []
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
  // L pairs: two single flights at right angles, the second beside the square past the top of the first
  const lPairs = new Set<FlightCluster[]>()
  const lAdj = (a: FlightCluster, b: FlightCluster) => {
    const pts: P2[] = [[b.s0, b.t0], [b.s1, b.t0], [b.s1, b.t1], [b.s0, b.t1]].map(([s, t]) => [b.d[0] * s + b.n[0] * t, b.d[1] * s + b.n[1] * t])
    const bn = pts.map((p) => dot(p, a.n)), bd = pts.map((p) => dot(p, a.d))
    const n0 = Math.min(...bn), n1 = Math.max(...bn), d0 = Math.min(...bd), d1 = Math.max(...bd)
    const pastEnd = Math.abs(n0 - a.t1) < 400 || Math.abs(n1 - a.t0) < 400
    const beside = Math.abs(d0 - a.s1) < 400 || Math.abs(d1 - a.s0) < 400
    return pastEnd && beside
  }
  for (let i = 0; i < systems.length; i++) {
    if (systems[i].length !== 1) continue
    for (let j = i + 1; j < systems.length; j++) {
      const a = systems[i][0], b = systems[j][0]
      if (systems[j].length !== 1 || Math.abs(dot(a.n, b.n)) > 0.05 || !(lAdj(a, b) || lAdj(b, a))) continue
      // flight 1 first: the one whose top end the other one leaves from
      const sys = lAdj(a, b) ? [a, b] : [b, a]
      systems[i] = sys
      systems.splice(j, 1)
      lPairs.add(sys)
      break
    }
  }
  const diagonals = sorted.flatMap((p, li) => (p.rec.stairDiagonals ?? []).map(([x, y]) => [x - origins[li][0], y - origins[li][1]] as P2))
  const stairs: Stair[] = [], landings: Slab[] = [], railings: Railing[] = []
  let no = 0
  // a wall along the side of a flight (its centre line within 350 mm of the edge, over half the run)
  const wallAt = (lv: string, c: FlightCluster, sEdge: number) => walls.some((w) => {
    if (w.baseLevel !== lv) return false
    const { a: wa, dir: wu } = wallEnds(w)
    if (Math.abs(dot(wu, c.n)) < 0.95 || Math.abs(dot(wa, c.d) - sEdge) > 350) return false
    const w0 = dot(wa, c.n), w1 = w0 + w.length * dot(wu, c.n)
    return Math.min(Math.max(w0, w1), c.t1) - Math.max(Math.min(w0, w1), c.t0) > 0.5 * (c.t1 - c.t0)
  })
  // a rail along a flight on one side (+1: its left): from the first nosing to the top one, then on to its top end
  const railOf = (st: Stair, side: 1 | -1) => {
    const t = (st.angle * Math.PI) / 180, u: P2 = [Math.cos(t), Math.sin(t)], nl: P2 = [-u[1], u[0]]
    const o = side * (st.width / 2 - 50), n = st.risers ?? 1, g = st.length / n, r = (st.rise ?? 0) / n, z0 = st.baseOffset ?? 0
    const p = (along: number): P2 => [r1(st.x + u[0] * along + nl[0] * o), r1(st.y + u[1] * along + nl[1] * o)]
    return { pts: [p(0), p(st.length - g), p(st.length)], z: [r1(z0 + r), r1(z0 + n * r), r1(z0 + n * r)] }
  }
  const sideTo = (st: Stair, q: P2): 1 | -1 => { const t = (st.angle * Math.PI) / 180; return (-Math.sin(t) * (q[0] - st.x) + Math.cos(t) * (q[1] - st.y) >= 0 ? 1 : -1) }
  const leftEdge = (c: FlightCluster, st: Stair) => { const t = (st.angle * Math.PI) / 180; const nl: P2 = [-Math.sin(t), Math.cos(t)]; return dot(nl, c.d) > 0 ? c.s1 : c.s0 }
  const rail = (lv: string, pts: P2[], z: number[], height: number) => railings.push({ id: `railing-${railings.length + 1}`, category: 'railing', mark: `RL${railings.length + 1}`, level: lv, pts, height, z })
  // per stair system: the storeys it was built for, with flight 1 (cluster and element) of each
  const built = new Map<FlightCluster[], { li: number; c1: FlightCluster; other: FlightCluster | undefined; st: Stair; L: boolean }[]>()
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
      // flight 1: the one drawn on the lowest plan (the start of the stair); of an L, the one the other leaves
      const isL = lPairs.has(sys)
      const [c1, c2] = !isL && sys.length === 2 && Math.min(...sys[1].seen) < Math.min(...sys[0].seen) ? [sys[1], sys[0]] : [sys[0], sys[1]]
      // up: as drawn; an L climbs towards the corner it turns at
      const toCorner = isL && c2 ? ((dot([c2.d[0] * (c2.s0 + c2.s1) / 2 + c2.n[0] * (c2.t0 + c2.t1) / 2, c2.d[1] * (c2.s0 + c2.s1) / 2 + c2.n[1] * (c2.t0 + c2.t1) / 2], c1.n) > (c1.t0 + c1.t1) / 2 ? 1 : -1) as 1 | -1) : 0
      const u1 = (c1.up || toCorner || (c2 ? -c2.up : 0) || 1) as 1 | -1
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
      const s1st = flight(c1, u1, 0, k1, `ST${no}`)
      stairs.push(s1st)
      built.set(sys, [...(built.get(sys) ?? []), { li, c1, other: isL ? undefined : c2, st: s1st, L: isL }])
      let well = rect(c1, c1.s0, c1.s1, c1.t0, c1.t1)
      let well2: P2[] | null = null
      // open sides of a flight get a rail (the side towards the other flight of a U stair is done below)
      const openRails = (c: FlightCluster, st: Stair, skip: 1 | -1 | 0) => {
        for (const side of [1, -1] as const) {
          if (side === skip) continue
          const edge = side === 1 ? leftEdge(c, st) : leftEdge(c, st) === c.s1 ? c.s0 : c.s1
          if (wallAt(lv.id, c, edge)) continue
          const r = railOf(st, side)
          rail(lv.id, r.pts, r.z, RAIL_H)
        }
      }
      if (c2 && isL) {
        // L: a square landing past the top of flight 1 (as wide as flight 2), flight 2 leaving it at right angles
        const te = u1 > 0 ? c1.t1 : c1.t0
        const sq = rect(c1, c1.s0, c1.s1, te, te + u1 * (c2.s1 - c2.s0))
        const z = k1 * riser
        landings.push({ id: `landing-${landings.length + 1}`, category: 'slab', mark: `LD${landings.length + 1}`, kind: 'floor', level: lv.id, offset: r1(z), thickness: 100, outline: sq, landing: true })
        const cx = sq.reduce((a, p) => a + p[0], 0) / 4, cy = sq.reduce((a, p) => a + p[1], 0) / 4, tP = dot([cx, cy], c2.n)
        const s2st = flight(c2, (Math.abs(c2.t0 - tP) < Math.abs(c2.t1 - tP) ? 1 : -1) as 1 | -1, z, k2, `ST${no}b`)
        stairs.push(s2st)
        well = rect(c1, c1.s0, c1.s1, Math.min(c1.t0, te + u1 * (c2.s1 - c2.s0)), Math.max(c1.t1, te + u1 * (c2.s1 - c2.s0)))
        well2 = rect(c2, c2.s0, c2.s1, c2.t0, c2.t1)
        openRails(c1, s1st, 0)
        openRails(c2, s2st, 0)
        // slanted tread lines in the corner: winders, built as this landing
        const xs = sq.map((p) => p[0]), ys = sq.map((p) => p[1])
        if (diagonals.some(([x, y]) => x > Math.min(...xs) - 50 && x < Math.max(...xs) + 50 && y > Math.min(...ys) - 50 && y < Math.max(...ys) + 50)) notes.push(`winders:${lv.name}`)
      } else if (c2) {
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
        const s2st = flight(c2, (-u1) as 1 | -1, z, k2, `ST${no}b`)
        stairs.push(s2st)
        well = rect(c1, S0, S1, Math.min(c1.t0, c2.t0, te + u1 * D), Math.max(c1.t1, c2.t1, te + u1 * D))
        // the inner rail: up flight 1, across the well at the landing, up flight 2 — one rail
        const in1 = sideTo(s1st, [s2st.x, s2st.y]), in2 = sideTo(s2st, [s1st.x, s1st.y])
        const a = railOf(s1st, in1), b = railOf(s2st, in2)
        rail(lv.id, [...a.pts, ...b.pts], [...a.z, ...b.z], RAIL_H)
        openRails(c1, s1st, in1)
        openRails(c2, s2st, in2)
      } else openRails(c1, s1st, 0)
      // the stair well through the floor above
      const up = slabs.find((s) => s.level === above.id && s.kind === 'floor' && !s.landing)
      if (up) up.openings = [...(up.openings ?? []), well, ...(well2 ? [well2] : [])]
    }
  }
  // spiral stairs: the same one on each plan by its centre; a storey gets one drawn on its plan and the one above
  const sp: { c: P2; r0: number; r1: number; a0: number; sweep: number; lines: number; seen: Set<number> }[] = []
  sorted.forEach((p, li) => {
    for (const s of p.rec.spirals ?? []) {
      const c: P2 = [s.c[0] - origins[li][0], s.c[1] - origins[li][1]]
      const e = sp.find((x) => Math.hypot(x.c[0] - c[0], x.c[1] - c[1]) < 200)
      if (e) { e.seen.add(li); if (s.lines > e.lines) Object.assign(e, { a0: s.a0, sweep: s.sweep, lines: s.lines, r0: s.r0, r1: s.r1 }) } else sp.push({ ...s, c, seen: new Set([li]) })
    }
  })
  for (const s of sp) {
    for (let li = 0; li + 1 < sorted.length; li++) {
      if (sorted[li].roof || !s.seen.has(li) || !s.seen.has(li + 1)) continue
      const lv = levels[li], above = levels[li + 1], H = above.elevation - lv.elevation
      if (H <= 0) continue
      const n = H / s.lines >= 140 && H / s.lines <= 220 ? s.lines : Math.ceil(H / 180)
      const step = s.lines > 1 ? s.sweep / (s.lines - 1) : s.sweep
      const sweep = step * n, rm = (s.r0 + s.r1) / 2
      no++
      const st: Stair = { id: `stair-${stairs.length + 1}`, category: 'stair', mark: `ST${no}`, baseLevel: lv.id, topLevel: above.id, x: r1(s.c[0]), y: r1(s.c[1]), angle: r1((s.a0 * 180) / Math.PI), length: r1(Math.abs(sweep) * rm), width: r1(s.r1 - s.r0), baseOffset: 0, rise: r1(H), risers: n, spiral: { r0: r1(s.r0), r1: r1(s.r1), a0: r1((s.a0 * 180) / Math.PI), sweep: r1((sweep * 180) / Math.PI) } }
      stairs.push(st)
      // the outer rail along the treads, rising with them; the well a circle through the floor above
      const k = Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI / 12)))
      const pts: P2[] = [], z: number[] = []
      for (let i = 0; i <= k; i++) { const a = s.a0 + (sweep * i) / k; pts.push([r1(s.c[0] + Math.cos(a) * (s.r1 - 50)), r1(s.c[1] + Math.sin(a) * (s.r1 - 50))]); z.push(r1((H * i) / k)) }
      rail(lv.id, pts, z, RAIL_H)
      const up = slabs.find((x) => x.level === above.id && x.kind === 'floor' && !x.landing)
      if (up) up.openings = [...(up.openings ?? []), Array.from({ length: 24 }, (_, i) => [r1(s.c[0] + Math.cos((i * Math.PI) / 12) * (s.r1 + 50)), r1(s.c[1] + Math.sin((i * Math.PI) / 12) * (s.r1 + 50))] as P2)]
    }
  }
  // the floor where a stair ends: a guard rail across the open edge of its well (over flight 1 of a U stair,
  // along the open sides of a straight one), where no wall stands
  for (const list of built.values()) {
    for (const { li, c1, other, st, L } of list) {
      if (L || list.some((x) => x.li === li + 1)) continue
      const above = levels[li + 1], lv = levels[li]
      if (!above) continue
      // the floor-side end of the well: the bottom of flight 1, the guard 50 mm back on the floor
      const t = (st.angle * Math.PI) / 180
      const tb = dot([st.x, st.y], c1.n), sgn = Math.cos(t) * c1.n[0] + Math.sin(t) * c1.n[1] > 0 ? 1 : -1
      if (other) {
        const inner = Math.abs(c1.s0 - other.s1) < Math.abs(c1.s1 - other.s0) ? c1.s0 : c1.s1
        const outer = inner === c1.s0 ? c1.s1 : c1.s0
        const sOut = wallAt(lv.id, c1, outer) ? outer + (outer > inner ? -50 : 50) : outer
        rail(above.id, [at(c1, inner, tb - sgn * 50), at(c1, sOut, tb - sgn * 50)], [0, 0], GUARD_H)
      } else for (const edge of [c1.s0, c1.s1]) if (!wallAt(lv.id, c1, edge)) rail(above.id, [at(c1, edge, c1.t0), at(c1, edge, c1.t1)], [0, 0], GUARD_H)
    }
  }
  return { stairs, landings, railings, notes }
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
    .filter((r) => r.level === levelId && !r.void && r.outline && r.outline.length >= 3)
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
