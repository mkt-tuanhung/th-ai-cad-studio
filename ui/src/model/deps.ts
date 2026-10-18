/**
 * Dependency graph of the semantic model (v2.4, SP01 / SP15): which elements an edit makes dirty — the elements it
 * changed and everything that depends on them — so each view rebuilds only that: the native 3D scene replaces the
 * dirty solids (scene3dPatch), the plan / elevations / sections / schedules / quantities refresh.
 *
 * Rules (BIM):
 * - a wall → its hosted openings (their cut and glazing), the rooms it bounds (their outline and area), the level
 *   slabs that span its level (native default slabs), elevations / sections / schedules / quantities;
 * - a wall type → every wall of that type (and on from each wall);
 * - an opening → its host wall (old and new host), the opening's own glazing / leaf;
 * - a level elevation → everything on the level or hosted by it: walls based or topped there (and on from each), the
 *   slabs, columns, rooms, components, railings, beams, footings, roofs on it, the stairs that start or end there;
 * - any other element → itself.
 * Elements are keyed by guid (identity v3); an element without one falls back to "list:id".
 */
import type { BimModel } from '../bim/model'
import { ENTITY_LISTS, type Entity, type EntityList } from '../bim/identity'

export type DirtyView = '3d' | 'plan' | 'elevation' | 'section' | 'schedule' | 'quantities'

export interface Dirty {
  /** the elements the edit itself added, modified or removed */
  changed: Set<string>
  /** changed + every dependent */
  guids: Set<string>
  /** the same as element ids per list (old and new ids) */
  ids: Partial<Record<EntityList, Set<string>>>
  /** why each dependent is dirty ("self", "host W3", "bounds W3", "level L2" …) */
  why: Map<string, string>
  /** native building items to rebuild: walls (with their openings and glazing) and the level slabs */
  native: { walls: Set<string>; levelSlabs: Set<string> }
  views: Set<DirtyView>
}

type Ref = { list: EntityList; e: Entity }
const keyOf = (list: EntityList, e: Entity) => e.guid ?? `${list}:${e.id}`

function index(m: BimModel | null): Map<string, Ref> {
  const out = new Map<string, Ref>()
  if (!m) return out
  for (const list of ENTITY_LISTS) for (const e of ((m[list] as Entity[] | undefined) ?? [])) out.set(keyOf(list, e), { list, e })
  return out
}

const body = (e: Entity) => {
  const { rev: _r, ...rest } = e as Entity & Record<string, unknown>
  void _r
  return JSON.stringify(rest)
}

/** Dirty set of one edit (before → after). `before` null: everything is new. */
export function dirtyOf(before: BimModel | null, after: BimModel): Dirty {
  const A = index(before), B = index(after)
  const changed = new Set<string>()
  for (const [k, r] of B) {
    const a = A.get(k)
    if (!a || (a.e !== r.e && body(a.e) !== body(r.e))) changed.add(k)
  }
  for (const k of A.keys()) if (!B.has(k)) changed.add(k)

  const guids = new Set<string>()
  const why = new Map<string, string>()
  const ids: Dirty['ids'] = {}
  const native = { walls: new Set<string>(), levelSlabs: new Set<string>() }
  const views = new Set<DirtyView>()
  const work: string[] = []
  const mark = (k: string, reason: string) => {
    if (guids.has(k)) return
    guids.add(k)
    why.set(k, reason)
    work.push(k)
  }
  for (const k of changed) mark(k, 'self')

  // lookups over both versions (an edit may move a door to another wall, delete a wall…)
  const both = [before, after].filter((m): m is BimModel => !!m)
  const find = (list: EntityList, pred: (e: Entity & Record<string, unknown>) => boolean) => {
    const out: string[] = []
    for (const m of both) for (const e of ((m[list] as (Entity & Record<string, unknown>)[] | undefined) ?? [])) if (pred(e)) out.push(keyOf(list, e))
    return out
  }
  const refOf = (k: string) => B.get(k) ?? A.get(k)!

  while (work.length) {
    const k = work.pop()!
    const { list, e } = refOf(k)
    const x = e as Entity & Record<string, unknown>
    ;(ids[list] ??= new Set()).add(e.id)
    switch (list) {
      case 'walls': {
        native.walls.add(e.id)
        for (const lv of [x.baseLevel, x.topLevel] as string[]) native.levelSlabs.add(lv)
        for (const o of [...find('doors', (d) => d.hostWall === e.id), ...find('windows', (d) => d.hostWall === e.id)]) mark(o, `host ${e.id}`)
        for (const r of find('rooms', (r) => ((r.edges as { wall: string }[] | undefined) ?? []).some((ed) => ed.wall === e.id))) mark(r, `bounds ${e.id}`)
        ;['3d', 'plan', 'elevation', 'section', 'schedule', 'quantities'].forEach((v) => views.add(v as DirtyView))
        break
      }
      case 'wallTypes':
        for (const w of find('walls', (w) => w.typeId === e.id)) mark(w, `type ${e.id}`)
        break
      case 'doors':
      case 'windows': {
        for (const w of find('walls', (w) => w.id === x.hostWall)) mark(w, `hosts ${e.id}`)
        ;['3d', 'plan', 'elevation', 'section', 'schedule', 'quantities'].forEach((v) => views.add(v as DirtyView))
        break
      }
      case 'levels': {
        native.levelSlabs.add(e.id)
        const on = (f: string) => (r: Record<string, unknown>) => r[f] === e.id
        for (const w of find('walls', (w) => w.baseLevel === e.id || w.topLevel === e.id)) mark(w, `level ${e.id}`)
        for (const l of ['slabs', 'rooms', 'components', 'railings', 'beams', 'footings', 'roofs', 'annotations'] as const) for (const q of find(l, on('level'))) mark(q, `level ${e.id}`)
        for (const c of find('columns', (c) => c.level === e.id || c.topLevel === e.id)) mark(c, `level ${e.id}`)
        for (const st of find('stairs', (st) => st.baseLevel === e.id || st.topLevel === e.id)) mark(st, `level ${e.id}`)
        ;['3d', 'plan', 'elevation', 'section', 'schedule', 'quantities'].forEach((v) => views.add(v as DirtyView))
        break
      }
      case 'rooms':
        views.add('plan')
        views.add('schedule')
        views.add('section')
        break
      case 'annotations':
      case 'grids':
        views.add('plan')
        views.add('elevation')
        views.add('section')
        break
      default:
        ;['3d', 'plan', 'elevation', 'section', 'quantities'].forEach((v) => views.add(v as DirtyView))
    }
  }
  return { changed, guids, ids, why, native, views }
}

/** guid → element of a model (list, id). */
export function elementOf(m: BimModel, guid: string): { list: EntityList; id: string } | null {
  for (const list of ENTITY_LISTS) for (const e of ((m[list] as Entity[] | undefined) ?? [])) if (e.guid === guid) return { list, id: e.id }
  return null
}
