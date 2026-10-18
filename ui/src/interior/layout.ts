/**
 * Space Planning edits (SP23–SP25): place from the catalog, auto-align to a wall, move / rotate / duplicate /
 * group, replace in place, resize within the product's limits, elevation, lock and wall hosting.
 *
 * Every function is pure: it takes the interior document and returns the next one, or an error (nothing
 * changes). The workspace commits a result with `edit(label, () => next)` — one undo step, validated by
 * validateInterior. Origin convention: see interior/catalog.ts (footprint centre, bottom, front −Y).
 */
import type { InteriorDoc } from '../state/interior'
import type { Cabinet, Item, PartFinish, Room } from './model'
import { assetByKey, doorsFor, itemFromAsset, limitsOf, newId, type SpaceAsset } from './catalog'
import { itemPartPrims, itemPlacements, type Place } from './scene'
import { faceAlong, faceDist, inPoly, innerPoly, norm180, primsBounds, roomBox, wallFaces, type Box3, type WallFace } from './geom'

export type EditResult = { doc: InteriorDoc; id?: string; error?: undefined } | { error: string; doc?: undefined; id?: undefined }

const err = (e: string): EditResult => ({ error: e })

export const footW = (i: Pick<Item, 'w' | 'dia'>) => i.w ?? i.dia ?? 500
export const footD = (i: Pick<Item, 'd' | 'dia'>) => i.d ?? i.dia ?? 500

/** Current placements of an item's instances (its own `at`, the sample layout or the auto grid). */
export function placesOf(doc: InteriorDoc, id: string): Place[] {
  return itemPlacements(doc).find((p) => p.item.id === id)?.at ?? []
}

/** World bounds of one instance (or all instances) of an item, exactly as built in 3D. */
export function itemBounds(doc: InteriorDoc, id: string, k?: number): Box3 | null {
  const pl = itemPlacements(doc).find((p) => p.item.id === id)
  if (!pl) return null
  const at = k === undefined ? pl.at : pl.at.slice(k, k + 1)
  // lighting cords run to the ceiling: bounds of the fixture only
  const prims = itemPartPrims(doc, pl.item, pl.room, at).map((t) => t.prim)
  const fix = pl.item.category === 'lighting' ? prims.filter((p) => p.k !== 'cyl' || p.s[0] > 10) : prims
  return primsBounds(fix)
}

const upd = (doc: InteriorDoc, id: string, fn: (i: Item) => Item): InteriorDoc => ({ ...doc, items: doc.items.map((i) => (i.id === id ? fn(i) : i)) })
const withAt = (doc: InteriorDoc, id: string, at: Place[]) => upd(doc, id, (i) => ({ ...i, at }))
const roomOf = (doc: InteriorDoc, i: Item) => doc.rooms.find((r) => r.id === i.room)
const getItem = (doc: InteriorDoc, id: string) => doc.items.find((i) => i.id === id)

/* ---------------- walls ---------------- */

/** Nearest wall face to a footprint centre (distance from the face to the item's back). */
export function nearestWall(r: Room, x: number, y: number, depth: number): { face: WallFace; gap: number } | null {
  let best: { face: WallFace; gap: number } | null = null
  for (const f of wallFaces(r)) {
    const al = faceAlong(f, x, y)
    if (al < -depth || al > f.len + depth) continue
    const gap = faceDist(f, x, y) - depth / 2
    if (!best || Math.abs(gap) < Math.abs(best.gap)) best = { face: f, gap }
  }
  return best
}

/** Gap kept between a wall and the back of an item when aligned (mm, guidance). */
export const WALL_GAP: Record<Item['category'], number> = { sofas: 50, tables: 0, cabinet: 0, chairs: 50, lighting: 0, beds: 0, decor: 20, rugs: 300 }

/** Place an item's back against a wall face: rotation from the wall, centre on the face normal, kept within the wall's length. */
export function snapPlace(f: WallFace, x: number, y: number, w: number, d: number, gap: number): Place {
  const half = w / 2
  const along = Math.min(Math.max(faceAlong(f, x, y), half), Math.max(half, f.len - half))
  const off = d / 2 + gap
  return { x: f.a[0] + f.dir[0] * along + f.n[0] * off, y: f.a[1] + f.dir[1] * along + f.n[1] * off, rot: f.rot }
}

/** Auto-align one instance to its nearest wall (wall-hosted items: to their host wall). */
export function alignToWall(doc: InteriorDoc, id: string, k = 0, wall?: number): EditResult {
  const i = getItem(doc, id)
  if (!i) return err('item')
  if (i.locked) return err('locked')
  const r = roomOf(doc, i)
  if (!r) return err('room')
  const at = placesOf(doc, id)
  const p = at[k]
  if (!p) return err('instance')
  const w = footW(i), d = footD(i)
  const target = wall ?? i.host?.wall
  const face = target !== undefined ? wallFaces(r).find((f) => f.index === target) : nearestWall(r, p.x, p.y, d)?.face
  if (!face) return err('wall')
  const np = snapPlace(face, p.x, p.y, w, d, i.host ? 0 : WALL_GAP[i.category])
  const next = at.map((q, n) => (n === k ? np : q))
  return { doc: withAt(doc, id, next) }
}

/* ---------------- place / move / rotate ---------------- */

/** Place a catalog product in a room: at `point` (or the room centre); wall-hosted products, and products dropped
 *  within 600 mm of a wall, are aligned back to that wall. */
export function placeAsset(doc: InteriorDoc, a: SpaceAsset, roomId: string, point?: { x: number; y: number }, ids?: { item?: string; cabinet?: string }): EditResult {
  const r = doc.rooms.find((x) => x.id === roomId)
  if (!r) return err('room')
  const b = roomBox(r)
  const p = point ?? { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }
  const { item, cabinet } = itemFromAsset(a, roomId, { x: p.x, y: p.y, rot: 0 }, ids)
  let next: InteriorDoc = { ...doc, items: [...doc.items, item], cabinets: cabinet ? [...doc.cabinets, cabinet] : doc.cabinets }
  const near = nearestWall(r, p.x, p.y, a.d)
  if (a.hosted === 'wall' || (near && Math.abs(near.gap) <= 600)) {
    const face = near?.face ?? wallFaces(r)[0]
    if (a.hosted === 'wall') next = upd(next, item.id, (x) => ({ ...x, host: { wall: face.index } }))
    const res = alignToWall(next, item.id, 0, face.index)
    if (res.doc) next = res.doc
  }
  return { doc: next, id: item.id }
}

/** Items that move with `id` (its group). */
export const groupOf = (doc: InteriorDoc, id: string) => {
  const g = getItem(doc, id)?.group
  return g ? doc.items.filter((i) => i.group === g).map((i) => i.id) : [id]
}

/**
 * Move one instance by (dx, dy). Wall-hosted items slide along their wall only; locked items (or a group with a
 * locked member) do not move; group members move together (all their instances).
 */
export function moveInstance(doc: InteriorDoc, id: string, k: number, dx: number, dy: number): EditResult {
  const i = getItem(doc, id)
  if (!i) return err('item')
  const members = groupOf(doc, id)
  if (members.some((m) => getItem(doc, m)?.locked)) return err('locked')
  let next = doc
  for (const m of members) {
    const it = getItem(next, m)!
    const at = placesOf(next, m)
    let mx = dx, my = dy
    if (it.host) {
      const r = roomOf(next, it)
      const f = r && wallFaces(r).find((x) => x.index === it.host!.wall)
      if (f) {
        const t = dx * f.dir[0] + dy * f.dir[1]
        mx = f.dir[0] * t
        my = f.dir[1] * t
      }
    }
    // a single item moves the one instance; a group moves every instance of every member
    const all = members.length > 1
    next = withAt(next, m, at.map((p, n) => (all || n === k ? { ...p, x: p.x + mx, y: p.y + my } : p)))
  }
  return { doc: next }
}

/** Move one instance to an absolute placement (plan drag), applying the host rule. */
export function setPlace(doc: InteriorDoc, id: string, k: number, p: Place): EditResult {
  const cur = placesOf(doc, id)[k]
  if (!cur) return err('instance')
  const i = getItem(doc, id)!
  if (i.locked) return err('locked')
  if (i.host && norm180(p.rot) !== norm180(cur.rot)) return err('hosted')
  const moved = moveInstance(doc, id, k, p.x - cur.x, p.y - cur.y)
  if (moved.error || norm180(p.rot) === norm180(cur.rot)) return moved
  return rotateInstance(moved.doc!, id, k, p.rot - cur.rot)
}

/** Rotate one instance about its own origin (90° steps or any angle). Hosted items follow their wall. */
export function rotateInstance(doc: InteriorDoc, id: string, k: number, deg: number): EditResult {
  const i = getItem(doc, id)
  if (!i) return err('item')
  if (i.locked) return err('locked')
  if (i.host) return err('hosted')
  const at = placesOf(doc, id)
  if (!at[k]) return err('instance')
  return { doc: withAt(doc, id, at.map((p, n) => (n === k ? { ...p, rot: norm180(p.rot + deg) } : p))) }
}

/** Duplicate an item (one instance), offset beside the original along its own width; cabinets get their own cut list. */
export function duplicateItem(doc: InteriorDoc, id: string, k = 0): EditResult {
  const i = getItem(doc, id)
  if (!i) return err('item')
  const p = placesOf(doc, id)[k]
  if (!p) return err('instance')
  const a = (p.rot * Math.PI) / 180
  const off = footW(i) + 100
  const nid = newId('i')
  let cabinets = doc.cabinets
  let cabinet: string | undefined
  if (i.cabinet) {
    const c = doc.cabinets.find((x) => x.id === i.cabinet)
    if (c) {
      cabinet = newId('c')
      cabinets = [...cabinets, { ...c, id: cabinet }]
    }
  }
  const copy: Item = { ...i, id: nid, qty: 1, status: 'planned', locked: undefined, group: undefined, cabinet, at: [{ x: p.x + Math.cos(a) * off, y: p.y + Math.sin(a) * off, rot: p.rot }] }
  return { doc: { ...doc, items: [...doc.items, copy], cabinets }, id: nid }
}

export function groupItems(doc: InteriorDoc, ids: string[]): EditResult {
  if (ids.length < 2) return err('group')
  const g = newId('g')
  return { doc: { ...doc, items: doc.items.map((i) => (ids.includes(i.id) ? { ...i, group: g } : i)) } }
}
export function ungroup(doc: InteriorDoc, id: string): EditResult {
  const g = getItem(doc, id)?.group
  if (!g) return err('group')
  return { doc: { ...doc, items: doc.items.map((i) => (i.group === g ? { ...i, group: undefined } : i)) } }
}

export function setLocked(doc: InteriorDoc, id: string, locked: boolean): EditResult {
  if (!getItem(doc, id)) return err('item')
  return { doc: upd(doc, id, (i) => ({ ...i, locked: locked || undefined })) }
}

/** Host an item on a wall of its room (its back is aligned to the wall) or release it. */
export function setHost(doc: InteriorDoc, id: string, wall: number | null): EditResult {
  const i = getItem(doc, id)
  if (!i) return err('item')
  if (i.locked) return err('locked')
  if (wall === null) return { doc: upd(doc, id, (x) => ({ ...x, host: undefined })) }
  const hosted = upd(doc, id, (x) => ({ ...x, host: { wall } }))
  return alignToWall(hosted, id, 0, wall)
}

/* ---------------- size / elevation / replace ---------------- */

const within = (v: number, [a, b]: [number, number]) => v >= a - 1e-6 && v <= b + 1e-6

/** Resize within the catalog product's parametric limits (fixed products: replace them instead). */
export function resizeItem(doc: InteriorDoc, id: string, s: { w?: number; d?: number; h?: number }): EditResult {
  const i = getItem(doc, id)
  if (!i) return err('item')
  if (i.locked) return err('locked')
  const lim = limitsOf(i)
  const w = s.w ?? i.w ?? i.dia, d = s.d ?? i.d ?? i.dia, h = s.h ?? i.h
  if (w !== undefined && !within(w, lim.w)) return err(`W ${w} mm outside ${lim.w[0]}–${lim.w[1]} mm`)
  if (d !== undefined && !within(d, lim.d)) return err(`D ${d} mm outside ${lim.d[0]}–${lim.d[1]} mm`)
  if (!within(h, lim.h)) return err(`H ${h} mm outside ${lim.h[0]}–${lim.h[1]} mm`)
  const r = roomOf(doc, i)
  if (r && (i.elev ?? 0) + h > r.ceilingHeight) return err(`top ${(i.elev ?? 0) + h} mm above the ceiling ${r.ceilingHeight} mm`)
  const patch: Partial<Item> = i.dia !== undefined ? { dia: w, h } : { w, d, h }
  let next = upd(doc, id, (x) => ({ ...x, ...patch }))
  if (i.cabinet) next = { ...next, cabinets: next.cabinets.map((c) => (c.id === i.cabinet ? { ...c, w: w ?? c.w, d: d ?? c.d, h, doors: c.w === w ? c.doors : doorsFor(w ?? c.w) } : c)) }
  return { doc: next }
}

/** Elevation of the underside above the floor (wall cabinets, shelves); the top stays below the ceiling. */
export function setElevation(doc: InteriorDoc, id: string, elev: number): EditResult {
  const i = getItem(doc, id)
  if (!i) return err('item')
  if (i.locked) return err('locked')
  if (!(elev >= 0)) return err('elevation')
  const r = roomOf(doc, i)
  if (r && elev + i.h > r.ceilingHeight) return err(`top ${elev + i.h} mm above the ceiling ${r.ceilingHeight} mm`)
  return { doc: upd(doc, id, (x) => ({ ...x, elev: elev || undefined })) }
}

/**
 * Replace in place (SP24): another catalog product takes the item's place — same placements (position, rotation,
 * origin), elevation, room, status, quantity and host; the new product's dimensions and category. The finish is
 * kept when the category is the same. A parametric cabinet keeps its boards and gets the new size (new cut list).
 * The caller re-runs the clearance checks on the result (interior/clearance.ts).
 */
export function replaceInPlace(doc: InteriorDoc, id: string, key: string): EditResult {
  const i = getItem(doc, id)
  const a = assetByKey(key)
  if (!i) return err('item')
  if (!a) return err('catalog')
  if (i.locked) return err('locked')
  const at = placesOf(doc, id)
  const same = a.cat === i.category
  const old = i.cabinet ? doc.cabinets.find((c) => c.id === i.cabinet) : undefined
  let cabinets = doc.cabinets
  let cabinet: string | undefined
  if (a.cabinet) {
    const base: Cabinet = old ?? { id: newId('c'), name: a.name, room: i.room, w: a.w, d: a.d, h: a.h, t: 18, shelves: 0, doors: 1, board: 'MFC 18 - Oak', front: 'MFC 18 - Oak' }
    const nc: Cabinet = { ...base, name: a.name, w: a.w, d: a.d, h: a.h, doors: doorsFor(a.w), shelves: a.h > 1500 ? 4 : a.h > 600 ? 1 : 0, src: { kind: 'catalog' } }
    cabinet = nc.id
    cabinets = old ? cabinets.map((c) => (c.id === old.id ? nc : c)) : [...cabinets, nc]
  } else if (old && !doc.items.some((x) => x.id !== id && x.cabinet === old.id)) cabinets = cabinets.filter((c) => c.id !== old.id)
  const next: Item = {
    ...i,
    name: a.name,
    category: a.cat,
    catalog: a.key,
    w: a.round ? undefined : a.w,
    d: a.round ? undefined : a.d,
    dia: a.round ? a.w : undefined,
    h: a.h,
    material: same ? i.material : a.material,
    parts: same ? i.parts : undefined,
    cabinet,
    at,
    src: { kind: 'catalog' },
  }
  return { doc: { ...doc, items: doc.items.map((x) => (x.id === id ? next : x)), cabinets } }
}

/** Per-part finish (appearance only: placements, sizes and cut-list sizes stay). Cabinet body / front set the boards. */
export function setPartFinish(doc: InteriorDoc, id: string, part: string, f: PartFinish): EditResult {
  const i = getItem(doc, id)
  if (!i) return err('item')
  const cab = i.cabinet ? doc.cabinets.find((c) => c.id === i.cabinet) : undefined
  let next = upd(doc, id, (x) => ({ ...x, parts: { ...(x.parts ?? {}), [part]: f } }))
  if (cab && (part === 'body' || part === 'front')) next = { ...next, cabinets: next.cabinets.map((c) => (c.id === cab.id ? { ...c, [part === 'body' ? 'board' : 'front']: f.material } : c)) }
  return { doc: next }
}

/** Is the instance's footprint inside its room (within the wall faces)? */
export function insideRoom(doc: InteriorDoc, id: string, k: number): boolean {
  const i = getItem(doc, id)
  const r = i && roomOf(doc, i)
  const b = itemBounds(doc, id, k)
  if (!r || !b) return false
  const poly = innerPoly(r)
  const tol = 2
  return [[b.x0 + tol, b.y0 + tol], [b.x1 - tol, b.y0 + tol], [b.x1 - tol, b.y1 - tol], [b.x0 + tol, b.y1 - tol]].every(([x, y]) => inPoly(poly, x, y))
}
