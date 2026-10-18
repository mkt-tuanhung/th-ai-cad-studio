/**
 * Plan / 3D measurement helpers for Space Planning: exact axis-aligned bounds of the scene primitives,
 * oriented footprints, room wall faces. Everything in mm, plan X/Y, Z up — the same numbers the 3D engine
 * builds, so a check here is a check of the 3D model.
 */
import type { Prim, V3 } from '../engine3d/scene'
import type { Pt, Room } from './model'

export interface Box3 {
  x0: number
  y0: number
  z0: number
  x1: number
  y1: number
  z1: number
}
export const EMPTY: Box3 = { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity }

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const nrm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** Bounds of one primitive (boxes exact; cylinders / cones exact for any axis; others by their frame extents). */
export function primBounds(p: Prim): Box3 {
  const o = p.o
  const z = nrm(p.z ?? [0, 0, 1])
  if (p.k === 'box') {
    const x = nrm(p.x ?? [1, 0, 0])
    const y = cross(z, x)
    const b = { ...EMPTY }
    for (const i of [0, 1]) for (const j of [0, 1]) for (const k of [0, 1]) {
      const c: V3 = [0, 1, 2].map((a) => o[a] + x[a] * p.s[0] * i + y[a] * p.s[1] * j + z[a] * p.s[2] * k) as V3
      grow(b, c)
    }
    return b
  }
  if (p.k === 'cyl' || p.k === 'cone') {
    const r = p.k === 'cyl' ? p.s[0] : Math.max(p.s[0], p.s[1])
    const h = p.k === 'cyl' ? p.s[1] : p.s[2]
    const top: V3 = [o[0] + z[0] * h, o[1] + z[1] * h, o[2] + z[2] * h]
    // a disc of radius r normal to z extends r·sqrt(1 − z_a²) along axis a
    const e = [0, 1, 2].map((a) => r * Math.sqrt(Math.max(0, 1 - z[a] * z[a])))
    const b = { ...EMPTY }
    for (const c of [o, top]) {
      grow(b, [c[0] - e[0], c[1] - e[1], c[2] - e[2]])
      grow(b, [c[0] + e[0], c[1] + e[1], c[2] + e[2]])
    }
    return b
  }
  if (p.k === 'prism' && p.pts) {
    const b = { ...EMPTY }
    for (const [x, y] of p.pts) {
      grow(b, [o[0] + x, o[1] + y, o[2]])
      grow(b, [o[0] + x, o[1] + y, o[2] + p.s[0]])
    }
    return b
  }
  const r = Math.max(p.s[0], p.s[1], p.s[2])
  return { x0: o[0] - r, y0: o[1] - r, z0: o[2] - r, x1: o[0] + r, y1: o[1] + r, z1: o[2] + r }
}

export function grow(b: Box3, c: V3 | Box3) {
  if (Array.isArray(c)) {
    b.x0 = Math.min(b.x0, c[0]); b.y0 = Math.min(b.y0, c[1]); b.z0 = Math.min(b.z0, c[2])
    b.x1 = Math.max(b.x1, c[0]); b.y1 = Math.max(b.y1, c[1]); b.z1 = Math.max(b.z1, c[2])
  } else {
    b.x0 = Math.min(b.x0, c.x0); b.y0 = Math.min(b.y0, c.y0); b.z0 = Math.min(b.z0, c.z0)
    b.x1 = Math.max(b.x1, c.x1); b.y1 = Math.max(b.y1, c.y1); b.z1 = Math.max(b.z1, c.z1)
  }
  return b
}

export function primsBounds(ps: Prim[]): Box3 {
  const b = { ...EMPTY }
  for (const p of ps) grow(b, primBounds(p))
  return b
}

export const size = (b: Box3) => ({ w: b.x1 - b.x0, d: b.y1 - b.y0, h: b.z1 - b.z0 })
export const r1 = (v: number) => Math.round(v * 10) / 10

/* ---------------- 2D ---------------- */

export type P2 = [number, number]

/** Corners of a W × D footprint centred at (x, y), rotated rot° (front −Y before rotation). */
export function footprint(x: number, y: number, w: number, d: number, rot: number): P2[] {
  const a = (rot * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a)
  return ([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] as P2[]).map(([u, v]) => [x + u * c - v * sn, y + u * sn + v * c])
}

/** Local (item frame) → plan. */
export function toPlan(x: number, y: number, rot: number, u: number, v: number): P2 {
  const a = (rot * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a)
  return [x + u * c - v * sn, y + u * sn + v * c]
}

/** Convex polygon overlap depth along the separating axes (SAT); ≤ 0 = apart (|value| = gap on the best axis). */
export function satOverlap(a: P2[], b: P2[]): number {
  let best = Infinity
  for (const poly of [a, b])
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length]
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1
      const n: P2 = [-(q[1] - p[1]) / l, (q[0] - p[0]) / l]
      const pa = a.map((v) => v[0] * n[0] + v[1] * n[1]), pb = b.map((v) => v[0] * n[0] + v[1] * n[1])
      const o = Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb))
      best = Math.min(best, o)
    }
  return best
}

/** Plan polygon of a primitive (box footprint, or a 16-gon for vertical cylinders / cones). */
export function primPoly(p: Prim): P2[] {
  if (p.k === 'box') {
    const x = nrm(p.x ?? [1, 0, 0])
    const z = nrm(p.z ?? [0, 0, 1])
    const y = cross(z, x)
    const o = p.o
    const pts: P2[] = []
    for (const [i, j] of [[0, 0], [1, 0], [1, 1], [0, 1]]) pts.push([o[0] + x[0] * p.s[0] * i + y[0] * p.s[1] * j, o[1] + x[1] * p.s[0] * i + y[1] * p.s[1] * j])
    return pts
  }
  const b = primBounds(p)
  if (p.k === 'cyl' || p.k === 'cone') {
    const r = Math.min(b.x1 - b.x0, b.y1 - b.y0) / 2, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2
    return Array.from({ length: 16 }, (_, k) => [cx + r * Math.cos((k * Math.PI) / 8), cy + r * Math.sin((k * Math.PI) / 8)] as P2)
  }
  return [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]]
}

export function inPoly(o: Pt[] | P2[], x: number, y: number) {
  const pts = (o as (Pt | P2)[]).map((p) => (Array.isArray(p) ? p : [p.x, p.y])) as P2[]
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
    if (pts[i][1] > y !== pts[j][1] > y && x < ((pts[j][0] - pts[i][0]) * (y - pts[i][1])) / (pts[j][1] - pts[i][1]) + pts[i][0]) inside = !inside
  return inside
}

/** Same half-partition the 3D walls are drawn with (interior/scene.ts WALL_T). */
export const WALL_FACE = 50

export interface WallFace {
  index: number
  /** Inner face line (the outline edge moved WALL_FACE into the room). */
  a: P2
  b: P2
  len: number
  /** Unit direction a → b and inward normal. */
  dir: P2
  n: P2
  /** Rotation of an item backed onto this wall (its front faces the room). */
  rot: number
}

/** Wall faces of a room (counter-clockwise outline → inward normal on the left of each edge). */
export function wallFaces(r: Room): WallFace[] {
  const o = r.outline
  const out: WallFace[] = []
  // orientation: positive area = counter-clockwise
  let a2 = 0
  for (let i = 0; i < o.length; i++) a2 += o[i].x * o[(i + 1) % o.length].y - o[(i + 1) % o.length].x * o[i].y
  const sgn = a2 >= 0 ? 1 : -1
  for (let k = 0; k < o.length; k++) {
    const p = o[k], q = o[(k + 1) % o.length]
    const len = Math.hypot(q.x - p.x, q.y - p.y)
    if (len < 1) continue
    const dir: P2 = [(q.x - p.x) / len, (q.y - p.y) / len]
    const n: P2 = [-dir[1] * sgn, dir[0] * sgn]
    const rot = norm180((Math.atan2(n[0], -n[1]) * 180) / Math.PI)
    out.push({ index: k, a: [p.x + n[0] * WALL_FACE, p.y + n[1] * WALL_FACE], b: [q.x + n[0] * WALL_FACE, q.y + n[1] * WALL_FACE], len, dir, n, rot })
  }
  return out
}

export const norm180 = (d: number) => {
  let r = ((d % 360) + 360) % 360
  if (r > 180) r -= 360
  return Math.round(r * 1e6) / 1e6 === -180 ? 180 : Math.round(r * 1e6) / 1e6
}

/** Signed distance of a point in front of a wall face (positive = inside the room). */
export const faceDist = (f: WallFace, x: number, y: number) => (x - f.a[0]) * f.n[0] + (y - f.a[1]) * f.n[1]
/** Position of a point along a wall face (0 at a). */
export const faceAlong = (f: WallFace, x: number, y: number) => (x - f.a[0]) * f.dir[0] + (y - f.a[1]) * f.dir[1]

export function roomBox(r: Room) {
  const xs = r.outline.map((p) => p.x), ys = r.outline.map((p) => p.y)
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
}

/** The room's usable interior polygon (outline shrunk by the wall face) for rectangles; the outline otherwise. */
export function innerPoly(r: Room): P2[] {
  const f = wallFaces(r)
  if (f.length < 3) return r.outline.map((p) => [p.x, p.y])
  // intersect consecutive face lines
  const out: P2[] = []
  for (let i = 0; i < f.length; i++) {
    const A = f[(i + f.length - 1) % f.length], B = f[i]
    const den = A.dir[0] * B.dir[1] - A.dir[1] * B.dir[0]
    if (Math.abs(den) < 1e-9) {
      out.push(B.a)
      continue
    }
    const t = ((B.a[0] - A.a[0]) * B.dir[1] - (B.a[1] - A.a[1]) * B.dir[0]) / den
    out.push([A.a[0] + A.dir[0] * t, A.a[1] + A.dir[1] * t])
  }
  return out
}

export function polyArea(p: P2[]) {
  let a = 0
  for (let i = 0; i < p.length; i++) a += p[i][0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * p[i][1]
  return Math.abs(a) / 2
}
