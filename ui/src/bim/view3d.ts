/**
 * View-only states of the live BIM 3D view (v2.4, SP18–SP22): which walls a see-through view fades, where low
 * walls are cut, the camera and clip box of a room focus, the walkthrough start. None of them touches the model
 * (V24-012 / V24-013): they only produce native view commands (per-item opacity, per-item clip planes, camera, clip
 * box).
 */
import { levelOf, typeOf, type BimModel, type P2 } from './model'
import { ends } from './walls'
import { roomShape } from './rooms'
import type { V3 } from '../model/bookmark'

const elev = (m: BimModel, id: string) => levelOf(m, id)?.elevation ?? 0

function planBox(m: BimModel): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const w of m.walls) {
    const e = ends(w)
    for (const p of [e.a, e.b]) ((x0 = Math.min(x0, p[0])), (y0 = Math.min(y0, p[1])), (x1 = Math.max(x1, p[0])), (y1 = Math.max(y1, p[1])))
  }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : [0, 0, 10000, 10000]
}

/** Walls between the camera and the middle of the building, facing it (see-through view): their 3D item ids. */
export function frontWalls(m: BimModel, eye: V3, at: V3): string[] {
  const [x0, y0, x1, y1] = planBox(m)
  const c: P2 = [(x0 + x1) / 2, (y0 + y1) / 2]
  let vx = at[0] - eye[0], vy = at[1] - eye[1]
  const L = Math.hypot(vx, vy)
  // looking straight down: no wall stands in front
  if (L < 1e-6) return []
  vx /= L
  vy /= L
  const ext = Math.max(x1 - x0, y1 - y0)
  const out: string[] = []
  for (const w of m.walls) {
    const e = ends(w)
    const p: P2 = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2]
    const n: P2 = [-e.dir[1], e.dir[0]]
    const facing = Math.abs(n[0] * vx + n[1] * vy) > 0.3
    const towardCamera = (p[0] - c[0]) * -vx + (p[1] - c[1]) * -vy > 0.12 * ext
    if (facing && towardCamera) out.push(w.id, `${w.id}:frame`)
  }
  return out
}

/** Low walls: every wall (with its panes, frames and door leaves) cut `h` mm above its base — item id → cut z. */
export function lowWallCuts(m: BimModel, h: number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const w of m.walls) {
    const z = elev(m, w.baseLevel) + w.baseOffset + h
    out[w.id] = z
    out[`${w.id}:frame`] = z
    for (const o of [...m.doors, ...m.windows]) if (o.hostWall === w.id) ((out[`glass:${o.id}`] = z), (out[`leaf:${o.id}`] = z))
  }
  return out
}

/** Room focus: a camera looking into the room from above one corner, the clip box round it (its walls included,
 *  cut 2.4 m above its floor), and its level. */
export function roomFocus(m: BimModel, roomId: string): { eye: V3; at: V3; up: V3; fov: number; planes: number[][]; level: string; name: string } | null {
  const r = m.rooms.find((x) => x.id === roomId)
  if (!r) return null
  const poly = roomShape(m, r)?.net ?? r.outline
  if (!poly || poly.length < 3) return null
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1])
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  const z0 = elev(m, r.level)
  const pad = 400
  const top = z0 + 2400
  const planes = [[1, 0, 0, -(x0 - pad)], [-1, 0, 0, x1 + pad], [0, 1, 0, -(y0 - pad)], [0, -1, 0, y1 + pad], [0, 0, 1, -(z0 - 300)], [0, 0, -1, top]]
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, d = Math.max(x1 - x0, y1 - y0, 2000)
  return { eye: [cx - 0.75 * d, cy - 1.1 * d, z0 + 1.5 * d], at: [cx, cy, z0 + 800], up: [0, 0, 1], fov: 45, planes, level: r.level, name: `${r.name} ${r.number}` }
}

/** Walkthrough start: eye 1.6 m above the level at the selected room's middle (else the building's), looking along +X. */
export function walkStart(m: BimModel, level: string, roomId?: string): { eye: V3; at: V3 } {
  const z = elev(m, level) + 1600
  const r = roomId ? m.rooms.find((x) => x.id === roomId) : undefined
  const poly = r ? (roomShape(m, r)?.net ?? r.outline) : undefined
  let c: P2
  if (poly && poly.length > 2) c = [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length]
  else {
    const [x0, y0, x1, y1] = planBox(m)
    c = [(x0 + x1) / 2, (y0 + y1) / 2]
  }
  return { eye: [c[0], c[1], z], at: [c[0] + 1000, c[1], z] }
}

/** Walls of a model drawn opaque in 3D (what a see-through view may fade). */
export const solidWallIds = (m: BimModel) => m.walls.filter((w) => typeOf(m, w)?.family !== 'Curtain Wall').map((w) => w.id)
