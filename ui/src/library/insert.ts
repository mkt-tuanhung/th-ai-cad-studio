import type { CadDocument, Entity } from '../cad/types'
import { rotateEntity, translateEntity } from '../cad/geometry'
import { toDxf } from '../cad/dxf'
import { createBlankDocument } from '../cad/seed'
import { insertQueue } from '../state/cadSession'
import { useCad } from '../state/cad'
import { useCadSession } from '../state/cadSession'
import { useLibrary, type InsertPrefs } from '../state/library'
import type { LibComponent } from './catalog'
import { bounds, type Shape } from './shapes'

const COLORS: Record<string, string> = { ByLayer: 'ByLayer', red: '#dc2626', yellow: '#ca8a04', green: '#16a34a', cyan: '#0891b2', blue: '#2563eb', magenta: '#c026d3', gray: '#6b7280', black: '#111827' }
export const COLOR_NAMES = Object.keys(COLORS)

/** Plan geometry offset to the insertion point and rotated (block coordinates). */
export function prepareBlock(comp: LibComponent, prefs: InsertPrefs): Shape[] {
  const plan = comp.plan?.() ?? []
  if (!plan.length) return []
  const b = bounds(plan)
  const origin =
    prefs.point === 'bottom-left' ? b.min : prefs.point === 'bottom-center' ? { x: (b.min.x + b.max.x) / 2, y: b.min.y } : { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 }
  return plan.map((e) => rotateEntity(translateEntity(e, { x: -origin.x, y: -origin.y }), (prefs.rotation * Math.PI) / 180))
}

export const canInsert = (c: LibComponent) => !!c.plan && c.group !== 'materials'

/**
 * Starts AutoCAD-style INSERT in CAD 2D for a library component: the block follows the cursor
 * until a point is picked (or typed); geometry goes through the command bus like any other edit.
 */
export function queueInsert(comp: LibComponent, prefs: InsertPrefs, mappedLayer: string) {
  const doc = useCad.getState().activeDoc()
  insertQueue.next = {
    componentId: comp.id,
    name: comp.name,
    entities: prepareBlock(comp, prefs) as Entity[],
    layer: prefs.currentLayer ? null : mappedLayer || comp.layer,
    layerColor: '#1f2937',
    color: COLORS[prefs.color] ?? 'ByLayer',
    linetype: prefs.linetype,
    explode: prefs.explode,
    onPlaced: () => useLibrary.getState().recordUse(comp.id),
  }
  if (!doc) useCad.getState().newDrawing()
  useCadSession.getState().start('insert', 'INSERT')
}

/** The component as a DXF R12 drawing (Associated Files → download; its size is the file size shown). */
export function componentDxf(comp: LibComponent): string {
  const doc: CadDocument = createBlankDocument(`${comp.name}.dxf`)
  const layer = comp.layer || '0'
  doc.layers = doc.layers.some((l) => l.name === layer) ? doc.layers : [...doc.layers, { name: layer, color: '#1f2937', visible: true, locked: false, linetype: 'Continuous', lineweight: 0.25 }]
  doc.entities = (comp.plan?.() ?? []).map((e, i) => ({ ...e, id: `c${i}`, layer }))
  return toDxf(doc)
}

const sizeCache = new Map<string, number>()
export function componentBytes(comp: LibComponent): number {
  if (!comp.plan) return 0
  let n = sizeCache.get(comp.id)
  if (n === undefined) {
    n = new Blob([componentDxf(comp)]).size
    sizeCache.set(comp.id, n)
  }
  return n
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function downloadText(name: string, text: string, type = 'application/dxf') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const fileStem = (name: string) => name.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
