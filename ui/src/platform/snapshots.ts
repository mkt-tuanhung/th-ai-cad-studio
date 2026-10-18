/**
 * Version history (SP50, V24-062/063): local snapshots of every model workspace — BIM, Interior, CAD 2D drawings,
 * MEP, Civil, Mechanical, Renders — kept on this computer (IndexedDB), listed with provenance (time, label, why,
 * app version, project, one revision id per workspace) and a diff summary in element counts, and restorable.
 *
 * When a snapshot is taken (Settings → File Handling):
 *  - "Auto-recover" (autoRecover): every N minutes (the current project's auto-save interval, default 10) when
 *    something changed since the last snapshot;
 *  - "Create backup on save" (backup): on Save (⌘S in any workspace, CAD 2D Save) and before risky operations
 *    (restoring a snapshot, importing a project file, creating a project from a template, a large replacement);
 *  - always on "Save version now" in Version history.
 *
 * Restoring goes through each workspace's own validated edit (one undo step per workspace; CAD drawings through
 * useCad.restoreDoc), after a "before restore" snapshot. An older snapshot is migrated first with the store's own
 * persist migration. Storage: the IndexedDB database of auto/backup.ts ("thcad-backup", store "kv") under its own
 * keys — the pre-replace backups of the one-command build stay where they are and are listed next to these.
 */
import { useBim } from '../state/bim'
import { useInterior } from '../state/interior'
import { useCad } from '../state/cad'
import { useMep } from '../state/mep'
import { useCivil } from '../state/civil'
import { useMech } from '../state/mech'
import { useRenders } from '../state/renders'
import { useSettings } from '../state/settings'
import { useWorkspace } from '../state/workspace'
import type { CadDocument } from '../cad/types'

export const APP_VERSION = '0.1.0'
export const SNAPSHOT_SCHEMA = 1
/** how many snapshots are kept (interval snapshots: at most INTERVAL_KEEP of them) */
export const KEEP = 20
export const INTERVAL_KEEP = 10

export type ModelStore = 'bim' | 'interior' | 'cad' | 'mep' | 'civil' | 'mech' | 'renders'
export const MODEL_STORES: ModelStore[] = ['bim', 'interior', 'cad', 'mep', 'civil', 'mech', 'renders']
export type SnapshotReason = 'save' | 'interval' | 'risky' | 'manual' | 'import' | 'template'

/** CAD 2D part of a snapshot: the open drawings. */
export interface CadPart { docs: Record<string, CadDocument>; tabs: string[]; activeId: string | null }
export type StoreDocs = Partial<Record<ModelStore, unknown>>

export interface SnapshotMeta {
  id: string
  at: number
  label: string
  reason: SnapshotReason
  appVersion: string
  schema: number
  project: { id: string; name: string } | null
  /** persist version of each store when the snapshot was taken (older ones are migrated on restore) */
  storeVersions: Record<ModelStore, number>
  /** content revision id per workspace (a hash: equal ids = identical model) */
  revisions: Record<ModelStore, string>
  counts: Record<ModelStore, Record<string, number>>
}
export interface Snapshot extends SnapshotMeta { stores: StoreDocs }

/* ---------------------------------------------------------------- adapters */

interface Adapter {
  get: () => unknown
  /** validated, undoable replacement; null or the rule that rejected it */
  apply: (doc: unknown, label: string) => string | null
  version: () => number
  /** the store's persist migration on this part */
  migrate: (doc: unknown, from: number) => unknown
}

const persistOpts = (s: { persist: { getOptions: () => { version?: number; migrate?: (p: unknown, v: number) => unknown } } }) => s.persist.getOptions()
const viaMigrate = (store: Parameters<typeof persistOpts>[0], key: string) => (doc: unknown, from: number) => {
  const o = persistOpts(store)
  if (!o.migrate || from >= (o.version ?? 0)) return doc
  const r = o.migrate({ [key]: doc }, from) as Record<string, unknown>
  return r?.[key] ?? doc
}

const ADAPTERS: Record<ModelStore, Adapter> = {
  bim: {
    get: () => useBim.getState().model,
    apply: (doc, label) => {
      const st = useBim.getState()
      const err = st.edit(label, () => doc as typeof st.model)
      if (!err) { const m = useBim.getState().model; st.set({ level: m.levels.some((l) => l.id === st.level) ? st.level : (m.levels[0]?.id ?? 'L1'), selection: null, drawing: null }); st.runChecks() }
      return err
    },
    version: () => persistOpts(useBim).version ?? 0,
    migrate: viaMigrate(useBim, 'model'),
  },
  interior: {
    get: () => useInterior.getState().doc,
    apply: (doc, label) => {
      const st = useInterior.getState()
      const err = st.edit(label, () => doc as typeof st.doc)
      if (!err) st.set({ sel: null, appliedPreset: null })
      return err
    },
    version: () => persistOpts(useInterior).version ?? 0,
    migrate: viaMigrate(useInterior, 'doc'),
  },
  cad: {
    get: (): CadPart => { const s = useCad.getState(); return { docs: s.docs, tabs: s.tabs, activeId: s.activeId } },
    apply: (part, label) => {
      const p = part as CadPart
      if (!p || typeof p.docs !== 'object') return 'drawings'
      const cad = useCad.getState()
      const active = cad.activeId
      for (const d of Object.values(p.docs)) if (d && Array.isArray(d.entities)) useCad.getState().restoreDoc(d, label)
      const tabs = useCad.getState().tabs
      if (p.activeId && tabs.includes(p.activeId)) useCad.getState().setActive(p.activeId)
      else if (active && tabs.includes(active)) useCad.getState().setActive(active)
      return null
    },
    version: () => persistOpts(useCad).version ?? 0,
    migrate: (part, from) => {
      const o = persistOpts(useCad)
      return o.migrate && from < (o.version ?? 0) ? o.migrate(part, from) : part
    },
  },
  mep: {
    get: () => useMep.getState().doc,
    apply: (doc, label) => {
      const st = useMep.getState()
      const err = st.edit(label, () => doc as typeof st.doc)
      if (!err) st.set({ sel: null })
      return err
    },
    version: () => persistOpts(useMep).version ?? 0,
    migrate: viaMigrate(useMep, 'doc'),
  },
  civil: {
    get: () => useCivil.getState().doc,
    apply: (doc, label) => useCivil.getState().edit(label, () => doc as ReturnType<typeof useCivil.getState>['doc']),
    version: () => persistOpts(useCivil).version ?? 0,
    migrate: viaMigrate(useCivil, 'doc'),
  },
  mech: {
    get: () => useMech.getState().doc,
    apply: (doc, label) => useMech.getState().edit(label, () => doc as ReturnType<typeof useMech.getState>['doc']),
    version: () => persistOpts(useMech).version ?? 0,
    migrate: viaMigrate(useMech, 'doc'),
  },
  renders: {
    get: () => useRenders.getState().doc,
    apply: (doc, label) => useRenders.getState().edit(label, () => doc as ReturnType<typeof useRenders.getState>['doc']),
    version: () => persistOpts(useRenders).version ?? 0,
    migrate: viaMigrate(useRenders, 'doc'),
  },
}

/* ---------------------------------------------------------------- content */

/** The current model of every workspace (references: zustand state is immutable). */
export function captureStores(): StoreDocs {
  const out: StoreDocs = {}
  for (const s of MODEL_STORES) out[s] = ADAPTERS[s].get()
  return out
}
export const storeVersions = () => Object.fromEntries(MODEL_STORES.map((s) => [s, ADAPTERS[s].version()])) as Record<ModelStore, number>

/** FNV-1a 32-bit of a JSON value, as 8 hex digits ("rev-1a2b3c4d"). */
export function revisionOf(v: unknown): string {
  const s = JSON.stringify(v) ?? ''
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return 'rev-' + h.toString(16).padStart(8, '0')
}

/** Element counts of a workspace part: every list of the model (CAD: drawings, entities, layers, layouts). */
export function countsOf(store: ModelStore, doc: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (!doc || typeof doc !== 'object') return out
  if (store === 'cad') {
    const docs = Object.values((doc as CadPart).docs ?? {})
    out.drawings = docs.length
    out.entities = docs.reduce((n, d) => n + (d?.entities?.length ?? 0), 0)
    out.layers = docs.reduce((n, d) => n + (d?.layers?.length ?? 0), 0)
    out.layouts = docs.reduce((n, d) => n + (d?.layouts?.length ?? 0), 0)
    return out
  }
  for (const [k, v] of Object.entries(doc as Record<string, unknown>)) if (Array.isArray(v)) out[k] = v.length
  return out
}

export interface StoreDiff { store: ModelStore; changed: boolean; rows: { key: string; then: number; now: number }[] }
export interface ModelInfo { counts: Record<ModelStore, Record<string, number>>; revisions: Record<ModelStore, string> }

/** Counts and revision ids of the workspaces now (computed once, compared with many snapshots). */
export function currentInfo(now: StoreDocs = captureStores()): ModelInfo {
  const counts = {} as ModelInfo['counts'], revisions = {} as ModelInfo['revisions']
  for (const s of MODEL_STORES) { counts[s] = countsOf(s, now[s]); revisions[s] = revisionOf(now[s]) }
  return { counts, revisions }
}

/** What restoring a snapshot would change, per workspace, in element counts (and whether the content differs). */
export function diffSummary(meta: Pick<SnapshotMeta, 'counts' | 'revisions'>, now: ModelInfo = currentInfo()): StoreDiff[] {
  return MODEL_STORES.filter((s) => meta.counts[s]).map((s) => {
    const a = meta.counts[s] ?? {}, b = now.counts[s] ?? {}
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])]
    return { store: s, changed: now.revisions[s] !== meta.revisions[s], rows: keys.filter((k) => (a[k] ?? 0) !== (b[k] ?? 0)).map((k) => ({ key: k, then: a[k] ?? 0, now: b[k] ?? 0 })) }
  })
}

export function makeSnapshot(label: string, reason: SnapshotReason, stores: StoreDocs = captureStores(), at = Date.now()): Snapshot {
  const ws = useWorkspace.getState()
  const p = ws.projects.find((x) => x.id === ws.currentId)
  const revisions = {} as Record<ModelStore, string>
  const counts = {} as Record<ModelStore, Record<string, number>>
  for (const s of MODEL_STORES) if (stores[s] !== undefined) { revisions[s] = revisionOf(stores[s]); counts[s] = countsOf(s, stores[s]) }
  return {
    id: `snap-${at.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    at, label, reason, appVersion: APP_VERSION, schema: SNAPSHOT_SCHEMA,
    project: p ? { id: p.id, name: p.name } : null,
    storeVersions: storeVersions(), revisions, counts, stores,
  }
}

/* ---------------------------------------------------------------- storage */

export interface SnapStorage {
  list(): Promise<SnapshotMeta[]>
  get(id: string): Promise<Snapshot | null>
  put(s: Snapshot, list: SnapshotMeta[]): Promise<void>
  remove(ids: string[], list: SnapshotMeta[]): Promise<void>
}

const INDEX = 'thcad.snapshots'
const bodyKey = (id: string) => `thcad.snapshot.${id}`
let dbp: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  // the database and store of auto/backup.ts (same name, version and object store)
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('thcad-backup', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('kv')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbp
}
async function tx(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => void | IDBRequest): Promise<unknown> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const t = d.transaction('kv', mode)
    const r = fn(t.objectStore('kv'))
    t.oncomplete = () => resolve(r ? r.result : undefined)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}
const strip = (s: Snapshot): SnapshotMeta => { const { stores: _drop, ...meta } = s; void _drop; return meta }

export const idbSnapStorage: SnapStorage = {
  list: async () => { const v = await tx('readonly', (s) => s.get(INDEX)); return Array.isArray(v) ? (v as SnapshotMeta[]) : [] },
  get: async (id) => ((await tx('readonly', (s) => s.get(bodyKey(id)))) as Snapshot | undefined) ?? null,
  put: async (snap, list) => { await tx('readwrite', (s) => { s.put(snap, bodyKey(snap.id)); s.put(list, INDEX) }) },
  remove: async (ids, list) => { await tx('readwrite', (s) => { for (const id of ids) s.delete(bodyKey(id)); s.put(list, INDEX) }) },
}

/** In-memory storage (no IndexedDB: tests, very old engines). */
export function memorySnapStorage(): SnapStorage {
  const bodies = new Map<string, Snapshot>()
  let index: SnapshotMeta[] = []
  return {
    list: async () => index,
    get: async (id) => bodies.get(id) ?? null,
    put: async (s, list) => { bodies.set(s.id, s); index = list },
    remove: async (ids, list) => { ids.forEach((i) => bodies.delete(i)); index = list },
  }
}

let storage: SnapStorage = typeof indexedDB !== 'undefined' ? idbSnapStorage : memorySnapStorage()
export const setSnapStorage = (s: SnapStorage) => { storage = s }

/* ---------------------------------------------------------------- API */

let last: StoreDocs | null = null
const listeners = new Set<() => void>()
export const onSnapshotsChanged = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }

export const listSnapshots = () => storage.list()
export const getSnapshot = (id: string) => storage.get(id)

/** Keeps the newest KEEP snapshots, at most INTERVAL_KEEP of them interval ones. */
export function retain(list: SnapshotMeta[]): { keep: SnapshotMeta[]; drop: string[] } {
  const sorted = [...list].sort((a, b) => b.at - a.at)
  const keep: SnapshotMeta[] = [], drop: string[] = []
  let intervals = 0
  for (const m of sorted) {
    if (m.reason === 'interval' && ++intervals > INTERVAL_KEEP) drop.push(m.id)
    else if (keep.length >= KEEP) drop.push(m.id)
    else keep.push(m)
  }
  return { keep, drop }
}

/** Saves a snapshot (newest first). When storage is full the oldest are given up first. Null when it could not be kept. */
export async function saveSnapshot(snap: Snapshot): Promise<SnapshotMeta | null> {
  const before = await storage.list().catch(() => [] as SnapshotMeta[])
  let { keep, drop } = retain([strip(snap), ...before])
  for (;;) {
    try {
      await storage.put(snap, keep)
      if (drop.length) await storage.remove(drop, keep)
      last = snap.stores
      listeners.forEach((f) => f())
      return strip(snap)
    } catch {
      if (keep.length <= 1) return null
      drop = [...drop, keep[keep.length - 1].id]
      keep = keep.slice(0, -1)
    }
  }
}

/** True when no workspace changed since the last snapshot of this session (same object references). */
export function unchangedSinceLast(now: StoreDocs = captureStores()): boolean {
  if (!last) return false
  const same = (s: ModelStore) => {
    if (s !== 'cad') return now[s] === last![s]
    const a = now.cad as CadPart | undefined, b = last!.cad as CadPart | undefined
    return a === b || (!!a && !!b && a.docs === b.docs && a.tabs === b.tabs && a.activeId === b.activeId)
  }
  return MODEL_STORES.every(same)
}

/**
 * Takes a snapshot when the Settings allow it: 'interval' needs Auto-recover, 'save' / 'risky' need "backup on
 * save"; 'manual', 'import', 'template' always. Interval / save snapshots are skipped when nothing changed.
 */
export async function snapshotOn(reason: SnapshotReason, label: string, stores?: StoreDocs): Promise<SnapshotMeta | null> {
  const p = useSettings.getState()
  if (reason === 'interval' && !p.autoRecover) return null
  if ((reason === 'save' || reason === 'risky') && !p.backup) return null
  const now = stores ?? captureStores()
  if ((reason === 'interval' || reason === 'save') && unchangedSinceLast(now)) return null
  return saveSnapshot(makeSnapshot(label, reason, now))
}

export interface ApplyResult { applied: ModelStore[]; errors: { store: ModelStore; error: string }[] }

/** Puts workspace parts back through each store's validated, undoable edit (migrating older versions first). */
let applying = 0
/** True while a snapshot / project file / template is being applied (it took its own "before" snapshot). */
export const isApplying = () => applying > 0

export function applyStores(stores: StoreDocs, label: string, versions?: Partial<Record<ModelStore, number>>, only?: ModelStore[]): ApplyResult {
  applying++
  try { return applyAll(stores, label, versions, only) } finally { applying-- }
}
function applyAll(stores: StoreDocs, label: string, versions?: Partial<Record<ModelStore, number>>, only?: ModelStore[]): ApplyResult {
  const out: ApplyResult = { applied: [], errors: [] }
  for (const s of MODEL_STORES) {
    if (stores[s] === undefined || (only && !only.includes(s))) continue
    const a = ADAPTERS[s]
    const from = versions?.[s] ?? a.version()
    const doc = from < a.version() ? a.migrate(stores[s], from) : stores[s]
    if (doc === a.get()) continue
    const err = a.apply(doc, label)
    if (err) out.errors.push({ store: s, error: err })
    else out.applied.push(s)
  }
  return out
}

/** Restores a snapshot (all workspaces, or `only` some), after a "before restore" snapshot. */
export async function restoreSnapshot(id: string, label: string, only?: ModelStore[]): Promise<ApplyResult | 'none'> {
  const snap = await storage.get(id)
  if (!snap) return 'none'
  await snapshotOn('risky', `${label} — before`)
  const r = applyStores(snap.stores, label, snap.storeVersions, only)
  last = captureStores()
  return r
}
