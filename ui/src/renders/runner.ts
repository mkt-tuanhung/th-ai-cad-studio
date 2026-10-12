/**
 * Desktop render runner: turns queued jobs into native render requests (OCCT path tracing, see
 * HostBridge::renderStart) one at a time, and mirrors progress, previews and results into the store.
 * In a plain browser there is no host and nothing here runs.
 */
import type { HostApi } from '../services/host'
import { useRenders } from '../state/renders'
import { useInterior } from '../state/interior'
import { interiorScene } from '../interior/scene'
import { DEFAULT_FX, dims, viewOf, type Job, type PostFx, type RenderSettings } from './model'

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
}

let attached: HostApi | null = null
let current: string | null = null

const engineOf = (e: RenderSettings['engine']) => (e === 'Rasterized Preview' ? 'raytrace' : 'path')
const skyOf = (s: RenderSettings) =>
  !s.sunSky && s.sunIntensity === 0 ? 'night' : s.hdri === 'Outdoor - Overcast' ? 'overcast' : s.hdri === 'Studio - Soft Box' ? 'studio' : 'clear'

/** The native job for a queued render: scene of its camera, camera, settings, post-processing. */
export function buildJob(job: Job): object | null {
  const st = useRenders.getState()
  const cam = st.doc.cameras.find((c) => c.id === job.cameraId) ?? st.doc.cameras.find((c) => job.camera.startsWith(c.name))
  if (!cam) return null
  const settings = job.cfg?.settings ?? st.doc.settings
  const fx: PostFx = job.cfg?.fx ?? st.doc.fx ?? DEFAULT_FX
  const v = viewOf(cam)
  const layers = st.layers
  const scene =
    v.scene === 'exterior'
      ? { items: [], bim: layers.architecture !== false, ground: layers.landscape !== false }
      : interiorScene(useInterior.getState().doc, { fullWalls: true, furniture: layers.furniture !== false })
  const base = dims(settings.resolution)
  const w = job.special?.w ?? base.w, h = job.special?.h ?? base.h
  const hybrid = settings.engine === 'Hybrid (Path Traced GI)'
  return {
    id: job.id,
    name: job.camera,
    kind: job.kind ?? 'still',
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
      camera: { eye: v.eye, at: v.at, fov: v.fov },
    },
    // exposure is applied by the renderer's tone mapping; the rest after rendering
    fx: { contrast: fx.contrast, saturation: fx.saturation, temperature: fx.temperature, vignette: fx.vignette },
    denoise: settings.denoise || settings.ai.denoise,
    format: settings.format,
    dpi: settings.dpi,
  }
}

function onProgress(p: Progress) {
  const st = useRenders.getState()
  if (p.preview) useRenders.setState({ previews: { ...st.previews, [p.id]: p.preview } })
  if (!p.done) return st.setRun(p.id, { status: 'rendering', samples: p.samples, total: p.total, ms: p.ms })
  current = null
  const status = p.ok ? 'done' : p.error === 'cancelled' ? 'cancelled' : 'failed'
  st.setRun(p.id, { status, samples: p.samples, ms: p.ms, path: p.path, error: p.ok ? undefined : p.error, finished: Date.now() })
  if (p.ok && p.preview) {
    // a variation thumbnail render: its picture becomes the variation's thumbnail
    const job = st.doc.queue.find((j) => j.id === p.id)
    if (job?.thumbFor) useRenders.setState((s) => ({ doc: { ...s.doc, custom: (s.doc.custom ?? []).map((v) => (v.id === job.thumbFor ? { ...v, preview: p.preview } : v)) } }))
  }
  if (p.ok && p.path) {
    const job = st.doc.queue.find((j) => j.id === p.id)
    const d0 = dims((job?.cfg?.settings ?? st.doc.settings).resolution)
    const w = job?.kind === 'panorama' ? (job.special?.face ?? 1024) * 2 : job?.special?.w ?? d0.w, h = job?.kind === 'panorama' ? job.special?.face ?? 1024 : job?.special?.h ?? d0.h
    useRenders.setState((s) => ({ history: [{ jobId: p.id, camera: job?.camera ?? p.id, cameraId: job?.cameraId, path: p.path!, ms: p.ms ?? 0, samples: p.samples ?? 0, finished: Date.now(), w, h }, ...s.history].slice(0, 50) }))
  }
  if (status !== 'cancelled' && attached) void startNext(attached)
}

export function attachRunner(host: HostApi) {
  if (attached) return
  attached = host
  host.on('renderProgress', (p) => onProgress(p as Progress))
}

export const renderingId = () => current

/** Starts one job; resolves to an error message, or null when it started. */
export async function startJob(host: HostApi, id: string): Promise<string | null> {
  attachRunner(host)
  if (current) return 'busy'
  const st = useRenders.getState()
  const job = st.doc.queue.find((j) => j.id === id)
  const spec = job && buildJob(job)
  if (!job || !spec) return 'unknown job'
  current = id
  const views = job.kind === 'panorama' ? 6 : job.kind === 'video' ? job.special?.frames?.length ?? 1 : 1
  st.setRun(id, { status: 'rendering', samples: 0, total: (job.special?.samples ?? job.cfg?.settings.samples ?? st.doc.settings.samples) * views, ms: 0, error: undefined })
  const r = await host.renderStart(JSON.stringify(spec))
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
