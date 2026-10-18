/**
 * Wall geometry for direct editing (v2.4): arc walls, sloped tops, joined ends, stretching and moving walls with
 * the walls joined to them, inner / outer face lengths, the host-wall rule for openings, the plan snaps and the
 * typed coordinates of the wall tool. Units: mm, X east, Y north, angles in degrees CCW from +X.
 *
 * A wall is stored as its start (x, y), direction `angle` and `length` (the chord for an arc wall). An arc wall
 * adds `arc.radius` (signed: positive bulges to the left of start → end), so its ends — and every join, snap and
 * room edge that uses them — are the same as for the straight wall between them.
 */
import { levelOf, typeOf, wallHeight, type BimModel, type Opening, type P2, type Wall } from './model'

const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI
const hyp = (a: P2, b: P2) => Math.hypot(b[0] - a[0], b[1] - a[1])
const r2 = (v: number) => Math.round(v * 100) / 100

/** Smallest opening clearance from either end of its host wall (mm): a door / window cut never reaches the corner. */
export const OPENING_CLEARANCE = 50
/** Ends closer than this are joined (mm). */
export const JOIN_TOL = 1

export function ends(w: Wall): { a: P2; b: P2; dir: P2 } {
  const x = w.x ?? 0, y = w.y ?? 0, t = rad(w.angle ?? 0)
  const dir: P2 = [Math.cos(t), Math.sin(t)]
  return { a: [x, y], b: [x + dir[0] * w.length, y + dir[1] * w.length], dir }
}

export interface ArcInfo {
  c: P2
  /** |radius| */
  r: number
  /** angle of the start point seen from the centre (rad) */
  a0: number
  /** signed sweep start → end (rad): negative = clockwise (a positive radius) */
  sweep: number
  /** centre-line arc length */
  len: number
}

/** The arc of an arc wall (null for a straight wall or a radius too small for the chord). */
export function arcOf(w: Wall): ArcInfo | null {
  const R = w.arc?.radius
  if (!R || !Number.isFinite(R)) return null
  const c = w.length
  const r = Math.abs(R)
  if (c <= 0 || r < c / 2 - 1e-6) return null
  const { a, dir } = ends(w)
  const n: P2 = [-dir[1], dir[0]]
  const h = Math.sqrt(Math.max(0, r * r - (c * c) / 4))
  const mid: P2 = [a[0] + (dir[0] * c) / 2, a[1] + (dir[1] * c) / 2]
  // a positive radius bulges left: the centre is on the right of the chord
  const s = R > 0 ? -1 : 1
  const cc: P2 = [mid[0] + n[0] * h * s, mid[1] + n[1] * h * s]
  const phi = 2 * Math.asin(Math.min(1, c / (2 * r)))
  return { c: cc, r, a0: Math.atan2(a[1] - cc[1], a[0] - cc[0]), sweep: R > 0 ? -phi : phi, len: r * phi }
}

/** Centre-line length (the arc length of an arc wall). */
export const wallRun = (w: Wall) => arcOf(w)?.len ?? w.length

/** Point and unit tangent at distance s along the centre line. */
export function pointAt(w: Wall, s: number): { p: P2; t: P2 } {
  const arc = arcOf(w)
  if (!arc) {
    const { a, dir } = ends(w)
    return { p: [a[0] + dir[0] * s, a[1] + dir[1] * s], t: dir }
  }
  const ang = arc.a0 + (arc.sweep >= 0 ? 1 : -1) * (s / arc.r)
  const p: P2 = [arc.c[0] + Math.cos(ang) * arc.r, arc.c[1] + Math.sin(ang) * arc.r]
  const k = arc.sweep >= 0 ? 1 : -1
  return { p, t: [-Math.sin(ang) * k, Math.cos(ang) * k] }
}

/** Centre line as a polyline (an arc sampled every ≤ 5°). */
export function centreLine(w: Wall): P2[] {
  const arc = arcOf(w)
  if (!arc) {
    const { a, b } = ends(w)
    return [a, b]
  }
  const k = Math.max(2, Math.ceil(Math.abs(arc.sweep) / rad(5)))
  return Array.from({ length: k + 1 }, (_, i) => pointAt(w, (arc.len * i) / k).p)
}

/** Plan outline of a wall: both faces (arcs sampled), centred on its line. */
export function wallOutline(m: BimModel, w: Wall): P2[] {
  const h = (typeOf(m, w)?.thickness ?? 200) / 2
  const arc = arcOf(w)
  if (!arc) {
    const { a, b, dir } = ends(w)
    const n: P2 = [-dir[1] * h, dir[0] * h]
    return [[a[0] + n[0], a[1] + n[1]], [b[0] + n[0], b[1] + n[1]], [b[0] - n[0], b[1] - n[1]], [a[0] - n[0], a[1] - n[1]]]
  }
  const L = arc.len
  const k = Math.max(2, Math.ceil(Math.abs(arc.sweep) / rad(5)))
  const left: P2[] = [], right: P2[] = []
  for (let i = 0; i <= k; i++) {
    const { p, t } = pointAt(w, (L * i) / k)
    left.push([p[0] - t[1] * h, p[1] + t[0] * h])
    right.push([p[0] + t[1] * h, p[1] - t[0] * h])
  }
  return [...left, ...right.reverse()]
}

/** Height at the start and at the end (a sloped top), and the mean. */
export function heightsOf(m: BimModel, w: Wall): { h0: number; h1: number; mean: number } {
  const h0 = wallHeight(m, w)
  const h1 = w.heightEnd !== undefined && w.heightEnd > 0 ? w.heightEnd : h0
  return { h0, h1, mean: (h0 + h1) / 2 }
}
export const heightAt = (m: BimModel, w: Wall, s: number) => {
  const { h0, h1 } = heightsOf(m, w)
  const L = wallRun(w) || 1
  return h0 + ((h1 - h0) * Math.min(L, Math.max(0, s))) / L
}

/** A wall placed between two points (keeps everything else, the arc radius clamped to the new chord). */
export function setEnds(w: Wall, a: P2, b: P2): Wall {
  const L = r2(hyp(a, b))
  const out: Wall = { ...w, x: r2(a[0]), y: r2(a[1]), length: L, angle: r2(deg(Math.atan2(b[1] - a[1], b[0] - a[0]))) }
  if (w.arc && Math.abs(w.arc.radius) < L / 2) out.arc = { radius: Math.sign(w.arc.radius) * (L / 2) }
  return out
}

/** Walls whose end touches this end (centre lines, within 1 mm), with which of their ends. */
export function joinedAt(m: BimModel, w: Wall, end: 'a' | 'b'): { wall: Wall; end: 'a' | 'b' }[] {
  const p = ends(w)[end]
  const out: { wall: Wall; end: 'a' | 'b' }[] = []
  for (const o of m.walls) {
    if (o.id === w.id || o.baseLevel !== w.baseLevel) continue
    const e = ends(o)
    if (hyp(e.a, p) <= JOIN_TOL) out.push({ wall: o, end: 'a' })
    else if (hyp(e.b, p) <= JOIN_TOL) out.push({ wall: o, end: 'b' })
  }
  return out
}

/** Openings keep their place in plan when their host's start moves (re-projected on the new line), and their
 *  offset along an arc wall. */
function keepOpenings(before: BimModel, after: BimModel, ids: Set<string>): BimModel {
  const fix = (o: Opening): Opening => {
    if (!ids.has(o.hostWall)) return o
    const wb = before.walls.find((w) => w.id === o.hostWall), wa = after.walls.find((w) => w.id === o.hostWall)
    if (!wb || !wa || arcOf(wb) || arcOf(wa)) return o
    const eb = ends(wb), ea = ends(wa)
    if (hyp(eb.a, ea.a) < 0.01) return o
    const c = pointAt(wb, o.offset + o.width / 2).p
    const s = (c[0] - ea.a[0]) * ea.dir[0] + (c[1] - ea.a[1]) * ea.dir[1]
    return { ...o, offset: r2(s - o.width / 2) }
  }
  return { ...after, doors: after.doors.map(fix), windows: after.windows.map(fix) }
}

function replaceWalls(m: BimModel, next: Map<string, Wall>): BimModel {
  return { ...m, walls: m.walls.map((w) => next.get(w.id) ?? w) }
}

/** One end of a wall moved to p; walls joined there follow (their end moves too) unless `follow` is off. */
export function moveWallEnd(m: BimModel, id: string, end: 'a' | 'b', p: P2, follow = true): BimModel {
  const w = m.walls.find((x) => x.id === id)
  if (!w) return m
  const e = ends(w)
  const next = new Map<string, Wall>()
  next.set(id, end === 'a' ? setEnds(w, p, e.b) : setEnds(w, e.a, p))
  if (follow)
    for (const j of joinedAt(m, w, end)) {
      const je = ends(j.wall)
      next.set(j.wall.id, j.end === 'a' ? setEnds(j.wall, p, je.b) : setEnds(j.wall, je.a, p))
    }
  return keepOpenings(m, replaceWalls(m, next), new Set(next.keys()))
}

/** A wall moved by d; the walls joined at its ends stretch to stay joined (unless `follow` is off). */
export function moveWall(m: BimModel, id: string, d: P2, follow = true): BimModel {
  const w = m.walls.find((x) => x.id === id)
  if (!w) return m
  const next = new Map<string, Wall>()
  next.set(id, { ...w, x: r2((w.x ?? 0) + d[0]), y: r2((w.y ?? 0) + d[1]) })
  if (follow)
    for (const end of ['a', 'b'] as const)
      for (const j of joinedAt(m, w, end)) {
        const cur = next.get(j.wall.id) ?? j.wall
        const je = ends(cur)
        const q: P2 = [ends(w)[end][0] + d[0], ends(w)[end][1] + d[1]]
        next.set(j.wall.id, j.end === 'a' ? setEnds(cur, q, je.b) : setEnds(cur, je.a, q))
      }
  return keepOpenings(m, replaceWalls(m, next), new Set(next.keys()))
}

/**
 * A wall's length set from its start (the typed length of Properties): its end moves along the wall. A wall joined
 * at that end at an angle moves with it as a whole and the walls at its far end stretch — the room stays closed
 * (a 4200 × 3600 room becomes 4500 × 3600). A wall continuing in line is shortened / lengthened from that end.
 */
export function stretchWall(m: BimModel, id: string, length: number): BimModel {
  const w = m.walls.find((x) => x.id === id)
  if (!w || length <= 0) return m
  const e = ends(w)
  const v: P2 = [e.dir[0] * (length - w.length), e.dir[1] * (length - w.length)]
  const next = new Map<string, Wall>()
  next.set(id, { ...w, length: r2(length) })
  for (const j of joinedAt(m, w, 'b')) {
    const je = ends(j.wall)
    const cross = Math.abs(je.dir[0] * e.dir[1] - je.dir[1] * e.dir[0])
    if (cross < 1e-6) {
      // in line: the joined end follows
      next.set(j.wall.id, j.end === 'a' ? setEnds(j.wall, [je.a[0] + v[0], je.a[1] + v[1]], je.b) : setEnds(j.wall, je.a, [je.b[0] + v[0], je.b[1] + v[1]]))
      continue
    }
    // at an angle: the whole wall moves, and the walls joined at its far end stretch with it
    next.set(j.wall.id, { ...j.wall, x: r2((j.wall.x ?? 0) + v[0]), y: r2((j.wall.y ?? 0) + v[1]) })
    const far = j.end === 'a' ? 'b' : 'a'
    for (const k of joinedAt(m, j.wall, far)) {
      if (k.wall.id === id || next.has(k.wall.id)) continue
      const ke = ends(k.wall)
      next.set(k.wall.id, k.end === 'a' ? setEnds(k.wall, [ke.a[0] + v[0], ke.a[1] + v[1]], ke.b) : setEnds(k.wall, ke.a, [ke.b[0] + v[0], ke.b[1] + v[1]]))
    }
  }
  return keepOpenings(m, replaceWalls(m, next), new Set(next.keys()))
}

/** Lengths of the centre line and of both faces (left / right of start → end), the faces trimmed or extended at
 *  joined ends: at a corner the face on the other wall's side stops at its near face, the other one runs to its far
 *  face; at a T (the end on another wall's side) both stop at the near face. */
export function faceLengths(m: BimModel, w: Wall): { centre: number; left: number; right: number } {
  const t = typeOf(m, w)?.thickness ?? 200
  const arc = arcOf(w)
  if (arc) {
    // concentric arcs: the left face is inside when the arc turns left (a negative radius)
    const inner = arc.len - (Math.abs(arc.sweep) * t) / 2, outer = arc.len + (Math.abs(arc.sweep) * t) / 2
    return { centre: arc.len, left: (w.arc!.radius < 0 ? inner : outer), right: (w.arc!.radius < 0 ? outer : inner) }
  }
  const e = ends(w)
  let left = w.length, right = w.length
  for (const end of ['a', 'b'] as const) {
    const p = e[end]
    // the direction from this end into the wall
    const into: P2 = end === 'a' ? e.dir : [-e.dir[0], -e.dir[1]]
    const add = (side: 'left' | 'right', d: number) => (side === 'left' ? (left += d) : (right += d))
    const js = joinedAt(m, w, end)
    if (js.length) {
      for (const j of js.slice(0, 1)) {
        const je = ends(j.wall)
        const away: P2 = j.end === 'a' ? je.dir : [-je.dir[0], -je.dir[1]]
        const sin = into[0] * away[1] - into[1] * away[0]
        if (Math.abs(sin) < 1e-6) continue
        const tj = (typeOf(m, j.wall)?.thickness ?? 200) / 2
        const ext = tj / Math.abs(sin)
        // the other wall leaves towards the left of `into` when sin > 0; "left of the wall" flips at the end
        const towards = (sin > 0) === (end === 'a') ? 'left' : 'right'
        add(towards, -ext)
        add(towards === 'left' ? 'right' : 'left', ext)
      }
      continue
    }
    // a T: this end on the side of another wall
    for (const o of m.walls) {
      if (o.id === w.id || o.baseLevel !== w.baseLevel || arcOf(o)) continue
      const oe = ends(o)
      const L2 = o.length * o.length || 1
      const u = ((p[0] - oe.a[0]) * oe.dir[0] * o.length + (p[1] - oe.a[1]) * oe.dir[1] * o.length) / L2
      const dd = Math.abs((p[0] - oe.a[0]) * oe.dir[1] - (p[1] - oe.a[1]) * oe.dir[0])
      if (u > 0.001 && u < 0.999 && dd <= JOIN_TOL) {
        const sin = Math.abs(into[0] * oe.dir[1] - into[1] * oe.dir[0])
        if (sin < 1e-6) continue
        const ext = (typeOf(m, o)?.thickness ?? 200) / 2 / sin
        left -= ext
        right -= ext
        break
      }
    }
  }
  return { centre: w.length, left: r2(left), right: r2(right) }
}

/* ---------- the host-wall rule (V24-009) ---------- */

export type OpeningProblem = 'noHost' | 'beyond' | 'nearEnd' | 'tooTall' | 'bad'

/** Why an opening cannot be cut in its host wall (null: it fits). It must lie within the wall's run with
 *  OPENING_CLEARANCE mm left at each end, and below the wall's top. */
export function openingProblem(m: BimModel, o: Opening): OpeningProblem | null {
  const w = m.walls.find((x) => x.id === o.hostWall)
  if (!w) return 'noHost'
  if (!(o.width > 0) || !(o.height > 0) || o.sill < 0) return 'bad'
  const L = wallRun(w)
  if (o.offset < 0 || o.offset + o.width > L) return 'beyond'
  if (o.offset < OPENING_CLEARANCE || o.offset + o.width > L - OPENING_CLEARANCE) return 'nearEnd'
  const top = Math.min(heightAt(m, w, o.offset), heightAt(m, w, o.offset + o.width))
  if (o.sill + o.height > top) return 'tooTall'
  return null
}

/** The nearest valid offset for an opening of this width on a wall (clamped between the clearances). */
export const clampOffset = (w: Wall, width: number, offset: number) => Math.round(Math.min(wallRun(w) - width - OPENING_CLEARANCE, Math.max(OPENING_CLEARANCE, offset)))

/* ---------- plan snaps (SP05) ---------- */

export type SnapKind = 'end' | 'mid' | 'int' | 'perp' | 'near' | 'grid' | 'none'
export interface Snap {
  p: P2
  kind: SnapKind
  /** the wall it snapped to */
  wall?: string
}

function segInt(a: P2, b: P2, c: P2, d: P2): P2 | null {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1]
  const den = rx * sy - ry * sx
  if (Math.abs(den) < 1e-9) return null
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null
  return [a[0] + rx * t, a[1] + ry * t]
}

function foot(p: P2, a: P2, b: P2): { q: P2; t: number; d: number } {
  const vx = b[0] - a[0], vy = b[1] - a[1]
  const L2 = vx * vx + vy * vy || 1
  const t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2
  const tc = Math.max(0, Math.min(1, t))
  const q: P2 = [a[0] + vx * tc, a[1] + vy * tc]
  return { q, t, d: hyp(p, q) }
}

/**
 * Object snap on the walls of a plan, in priority order within `tol` (mm): endpoint, midpoint, intersection of
 * centre lines, perpendicular from the last point, nearest point on a centre line or a face. `extra` adds other
 * endpoints (columns, grids, slab corners). null: nothing near.
 */
export function snapWalls(m: BimModel, walls: Wall[], raw: P2, tol: number, last?: P2 | null, extra: P2[] = []): Snap | null {
  let best: Snap | null = null, bd = tol
  const take = (p: P2, kind: SnapKind, wall?: string, bias = 0) => {
    const d = hyp(p, raw) + bias
    if (d < bd) ((best = { p: [r2(p[0]), r2(p[1])], kind, wall }), (bd = d))
  }
  for (const w of walls) {
    const e = ends(w)
    take(e.a, 'end', w.id)
    take(e.b, 'end', w.id)
  }
  for (const p of extra) take(p, 'end')
  if (best) return best
  for (const w of walls) take(pointAt(w, wallRun(w) / 2).p, 'mid', w.id)
  if (best) return best
  for (let i = 0; i < walls.length; i++)
    for (let j = i + 1; j < walls.length; j++) {
      const a = ends(walls[i]), b = ends(walls[j])
      const x = segInt(a.a, a.b, b.a, b.b)
      if (x) take(x, 'int', walls[i].id)
    }
  if (best) return best
  if (last)
    for (const w of walls) {
      if (arcOf(w)) continue
      const e = ends(w)
      const f = foot(last, e.a, e.b)
      if (f.t > 0 && f.t < 1) take(f.q, 'perp', w.id)
    }
  if (best) return best
  for (const w of walls) {
    if (arcOf(w)) {
      const line = centreLine(w)
      for (let i = 0; i + 1 < line.length; i++) take(foot(raw, line[i], line[i + 1]).q, 'near', w.id, 0.5)
      continue
    }
    const poly = wallOutline(m, w)
    const e = ends(w)
    take(foot(raw, e.a, e.b).q, 'near', w.id, 0.5)
    // the faces: left (poly 0 → 1) and right (poly 3 → 2)
    take(foot(raw, poly[0], poly[1]).q, 'near', w.id)
    take(foot(raw, poly[3], poly[2]).q, 'near', w.id)
  }
  return best
}

/** Angle lock: the point from `last` at the nearest multiple of `stepDeg`, same distance. */
export function lockAngle(last: P2, p: P2, stepDeg = 15): P2 {
  const L = hyp(last, p)
  const a = Math.round(deg(Math.atan2(p[1] - last[1], p[0] - last[0])) / stepDeg) * stepDeg
  return [r2(last[0] + Math.cos(rad(a)) * L), r2(last[1] + Math.sin(rad(a)) * L)]
}

/* ---------- typed coordinates (SP04) ---------- */

export type Typed = { kind: 'point'; p: P2 } | { kind: 'radius'; r: number } | { kind: 'error' }

/**
 * Keyboard input of the wall tool, as in CAD: "4200" — that distance from the last point towards the cursor;
 * "4200<90" or "@4200<90" — distance and angle from the last point; "@1200,-300" — relative; "1200,3400" —
 * absolute; "R2500" / "r-2500" — the radius of the next (arc) wall. Numbers in mm, "," or ";" between x and y.
 */
export function parseTyped(input: string, last: P2 | null, cursor: P2 | null): Typed {
  const s = input.trim().replace(/\s+/g, '')
  if (!s) return { kind: 'error' }
  const num = (x: string) => (/^[-+]?\d+(\.\d+)?$/.test(x) ? Number(x) : NaN)
  const rm = /^[rR]([-+]?\d+(\.\d+)?)$/.exec(s)
  if (rm) return { kind: 'radius', r: Number(rm[1]) }
  const rel = s.startsWith('@')
  const body = rel ? s.slice(1) : s
  const polar = /^([-+]?\d+(\.\d+)?)<([-+]?\d+(\.\d+)?)$/.exec(body)
  if (polar) {
    if (!last) return { kind: 'error' }
    const L = Number(polar[1]), a = rad(Number(polar[3]))
    return { kind: 'point', p: [r2(last[0] + Math.cos(a) * L), r2(last[1] + Math.sin(a) * L)] }
  }
  const xy = body.split(/[,;]/)
  if (xy.length === 2) {
    const x = num(xy[0]), y = num(xy[1])
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { kind: 'error' }
    if (rel) return last ? { kind: 'point', p: [r2(last[0] + x), r2(last[1] + y)] } : { kind: 'error' }
    return { kind: 'point', p: [x, y] }
  }
  const L = num(body)
  if (!Number.isFinite(L) || !last) return { kind: 'error' }
  // direct distance: along the cursor direction (east when the cursor sits on the last point)
  const dx = cursor ? cursor[0] - last[0] : 1, dy = cursor ? cursor[1] - last[1] : 0
  const d = Math.hypot(dx, dy)
  const ux = d > 1e-6 ? dx / d : 1, uy = d > 1e-6 ? dy / d : 0
  return { kind: 'point', p: [r2(last[0] + ux * L), r2(last[1] + uy * L)] }
}

/** Signed radius of the arc through a, b and a third point q (positive: q on the left of a → b); null if in line. */
export function radiusThrough(a: P2, b: P2, q: P2): number | null {
  const c = hyp(a, b)
  const cross = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0])
  if (c < 1 || Math.abs(cross) < 1e-6 * c * c) return null
  const A = hyp(a, q), B = hyp(b, q)
  const R = (A * B * c) / (2 * Math.abs(cross / 2) * 2)
  return r2((cross > 0 ? 1 : -1) * R)
}

export const levelElev = (m: BimModel, id: string) => levelOf(m, id)?.elevation ?? 0
