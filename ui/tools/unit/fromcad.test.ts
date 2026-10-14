// Plan → BIM recognition and model building (run: UNIT=fromcad node tools/test-cam.mjs run <file.dxf> [truth.json]).
//   run      the SYNTHETIC fixture against its ground truth (qa/fixtures/bim/house_vn_SYNTHETIC.truth.json),
//            the 30°-rotated copy against the same truth, unit checks of the text parsers and the layer rules
//   villa    recognition summary of another DXF (e.g. the VILLA_150 test set) for the QA notes
//   ifc      IFC 4 text of the model built from a DXF (checked with tools/check_ifc.py)
import { decodeDxf, importDxf } from '../../src/cad/dxfImport'
import type { CadDocument } from '../../src/cad/types'
import { dominantAngle, findFlights, findSpirals, findPlans, layerStats, norm, parseElevation, parseMark, parseSize, recognize, ruleRole, segsOf, type LayerRole } from '../../src/bim/fromCad'
import { balconiesAndVoids, buildBimModel, buildInterior, DEFAULT_BUILD, stairsFrom, type BuildNames } from '../../src/bim/fromCadBuild'
import { boq, openingSchedule, priceOf, readPrices } from '../../src/bim/quantities'
import { applyStructure, readStructure } from '../../src/bim/structure'
import { parseSlope, readRoofs, roofQuantities } from '../../src/bim/roof'
import { bimExtras } from '../../src/bim/scene'
import { autoEn } from '../../src/i18n/ws/auto'
import type { Entity } from '../../src/cad/types'
import { stairSection } from '../../src/auto/views'
import { runModelChecks, wallVolume } from '../../src/bim/model'
import { toIfc } from '../../src/bim/ifc'
import { validateInterior } from '../../src/state/interior'
import { cutList } from '../../src/interior/model'
import { layerGrammar, parseLayerRoles } from '../../src/ai/layerRoles'
import { fromCadEn } from '../../src/i18n/ws/fromCad'
import { autoVi } from '../../src/i18n/ws/auto'
import { viewRequests } from '../../src/auto/views'
import { planDocument } from '../../src/auto/drawings'

// the harness bundles for the browser: Node's fs is taken at run time (run from ui/)
const proc = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(m: string): { readFileSync(p: string, enc: string): string } } }).process
const readFileSync = (p: string, enc: string) => proc.getBuiltinModule('node:fs').readFileSync(p, enc)
const FX = `${proc.cwd()}/../qa/fixtures/bim/`

function load(latin1: string): CadDocument {
  const bytes = new Uint8Array(latin1.length)
  for (let i = 0; i < latin1.length; i++) bytes[i] = latin1.charCodeAt(i)
  const r = importDxf(decodeDxf(bytes).text)
  return { id: 'u', name: 'u.dxf', entities: r.entities, layers: [], currentLayer: '0', underlay: null, blocks: [], dirty: false, createdAt: 0, savedAt: null, source: 'dxf-import' }
}
const NAMES: BuildNames = {
  roofLevel: 'Roof', room: (n) => `Room ${n}`, wallExt: (t) => `Ext ${t}`, wallInt: (t) => `Int ${t}`, curtain: (t) => `CW ${t}`,
  door: 'Door', doubleDoor: 'Double door', opening: 'Opening', window: 'Window', furniture: fromCadEn.furniture,
}

function analyse(doc: CadDocument) {
  const roles = Object.fromEntries(layerStats(doc).map((s) => [s.name, s.role])) as Record<string, LayerRole>
  const plans = findPlans(doc, roles).filter((p) => p.kind !== 'other')
  const recs = plans.map((p) => recognize(doc, roles, p))
  const built = buildBimModel(recs.map((r, i) => ({ rec: r, levelName: r.region.levelName ?? `L${i + 1}`, elevation: r.region.elevation ?? i * 3300, roof: r.region.kind === 'roof' })), DEFAULT_BUILD, NAMES)
  return { roles, plans, recs, built }
}

export function run(file?: string) {
  const out: string[] = []
  let fails = 0
  const check = (name: string, ok: boolean, extra = '') => { if (!ok) fails++; out.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`) }

  // parsers and rules
  check('elevations', parseElevation('MẶT BẰNG TẦNG 2  +3.900') === 3900 && parseElevation('±0.000') === 0 && parseElevation('COS -0,450') === -450 && parseElevation('Phòng 12') === null)
  check('marks', parseMark('Đ1')?.kind === 'door' && parseMark('D-02')?.kind === 'door' && parseMark('S3')?.kind === 'window' && parseMark('CS1')?.kind === 'window' && parseMark('SD4')?.kind === 'door' && parseMark('PHÒNG') === null)
  check('sizes', JSON.stringify(parseSize('Đ1 900x2200')) === '[900,2200]' && JSON.stringify(parseSize('1200 X 1500')) === '[1200,1500]' && parseSize('12000') === null)
  check('norm', norm('Tường xây 220') === 'TUONG XAY 220' && norm('ĐÈN') === 'DEN')
  const rules: [string, LayerRole][] = [['TUONG', 'wall'], ['0-TUONG220', 'wall'], ['A-WALL-EXT', 'wall'], ['CUA', 'door'], ['CUA SO', 'window'], ['A-WINDOW', 'window'], ['COT', 'column'], ['TRUC', 'grid'],
    ['KICH THUOC', 'ignore'], ['A-DIMS', 'ignore'], ['NOI THAT', 'furniture'], ['TBVS', 'furniture'], ['TEN PHONG', 'room'], ['THANG MAY', 'ignore'], ['CAU THANG', 'stair'], ['CHU', 'text'], ['HATCH', 'ignore']]
  const bad = rules.filter(([n, r]) => ruleRole(n) !== r).map(([n, r]) => `${n}: ${ruleRole(n)} ≠ ${r}`)
  check('layer name rules (VN + EN)', !bad.length, bad.join(', '))
  const g = layerGrammar(['TUONG', 'A "B"'])
  check('AI grammar lists only real layers and roles', g.includes('"\\"TUONG\\""') && g.includes('"\\"wall\\""') && !g.includes('"\\"walls\\""'))
  check('AI reply parsing keeps known layers / roles only', JSON.stringify(parseLayerRoles('x {"layers":[{"name":"TUONG","role":"wall"},{"name":"X","role":"door"},{"name":"CUA","role":"roof"}]}', ['TUONG', 'CUA'])) === '{"TUONG":"wall"}')

  // the SYNTHETIC house against its ground truth
  const truth = JSON.parse(readFileSync(FX + 'house_vn_SYNTHETIC.truth.json', 'utf8')) as { floors: { title: string; elevation: number; doors: number; windows: number; rooms: { name: string; area: number }[]; columns: number; furniture: number; grids: string[] }[] }
  for (const [label, name] of [['straight', 'house_vn_SYNTHETIC.dxf'], ['rotated 30°', 'house_vn_rot30_SYNTHETIC.dxf']]) {
    const doc = load(readFileSync(FX + name, 'latin1'))
    const a = analyse(doc)
    check(`${label}: two floor plans with their titles`, a.plans.length === 2 && a.plans.every((p, i) => norm(p.title ?? '') === norm(truth.floors[i].title)), a.plans.map((p) => p.title).join(' | '))
    if (label !== 'straight') check(`${label}: main wall direction found`, Math.abs((dominantAngle(doc.entities.filter((e) => e.layer === 'TUONG').flatMap(segsOf)) * 180) / Math.PI - 30) < 0.01)
    a.recs.forEach((r, i) => {
      const t = truth.floors[i]
      const doors = r.openings.filter((o) => o.kind === 'door').length, wins = r.openings.filter((o) => o.kind === 'window').length
      check(`${label} floor ${i + 1}: elevation ${t.elevation}`, r.region.elevation === t.elevation)
      check(`${label} floor ${i + 1}: walls 220 / 110, ${t.doors} doors, ${t.windows} windows, no plain openings`, doors === t.doors && wins === t.windows && r.openings.every((o) => o.kind !== 'opening') && r.walls.every((w) => w.t === 220 || w.t === 110), `${r.walls.length} walls, ${doors} D, ${wins} W`)
      const rooms = r.rooms.map((x) => `${x.name}:${x.area}`).sort().join(', '), want = t.rooms.map((x) => `${x.name}:${x.area}`).sort().join(', ')
      check(`${label} floor ${i + 1}: rooms and areas exact`, rooms === want, rooms)
      check(`${label} floor ${i + 1}: ${t.columns} columns, ${t.furniture} furniture, grids`, r.columns.length === t.columns && r.furniture.length === t.furniture && t.grids.every((x) => r.grids.some((g2) => g2.label === x)))
      check(`${label} floor ${i + 1}: tags`, r.openings.filter((o) => o.mark).length === t.doors + t.windows)
      check(`${label} floor ${i + 1}: footprint 12 × 9 m`, !!r.footprint && Math.abs(Math.abs(r.footprint.reduce((s, p, k) => s + p[0] * r.footprint![(k + 1) % r.footprint!.length][1] - r.footprint![(k + 1) % r.footprint!.length][0] * p[1], 0) / 2) / 1e6 - 108) < 0.01)
    })
    const m = a.built.model
    check(`${label}: model aligned on grid 1/A, checks pass`, a.built.align.method === 'grid' && runModelChecks(m).every((c) => c.status === 'ok'), runModelChecks(m).map((c) => `${c.key}:${c.status}`).join(' '))
    const vol = m.walls.reduce((s, w) => s + wallVolume(m, w), 0)
    out.push(`  ${label}: ${m.walls.length} walls, wall volume ${vol.toFixed(3)} m³ (gross), ${m.slabs.length} slabs, ${m.components.length} components`)
    const int = buildInterior(m, 'L1', a.recs[0].furniture, a.built.align.origins[0], NAMES)
    check(`${label}: interior data valid (rooms, placed items, cabinets for the cut list)`, validateInterior({ rooms: int.rooms, items: int.items, cabinets: int.cabinets }) === null && int.rooms.length === 5 && int.cabinets.length === 4 && int.items.every((x) => x.at?.length === x.qty),
      `${int.items.length} items, cabinets ${int.cabinets.map((c) => `${c.name} ${c.w}×${c.d}×${c.h} (${cutList(c).reduce((s, p) => s + p.qty, 0)} parts)`).join('; ')}`)
    if (label === 'straight') out.push(`  straight wall volume used as reference: ${vol.toFixed(3)}`)
    // bill of quantities: masonry = gross wall volume − the openings in it; slabs, floors, doors, windows by count
    const W = autoEn.boq.words
    const B = boq(m, W)
    const sum = (f: (r: (typeof B)[number]) => boolean) => B.filter(f).reduce((a, r) => a + r.total, 0)
    const opVol = [...m.doors, ...m.windows].reduce((a, o) => { const w = m.walls.find((x) => x.id === o.hostWall)!; return a + (o.width * o.height * (m.wallTypes.find((t) => t.id === w.typeId)?.thickness ?? 0)) / 1e9 }, 0)
    const slabVol = m.slabs.reduce((a, x) => a + (Math.abs(x.outline.reduce((s2, p, i) => s2 + p[0] * x.outline[(i + 1) % x.outline.length][1] - x.outline[(i + 1) % x.outline.length][0] * p[1], 0)) / 2 / 1e6) * x.thickness / 1000, 0)
    const masonry = sum((r) => r.group === W.groups.masonry && r.unit === W.units.m3)
    check(`${label}: bill of quantities — masonry = gross − openings, slab concrete, floor = rooms, doors / windows counted`,
      Math.abs(masonry - (vol - opVol)) < 0.01 && Math.abs(sum((r) => r.item === W.items.slab || r.item === W.items.roof) - slabVol) < 0.01 && Math.abs(sum((r) => r.item === W.items.floor) - m.rooms.reduce((a, x) => a + x.area, 0)) < 0.01 && sum((r) => r.item === W.items.doors) === m.doors.length && sum((r) => r.item === W.items.windows) === m.windows.length && sum((r) => r.item === W.items.plasterOut) > 0,
      `masonry ${masonry.toFixed(3)} vs ${(vol - opVol).toFixed(3)}; ${B.map((r) => `${r.item} ${r.total.toFixed(2)} ${r.unit}`).join('; ')}`)
    const sch = openingSchedule(m)
    check(`${label}: door / window schedule — every opening counted once, by mark and size`, sch.reduce((a, e) => a + e.count, 0) === m.doors.length + m.windows.length && sch.every((e) => e.levels.length >= 1), sch.map((e) => `${e.mark}×${e.count}`).join(' '))
    // one command: elevations named by the grids they show (Vietnamese convention), sections 1-1 / 2-2 marked on the plans
    const titles = viewRequests(m, autoVi.viewWords).map((r) => r.title)
    check(`${label}: elevations named by their grids, sections 1-1 and 2-2`, /^Mặt đứng trục 1-\d+$/.test(titles[0]) && /^Mặt đứng trục A-[B-Z]$/.test(titles[1]) && /^Mặt đứng trục \d+-1$/.test(titles[2]) && /^Mặt đứng trục [B-Z]-A$/.test(titles[3]) && titles[4] === 'Mặt cắt 1-1' && titles[5] === 'Mặt cắt 2-2', titles.join(' | '))
    const plan = planDocument(m, 'L1', 'Mặt bằng tầng 1', [{ axis: 'y', at: 4500, label: '1' }, { axis: 'x', at: 6000, label: '2' }])
    check(`${label}: section cuts drawn on the floor plan (both ends, arrow, number)`, plan.entities.filter((e) => e.layer === 'A-SECT').length === 12 && plan.entities.filter((e) => e.kind === 'text' && (e.value === '1' || e.value === '2') && e.layer === 'A-ANNO-TEXT').length === 4)
  }
  stairChecks(check)
  edgeChecks(check)
  structureChecks(check)
  stairKindChecks(check)
  roofChecks(check)
  if (file) out.push(...villa(file).lines)
  out.push(fails ? `FAILED ${fails}` : 'ALL PASS')
  return out.join('\n')
}

/** Summary of another drawing (no truth file): per plan what was found, warnings, model checks. */
export function villa(file?: string) {
  const doc = load(file ?? '')
  const a = analyse(doc)
  const lines = a.recs.map((r) => `  ${r.region.title}: ${r.walls.length} walls (${[...new Set(r.walls.map((w) => w.t))].sort((x, y) => x - y).join('/')} mm), ${r.openings.filter((o) => o.kind === 'door').length} doors, ${r.openings.filter((o) => o.kind === 'window').length} windows, ${r.openings.filter((o) => o.kind === 'opening').length} openings, ${r.walls.filter((w) => w.curtain).length} curtain walls, ${r.rooms.length} rooms, ${r.columns.length} columns, ${r.furniture.length} furniture; ${r.warnings.map((w) => w.code + ('n' in w ? ` ${w.n}` : '')).join(', ') || 'no warnings'}`)
  lines.push(`  model: ${JSON.stringify(a.built.counts)}; checks ${runModelChecks(a.built.model).map((c) => `${c.key}:${c.status}`).join(' ')}`)
  lines.push(`  rooms ${a.recs.map((r) => r.rooms.map((x) => `${x.name ?? '?'} ${x.area}`).join(', ')).join(' || ')}`)
  return { lines }
}

export function ifc(file?: string) {
  const a = analyse(load(file ?? readFileSync(FX + 'house_vn_SYNTHETIC.dxf', 'latin1')))
  const r = toIfc(a.built.model, 'From CAD plan')
  return { text: r.text, counts: r.counts }
}

/** A U stair as Vietnamese plans draw it (the VILLA_150 set): two 1100 mm flights side by side with a 100 mm well,
 *  tread lines every 270 mm, the up arrow with its head, a start dot, and the break line on the lower plan. */
function uStairPlan(lower: boolean): Entity[] {
  let k = 0
  const base = { color: 'ByLayer', linetype: 'ByLayer', lineweight: 'ByLayer', transparency: 0, layer: 'A-STAIR' } as const
  const L = (ax: number, ay: number, bx: number, by: number): Entity => ({ ...base, id: `s${++k}`, kind: 'line', a: { x: ax, y: ay }, b: { x: bx, y: by } })
  const out: Entity[] = [L(8600, 7600, 8600, 10300), L(8700, 7600, 8700, 10300), L(7500, 10300, 9800, 10300)]
  // flight B (x 8700…9800) goes up +y; the lower plan shows it only to the cut (5 goings) with a zig-zag
  const nb = lower ? 6 : 11
  for (let i = 0; i < nb; i++) out.push(L(8700, 7600 + 270 * i, 9800, 7600 + 270 * i))
  if (lower) out.push(L(8700, 8935, 9150, 9205), L(9150, 9205, 9350, 8965), L(9350, 8965, 9800, 9235))
  out.push(L(9250, 7750, 9250, 8835), { ...base, id: `s${++k}`, kind: 'polyline', pts: [{ x: 9160, y: 8685 }, { x: 9250, y: 8835 }, { x: 9340, y: 8685 }], closed: false }, { ...base, id: `s${++k}`, kind: 'circle', c: { x: 9250, y: 7750 }, r: 50 })
  // flight A (x 7500…8600) comes back down −y to the upper floor: drawn on the upper plan
  if (!lower) {
    for (let i = 0; i < 11; i++) out.push(L(7500, 7600 + 270 * i, 8600, 7600 + 270 * i))
    out.push(L(8050, 10150, 8050, 7900), { ...base, id: `s${++k}`, kind: 'polyline', pts: [{ x: 7960, y: 8050 }, { x: 8050, y: 7900 }, { x: 8140, y: 8050 }], closed: false })
  }
  return out
}

function stairChecks(check: (name: string, ok: boolean, extra?: string) => void) {
  const lower = findFlights(uStairPlan(true)), upper = findFlights(uStairPlan(false))
  const fl = (f: ReturnType<typeof findFlights>[number]) => `${f.a.map((v) => Math.round(v))} run ${Math.round(f.run)} w ${Math.round(f.width)} lines ${f.lines} going ${Math.round(f.going)} up ${f.up}${f.broken ? ' broken' : ''}`
  check('stairs: the cut flight on the lower plan — 6 tread lines at 270 mm, up +y (arrow head), break line', lower.length === 1 && lower[0].lines === 6 && Math.round(lower[0].going) === 270 && lower[0].up === 1 && lower[0].broken && Math.round(lower[0].width) === 1100, lower.map(fl).join(' | '))
  check('stairs: the upper plan — both flights, 11 lines each, going opposite ways, the landing edge and stringers left out', upper.length === 2 && upper.every((f) => f.lines === 11 && !f.broken) && upper.some((f) => f.up === 1) && upper.some((f) => f.up === -1), upper.map(fl).join(' | '))
  // a two-storey building: plan 1 (lower) and plan 2 (upper), 3900 mm apart
  const rec = (flights: ReturnType<typeof findFlights>) => ({ flights } as unknown as Parameters<typeof stairsFrom>[0][number]['rec'])
  const levels = [{ id: 'L1', name: 'Tầng 1', elevation: 0 }, { id: 'L2', name: 'Tầng 2', elevation: 3900 }, { id: 'L3', name: 'Mái', elevation: 7500 }]
  const wall = { id: 'W1', category: 'wall', mark: 'W1', typeId: 'I200', baseLevel: 'L1', baseOffset: 0, topLevel: 'L2', topOffset: 0, length: 4000, x: 7000, y: 11600, angle: 0 } as const
  const types = new Map([['I200', { id: 'I200', family: 'Basic Wall', name: 'Int 200', thickness: 200, structure: '', finishExt: '', finishInt: '', description: '' }]])
  const slabs = [{ id: 'S1', category: 'slab', mark: 'S1', kind: 'floor', level: 'L1', offset: 0, thickness: 120, outline: [[0, 0], [10000, 0], [10000, 15000], [0, 15000]] }, { id: 'S2', category: 'slab', mark: 'S2', kind: 'floor', level: 'L2', offset: 0, thickness: 120, outline: [[0, 0], [10000, 0], [10000, 15000], [0, 15000]] }] as Parameters<typeof stairsFrom>[5]
  const picks = [{ rec: rec(lower), levelName: 'Tầng 1', elevation: 0, roof: false }, { rec: rec(upper), levelName: 'Tầng 2', elevation: 3900, roof: false }]
  // the stair hall: walls on both outer sides of the flights (x 7400 and 9900) and beyond the landing
  const side = (id: string, x: number) => ({ ...wall, id, mark: id, x, y: 7000, length: 4600, angle: 90 })
  const { stairs, landings, railings } = stairsFrom(picks, [[0, 0], [0, 0]], levels, [wall, side('W2', 7400), side('W3', 9900)], types, slabs)
  const [f1, f2] = stairs
  check('stairs: a U stair for the storey — flight 1 up +y from the floor, flight 2 back from the landing, 22 risers of 177 mm', stairs.length === 2 && f1.angle === 90 && f1.x === 9250 && f1.y === 7600 && f1.risers === 11 && f1.baseOffset === 0 && f2.angle === -90 && f2.x === 8050 && f2.y === 10300 && f2.baseOffset === 1950 && f2.risers === 11 && Math.abs((f1.rise ?? 0) / 11 - 177.3) < 0.1, JSON.stringify(stairs.map((x) => [x.x, x.y, x.angle, x.baseOffset, x.rise, x.risers])))
  const ld = landings[0]
  const ys = ld ? ld.outline.map((q) => q[1]) : []
  check('stairs: the landing at the top of flight 1, across both flights, up to the wall face beyond (1200 mm deep)', landings.length === 1 && !!ld.landing && ld.offset === 1950 && Math.min(...ys) === 10300 && Math.max(...ys) === 11500, JSON.stringify(ld))
  check('stairs: the stair well cut through the floor above only', !slabs[0].openings && slabs[1].openings?.length === 1, JSON.stringify(slabs[1].openings))
  const inner = railings.find((r) => r.level === 'L1'), guard = railings.find((r) => r.level === 'L2')
  const r = (f1?.rise ?? 0) / 11
  check('stairs: railings — the inner rail up flight 1, round the landing, up flight 2 (900 mm, parallel to the nosings); none along the walls', railings.length === 2 && !!inner && inner.height === 900 && inner.pts.length === 6 && inner.pts.every((q) => q[0] === 8750 || q[0] === 8550) && JSON.stringify(inner.z) === JSON.stringify([r, 1950, 1950, 1950 + r, 3900, 3900].map((v) => Math.round(v * 10) / 10)), JSON.stringify(railings.map((x) => [x.level, x.height, x.pts, x.z])))
  check('stairs: the guard rail on the top floor across the open edge of the well over flight 1 (1000 mm), stopping at the wall', !!guard && guard.height === 1000 && JSON.stringify(guard.pts) === JSON.stringify([[8700, 7550], [9750, 7550]]), JSON.stringify(guard))
  // the section of the drawing set goes along flight 1 and looks towards flight 2
  const m = { levels, stairs, walls: [], slabs: [], rooms: [], grids: [] } as unknown as Parameters<typeof stairSection>[0]
  const sec = stairSection(m)
  check('stairs: section 1-1 along flight 1 (x = 9250), looking towards flight 2 (−x)', !!sec && sec.axis === 'x' && sec.at === 9250 && sec.face === 'right', JSON.stringify(sec))
}

/** A balcony with no parapet drawn, a void named as one, and a parapet wall split around the door in it. */
function edgeChecks(check: (name: string, ok: boolean, extra?: string) => void) {
  const levels = [{ id: 'L1', name: 'Tầng 1', elevation: 0 }, { id: 'L2', name: 'Tầng 2', elevation: 3600 }, { id: 'L3', name: 'Mái', elevation: 7200 }]
  const types = new Map([['E200', { id: 'E200', family: 'Basic Wall', name: 'Ext 200', thickness: 200, structure: '', finishExt: '', finishInt: '', description: '' }]])
  const wall = (id: string, x: number, y: number, length: number, angle: number) => ({ id, category: 'wall' as const, mark: id, typeId: 'E200', baseLevel: 'L2', baseOffset: 0, topLevel: 'L3', topOffset: 0, length, x, y, angle })
  // the building 10 × 8 m; its front wall on y = 0; a 4 × 1.4 m balcony in front (no wall drawn on its edges)
  const walls = [wall('W1', 0, 0, 10000, 0), wall('W2', 10000, 0, 8000, 90), wall('W3', 10000, 8000, 10000, 180), wall('W4', 0, 8000, 8000, 270)]
  const fp: [number, number][] = [[0, 0], [10000, 0], [10000, 8000], [0, 8000]]
  const slabs = [{ id: 'S2', category: 'slab', mark: 'S2', kind: 'floor', level: 'L2', offset: 0, thickness: 120, outline: fp }] as Parameters<typeof balconiesAndVoids>[4]
  const rooms = [
    { id: 'r1', category: 'room', number: '201', name: 'BAN CÔNG', level: 'L2', area: 5.6, outline: [[3000, -1400], [7000, -1400], [7000, 0], [3000, 0]] },
    { id: 'r2', category: 'room', number: '202', name: 'Ô THÔNG TẦNG', level: 'L2', area: 6, outline: [[1000, 2000], [4000, 2000], [4000, 4000], [1000, 4000]] },
    { id: 'r3', category: 'room', number: '203', name: 'PHÒNG NGỦ', level: 'L2', area: 30, outline: [[5000, 1000], [9000, 1000], [9000, 7000], [5000, 7000]] },
  ] as Parameters<typeof balconiesAndVoids>[1]
  const res = balconiesAndVoids(levels, rooms, walls, types, slabs, 120, 'Ô thông tầng', new Set(), [])
  const bal = res.railings.filter((r) => r.height === 1100), vd = res.railings.filter((r) => r.height === 1000)
  const pts = bal[0]?.pts ?? []
  check('balcony without a parapet drawn: its own slab, one guard rail 1.1 m round its three open edges (50 mm in), none along the facade', res.slabs.length === 1 && bal.length === 1 && pts.length === 4 && JSON.stringify(pts) === JSON.stringify([[3050, -50], [3050, -1350], [6950, -1350], [6950, -50]]), JSON.stringify(res.railings))
  check('void: the floor slab cut out under it, flagged, a guard rail 1 m round it', !!rooms[1].void && slabs[0].openings?.length === 1 && vd.length === 1 && vd[0].pts.length === 5, JSON.stringify(vd))
  // a parapet drawn as a wall on the balcony edge, running on past it with a door in the rest
  const w5 = { ...wall('W5', 0, -1400, 10000, 0) }
  const door = { id: 'd1', category: 'door', mark: 'D1', family: 'Door', type: '', hostWall: 'W5', offset: 8000, width: 900, height: 2100, sill: 0 } as Parameters<typeof balconiesAndVoids>[8][number]
  const walls2 = [...walls.map((x) => ({ ...x })), w5]
  const rooms2 = rooms.map((r) => ({ ...r, void: undefined }))
  balconiesAndVoids(levels, rooms2, walls2, types, [{ ...slabs[0], openings: undefined }], 120, 'Ô thông tầng', new Set(), [door])
  const par = walls2.filter((x) => x.id.startsWith('W5'))
  // unnamed: a room outside the footprint above the ground floor is a balcony; a crossed room a void
  const rooms3 = [
    { id: 'u1', category: 'room', number: '211', name: 'Room 11', level: 'L2', area: 5.6, outline: [[3000, -1400], [7000, -1400], [7000, 0], [3000, 0]] },
    { id: 'u2', category: 'room', number: '212', name: 'Room 12', level: 'L2', area: 6, outline: [[1000, 2000], [4000, 2000], [4000, 4000], [1000, 4000]], void: true },
  ] as Parameters<typeof balconiesAndVoids>[1]
  const sl3 = [{ ...slabs[0], openings: undefined }] as Parameters<typeof balconiesAndVoids>[4]
  const r3 = balconiesAndVoids(levels, rooms3, walls.map((x) => ({ ...x })), types, sl3, 120, 'Ô thông tầng', new Set(['u1', 'u2']), [], 'Ban công')
  check('unnamed rooms: outside the footprint → a balcony (slab, guard rail, named); crossed corner to corner → a void (slab cut, guard rail)', rooms3[0].name === 'Ban công' && r3.slabs.length === 1 && r3.railings.some((r) => r.height === 1100) && rooms3[1].name === 'Ô thông tầng' && !!rooms3[1].void && sl3[0].openings?.length === 1 && r3.railings.some((r) => r.height === 1000), JSON.stringify({ n: rooms3.map((r) => r.name), rails: r3.railings.map((r) => r.height) }))
  check('parapet: the wall along the balcony edge is split — that stretch 1.1 m high, the rest (with its door) a storey', par.length === 3 && par.some((x) => x.topLevel === 'L2' && x.topOffset === 1100 && x.length === 4000) && par.filter((x) => x.topLevel === 'L3').length === 2 && door.hostWall !== 'W5' && door.offset === 1000, JSON.stringify(par.map((x) => [x.id, x.x, x.length, x.topLevel, x.topOffset])) + ' door ' + door.hostWall + ' @' + door.offset)
}

/** A structural drawing as the VILLA_150 set draws it, in code: a foundation plan and a floor beam plan, each with
 *  its grids 1 / A offset from the model's, tags, levels written in the titles and texts. */
function structureChecks(check: (name: string, ok: boolean, extra?: string) => void) {
  let k = 0
  const base = (layer: string) => ({ color: 'ByLayer', linetype: 'ByLayer', lineweight: 'ByLayer', transparency: 0, layer, id: `e${++k}` }) as const
  const L = (layer: string, ax: number, ay: number, bx: number, by: number): Entity => ({ ...base(layer), kind: 'line', a: { x: ax, y: ay }, b: { x: bx, y: by } })
  const R = (layer: string, x0: number, y0: number, x1: number, y1: number): Entity => ({ ...base(layer), kind: 'polyline', closed: true, pts: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] })
  const Tx = (layer: string, x: number, y: number, value: string, height = 200): Entity => ({ ...base(layer), kind: 'text', p: { x, y }, height, value, rotation: 0, align: 'left' })
  const plan = (ox: number, title: string, body: Entity[]): Entity[] => [
    // grids 1 (x = ox) and 2 (x = ox + 6000), A (y = 0) and B (y = 5000), labelled at their ends
    L('S-GRID', ox, -2000, ox, 7000), Tx('S-GRID', ox, 7300, '1', 350), L('S-GRID', ox + 6000, -2000, ox + 6000, 7000), Tx('S-GRID', ox + 6000, 7300, '2', 350),
    L('S-GRID', ox - 2000, 0, ox + 8000, 0), Tx('S-GRID', ox + 8300, 0, 'A', 350), L('S-GRID', ox - 2000, 5000, ox + 8000, 5000), Tx('S-GRID', ox + 8300, 5000, 'B', 350),
    ...body, Tx('S-TEXT', ox + 2000, -3500, title, 380),
  ]
  const ents: Entity[] = [
    ...plan(0, 'MẶT BẰNG MÓNG + GIẰNG MÓNG', [
      R('S-FOUND', -300, -675, 300, 675), R('S-PILE', -125, -500, 125, -250), R('S-PILE', -125, 250, 125, 500), Tx('S-TAG', -250, 750, 'M1 (2 cọc)'),
      L('S-TIE', 300, -125, 5700, -125), L('S-TIE', 300, 125, 5700, 125), Tx('S-TAG', 2500, 200, 'GM 250×450'),
      Tx('S-TEXT', 2000, 2500, 'ĐÁY ĐÀI -1.600'),
    ]),
    Tx('S-LEVEL', -1800, -9000, '-0.950 ĐỈNH ĐÀI'),
    ...plan(20000, 'MẶT BẰNG KẾT CẤU SÀN TẦNG 2  (MẶT SÀN KC +3.550)', [
      L('S-BEAM', 20000, -110, 26000, -110), L('S-BEAM', 20000, 110, 26000, 110), Tx('S-TAG', 22000, 150, 'D2-1 220x400'),
      L('S-BEAM', 20000, 4890, 26000, 4890), L('S-BEAM', 20000, 5110, 26000, 5110),
      R('S-SLAB', 20000, 0, 26000, 5000), Tx('S-TAG', 21000, 2000, 'S1'), Tx('S-TAG', 21000, 1800, 'h=150'),
      R('S-OPEN', 23000, 1000, 24000, 2500),
    ]),
  ]
  const doc = { id: 's', name: 's.dxf', entities: ents, layers: [], currentLayer: '0', underlay: null, blocks: [], dirty: false, createdAt: 0, savedAt: null, source: 'dxf-import' } as unknown as CadDocument
  // the model: grids 1 / A through (1000, 2000); levels; a floor slab on Tầng 2; a column at 1 / A
  const m = { levels: [{ id: 'L1', name: 'Tầng 1', elevation: 0 }, { id: 'L2', name: 'Tầng 2', elevation: 3600 }], wallTypes: [], walls: [], doors: [], windows: [], rooms: [], columns: [{ id: 'C1', category: 'column', mark: 'C1', level: 'L1', topLevel: 'L2', x: 1000, y: 2000, w: 250, d: 250 }], slabs: [{ id: 'S2', category: 'slab', mark: 'S2', kind: 'floor', level: 'L2', offset: 0, thickness: 120, outline: [[1000, 2000], [7000, 2000], [7000, 7000], [1000, 7000]] }], stairs: [], railings: [], components: [], annotations: [],
    grids: [{ id: 'g1', category: 'grid', label: '1', a: [1000, 0], b: [1000, 9000] }, { id: 'g2', category: 'grid', label: 'A', a: [0, 2000], b: [9000, 2000] }] } as unknown as Parameters<typeof readStructure>[1]
  const s = readStructure(doc, m, ['1', 'A'])
  const beam = s.beams.find((b) => !b.tie && b.mark === 'D2-1'), other = s.beams.find((b) => !b.tie && b.mark !== 'D2-1'), tie = s.beams.find((b) => b.tie), cap = s.footings[0]
  check('structure: two plans found, levels from their titles (foundation → the ground floor, "SÀN TẦNG 2" → Tầng 2)', s.plans.length === 2 && s.plans.some((p) => p.kind === 'foundation' && p.level === 'L1') && s.plans.some((p) => p.kind === 'floor' && p.level === 'L2' && p.elevation === 3550), JSON.stringify(s.plans.map((p) => [p.kind, p.level, p.elevation])))
  check('structure: placed on the model by grid 1 / A; beam D2-1 220×400 from its tag, its top 50 mm under the level (KC +3.550)', !!beam && beam.x === 1000 && beam.y === 2000 && beam.length === 6000 && beam.b === 220 && beam.h === 400 && beam.topOffset === -50, JSON.stringify(beam))
  check('structure: an untagged beam takes h of the tagged ones of its width (flagged)', !!other && other.h === 400 && !!other.assumedH && other.y === 7000, JSON.stringify(other))
  check('structure: pile cap M1 600×1350 with its 2 piles 250, top −0.950 / bottom −1.600; tie beam GM 250×450 at the caps\' top', s.footings.length === 1 && cap.mark === 'M1' && cap.w === 600 && cap.d === 1350 && cap.piles === 2 && cap.pileSize === 250 && cap.top === -950 && cap.bottom === -1600 && cap.x === 1000 && cap.y === 2000 && !!tie && tie.b === 250 && tie.h === 450 && tie.topOffset === -950, JSON.stringify({ cap, tie }))
  const m2 = applyStructure(m, s)
  const sl = m2.slabs[0]
  check('structure: slab thickness h=150 and its opening taken onto the model', sl.thickness === 150 && sl.openings?.length === 1 && JSON.stringify(sl.openings[0]) === JSON.stringify([[4000, 3000], [5000, 3000], [5000, 4500], [4000, 4500]]) && s.warnings.length === 0, JSON.stringify({ sl, w: s.warnings }))
  // the bill of quantities: the beam under the slab only, between the column faces
  const W = autoEn.boq.words
  const B = boq(m2, W)
  const bv = B.find((r) => r.key === 'beam')?.total ?? 0
  const exp = (0.22 * (0.4 - 0.15) * (6 - 0.125)) + (0.22 * (0.4 - 0.15) * 6)
  check('structure: beam concrete = b × (h − slab) × clear span (minus half the column at 1 / A)', Math.abs(bv - exp) < 1e-6 && (B.find((r) => r.key === 'footing')?.total ?? 0) > 0.52 && (B.find((r) => r.key === 'piles:250')?.total ?? 0) === 2 && (B.find((r) => r.key === 'rebar:beam')?.total ?? 0) > 0, `${bv} vs ${exp}`)
  const P = readPrices('Mã,Hạng mục,Đơn vị,Đơn giá\nbeam,Dầm,m³,"1.250.000"\n,Cột,m³,900000\n')
  check('prices: a CSV list read by key or by item text ("1.250.000" thousands)', priceOf(P, B.find((r) => r.key === 'beam')!) === 1250000 && P.get('item:cột') === 900000, JSON.stringify([...P]))
}

/** An L stair with winders in its corner, and a spiral stair, as plans draw them. */
function stairKindChecks(check: (name: string, ok: boolean, extra?: string) => void) {
  let k = 0
  const base = { color: 'ByLayer', linetype: 'ByLayer', lineweight: 'ByLayer', transparency: 0, layer: 'CAU THANG' } as const
  const L = (ax: number, ay: number, bx: number, by: number): Entity => ({ ...base, id: `l${++k}`, kind: 'line', a: { x: ax, y: ay }, b: { x: bx, y: by } })
  // flight 1 along +x (y 0…1000), 8 treads x 0…1890; the corner square x 1890…2890; flight 2 along +y (x 1890…2890) from y 1000, 8 treads
  const lPlan: Entity[] = []
  for (let i = 0; i < 8; i++) lPlan.push(L(270 * i, 0, 270 * i, 1000))
  for (let i = 0; i < 8; i++) lPlan.push(L(1890, 1000 + 270 * i, 2890, 1000 + 270 * i))
  // winders: two slanted lines in the corner
  lPlan.push(L(1890, 1000, 2890, 0), L(1890, 1000, 2400, 0))
  const lf = findFlights(lPlan)
  const rec = (flights: ReturnType<typeof findFlights>, extra: object = {}) => ({ flights, ...extra } as unknown as Parameters<typeof stairsFrom>[0][number]['rec'])
  const levels = [{ id: 'L1', name: 'Tầng 1', elevation: 0 }, { id: 'L2', name: 'Tầng 2', elevation: 3000 }]
  const diag: [number, number][] = [[2390, 500], [2145, 500]]
  const picks = [{ rec: rec(lf, { stairDiagonals: diag }), levelName: 'Tầng 1', elevation: 0, roof: false }, { rec: rec(lf), levelName: 'Tầng 2', elevation: 3000, roof: false }]
  const r = stairsFrom(picks, [[0, 0], [0, 0]], levels, [], new Map(), [])
  const [f1, f2] = r.stairs
  check('L stair: two flights at right angles, a square landing in the corner, winders noted', lf.length === 2 && r.stairs.length === 2 && r.landings.length === 1 && !!f1 && !!f2 && Math.abs(Math.abs(f1.angle - f2.angle) - 90) < 1e-6 && f2.baseOffset === f1.rise && r.notes.some((n) => n.startsWith('winders')), JSON.stringify({ st: r.stairs.map((x) => [x.x, x.y, x.angle, x.baseOffset, x.rise, x.risers]), ld: r.landings.map((x) => x.outline), notes: r.notes }))
  // spiral: newel r 100, treads to r 1000, 12 lines over 270°
  const sp: Entity[] = [{ ...base, id: 'c0', kind: 'circle', c: { x: 5000, y: 5000 }, r: 100 }, { ...base, id: 'c1', kind: 'circle', c: { x: 5000, y: 5000 }, r: 1000 }]
  for (let i = 0; i < 12; i++) { const a = (i * (270 / 11) * Math.PI) / 180; sp.push(L(5000 + Math.cos(a) * 100, 5000 + Math.sin(a) * 100, 5000 + Math.cos(a) * 1000, 5000 + Math.sin(a) * 1000)) }
  const sps = findSpirals(sp)
  check('spiral: centre, radii, 12 tread lines over 270° found; no straight flight made of them', sps.length === 1 && Math.abs(sps[0].c[0] - 5000) < 1 && Math.abs(sps[0].r0 - 100) < 2 && Math.abs(sps[0].r1 - 1000) < 2 && sps[0].lines === 12 && Math.abs((Math.abs(sps[0].sweep) * 180) / Math.PI - 270) < 1, JSON.stringify(sps))
  const rs = stairsFrom([{ rec: rec([], { spirals: sps }), levelName: 'Tầng 1', elevation: 0, roof: false }, { rec: rec([], { spirals: sps }), levelName: 'Tầng 2', elevation: 3000, roof: false }], [[0, 0], [0, 0]], levels, [], new Map(), [])
  const ss = rs.stairs[0]
  check('spiral: built as a spiral stair for the storey (risers from the storey), an outer rail rising with it', rs.stairs.length === 1 && !!ss.spiral && ss.risers === Math.ceil(3000 / 180) && rs.railings.length === 1 && rs.railings[0].z![rs.railings[0].z!.length - 1] === 3000, JSON.stringify({ ss, rail: rs.railings[0]?.pts.length }))
}

/** Roof plans: a hip roof with its slope in %, a gable one found by its ridge running end to end. */
function roofChecks(check: (name: string, ok: boolean, extra?: string) => void) {
  let k = 0
  const base = (layer: string) => ({ color: 'ByLayer', linetype: 'ByLayer', lineweight: 'ByLayer', transparency: 0, layer, id: `r${++k}` }) as const
  const L = (layer: string, ax: number, ay: number, bx: number, by: number): Entity => ({ ...base(layer), kind: 'line', a: { x: ax, y: ay }, b: { x: bx, y: by } })
  const R = (layer: string, x0: number, y0: number, x1: number, y1: number): Entity => ({ ...base(layer), kind: 'polyline', closed: true, pts: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] })
  const Tx = (layer: string, x: number, y: number, value: string, height = 250): Entity => ({ ...base(layer), kind: 'text', p: { x, y }, height, value, rotation: 0, align: 'left' })
  const grids = (ox: number) => [L('TRUC', ox, -1000, ox, 9000), Tx('TRUC', ox, 9300, '1', 350), L('TRUC', ox - 1000, 0, ox + 13000, 0), Tx('TRUC', ox + 13300, 0, 'A', 350)]
  // 1: hip, 12 × 8 m eaves (500 mm past the walls), slope i = 35 %; 2: gable 12 × 8 m with its ridge drawn end to end
  const ents: Entity[] = [
    ...grids(0), R('MAI', -500, -500, 11500, 7500), Tx('MAI', 3000, 2000, 'MÁI DỐC i = 35%'), Tx('CHU', 3000, -3000, 'MẶT BẰNG MÁI', 400),
    ...grids(40000), R('MAI', 39500, -500, 51500, 7500), L('MAI', 39500, 3500, 51500, 3500), Tx('MAI', 43000, 2000, 'độ dốc 30°'), Tx('CHU', 43000, -3000, 'MẶT BẰNG MÁI', 400),
  ]
  const doc = { id: 'r', name: 'r.dxf', entities: ents, layers: [], currentLayer: '0', underlay: null, blocks: [], dirty: false, createdAt: 0, savedAt: null, source: 'dxf-import' } as unknown as CadDocument
  const m = { levels: [{ id: 'L1', name: 'Tầng 1', elevation: 0 }, { id: 'L2', name: 'Mái', elevation: 7000 }], wallTypes: [], walls: [], doors: [], windows: [], rooms: [], columns: [], slabs: [], stairs: [], railings: [], components: [], annotations: [],
    grids: [{ id: 'g1', category: 'grid', label: '1', a: [0, -1000], b: [0, 9000] }, { id: 'g2', category: 'grid', label: 'A', a: [-1000, 0], b: [13000, 0] }] } as unknown as Parameters<typeof readRoofs>[1]
  const rr = readRoofs(doc, m, ['1', 'A'])
  const [hip, gable] = rr.roofs
  check('roof slope words: "i = 35%", "độ dốc 30°"', Math.abs((parseSlope('MÁI DỐC i = 35%') ?? 0) - 19.29) < 0.01 && parseSlope('độ dốc 30°') === 30 && parseSlope('MẶT BẰNG MÁI') === null)
  check('roof plans: a hip roof (slope written, no ridge end to end) and a gable one (its ridge drawn end to end), placed by grid 1 / A, eaves on the top level', rr.roofs.length === 2 && hip.kind === 'hip' && gable.kind === 'gable' && hip.level === 'L2' && JSON.stringify(hip.outline) === JSON.stringify([[-500, -500], [11500, -500], [11500, 7500], [-500, 7500]]) && JSON.stringify(gable.outline) === JSON.stringify(hip.outline) && rr.warnings.length === 0, JSON.stringify(rr))
  // a flat roof with its drainage fall written: no pitched roof
  const flat = readRoofs({ ...doc, entities: [...grids(0), { ...ents[4] }, Tx('MAI', 3000, 2000, 'SÀN MÁI BTCT, dốc thoát nước i = 2%'), ents[6]] } as CadDocument, m, ['1', 'A'])
  check('roof: a drainage fall (i = 2%) is a flat roof, not a pitched one', flat.roofs.length === 0, JSON.stringify(flat))
  const qh = roofQuantities(hip), qg = roofQuantities(gable)
  check('roof quantities: covering = plan area / cos(slope); hip ridge L − W, 4 hips; gable ridge L, 2 gable walls', Math.abs(qh.area - 96 / Math.cos((hip.slope * Math.PI) / 180)) < 1e-6 && Math.abs(qh.ridge - 4) < 1e-9 && qh.hips > 0 && Math.abs(qg.ridge - 12) < 1e-9 && qg.hips === 0 && Math.abs(qg.gableWalls - 8 * 4 * Math.tan(Math.PI / 6)) < 1e-6, JSON.stringify({ qh, qg }))
  const sc = bimExtras({ ...m, roofs: rr.roofs } as Parameters<typeof bimExtras>[0])
  const hi = sc.items.find((x) => x.id === hip.id), gi = sc.items.find((x) => x.id === gable.id)
  check('roof 3D: the gable mass (a prism), the hip one with its two ends cut', !!hi && hi.parts[0].k === 'prism' && hi.cuts?.length === 2 && !!gi && !gi.cuts)
}
