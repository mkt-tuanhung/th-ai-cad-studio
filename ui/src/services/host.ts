/**
 * Desktop host bridge (architecture option A). In the Qt app, the native side injects
 * `window.thcadHostReady` (QWebChannel) before any page script runs. In a plain browser there is no
 * host and every caller falls back to the prototype implementation.
 */
export interface NativeAiStatus {
  source: 'native'
  backend: string
  online: boolean
  ready: boolean
  modelName: string | null
  modelPath: string
  vramUsedGb: number
  vramTotalGb: number
  responseSeconds: number | null
  tokensPerSecond: number | null
  error: string
}

export interface HostApi {
  nativeViewport: boolean
  info(): Promise<{ engine: string; platform: string; occt: string | null; aiBackend: string; commands: number; nativeViewport: boolean; dwgReader?: string }>
  localAiStatus(): Promise<NativeAiStatus>
  cadExecute(opsJson: string): Promise<{ ok: boolean; error?: { code: string; detail: string } }>
  proposeOps(title: string, opsJson: string): Promise<{ ok: boolean; message: string }>
  aiRequest(request: string): Promise<void>
  cadLoad(documentJson: string): Promise<{ ok: boolean; entities?: number; error?: string }>
  cadUndo(): Promise<{ ok: boolean; label?: string; document?: { entities: unknown[] } }>
  cadRedo(): Promise<{ ok: boolean; label?: string; document?: { entities: unknown[] } }>
  cadDocument(): Promise<{ entities: unknown[]; currentLayer: string }>
  approveProposal(id: string): Promise<{ ok: boolean; error?: { code: string; detail: string } }>
  rejectProposal(id: string): Promise<boolean>
  bim3dLoad(modelJson: string): Promise<{ ok: boolean }>
  bim3dFrame(w: number, h: number, mode: string, selectedWall: string): Promise<{ ok: boolean; url?: string; ms?: number }>
  bim3dCamera(action: string, a: number, b: number, c: number, d: number): Promise<void>
  bimSummary(): Promise<{ walls: { mark: string; area: number; volume: number; netVolume?: number }[]; checks: number[] }>
  setViewportSlot(kind: string, x: number, y: number, w: number, h: number, visible: boolean): Promise<void>
  /** Async; the result arrives on the 'dwgResult' signal with the returned id. */
  dwgToDxf(base64: string, name: string): Promise<string>
  /** QA only (THCAD_QA=1). */
  qaSampleDwg(): Promise<string>
  on(signal: 'aiResult' | 'documentChanged' | 'dwgResult', fn: (payload: unknown) => void): void
}

declare global {
  interface Window {
    thcadHostReady?: Promise<HostApi>
    thcadHost?: HostApi
  }
}

export interface NativeProposal {
  id: string
  title: string
  source: string
  status: 'pending' | 'approved' | 'rejected' | 'invalid'
  added: number
  erased: number
  modified: number
  ops: import('./nativeCad').NativeOp[]
  error?: string
}

export interface AiResult {
  ok: boolean
  message: string
  raw?: string
  seconds?: number
  retried?: boolean
  tokensPerSecond?: number
  proposal?: NativeProposal
}

export function getHost(): Promise<HostApi | null> {
  return window.thcadHostReady ?? Promise.resolve(null)
}

export const isDesktopHost = () => typeof window.thcadHostReady !== 'undefined'
