/**
 * Machine library acceptance: template → profile, posts per controller family, Weihong multi-spindle, RichAuto,
 * panel-saw guillotine nesting, hardware drilling, vendor-CAM DXF, router saw unit, commissioning wizard → VERIFIED
 * → production export, then a tool change → blocked again.
 * Run: UNIT=machlib node tools/test-cam.mjs run → { all, passed, total, failed, results }.
 *
 * Machines named TEST-… are synthetic fixtures (measured values typed in by the test) that prove the gate CAN open;
 * they describe no real machine. Library templates are the generic seed / research reference data.
 */
import { CABINETS, type Cabinet } from '../../src/interior/model'
import { DEFAULT_CAM } from '../../src/cam/gcode'
import { DEFAULT_NEST, piecesOf, rotations } from '../../src/cam/nesting'
import { capabilities, commission, machineBlockers, profileContentHash, releaseBlockers, reviseProfile, type MachineProfile, type MachineTool } from '../../src/cam/machine'
import { approveJob, newJob, type ManufacturingJob } from '../../src/cam/job'
import { interiorCnc, type CamPrefsLike } from '../../src/cam/interiorJob'
import { parseNc } from '../../src/cam/ncparse'
import { POSTS, codesIn, postIdForFamily } from '../../src/cam/posts'
import { ProductionBlocked, productionFiles, productionSawFiles } from '../../src/cam/release'
import { sha256 } from '../../src/lib/sha256'
import { LIBRARY, familyById, familyCodes, searchTemplates, similarTemplates, templateById } from '../../src/cam/library'
import { templateToProfile } from '../../src/cam/library/fromTemplate'
import { blankOwnProfile, newHead, validateOwnProfile } from '../../src/cam/library/own'
import { hardwarePlan } from '../../src/cam/hardware'
import { guillotineNest, verifyAll, verifyGuillotine, patternSvg } from '../../src/cam/guillotine'
import { vendorDxfFiles } from '../../src/cam/vendorDxf'
import { automatedChecks, newWizard, wizardInput, SURVEY_ITEMS } from '../../src/cam/commissioning'
import type { ControllerFamilyId } from '../../src/cam/library/types'

type R = { id: string; pass: boolean; detail?: unknown }
const results: R[] = []
const check = (id: string, pass: boolean, detail?: unknown) => results.push({ id, pass: !!pass, ...(pass ? {} : { detail }) })
const has = (list: string[], code: string) => list.some((b) => b === code || b.startsWith(`${code}:`))
const blocked = (fn: () => unknown): string[] | null => {
  try {
    fn()
    return null
  } catch (e) {
    return e instanceof ProductionBlocked ? e.blockers : [`THREW:${String(e)}`]
  }
}
const AT = '2026-10-18T08:00:00.000Z'
const KITCHEN = CABINETS.find((c) => c.id === 'c2')!
const PREFS: CamPrefsLike = { stock: {}, trim: 10, web: 4, grain: true, cnc: { ...DEFAULT_CAM, dialect: 'iso' } }
const code = (t: string) => t.split('\n').map((l) => l.replace(/\(.*?\)/g, '').replace(/;.*$/, '').trim())
const tool = (id: string, kind: string, d: number, n: number): MachineTool => ({ tool_id: id, kind, diameter_mm: d, actual_calibrated: true, number: n, length_mm: 60 })
const TOOLS = () => [tool('EM8', 'END_MILL', 8, 1), tool('DR5', 'DRILL', 5, 2), tool('FO35', 'FORSTNER', 35, 3)]

/** Fill in what a workshop measures (TEST values): controller identity, origin, safe Z, offsets, tools. */
function measured(p: MachineProfile, patch: Partial<MachineProfile> = {}, tools = TOOLS()): MachineProfile {
  const heads = p.heads.map((h, i) => ({ ...h, offset_mm: { x: 0, y: i * 100, z: 0 }, offset_calibrated: true, activation_mapping_verified: true, tools: h.type === 'ROUTER_SPINDLE' && i === 0 ? tools : h.tools.map((t) => ({ ...t, diameter_mm: t.diameter_mm ?? 5, actual_calibrated: true, kind: t.kind === 'UNASSIGNED' ? 'END_MILL' : t.kind })) }))
  return {
    ...p, controller: { ...p.controller, firmware: 'TEST-FW-1', manual_reference: 'TEST manual rev A', model: p.controller.model ?? 'TEST' },
    origin: { stock_corner: 'LOWER_LEFT', z_reference: 'BOARD_TOP', work_offset: 'G54', home_calibrated: true }, fixtures: { ...p.fixtures, safe_clearance_mm: 10 }, heads, ...patch,
  }
}
const job = (m: MachineProfile | null, mfc = 18): ManufacturingJob => {
  const j = newJob('TEST-JOB', m ? { profile_id: m.profile_id, revision: m.revision, hash: profileContentHash(m) } : null)
  const st = (material: string, nominal: number, t: number) => ({ material, nominal_mm: nominal, measured_thickness_mm: t, lot: 'TEST-LOT', length_mm: 2440, width_mm: 1830, grain_axis: 'X' as const, face_a: 'inside' })
  const stocks = ['MFC 18 - Oak', 'MFC 18 - Walnut'].map((m0) => st(m0, 18, mfc)).concat([st('HDF 6 - White', 6, 6)])
  return { ...j, stocks, stock: stocks[0], edge_band_confirmed: true }
}
const cncOf = (m: MachineProfile | null, cabs: Cabinet[] = [KITCHEN], j: ManufacturingJob | null = m ? job(m) : null, com: ReturnType<typeof commission>['record'] | null = null) =>
  interiorCnc({ cabinets: cabs, cam: PREFS, machine: m, machineProfileId: m?.profile_id ?? null, commissioning: com, job: j, jobName: 'TEST' })
const texts = (c: ReturnType<typeof cncOf>) => c.sheets.flatMap((s) => s.programs.map((p) => p.text))
const allCodes = (c: ReturnType<typeof cncOf>) => [...new Set(texts(c).flatMap(codesIn))]

/** A TEST profile of a controller family: one router head with EM8 / DR5 / FO35, the family's documented codes. */
function familyMachine(fam: ControllerFamilyId, opts: { atc?: boolean; postId?: string } = {}): MachineProfile {
  const p = blankOwnProfile(`TEST-${fam}`, fam)
  const post = opts.postId ? POSTS[opts.postId as keyof typeof POSTS] : null
  const m = measured({ ...p, manufacturer: 'TEST-OEM', machine_model: 'TEST', work_envelope_mm: { x: 3100, y: 2100, z: 200 }, atc: { supported: opts.atc ?? true, magazine_slots: opts.atc === false ? 0 : 8 } })
  return {
    ...m, postprocessor: post ? { id: post.id, version: post.version, sha256: post.sha256, approved_for_controller: false } : m.postprocessor,
    ext: { ...m.ext, file_extension: m.ext?.file_extension ?? '.nc', tool_length_mode: m.ext?.tool_length_mode ?? (opts.atc === false ? null : 'G43') },
  }
}


/** Program heads per family post (for the QA report). */
export function samples() {
  const out: Record<string, string> = {}
  for (const [fam, atc] of [['SYNTEC', true], ['FANUC', true], ['SIEMENS_840D', true], ['OSAI', true], ['RICHAUTO_DSP', false], ['MACH3', false]] as [ControllerFamilyId, boolean][]) {
    const m = familyMachine(fam, { atc })
    if (fam === 'OSAI') m.ext = { ...m.ext, tool_length_mode: 'AUTO_ON_TOOL_CHANGE' }
    const c = cncOf(m)
    const p = c.sheets[1]?.programs[0] ?? c.sheets[0].programs[0]
    out[`${m.postprocessor.id} (${fam}, ATC ${atc ? 'yes' : 'no'}) ${p.name}`] = p.text.split('\n').slice(0, 16).join('\n')
  }
  return out
}

export function run() {
  /* ------------------------------------------------ library data + search */
  check('library: seed / research data loaded (machines, 12 controller families, hardware)', LIBRARY.machines.length >= 5 && LIBRARY.controllers.length === 12 && LIBRARY.hardware.length >= 4, LIBRARY.origin)
  const saws = searchTemplates({ category: 'panel-saw' })
  check('library search: category filter', saws.length >= 1 && saws.every((t) => t.category === 'panel-saw'))
  const big = searchTemplates({ minL: 2440, minW: 1830 })
  check('library search: table-size filter (2440 × 1830 sheet fits, either orientation)', big.length > 0 && big.every((t) => { const x = t.work_envelope_mm.x ?? 0, y = t.work_envelope_mm.y ?? 0; return (x >= 2440 && y >= 1830) || (x >= 1830 && y >= 2440) }))
  const t2131 = templateById('generic-nesting-router-2131-atc')!
  const sim = similarTemplates(t2131, 3)
  check('library: similar machines (same category / controller / size first, never itself)', sim.length > 0 && !sim.some((t) => t.id === t2131.id) && (sim[0].category === t2131.category || sim[0].controller_family === t2131.controller_family), sim.map((t) => t.id))
  const grbl = familyCodes(familyById('GRBL'))
  check('controller notes → codes: GRBL never gets M6 / G43 / canned cycles', !grbl.includes('M6') && !grbl.includes('G43') && !grbl.includes('G81') && grbl.includes('G21') && grbl.includes('M3'), grbl)

  /* ------------------------------------------------ template → profile */
  const t4 = templateById('generic-4-process-router-ncstudio')!
  const { profile: p4, todo: todo4 } = templateToProfile(t4, { profileId: 'TEST-4P', at: AT })
  check('template → profile: 4-process = 4 router heads (1 main + 3 pneumatic), no ATC, Weihong post, family codes, UNVERIFIED, nothing measured',
    p4.status === 'UNVERIFIED' && !p4.production_export_allowed && p4.heads.length === 4 && p4.heads.every((h) => h.type === 'ROUTER_SPINDLE' && h.offset_mm.x === null && !h.offset_calibrated) && !p4.atc.supported &&
    p4.postprocessor.id === 'weihong' && !p4.postprocessor.approved_for_controller && p4.controller.supported_codes.join() === familyCodes(familyById('WEIHONG_NCSTUDIO')).join() && p4.controller.firmware === null &&
    p4.fixtures.clamp_no_go_shapes.length === 0 && p4.fixtures.safe_clearance_mm === null && p4.ext?.provenance?.template_id === t4.id && p4.ext.head_info?.[1].power_kw === 3.5 && todo4.includes('SPINDLE_SELECT') && todo4.includes('HEAD_OFFSETS'),
    { heads: p4.heads.length, post: p4.postprocessor.id, todo4 })
  const tptp = templateById('generic-ptp-centre-vendor-cam')!
  const pp = templateToProfile(tptp, { profileId: 'TEST-PTP' }).profile
  const db = pp.heads.find((h) => h.type === 'DRILL_BANK')
  check('template → profile: drill bank (21 V + 8 H) + groove saw heads, proprietary controller → no post, vendor-CAM DXF layers',
    !!db && db.supported_operations.includes('DRILL_VERTICAL') && db.supported_operations.includes('DRILL_HORIZONTAL') && db.tools.length === 29 && pp.heads.some((h) => h.head_id === 'GROOVE_SAW_1') && pp.postprocessor.id === null && !!pp.ext?.dxf_layers && pp.atc.supported && pp.atc.magazine_slots === 10)
  const tsaw = templateById('generic-panel-saw-3800')!
  const ps = templateToProfile(tsaw, { profileId: 'TEST-SAW' }).profile
  check('template → profile: panel saw = PANEL_SAW, saw_cutlist post, main blade with kerf, cut height', ps.machine_type === 'PANEL_SAW' && ps.postprocessor.id === 'saw_cutlist' && ps.heads.length === 1 && ps.heads[0].type === 'SAW_BLADE' && ps.heads[0].tools[0].kerf_mm === 4.4 && ps.ext?.saw?.max_cut_height_mm === 100)
  check('template → profile: never VERIFIED, gate closed (catalogue values are references)', machineBlockers(p4).includes('MACHINE_PROFILE_NOT_VERIFIED') && machineBlockers(p4).includes('CONTROLLER_ID_OR_MANUAL_MISSING') && machineBlockers(p4).includes('STOCK_ORIGIN_UNCALIBRATED'))
  check('every library template maps to a profile with a valid post or the vendor-CAM route', LIBRARY.machines.every((t) => { const p = templateToProfile(t, { profileId: 'X1' }).profile; return p.status === 'UNVERIFIED' && (p.postprocessor.id ? !!POSTS[p.postprocessor.id as keyof typeof POSTS] : t.controller_family === 'PROPRIETARY' || t.controller_family === null) }))

  /* ------------------------------------------------ own machine form validation */
  const own = blankOwnProfile('TEST-OWN', 'SYNTEC')
  const e0 = validateOwnProfile(own)
  const own2 = { ...measured({ ...own, manufacturer: 'TEST', machine_model: 'M1', work_envelope_mm: { x: 2500, y: 1300, z: 200 } }), ext: { ...own.ext, spindle_select: [{ head_id: 'HEAD_1', codes: ['M77'] }] } }
  check('enter my machine: validation (make / envelope required; spindle-select codes must be in the verified codes)', e0.includes('MAKE_MODEL') && e0.includes('ENVELOPE_X') && validateOwnProfile(own2).includes('SPINDLE_SELECT_CODE:HEAD_1:M77') && validateOwnProfile({ ...own2, ext: { ...own2.ext, spindle_select: [] } }).length === 0, { e0, e1: validateOwnProfile(own2) })

  /* ------------------------------------------------ posts per controller family */
  const FAMS: [ControllerFamilyId, boolean][] = [['SYNTEC', true], ['MACH3', true], ['FANUC', true], ['SIEMENS_840D', true], ['OSAI', true], ['RICHAUTO_DSP', false], ['WEIHONG_NCSTUDIO', true], ['LNC', true]]
  for (const [fam, atc] of FAMS) {
    const m = familyMachine(fam, { atc })
    if (fam === 'OSAI' || fam === 'WEIHONG_NCSTUDIO') m.ext = { ...m.ext, tool_length_mode: 'AUTO_ON_TOOL_CHANGE' }
    const c = cncOf(m)
    const codes = allCodes(c)
    const allowed = new Set(m.controller.supported_codes)
    const outside = codes.filter((x) => !allowed.has(x))
    const postB = c.blockers.filter((b) => b.startsWith('NC_CHECK_FAILED'))
    check(`post ${m.postprocessor.id} (${fam}): only codes of the family notes + profile; parser finds nothing to block`, texts(c).length > 0 && outside.length === 0 && postB.length === 0 && m.postprocessor.id === postIdForFamily(fam), { outside, postB, codes })
  }
  const syn = familyMachine('SYNTEC')
  const reduced = { ...syn, controller: { ...syn.controller, supported_codes: syn.controller.supported_codes.filter((x) => !['G2', 'G3', 'G17', 'G94', 'G40', 'G49', 'G80', 'G54'].includes(x)) } }
  const cR = cncOf(reduced)
  check('family post: arcs not in the profile → G1 chords, optional codes left out; still only allowed codes, no blocker', allCodes(cR).every((x) => reduced.controller.supported_codes.includes(x)) && !allCodes(cR).includes('G2') && !cR.blockers.some((b) => b.startsWith('NC_CHECK_FAILED')) && texts(cR)[0].split('\n').length > texts(cncOf(syn))[0].split('\n').length, allCodes(cR))
  const noUnits = { ...syn, controller: { ...syn.controller, supported_codes: syn.controller.supported_codes.filter((x) => x !== 'G21') } }
  check('family post: a required code not documented (G21) → written in the preview but export-blocking', cncOf(noUnits).blockers.includes('NC_CHECK_FAILED:SYNTEC_CODE_NOT_DOCUMENTED:G21'))
  const osaiText = texts(cncOf({ ...familyMachine('OSAI'), ext: { ...familyMachine('OSAI').ext, tool_length_mode: 'AUTO_ON_TOOL_CHANGE' } }))[0]
  check('OSAI: G71 metric, ; comments, parser reads G71 as units', /^G71 G90/m.test(osaiText) && !osaiText.includes('(') && !parseNc(osaiText, { units: POSTS.osai.units }).issues.some((i) => i.code === 'UNITS_NOT_SET'))
  const fanText = texts(cncOf(familyMachine('FANUC')))[0]
  check('FANUC: % + O number at the start, % after M30, ( ) comments', fanText.startsWith('%\nO1000\n(') && /M30\n%\n$/.test(fanText))
  const sieText = texts(cncOf(familyMachine('SIEMENS_840D')))[0]
  check('SIEMENS 840D: ISO dialect mode, ; comments only', sieText.includes('; ISO DIALECT MODE MUST BE ACTIVE ON THE CONTROL') && !sieText.includes('('))
  const osaiNoTlo = familyMachine('OSAI')
  osaiNoTlo.ext = { ...osaiNoTlo.ext, tool_length_mode: null }
  check('OSAI with ATC and no documented tool-length mode → blocked until the profile states it', cncOf(osaiNoTlo).blockers.includes('NC_CHECK_FAILED:OSAI_TOOL_LENGTH_MODE_NOT_DOCUMENTED'))
  // RichAuto: no ATC → no T / M6, one program per tool
  const ra = familyMachine('RICHAUTO_DSP', { atc: false })
  const cRa = cncOf(ra)
  check('RichAuto without ATC: no T / M6 / G43, one program per tool, no comments (not documented)', texts(cRa).length >= 2 && texts(cRa).every((t) => !code(t).some((l) => /^T\d|\bM6\b|\bG43\b/.test(l)) && !t.includes('(')) && cRa.sheets.every((s) => s.cam.programs.every((p) => p.tools.length === 1)) && !cRa.blockers.some((b) => b.startsWith('NC_CHECK_FAILED')), cRa.blockers.filter((b) => b.startsWith('NC')))
  // Weihong multi-spindle
  const wh0 = familyMachine('WEIHONG_NCSTUDIO', { atc: false })
  const head = (id: string, t: MachineTool) => ({ ...newHead(1, 'ROUTER_SPINDLE'), head_id: id, offset_mm: { x: 0, y: 0, z: 0 }, offset_calibrated: true, activation_mapping_verified: true, tools: [t] })
  const wh: MachineProfile = { ...wh0, heads: [head('HEAD_1', tool('EM8', 'END_MILL', 8, 1)), head('HEAD_2', tool('DR5', 'DRILL', 5, 2)), head('HEAD_3', tool('FO35', 'FORSTNER', 35, 3))] }
  const cW = cncOf(wh)
  check('Weihong multi-spindle / 4-process without documented spindle-select codes → BLOCKED (clear message)', cW.blockers.some((b) => b.startsWith('NC_CHECK_FAILED:WEIHONG_SPINDLE_SELECT_NOT_DOCUMENTED')) && cW.sheets.some((s) => s.cam.postIssues.some((i) => i === 'WEIHONG_SPINDLE_SELECT_NOT_DOCUMENTED:HEAD_1,HEAD_2,HEAD_3')), cW.sheets[0]?.cam.postIssues)
  const whSel: MachineProfile = { ...wh, controller: { ...wh.controller, supported_codes: [...wh.controller.supported_codes, 'M51', 'M52', 'M53'] }, ext: { ...wh.ext, spindle_select: [{ head_id: 'HEAD_1', codes: ['M51'] }, { head_id: 'HEAD_2', codes: ['M52'] }, { head_id: 'HEAD_3', codes: ['M53'] }] } }
  const cWs = cncOf(whSel)
  const wt = texts(cWs)
  check('Weihong with the select codes from the manual: one program per sheet, M51 / M52 / M53 before each head, no T / M6, only allowed codes', cWs.sheets.every((s) => s.programs.length === 1) && wt.some((t) => /\nM52\n/.test(t) && /\nM53\n/.test(t)) && wt.every((t) => !code(t).some((l) => /^T\d|\bM6\b/.test(l))) && allCodes(cWs).every((x) => whSel.controller.supported_codes.includes(x)) && !cWs.blockers.some((b) => b.startsWith('NC_CHECK_FAILED')), { b: cWs.blockers.filter((b) => b.startsWith('NC')), n: cWs.sheets.map((s) => s.programs.length) })

  /* ------------------------------------------------ panel saw: guillotine */
  const SAW = measured(ps)
  const cS = cncOf(SAW, CABINETS)
  const gs = { kerf: 4.4, trim: 10, grained: DEFAULT_NEST.grained }
  const saw = cS.saw!
  const errs = verifyAll(saw, gs)
  const placed = saw.patterns.reduce((a, p) => a + p.parts.length * p.count, 0)
  check('panel saw: guillotine patterns for the sample cabinets, verifier finds no error, every piece placed or listed', !!saw && saw.patterns.length > 0 && errs.length === 0 && placed + saw.unplaced.length === piecesOf(CABINETS).length, { errs: errs.slice(0, 5), placed, unplaced: saw.unplaced.length })
  const kerfOk = saw.patterns.every((p) => p.parts.every((a, i) => p.parts.every((b, j) => {
    if (i >= j) return true
    const ox = Math.min(a.x + a.sx, b.x + b.sx) - Math.max(a.x, b.x), oy = Math.min(a.y + a.sy, b.y + b.sy) - Math.max(a.y, b.y)
    if (ox > 1e-6 && oy > 1e-6) return false // overlap
    if (ox > 1e-6) return -oy >= 4.4 - 1e-6 // stacked: separated by at least the kerf
    if (oy > 1e-6) return -ox >= 4.4 - 1e-6
    return true
  })))
  check('panel saw: no overlap, neighbours at least one kerf (4.4 mm) apart', kerfOk)
  check('panel saw: rips run through the whole trimmed board, every cut edge to edge (replayed by the verifier)', saw.patterns.every((p) => p.cuts.filter((c) => c.stage === 1).every((c) => c.from === 10 && c.to === p.l - 10) && verifyGuillotine(p, gs).length === 0))
  check('panel saw: grain-locked parts on wood-décor boards never rotated', saw.patterns.every((p) => p.parts.every((q) => rotations(q, { ...DEFAULT_NEST, gap: 4.4 }).includes(q.rotated) && (!DEFAULT_NEST.grained(q.material) || q.grain !== 'L' || !q.rotated))))
  check('panel saw: books of floor(100 / 18) = 5 sheets', saw.patterns.every((p) => p.t !== 18 || (p.perBook === 5 && p.books === Math.ceil(p.count / 5))))
  check('panel saw: no router programs at all, cutting list + cut sequence CSV instead, no saw-pattern blocker', cS.sheets.length === 0 && texts(cS).length === 0 && cS.sawFiles?.length === 2 && /^Pattern,Sheets,Books/.test(cS.sawFiles[0].text) && /^Pattern,Cut,Stage,Axis/.test(cS.sawFiles[1].text) && !cS.blockers.some((b) => b.startsWith('SAW_PATTERN_INVALID')) && /<svg/.test(patternSvg(saw.patterns[0])), cS.blockers.filter((b) => b.startsWith('SAW')))
  const p0 = saw.patterns[0]
  const bad1 = { ...p0, cuts: p0.cuts.map((c) => (c.stage === 2 ? { ...c, to: c.to - 50 } : c)) }
  const bad2 = { ...p0, parts: p0.parts.map((q, i) => (i === 0 ? { ...q, x: q.x + 1 } : q)) }
  const bad3 = { ...p0, cuts: p0.cuts.map((c) => ({ ...c, kerf: 3 })) }
  check('guillotine verifier catches a cut that is not edge to edge, a part in the kerf, a wrong kerf', verifyGuillotine(bad1, gs).some((e) => e.startsWith('CUT_NOT_EDGE_TO_EDGE')) && verifyGuillotine(bad2, gs).some((e) => e.startsWith('PART_NOT_SEPARATED')) && verifyGuillotine(bad3, gs).some((e) => e.startsWith('KERF_MISMATCH')))
  const noKerf = guillotineNest(piecesOf([KITCHEN]), { kerf: 0, trim: 10, sheetL: 2440, sheetW: 1830, grained: DEFAULT_NEST.grained, maxCutHeight: 100 })
  check('panel saw without a kerf in the profile → SAW_KERF_NOT_DEFINED, nothing nested', noKerf.setup.includes('SAW_KERF_NOT_DEFINED') && noKerf.patterns.length === 0)
  const sawUnv = cncOf(ps, [KITCHEN])
  check('panel saw profile UNVERIFIED → production cutting list blocked', blocked(() => productionSawFiles(sawUnv.sawFiles!, [], { machine: ps, machineHash: profileContentHash(ps), commissioning: null, post: sawUnv.post, gate: sawUnv.gate, meta: sawUnv.meta })) !== null)

  /* ------------------------------------------------ hardware drilling */
  const HW: Cabinet = { ...KITCHEN, hardware: { hinge: 'generic-hinge-35-system32', boringDistance: 4, hingeEndDistance: 100, slide: 'generic-slide-system32', slideRows: [100, 300] } }
  const plan = hardwarePlan(HW, { shelfPins: true })
  const cups = plan.holes.filter((h) => h.purpose === 'hinge-cup')
  const fix = plan.holes.filter((h) => h.purpose === 'hinge-fixing')
  const plates = plan.holes.filter((h) => h.purpose === 'hinge-plate')
  check('Blum-like hinge (CLIP top class): Ø35 × 13 cups 21.5 mm from the hinge edge (C = 4), 100 mm from the door ends', plan.issues.length === 0 && cups.length === 2 && cups.every((h) => h.part === 'DOOR' && h.d === 35 && h.depth === 13 && h.y === 21.5) && cups.map((h) => h.x).join() === '100,747', { issues: plan.issues, cups })
  check('hinge fixings 45 / 9.5: Ø8 × 13 at cup ± 22.5, 9.5 mm further from the edge', fix.length === 4 && fix.map((h) => h.x).sort((a, b) => a - b).join() === '77.5,122.5,724.5,769.5' && fix.every((h) => h.y === 31 && h.d === 8))
  check('mounting plates (system 32): side-panel holes 37 mm from the front, 32 mm apart about each hinge', plates.length === 4 && plates.every((h) => h.part === 'SIDE' && h.y === 37 && h.d === 5) && plates.map((h) => h.x).sort((a, b) => a - b).join() === '85.5,117.5,732.5,764.5')
  const sl = plan.holes.filter((h) => h.purpose === 'slide')
  check('system-32 slide 500: holes at 37 / 261 / 453 from the front on both sides; the right side mirrored (x = H − h)', sl.length === 12 && sl.filter((h) => h.piece === 1).map((h) => `${h.x}/${h.y}`).sort().join() === ['100/261', '100/37', '100/453', '300/261', '300/37', '300/453'].sort().join() && sl.filter((h) => h.piece === 2).every((h) => h.x === 750 || h.x === 550))
  const thin = hardwarePlan(HW, { thickness: { front: 12 } })
  check('through-hole check vs measured thickness: 12 mm door with a 13 mm cup → blocked; door below the hinge minimum flagged', has(thin.issues, 'HW_THROUGH_HOLE') && has(thin.issues, 'HW_DOOR_THICKNESS_OUT_OF_RANGE'), thin.issues)
  const nd = hardwarePlan({ ...KITCHEN, hardware: { hinge: 'example-hinge-needs-data' } })
  check('unknown product data → "needs data", never guessed', nd.issues.includes('HW_NEEDS_DATA:example-hinge-needs-data:cup_depth_mm') && nd.issues.includes('HW_NEEDS_DATA:example-hinge-needs-data:boring_distance') && !nd.holes.length)
  check('boring distance outside the product range → blocked', has(hardwarePlan({ ...KITCHEN, hardware: { ...HW.hardware, boringDistance: 9 } }).issues, 'HW_BORING_DISTANCE_OUT_OF_RANGE'))
  const MT = measured(templateToProfile(t2131, { profileId: 'TEST-HW' }).profile, {}, [...TOOLS(), tool('DR8', 'DRILL', 8, 4)])
  const cHw = cncOf(MT, [HW])
  const hwText = texts(cHw).join('\n')
  check('hardware holes reach the NC: Ø8 fixing drill as its own tool, cups Ø35 × 13 deep (not clamped)', /Drill Ø8 \[hardware\]/.test(hwText) && cHw.sheets.some((s) => s.cam.holes.some((h) => h.d === 8)) && cHw.sheets.some((s) => s.cam.holes.some((h) => h.d === 35 && h.depth === 13)) && !cHw.blockers.some((b) => b.startsWith('HW_')), cHw.blockers.filter((b) => b.startsWith('HW') || b.startsWith('UNSUP')))
  const cHw2 = cncOf(measured(templateToProfile(t2131, { profileId: 'TEST-HW2' }).profile), [HW])
  check('a hardware hole without a matching tool on the machine → TOOL_NOT_ON_MACHINE blocks', cHw2.blockers.some((b) => b.startsWith('UNSUPPORTED_OPERATION:DRILL_VERTICAL:TOOL_NOT_ON_MACHINE')), cHw2.blockers.filter((b) => b.startsWith('UNSUP')))
  check('needs-data hardware blocks production in the job', cncOf(MT, [{ ...KITCHEN, hardware: { hinge: 'example-hinge-needs-data' } }]).blockers.some((b) => b.startsWith('HW_NEEDS_DATA')))
  const con = cncOf(MT, [{ ...KITCHEN, hardware: { connector: 'generic-cam-connector-15' } }])
  check('connector: Ø15 cams on the top / bottom, Ø5 bolts on the sides; Ø8 edge holes listed as not machined (horizontal)', con.sheets.some((s) => s.cam.holes.some((h) => h.d === 15)) && con.blockers.some((b) => b.startsWith('UNSUPPORTED_OPERATION:DRILL_HORIZONTAL')))
  check('back-compat: no hardware chosen → same NC as before (generic cup pattern)', texts(cncOf(MT, [KITCHEN])).join() === texts(cncOf(MT, [{ ...KITCHEN, hardware: undefined }])).join() && texts(cncOf(MT, [KITCHEN])).join().includes('Forstner Ø35 [hinge cups]'))

  /* ------------------------------------------------ vendor CAM (proprietary) */
  const VP = measured(pp)
  const cV = cncOf(VP)
  const dx = vendorDxfFiles([HW], { hingeCups: true, shelfPins: true, backGroove: true }, VP.ext!.dxf_layers!)
  check('proprietary controller: no NC written (vendor CAM generates the program), per-part DXF with layer conventions', cV.sheets.length === 0 && cV.blockers.includes('UNSUPPORTED_OPERATION:PROFILE:VENDOR_CAM_GENERATES_PROGRAM') && dx.some((f) => f.text.includes('DRILL_D35_Z13')) && dx.some((f) => f.text.includes('GROOVE_W6_5_Z8')) && dx.some((f) => / LEFT x1\.dxf$/.test(f.name)) && dx.every((f) => f.text.includes('OUTLINE')), dx.map((f) => f.name).slice(0, 4))

  /* ------------------------------------------------ router saw unit */
  const thy = templateById('generic-hybrid-router-saw-syntec')!
  const hy0 = measured(templateToProfile(thy, { profileId: 'TEST-HYBRID' }).profile)
  const capSaw = (m: MachineProfile) => capabilities(m).find((c) => c.op === 'SAW_CUT')!
  check('router saw unit: orientation missing → SAW_ORIENTATION_NOT_DEFINED', capSaw(hy0).reason === 'SAW_ORIENTATION_NOT_DEFINED')
  const hy = { ...hy0, ext: { ...hy0.ext, saw: { ...hy0.ext!.saw!, orientation: 'X' as const } }, heads: hy0.heads.map((h) => (h.type === 'SAW_BLADE' ? { ...h, tools: h.tools.map((t) => ({ ...t, number: 9, diameter_mm: 125 })) } : h)) }
  check('router saw unit: gated as unsupported until commissioned', capSaw(hy).state === 'unsupported' && capSaw(hy).reason === 'SAW_AGGREGATE_NOT_COMMISSIONED' && !cncOf(hy).sheets.some((s) => s.cam.ir.blocks.some((b) => b.op === 'SAW_CUT')))

  /* ------------------------------------------------ commissioning wizard → VERIFIED → production; tool change → blocked */
  const P0 = templateToProfile(t2131, { profileId: 'TEST-COM', at: AT }).profile
  const P1 = reviseProfile(P0, measured(P0))
  const auto = automatedChecks(P1)
  check('wizard step 3 (automated): the profile post writes the test cabinet, parser + backplot pass', auto.parser_pass && auto.post_backplot_pass && auto.programs.length > 0, auto.issues.slice(0, 6))
  const air = auto.airCut
  check('wizard step 4: air-cut test files — Z raised so the deepest move is 20 mm above the board, marked AIRCUT_TEST', air.length === auto.programs.length && air.every((f) => /\.AIRCUT_TEST\.nc$/.test(f.name) && f.text.includes('COMMISSIONING AIR CUT') && parseNc(f.text).minZ >= 20 - 1e-6))
  const w = newWizard('2026-10-18')
  for (const k of SURVEY_ITEMS) w.survey[k] = true
  Object.assign(w, { auto: { parser_pass: auto.parser_pass, post_backplot_pass: auto.post_backplot_pass }, postApproved: true, operator: 'TEST OPERATOR', engineer: 'TEST ENGINEER', evidence: 'TEST-EVIDENCE-1', serial: 'TEST-SN-1' })
  w.air = { pass: true, date: '2026-10-18', notes: 'TEST dry run', supervisor: 'TEST SUPERVISOR' }
  w.rows = w.rows.map((r) => ({ ...r, measured: r.nominal + Math.min(0.1, r.tolerance / 2) }))
  const noSurvey = commission(P1, { ...wizardInput(w, AT), survey: null }, AT)
  check('a library profile cannot be verified without the survey sheet', noSurvey.record.result === 'FAILED' && noSurvey.record.failures.includes('SURVEY_MISSING'))
  const out = commission(P1, { ...wizardInput(w, AT), rows: undefined, first_article_rows: w.rows.map((r, i) => (i === 0 ? { ...r, measured: r.nominal + 1 } : r)) } as never, AT)
  check('first article out of tolerance → FAILED', out.record.result === 'FAILED' && out.record.failures.some((f) => f.startsWith('FIRST_ARTICLE_OUT_OF_TOLERANCE')), out.record.failures)
  const { profile: MV, record: COM } = commission(P1, wizardInput(w, AT), AT)
  check('wizard complete → VERIFIED with expiry (180 days) and the profile hash', MV.status === 'VERIFIED' && COM.result === 'VERIFIED' && COM.valid_until === '2027-04-16' && COM.profile_hash === profileContentHash(MV) && machineBlockers(MV).length === 0, COM.failures)
  const j0 = job(MV)
  const c0 = cncOf(MV, [KITCHEN], j0, COM)
  const j1 = approveJob(j0, c0.chain, { operator: 'TEST OPERATOR', engineer: 'TEST ENGINEER' }, AT)
  const c1 = cncOf(MV, [KITCHEN], j1, COM)
  const rel = blocked(() => productionFiles(c1.sheets.flatMap((s) => s.programs), { machine: MV, machineHash: profileContentHash(MV), commissioning: COM, post: c1.post, gate: c1.gate, meta: c1.meta, at: AT }))
  const prodOut = rel === null ? productionFiles(c1.sheets.flatMap((s) => s.programs), { machine: MV, machineHash: profileContentHash(MV), commissioning: COM, post: c1.post, gate: c1.gate, meta: c1.meta, at: AT }) : null
  const man = prodOut ? JSON.parse(prodOut.files.find((f) => f.name === 'manifest.json')!.text) : null
  check('production export after commissioning: .nc files (Syntec post) + manifest with sha256 of every file', c1.blockers.length === 0 && !!prodOut && prodOut.files.filter((f) => f.name.endsWith('.nc')).length > 0 && man.kind === 'PRODUCTION_RELEASE' && man.post.id === 'syntec' &&
    man.files.every((f: { name: string; sha256: string }) => f.sha256 === sha256(prodOut.files.find((x) => x.name === f.name)!.text)) && man.commissioning.id === COM.id, { b: c1.blockers, rel })
  const MT2 = reviseProfile(MV, { ...MV, heads: MV.heads.map((h) => ({ ...h, tools: h.tools.map((t) => (t.tool_id === 'EM8' ? { ...t, diameter_mm: 7.98 } : t)) })) })
  const c2 = cncOf(MT2, [KITCHEN], j1, COM)
  check('a tool change after commissioning → UNVERIFIED, production export blocked again', MT2.status === 'UNVERIFIED' && !MT2.production_export_allowed && c2.blockers.includes('MACHINE_PROFILE_NOT_VERIFIED') && blocked(() => productionFiles(c2.sheets.flatMap((s) => s.programs), { machine: MT2, machineHash: profileContentHash(MT2), commissioning: COM, post: c2.post, gate: c2.gate, meta: c2.meta })) !== null)
  check('editing the spindle-select / file-extension extension also re-locks (machine content)', reviseProfile(MV, { ...MV, ext: { ...MV.ext, file_extension: '.tap' } }).status === 'UNVERIFIED' && reviseProfile(MV, { ...MV, ext: { ...MV.ext, provenance: { ...MV.ext!.provenance!, picked_at: 'x' } } }).status === 'VERIFIED')
  check('forged VERIFIED on a template profile → still blocked (no commissioning record)', releaseBlockers({ ...P1, status: 'VERIFIED', production_export_allowed: true }, c1.gate, null).includes('COMMISSIONING_RECORD_MISSING'))
  // saw unit after commissioning with the saw test
  const hyM = reviseProfile(hy, hy)
  const auto2 = automatedChecks(hyM)
  const w2 = { ...w, auto: { parser_pass: auto2.parser_pass, post_backplot_pass: auto2.post_backplot_pass }, sawTest: { pass: true, notes: 'TEST saw dry run' } }
  const { profile: HV } = commission(hyM, wizardInput(w2, AT), AT)
  const cH = cncOf(HV, [KITCHEN])
  const sawBlock = cH.sheets.flatMap((s) => s.cam.ir.blocks.filter((b) => b.op === 'SAW_CUT'))
  const linesOk = cH.sheets.every((s, si) => (s.cam.sawLines ?? []).every((l) => cH.nest.sheets[si].parts.every((p) => p.y + p.sy <= l.pos - 3.2 / 2 + 1e-6 || p.y >= l.pos + 3.2 / 2 - 1e-6)))
  check('router saw unit after the commissioned saw test: SAW_CUT available, straight edge-to-edge cuts between parts only', HV.status === 'VERIFIED' && capSaw(HV).state === 'available' && sawBlock.length > 0 && linesOk && !cH.blockers.some((b) => b.startsWith('NC_CHECK_FAILED')), { st: HV.status, cap: capSaw(HV), b: cH.blockers.filter((b) => b.startsWith('NC')) })

  return { all: results.every((r) => r.pass), passed: results.filter((r) => r.pass).length, total: results.length, failed: results.filter((r) => !r.pass), results: results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.id}`) }
}
