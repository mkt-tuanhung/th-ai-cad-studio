import { cadMirror, useCad } from '../state/cad'
import { toast } from '../state/toast'
import type { CadOp } from '../cad/commandBus'
import type { CadDocument } from '../cad/types'
import { getMessages } from '../i18n'
import { useSettings } from '../state/settings'
import type { HostApi } from './host'
import { toNativeDocument, toNativeEntity } from './nativeCad'

/**
 * Keeps the native C++ command bus in lock-step with the CAD 2D screen (desktop app only).
 * The UI commits optimistically; the engine re-validates every op. If the engine rejects an op,
 * the local commit is rolled back. Entity counts are compared after each step and the engine is
 * re-seeded from the UI document if they ever diverge.
 */
export interface SyncStats {
  mirrored: number
  rejected: number
  resyncs: number
  loads: number
  lastError: string | null
}
export const syncStats: SyncStats = { mirrored: 0, rejected: 0, resyncs: 0, loads: 0, lastError: null }
;(window as unknown as { thcadSyncStats: SyncStats }).thcadSyncStats = syncStats
// Read-only accessor for the in-app QA scripts (drawings live in IndexedDB, not localStorage).
;(window as unknown as { thcadActiveDoc: () => CadDocument | null }).thcadActiveDoc = () => useCad.getState().activeDoc()

let host: HostApi | null = null
let loadedDocId: string | null = null
let chain: Promise<unknown> = Promise.resolve()
const enqueue = <T>(fn: () => Promise<T>) => (chain = chain.then(fn, fn)) as Promise<T>

export function toNativeOp(op: CadOp) {
  switch (op.type) {
    case 'add':
    case 'replace':
      return { type: op.type, label: op.label, entities: op.entities.map(toNativeEntity) }
    case 'erase':
      return { type: 'erase', label: op.label, ids: op.ids }
    case 'setCurrentLayer':
      return { type: 'setCurrentLayer', label: op.label, layer: op.layer }
    case 'layerProps':
      return { type: 'layerProps', label: op.label, name: op.name, ...op.patch }
    case 'addLayer':
      return { type: 'addLayer', label: op.label, name: op.name, color: op.color }
  }
}

async function load(doc: CadDocument) {
  if (!host) return
  const r = await host.cadLoad(JSON.stringify(toNativeDocument(doc)))
  if (r.ok) {
    loadedDocId = doc.id
    syncStats.loads++
  }
}

/** Makes sure the engine holds exactly the UI's current version of `doc` (used before AI requests). */
export function ensureLoaded(doc: CadDocument): Promise<void> {
  return enqueue(() => load(doc))
}

async function verify(docId: string, nativeCount: number | undefined) {
  const doc = useCad.getState().docs[docId]
  if (!doc || nativeCount === undefined || nativeCount === doc.entities.length) return
  syncStats.resyncs++
  await load(doc)
}

export function installNativeSync(h: HostApi) {
  host = h
  // drawings hydrate asynchronously (IndexedDB): make the engine re-adopt the restored document
  useCad.persist.onFinishHydration(() => { loadedDocId = null })
  cadMirror.current = {
    commit: (docId, ops, label) =>
      enqueue(async () => {
        const doc = useCad.getState().docs[docId]
        if (!doc) return
        if (loadedDocId !== docId) return load(doc) // engine adopts the UI document (already includes the op)
        const r = (await h.cadExecute(JSON.stringify({ ops: ops.map(toNativeOp) }))) as {
          ok: boolean
          error?: { code: string; detail: string }
          document?: { entities: unknown[] }
        }
        if (!r.ok) {
          syncStats.rejected++
          syncStats.lastError = `${r.error?.code} ${r.error?.detail}`
          // engine is authoritative: roll the optimistic local commit back
          cadMirror.suspended = true
          try {
            if (useCad.getState().activeId === docId) useCad.getState().undo()
          } finally {
            cadMirror.suspended = false
          }
          const t = getMessages(useSettings.getState().language).cad
          useCad.getState().print(`${label}: ${syncStats.lastError}`, 'error')
          toast(`${t.sync.rejected} ${label}: ${syncStats.lastError}`, 'warning')
          return
        }
        syncStats.mirrored++
        await verify(docId, r.document?.entities.length)
      }),
    undo: (docId) =>
      enqueue(async () => {
        if (loadedDocId !== docId) return load(useCad.getState().docs[docId])
        const r = await h.cadUndo()
        syncStats.mirrored++
        await verify(docId, r?.document?.entities.length)
      }),
    redo: (docId) =>
      enqueue(async () => {
        if (loadedDocId !== docId) return load(useCad.getState().docs[docId])
        const r = await h.cadRedo()
        syncStats.mirrored++
        await verify(docId, r?.document?.entities.length)
      }),
  }
  // engine starts on the active drawing; re-seed whenever the active drawing changes
  const active = useCad.getState().activeDoc()
  if (active) ensureLoaded(active)
  useCad.subscribe((s, prev) => {
    if (s.activeId && s.activeId !== prev.activeId && s.docs[s.activeId]) ensureLoaded(s.docs[s.activeId])
  })
}
