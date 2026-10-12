/**
 * Editing geometry for TRIM, HATCH and OFFSET on the 2D model: intersections between lines, polyline
 * segments, circles and arcs; trimming the picked part between the nearest cutting edges; solid hatch of a
 * closed boundary (picked or found around a point); offsets of polylines (mitred) and arcs; ear-clipping
 * triangulation for writing filled areas as SOLIDs (DXF R12 / DWG).
 */
import type { Entity, Vec2 } from './types'
import { add, angleInArc, arcPoint, dist, norm, perp, pointInPolygon, scale, sub } from './geometry'

const TAU = Math.PI * 2
const normAng = (a: number) => ((a % TAU) + TAU) % TAU

type Seg = { a: Vec2; b: Vec2 }
type Circ = { c: Vec2; r: number; start?: number; end?: number }

/** Straight segments and circles / arcs of an entity (cutting edges). */
function pieces(e: Entity): { segs: Seg[]; circs: Circ[] } {
  if (e.kind === 'line') return { segs: [{ a: e.a, b: e.b }], circs: [] }
  if (e.kind === 'polyline') {
    const segs: Seg[] = []
    for (let i = 0; i + 1 < e.pts.length; i++) segs.push({ a: e.pts[i], b: e.pts[i + 1] })
    if (e.closed && e.pts.length > 2) segs.push({ a: e.pts[e.pts.length - 1], b: e.pts[0] })
    return { segs, circs: [] }
  }
  if (e.kind === 'circle') return { segs: [], circs: [{ c: e.c, r: e.r }] }
  if (e.kind === 'arc') return { segs: [], circs: [{ c: e.c, r: e.r, start: e.start, end: e.end }] }
  return { segs: [], circs: [] }
}

const onArc = (c: Circ, p: Vec2) => c.start === undefined || angleInArc(Math.atan2(p.y - c.c.y, p.x - c.c.x), c.start, c.end!)

function segSeg(s: Seg, t: Seg): Vec2[] {
  const r = sub(s.b, s.a), q = sub(t.b, t.a)
  const den = r.x * q.y - r.y * q.x
  if (Math.abs(den) < 1e-12) return []
  const w = sub(t.a, s.a)
  const u = (w.x * q.y - w.y * q.x) / den, v = (w.x * r.y - w.y * r.x) / den
  return u >= -1e-9 && u <= 1 + 1e-9 && v >= -1e-9 && v <= 1 + 1e-9 ? [add(s.a, scale(r, u))] : []
}
function segCirc(s: Seg, c: Circ): Vec2[] {
  const d = sub(s.b, s.a), f = sub(s.a, c.c)
  const A = d.x * d.x + d.y * d.y, B = 2 * (f.x * d.x + f.y * d.y), C = f.x * f.x + f.y * f.y - c.r * c.r
  const disc = B * B - 4 * A * C
  if (A < 1e-12 || disc < 0) return []
  const sq = Math.sqrt(disc)
  return [(-B - sq) / (2 * A), (-B + sq) / (2 * A)].filter((u) => u >= -1e-9 && u <= 1 + 1e-9).map((u) => add(s.a, scale(d, u))).filter((p) => onArc(c, p))
}
function circCirc(a: Circ, b: Circ): Vec2[] {
  const d = dist(a.c, b.c)
  if (d < 1e-9 || d > a.r + b.r || d < Math.abs(a.r - b.r)) return []
  const x = (d * d + a.r * a.r - b.r * b.r) / (2 * d), h = Math.sqrt(Math.max(0, a.r * a.r - x * x))
  const u = scale(sub(b.c, a.c), 1 / d), m = add(a.c, scale(u, x)), n = perp(u)
  return [add(m, scale(n, h)), add(m, scale(n, -h))].filter((p) => onArc(a, p) && onArc(b, p))
}

/** Intersection points of entity `e` with all the other entities. */
export function intersectionsWith(e: Entity, others: Entity[]): Vec2[] {
  const A = pieces(e)
  const out: Vec2[] = []
  for (const o of others) {
    if (o.id === e.id) continue
    const B = pieces(o)
    for (const s of A.segs) {
      for (const t of B.segs) out.push(...segSeg(s, t))
      for (const c of B.circs) out.push(...segCirc(s, c))
    }
    for (const c of A.circs) {
      for (const t of B.segs) out.push(...segCirc(t, c))
      for (const k of B.circs) out.push(...circCirc(c, k))
    }
  }
  return out
}

/**
 * TRIM at pick point p: the part of `e` between the two nearest cutting points around p is removed.
 * Returns the remaining pieces (0, 1 or 2 entities; the first keeps e's id) or null if nothing cuts e there.
 */
export function trimEntity(e: Entity, others: Entity[], p: Vec2, newId: () => string): Entity[] | null {
  const cuts = intersectionsWith(e, others)
  if (!cuts.length) return null
  if (e.kind === 'line') {
    const d = sub(e.b, e.a), L2 = d.x * d.x + d.y * d.y
    const t = (q: Vec2) => ((q.x - e.a.x) * d.x + (q.y - e.a.y) * d.y) / L2
    const tp = t(p), ts = cuts.map(t).filter((x) => x > 1e-6 && x < 1 - 1e-6)
    const lo = Math.max(-Infinity, ...ts.filter((x) => x < tp)), hi = Math.min(Infinity, ...ts.filter((x) => x > tp))
    if (lo === -Infinity && hi === Infinity) return null
    const at = (x: number) => add(e.a, scale(d, x))
    const out: Entity[] = []
    if (lo > -Infinity) out.push({ ...e, a: e.a, b: at(lo) })
    if (hi < Infinity) out.push({ ...e, id: out.length ? newId() : e.id, a: at(hi), b: e.b })
    return out
  }
  if (e.kind === 'circle' || e.kind === 'arc') {
    const ang = (q: Vec2) => normAng(Math.atan2(q.y - e.c.y, q.x - e.c.x))
    const a0 = e.kind === 'arc' ? normAng(e.start) : 0
    const span = e.kind === 'arc' ? normAng(e.end - e.start) || TAU : TAU
    // angles measured from the arc start, counter-clockwise
    const rel = (q: Vec2) => normAng(ang(q) - a0)
    const ap = rel(p), as = cuts.map(rel).filter((x) => (e.kind === 'circle' ? x >= 0 && x < TAU - 1e-9 : x > 1e-6 && x < span - 1e-6))
    if (e.kind === 'circle') {
      if (as.length < 2) return null
      // the circle becomes the arc that stays: from the next cut after p round to the previous one
      const sorted = [...as].sort((a, b) => a - b)
      const hi = sorted.find((x) => x > ap) ?? sorted[0]
      const lo = [...sorted].reverse().find((x) => x < ap) ?? sorted[sorted.length - 1]
      return [{ ...e, kind: 'arc', start: normAng(a0 + hi), end: normAng(a0 + lo) } as Entity]
    }
    const lo = Math.max(-Infinity, ...as.filter((x) => x < ap)), hi = Math.min(Infinity, ...as.filter((x) => x > ap))
    if (lo === -Infinity && hi === Infinity) return null
    const out: Entity[] = []
    if (lo > -Infinity) out.push({ ...e, start: e.start, end: normAng(a0 + lo) })
    if (hi < Infinity) out.push({ ...e, id: out.length ? newId() : e.id, start: normAng(a0 + hi), end: e.end })
    return out
  }
  if (e.kind === 'polyline') {
    // work on the polyline as a chain of chainage; closed ones are opened at the cut
    const pts = e.closed ? [...e.pts, e.pts[0]] : e.pts
    const acc = [0]
    for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + dist(pts[i - 1], pts[i]))
    const chain = (q: Vec2) => {
      let best = { d: Infinity, s: 0 }
      for (let i = 0; i + 1 < pts.length; i++) {
        const d = sub(pts[i + 1], pts[i]), L2 = d.x * d.x + d.y * d.y || 1
        const u = Math.max(0, Math.min(1, ((q.x - pts[i].x) * d.x + (q.y - pts[i].y) * d.y) / L2))
        const pr = add(pts[i], scale(d, u))
        if (dist(pr, q) < best.d) best = { d: dist(pr, q), s: acc[i] + u * Math.sqrt(L2) }
      }
      return best.s
    }
    const total = acc[acc.length - 1]
    const sp = chain(p), ss = cuts.map(chain).filter((x) => x > 1e-6 && x < total - 1e-6)
    if (!ss.length) return null
    const point = (s: number) => {
      for (let i = 0; i + 1 < pts.length; i++) if (s <= acc[i + 1] + 1e-9) return add(pts[i], scale(sub(pts[i + 1], pts[i]), (s - acc[i]) / Math.max(1e-12, acc[i + 1] - acc[i])))
      return pts[pts.length - 1]
    }
    const between = (s0: number, s1: number) => [point(s0), ...pts.filter((_, i) => acc[i] > s0 + 1e-9 && acc[i] < s1 - 1e-9), point(s1)]
    if (e.closed) {
      if (ss.length < 2) return null
      const sorted = [...ss].sort((a, b) => a - b)
      // keep from the first cut after p round to the last cut before p (chainage, wrapping once)
      const hi = sorted.find((x) => x > sp) ?? sorted[0] + total
      const lo = ([...sorted].reverse().find((x) => x < sp) ?? sorted[sorted.length - 1] - total) + total
      const wrap = (x: number) => ((x % total) + total) % total
      const keep = [point(wrap(hi))]
      const verts = acc.slice(0, -1)
      for (const cycle of [0, total]) for (let k = 0; k < verts.length; k++) if (verts[k] + cycle > hi + 1e-9 && verts[k] + cycle < lo - 1e-9) keep.push(pts[k])
      keep.push(point(wrap(lo)))
      return [{ ...e, closed: false, filled: false, pts: keep }]
    }
    const lo = Math.max(-Infinity, ...ss.filter((x) => x < sp)), hi = Math.min(Infinity, ...ss.filter((x) => x > sp))
    const out: Entity[] = []
    if (lo > -Infinity) out.push({ ...e, pts: between(0, lo) })
    if (hi < Infinity) out.push({ ...e, id: out.length ? newId() : e.id, pts: between(hi, total) })
    return out.filter((x) => x.kind !== 'polyline' || x.pts.length >= 2)
  }
  return null
}

/** Closed boundary for HATCH: the picked closed polyline / circle, or the smallest one around p. */
export function hatchBoundary(entities: Entity[], p: Vec2, hitId: string | null): Vec2[] | null {
  const ring = (e: Entity): Vec2[] | null =>
    e.kind === 'polyline' && e.closed && e.pts.length >= 3 ? e.pts : e.kind === 'circle' ? Array.from({ length: 72 }, (_, i) => arcPoint(e.c, e.r, (i / 72) * TAU)) : null
  const hit = hitId ? entities.find((e) => e.id === hitId) : null
  const picked = hit && ring(hit)
  if (picked) return picked
  let best: { pts: Vec2[]; area: number } | null = null
  for (const e of entities) {
    const r = ring(e)
    if (!r || !pointInPolygon(p, r)) continue
    const a = Math.abs(polyArea(r))
    if (!best || a < best.area) best = { pts: r, area: a }
  }
  return best?.pts ?? null
}

export const polyArea = (pts: Vec2[]) => pts.reduce((s, q, i) => s + q.x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * q.y, 0) / 2

/** OFFSET of a polyline (mitred corners, side of p) or an arc (radius ± d). */
export function offsetMore(e: Entity, d: number, side: Vec2): Entity | null {
  if (e.kind === 'arc') {
    const r = dist(side, e.c) > e.r ? e.r + d : e.r - d
    return r > 0 ? { ...e, r } : null
  }
  if (e.kind !== 'polyline' || e.pts.length < 2) return null
  const pts = e.pts
  const n = pts.length
  const segN = (i: number) => perp(norm(sub(pts[(i + 1) % n], pts[i])))
  // which side: compare with the nearest segment's normal
  let near = 0, nd = Infinity
  for (let i = 0; i + (e.closed ? 0 : 1) < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], dd = sub(b, a), L2 = dd.x * dd.x + dd.y * dd.y || 1
    const u = Math.max(0, Math.min(1, ((side.x - a.x) * dd.x + (side.y - a.y) * dd.y) / L2))
    const q = add(a, scale(dd, u))
    if (dist(q, side) < nd) (nd = dist(q, side)), (near = i)
  }
  const sn = segN(near)
  const sign = (side.x - pts[near].x) * sn.x + (side.y - pts[near].y) * sn.y >= 0 ? 1 : -1
  const out = pts.map((p, i) => {
    const hasPrev = e.closed || i > 0, hasNext = e.closed || i < n - 1
    const n1 = hasPrev ? segN((i - 1 + n) % n) : null, n2 = hasNext ? segN(i) : null
    if (!n1) return add(p, scale(n2!, d * sign))
    if (!n2) return add(p, scale(n1, d * sign))
    const m = norm(add(n1, n2))
    const k = d / Math.max(0.2, m.x * n1.x + m.y * n1.y)
    return add(p, scale(m, k * sign))
  })
  return { ...e, pts: out }
}

/** Ear-clipping triangulation of a simple polygon (for SOLID export of filled areas). */
export function triangulate(pts: Vec2[]): [Vec2, Vec2, Vec2][] {
  const idx = pts.map((_, i) => i)
  if (polyArea(pts) < 0) idx.reverse()
  const tris: [Vec2, Vec2, Vec2][] = []
  const cross = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  let guard = 0
  while (idx.length > 3 && guard++ < 10000) {
    let cut = false
    for (let k = 0; k < idx.length; k++) {
      const a = pts[idx[(k - 1 + idx.length) % idx.length]], b = pts[idx[k]], c = pts[idx[(k + 1) % idx.length]]
      if (cross(a, b, c) <= 1e-12) continue
      if (idx.some((j) => { const q = pts[j]; return q !== a && q !== b && q !== c && pointInPolygon(q, [a, b, c]) })) continue
      tris.push([a, b, c])
      idx.splice(k, 1)
      cut = true
      break
    }
    if (!cut) break
  }
  if (idx.length === 3) tris.push([pts[idx[0]], pts[idx[1]], pts[idx[2]]])
  return tris
}
