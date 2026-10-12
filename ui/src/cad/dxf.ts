import { triangulate } from './edit'
import type { CadDocument, Entity, Layer } from './types'
import { dimensionGeometry, formatLength, measured } from './geometry'

/**
 * Minimal ASCII DXF (AC1009 / R12) export and import for the prototype model.
 * Raster underlays are not exported (R12 has no IMAGE entity) — the export says so in a comment.
 */
const ACI: Record<string, number> = { '#111827': 7, '#1f2937': 7, '#0f766e': 4, '#2563eb': 5, '#6b7280': 8, '#9aa1ab': 9, '#3f4654': 8, '#9ca3af': 9 }

export function toDxf(doc: CadDocument): string {
  const o: (string | number)[] = []
  const g = (code: number, value: string | number) => o.push(code, typeof value === 'number' ? fmt(value) : value)
  g(999, `MD CAD AI STUDIO UI prototype export — ${doc.name}${doc.underlay ? ' (raster underlay not included)' : ''}`)
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$INSUNITS'); g(70, 4); g(0, 'ENDSEC')
  g(0, 'SECTION'); g(2, 'TABLES'); g(0, 'TABLE'); g(2, 'LAYER'); g(70, doc.layers.length)
  for (const l of doc.layers) layer(g, l)
  g(0, 'ENDTAB'); g(0, 'ENDSEC')
  g(0, 'SECTION'); g(2, 'ENTITIES')
  for (const e of doc.entities) entity(g, e)
  g(0, 'ENDSEC'); g(0, 'EOF')
  const lines: string[] = []
  for (let i = 0; i < o.length; i += 2) lines.push(String(o[i]).padStart(3, ' '), String(o[i + 1]))
  return lines.join('\r\n') + '\r\n'
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(6))

function layer(g: (c: number, v: string | number) => void, l: Layer) {
  g(0, 'LAYER'); g(2, l.name); g(70, l.locked ? 4 : 0); g(62, (ACI[l.color] ?? 7) * (l.visible ? 1 : -1))
  g(6, l.linetype === 'Continuous' ? 'CONTINUOUS' : l.linetype === 'Dashed' ? 'DASHED' : 'DASHDOT')
}

function entity(g: (c: number, v: string | number) => void, e: Entity) {
  const head = (type: string) => { g(0, type); g(8, e.layer) }
  switch (e.kind) {
    case 'line':
      head('LINE'); g(10, e.a.x); g(20, e.a.y); g(30, 0); g(11, e.b.x); g(21, e.b.y); g(31, 0)
      break
    case 'polyline':
      head('POLYLINE'); g(66, 1); g(70, e.closed ? 1 : 0)
      for (const p of e.pts) { g(0, 'VERTEX'); g(8, e.layer); g(10, p.x); g(20, p.y); g(30, 0) }
      g(0, 'SEQEND'); g(8, e.layer)
      // solid fill (HATCH) as R12 SOLIDs: one triangle each (corner order 1-2-4-3, the 4th = the 3rd)
      if (e.filled && e.closed)
        for (const [a, b, c] of triangulate(e.pts)) {
          head('SOLID'); g(10, a.x); g(20, a.y); g(30, 0); g(11, b.x); g(21, b.y); g(31, 0); g(12, c.x); g(22, c.y); g(32, 0); g(13, c.x); g(23, c.y); g(33, 0)
        }
      break
    case 'circle':
      head('CIRCLE'); g(10, e.c.x); g(20, e.c.y); g(30, 0); g(40, e.r)
      break
    case 'arc':
      head('ARC'); g(10, e.c.x); g(20, e.c.y); g(30, 0); g(40, e.r); g(50, (e.start * 180) / Math.PI); g(51, (e.end * 180) / Math.PI)
      break
    case 'text':
      head('TEXT'); g(10, e.p.x); g(20, e.p.y); g(30, 0); g(40, e.height); g(1, e.value); g(50, (e.rotation * 180) / Math.PI)
      if (e.align === 'center') { g(72, 1); g(11, e.p.x); g(21, e.p.y); g(31, 0) }
      break
    case 'dimension': {
      // R12 DIMENSION needs an anonymous block; export the visible geometry instead (exploded).
      const d = dimensionGeometry(e.a, e.b, e.offset)
      for (const [a, b] of [[e.a, d.da], [e.b, d.db], [d.da, d.db]] as const) {
        head('LINE'); g(10, a.x); g(20, a.y); g(30, 0); g(11, b.x); g(21, b.y); g(31, 0)
      }
      head('TEXT'); g(10, d.textAt.x); g(20, d.textAt.y); g(30, 0); g(40, e.textHeight)
      g(1, e.override ?? formatLength(measured(e.a, e.b))); g(50, (d.angle * 180) / Math.PI)
      g(72, 1); g(11, d.textAt.x); g(21, d.textAt.y); g(31, 0)
      break
    }
  }
}
