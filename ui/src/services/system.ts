import { getHost, type HostSystemInfo } from './host'
import { getLocalAi, type LocalAiStatus } from './localAi'
import { sessionFiles } from '../screens/projects/ProjectFiles'

/**
 * Live system facts for Settings: local AI runtime, models, disk, GPU, storage. In a plain browser
 * there is no host: AI values come from the demo runtime (flagged `source: 'demo'`) and disk figures
 * from the browser's storage estimate.
 */
export interface SystemStatus {
  ai: LocalAiStatus
  host: HostSystemInfo | null
  info: { engine: string; occt: string | null; aiBackend: string; dwgReader?: string } | null
  webgl2: boolean
  /** Bytes used by Cache Storage (thumbnails / downloads) — what "Clear Cache" removes. */
  cacheBytes: number
  /** Browser-side app data (drawings in IndexedDB, settings). */
  appDataBytes: number
  /** Capacity of the volume (desktop) or the browser storage quota. */
  capacityBytes: number
}

export function hasWebGl2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

async function cacheStorageBytes(): Promise<number> {
  if (!('caches' in window)) return 0
  let n = 0
  for (const key of await caches.keys()) {
    const c = await caches.open(key)
    for (const req of await c.keys()) {
      const res = await c.match(req)
      if (res) n += (await res.clone().arrayBuffer()).byteLength
    }
  }
  return n
}

export async function readSystemStatus(): Promise<SystemStatus> {
  const host = await getHost()
  const [ai, hostInfo, info, cacheBytes, estimate] = await Promise.all([
    getLocalAi().status(),
    host ? host.systemInfo().catch(() => null) : Promise.resolve(null),
    host ? host.info().catch(() => null) : Promise.resolve(null),
    cacheStorageBytes().catch(() => 0),
    navigator.storage?.estimate?.().catch(() => ({ usage: 0, quota: 0 })) ?? Promise.resolve({ usage: 0, quota: 0 }),
  ])
  const sessionBytes = [...sessionFiles.values()].reduce((n, f) => n + f.size, 0)
  return {
    ai,
    host: hostInfo,
    info,
    webgl2: hasWebGl2(),
    cacheBytes: cacheBytes + sessionBytes,
    appDataBytes: Math.max(0, (estimate.usage ?? 0) - cacheBytes),
    capacityBytes: hostInfo?.disk.total || estimate.quota || 0,
  }
}

/** Settings → Performance → Clear Cache: Cache Storage + this session's imported file contents. */
export async function clearCaches(): Promise<void> {
  if ('caches' in window) for (const key of await caches.keys()) await caches.delete(key)
  sessionFiles.clear()
}

export function formatGb(bytes: number): string {
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  const mb = bytes / 1024 ** 2
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}
