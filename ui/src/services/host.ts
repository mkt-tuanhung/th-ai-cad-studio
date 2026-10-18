import { useEffect as useHostEffect, useState as useHostState } from 'react'
/**
 * Desktop host bridge (architecture option A). In the Qt app, the native side injects
 * `window.thcadHostReady` (QWebChannel) before any page script runs. In a plain browser there is no
 * host and every caller falls back to the prototype implementation.
 */
/** Licence state from the desktop host (native/app/src/licence_gate.hpp). */
export interface LicenceInfo { enforced: boolean; licensed: boolean; reason: string; machineCode: string; customer: string; serial: number; issued: string; expires: string }

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
  info(): Promise<{ engine: string; platform: string; occt: string | null; aiBackend: string; commands: number; nativeViewport: boolean; dwgReader?: string; blender?: BlenderInfo; licence?: LicenceInfo }>
  localAiStatus(): Promise<NativeAiStatus>
  cadExecute(opsJson: string): Promise<{ ok: boolean; error?: { code: string; detail: string } }>
  proposeOps(title: string, opsJson: string): Promise<{ ok: boolean; message: string }>
  aiRequest(request: string): Promise<void>
  /** Discipline assistants: generic generation (see ui/src/ai/discipline.ts); false = no model ready. */
  aiTask(taskJson: string): Promise<boolean>
  cadLoad(documentJson: string): Promise<{ ok: boolean; entities?: number; error?: string }>
  cadUndo(): Promise<{ ok: boolean; label?: string; document?: { entities: unknown[] } }>
  cadRedo(): Promise<{ ok: boolean; label?: string; document?: { entities: unknown[] } }>
  cadDocument(): Promise<{ entities: unknown[]; currentLayer: string }>
  approveProposal(id: string): Promise<{ ok: boolean; error?: { code: string; detail: string } }>
  rejectProposal(id: string): Promise<boolean>
  bim3dLoad(modelJson: string): Promise<{ ok: boolean }>
  bim3dFrame(w: number, h: number, mode: string, selectedWall: string): Promise<{ ok: boolean; url?: string; ms?: number }>
  bim3dCamera(action: string, a: number, b: number, c: number, d: number): Promise<void>
  scene3dLoad(key: string, json: string): Promise<{ ok: boolean; items?: number; failures?: number; ms?: number; volumes?: Record<string, number>; errors?: string[]; error?: string }>
  scene3dFrame(key: string, w: number, h: number, mode: string, selected: string, highlightedCsv: string): Promise<{ ok: boolean; url?: string; ms?: number }>
  scene3dCamera(key: string, action: string, a: number, b: number, c: number): Promise<void>
  scene3dPick(key: string, x: number, y: number): Promise<string>
  voiceAvailability(locale: string): Promise<{ available: boolean; onDevice: boolean; reason: string; locale: string }>
  voiceStart(locale: string): Promise<void>
  voiceStop(): Promise<void>
  /** Local Whisper (whisper.cpp helper + model in <models>/whisper). */
  whisperStatus(): Promise<{ available: boolean; helper: string; model: string; modelBytes: number; device?: string; reason?: string }>
  voiceTranscribe(id: string, wavBase64: string, lang: string): Promise<void>
  whisperDownload(): Promise<void>
  voiceWarmup(): Promise<void>
  /** Local AI model download (Settings): see services/modelDownload.ts. */
  modelDownloadState(): Promise<import('./modelDownload').ModelDownloadState>
  modelDownload(id: string): Promise<{ ok: boolean; error?: string; dir?: string; bytes?: number; needBytes?: number; freeBytes?: number }>
  modelDownloadCancel(): Promise<void>
  scene3dLoadBim(key: string, modelJson: string, extrasJson: string): Promise<{ ok: boolean; items?: number; failures?: number; ms?: number; error?: string }>
  /** v2.4 incremental BIM scene update (absent in older hosts): see ui/src/bim/live3d.ts. */
  scene3dPatch?(key: string, upsertsJson: string, removeIdsJson: string): Promise<{ ok: boolean; rebuilt?: string[]; removed?: string[]; items?: number; ms?: number; built?: number; error?: string }>
  scene3dCommand(key: string, json: string): Promise<{ ok: boolean; error?: string; url?: string; w?: number; h?: number; bytes?: number; bounds?: number[]; visible?: number; path?: string; sha256?: string; hash?: string; items?: number; volumeM3?: number; nodes?: number; materials?: string[]; boundsMm?: number[]; eye?: number[]; at?: number[]; up?: number[]; fov?: number; lighting?: string; changed?: number }>
  scene3dCommon(key: string, a: string, b: string): Promise<number>
  scene3dOverlaps(key: string): Promise<{ a: string; b: string; m3: number }[]>
  renderStart(jobJson: string): Promise<{ ok: boolean; error?: string; code?: string; w?: number; h?: number; samples?: number; engine?: string; needBytes?: number; budgetBytes?: number }>
  renderCancel(id: string): Promise<void>
  scene3dExportStep(key: string, suggestedName: string): Promise<{ ok: boolean; path?: string; bytes?: number; error?: string; cancelled?: boolean }>
  /** glTF binary of a scene (presentation; mm → m, Y up), save dialog. */
  scene3dExportGlb(key: string, suggestedName: string): Promise<{ ok: boolean; path?: string; bytes?: number; nodes?: number; triangles?: number; materials?: string[]; boundsMm?: number[]; sha256?: string; error?: string; cancelled?: boolean }>
  /** The user's own Blender (external process, never bundled). */
  blenderInfo(refresh: boolean): Promise<BlenderInfo>
  /** 3D asset library (v2.4, library/assets.ts): the manifest on disk and its folder. */
  libraryList(): Promise<{ ok: boolean; dir: string; manifest: unknown; bytes: number; freeBytes: number; running: boolean; busy: boolean; blender: boolean; script: boolean }>
  /** User action only: GET an allow-listed Poly Haven API URL; the text arrives on 'libraryEvent' {type:'fetch', id}. */
  libraryFetch(id: string, url: string): Promise<{ ok: boolean; id?: string; error?: string }>
  libraryDownload(planJson: string): Promise<{ ok: boolean; assets?: number; bytes?: number; error?: string; needBytes?: number; freeBytes?: number }>
  libraryCancel(): Promise<void>
  libraryPut(entryJson: string, thumbDataUrl: string): Promise<{ ok: boolean; id?: string; error?: string }>
  libraryRemove(id: string): Promise<{ ok: boolean; removed?: boolean }>
  libraryThumbs(idsJson: string): Promise<Record<string, string>>
  libraryImport(path: string): Promise<{ ok: boolean; id?: string; dir?: string; error?: string; code?: string; cancelled?: boolean }>
  libraryExport(): Promise<{ ok: boolean; path?: string; items?: number; files?: number; bytes?: number; error?: string; cancelled?: boolean }>
  libraryImportZip(): Promise<{ ok: boolean; items?: number; files?: number; error?: string; cancelled?: boolean }>
  libraryReveal(): Promise<boolean>
  /** Render memory pre-check (4K / 8K guard). */
  renderMemoryCheck(w: number, h: number, engine: string): Promise<{ ok: boolean; needBytes: number; budgetBytes: number; physicalBytes: number; reason?: string }>
  /** A render output / queued 3D frame (Renders folder or render cache only) as a JPEG data URL. */
  renderReadImage(path: string, maxWidth: number): Promise<{ ok: boolean; url?: string; w?: number; h?: number; error?: string }>
  /** Provenance sidecar of a render (Renders folder only). */
  renderReadSidecar(imagePath: string): Promise<{ ok: boolean; path?: string; sidecar?: { presentationOnly?: boolean; scene?: { id: string; revision: string; glbSha256?: string } | null; camera?: { eye: number[]; at: number[]; up: number[]; fov: number; lens: number } | null; engine?: { name: string; device?: string; blender?: string }; image?: { sha256: string; w: number; h: number }; [k: string]: unknown }; error?: string }>
  bimSummary(): Promise<{ walls: { mark: string; area: number; volume: number; netVolume?: number }[]; checks: number[] }>
  setViewportSlot(kind: string, x: number, y: number, w: number, h: number, visible: boolean): Promise<void>
  /** Async; the result arrives on the 'dwgResult' signal with the returned id. */
  dwgToDxf(base64: string, name: string): Promise<string>
  /** DWG with layouts from a DXF 2000 (LibreDWG dxf2dwg). */
  dwgWriteDxf(dxf: string, suggestedName: string): Promise<{ ok: boolean; path?: string; bytes?: number; entities?: number; layers?: number; layouts?: number; warnings?: string; error?: string; cancelled?: boolean }>
  dwgWriteDxfTo(dxf: string, dir: string, name: string): Promise<{ ok: boolean; path?: string; bytes?: number; entities?: number; layouts?: number; error?: string }>
  dwgWrite(script: string, suggestedName: string): Promise<{ ok: boolean; path?: string; bytes?: number; entities?: number; layers?: number; warnings?: string; error?: string; cancelled?: boolean }>
  cadExportPdf(pageJson: string, suggestedName: string): Promise<{ ok: boolean; path?: string; bytes?: number; error?: string; cancelled?: boolean }>
  /** QA only (THCAD_QA=1). */
  qaSampleDwg(): Promise<string>
  qaSampleFile(index: number): Promise<string>
  systemInfo(): Promise<HostSystemInfo>
  setModelsDir(dir: string): Promise<{ ok: boolean; model?: string; loaded?: boolean; error?: string }>
  setAiGpu(on: boolean): Promise<boolean>
  pickFolder(title: string, start: string): Promise<string>
  /** Batch output into a folder picked with pickFolder in this session (never overwrites: “name (2).ext”). */
  writeFileTo(dir: string, name: string, base64: string): Promise<{ ok: boolean; path?: string; bytes?: number; error?: string }>
  cadExportPdfTo(pageJson: string, dir: string, name: string): Promise<{ ok: boolean; path?: string; bytes?: number; pages?: number; error?: string }>
  dwgWriteTo(script: string, dir: string, name: string): Promise<{ ok: boolean; path?: string; bytes?: number; entities?: number; error?: string }>
  revealFolder(path: string): Promise<boolean>
  loadModel(path: string): Promise<boolean>
  on(signal: 'aiResult' | 'aiTaskResult' | 'documentChanged' | 'dwgResult' | 'renderProgress' | 'voiceText' | 'voiceTranscript' | 'whisperProgress' | 'modelProgress' | 'libraryEvent', fn: (payload: unknown) => void): void
}

export interface BlenderInfo {
  found: boolean
  path?: string
  version?: string
  script?: string
  scriptFound?: boolean
  sandbox?: boolean
  source?: string
  reason?: string
}

export interface HostSystemInfo {
  modelsDir: string
  models: { name: string; path: string; bytes: number; active: boolean }[]
  modelBytes: number
  disk: { total: number; free: number }
  home: string
  documents: string
  aiGpu: boolean
  backend: string
  dwgReader: string
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

/** React hook: the desktop host, or null in a plain browser (resolves once). */
export function useHost(): HostApi | null {
  const [host, setHost] = useHostState<HostApi | null>(null)
  useHostEffect(() => {
    let live = true
    getHost().then((h) => live && setHost(h))
    return () => {
      live = false
    }
  }, [])
  return host
}
