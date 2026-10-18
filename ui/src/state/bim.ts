import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createVillaBim, runModelChecks, upgradeModel, type BimModel, type CheckResult, type Comment, type ElementRef, type Provenance, type Wall } from '../bim/model'
import { stampEdit } from '../bim/identity'
import { deriveModel, editRule } from '../bim/derive'
import type { SmartRoomSpec } from '../bim/smartRoom'
import type { CameraBookmark } from '../model/bookmark'
import { ruleText } from '../i18n/ws/linked'

export type BimView = 'plan' | '3d' | 'schedule' | 'drawing'
export type DisplayMode = 'realistic' | 'shaded' | 'wireframe' | 'hidden'
export type ScheduleCat = 'walls' | 'doors' | 'windows' | 'rooms' | 'levels'
export type BimRightTab = 'properties' | 'ai' | 'comments'
/** Drawing tools of the ribbon (they act in the plan view). */
export type BimTool = 'select' | 'wall' | 'curtainWall' | 'door' | 'window' | 'column' | 'slab' | 'roof' | 'ceiling' | 'stair' | 'room' | 'railing' | 'component' | 'modelText' | 'dimension' | 'tag' | 'grid' | 'smartRoom'
/** 3D view mode of the BIM viewer (view-only: none of them changes the model). */
export type View3dMode = 'section' | 'exterior' | 'lowWalls' | 'xray' | 'walk'

/** View-only state of the live 3D view (v2.4): wall opacity of the see-through mode, the cut height of low walls,
 *  doors drawn open or closed, walkthrough collision. Never written to the model. */
export interface Live3dView {
  mode: View3dMode
  /** see-through walls: opacity of the walls facing the camera (0.1…1) */
  wallOpacity: number
  /** low walls: walls cut this high above their level (mm) */
  lowWalls: number
  doorsOpen: boolean
  collide: boolean
}

/** Message of an edit that a model rule rejected (shown as it is, not as a mark). */
export const RULE = 'rule:'
export const ruleMessage = (err: string) => (err.startsWith(RULE) ? err.slice(RULE.length) : null)

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
  /** Coordination settings: checks turned off, and re-checking after every edit. */
  coordOff: CheckResult['key'][]
  coordAuto: boolean
  setCoord: (patch: { coordOff?: CheckResult['key'][]; coordAuto?: boolean }) => void
  checkedAt: number | null
  appliedRecommendation: boolean
  tool: BimTool
  /** Structure shows only the load-bearing elements (plan and 3D). */
  discipline: 'architecture' | 'structure'
  /** Wall type the Wall tool draws with. */
  wallType: string
  /** Component library → the next Component click places this (real size); autoAlign turns it parallel to
   *  the nearest wall within 1 m. Session only. */
  pendingComponent: { name: string; w: number; d: number; h: number; rot: number; autoAlign: boolean } | null
  /** Project Browser → 2D elevation / section drawing (view 'drawing'). */
  drawing: import('../bim/drawing2d').DrawingReq | null
  /** Project Browser → 3D view request (session only): an elevation (orthographic side view), a section
   *  (clip plane through the building centre), or a named 3D view. `n` makes repeated requests distinct. */
  viewReq: { kind: 'elev' | 'section' | 'home' | 'sectionBox' | 'exterior' | 'bookmark' | 'saveView'; face?: 'front' | 'back' | 'left' | 'right'; axis?: 'x' | 'y'; /** bookmark: its id */ id?: string; n: number } | null
  requestView: (r: Omit<NonNullable<BimState['viewReq']>, 'n'>) => void

  /** Validated, undoable model edit (ONE undo step): rooms / stairs recomputed, the model rules checked, element
   *  identities stamped (guid kept, rev + 1, provenance `opts.src` on new elements). Returns an error or null: the
   *  mark of the element whose top would not be above its base, or `rule:<message>` (see ruleMessage). */
  edit: (label: string, fn: (m: BimModel) => BimModel, opts?: { src?: Provenance; /** false: an import — the opening rules are left to the model checks */ rules?: boolean }) => string | null
  /** Saved 3D viewpoints (persisted) and the live 3D view-only state (session). */
  bookmarks: CameraBookmark[]
  setBookmarks: (b: CameraBookmark[]) => void
  /** Highest model revision handed out (an edit after an undo gets a new revision, never an old one again). */
  revTop: number
  live3d: Live3dView
  setLive3d: (p: Partial<Live3dView>) => void
  /** Smart Room tool: the template placed by the next plan click. Session only. */
  pendingRoom: SmartRoomSpec | null
  /** 3D room focus request (camera to the room, its level): `n` makes repeats distinct. */
  focusReq: { room: string; n: number } | null
  focusRoom: (room: string) => void
  updateWall: (id: string, patch: Partial<Wall>, label: string) => string | null
  undo: () => string | null
  redo: () => string | null
  runChecks: () => void
  set: (patch: Partial<Pick<BimState, 'view' | 'display' | 'level' | 'scale' | 'scheduleCat' | 'checked' | 'selection' | 'rightTab' | 'browserCollapsed' | 'maximized' | 'appliedRecommendation' | 'browserSel' | 'tool' | 'wallType' | 'discipline' | 'pendingComponent' | 'drawing' | 'pendingRoom'>>) => void
  /** Deletes the selected element (a wall takes its doors and windows with it). Returns its label or null. */
  deleteSelection: () => string | null
  toggleBrowser: (key: string) => void
  addComment: (text: string) => void
  reset: () => void
}

const initial = createVillaBim()

/** Persisted BIM store of an older version → the current one (v2: placements and lists, v3: element identities).
 *  Everything the user saved stays as it was; only what is missing is filled in. */
export function migrateBimState(persisted: unknown, version: number): Partial<BimState> & { model: BimModel } {
  void version
  const p = persisted as Partial<BimState>
  return { ...p, model: upgradeModel(p.model ?? createVillaBim(), !p.model) }
}
/** Persisted store version (3 = element identities). */
export const BIM_STORE_VERSION = 3

export const useBim = create<BimState>()(
  persist(
    (set, get) => ({
      viewReq: null,
      pendingComponent: null,
      pendingRoom: null,
      bookmarks: [],
      revTop: initial.rev ?? 1,
      setBookmarks: (bookmarks) => set({ bookmarks }),
      live3d: { mode: 'section', wallOpacity: 0.35, lowWalls: 1200, doorsOpen: false, collide: true },
      setLive3d: (p) => set({ live3d: { ...get().live3d, ...p } }),
      focusReq: null,
      focusRoom: (room) => set({ view: '3d', focusReq: { room, n: (get().focusReq?.n ?? 0) + 1 } }),
      drawing: null,
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

      edit: (label, fn, opts) => {
        const before = get().model
        const raw = fn(before)
        if (raw === before) return null
        // rooms follow their walls, imported stairs a changed storey height — in this same step
        const after = deriveModel(before, raw)
        // validation: a wall's top must stay above its base
        const bad = after.walls.find((w) => {
          const base = (after.levels.find((l) => l.id === w.baseLevel)?.elevation ?? 0) + w.baseOffset
          const top = (after.levels.find((l) => l.id === w.topLevel)?.elevation ?? 0) + w.topOffset
          return top - base <= 0 || w.length <= 0
        })
        if (bad) return bad.mark
        // the host-wall rule of openings, arc radii, sloped tops (only what this edit touched)
        const rule = opts?.rules === false ? null : editRule(before, after)
        if (rule) return RULE + ruleText(rule.mark, rule.code)
        const stamped = stampEdit(before, after, opts?.src ?? { kind: 'drawn' }).model
        // revisions never repeat, also after an undo
        const rev = Math.max(get().revTop ?? 0, before.rev ?? 1) + 1
        stamped.rev = rev
        set({ revTop: rev, model: stamped, undoStack: [...get().undoStack.slice(-99), { label, model: before }], redoStack: [] })
        if (get().coordAuto) get().runChecks()
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
      runChecks: () => {
        const off = get().coordOff
        set({ checks: runModelChecks(get().model).map((c) => (off.includes(c.key) ? { ...c, status: 'off' as const, count: 0, items: [] } : c)), checkedAt: Date.now() })
      },
      coordOff: [],
      coordAuto: false,
      setCoord: (patch) => {
        set(patch)
        get().runChecks()
      },
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
      version: BIM_STORE_VERSION,
      // v2: walls carry their plan placement; columns, slabs, stairs… lists
      // v3: every element carries a guid, rev and provenance (assigned here, nothing else changes)
      migrate: (persisted, version) => migrateBimState(persisted, version) as BimState,
      partialize: (s) => ({
        model: s.model,
        view: (s.view === 'drawing' ? '3d' : s.view) as BimView,
        display: s.display,
        level: s.level,
        scale: s.scale,
        scheduleCat: s.scheduleCat,
        rightTab: s.rightTab,
        browserCollapsed: s.browserCollapsed,
        browserOpen: s.browserOpen,
        browserSel: s.browserSel,
        coordOff: s.coordOff,
        coordAuto: s.coordAuto,
        bookmarks: s.bookmarks,
        revTop: s.revTop,
        comments: s.comments,
        checks: s.checks,
        checkedAt: s.checkedAt,
        appliedRecommendation: s.appliedRecommendation,
      }),
    },
  ),
)
