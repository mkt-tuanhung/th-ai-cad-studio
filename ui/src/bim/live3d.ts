/**
 * Live linked 3D (v2.4, SP15 / V24-005): keeps a native OCCT scene in step with the BIM model by patching only
 * what an edit made dirty. The first load (and any failure) builds the whole scene (scene3dLoadBim); after that each
 * model change sends scene3dPatch with just the building walls whose inputs changed (rebuilt natively with their
 * openings and panes), the primitive items whose description changed (columns, slabs, stairs, arc walls, door
 * leaves…), the removed ids, and lets the host rebuild only the default level slabs whose extent changed. The
 * dependency graph (model/deps.ts) is the cross-check: every wall it marks dirty is rebuilt too.
 *
 * Per scene key the last synced model is kept here (module state, survives the 3D view unmounting while the user
 * edits in plan), so returning to 3D patches instead of reloading.
 */
import type { HostApi } from '../services/host'
import type { BimModel } from './model'
import { bimExtras, nativeBuildingModel, type SceneView } from './scene'
import { dirtyOf } from '../model/deps'

interface Synced {
  model: BimModel
  view: string
  extras: Map<string, string>
  walls: Map<string, string>
  host: HostApi
}

export interface SyncResult {
  ok: boolean
  mode: 'full' | 'patch' | 'none'
  items?: number
  failures?: number
  ms?: number
  error?: string
  /** patch: ids rebuilt / removed natively, dirty elements by the dependency graph */
  rebuilt?: string[]
  removed?: string[]
  dirty?: number
  /** solids the host has built since it started (instrumentation) */
  built?: number
  rev?: number
}

const synced = new Map<string, Synced>()
/** Last sync per scene key (QA / e2e instrumentation: window.__thcad.live3d). */
export const lastSync = new Map<string, SyncResult>()
export const syncLog: (SyncResult & { key: string; at: number })[] = []

/** `v24.incremental3d` flag (Settings → Experimental, stored locally): on unless turned off. */
export function incrementalOn(): boolean {
  try {
    const f = JSON.parse(localStorage.getItem('thcad.flags') ?? '{}') as Record<string, unknown>
    return f['v24.incremental3d'] !== false
  } catch {
    return true
  }
}

/** What the native builder reads for one wall: the wall, its type, its levels, its openings. */
function wallInputs(m: BimModel): Map<string, string> {
  const out = new Map<string, string>()
  const lv = new Map(m.levels.map((l) => [l.id, l.elevation]))
  for (const w of m.walls) {
    const ty = m.wallTypes.find((t) => t.id === w.typeId)
    const ops = [...m.doors, ...m.windows].filter((o) => o.hostWall === w.id).map((o) => [o.id, o.category, o.offset, o.width, o.height, o.sill])
    out.set(w.id, JSON.stringify([w.x, w.y, w.angle, w.length, w.baseLevel, w.topLevel, w.baseOffset, w.topOffset, ty?.thickness, ty?.family, lv.get(w.baseLevel), lv.get(w.topLevel), ops]))
  }
  return out
}

/** Element guid of each native item id (walls, their panes, door leaves, frames, primitives). */
function guidsOf(m: BimModel, ids: string[]): Record<string, string> {
  const byId = new Map<string, string>()
  for (const list of [m.walls, m.doors, m.windows, m.columns, m.slabs, m.stairs, m.railings, m.components, m.beams ?? [], m.footings ?? [], m.roofs ?? []] as { id: string; guid?: string }[][])
    for (const e of list) if (e.guid) byId.set(e.id, e.guid)
  const out: Record<string, string> = {}
  for (const id of ids) {
    const base = id.replace(/^(glass|leaf):/, '').replace(/:frame$/, '')
    const g = byId.get(base)
    if (g) out[id] = g
  }
  return out
}

const viewKey = (v: SceneView) => JSON.stringify({ d: !!v.doorsOpen })

/** Forgets what a scene holds (the next sync reloads it). */
export const forget = (key: string) => synced.delete(key)

/**
 * Brings the native scene `key` to `model`: a patch when this scene already holds an earlier model (and the host
 * supports it), else a full load. Falls back to a full load when a patch fails.
 */
export async function syncBim3d(host: HostApi, key: string, model: BimModel, view: SceneView = {}, opts: { force?: boolean } = {}): Promise<SyncResult> {
  const t0 = performance.now()
  const prev = synced.get(key)
  const nm = nativeBuildingModel(model)
  const items = bimExtras(model, view).items
  const extras = new Map(items.map((i) => [i.id, JSON.stringify(i)]))
  const walls = wallInputs(nm)
  const vk = viewKey(view)
  const done = (r: SyncResult) => {
    const out = { ...r, rev: model.rev }
    lastSync.set(key, out)
    syncLog.push({ ...out, key, at: Date.now() })
    if (syncLog.length > 50) syncLog.shift()
    return out
  }
  const full = async (): Promise<SyncResult> => {
    const r = await host.scene3dLoadBim(key, JSON.stringify(nm), JSON.stringify({ items }))
    if (!r.ok) {
      synced.delete(key)
      return done({ ok: false, mode: 'full', error: r.error })
    }
    await host.scene3dCommand(key, JSON.stringify({ cmd: 'tag', guids: guidsOf(model, [...walls.keys(), ...nm.windows.map((o) => `glass:${o.id}`), ...extras.keys()]) }))
    synced.set(key, { model, view: vk, extras, walls, host })
    return done({ ok: true, mode: 'full', items: r.items, failures: r.failures, ms: r.ms ?? performance.now() - t0 })
  }
  if (!prev || prev.host !== host || opts.force || !host.scene3dPatch || !incrementalOn()) return full()
  if (prev.model === model && prev.view === vk) return done({ ok: true, mode: 'none', ms: 0, rebuilt: [] })

  // walls whose native inputs changed, cross-checked with the dependency graph
  const dirty = dirtyOf(prev.model, model)
  const rebuild = new Set<string>()
  for (const [id, sig] of walls) if (prev.walls.get(id) !== sig) rebuild.add(id)
  for (const id of dirty.native.walls) if (walls.has(id)) rebuild.add(id)
  const remove: string[] = []
  for (const id of prev.walls.keys()) if (!walls.has(id)) remove.push(id)
  const upserts = items.filter((i) => prev.extras.get(i.id) !== extras.get(i.id))
  for (const id of prev.extras.keys()) if (!extras.has(id) && !walls.has(id)) remove.push(id)
  const nativeChanged = rebuild.size > 0 || remove.some((id) => prev.walls.has(id)) || prev.model.levels !== model.levels || JSON.stringify(prev.model.slabs.map((s) => [s.level, s.kind])) !== JSON.stringify(model.slabs.map((s) => [s.level, s.kind]))
  if (!rebuild.size && !upserts.length && !remove.length && !nativeChanged) {
    synced.set(key, { model, view: vk, extras, walls, host })
    return done({ ok: true, mode: 'none', ms: performance.now() - t0, rebuilt: [], dirty: dirty.guids.size })
  }
  const ids = [...rebuild, ...nm.windows.filter((o) => rebuild.has(o.hostWall)).map((o) => `glass:${o.id}`), ...upserts.map((i) => i.id)]
  const payload = { ...(rebuild.size || nativeChanged ? { model: nm } : {}), walls: [...rebuild], items: upserts, levelSlabs: nativeChanged, guids: guidsOf(model, ids) }
  let r: Awaited<ReturnType<NonNullable<HostApi['scene3dPatch']>>>
  try {
    r = await host.scene3dPatch(key, JSON.stringify(payload), JSON.stringify(remove))
  } catch (e) {
    r = { ok: false, error: String(e) }
  }
  if (!r.ok) return full()
  synced.set(key, { model, view: vk, extras, walls, host })
  return done({ ok: true, mode: 'patch', items: r.items, ms: r.ms, rebuilt: r.rebuilt ?? [], removed: r.removed ?? [], dirty: dirty.guids.size, built: r.built })
}

if (typeof window !== 'undefined') {
  const w = window as unknown as { __thcad?: Record<string, unknown> }
  w.__thcad = { ...(w.__thcad ?? {}), live3d: { lastSync, syncLog, forget } }
}
