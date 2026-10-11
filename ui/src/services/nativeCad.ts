import type { CadDocument, Entity } from '../cad/types'
import type { CadOp } from '../cad/commandBus'

/** Wire format of native entities/ops (native/libs/core/include/thcad/core/ops_json.hpp). */
type P = [number, number]
export interface NativeEntity {
  id: string
  layer: string
  color?: string
  kind: 'line' | 'polyline' | 'circle' | 'arc' | 'text' | 'dimension'
  a?: P
  b?: P
  points?: P[]
  closed?: boolean
  center?: P
  radius?: number
  start?: number
  end?: number
  position?: P
  height?: number
  value?: string
  rotation?: number
  centered?: boolean
  offset?: number
  override?: string | null
  textHeight?: number
}
export interface NativeOp {
  type: 'add' | 'erase' | 'replace' | 'setCurrentLayer' | 'layerProps'
  label?: string
  entities?: NativeEntity[]
  ids?: string[]
  layer?: string
}

const pt = (p: { x: number; y: number }): P => [p.x, p.y]
const v = (p: P | undefined) => ({ x: p?.[0] ?? 0, y: p?.[1] ?? 0 })

export function toNativeEntity(e: Entity): NativeEntity {
  const base = { id: e.id, layer: e.layer, color: e.color }
  switch (e.kind) {
    case 'line':
      return { ...base, kind: 'line', a: pt(e.a), b: pt(e.b) }
    case 'polyline':
      return { ...base, kind: 'polyline', points: e.pts.map(pt), closed: e.closed }
    case 'circle':
      return { ...base, kind: 'circle', center: pt(e.c), radius: e.r }
    case 'arc':
      return { ...base, kind: 'arc', center: pt(e.c), radius: e.r, start: e.start, end: e.end }
    case 'text':
      return { ...base, kind: 'text', position: pt(e.p), height: e.height, value: e.value, rotation: e.rotation, centered: e.align === 'center' }
    case 'dimension':
      return { ...base, kind: 'dimension', a: pt(e.a), b: pt(e.b), offset: e.offset, override: e.override, textHeight: e.textHeight }
  }
}

export function fromNativeEntity(n: NativeEntity): Entity {
  const base = { id: n.id, layer: n.layer, color: n.color ?? 'ByLayer', linetype: 'ByLayer' as const, lineweight: 'ByLayer' as const, transparency: 0 }
  switch (n.kind) {
    case 'line':
      return { ...base, kind: 'line', a: v(n.a), b: v(n.b) }
    case 'polyline':
      return { ...base, kind: 'polyline', pts: (n.points ?? []).map(v), closed: !!n.closed }
    case 'circle':
      return { ...base, kind: 'circle', c: v(n.center), r: n.radius ?? 0 }
    case 'arc':
      return { ...base, kind: 'arc', c: v(n.center), r: n.radius ?? 0, start: n.start ?? 0, end: n.end ?? 0 }
    case 'text':
      return { ...base, kind: 'text', p: v(n.position), height: n.height ?? 250, value: n.value ?? '', rotation: n.rotation ?? 0, align: n.centered ? 'center' : 'left' }
    case 'dimension':
      return { ...base, kind: 'dimension', a: v(n.a), b: v(n.b), offset: n.offset ?? 0, override: n.override ?? null, textHeight: n.textHeight ?? 250 }
  }
}

/** The open drawing as the engine sees it (raster underlays are not geometry and are omitted). */
export function toNativeDocument(d: CadDocument) {
  return {
    id: d.id,
    name: d.name,
    currentLayer: d.currentLayer,
    layers: d.layers.map((l) => ({ name: l.name, color: l.color, visible: l.visible, locked: l.locked })),
    entities: d.entities.map(toNativeEntity),
  }
}

/** Native ops → prototype ops (the UI's own command bus validates them again). */
export function fromNativeOps(ops: NativeOp[], label: string): CadOp[] {
  return ops.map((o): CadOp => {
    switch (o.type) {
      case 'add':
        return { type: 'add', entities: (o.entities ?? []).map(fromNativeEntity), label }
      case 'replace':
        return { type: 'replace', entities: (o.entities ?? []).map(fromNativeEntity), label }
      case 'erase':
        return { type: 'erase', ids: o.ids ?? [], label }
      case 'setCurrentLayer':
        return { type: 'setCurrentLayer', layer: o.layer ?? '0', label }
      default:
        return { type: 'setCurrentLayer', layer: o.layer ?? '0', label }
    }
  })
}
