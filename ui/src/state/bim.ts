import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createVillaBim, runModelChecks, upgradeModel, type BimModel, type CheckResult, type Comment, type ElementRef, type Wall } from '../bim/model'

export type BimView = 'plan' | '3d' | 'schedule'
export type DisplayMode = 'realistic' | 'shaded' | 'wireframe' | 'hidden'
export type ScheduleCat = 'walls' | 'doors' | 'windows' | 'rooms' | 'levels'
export type BimRightTab = 'properties' | 'ai' | 'comments'
/** Drawing tools of the ribbon (they act in the plan view). */
export type BimTool = 'select' | 'wall' | 'curtainWall' | 'door' | 'window' | 'column' | 'slab' | 'roof' | 'ceiling' | 'stair' | 'room' | 'railing' | 'component' | 'modelText' | 'dimension' | 'tag' | 'grid'

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
  tool: BimTool
  /** Structure shows only the load-bearing elements (plan and 3D). */
  discipline: 'architecture' | 'structure'
  /** Wall type the Wall tool draws with. */
  wallType: string
  /** Project Browser → 3D view request (session only): an elevation (orthographic side view), a section
   *  (clip plane through the building centre), or a named 3D view. `n` makes repeated requests distinct. */
  viewReq: { kind: 'elev' | 'section' | 'home' | 'sectionBox' | 'exterior'; face?: 'front' | 'back' | 'left' | 'right'; axis?: 'x' | 'y'; n: number } | null
  requestView: (r: Omit<NonNullable<BimState['viewReq']>, 'n'>) => void

  /** Validated, undoable model edit. Returns an error message or null. */
  edit: (label: string, fn: (m: BimModel) => BimModel) => string | null
  updateWall: (id: string, patch: Partial<Wall>, label: string) => string | null
  undo: () => string | null
  redo: () => string | null
  runChecks: () => void
  set: (patch: Partial<Pick<BimState, 'view' | 'display' | 'level' | 'scale' | 'scheduleCat' | 'checked' | 'selection' | 'rightTab' | 'browserCollapsed' | 'maximized' | 'appliedRecommendation' | 'browserSel' | 'tool' | 'wallType' | 'discipline'>>) => void
  /** Deletes the selected element (a wall takes its doors and windows with it). Returns its label or null. */
  deleteSelection: () => string | null
  toggleBrowser: (key: string) => void
  addComment: (text: string) => void
  reset: () => void
}

const initial = createVillaBim()

export const useBim = create<BimState>()(
  persist(
    (set, get) => ({
      viewReq: null,
      requestView: (r) => set({ view: '3d', viewReq: { ...r, n: (get().viewReq?.n ?? 0) + 1 } }),
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
      tool: 'select',
      discipline: 'architecture',
      wallType: 'C200',

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
      deleteSelection: () => {
        const sel = get().selection
        if (!sel || sel.category === 'level') return null
        const key = ({ wall: 'walls', door: 'doors', window: 'windows', room: 'rooms', column: 'columns', slab: 'slabs', stair: 'stairs', railing: 'railings', component: 'components', grid: 'grids', annotation: 'annotations' } as const)[sel.category]
        const list = get().model[key] as { id: string; mark?: string; number?: string; label?: string }[]
        const el = list.find((x) => x.id === sel.id)
        if (!el) return null
        const label = `Delete ${el.mark || el.number || el.label || sel.category}`
        const err = get().edit(label, (m) => {
          const next = { ...m, [key]: (m[key] as { id: string }[]).filter((x) => x.id !== sel.id) } as BimModel
          if (sel.category === 'wall') {
            next.doors = m.doors.filter((o) => o.hostWall !== sel.id)
            next.windows = m.windows.filter((o) => o.hostWall !== sel.id)
          }
          next.annotations = next.annotations.filter((a) => a.target !== sel.id)
          return next
        })
        if (err) return null
        set({ selection: null })
        return label
      },
      toggleBrowser: (key) => set({ browserOpen: { ...get().browserOpen, [key]: !(get().browserOpen[key] ?? true) } }),
      addComment: (text) =>
        set({ comments: [...get().comments, { id: Math.random().toString(36).slice(2), elementId: get().selection?.id ?? null, text, at: Date.now() }] }),
      reset: () => set({ model: createVillaBim(), undoStack: [], redoStack: [], checks: runModelChecks(createVillaBim()), appliedRecommendation: false }),
    }),
    {
      name: 'thcad.bim',
      version: 2,
      // v2: walls carry their plan placement; columns, slabs, stairs… lists
      migrate: (persisted) => {
        const p = persisted as Partial<BimState>
        return { ...p, model: upgradeModel(p.model ?? createVillaBim()) } as BimState
      },
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
