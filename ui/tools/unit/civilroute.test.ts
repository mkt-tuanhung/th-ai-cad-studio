// Route from CAD (long profile + cross sections) — run: UNIT=civilroute node tools/test-cam.mjs run [real.dxf]
//   run   the SYNTHETIC canal (qa/fixtures/civil/canal_route_SYNTHETIC.dxf) against its analytic truth; with a real
//         drawing as argument, a comparison of every section with the designer's written areas (no truth file);
//         plus the synthetic cases of the review fixes (reviewCases, built in memory with hand-worked truths)
//   dump  real.dxf — every stake and section, one line each (DUMP_LINES=1 adds the lines): to compare two versions
import { decodeDxf, importDxf } from '../../src/cad/dxfImport'
import type { CadDocument } from '../../src/cad/types'
import { civilRuleRole, cutFill, findRoutes, routeHasDesign, stakeKey, stationOf, volumes, type CivilRole } from '../../src/civil/fromCad'
import { buildCivilModel, typicalOf } from '../../src/civil/fromCadBuild'
import { areasAt, bankDepth, checks, createNorthCanal, drawnSplit, earthwork, hydraulics, liningQuantities, typicalSlope } from '../../src/civil/model'
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

  reviewCases(check)

  if (file) out.push(...real(file))
  out.push(fails ? `FAILED ${fails}` : 'ALL PASS')
  return out.join('\n')
}

/* ---------------- synthetic drawings for the review fixes (qa/REVIEW_2026-10-18.md A1, A2, B1–B6, B9) ----------------
 * Built here in the style of make-route-fixtures.mjs (vertical 1:100 = 10 units per metre, the elevation table
 * under each section, the scale labels a few units below their ticks), each case with its truth worked out by
 * hand (rectangles and trapezoids), so the reader is checked against geometry, not against itself. */
type P = [number, number]
interface SecSpec {
  title: string
  ground: P[][]
  design: P[][]
  /** horizontal drawing units per metre (default 10, as the vertical) */
  kx?: number
  /** the area box: [label] (number inside it) or [label, value] */
  box?: string[][]
  /** no "Khoảng cách" row; `offsets`: a "Khoảng cách cộng dồn" row of offsets from the left end instead */
  noDist?: boolean
  offsets?: boolean
}
interface ProfSpec {
  title: string
  names: string[]
  /** station row values ("" = not written), else no station row */
  stations?: string[]
  /** "khoảng cách lẻ" values written between columns i and i + 1 */
  between?: string[]
  invert?: string[]
  /** a stray number in the invert row, written BEFORE the column's value and nearer the next column */
  strayInvert?: number
}
function makeDoc(prof: ProfSpec, secs: SecSpec[]): CadDocument {
  const entities: CadDocument['entities'] = []
  let id = 0
  const base = () => ({ id: `e${id++}`, color: 'ByLayer', linetype: 'ByLayer' as const, lineweight: 'ByLayer' as const, transparency: 0 })
  const line = (layer: string, x1: number, y1: number, x2: number, y2: number) => entities.push({ ...base(), kind: 'line', layer, a: { x: x1, y: y1 }, b: { x: x2, y: y2 } })
  const text = (layer: string, x: number, y: number, h: number, value: string) => entities.push({ ...base(), kind: 'text', layer, p: { x, y }, height: h, value, rotation: 0, align: 'left' })
  // long profile
  const x0 = 0, y0 = 1200, rowH = 24, pitch = 100
  text('0', x0 + 150, y0 + 260, 12, 'CẮT DỌC TUYẾN')
  text('Text', x0 + 150, y0 + 240, 7, prof.title)
  const rows: [string, (i: number) => string][] = [['tên cọc', (i) => prof.names[i]]]
  if (prof.stations) rows.push(['khoảng cách cộng dồn ( m )', (i) => prof.stations![i]])
  if (prof.between) rows.push(['khoảng cách lẻ ( m )', () => ''])
  if (prof.invert) rows.push(['Cao trình đáy kênh thiết kế', (i) => prof.invert![i]])
  rows.forEach(([label, f], r) => {
    const y = y0 + r * rowH
    text('Text', x0, y, 5, label)
    prof.names.forEach((_, i) => {
      if (label.startsWith('Cao trình đáy') && prof.strayInvert === i) text('Text', x0 + 200 + i * pitch + 0.4 * pitch, y, 5, '0.50')
      const v = f(i)
      if (v) text('Text', x0 + 200 + i * pitch, y, 5, v)
    })
    if (label.startsWith('khoảng cách lẻ')) prof.between!.forEach((v, i) => text('Text', x0 + 200 + (i + 0.5) * pitch - 0.3 * 5 * v.length, y, 5, v))
    line('khung', x0 - 5, y - 8, x0 + 200 + prof.names.length * pitch, y - 8)
  })
  // cross sections, two per column
  secs.forEach((k, i) => {
    const ox = Math.floor(i / 2) * 700, oy = -(i % 2) * 300
    const cx = ox + 200, datum = -3, K = 10, KX = k.kx ?? 10
    const Y = (z: number) => oy + (z - datum) * K, X = (o: number) => cx + o * KX
    text('tencoc', cx - 5, Y(5.5), 10, k.title)
    const bx = ox + 35
    for (let z = datum; z < 4.5; z += 0.5) line('Thuoccaodo', bx, Y(z), bx, Y(z + 0.5))
    for (const z of [-2, 0, 2, 4]) text('Thuoccaodo', ox + 12, Y(z) - 3.5, 5, z > 0 ? `+${z.toFixed(2)}` : z.toFixed(2))
    line('đường trục tâm', cx, Y(-1.5), cx, Y(4.6))
    text('text ghi chú', cx + 1.5, Y(4.4), 4, 'tim kênh tk')
    for (const g of k.ground) for (let j = 1; j < g.length; j++) line('Mat dat tu nhien', X(g[j - 1][0]), Y(g[j - 1][1]), X(g[j][0]), Y(g[j][1]))
    for (const d of k.design) for (let j = 1; j < d.length; j++) line('Thietke', X(d[j - 1][0]), Y(d[j - 1][1]), X(d[j][0]), Y(d[j][1]))
    text('Thuoccaodo', ox - 40, Y(datum) - 16, 5, 'Cao độ mặt đất tự nhiên')
    if (!k.noDist) text('Thuoccaodo', ox - 40, Y(datum) - 30, 5, 'Khoảng cách')
    if (k.offsets) text('Thuoccaodo', ox - 40, Y(datum) - 44, 5, 'Khoảng cách cộng dồn')
    text('Thuoccaodo', ox - 40, Y(datum) + 2, 5, 'Mức so sánh')
    const verts = k.ground.flat().sort((a, b) => a[0] - b[0]).filter((p, j, a) => !j || p[0] - a[j - 1][0] > 1e-9)
    verts.forEach(([o, z], j) => {
      line('duongdong', X(o), Y(datum), X(o), Y(z))
      text('caodo', X(o) + 2, Y(datum) - 18, 5, z.toFixed(2))
      if (j && !k.noDist) text('khoangcach', (X(o) + X(verts[j - 1][0])) / 2 - 5, Y(datum) - 32, 5, (o - verts[j - 1][0]).toFixed(2))
      if (k.offsets) text('khoangcach', X(o) + 2, Y(datum) - 46, 5, (o - verts[0][0]).toFixed(2))
    })
    if (k.box) {
      const bx2 = ox + 520, by = Y(4.5)
      text('1', bx2, by, 5, k.title)
      k.box.forEach(([label, v], r) => { text('text khao sat', bx2 + 5, by - 11 * (r + 1), 5, label); if (v) text('text khao sat', bx2 + 50, by - 11 * (r + 1), 5, v) })
    }
  })
  return { id: 'syn', name: 'review_SYNTHETIC.dxf', entities, layers: [], currentLayer: '0', underlay: null, blocks: [], dirty: false, createdAt: 0, savedAt: null, source: 'dxf-import' }
}

function reviewCases(check: (name: string, ok: boolean, extra?: string) => void) {
  const near = (a: number | undefined, b: number, tol = 0.005) => a !== undefined && Math.abs(a - b) <= tol
  // level ground at +1 surveyed every 3 m (as drawn: one elevation and one distance label per point)
  const flat1: P[] = Array.from({ length: 9 }, (_, i) => [-12 + 3 * i, 1] as P)
  const trap: P[] = [[-6, 1], [-3, -1], [3, -1], [6, 1]] // cut 18 m² under a level ground at +1

  // A1 + B3: a rectangular canal 3 m wide, 4 m below its banks, the banks drawn as separate lines (0.15 m apart);
  // a lined canal drawn with its inner and outer faces (lining 0.3 m)
  {
    const doc = makeDoc({ title: 'kênh thành đứng', names: ['C1', 'C2'], stations: ['0', '50'], invert: ['-2.00', '-0.30'] }, [
      { title: 'C1', ground: [[[-12, 2], [12, 2]]], design: [[[-8, 2], [-1.65, 2]], [[-1.5, 2], [-1.5, -2], [1.5, -2], [1.5, 2]], [[1.65, 2], [8, 2]]] },
      { title: 'C2', ground: [[[-12, 2.5], [12, 2.5]]], design: [[[-8, 2], [-1.8, 2], [-1.8, -0.3], [1.8, -0.3], [1.8, 2], [8, 2]], [[-1.5, 2], [-1.5, 0], [1.5, 0], [1.5, 2]]] },
    ])
    const r = findRoutes(doc, rolesOf(doc))[0]
    const c1 = r?.sections.find((s) => s.name === 'C1'), c2 = r?.sections.find((s) => s.name === 'C2')
    check('A1: rectangular canal, banks drawn apart — cut 12.00 m² (3 m × 4 m), walls kept vertical', !!c1 && near(c1.cut, 12, 0.01) && near(c1.fill, 0, 0.01) && c1.design.some(([o, z]) => o === -1.5 && z === -2) && c1.design.some(([o, z]) => o === -1.5 && z === 2), c1 ? `${c1.cut.toFixed(3)} / ${c1.fill.toFixed(3)} ${JSON.stringify(c1.design)}` : 'no section')
    check('A1: lined canal (inner + outer faces) — cut to the outer face 16.28 m², inner face kept as the channel', !!c2 && near(c2.cut, 16.28, 0.01) && !!c2.channel && c2.channel[1][1] === 0, c2 ? `${c2.cut.toFixed(3)}; channel ${JSON.stringify(c2.channel)}` : 'no section')
    const m = r ? buildCivilModel(createNorthCanal(), r, 'walls') : null
    check('B3: vertical walls give side slope 0, bottom width 3 m (lined: on the inner face)', !!m && m.params.sideSlope === 0 && m.params.bottomWidth === 3, m ? `b ${m.params.bottomWidth}, m ${m.params.sideSlope}` : '')
    const tv = typicalOf([[-6, 2], [-1.5, 2], [-1.5, 0], [1.5, 0], [1.5, 2], [6, 2]])
    check('B3: typicalOf on a vertical-wall line → b 3, m 0 (was 2.25)', !!tv && tv.b === 3 && tv.m === 0, JSON.stringify(tv))
    check('A1: 3D corridor lofts the vertical walls', !!m && civilScene(m, 1).stats.triangles > 0)
  }

  // B1 + B2 + B4 + B9 + nearest column: Km stations, varied stake names, an area box with a total and its breakdown,
  // a section at 1:200 across with an offsets row, a section with no distance labels
  {
    const doc = makeDoc({ title: 'đường mẫu Km', names: ['KM0', 'TĐ1', 'C 2', 'Cọc 3'], stations: ['Km0+000', 'Km0+050', 'KM0+100.00', 'Km 0+150,5'], invert: ['-1.00', '-1.00', '-1.00', '-1.00'], strayInvert: 2 }, [
      { title: 'KM0', ground: [flat1], design: [trap] },
      { title: 'TD1', ground: [flat1], design: [trap], box: [['S đào đất cấp II', '1.00'], ['S đào đất cấp III', '2.00'], ['S đất đắp = 6.00 m2'], ['S đất đắp bằng máy = 5.05 m2'], ['S đắp thủ công', '0.95']] },
      { title: 'C2', ground: [flat1], design: [trap], kx: 5, noDist: true, offsets: true },
      { title: 'C 3', ground: [flat1], design: [trap], noDist: true },
    ])
    check('B1: stationOf reads Km0+050, KM0+050.00, 0+050, 0+050.00, "Km 1+250,5", 1250.5', stationOf('Km0+050') === 50 && stationOf('KM0+050.00') === 50 && stationOf('0+050') === 50 && stationOf('0+050.00') === 50 && stationOf('Km 1+250,5') === 1250.5 && stationOf('1250.5') === 1250.5 && stationOf('C12') === null)
    check('B2: stakeKey: "C 12" = "C12" = "Cọc 12", TĐ1 = TD1', stakeKey('C 12') === 'C12' && stakeKey('Cọc 12') === 'C12' && stakeKey('c12') === 'C12' && stakeKey('TĐ1') === 'TD1' && stakeKey('NĐ1') === 'ND1')
    const r = findRoutes(doc, rolesOf(doc))[0]
    check('B1: Km-format stations read (0, 50, 100, 150.5)', !!r && r.stakes.map((k) => k.station).join() === '0,50,100,150.5', r?.stakes.map((k) => `${k.name}@${k.station}`).join(' '))
    check('B2: KM0 / TĐ1 / "C 2" / "Cọc 3" stakes matched to sections KM0 / TD1 / C2 / "C 3"', !!r && r.sections.length === 4 && !r.missing.length && !r.unmatched.length, r ? `${r.sections.map((s) => s.name).join(',')}; missing ${r.missing}; unmatched ${r.unmatched}` : '')
    check('profile values: the nearest column wins, not the first text', !!r && r.stakes[2]?.invert === -1, `invert at C2: ${r?.stakes[2]?.invert}`)
    const td = r?.sections.find((s) => stakeKey(s.name) === 'TD1')
    check('B4: area rows of one kind add up (cut 1.00 + 2.00), a total with its breakdown is not doubled (fill 6.00, machine 5.05, by hand 0.95)', !!td?.drawn && near(td.drawn.cut, 3, 1e-9) && near(td.drawn.fill, 6, 1e-9) && near(td.drawn.fillMachine, 5.05, 1e-9) && near(td.drawn.fillManual, 0.95, 1e-9), JSON.stringify(td?.drawn))
    const c2 = r?.sections.find((s) => s.name === 'C2'), c3 = r?.sections.find((s) => s.name === 'C3')
    check('B9: horizontal scale 1:200 from the offsets row (5 units/m), cut 18 m², no warning', !!c2 && near(c2.scale.h, 5, 0.01) && near(c2.cut, 18, 0.01) && !c2.warnings.length, c2 ? `${c2.scale.h} ${c2.cut.toFixed(3)} ${JSON.stringify(c2.warnings)}` : '')
    check('B9: no distance labels → horizontal scale = vertical, WARNED', !!c3 && c3.warnings.some((w) => w.kind === 'hScale' && w.from === 'assumed') && near(c3.cut, 18, 0.01), JSON.stringify(c3?.warnings))
    const k0 = r?.sections.find((s) => s.name === 'KM0')
    check('trapezoid at 1:100 with its "Khoảng cách" row: cut 18 m², no warning', !!k0 && near(k0.cut, 18, 0.01) && !k0.warnings.length, k0 ? `${k0.cut.toFixed(3)} ${JSON.stringify(k0.warnings)}` : '')
    // B5: the designer's split in the route model
    const m = r ? buildCivilModel(createNorthCanal(), r, 'km') : null
    const sec = m?.sections?.find((s) => stakeKey(s.name) === 'TD1')
    check('B5: the split by machine / by hand reaches the Civil model (sections[].drawn.fillMachine / fillManual)', near(sec?.drawn?.fillMachine, 5.05, 1e-9) && near(sec?.drawn?.fillManual, 0.95, 1e-9) && near(sec?.drawn?.fill, 6, 1e-9), JSON.stringify(sec?.drawn))
    check('B5: drawnSplit() gives a part only when every section with areas writes it', !!m && drawnSplit(m) !== null && drawnSplit(m)!.fillMachine === undefined, JSON.stringify(m && drawnSplit(m)))
  }

  // B1: a table with only "khoảng cách lẻ" (distances between stakes), accumulated into stations
  {
    const doc = makeDoc({ title: 'kênh khoảng cách lẻ', names: ['C1', 'C2', 'C3', 'C4'], between: ['50.00', '50.00', '60.00'], invert: ['-1.00', '-1.00', '-1.00', '-1.00'] }, [
      { title: 'C1', ground: [flat1], design: [trap], box: [['S đất đắp bằng máy', '5.00'], ['S đắp thủ công', '1.00'], ['S đào đất', '18.00']] },
      { title: 'C2', ground: [flat1], design: [trap], box: [['S đất đắp bằng máy', '4.00'], ['S đắp thủ công', '1.00'], ['S đào đất', '18.00']] },
    ])
    const r = findRoutes(doc, rolesOf(doc))[0]
    check('B1: distances only → stations 0, 50, 100, 160, flagged as accumulated', !!r && r.stakes.map((k) => k.station).join() === '0,50,100,160' && r.stakes.every((k) => k.stationFrom === 'distances'), r?.stakes.map((k) => `${k.name}@${k.station}`).join(' '))
    const v = r ? volumes(r.sections) : null
    check('B5: route totals of the designer\'s split (machine 225, by hand 50 m³ over 50 m)', !!v?.drawn && near(v.drawn.fillMachine, 225, 1e-6) && near(v.drawn.fillManual, 50, 1e-6) && near(v.drawn.fill, 275, 1e-6), JSON.stringify(v?.drawn))
  }

  // B6: a ground line broken in two pieces; a ground line shorter than the design
  {
    const doc = makeDoc({ title: 'kênh đất đứt', names: ['C1', 'C2'], stations: ['0', '50'], invert: ['-1.00', '-1.00'] }, [
      { title: 'C1', ground: [[...flat1.filter(([o]) => o < 0), [-0.25, 1]], [[0.25, 1], ...flat1.filter(([o]) => o > 0)]], design: [trap] },
      { title: 'C2', ground: [[...flat1.filter(([o]) => o < 4), [4, 1]]], design: [trap] },
    ])
    const r = findRoutes(doc, rolesOf(doc))[0]
    const c1 = r?.sections.find((s) => s.name === 'C1'), c2 = r?.sections.find((s) => s.name === 'C2')
    check('B6: broken ground line joined — cut 18 m² (one piece alone gives ≈ 9), warned with the 0.5 m bridged', !!c1 && near(c1.cut, 18, 0.01) && c1.warnings.some((w) => w.kind === 'groundJoined' && w.pieces === 2 && near(w.gap, 0.5, 0.01)), c1 ? `${c1.cut.toFixed(3)} ${JSON.stringify(c1.warnings)}` : '')
    check('B6: design 2 m beyond the drawn ground — the part over the ground computed (16.667 m²), the rest WARNED', !!c2 && near(c2.cut, 50 / 3, 0.01) && c2.warnings.some((w) => w.kind === 'groundShort' && w.left === 0 && near(w.right, 2, 0.01)), c2 ? `${c2.cut.toFixed(3)} ${JSON.stringify(c2.warnings)}` : '')
  }

  // A2: no design line (design layer not picked, no design row in the long profile)
  {
    const doc = makeDoc({ title: 'kênh không thiết kế', names: ['C1', 'C2'], stations: ['0', '50'] }, [
      { title: 'C1', ground: [flat1], design: [trap] },
      { title: 'C2', ground: [flat1], design: [trap] },
    ])
    const roles = { ...rolesOf(doc), Thietke: 'ignore' as CivilRole }
    const r = findRoutes(doc, roles)[0]
    check('A2: the route is read but has no design line (Approve is not offered)', !!r && r.sections.length === 2 && !routeHasDesign(r) && r.sections.every((s) => s.warnings.some((w) => w.kind === 'noDesign')))
    const m = r ? buildCivilModel(createNorthCanal(), r, 'nodesign') : null
    check('A2: validateCivil rejects a model without a design invert', !!m && m.invert.length === 0 && validateCivil(m) === 'Design invert', m ? String(validateCivil(m)) : '')
    // a broken model as stored before the fix (empty invert) must not crash any reader
    let crash = ''
    for (const bad of [m!, { ...createNorthCanal(), invert: [] as [number, number][] }, { ...createNorthCanal(), invert: [[0, 1]] as [number, number][] }]) {
      try {
        void typicalSlope(bad); void hydraulics(bad); void checks(bad); void earthwork(bad); void bankDepth(bad); void liningQuantities(bad); void civilScene(bad, 1); void areasAt(bad, 10, 1)
      } catch (e) { crash += String(e) + ' ' }
    }
    check('A2: every reader of the invert is safe on an empty / one-point invert (no TypeError)', !crash, crash)
  }
}

/** Every section of a real drawing compared with the designer's written areas. */
function real(file: string): string[] {
  const doc = load(file)
  const lines: string[] = []
  for (const r of findRoutes(doc, rolesOf(doc))) {
    const v = volumes(r.sections)
    const close = r.sections.filter((s) => s.drawn?.cut !== undefined && Math.abs(s.cut - s.drawn.cut) <= 0.02 && Math.abs(s.fill - (s.drawn.fill ?? 0)) <= 0.02).length
    const within = (tol: number) => r.sections.filter((s) => s.drawn?.cut !== undefined && Math.abs(s.cut - s.drawn.cut) <= tol && Math.abs(s.fill - (s.drawn.fill ?? 0)) <= tol).length
    lines.push(`  ${r.name}: ${r.stakes.length} stakes, ${r.sections.length} sections (missing ${r.missing.length}); cut ${v.cut.toFixed(1)} / designer ${v.drawn?.cut.toFixed(1)} m³ (${v.drawn ? (((v.cut - v.drawn.cut) / v.drawn.cut) * 100).toFixed(2) : '—'} %), fill ${v.fill.toFixed(1)} / ${v.drawn?.fill.toFixed(1)} m³ (${v.drawn ? (((v.fill - v.drawn.fill) / v.drawn.fill) * 100).toFixed(2) : '—'} %); sections within 0.02 m²: ${close}, 0.10 m²: ${within(0.1)}, 0.30 m²: ${within(0.3)}; table ≠ line: ${r.sections.filter((s) => s.tableOff).length}; levels from the profile: ${r.sections.filter((s) => s.map.vfit !== 'table').length}`)
  }
  return lines
}

/** Every stake and section of a real drawing, one line each (to compare two versions of the reader). */
export function dump(file?: string) {
  if (!file) return 'usage: UNIT=civilroute node tools/test-cam.mjs dump real.dxf'
  const doc = load(file)
  const lines: string[] = []
  for (const r of findRoutes(doc, rolesOf(doc))) {
    lines.push(`ROUTE ${r.name}: stakes ${r.stakes.map((k) => `${k.name}@${k.station}`).join(' ')}`)
    for (const s of r.sections) lines.push(`  ${s.name} @${s.station} cut ${s.cut.toFixed(3)} fill ${s.fill.toFixed(3)} drawn ${JSON.stringify(s.drawn)} scale ${s.scale.h.toFixed(3)}/${s.scale.v.toFixed(3)} ${s.map.vfit} g${s.ground.length} d${s.design.length}${(proc as unknown as { env: Record<string, string | undefined> }).env.DUMP_LINES ? ` G ${JSON.stringify(s.ground)} D ${JSON.stringify(s.design)}` : ''}${(s as { warnings?: unknown[] }).warnings?.length ? ` W ${JSON.stringify((s as { warnings?: unknown[] }).warnings)}` : ''}`)
    const m = buildCivilModel(createNorthCanal(), r, 'real')
    lines.push(`  model b ${m.params.bottomWidth} m ${m.params.sideSlope} invert ${m.invert.length} ground ${m.ground?.length}`)
  }
  return lines
}
