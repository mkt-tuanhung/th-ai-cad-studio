/**
 * Backups of the models a build replaces (one command, Build from CAD plans): before the BIM model, the Interior
 * data, the Civil route or the MEP model is replaced, the current one is saved (the last BACKUPS per workspace, with
 * the time and what replaced it). The undo stack lives in memory only — the backup survives closing the app.
 * Restoring goes through the workspace's own validated edit (one undo step) and backs up what it replaces.
 *
 * Kept in IndexedDB (its own database: a model can be several MB, and localStorage's ~5 MB is the workspaces' own
 * persistence — a backup must never crowd it out); localStorage only where IndexedDB is missing.
 */
import { useBim } from '../state/bim'
import { useInterior } from '../state/interior'
import { useCivil } from '../state/civil'
import { useMep } from '../state/mep'

export type BackupStore = 'bim' | 'interior' | 'civil' | 'mep'
export const BACKUP_STORES: BackupStore[] = ['bim', 'interior', 'civil', 'mep']
/** how many backups are kept per workspace */
export const BACKUPS = 3

export interface Backup<D = unknown> {
  at: number
  /** what replaced it ("One command: house.dxf") */
  label: string
  doc: D
}

const key = (s: BackupStore) => `thcad.backup.${s}`

/* ---------------------------------------------------------------- storage */

const DB = 'thcad-backup', STORE = 'kv'
let dbp: Promise<IDBDatabase> | null = null
const hasIdb = () => typeof indexedDB !== 'undefined'
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbp
}
async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  return new Promise<T>((resolve, reject) => {
    const tx = d.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(req.result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}
function ls(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

async function read(s: BackupStore): Promise<Backup[]> {
  try {
    const v = hasIdb() ? await idb<unknown>('readonly', (st) => st.get(key(s))) : JSON.parse(ls()?.getItem(key(s)) ?? '[]')
    return Array.isArray(v) ? (v as Backup[]).filter((b) => b && typeof b.at === 'number' && b.doc) : []
  } catch {
    return []
  }
}
async function write(s: BackupStore, list: Backup[]): Promise<void> {
  if (hasIdb()) { await idb('readwrite', (st) => st.put(list, key(s))); return }
  const l = ls()
  if (!l) throw new Error('no storage')
  l.setItem(key(s), JSON.stringify(list))
}

/* ---------------------------------------------------------------- API */

export function listBackups(s: BackupStore): Promise<Backup[]> {
  return read(s)
}

/** The workspace's current model. */
export function currentDoc(s: BackupStore): unknown {
  return s === 'bim' ? useBim.getState().model : s === 'interior' ? useInterior.getState().doc : s === 'civil' ? useCivil.getState().doc : useMep.getState().doc
}

/**
 * Saves `doc` (the model about to be replaced) as the newest backup of the workspace. When the storage is full the
 * oldest backups are given up first; false when even this one cannot be kept (the caller says so — the model is
 * then only in the undo stack of this session).
 */
export async function backupModel(s: BackupStore, label: string, doc: unknown = currentDoc(s), now = Date.now()): Promise<boolean> {
  const list: Backup[] = [{ at: now, label, doc }, ...(await read(s))].slice(0, BACKUPS)
  for (let n = list.length; n >= 1; n--) {
    try {
      await write(s, list.slice(0, n))
      return true
    } catch {
      /* quota: keep fewer */
    }
  }
  return false
}

/**
 * Restores the newest backup (or the i-th) through the workspace's validated, undoable edit. The model it replaces
 * takes its place in the backups (restoring twice swaps back). Null, or the reason it was not restored ('none' when
 * there is no backup, else the model rule that rejected it).
 */
export async function restoreBackup(s: BackupStore, label: string, i = 0): Promise<string | null> {
  const list = await read(s)
  const b = list[i]
  if (!b) return 'none'
  const cur = currentDoc(s)
  let err: string | null
  if (s === 'bim') {
    const st = useBim.getState()
    err = st.edit(label, () => b.doc as typeof st.model)
    if (!err) { const m = useBim.getState().model; st.set({ level: m.levels[0]?.id ?? 'L1', selection: null, drawing: null }); st.runChecks() }
  } else if (s === 'interior') {
    const st = useInterior.getState()
    err = st.edit(label, () => b.doc as typeof st.doc)
    if (!err) st.set({ sel: null, appliedPreset: null })
  } else if (s === 'civil') {
    const st = useCivil.getState()
    err = st.edit(label, () => b.doc as typeof st.doc)
  } else {
    const st = useMep.getState()
    err = st.edit(label, () => b.doc as typeof st.doc)
    if (!err) st.set({ sel: null })
  }
  if (err) return err
  const rest = list.filter((_, k) => k !== i)
  try {
    await write(s, [{ at: Date.now(), label, doc: cur }, ...rest].slice(0, BACKUPS))
  } catch {
    try { await write(s, rest) } catch { /* storage full: the backups stay as they were */ }
  }
  return null
}

/** The newest backup of each workspace that has one (for the "Restore the previous model" actions). */
export async function latestBackups(stores: BackupStore[] = BACKUP_STORES): Promise<{ store: BackupStore; at: number; label: string }[]> {
  const out: { store: BackupStore; at: number; label: string }[] = []
  for (const s of stores) { const b = (await read(s))[0]; if (b) out.push({ store: s, at: b.at, label: b.label }) }
  return out
}
