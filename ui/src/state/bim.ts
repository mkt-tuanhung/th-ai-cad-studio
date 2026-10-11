import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createVillaBim, runModelChecks, type BimModel, type CheckResult, type Comment, type ElementRef, type Wall } from '../bim/model'

export type BimView = 'plan' | '3d' | 'schedule'
export type DisplayMode = 'realistic' | 'shaded' | 'wireframe' | 'hidden'
export type ScheduleCat = 'walls' | 'doors' | 'windows' | 'rooms' | 'levels'
export type BimRightTab = 'properties' | 'ai' | 'comments'

interface BimState {
  model: BimModel
  undoStack: { label: string; model: BimModel }[]
  redoStack: { label: string; model: BimModel }[]
  view: BimView
  display: DisplayMode
  level: string
  scale: string
  scheduleCat: ScheduleCat
  checked: string[]
  selection: ElementRef | null
  rightTab: BimRightTab
  browserCollapsed: boolean
  browserOpen: Record<string, boolean>
  /** Highlighted Project Browser item (mockup: Level 1). */
  browserSel: string
  maximized: boolean
  comments: Comment[]
  checks: CheckResult[]
  checkedAt: number | null
  appliedRecommendation: boolean

  /** Validated, undoable model edit. Returns an error message or null. */
  edit: (label: string, fn: (m: BimModel) => BimModel) => string | null
  updateWall: (id: string, patch: Partial<Wall>, label: string) => string | null
  undo: () => string | null
  redo: () => string | null
  runChecks: () => void
  set: (patch: Partial<Pick<BimState, 'view' | 'display' | 'level' | 'scale' | 'scheduleCat' | 'checked' | 'selection' | 'rightTab' | 'browserCollapsed' | 'maximized' | 'appliedRecommendation' | 'browserSel'>>) => void
  toggleBrowser: (key: string) => void
  addComment: (text: string) => void
  reset: () => void
}

const initial = createVillaBim()

export const useBim = create<BimState>()(
  persist(
    (set, get) => ({
      model: initial,
      undoStack: [],
      redoStack: [],
      view: '3d',
      display: 'realistic',
      level: 'L1',
      scale: '1 : 100',
      scheduleCat: 'walls',
      checked: [],
      // Mockup 04 shows wall W1 selected in Properties.
      selection: { category: 'wall', id: 'W1' },
      rightTab: 'properties',
      browserCollapsed: false,
      browserOpen: {},
      browserSel: 'plan-L1',
      maximized: false,
      comments: [],
      checks: runModelChecks(initial),
      checkedAt: null,
      appliedRecommendation: false,

      edit: (label, fn) => {
        const before = get().model
        const after = fn(before)
        // validation: a wall's top must stay above its base
        const bad = after.walls.find((w) => {
          const base = (after.levels.find((l) => l.id === w.baseLevel)?.elevation ?? 0) + w.baseOffset
          const top = (after.levels.find((l) => l.id === w.topLevel)?.elevation ?? 0) + w.topOffset
          return top - base <= 0 || w.length <= 0
        })
        if (bad) return bad.mark
        set({ model: after, undoStack: [...get().undoStack.slice(-99), { label, model: before }], redoStack: [] })
        return null
      },
      updateWall: (id, patch, label) => get().edit(label, (m) => ({ ...m, walls: m.walls.map((w) => (w.id === id ? { ...w, ...patch } : w)) })),
      undo: () => {
        const last = get().undoStack.at(-1)
        if (!last) return null
        set({ model: last.model, undoStack: get().undoStack.slice(0, -1), redoStack: [...get().redoStack, { label: last.label, model: get().model }] })
        return last.label
      },
      redo: () => {
        const next = get().redoStack.at(-1)
        if (!next) return null
        set({ model: next.model, redoStack: get().redoStack.slice(0, -1), undoStack: [...get().undoStack, { label: next.label, model: get().model }] })
        return next.label
      },
      runChecks: () => set({ checks: runModelChecks(get().model), checkedAt: Date.now() }),
      set: (patch) => set(patch),
      toggleBrowser: (key) => set({ browserOpen: { ...get().browserOpen, [key]: !(get().browserOpen[key] ?? true) } }),
      addComment: (text) =>
        set({ comments: [...get().comments, { id: Math.random().toString(36).slice(2), elementId: get().selection?.id ?? null, text, at: Date.now() }] }),
      reset: () => set({ model: createVillaBim(), undoStack: [], redoStack: [], checks: runModelChecks(createVillaBim()), appliedRecommendation: false }),
    }),
    {
      name: 'thcad.bim',
      version: 1,
      partialize: (s) => ({
        model: s.model,
        view: s.view,
        display: s.display,
        level: s.level,
        scale: s.scale,
        scheduleCat: s.scheduleCat,
        rightTab: s.rightTab,
        browserCollapsed: s.browserCollapsed,
        browserOpen: s.browserOpen,
        browserSel: s.browserSel,
        comments: s.comments,
        checks: s.checks,
        checkedAt: s.checkedAt,
        appliedRecommendation: s.appliedRecommendation,
      }),
    },
  ),
)
