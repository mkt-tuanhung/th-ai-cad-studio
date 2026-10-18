/**
 * Desktop render runner: turns queued jobs into native render requests one at a time — the in-app OCCT path
 * tracer (HostBridge::renderStart) or, for stills with "Blender Cycles (local)", the user's own Blender run as
 * a separate process (md_render.py). Progress, previews and results are mirrored into the store.
 *
 * v2.4: each job's scene is captured when it is QUEUED (renders/snapshot.ts): spec + revision, geometry hash,
 * a GLB for Blender and a live 3D frame for the before / after comparison. A job never renders later edits.
 * Without Blender the OCCT path tracer is used and the job says so. In a plain browser nothing here runs.
 */
import type { HostApi } from '../services/host'
import { useRenders } from '../state/renders'
import { DEFAULT_FX, dims, isBlender, viewOf, type Camera, type Job, type PostFx, type RenderSettings } from './model'
import { finalStatus, lightingOf, provenanceOf, type JobSnapshot } from './provenance'
import { captureSnapshot, specFor, specRevision, type SceneSpec } from './snapshot'
import { ensureLibrary } from '../library/assetService'

interface Progress {
  id: string
  samples?: number
  total?: number
  ms?: number
  preview?: string
  done?: boolean
  ok?: boolean
  path?: string
  error?: string
  engine?: 'blender' | 'occt'
  device?: string
  sidecar?: string
}

export interface BlenderStatus {
  found: boolean
  path?: string
  version?: string
  script?: string
  sandbox?: boolean
  reason?: string
}

let attached: HostApi | null = null
let current: string | null = null
/** Queue-time scene specs (memory only; after a restart the job re-checks the revision). */
const specs = new Map<string, SceneSpec>()
const pending = new Map<string, Promise<void>>()
let chain: Promise<void> = Promise.resolve()
let blender: BlenderStatus | null = null

const engineOf = (e: RenderSettings['engine']) => (e === 'Rasterized Preview' ? 'raytrace' : 'path')
const skyOf = (s: RenderSettings) =>
  !s.sunSky && s.sunIntensity === 0 ? 'night' : s.hdri === 'Outdoor - Overcast' ? 'overcast' : s.hdri === 'Studio - Soft Box' ? 'studio' : 'clear'

/** Detected Blender (cached for the session; `refresh` asks the host again). */
export async function blenderStatus(host: HostApi, refresh = false): Promise<BlenderStatus> {
  if (!blender || refresh) blender = (await host.blenderInfo(refresh)) as BlenderStatus
  return blender
}
export const knownBlender = () => blender

const camOf = (job: Job): Camera | undefined => {
  const st = useRenders.getState()
  return st.doc.cameras.find((c) => c.id === job.cameraId) ?? st.doc.cameras.find((c) => job.camera.startsWith(c.name))
}
const settingsOf = (job: Job): RenderSettings => job.cfg?.settings ?? useRenders.getState().doc.settings
const sizeOf = (job: Job) => {
  const d = dims(settingsOf(job).resolution)
  return { w: job.special?.w ?? d.w, h: job.special?.h ?? d.h }
}
const wantsBlender = (job: Job) => isBlender(settingsOf(job)) && (job.kind ?? 'still') === 'still'

/** Captures the scene of a queued job now (serialised; the host builds one scene at a time). */
async function snapshotJob(host: HostApi, id: string) {
  const st = useRenders.getState()
  const job = st.doc.queue.find((j) => j.id === id)
  const cam = job && camOf(job)
  if (!job || !cam || job.snap) return
  // the asset library's manifest (library models / PBR materials for the interior dressing)
  await ensureLibrary(host)
  const v = viewOf(cam)
  const spec = specFor(v, st.layers)
  specs.set(id, spec)
  const { w, h } = sizeOf(job)
  const fw = 640, fh = Math.max(64, Math.round((640 * h) / w))
  const glb = wantsBlender(job) && (await blenderStatus(host)).found
  let snap: JobSnapshot
  try {
    snap = await captureSnapshot(host, spec, { eye: v.eye, at: v.at, up: v.up, fov: v.fov }, { glb, frameW: fw, frameH: fh })
  } catch {
    // the 3D build failed: keep at least the revision; Blender cannot render it (no GLB) and falls back to OCCT
    snap = { sceneId: spec.sceneId, sceneRev: specRevision(spec), camera: { eye: [...v.eye], at: [...v.at], up: [...(v.up ?? [0, 0, 1])], fov: v.fov, lens: 0 }, capturedAt: Date.now() }
  }
  useRenders.setState((s) => ({ doc: { ...s.doc, queue: s.doc.queue.map((j) => (j.id === id ? { ...j, snap } : j)) } }))
}

/** Snapshots every waiting job that has none yet (called whenever the queue changes). */
function scheduleSnapshots(host: HostApi) {
  const st = useRenders.getState()
  for (const j of st.doc.queue) {
    if (j.snap || pending.has(j.id)) continue
    const status = st.runs[j.id]?.status ?? 'waiting'
    if (status !== 'waiting') continue
    const p = chain.then(() => snapshotJob(host, j.id)).catch(() => undefined)
    chain = p
    pending.set(j.id, p)
  }
}

/** The native job for a queued render: its queue-time scene, camera, settings, post-processing, provenance. */
export function buildJob(job: Job, engine: 'blender' | 'occt' = 'occt', note?: string): object | { error: string } | null {
  const st = useRenders.getState()
  const cam = camOf(job)
  if (!cam) return null
  const settings = settingsOf(job)
  const fx: PostFx = job.cfg?.fx ?? st.doc.fx ?? DEFAULT_FX
  const v = viewOf(cam)
  let spec = specs.get(job.id)
  if (!spec) {
    // after a restart the queue-time spec is gone: render only if the model is still at the queued revision
    const cur = specFor(v, st.layers)
    if (job.snap && specRevision(cur) !== job.snap.sceneRev) return { error: 'stale' }
    spec = cur
  }
  const camera = job.snap?.camera ?? { eye: v.eye, at: v.at, up: v.up ?? [0, 0, 1], fov: v.fov }
  const overrides = job.variant?.overrides
  const scene = {
    items: spec.items,
    ...(spec.bimModel ? { bimModel: spec.bimModel, ground: spec.ground } : {}),
    ...(overrides && Object.keys(overrides).length ? { overrides } : {}),
  }
  const { w, h } = sizeOf(job)
  const hybrid = settings.engine === 'Hybrid (Path Traced GI)'
  return {
    id: job.id,
    name: job.camera,
    kind: job.kind ?? 'still',
    engine,
    scene,
    params: {
      w, h,
      face: job.special?.face,
      fps: job.special?.fps,
      frames: job.special?.frames,
      samples: job.special?.samples ?? settings.samples,
      bounces: hybrid ? Math.min(settings.bounces, 3) : settings.bounces,
      engine: engineOf(settings.engine),
      exposure: fx.exposure,
      sun: settings.sunSky && settings.sunIntensity > 0,
      sunIntensity: settings.sunIntensity,
      sunAzimuth: settings.sunDirection,
      sunElevation: settings.sunElevation ?? 40,
      sky: skyOf(settings),
      camera: { eye: camera.eye, at: camera.at, up: camera.up, fov: camera.fov },
    },
    ...(engine === 'blender'
      ? { blender: { glb: job.snap?.glb, lighting: lightingOf(settings), overrides: overrides ?? {}, ground: !!spec.ground, camera: { ...camera, ...(v.shift ? { shift: v.shift } : {}), ...(v.level ? { level: true } : {}) }, ...(spec.dressing ? { dressing: spec.dressing } : {}) } }
      : {}),
    // exposure is applied by the renderer's tone mapping; the rest after rendering
    fx: { contrast: fx.contrast, saturation: fx.saturation, temperature: fx.temperature, vignette: fx.vignette },
    denoise: settings.denoise || settings.ai.denoise,
    format: settings.format,
    dpi: settings.dpi,
    provenance: provenanceOf(job, job.snap, { ...settings, fx }, engine, note),
  }
}

function onProgress(p: Progress) {
  const st = useRenders.getState()
  if (p.preview) useRenders.setState({ previews: { ...st.previews, [p.id]: p.preview } })
  if (!p.done) return st.setRun(p.id, { status: 'rendering', samples: p.samples, total: p.total, ms: p.ms })
  current = null
  // a cancelled or broken render is never marked done (V24-043)
  const status = finalStatus(p, false)
  st.setRun(p.id, { status, samples: p.samples, ms: p.ms, path: p.path, error: status === 'done' ? undefined : p.error, finished: Date.now(), device: p.device, sidecar: p.sidecar, ...(p.engine ? { engine: p.engine } : {}) })
  if (status === 'done' && p.preview) {
    // a variation thumbnail render: its picture becomes the variation's thumbnail
    const job = st.doc.queue.find((j) => j.id === p.id)
    if (job?.thumbFor) useRenders.setState((s) => ({ doc: { ...s.doc, custom: (s.doc.custom ?? []).map((v) => (v.id === job.thumbFor ? { ...v, preview: p.preview } : v)) } }))
  }
  if (status === 'done' && p.path) {
    const job = st.doc.queue.find((j) => j.id === p.id)
    const d0 = dims((job?.cfg?.settings ?? st.doc.settings).resolution)
    const w = job?.kind === 'panorama' ? (job.special?.face ?? 1024) * 2 : job?.special?.w ?? d0.w, h = job?.kind === 'panorama' ? job.special?.face ?? 1024 : job?.special?.h ?? d0.h
    const run = useRenders.getState().runs[p.id]
    useRenders.setState((s) => ({ history: [{ jobId: p.id, camera: job?.camera ?? p.id, cameraId: job?.cameraId, path: p.path!, ms: p.ms ?? 0, samples: p.samples ?? 0, finished: Date.now(), w, h, engine: run?.engine, sidecar: p.sidecar, sceneRev: job?.snap?.sceneRev, frame: job?.snap?.frame }, ...s.history].slice(0, 50) }))
  }
  if (status !== 'cancelled' && attached) void startNext(attached)
}

export function attachRunner(host: HostApi) {
  if (attached) return
  attached = host
  host.on('renderProgress', (p) => onProgress(p as Progress))
  void blenderStatus(host).catch(() => undefined)
  scheduleSnapshots(host)
  useRenders.subscribe((s, prev) => {
    if (s.doc.queue !== prev.doc.queue) scheduleSnapshots(host)
  })
}

export const renderingId = () => current

/** Waits until a job's queue-time snapshot exists (QA and the runner). */
export async function snapshotReady(id: string) {
  await pending.get(id)
  return useRenders.getState().doc.queue.find((j) => j.id === id)?.snap
}

/** Starts one job; resolves to an error message, or null when it started. */
export async function startJob(host: HostApi, id: string): Promise<string | null> {
  attachRunner(host)
  if (current) return 'busy'
  current = id
  await pending.get(id)
  const st = useRenders.getState()
  const job = st.doc.queue.find((j) => j.id === id)
  if (!job) {
    current = null
    return 'unknown job'
  }
  let engine: 'blender' | 'occt' = 'occt'
  let note: string | undefined
  if (isBlender(settingsOf(job))) {
    if ((job.kind ?? 'still') !== 'still') note = 'blender-stills-only'
    else if (!(await blenderStatus(host)).found) note = 'blender-missing'
    else if (!job.snap?.glb) note = 'no-snapshot'
    else engine = 'blender'
  }
  let spec = buildJob(job, engine, note)
  if (spec && 'error' in spec) {
    current = null
    st.setRun(id, { status: 'failed', error: spec.error })
    return spec.error
  }
  if (!spec) {
    current = null
    return 'unknown job'
  }
  const views = job.kind === 'panorama' ? 6 : job.kind === 'video' ? job.special?.frames?.length ?? 1 : 1
  st.setRun(id, { status: 'rendering', samples: 0, total: (job.special?.samples ?? job.cfg?.settings.samples ?? st.doc.settings.samples) * views, ms: 0, error: undefined, engine, note })
  let r = await host.renderStart(JSON.stringify(spec))
  if (!r.ok && engine === 'blender' && r.code === 'blender-not-found') {
    // Blender went away since detection: render with the OCCT path tracer and say so
    blender = { found: false, reason: r.error }
    engine = 'occt'
    note = 'blender-missing'
    spec = buildJob(job, engine, note) as object
    st.setRun(id, { engine, note })
    r = await host.renderStart(JSON.stringify(spec))
  }
  if (!r.ok) {
    current = null
    st.setRun(id, { status: 'failed', error: r.error ?? 'failed' })
    return r.error ?? 'failed'
  }
  return null
}

/** Renders the next waiting job of the queue (if nothing is rendering). */
export async function startNext(host: HostApi): Promise<string | null> {
  if (current) return null
  const st = useRenders.getState()
  const next = st.doc.queue.find((j) => (st.runs[j.id]?.status ?? 'waiting') === 'waiting')
  return next ? startJob(host, next.id) : null
}

export function cancelJob(host: HostApi, id: string) {
  host.renderCancel(id)
}
