import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createVillaMep, type LevelId, type MepModel } from '../mep/model'
import { undoableActions, type Undoable } from './undoable'

export type MepDiscipline = 'hvac' | 'plumbing' | 'electrical' | 'coordination'
export type MepBottom = 'schedules' | 'clashes' | 'status' | 'ai'
export type MepSchedule = 'duct' | 'pipe' | 'electrical' | 'equipment'
export type MepRight = 'properties' | 'system' | 'ai'
export type MepMode = 'realistic' | 'shaded' | 'wireframe' | 'hidden'
export type MepSel = { kind: 'duct' | 'pipe' | 'circuit' | 'equipment'; id: string } | null

interface MepState extends Undoable<MepModel> {
  discipline: MepDiscipline
  bottom: MepBottom
  schedule: MepSchedule
  right: MepRight
  mode: MepMode
  level: LevelId
  scale: string
  view: string
  sel: MepSel
  browserSel: string
  checked: string[]
  /** Schedules show the current level only (mockup: Level 2) unless "View all". */
  allLevels: boolean
  checkedAt: number | null
  edit: (label: string, fn: (d: MepModel) => MepModel) => string | null
  undo: () => string | null
  redo: () => string | null
  set: (p: Partial<Omit<MepState, 'doc' | 'undoStack' | 'redoStack' | 'edit' | 'undo' | 'redo' | 'set' | 'reset'>>) => void
  reset: () => void
}

export function validateMep(m: MepModel): string | null {
  for (const d of m.ducts) {
    if (!(d.w >= 100 && d.w <= 2500 && d.h >= 100 && d.h <= 1500)) return `${d.mark}: size`
    if (!(d.flow > 0 && d.flow <= 20000)) return `${d.mark}: flow`
    if (!(d.length > 0)) return `${d.mark}: length`
    if (!(d.elevation >= 1800 && d.elevation <= 3600)) return `${d.mark}: elevation`
  }
  for (const c of m.circuits) if (!(c.kw > 0 && c.length > 0)) return `${c.mark}: load`
  return null
}

export const useMep = create<MepState>()(
  persist(
    (set, get) => ({
      doc: createVillaMep(),
      undoStack: [],
      redoStack: [],
      discipline: 'hvac',
      bottom: 'schedules',
      schedule: 'duct',
      right: 'properties',
      mode: 'realistic',
      level: 'L2',
      scale: '1 : 100',
      view: 'coord',
      // mockup 08: duct SA-01 selected in Properties
      sel: { kind: 'duct', id: 'SA-01-L2' },
      browserSel: 'v-coord',
      checked: [],
      allLevels: false,
      checkedAt: null,
      ...undoableActions<MepModel, MepState>(get, set, validateMep),
      set: (p) => set(p),
      reset: () => set({ doc: createVillaMep(), undoStack: [], redoStack: [], sel: { kind: 'duct', id: 'SA-01-L2' } }),
    }),
    { name: 'thcad.mep', version: 1, partialize: (s) => ({ doc: s.doc, schedule: s.schedule, mode: s.mode, scale: s.scale }) },
  ),
)
