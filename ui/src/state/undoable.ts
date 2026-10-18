import { matchesShortcut, useSettings } from './settings'

/**
 * Shared undo/redo stack for the discipline workspaces. A workspace keeps its editable data in `doc`;
 * every change goes through `edit(label, fn)`, which validates the result before committing.
 */
export interface Undoable<D> {
  doc: D
  undoStack: { label: string; doc: D }[]
  redoStack: { label: string; doc: D }[]
}

type Get<S> = () => S
type Set<S> = (p: Partial<S>) => void

export function undoableActions<D, S extends Undoable<D>>(get: Get<S>, set: Set<S>, validate?: (d: D) => string | null) {
  return {
    /** Returns a validation error (nothing committed) or null. */
    edit(label: string, fn: (d: D) => D): string | null {
      const before = get().doc
      const after = fn(before)
      const err = validate?.(after) ?? null
      if (err) return err
      set({ doc: after, undoStack: [...get().undoStack.slice(-99), { label, doc: before }], redoStack: [] } as unknown as Partial<S>)
      return null
    },
    undo(): string | null {
      const last = get().undoStack.at(-1)
      if (!last) return null
      set({ doc: last.doc, undoStack: get().undoStack.slice(0, -1), redoStack: [...get().redoStack, { label: last.label, doc: get().doc }] } as unknown as Partial<S>)
      return last.label
    },
    redo(): string | null {
      const next = get().redoStack.at(-1)
      if (!next) return null
      set({ doc: next.doc, redoStack: get().redoStack.slice(0, -1), undoStack: [...get().undoStack, { label: next.label, doc: get().doc }] } as unknown as Partial<S>)
      return next.label
    },
  }
}

/** Undo / redo handler for a workspace — the keys of Settings → Keyboard Shortcuts (⌘Z / ⌘⇧Z by default);
 *  ignored while typing in a field. */
export function undoKeys(undo: () => string | null, redo: () => string | null, report: (label: string | null, redo: boolean) => void) {
  return (e: KeyboardEvent) => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement
    if (typing) return
    const sc = useSettings.getState().shortcuts
    const isRedo = matchesShortcut(e, sc.redo)
    if (!isRedo && !matchesShortcut(e, sc.undo)) return
    e.preventDefault()
    report(isRedo ? redo() : undo(), isRedo)
  }
}
