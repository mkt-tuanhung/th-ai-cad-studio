/**
 * Triangulated surface (TIN) from survey points: Delaunay triangulation (or the surveyor's own faces from
 * LandXML), long-edge trimming at the survey boundary, elevation queries through a uniform grid index,
 * contour lines by linear interpolation on the triangles, and sampling along an alignment.
 */
import Delaunator from 'delaunator'
import type { Survey } from './survey'
import type { Profile } from './model'

export interface Tin {
  x: Float64Array
  y: Float64Array
  z: Float64Array
  /** Triangles: vertex index triples. */
  tri: Uint32Array
  bounds: { x0: number; y0: number; x1: number; y1: number }
  zmin: number
  zmax: number
  /** Plan area covered by the triangles (m²). */
  area: number
  /** Edge-length limit used to trim the outer triangles (m); null when the file's own faces are used. */
  maxEdge: number | null
  grid: { nx: number; ny: number; cell: number; cells: Uint32Array[] }
}

export function buildTin(s: Survey, maxEdge?: number | null): Tin {
  const n = s.x.length
  const x = Float64Array.from(s.x), y = Float64Array.from(s.y), z = Float64Array.from(s.z)
  let tri: Uint32Array
  let limit: number | null = null
  if (s.faces && s.faces.length >= 3) tri = Uint32Array.from(s.faces)
  else {
    const coords = new Float64Array(n * 2)
    for (let i = 0; i < n; i++) (coords[2 * i] = x[i]), (coords[2 * i + 1] = y[i])
    const all = new Delaunator(coords).triangles
    // trim the convex-hull slivers: drop triangles with an edge longer than the limit
    // (default 4 × the median edge, a common survey boundary heuristic)
    const edges: number[] = []
    for (let t = 0; t < all.length; t += 3) for (let k = 0; k < 3; k++) edges.push(len(x, y, all[t + k], all[t + ((k + 1) % 3)]))
    edges.sort((a, b) => a - b)
    limit = maxEdge ?? 4 * (edges[edges.length >> 1] ?? 0)
    const keep: number[] = []
    for (let t = 0; t < all.length; t += 3) {
      const a = all[t], b = all[t + 1], c = all[t + 2]
      if (len(x, y, a, b) <= limit && len(x, y, b, c) <= limit && len(x, y, c, a) <= limit) keep.push(a, b, c)
    }
    tri = Uint32Array.from(keep)
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, zmin = Infinity, zmax = -Infinity
  for (let i = 0; i < n; i++) {
    x0 = Math.min(x0, x[i]), x1 = Math.max(x1, x[i]), y0 = Math.min(y0, y[i]), y1 = Math.max(y1, y[i])
    zmin = Math.min(zmin, z[i]), zmax = Math.max(zmax, z[i])
  }
  let area = 0
  for (let t = 0; t < tri.length; t += 3) area += Math.abs(cross(x, y, tri[t], tri[t + 1], tri[t + 2])) / 2
  const tin: Tin = { x, y, z, tri, bounds: { x0, y0, x1, y1 }, zmin, zmax, area, maxEdge: limit, grid: { nx: 1, ny: 1, cell: 1, cells: [] } }
  tin.grid = index(tin)
  return tin
}

const len = (x: Float64Array, y: Float64Array, a: number, b: number) => Math.hypot(x[a] - x[b], y[a] - y[b])
const cross = (x: Float64Array, y: Float64Array, a: number, b: number, c: number) => (x[b] - x[a]) * (y[c] - y[a]) - (y[b] - y[a]) * (x[c] - x[a])

function index(t: Tin) {
  const { x0, y0, x1, y1 } = t.bounds
  const ntri = t.tri.length / 3
  const cell = Math.max(1e-6, Math.sqrt(((x1 - x0) * (y1 - y0)) / Math.max(1, ntri)) * 2)
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell) + 1), ny = Math.max(1, Math.ceil((y1 - y0) / cell) + 1)
  const lists: number[][] = Array.from({ length: nx * ny }, () => [])
  for (let k = 0; k < ntri; k++) {
    const a = t.tri[3 * k], b = t.tri[3 * k + 1], c = t.tri[3 * k + 2]
    const i0 = Math.floor((Math.min(t.x[a], t.x[b], t.x[c]) - x0) / cell), i1 = Math.floor((Math.max(t.x[a], t.x[b], t.x[c]) - x0) / cell)
    const j0 = Math.floor((Math.min(t.y[a], t.y[b], t.y[c]) - y0) / cell), j1 = Math.floor((Math.max(t.y[a], t.y[b], t.y[c]) - y0) / cell)
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) lists[j * nx + i].push(k)
  }
  return { nx, ny, cell, cells: lists.map((l) => Uint32Array.from(l)) }
}

/** Elevation at (px, py) by linear interpolation in the containing triangle; null outside the surface. */
export function elevationAt(t: Tin, px: number, py: number): number | null {
  const { nx, ny, cell, cells } = t.grid
  const i = Math.floor((px - t.bounds.x0) / cell), j = Math.floor((py - t.bounds.y0) / cell)
  if (i < 0 || j < 0 || i >= nx || j >= ny) return null
  for (const k of cells[j * nx + i]) {
    const a = t.tri[3 * k], b = t.tri[3 * k + 1], c = t.tri[3 * k + 2]
    const d = (t.y[b] - t.y[c]) * (t.x[a] - t.x[c]) + (t.x[c] - t.x[b]) * (t.y[a] - t.y[c])
    if (d === 0) continue
    const l1 = ((t.y[b] - t.y[c]) * (px - t.x[c]) + (t.x[c] - t.x[b]) * (py - t.y[c])) / d
    const l2 = ((t.y[c] - t.y[a]) * (px - t.x[c]) + (t.x[a] - t.x[c]) * (py - t.y[c])) / d
    const l3 = 1 - l1 - l2
    if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) return l1 * t.z[a] + l2 * t.z[b] + l3 * t.z[c]
  }
  return null
}

export interface Contour {
  level: number
  major: boolean
  lines: [number, number][][]
}

/** Contour lines every `interval` m (every 5th is major), segments joined into polylines. */
export function contours(t: Tin, interval: number, maxLevels = 400): Contour[] {
  const first = Math.ceil(t.zmin / interval) * interval
  const levels: number[] = []
  for (let v = first; v <= t.zmax + 1e-9 && levels.length < maxLevels; v += interval) levels.push(Math.round(v * 1e6) / 1e6)
  const out: Contour[] = []
  for (const lv of levels) {
    const segs: [number, number, number, number][] = []
    for (let k = 0; k < t.tri.length; k += 3) {
      const v = [t.tri[k], t.tri[k + 1], t.tri[k + 2]]
      const pts: [number, number][] = []
      for (let e = 0; e < 3; e++) {
        const a = v[e], b = v[(e + 1) % 3]
        const za = t.z[a] - lv, zb = t.z[b] - lv
        // half-open rule: a vertex exactly on the level counts as above, so no segment is emitted twice
        if ((za < 0) !== (zb < 0)) {
          const r = za / (za - zb)
          pts.push([t.x[a] + r * (t.x[b] - t.x[a]), t.y[a] + r * (t.y[b] - t.y[a])])
        }
      }
      if (pts.length === 2) segs.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1]])
    }
    out.push({ level: lv, major: Math.abs(Math.round(lv / (interval * 5)) * interval * 5 - lv) < 1e-6, lines: join(segs) })
  }
  return out
}

function join(segs: [number, number, number, number][]): [number, number][][] {
  const key = (x: number, y: number) => `${Math.round(x * 1000)}:${Math.round(y * 1000)}`
  const ends = new Map<string, number[]>()
  segs.forEach((s, i) => {
    for (const k of [key(s[0], s[1]), key(s[2], s[3])]) ends.set(k, [...(ends.get(k) ?? []), i])
  })
  const used = new Uint8Array(segs.length)
  const lines: [number, number][][] = []
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue
    used[i] = 1
    const line: [number, number][] = [[segs[i][0], segs[i][1]], [segs[i][2], segs[i][3]]]
    for (const dir of [1, 0]) {
      for (;;) {
        const p = dir ? line[line.length - 1] : line[0]
        const next = (ends.get(key(p[0], p[1])) ?? []).find((j) => !used[j])
        if (next === undefined) break
        used[next] = 1
        const s = segs[next]
        const q: [number, number] = key(s[0], s[1]) === key(p[0], p[1]) ? [s[2], s[3]] : [s[0], s[1]]
        if (dir) line.push(q)
        else line.unshift(q)
      }
    }
    lines.push(line)
  }
  return lines
}

/* ------------------------------------------------------------------ alignment geometry */

export type Polyline = [number, number][]

export function polyLength(p: Polyline): number {
  let l = 0
  for (let i = 1; i < p.length; i++) l += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])
  return l
}

/** Point and unit direction at chainage `s` along the polyline. */
export function pointAt(p: Polyline, s: number): { x: number; y: number; dx: number; dy: number } {
  let acc = 0
  for (let i = 1; i < p.length; i++) {
    const l = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])
    if (s <= acc + l || i === p.length - 1) {
      const r = l ? Math.min(1, Math.max(0, (s - acc) / l)) : 0
      return { x: p[i - 1][0] + r * (p[i][0] - p[i - 1][0]), y: p[i - 1][1] + r * (p[i][1] - p[i - 1][1]), dx: l ? (p[i][0] - p[i - 1][0]) / l : 1, dy: l ? (p[i][1] - p[i - 1][1]) / l : 0 }
    }
    acc += l
  }
  return { x: p[0][0], y: p[0][1], dx: 1, dy: 0 }
}

/** Chainage of the closest point of the polyline to (x, y), and its offset. */
export function stationOf(p: Polyline, x: number, y: number): { s: number; offset: number } {
  let best = { s: 0, offset: Infinity }, acc = 0
  for (let i = 1; i < p.length; i++) {
    const [ax, ay] = p[i - 1], [bx, by] = p[i]
    const l = Math.hypot(bx - ax, by - ay)
    const r = l ? Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (l * l))) : 0
    const d = Math.hypot(x - (ax + r * (bx - ax)), y - (ay + r * (by - ay)))
    if (d < Math.abs(best.offset)) best = { s: acc + r * l, offset: d }
    acc += l
  }
  return best
}

/** Existing-ground profile along the alignment every `step` m; stations outside the surface are left out. */
export function groundProfile(t: Tin, p: Polyline, step = 20): { profile: Profile; missing: number[] } {
  const L = polyLength(p)
  const profile: Profile = [], missing: number[] = []
  for (let s = 0; s <= L + 1e-6; s += step) {
    const st = Math.min(s, L)
    const q = pointAt(p, st)
    const z = elevationAt(t, q.x, q.y)
    if (z === null) missing.push(st)
    else profile.push([Math.round(st * 1000) / 1000, Math.round(z * 1000) / 1000])
  }
  return { profile, missing }
}

/** Ground cross line at chainage s, offsets −half … +half (m, left negative), every `step` m. */
export function crossLine(t: Tin, p: Polyline, s: number, half = 40, step = 1): [number, number][] {
  const q = pointAt(p, s)
  const out: [number, number][] = []
  for (let o = -half; o <= half + 1e-9; o += step) {
    // positive offsets are right of the direction of travel: (dy, −dx)
    const z = elevationAt(t, q.x + q.dy * o, q.y - q.dx * o)
    if (z !== null) out.push([o, z])
  }
  return out
}
