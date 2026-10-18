/**
 * Layout options (SP28, V24-029…031): a deterministic generator that proposes up to three furniture layouts
 * for one room from the catalog — living room, bedroom, kitchen (with work-triangle guidance).
 *
 * Rules, not AI: candidates come from templates applied to each wall of the room; every candidate is checked
 * with the clearance & collision checks (interior/clearance.ts) and kept only if it is geometry-valid (inside the
 * room, no overlaps, clearances and door zones free, an 800 mm path from the door to everything that needs
 * access). Valid candidates are scored transparently (usable floor, storage, door clearance, cost when prices
 * are known, kitchen triangle) and the best three are returned, each as its own change set (removes + adds) to
 * preview, apply (one undo step) or reject (nothing changes).
 *
 * Missing inputs are never guessed: a room without a door, or a door without a width, returns "needs input".
 * The local AI may re-order / explain the options (rankOptionsWithModel) but never creates geometry.
 */
import type { InteriorDoc } from '../state/interior'
import type { HostApi } from '../services/host'
import { task } from '../ai/discipline'
import type { Cabinet, Item, ItemCategory, Room } from './model'
import { area } from './model'
import { assetByKey, itemFromAsset, type SpaceAsset } from './catalog'
import { checkClearance, doorZones, freeFloor, DEFAULT_RULES, type ClearanceRules } from './clearance'
import { faceAlong, innerPoly, polyArea, primPoly, satOverlap, wallFaces, WALL_FACE, type P2, type WallFace } from './geom'
import { itemPartPrims, itemPlacements, type Place } from './scene'

export type RoomType = 'living' | 'bedroom' | 'kitchen'
export const ROOM_TYPES: RoomType[] = ['living', 'bedroom', 'kitchen']

/** Room type from its name (the user can override it). */
export function roomTypeOf(r: Room): RoomType {
  const n = `${r.name} ${r.id}`.toLowerCase()
  if (/kitchen|bếp|bep/.test(n)) return 'kitchen'
  if (/bed|master|ngủ|ngu/.test(n)) return 'bedroom'
  return 'living'
}

/** Categories an option replaces in the room (other items, locked items and lighting stay as they are). */
const REPLACES: Record<RoomType, ItemCategory[]> = { living: ['sofas', 'tables', 'chairs', 'cabinet'], bedroom: ['beds', 'cabinet'], kitchen: ['cabinet'] }

export interface ChangeSet {
  removes: string[]
  removesCabinets: string[]
  adds: Item[]
  addsCabinets: Cabinet[]
}

export interface OptionScore {
  /** Floor reachable from the door with the circulation width (m²) and its share of the inner floor. */
  usable: number
  usableShare: number
  /** All access points (cabinet fronts, bed sides) reachable on an 800 mm path. */
  access: number
  storageL: number
  /** Smallest clear depth in front of a door zone (mm, capped at 2000). */
  doorClear: number
  /** Sum of catalog prices; null when a price is unknown (no prices are invented). */
  cost: number | null
  triangle?: { legs: [number, number, number]; sum: number; ok: boolean }
  total: number
  /** The formula, for display. */
  parts: { usable: number; storage: number; door: number; triangle: number }
}

export interface LayoutOption {
  id: 'A' | 'B' | 'C'
  template: string
  /** Wall(s) used (outline edge indices). */
  walls: number[]
  changes: ChangeSet
  doc: InteriorDoc
  score: OptionScore
  items: { name: string; w: number; d: number; h: number }[]
}

export type GenerateResult =
  | { status: 'needs-input'; missing: ('door' | 'door.width' | 'room')[] }
  | { status: 'none'; tried: number; rejected: Rejected[] }
  | { status: 'ok'; options: LayoutOption[]; tried: number; rejected: Rejected[] }

/** A candidate that failed the checks (template, walls, the issue ids found). */
export interface Rejected {
  template: string
  walls: number[]
  issues: string[]
}

/* ---------------- change sets ---------------- */

export function applyChangeSet(doc: InteriorDoc, cs: ChangeSet): InteriorDoc {
  return {
    ...doc,
    items: [...doc.items.filter((i) => !cs.removes.includes(i.id)), ...cs.adds],
    cabinets: [...doc.cabinets.filter((c) => !cs.removesCabinets.includes(c.id)), ...cs.addsCabinets],
  }
}

/** What is missing before layouts can be generated (never guessed). */
export function missingInputs(r: Room | undefined): ('door' | 'door.width' | 'room')[] {
  if (!r || r.outline.length < 3 || area(r.outline) <= 0) return ['room']
  if (!r.doors?.length) return ['door']
  if (r.doors.some((d) => !(d.width && d.width > 0))) return ['door.width']
  return []
}

/* ---------------- placement on a wall ---------------- */

const onWall = (f: WallFace, along: number, d: number, gap = 0): Place => ({ x: f.a[0] + f.dir[0] * along + f.n[0] * (d / 2 + gap), y: f.a[1] + f.dir[1] * along + f.n[1] * (d / 2 + gap), rot: f.rot })

/** Free stretches of a wall face (mm along it): inside the corners (the neighbouring wall faces) and outside door
 *  openings with a 100 mm jamb margin. */
function wallSpans(r: Room, f: WallFace): [number, number][] {
  const lo = WALL_FACE, hi = f.len - WALL_FACE
  const cuts = (r.doors ?? []).filter((d) => d.wall === f.index && d.width).map((d) => [d.at - 100, d.at + d.width! + 100] as [number, number]).sort((a, b) => a[0] - b[0])
  const out: [number, number][] = []
  let s = lo
  for (const [a, b] of cuts) {
    if (a > s) out.push([s, Math.min(a, hi)])
    s = Math.max(s, b)
  }
  if (s < hi) out.push([s, hi])
  return out.filter(([a, b]) => b - a > 200)
}
const longestSpan = (r: Room, f: WallFace) => [...wallSpans(r, f)].sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0] ?? null

/** Depth of the room in front of a wall (inner polygon extent along the wall's normal). */
function depthFrom(r: Room, f: WallFace) {
  const pts = innerPoly(r)
  return Math.max(...pts.map(([x, y]) => (x - f.a[0]) * f.n[0] + (y - f.a[1]) * f.n[1]))
}
const opposite = (fs: WallFace[], f: WallFace) => fs.find((g) => g.n[0] * f.n[0] + g.n[1] * f.n[1] < -0.99)

interface Draft {
  key: string
  at: Place
  w?: number
}

/**
 * A template is a list of slots; each slot lists alternative placements in order of preference. The builder
 * (generateLayouts) takes, slot by slot, the first alternative that keeps the room free of new issues; a
 * required slot with no valid alternative rejects the template. Deterministic.
 */
interface Slot {
  /** Alternatives, or alternatives computed from what the earlier slots placed. */
  alts: Draft[][] | ((placed: Draft[]) => Draft[][])
  optional?: boolean
}
type Template = { name: string; walls: number[]; slots: Slot[] }

/** Positions for a product of width w on a stretch: centred, then at either end. */
const positions = (s: [number, number], w: number, prefer?: number) => {
  const c = prefer !== undefined ? Math.min(Math.max(prefer, s[0] + w / 2), s[1] - w / 2) : (s[0] + s[1]) / 2
  return [...new Set([c, (s[0] + s[1]) / 2, s[0] + w / 2, s[1] - w / 2].map(Math.round))].filter((x) => x - w / 2 >= s[0] - 0.5 && x + w / 2 <= s[1] + 0.5)
}

/** Rotation whose front faces direction v (front = local −Y). */
const facing = (v: P2) => Math.round((Math.atan2(v[0], -v[1]) * 180) / Math.PI)

function livingTemplates(r: Room): Template[] {
  const fs = wallFaces(r)
  const out: Template[] = []
  const ct = assetByKey('Coffee Table')!, ar = assetByKey('Armchair')!
  for (const f of [...fs].sort((a, b) => b.len - a.len)) {
    const spans = wallSpans(r, f)
    if (!spans.length) continue
    const sofas = ['Modern Sofa 3-Seater', 'Sofa 2-Seater'].map((k) => assetByKey(k)!)
    // sofa + coffee table together (the table 450 mm in front of the seat), several positions
    const pair: Draft[][] = []
    for (const sa of sofas) for (const s of spans) for (const c of positions(s, sa.w)) pair.push([{ key: sa.key, at: onWall(f, c, sa.d, 50) }, { key: ct.key, at: onWall(f, c, ct.d, 50 + sa.d + 450) }])
    if (!pair.length) continue
    const slots: Slot[] = [{ alts: pair }]
    const o = opposite(fs, f)
    if (o)
      // TV unit on the opposite wall, facing the sofa where possible
      slots.push({
        optional: true,
        alts: (placed) => {
          const sofa = placed[0].at
          const tv: Draft[][] = []
          for (const k of ['TV Unit 2400', 'TV Unit 1800']) {
            const ta = assetByKey(k)!
            for (const s of wallSpans(r, o)) for (const c of positions(s, ta.w, faceAlong(o, sofa.x, sofa.y))) tv.push([{ key: k, at: onWall(o, c, ta.d, 0) }])
          }
          return tv
        },
      })
    // an armchair beside the coffee table, turned towards it (either side)
    slots.push({
      optional: true,
      alts: (placed) => {
        const t = placed[1].at
        return [1, -1].map((side) => {
          const v: P2 = [-side * f.dir[0], -side * f.dir[1]]
          const off = side * (ct.w / 2 + 450 + ar.d / 2)
          return [{ key: ar.key, at: { x: t.x + f.dir[0] * off, y: t.y + f.dir[1] * off, rot: facing(v) } }]
        })
      },
    })
    out.push({ name: 'sofaWall', walls: [f.index, ...(o ? [o.index] : [])], slots })
  }
  return out
}

const BEDS = ['King Bed', 'Queen Bed', 'Double Bed', 'Single Bed']

function bedroomTemplates(r: Room): Template[] {
  const fs = wallFaces(r)
  const out: Template[] = []
  const ns = assetByKey('Nightstand 450')!, wa = assetByKey('Wardrobe (parametric)')!
  for (const f of [...fs].sort((a, b) => b.len - a.len)) {
    const spans = wallSpans(r, f)
    if (!spans.length) continue
    const depth = depthFrom(r, f)
    const beds: Draft[][] = []
    for (const k of BEDS) {
      const b = assetByKey(k)!
      if (b.d + 600 > depth) continue
      for (const s of spans) for (const c of positions(s, b.w)) beds.push([{ key: k, at: onWall(f, c, b.d, 0) }])
    }
    if (!beds.length) continue
    const slots: Slot[] = [{ alts: beds }]
    // bedside tables: one each side of the bed, against the same wall
    for (const side of [-1, 1])
      slots.push({
        optional: true,
        alts: (placed) => {
          const b = placed[0]
          const c = faceAlong(f, b.at.x, b.at.y) + side * (assetByKey(b.key)!.w / 2 + 10 + ns.w / 2)
          return [[{ key: ns.key, at: onWall(f, c, ns.d, 0) }]]
        },
      })
    // wardrobe on another wall: parametric width to fit (2400 → 1000 mm), centred or at either end
    const ward: Draft[][] = []
    for (const g of fs.filter((x) => x.index !== f.index).sort((a, b) => b.len - a.len))
      for (const s of wallSpans(r, g))
        for (const w of [2400, 2000, 1600, 1200, 1000].filter((x) => x <= s[1] - s[0]))
          for (const c of positions(s, w)) ward.push([{ key: wa.key, at: onWall(g, c, wa.d, 0), w }])
    slots.push({ alts: ward, optional: true })
    out.push({ name: 'bedWall', walls: [f.index], slots })
  }
  return out
}

function kitchenTemplates(r: Room): Template[] {
  const fs = wallFaces(r)
  const n = r.outline.length
  const out: Template[] = []
  const run = assetByKey('Base Cabinet Run')!
  /** Modules along one wall stretch, filler runs (numbers) sharing the free length; null if they do not fit. */
  const line = (f: WallFace, s: [number, number], keys: (string | number)[]): Draft[] | null => {
    const fixed = keys.reduce<number>((a, k) => a + (typeof k === 'number' ? 0 : assetByKey(k)!.w), 0)
    const fills = keys.filter((k) => typeof k === 'number').length
    const free = s[1] - s[0] - fixed
    if (free < 0 || (fills && free < fills * 300 && free > 0)) return null
    const fw = fills ? Math.min(run.limits.w[1], Math.floor(free / fills / 50) * 50) : 0
    let x = s[0]
    const ds: Draft[] = []
    for (const k of keys) {
      if (typeof k === 'number') {
        if (fw >= 300) ds.push({ key: run.key, at: onWall(f, x + fw / 2, run.d, 0), w: fw })
        x += fw >= 300 ? fw : 0
      } else {
        const a = assetByKey(k)!
        ds.push({ key: k, at: onWall(f, x + a.w / 2, a.d, 0) })
        x += a.w
      }
    }
    return ds
  }
  const F = 'Refrigerator 700', S = 'Sink Base Cabinet 800', H = 'Hob Base Cabinet 600'
  const add = (name: string, walls: number[], alts: (Draft[] | null)[]) => {
    const ok = alts.filter((a): a is Draft[] => !!a)
    if (ok.length) out.push({ name, walls, slots: [{ alts: ok }] })
  }
  for (const f of [...fs].sort((a, b) => b.len - a.len)) {
    const spans = wallSpans(r, f)
    const s = longestSpan(r, f)
    if (!s) continue
    // I: fridge | run | sink | run | hob | run  (or mirrored)
    add('kitchenI', [f.index], spans.flatMap((sp) => [line(f, sp, [F, 1, S, 1, H, 1]), line(f, sp, [1, H, 1, S, 1, F])]))
    // L: this wall and the next one, sharing the corner (the corner square belongs to the next wall's run)
    const g = fs.find((x) => x.index === (f.index + 1) % n)
    if (g && Math.abs(g.n[0] * f.n[0] + g.n[1] * f.n[1]) < 0.01) {
      const gs = wallSpans(r, g)[0]
      if (gs && gs[0] <= WALL_FACE + 1) {
        // the next run's doors overlay 18 mm in front of it: keep a 50 mm corner filler beyond them
        const fEnd: [number, number] = [s[0], Math.min(s[1], f.len - WALL_FACE - 600 - 18 - 50)]
        add('kitchenL', [f.index, g.index], [
          [...(line(f, fEnd, [F, 1, S]) ?? []), ...(line(g, gs, [1, H, 1]) ?? [])],
          [...(line(f, fEnd, [S, 1, H]) ?? []), ...(line(g, gs, [1, F]) ?? [])],
        ].map((a) => (a.length >= 4 ? a : null)))
      }
    }
    // galley: sink + fridge here, hob opposite (aisle ≥ 1200 mm)
    const o = opposite(fs, f)
    if (o && depthFrom(r, f) >= 600 + 1200 + 600) {
      const os = longestSpan(r, o)
      const a = line(f, s, [F, 1, S, 1])
      const b = os && line(o, os, [1, H, 1])
      add('kitchenGalley', [f.index, o.index], [a && b ? [...a, ...b] : null])
    }
  }
  return out
}
/* ---------------- scoring ---------------- */

const dist2 = (a: Place, b: Place) => Math.hypot(a.x - b.x, a.y - b.y)

/** Work triangle (guidance only): fridge – sink – hob centres; each leg 1200–2700 mm, total 4000–7900 mm. */
export function workTriangle(doc: InteriorDoc, room: string) {
  const find = (key: string) => {
    const it = doc.items.find((i) => i.room === room && i.catalog === key)
    return it ? itemPlacements(doc).find((p) => p.item.id === it.id)?.at[0] : undefined
  }
  const f = find('Refrigerator 700'), s = find('Sink Base Cabinet 800'), h = find('Hob Base Cabinet 600')
  if (!f || !s || !h) return undefined
  const legs: [number, number, number] = [Math.round(dist2(f, s)), Math.round(dist2(s, h)), Math.round(dist2(h, f))]
  const sum = legs[0] + legs[1] + legs[2]
  return { legs, sum, ok: legs.every((l) => l >= 1200 && l <= 2700) && sum >= 4000 && sum <= 7900 }
}

function scoreOf(doc: InteriorDoc, r: Room, cs: ChangeSet, type: RoomType, rules: ClearanceRules): Omit<OptionScore, 'total' | 'parts'> {
  const ff = freeFloor(doc, r, rules)
  const inner = polyArea(innerPoly(r)) / 1e6
  const storageL = cs.adds.filter((i) => i.category === 'cabinet').reduce((a, i) => a + ((i.w ?? 0) * (i.d ?? 0) * i.h) / 1e6, 0)
  // door clearance: the clear depth in front of each door (zone vs the nearest new item)
  let doorClear = 2000
  const pl = itemPlacements(doc)
  for (const dz of doorZones(r, rules))
    for (const i of cs.adds) {
      const p = pl.find((x) => x.item.id === i.id)
      if (!p) continue
      for (const prim of itemPartPrims(doc, i, r, p.at).map((t) => t.prim)) {
        // separation between the item and the door opening (outer edge of the zone grows with depth)
        const probe: P2[] = [dz.poly[0], dz.poly[1], [dz.poly[1][0] + (dz.poly[2][0] - dz.poly[1][0]) * (2000 / dz.depth), dz.poly[1][1] + (dz.poly[2][1] - dz.poly[1][1]) * (2000 / dz.depth)], [dz.poly[0][0] + (dz.poly[3][0] - dz.poly[0][0]) * (2000 / dz.depth), dz.poly[0][1] + (dz.poly[3][1] - dz.poly[0][1]) * (2000 / dz.depth)]]
        if (satOverlap(primPoly(prim), probe) > 0) {
          // depth along the door normal to the nearest corner of the item
          const n = dz.face.n
          const d = Math.min(...primPoly(prim).map(([x, y]) => (x - dz.poly[0][0]) * n[0] + (y - dz.poly[0][1]) * n[1]))
          doorClear = Math.min(doorClear, Math.max(0, Math.round(d)))
        }
      }
    }
  const prices = cs.adds.map((i) => assetByKey(i.catalog)?.price)
  const cost = prices.every((p) => typeof p === 'number') ? prices.reduce<number>((a, p) => a + (p as number), 0) : null
  const tri = type === 'kitchen' ? workTriangle(doc, r.id) : undefined
  const access = checkClearance(doc, rules, { room: r.id }).filter((x) => x.kind === 'circulation').length === 0 ? 1 : 0
  return { usable: Math.round(ff.reachable * 100) / 100, usableShare: inner ? ff.reachable / inner : 0, access, storageL: Math.round(storageL), doorClear, cost, ...(tri ? { triangle: tri } : {}) }
}

/** Total = 40 × usable share + 30 × storage / best storage + 30 × door clear / 1000 (capped) + 10 if the kitchen triangle passes. */
function total(s: Omit<OptionScore, 'total' | 'parts'>, bestStorage: number): OptionScore {
  const parts = {
    usable: Math.round(40 * s.usableShare * 10) / 10,
    storage: Math.round((bestStorage ? (30 * s.storageL) / bestStorage : 30) * 10) / 10,
    door: Math.round(30 * Math.min(1, s.doorClear / 1000) * 10) / 10,
    triangle: s.triangle ? (s.triangle.ok ? 10 : 0) : 0,
  }
  return { ...s, parts, total: Math.round((parts.usable + parts.storage + parts.door + parts.triangle) * 10) / 10 }
}

/* ---------------- generator ---------------- */

/** Up to three geometry-valid layouts for a room (deterministic: same input → same options). */
export function generateLayouts(doc: InteriorDoc, roomId: string, type: RoomType, rules: ClearanceRules = DEFAULT_RULES): GenerateResult {
  const r = doc.rooms.find((x) => x.id === roomId)
  const missing = missingInputs(r)
  if (missing.length || !r) return { status: 'needs-input', missing }
  const cats = REPLACES[type]
  const removes = doc.items.filter((i) => i.room === roomId && !i.locked && cats.includes(i.category) && !(i.elev && i.elev >= 1200)).map((i) => i.id)
  const keepCab = new Set(doc.items.filter((i) => !removes.includes(i.id) && i.cabinet).map((i) => i.cabinet!))
  const removesCabinets = doc.items.filter((i) => removes.includes(i.id) && i.cabinet && !keepCab.has(i.cabinet)).map((i) => i.cabinet!)
  const base = applyChangeSet(doc, { removes, removesCabinets, adds: [], addsCabinets: [] })
  const before = new Set(checkClearance(base, rules, { room: roomId }).map((x) => x.id))
  const templates = type === 'living' ? livingTemplates(r) : type === 'bedroom' ? bedroomTemplates(r) : kitchenTemplates(r)
  const raw: { t: Template; cs: ChangeSet; next: InteriorDoc; s: Omit<OptionScore, 'total' | 'parts'> }[] = []
  let n = 0
  const rejected: Rejected[] = []
  /** Items for drafts (ids stable per template and slot so the same input gives the same change set). */
  const build = (drafts: Draft[], tn: number) => {
    const adds: Item[] = []
    const addsCabinets: Cabinet[] = []
    drafts.forEach((d, k) => {
      const a = assetByKey(d.key) as SpaceAsset
      const { item, cabinet } = itemFromAsset(a, roomId, d.at, { item: `L${tn}-${k}-${roomId}`, cabinet: `LC${tn}-${k}-${roomId}` })
      const w = d.w ?? a.w
      adds.push(w !== a.w ? { ...item, w } : item)
      if (cabinet) addsCabinets.push(w !== a.w ? { ...cabinet, w, doors: Math.max(1, Math.ceil(w / 600)) } : cabinet)
    })
    return { removes, removesCabinets, adds, addsCabinets } as ChangeSet
  }
  /** New issues of a candidate (pre-existing ones from kept / locked items are not counted); collisions first (cheap). */
  const newIssues = (cs: ChangeSet) => {
    const next = applyChangeSet(doc, cs)
    const quick = checkClearance(next, rules, { room: roomId, circulation: false }).filter((x) => !before.has(x.id))
    if (quick.length) return { next, issues: quick }
    return { next, issues: checkClearance(next, rules, { room: roomId }).filter((x) => !before.has(x.id)) }
  }
  for (const t of templates) {
    n++
    let placed: Draft[] = []
    let failed: string[] | null = null
    for (const slot of t.slots) {
      const alts = typeof slot.alts === 'function' ? slot.alts(placed) : slot.alts
      let took = false
      let last: string[] = []
      for (const alt of alts) {
        const res = newIssues(build([...placed, ...alt], n))
        if (!res.issues.length) {
          placed = [...placed, ...alt]
          took = true
          break
        }
        last = res.issues.map((x) => x.id)
      }
      if (!took && !slot.optional) {
        failed = last.length ? last : ['no-placement']
        break
      }
    }
    if (failed) {
      rejected.push({ template: t.name, walls: t.walls, issues: failed })
      continue
    }
    const cs = build(placed, n)
    const next = applyChangeSet(doc, cs)
    raw.push({ t, cs, next, s: scoreOf(next, r, cs, type, rules) })
  }
  if (!raw.length) return { status: 'none', tried: n, rejected }
  const bestStorage = Math.max(...raw.map((x) => x.s.storageL))
  const scored = raw.map((x) => ({ ...x, score: total(x.s, bestStorage) }))
  // distinct options: identical change sets (same products at the same places) count once
  const sig = (cs: ChangeSet) => cs.adds.map((i) => `${i.catalog}@${Math.round(i.at![0].x)},${Math.round(i.at![0].y)},${i.at![0].rot}:${i.w}`).sort().join('|')
  const seen = new Set<string>()
  const uniq = scored.sort((a, b) => b.score.total - a.score.total || a.t.walls[0] - b.t.walls[0]).filter((x) => (seen.has(sig(x.cs)) ? false : (seen.add(sig(x.cs)), true)))
  const ids = ['A', 'B', 'C'] as const
  return {
    status: 'ok',
    tried: n,
    rejected,
    options: uniq.slice(0, 3).map((x, k) => ({
      id: ids[k],
      template: x.t.name,
      walls: x.t.walls,
      changes: x.cs,
      doc: x.next,
      score: x.score,
      items: x.cs.adds.map((i) => ({ name: i.name, w: i.w ?? i.dia ?? 0, d: i.d ?? i.dia ?? 0, h: i.h })),
    })),
  }
}

/* ---------------- local AI: rank and explain only ---------------- */

/** The local model orders the options and explains in one sentence; it sees the scores, never edits geometry. */
export async function rankOptionsWithModel(host: HostApi, opts: LayoutOption[], lang: 'en' | 'vi'): Promise<{ order: string[]; why: string; seconds: number } | null> {
  if (opts.length < 2) return null
  const sys = `You review furniture layout options for an interior designer. Order the options from best to worst for daily use and explain why in one short sentence${lang === 'vi' ? ' in Vietnamese' : ''}. Use only the numbers given.`
  const prompt = opts
    .map((o) => `${o.id}: ${o.template}, items ${o.items.map((i) => i.name).join(', ')}; usable floor ${o.score.usable} m² (${Math.round(o.score.usableShare * 100)}%), storage ${o.score.storageL} L, door clear ${o.score.doorClear} mm${o.score.triangle ? `, work triangle ${o.score.triangle.sum} mm ${o.score.triangle.ok ? 'ok' : 'outside guidance'}` : ''}, score ${o.score.total}`)
    .join('\n')
  const id = opts.map((o) => `"\\"${o.id}\\""`).join(' | ')
  const grammar = `root ::= "{\\"order\\":[" id ("," id)* "],\\"why\\":\\"" txt "\\"}"\nid ::= ${id}\ntxt ::= [^"\\\\\\n]{1,240}`
  const r = await task(host, sys, `${prompt}\nReply as JSON.`, grammar, 160)
  if (!r.ok) return null
  try {
    const j = JSON.parse(r.text) as { order: string[]; why: string }
    const order = [...new Set(j.order)].filter((x) => opts.some((o) => o.id === x))
    return { order, why: String(j.why).slice(0, 240), seconds: r.seconds }
  } catch {
    return null
  }
}
