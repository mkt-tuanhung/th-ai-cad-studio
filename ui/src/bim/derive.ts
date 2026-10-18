/**
 * What every committed BIM edit recomputes and checks (v2.4), inside the store's `edit()` so the result — and its
 * undo — is ONE step: rooms follow their bounding walls (outline, net / gross area, perimeter), stairs and landings
 * from an import re-scale to a changed storey height (V24-010), and the rules an edit must not break (an opening must
 * stay inside its host wall with its end clearance — V24-009; an arc radius must reach across its wall).
 */
import { levelOf, type BimModel, type Opening } from './model'
import { nextLevel } from './geometry'
import { deriveRooms } from './rooms'
import { openingProblem, type OpeningProblem } from './walls'

const elev = (m: BimModel, id: string) => levelOf(m, id)?.elevation ?? 0

/** Imported stair flights (fixed rise / start height), landings and stair rails re-scaled when a storey height changes. */
export function rescaleStairs(before: BimModel | null, after: BimModel): BimModel {
  if (!before || before.levels === after.levels) return after
  const moved = after.levels.filter((l) => before.levels.find((x) => x.id === l.id)?.elevation !== l.elevation)
  if (!moved.length) return after
  const storey = (m: BimModel, base: string, top: string) => elev(m, top) - elev(m, base)
  const k = (base: string, top: string) => {
    const h0 = storey(before, base, top), h1 = storey(after, base, top)
    return h0 > 0 && h1 > 0 && Math.abs(h1 - h0) > 0.01 ? h1 / h0 : 1
  }
  let any = false
  const stairs = after.stairs.map((st) => {
    if (st.rise === undefined) return st // risers follow the storey height already
    const f = k(st.baseLevel, st.topLevel)
    if (f === 1) return st
    any = true
    return { ...st, rise: Math.round(st.rise * f * 10) / 10, baseOffset: Math.round((st.baseOffset ?? 0) * f * 10) / 10 }
  })
  const up = (lv: string) => nextLevel(after, lv)?.id
  const slabs = after.slabs.map((s) => {
    const top = up(s.level)
    if (!s.landing || !top) return s
    const f = k(s.level, top)
    if (f === 1) return s
    any = true
    return { ...s, offset: Math.round(s.offset * f * 10) / 10 }
  })
  const railings = after.railings.map((r) => {
    const top = up(r.level)
    if (!r.z?.length || !top) return r
    const f = k(r.level, top)
    if (f === 1) return r
    any = true
    return { ...r, z: r.z.map((z) => Math.round(z * f * 10) / 10) }
  })
  return any ? { ...after, stairs, slabs, railings } : after
}

/** The model an edit commits: rooms and stairs recomputed. */
export function deriveModel(before: BimModel | null, after: BimModel): BimModel {
  return deriveRooms(before, rescaleStairs(before, after))
}

export type EditRule = { mark: string; code: OpeningProblem | 'arc' | 'slope' }

/**
 * The first rule the edit breaks (null: none). Only what the edit touched is checked — openings that are new or
 * changed, or whose host changed — and an opening that was already out of its wall before (the sample model's
 * deliberate checks) does not block edits that leave it as it was.
 */
export function editRule(before: BimModel, after: BimModel): EditRule | null {
  const prevWalls = new Map(before.walls.map((w) => [w.id, w]))
  for (const w of after.walls) {
    if (prevWalls.get(w.id) === w) continue
    if (w.arc && !(Math.abs(w.arc.radius) >= w.length / 2 - 0.01)) return { mark: w.mark, code: 'arc' }
    if (w.heightEnd !== undefined && !(w.heightEnd > 0)) return { mark: w.mark, code: 'slope' }
  }
  const prevOpen = new Map<string, Opening>([...before.doors, ...before.windows].map((o) => [o.id, o]))
  for (const o of [...after.doors, ...after.windows]) {
    const was = prevOpen.get(o.id)
    const host = after.walls.find((w) => w.id === o.hostWall)
    const touched = was !== o || !host || prevWalls.get(host.id) !== host || before.levels !== after.levels || before.wallTypes !== after.wallTypes
    if (!touched) continue
    const p = openingProblem(after, o)
    if (!p) continue
    // already out of its wall, and this edit did not touch the opening itself: not this edit's doing
    if (was && was.hostWall === o.hostWall && openingProblem(before, was)) continue
    return { mark: o.mark || o.id, code: p }
  }
  return null
}
