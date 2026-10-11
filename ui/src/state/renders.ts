import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { CAMERAS, DEFAULT_FX, DEFAULT_SETTINGS, settingsSummary, FORMATS, type Camera, type Job, type PostFx, type RenderSettings, type Variation } from '../renders/model'
import { undoableActions, type Undoable } from './undoable'

export type RenderTab = 'studio' | 'panorama' | 'video' | 'ai' | 'batch'
export type RenderMode = 'wireframe' | 'clay' | 'shaded' | 'rendered'
export type LeftTab = 'scene' | 'cameras' | 'layers'
export type AssetTab = 'materials' | 'models' | 'plants' | 'people'

export interface RenderDoc {
  cameras: Camera[]
  settings: RenderSettings
  fx: PostFx
  queue: Job[]
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
  edit: (label: string, fn: (d: RenderDoc) => RenderDoc) => string | null
  undo: () => string | null
  redo: () => string | null
  set: (p: Partial<Omit<RenderState, 'doc' | 'undoStack' | 'redoStack' | 'edit' | 'undo' | 'redo' | 'set' | 'reset' | 'enqueue'>>) => void
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
const SEED_QUEUE: Job[] = CAMERAS.slice(0, 3).map((c, i) => ({ id: `seed-${i}`, camera: `${c.name} - ${c.kind.replace('Exterior - ', '').replace('Interior - ', '')}`.replace('Cam 01 - Front View', 'Cam 01 - Exterior Front View'), settings: settingsSummary(DEFAULT_SETTINGS), output: 'PNG', status: 'waiting', created: 0 }))
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
      ...undoableActions<RenderDoc, RenderState>(get, set, validateRender),
      set: (p) => set(p),
      enqueue: (ids) => {
        const d = get().doc
        const fmt = FORMATS.find((f) => f.key === d.settings.format)!
        const jobs: Job[] = ids.map((id) => {
          const c = d.cameras.find((x) => x.id === id)!
          return { id: `job-${Date.now()}-${seq++}`, camera: `${c.name} - ${c.kind}`, settings: settingsSummary(d.settings), output: fmt.ext, status: 'waiting', created: Date.now() }
        })
        get().edit(`Queue ${jobs.length} render(s)`, (x) => ({ ...x, queue: [...x.queue, ...jobs] }))
        return jobs.length
      },
      reset: () => set({ doc: initial(), undoStack: [], redoStack: [], camera: 'cam1', variation: 'original' }),
    }),
    { name: 'thcad.renders', version: 1, partialize: (s) => ({ doc: s.doc, camera: s.camera, variation: s.variation, mode: s.mode }) },
  ),
)
