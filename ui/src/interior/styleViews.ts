/**
 * Cameras for the "reference photo → style" render (v2.4): architectural views (eye 1.3 m, level, lens shift) like the
 * Interior auto views, but chosen to show what a reference photo shows — the room's main piece (sofa / bed) from its
 * front with the pieces around it. The eye may stand anywhere on free floor (a 300 mm grid, ≥ 350 mm from walls and
 * ≥ 300 mm from furniture), not only at corners and wall middles: in a furnished narrow room those spots are often
 * taken (TV unit, plant) and the corner views then look past the sofa. Presentation only.
 */
import type { InteriorDoc } from '../state/interior'
import { innerPoly, inPoly } from './geom'
import { itemPlacements } from './scene'
import { frontOf } from './orient'
import { itemBox } from '../library/assets'
import { vfovForLens, type AutoView } from '../renders/interiorRender'

interface Foot {
  x: number
  y: number
  w: number
  d: number
  h: number
  main?: boolean
}

/** Distance from point p to segment a–b. */
const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax, dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}

export function styleViews(doc: InteriorDoc, roomId: string, n = 2, aspect = 16 / 9): AutoView[] {
  const room = doc.rooms.find((r) => r.id === roomId)
  if (!room || room.outline.length < 3) return []
  const xs = room.outline.map((p) => p.x), ys = room.outline.map((p) => p.y)
  const minSide = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  const lensEq = minSide < 3600 ? 22 : 24
  const fov = Math.round(vfovForLens(lensEq, aspect) * 100) / 100
  const half = Math.atan(18 / lensEq) * 0.9
  const foot: Foot[] = []
  let main: { f: Foot; front: [number, number]; a: number } | null = null
  for (const { item, room: r, at } of itemPlacements(doc)) {
    if (r.id !== roomId || item.category === 'rugs' || item.category === 'lighting' || (item.elev ?? 0) >= 1200) continue
    const b = itemBox(item)
    for (const p of at) {
      const q = Math.abs(Math.cos((p.rot * Math.PI) / 180)) > 0.7
      const f: Foot = { x: p.x, y: p.y, w: q ? b.w : b.d, d: q ? b.d : b.w, h: (item.elev ?? 0) + b.h }
      foot.push(f)
      if ((item.category === 'sofas' || item.category === 'beds') && (!main || b.w * b.d > main.a)) main = { f, front: frontOf(p.rot), a: b.w * b.d }
    }
  }
  if (main) main.f.main = true
  const area = foot.reduce((s, f) => s + f.w * f.d, 0)
  // the subject: the main piece and what stands in front of it (sofa + coffee table), else the furniture's centre
  const target = main
    ? { x: main.f.x + main.front[0] * 900, y: main.f.y + main.front[1] * 900 }
    : area > 0
      ? { x: foot.reduce((s, f) => s + f.x * f.w * f.d, 0) / area, y: foot.reduce((s, f) => s + f.y * f.w * f.d, 0) / area }
      : { x: xs.reduce((a, v) => a + v, 0) / xs.length, y: ys.reduce((a, v) => a + v, 0) / ys.length }
  const inner = innerPoly(room)
  const nearWall = (x: number, y: number) => {
    for (let i = 0; i < inner.length; i++) {
      const a = inner[i], b = inner[(i + 1) % inner.length]
      if (segDist(x, y, a[0], a[1], b[0], b[1]) < 350) return true
    }
    return false
  }
  const gap = (x: number, y: number, f: Foot) => Math.hypot(Math.max(0, Math.abs(x - f.x) - f.w / 2), Math.max(0, Math.abs(y - f.y) - f.d / 2))
  const cands: { x: number; y: number; dir: number; dist: number; score: number }[] = []
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  for (let x = x0 + 150; x < x1; x += 300)
    for (let y = y0 + 150; y < y1; y += 300) {
      if (!inPoly(inner, x, y) || nearWall(x, y) || foot.some((f) => gap(x, y, f) < 300)) continue
      const dx = target.x - x, dy = target.y - y, dist = Math.hypot(dx, dy)
      if (dist < 1800) continue
      const ux = dx / dist, uy = dy / dist
      let score = -Math.abs(dist - 3600) * 0.6
      if (main) score += 2600 * Math.max(-0.5, -(main.front[0] * ux + main.front[1] * uy))
      for (const f of foot) {
        const vx = f.x - x, vy = f.y - y, L = Math.hypot(vx, vy)
        const ang = Math.acos(Math.max(-1, Math.min(1, (vx * ux + vy * uy) / (L || 1))))
        if (L > 1200 && ang < half) score += 500
        // a tall piece between the eye and the subject hides it (a low coffee table does not: the eye is at 1.3 m)
        if (!f.main && f.h > 1000 && segDist(f.x, f.y, x, y, target.x, target.y) < Math.max(f.w, f.d) / 2 && L < dist) score -= 3000
        // a piece filling the foreground
        if (ang < half + 0.2 && gap(x, y, f) < 900 && !f.main) score -= 1500
      }
      cands.push({ x, y, dir: Math.atan2(dy, dx), dist, score })
    }
  cands.sort((a, b) => b.score - a.score)
  const chosen: typeof cands = []
  for (const c of cands) {
    if (chosen.some((p) => Math.abs(((p.dir - c.dir + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) < (30 * Math.PI) / 180 && Math.hypot(p.x - c.x, p.y - c.y) < 1500)) continue
    chosen.push(c)
    if (chosen.length >= n) break
  }
  return chosen.map((c, k) => {
    const dx = target.x - c.x, dy = target.y - c.y, L = Math.hypot(dx, dy)
    return {
      scene: 'interior' as const, name: `${k + 1}`, room: roomId,
      eye: [Math.round(c.x), Math.round(c.y), 1300] as [number, number, number],
      at: [Math.round(c.x + (dx / L) * (L + 1000)), Math.round(c.y + (dy / L) * (L + 1000)), 1300] as [number, number, number],
      up: [0, 0, 1] as [number, number, number], fov, lensEq, shift: [0, -0.06] as [number, number], level: true as const,
    }
  })
}
