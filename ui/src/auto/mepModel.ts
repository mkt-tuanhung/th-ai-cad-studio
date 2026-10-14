/**
 * The MEP coordination model (the MEP workspace's model, src/mep/model.ts) from the MEP drawings placed on the
 * building (src/auto/mep.ts) and the beams of its structure, so the workspace's clash check finds where pipes run
 * through beams. What the plans do not say is set by stated rules:
 *  - the first three storeys of the building are the workspace's levels L1 … L3 (its model has three);
 *  - horizontal pipes run in the ceiling space of their storey, under the beams of the usual depth of the slab
 *    above (BEAM_GAP clear; without beams CEIL_GAP under the slab), each service in its band (BAND: drains
 *    highest, then cold, then hot water) — so a clash is a beam deeper than the usual ones in the pipe's way;
 *    a branch meeting a main of its service stops at the main's face (a tee, not a clash);
 *    only runs along the grid axes are kept (the workspace's runs are axis-aligned), diagonal pieces are left;
 *  - a pipe without a diameter written takes the usual one of its service (DEFAULT_DN); flows are unknown (0);
 *  - the beams of the slab above hang into the storey from that slab's structural top;
 *  - lights and sprinklers at the ceiling, sockets SOCKET_H up, floor drains on the floor; air conditioners and
 *    boards as equipment of their level.
 */
import type { BimModel } from '../bim/model'
import { findClashes, upgradeMep, type Equipment, type Fixture, type LevelId, type MepModel, type Pipe, type PipeService, type Beam as MepBeam } from '../mep/model'
import { SOCKET_H, type MepItem, type MepRole } from './mep'

export const CEIL_GAP = 250, BEAM_GAP = 50, MAX_DN = 110
/** centre of each service's band under the top of the ceiling space: room for a pipe up to MAX_DN in each */
const BAND: Partial<Record<MepRole, number>> = { waste: 75, sewer: 75, storm: 75, vent: 75, cold: 230, hot: 400 }
export const DEFAULT_DN: Partial<Record<MepRole, number>> = { cold: 25, hot: 25, waste: 75, sewer: 110, storm: 90, vent: 60 }
const SERVICE: Partial<Record<MepRole, PipeService>> = { cold: 'Domestic Cold Water', hot: 'Domestic Hot Water', waste: 'Sanitary Drain', sewer: 'Sanitary Drain', storm: 'Sanitary Drain', vent: 'Sanitary Drain' }

export interface MepBuild {
  model: MepModel
  /** building level name → workspace level */
  levels: Record<string, LevelId>
  pipes: number
  beams: number
  fixtures: number
  clashes: number
  /** pipe pieces left out (diagonal) */
  skipped: number
  /** clashes of pipes with beams (crossings of pipes are joints, not counted) */
  pipeBeam: number
}

export function buildMepModel(items: MepItem[], bim: BimModel): MepBuild {
  const lv = [...bim.levels].sort((a, b) => a.elevation - b.elevation)
  const ids: LevelId[] = ['L1', 'L2', 'L3']
  const levels: Record<string, LevelId> = {}
  lv.slice(0, 3).forEach((l, i) => { if (i + 1 < lv.length) levels[l.name] = ids[i] })
  const H = (name: string) => { const i = lv.findIndex((l) => l.name === name); return i >= 0 && i + 1 < lv.length ? lv[i + 1].elevation - lv[i].elevation : 3300 }
  // the usual (median) depth of the beams of the slab above a storey, from that slab's structural top
  const beamBottom = (name: string) => {
    const i = lv.findIndex((l) => l.name === name), up = lv[i + 1]
    const bs = (bim.beams ?? []).filter((b) => !b.tie && b.level === up?.id).sort((a, b) => a.h - b.h)
    if (!bs.length || !up) return null
    const m = bs[Math.floor(bs.length / 2)]
    return up.elevation + m.topOffset - m.h - lv[i].elevation
  }
  const slabT = (name: string) => { const i = lv.findIndex((l) => l.name === name); const up = lv[i + 1]; return bim.slabs.find((s) => s.level === up?.id && s.kind !== 'ceiling' && !s.landing)?.thickness ?? 120 }
  const pipes: Pipe[] = [], fixtures: Fixture[] = [], equipment: Equipment[] = [], beams: MepBeam[] = []
  let skipped = 0
  for (const it of items) {
    const L = levels[it.level]
    if (!L) continue
    if (it.pts && SERVICE[it.role]) {
      const dn = it.size ? Number(it.size) : DEFAULT_DN[it.role] ?? 50
      const bb = beamBottom(it.level)
      const elev = (bb !== null ? bb - BEAM_GAP : H(it.level) - slabT(it.level) - CEIL_GAP) - (BAND[it.role] ?? 75)
      for (let i = 0; i + 1 < it.pts.length; i++) {
        const [a, b] = [it.pts[i], it.pts[i + 1]]
        const dx = b[0] - a[0], dy = b[1] - a[1]
        if (Math.hypot(dx, dy) < 100) continue
        const axis = Math.abs(dy) <= 20 ? 'x' : Math.abs(dx) <= 20 ? 'y' : null
        if (!axis) { skipped++; continue }
        // each piece stops short of the joints by half a section (the fittings' room), so pieces meeting at a
        // corner or a tee are not taken for clashes
        // (by the largest section met on the plans: a small branch tees into a larger main)
        const trim = (Math.max(dn, MAX_DN) + 40) / 2 + 1, len = Math.abs(axis === 'x' ? dx : dy)
        if (len <= 2 * trim + 50) continue
        const n = pipes.length + 1
        pipes.push({ id: `p-auto-${n}`, mark: `P${n}`, service: SERVICE[it.role]!, dn, flow: 0, material: it.role === 'cold' || it.role === 'hot' ? 'PPR' : 'uPVC', x: Math.round(Math.min(a[0], b[0]) + (axis === 'x' ? trim : 0)), y: Math.round(axis === 'x' ? a[1] : Math.min(a[1], b[1]) + trim), axis, length: Math.round(len - 2 * trim), elevation: Math.round(elev), level: L })
      }
    } else if (it.at) {
      const n = fixtures.length + 1
      const fx = (kind: Fixture['kind'], elevation: number) => fixtures.push({ id: `fx-auto-${n}`, mark: `F${n}`, kind, level: L, x: it.at![0], y: it.at![1], elevation })
      if (it.role === 'light') fx('Downlight', H(it.level) - slabT(it.level))
      else if (it.role === 'sprinkler') fx('Sprinkler', H(it.level) - slabT(it.level) - 50)
      else if (it.role === 'socket') fx('Socket', SOCKET_H)
      else if (it.role === 'fixture') fx('Floor Drain', 0)
      else if (it.role === 'ac' || it.role === 'panel') {
        const e = equipment.length + 1
        equipment.push({ id: `eq-auto-${e}`, mark: it.role === 'ac' ? `AC${e}` : `DB${e}`, kind: it.role === 'ac' ? 'FCU' : 'Electrical Panel', system: it.role === 'ac' ? 'hvac' : 'electrical', level: L, capacity: it.role === 'ac' ? (it.cap ? `${it.cap.toUpperCase()} BTU` : '—') : '—' })
      }
    }
  }
  // branches drawn from one point share their first stretch: pieces of a service on one line that overlap are
  // one pipe (the larger diameter kept)
  const merged: Pipe[] = []
  for (const p of [...pipes].sort((a, b) => (a.axis === 'x' ? a.x : a.y) - (b.axis === 'x' ? b.x : b.y))) {
    const c = p.axis === 'x' ? p.y : p.x, s0 = p.axis === 'x' ? p.x : p.y
    const q = merged.find((m) => m.level === p.level && m.service === p.service && m.axis === p.axis && Math.abs((m.axis === 'x' ? m.y : m.x) - c) <= 30 && s0 <= (m.axis === 'x' ? m.x : m.y) + m.length + 1)
    if (!q) { merged.push({ ...p }); continue }
    const q0 = q.axis === 'x' ? q.x : q.y
    q.length = Math.max(q.length, s0 + p.length - q0)
    if (p.dn > q.dn) { q.dn = p.dn; q.elevation = Math.min(q.elevation, p.elevation) }
  }
  // tees: a branch ending inside a main of its service (at right angles) stops at the main's face
  for (const b of merged)
    for (const m of merged) {
      if (b === m || b.level !== m.level || b.service !== m.service || b.axis === m.axis) continue
      const half = (m.dn + 40) / 2 + 1
      const mc = m.axis === 'x' ? m.y : m.x, m0 = m.axis === 'x' ? m.x : m.y
      const bc = b.axis === 'x' ? b.y : b.x
      if (bc < m0 - half || bc > m0 + m.length + half) continue
      const b0 = b.axis === 'x' ? b.x : b.y, b1 = b0 + b.length
      if (b1 > mc - half && b1 <= mc + half + 200 && b0 < mc - half) { b.length = Math.max(1, mc - half - b0) }
      else if (b0 < mc + half && b0 >= mc - half - 200 && b1 > mc + half) { const n0 = mc + half; b.length = Math.max(1, b1 - n0); if (b.axis === 'x') b.x = n0; else b.y = n0 }
    }
  merged.forEach((p, i) => { p.id = `p-auto-${i + 1}`; p.mark = `P${i + 1}` })
  pipes.length = 0
  pipes.push(...merged)
  // the beams of the slab above each storey, hanging into it
  for (const b of bim.beams ?? []) {
    if (b.tie) continue
    const k = lv.findIndex((l) => l.id === b.level)
    const below = lv[k - 1]
    const L = below ? levels[below.name] : undefined
    if (!L) continue
    const t = (b.angle * Math.PI) / 180, ux = Math.cos(t), uy = Math.sin(t)
    const axis = Math.abs(uy) < 0.02 ? 'x' : Math.abs(ux) < 0.02 ? 'y' : null
    if (!axis) continue
    const x1 = b.x + ux * b.length, y1 = b.y + uy * b.length
    const top = lv[k].elevation + b.topOffset - below.elevation
    beams.push({ id: `B-${L}-${b.mark}-${beams.length + 1}`, x: Math.min(b.x, x1), y: axis === 'x' ? b.y : Math.min(b.y, y1), axis, length: b.length, elevation: Math.round(top - b.h / 2), level: L, w: b.b, h: b.h })
  }
  const model = upgradeMep({ ducts: [], pipes, circuits: [], equipment, beams, trays: [], fixtures, terminals: [], fittings: [], annotations: [], sections: [] })
  const cl = findClashes(model)
  return { model, levels, pipes: pipes.length, beams: beams.length, fixtures: fixtures.length, clashes: cl.length, pipeBeam: cl.filter((c) => c.kind === 'pipe-beam').length, skipped }
}
