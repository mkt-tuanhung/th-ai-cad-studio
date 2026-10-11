import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { CABINETS, ITEMS, MATERIALS, ROOMS, type Cabinet, type Item, type Room } from '../interior/model'
import { undoableActions, type Undoable } from './undoable'

export interface InteriorDoc {
  rooms: Room[]
  items: Item[]
  cabinets: Cabinet[]
}

export type InteriorTab = 'design' | 'renders' | 'drawings' | 'schedule'
export type InteriorBottom = 'furniture' | 'materials' | 'cutlist' | 'quantities'
export type InteriorRight = 'properties' | 'materials' | 'ai'
export type InteriorMode = 'realistic' | 'shaded' | 'wireframe' | 'hidden'
export type Selection = { kind: 'item' | 'room' | 'cabinet'; id: string } | null

interface InteriorState extends Undoable<InteriorDoc> {
  tab: InteriorTab
  bottom: InteriorBottom
  right: InteriorRight
  mode: InteriorMode
  level: string
  scale: string
  view: string
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
  }
  for (const c of d.cabinets) {
    if (!(c.w >= 300 && c.w <= 6000 && c.d >= 250 && c.d <= 900 && c.h >= 300 && c.h <= 2800)) return `${c.name}: size`
    if (!(c.t >= 12 && c.t <= 25)) return `${c.name}: board`
    if (!(c.doors >= 0 && c.doors <= 12 && c.shelves >= 0 && c.shelves <= 10)) return `${c.name}: doors/shelves`
    if (c.doors && c.w / c.doors < 250) return `${c.name}: doors`
  }
  for (const r of d.rooms) if (!(r.ceilingHeight >= 2200 && r.ceilingHeight <= 6000)) return `${r.name}: ceiling height`
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
      sel: null,
      browserSel: 'room-living',
      room: 'living',
      styles: [],
      /** null = the localized default brief from the mockup */
      prompt: null,
      checked: [],
      filter: null,
      appliedPreset: null,
      ...undoableActions<InteriorDoc, InteriorState>(get, set, validateInterior),
      set: (p) => set(p),
      reset: () => set({ doc: initialDoc(), undoStack: [], redoStack: [], sel: null, appliedPreset: null }),
    }),
    {
      name: 'thcad.interior',
      version: 1,
      partialize: (s) => ({ doc: s.doc, bottom: s.bottom, right: s.right, mode: s.mode, scale: s.scale, room: s.room, styles: s.styles, appliedPreset: s.appliedPreset }),
    },
  ),
)
