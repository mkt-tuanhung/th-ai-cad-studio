import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createNorthCanal, type CivilModel } from '../civil/model'
import { undoableActions, type Undoable } from './undoable'

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
  for (let i = 1; i < m.invert.length; i++) if (!(m.invert[i][0] > m.invert[i - 1][0])) return 'Profile stations'
  return null
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
      ...undoableActions<CivilModel, CivilState>(get, set, validateCivil),
      set: (p) => set(p),
      reset: () => set({ doc: createNorthCanal(), undoStack: [], redoStack: [] }),
    }),
    { name: 'thcad.civil', version: 1, partialize: (s) => ({ doc: s.doc, station: s.station, layers: s.layers, bottom: s.bottom }) },
  ),
)
