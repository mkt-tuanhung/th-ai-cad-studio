// Plan → BIM recognition and model building (run: UNIT=fromcad node tools/test-cam.mjs run <file.dxf> [truth.json]).
//   run      the SYNTHETIC fixture against its ground truth (qa/fixtures/bim/house_vn_SYNTHETIC.truth.json),
//            the 30°-rotated copy against the same truth, unit checks of the text parsers and the layer rules
//   villa    recognition summary of another DXF (e.g. the VILLA_150 test set) for the QA notes
//   ifc      IFC 4 text of the model built from a DXF (checked with tools/check_ifc.py)
import { decodeDxf, importDxf } from '../../src/cad/dxfImport'
import type { CadDocument } from '../../src/cad/types'
import { dominantAngle, findPlans, layerStats, norm, parseElevation, parseMark, parseSize, recognize, ruleRole, segsOf, type LayerRole } from '../../src/bim/fromCad'
import { buildBimModel, buildInterior, DEFAULT_BUILD, type BuildNames } from '../../src/bim/fromCadBuild'
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
    // one command: elevations named by the grids they show (Vietnamese convention), sections 1-1 / 2-2 marked on the plans
    const titles = viewRequests(m, autoVi.viewWords).map((r) => r.title)
    check(`${label}: elevations named by their grids, sections 1-1 and 2-2`, /^Mặt đứng trục 1-\d+$/.test(titles[0]) && /^Mặt đứng trục A-[B-Z]$/.test(titles[1]) && /^Mặt đứng trục \d+-1$/.test(titles[2]) && /^Mặt đứng trục [B-Z]-A$/.test(titles[3]) && titles[4] === 'Mặt cắt 1-1' && titles[5] === 'Mặt cắt 2-2', titles.join(' | '))
    const plan = planDocument(m, 'L1', 'Mặt bằng tầng 1', [{ axis: 'y', at: 4500, label: '1' }, { axis: 'x', at: 6000, label: '2' }])
    check(`${label}: section cuts drawn on the floor plan (both ends, arrow, number)`, plan.entities.filter((e) => e.layer === 'A-SECT').length === 12 && plan.entities.filter((e) => e.kind === 'text' && (e.value === '1' || e.value === '2') && e.layer === 'A-ANNO-TEXT').length === 4)
  }
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
