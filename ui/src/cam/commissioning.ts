/**
 * Commissioning wizard logic (docs/requirements/v2_4/baseline_v2_3/…/docs/09_MACHINE_COMMISSIONING_AND_QC.md),
 * pure functions shared by the Machines & Tools wizard and the unit tests:
 *   1. survey sheet (checklist, signed)          → SURVEY_ITEMS
 *   2. tool / head measurements                  → profile edits (a new revision)
 *   3. parser + backplot on the profile's post   → automatedChecks() (runs the real CAM + post + parser)
 *   4. supervised air cut                        → airCutFiles() (release.ts) + the recorded result
 *   5. first article measured vs tolerances      → firstArticleRows() / rowsPass()
 *   6. operator + engineer sign-off, expiry      → wizardInput() → commission() (machine.ts) → VERIFIED
 * Any later change to heads / tools / offsets / controller / post drops the profile to UNVERIFIED (reviseProfile).
 */
import type { Cabinet } from '../interior/model'
import { DEFAULT_CAM } from './gcode'
import { interiorCnc, type CamPrefsLike } from './interiorJob'
import type { CommissioningInput, MachineProfile } from './machine'
import { MOTION_ISSUES } from './ncparse'
import { airCutFiles, type WrittenFile } from './release'

/** Survey sheet items (docs/09 "Phiếu khảo sát thiết bị"); every one must be confirmed on the real machine. */
export const SURVEY_ITEMS = [
  'machine_id', // machine id / serial, last maintenance date
  'safety', // E-stop / interlock locations seen and working; the software never bypasses them
  'controller', // controller OEM / build / firmware, manual at hand, a sample program that ran
  'codes', // supported NC codes, M / T / S / F conventions, drill cycles, head / tool change checked
  'axes', // X / Y / Z mapping, axis directions, soft / hard limits, home, work zero (G54…), safe Z, park
  'envelope', // work envelope MEASURED (catalogue values are references)
  'table', // table, vacuum zones, clamp / no-go positions entered in the profile
  'heads', // head list (spindle / drill bank / saw / knife), offsets X / Y / Z measured, activation order
  'tools', // tools mounted: diameter / kerf measured, length / protrusion, max rpm, feeds approved by the shop
  'stock', // stock profile: sizes, measured thickness, grain, face A / B, spoilboard
] as const
export type SurveyItem = (typeof SURVEY_ITEMS)[number]

export interface FaRow {
  feature: string
  nominal: number
  tolerance: number
  measured: number | null
}

/**
 * First-article rows for the commissioning test panel (cabinet side of TEST_CABINET): the engineer sets the
 * tolerances (the defaults are a starting point, not a promise of accuracy — docs/06 §9) and QC enters the values.
 */
export function firstArticleRows(c: Cabinet = TEST_CABINET): FaRow[] {
  return [
    { feature: 'side length (mm)', nominal: c.h, tolerance: 0.3, measured: null },
    { feature: 'side width (mm, front banded)', nominal: c.d - 1, tolerance: 0.3, measured: null },
    { feature: 'diagonal difference (mm)', nominal: 0, tolerance: 0.5, measured: null },
    { feature: 'shelf-pin hole X from bottom (mm)', nominal: Math.ceil((c.h * 0.25) / 32) * 32, tolerance: 0.2, measured: null },
    { feature: 'shelf-pin hole Y from front (mm)', nominal: 37, tolerance: 0.2, measured: null },
    { feature: 'hole depth (mm)', nominal: 12, tolerance: 0.3, measured: null },
    { feature: 'back rebate depth (mm)', nominal: 8, tolerance: 0.3, measured: null },
  ]
}

export const rowPass = (r: FaRow) => r.measured !== null && Number.isFinite(r.measured) && Math.abs(r.measured - r.nominal) <= r.tolerance + 1e-9
export const rowsPass = (rows: FaRow[]) => rows.length > 0 && rows.every(rowPass)

/** The commissioning test cabinet: one carcass, one shelf, one door (small enough for every sheet / envelope). */
export const TEST_CABINET: Cabinet = { id: 'qa', name: 'Commissioning test cabinet', room: 'qa', w: 600, d: 560, h: 720, t: 18, shelves: 1, doors: 1, board: 'MFC 18 - Oak', front: 'MFC 18 - Oak' }
const PREFS: CamPrefsLike = { stock: {}, trim: 10, web: 4, grain: true, cnc: { ...DEFAULT_CAM } }

export interface AutoCheck {
  parser_pass: boolean
  post_backplot_pass: boolean
  /** Programs of the test panel (post output), the issues the parser found, the air-cut test files. */
  programs: { name: string; text: string }[]
  issues: { code: string; msg: string; program: string }[]
  airCut: WrittenFile[]
  minZ: number
  segments: number
}

/** Issues that only concern a production JOB (stock lot / sign-off…), not the machine's post / parser check. */
const JOB_ONLY = /^(STOCK_|EDGE_BAND|JOB_|NC_NOT_PARSED|MACHINE_|CONTROLLER_|WORK_|SAFE_Z|HEAD_|TOOLS_|POSTPROCESSOR|QUALIFICATION|PRODUCTION_|COMMISSIONING|LEGACY|CABINET_)/

/**
 * Step 3 (automated): the profile's own post writes the test cabinet, the parser re-reads the exact bytes with
 * the profile's dialect, verified codes, ATC, envelope, clamps; the backplot must stay inside the sheet / envelope,
 * cut through the board and never rapid in material. Pass = no export-blocking issue from the post or parser.
 */
export function automatedChecks(m: MachineProfile, opts: { gap?: number; cabinet?: Cabinet } = {}): AutoCheck {
  const cnc = interiorCnc({ cabinets: [opts.cabinet ?? TEST_CABINET], cam: PREFS, machine: m, machineProfileId: m.profile_id, job: null, jobName: `COMMISSIONING ${m.profile_id}` })
  const programs = cnc.sheets.flatMap((s) => s.programs)
  const issues = cnc.sheets.flatMap((s) => s.programs.flatMap((p, i) => s.parses[i].issues.filter((x) => x.block).map((x) => ({ code: x.code, msg: x.msg, program: p.name }))))
  for (const s of cnc.sheets) for (const code of s.cam.postIssues) issues.push({ code, msg: code, program: s.cam.ir.name })
  const parses = cnc.sheets.flatMap((s) => s.parses)
  const motion = issues.filter((x) => MOTION_ISSUES.has(x.code))
  const codeIssues = issues.filter((x) => !MOTION_ISSUES.has(x.code) && !JOB_ONLY.test(x.code))
  const minZ = Math.min(0, ...parses.map((p) => p.minZ))
  const segments = parses.reduce((a, p) => a + p.segments.length, 0)
  let airCut: WrittenFile[] = []
  try {
    airCut = programs.length ? airCutFiles(programs, { gap: opts.gap ?? 20, clampTop: Math.max(0, ...m.fixtures.clamp_no_go_shapes.map((c) => c.z_top + (m.fixtures.safe_clearance_mm ?? 0))) }) : []
  } catch (e) {
    issues.push({ code: 'AIRCUT_NOT_LIFTED', msg: String(e), program: '' })
  }
  return { parser_pass: programs.length > 0 && codeIssues.length === 0, post_backplot_pass: programs.length > 0 && motion.length === 0 && segments > 0, programs: programs.map((p) => ({ name: p.name, text: p.text })), issues, airCut, minZ, segments }
}

export interface WizardState {
  survey: Record<SurveyItem, boolean>
  serial: string
  maintenance: string
  auto: { parser_pass: boolean; post_backplot_pass: boolean } | null
  postApproved: boolean
  air: { pass: boolean; date: string; notes: string; supervisor: string }
  sawTest: { pass: boolean; notes: string } | null
  rows: FaRow[]
  faDate: string
  operator: string
  engineer: string
  signedAt: string
  validUntil: string
  evidence: string
}

export const blankSurvey = (): Record<SurveyItem, boolean> => Object.fromEntries(SURVEY_ITEMS.map((k) => [k, false])) as Record<SurveyItem, boolean>

/** Default validity of a commissioning: 180 days (the engineer may set another date). */
export const defaultValidUntil = (from = new Date()) => new Date(from.getTime() + 180 * 864e5).toISOString().slice(0, 10)

export function newWizard(today = new Date().toISOString().slice(0, 10)): WizardState {
  return { survey: blankSurvey(), serial: '', maintenance: '', auto: null, postApproved: false, air: { pass: false, date: today, notes: '', supervisor: '' }, sawTest: null, rows: firstArticleRows(), faDate: today, operator: '', engineer: '', signedAt: today, validUntil: defaultValidUntil(new Date(`${today}T00:00:00Z`)), evidence: '' }
}

/** Wizard state → the commissioning record input (commission() decides VERIFIED / FAILED). */
export function wizardInput(w: WizardState, at = new Date().toISOString()): CommissioningInput {
  const meas = w.rows.map((r) => `${r.feature}: nominal ${r.nominal} ± ${r.tolerance}, measured ${r.measured ?? '—'} ${rowPass(r) ? 'OK' : 'OUT'}`).join('; ')
  return {
    parser_pass: !!w.auto?.parser_pass, post_backplot_pass: !!w.auto?.post_backplot_pass, post_approved_for_controller: w.postApproved,
    air_cut: { pass: w.air.pass, date: w.air.date, notes: `${w.air.notes}${w.air.supervisor ? ` (supervised by ${w.air.supervisor})` : ''}` },
    first_article: { pass: rowsPass(w.rows), date: w.faDate, measurements: meas },
    operator: { name: w.operator, at }, engineer: { name: w.engineer, at },
    evidence_refs: [...w.evidence.split('\n').map((x) => x.trim()).filter(Boolean), ...(w.serial ? [`survey: serial ${w.serial}${w.maintenance ? `, maintenance ${w.maintenance}` : ''}`] : [])],
    valid_until: w.validUntil || null,
    survey: { ...w.survey }, first_article_rows: w.rows.map((r) => ({ ...r })), saw_test: w.sawTest,
  }
}

