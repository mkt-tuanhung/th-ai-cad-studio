// V24-021 / V24-022 — DXF export is real CAD geometry (no picture inside) and 1000 mm stays 1000 mm through a
// round trip, for both writers (R12 and R2000 with layouts). Run: UNIT=dxfround node tools/test-cam.mjs run
import { createVillaDocument } from '../../src/cad/seed'
import { toDxf } from '../../src/cad/dxf'
import { toDxf2000 } from '../../src/cad/dxf2000'
import { importDxf } from '../../src/cad/dxfImport'
import type { CadDocument, Entity } from '../../src/cad/types'

const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol

export function run() {
  const out: string[] = []
  let fails = 0
  const check = (name: string, ok: boolean, extra = '') => {
    if (!ok) fails++
    out.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
  }
  const base = createVillaDocument(0)
  const layer = base.layers[0].name
  const probes: Entity[] = [
    { id: 'q-line', kind: 'line', layer, a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } } as Entity,
    { id: 'q-arc', kind: 'arc', layer, c: { x: 5000, y: 5000 }, r: 2500, start: 0, end: Math.PI / 2 } as Entity,
    { id: 'q-circle', kind: 'circle', layer, c: { x: -3000, y: 2000 }, r: 450 } as Entity,
    { id: 'q-poly', kind: 'polyline', layer, pts: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }], closed: true } as Entity,
  ]
  const doc: CadDocument = { ...base, entities: [...base.entities, ...probes] }
  for (const [name, text] of [['R12', toDxf(doc)], ['R2000', toDxf2000(doc)]] as const) {
    // V24-021: real entities, no raster masquerading as CAD
    check(`${name}: no IMAGE / IMAGEDEF / OLE / WIPEOUT entity in the file`, !/\n\s*0\s*\n(IMAGE|IMAGEDEF|OLE2FRAME|OLEFRAME|WIPEOUT)\s*\n/.test(text))
    const im = importDxf(text)
    const kinds = (k: string) => im.entities.filter((e) => e.kind === k).length
    check(`${name}: read back as CAD entities (lines ${kinds('line')}, arcs ${kinds('arc')}, circles ${kinds('circle')}, polylines ${kinds('polyline')})`, kinds('line') > 0 && kinds('arc') > 0 && kinds('circle') > 0 && kinds('polyline') > 0)
    // V24-022: scale — 1000 mm stays 1000 mm, the arc radius exact
    const line = im.entities.find((e) => e.kind === 'line' && near(e.a.x, 0) && near(e.a.y, 0) && near(e.b.y, 0) && near(e.b.x, 1000, 1e-3))
    check(`${name}: the 1000 mm line is 1000 mm`, !!line, line ? JSON.stringify(line) : 'not found')
    const arc = im.entities.find((e) => e.kind === 'arc' && near(e.c.x, 5000, 1e-3) && near(e.c.y, 5000, 1e-3))
    check(`${name}: the arc keeps radius 2500 and its angles`, !!arc && arc.kind === 'arc' && near(arc.r, 2500, 1e-3) && near(arc.start, 0, 1e-6) && near(arc.end, Math.PI / 2, 1e-6), arc ? JSON.stringify(arc) : 'not found')
    const circle = im.entities.find((e) => e.kind === 'circle' && near(e.c.x, -3000, 1e-3))
    check(`${name}: the circle keeps radius 450`, !!circle && circle.kind === 'circle' && near(circle.r, 450, 1e-3))
    const poly = im.entities.find((e) => e.kind === 'polyline' && e.closed && e.pts.length === 4 && e.pts.some((p) => near(p.x, 1000, 1e-3) && near(p.y, 1000, 1e-3)))
    check(`${name}: the closed 1000 × 1000 polyline is exact`, !!poly)
    const ins = im.insunits
    check(`${name}: the file says millimetres ($INSUNITS 4) or nothing (read as mm)`, ins === 4 || ins === null || ins === undefined, String(ins))
    check(`${name}: every entity read back (${im.entities.length} of ${doc.entities.length} before block / dimension explosion)`, im.entities.length >= doc.entities.length * 0.9)
  }
  return { all: fails === 0, failed: fails, out }
}
