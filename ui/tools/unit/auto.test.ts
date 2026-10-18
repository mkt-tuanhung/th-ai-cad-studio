// One-command pipeline, dialogs' helpers and quantities (run: UNIT=auto node tools/test-cam.mjs run).
//   price lists (VN / EN numbers, delimiters, BOM, headers), AI-vs-rule merge, elevations missing from titles,
//   file classification (several files in any order), drawing units (INSUNITS), BOQ level columns, roof-slab
//   deduction under beams, stair concrete formula, package file names / BOM, earthwork machine / hand split.
import { decodeDxf, dxfInsunits, importDxf } from '../../src/cad/dxfImport'
import { detectUnits, readDrawing, scaleDrawing } from '../../src/cad/batch'
import type { CadDocument, Entity } from '../../src/cad/types'
import { layerStats, type LayerRole, type LayerStat } from '../../src/bim/fromCad'
import { boq, csvDelimiter, parseNumber, readPriceList, stairConcrete, UNASSIGNED } from '../../src/bim/quantities'
import { stairFlight } from '../../src/bim/scene'
import { aiCandidate, classifyFile, fileHint, inferElevations, mergeAiRoles, runAuto } from '../../src/auto/pipeline'
import { BOM, defaultCam, earthSplit, machineShare, makePackage, safeFileName, uniqueNames } from '../../src/auto/package'
import type { CivilRole } from '../../src/civil/fromCad'
import { createNorthCanal, type CivilModel } from '../../src/civil/model'
import { autoEn } from '../../src/i18n/ws/auto'
import { fromCadEn } from '../../src/i18n/ws/fromCad'
import type { BuildNames } from '../../src/bim/fromCadBuild'
import { DEFAULT_CAM } from '../../src/cam/gcode'

const proc = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(m: string): { readFileSync(p: string, enc: string): string } } }).process
const readFileSync = (p: string, enc: string) => proc.getBuiltinModule('node:fs').readFileSync(p, enc)
const FX = `${proc.cwd()}/../qa/fixtures/`

function load(latin1: string, name: string): CadDocument {
  const bytes = new Uint8Array(latin1.length)
  for (let i = 0; i < latin1.length; i++) bytes[i] = latin1.charCodeAt(i)
  const r = importDxf(decodeDxf(bytes).text)
  return { id: name, name, entities: r.entities, layers: [], currentLayer: '0', underlay: null, blocks: [], dirty: false, createdAt: 0, savedAt: null, source: 'dxf-import' }
}
const NAMES: BuildNames = {
  roofLevel: 'Roof', room: (n) => `Room ${n}`, wallExt: (t) => `Ext ${t}`, wallInt: (t) => `Int ${t}`, curtain: (t) => `CW ${t}`,
  door: 'Door', doubleDoor: 'Double door', opening: 'Opening', window: 'Window', furniture: fromCadEn.furniture,
}
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b))

export async function run() {
  const out: string[] = []
  let fails = 0
  const check = (name: string, ok: boolean, extra = '') => { if (!ok) fails++; out.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`) }

  /* ---------------------------------------------------------------- A5 / B14: price lists */
  {
    const n = (s: string, vn = false) => parseNumber(s, vn)
    check('numbers: VN thousands "1.250.000", "1.250.000 đ", "1 250 000"', n('1.250.000') === 1250000 && n('1.250.000 đ') === 1250000 && n('1 250 000') === 1250000 && n('1 250 000 VNĐ') === 1250000)
    check('numbers: "1.234,5" and "1,234.5" both 1234.5', n('1.234,5') === 1234.5 && n('1,234.5') === 1234.5)
    check('numbers: "12,50" (VN decimal comma) 12.5, "90%" 90, "-3.5"', n('12,50', true) === 12.5 && n('90%') === 90 && n('-3.5') === -3.5)
    check('numbers: one separator + 3 digits by the list locale ("1.250" VN 1250, EN 1.25; "1,250" EN 1250)', n('1.250', true) === 1250 && n('1.250', false) === 1.25 && n('1,250', false) === 1250 && n('1,250', true) === 1.25)
    check('numbers: not numbers → null ("abc", "1.2.3,4.5", "")', n('abc') === null && n('1.2.3,4.5') === null && n('') === null)
    const vn = '﻿Mã;Hạng mục;Đơn vị;Khối lượng;Đơn giá\r\nslab;Bê tông sàn;m3;12,50;1.250.000\r\nbeam;"Dầm; bê tông";m3;3;1.250.000 đ\r\ncolumn;Cột;m3;1;abc\r\nfooting;Đài móng;m3;2;\r\n'
    const p = readPriceList(vn)
    check('VN ";" CSV with BOM: delimiter ";", slab 1 250 000 (not 50), quoted ";" kept', p.delimiter === ';' && p.map.get('slab') === 1250000 && p.map.get('beam') === 1250000 && p.map.get('item:dầm; bê tông') === 1250000, JSON.stringify([...p.map]))
    check('VN CSV: the unreadable price is reported (line 4), the empty one is not an error', p.bad.length === 1 && p.bad[0].line === 4 && p.bad[0].why === 'price' && p.read === 2, JSON.stringify(p.bad))
    const en = 'Key,Item,Unit,Total,Unit price\nslab,Slab,m3,12.5,"1,250,000"\ncolumn,Column,m3,1,1234.5\nmachineShare,share,%,,90%\n'
    const e = readPriceList(en)
    check('EN "," CSV: "1,250,000" quoted, 1234.5, machineShare "90%" → 0.9', e.delimiter === ',' && e.map.get('slab') === 1250000 && e.map.get('column') === 1234.5 && machineShare(e.map) === 0.9)
    const sep = readPriceList('sep=;\nKey;Unit price\nslab;2,5\n')
    check('Excel "sep=;" line honoured', sep.delimiter === ';' && sep.map.get('slab') === 2.5)
    const tab = readPriceList('Ma\tHang muc\tDon gia\nslab\tSan\t1.000.000\n')
    check('tab list, headers without diacritics (Ma / Hang muc / Don gia)', tab.delimiter === '\t' && tab.map.get('slab') === 1000000)
    const amt = readPriceList('Mã,Hạng mục,Thành tiền,Đơn giá\nslab,Sàn,99,7\n')
    check('the price column is "Đơn giá", never "Thành tiền"', amt.map.get('slab') === 7)
    check('no price column: said so, nothing read', readPriceList('a,b\n1,2\n').noPriceColumn)
    check('delimiter detection ignores separators inside quotes', csvDelimiter('"a;b;c",x,y\n').delim === ',')
    const fx = readPriceList(readFileSync(FX + 'prices/don_gia_TEST_khong_phai_gia_that.csv', 'utf8'))
    check('the test price list of the repo still reads (1.000.000)', fx.map.get('slab') === 1000000 && fx.bad.length === 0, `${fx.read} read, ${fx.bad.length} bad`)
  }

  /* ---------------------------------------------------------------- A3: AI never overrides a rule */
  {
    const st = (name: string, by: LayerStat['by'], role: LayerRole = 'ignore'): LayerStat => ({ name, count: 20, kinds: { line: 20 }, texts: [], blocks: [], pairRatio: 0, role, by })
    const stats = [st('TN', 'none'), st('MAT DAT TN', 'none'), st('THIET KE', 'none'), st('TK', 'none'), st('DUONG DONG', 'none'), st('KICH THUOC', 'rule'), st('TUONG', 'rule', 'wall'), st('LAYER_X', 'none')]
    const asked = stats.filter(aiCandidate).map((s) => s.name)
    check('AI asked only about layers no rule knows (not TN / MAT DAT TN / THIET KE / TK / DUONG DONG / KICH THUOC / TUONG)', JSON.stringify(asked) === '["LAYER_X"]', asked.join(','))
    const house = Object.fromEntries(stats.map((s) => [s.name, s.role])) as Record<string, LayerRole>
    const civil: Record<string, CivilRole> = { TN: 'ground', 'MAT DAT TN': 'ground', 'THIET KE': 'design', TK: 'design', 'DUONG DONG': 'ignore', 'KICH THUOC': 'ignore', TUONG: 'ignore', LAYER_X: 'ignore' }
    const set = mergeAiRoles(stats, house, civil, { 'KICH THUOC': 'wall', TUONG: 'door', LAYER_X: 'wall' }, { TN: 'design', 'THIET KE': 'ground', TK: 'ground', 'DUONG DONG': 'ground', 'KICH THUOC': 'design', LAYER_X: 'ground' })
    check('civil rule kept: TN / MAT DAT TN ground, THIET KE / TK design', civil.TN === 'ground' && civil['MAT DAT TN'] === 'ground' && civil['THIET KE'] === 'design' && civil.TK === 'design')
    check('excluded on purpose stays out: DUONG DONG / KICH THUOC never ground / design', civil['DUONG DONG'] === 'ignore' && civil['KICH THUOC'] === 'ignore')
    check('house rule kept: KICH THUOC ignore, TUONG wall', house['KICH THUOC'] === 'ignore' && house.TUONG === 'wall')
    check('the AI fills only the unknown layer (marked AI)', house.LAYER_X === 'wall' && civil.LAYER_X === 'ground' && JSON.stringify(set) === '["LAYER_X"]', set.join(','))
  }

  /* ---------------------------------------------------------------- B8: elevations missing from the titles */
  {
    const H = 3300
    const e = (items: { order: number | null; elevation: number | null; roof?: boolean }[], roofEl: number | null = null) => inferElevations(items.map((x) => ({ roof: false, ...x })), H, roofEl)
    const a = e([{ order: 1, elevation: 0 }, { order: 2, elevation: null }, { order: 3, elevation: 6600 }])
    check('"TẦNG 1 ±0", "TẦNG 2" (none), "TẦNG 3 +6.600" → Tầng 2 at +3.300, flagged', a[1].elevation === 3300 && a[1].inferred === 'between' && a[0].inferred === null)
    const b = e([{ order: 0, elevation: -3000 }, { order: null, elevation: null }])
    check('basement −3.000 + untitled plan → the untitled one at ±0.000 (not +3.300)', b[1].elevation === 0 && b[1].inferred === 'free', JSON.stringify(b))
    const c = e([{ order: 1, elevation: 0 }, { order: null, elevation: null }])
    check('titled ground + untitled → a storey above', c[1].elevation === 3300)
    const d = e([{ order: null, elevation: null }, { order: null, elevation: null }, { order: null, elevation: null }])
    check('three untitled → 0 / 3300 / 6600', d.map((x) => x.elevation).join() === '0,3300,6600')
    const f = e([{ order: 2, elevation: null }, { order: 3, elevation: null }])
    check('numbered, no titled level: (n − 1) × storey from ±0', f[0].elevation === 3300 && f[1].elevation === 6600)
    const g = e([{ order: 0, elevation: null }, { order: 1, elevation: 0 }])
    check('basement without elevation: a storey under the ground (negative)', g[0].elevation === -3300)
    const h = e([{ order: 1, elevation: 0 }, { order: 1.5, elevation: null }, { order: 2, elevation: 3600 }])
    check('mezzanine between ground and Tầng 2', h[1].elevation === 1800)
    const r = e([{ order: 1, elevation: 0 }, { order: 2, elevation: 3600 }, { order: 99, elevation: null, roof: true }], 7500)
    check('roof plan without elevation: the roof title elevation (else a storey above)', r[2].elevation === 7500 && e([{ order: 1, elevation: 0 }, { order: 99, elevation: null, roof: true }])[1].elevation === 3300)
    const k = e([{ order: 1, elevation: 0 }, { order: 2, elevation: 3300 }, { order: 3, elevation: null }, { order: null, elevation: null }])
    const els = k.map((x) => x.elevation)
    check('never two plans at one elevation', new Set(els).size === els.length, els.join())
  }

  /* ---------------------------------------------------------------- B12: files by content, names as hints */
  {
    check('names: NHA_KC.dwg / KẾT CẤU.dxf / S-101.dwg → structure', fileHint('NHA_KC.dwg') === 'structure' && fileHint('Bản vẽ KẾT CẤU.dxf') === 'structure' && fileHint('S-101.dwg') === 'structure' && fileHint('nha_ket_cau.dxf') === 'structure')
    check('names: DIEN NUOC.dwg / ĐIỆN.dwg / NHA_CTN.dxf / PCCC.dwg / E-101.dwg → MEP', ['DIEN NUOC.dwg', 'ĐIỆN.dwg', 'NHA_CTN.dxf', 'PCCC tang 1.dwg', 'E-101.dwg', 'ELV.dxf', 'Nha_MEP.dwg'].every((x) => fileHint(x) === 'mep'))
    check('names: house_vn_SYNTHETIC.dxf → no hint; NHA_KT.dwg → architecture', fileHint('house_vn_SYNTHETIC.dxf') === null && fileHint('NHA_KT.dwg') === 'arch')
    const fake = (titles: string[]) => titles.map((t) => ({ region: { title: t } })) as unknown as Parameters<typeof classifyFile>[1]['plans']
    check('content: plans with rooms → architecture', classifyFile('A.dwg', { plans: fake(['MẶT BẰNG TẦNG 1']), structure: false, mep: true }) === 'arch')
    check('content: plans titled MẶT BẰNG CẤP NƯỚC → MEP (architecture underneath)', classifyFile('A.dwg', { plans: fake(['MẶT BẰNG CẤP NƯỚC TẦNG 1', 'MẶT BẰNG ĐIỆN TẦNG 2']), structure: false, mep: true }) === 'mep')
    check('content: no plans, structural layers → structure', classifyFile('A.dwg', { plans: [], structure: true, mep: false }) === 'structure')
    // two files in any order: the plans are read from the architectural one, the "KC" copy is not doubled
    const latin = readFileSync(FX + 'bim/house_vn_SYNTHETIC.dxf', 'latin1')
    const kt = load(latin, 'NHA_KT.dxf'), kc = load(latin, 'NHA_KC.dxf')
    const opt = { host: null, useAi: false, names: NAMES, levelName: (n: number) => `Level ${n}`, civilBase: createNorthCanal() }
    const one = await runAuto(kt, opt)
    const two = await runAuto(kc, { ...opt, extras: [kt] })
    check('multi-file: structural-named file first → plans still from the architectural one', two.file === 'NHA_KT.dxf' && two.files.find((f) => f.name === 'NHA_KC.dxf')?.kind === 'structure' && two.files.find((f) => f.name === 'NHA_KT.dxf')?.usedForPlans === true)
    check('multi-file: same levels as the single file (no level doubled)', two.house?.built.model.levels.length === one.house?.built.model.levels.length && two.house?.built.counts.walls === one.house?.built.counts.walls, `${two.house?.built.model.levels.length} / ${one.house?.built.model.levels.length}`)
    const both = await runAuto(load(latin, 'A.dxf'), { ...opt, extras: [load(latin, 'B.dxf')] })
    check('two architectural files with the same levels: merged, the duplicates said', both.house?.built.model.levels.length === one.house?.built.model.levels.length && (both.house?.duplicates.length ?? 0) > 0)
    check('warnings labelled by each plan\'s own level', one.house!.recLevels.length === one.house!.recs.length && one.house!.recLevels.every((n) => one.house!.built.model.levels.some((l) => l.name === n)))
  }

  /* ---------------------------------------------------------------- B13: drawing units */
  {
    const dxf = (u: number | null) => `0\nSECTION\n2\nHEADER\n${u === null ? '' : `9\n$INSUNITS\n70\n${u}\n`}9\n$ACADVER\n1\nAC1015\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nTUONG\n10\n0\n20\n0\n11\n12.5\n21\n0\n0\nTEXT\n8\nTEXT\n10\n1\n20\n1\n40\n0.25\n1\nPHONG\n0\nENDSEC\n0\nEOF\n`
    check('$INSUNITS read from the header (6 m, 5 cm, none → null)', dxfInsunits(dxf(6)) === 6 && dxfInsunits(dxf(5)) === 5 && dxfInsunits(dxf(null)) === null && importDxf(dxf(4)).insunits === 4)
    const m = await readDrawing(new File([dxf(6)], 'm.dxf'))
    const line = m.doc.entities.find((x) => x.kind === 'line') as Extract<Entity, { kind: 'line' }>
    const text = m.doc.entities.find((x) => x.kind === 'text') as Extract<Entity, { kind: 'text' }>
    check('a drawing in metres is read in mm (12.5 m line → 12 500 mm, text 0.25 → 250)', m.units.factor === 1000 && m.units.source === 'header' && near(line.b.x, 12500) && near(text.height, 250), JSON.stringify(m.units))
    const cm = await readDrawing(new File([dxf(5)], 'cm.dxf'))
    check('a drawing in cm ×10', cm.units.unit === 'cm' && near((cm.doc.entities.find((x) => x.kind === 'line') as Extract<Entity, { kind: 'line' }>).b.x, 125))
    const mm = await readDrawing(new File([dxf(4)], 'mm.dxf'))
    check('a drawing in mm unchanged', mm.units.factor === 1 && near((mm.doc.entities.find((x) => x.kind === 'line') as Extract<Entity, { kind: 'line' }>).b.x, 12.5))
    // no header: a building in metres (tens of units across, texts a fraction of a unit) is guessed
    const base = { id: 'e', layer: '0', color: 'ByLayer', linetype: 'ByLayer' as const, lineweight: 'ByLayer' as const, transparency: 0 }
    const meters: Entity[] = [{ ...base, kind: 'line', a: { x: 0, y: 0 }, b: { x: 20, y: 0 } }, { ...base, kind: 'line', a: { x: 0, y: 12 }, b: { x: 20, y: 12 } }, ...[1, 2, 3, 4].map((i): Entity => ({ ...base, kind: 'text', p: { x: i * 4, y: 6 }, height: 0.25, value: 'P', rotation: 0, align: 'left' }))]
    const g = detectUnits(0, meters)
    check('INSUNITS 0, metre-sized geometry → guessed m (×1000, warned)', g.factor === 1000 && g.source === 'guess' && g.note === 'guessM')
    const mmEnts: Entity[] = meters.map((x) => (x.kind === 'line' ? { ...x, a: { x: x.a.x * 1000, y: x.a.y * 1000 }, b: { x: x.b.x * 1000, y: x.b.y * 1000 } } : x.kind === 'text' ? { ...x, p: { x: x.p.x * 1000, y: x.p.y * 1000 }, height: 250 } : x))
    const u = detectUnits(null, mmEnts)
    check('no header, mm-sized geometry → mm, said "not set"', u.factor === 1 && u.source === 'assumed' && u.note === 'noHeader')
    check('unknown INSUNITS code → mm with a note', detectUnits(99, mmEnts).note === 'unknownCode')
    const sc = scaleDrawing(meters, [{ id: 'l', name: 'L', paper: 'A3', scale: 0.1 }], 1000)
    check('scaling: positions, text heights and viewport scales', near((sc.entities[0] as Extract<Entity, { kind: 'line' }>).b.x, 20000) && near((sc.entities[2] as Extract<Entity, { kind: 'text' }>).height, 250) && sc.layouts?.[0].scale === 100)
    // the house fixture is in mm (INSUNITS 4): unchanged
    const fx = await readDrawing(new File([new Uint8Array(readFileSync(FX + 'bim/house_vn_SYNTHETIC.dxf', 'latin1').split('').map((c) => c.charCodeAt(0)))], 'house.dxf'))
    check('the house fixture (INSUNITS 4) stays in mm', fx.units.factor === 1 && fx.units.insunits === 4)
  }

  /* ---------------------------------------------------------------- quantities: level columns, roof slab, stairs */
  const latin = readFileSync(FX + 'bim/house_vn_SYNTHETIC.dxf', 'latin1')
  const opt = { host: null, useAi: false, names: NAMES, levelName: (n: number) => `Level ${n}`, civilBase: createNorthCanal() }
  const house = await runAuto(load(latin, 'house.dxf'), opt)
  const m = house.house!.built.model
  {
    // an element on a level that is not in the model: its quantity goes to the unassigned column
    const ghost = { ...m, columns: [...m.columns, { ...m.columns[0], id: 'Cghost', mark: 'Cghost', level: 'L-gone', topLevel: m.levels[1].id }] }
    const rows = boq(ghost, autoEn.boq.words)
    const sums = rows.every((r) => near(Object.values(r.byLevel).reduce((a, v) => a + v, 0), r.total, 1e-9))
    check('BOQ: the level columns add up to the total on every line', sums, rows.filter((r) => !near(Object.values(r.byLevel).reduce((a, v) => a + v, 0), r.total, 1e-9)).map((r) => r.key).join(','))
    const col = rows.find((r) => r.key === 'column')!
    check('BOQ: the element on no level is in the "No level (unassigned)" column', (col.byLevel[autoEn.boq.words.unassigned] ?? 0) > 0 && UNASSIGNED === 'Unassigned')
    // a beam under the automatic roof slab: only its depth below the slab is billed
    const roof = m.slabs.find((s) => s.kind === 'roof')
    if (roof) {
      const xs = roof.outline.map((p) => p[0]), ys = roof.outline.map((p) => p[1])
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2
      const beam = { id: 'Bt', category: 'beam' as const, mark: 'Bt', level: roof.level, topOffset: 0, x: cx - 500, y: cy, angle: 0, length: 1000, b: 220, h: 400 }
      const bm = { ...m, beams: [beam], columns: [] }
      const v = boq(bm, autoEn.boq.words).find((r) => r.key === 'beam')!.total
      check('roof beams: the roof slab thickness deducted (no double concrete)', near(v, (220 * (400 - roof.thickness) * 1000) / 1e9, 1e-9), `${v} vs ${(220 * (400 - roof.thickness) * 1000) / 1e9}`)
    } else check('roof beams: the fixture has a roof slab', false)
    // stairs: steps + waist slab by formula
    const v1 = stairConcrete(10, 170, 2500, 1000)
    check('stair formula: n·½·r·g·w + t·√(run²+rise²)·w (10 × 170 / 2500 × 1000 → 0.666 m³)', near(v1, 0.2125 + (150 * Math.hypot(2500, 1700) * 1000) / 1e9, 1e-12) && v1 > 0.66 && v1 < 0.67)
    check('stair formula: unit check — doubling the width doubles it, zero risers → 0', near(stairConcrete(10, 170, 2500, 2000), 2 * v1, 1e-12) && stairConcrete(0, 170, 2500, 1000) === 0)
    const st = m.stairs.find((x) => !x.spiral) ?? { id: 'S-t', category: 'stair' as const, mark: 'S-t', baseLevel: m.levels[0].id, topLevel: m.levels[1].id, x: 0, y: 0, angle: 0, length: 3000, width: 1000 }
    {
      const { n, riser } = stairFlight(m, st)
      const row = boq({ ...m, stairs: [st] }, autoEn.boq.words).find((r) => r.key === 'stair')!
      check('BOQ stair line = the formula', near(row.total, stairConcrete(n, riser, st.length, st.width), 1e-9))
    }
  }

  /* ---------------------------------------------------------------- package: names, BOM, earthwork split */
  {
    check('file names: "1/A" → "1-A", "a\\\\b:c" safe, trailing dots gone', safeFileName('Section 1/A') === 'Section 1-A' && safeFileName('a\\b:c?.') === 'a-b c' && safeFileName('///') === '-')
    const u = uniqueNames([{ name: 'a.csv' }, { name: 'A.csv' }, { name: 'a.csv' }])
    check('file names made unique (case-insensitive)', u.map((x) => x.name).join('|') === 'a.csv|A (2).csv|a (3).csv')
    const T = autoEn
    const text = { plan: (lv: string) => `Floor plan ${lv}`.trim(), views: T.viewsPdf, boq: { ...T.boq, prices: null }, mep: T.mep, profile: T.profile, sections: T.sections, words: T.words, report: (b: string) => b }
    const files = makePackage(house, defaultCam(DEFAULT_CAM), text, { house: true, interior: true, route: true })
    const csvs = files.filter((f) => f.name.endsWith('.csv'))
    check('every CSV starts with the UTF-8 BOM (Excel on Windows)', csvs.length > 3 && csvs.every((f) => f.kind === 'text' && f.text.startsWith(BOM)), csvs.map((f) => f.name).join(', '))
    check('every package name safe and unique', files.every((f) => f.name === safeFileName(f.name)) && new Set(files.map((f) => f.name.toLowerCase())).size === files.length)
    const tpl = csvs.find((f) => f.name.includes(T.boq.priceTemplate))
    const back = tpl && tpl.kind === 'text' ? readPriceList(tpl.text.replace(/,\n/g, ',1.000\n')) : null
    check('the price template, re-read (BOM, its own headers), gives prices back', !!back && !back.noPriceColumn && back.map.size > 0, back ? `${back.read}` : 'no template')
    // earthwork machine / hand
    const cm: CivilModel = createNorthCanal()
    const secs = [0, 50, 100].map((s) => ({ name: `C${s}`, station: s, ground: [[-5, 1], [5, 1]] as [number, number][], design: [[-5, 0], [5, 0]] as [number, number][], cut: 10, fill: 2 }))
    const plain = { ...cm, sections: secs }
    const d1 = earthSplit(plain)
    check('no split on the drawing, no price list → 90 / 10, said so', d1.source === 'default' && near(d1.total.cutM / d1.total.cut, 0.9))
    const d2 = earthSplit(plain, new Map([['machineShare', 95]]))
    check('price list machineShare 95 → 95 %', d2.source === 'prices' && near(d2.total.cutM / d2.total.cut, 0.95))
    const des = { ...cm, sections: secs.map((x) => ({ ...x, cutMachine: 7, cutManual: 3, fillMachine: 1, fillManual: 1 })) }
    const d3 = earthSplit(des, new Map([['machineShare', 95]]))
    check('the designer\'s split on the sections wins (cut 70 %, fill 50 %)', d3.source === 'drawing' && near(d3.total.cutM / d3.total.cut, 0.7) && near(d3.total.fillM / d3.total.fill, 0.5))
  }

  out.push(fails ? `FAILED ${fails}` : 'ALL PASS')
  return out.join('\n')
}
