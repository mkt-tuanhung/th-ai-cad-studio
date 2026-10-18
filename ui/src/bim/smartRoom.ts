/**
 * Smart Room (v2.4, SP02 / V24-001 / V24-002): a room from a template and typed sizes in mm — rectangle, L, U,
 * polygon, round (straight segments or four arc walls), corridor — built as real walls plus a room bounded by
 * them, so its area and outline follow the walls from then on. A side that lies on an existing wall (an adjacent
 * room) reuses that wall instead of drawing a second one on top of it; only the uncovered parts get new walls.
 *
 * Pure: `smartRoom(model, spec)` returns the new model (to commit as ONE undoable edit) — also for other
 * workspaces (Interior space planning) to call.
 */
import { levelOf, type BimModel, type P2, type Room, type Wall, type WallType } from './model'
import { nextLevel, nextMark, uid } from './geometry'
import { arcOf, ends } from './walls'
import { deriveRooms, levelWalls } from './rooms'
import { uuid } from './identity'

export type SmartShape = 'rect' | 'L' | 'U' | 'polygon' | 'round' | 'corridor'

export interface SmartRoomSpec {
  shape: SmartShape
  level: string
  /** rect / L / U / corridor: the corner the first wall starts from (inside corner with `dims: 'inner'`); round:
   *  the centre; polygon: added to every point */
  origin: P2
  /** overall size along x (length of a corridor) and y (its width) */
  w?: number
  d?: number
  /** L: the corner cut away at the far x / far y corner; U: the notch in the middle of the far y side */
  cutW?: number
  cutD?: number
  /** polygon: corners (relative to origin), either orientation */
  pts?: P2[]
  /** round: radius (to the inside face with `dims: 'inner'`) */
  r?: number
  /** round: number of straight walls (default 16), or four arc walls with `arcWalls` */
  segments?: number
  arcWalls?: boolean
  /** rotation about the origin (degrees, counter-clockwise) */
  angle?: number
  /** wall thickness and height (mm) */
  thickness: number
  height: number
  /** the typed sizes are clear inside sizes (default) or to the wall centre lines */
  dims?: 'inner' | 'centre'
  name?: string
  number?: string
  /** wall type to draw with (else one of this thickness, created when the model has none) */
  wallType?: string
}

export interface SmartRoomResult {
  model: BimModel
  room: string
  /** the new room's guid (for links such as Interior's roomGuid) */
  roomGuid: string
  /** walls drawn / existing walls reused for a side */
  created: string[]
  reused: string[]
  error?: undefined
}

const r2 = (v: number) => Math.round(v * 100) / 100
const signed = (poly: P2[]) => poly.reduce((s, p, i) => s + p[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * p[1], 0) / 2

/** The polygon offset outwards by h (counter-clockwise input). */
export function offsetPoly(poly: P2[], h: number): P2[] {
  const n = poly.length
  const lines = poly.map((p, i) => {
    const q = poly[(i + 1) % n]
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1
    const d: P2 = [(q[0] - p[0]) / L, (q[1] - p[1]) / L]
    // outwards = right of the travel direction
    return { p: [p[0] + d[1] * h, p[1] - d[0] * h] as P2, d }
  })
  return lines.map((l, i) => {
    const k = lines[(i - 1 + n) % n]
    const den = k.d[0] * l.d[1] - k.d[1] * l.d[0]
    if (Math.abs(den) < 1e-9) return l.p
    const t = ((l.p[0] - k.p[0]) * l.d[1] - (l.p[1] - k.p[1]) * l.d[0]) / den
    return [k.p[0] + k.d[0] * t, k.p[1] + k.d[1] * t] as P2
  })
}

/** Validation of a spec: an error key or null. */
export function specProblem(m: BimModel, s: SmartRoomSpec): string | null {
  if (!levelOf(m, s.level)) return 'level'
  if (!(s.thickness >= 50 && s.thickness <= 1000)) return 'thickness'
  if (!(s.height >= 300)) return 'height'
  const min = 300
  if (s.shape === 'round') return (s.r ?? 0) >= min ? null : 'size'
  if (s.shape === 'polygon') return (s.pts?.length ?? 0) >= 3 && Math.abs(signed(s.pts!)) > min * min ? null : 'size'
  const w = s.w ?? 0, d = s.d ?? 0
  if (!(w >= min && d >= min)) return 'size'
  if (s.shape === 'L' && !((s.cutW ?? 0) >= min && (s.cutD ?? 0) >= min && (s.cutW ?? 0) <= w - min && (s.cutD ?? 0) <= d - min)) return 'cut'
  if (s.shape === 'U' && !((s.cutW ?? 0) >= min && (s.cutD ?? 0) >= min && (s.cutW ?? 0) <= w - 2 * min && (s.cutD ?? 0) <= d - min)) return 'cut'
  return null
}

/** Defaults of each template (mm). */
export function defaultSpec(shape: SmartShape, level: string, origin: P2 = [0, 0]): SmartRoomSpec {
  const base = { shape, level, origin, thickness: 200, height: 3000, dims: 'inner' as const }
  switch (shape) {
    case 'L': return { ...base, w: 6000, d: 5000, cutW: 2400, cutD: 2000 }
    case 'U': return { ...base, w: 7200, d: 5000, cutW: 2400, cutD: 2000 }
    case 'round': return { ...base, r: 2500, segments: 16 }
    case 'polygon': return { ...base, pts: [[0, 0], [5000, 0], [6000, 2500], [3000, 4500], [0, 3500]] }
    case 'corridor': return { ...base, w: 6000, d: 1500, thickness: 150 }
    default: return { ...base, w: 4200, d: 3600 }
  }
}

/** Centre-line corners of the room's walls (counter-clockwise, placed) — straight sides only; null for a round
 *  room of arc walls (see `arcLoop`). */
export function smartOutline(s: SmartRoomSpec): P2[] | null {
  const t = s.thickness
  const inner = (s.dims ?? 'inner') === 'inner'
  let poly: P2[]
  const w = s.w ?? 0, d = s.d ?? 0, cw = s.cutW ?? 0, cd = s.cutD ?? 0
  switch (s.shape) {
    case 'L': poly = [[0, 0], [w, 0], [w, d - cd], [w - cw, d - cd], [w - cw, d], [0, d]]; break
    case 'U': {
      const x0 = (w - cw) / 2, x1 = (w + cw) / 2
      poly = [[0, 0], [w, 0], [w, d], [x1, d], [x1, d - cd], [x0, d - cd], [x0, d], [0, d]]
      break
    }
    case 'polygon': poly = [...(s.pts ?? [])]; break
    case 'round': {
      if (s.arcWalls) return null
      const n = Math.max(6, Math.round(s.segments ?? 16))
      // r = apothem (to the middle of each straight side)
      const R = (s.r ?? 0) / Math.cos(Math.PI / n)
      poly = Array.from({ length: n }, (_, i) => [Math.cos(((i + 0.5) * 2 * Math.PI) / n) * R, Math.sin(((i + 0.5) * 2 * Math.PI) / n) * R] as P2)
      break
    }
    default: poly = [[0, 0], [w, 0], [w, d], [0, d]]
  }
  if (signed(poly) < 0) poly.reverse()
  // clear inside sizes: the wall centre lines are half a thickness further out
  if (inner) poly = offsetPoly(poly, t / 2)
  return place(s, poly)
}

function place(s: SmartRoomSpec, poly: P2[]): P2[] {
  const a = ((s.angle ?? 0) * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a)
  return poly.map(([x, y]) => [r2(s.origin[0] + x * c - y * sn), r2(s.origin[1] + x * sn + y * c)])
}

/** The four quarter arcs of a round room of arc walls: centre-line points and the (signed) radius. */
export function arcLoop(s: SmartRoomSpec): { pts: P2[]; radius: number } {
  const R = (s.r ?? 0) + ((s.dims ?? 'inner') === 'inner' ? s.thickness / 2 : 0)
  const pts = place(s, [[R, 0], [0, R], [-R, 0], [0, -R]])
  // counter-clockwise round the centre: each arc bulges to the right of its chord (away from the centre)
  return { pts, radius: -r2(R) }
}

/** The wall type to draw with: the requested one, one of this thickness, or a new "Generic - t mm" type. */
function wallTypeFor(m: BimModel, s: SmartRoomSpec): { model: BimModel; id: string } {
  if (s.wallType && m.wallTypes.some((t) => t.id === s.wallType && t.thickness === s.thickness)) return { model: m, id: s.wallType }
  const found = m.wallTypes.find((t) => t.family === 'Basic Wall' && t.thickness === s.thickness)
  if (found) return { model: m, id: found.id }
  const id = `SR${s.thickness}`
  const ty: WallType = { id, guid: uuid(), rev: 1, src: { kind: 'drawn' }, family: 'Basic Wall', name: `Generic - ${s.thickness}mm`, thickness: s.thickness, structure: 'Masonry - Brick', finishExt: 'Paint - White', finishInt: 'Paint - White', description: 'Smart Room wall' }
  return { model: { ...m, wallTypes: [...m.wallTypes, ty] }, id }
}

/** Builds the room. Returns the new model or `{ error }` (a spec problem key). */
export function smartRoom(m0: BimModel, s: SmartRoomSpec): SmartRoomResult | { error: string } {
  const bad = specProblem(m0, s)
  if (bad) return { error: bad }
  const { model: m1, id: typeId } = wallTypeFor(m0, s)
  const lvl = levelOf(m1, s.level)!
  const up = nextLevel(m1, s.level)
  const top = up && Math.abs(up.elevation - lvl.elevation - s.height) < 1 ? { topLevel: up.id, topOffset: 0 } : { topLevel: s.level, topOffset: s.height }
  const marks = m1.walls.map((w) => w.mark)
  const ids = new Set(m1.walls.map((w) => w.id))
  const newWall = (a: P2, b: P2, radius?: number): Wall => {
    let mark = nextMark(marks, 'W')
    while (ids.has(mark)) {
      marks.push(mark)
      mark = nextMark(marks, 'W')
    }
    marks.push(mark)
    ids.add(mark)
    const L = r2(Math.hypot(b[0] - a[0], b[1] - a[1]))
    return { id: mark, guid: uuid(), rev: 1, src: { kind: 'drawn' }, category: 'wall', mark, typeId, baseLevel: s.level, baseOffset: 0, ...top, length: L, x: r2(a[0]), y: r2(a[1]), angle: r2((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI), ...(radius ? { arc: { radius } } : {}) }
  }
  const created: Wall[] = [], reused: string[] = []
  const edges: NonNullable<Room['edges']> = []
  if (s.shape === 'round' && s.arcWalls) {
    const { pts, radius } = arcLoop(s)
    for (let i = 0; i < 4; i++) {
      const w = newWall(pts[i], pts[(i + 1) % 4], radius)
      created.push(w)
      edges.push({ wall: w.id })
    }
  } else {
    const poly = smartOutline(s)!
    const existing = levelWalls(m1, s.level).filter((w) => !arcOf(w))
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length]
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (L < 1) continue
      const d: P2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]
      // existing walls on this side's line: the stretch of the side each one covers
      const cover: { s0: number; s1: number; wall: Wall; rev: boolean }[] = []
      for (const w of existing) {
        const e = ends(w)
        if (Math.abs(e.dir[0] * d[1] - e.dir[1] * d[0]) > 1e-6) continue
        if (Math.abs((e.a[0] - a[0]) * d[1] - (e.a[1] - a[1]) * d[0]) > 1) continue
        const u0 = (e.a[0] - a[0]) * d[0] + (e.a[1] - a[1]) * d[1], u1 = (e.b[0] - a[0]) * d[0] + (e.b[1] - a[1]) * d[1]
        const s0 = Math.max(0, Math.min(u0, u1)), s1 = Math.min(L, Math.max(u0, u1))
        if (s1 - s0 > 1) cover.push({ s0, s1, wall: w, rev: e.dir[0] * d[0] + e.dir[1] * d[1] < 0 })
      }
      cover.sort((x, y) => x.s0 - y.s0)
      // the uncovered stretches get new walls; the side's edges in order along it
      let at = 0
      const pieces: { s0: number; edge: { wall: string; rev?: boolean } }[] = []
      for (const c of cover) {
        if (c.s0 - at > 10) {
          const w = newWall([a[0] + d[0] * at, a[1] + d[1] * at], [a[0] + d[0] * c.s0, a[1] + d[1] * c.s0])
          created.push(w)
          pieces.push({ s0: at, edge: { wall: w.id } })
        }
        if (!reused.includes(c.wall.id)) reused.push(c.wall.id)
        pieces.push({ s0: c.s0, edge: c.rev ? { wall: c.wall.id, rev: true } : { wall: c.wall.id } })
        at = Math.max(at, c.s1)
      }
      if (L - at > 10) {
        const w = newWall([a[0] + d[0] * at, a[1] + d[1] * at], b)
        created.push(w)
        pieces.push({ s0: at, edge: { wall: w.id } })
      }
      for (const p of pieces.sort((x, y) => x.s0 - y.s0)) if (!edges.length || edges.at(-1)!.wall !== p.edge.wall) edges.push(p.edge)
    }
    if (edges.length > 1 && edges[0].wall === edges.at(-1)!.wall) edges.pop()
  }
  const nums = m1.rooms.filter((r) => r.level === s.level).map((r) => Number(r.number)).filter(Number.isFinite)
  const idx = [...m1.levels].sort((a, b) => a.elevation - b.elevation).findIndex((l) => l.id === s.level) + 1
  const number = s.number ?? String(nums.length ? Math.max(...nums) + 1 : idx * 100 + 1)
  const room: Room = { id: uid('room'), guid: uuid(), rev: 1, src: { kind: 'drawn' }, category: 'room', number, name: s.name ?? 'Room', level: s.level, area: 0, edges }
  const next = deriveRooms(null, { ...m1, walls: [...m1.walls, ...created], rooms: [...m1.rooms, room] })
  const placed = next.rooms.find((r) => r.id === room.id)!
  if (!(placed.area > 0)) return { error: 'closure' }
  return { model: next, room: room.id, roomGuid: room.guid!, created: created.map((w) => w.id), reused }
}
