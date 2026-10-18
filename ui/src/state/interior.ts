import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { CABINETS, ITEMS, MATERIALS, ROOMS, roomOverlap, type Cabinet, type Item, type Room } from '../interior/model'
import { undoableActions, type Undoable } from './undoable'
import { DEFAULT_CAM, type CamSettings } from '../cam/gcode'
import { migrateInterior } from './migrations'

export interface InteriorDoc {
  rooms: Room[]
  items: Item[]
  cabinets: Cabinet[]
  /** Plan dimensions (a → b, mm) and tags (target = item or room id). */
  notes?: { id: string; kind: 'dimension' | 'tag'; a: [number, number]; b?: [number, number]; target?: string }[]
  /** Space Planning clearance table of this project (guidance values, mm); missing keys use the defaults. */
  clearance?: Partial<Record<'cabinetFront' | 'bedSide' | 'circulation' | 'doorApproach' | 'hostTolerance', number>>
}

/** Space Planning sub-panels (bottom card) and view modes (viewer). */
export type SpaceTab = 'library' | 'checks' | 'layouts' | 'elevation' | 'schedule'
export type SpaceView = 'plan' | 'live' | 'walk' | 'render' | 'production'
/** A layout option or any proposed change shown in the plan / 3D without being applied. */
export interface SpacePreview {
  label: string
  doc: InteriorDoc
}

/** Reference photos → style (v2.4, AI panel): the photos, the reading and its result for one room (not persisted —
 *  photos stay in memory only). */
export interface StyleSession {
  room: string
  images: import('../services/vision').RefImage[]
  status: 'reading' | 'done' | 'error'
  /** Basic (no model) or model reading under way. */
  withModel?: boolean
  analysis?: import('../interior/styleRef').StyleAnalysis
  raw?: string
  modelError?: string
  device?: string
  error?: string
  started: number
}
export type StyleStep = 'analysis' | 'options' | 'render'

/** Plan views of the interior: furniture layout (floor), reflected ceiling, finishes. */
export type InteriorPlan = 'floor' | 'ceiling' | 'finish'

export type InteriorTab = 'design' | 'renders' | 'drawings' | 'schedule'
export type InteriorBottom = 'furniture' | 'materials' | 'cutlist' | 'quantities' | 'space'
export type InteriorRight = 'properties' | 'materials' | 'ai'
export type InteriorMode = 'realistic' | 'shaded' | 'wireframe' | 'hidden'
export interface CamPrefs {
  /** Stock size per board material (mm, length along the grain × width). */
  stock: Record<string, { l: number; w: number }>
  trim: number
  /** Web between neighbouring cutter paths (mm); the part gap is cutter Ø + web. */
  web: number
  grain: boolean
  cnc: CamSettings
  /**
   * Machine profile chosen for this project's manufacturing job (state/machines.ts). undefined = saved before
   * machine profiles existed → LEGACY_UNASSIGNED (kept open and editable; nesting / CAM wait for a choice and
   * production NC stays blocked). null = not chosen yet.
   */
  machineProfileId?: string | null
}

export const DEFAULT_CAM_PREFS: CamPrefs = { stock: {}, trim: 10, web: 4, grain: true, cnc: DEFAULT_CAM, machineProfileId: null }

export type Selection = { kind: 'item' | 'room' | 'cabinet'; id: string } | null

interface InteriorState extends Undoable<InteriorDoc> {
  tab: InteriorTab
  bottom: InteriorBottom
  right: InteriorRight
  mode: InteriorMode
  level: string
  scale: string
  view: string
  plan: InteriorPlan | null
  /** Plan tools. */
  itool: 'dimension' | 'tag' | null
  /** Elevation / section shown in 3D (browser key, e.g. elev-living, sec-a). */
  cut: string | null
  sel: Selection
  /** Project Browser highlight (mockup: Living Room). */
  browserSel: string
  /** Room shown in Room Information / AI Room Context. */
  room: string
  styles: string[]
  prompt: string | null
  checked: string[]
  filter: string | null
  appliedPreset: string | null
  /** Desktop app: exact volumes (m³) of the OCCT scene items (cabinets are checked against the cut list). */
  nativeVolumes: Record<string, number> | null
  /** Nesting & CNC settings (persisted with the workspace, not part of the design undo history). */
  cam: CamPrefs
  nestingOpen: boolean
  /* ---- Space Planning (not persisted) ---- */
  spTab: SpaceTab
  /** Selected instance of the selected item (items with qty > 1). */
  inst: number
  /** Option / proposal being previewed (plan + 3D show it; nothing is applied). */
  preview: SpacePreview | null
  /* ---- reference photo → style (not persisted) ---- */
  styleRef: StyleSession | null
  /** The style dialog, open at this step. */
  styleDlg: StyleStep | null

  edit: (label: string, fn: (d: InteriorDoc) => InteriorDoc) => string | null
  undo: () => string | null
  redo: () => string | null
  set: (p: Partial<Omit<InteriorState, 'doc' | 'undoStack' | 'redoStack' | 'edit' | 'undo' | 'redo' | 'set' | 'reset'>>) => void
  reset: () => void
}

const initialDoc = (): InteriorDoc => ({ rooms: ROOMS, items: ITEMS, cabinets: CABINETS })

/** Model rules: positive sizes, quantities ≥ 1, known rooms and materials, cabinets buildable. */
export function validateInterior(d: InteriorDoc): string | null {
  const mats = new Set(MATERIALS.map((m) => m.name))
  const rooms = new Set(d.rooms.map((r) => r.id))
  for (const i of d.items) {
    if (!rooms.has(i.room)) return `${i.name}: room`
    if (!mats.has(i.material)) return `${i.name}: material`
    if (!(i.qty >= 1 && Number.isInteger(i.qty))) return `${i.name}: quantity`
    if (i.dia !== undefined ? !(i.dia > 0) : !((i.w ?? 0) > 0 && (i.d ?? 0) > 0)) return `${i.name}: size`
    if (!(i.h > 0)) return `${i.name}: height`
    // Space Planning: per-part finishes, elevation within the room height
    for (const [part, f] of Object.entries(i.parts ?? {})) if (!mats.has(f.material)) return `${i.name}: ${part} material`
    if (i.elev !== undefined && !(i.elev >= 0)) return `${i.name}: elevation`
    const rm = d.rooms.find((r) => r.id === i.room)
    if (rm && i.category !== 'lighting' && (i.elev ?? 0) + i.h > rm.ceilingHeight) return `${i.name}: above the ceiling`
  }
  for (const c of d.cabinets) {
    if (!(c.w >= 300 && c.w <= 6000 && c.d >= 250 && c.d <= 900 && c.h >= 300 && c.h <= 2800)) return `${c.name}: size`
    if (!(c.t >= 12 && c.t <= 25)) return `${c.name}: board`
    if (!(c.doors >= 0 && c.doors <= 12 && c.shelves >= 0 && c.shelves <= 10)) return `${c.name}: doors/shelves`
    if (c.doors && c.w / c.doors < 250) return `${c.name}: doors`
  }
  for (const r of d.rooms) if (!(r.ceilingHeight >= 2200 && r.ceilingHeight <= 6000)) return `${r.name}: ceiling height`
  for (const r of d.rooms)
    for (const dr of r.doors ?? []) {
      const p = r.outline[dr.wall], q = r.outline[(dr.wall + 1) % r.outline.length]
      if (!p || !q) return `${r.name}: door wall`
      const len = Math.hypot(q.x - p.x, q.y - p.y)
      if (!(dr.at >= 0) || (dr.width !== undefined && !(dr.width >= 500 && dr.at + dr.width <= len))) return `${r.name}: door`
    }
  for (let i = 0; i < d.rooms.length; i++)
    for (let j = i + 1; j < d.rooms.length; j++) if (roomOverlap(d.rooms[i].outline, d.rooms[j].outline) > 0) return `${d.rooms[i].name} / ${d.rooms[j].name}: overlap`
  return null
}

export const useInterior = create<InteriorState>()(
  persist(
    (set, get) => ({
      doc: initialDoc(),
      undoStack: [],
      redoStack: [],
      tab: 'design',
      bottom: 'furniture',
      right: 'ai',
      mode: 'realistic',
      level: 'L1',
      scale: '1 : 50',
      view: 'perspective',
      plan: null,
      itool: null,
      cut: null,
      sel: null,
      browserSel: 'room-living',
      room: 'living',
      styles: [],
      /** null = the localized default brief from the mockup */
      prompt: null,
      checked: [],
      filter: null,
      appliedPreset: null,
      nativeVolumes: null,
      cam: DEFAULT_CAM_PREFS,
      nestingOpen: false,
      spTab: 'library',
      inst: 0,
      preview: null,
      styleRef: null,
      styleDlg: null,
      ...undoableActions<InteriorDoc, InteriorState>(get, set, validateInterior),
      set: (p) => set(p),
      reset: () => set({ doc: initialDoc(), undoStack: [], redoStack: [], sel: null, appliedPreset: null, preview: null, inst: 0 }),
    }),
    {
      name: 'thcad.interior',
      version: 2,
      // v2: corrected sample outlines (Bedroom 1 / Laundry overlapped their neighbours) — the user's rooms are kept
      // (state/migrations.ts; the first version of this migration replaced them with the sample rooms)
      migrate: (s, v) => migrateInterior(s, v) as InteriorState,
      partialize: (s) => ({ doc: s.doc, bottom: s.bottom, right: s.right, mode: s.mode, scale: s.scale, room: s.room, styles: s.styles, appliedPreset: s.appliedPreset, cam: s.cam }),
    },
  ),
)
