/**
 * Civil 3D model for the native OCCT engine: the canal corridor (lining bottom and side slopes, water at
 * normal depth, 3 m crests at top of bank + 0.30 m, embankment / cut slopes daylighting to the ground),
 * the existing ground (the survey TIN when imported, else a strip from the sample ground profile) and the
 * culverts. Surfaces are triangle meshes; culverts are solids. Coordinates: metres → mm, origin at the
 * alignment start; heights exaggerated by `ve` (shown on the view).
 */
import { box, hex, type Scene } from '../engine3d/scene'
import { groundOf, hydraulics, interp, type CivilModel } from './model'
import { elevationAt, pointAt, polyLength, stationOf, type Polyline, type Tin } from './tin'
import { tinOf } from './surveyModel'

const CREST = 3.0
const ROAD = 0.3

export interface CorridorFrame {
  /** Plan point and unit direction at chainage s (m). */
  at: (s: number) => { x: number; y: number; dx: number; dy: number }
  /** Existing ground at a plan point (m), null outside the survey. */
  ground: (x: number, y: number, s: number) => number | null
  origin: [number, number]
}

export function corridorFrame(m: CivilModel, tin: Tin | null): CorridorFrame {
  const plan: Polyline | null = m.plan && m.plan.length >= 2 ? m.plan : null
  const len = m.alignment.end - m.alignment.start
  const at = plan ? (s: number) => pointAt(plan, Math.min(polyLength(plan), Math.max(0, s - m.alignment.start))) : (s: number) => ({ x: s - m.alignment.start, y: 0, dx: 1, dy: 0 })
  const EG = groundOf(m)
  const ground = tin && plan ? (x: number, y: number) => elevationAt(tin, x, y) : (_x: number, _y: number, s: number) => interp(EG, s)
  const o = at(m.alignment.start)
  void len
  return { at, ground, origin: [o.x, o.y] }
}

/** Points of the design template at a station: offsets (m, + = left) and elevations, from the left daylight to the right one. */
export function template(m: CivilModel, s: number, f: CorridorFrame): { o: number; z: number }[] {
  const { H } = hydraulics(m)
  const { bottomWidth: b, sideSlope: k } = m.params
  const inv = interp(m.invert, s)
  const half = b / 2 + k * H
  const crestZ = inv + H + ROAD
  const p = f.at(s)
  const side = (dir: 1 | -1) => {
    // outer slope 2:1 from the crest edge down (fill) or up (cut) to the ground
    const edge = half + CREST
    let o = edge, z = crestZ
    for (let d = 0.5; d <= 40; d += 0.5) {
      const off = edge + d
      const g = f.ground(p.x - p.dy * off * dir, p.y + p.dx * off * dir, s)
      if (g === null) break
      const zs = crestZ > g ? crestZ - d / 2 : crestZ + d / 2
      o = off
      z = zs
      if ((crestZ > g && zs <= g) || (crestZ <= g && zs >= g)) {
        z = g
        break
      }
    }
    return { o: o * dir, z }
  }
  const L = side(1), R = side(-1)
  return [L, { o: half + CREST, z: crestZ }, { o: half, z: crestZ }, { o: half, z: inv + H }, { o: b / 2, z: inv }, { o: -b / 2, z: inv }, { o: -half, z: inv + H }, { o: -half, z: crestZ }, { o: -(half + CREST), z: crestZ }, R]
}

/**
 * Corridor of a route read from a drawing: the existing ground and the design surface lofted between consecutive
 * drawn cross sections (strips at every vertex offset of either section, across their common width). Straight by chainage unless a
 * plan alignment exists. No water: such a drawing gives no discharge.
 */
function drawnScene(m: CivilModel, ve: number): Scene & { stats: { stations: number; triangles: number; terrain: 'survey' | 'sample' | 'drawing' } } {
  const secs = [...(m.sections ?? [])].sort((a, b) => a.station - b.station)
  const f = corridorFrame(m, null)
  const [ox, oy] = f.origin
  const zRef = Math.min(...secs.flatMap((x) => [...x.ground, ...x.design].map(([, z]) => z))) - 1
  // drawn offsets are + to the right; the frame's are + to the left
  const world = (st: number, o: number, z: number): number[] => {
    const p = f.at(st)
    return [(p.x + p.dy * o - ox) * 1000, (p.y - p.dx * o - oy) * 1000, (z - zRef) * ve * 1000]
  }
  const zAt = (line: [number, number][], o: number) => {
    if (o <= line[0][0]) return line[0][1]
    for (let i = 1; i < line.length; i++) if (o <= line[i][0]) { const [a, za] = line[i - 1], [b, zb] = line[i]; return b - a < 1e-9 ? Math.max(za, zb) : za + ((zb - za) * (o - a)) / (b - a) }
    return line[line.length - 1][1]
  }
  const range = (l: [number, number][]) => [Math.min(...l.map(([o]) => o)), Math.max(...l.map(([o]) => o))] as const
  const terrain: number[] = [], design: number[] = []
  const quad = (out: number[], a: number[], b: number[], c: number[], d: number[]) => out.push(...a, ...b, ...c, ...a, ...c, ...d)
  const loft = (out: number[], A: (typeof secs)[number], B: (typeof secs)[number], pick: (x: (typeof secs)[number]) => [number, number][], dz = 0) => {
    const la = pick(A), lb = pick(B)
    if (la.length < 2 || lb.length < 2) return
    const [a0, a1] = range(la), [b0, b1] = range(lb)
    const lo = Math.max(a0, b0), hi = Math.min(a1, b1)
    // strips at every vertex of either line: exact for piecewise-linear sections, and few triangles
    const cuts = [...new Set([lo, hi, ...la.map(([o]) => o), ...lb.map(([o]) => o)].filter((o) => o >= lo && o <= hi).map((o) => Math.round(o * 1000) / 1000))].sort((x, y) => x - y)
    for (let j = 1; j < cuts.length; j++) {
      const o = cuts[j - 1], o2 = cuts[j]
      if (o2 - o < 1e-3) continue
      quad(out, world(A.station, o, zAt(la, o) + dz), world(B.station, o, zAt(lb, o) + dz), world(B.station, o2, zAt(lb, o2) + dz), world(A.station, o2, zAt(la, o2) + dz))
    }
  }
  for (let i = 1; i < secs.length; i++) {
    loft(terrain, secs[i - 1], secs[i], (x) => x.ground, -0.02)
    loft(design, secs[i - 1], secs[i], (x) => x.design)
  }
  const items: Scene['items'] = [
    { id: 'terrain', rgb: hex('#9fae7f'), transparency: 0.35, parts: [{ k: 'mesh', o: [0, 0, 0], s: [0, 0, 0], tri: terrain }] },
    { id: 'banks', rgb: hex('#c8b98f'), parts: [{ k: 'mesh', o: [0, 0, 0], s: [0, 0, 0], tri: design }] },
  ]
  return { items, stats: { stations: secs.length, triangles: (terrain.length + design.length) / 9, terrain: 'drawing' } }
}

export function civilScene(m: CivilModel, ve = 3, step = 10): Scene & { stats: { stations: number; triangles: number; terrain: 'survey' | 'sample' | 'drawing' } } {
  if (m.sections && m.sections.length >= 2) return drawnScene(m, ve)
  const tin = tinOf(m)
  const f = corridorFrame(m, tin)
  const [ox, oy] = f.origin
  const zRef = Math.min(...m.invert.map(([, z]) => z)) - 1
  const P = (x: number, y: number, z: number): [number, number, number] => [(x - ox) * 1000, (y - oy) * 1000, (z - zRef) * ve * 1000]
  const stations: number[] = []
  for (let s = m.alignment.start; s < m.alignment.end; s += step) stations.push(s)
  stations.push(m.alignment.end)
  const hy = hydraulics(m)
  const k = m.params.sideSlope, b = m.params.bottomWidth
  const world = (s: number, o: number, z: number) => {
    const p = f.at(s)
    return P(p.x - p.dy * o, p.y + p.dx * o, z)
  }
  const lining: number[] = [], banks: number[] = [], water: number[] = []
  const quad = (out: number[], a: number[], bq: number[], c: number[], d: number[]) => out.push(...a, ...bq, ...c, ...a, ...c, ...d)
  for (let i = 1; i < stations.length; i++) {
    const s0 = stations[i - 1], s1 = stations[i]
    const t0 = template(m, s0, f), t1 = template(m, s1, f)
    for (let j = 1; j < t0.length; j++) {
      const out = j >= 4 && j <= 6 ? lining : banks
      quad(out, world(s0, t0[j - 1].o, t0[j - 1].z), world(s1, t1[j - 1].o, t1[j - 1].z), world(s1, t1[j].o, t1[j].z), world(s0, t0[j].o, t0[j].z))
    }
    const w0 = b / 2 + k * hy.y, i0 = interp(m.invert, s0) + hy.y, i1 = interp(m.invert, s1) + hy.y
    quad(water, world(s0, w0, i0), world(s1, w0, i1), world(s1, -w0, i1), world(s0, -w0, i0))
  }
  // existing ground, opened where the corridor (daylight to daylight) replaces it
  const terrain: number[] = []
  const daylight = stations.map((x) => {
    const tp = template(m, x, f)
    return [tp[0].o, tp[tp.length - 1].o] as const
  })
  const widthAt = (x: number) => daylight[Math.max(0, Math.min(daylight.length - 1, Math.round((x - m.alignment.start) / step)))]
  if (tin) {
    const n = tin.tri.length / 3
    const every = Math.max(1, Math.ceil(n / 30000)) // keep the scene light on very large surveys
    const plan = m.plan && m.plan.length >= 2 ? m.plan : null
    for (let t = 0; t < n; t += every) {
      const a = tin.tri[t * 3], bb = tin.tri[t * 3 + 1], c = tin.tri[t * 3 + 2]
      if (plan) {
        const cx = (tin.x[a] + tin.x[bb] + tin.x[c]) / 3, cy = (tin.y[a] + tin.y[bb] + tin.y[c]) / 3
        const so = stationOf(plan, cx, cy)
        const st = so.s + m.alignment.start
        if (st >= m.alignment.start && st <= m.alignment.end) {
          const [l, r] = widthAt(st)
          // signed offset, positive to the left like the template
          const q = pointAt(plan, so.s)
          const signed = ((cx - q.x) * -q.dy + (cy - q.y) * q.dx >= 0 ? 1 : -1) * so.offset
          if (signed <= l && signed >= r) continue
        }
      }
      for (const id of [a, bb, c]) terrain.push(...P(tin.x[id], tin.y[id], tin.z[id]))
    }
  } else {
    const W = 60
    for (let i = 1; i < stations.length; i++) {
      const s0 = stations[i - 1], s1 = stations[i]
      const g0 = interp(groundOf(m), s0), g1 = interp(groundOf(m), s1)
      const [l0, r0] = daylight[i - 1], [l1, r1] = daylight[i]
      quad(terrain, world(s0, W, g0 - 0.02), world(s1, W, g1 - 0.02), world(s1, l1, g1 - 0.02), world(s0, l0, g0 - 0.02))
      quad(terrain, world(s0, r0, g0 - 0.02), world(s1, r1, g1 - 0.02), world(s1, -W, g1 - 0.02), world(s0, -W, g0 - 0.02))
    }
  }
  const items: Scene['items'] = [
    { id: 'terrain', rgb: hex(tin ? '#9fae7f' : '#b3b79a'), transparency: 0.15, parts: [{ k: 'mesh', o: [0, 0, 0], s: [0, 0, 0], tri: terrain }] },
    { id: 'banks', rgb: hex('#c8b98f'), parts: [{ k: 'mesh', o: [0, 0, 0], s: [0, 0, 0], tri: banks }] },
    { id: 'lining', rgb: hex('#c9c6c0'), mat: 'glossy', parts: [{ k: 'mesh', o: [0, 0, 0], s: [0, 0, 0], tri: lining }] },
    { id: 'water', rgb: hex('#3f86c6'), transparency: 0.35, mat: 'glass', parts: [{ k: 'mesh', o: [0, 0, 0], s: [0, 0, 0], tri: water }] },
  ]
  // culverts: concrete box under a 12 m road crossing, across the channel
  for (const c of m.culverts) {
    const p = f.at(c.station)
    const [x, y, z] = P(p.x, p.y, c.invert)
    const top = hy.H + ROAD
    const Lc = c.length * 1000, Wc = 4.4 * 1000
    // box frame: X along the channel (width of the box), Y across (culvert length)
    items.push({ id: c.id, rgb: hex('#8d8a85'), parts: [{ ...box(-Wc / 2, -Lc / 2, 0, Wc, Lc, top * ve * 1000), o: [x - (p.dx * Wc) / 2 + (p.dy * Lc) / 2, y - (p.dy * Wc) / 2 - (p.dx * Lc) / 2, z], x: [p.dx, p.dy, 0], z: [0, 0, 1] }] })
  }
  return { items, stats: { stations: stations.length, triangles: (terrain.length + banks.length + lining.length + water.length) / 9, terrain: tin ? 'survey' : 'sample' } }
}
