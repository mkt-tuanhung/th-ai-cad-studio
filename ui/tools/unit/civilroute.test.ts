// Route from CAD (long profile + cross sections) — run: UNIT=civilroute node tools/test-cam.mjs run [real.dxf]
//   run   the SYNTHETIC canal (qa/fixtures/civil/canal_route_SYNTHETIC.dxf) against its analytic truth; with a real
//         drawing as argument, a comparison of every section with the designer's written areas (no truth file)
import { decodeDxf, importDxf } from '../../src/cad/dxfImport'
import type { CadDocument } from '../../src/cad/types'
import { civilRuleRole, cutFill, findRoutes, volumes, type CivilRole } from '../../src/civil/fromCad'
import { buildCivilModel, typicalOf } from '../../src/civil/fromCadBuild'
import { createNorthCanal, earthwork, hydraulics } from '../../src/civil/model'
import { validateCivil } from '../../src/state/civil'
import { civilScene } from '../../src/civil/scene3d'

const proc = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(m: string): { readFileSync(p: string, enc: string): string } } }).process
const readFileSync = (p: string, enc: string) => proc.getBuiltinModule('node:fs').readFileSync(p, enc)
const FX = `${proc.cwd()}/../qa/fixtures/civil/`

function load(latin1: string): CadDocument {
  const bytes = new Uint8Array(latin1.length)
  for (let i = 0; i < latin1.length; i++) bytes[i] = latin1.charCodeAt(i)
  const r = importDxf(decodeDxf(bytes).text)
  return { id: 'u', name: 'u.dxf', entities: r.entities, layers: [], currentLayer: '0', underlay: null, blocks: [], dirty: false, createdAt: 0, savedAt: null, source: 'dxf-import' }
}
const rolesOf = (doc: CadDocument) => Object.fromEntries([...new Set(doc.entities.map((e) => e.layer))].map((l) => [l, civilRuleRole(l) ?? 'ignore'])) as Record<string, CivilRole>

export function run(file?: string) {
  const out: string[] = []
  let fails = 0
  const check = (name: string, ok: boolean, extra = '') => { if (!ok) fails++; out.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`) }

  // unit pieces
  check('layer rules', civilRuleRole('Mat dat tu nhien') === 'ground' && civilRuleRole('matcattunhien') === 'ground' && civilRuleRole('Thietke') === 'design' && civilRuleRole('TK2') === 'design' && civilRuleRole('Duong hien trang') === null && civilRuleRole('hatch vật liệu') === null && civilRuleRole('Thuoccaodo') === null)
  const sq = cutFill([[-5, 0], [5, 0]], [[-5, 1], [5, 1]])
  check('cutFill: 10 m × 1 m fill', Math.abs(sq.fill - 10) < 1e-6 && sq.cut === 0, JSON.stringify(sq))
  const tri = cutFill([[0, 0], [4, 2]], [[0, 1], [4, 1]])
  check('cutFill: crossing lines split into cut and fill (1 + 1 m²)', Math.abs(tri.cut - 1) < 1e-3 && Math.abs(tri.fill - 1) < 1e-3, JSON.stringify(tri))
  const typ = typicalOf([[-6, 2], [-4.375, 2], [-1.25, -1], [1.25, -1], [4.375, 2], [6, 2]])
  check('typical section from a design line (b = 2.5 m, m = 1.04)', !!typ && Math.abs(typ.b - 2.5) < 1e-6 && Math.abs(typ.m - 3.125 / 3) < 1e-3, JSON.stringify(typ))

  // the synthetic canal against its exact areas
  const truth = JSON.parse(readFileSync(FX + 'canal_route_SYNTHETIC.truth.json', 'utf8')) as { route: string; sections: { name: string; station: number; cut: number; fill: number; tableError: boolean; verticalTable: boolean }[]; volume: { cut: number; fill: number } }
  const doc = load(readFileSync(FX + 'canal_route_SYNTHETIC.dxf', 'latin1'))
  const routes = findRoutes(doc, rolesOf(doc))
  check('one route found from the long-profile table, named by its title', routes.length === 1 && routes[0].name === truth.route, routes.map((r) => r.name).join(' | '))
  const r = routes[0]
  check('4 stakes with stations, invert, existing ground, banks', r.stakes.length === 4 && r.stakes.every((k, i) => k.station === i * 50 && k.invert === -1 && k.leftDes === 2 && k.rightDes === 2 && k.ground !== undefined))
  check('every stake has its cross section', r.sections.length === 4 && !r.missing.length && !r.unmatched.length)
  for (const t of truth.sections) {
    const s = r.sections.find((x) => x.name === t.name)!
    check(`${t.name}: cut ${t.cut} / fill ${t.fill} m² (exact) within 0.005 m²`, Math.abs(s.cut - t.cut) < 0.005 && Math.abs(s.fill - t.fill) < 0.005, `${s.cut.toFixed(4)} / ${s.fill.toFixed(4)}; scale ${s.scale.h.toFixed(3)}/${s.scale.v.toFixed(3)} from ${s.map.vfit}`)
    if (t.tableError) check(`${t.name}: the table value off by 0.10 m is reported, the drawn line is used`, s.tableOff === 1 && Math.abs((s.tableDev ?? 0) - 0.1) < 0.005)
    if (t.verticalTable) check(`${t.name}: table written vertically is read`, s.map.vfit === 'table')
    check(`${t.name}: designer's areas read`, s.drawn?.cut === Math.round(t.cut * 100) / 100)
  }
  const v = volumes(r.sections)
  check(`volumes (average end areas): cut ${truth.volume.cut}, fill ${truth.volume.fill} m³ within 0.1 m³`, Math.abs(v.cut - truth.volume.cut) < 0.1 && Math.abs(v.fill - truth.volume.fill) < 0.1, `${v.cut.toFixed(2)} / ${v.fill.toFixed(2)}`)

  // the Civil model
  const m = buildCivilModel(createNorthCanal(), r, 'canal_route_SYNTHETIC.dxf')
  check('Civil model valid (model rules)', validateCivil(m) === null, validateCivil(m) ?? '')
  const ew = earthwork(m)
  const ewc = ew.reduce((a, x) => a + x.cut, 0), ewf = ew.reduce((a, x) => a + x.fill, 0)
  // the model keeps areas to 0.001 m²
  check('earthwork table = section volumes (rows per 100 m)', Math.abs(ewc - v.cut) < 0.05 && Math.abs(ewf - v.fill) < 0.05 && ew.length === 2, `${ewc.toFixed(2)} / ${ewf.toFixed(2)} in ${ew.length} rows`)
  check('typical section measured on the drawing (b 2.5 m)', Math.abs(m.params.bottomWidth - 2.5) < 0.01, `b ${m.params.bottomWidth}, m ${m.params.sideSlope}`)
  check('level bottom, no discharge in the drawing: no hydraulics invented', hydraulics(m).ok === false)
  const sc = civilScene(m, 3)
  check('3D corridor lofted from the drawn sections', sc.stats.terrain === 'drawing' && sc.stats.stations === 4 && sc.stats.triangles > 60, JSON.stringify(sc.stats))

  if (file) out.push(...real(file))
  out.push(fails ? `FAILED ${fails}` : 'ALL PASS')
  return out.join('\n')
}

/** Every section of a real drawing compared with the designer's written areas. */
function real(file: string): string[] {
  const doc = load(file)
  const lines: string[] = []
  for (const r of findRoutes(doc, rolesOf(doc))) {
    const v = volumes(r.sections)
    const close = r.sections.filter((s) => s.drawn?.cut !== undefined && Math.abs(s.cut - s.drawn.cut) <= 0.02 && Math.abs(s.fill - ((s.drawn.fill ?? 0) + (s.drawn.fillMachine ?? 0) + (s.drawn.fillManual ?? 0))) <= 0.02).length
    const within = (tol: number) => r.sections.filter((s) => s.drawn?.cut !== undefined && Math.abs(s.cut - s.drawn.cut) <= tol && Math.abs(s.fill - ((s.drawn.fill ?? 0) + (s.drawn.fillMachine ?? 0) + (s.drawn.fillManual ?? 0))) <= tol).length
    lines.push(`  ${r.name}: ${r.stakes.length} stakes, ${r.sections.length} sections (missing ${r.missing.length}); cut ${v.cut.toFixed(1)} / designer ${v.drawn?.cut.toFixed(1)} m³ (${v.drawn ? (((v.cut - v.drawn.cut) / v.drawn.cut) * 100).toFixed(2) : '—'} %), fill ${v.fill.toFixed(1)} / ${v.drawn?.fill.toFixed(1)} m³ (${v.drawn ? (((v.fill - v.drawn.fill) / v.drawn.fill) * 100).toFixed(2) : '—'} %); sections within 0.02 m²: ${close}, 0.10 m²: ${within(0.1)}, 0.30 m²: ${within(0.3)}; table ≠ line: ${r.sections.filter((s) => s.tableOff).length}; levels from the profile: ${r.sections.filter((s) => s.map.vfit !== 'table').length}`)
  }
  return lines
}
