import type { Entity, Vec2 } from './types'

export const v = (x: number, y: number): Vec2 => ({ x, y })
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s })
export const len = (a: Vec2): number => Math.hypot(a.x, a.y)
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y)
export const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
export const norm = (a: Vec2): Vec2 => {
  const l = len(a) || 1
  return { x: a.x / l, y: a.y / l }
}
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x })
export const angleOf = (a: Vec2): number => Math.atan2(a.y, a.x)

export interface BBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / (ab.x * ab.x + ab.y * ab.y || 1)))
  return dist(p, add(a, scale(ab, t)))
}

const normAngle = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)

export function angleInArc(ang: number, start: number, end: number): boolean {
  const s = normAngle(start)
  const e = normAngle(end)
  const x = normAngle(ang)
  return s <= e ? x >= s && x <= e : x >= s || x <= e
}

/** Geometry of a dimension: extension-line feet, dimension line ends, text anchor/angle. */
export function dimensionGeometry(a: Vec2, b: Vec2, offset: number) {
  const dir = norm(sub(b, a))
  const n = perp(dir)
  const da = add(a, scale(n, offset))
  const db = add(b, scale(n, offset))
  let ang = angleOf(dir)
  // keep text readable (never upside down)
  if (ang > Math.PI / 2 + 1e-6 || ang < -Math.PI / 2 + 1e-6) ang += Math.PI
  return { da, db, textAt: mid(da, db), angle: ang, n }
}

export function measured(a: Vec2, b: Vec2): number {
  return dist(a, b)
}

export function formatLength(mm: number): string {
  return Math.round(mm).toString()
}

/** Distance from point to entity (world units). */
export function distanceTo(e: Entity, p: Vec2): number {
  switch (e.kind) {
    case 'line':
      return distToSegment(p, e.a, e.b)
    case 'polyline': {
      let d = Infinity
      const n = e.pts.length
      for (let i = 0; i < n - 1; i++) d = Math.min(d, distToSegment(p, e.pts[i], e.pts[i + 1]))
      if (e.closed && n > 2) d = Math.min(d, distToSegment(p, e.pts[n - 1], e.pts[0]))
      if (e.filled && e.closed && pointInPolygon(p, e.pts)) d = 0
      return d
    }
    case 'circle':
      return Math.abs(dist(p, e.c) - e.r)
    case 'arc': {
      const ang = angleOf(sub(p, e.c))
      if (angleInArc(ang, e.start, e.end)) return Math.abs(dist(p, e.c) - e.r)
      return Math.min(dist(p, arcPoint(e.c, e.r, e.start)), dist(p, arcPoint(e.c, e.r, e.end)))
    }
    case 'text': {
      const b = textBox(e.p, e.height, e.value, e.rotation, e.align)
      return pointInPolygon(p, b) ? 0 : Math.min(...b.map((q, i) => distToSegment(p, q, b[(i + 1) % 4])))
    }
    case 'dimension': {
      const g = dimensionGeometry(e.a, e.b, e.offset)
      return Math.min(distToSegment(p, g.da, g.db), distToSegment(p, e.a, g.da), distToSegment(p, e.b, g.db))
    }
  }
}

export const arcPoint = (c: Vec2, r: number, a: number): Vec2 => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) })

/** Approximate text box (Roboto-ish advance 0.56em). */
export function textBox(p: Vec2, h: number, value: string, rot: number, align: 'left' | 'center'): Vec2[] {
  const w = value.length * h * 0.56
  const x0 = align === 'center' ? -w / 2 : 0
  const local = [v(x0, -h * 0.15), v(x0 + w, -h * 0.15), v(x0 + w, h * 0.95), v(x0, h * 0.95)]
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  return local.map((q) => v(p.x + q.x * c - q.y * s, p.y + q.x * s + q.y * c))
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-12) + a.x) inside = !inside
  }
  return inside
}

export function bboxOf(e: Entity): BBox {
  const pts: Vec2[] = []
  switch (e.kind) {
    case 'line':
      pts.push(e.a, e.b)
      break
    case 'polyline':
      for (const q of e.pts) pts.push(q)
      break
    case 'circle':
    case 'arc':
      pts.push(v(e.c.x - e.r, e.c.y - e.r), v(e.c.x + e.r, e.c.y + e.r))
      break
    case 'text':
      pts.push(...textBox(e.p, e.height, e.value, e.rotation, e.align))
      break
    case 'dimension': {
      const g = dimensionGeometry(e.a, e.b, e.offset)
      pts.push(e.a, e.b, g.da, g.db)
      break
    }
  }
  // loops, not Math.min(...array): spreading 100k+ values overflows the call stack
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const q of pts) {
    if (q.x < minX) minX = q.x
    if (q.x > maxX) maxX = q.x
    if (q.y < minY) minY = q.y
    if (q.y > maxY) maxY = q.y
  }
  return { minX, minY, maxX, maxY }
}

export function unionBBox(boxes: BBox[]): BBox | null {
  if (!boxes.length) return null
  const u = { ...boxes[0] }
  for (const b of boxes) {
    if (b.minX < u.minX) u.minX = b.minX
    if (b.minY < u.minY) u.minY = b.minY
    if (b.maxX > u.maxX) u.maxX = b.maxX
    if (b.maxY > u.maxY) u.maxY = b.maxY
  }
  return u
}

export const bboxInside = (inner: BBox, outer: BBox) =>
  inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY
export const bboxIntersects = (a: BBox, b: BBox) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY

/** Object-snap candidates: endpoints, midpoints, centres. */
export type SnapKind = 'endpoint' | 'midpoint' | 'center' | 'grid'
export function snapPoints(e: Entity): { p: Vec2; kind: SnapKind }[] {
  switch (e.kind) {
    case 'line':
      return [
        { p: e.a, kind: 'endpoint' },
        { p: e.b, kind: 'endpoint' },
        { p: mid(e.a, e.b), kind: 'midpoint' },
      ]
    case 'polyline': {
      const out: { p: Vec2; kind: SnapKind }[] = e.pts.map((p) => ({ p, kind: 'endpoint' as const }))
      for (let i = 0; i < e.pts.length - 1; i++) out.push({ p: mid(e.pts[i], e.pts[i + 1]), kind: 'midpoint' })
      if (e.closed && e.pts.length > 2) out.push({ p: mid(e.pts[e.pts.length - 1], e.pts[0]), kind: 'midpoint' })
      return out
    }
    case 'circle':
      return [{ p: e.c, kind: 'center' }]
    case 'arc':
      return [
        { p: e.c, kind: 'center' },
        { p: arcPoint(e.c, e.r, e.start), kind: 'endpoint' },
        { p: arcPoint(e.c, e.r, e.end), kind: 'endpoint' },
      ]
    case 'text':
      return [{ p: e.p, kind: 'endpoint' }]
    case 'dimension':
      return [
        { p: e.a, kind: 'endpoint' },
        { p: e.b, kind: 'endpoint' },
      ]
  }
}

/** Circle through three points (for 3-point ARC). Null when collinear. */
export function circleFrom3(p1: Vec2, p2: Vec2, p3: Vec2): { c: Vec2; r: number } | null {
  const d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y))
  if (Math.abs(d) < 1e-9) return null
  const s1 = p1.x ** 2 + p1.y ** 2
  const s2 = p2.x ** 2 + p2.y ** 2
  const s3 = p3.x ** 2 + p3.y ** 2
  const c = v((s1 * (p2.y - p3.y) + s2 * (p3.y - p1.y) + s3 * (p1.y - p2.y)) / d, (s1 * (p3.x - p2.x) + s2 * (p1.x - p3.x) + s3 * (p2.x - p1.x)) / d)
  return { c, r: dist(c, p1) }
}

/** 3-point arc → start/end angles (counter-clockwise from start through mid to end). */
export function arcFrom3(p1: Vec2, p2: Vec2, p3: Vec2) {
  const circ = circleFrom3(p1, p2, p3)
  if (!circ) return null
  const a1 = angleOf(sub(p1, circ.c))
  const a2 = angleOf(sub(p2, circ.c))
  const a3 = angleOf(sub(p3, circ.c))
  return angleInArc(a2, a1, a3) ? { ...circ, start: a1, end: a3 } : { ...circ, start: a3, end: a1 }
}

export function translateEntity(e: Entity, d: Vec2): Entity {
  switch (e.kind) {
    case 'line':
      return { ...e, a: add(e.a, d), b: add(e.b, d) }
    case 'polyline':
      return { ...e, pts: e.pts.map((p) => add(p, d)) }
    case 'circle':
    case 'arc':
      return { ...e, c: add(e.c, d) }
    case 'text':
      return { ...e, p: add(e.p, d) }
    case 'dimension':
      return { ...e, a: add(e.a, d), b: add(e.b, d) }
  }
}

/** Rotation about the origin (radians, counter-clockwise). */
export function rotateEntity(e: Entity, a: number): Entity {
  if (!a) return e
  const c = Math.cos(a), s = Math.sin(a)
  const r = (p: Vec2): Vec2 => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c })
  switch (e.kind) {
    case 'line':
      return { ...e, a: r(e.a), b: r(e.b) }
    case 'polyline':
      return { ...e, pts: e.pts.map(r) }
    case 'circle':
      return { ...e, c: r(e.c) }
    case 'arc':
      return { ...e, c: r(e.c), start: e.start + a, end: e.end + a }
    case 'text':
      return { ...e, p: r(e.p), rotation: e.rotation + a }
    case 'dimension':
      return { ...e, a: r(e.a), b: r(e.b) }
  }
}
