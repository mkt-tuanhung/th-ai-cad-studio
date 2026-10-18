/** Survey exports: points (CSV, PNEZD), contours (DXF R12 polylines with elevation), surface + alignment (LandXML 1.2). */
import type { Survey } from './survey'
import type { Contour, Polyline, Tin } from './tin'

const f3 = (v: number) => v.toFixed(3)

export function pointsCsv(s: Survey): string {
  const rows = ['Point,Northing,Easting,Elevation,Description']
  for (let i = 0; i < s.x.length; i++) rows.push(`${i + 1},${f3(s.y[i])},${f3(s.x[i])},${f3(s.z[i])},${(s.codes?.[i] ?? '').replace(/,/g, ' ')}`)
  return rows.join('\r\n') + '\r\n'
}

/** DXF R12: contours as 2D POLYLINEs at their elevation (code 30 on the header), minor / major layers. */
export function contoursDxf(cs: Contour[]): string {
  const out: string[] = ['0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', '2']
  for (const [name, color] of [['C-TOPO-MINR', 8], ['C-TOPO-MAJR', 7]] as const) out.push('0', 'LAYER', '2', name, '70', '0', '62', String(color), '6', 'CONTINUOUS')
  out.push('0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES')
  for (const c of cs)
    for (const line of c.lines) {
      out.push('0', 'POLYLINE', '8', c.major ? 'C-TOPO-MAJR' : 'C-TOPO-MINR', '66', '1', '10', '0', '20', '0', '30', f3(c.level), '70', '0')
      for (const [x, y] of line) out.push('0', 'VERTEX', '8', c.major ? 'C-TOPO-MAJR' : 'C-TOPO-MINR', '10', f3(x), '20', f3(y), '30', f3(c.level))
      out.push('0', 'SEQEND')
    }
  out.push('0', 'ENDSEC', '0', 'EOF')
  return out.join('\r\n') + '\r\n'
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

export function landXml(name: string, t: Tin, plan?: Polyline, alignmentName = 'CANAL-01'): string {
  const o: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" date="${new Date().toISOString().slice(0, 10)}" time="${new Date().toISOString().slice(11, 19)}">`,
    '<Units><Metric linearUnit="meter" areaUnit="squareMeter" volumeUnit="cubicMeter" angularUnit="decimal degrees" directionUnit="decimal degrees"/></Units>',
    `<Application name="MD CAD AI STUDIO" manufacturer="MD CAD AI STUDIO" version="0.1.1"/>`,
    `<Surfaces><Surface name="${esc(name)}"><Definition surfType="TIN" area2DSurf="${t.area.toFixed(3)}" elevMin="${f3(t.zmin)}" elevMax="${f3(t.zmax)}"><Pnts>`,
  ]
  for (let i = 0; i < t.x.length; i++) o.push(`<P id="${i + 1}">${f3(t.y[i])} ${f3(t.x[i])} ${f3(t.z[i])}</P>`)
  o.push('</Pnts><Faces>')
  for (let k = 0; k < t.tri.length; k += 3) o.push(`<F>${t.tri[k] + 1} ${t.tri[k + 1] + 1} ${t.tri[k + 2] + 1}</F>`)
  o.push('</Faces></Definition></Surface></Surfaces>')
  if (plan && plan.length >= 2) {
    let L = 0
    for (let i = 1; i < plan.length; i++) L += Math.hypot(plan[i][0] - plan[i - 1][0], plan[i][1] - plan[i - 1][1])
    o.push(`<Alignments><Alignment name="${esc(alignmentName)}" length="${f3(L)}" staStart="0"><CoordGeom>`)
    for (let i = 1; i < plan.length; i++) o.push(`<Line><Start>${f3(plan[i - 1][1])} ${f3(plan[i - 1][0])}</Start><End>${f3(plan[i][1])} ${f3(plan[i][0])}</End></Line>`)
    o.push('</CoordGeom></Alignment></Alignments>')
  }
  o.push('</LandXML>')
  return o.join('\n') + '\n'
}
