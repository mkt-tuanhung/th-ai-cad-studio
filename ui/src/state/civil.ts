import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { toast } from './toast'
import { useSettings } from './settings'
import { getMessages } from '../i18n'
import { createNorthCanal, type CivilModel } from '../civil/model'
import { undoableActions, type Undoable } from './undoable'
import { migrateCivil } from './migrations'

export type CivilView = 'plan' | 'profile' | 'section' | '3d' | 'schedule'
export type CivilBottom = 'earthwork' | 'channel' | 'structures' | 'materials'
export type CivilRight = 'properties' | 'layers' | 'references'
export type CivilAiTab = 'analysis' | 'check' | 'optimize'

interface CivilState extends Undoable<CivilModel> {
  view: CivilView
  bottom: CivilBottom
  right: CivilRight
  aiTab: CivilAiTab
  aiOpen: boolean
  station: number
  browserSel: string
  layers: Record<string, boolean>
  allRows: boolean
  /** Contour interval (m) of the survey plan. */
  contour: number
  /** Plan view: drawing a new alignment. */
  drawing: boolean
  importOpen: boolean
  /** Profile / section tools: place a note, measure between two points. */
  tool: 'annotation' | 'dimension' | null
  /** 3D view: vertical exaggeration. */
  ve: number
  crossingOpen: boolean
  /** Profile chart window (stations), null = whole alignment. */
  profileRange: [number, number] | null
  edit: (label: string, fn: (d: CivilModel) => CivilModel) => string | null
  undo: () => string | null
  redo: () => string | null
  set: (p: Partial<Omit<CivilState, 'doc' | 'undoStack' | 'redoStack' | 'edit' | 'undo' | 'redo' | 'set' | 'reset'>>) => void
  reset: () => void
}

export function validateCivil(m: CivilModel): string | null {
  const p = m.params
  if (!(p.bottomWidth >= 0.5 && p.bottomWidth <= 50)) return 'Bottom Width'
  if (!(p.sideSlope >= 0 && p.sideSlope <= 5)) return 'Side Slope'
  if (!(p.freeboard >= 0.1 && p.freeboard <= 3)) return 'Freeboard'
  if (!(p.manningN >= 0.009 && p.manningN <= 0.05)) return "Manning's n"
  if (!(p.discharge > 0 && p.discharge <= 500)) return 'Design discharge'
  if (!(p.slopeMin > 0 && p.slopeMin < p.slopeMax && p.slopeMax <= 0.05)) return 'Design Slope'
  // a route without a design line has no invert: nothing to grade, no cut / fill (never invented)
  if (!(m.invert.length >= 2) || m.invert.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return 'Design invert'
  for (let i = 1; i < m.invert.length; i++) if (!(m.invert[i][0] > m.invert[i - 1][0])) return 'Profile stations'
  if (!(m.alignment.end - m.alignment.start >= 20)) return 'Alignment length'
  return null
}

/**
 * localStorage with a fallback for large surveys: when the quota is exceeded the raw survey points are
 * left out (alignment, sampled ground and design are kept) and the user is told once.
 */
let warned = false
const civilStorage: StateStorage = {
  getItem: (k) => localStorage.getItem(k),
  removeItem: (k) => localStorage.removeItem(k),
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      const o = JSON.parse(v) as { state?: { doc?: { survey?: unknown } } }
      if (o.state?.doc?.survey) delete o.state.doc.survey
      try {
        localStorage.setItem(k, JSON.stringify(o))
      } catch {
        /* still too large: keep the session in memory only */
      }
      if (!warned) {
        warned = true
        toast(getMessages(useSettings.getState().language).civil.survey.tooLarge, 'warning')
      }
    }
  },
}

export const useCivil = create<CivilState>()(
  persist(
    (set, get) => ({
      doc: createNorthCanal(),
      undoStack: [],
      redoStack: [],
      view: 'plan',
      bottom: 'earthwork',
      right: 'properties',
      aiTab: 'analysis',
      aiOpen: true,
      station: 300,
      browserSel: 'al-canal',
      layers: { alignment: true, channel: true, ground: true, row: true, structures: true, surfaces: true },
      allRows: false,
      contour: 0.25,
      drawing: false,
      importOpen: false,
      tool: null,
      ve: 3,
      crossingOpen: false,
      profileRange: null,
      ...undoableActions<CivilModel, CivilState>(get, set, validateCivil),
      set: (p) => set(p),
      reset: () => set({ doc: createNorthCanal(), undoStack: [], redoStack: [] }),
    }),
    // v2: explicit migration (state/migrations.ts)
    { name: 'thcad.civil', version: 2, migrate: (p, v) => migrateCivil(p, v) as CivilState, storage: createJSONStorage(() => civilStorage), partialize: (s) => ({ doc: s.doc, station: s.station, layers: s.layers, bottom: s.bottom, contour: s.contour }) },
  ),
)
