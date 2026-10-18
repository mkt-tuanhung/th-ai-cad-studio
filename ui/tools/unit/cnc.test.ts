/**
 * CNC safety acceptance (v2.4 V24-049…061 and the automatable CNC-0xx rows of the v2.3 CNC_MULTI_MACHINE tests).
 * Run: UNIT=cnc node tools/test-cam.mjs run → { all, results: [{ id, pass, detail }] }.
 *
 * The "commissioned" machines below are TEST FIXTURES (synthetic data, names TEST-…): they exist only to prove
 * that the gate CAN open when every condition is met, so each negative case shows the blocker that closes it.
 * They are not shipped and describe no real machine.
 */
import { CABINETS, cutList, type Cabinet } from '../../src/interior/model'
import { DEFAULT_CAM } from '../../src/cam/gcode'
import { DEFAULT_NEST, labelRows, nest, piecesOf, verifyNest } from '../../src/cam/nesting'
import { holesOf } from '../../src/cam/gcode'
import {
  SAMPLE_PROFILES, assignHeads, capabilities, cloneProfile, commission, headSummary, importProfile, machineBlockers, profileContentHash, releaseBlockers, reviseProfile,
  type CommissioningInput, type MachineProfile,
} from '../../src/cam/machine'
import { approveJob, forkJob, isStale, newJob, releaseJob, selectMachine, type ManufacturingJob } from '../../src/cam/job'
import { interiorCnc, type CamPrefsLike } from '../../src/cam/interiorJob'
import { parseNc } from '../../src/cam/ncparse'
import { POSTS } from '../../src/cam/posts'
import { PREVIEW_EXT, ProductionBlocked, WATERMARK, previewFiles, productionFiles } from '../../src/cam/release'
import { sha256 } from '../../src/lib/sha256'
import { camSheet } from '../../src/cam/gcode'

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

/* ---------------------------------------------------------------- fixtures */

const KITCHEN = CABINETS.find((c) => c.id === 'c2')! // 2400 × 600 × 850: every part fits a 2440 × 1830 sheet
const PREFS: CamPrefsLike = { stock: {}, trim: 10, web: 4, grain: true, cnc: { ...DEFAULT_CAM, dialect: 'iso' } }
const blankQ = () => ({ parser_pass: false, post_backplot_pass: false, air_cut_pass: false, first_article_pass: false, operator_signed: false, engineer_signed: false, qualified_at: null, evidence_refs: [] })

function testMachine(id = 'TEST-ROUTER-1', patch: Partial<MachineProfile> = {}): MachineProfile {
  return {
    schema_version: '2.2.0', profile_id: id, revision: 1, status: 'UNVERIFIED', machine_type: 'CNC_ROUTER', manufacturer: 'TEST-OEM', machine_model: 'TEST-2513', serial_reference: 'TEST-0001',
    controller: { name: 'LinuxCNC', model: 'TEST-MESA', firmware: '2.9.2', manual_reference: 'TEST manual rev A', supported_codes: [...POSTS.linuxcnc.dialect] },
    axes: ['X', 'Y', 'Z'], work_envelope_mm: { x: 2600, y: 1900, z: 200 }, origin: { stock_corner: 'LOWER_LEFT', z_reference: 'BOARD_TOP', work_offset: 'G54', home_calibrated: true },
    heads: [{
      head_id: 'HEAD_1', type: 'ROUTER_SPINDLE', offset_mm: { x: 0, y: 0, z: 0 }, offset_calibrated: true, activation_mapping_verified: true, kinematics_group: 'GANTRY_1', simultaneous_qualified: false,
      supported_operations: ['PROFILE', 'POCKET', 'SLOT', 'DRILL_VERTICAL'],
      tools: [{ tool_id: 'EM8', kind: 'END_MILL', diameter_mm: 8, actual_calibrated: true, number: 1 }, { tool_id: 'DR5', kind: 'DRILL', diameter_mm: 5, actual_calibrated: true, number: 2 }, { tool_id: 'FO35', kind: 'FORSTNER', diameter_mm: 35, actual_calibrated: true, number: 3 }],
    }],
    motion_policy: 'SEQUENTIAL_ONLY', atc: { supported: true, magazine_slots: 8 }, fixtures: { bed_type: 'VACUUM', vacuum_zones: [], clamp_no_go_shapes: [], safe_clearance_mm: 10 },
    postprocessor: { id: 'linuxcnc', version: POSTS.linuxcnc.version, sha256: POSTS.linuxcnc.sha256, approved_for_controller: false },
    qualification: blankQ(), production_export_allowed: false, ...patch,
  }
}
const AT = '2026-10-18T08:00:00.000Z'
const COM_OK: CommissioningInput = {
  parser_pass: true, post_backplot_pass: true, post_approved_for_controller: true, air_cut: { pass: true, date: '2026-10-18', notes: 'TEST air cut' },
  first_article: { pass: true, date: '2026-10-18', measurements: 'TEST 1164.0 / 1164.1 mm' }, operator: { name: 'TEST OPERATOR', at: AT }, engineer: { name: 'TEST ENGINEER', at: AT }, evidence_refs: ['TEST-EVIDENCE-1'],
}
const commissioned = (m: MachineProfile) => commission(m, COM_OK, AT)
const pin = (m: MachineProfile) => ({ profile_id: m.profile_id, revision: m.revision, hash: profileContentHash(m) })
function jobFor(m: MachineProfile | null, over: { mfc?: number | null; hdf?: number | null; lot?: string | null; band?: boolean } = {}): ManufacturingJob {
  const j = newJob('TEST-JOB', m ? pin(m) : null)
  const st = (material: string, nominal: number, t: number | null) => ({ material, nominal_mm: nominal, measured_thickness_mm: t, lot: over.lot === undefined ? 'TEST-LOT-1' : over.lot, length_mm: 2440, width_mm: 1830, grain_axis: 'X' as const, face_a: 'inside' })
  const stocks = [st('MFC 18 - Oak', 18, over.mfc === undefined ? 18 : over.mfc), st('HDF 6 - White', 6, over.hdf === undefined ? 6 : over.hdf)]
  return { ...j, stocks, stock: stocks[0], edge_band_confirmed: over.band ?? true }
}
const run1 = (m: MachineProfile | null, job: ManufacturingJob | null, cabs: Cabinet[] = [KITCHEN], com = m ? commission(m, COM_OK, AT).record : null, prefs = PREFS) =>
  interiorCnc({ cabinets: cabs, cam: prefs, machine: m, machineProfileId: m ? m.profile_id : null, commissioning: com, job, jobName: 'TEST' })
const prod = (m: MachineProfile | null, cnc: ReturnType<typeof run1>, com = m ? commission(m, COM_OK, AT).record : null) =>
  productionFiles(cnc.sheets.flatMap((s) => s.programs), { machine: m, machineHash: m ? profileContentHash(m) : null, commissioning: com, post: cnc.post, gate: cnc.gate, meta: cnc.meta, at: AT })
const texts = (cnc: ReturnType<typeof run1>) => cnc.sheets.flatMap((s) => s.programs.map((p) => p.text))
const code = (t: string) => t.split('\n').map((l) => l.replace(/\(.*?\)/g, '').trim())

export function run() {
  /* ------------------------------------------------ positive control: the gate CAN open */
  const { profile: MV, record: COM } = commissioned(testMachine())
  check('control: TEST machine commissioned → VERIFIED', MV.status === 'VERIFIED' && COM.result === 'VERIFIED' && machineBlockers(MV).length === 0, { status: MV.status, failures: COM.failures, mb: machineBlockers(MV) })
  const job0 = jobFor(MV)
  const c0 = run1(MV, job0, [KITCHEN], COM)
  const job1 = approveJob(job0, c0.chain, { operator: 'TEST OPERATOR', engineer: 'TEST ENGINEER' }, AT)
  const c1 = run1(MV, job1, [KITCHEN], COM)
  check('control: complete job on a VERIFIED machine → no blockers', c1.blockers.length === 0 && c1.status === 'VALIDATED', c1.blockers)
  const rel = blocked(() => prod(MV, c1, COM))
  check('control: production export succeeds only then', rel === null, rel)

  /* ------------------------------------------------ V24 */
  // V24-049: cut sizes exact and unique ids
  const parts = cutList(KITCHEN)
  const door = parts.find((p) => p.part === 'Door')!, side = parts.find((p) => p.part === 'Side panel')!, tb = parts.find((p) => p.part === 'Top / bottom')!
  check('V24-049 unique part ids + revisions', new Set(parts.map((p) => p.id)).size === parts.length && parts.every((p) => /^[0-9a-f]{8}$/.test(p.rev)), parts.map((p) => p.id))
  check('V24-049 / CNC-038 banded door cut = finished − band per side', door.edges.L1 === 1 && door.edges.W2 === 1 && door.cut.l === door.finished.l - 2 && door.cut.w === door.finished.w - 2 && door.finished.l === 847 && door.finished.w === 597, door)
  check('V24-049 side / top-bottom: front edge banded → width − 1, length unchanged', side.cut.w === 599 && side.cut.l === 850 && tb.cut.l === 2364 && tb.cut.w === 599, { side: side.cut, tb: tb.cut })
  check('CNC-035 1200 carcass, 18 sides → top / bottom 1164', cutList({ ...KITCHEN, w: 1200 }).find((p) => p.part === 'Top / bottom')!.l === 1164)
  // V24-050: change cabinet width after nesting / approval
  const cW = run1(MV, job1, [{ ...KITCHEN, w: 2300 }], COM)
  check('V24-050 / CNC-037 cabinet width change → STALE from parts', cW.stale.stale && cW.stale.from === 'parts' && cW.status === 'STALE' && has(cW.blockers, 'JOB_STALE') && STAGES_ALL(cW.stale.stages), { from: cW.stale.from, status: cW.status })
  // V24-051: change machine after nesting
  const MB = commissioned(testMachine('TEST-ROUTER-2')).profile
  const cM = run1(MB, job1, [KITCHEN], commissioned(testMachine('TEST-ROUTER-2')).record)
  check('V24-051 / CNC-017 machine change → STALE from machine, CAM / post export invalidated', cM.stale.from === 'machine' && has(cM.blockers, 'JOB_MACHINE_MISMATCH') && has(cM.blockers, 'JOB_STALE') && blocked(() => prod(MB, cM, commissioned(testMachine('TEST-ROUTER-2')).record)) !== null, cM.blockers)
  // V24-052: measured thickness changed
  const cT = run1(MV, { ...job1, stocks: job1.stocks.map((s) => (s.material === 'MFC 18 - Oak' ? { ...s, measured_thickness_mm: 18.4 } : s)) }, [KITCHEN], COM)
  const minZ = Math.min(...cT.sheets.filter((s) => s.cam.ir.stock.t === 18.4).flatMap((s) => s.parses.map((p) => p.minZ)))
  check('V24-052 / CNC-036 measured thickness 18 → 18.4: toolpaths recomputed (depth 18.7), old NC STALE, deviation flagged', cT.stale.from === 'stock' && Math.abs(minZ + 18.7) < 1e-6 && has(cT.blockers, 'THICKNESS_DEVIATES_FROM_NOMINAL') && texts(cT).join() !== texts(c1).join(), { from: cT.stale.from, minZ, b: cT.blockers })
  // V24-053: 1-head router sample: only its own operations
  const S1 = SAMPLE_PROFILES[0]
  const c53 = run1(S1, jobFor(S1), CABINETS, null)
  const allText = texts(c53).join('\n')
  check('V24-053 / CNC-010 1-head router: only supported single-head operations emitted (no drilling), no tool change', c53.sheets.every((s) => s.cam.programs.every((p) => p.tools.length === 1)) && !/Drill|Forstner/.test(allText) && /Back-panel rebates/.test(allText) && /\(LOAD T1/.test(allText) && !/\bM6\b/.test(allText.replace(/\(.*?\)/g, '')) && has(c53.blockers, 'UNSUPPORTED_OPERATION'), c53.unsupported)
  // V24-054: 2-head offsets unverified
  const S2 = SAMPLE_PROFILES[1]
  const c54 = run1(S2, jobFor(S2), [KITCHEN], null)
  check('V24-054 / CNC-073 2-head offsets unverified → production NC blocked', has(c54.blockers, 'HEAD_UNCALIBRATED') && c54.blockers.includes('HEAD_UNCALIBRATED:HEAD_2') && blocked(() => prod(S2, c54, null)) !== null, c54.blockers.slice(0, 6))
  // V24-055: 3 router spindles vs 3 saw blades
  const S3 = SAMPLE_PROFILES[2]
  const SAW3: MachineProfile = { ...cloneProfile(SAMPLE_PROFILES[3], 'TEST-3-SAWS'), heads: [0, 1, 2].map((i) => ({ ...SAMPLE_PROFILES[3].heads[0], head_id: `HEAD_${i + 1}` })) }
  const cap = (m: MachineProfile, op: string) => capabilities(m).find((x) => x.op === op)!
  const cSaw = run1(SAW3, jobFor(SAW3), [KITCHEN], null)
  check('V24-055 / CNC-012 / CNC-014 3-head router vs 3 saw blades: capabilities not confused', headSummary(S3).routerHeads === 3 && headSummary(S3).sawHeads === 0 && headSummary(SAW3).sawHeads === 3 && headSummary(SAW3).routerHeads === 0 &&
    cap(S3, 'PROFILE').state !== 'unsupported' && cap(S3, 'SAW_CUT').state === 'unsupported' && cap(SAW3, 'PROFILE').state === 'unsupported' && cap(SAW3, 'SAW_CUT').reason === 'SAW_ADAPTER_NOT_AVAILABLE' &&
    texts(cSaw).length === 0 && has(cSaw.blockers, 'UNSUPPORTED_OPERATION'), { saw: cSaw.unsupported })
  // V24-056: ATC absent → T / M tool change blocked
  const { profile: MNA, record: COMNA } = commissioned(testMachine('TEST-NO-ATC', { atc: { supported: false, magazine_slots: 0 } }))
  const jNA0 = jobFor(MNA), cNA0 = run1(MNA, jNA0, [KITCHEN], COMNA)
  const jNA = approveJob(jNA0, cNA0.chain, { operator: 'TEST OPERATOR', engineer: 'TEST ENGINEER' }, AT)
  const cNA = run1(MNA, jNA, [KITCHEN], COMNA)
  const naText = texts(cNA)
  const tampered = cNA.sheets.flatMap((s) => s.programs.map((p, i) => (i === 0 ? { ...p, text: p.text.replace('G43 H', 'T2 M6\nG43 H') } : p)))
  const tamperedParse = parseNc(tampered[0].text, tampered[0].ctx)
  const tb56 = blocked(() => productionFiles(tampered, { machine: MNA, machineHash: profileContentHash(MNA), commissioning: COMNA, post: cNA.post, gate: cNA.gate, meta: cNA.meta }))
  check('V24-056 / CNC-034 ATC absent: no T / M6 written (one program per tool, M0 + MSG), a T / M6 in the file is blocked', naText.every((t) => !code(t).some((l) => /\bM6\b|^T\d/.test(l))) && naText.every((t) => /MSG, LOAD T\d/.test(t)) && cNA.blockers.length === 0 &&
    tamperedParse.issues.some((i) => i.code === 'ATC_ABSENT_TOOL_CHANGE') && !!tb56 && has(tb56, 'NC_CHECK_FAILED') && tb56.includes('NC_BYTES_NOT_APPROVED'), { b: cNA.blockers, tb56 })
  // V24-057: clamp region collision
  const CLAMP = { id: 'TEST-CLAMP-1', x0: 1150, y0: 1700, x1: 1290, y1: 1830, z_top: 40 } // an edge clamp on the far long side
  const { profile: MC, record: COMC } = commissioned(testMachine('TEST-CLAMPS', { fixtures: { bed_type: 'CLAMPS', vacuum_zones: [], clamp_no_go_shapes: [CLAMP], safe_clearance_mm: 10 } }))
  const cC = run1(MC, jobFor(MC), [KITCHEN], COMC)
  const collisionsCam = cC.sheets.flatMap((s) => s.parses.flatMap((p) => p.issues)).filter((i) => i.code === 'CLAMP_COLLISION')
  const legacy = cC.sheets.map((s, i) => ({ sh: cC.nest.sheets[i], progs: camSheet(nest(piecesOf([KITCHEN]), { ...DEFAULT_NEST, gap: 12 }).sheets[i] ?? cC.nest.sheets[i], { ...DEFAULT_CAM, dialect: 'linuxcnc' }, () => true, 'TEST', { post: POSTS.linuxcnc, atc: true }).programs, ctx: s.programs[0].ctx }))
  const legacyHits = legacy.flatMap((l) => l.progs.flatMap((p) => parseNc(p.text, l.ctx).issues)).filter((i) => i.code === 'CLAMP_COLLISION')
  const jC = approveJob(jobFor(MC), cC.chain, { operator: 'TEST OPERATOR', engineer: 'TEST ENGINEER' }, AT)
  const cC2 = run1(MC, jC, [KITCHEN], COMC)
  const legacyProgs = legacy.flatMap((l) => l.progs.map((p) => ({ name: p.name, text: p.text, ctx: l.ctx })))
  const tb57 = blocked(() => productionFiles(legacyProgs, { machine: MC, machineHash: profileContentHash(MC), commissioning: COMC, post: cC2.post, gate: cC2.gate, meta: cC2.meta }))
  check('V24-057 / CNC-048 / CNC-056 clamp zone: nest keeps parts off, traverses climb over it; a program crossing it is export-blocking', verifyNest(cC.nest, cC.nestSettings).length === 0 && collisionsCam.length === 0 && cC.sheets[0].cam.ir.clearZ === 50 && cC2.blockers.length === 0 &&
    legacyHits.length > 0 && !!tb57 && tb57.includes('NC_CHECK_FAILED:CLAMP_COLLISION'), { collisionsCam: collisionsCam.length, legacyHits: legacyHits.length, b: cC2.blockers, tb57: tb57?.slice(0, 4) })
  // V24-058: post not approved for the controller
  const MPN = { ...MV, postprocessor: { ...MV.postprocessor, approved_for_controller: false } }
  const c58 = run1(MPN, job1, [KITCHEN], COM)
  check('V24-058 / CNC-071 unverified controller post → production blocked', has(c58.blockers, 'POSTPROCESSOR_NOT_APPROVED') && blocked(() => prod(MPN, c58, COM)) !== null, c58.blockers)
  // V24-059 / 060 / 061: commissioning not signed, air cut failed, first article failed
  const fail = (patch: Partial<CommissioningInput>) => commission(testMachine(), { ...COM_OK, ...patch }, AT)
  const f59 = fail({ engineer: { name: '', at: AT } }), f60 = fail({ air_cut: { pass: false, date: '2026-10-18', notes: 'TEST: Z overshoot' } }), f61 = fail({ first_article: { pass: false, date: '2026-10-18', measurements: 'TEST 1163.2 (out of tolerance)' } })
  for (const [id, f, code1] of [['V24-059 / CNC-077 commissioning not signed', f59, 'ENGINEER_SIGNOFF_MISSING'], ['V24-060 / CNC-075 air cut failure', f60, 'AIR_CUT_FAILED'], ['V24-061 / CNC-076 first article QC failed', f61, 'FIRST_ARTICLE_QC_FAILED']] as const) {
    const cx = run1(f.profile, jobFor(f.profile), [KITCHEN], f.record)
    check(`${id} → profile not VERIFIED, release gate blocked`, f.record.result === 'FAILED' && f.record.failures.includes(code1) && f.profile.status !== 'VERIFIED' && !f.profile.production_export_allowed && has(cx.blockers, 'MACHINE_PROFILE_NOT_VERIFIED') && blocked(() => prod(f.profile, cx, f.record)) !== null, f.record.failures)
  }
  const jFA = approveJob(job0, c0.chain, { operator: 'TEST OPERATOR', engineer: 'TEST ENGINEER', firstArticle: 'FAIL' }, AT)
  const cFA = run1(MV, jFA, [KITCHEN], COM)
  check('V24-061 job first article FAIL → job cannot be released', cFA.blockers.includes('JOB_FIRST_ARTICLE_QC_FAILED') && blocked(() => prod(MV, cFA, COM)) !== null, cFA.blockers)

  /* ------------------------------------------------ gate cannot be bypassed */
  for (const s of SAMPLE_PROFILES) {
    const b = releaseBlockers(s, null)
    check(`reference gate parity: ${s.profile_id} rejected (MACHINE_PROFILE_NOT_VERIFIED, PRODUCTION_EXPORT_DISABLED)`, b.includes('MACHINE_PROFILE_NOT_VERIFIED') && b.includes('PRODUCTION_EXPORT_DISABLED') && b.includes('CONTROLLER_ID_OR_MANUAL_MISSING'), b)
  }
  check('reference gate parity: no bypass by switching production_export_allowed', releaseBlockers({ ...S3, production_export_allowed: true }, null).includes('MACHINE_PROFILE_NOT_VERIFIED'))
  check('reference gate parity: head calibration per head (HEAD_1, HEAD_2)', machineBlockers(S2).includes('HEAD_UNCALIBRATED:HEAD_1') && machineBlockers(S2).includes('HEAD_UNCALIBRATED:HEAD_2'))
  const forged: MachineProfile = { ...S1, status: 'VERIFIED', production_export_allowed: true, qualification: { parser_pass: true, post_backplot_pass: true, air_cut_pass: true, first_article_pass: true, operator_signed: true, engineer_signed: true, qualified_at: AT, evidence_refs: ['forged'] } }
  const fakeGate = { ...c1.gate, machineProfileId: forged.profile_id, machineProfileRevision: forged.revision, machineProfileHash: profileContentHash(forged) }
  const by = blocked(() => productionFiles(c1.sheets.flatMap((s) => s.programs), { machine: forged, machineHash: null, commissioning: null, post: c1.post, gate: fakeGate, meta: c1.meta }))
  check('CNC-068 / CNC-070 UNVERIFIED (or forged VERIFIED) → production blocked even via a direct function call', !!by && by.includes('COMMISSIONING_RECORD_MISSING') && by.includes('CONTROLLER_ID_OR_MANUAL_MISSING') && blocked(() => productionFiles(c53.sheets.flatMap((s) => s.programs), { machine: S1, machineHash: null, commissioning: null, post: c53.post, gate: { ...c53.gate, approvals: { operator: 'x', engineer: 'y' }, stale: { stale: false, from: null }, ncIssues: [] }, meta: c53.meta })) !== null, by)
  const imp = importProfile(JSON.parse(JSON.stringify(MV)))
  check('import never sets VERIFIED', imp.profile?.status === 'UNVERIFIED' && imp.profile.production_export_allowed === false && !imp.profile.qualification.air_cut_pass && !imp.profile.postprocessor.approved_for_controller)
  const fw = reviseProfile(MV, { ...MV, controller: { ...MV.controller, firmware: '2.9.3' } })
  const dia = reviseProfile(MV, { ...MV, heads: [{ ...MV.heads[0], tools: MV.heads[0].tools.map((t) => (t.tool_id === 'EM8' ? { ...t, diameter_mm: 8.02 } : t)) }] })
  const same = reviseProfile(MV, { ...MV, manufacturer: MV.manufacturer })
  check('CNC-078 / CNC-079 firmware / tool / offset change after VERIFIED → UNVERIFIED, new revision', fw.status === 'UNVERIFIED' && dia.status === 'UNVERIFIED' && fw.revision === 2 && !fw.production_export_allowed && same.status === 'VERIFIED' && same.revision === 2)
  const mutated = { ...MV, controller: { ...MV.controller, firmware: '2.9.3' } }
  check('CNC-078 direct edit of a VERIFIED profile (no new commissioning) → COMMISSIONING_STALE', releaseBlockers(mutated, c1.gate, COM).includes('COMMISSIONING_STALE'))
  const cDia = run1(dia, job1, [KITCHEN], COM)
  check('CNC-031 tool diameter change → NC STALE (tools stage or earlier)', cDia.stale.stale && ['machine', 'tools'].includes(cDia.stale.from!) && cDia.blockers.includes('MACHINE_REVISION_CHANGED'), cDia.stale.from)
  check('CNC-021 machine revision + hash pinned on the job', job1.machine_profile_revision === MV.revision && job1.machine_profile_hash === profileContentHash(MV))

  /* ------------------------------------------------ machine selection / heads */
  check('CNC-009 no machine → MACHINE_NOT_SELECTED; old project → LEGACY_UNASSIGNED', releaseBlockers(null, { ...c1.gate, machineProfileId: null }).includes('MACHINE_NOT_SELECTED') && releaseBlockers(null, { ...c1.gate, machineProfileId: undefined }).includes('LEGACY_UNASSIGNED'))
  check('CNC-011 2-spindle sample shows two independent heads', headSummary(S2).routerHeads === 2 && new Set(S2.heads.map((h) => h.head_id)).size === 2)
  const ATC1: MachineProfile = { ...testMachine('TEST-ATC'), atc: { supported: true, magazine_slots: 3 } }
  check('CNC-013 1 spindle + 3-tool ATC is ONE head', headSummary(ATC1).routerHeads === 1 && headSummary(ATC1).tools === 3 && headSummary(ATC1).atc)
  const DRILL: MachineProfile = { ...testMachine('TEST-DRILL'), machine_type: 'CNC_DRILL', heads: [{ ...testMachine().heads[0], head_id: 'DB_1', type: 'DRILL_BANK', supported_operations: ['DRILL_VERTICAL', 'DRILL_HORIZONTAL'], tools: [{ tool_id: 'DB5', kind: 'DRILL', diameter_mm: 5, actual_calibrated: true }] }] }
  check('CNC-015 / CNC-026 drill bank: drilling (vertical + horizontal) only; horizontal drilling never on a router-only machine', cap(DRILL, 'DRILL_HORIZONTAL').state === 'available' && cap(DRILL, 'PROFILE').state === 'unsupported' && cap(MV, 'DRILL_HORIZONTAL').state === 'unsupported')
  check('CNC-016 / CNC-020 unknown controller / missing firmware → blocked', machineBlockers(S1).includes('CONTROLLER_ID_OR_MANUAL_MISSING') && machineBlockers({ ...MV, controller: { ...MV.controller, firmware: null } }).includes('CONTROLLER_ID_OR_MANUAL_MISSING'))
  const SMALL = commissioned(testMachine('TEST-SMALL', { work_envelope_mm: { x: 2000, y: 1500, z: 200 } }))
  const c19 = run1(SMALL.profile, jobFor(SMALL.profile), [KITCHEN], SMALL.record)
  check('CNC-019 machine smaller than the stock → envelope blockers', has(c19.blockers, 'STOCK_EXCEEDS_ENVELOPE') && c19.blockers.includes('NC_CHECK_FAILED:OUTSIDE_ENVELOPE'), c19.blockers.slice(0, 5))
  const H3: MachineProfile = { ...testMachine('TEST-3HEAD'), heads: [
    { ...testMachine().heads[0], head_id: 'HEAD_1', tools: [testMachine().heads[0].tools[0]], supported_operations: ['PROFILE', 'SLOT'] },
    { ...testMachine().heads[0], head_id: 'HEAD_2', offset_calibrated: false, offset_mm: { x: null, y: 120, z: 0 }, tools: [testMachine().heads[0].tools[1]], supported_operations: ['DRILL_VERTICAL'] },
    { ...testMachine().heads[0], head_id: 'HEAD_3', activation_mapping_verified: false, tools: [testMachine().heads[0].tools[2]], supported_operations: ['DRILL_VERTICAL'] },
  ] }
  const as = assignHeads(H3, [{ operation_id: 'P', op: 'PROFILE' }, { operation_id: 'D5', op: 'DRILL_VERTICAL', diameter: 5 }, { operation_id: 'D35', op: 'DRILL_VERTICAL', diameter: 35 }, { operation_id: 'S', op: 'SAW_CUT' }])
  const a = (id: string) => as.find((x) => x.operation_id === id)!
  check('CNC-022 / CNC-023 head 2 offset not measured, head 3 not mapped → assignment PENDING + gate blockers', a('P').status === 'OK' && a('P').head_id === 'HEAD_1' && a('D5').head_id === 'HEAD_2' && a('D5').reasons.includes('HEAD_OFFSET_NOT_MEASURED:HEAD_2') && a('D35').head_id === 'HEAD_3' && a('D35').reasons.includes('HEAD_ACTIVATION_NOT_MAPPED:HEAD_3') && machineBlockers(H3).includes('HEAD_UNCALIBRATED:HEAD_2') && machineBlockers(H3).includes('HEAD_UNCALIBRATED:HEAD_3'), as)
  check('CNC-024 router head never takes a saw cut', a('S').status === 'UNSUPPORTED')
  check('CNC-025 saw head never takes a pocket', assignHeads(SAW3, [{ operation_id: 'X', op: 'POCKET' }])[0].status === 'UNSUPPORTED')
  const cH3 = run1(H3, jobFor(H3), [KITCHEN], null)
  check('CNC-027 / CNC-032 multi-head: sequential, one program per head (no guessed head-activation code)', headSummary(H3).sequentialOnly && cH3.sheets.some((s) => s.programs.some((p) => / HEAD_2\.nc$/.test(p.name))) && cH3.sheets.some((s) => s.programs.some((p) => / HEAD_1\.nc$/.test(p.name))) && !texts(cH3).some((t) => /\$\d|M6[0-9]/.test(t.replace(/\(.*?\)/g, ''))), cH3.sheets[0]?.programs.map((p) => p.name))
  check('CNC-028 parallel motion needs per-head qualification', machineBlockers({ ...MV, motion_policy: 'PARALLEL_QUALIFIED' }).includes('HEAD_PARALLEL_NOT_QUALIFIED:HEAD_1'))
  check('CNC-030 / CNC-073 tools not measured → TOOLS_NOT_VERIFIED', machineBlockers(S1).includes('TOOLS_NOT_VERIFIED:HEAD_1'))

  /* ------------------------------------------------ parts / nesting */
  const pc = nest(piecesOf(CABINETS), { ...DEFAULT_NEST, grained: () => false })
  const rotDoor = pc.sheets.flatMap((s) => s.parts).find((p) => p.part === 'Door' && p.rotated)
  const cups = rotDoor ? holesOf(rotDoor, DEFAULT_CAM, () => true) : []
  check('CNC-042 a rotated part keeps face A / handing (rigid rotation, hinge cups stay on the L1 edge)', !!rotDoor && cups.length > 0 && cups.every((h) => h.x > rotDoor.x + rotDoor.sx / 2 && h.x <= rotDoor.x + rotDoor.sx && h.y >= rotDoor.y && h.y <= rotDoor.y + rotDoor.sy), rotDoor && { x: rotDoor.x, sx: rotDoor.sx, cups: cups.map((h) => h.x) })
  check('CNC-043 design data unchanged when switching machine', JSON.stringify(run1(S3, jobFor(S3), [KITCHEN], null).parts) === JSON.stringify(c1.parts))
  const nAll = nest(piecesOf(CABINETS))
  check('CNC-044 / CNC-045 / CNC-047 no overlap, inside usable stock, one material per sheet', verifyNest(nAll).length === 0 && nAll.sheets.every((s) => s.parts.every((p) => p.material === s.material)))
  check('CNC-046 grain locked parts never rotated on grained boards', nAll.sheets.flatMap((s) => s.parts).filter((p) => DEFAULT_NEST.grained(p.material) && p.grain === 'L').every((p) => !p.rotated))
  const cBig = run1(MV, jobFor(MV), CABINETS, COM)
  check('CNC-050 parts larger than the stock are reported and block production', cBig.nest.unplaced.length === 4 && cBig.blockers.includes('PARTS_DO_NOT_FIT_STOCK:4'), cBig.nest.unplaced.map((p) => p.label))
  const lr = labelRows(nAll.sheets)
  check('CNC-051 labels map sheet → part id → revision', lr[0].includes('Part ID') && lr[0].includes('Rev') && lr.slice(1).every((r) => /^c\d\.[A-Z]+$/.test(String(r[9])) && /^[0-9a-f]{8}$/.test(String(r[10]))))

  /* ------------------------------------------------ CAM / NC */
  const iso = POSTS.iso_generic, lin = POSTS.linuxcnc, grbl = POSTS.grbl11
  const isoCnc = run1(null, null, [KITCHEN], null, { ...PREFS, cnc: { ...DEFAULT_CAM, dialect: 'iso' } })
  const g43 = (t: string) => { const c = code(t); return c.every((l, i) => !/^T(\d+) M6$/.test(l) || c.slice(i + 1, i + 4).some((x) => x.includes(`G43 H${/^T(\d+)/.exec(l)![1]}`))) && c.some((l) => /M6$/.test(l)) }
  check('G43 H n after every M6 — ISO generic', texts(isoCnc).every(g43), texts(isoCnc)[0]?.slice(0, 400))
  check('G43 H n after every M6 — LinuxCNC', texts(c1).every(g43))
  const grblCnc = run1(null, null, [KITCHEN], null, { ...PREFS, cnc: { ...DEFAULT_CAM, dialect: 'grbl' } })
  check('CNC-062 GRBL 1.1: no M6 / G43 / canned cycles; M0 operator stop with load + zero-Z message before motion', texts(grblCnc).every((t) => { const c = code(t); const f = c.findIndex((l) => /[XYZ]-?\d/.test(l)); return !c.some((l) => /\bM6\b|\bG43\b|\bG8[1-9]\b/.test(l)) && c.slice(0, f).includes('M0') && /ZERO Z ON THE BOARD TOP/.test(t) }))
  check('CNC-061 unsupported canned drill cycle rejected', parseNc('G21 G90\nG81 X10 Y10 Z-5 R2 F100\nM30\n', { dialect: grbl.dialect, dialectName: grbl.label }).issues.some((i) => i.code === 'CANNED_CYCLE_UNSUPPORTED'))
  const pr = parseNc('G21 G90 G17\nS1000 M3\nG0 X0 Y0 Z5\nG2 X10 Y0 I5 J0 F500\nM5\nM30\n', { dialect: iso.dialect, profileCodes: ['G0', 'G1', 'G17', 'G21', 'G90', 'M3', 'M5', 'M30'] })
  check('parser rejects a code outside the profile’s verified codes (G2)', pr.issues.some((i) => i.code === 'CODE_NOT_IN_PROFILE' && /G2/.test(i.msg)))
  check('parser rejects a code outside the dialect (G43 on GRBL)', parseNc('G21 G90\nG43 H1 Z5\nM30\n', { dialect: grbl.dialect }).issues.some((i) => i.code === 'CODE_NOT_IN_DIALECT'))
  check('CNC-059 units: motion before G21 / G20 blocked, G20 flagged', parseNc('G90\nG0 X1 Y1 Z5\nM30\n').issues.some((i) => i.code === 'UNITS_NOT_SET') && parseNc('G20 G90\nG0 X1\nM30\n').issues.some((i) => i.code === 'INCH_UNITS'))
  const inc = parseNc('G21 G90\nG0 X10 Y10 Z5\nG91\nG0 X5 Y5\nG90\nM30\n')
  check('CNC-060 G90 / G91 modal state tracked (incremental move → X15 Y15), missing distance mode blocked', inc.bounds.x1 === 15 && inc.bounds.y1 === 15 && parseNc('G21\nG0 X1\nM30\n').issues.some((i) => i.code === 'DISTANCE_MODE_NOT_SET'))
  check('CNC-063 LinuxCNC multi-spindle $ syntax never written; a $ word is rejected', !texts(c1).some((t) => t.includes('$')) && parseNc('G21 G90\nM3 $1 S1000\nM30\n', { dialect: lin.dialect }).issues.some((i) => i.code === 'UNPARSEABLE'))
  check('CNC-058 depth beyond the measured board + allowance blocked', parseNc('G21 G90\nS1 M3\nG0 X10 Y10 Z2\nG1 Z-19.2 F100\nM5\nM30\n', { stockT: 18, allowance: 0.5 }).issues.some((i) => i.code === 'DEPTH_BEYOND_STOCK'))
  check('CNC-074 NC not parsed → NC_NOT_PARSED', releaseBlockers(MV, { ...c1.gate, ncIssues: null }, COM).includes('NC_NOT_PARSED'))
  check('CNC-072 missing origin / measured thickness / lot → blocked', machineBlockers(S1).includes('STOCK_ORIGIN_UNCALIBRATED') && run1(MV, jobFor(MV, { mfc: null, lot: null }), [KITCHEN], COM).blockers.some((b) => b.startsWith('STOCK_THICKNESS_NOT_MEASURED:MFC')) && run1(MV, jobFor(MV, { lot: null }), [KITCHEN], COM).blockers.some((b) => b.startsWith('STOCK_LOT_MISSING')))
  check('edge band thickness must be confirmed', run1(MV, jobFor(MV, { band: false }), [KITCHEN], COM).blockers.includes('EDGE_BAND_THICKNESS_NOT_CONFIRMED'))
  check('back panel rebate machined (SLOT) when the machine can; GROOVE_NOT_MACHINED_MANUAL when it cannot', /Back-panel rebates/.test(texts(c1).join()) && run1({ ...MV, heads: [{ ...MV.heads[0], supported_operations: ['PROFILE', 'DRILL_VERTICAL'] }] }, jobFor(MV), [KITCHEN], COM).blockers.some((b) => b.startsWith('UNSUPPORTED_OPERATION:SLOT:GROOVE_NOT_MACHINED_MANUAL')))

  /* ------------------------------------------------ preview and release files */
  const pv = previewFiles(c53.sheets[0].programs, { machine: S1, machineHash: profileContentHash(S1), post: c53.post, blockers: c53.blockers, meta: c53.meta, at: AT })
  const f0 = pv.files[0]
  const lines = f0.text.split('\n')
  const firstMotion = lines.findIndex((l) => /[XYZ]-?\d/.test(l.replace(/\(.*?\)/g, '')))
  const manifest = JSON.parse(pv.files.find((f) => f.name === 'manifest.json')!.text)
  check('CNC-082 preview: .NOT_FOR_MACHINE.txt, watermark + machine / status / post / blockers header, M0 before the first motion, manifest with sha256', f0.name.endsWith(PREVIEW_EXT) && lines[0] === `(${WATERMARK})` && /^\(machine=DEMO_1_HEADS_NOT_FOR_MACHINE status=UNVERIFIED post=iso_generic /.test(lines[1]) && lines.some((l) => l.startsWith('(blockers')) && lines.slice(0, firstMotion).some((l) => l.startsWith('M0 (')) &&
    manifest.kind === 'ENGINEERING_PREVIEW' && manifest.not_for_machine === true && manifest.files[0].sha256 === sha256(f0.text) && manifest.blockers.length === c53.blockers.length && pv.parses.every((p) => !p.parse.issues.some((i) => i.code === 'PREVIEW_WITHOUT_M0')), { name: f0.name, head: lines.slice(0, 6) })
  const reparse = parseNc(f0.text, { ...c53.sheets[0].programs[0].ctx, preview: true })
  check('CNC-065 the manifest holds the parse of the exact bytes written; a changed byte changes the checksum', manifest.files[0].sha256 !== sha256(f0.text.replace('G0', 'G00')) && +reparse.minZ.toFixed(3) === manifest.files[0].parse.min_z && reparse.codes.join() === manifest.files[0].parse.codes.join() && reparse.issues.length === manifest.files[0].parse.issues.length, { m: manifest.files[0].parse, r: reparse.minZ })
  const out = prod(MV, c1, COM)
  const pm = JSON.parse(out.files.find((f) => f.name === 'manifest.json')!.text)
  check('CNC-067 / CNC-080 production manifest: post id + hash, checksums, revisions, sign-offs; .nc only when the gate is empty', out.files.filter((f) => f.name.endsWith('.nc')).length === texts(c1).length && pm.kind === 'PRODUCTION_RELEASE' && pm.post.sha256 === lin.sha256 && pm.files.every((f: { name: string; sha256: string }) => f.sha256 === sha256(out.files.find((x) => x.name === f.name)!.text)) && pm.signoffs.engineer === 'TEST ENGINEER' && pm.machine.revision === MV.revision && pm.job.chain.nc === c1.chain.nc, pm.files?.[0])
  // CNC-018: a released job is immutable; changing the machine forks a new revision
  const released = releaseJob(job1, { job_id: job1.job_id, job_revision: 1, at: AT, machine_profile_id: MV.profile_id, machine_profile_revision: MV.revision, machine_profile_hash: profileContentHash(MV), post: { id: lin.id, version: lin.version, sha256: lin.sha256 }, chain: c1.chain, files: [], approvals: { operator: 'TEST OPERATOR', engineer: 'TEST ENGINEER', at: AT } })
  let frozen = false
  try {
    ;(released as { status: string }).status = 'DRAFT'
  } catch {
    frozen = true
  }
  const forked = selectMachine(released, pin(MB))
  check('CNC-018 released record immutable; another machine → new job revision', frozen && released.status === 'PRODUCTION_RELEASED' && Object.isFrozen(released.released) && forked.revision === 2 && forked.released === null && forked.machine_profile_id === MB.profile_id && forkJob(released).approval === null)
  let threw = false
  try {
    approveJob(released, c1.chain, { operator: 'a', engineer: 'b' })
  } catch {
    threw = true
  }
  check('a released job cannot be re-approved', threw)
  check('isStale: no record → nothing STALE; same chain → CURRENT', !isStale(null, c1.chain).stale && !isStale(c1.chain, c1.chain).stale)

  return { all: results.every((r) => r.pass), passed: results.filter((r) => r.pass).length, total: results.length, failed: results.filter((r) => !r.pass), results: results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.id}`) }
}

function STAGES_ALL(stages: Record<string, string>) {
  return Object.values(stages).every((v) => v === 'STALE')
}

/** The blockers of every sample profile for a fully measured job (for the QA report). */
export function samples() {
  return SAMPLE_PROFILES.map((s) => ({ id: s.profile_id, status: s.status, blockers: run1(s, jobFor(s), [KITCHEN], null).blockers }))
}

/** The header of an engineering preview file (for the QA report). */
export function previewHeader() {
  const S1 = SAMPLE_PROFILES[0]
  const c = run1(S1, jobFor(S1), [KITCHEN], null)
  const pv = previewFiles(c.sheets[0].programs, { machine: S1, machineHash: profileContentHash(S1), post: c.post, blockers: c.blockers, meta: c.meta, at: AT })
  return { name: pv.files[0].name, head: pv.files[0].text.split('\n').slice(0, 24).join('\n'), files: pv.files.map((f) => f.name) }
}
