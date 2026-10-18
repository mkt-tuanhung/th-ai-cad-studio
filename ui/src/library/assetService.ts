/**
 * Desktop side of the 3D asset library: loads the host's manifest into the mirror store, relays the host's library
 * events (Poly Haven fetches, downloads, imports, probes) and builds the Poly Haven download plans.
 * Network is used only from the explicit user actions that call `fetchJson` / `downloadStarter` / `downloadAsset`.
 */
import type { HostApi } from '../services/host'
import { parseManifest, useAssetLibrary, type LibAsset, type LibraryProgress } from './assets'
import { PH_API, STARTER_HDRIS, STARTER_MATERIALS, STARTER_MODELS, planAsset, type PhInfo, type PlanAsset } from './polyhaven'
import { composedPrims, partsFor, presetAssets } from './composer'
import { itemBox } from './assets'
import { PARTS } from '../interior/materials'
import { setComposedResolver } from '../interior/scene'

// the live OCCT view draws composed pieces (presets, "Tự vẽ") from their parts, scaled into the item's box
setComposedResolver((assetId, i, at) => {
  const a = assetId.startsWith('preset-') ? presetAssets().find((x) => x.id === assetId) : useAssetLibrary.getState().assets.find((x) => x.id === assetId)
  if (!a || a.files.main || !a.parts?.length) return null
  const b = itemBox(i)
  const parts = partsFor(a, b.w, b.d, b.h)
  const tag = PARTS[i.category]?.[0] ?? 'body'
  return at.flatMap((p) => composedPrims(parts, p, i.elev ?? 0).map((prim) => ({ part: tag, prim })))
})

export interface LibraryEvent extends LibraryProgress {
  type: 'fetch' | 'download' | 'import' | 'probe'
  id?: string
  text?: string
  status?: number
  [k: string]: unknown
}

let attached: HostApi | null = null
const waiters = new Map<string, (e: LibraryEvent) => void>()
const listeners = new Set<(e: LibraryEvent) => void>()
let seq = 0
let loading: Promise<void> | null = null

function onEvent(e: LibraryEvent) {
  if (e.type === 'fetch' && e.id && waiters.has(e.id)) {
    waiters.get(e.id)!(e)
    waiters.delete(e.id)
  }
  if (e.type === 'download') {
    // the latest event is the state (an asset's ok / error belongs to that asset only)
    const prev = useAssetLibrary.getState().progress
    useAssetLibrary.getState().set({ progress: e.done ? { ...e, phase: 'done' } : e.phase === 'download' ? e : { ...prev, phase: e.phase, index: e.index ?? prev?.index, assets: e.assets ?? prev?.assets } })
    if (e.done || e.phase === 'asset') void refreshLibrary(attached!)
  }
  if (e.type === 'probe' && e.done) void refreshLibrary(attached!)
  for (const fn of listeners) fn(e)
}

export function attachLibrary(host: HostApi) {
  if (attached) return
  attached = host
  host.on('libraryEvent', (p) => onEvent(p as LibraryEvent))
}

/** Subscribe to library events (dialogs); returns the unsubscribe function. */
export function onLibraryEvent(fn: (e: LibraryEvent) => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/** Reloads the manifest from the host. */
export async function refreshLibrary(host: HostApi | null) {
  if (!host || typeof host.libraryList !== 'function') return
  attachLibrary(host)
  const r = await host.libraryList()
  if (!r?.ok) return
  useAssetLibrary.getState().set({ dir: r.dir, assets: parseManifest(r.manifest).items, bytes: r.bytes, loaded: true, blender: r.blender, freeBytes: r.freeBytes })
}

/** The manifest is loaded once per session before the first render / dialog needs it. */
export function ensureLibrary(host: HostApi | null): Promise<void> {
  if (useAssetLibrary.getState().loaded || !host) return Promise.resolve()
  return (loading ??= refreshLibrary(host).catch(() => undefined).finally(() => (loading = null)))
}

/** Thumbnails (data URLs) of entries not cached yet. */
export async function loadThumbs(host: HostApi, ids: string[]) {
  const have = useAssetLibrary.getState().thumbs
  const want = ids.filter((id) => !(id in have))
  if (!want.length) return
  const got = await host.libraryThumbs(JSON.stringify(want))
  const next = { ...useAssetLibrary.getState().thumbs }
  for (const id of want) next[id] = got?.[id] ?? ''
  useAssetLibrary.getState().set({ thumbs: next })
}

/** GET an allow-listed Poly Haven API URL through the host (user action) → parsed JSON. */
export function fetchJson(host: HostApi, url: string, timeoutMs = 90000): Promise<unknown> {
  attachLibrary(host)
  const id = `f${Date.now().toString(36)}${(seq++).toString(36)}`
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => (waiters.delete(id), reject(new Error('timeout'))), timeoutMs)
    waiters.set(id, (e) => {
      clearTimeout(t)
      if (!e.ok || typeof e.text !== 'string') return reject(new Error(String(e.error ?? 'network error')))
      try {
        resolve(JSON.parse(e.text))
      } catch {
        reject(new Error('bad JSON'))
      }
    })
    host.libraryFetch(id, url).then((r) => {
      if (!r.ok) {
        clearTimeout(t)
        waiters.delete(id)
        reject(new Error(r.error ?? 'refused'))
      }
    })
  })
}

type Catalogue = Record<string, PhInfo & { category?: string }>
const catalogues: Partial<Record<'models' | 'textures' | 'hdris', Catalogue>> = {}

/** Poly Haven catalogue of a type (cached for the session). */
export async function catalogue(host: HostApi, t: 'models' | 'textures' | 'hdris'): Promise<Catalogue> {
  return (catalogues[t] ??= (await fetchJson(host, `${PH_API}/assets?t=${t}`)) as Catalogue)
}

const kindOf = { models: 'model', textures: 'material', hdris: 'hdri' } as const

/** Download plans of the given assets (their file lists from the API), a few requests at a time. */
export async function planFor(host: HostApi, list: { t: 'models' | 'textures' | 'hdris'; id: string }[], onStep?: (done: number, total: number) => void): Promise<{ plan: PlanAsset[]; missing: string[] }> {
  const plan: PlanAsset[] = []
  const missing: string[] = []
  let done = 0
  const queue = [...list]
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      try {
        const cat = await catalogue(host, job.t)
        const info = cat[job.id]
        if (!info) throw new Error('not in the catalogue')
        const files = await fetchJson(host, `${PH_API}/files/${job.id}`)
        const p = planAsset(kindOf[job.t], job.id, files, info)
        if (p) plan.push(p)
        else missing.push(job.id)
      } catch {
        missing.push(job.id)
      }
      onStep?.(++done, list.length)
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  // keep the starter order (the manifest lists them like the curated list)
  const order = new Map(list.map((x, i) => [x.id, i]))
  plan.sort((a, b) => order.get(a.id)! - order.get(b.id)!)
  return { plan, missing }
}

/** The curated starter set (models, materials, HDRIs) minus what the library already has. */
export function starterList(have: LibAsset[]) {
  const got = new Set(have.map((a) => a.id))
  return [
    ...STARTER_MODELS.map((m) => ({ t: 'models' as const, id: m.id })),
    ...STARTER_MATERIALS.map((m) => ({ t: 'textures' as const, id: m.id })),
    ...STARTER_HDRIS.map((m) => ({ t: 'hdris' as const, id: m.id })),
  ].filter((x) => !got.has(x.id))
}

/** "Tải thư viện nội thất mẫu": plan the missing starter assets and start the host download. */
export async function downloadStarter(host: HostApi, onStep?: (done: number, total: number) => void) {
  await ensureLibrary(host)
  const list = starterList(useAssetLibrary.getState().assets)
  if (!list.length) return { ok: true, assets: 0, bytes: 0, missing: [] as string[] }
  useAssetLibrary.getState().set({ progress: { phase: 'plan', index: 0, assets: list.length } })
  const { plan, missing } = await planFor(host, list, (d, n) => {
    onStep?.(d, n)
    useAssetLibrary.getState().set({ progress: { phase: 'plan', index: d, assets: n } })
  })
  if (!plan.length) {
    useAssetLibrary.getState().set({ progress: { done: true, ok: false, error: 'no files to download', phase: 'done' } })
    return { ok: false, error: 'no files', missing }
  }
  const r = await host.libraryDownload(JSON.stringify(plan))
  if (!r.ok) useAssetLibrary.getState().set({ progress: { done: true, ok: false, error: r.error, phase: 'done' } })
  return { ...r, missing }
}

/** "Tải từ mạng": one Poly Haven asset into the library. */
export async function downloadAsset(host: HostApi, t: 'models' | 'textures' | 'hdris', id: string) {
  const { plan, missing } = await planFor(host, [{ t, id }])
  if (!plan.length) return { ok: false, error: missing.length ? 'not available' : 'no files' }
  return host.libraryDownload(JSON.stringify(plan))
}
