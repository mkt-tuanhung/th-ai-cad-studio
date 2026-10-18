/**
 * Applying a reference-photo style to a room (v2.4): finishes, furniture appearance, library models and an
 * auto-furnished layout — proposed as up to three options plus "keep the layout, restyle only", each a complete
 * preview document. Nothing is applied before the user picks one; applying it is ONE undo step.
 *
 * Layouts come from the existing Space Planning generator (interior/options.ts: room-type templates, real catalog
 * sizes, doors, circulation, locked items kept), checked again here:
 *   - no overlap between items, everything inside the room (clearance.ts checks, no NEW issue allowed);
 *   - a clear zone of at least 800 mm in front of every door (stricter than the generator's swing zone).
 * Style only changes appearance: room finishes, item finishes per part, the library model shown in renders
 * (presentation only — the item's W × D × H stays the truth). Parametric cabinets keep their boards unless the user
 * explicitly ticks "apply joinery to cabinet boards" (that changes manufacturing data, so it is opt-in and listed).
 */
import type { InteriorDoc } from '../state/interior'
import type { Cabinet, Item, Room, RoomDoor } from './model'
import { applyChangeSet, generateLayouts, roomTypeOf, type LayoutOption, type RoomType } from './options'
import { checkClearance, DEFAULT_RULES, type ClearanceRules } from './clearance'
import { assetByKey, itemFromAsset } from './catalog'
import { doorsFromBim } from './bimDoors'
import { innerPoly, inPoly, primBounds, primPoly, satOverlap, wallFaces, type P2 } from './geom'
import { itemPartPrims, itemPlacements, type Place } from './scene'
import { itemBox, libCategoriesFor, matchScore, type LibAsset } from '../library/assets'
import { appFinish, finishById, nearestFinish, STYLE_DEFAULTS, type FurnCat, type StyleAnalysis, type StyleKey } from './styleRef'

export const DOOR_CLEAR_MM = 800

export interface StyleApplyOptions {
  /** Room floor / wall / ceiling finishes. */
  finishes: boolean
  /** Auto-furnish with the layout generator (else only the restyle option). */
  furnish: boolean
  /** Furniture categories the user switched off (dropped from the generated layouts). */
  exclude: FurnCat[]
  /** Explicit opt-in: joinery finish → parametric cabinet boards (changes manufacturing data). */
  cabinetBoards: boolean
}
export const DEFAULT_APPLY: StyleApplyOptions = { finishes: true, furnish: true, exclude: [], cabinetBoards: false }

export interface StyleChecks {
  collisions: number
  outside: number
  /** Smallest clear depth in front of a door (mm, capped at 2000); Infinity when the room has no door. */
  doorClear: number
  /** New issues of any kind compared with the room before (ids). */
  issues: string[]
  ok: boolean
}

export interface StyleOption {
  id: 'A' | 'B' | 'C' | 'K'
  kind: 'layout' | 'restyle'
  template?: string
  score?: LayoutOption['score']
  doc: InteriorDoc
  finishes: { floor?: string; wall?: string; ceiling?: string }
  /** Doors read from the BIM model and added to the room (measured data, listed for the user). */
  doors: RoomDoor[]
  /** Items added / removed by the layout, extras (rug, plant) included. */
  added: { name: string; w: number; d: number; h: number }[]
  removed: number
  /** Library models chosen for the room's items (presentation only). */
  models: { item: string; name: string; asset: string; assetName: string }[]
  /** Cabinet board changes (only with cabinetBoards). */
  boards: { cabinet: string; name: string; board: string }[]
  checks: StyleChecks
}

export type StylePlan =
  | { status: 'ok'; options: StyleOption[]; type: RoomType; notes: string[] }
  | { status: 'needs-input'; missing: string[]; options: StyleOption[]; type: RoomType; notes: string[] }

/* ------------------------------------------------------------------ library model per item */

const words = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9_]+/).filter((w) => w.length > 2)
const textOf = (a: LibAsset) => [a.id, a.name, ...a.tags, ...(a.style ?? [])].join(' ').toLowerCase()

/** Style fit of a library model: liked words +0.15 each (≤ 0.3), avoided words −0.3 each (≤ −0.6), hint words +0.05. */
export function styleBonus(a: LibAsset, style: StyleKey, hint = ''): number {
  const d = STYLE_DEFAULTS[style]
  const t = textOf(a)
  const like = d.like.filter((w) => t.includes(w)).length
  const avoid = d.avoid.filter((w) => t.includes(w)).length
  const hw = words(hint).filter((w) => t.includes(w)).length
  return Math.min(0.3, like * 0.15) - Math.min(0.6, avoid * 0.3) + Math.min(0.15, hw * 0.05)
}

/**
 * The library model (a downloaded or imported FILE model) that best fits an item for a style: the size fit of the
 * render matcher plus the style bonus. Composed presets are not assigned (the default matcher still uses them), so
 * the live 3D / clearance geometry never changes. Parametric cabinets keep their cut-list geometry (null).
 */
export function styleAssetFor(i: Item, assets: LibAsset[], a: StyleAnalysis): LibAsset | null {
  if (i.cabinet) return null
  const want = libCategoriesFor(i as Item & { kind?: string })
  const box = itemBox(i)
  const hint = a.furniture.filter((f) => want.includes(f.category)).map((f) => f.hint).join(' ')
  let best: LibAsset | null = null, bs = 0.15
  for (const x of assets) {
    if (x.kind !== 'model' || !x.files.main) continue
    const base = matchScore(x, box, want)
    if (base < 0) continue
    const s = base + styleBonus(x, a.style, hint)
    if (s > bs || (s === bs && best && x.id < best.id)) {
      bs = s
      best = x
    }
  }
  return best
}

/* ------------------------------------------------------------------ finishes of items */

const METAL_LEGS: StyleKey[] = ['industrial', 'modern', 'minimal', 'luxury']

/** An item in the style's finishes (appearance only: material and per-part finishes; never its size or place). */
export function restyleItem(i: Item, a: StyleAnalysis, rug: string): Item {
  if (i.locked) return i
  const up = appFinish(a, 'upholstery') ?? i.material
  const jo = appFinish(a, 'joinery') ?? i.material
  const me = appFinish(a, 'metal') ?? 'Metal - Black'
  const st = appFinish(a, 'stone')
  const legs = METAL_LEGS.includes(a.style) ? me : jo
  switch (i.category) {
    case 'sofas':
      return { ...i, material: up, parts: { ...i.parts, body: { material: up }, back: { material: up } }, assetFinish: 'item' }
    case 'chairs': {
      const arm = (i.w ?? 0) >= 700
      return { ...i, material: up, parts: { ...i.parts, seat: { material: up }, back: { material: up }, legs: { material: legs } }, ...(arm ? { assetFinish: 'item' as const } : {}) }
    }
    case 'tables': {
      const top = st && (i.h < 500 || ['luxury', 'minimal', 'modern'].includes(a.style)) ? st : jo
      return { ...i, material: top, parts: { ...i.parts, top: { material: top }, legs: { material: legs } } }
    }
    case 'beds':
      return { ...i, material: up, parts: { ...i.parts, frame: { material: jo }, mattress: { material: 'Fabric - Linen' } } }
    case 'cabinet':
      // a parametric cabinet's body / front ARE its boards (manufacturing data): only the item's display finish here
      return i.cabinet ? { ...i, material: jo } : { ...i, material: jo, parts: { ...i.parts, body: { material: jo }, front: { material: jo } } }
    case 'lighting':
      return { ...i, material: me }
    case 'rugs':
      return { ...i, material: rug }
    default:
      return i
  }
}

/** Rug fabric: the palette's main textile / accent colour as the nearest upholstery finish (not the sofa's). */
export function rugFinish(a: StyleAnalysis): string {
  const up = appFinish(a, 'upholstery')
  const cands = a.palette.filter((p) => p.role === 'textile' || p.role === 'accent').sort((x, y) => y.share - x.share)
  for (const p of cands) {
    const f = nearestFinish(p.hex, 'upholstery', ['fabric_beige', 'fabric_taupe', 'fabric_linen', 'fabric_olive', 'fabric_grey', 'fabric_blue'])
    if (f.app !== up) return f.app
  }
  return up === 'Fabric - Linen' ? 'Fabric - Beige' : 'Fabric - Linen'
}

/** Joinery finish → the production board of the same wood (null: no board in the production library). */
export function boardFor(joineryApp: string | null): string | null {
  if (!joineryApp) return null
  if (/Oak|Ash/.test(joineryApp)) return 'MFC 18 - Oak'
  if (/Walnut|Dark Stained/.test(joineryApp)) return 'MFC 18 - Walnut'
  return null
}

/* ------------------------------------------------------------------ checks */

/** Clear depth in front of each door of a room: zone = door width × `depth` mm inward; items (not rugs, not hung
 *  above 1.2 m) may not enter it. Returns the smallest clear depth (≥ depth when free; Infinity without doors). */
export function doorClearance(doc: InteriorDoc, r: Room, depth = DOOR_CLEAR_MM): { min: number; blocked: string[] } {
  const faces = wallFaces(r)
  let min = Infinity
  const blocked: string[] = []
  const pl = itemPlacements(doc).filter((p) => p.room.id === r.id && p.item.category !== 'rugs')
  for (const dr of r.doors ?? []) {
    const f = faces.find((x) => x.index === dr.wall)
    if (!f || !dr.width) continue
    const a: P2 = [f.a[0] + f.dir[0] * dr.at, f.a[1] + f.dir[1] * dr.at]
    const b: P2 = [a[0] + f.dir[0] * dr.width, a[1] + f.dir[1] * dr.width]
    const zone: P2[] = [a, b, [b[0] + f.n[0] * depth, b[1] + f.n[1] * depth], [a[0] + f.n[0] * depth, a[1] + f.n[1] * depth]]
    let clear = Math.max(depth, 2000)
    for (const p of pl)
      for (const t of itemPartPrims(doc, p.item, p.room, p.at)) {
        if (primBounds(t.prim).z0 >= 1200) continue
        const poly = primPoly(t.prim)
        if (satOverlap(poly, zone) <= 1) continue
        const near = Math.min(...poly.map(([x, y]) => (x - a[0]) * f.n[0] + (y - a[1]) * f.n[1]))
        clear = Math.min(clear, Math.max(0, Math.round(near)))
        if (near < depth - 1) blocked.push(p.item.id)
      }
    min = Math.min(min, clear)
  }
  return { min, blocked: [...new Set(blocked)] }
}

/** Every item of the room inside its inner outline (plan polygons of all parts; `tol` mm of rounding allowed, as the
 *  clearance check). */
export function insideRoom(doc: InteriorDoc, r: Room, tol = 5): boolean {
  const poly = innerPoly(r)
  const dist = (x: number, y: number) => {
    let best = Infinity
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length]
      const dx = b[0] - a[0], dy = b[1] - a[1]
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)))
      best = Math.min(best, Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy))
    }
    return best
  }
  for (const p of itemPlacements(doc).filter((x) => x.room.id === r.id))
    for (const t of itemPartPrims(doc, p.item, p.room, p.at))
      for (const [x, y] of primPoly(t.prim)) if (!inPoly(poly, x, y) && dist(x, y) > tol) return false
  return true
}

/** Issues of a candidate that were not there before (`before`: clearance issue ids, `blockedBefore`: items already in
 *  an 800 mm door zone — existing furniture is not blamed on the style). */
function checksOf(doc: InteriorDoc, roomId: string, before: Set<string>, rules: ClearanceRules, blockedBefore: Set<string> = new Set()): StyleChecks {
  const r = doc.rooms.find((x) => x.id === roomId)!
  const all = checkClearance(doc, rules, { room: roomId })
  const fresh = all.filter((x) => !before.has(x.id))
  const dc = doorClearance(doc, r)
  const blocked = dc.blocked.filter((id) => !blockedBefore.has(id))
  return {
    collisions: fresh.filter((x) => x.kind === 'collision').length,
    outside: fresh.filter((x) => x.kind === 'outside').length,
    doorClear: dc.min,
    issues: [...fresh.map((x) => x.id), ...blocked.map((id) => `door800:${id}`)],
    ok: fresh.length === 0 && blocked.length === 0,
  }
}

/* ------------------------------------------------------------------ extras: rug, plant */

/** A rug under the coffee table (passive: never blocks) and a plant in a free corner, each kept only when the room
 *  stays free of new issues. */
function addExtras(doc: InteriorDoc, roomId: string, a: StyleAnalysis, exclude: FurnCat[], before: Set<string>, blockedBefore: Set<string>, rules: ClearanceRules, rug: string): { doc: InteriorDoc; added: Item[] } {
  const want = (c: FurnCat) => a.furniture.some((f) => f.category === c) && !exclude.includes(c)
  const r = doc.rooms.find((x) => x.id === roomId)!
  const added: Item[] = []
  let cur = doc
  const tryAdd = (it: Item) => {
    const next = { ...cur, items: [...cur.items, it] }
    if (checksOf(next, roomId, before, rules, blockedBefore).ok) {
      cur = next
      added.push(it)
      return true
    }
    return false
  }
  const pl = itemPlacements(cur).filter((p) => p.room.id === roomId)
  const table = pl.find((p) => p.item.catalog === 'Coffee Table' || /coffee|bàn trà/i.test(p.item.name))
  const sofa = pl.find((p) => p.item.category === 'sofas')
  if (want('rug') && table && !pl.some((p) => p.item.category === 'rugs')) {
    const asset = assetByKey('Area Rug')
    const t = table.at[0]
    if (asset)
      for (const [w, d] of [[Math.min(3200, Math.max(1600, (sofa?.item.w ?? 2000) + 400)), 2000], [2000, 1600], [1600, 1200]]) {
        const { item } = itemFromAsset(asset, roomId, { x: t.x, y: t.y, rot: t.rot }, { item: `SR-rug-${roomId}` })
        if (tryAdd({ ...item, w, d, material: rug })) break
      }
  }
  if (want('plant')) {
    const asset = assetByKey('Potted Plant')
    const poly = innerPoly(r)
    if (asset)
      for (let k = 0; k < poly.length; k++) {
        const p = poly[k], prev = poly[(k + poly.length - 1) % poly.length], next = poly[(k + 1) % poly.length]
        const u = [prev[0] - p[0], prev[1] - p[1]], v = [next[0] - p[0], next[1] - p[1]]
        const lu = Math.hypot(u[0], u[1]) || 1, lv = Math.hypot(v[0], v[1]) || 1
        const at: Place = { x: p[0] + (u[0] / lu + v[0] / lv) * 350, y: p[1] + (u[1] / lu + v[1] / lv) * 350, rot: 0 }
        if (!inPoly(poly, at.x, at.y)) continue
        const { item } = itemFromAsset(asset, roomId, at, { item: `SR-plant-${roomId}` })
        if (tryAdd(item)) break
      }
  }
  return { doc: cur, added }
}

/* ------------------------------------------------------------------ the options */

/** Library model + finishes for every (unlocked) item of the room; boards of its cabinets when opted in. */
function restyleRoom(doc: InteriorDoc, roomId: string, a: StyleAnalysis, assets: LibAsset[], opts: StyleApplyOptions, rug: string) {
  const models: StyleOption['models'] = []
  const items = doc.items.map((i) => {
    if (i.room !== roomId || i.locked) return i
    const next = restyleItem(i, a, rug)
    const m = styleAssetFor(next, assets, a)
    if (!m) return next
    models.push({ item: i.id, name: i.name, asset: m.id, assetName: m.nameVi || m.name })
    return { ...next, asset: m.id }
  })
  const boards: StyleOption['boards'] = []
  let cabinets: Cabinet[] = doc.cabinets
  const board = opts.cabinetBoards ? boardFor(appFinish(a, 'joinery')) : null
  if (board) {
    const locked = new Set(doc.items.filter((i) => i.locked && i.cabinet).map((i) => i.cabinet!))
    cabinets = doc.cabinets.map((c) => {
      if (c.room !== roomId || locked.has(c.id) || (c.board === board && c.front === board)) return c
      boards.push({ cabinet: c.id, name: c.name, board })
      return { ...c, board, front: board }
    })
  }
  return { doc: { ...doc, items, cabinets }, models, boards }
}

/**
 * The options for a room: up to three generated layouts (A/B/C) restyled, plus K = keep the current layout and only
 * restyle. Every option is checked (no new collision / outside / clearance / circulation issue, 800 mm in front of
 * doors); an option that fails is dropped. Deterministic for the same input.
 */
export function planStyle(doc: InteriorDoc, roomId: string, a: StyleAnalysis, assets: LibAsset[], opts: StyleApplyOptions = DEFAULT_APPLY, ctx: { rules?: ClearanceRules; bim?: Parameters<typeof doorsFromBim>[0] | null; type?: RoomType } = {}): StylePlan {
  const rules = ctx.rules ?? DEFAULT_RULES
  const r0 = doc.rooms.find((x) => x.id === roomId)
  const type = ctx.type ?? (r0 ? roomTypeOf(r0) : 'living')
  if (!r0) return { status: 'needs-input', missing: ['room'], options: [], type, notes: [] }
  const notes: string[] = []
  // 1. room patch: finishes, and the doors of the BIM model when the room has none (measured, not guessed)
  const finishes: StyleOption['finishes'] = {}
  if (opts.finishes) {
    const fl = appFinish(a, 'floor'), wa = appFinish(a, 'walls'), ce = appFinish(a, 'ceiling')
    if (fl && fl !== r0.floorFinish) finishes.floor = fl
    if (wa && wa !== r0.wallFinish) finishes.wall = wa
    if (ce && ce !== r0.ceilingFinish && r0.ceilingFinish !== '—') finishes.ceiling = ce
  }
  const bimDoors = !r0.doors?.length && ctx.bim ? doorsFromBim(ctx.bim, r0) : []
  if (bimDoors.length) notes.push('doors-from-bim')
  const room: Room = {
    ...r0,
    ...(finishes.floor ? { floorFinish: finishes.floor } : {}),
    ...(finishes.wall ? { wallFinish: finishes.wall } : {}),
    ...(finishes.ceiling ? { ceilingFinish: finishes.ceiling } : {}),
    ...(bimDoors.length ? { doors: bimDoors } : {}),
  }
  const base: InteriorDoc = { ...doc, rooms: doc.rooms.map((x) => (x.id === roomId ? room : x)) }
  const before = new Set(checkClearance(base, rules, { room: roomId }).map((x) => x.id))
  // door-800 problems already there before (existing, kept furniture) are not blamed on the style
  const blockedBefore = new Set(doorClearance(base, room).blocked)
  const rug = rugFinish(a)
  const options: StyleOption[] = []
  let missing: string[] = []
  // 2. generated layouts
  if (opts.furnish) {
    const g = generateLayouts(base, roomId, type, rules)
    if (g.status === 'needs-input') missing = g.missing
    else if (g.status === 'none') notes.push('no-layout')
    else
      for (const o of g.options) {
        // drop the categories the user switched off (removing never creates a clash)
        const adds = o.changes.adds.filter((i) => !opts.exclude.includes(libCategoriesFor(i as Item & { kind?: string })[0] as FurnCat))
        const keepCab = new Set(adds.map((i) => i.cabinet).filter(Boolean))
        const cs = { ...o.changes, adds, addsCabinets: o.changes.addsCabinets.filter((c) => keepCab.has(c.id)) }
        const laid = applyChangeSet(base, cs)
        const ex = addExtras(laid, roomId, a, opts.exclude, before, blockedBefore, rules, rug)
        const styled = restyleRoom(ex.doc, roomId, a, assets, opts, rug)
        const checks = checksOf(styled.doc, roomId, before, rules, blockedBefore)
        if (!checks.ok) {
          notes.push(`rejected-${o.id}`)
          continue
        }
        options.push({
          id: o.id, kind: 'layout', template: o.template, score: o.score, doc: styled.doc, finishes, doors: bimDoors,
          added: [...adds, ...ex.added].map((i) => ({ name: i.name, w: i.w ?? i.dia ?? 0, d: i.d ?? i.dia ?? 0, h: i.h })),
          removed: cs.removes.length, models: styled.models, boards: styled.boards, checks,
        })
      }
  }
  // 3. keep the current layout, restyle only (always offered)
  const styled = restyleRoom(base, roomId, a, assets, opts, rug)
  options.push({ id: 'K', kind: 'restyle', doc: styled.doc, finishes, doors: bimDoors, added: [], removed: 0, models: styled.models, boards: styled.boards, checks: checksOf(styled.doc, roomId, before, rules, blockedBefore) })
  return missing.length ? { status: 'needs-input', missing, options, type, notes } : { status: 'ok', options, type, notes }
}

/** Blender lighting preset of the analysis mood: warm day → golden, neutral day → day, evening → night. */
export const lightingPreset = (a: Pick<StyleAnalysis, 'lighting'>): 'day' | 'golden' | 'night' => (a.lighting.time === 'evening' ? 'night' : a.lighting.tone === 'warm' ? 'golden' : 'day')

/** Short label of an analysis finish for messages. */
export const finishApp = (id: string | null) => finishById(id)?.app ?? null
