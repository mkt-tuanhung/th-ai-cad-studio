import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { CAMERAS, DEFAULT_FX, DEFAULT_PANO, DEFAULT_SETTINGS, DEFAULT_VIDEO, settingsSummary, FORMATS, videoFrames, type Camera, type CustomVariation, type Job, type JobRun, type PanoSettings, type PostFx, type RenderSettings, type Variation, type VideoSettings } from '../renders/model'
import { undoableActions, type Undoable } from './undoable'
import { MATERIAL_OPTIONS } from '../renders/provenance'

export type RenderTab = 'studio' | 'panorama' | 'video' | 'ai' | 'batch'
export type RenderMode = 'wireframe' | 'clay' | 'shaded' | 'rendered'
export type LeftTab = 'scene' | 'cameras' | 'layers'
export type AssetTab = 'materials' | 'models' | 'plants' | 'people'

export interface RenderDoc {
  cameras: Camera[]
  settings: RenderSettings
  fx: PostFx
  queue: Job[]
  /** AI-proposed / custom lighting variations. */
  custom?: CustomVariation[]
  /** Camera bookmarks saved from the BIM / Interior 3D views and Renders (v2.4). */
  bookmarks?: import('../renders/provenance').CameraBookmark[]
}

interface RenderState extends Undoable<RenderDoc> {
  tab: RenderTab
  mode: RenderMode
  left: LeftTab
  assets: AssetTab
  right: 'settings' | 'post'
  bottom: 'queue' | 'history'
  camera: string
  variation: Variation['key']
  projection: 'perspective' | 'orthographic' | 'two-point'
  preview: 'high' | 'medium' | 'draft'
  layers: Record<string, boolean>
  open: Record<string, boolean>
  /** Desktop renderer: live state per job id, finished renders (history) and in-memory previews. */
  runs: Record<string, JobRun>
  history: { jobId: string; camera: string; cameraId?: string; path: string; ms: number; samples: number; finished: number; w: number; h: number; engine?: 'blender' | 'occt'; sidecar?: string; sceneRev?: string; frame?: string }[]
  previews: Record<string, string>
  pano: PanoSettings
  video: VideoSettings
  /** Collapsed left cards. */
  collapsed: Record<string, boolean>
  safeFrame: boolean
  /** Custom variation applied last (highlighted in the strip). */
  customSel: string | null
  /** Queues a 360° panorama or a video of a camera; returns the job id. */
  enqueueSpecial: (kind: 'panorama' | 'video', cameraId: string) => string
  /** Queues the camera once per presentation material option (same model, materials only); returns the count. */
  enqueueMaterialOptions: (cameraId: string, names: Record<string, string>) => number
  setRun: (id: string, patch: Partial<JobRun>) => void
  edit: (label: string, fn: (d: RenderDoc) => RenderDoc) => string | null
  undo: () => string | null
  redo: () => string | null
  set: (p: Partial<Omit<RenderState, 'doc' | 'undoStack' | 'redoStack' | 'edit' | 'undo' | 'redo' | 'set' | 'reset' | 'enqueue' | 'setRun' | 'enqueueSpecial' | 'enqueueMaterialOptions'>>) => void
  enqueue: (cameraIds: string[]) => number
  reset: () => void
}

export function validateRender(d: RenderDoc): string | null {
  const s = d.settings
  if (!(s.samples >= 16 && s.samples <= 16384)) return 'Samples 16–16384'
  if (!(s.bounces >= 1 && s.bounces <= 64)) return 'Max Bounces 1–64'
  if (!(s.dpi >= 72 && s.dpi <= 1200)) return 'DPI 72–1200'
  if (!(s.rotation >= 0 && s.rotation <= 360)) return 'Rotation 0–360°'
  if (!(s.sunDirection >= 0 && s.sunDirection <= 360)) return 'Sun Direction 0–360°'
  if (!(s.sunIntensity >= 0 && s.sunIntensity <= 10)) return 'Sun Intensity 0–10'
  if (d.cameras.some((c) => !c.name.trim())) return 'Camera name'
  return null
}

let seq = 0
// Sample project: three views were queued (as in the mockup). They stay waiting — no renderer is connected.
const SEED_QUEUE: Job[] = CAMERAS.slice(0, 3).map((c, i) => ({ id: `seed-${i}`, cameraId: c.id, cfg: { settings: DEFAULT_SETTINGS, fx: DEFAULT_FX }, camera: `${c.name} - ${c.kind.replace('Exterior - ', '').replace('Interior - ', '')}`.replace('Cam 01 - Front View', 'Cam 01 - Exterior Front View'), settings: settingsSummary(DEFAULT_SETTINGS), output: 'PNG', status: 'waiting', created: 0 }))
const initial = (): RenderDoc => ({ cameras: CAMERAS, settings: DEFAULT_SETTINGS, fx: DEFAULT_FX, queue: SEED_QUEUE })

export const useRenders = create<RenderState>()(
  persist(
    (set, get) => ({
      doc: initial(),
      undoStack: [],
      redoStack: [],
      tab: 'studio',
      mode: 'rendered',
      left: 'cameras',
      assets: 'materials',
      right: 'settings',
      bottom: 'queue',
      camera: 'cam1',
      variation: 'original',
      projection: 'perspective',
      preview: 'high',
      layers: { architecture: true, landscape: true, furniture: true, people: false },
      open: { output: true, rendering: true, environment: true, ai: true },
      runs: {},
      history: [],
      previews: {},
      pano: DEFAULT_PANO,
      video: DEFAULT_VIDEO,
      collapsed: {},
      safeFrame: false,
      customSel: null,
      setRun: (id, patch) => set((s) => ({ runs: { ...s.runs, [id]: { ...(s.runs[id] ?? { status: 'waiting' }), ...patch } } })),
      ...undoableActions<RenderDoc, RenderState>(get, set, validateRender),
      set: (p) => set(p),
      enqueue: (ids) => {
        const d = get().doc
        const fmt = FORMATS.find((f) => f.key === d.settings.format)!
        const jobs: Job[] = ids.map((id) => {
          const c = d.cameras.find((x) => x.id === id)!
          return { id: `job-${Date.now()}-${seq++}`, cameraId: c.id, camera: `${c.name} - ${c.kind}`, settings: settingsSummary(d.settings), output: fmt.ext, status: 'waiting', created: Date.now(), cfg: { settings: d.settings, fx: d.fx } }
        })
        get().edit(`Queue ${jobs.length} render(s)`, (x) => ({ ...x, queue: [...x.queue, ...jobs] }))
        return jobs.length
      },
      enqueueSpecial: (kind, cameraId) => {
        const s = get()
        const d = s.doc
        const c = d.cameras.find((x) => x.id === cameraId)!
        const id = `job-${Date.now()}-${seq++}`
        const [vw, vh] = s.video.resolution.split('x').map(Number)
        const job: Job =
          kind === 'panorama'
            ? { id, cameraId, kind, camera: `${c.name} - 360° panorama`, settings: `${s.pano.face * 2} × ${s.pano.face} · ${s.pano.samples} samples × 6`, output: 'JPG 360°', status: 'waiting', created: Date.now(), cfg: { settings: d.settings, fx: d.fx }, special: { face: s.pano.face, samples: s.pano.samples } }
            : { id, cameraId, kind, camera: `${c.name} - ${s.video.path === 'orbit' ? 'orbit' : 'fly-through'} video`, settings: `${s.video.resolution.replace('x', ' × ')} · ${s.video.seconds} s @ ${s.video.fps} fps · ${s.video.samples} samples`, output: 'MP4', status: 'waiting', created: Date.now(), cfg: { settings: d.settings, fx: d.fx }, special: { fps: s.video.fps, samples: s.video.samples, w: vw, h: vh, frames: videoFrames(d.cameras, c, s.video) } }
        get().edit(`Queue ${job.camera}`, (x) => ({ ...x, queue: [...x.queue, job] }))
        return id
      },
      enqueueMaterialOptions: (cameraId, names) => {
        const d = get().doc
        const c = d.cameras.find((x) => x.id === cameraId)!
        const fmtx = FORMATS.find((f) => f.key === d.settings.format)!
        const jobs: Job[] = MATERIAL_OPTIONS.map((o) => ({ id: `job-${Date.now()}-${seq++}`, cameraId, camera: `${c.name} - ${names[o.key] ?? o.key}`, settings: settingsSummary(d.settings), output: fmtx.ext, status: 'waiting', created: Date.now(), cfg: { settings: d.settings, fx: d.fx }, variant: { key: o.key, name: names[o.key] ?? o.key, overrides: o.overrides } }))
        get().edit(`Queue ${jobs.length} material option(s)`, (x) => ({ ...x, queue: [...x.queue, ...jobs] }))
        return jobs.length
      },
      reset: () => set({ doc: initial(), undoStack: [], redoStack: [], camera: 'cam1', variation: 'original' }),
    }),
    {
      name: 'thcad.renders',
      version: 1,
      partialize: (s) => ({ doc: s.doc, camera: s.camera, variation: s.variation, mode: s.mode, history: s.history, pano: s.pano, video: s.video, runs: Object.fromEntries(Object.entries(s.runs).filter(([, r]) => r.status !== 'rendering')) }),
    },
  ),
)
