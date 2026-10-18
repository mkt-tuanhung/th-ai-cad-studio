import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createPump, type MechModel } from '../mech/model'
import { undoableActions, type Undoable } from './undoable'
import { migrateMech } from './migrations'
import { DEFAULT_SHAFT, type ShaftInputs } from '../mech/fea'
import type { FeatureKind } from '../mech/part'

export type MechMode = 'shaded' | 'wireframe' | 'hidden' | 'realistic'
export type MechBottom = 'parameters' | 'bom' | 'mates' | 'checks'
export type MechRight = 'properties' | 'configurations' | 'display'

interface MechState extends Undoable<MechModel> {
  tab: 'part' | 'assembly' | 'drawing'
  bottom: MechBottom
  right: MechRight
  mode: MechMode
  sel: string
  browserSel: string
  checkedAt: number | null
  bomAll: boolean
  exploded: boolean
  checked: string[]
  /** Desktop app: exact volumes (m³) from the OCCT scene and impeller∩casing overlap (m³). */
  nativeVolumes: Record<string, number> | null
  nativeOverlap: number | null
  /** Shaft FEA load / support inputs (persisted). */
  fea: ShaftInputs
  feaOpen: boolean
  /** Part Studio: open part, selected tree node, native build results, dialogs. */
  activePart: string | null
  partSel: string | null
  partErrors: string[]
  partVolume: number | null
  partBounds: number[] | null
  partDialog: { kind: 'sketch' | FeatureKind; id?: string } | null
  camOpen: boolean
  /** Browser → camera request on the assembly view (a plane's normal view, or home for the origin). */
  camReq: { view: 'top' | 'front' | 'right' | 'home'; label: string; n: number } | null
  edit: (label: string, fn: (d: MechModel) => MechModel) => string | null
  undo: () => string | null
  redo: () => string | null
  set: (p: Partial<Omit<MechState, 'doc' | 'undoStack' | 'redoStack' | 'edit' | 'undo' | 'redo' | 'set' | 'reset'>>) => void
  reset: () => void
}

export function validateMech(m: MechModel): string | null {
  for (const p of m.params) if (!(Number.isFinite(p.value) && p.value >= p.min && p.value <= p.max)) return `${p.name}: ${p.min}–${p.max} ${p.unit}`
  for (const c of m.components) if (!(c.opacity >= 0 && c.opacity <= 100)) return `${c.file}: opacity`
  for (const b of m.bom) if (!(Number.isInteger(b.qty) && b.qty >= 1)) return `${b.name}: qty`
  return null
}

export const useMech = create<MechState>()(
  persist(
    (set, get) => ({
      doc: createPump(),
      undoStack: [],
      redoStack: [],
      tab: 'assembly',
      bottom: 'parameters',
      right: 'properties',
      mode: 'shaded',
      sel: 'casing',
      camReq: null,
      browserSel: 'c-casing',
      checkedAt: null,
      bomAll: false,
      exploded: false,
      checked: [],
      nativeVolumes: null,
      nativeOverlap: null,
      fea: DEFAULT_SHAFT,
      feaOpen: false,
      activePart: null,
      partSel: null,
      partErrors: [],
      partVolume: null,
      partBounds: null,
      partDialog: null,
      camOpen: false,
      ...undoableActions<MechModel, MechState>(get, set, validateMech),
      set: (p) => set(p),
      reset: () => set({ doc: createPump(), undoStack: [], redoStack: [], sel: 'casing' }),
    }),
    // v2: explicit migration (state/migrations.ts)
    { name: 'thcad.mech', version: 2, migrate: (p, v) => migrateMech(p, v) as MechState, partialize: (s) => ({ doc: s.doc, mode: s.mode, bottom: s.bottom, fea: s.fea, tab: s.tab, activePart: s.activePart }) },
  ),
)
