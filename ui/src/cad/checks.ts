import type { CadDocument, Entity } from './types'
import { measured } from './geometry'

/** Deterministic drawing checks (run locally on the document — no AI involved). */
export interface Finding {
  id: string
  entityId: string
  kind: 'dimension-override' | 'zero-length' | 'layer-0'
  measured?: number
  shown?: string
}

export function runChecks(doc: CadDocument): Finding[] {
  const out: Finding[] = []
  for (const e of doc.entities) {
    if (e.kind === 'dimension' && e.override !== null) {
      const m = measured(e.a, e.b)
      const shown = parseFloat(e.override)
      if (!Number.isFinite(shown) || Math.abs(shown - m) / Math.max(m, 1) > 0.01)
        out.push({ id: `dim-${e.id}`, entityId: e.id, kind: 'dimension-override', measured: m, shown: e.override })
    }
    if (isZeroLength(e)) out.push({ id: `zero-${e.id}`, entityId: e.id, kind: 'zero-length' })
  }
  return out
}

function isZeroLength(e: Entity) {
  return e.kind === 'line' && e.a.x === e.b.x && e.a.y === e.b.y
}
