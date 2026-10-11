import type { CadDocument, Entity } from './types'
import { dist } from './geometry'

/**
 * Command bus contract shared with the native engine:
 *   validate(op) → preview(op) (no side effects) → commit(op) → undo/redo.
 * The native implementation will expose the same operations over the Qt bridge; AI-generated
 * operations must go through preview + explicit user approval before commit.
 */
export type CadOp =
  | { type: 'add'; entities: Entity[]; label: string }
  | { type: 'erase'; ids: string[]; label: string }
  | { type: 'replace'; entities: Entity[]; label: string }
  | { type: 'setCurrentLayer'; layer: string; label: string }
  | { type: 'layerProps'; name: string; patch: Partial<Pick<CadDocument['layers'][number], 'visible' | 'locked' | 'color'>>; label: string }
  /** AutoCAD -LAYER Make (without setting it current): creates the layer when it is missing. */
  | { type: 'addLayer'; name: string; color: string; label: string }

export type ValidationError = { code: 'locked-layer' | 'degenerate' | 'unknown-entity' | 'unknown-layer'; detail: string }

export function validate(doc: CadDocument, op: CadOp): ValidationError | null {
  const layer = (name: string) => doc.layers.find((l) => l.name === name)
  // Sets / maps, not includes()/find(): selections of tens of thousands of entities are normal
  const eraseIds = op.type === 'erase' ? new Set(op.ids) : null
  const touched: Entity[] =
    op.type === 'add' || op.type === 'replace'
      ? op.entities
      : eraseIds
        ? doc.entities.filter((e) => eraseIds.has(e.id))
        : []
  if (op.type === 'erase' && touched.length !== op.ids.length) return { code: 'unknown-entity', detail: 'entity not found' }
  if (op.type === 'replace') {
    const byId = new Map(doc.entities.map((x) => [x.id, x]))
    for (const e of op.entities) {
      const prev = byId.get(e.id)
      if (!prev) return { code: 'unknown-entity', detail: e.id }
      if (layer(prev.layer)?.locked) return { code: 'locked-layer', detail: prev.layer }
    }
  }
  for (const e of touched) {
    const l = layer(e.layer)
    if (!l) return { code: 'unknown-layer', detail: e.layer }
    if (l.locked) return { code: 'locked-layer', detail: e.layer }
    if (op.type !== 'erase' && isDegenerate(e)) return { code: 'degenerate', detail: e.kind }
  }
  if (op.type === 'setCurrentLayer' && !layer(op.layer)) return { code: 'unknown-layer', detail: op.layer }
  if (op.type === 'layerProps' && !layer(op.name)) return { code: 'unknown-layer', detail: op.name }
  if (op.type === 'addLayer' && !op.name.trim()) return { code: 'unknown-layer', detail: 'empty layer name' }
  return null
}

function isDegenerate(e: Entity): boolean {
  switch (e.kind) {
    case 'line':
      return dist(e.a, e.b) < 1e-6
    case 'polyline':
      return e.pts.length < 2
    case 'circle':
    case 'arc':
      return !(e.r > 1e-6)
    case 'text':
      return !e.value.trim()
    case 'dimension':
      return dist(e.a, e.b) < 1e-6
  }
}

/** Pure: returns the document as it would be after `op` (used for preview and commit). */
export function preview(doc: CadDocument, op: CadOp): CadDocument {
  switch (op.type) {
    case 'add':
      return { ...doc, entities: [...doc.entities, ...op.entities], dirty: true }
    case 'erase': {
      const ids = new Set(op.ids)
      // keep the image draw-order boundary stable
      const removedBehind = doc.underlay ? doc.entities.slice(0, doc.underlay.drawIndex).filter((e) => ids.has(e.id)).length : 0
      return {
        ...doc,
        entities: doc.entities.filter((e) => !ids.has(e.id)),
        underlay: doc.underlay ? { ...doc.underlay, drawIndex: doc.underlay.drawIndex - removedBehind } : null,
        dirty: true,
      }
    }
    case 'replace': {
      const map = new Map(op.entities.map((e) => [e.id, e]))
      return { ...doc, entities: doc.entities.map((e) => map.get(e.id) ?? e), dirty: true }
    }
    case 'setCurrentLayer':
      return { ...doc, currentLayer: op.layer }
    case 'layerProps':
      return { ...doc, layers: doc.layers.map((l) => (l.name === op.name ? { ...l, ...op.patch } : l)), dirty: true }
    case 'addLayer':
      if (doc.layers.some((l) => l.name === op.name)) return doc
      return { ...doc, layers: [...doc.layers, { name: op.name, color: op.color, visible: true, locked: false, linetype: 'Continuous', lineweight: 0.25 }], dirty: true }
  }
}

export interface HistoryEntry {
  label: string
  before: CadDocument
  after: CadDocument
}

export interface History {
  undo: HistoryEntry[]
  redo: HistoryEntry[]
}

export const emptyHistory = (): History => ({ undo: [], redo: [] })
const MAX_UNDO = 200

export type CommitResult = { ok: true; doc: CadDocument; history: History } | { ok: false; error: ValidationError }

export function commit(doc: CadDocument, history: History, op: CadOp): CommitResult {
  const error = validate(doc, op)
  if (error) return { ok: false, error }
  const after = preview(doc, op)
  return {
    ok: true,
    doc: after,
    history: { undo: [...history.undo.slice(-MAX_UNDO + 1), { label: op.label, before: doc, after }], redo: [] },
  }
}

export function undo(history: History): { doc: CadDocument; history: History; label: string } | null {
  const last = history.undo.at(-1)
  if (!last) return null
  return { doc: { ...last.before, dirty: true }, history: { undo: history.undo.slice(0, -1), redo: [...history.redo, last] }, label: last.label }
}

export function redo(history: History): { doc: CadDocument; history: History; label: string } | null {
  const next = history.redo.at(-1)
  if (!next) return null
  return { doc: next.after, history: { undo: [...history.undo, next], redo: history.redo.slice(0, -1) }, label: next.label }
}
