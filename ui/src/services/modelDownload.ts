import { create } from 'zustand'
import { getHost } from './host'

/** One model of the host's download catalogue (native/app/src/model_downloader.cpp). */
export interface CatalogueModel {
  id: string
  label: string
  bytes: number
  installed: boolean
  /** Bytes already on disk from an interrupted download (resumes from there). */
  partialBytes: number
  /** Fits the memory budget the runtime uses to pick a model on this computer. */
  fits: boolean
}

export interface ModelDownloadState {
  dir: string
  freeBytes: number
  ramBytes: number
  recommended: string
  running: boolean
  /** Downloading, or loading / testing the model just installed. */
  busy?: boolean
  current: string
  /** The last final event (ok or not) — lets the UI catch up if it missed the signal. */
  last?: ModelProgress
  models: CatalogueModel[]
}

export type ModelPhase = 'download' | 'verify' | 'retry' | 'load' | 'test'

export interface ModelProgress {
  id: string
  phase?: ModelPhase
  received?: number
  total?: number
  bytesPerSecond?: number
  etaSeconds?: number
  shard?: number
  shards?: number
  attempt?: number
  inSeconds?: number
  done?: boolean
  ok?: boolean
  cancelled?: boolean
  error?: string
  needBytes?: number
  freeBytes?: number
  test?: string
  device?: string
  model?: string
  tokensPerSecond?: number
}

interface Store {
  state: ModelDownloadState | null
  /** Last event of the running download (kept while Settings is closed). */
  progress: ModelProgress | null
  /** Final event of the last download (success or error), until the next one starts. */
  result: ModelProgress | null
  refresh: () => Promise<void>
  start: (id: string) => Promise<void>
  cancel: () => Promise<void>
}

let subscribed = false
let poll: ReturnType<typeof setInterval> | null = null
let starting = false  // between Download and the host accepting it: its last event is still the previous run's
const listeners = new Set<(r: ModelProgress) => void>()
/** Called once a download has finished (ok or not): Settings refreshes the system status with it. */
export function onModelDownloadDone(fn: (r: ModelProgress) => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/**
 * The local AI model download, shared by Settings and the AI panels. The host does the work (free space,
 * resume, retries, sha256, atomic install into the folder the runtime reads, load + test question); this
 * store only mirrors its events. One subscription to the host signal for the whole app.
 */
export const useModelDownload = create<Store>((set, get) => {
  const finish = (p: ModelProgress) => {
    if (!get().progress) return // already handled (signal and poll both report it)
    set({ progress: null, result: p })
    void get().refresh()
    listeners.forEach((fn) => fn(p))
  }
  return {
    state: null,
    progress: null,
    result: null,
    refresh: async () => {
      const h = await getHost()
      if (!h) return
      if (!subscribed) {
        subscribed = true
        h.on('modelProgress', (raw) => {
          const p = raw as ModelProgress
          if (p.done) finish(p)
          else set({ progress: p })
        })
      }
      const state = await h.modelDownloadState()
      set({ state })
      // a download started earlier in this session is still running (Settings was closed and reopened)
      if (state.busy && !get().progress) set({ progress: { id: state.current, phase: state.running ? 'download' : 'load' } })
      // the host has finished but this page did not hear it (a missed signal): take its final event
      if (!starting && !state.busy && get().progress && state.last) finish(state.last)
      // while something runs, ask the host every few seconds as well — the UI never stays on a stale step
      if (get().progress && !poll) poll = setInterval(() => void get().refresh(), 3000)
      if (!get().progress && poll) {
        clearInterval(poll)
        poll = null
      }
    },
    start: async (id) => {
      const h = await getHost()
      if (!h) return
      await get().refresh()
      set({ result: null, progress: { id, phase: 'download', received: 0 } })
      starting = true
      const r = await h.modelDownload(id).finally(() => (starting = false))
      if (!r.ok) return set({ progress: null, result: { id, done: true, ok: false, error: r.error, needBytes: r.needBytes, freeBytes: r.freeBytes } })
      void get().refresh() // starts the catch-up poll
    },
    cancel: async () => {
      const h = await getHost()
      await h?.modelDownloadCancel()
    },
  }
})
