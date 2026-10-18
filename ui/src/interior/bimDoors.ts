/**
 * Doors of an interior room from the BIM model (read only): interior rooms built from a CAD plan share the BIM
 * room ids and coordinates (bim/fromCadBuild.ts buildInterior), so each BIM door whose opening lies on one of the
 * room's outline edges becomes a room door with its real position and width — measured data instead of a guess.
 */
import type { Room, RoomDoor } from './model'

interface BimLike {
  walls: { id: string; length: number; x?: number; y?: number; angle?: number }[]
  doors: { id: string; mark: string; hostWall: string; offset: number; width: number }[]
}

/** Room doors found in the BIM model (within `tol` mm of an outline edge, parallel to it). */
export function doorsFromBim(model: BimLike, r: Room, tol = 260): RoomDoor[] {
  const out: RoomDoor[] = []
  const o = r.outline
  for (const d of model.doors) {
    const w = model.walls.find((x) => x.id === d.hostWall)
    if (!w) continue
    const t = ((w.angle ?? 0) * Math.PI) / 180
    const dir = [Math.cos(t), Math.sin(t)]
    const s = [(w.x ?? 0) + dir[0] * d.offset, (w.y ?? 0) + dir[1] * d.offset]
    const e = [s[0] + dir[0] * d.width, s[1] + dir[1] * d.width]
    const c = [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2]
    for (let k = 0; k < o.length; k++) {
      const p = o[k], q = o[(k + 1) % o.length]
      const len = Math.hypot(q.x - p.x, q.y - p.y)
      if (len < 1) continue
      const u = [(q.x - p.x) / len, (q.y - p.y) / len]
      if (Math.abs(u[0] * dir[1] - u[1] * dir[0]) > 0.05) continue
      const along = (c[0] - p.x) * u[0] + (c[1] - p.y) * u[1]
      const off = Math.abs(-(c[0] - p.x) * u[1] + (c[1] - p.y) * u[0])
      if (off > tol || along < 0 || along > len) continue
      const a0 = (s[0] - p.x) * u[0] + (s[1] - p.y) * u[1], a1 = (e[0] - p.x) * u[0] + (e[1] - p.y) * u[1]
      const at = Math.max(0, Math.round(Math.min(a0, a1)))
      out.push({ id: `bim-${d.id}`, wall: k, at, width: Math.min(Math.round(d.width), Math.round(len - at)), swing: 'in' })
      break
    }
  }
  return out
}
