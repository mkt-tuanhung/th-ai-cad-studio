/**
 * Which way furniture from a CAD plan faces. A drawing's furniture block carries an insertion angle, but nothing says
 * which side of the block is its FRONT (blocks are drawn with the front up or down depending on the library), so an
 * item can arrive backwards: a bed with its headboard away from the wall its nightstands stand at, a sofa turned away
 * from its coffee table. The interior's convention is front −Y before rotation (interior/catalog.ts); this pass keeps
 * each instance's axis and only turns it by 180° when the room says it faces the wrong way:
 *   - wall-backed pieces (bed, wardrobe, cabinets, shelves, desk, nightstand …): the back goes to the nearer wall when
 *     the front stands close to a wall and the back does not;
 *   - seating (sofa, chair, bench): faces the coffee table (else the TV cabinet, else the table) of its room.
 * Geometry, sizes and counts never change.
 */
import type { Item, Pt, Room } from './model'

const WALL_BACKED = new Set(['bed', 'wardrobe', 'tvCabinet', 'kitchen', 'shoeCabinet', 'shelf', 'cabinet', 'altar', 'nightstand', 'desk', 'fridge'])
const SEATING = new Set(['sofa', 'chair', 'bench'])

/** Distance (mm) from p along the unit direction (dx, dy) to the room outline (Infinity when the ray leaves no edge). */
export function rayToOutline(o: Pt[], p: Pt, dx: number, dy: number): number {
  let best = Infinity
  for (let i = 0; i < o.length; i++) {
    const a = o[i], b = o[(i + 1) % o.length]
    const ex = b.x - a.x, ey = b.y - a.y
    const den = dx * ey - dy * ex
    if (Math.abs(den) < 1e-9) continue
    const t = ((a.x - p.x) * ey - (a.y - p.y) * ex) / den
    const u = ((a.x - p.x) * dy - (a.y - p.y) * dx) / den
    if (t > 1e-6 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t)
  }
  return best
}

/** Front direction (unit) of an item placed with rotation `rot` (degrees): −Y turned counter-clockwise. */
export const frontOf = (rot: number): [number, number] => {
  const a = (rot * Math.PI) / 180
  return [Math.sin(a), -Math.cos(a)]
}

const norm360 = (r: number) => Math.round(((((r + 180) % 360) + 360) % 360 - 180) * 100) / 100

/** Items with their instances turned to face the right way (see the module comment). `kind` = the CAD furniture kind. */
export function orientItems(rooms: Room[], items: (Item & { kind?: string })[]): (Item & { kind?: string })[] {
  const byRoom = new Map(rooms.map((r) => [r.id, r]))
  // targets per room: coffee table, TV cabinet, dining / other table (first instance)
  const target = (roomId: string, kinds: string[]): Pt | null => {
    for (const k of kinds) {
      const t = items.find((i) => i.room === roomId && i.kind === k && i.at?.length)
      if (t) return { x: t.at![0].x, y: t.at![0].y }
    }
    return null
  }
  return items.map((i) => {
    const room = byRoom.get(i.room)
    if (!room || !i.at?.length || !i.kind) return i
    const depth = Math.min(i.w ?? i.dia ?? 500, i.d ?? i.dia ?? 500)
    let changed = false
    const at = i.at.map((p) => {
      const [fx, fy] = frontOf(p.rot)
      let flip = false
      if (SEATING.has(i.kind!)) {
        const t = target(i.room, ['coffeeTable', 'tvCabinet', 'dining', 'table', 'desk'])
        if (t && Math.hypot(t.x - p.x, t.y - p.y) > 1) flip = fx * (t.x - p.x) + fy * (t.y - p.y) < 0
        else if (i.kind === 'sofa') {
          const front = rayToOutline(room.outline, p, fx, fy), back = rayToOutline(room.outline, p, -fx, -fy)
          flip = front < back && front < (i.d ?? depth) / 2 + 600
        }
      } else if (WALL_BACKED.has(i.kind!)) {
        const front = rayToOutline(room.outline, p, fx, fy), back = rayToOutline(room.outline, p, -fx, -fy)
        // the front stands at a wall and the back does not: the piece is backwards
        const d = (i.d ?? depth) / 2
        flip = front < back && front < d + 600 && back > d + 150
      }
      if (!flip) return p
      changed = true
      return { ...p, rot: norm360(p.rot + 180) }
    })
    return changed ? { ...i, at } : i
  })
}
