import { getHost, type HostApi } from './host'

/**
 * Opening DWG in the desktop app: the bytes go to the host, which runs the bundled LibreDWG
 * `dwg2dxf` helper (a separate GPL program) and returns DXF bytes; the UI imports those like any
 * DXF. A plain browser has no reader.
 */
export interface DwgResult {
  id: string
  ok: boolean
  dxf?: string
  ms?: number
  warnings?: number
  error?: string
}

const pending = new Map<string, (r: DwgResult) => void>()
const early = new Map<string, DwgResult>()
let listening: HostApi | null = null

function listen(h: HostApi) {
  if (listening === h) return
  listening = h
  h.on('dwgResult', (payload) => {
    const r = payload as DwgResult
    const done = pending.get(r.id)
    if (done) { pending.delete(r.id); done(r) } else early.set(r.id, r)
  })
}

/** Reader name ("LibreDWG 0.14") or null when DWG cannot be opened here. */
export async function dwgReader(): Promise<string | null> {
  const h = await getHost()
  if (!h) return null
  const info = await h.info()
  return info.dwgReader || null
}

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

/** DWG bytes → DXF bytes. Rejects with the reader's message on failure. */
export async function convertDwg(bytes: Uint8Array, name: string): Promise<{ dxf: Uint8Array; ms: number; warnings: number }> {
  const h = await getHost()
  if (!h) throw new Error('no-reader')
  listen(h)
  const id = await h.dwgToDxf(toBase64(bytes), name)
  const r = early.get(id) ?? (await new Promise<DwgResult>((resolve) => pending.set(id, resolve)))
  early.delete(id)
  if (!r.ok || !r.dxf) throw new Error(r.error || 'conversion failed')
  return { dxf: fromBase64(r.dxf), ms: r.ms ?? 0, warnings: r.warnings ?? 0 }
}
