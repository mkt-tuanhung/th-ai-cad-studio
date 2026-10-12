import { parseShapefile, parseSurvey, previewCsv } from '../../src/civil/survey'
import { buildTin, contours, elevationAt, groundProfile, polyLength, crossLine } from '../../src/civil/tin'
import { EXISTING_GROUND, interp } from '../../src/civil/model'

declare global { interface Window { runSurveyTests: (files: Record<string, string>, shp: { shp: string; dbf: string; prj: string; al: string; aldbf: string }) => unknown } }
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer

window.runSurveyTests = (files, shp) => {
  const out: Record<string, unknown> = {}
  const pts = parseShapefile('canal_points_SYNTHETIC.shp', b64(shp.shp), b64(shp.dbf), shp.prj)
  const al = parseShapefile('canal_centreline_SYNTHETIC.shp', b64(shp.al), b64(shp.aldbf), shp.prj)
  const stin = buildTin(pts)
  out.shapefile = { points: pts.x.length, tris: stin.tri.length / 3, area: Math.round(stin.area), crs: pts.crs, alignment: al.alignment?.length, alName: al.alignmentName, length: al.alignment ? +polyLength(al.alignment).toFixed(2) : null, maxErr: Math.max(...groundProfile(stin, al.alignment!, 20).profile.map(([st, z]) => Math.abs(z - interp(EXISTING_GROUND, st)))).toFixed(3) }
  for (const [name, text] of Object.entries(files)) {
    const t0 = performance.now()
    const s = parseSurvey(name, text)
    const tin = buildTin(s)
    const g = s.alignment ? groundProfile(tin, s.alignment, 20) : null
    // compare with the profile the synthetic terrain was generated from (noise ±3 cm)
    const err = g ? Math.max(...g.profile.map(([st, z]) => Math.abs(z - interp(EXISTING_GROUND, st)))) : null
    const c = contours(tin, 0.25)
    out[name] = {
      format: s.format, crs: s.crs, points: s.x.length, codes: s.codes?.length ?? 0, alignment: s.alignment?.length ?? 0, alName: s.alignmentName,
      length: s.alignment ? +polyLength(s.alignment).toFixed(2) : null, tris: tin.tri.length / 3, area: Math.round(tin.area), maxEdge: tin.maxEdge && +tin.maxEdge.toFixed(2),
      zr: [+tin.zmin.toFixed(3), +tin.zmax.toFixed(3)], profileN: g?.profile.length, missing: g?.missing.length, maxErr: err && +err.toFixed(3),
      contourLevels: c.length, contourLines: c.reduce((a, x) => a + x.lines.length, 0), cross: s.alignment ? crossLine(tin, s.alignment, 300, 40, 5).length : null,
      outside: elevationAt(tin, tin.bounds.x0 - 100, tin.bounds.y0 - 100), warnings: s.warnings, ms: Math.round(performance.now() - t0),
    }
  }
  out.preview = previewCsv('1 1151400.0 585200.0 7.75 GND\n2 1151408.1 585201.2 7.80 GND\n3 1151416.3 585199.8 7.81 GND\n')
  out.previewVn = previewCsv('STT;X;Y;H\n1;1151400,0;585200,0;7,75\n')
  const vn = parseSurvey('vn.csv', 'STT;X;Y;H\n1;1151400,0;585200,0;7,75\n2;1151410,0;585200,0;7,80\n3;1151400,0;585210,0;7,70\n')
  out.vn = { x: vn.x, y: vn.y, z: vn.z, warnings: vn.warnings }
  try { parseSurvey('bad.csv', 'a,b\n1,2\n') } catch (e) { out.badCsv = String(e) }
  return out
}
