/**
 * Rooms bounded by walls (v2.4, SP02 / SP10): a room that knows its bounding walls (`edges`, in order round it)
 * gets its outline, net area (inside faces), gross area (wall centre lines) and net perimeter computed from the
 * walls — on every edit, so moving or thickening a wall updates the room (V24-004). Edges on arc walls follow the
 * arc. Rooms without edges (the original survey rooms) keep their stored area.
 */
import { typeOf, type BimModel, type P2, type Room, type Wall } from './model'
import { arcOf, ends } from './walls'
import { cutBy, polyArea, wallsOn } from './geometry'

type Edge =
  | { kind: 'line'; p: P2; d: P2; t: number; wall: Wall }
  | { kind: 'circle'; c: P2; r: number; /** +1: the edge runs counter-clockwise round c */ ccw: 1 | -1; t: number; wall: Wall; from: P2; to: P2 }

const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]]
const hyp = (a: P2, b: P2) => Math.hypot(b[0] - a[0], b[1] - a[1])

function lineLine(p: P2, d: P2, q: P2, e: P2): P2 | null {
  const den = d[0] * e[1] - d[1] * e[0]
  if (Math.abs(den) < 1e-9) return null
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den
  return [p[0] + d[0] * t, p[1] + d[1] * t]
}
function lineCircle(p: P2, d: P2, c: P2, r: number, near: P2): P2 | null {
  const f = sub(p, c)
  const b = f[0] * d[0] + f[1] * d[1], cc = f[0] * f[0] + f[1] * f[1] - r * r
  const disc = b * b - cc
  if (disc < 0) return null
  const s = Math.sqrt(disc)
  const xs = [-b - s, -b + s].map((t): P2 => [p[0] + d[0] * t, p[1] + d[1] * t])
  return hyp(xs[0], near) <= hyp(xs[1], near) ? xs[0] : xs[1]
}
function circleCircle(c1: P2, r1: number, c2: P2, r2: number, near: P2): P2 | null {
  const D = hyp(c1, c2)
  if (D < 1e-9 || D > r1 + r2 || D < Math.abs(r1 - r2)) return null
  const a = (r1 * r1 - r2 * r2 + D * D) / (2 * D)
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a))
  const m: P2 = [c1[0] + ((c2[0] - c1[0]) * a) / D, c1[1] + ((c2[1] - c1[1]) * a) / D]
  const o: P2 = [(-(c2[1] - c1[1]) * h) / D, ((c2[0] - c1[0]) * h) / D]
  const x1: P2 = [m[0] + o[0], m[1] + o[1]], x2: P2 = [m[0] - o[0], m[1] - o[1]]
  return hyp(x1, near) <= hyp(x2, near) ? x1 : x2
}

/** The room's edges as lines / circles offset towards the inside by `k` × half the wall thickness
 *  (k = 0: centre lines, 1: inside faces). `side` = +1 for a counter-clockwise loop (inside on the left of the
 *  travel), −1 for a clockwise one. Walls in line along one side are one edge (the thickest one's faces). */
function offsetEdges(m: BimModel, room: Room, k: number, side: 1 | -1): Edge[] | null {
  const raw: Edge[] = []
  for (const e of room.edges ?? []) {
    const w = m.walls.find((x) => x.id === e.wall)
    if (!w) return null
    const t = typeOf(m, w)?.thickness ?? 200
    const arc = arcOf(w)
    const en = ends(w)
    if (arc) {
      // travelling the edge: the wall's own sweep, reversed for `rev`
      const dir = ((arc.sweep >= 0 ? 1 : -1) * (e.rev ? -1 : 1)) as 1 | -1
      raw.push({ kind: 'circle', c: arc.c, r: arc.r, ccw: dir, t, wall: w, from: e.rev ? en.b : en.a, to: e.rev ? en.a : en.b })
      continue
    }
    raw.push({ kind: 'line', p: e.rev ? en.b : en.a, d: e.rev ? [-en.dir[0], -en.dir[1]] : en.dir, t, wall: w })
  }
  const inLine = (a: Edge, b: Edge) => a.kind === 'line' && b.kind === 'line' && Math.abs(a.d[0] * b.d[1] - a.d[1] * b.d[0]) < 1e-6 && a.d[0] * b.d[0] + a.d[1] * b.d[1] > 0 && Math.abs((b.p[0] - a.p[0]) * a.d[1] - (b.p[1] - a.p[1]) * a.d[0]) < 1
  const merged: Edge[] = []
  for (const e of raw) {
    const prev = merged.at(-1)
    if (prev && inLine(prev, e)) {
      prev.t = Math.max(prev.t, e.t)
      continue
    }
    merged.push({ ...e })
  }
  while (merged.length > 2 && inLine(merged.at(-1)!, merged[0])) merged[0].t = Math.max(merged[0].t, merged.pop()!.t)
  if (!(merged.length >= 3 || merged.some((e) => e.kind === 'circle'))) return null
  return merged
    .map((e): Edge => {
      const h = (k * e.t) / 2
      if (e.kind === 'circle') return { ...e, r: e.r - h * e.ccw * side }
      // inside = the left of the travel direction for a counter-clockwise loop
      const n: P2 = [-e.d[1] * side, e.d[0] * side]
      return { ...e, p: [e.p[0] + n[0] * h, e.p[1] + n[1] * h] }
    })
    .filter((e) => e.kind === 'line' || e.r > 1)
}

/** Corner between two consecutive edges (near the walls' shared end). */
function corner(a: Edge, b: Edge): P2 | null {
  const near: P2 = a.kind === 'circle' ? a.to : b.kind === 'circle' ? b.from : a.p
  if (a.kind === 'line' && b.kind === 'line') return lineLine(a.p, a.d, b.p, b.d)
  if (a.kind === 'line' && b.kind === 'circle') return lineCircle(a.p, a.d, b.c, b.r, near)
  if (a.kind === 'circle' && b.kind === 'line') return lineCircle(b.p, b.d, a.c, a.r, near)
  if (a.kind === 'circle' && b.kind === 'circle') {
    if (hyp(a.c, b.c) < 1e-6 && Math.abs(a.r - b.r) < 1e-6) return [a.c[0] + Math.cos(Math.atan2(near[1] - a.c[1], near[0] - a.c[0])) * a.r, a.c[1] + Math.sin(Math.atan2(near[1] - a.c[1], near[0] - a.c[0])) * a.r]
    return circleCircle(a.c, a.r, b.c, b.r, near)
  }
  return null
}

function polygonOf(edges: Edge[]): P2[] | null {
  const n = edges.length
  const vs: P2[] = []
  for (let i = 0; i < n; i++) {
    const v = corner(edges[(i - 1 + n) % n], edges[i])
    if (!v || !Number.isFinite(v[0]) || !Number.isFinite(v[1])) return null
    vs.push(v)
  }
  const out: P2[] = []
  for (let i = 0; i < n; i++) {
    const e = edges[i], v0 = vs[i], v1 = vs[(i + 1) % n]
    out.push(v0)
    if (e.kind === 'circle') {
      const a0 = Math.atan2(v0[1] - e.c[1], v0[0] - e.c[0]), a1 = Math.atan2(v1[1] - e.c[1], v1[0] - e.c[0])
      let sw = a1 - a0
      if (e.ccw > 0) while (sw <= 1e-9) sw += 2 * Math.PI
      else while (sw >= -1e-9) sw -= 2 * Math.PI
      const k = Math.max(1, Math.ceil(Math.abs(sw) / (Math.PI / 180)))
      for (let j = 1; j < k; j++) out.push([e.c[0] + Math.cos(a0 + (sw * j) / k) * e.r, e.c[1] + Math.sin(a0 + (sw * j) / k) * e.r])
    }
  }
  return out
}

const signed = (poly: P2[]) => poly.reduce((s, p, i) => s + p[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * p[1], 0) / 2
export const perimeterOf = (poly: P2[]) => poly.reduce((s, p, i) => s + hyp(p, poly[(i + 1) % poly.length]), 0)

export interface RoomShape {
  /** inside faces (net) and wall centre lines (gross) */
  net: P2[]
  gross: P2[]
  netArea: number // m²
  grossArea: number // m²
  perimeter: number // mm, along the inside faces
}

/** Room geometry from its bounding walls (null: no edges, a wall missing, or the walls do not close a room). */
export function roomShape(m: BimModel, room: Room): RoomShape | null {
  if (!room.edges || room.edges.length < 1) return null
  for (const side of [1, -1] as const) {
    const ge = offsetEdges(m, room, 0, side), ne = offsetEdges(m, room, 1, side)
    if (!ge || !ne) return null
    const gross = polygonOf(ge), net = polygonOf(ne)
    if (!gross || !net) return null
    // the loop runs counter-clockwise when its centre-line polygon has a positive area; else try it the other way
    if (signed(gross) <= 0 && side === 1) continue
    const ga = Math.abs(signed(gross)), na = Math.abs(signed(net))
    if (na <= 0 || na >= ga + 1) return null
    return { net, gross, netArea: na / 1e6, grossArea: ga / 1e6, perimeter: perimeterOf(net) }
  }
  return null
}

const round = (p: P2): P2 => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]

/** A room with its computed outline, areas and perimeter (unchanged when it has no edges or they do not close). */
export function withShape(m: BimModel, room: Room): Room {
  const sh = roomShape(m, room)
  if (!sh) return room
  const area = Math.round(sh.netArea * 1e4) / 1e4, areaGross = Math.round(sh.grossArea * 1e4) / 1e4, perimeter = Math.round(sh.perimeter * 10) / 10
  const outline = sh.net.map(round)
  if (room.area === area && room.areaGross === areaGross && room.perimeter === perimeter && JSON.stringify(room.outline) === JSON.stringify(outline)) return room
  return { ...room, area, areaGross, perimeter, outline }
}

/**
 * Rooms recomputed after an edit: every room with edges whose walls (or their types) changed, or that is new. A
 * room whose bounding wall was deleted keeps its last outline and area and loses its edges.
 */
export function deriveRooms(before: BimModel | null, after: BimModel): BimModel {
  if (!after.rooms.some((r) => r.edges?.length)) return after
  const wallsBefore = new Map((before?.walls ?? []).map((w) => [w.id, w]))
  const typeChanged = new Set(after.wallTypes.filter((t) => before?.wallTypes.find((x) => x.id === t.id) !== t).map((t) => t.id))
  let any = false
  const rooms = after.rooms.map((r) => {
    if (!r.edges?.length) return r
    const prevRoom = before?.rooms.find((x) => x.id === r.id)
    const touched = !before || prevRoom !== r || r.edges.some((e) => {
      const w = after.walls.find((x) => x.id === e.wall)
      return !w || wallsBefore.get(e.wall) !== w || typeChanged.has(w.typeId)
    })
    if (!touched) return r
    if (r.edges.some((e) => !after.walls.some((w) => w.id === e.wall))) {
      any = true
      const { edges: _e, ...rest } = r
      void _e
      return rest as Room
    }
    const nr = withShape(after, r)
    if (nr !== r) any = true
    return nr
  })
  return any ? { ...after, rooms } : after
}

/**
 * The Room tool's boundary (an orthogonal room round a point): rays east / west / north / south stop at the
 * nearest wall; the room's edges are those four walls (when they run along the rectangle's sides).
 */
export function roomEdgesAt(m: BimModel, level: string, p: P2): Room['edges'] | null {
  const walls = wallsOn(m, level).filter((w) => !arcOf(w))
  const hit = (dx: number, dy: number): Wall | null => {
    let best = Infinity, bw: Wall | null = null
    for (const w of walls) {
      const { a, b } = ends(w)
      const ex = b[0] - a[0], ey = b[1] - a[1]
      const den = dx * ey - dy * ex
      if (Math.abs(den) < 1e-9) continue
      const s = ((a[0] - p[0]) * ey - (a[1] - p[1]) * ex) / den
      const u = ((a[0] - p[0]) * dy - (a[1] - p[1]) * dx) / den
      if (s > 0 && u >= -0.001 && u <= 1.001 && s < best) ((best = s), (bw = w))
    }
    return bw
  }
  const dirs: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]] // south, east, north, west
  const travel: P2[] = [[1, 0], [0, 1], [-1, 0], [0, -1]] // the counter-clockwise rectangle's edges
  const edges: NonNullable<Room['edges']> = []
  for (let i = 0; i < 4; i++) {
    const w = hit(...dirs[i])
    if (!w) return null
    const d = ends(w).dir
    const dot = d[0] * travel[i][0] + d[1] * travel[i][1]
    if (Math.abs(dot) < 0.999) return null
    edges.push(dot < 0 ? { wall: w.id, rev: true } : { wall: w.id })
  }
  return edges
}

/** Net / gross areas and perimeter of a room for Properties and schedules (computed, or the stored area). */
export function roomFigures(m: BimModel, r: Room): { net: number; gross: number | null; perimeter: number | null; live: boolean } {
  const sh = roomShape(m, r)
  if (sh) return { net: sh.netArea, gross: sh.grossArea, perimeter: sh.perimeter, live: true }
  const net = r.outline && r.outline.length > 2 ? polyArea(r.outline) / 1e6 : r.area
  return { net: r.area ?? net, gross: r.areaGross ?? null, perimeter: r.outline && r.outline.length > 2 ? perimeterOf(r.outline) : null, live: false }
}

/** Walls of a level whose vertical extent the room's level plan cuts (for templates and adjacency). */
export const levelWalls = (m: BimModel, level: string) => m.walls.filter((w) => cutBy(m, level, w.baseLevel, w.topLevel, w.baseOffset, w.topOffset))
