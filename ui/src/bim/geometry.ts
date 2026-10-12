/**
 * Plan geometry of the BIM model: wall lines, what is cut by a level's plan, hit testing, room boundaries
 * found from the surrounding walls, and the next free marks. Units: mm, X east, Y north.
 */
import { levelOf, typeOf, type BimModel, type ElementRef, type Level, type Opening, type P2, type Wall } from './model'

const rad = (d: number) => (d * Math.PI) / 180
export const dist = (a: P2, b: P2) => Math.hypot(b[0] - a[0], b[1] - a[1])

/** Start and end of a wall's centre line. */
export function wallEnds(w: Wall): { a: P2; b: P2; dir: P2 } {
  const x = w.x ?? 0, y = w.y ?? 0, t = rad(w.angle ?? 0)
  const dir: P2 = [Math.cos(t), Math.sin(t)]
  return { a: [x, y], b: [x + dir[0] * w.length, y + dir[1] * w.length], dir }
}

/** Plan cut height above a level (architectural convention). */
export const CUT = 1200

const elev = (m: BimModel, id: string) => levelOf(m, id)?.elevation ?? 0

/** Elements of a vertical extent show on a level's plan when the cut plane passes through them. */
export function cutBy(m: BimModel, level: string, base: string, top: string, baseOffset = 0, topOffset = 0): boolean {
  const z = elev(m, level) + CUT
  return elev(m, base) + baseOffset <= z && z < elev(m, top) + topOffset
}

export const wallsOn = (m: BimModel, level: string) => m.walls.filter((w) => cutBy(m, level, w.baseLevel, w.topLevel, w.baseOffset, w.topOffset))

/** Level above `id` (or `id` + 3 m if it is the highest). */
export function nextLevel(m: BimModel, id: string): Level | undefined {
  const sorted = [...m.levels].sort((a, b) => a.elevation - b.elevation)
  const i = sorted.findIndex((l) => l.id === id)
  return sorted[i + 1]
}

/** Footprint polygon of a wall (centred on its line). */
export function wallPoly(m: BimModel, w: Wall): P2[] {
  const { a, b, dir } = wallEnds(w)
  const h = (typeOf(m, w)?.thickness ?? 200) / 2
  const n: P2 = [-dir[1] * h, dir[0] * h]
  return [[a[0] + n[0], a[1] + n[1]], [b[0] + n[0], b[1] + n[1]], [b[0] - n[0], b[1] - n[1]], [a[0] - n[0], a[1] - n[1]]]
}

/** Point on the host wall line at an opening's offset + t·width. */
export function openingPoint(w: Wall, o: Opening, t: number): P2 {
  const { a, dir } = wallEnds(w)
  const s = o.offset + o.width * t
  return [a[0] + dir[0] * s, a[1] + dir[1] * s]
}

/** Distance from p to segment ab and the parameter along it (0…1). */
export function segDist(p: P2, a: P2, b: P2): { d: number; t: number; q: P2 } {
  const vx = b[0] - a[0], vy = b[1] - a[1]
  const L2 = vx * vx + vy * vy || 1
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2))
  const q: P2 = [a[0] + vx * t, a[1] + vy * t]
  return { d: dist(p, q), t, q }
}

export function pointInPoly(p: P2, poly: P2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export const polyArea = (poly: P2[]) => Math.abs(poly.reduce((s, p, i) => s + p[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * p[1], 0)) / 2

export const rectPoly = (a: P2, b: P2): P2[] => {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1])
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
}

/**
 * Room boundary around a point: rays east / west / north / south stop at the inner face of the nearest
 * wall on the level. Works for the orthogonal layouts a room tool is used on; null if a side is open.
 */
export function roomAt(m: BimModel, level: string, p: P2): P2[] | null {
  const walls = wallsOn(m, level)
  const hit = (dx: number, dy: number) => {
    let best = Infinity
    for (const w of walls) {
      const { a, b } = wallEnds(w)
      const half = (typeOf(m, w)?.thickness ?? 200) / 2
      // ray p + s·(dx, dy) against segment a + u·(b − a)
      const ex = b[0] - a[0], ey = b[1] - a[1]
      const den = dx * ey - dy * ex
      if (Math.abs(den) < 1e-9) continue
      const s = ((a[0] - p[0]) * ey - (a[1] - p[1]) * ex) / den
      const u = ((a[0] - p[0]) * dy - (a[1] - p[1]) * dx) / den
      if (s > 0 && u >= -0.001 && u <= 1.001) {
        // inner face: back off by half the thickness measured along the ray
        const cos = Math.abs(dx * -ey + dy * ex) / Math.hypot(ex, ey)
        best = Math.min(best, s - half / Math.max(cos, 0.2))
      }
    }
    return best
  }
  const e = hit(1, 0), w = hit(-1, 0), n = hit(0, 1), s = hit(0, -1)
  if (![e, w, n, s].every((v) => Number.isFinite(v) && v > 100 && v < 60000)) return null
  return [[p[0] - w, p[1] - s], [p[0] + e, p[1] - s], [p[0] + e, p[1] + n], [p[0] - w, p[1] + n]]
}

/** Next free mark with a prefix: W25, D13, C1… */
export function nextMark(marks: string[], prefix: string): string {
  let n = 0
  for (const mk of marks) {
    const r = new RegExp(`^${prefix}(\\d+)$`).exec(mk)
    if (r) n = Math.max(n, Number(r[1]))
  }
  return `${prefix}${n + 1}`
}

export const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** Next grid label: letters for lines running mostly east–west, numbers for north–south. */
export function nextGridLabel(m: BimModel, a: P2, b: P2): string {
  const horizontal = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1])
  if (horizontal) {
    const used = new Set(m.grids.map((g) => g.label))
    for (let i = 0; i < 26; i++) if (!used.has(String.fromCharCode(65 + i))) return String.fromCharCode(65 + i)
    return `A${m.grids.length}`
  }
  return nextMark(m.grids.map((g) => g.label).map((l) => `G${l}`), 'G').slice(1)
}

/** Plan centre of an element (for tags, zoom). */
export function centreOf(m: BimModel, ref: ElementRef): P2 | null {
  switch (ref.category) {
    case 'wall': {
      const w = m.walls.find((x) => x.id === ref.id)
      if (!w) return null
      const { a, b } = wallEnds(w)
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    }
    case 'door':
    case 'window': {
      const o = [...m.doors, ...m.windows].find((x) => x.id === ref.id)
      const w = o && m.walls.find((x) => x.id === o.hostWall)
      return o && w ? openingPoint(w, o, 0.5) : null
    }
    case 'column': {
      const c = m.columns.find((x) => x.id === ref.id)
      return c ? [c.x, c.y] : null
    }
    case 'component': {
      const c = m.components.find((x) => x.id === ref.id)
      return c ? [c.x, c.y] : null
    }
    case 'stair': {
      const st = m.stairs.find((x) => x.id === ref.id)
      if (!st) return null
      const t = rad(st.angle)
      return [st.x + (Math.cos(t) * st.length) / 2, st.y + (Math.sin(t) * st.length) / 2]
    }
    case 'room':
    case 'slab': {
      const poly = ref.category === 'room' ? m.rooms.find((x) => x.id === ref.id)?.outline : m.slabs.find((x) => x.id === ref.id)?.outline
      if (!poly?.length) return null
      return [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length]
    }
    default:
      return null
  }
}

/** Mark shown by a tag. */
export function markOf(m: BimModel, ref: ElementRef): string {
  const all: { id: string; mark?: string; number?: string; label?: string }[] = [...m.walls, ...m.doors, ...m.windows, ...m.columns, ...m.slabs, ...m.stairs, ...m.railings, ...m.components, ...m.grids, ...m.rooms]
  const e = all.find((x) => x.id === ref.id)
  return e?.mark || e?.number || e?.label || '?'
}
