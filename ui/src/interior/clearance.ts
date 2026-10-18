/**
 * Clearance & collision checks (SP29) — deterministic measurements on the same primitives the 3D engine builds.
 *
 * GUIDANCE, NOT LEGAL COMPLIANCE: the clearance table holds common planning values (drawer pull-out, bed
 * access, circulation width, door approach). They are editable per project and are not a building-code check.
 *
 * Checks: overlapping items (plan overlap of the solids whose heights overlap), items inside another item's
 * clearance zone, items in a door's swing / approach zone, an 800 mm (configurable) walking path from each door
 * to every item that needs access (grid path search), wall-hosted items off their wall, items outside the room.
 * Each issue carries the measured numbers and fixes (move / rotate / align) computed and re-checked here; the
 * user applies one (one undo step).
 */
import type { InteriorDoc } from '../state/interior'
import type { Item, Room } from './model'
import { itemPartPrims, itemPlacements, type Place } from './scene'
import { faceDist, inPoly, innerPoly, primBounds, primPoly, satOverlap, toPlan, wallFaces, type P2 } from './geom'
import { alignToWall, footD, footW, moveInstance, rotateInstance, type EditResult } from './layout'

export interface ClearanceRules {
  /** Free depth in front of cabinets and wardrobes (drawer pull-out / door swing). */
  cabinetFront: number
  /** Access along the sides and the foot of a bed. */
  bedSide: number
  /** Width of the walking path from the door(s) to every item that needs access. */
  circulation: number
  /** Free depth inside a door that does not swing into the room (approach zone). */
  doorApproach: number
  /** Allowed gap between a wall-hosted item's back and its wall. */
  hostTolerance: number
}
export const DEFAULT_RULES: ClearanceRules = { cabinetFront: 500, bedSide: 600, circulation: 800, doorApproach: 600, hostTolerance: 5 }

export type IssueKind = 'collision' | 'clearance' | 'door' | 'circulation' | 'host' | 'outside' | 'needsInput'
export interface Fix {
  kind: 'move' | 'rotate' | 'align'
  item: string
  k: number
  /** move: distance (mm) and direction; rotate: degrees. */
  dist?: number
  dir?: '+X' | '−X' | '+Y' | '−Y' | 'along'
  deg?: number
  /** Measured value after the fix (clear distance / overlap, mm). */
  after?: number
  doc: InteriorDoc
}
export interface Issue {
  id: string
  kind: IssueKind
  room: string
  /** Item instances involved: `[item id, instance]`; the first is the one the fixes move. */
  items: [string, number][]
  /** Measured value (mm): overlap depth, clear distance, path width or gap. */
  measured?: number
  required?: number
  /** For needsInput: what is missing. */
  missing?: string
  fixes: Fix[]
}

interface Solid {
  item: Item
  k: number
  room: Room
  at: Place
  /** Plan polygons of the item's solids and their height ranges. */
  parts: { poly: P2[]; z0: number; z1: number }[]
  z0: number
  z1: number
}

/** Items that never block (floor coverings) and items that do not obstruct walking (hung high). */
const passive = (i: Item) => i.category === 'rugs'
const overhead = (s: Solid) => s.z0 >= 1200

function solids(doc: InteriorDoc, roomId?: string): Solid[] {
  const out: Solid[] = []
  for (const pl of itemPlacements(doc)) {
    if (roomId && pl.room.id !== roomId) continue
    pl.at.forEach((at, k) => {
      const prims = itemPartPrims(doc, pl.item, pl.room, [at]).map((t) => t.prim)
      // lighting: the fixture, not its cord
      const ps = pl.item.category === 'lighting' ? prims.filter((p) => p.k !== 'cyl' || p.s[0] > 10) : prims
      const parts = ps.map((p) => {
        const b = primBounds(p)
        return { poly: primPoly(p), z0: b.z0, z1: b.z1 }
      })
      out.push({ item: pl.item, k, room: pl.room, at, parts, z0: Math.min(...parts.map((p) => p.z0)), z1: Math.max(...parts.map((p) => p.z1)) })
    })
  }
  return out
}

/** Largest plan overlap depth between two solids whose parts also overlap in height (mm; ≤ 0 = clear). */
function overlap(a: Solid, b: Solid): number {
  let best = -Infinity
  for (const p of a.parts)
    for (const q of b.parts) {
      if (Math.min(p.z1, q.z1) - Math.max(p.z0, q.z0) <= 1) continue
      best = Math.max(best, satOverlap(p.poly, q.poly))
    }
  return best
}

/** Overlap of a solid with a zone polygon over a height range. */
function intrusion(s: Solid, zone: P2[], z0: number, z1: number): number {
  let best = -Infinity
  for (const p of s.parts) {
    if (Math.min(p.z1, z1) - Math.max(p.z0, z0) <= 1) continue
    best = Math.max(best, satOverlap(p.poly, zone))
  }
  return best
}

const rect = (at: Place, u0: number, v0: number, u1: number, v1: number): P2[] => [toPlan(at.x, at.y, at.rot, u0, v0), toPlan(at.x, at.y, at.rot, u1, v0), toPlan(at.x, at.y, at.rot, u1, v1), toPlan(at.x, at.y, at.rot, u0, v1)]

/** Clearance zones of an item instance (polygon, height range, required depth). */
export function zonesOf(doc: InteriorDoc, s: Solid, rules: ClearanceRules): { poly: P2[]; z0: number; z1: number; required: number; what: 'front' | 'side' | 'foot' }[] {
  const i = s.item
  const w = footW(i), d = footD(i)
  const cab = i.cabinet ? doc.cabinets.find((c) => c.id === i.cabinet) : undefined
  if (i.category === 'cabinet') {
    const f = -d / 2 - (cab ? cab.t : 0)
    return [{ poly: rect(s.at, -w / 2, f - rules.cabinetFront, w / 2, f), z0: s.z0, z1: Math.max(s.z1, s.z0 + 900), required: rules.cabinetFront, what: 'front' }]
  }
  if (i.category === 'beds') {
    const r = rules.bedSide
    // sides from the foot up to 500 mm short of the headboard (bedside tables stand there), and the foot
    return [
      { poly: rect(s.at, -w / 2 - r, -d / 2, -w / 2, d / 2 - 500), z0: 0, z1: 1800, required: r, what: 'side' },
      { poly: rect(s.at, w / 2, -d / 2, w / 2 + r, d / 2 - 500), z0: 0, z1: 1800, required: r, what: 'side' },
      { poly: rect(s.at, -w / 2, -d / 2 - r, w / 2, -d / 2), z0: 0, z1: 1800, required: r, what: 'foot' },
    ]
  }
  return []
}

/** Door zones of a room: swing (leaf width deep) or approach zone, inside the room. */
export function doorZones(r: Room, rules: ClearanceRules) {
  const faces = wallFaces(r)
  return (r.doors ?? []).flatMap((dr) => {
    const f = faces.find((x) => x.index === dr.wall)
    if (!f || !dr.width) return []
    const depth = dr.swing === 'in' || dr.swing === undefined ? dr.width : rules.doorApproach
    const a: P2 = [f.a[0] + f.dir[0] * dr.at, f.a[1] + f.dir[1] * dr.at]
    const b: P2 = [a[0] + f.dir[0] * dr.width, a[1] + f.dir[1] * dr.width]
    const poly: P2[] = [a, b, [b[0] + f.n[0] * depth, b[1] + f.n[1] * depth], [a[0] + f.n[0] * depth, a[1] + f.n[1] * depth]]
    const mid: P2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    return [{ door: dr, face: f, poly, depth, mid }]
  })
}

/** Measured clear depth of a zone given the intruder's penetration (mm). */
const clear = (required: number, pen: number) => Math.max(0, Math.round(required - pen))

const key = (s: Solid) => `${s.item.id}#${s.k}`

/**
 * All issues in the document (or one room). Deterministic: the same document gives the same list.
 * `fixes: false` skips the fix search (used inside the fix search and by the layout generator).
 */
export function checkClearance(doc: InteriorDoc, rules: ClearanceRules = DEFAULT_RULES, opts: { room?: string; fixes?: boolean; circulation?: boolean } = {}): Issue[] {
  const all = solids(doc, opts.room)
  const issues: Issue[] = []
  const add = (x: Omit<Issue, 'fixes'>) => issues.push({ ...x, fixes: [] })
  const active = all.filter((s) => !passive(s.item))
  // 1. collisions
  for (let a = 0; a < active.length; a++)
    for (let b = a + 1; b < active.length; b++) {
      const A = active[a], B = active[b]
      if (A.room.id !== B.room.id) continue
      const o = overlap(A, B)
      if (o > 5) {
        const mover = pickMover(A, B)
        const other = mover === A ? B : A
        add({ id: `collision:${key(mover)}:${key(other)}`, kind: 'collision', room: A.room.id, items: [[mover.item.id, mover.k], [other.item.id, other.k]], measured: Math.round(o) })
      }
    }
  // 2. clearance zones
  for (const owner of active)
    for (const z of zonesOf(doc, owner, rules))
      for (const s of active) {
        if (s === owner || s.room.id !== owner.room.id || s.item.id === owner.item.id) continue
        const pen = intrusion(s, z.poly, z.z0, z.z1)
        if (pen > 5) add({ id: `clearance:${key(owner)}:${z.what}:${key(s)}`, kind: 'clearance', room: owner.room.id, items: [[s.item.id, s.k], [owner.item.id, owner.k]], measured: clear(z.required, pen), required: z.required })
      }
  // 3. doors
  const rooms = doc.rooms.filter((r) => !opts.room || r.id === opts.room)
  for (const r of rooms) {
    for (const dz of doorZones(r, rules))
      for (const s of active) {
        if (s.room.id !== r.id || overhead(s)) continue
        const pen = intrusion(s, dz.poly, 0, 2100)
        if (pen > 5) add({ id: `door:${dz.door.id}:${key(s)}`, kind: 'door', room: r.id, items: [[s.item.id, s.k]], measured: clear(dz.depth, pen), required: dz.depth })
      }
    for (const dr of r.doors ?? []) if (!dr.width) add({ id: `needs:${r.id}:${dr.id}:width`, kind: 'needsInput', room: r.id, items: [], missing: 'door.width' })
  }
  // 4. wall hosting and room containment
  for (const s of all) {
    if (s.item.host) {
      const f = wallFaces(s.room).find((x) => x.index === s.item.host!.wall)
      if (f) {
        const back = toPlan(s.at.x, s.at.y, s.at.rot, 0, footD(s.item) / 2)
        const gap = Math.round(faceDist(f, back[0], back[1]))
        const rotOk = Math.abs(((s.at.rot - f.rot + 540) % 360) - 180) < 0.5
        if (Math.abs(gap) > rules.hostTolerance || !rotOk) add({ id: `host:${key(s)}`, kind: 'host', room: s.room.id, items: [[s.item.id, s.k]], measured: gap, required: 0 })
      }
    }
    const poly = innerPoly(s.room)
    let out = 0
    for (const p of s.parts) for (const [x, y] of p.poly) if (!inPoly(poly, x, y)) out = Math.max(out, outsideBy(poly, x, y))
    if (out > 5) add({ id: `outside:${key(s)}`, kind: 'outside', room: s.room.id, items: [[s.item.id, s.k]], measured: Math.round(out) })
  }
  // 5. circulation (needs a door with a known width to start from)
  if (opts.circulation !== false) for (const r of rooms) issues.push(...circulation(doc, r, all, rules).map((x) => ({ ...x, fixes: [] })))

  if (opts.fixes) for (const is of issues) is.fixes = fixesFor(doc, is, rules)
  return issues
}

/** Distance (mm) of a point outside a polygon to its nearest edge. */
function outsideBy(poly: P2[], x: number, y: number) {
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)))
    best = Math.min(best, Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy))
  }
  return best
}

/** The one a fix moves: never a locked or wall-hosted item if the other can move; else the smaller footprint. */
function pickMover(a: Solid, b: Solid): Solid {
  const fixed = (s: Solid) => (s.item.locked ? 2 : 0) + (s.item.host ? 1 : 0) + (s.item.category === 'cabinet' ? 0.5 : 0)
  if (fixed(a) !== fixed(b)) return fixed(a) < fixed(b) ? a : b
  return footW(a.item) * footD(a.item) <= footW(b.item) * footD(b.item) ? a : b
}

/* ---------------- circulation: grid path search ---------------- */

const CELL = 50

/** Walking-path targets: in front of cabinets, beside and at the foot of beds (path centre, plan). */
function accessPoints(doc: InteriorDoc, s: Solid, rules: ClearanceRules): P2[][] {
  const i = s.item
  const w = footW(i), d = footD(i), half = rules.circulation / 2 + CELL
  const cab = i.cabinet ? doc.cabinets.find((c) => c.id === i.cabinet) : undefined
  const P = (u: number, v: number) => toPlan(s.at.x, s.at.y, s.at.rot, u, v)
  const range = (a: number, b: number) => Array.from({ length: Math.max(1, Math.floor((b - a) / 100) + 1) }, (_, k) => a + k * 100)
  // each target is reached when the path centre gets to any point in front of (beside) it
  if (i.category === 'cabinet' && s.z0 < 1200) return [range(-w / 2, w / 2).map((u) => P(u, -d / 2 - (cab?.t ?? 0) - half))]
  if (i.category === 'beds') {
    const left = range(-d / 2, d / 2 - 500).map((v) => P(-w / 2 - half, v)), right = range(-d / 2, d / 2 - 500).map((v) => P(w / 2 + half, v))
    // a double bed needs both sides, a single bed one
    return w >= 1400 ? [left, right] : [[...left, ...right]]
  }
  return []
}

export interface PathGrid {
  x0: number
  y0: number
  nx: number
  ny: number
  /** 1 = the path centre can stand here (clear of walls and items by circulation / 2). */
  free: Uint8Array
  /** Reached from a door (BFS). */
  reach: Uint8Array
}

/** Free / reachable cells of a room for a walker `rules.circulation` wide, from its doors. */
export function pathGrid(doc: InteriorDoc, r: Room, all: Solid[] = solids(doc, r.id), rules: ClearanceRules = DEFAULT_RULES): PathGrid {
  const poly = innerPoly(r)
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1])
  const x0 = Math.min(...xs), y0 = Math.min(...ys)
  const nx = Math.max(1, Math.ceil((Math.max(...xs) - x0) / CELL)), ny = Math.max(1, Math.ceil((Math.max(...ys) - y0) / CELL))
  const blocked = new Uint8Array(nx * ny)
  const obstacles = all.filter((s) => s.room.id === r.id && !passive(s.item) && !overhead(s)).flatMap((s) => s.parts.filter((p) => p.z0 < 1200).map((p) => p.poly))
  const boxes = obstacles.map((o) => ({ o, x0: Math.min(...o.map((p) => p[0])), x1: Math.max(...o.map((p) => p[0])), y0: Math.min(...o.map((p) => p[1])), y1: Math.max(...o.map((p) => p[1])) }))
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * CELL, y = y0 + (j + 0.5) * CELL
      if (!inPoly(poly, x, y)) {
        blocked[j * nx + i] = 1
        continue
      }
      for (const b of boxes) if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && inPoly(b.o, x, y)) {
        blocked[j * nx + i] = 1
        break
      }
    }
  // chamfer distance (3-4) to the nearest blocked cell or the grid border (walls)
  const INF = 1e9
  const dist = new Float64Array(nx * ny)
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) dist[j * nx + i] = blocked[j * nx + i] ? 0 : Math.min(3 * (i + 0.5), 3 * (nx - i - 0.5), 3 * (j + 0.5), 3 * (ny - j - 0.5), INF)
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= nx || j >= ny ? 0 : dist[j * nx + i])
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) dist[j * nx + i] = Math.min(dist[j * nx + i], at(i - 1, j) + 3, at(i, j - 1) + 3, at(i - 1, j - 1) + 4, at(i + 1, j - 1) + 4)
  for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) dist[j * nx + i] = Math.min(dist[j * nx + i], at(i + 1, j) + 3, at(i, j + 1) + 3, at(i + 1, j + 1) + 4, at(i - 1, j + 1) + 4)
  const free = new Uint8Array(nx * ny)
  const need = rules.circulation / 2 / CELL
  for (let n = 0; n < free.length; n++) free[n] = (dist[n] / 3) + 0.5 >= need ? 1 : 0
  const reach = new Uint8Array(nx * ny)
  const queue: number[] = []
  const faces = wallFaces(r)
  for (const dr of r.doors ?? []) {
    const f = faces.find((x) => x.index === dr.wall)
    if (!f || !dr.width) continue
    // the walker enters through the door: the first free cell straight in from the door's middle
    const m: P2 = [f.a[0] + f.dir[0] * (dr.at + dr.width / 2), f.a[1] + f.dir[1] * (dr.at + dr.width / 2)]
    for (let t = CELL / 2; t <= rules.circulation; t += CELL / 2) {
      const i = Math.floor((m[0] + f.n[0] * t - x0) / CELL), j = Math.floor((m[1] + f.n[1] * t - y0) / CELL)
      if (i >= 0 && j >= 0 && i < nx && j < ny && free[j * nx + i]) {
        if (!reach[j * nx + i]) (reach[j * nx + i] = 1), queue.push(j * nx + i)
        break
      }
    }
  }
  while (queue.length) {
    const c = queue.shift()!
    const i = c % nx, j = (c - i) / nx
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj
      if (a < 0 || b < 0 || a >= nx || b >= ny) continue
      const n = b * nx + a
      if (free[n] && !reach[n]) (reach[n] = 1), queue.push(n)
    }
  }
  return { x0, y0, nx, ny, free, reach }
}

export const reachable = (g: PathGrid, x: number, y: number) => {
  // within one cell of the target point (cell centres do not fall exactly on it)
  for (const dx of [0, -CELL, CELL]) for (const dy of [0, -CELL, CELL]) {
    const i = Math.floor((x + dx - g.x0) / CELL), j = Math.floor((y + dy - g.y0) / CELL)
    if (i >= 0 && j >= 0 && i < g.nx && j < g.ny && g.reach[j * g.nx + i]) return true
  }
  return false
}

function circulation(doc: InteriorDoc, r: Room, all: Solid[], rules: ClearanceRules): Omit<Issue, 'fixes'>[] {
  const inRoom = all.filter((s) => s.room.id === r.id)
  const targets = inRoom.flatMap((s) => accessPoints(doc, s, rules).map((p) => ({ s, p })))
  if (!targets.length) return []
  const doors = (r.doors ?? []).filter((d) => d.width)
  if (!doors.length) return [{ id: `needs:${r.id}:door`, kind: 'needsInput', room: r.id, items: [], missing: r.doors?.length ? 'door.width' : 'door' }]
  const g = pathGrid(doc, r, all, rules)
  const out: Omit<Issue, 'fixes'>[] = []
  const seen = new Set<string>()
  for (const t of targets) {
    if (t.p.some(([x, y]) => reachable(g, x, y)) || seen.has(key(t.s))) continue
    seen.add(key(t.s))
    out.push({ id: `circulation:${key(t.s)}`, kind: 'circulation', room: r.id, items: [[t.s.item.id, t.s.k]], required: rules.circulation })
  }
  return out
}

/* ---------------- fixes ---------------- */

const issueStill = (doc: InteriorDoc, is: Issue, rules: ClearanceRules) => checkClearance(doc, rules, { room: is.room, circulation: is.kind === "circulation" })
const DIRS: { dir: Fix['dir']; v: P2 }[] = [{ dir: '+X', v: [1, 0] }, { dir: '−X', v: [-1, 0] }, { dir: '+Y', v: [0, 1] }, { dir: '−Y', v: [0, -1] }]

/**
 * The issue's measurement in another version of the document (after a fix): collision → clear gap between the two
 * items (mm, negative = still overlapping); clearance / door → clear depth of the zone; host → gap to the wall.
 */
export function measure(doc: InteriorDoc, is: Issue, rules: ClearanceRules = DEFAULT_RULES): number | undefined {
  const all = solids(doc, is.room)
  const find = ([id, k]: [string, number]) => all.find((s) => s.item.id === id && s.k === k)
  const a = is.items[0] && find(is.items[0])
  if (!a) return undefined
  if (is.kind === 'collision') {
    const b = find(is.items[1])
    return b ? Math.round(-overlap(a, b)) : undefined
  }
  if (is.kind === 'clearance') {
    const owner = find(is.items[1])
    if (!owner) return undefined
    const what = is.id.split(':')[2]
    const z = zonesOf(doc, owner, rules).find((x) => x.what === what)
    return z ? Math.round(z.required - Math.max(-z.required, intrusion(a, z.poly, z.z0, z.z1))) : undefined
  }
  if (is.kind === 'door') {
    const r = doc.rooms.find((x) => x.id === is.room)
    const dz = r && doorZones(r, rules).find((x) => is.id.startsWith(`door:${x.door.id}:`))
    return dz ? Math.round(dz.depth - Math.max(-dz.depth, intrusion(a, dz.poly, 0, 2100))) : undefined
  }
  if (is.kind === 'host' && a.item.host) {
    const f = wallFaces(a.room).find((x) => x.index === a.item.host!.wall)
    const back = toPlan(a.at.x, a.at.y, a.at.rot, 0, footD(a.item) / 2)
    return f ? Math.round(faceDist(f, back[0], back[1])) : undefined
  }
  return undefined
}

/** Fixes that remove the issue without creating a new one in the room, smallest first. */
export function fixesFor(doc: InteriorDoc, is: Issue, rules: ClearanceRules = DEFAULT_RULES): Fix[] {
  if (!is.items.length || is.kind === 'needsInput') return []
  const [id, k] = is.items[0]
  const item = doc.items.find((i) => i.id === id)
  if (!item || item.locked) return []
  const before = issueStill(doc, is, rules)
  const ok = (next: InteriorDoc) => {
    const after = issueStill(next, is, rules)
    return !after.some((x) => x.id === is.id) && after.length < before.length && after.every((x) => before.some((y) => y.id === x.id))
  }
  const out: Fix[] = []
  const take = (f: Omit<Fix, 'doc'>, r: EditResult) => {
    if (r.doc && ok(r.doc)) out.push({ ...f, doc: r.doc })
  }
  if (is.kind === 'host') {
    take({ kind: 'align', item: id, k, dist: Math.abs(is.measured ?? 0) }, alignToWall(doc, id, k))
    return out
  }
  // moves: 50 mm steps up to 2 m in the four plan directions (hosted items slide along their wall)
  for (const { dir, v } of DIRS) {
    for (let dist = 50; dist <= 2000; dist += 50) {
      const r = moveInstance(doc, id, k, v[0] * dist, v[1] * dist)
      if (r.doc && ok(r.doc)) {
        out.push({ kind: 'move', item: id, k, dist, dir: item.host ? 'along' : dir, doc: r.doc })
        break
      }
    }
  }
  if (!item.host) for (const deg of [90, -90, 180]) take({ kind: 'rotate', item: id, k, deg }, rotateInstance(doc, id, k, deg))
  out.sort((a, b) => (a.kind === 'move' ? a.dist! : 1e6 + Math.abs(a.deg ?? 0)) - (b.kind === 'move' ? b.dist! : 1e6 + Math.abs(b.deg ?? 0)))
  // measured value after the fix: the issue's own number is gone; show the new clear distance where it applies
  return out.slice(0, 3).map((f) => ({ ...f, after: measure(f.doc, is, rules) }))
}

/** Free floor area (m²) of a room: inner floor minus the plan area of items standing on it (grid estimate, 50 mm cells). */
export function freeFloor(doc: InteriorDoc, r: Room, rules: ClearanceRules = DEFAULT_RULES) {
  const g = pathGrid(doc, r, solids(doc, r.id), rules)
  let free = 0, reach = 0
  for (let n = 0; n < g.free.length; n++) {
    free += g.free[n]
    reach += g.reach[n]
  }
  return { walkable: (free * CELL * CELL) / 1e6, reachable: (reach * CELL * CELL) / 1e6 }
}


