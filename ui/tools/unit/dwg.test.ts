import { createVillaDocument } from '../../src/cad/seed'
import { toDxf } from '../../src/cad/dxf'
import { toDwgAdd, expectedEntities } from '../../src/cad/dwgWrite'
import { dxfText, importDxf } from '../../src/cad/dxfImport'
export function dxf() {
  const d = createVillaDocument(0)
  return { text: toDxf(d), n: d.entities.length }
}
export function dwgadd() {
  const d = createVillaDocument(0)
  // add a Vietnamese label to check the Unicode path
  d.entities.push({ id: 'vn', kind: 'text', layer: d.layers[0].name, p: { x: 1000, y: 1000 }, height: 250, value: 'PHÒNG KHÁCH — Tầng 1', rotation: 0, align: 'left' } as never)
  const r = toDwgAdd(d)
  return { script: r.script, counts: r.counts, expected: expectedEntities(r.counts), layers: d.layers.map((l) => l.name) }
}
export function readBack(text: string) {
  const imp = importDxf(text)
  const kinds: Record<string, number> = {}
  for (const e of imp.entities) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1
  return { kinds, n: imp.entities.length, texts: imp.entities.filter((e) => e.kind === 'text').map((e) => (e as { value: string }).value).slice(-3), layers: imp.layers.map((l) => l.name), decoded: dxfText('PH\\U+00D2NG') }
}
