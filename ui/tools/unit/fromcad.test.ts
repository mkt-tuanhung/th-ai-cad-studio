// Plan → BIM recognition and model building (run: UNIT=fromcad node tools/test-cam.mjs run <file.dxf> [truth.json]).
//   run      the SYNTHETIC fixture against its ground truth (qa/fixtures/bim/house_vn_SYNTHETIC.truth.json),
//            the 30°-rotated copy against the same truth, unit checks of the text parsers and the layer rules
//   villa    recognition summary of another DXF (e.g. the VILLA_150 test set) for the QA notes
//   ifc      IFC 4 text of the model built from a DXF (checked with tools/check_ifc.py)
import { decodeDxf, importDxf } from '../../src/cad/dxfImport'
import type { CadDocument } from '../../src/cad/types'
import { dominantAngle, findFlights, findSpirals, findPlans, isRoofPlanTitle, layerStats, norm, parseElevation, parseMark, parseSize, recognize, rotateEntity, ruleRole, scaleDoc, segsOf, shoelace, storeyOf, type LayerRole } from '../../src/bim/fromCad'
import { balconiesAndVoids, buildBimModel, buildInterior, DEFAULT_BUILD, inferElevations, mergeModels, stairsFrom, type BuildNames } from '../../src/bim/fromCadBuild'
import { boq, openingSchedule, priceOf, readPrices } from '../../src/bim/quantities'
import { applyStructure, readRebar, readStructure } from '../../src/bim/structure'
import { parseSlope, readRoofs, roofFrame, roofQuantities } from '../../src/bim/roof'
import { stairProfile, STAIR_WAIST } from '../../src/bim/scene'
import type { BimModel, PitchedRoof } from '../../src/bim/model'
import { mepRole, readMep } from '../../src/auto/mep'
import { buildMepModel } from '../../src/auto/mepModel'
import { findClashes } from '../../src/mep/model'
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

function analyse(doc: CadDocument, override: Record<string, LayerRole> = {}) {
  const roles = { ...Object.fromEntries(layerStats(doc).map((s) => [s.name, s.role])), ...override } as Record<string, LayerRole>
  const plans = findPlans(doc, roles).filter((p) => p.kind !== 'other')
  const recs = plans.map((p) => recognize(doc, roles, p))
  const built = buildBimModel(recs.map((r, i) => ({ rec: r, levelName: r.region.levelName ?? `L${i + 1}`, elevation: r.region.elevation ?? i * 3300, roof: r.region.kind === 'roof' })), DEFAULT_BUILD, NAMES)
  return { roles, plans, recs, built }
}
const docOf = (entities: Entity[], name = 't.dxf'): CadDocument => ({ id: name, name, entities, layers: [], currentLayer: '0', underlay: null, blocks: [], dirty: false, createdAt: 0, savedAt: null, source: 'dxf-import' }) as unknown as CadDocument
/** Entity makers for the synthetic cases (ids numbered per maker). */
function maker(tag: string) {
  let k = 0
  const base = (layer: string) => ({ color: 'ByLayer', linetype: 'ByLayer', lineweight: 'ByLayer', transparency: 0, layer, id: `${tag}${++k}` }) as const
  return {
    L: (layer: string, ax: number, ay: number, bx: number, by: number): Entity => ({ ...base(layer), kind: 'line', a: { x: ax, y: ay }, b: { x: bx, y: by } }),
    R: (layer: string, x0: number, y0: number, x1: number, y1: number): Entity => ({ ...base(layer), kind: 'polyline', closed: true, pts: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] }),
    PL: (layer: string, pts: [number, number][], closed = false): Entity => ({ ...base(layer), kind: 'polyline', closed, pts: pts.map(([x, y]) => ({ x, y })) }),
    C: (layer: string, x: number, y: number, r: number): Entity => ({ ...base(layer), kind: 'circle', c: { x, y }, r }),
    Tx: (layer: string, x: number, y: number, value: string, height = 250): Entity => ({ ...base(layer), kind: 'text', p: { x, y }, height, value, rotation: 0, align: 'left' }),
  }
}
const areaOf = (o: [number, number][]) => Math.abs(shoelace(o)) / 1e6

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
    const wet = m.rooms.filter((r) => /WC/.test(r.name)), dry = m.rooms.filter((r) => !/WC/.test(r.name))
    check(`${label}: finishes — WC walls tiled and its floor waterproofed, ceilings = room areas, skirting in the dry rooms only`, wet.length > 0 && (B.find((r) => r.key === 'tilesWet')?.total ?? 0) > 0 && Math.abs((B.find((r) => r.key === 'ceiling')?.total ?? 0) - m.rooms.reduce((a, r) => a + r.area, 0)) < 0.01 && (B.find((r) => r.key === 'waterproof')?.total ?? 0) > wet.reduce((a, r) => a + r.area, 0) && (B.find((r) => r.key === 'skirting')?.total ?? 0) > 0 && dry.length > 0)
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
  rebarChecks(check)
  mepChecks(check)
  // the review of 2026-10-18 (qa/REVIEW_2026-10-18.md): one synthetic case per bug
  titleChecks(check)
  deepRoofChecks(check)
  stairSectionChecks(check)
  uniqueIdChecks(check)
  mergeChecks(check)
  wideOpeningChecks(check)
  rotatedProjectChecks(check)
  capLevelChecks(check)
  coreChecks(check)
  bigSiteChecks(check)
  storeyStackChecks(check)
  unitChecks(check)
  ifcProjectChecks(check)
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

/** The typical details read as written (Φ, ø and %%c alike) and the bars counted from them. */
function rebarChecks(check: (name: string, ok: boolean, extra?: string) => void) {
  let k = 0
  const Tx = (x: number, y: number, value: string): Entity => ({ color: 'ByLayer', linetype: 'ByLayer', lineweight: 'ByLayer', transparency: 0, layer: 'S-TEXT', id: `t${++k}`, kind: 'text', p: { x, y }, height: 50, value, rotation: 0, align: 'left' })
  const ents = [
    Tx(0, 0, 'CỘT C1 250×250'), Tx(0, -60, '4Φ16 • ĐAI Φ6a100/200'),
    Tx(1000, 0, '220×300'), Tx(1000, -60, 'dưới 2ø12'), Tx(1000, -110, 'trên 2%%c16 + gia cường gối'), Tx(1000, -160, 'Φ8a100 (gối) / a200'),
    Tx(2000, 0, 'ĐÀI MÓNG 2 CỌC ĐIỂN HÌNH, H=700'), Tx(2000, -60, 'DƯỚI Φ16a150 • TRÊN Φ12a200'),
    Tx(3000, 0, 'BẢN THANG BTCT 140'), Tx(3000, -60, 'Φ10a150 dưới • Φ8a200 trên'),
  ]
  const spec = readRebar({ entities: ents } as unknown as CadDocument)
  check('rebar details: column 4Φ16 / Φ6a100/200, beam 300 (2ø12, 2%%c16, Φ8a100/a200), pile cap and stair meshes', !!spec && spec.column?.main.n === 4 && spec.column.main.d === 16 && spec.column.stirrups.d === 6 && spec.column.stirrups.aEnd === 100 && spec.column.stirrups.aMid === 200 && spec.beams[0]?.h === 300 && spec.beams[0].bottom.d === 12 && spec.beams[0].top.d === 16 && spec.beams[0].stirrups.aEnd === 100 && spec.cap?.bottom.d === 16 && spec.cap.top.a === 200 && spec.stair?.bottom.d === 10 && spec.stair.top.a === 200, JSON.stringify(spec))
  // one column 250 × 250, 3 m: 4Φ16 × (3 + 40 × 0.016) m; stirrups Φ6, 500 mm closer zones at both ends
  const m = { levels: [{ id: 'L1', name: 'Tầng 1', elevation: 0 }, { id: 'L2', name: 'Tầng 2', elevation: 3000 }], wallTypes: [], walls: [], doors: [], windows: [], rooms: [], slabs: [], stairs: [], railings: [], components: [], annotations: [], grids: [],
    columns: [{ id: 'C1', category: 'column', mark: 'C1', level: 'L1', topLevel: 'L2', x: 0, y: 0, w: 250, d: 250 }], rebar: spec } as unknown as Parameters<typeof boq>[0]
  const B = boq(m, autoEn.boq.words)
  const main = B.find((r) => r.key === 'rebarD:column:1')?.total ?? 0, st = B.find((r) => r.key === 'rebarD:column:0')?.total ?? 0
  const expMain = 4 * (3 + 0.64) * 0.00617 * 256
  const nSt = Math.ceil(1000 / 100) + Math.ceil(2000 / 200) + 1, expSt = nSt * ((2 * (200 + 200) + 120) / 1000) * 0.00617 * 36
  check('rebar from the details: column main bars and stirrups by their diameter class, no ratio estimate left for it', Math.abs(main - expMain) < 1e-6 && Math.abs(st - expSt) < 1e-6 && !B.some((r) => r.key === 'rebar:column'), `${main} vs ${expMain}; ${st} vs ${expSt}`)
}

/** MEP plans: devices counted by their symbols, runs measured, pipes sized by the label next to them, schematics left. */
function mepChecks(check: (name: string, ok: boolean, extra?: string) => void) {
  let k = 0
  const base = (layer: string) => ({ color: 'ByLayer', linetype: 'ByLayer', lineweight: 'ByLayer', transparency: 0, layer, id: `m${++k}` }) as const
  const L = (layer: string, ax: number, ay: number, bx: number, by: number): Entity => ({ ...base(layer), kind: 'line', a: { x: ax, y: ay }, b: { x: bx, y: by } })
  const C = (layer: string, x: number, y: number, r: number): Entity => ({ ...base(layer), kind: 'circle', c: { x, y }, r })
  const A = (layer: string, x: number, y: number, r: number): Entity => ({ ...base(layer), kind: 'arc', c: { x, y }, r, start: 0, end: Math.PI })
  const PL = (layer: string, pts: [number, number][], closed = false): Entity => ({ ...base(layer), kind: 'polyline', closed, pts: pts.map(([x, y]) => ({ x, y })) })
  const Tx = (layer: string, x: number, y: number, value: string, height = 200): Entity => ({ ...base(layer), kind: 'text', p: { x, y }, height, value, rotation: 0, align: 'left' })
  const light = (x: number, y: number) => [C('E-LIGHT', x, y, 140), L('E-LIGHT', x - 100, y - 100, x + 100, y + 100), L('E-LIGHT', x - 100, y + 100, x + 100, y - 100)]
  const ents: Entity[] = [
    ...light(1000, 1000), ...light(3000, 1000), ...light(5000, 1000),
    A('E-POWER', 1000, 3000, 110), L('E-POWER', 890, 3000, 1110, 3000), A('E-POWER', 4000, 3000, 110), L('E-POWER', 3890, 3000, 4110, 3000),
    PL('E-CIRCUIT', [[1000, 1000], [5000, 1000], [5000, 2000]]),
    PL('M-AC', [[6000, 500], [6900, 500], [6900, 720], [6000, 720]], true), Tx('E-TEXT', 6000, 900, 'ĐH 12k'),
    Tx('E-TEXT', 2000, -2000, 'MẶT BẰNG ĐIỆN – CHIẾU SÁNG TẦNG 1', 380),
    // plumbing, 30 m lower
    PL('P-CW', [[1000, -29000], [5000, -29000]]), Tx('P-TEXT', 2500, -28850, 'D25'),
    L('P-WASTE', 1000, -27000, 4000, -27000), Tx('P-TEXT', 2500, -26850, 'D90'),
    C('P-EQUIP', 4000, -27000, 80), L('P-EQUIP', 3945, -27055, 4055, -26945), L('P-EQUIP', 3945, -26945, 4055, -27055),
    Tx('P-TEXT', 2000, -32000, 'MẶT BẰNG CẤP THOÁT NƯỚC TẦNG 1', 380),
    // a schematic far away: not a plan
    L('P-CW', 40000, -29000, 48000, -29000), Tx('P-TEXT', 42000, -32000, 'SƠ ĐỒ NGUYÊN LÝ CẤP NƯỚC', 300),
  ]
  ents.push(Tx('P-TEXT', 1000, -29150, 'OĐ1 D110'), ...[0, 1].flatMap((i) => [C('E-SWITCH', 6000 + i * 800, 2500, 60), L('E-SWITCH', 6040 + i * 800, 2540, 6180 + i * 800, 2680)]))
  const r = readMep({ name: 'mep.dxf', entities: ents } as unknown as CadDocument, [{ name: 'Tầng 1', elevation: 0 }, { name: 'Tầng 2', elevation: 3600 }], 'Mái')
  const row = (key: string) => r.rows.find((x) => x.key === key)
  check('MEP: 2 plans (the schematic left out); 3 lights, 2 sockets, 5 m of wiring, an air conditioner 12k', r.plans.length === 2 && row('mep:light')?.total === 3 && row('mep:socket')?.total === 2 && Math.abs((row('mep:wire')?.total ?? 0) - 5) < 1e-9 && row('mep:ac:12k')?.total === 1 && r.plans.every((p) => p.level === 'Tầng 1'), JSON.stringify(r))
  check('MEP: a riser "OĐ1 D110" a storey high; drops to 2 switches and 2 sockets estimated (storey − slab − mounting height)', Math.abs((row('mep:riser:110')?.total ?? 0) - 3.6) < 1e-9 && Math.abs((row('mep:wireDrop')?.total ?? 0) - (2 * (3600 - 120 - 1250) + 2 * (3600 - 120 - 400)) / 1000) < 1e-9, JSON.stringify({ riser: row('mep:riser:110'), drop: row('mep:wireDrop') }))
  check('MEP roles: fire and low-current layers', mepRole('F-DETECT') === 'detector' && mepRole('F-ALARM') === 'alarm' && mepRole('F-EXT') === 'extinguisher' && mepRole('F-SIGN') === 'exitSign' && mepRole('L-CCTV') === 'camera' && mepRole('L-CCTV-FOV') === 'ignore' && mepRole('L-WIFI') === 'ap' && mepRole('L-WIFI-R') === 'ignore' && mepRole('L-DATA') === 'data' && mepRole('PCCC - ĐẦU BÁO KHÓI') === 'detector' && mepRole('P-CW') === 'cold' && mepRole('E-LIGHT') === 'light')
  // the coordination model: a drain main along x under the usual beams, a branch teeing into it, one beam deeper
  const bim = { levels: [{ id: 'L1', name: 'Tầng 1', elevation: 0 }, { id: 'L2', name: 'Tầng 2', elevation: 3600 }], slabs: [], walls: [], rooms: [], columns: [], grids: [],
    beams: [{ id: 'b1', category: 'beam', mark: 'D1', level: 'L2', topOffset: -50, x: 0, y: 0, angle: 90, length: 6000, b: 220, h: 300 }, { id: 'b2', category: 'beam', mark: 'D2', level: 'L2', topOffset: -50, x: 2000, y: 0, angle: 90, length: 6000, b: 220, h: 300 }, { id: 'b3', category: 'beam', mark: 'D3', level: 'L2', topOffset: -50, x: 4000, y: 0, angle: 90, length: 6000, b: 220, h: 600 }] } as unknown as Parameters<typeof buildMepModel>[1]
  const mm = buildMepModel([{ level: 'Tầng 1', role: 'waste', size: '110', pts: [[-500, 3000], [5000, 3000]] }, { level: 'Tầng 1', role: 'waste', size: '75', pts: [[3000, 1000], [3000, 3050]] }, { level: 'Tầng 1', role: 'light', size: null, at: [1000, 1000] }], bim)
  const cl = findClashes(mm.model)
  check('MEP model: pipes under the usual beams (300 deep) — only the deeper beam (600) is in the way; the tee is no clash', mm.pipes === 2 && cl.length === 1 && cl[0].kind === 'pipe-beam' && /D3/.test(cl[0].b) && mm.fixtures === 1 && mm.pipeBeam === 1, JSON.stringify({ pipes: mm.model.pipes, cl }))
  check('MEP: pipes measured and sized by the label next to them (cold D25 4 m, waste D90 3 m), a floor drain', Math.abs((row('mep:cold:25')?.total ?? 0) - 4) < 1e-9 && Math.abs((row('mep:waste:90')?.total ?? 0) - 3) < 1e-9 && row('mep:fixture')?.total === 1 && !r.rows.some((x) => x.role === 'cold' && x.total > 4.001), JSON.stringify(r.rows))
}

/* ================================================================ review 2026-10-18 */

type Check = (name: string, ok: boolean, extra?: string) => void
const near1 = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol

/** B9 / B10: elevations in titles and texts, roof plans against storeys with a roof part. */
function titleChecks(check: Check) {
  const cases: [string, number | null][] = [
    ['MẶT BẰNG TẦNG 2 - 3.900', 3900], ['MẶT BẰNG TẦNG 2  +3.900', 3900], ['±0.000', 0], ['COS -0,450', -450], ['-0.950 ĐỈNH ĐÀI', -950],
    ['ĐỈNH ĐÀI −0.950', -950], ['ĐỈNH ĐÀI − 0.950', -950], ['CỐT +3.900', 3900], ['COS 3.900', 3900], ['EL. 3.9 m', 3900], ['EL +3.90', 3900],
    ['COS - 0.450', -450], ['TẦNG 2-3.900', 3900], ['MẶT SÀN KC +3.550', 3550], ['EL. -1.2 m', -1200], ['MẶT BẰNG TẦNG 1   COS ±0.000', 0],
    ['Phòng 12', null], ['D2-1 220x400', null], ['3.6 m', null], ['12000', null],
  ]
  const bad = cases.filter(([s, v]) => parseElevation(s) !== v).map(([s, v]) => `${s} → ${parseElevation(s)} ≠ ${v}`)
  check('elevations: a spaced dash after a word or number separates ("TẦNG 2 - 3.900" = +3.900); "−" or a dash on the number is a minus; CỐT / COS / EL. 3.9 m', !bad.length, bad.join('; '))
  const roofT = ['MẶT BẰNG MÁI', 'MB MÁI', 'ROOF PLAN', 'MẶT BẰNG MÁI +11.100', 'MẶT BẰNG TẦNG MÁI']
  const storeys: [string, number, string][] = [['MẶT BẰNG TẦNG 4 + MÁI', 4, 'Tầng 4'], ['MẶT BẰNG TẦNG ÁP MÁI', 98, 'Tầng áp mái'], ['MẶT BẰNG TẦNG TUM', 98, 'Tầng tum'], ['LEVEL 3 + ROOF', 3, 'Level 3']]
  const wrong = [...roofT.filter((t) => !isRoofPlanTitle(t) || storeyOf(t)[0] !== 99), ...storeys.filter(([t, o, n]) => isRoofPlanTitle(t) || storeyOf(t)[0] !== o || storeyOf(t)[1] !== n).map(([t]) => t)]
  check('roof plans: only a roof plan title ("MẶT BẰNG MÁI", "MB MÁI", "ROOF PLAN"); "TẦNG 4 + MÁI", "TẦNG ÁP MÁI", "TẦNG TUM" stay storeys; a roof note is no title', !wrong.length && !isRoofPlanTitle('MÁI DỐC i = 35%', true) && isRoofPlanTitle('MẶT BẰNG MÁI', true), wrong.join('; '))
}

/** A6: a deep plot (its long side along plan Y), outlines both ways round: the ridge above the eaves in 3D and IFC. */
function deepRoofChecks(check: Check) {
  const mk = (id: string, outline: [number, number][], kind: PitchedRoof['kind']): PitchedRoof => ({ id, category: 'roof', mark: id, level: 'L2', outline, kind, slope: 30 })
  const deep: [number, number][] = [[0, 0], [8000, 0], [8000, 14000], [0, 14000]], wide: [number, number][] = [[0, 0], [14000, 0], [14000, 8000], [0, 8000]]
  const roofs = [mk('deep-gable', deep, 'gable'), mk('deep-hip', deep, 'hip'), mk('deep-cw', [...deep].reverse(), 'gable'), mk('wide-hip', wide, 'hip'), mk('wide-cw', [...wide].reverse(), 'hip')]
  const m = { levels: [{ id: 'L1', name: '1', elevation: 0 }, { id: 'L2', name: '2', elevation: 3600 }], wallTypes: [], walls: [], doors: [], windows: [], rooms: [], columns: [], slabs: [], stairs: [], railings: [], components: [], grids: [], annotations: [], roofs } as unknown as BimModel
  const sc = bimExtras(m)
  type V = [number, number, number]
  const crs = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const world = (o: V, z: V, x: V, u: number, v: number, w = 0): V => { const y = crs(z, x); return [o[0] + x[0] * u + y[0] * v + z[0] * w, o[1] + x[1] * u + y[1] * v + z[1] * w, o[2] + x[2] * u + y[2] * v + z[2] * w] }
  const corners = (r: PitchedRoof, pts: V[]) => pts.every((p) => r.outline.some((q) => near1(p[0], q[0]) && near1(p[1], q[1])))
  const bad: string[] = []
  for (const r of roofs) {
    const it = sc.items.find((x) => x.id === r.id)!, p = it.parts[0], f = roofFrame(r)
    const z = (p.z ?? [0, 0, 1]) as V, x = (p.x ?? [1, 0, 0]) as V
    const apex = world(p.o, z, x, f.W / 2, f.h), e = [world(p.o, z, x, 0, 0), world(p.o, z, x, f.W, 0), world(p.o, z, x, 0, 0, f.L), world(p.o, z, x, f.W, 0, f.L)]
    const cutsUp = (it.cuts ?? []).every((c) => crs((c.z ?? [0, 0, 1]) as V, (c.x ?? [1, 0, 0]) as V)[2] > 0.999)
    if (!(apex[2] > 3600 + 1000 && e.every((q) => near1(q[2], 3600)) && corners(r, e) && cutsUp)) bad.push(`3D ${r.id}: apex z ${apex[2].toFixed(0)}, eaves ${e.map((q) => q.map(Math.round).join(',')).join(' ')}`)
  }
  // IFC: the roof's extruded triangle through its placement — the profile's apex above its eaves
  const txt = toIfc(m, 'roofs').text
  const ent = new Map<string, string>()
  for (const l of txt.split('\n')) { const mm = /^(#\d+)=(.*);$/.exec(l); if (mm) ent.set(mm[1], mm[2]) }
  const refs = (s: string) => [...s.matchAll(/#\d+/g)].map((x) => x[0])
  const vec = (id: string) => /\(\(([^)]*)\)\)/.exec(ent.get(id)!)![1].split(',').map(Number) as number[]
  const roofEls = [...ent.entries()].filter(([, s]) => s.startsWith('IFCROOF('))
  for (const [, s] of roofEls) {
    const rep = refs(ent.get(refs(s)[1])!)[0]
    let item = refs(ent.get(rep)!).pop()!
    while (ent.get(item)!.startsWith('IFCBOOLEANCLIPPINGRESULT')) item = refs(ent.get(item)!)[0]
    const [prof, ax] = refs(ent.get(item)!)
    const [o, zd, xd] = refs(ent.get(ax)!).map(vec)
    const pts = refs(ent.get(refs(ent.get(prof)!)[0])!).map(vec)
    const top = pts.reduce((a, q) => (q[1] > a[1] ? q : a))
    const W = (q: number[]) => world([o[0], o[1], o[2] ?? 0], zd as V, xd as V, q[0], q[1])[2]
    if (!(W(top) > 1000 && pts.filter((q) => Math.abs(q[1]) < 1e-6).every((q) => Math.abs(W(q)) < 1e-6))) bad.push(`IFC ${s.slice(0, 60)}: apex z ${W(top)}`)
  }
  check('roof frame right-handed for every outline: deep plot (long side along Y) and both ways round — ridge above the eaves in the 3D mass, its hip cuts and the IFC placement', !bad.length && roofEls.length === roofs.length, bad.join('; '))
}

/** A9: the flight's section — steps on a waist slab 150 mm thick square to the pitch line under the step roots. */
function stairSectionChecks(check: Check) {
  const st = { id: 's', category: 'stair', mark: 'S', baseLevel: 'L1', topLevel: 'L2', x: 0, y: 0, angle: 0, length: 2900, width: 1100, rise: 1800, risers: 10 } as BimModel['stairs'][number]
  const n = 10, r = 180, g = 290, L = 2900
  const prof = stairProfile(st, n, r)
  const k = r / g, drop = STAIR_WAIST * Math.hypot(1, k), xs = drop / k
  const exp = (g * r * n * (n + 1)) / 2 - ((k * (L * L - xs * xs)) / 2 - drop * (L - xs))
  // thickness under each root ((i+1) g, (i+1) r) to the soffit edge of the profile
  const soffit = prof.filter((q, i) => i > 0 && (q[1] < (q[0] / g) * r - 1 || (q[1] === 0 && q[0] > 0)))
  const [s1, s2] = soffit.length >= 2 ? [soffit[0], soffit[soffit.length - 1]] : [[0, 0], [1, 0]]
  const dist = (p: [number, number]) => Math.abs((s2[1] - s1[1]) * p[0] - (s2[0] - s1[0]) * p[1] + s2[0] * s1[1] - s2[1] * s1[0]) / Math.hypot(s2[1] - s1[1], s2[0] - s1[0])
  const th = Array.from({ length: n - 1 }, (_, i) => dist([(i + 1) * g, (i + 1) * r]))
  const area = areaOf(prof) * 1e6
  const m = { levels: [{ id: 'L1', name: '1', elevation: 0 }, { id: 'L2', name: '2', elevation: 1800 }], wallTypes: [], walls: [], doors: [], windows: [], rooms: [], columns: [], slabs: [], stairs: [st], railings: [], components: [], grids: [], annotations: [] } as unknown as BimModel
  const v = boq(m, autoEn.boq.words).find((x) => x.key === 'stair')?.total ?? 0
  // a flight too short for the slab to leave the floor is solid down to it
  const short = stairProfile({ ...st, length: 300 }, 1, 150)
  check('stair section: riser 180 / going 290 — waist 150 mm square to the pitch under every step root (not ~5 mm), area = steps + waist, the bill of quantities uses it', near1(area, exp, 1) && th.every((t) => near1(t, STAIR_WAIST, 0.01)) && near1(v, (exp * 1100) / 1e9, 1e-6) && short.some((q) => q[0] === 300 && q[1] === 0) && areaOf(short) > 0,
    `area ${area.toFixed(0)} vs ${exp.toFixed(0)}; thickness ${th.map((t) => t.toFixed(1)).join('/')}; boq ${v}; ${JSON.stringify(prof.slice(-3))}`)
}

/* ---------- the project fixture: the SYNTHETIC house + a U stair + its structural plans + its roof plan ---------- */

/** Structural plans of the SYNTHETIC house (grids 1 / 2 / 3 at x 110 / 6000 / 11890, A / B at y 110 / 8890): a
 *  foundation plan (3 pile caps on grid A, a tie beam 1–2) and the floor beam plan of Tầng 2 (beams on A and B, slab
 *  h=150 with an opening), each with its grids and its title. */
function houseStruct(): Entity[] {
  const { L, R, Tx } = maker('st')
  const grids = (ox: number, oy: number) => [
    ...([['1', 110], ['2', 6000], ['3', 11890]] as const).flatMap(([lab, x]) => [L('S-GRID', ox + x, oy - 2000, ox + x, oy + 11000), Tx('S-GRID', ox + x, oy + 11300, lab, 350)]),
    ...([['A', 110], ['B', 8890]] as const).flatMap(([lab, y]) => [L('S-GRID', ox - 2000, oy + y, ox + 14000, oy + y), Tx('S-GRID', ox + 14300, oy + y, lab, 350)]),
  ]
  const fo = [0, -40000], fl = [30000, -40000]
  const caps = [110, 6000, 11890].flatMap((x) => [R('S-FOUND', fo[0] + x - 300, fo[1] + 110 - 675, fo[0] + x + 300, fo[1] + 110 + 675), R('S-PILE', fo[0] + x - 125, fo[1] + 110 - 500, fo[0] + x + 125, fo[1] + 110 - 250), R('S-PILE', fo[0] + x - 125, fo[1] + 110 + 250, fo[0] + x + 125, fo[1] + 110 + 500), Tx('S-TAG', fo[0] + x - 250, fo[1] + 110 + 750, 'M1 (2 cọc)')])
  return [
    ...grids(fo[0], fo[1]), ...caps,
    L('S-TIE', fo[0] + 410, fo[1] - 15, fo[0] + 5700, fo[1] - 15), L('S-TIE', fo[0] + 410, fo[1] + 235, fo[0] + 5700, fo[1] + 235), Tx('S-TAG', fo[0] + 2500, fo[1] + 300, 'GM 250×450'), L('S-TIE', fo[0] + 6300, fo[1] - 15, fo[0] + 11590, fo[1] - 15), L('S-TIE', fo[0] + 6300, fo[1] + 235, fo[0] + 11590, fo[1] + 235),
    Tx('S-TEXT', fo[0] + 2000, fo[1] + 4000, 'ĐÁY ĐÀI -1.600'), Tx('S-LEVEL', fo[0] + 2000, fo[1] + 4500, '-0.950 ĐỈNH ĐÀI'),
    Tx('S-TEXT', fo[0] + 3000, fo[1] - 3500, 'MẶT BẰNG MÓNG + GIẰNG MÓNG', 380),
    ...grids(fl[0], fl[1]),
    L('S-BEAM', fl[0] + 110, fl[1], fl[0] + 11890, fl[1]), L('S-BEAM', fl[0] + 110, fl[1] + 220, fl[0] + 11890, fl[1] + 220), Tx('S-TAG', fl[0] + 3000, fl[1] + 260, 'D1 220x400'),
    L('S-BEAM', fl[0] + 110, fl[1] + 8780, fl[0] + 11890, fl[1] + 8780), L('S-BEAM', fl[0] + 110, fl[1] + 9000, fl[0] + 11890, fl[1] + 9000),
    R('S-SLAB', fl[0] + 110, fl[1] + 110, fl[0] + 11890, fl[1] + 8890), Tx('S-TAG', fl[0] + 8000, fl[1] + 6000, 'h=150'),
    R('S-OPEN', fl[0] + 7000, fl[1] + 4000, fl[0] + 8000, fl[1] + 5500),
    Tx('S-TEXT', fl[0] + 3000, fl[1] - 3500, 'MẶT BẰNG KẾT CẤU SÀN TẦNG 2  (MẶT SÀN KC +3.550)', 380),
  ]
}
/** The roof plan of the house: its grids, the eaves 500 mm past the walls, a hip roof "i = 35%". */
function houseRoof(ox: number): Entity[] {
  const { L, R, Tx } = maker('rf')
  return [
    ...([['1', 110], ['2', 6000], ['3', 11890]] as const).flatMap(([lab, x]) => [L('TRUC', ox + x, -2500, ox + x, 11500), Tx('TRUC', ox + x - 120, -3020, lab, 300)]),
    ...([['A', 110], ['B', 8890]] as const).flatMap(([lab, y]) => [L('TRUC', ox - 2500, y, ox + 14500, y), Tx('TRUC', ox - 3020, y - 120, lab, 300)]),
    R('MAI', ox - 500, -500, ox + 12500, 9500), Tx('MAI', ox + 4000, 3000, 'MÁI DỐC i = 35% - LỢP NGÓI'), Tx('CHU', ox + 4000, -4500, 'MẶT BẰNG MÁI', 400),
  ]
}
/** The U stair of uStairPlan moved into the living room of the house (x 1200…3500, y 300…3000), on plan 1 and 2. */
function houseStairs(): Entity[] {
  const mv = (e: Entity, dx: number, dy: number): Entity => { const r = rotateEntity(e, 0, { x: 0, y: 0 }); const T = (p: { x: number; y: number }) => ({ x: p.x + dx, y: p.y + dy }); return r.kind === 'line' ? { ...r, a: T(r.a), b: T(r.b) } : r.kind === 'polyline' ? { ...r, pts: r.pts.map(T) } : r.kind === 'circle' ? { ...r, c: T(r.c) } : r }
  return [...uStairPlan(true).map((e) => ({ ...mv(e, -6300, -7300), id: `l${e.id}` })), ...uStairPlan(false).map((e) => ({ ...mv(e, 20000 - 6300, -7300), id: `u${e.id}` }))]
}
const STRUCT_ROLES: Record<string, LayerRole> = { 'S-BEAM': 'ignore', 'S-TIE': 'ignore', 'S-FOUND': 'ignore', 'S-PILE': 'ignore', 'S-SLAB': 'ignore', 'S-OPEN': 'ignore', 'S-GRID': 'ignore', 'S-TAG': 'ignore', 'S-TEXT': 'ignore', 'S-LEVEL': 'ignore', MAI: 'ignore' }
/** The whole project read as the one-command pipeline does: plans → model, structure applied, roofs read. */
function project(doc: CadDocument) {
  const a = analyse(doc, STRUCT_ROLES)
  const s = readStructure(doc, a.built.model, a.built.align.grid)
  let m = applyStructure(a.built.model, s)
  const rr = readRoofs(doc, m, a.built.align.grid)
  m = { ...m, roofs: rr.roofs }
  return { a, s, m, rr }
}
function projectDoc(ang = 0): CadDocument {
  const house = load(readFileSync(FX + 'house_vn_SYNTHETIC.dxf', 'latin1')).entities
  const all = [...house, ...houseStairs(), ...houseStruct(), ...houseRoof(60000)]
  return docOf(ang ? all.map((e) => rotateEntity(e, ang, { x: 0, y: 0 })) : all, ang ? 'rot.dxf' : 'straight.dxf')
}

/** A8: the structure of several drawings applied one after the other — beam / footing ids stay unique; IFC GlobalIds
 *  stay unique even for a model with a repeated id. */
function uniqueIdChecks(check: Check) {
  const { a } = project(projectDoc())
  const sdoc = docOf(houseStruct(), 's.dxf')
  let m = a.built.model
  for (let i = 0; i < 2; i++) m = applyStructure(m, readStructure(sdoc, m, a.built.align.grid))
  const ids = [...(m.beams ?? []), ...(m.footings ?? [])].map((x) => x.id)
  // a result read against the model before the first one was applied (a stale read) is re-numbered when applied
  const stale = readStructure(sdoc, a.built.model, a.built.align.grid)
  const m2 = applyStructure(applyStructure(a.built.model, stale), stale)
  const ids2 = [...(m2.beams ?? []), ...(m2.footings ?? [])].map((x) => x.id)
  const dup = { ...m, beams: [...(m.beams ?? []), { ...m.beams![0] }] }
  const guids = [...toIfc(dup, 'dup').text.matchAll(/^#\d+=IFC\w+\('([0-9A-Za-z_$]{22})'/gm)].map((x) => x[1])
  const health = runModelChecks(dup).find((c) => c.key === 'health')!
  check('structure of two drawings applied in turn: beam / footing ids unique (also for a stale read); IFC GlobalIds unique with a repeated id; the repeated id flagged by the model checks',
    ids.length === 2 * (4 + 3) && new Set(ids).size === ids.length && new Set(ids2).size === ids2.length && ids2.length === ids.length && guids.length > 100 && new Set(guids).size === guids.length && health.items.some((x) => /id used twice/.test(x.message)),
    `${ids.join(',')} | ${ids2.join(',')} | guids ${guids.length}/${new Set(guids).size}`)
}

/** A7: "Add to the current model" keeps every list of the imported model, with new ids where taken and the references
 *  following them. */
function mergeChecks(check: Check) {
  const { m } = project(projectDoc())
  const base: BimModel = { ...m, annotations: [{ id: 'A1', category: 'annotation', kind: 'tag', level: 'L1', a: [0, 0], target: 'W1' }] }
  const mg = mergeModels(base, base)
  const keys = ['walls', 'doors', 'windows', 'rooms', 'columns', 'slabs', 'stairs', 'railings', 'components', 'annotations', 'beams', 'footings', 'roofs'] as const
  const len = (x: BimModel, k: (typeof keys)[number]) => ((x[k] ?? []) as unknown[]).length
  const doubled = keys.filter((k) => len(mg, k) !== 2 * len(base, k))
  const all = keys.flatMap((k) => ((mg[k] ?? []) as { id: string }[]).map((x) => x.id)).concat(mg.grids.map((g) => g.id))
  const wallIds = new Set(mg.walls.map((w) => w.id)), lv = new Set(mg.levels.map((l) => l.id)), types = new Set(mg.wallTypes.map((t) => t.id))
  const refsOk = [...mg.doors, ...mg.windows].every((o) => wallIds.has(o.hostWall)) && mg.walls.every((w) => lv.has(w.baseLevel) && lv.has(w.topLevel) && types.has(w.typeId))
    && [...mg.rooms, ...mg.slabs, ...mg.railings, ...mg.components, ...(mg.beams ?? []), ...(mg.footings ?? []), ...(mg.roofs ?? [])].every((x) => lv.has(x.level)) && mg.stairs.every((s) => lv.has(s.baseLevel) && lv.has(s.topLevel)) && mg.columns.every((c) => lv.has(c.level) && lv.has(c.topLevel))
  const copyTag = mg.annotations[1]
  const nonEmpty = keys.filter((k) => len(base, k) > 0)
  check('add to the model: every list of the imported model kept (stairs, railings, beams, footings, roofs, annotations, landings with openings…), ids unique, references follow, shared levels and grids not doubled',
    !doubled.length && nonEmpty.length === keys.length && new Set(all).size === all.length && refsOk && mg.levels.length === base.levels.length && mg.grids.length === base.grids.length && !!copyTag && copyTag.target !== 'W1' && wallIds.has(copyTag.target!) && runModelChecks(mg).find((c) => c.key === 'health')!.status === 'ok' && !!mg.rebar === !!base.rebar,
    `doubled ✗ ${doubled.join(',')}; empty ✗ ${keys.filter((k) => !len(base, k)).join(',')}; ids ${all.length}/${new Set(all).size}; refs ${refsOk}; tag ${copyTag?.target}`)
}

/** B7: a 3.6 m gap in the front wall drawn only as a line on the door layer (a rolling shutter), or with "CỬA CUỐN"
 *  written by it, or with nothing; a 7 m gap with nothing. The room and the footprint stay closed. */
function wideOpeningChecks(check: Check) {
  const shop = (W: number, gap: [number, number], extra: (m: ReturnType<typeof maker>) => Entity[]) => {
    const mk = maker('sh'), { L, Tx } = mk, H = 9000, T = 220
    return docOf([
      L('TUONG', 0, 0, gap[0], 0), L('TUONG', gap[1], 0, W, 0), L('TUONG', T, T, gap[0], T), L('TUONG', gap[1], T, W - T, T), L('TUONG', gap[0], 0, gap[0], T), L('TUONG', gap[1], 0, gap[1], T),
      L('TUONG', 0, H, W, H), L('TUONG', T, H - T, W - T, H - T), L('TUONG', 0, 0, 0, H), L('TUONG', T, T, T, H - T), L('TUONG', W, 0, W, H), L('TUONG', W - T, T, W - T, H - T),
      Tx('TEN PHONG', W / 2, H / 2, 'GARA + SHOWROOM'), Tx('CHU', 2000, -3500, 'MẶT BẰNG TẦNG 1  ±0.000', 400), ...extra(mk),
    ])
  }
  const run1 = (doc: CadDocument) => { const a = analyse(doc); const r = a.recs[0]; return { r, fp: r?.footprint ? areaOf(r.footprint) : 0, ops: r?.openings.filter((o) => o.s1 - o.s0 > 2500) ?? [], codes: r?.warnings.map((w) => w.code) ?? [] } }
  const line = run1(shop(10000, [3000, 6600], ({ L }) => [L('CUA', 3000, 110, 6600, 110)]))
  const text = run1(shop(10000, [3000, 6600], ({ Tx }) => [Tx('CHU', 4000, -700, 'CỬA CUỐN', 200)]))
  const none = run1(shop(10000, [3000, 6600], () => []))
  const wide = run1(shop(12000, [2000, 9000], () => []))
  const room = (x: ReturnType<typeof run1>, a: number) => x.r?.rooms.length === 1 && near1(x.r.rooms[0].area, a, 0.011)
  const s = (x: ReturnType<typeof run1>) => `fp ${x.fp.toFixed(2)} ops ${x.ops.map((o) => `${o.kind}:${Math.round(o.s1 - o.s0)}:${o.why}`).join('/')} rooms ${x.r?.rooms.map((q) => q.area).join('/')} ${x.codes.join(',')}`
  check('wide opening: a door-layer line across a 3.6 m gap → a 3.6 m door; footprint 90 m², the room closed', line.ops.length === 1 && line.ops[0].kind === 'door' && line.ops[0].why.includes('line') && near1(line.ops[0].s1 - line.ops[0].s0, 3600) && near1(line.fp, 90, 0.01) && room(line, 81.83), s(line))
  check('wide opening: "CỬA CUỐN" written by the gap → a door', text.ops.length === 1 && text.ops[0].kind === 'door' && text.ops[0].why.includes('text') && near1(text.fp, 90, 0.01) && room(text, 81.83), s(text))
  check('wide opening: nothing drawn in a 3.6 m gap of the outer wall → a wide plain opening (flagged), footprint and room closed', none.ops.length === 1 && none.ops[0].kind === 'opening' && none.ops[0].why.includes('wallLine') && none.codes.includes('wideOpenings') && near1(none.fp, 90, 0.01) && room(none, 81.83), s(none))
  check('wide gap: 7 m with nothing → no opening built, the outline closed along the wall line for the room and the footprint (flagged)', wide.ops.length === 0 && wide.codes.includes('gapsClosedVirtual') && near1(wide.fp, 108, 0.01) && room(wide, 98.95), s(wide))
}

/** B11: the whole project drawn at 30° — house, U stair, structure, roof — gives the model of the square drawing. */
function rotatedProjectChecks(check: Check) {
  const A = project(projectDoc()), B = project(projectDoc(Math.PI / 6))
  const ang = (a: number, b: number, mod = 360) => { const d = (((a - b) % mod) + mod) % mod; return Math.min(d, mod - d) < 0.01 }
  const sameXY = (p: [number, number][], q: [number, number][]) => p.length === q.length && p.every((v) => q.some((w) => near1(v[0], w[0]) && near1(v[1], w[1])))
  const byXY = <T extends { x: number; y: number }>(xs: T[]) => [...xs].sort((a, b) => a.x - b.x || a.y - b.y)
  const st = (x: BimModel) => byXY(x.stairs)
  const stairsEq = st(A.m).length === 2 && st(A.m).length === st(B.m).length && st(A.m).every((s, i) => { const t = st(B.m)[i]; return near1(s.x, t.x) && near1(s.y, t.y) && ang(s.angle, t.angle) && near1(s.length, t.length) && near1(s.width, t.width) && s.risers === t.risers })
  const bm = (x: BimModel) => byXY(x.beams ?? [])
  const beamsEq = bm(A.m).length === 4 && bm(B.m).length === 4 && bm(A.m).every((b, i) => { const c = bm(B.m)[i]; return near1(b.x, c.x) && near1(b.y, c.y) && near1(b.length, c.length) && ang(b.angle, c.angle, 180) && b.b === c.b && b.h === c.h && b.topOffset === c.topOffset })
  const ft = (x: BimModel) => byXY(x.footings ?? [])
  const capsEq = ft(A.m).length === 3 && ft(A.m).every((f, i) => { const g = ft(B.m)[i]; return !!g && near1(f.x, g.x) && near1(f.y, g.y) && near1(f.w, g.w) && near1(f.d, g.d) && f.piles === g.piles && f.pileSize === g.pileSize && f.top === g.top })
  const ops = (x: BimModel) => x.slabs.flatMap((s) => s.openings ?? [])
  const opsEq = ops(A.m).length === ops(B.m).length && ops(A.m).length >= 2 && ops(A.m).every((o, i) => sameXY(o, ops(B.m)[i]))
  const [ra, rb] = [A.m.roofs?.[0], B.m.roofs?.[0]]
  const fa = ra && roofFrame(ra), fb = rb && roofFrame(rb)
  const roofEq = !!ra && !!rb && A.m.roofs!.length === 1 && B.m.roofs!.length === 1 && ra.kind === rb.kind && sameXY(ra.outline, rb.outline) && !!fa && !!fb && near1(fa.L, fb.L) && near1(fa.W, fb.W) && Math.abs(fa.u[0] * fb.u[1] - fa.u[1] * fb.u[0]) < 1e-3 && !rb.approx && sameXY(ra.outline, [[-610, -610], [12390, -610], [12390, 9390], [-610, 9390]])
  const counts = JSON.stringify(A.a.built.counts) === JSON.stringify(B.a.built.counts)
  check('drawn at 30°: the same model as square — counts, the U stair (both flights, every tread), beams / tie (place, length, direction), pile caps (size, piles), slab openings, the roof (outline, orientation), no warnings',
    counts && stairsEq && beamsEq && capsEq && opsEq && roofEq && !B.s.warnings.length && !B.rr.warnings.length,
    JSON.stringify({ counts: [A.a.built.counts, B.a.built.counts], stairs: [st(A.m), st(B.m)].map((l) => l.map((s) => [s.x, s.y, s.angle, s.length, s.risers])), beams: [bm(A.m), bm(B.m)].map((l) => l.map((b) => [b.x, b.y, b.angle, b.length])), caps: [ft(A.m), ft(B.m)].map((l) => l.map((f) => [f.x, f.y, f.w, f.d])), roof: [ra?.outline, rb?.outline], w: [B.s.warnings, B.rr.warnings] }))
  // a long building (30 × 6 m) at 30° with a flight at its far end: the treads are kept (filtered in the squared frame)
  const { L } = maker('lg'), T = 220
  const walls = [L('TUONG', 0, 0, 30000, 0), L('TUONG', T, T, 30000 - T, T), L('TUONG', 0, 6000, 30000, 6000), L('TUONG', T, 6000 - T, 30000 - T, 6000 - T), L('TUONG', 0, 0, 0, 6000), L('TUONG', T, T, T, 6000 - T), L('TUONG', 30000, 0, 30000, 6000), L('TUONG', 30000 - T, T, 30000 - T, 6000 - T)]
  const treads = Array.from({ length: 10 }, (_, i) => L('CAU THANG', 27300 + 270 * i, 1000, 27300 + 270 * i, 2100))
  const fl = (ents: Entity[]) => { const a = analyse(docOf(ents)); return a.recs[0]?.flights ?? [] }
  const f0 = fl([...walls, ...treads]), f1 = fl([...walls, ...treads].map((e) => rotateEntity(e, Math.PI / 6, { x: 0, y: 0 })))
  check('drawn at 30°: a flight at the far end of a long building keeps all its treads', f0.length === 1 && f1.length === 1 && f0[0].lines === 10 && f1[0].lines === 10 && near1(f0[0].run, f1[0].run), JSON.stringify([f0, f1].map((l) => l.map((f) => [f.lines, Math.round(f.run)]))))
}

/** B15: "ĐỈNH ĐÀI −0.950" is an elevation: the caps' top from their level when the lowest level is not ±0.000. */
function capLevelChecks(check: Check) {
  const { a } = project(projectDoc())
  const sdoc = docOf(houseStruct(), 's.dxf')
  const raised = { ...a.built.model, levels: a.built.model.levels.map((l) => (l.id === 'L1' ? { ...l, elevation: 450 } : l)) }
  const s1 = readStructure(sdoc, raised, a.built.align.grid)
  const c1 = s1.footings[0], tie1 = s1.beams.find((b) => b.tie)
  const base = { ...a.built.model, levels: [{ id: 'B1', name: 'Tầng hầm', elevation: -3000 }, ...a.built.model.levels] }
  const s2 = readStructure(sdoc, base, a.built.align.grid)
  const c2 = s2.footings[0]
  check('pile caps: ĐỈNH ĐÀI −0.950 / ĐÁY ĐÀI −1.600 from ±0.000 — ground floor at +0.450: top −1400 / bottom −2050 from it (tie beam too); a basement at −3.000: +2050 from it, flagged',
    !!c1 && c1.level === 'L1' && c1.top === -1400 && c1.bottom === -2050 && tie1?.topOffset === -1400 && !!c2 && c2.level === 'B1' && c2.top === 2050 && c2.bottom === 1400 && s2.warnings.some((w) => w.startsWith('capAboveLevel')),
    JSON.stringify({ c1, tie: tie1?.topOffset, c2, w: s2.warnings }))
}

/** B16: a hall running round a core (a shaft in walls 110 thick): the core is not its floor; the shaft is a room. */
function coreChecks(check: Check) {
  const { R, Tx } = maker('co')
  const doc = docOf([
    R('TUONG', 0, 0, 10000, 8000), R('TUONG', 220, 220, 9780, 7780), R('TUONG', 4000, 3000, 6000, 5000), R('TUONG', 4110, 3110, 5890, 4890),
    Tx('TEN PHONG', 1500, 1500, 'SẢNH'), Tx('TEN PHONG', 4300, 3900, 'HỘP KT', 150), Tx('CHU', 2000, -3000, 'MẶT BẰNG TẦNG 1  ±0.000', 400),
  ])
  const a = analyse(doc)
  const r = a.recs[0]
  const hall = r?.rooms.find((x) => x.name === 'SẢNH'), shaft = r?.rooms.find((x) => x.name === 'HỘP KT')
  const sp = toIfc(a.built.model, 'core').text
  check('room round a core: area = outline − the core (68.27 m², not 72.27), the core its hole (4 m²), the shaft its own room (3.17 m²); IFC space with the void',
    !!hall && hall.area === 68.27 && hall.holes?.length === 1 && near1(areaOf(hall.holes[0]), 4, 0.001) && !!shaft && shaft.area === 3.17 && !!a.built.model.rooms.find((x) => x.name === 'SẢNH')?.holes && /IFCSPACE[^\n]*/.test(sp) && sp.includes('IFCARBITRARYPROFILEDEFWITHVOIDS'),
    JSON.stringify(r?.rooms.map((x) => [x.name, x.area, x.holes?.map(areaOf)])))
}

/** B18: a 400 m site boundary on a wall layer round one plan: the rooms as without it, in well under 2 s. */
function bigSiteChecks(check: Check) {
  const truth = JSON.parse(readFileSync(FX + 'house_vn_SYNTHETIC.truth.json', 'utf8')) as { floors: { rooms: { name: string; area: number }[] }[] }
  const want = truth.floors[0].rooms.map((x) => `${x.name}:${x.area}`).sort().join(', ')
  const floor1 = load(readFileSync(FX + 'house_vn_SYNTHETIC.dxf', 'latin1')).entities.filter((e) => boxOf2(e) < 16000)
  const { PL } = maker('site')
  const site = PL('TUONG', [[-200000, -200000], [200000, -200000], [200000, 200000], [-200000, 200000]], true)
  const fence = [PL('TUONG', [[-200000, -200000], [200000, -200000], [200000, 200000], [-200000, 200000]], true), PL('TUONG', [[-199800, -199800], [199800, -199800], [199800, 199800], [-199800, 199800]], true)]
  const t0 = Date.now()
  const a = analyse(docOf([...floor1, site]))
  const dt = Date.now() - t0
  const got = a.recs[0]?.rooms.map((x) => `${x.name}:${x.area}`).sort().join(', ')
  const t1 = Date.now()
  const b = analyse(docOf([...floor1, ...fence]))
  const dt2 = Date.now() - t1
  const named = b.recs[0]?.rooms.filter((x) => x.name).map((x) => `${x.name}:${x.area}`).sort().join(', ')
  check('a 400 m site boundary on the wall layer: rooms exactly as without it, < 2 s; a 400 m site wall (a pair of lines): the grid grows its cells, < 2 s, the house rooms found', got === want && dt < 2000 && dt2 < 2000 && named === want, `${dt} ms / ${dt2} ms; ${got} | ${named}`)
}
const boxOf2 = (e: Entity) => (e.kind === 'line' ? Math.max(e.a.x, e.b.x) : e.kind === 'polyline' ? Math.max(...e.pts.map((p) => p.x)) : e.kind === 'text' ? e.p.x : e.kind === 'circle' || e.kind === 'arc' ? e.c.x : Math.max(e.a.x, e.b.x))

/** The IFC of the whole project (stairs as their section, roof, beams, caps, spaces): every reference defined, no
 *  GlobalId twice, each stair one swept section with the waist slab. */
function ifcProjectChecks(check: Check) {
  const { m } = project(projectDoc())
  const r = toIfc(m, 'project')
  const lines = new Map([...r.text.matchAll(/^(#\d+)=(.*);$/gm)].map((x) => [x[1], x[2]]))
  const used = [...r.text.matchAll(/#\d+/g)].map((x) => x[0])
  const guids = [...r.text.matchAll(/^#\d+=IFC\w+\('([0-9A-Za-z_$]{22})'/gm)].map((x) => x[1])
  const refs = (id: string) => [...(lines.get(id) ?? '').matchAll(/#\d+/g)].map((x) => x[0])
  const stairs = [...lines.entries()].filter(([, s]) => s.startsWith('IFCSTAIR('))
  const swept = stairs.every(([id]) => { const rep = refs(refs(id)[1])[0]; const items = refs(rep).slice(1); return items.length === 1 && lines.get(items[0])!.startsWith('IFCEXTRUDEDAREASOLID') })
  check('IFC of the project: references all defined, GlobalIds unique, each stair one swept section, roof / beams / caps exported', used.every((x) => lines.has(x)) && new Set(guids).size === guids.length && stairs.length === 2 && swept && r.counts.IfcRoof === 1 && r.counts.IfcBeam === 4 && r.counts.IfcFooting === 3,
    JSON.stringify(r.counts))
}

/** B8: elevations not written inferred from the storey order; two storeys at one elevation reported. */
function storeyStackChecks(check: Check) {
  const r1 = inferElevations([{ elevation: 0, order: 1, name: 'Tầng 1' }, { elevation: null, order: 2, name: 'Tầng 2' }, { elevation: 7200, order: 3 }, { elevation: null, order: 0, name: 'Tầng hầm' }, { elevation: null, order: 99, roof: true, name: 'Mái' }])
  const r2 = inferElevations([{ elevation: null, order: 1 }, { elevation: null, order: 2 }])
  const r3 = inferElevations([{ elevation: 3900, order: 2, name: 'Tầng 2' }, { elevation: 3900, order: 3, name: 'Tầng 3' }])
  const r4 = inferElevations([{ elevation: 7200, order: 2, name: 'Tầng 2' }, { elevation: 3600, order: 3, name: 'Tầng 3' }])
  const a = analyse(load(readFileSync(FX + 'house_vn_SYNTHETIC.dxf', 'latin1')))
  const b = buildBimModel([{ rec: a.recs[0], levelName: 'Tầng 1', elevation: 0, order: 1, roof: false }, { rec: a.recs[1], levelName: 'Tầng 2', elevation: null, order: 2, roof: false }], DEFAULT_BUILD, NAMES)
  const d = buildBimModel([{ rec: a.recs[0], levelName: 'Tầng 1', elevation: 0, roof: false }, { rec: a.recs[1], levelName: 'Tầng 2', elevation: 0, roof: false }], DEFAULT_BUILD, NAMES)
  check('storey stack: a missing elevation between written ones / below (basement) / above (roof) by the typical storey; none written: ±0 and the storey height; the build infers and notes it',
    JSON.stringify(r1.elevations) === '[0,3600,7200,-3600,10800]' && JSON.stringify(r1.inferred) === '[false,true,false,true,true]' && !r1.problems.length && JSON.stringify(r2.elevations) === '[0,3300]'
    && JSON.stringify(b.model.levels.map((l) => l.elevation)) === '[0,3300,6600]' && b.notes.some((n) => n.startsWith('elevationInferred:Tầng 2')) && !b.problems.length && runModelChecks(b.model).every((c) => c.key !== 'health' || c.status === 'ok'),
    JSON.stringify({ r1, r2, b: b.model.levels, notes: b.notes }))
  check('storey stack: two storeys at one elevation, a storey written above the next one — reported (build problems, model check), not built silently',
    r3.problems.some((p) => p === 'sameElevation:Tầng 2|Tầng 3') && r4.problems.some((p) => p === 'orderElevation:Tầng 2|Tầng 3') && d.problems.some((p) => p.startsWith('sameElevation')) && runModelChecks(d.model).find((c) => c.key === 'health')!.items.some((x) => /same elevation/.test(x.message)),
    JSON.stringify({ r3: r3.problems, r4: r4.problems, d: d.problems }))
}

/** Units: the SYNTHETIC house drawn in metres and in centimetres (no INSUNITS) reads as in millimetres, flagged. */
function unitChecks(check: Check) {
  const truth = JSON.parse(readFileSync(FX + 'house_vn_SYNTHETIC.truth.json', 'utf8')) as { floors: { rooms: { name: string; area: number }[] }[] }
  const doc = load(readFileSync(FX + 'house_vn_SYNTHETIC.dxf', 'latin1'))
  const bad: string[] = []
  for (const [k, unit] of [[0.001, 1000], [0.1, 10]] as const) {
    const a = analyse(scaleDoc(doc, k))
    const ok = a.plans.length === 2 && a.plans.every((p) => p.unit === unit) && a.recs.every((r, i) => r.warnings.some((w) => w.code === 'unitsScaled' && w.n === unit) && r.rooms.map((x) => `${x.name}:${x.area}`).sort().join() === truth.floors[i].rooms.map((x) => `${x.name}:${x.area}`).sort().join() && r.walls.every((w) => w.t === 220 || w.t === 110))
    if (!ok) bad.push(`×${k}: ${a.plans.length} plans ${a.recs.map((r) => r.rooms.map((x) => `${x.name}:${x.area}`).join('/')).join(' | ')}`)
  }
  check('units: the house drawn in metres / centimetres — the walls 0.22 / 22 units thick say so: read in millimetres (rooms, walls exact), flagged; a millimetre drawing untouched', !bad.length && analyse(doc).plans.every((p) => !p.unit), bad.join('; '))
}
