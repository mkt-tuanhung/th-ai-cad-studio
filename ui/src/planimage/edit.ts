/**
 * Fixes the user makes to a recognised plan picture before approving it (PlanImageReview): delete an element, add a
 * wall by two clicks, change an opening's type or width, rename a room. Every edit is pure (a new graph); after a
 * wall change the rooms, the outer walls and the footprint are worked out again from the walls (names the user
 * typed are kept where their room still is).
 */
import { roomsFromWalls, virtualClosers, type PlanGraph, type POpening, type PRoom, type Pt } from './recognize'

let n = 0
const id = (p: string) => `${p}u${Date.now().toString(36)}${++n}`

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0 }

/** Rooms, outer walls and footprint again from the walls (after a wall edit). */
export function rebuildRooms(g: PlanGraph): PlanGraph {
  const next: PlanGraph = { ...g, walls: g.walls.map((w) => ({ ...w })) }
  const r = roomsFromWalls(next, virtualClosers(next), g.rooms)
  for (const w of next.walls) w.ext = r.ext.has(w.id)
  // a room the user left out stays out
  const rooms = r.rooms.map((x) => (g.rooms.some((o) => o.skip && pointIn(o.seed, x.outline)) ? { ...x, skip: true } : x))
  return { ...next, rooms, footprint: r.footprint }
}

export function pointIn(p: Pt, poly: Pt[]): boolean {
  let r = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) r = !r
  }
  return r
}

export type Sel = { type: 'wall' | 'opening' | 'column' | 'room'; id: string } | null

/** Deletes a wall (with its openings), an opening, a column, or leaves a room out of the model. */
export function remove(g: PlanGraph, s: Sel): PlanGraph {
  if (!s) return g
  if (s.type === 'wall') return rebuildRooms({ ...g, walls: g.walls.filter((w) => w.id !== s.id), openings: g.openings.filter((o) => o.wall !== s.id) })
  if (s.type === 'opening') return { ...g, openings: g.openings.filter((o) => o.id !== s.id) }
  if (s.type === 'column') return rebuildRooms({ ...g, columns: g.columns.filter((c) => c.id !== s.id) })
  return { ...g, rooms: g.rooms.map((r) => (r.id === s.id ? { ...r, skip: !r.skip } : r)) }
}

/**
 * A new wall between two picked points (picture px): within 6° of horizontal / vertical it is squared, its ends
 * snap to a wall centre line within `snap` px; thickness = the typical interior wall of the plan.
 */
export function addWall(g: PlanGraph, a: Pt, b: Pt, snap = 0.25 * g.pxPerM): PlanGraph {
  let p = [...a] as Pt, q = [...b] as Pt
  const ang = Math.abs((Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI) % 180
  const horiz = ang < 6 || ang > 174, vert = Math.abs(ang - 90) < 6
  if (horiz) q = [q[0], p[1]]
  else if (vert) q = [p[0], q[1]]
  const snapEnd = (e: Pt): Pt => {
    let best = e, bd = snap
    for (const w of g.walls) {
      const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], L = Math.hypot(dx, dy)
      if (L < 1) continue
      const t = Math.max(0, Math.min(1, ((e[0] - w.a[0]) * dx + (e[1] - w.a[1]) * dy) / (L * L)))
      const c: Pt = [w.a[0] + dx * t, w.a[1] + dy * t]
      const d = Math.hypot(c[0] - e[0], c[1] - e[1])
      if (d < bd) { bd = d; best = c }
    }
    return best
  }
  p = snapEnd(p)
  q = snapEnd(q)
  // keep it square after the snap
  if (horiz) { const y = (p[1] + q[1]) / 2; p = [p[0], y]; q = [q[0], y] }
  else if (vert) { const x = (p[0] + q[0]) / 2; p = [x, p[1]]; q = [x, q[1]] }
  if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 3) return g
  const ts = g.walls.filter((w) => !w.curtain).map((w) => w.t).sort((x, y) => x - y)
  const t = median(ts.slice(0, Math.max(1, Math.ceil(ts.length / 2)))) || 0.12 * g.pxPerM
  return rebuildRooms({ ...g, walls: [...g.walls, { id: id('W'), a: p, b: q, t, ext: false, conf: 1, by: 'user' }] })
}

/** Changes an opening's type and / or width (px, about its centre, kept inside its wall). */
export function setOpening(g: PlanGraph, oid: string, patch: { kind?: POpening['kind']; width?: number }): PlanGraph {
  return {
    ...g,
    openings: g.openings.map((o) => {
      if (o.id !== oid) return o
      let { s0, s1 } = o
      if (patch.width && patch.width > 0) {
        const w = g.walls.find((x) => x.id === o.wall)
        const L = w ? Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) : s1
        const c = (s0 + s1) / 2, half = Math.min(patch.width, L) / 2
        s0 = Math.max(0, Math.min(L - 2 * half, c - half)); s1 = s0 + 2 * half
      }
      return { ...o, s0, s1, kind: patch.kind ?? o.kind, conf: 1, why: [...o.why.filter((x) => x !== 'user'), 'user'] }
    }),
  }
}

/** Renames a room (a typed name counts as confirmed: confidence 1, kept when the walls change). */
export function renameRoom(g: PlanGraph, rid: string, name: string): PlanGraph {
  return { ...g, rooms: g.rooms.map((r): PRoom => (r.id === rid ? { ...r, name: name.trim() || null, nameConf: 1, conf: 1 } : r)) }
}

/** Wall thickness (px). */
export function setWallThickness(g: PlanGraph, wid: string, t: number): PlanGraph {
  if (!(t > 0)) return g
  return rebuildRooms({ ...g, walls: g.walls.map((w) => (w.id === wid ? { ...w, t, conf: 1 } : w)) })
}
