import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { idbStorage } from './idbStorage'
import type { CadDocument, Vec2 } from '../cad/types'
import { commit, emptyHistory, preview, redo as redoOp, undo as undoOp, validate, type CadOp, type History, type ValidationError } from '../cad/commandBus'
import { createBlankDocument, createVillaDocument, SEED_VIEW } from '../cad/seed'
import type { ToolId } from '../cad/commands'

export type DraftToggle = 'ortho' | 'osnap' | 'grid' | 'snap' | 'polar' | 'model'
export type RightTab = 'properties' | 'layers' | 'blocks' | 'references'
export type BottomTab = 'command' | 'detected' | 'ai'
export type SheetTab = 'model' | 'layout1' | 'layout2'
export type AiTab = 'suggestions' | 'generate' | 'modify'

export interface ViewState {
  center: Vec2
  /** World millimetres per screen pixel. */
  mmPerPx: number
}

export interface LogLine {
  id: number
  text: string
  tone?: 'error' | 'info'
}

interface CadState {
  docs: Record<string, CadDocument>
  tabs: string[]
  activeId: string | null
  toggles: Record<DraftToggle, boolean>
  rightTab: RightTab
  bottomTab: BottomTab
  sheet: SheetTab
  aiPanel: { open: boolean; minimized: boolean; tab: AiTab }
  scale: string
  // ---- session-only (not persisted) ----
  history: Record<string, History>
  views: Record<string, ViewState>
  selection: string[]
  tool: ToolId
  log: LogLine[]

  activeDoc: () => CadDocument | null
  exec: (op: CadOp) => ValidationError | null
  /** Several ops validated progressively and committed as ONE undo step (AI proposals). */
  execBatch: (ops: CadOp[], label: string) => ValidationError | null
  undo: () => string | null
  redo: () => string | null
  newDrawing: (name?: string) => CadDocument
  openDocument: (doc: CadDocument) => void
  closeTab: (id: string) => void
  setActive: (id: string) => void
  save: () => void
  saveAs: (name: string) => void
  setView: (id: string, v: ViewState) => void
  setSelection: (ids: string[]) => void
  setTool: (t: ToolId) => void
  toggle: (k: DraftToggle) => void
  print: (text: string, tone?: LogLine['tone']) => void
  set: (patch: Partial<Pick<CadState, 'rightTab' | 'bottomTab' | 'sheet' | 'scale'>>) => void
  setAi: (patch: Partial<CadState['aiPanel']>) => void
}

/**
 * Desktop host: every local mutation is mirrored to the native C++ command bus, which is
 * authoritative (see services/nativeSync.ts). Null in a plain browser.
 */
export interface CadMirror {
  commit: (docId: string, ops: CadOp[], label: string) => void
  undo: (docId: string) => void
  redo: (docId: string) => void
}
export const cadMirror: { current: CadMirror | null; suspended: boolean } = { current: null, suspended: false }
const mirror = () => (cadMirror.suspended ? null : cadMirror.current)

let logSeq = 0
const line = (text: string, tone?: LogLine['tone']): LogLine => ({ id: ++logSeq, text, tone })

const villa = createVillaDocument()

export const useCad = create<CadState>()(
  persist(
    (set, get) => ({
      docs: { [villa.id]: villa },
      tabs: [villa.id],
      activeId: villa.id,
      // States shown in mockup 02: OSNAP, SNAP, MODEL on; ORTHO, GRID, POLAR off.
      toggles: { ortho: false, osnap: true, grid: false, snap: true, polar: false, model: true },
      rightTab: 'properties',
      bottomTab: 'command',
      sheet: 'model',
      aiPanel: { open: true, minimized: false, tab: 'suggestions' },
      scale: '1:100',
      history: {},
      views: {},
      selection: [],
      tool: 'select',
      // The two history lines visible in the mockup (file opened, window selection prompt).
      log: [line('Command: _OPEN'), line('Command: Specify opposite corner:')],

      activeDoc: () => {
        const { activeId, docs } = get()
        return activeId ? (docs[activeId] ?? null) : null
      },

      exec: (op) => {
        const doc = get().activeDoc()
        if (!doc) return { code: 'unknown-entity', detail: 'no document' }
        const h = get().history[doc.id] ?? emptyHistory()
        const r = commit(doc, h, op)
        if (!r.ok) return r.error
        set({ docs: { ...get().docs, [doc.id]: r.doc }, history: { ...get().history, [doc.id]: r.history } })
        mirror()?.commit(doc.id, [op], op.label)
        return null
      },

      execBatch: (ops, label) => {
        const doc = get().activeDoc()
        if (!doc) return { code: 'unknown-entity', detail: 'no document' }
        let next = doc
        for (const op of ops) {
          const err = validate(next, op)
          if (err) return err
          next = preview(next, op)
        }
        const h = get().history[doc.id] ?? emptyHistory()
        const history = { undo: [...h.undo, { label, before: doc, after: next }], redo: [] }
        set({ docs: { ...get().docs, [doc.id]: next }, history: { ...get().history, [doc.id]: history } })
        mirror()?.commit(doc.id, ops, label)
        return null
      },

      undo: () => {
        const doc = get().activeDoc()
        if (!doc) return null
        const r = undoOp(get().history[doc.id] ?? emptyHistory())
        if (!r) return null
        set({ docs: { ...get().docs, [doc.id]: r.doc }, history: { ...get().history, [doc.id]: r.history }, selection: [] })
        mirror()?.undo(doc.id)
        return r.label
      },

      redo: () => {
        const doc = get().activeDoc()
        if (!doc) return null
        const r = redoOp(get().history[doc.id] ?? emptyHistory())
        if (!r) return null
        set({ docs: { ...get().docs, [doc.id]: r.doc }, history: { ...get().history, [doc.id]: r.history }, selection: [] })
        mirror()?.redo(doc.id)
        return r.label
      },

      newDrawing: (name) => {
        const existing = Object.values(get().docs).map((d) => d.name)
        let i = 1
        while (existing.includes(`Drawing${i}.dwg`)) i++
        const doc = createBlankDocument(name ?? `Drawing${i}.dwg`)
        get().openDocument(doc)
        return doc
      },

      openDocument: (doc) =>
        set({
          docs: { ...get().docs, [doc.id]: doc },
          tabs: get().tabs.includes(doc.id) ? get().tabs : [...get().tabs, doc.id],
          activeId: doc.id,
          selection: [],
          sheet: 'model',
        }),

      closeTab: (id) => {
        const tabs = get().tabs.filter((t) => t !== id)
        const activeId = get().activeId === id ? (tabs.at(-1) ?? null) : get().activeId
        set({ tabs, activeId, selection: [] })
      },

      setActive: (id) => set({ activeId: id, selection: [] }),

      save: () => {
        const doc = get().activeDoc()
        if (!doc) return
        set({ docs: { ...get().docs, [doc.id]: { ...doc, dirty: false, savedAt: Date.now() } } })
      },

      saveAs: (name) => {
        const doc = get().activeDoc()
        if (!doc) return
        const fixed = /\.(dwg|dxf)$/i.test(name) ? name : `${name}.dwg`
        set({ docs: { ...get().docs, [doc.id]: { ...doc, name: fixed, dirty: false, savedAt: Date.now() } } })
      },

      setView: (id, v) => set({ views: { ...get().views, [id]: v } }),
      setSelection: (selection) => set({ selection }),
      setTool: (tool) => set({ tool }),
      toggle: (k) => set({ toggles: { ...get().toggles, [k]: !get().toggles[k] } }),
      print: (text, tone) => set({ log: [...get().log.slice(-300), line(text, tone)] }),
      set: (patch) => set(patch),
      setAi: (patch) => set({ aiPanel: { ...get().aiPanel, ...patch } }),
    }),
    {
      name: 'thcad.cad',
      version: 1,
      storage: idbStorage<Partial<CadState>>('docs'),
      partialize: (s) => ({
        docs: s.docs,
        tabs: s.tabs,
        activeId: s.activeId,
        toggles: s.toggles,
        rightTab: s.rightTab,
        bottomTab: s.bottomTab,
        aiPanel: s.aiPanel,
        scale: s.scale,
      }),
    },
  ),
)

export const defaultView = (doc: CadDocument): ViewState =>
  doc.underlay ? { ...SEED_VIEW } : { center: { x: 5000, y: 3500 }, mmPerPx: 15 }
