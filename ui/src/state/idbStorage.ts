import type { PersistStorage, StorageValue } from 'zustand/middleware'

/**
 * zustand persist storage that keeps one heavy field (the drawings) in IndexedDB and everything
 * else in localStorage. localStorage's ~5 MB quota is exceeded by one large DXF (a 40k-entity
 * drawing is ~15 MB as JSON). The light part is written synchronously as before; the heavy field
 * is stored as a structured clone (no JSON), only when its reference changes (zustand updates are
 * immutable, so pointer moves / selection never rewrite drawings), coalesced while edits are in
 * flight and flushed when the page is hidden.
 */
const DB = 'thcad'
const STORE = 'kv'
const IDLE_MS = 400
let dbp: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbp
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(STORE, mode)
        const req = fn(tx.objectStore(STORE))
        tx.oncomplete = () => resolve(req.result)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }),
  )
}

const pending = new Map<string, unknown>()
let timer: ReturnType<typeof setTimeout> | null = null

function flush() {
  if (timer) clearTimeout(timer)
  timer = null
  for (const [name, value] of pending) {
    pending.delete(name)
    run('readwrite', (s) => s.put(value, name))
      .catch((e) => console.warn(`[thcad] could not persist ${name}:`, e))
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush())
}

export function idbStorage<S>(heavy: keyof S & string): PersistStorage<S> {
  const heavyKey = (name: string) => `${name}.${heavy}`
  let lastHeavy: unknown = undefined
  return {
    getItem: async (name) => {
      const raw = localStorage.getItem(name)
      const light = raw ? (JSON.parse(raw) as StorageValue<S>) : null
      let stored: unknown
      try {
        stored = await run('readonly', (s) => s.get(heavyKey(name)))
      } catch {
        /* IndexedDB unavailable: the light part (or a legacy full value) is all there is */
      }
      if (!light) return null
      const state = light.state as Record<string, unknown>
      // a legacy all-in-localStorage value keeps its drawings until the first write moves them
      if (stored !== undefined) lastHeavy = state[heavy] = stored
      return light
    },
    setItem: (name, value) => {
      const { [heavy]: h, ...rest } = value.state as Record<string, unknown>
      try {
        localStorage.setItem(name, JSON.stringify({ ...value, state: rest }))
      } catch (e) {
        console.warn(`[thcad] could not persist ${name}:`, e)
      }
      if (h === lastHeavy) return
      const first = lastHeavy === undefined
      lastHeavy = h
      pending.set(heavyKey(name), h)
      if (timer) clearTimeout(timer)
      if (first) flush() // migration / first save: no delay
      else timer = setTimeout(flush, IDLE_MS)
    },
    removeItem: async (name) => {
      pending.delete(heavyKey(name))
      localStorage.removeItem(name)
      await run('readwrite', (s) => s.delete(heavyKey(name))).catch(() => undefined)
    },
  }
}
