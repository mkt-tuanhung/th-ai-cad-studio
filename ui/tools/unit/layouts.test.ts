// DXF R2000 with paper-space layouts (run: UNIT=layouts node tools/test-cam.mjs dxf > out.json).
import { toDxf2000 } from '../../src/cad/dxf2000'
import { createVillaDocument } from '../../src/cad/seed'
import { decodeDxf, importDxf } from '../../src/cad/dxfImport'

/** The villa drawing with three layouts: A3 fit, A1 1:50, A4 1:200 (named in Vietnamese). */
export function dxf() {
  const d = createVillaDocument(0)
  d.layouts = [
    { id: 'l1', name: 'Layout1', paper: 'A3', scale: null },
    { id: 'l2', name: 'Mặt bằng 1-50', paper: 'A1', scale: 50 },
    { id: 'l3', name: 'A4 1-200', paper: 'A4', scale: 200 },
  ]
  return { dxf: toDxf2000(d), entities: d.entities.length }
}

/** Reads a DXF back (R2000 with layouts): entity count and the layouts recovered. */
export function readBack(text: string) {
  const r = importDxf(decodeDxf(new TextEncoder().encode(text)).text)
  return { n: r.entities.length, layouts: r.layouts }
}
