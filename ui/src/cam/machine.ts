/**
 * CNC machine profiles (schema: docs/requirements/v2_4/baseline_v2_3/…/schemas/machine_profile.schema.json,
 * v2.2.0) and the production release gate.
 *
 * - A profile describes ONE real machine: heads (router spindle / saw blade / drill bank / knife, each with its
 *   own offset, tools and supported operations), ATC, controller model + firmware + verified codes, the
 *   approved post-processor, work envelope, clamps / no-go zones, safe clearance and the qualification record.
 *   1 / 2 / 3 heads are never inferred from the number of tools, and 3 saw blades are not 3 router spindles.
 * - Status DRAFT / UNVERIFIED / IN_QUALIFICATION / SUSPENDED never allows production NC. VERIFIED is reached
 *   only through a commissioning record (parser + backplot + air cut + first article + operator and engineer
 *   sign-off); importing a profile never sets it, and any change to heads, tools, offsets, controller, post,
 *   envelope, origin or fixtures drops it back to UNVERIFIED.
 * - `releaseBlockers(machine, job, commissioning)` is the TypeScript port of qa/reference_release_gate.py plus
 *   the job-specific checks the reference leaves out (stock measured, revision pinned, STALE, NC parsed,
 *   unsupported operations, oversize parts, sign-off). An empty list is the only way to production NC.
 */
import { hashOf } from '../lib/sha256'

export type HeadType = 'ROUTER_SPINDLE' | 'SAW_BLADE' | 'DRILL_BANK' | 'KNIFE'
export type OperationKind = 'PROFILE' | 'POCKET' | 'DRILL_VERTICAL' | 'DRILL_HORIZONTAL' | 'SLOT' | 'SAW_CUT' | 'ENGRAVE' | 'KNIFE_CUT'
export const OPERATIONS: OperationKind[] = ['PROFILE', 'POCKET', 'SLOT', 'DRILL_VERTICAL', 'DRILL_HORIZONTAL', 'SAW_CUT', 'ENGRAVE', 'KNIFE_CUT']
export type MachineStatus = 'DRAFT' | 'UNVERIFIED' | 'IN_QUALIFICATION' | 'VERIFIED' | 'SUSPENDED'
export type MachineType = 'CNC_ROUTER' | 'CNC_SAW' | 'PANEL_SAW' | 'CNC_DRILL' | 'HYBRID'
export type ToolKind = 'END_MILL' | 'DRILL' | 'FORSTNER' | 'SLOT_CUTTER' | 'SAW_BLADE' | 'KNIFE' | 'UNASSIGNED'
export const TOOL_KINDS: ToolKind[] = ['END_MILL', 'DRILL', 'FORSTNER', 'SLOT_CUTTER', 'SAW_BLADE', 'KNIFE', 'UNASSIGNED']

export interface MachineTool {
  tool_id: string
  kind: ToolKind | string
  diameter_mm: number | null
  actual_calibrated: boolean
  /** Tool / pocket number used for T and H words (extension; schema allows extra tool fields). */
  number?: number | null
  length_mm?: number | null
  calibrated_at?: string | null
  /** Saw blade: measured kerf (mm). */
  kerf_mm?: number | null
}

export interface MachineHead {
  head_id: string
  type: HeadType
  offset_mm: { x: number | null; y: number | null; z: number | null }
  offset_calibrated: boolean
  activation_mapping_verified: boolean
  kinematics_group: string
  tools: MachineTool[]
  supported_operations: OperationKind[]
  simultaneous_qualified: boolean
}

/** A clamp / no-go zone in work coordinates (mm from the sheet's lower-left corner; z_top above the board top). */
export interface ClampZone {
  id: string
  x0: number
  y0: number
  x1: number
  y1: number
  z_top: number
}

export interface MachineProfile {
  schema_version: '2.2.0'
  profile_id: string
  revision: number
  status: MachineStatus
  machine_type: MachineType
  manufacturer: string | null
  machine_model: string | null
  serial_reference?: string | null
  controller: { name: string | null; model: string | null; firmware: string | null; manual_reference: string | null; supported_codes: string[] }
  axes: string[]
  work_envelope_mm: { x: number | null; y: number | null; z: number | null }
  origin: { stock_corner: string | null; z_reference: string | null; work_offset: string | null; home_calibrated: boolean }
  heads: MachineHead[]
  motion_policy?: 'SEQUENTIAL_ONLY' | 'PARALLEL_QUALIFIED'
  atc: { supported: boolean; magazine_slots: number | null }
  fixtures: { bed_type: string | null; vacuum_zones: object[]; clamp_no_go_shapes: ClampZone[]; safe_clearance_mm: number | null }
  postprocessor: { id: string | null; version: string | null; sha256: string | null; approved_for_controller: boolean }
  qualification: {
    parser_pass: boolean
    post_backplot_pass: boolean
    air_cut_pass: boolean
    first_article_pass: boolean
    operator_signed: boolean
    engineer_signed: boolean
    qualified_at?: string | null
    evidence_refs?: string[]
  }
  production_export_allowed: boolean
  /**
   * MD extension (not part of the v2.2 schema; `schemaProfile()` strips it): the controller family, file
   * extension, tool-length mode, operator pause code and spindle-select codes the posts need, saw blade data,
   * and where the profile came from (machine library template). Everything here except `provenance` and
   * `qualified_ops` is machine content: changing it makes a new revision and drops VERIFIED.
   */
  ext?: MachineExt
}

/** Tool length handling after a tool load: G43 H n, applied by the controller on M6, or Z zeroed per program. */
export type ToolLengthMode = 'G43' | 'AUTO_ON_TOOL_CHANGE' | 'ZERO_PER_TOOL'

export interface MachineExt {
  /** ControllerFamilyId of cam/library (kept as a string here so the gate does not depend on the library). */
  controller_family?: string | null
  /** Program file extension with the dot (".nc", ".tap", ".mpf"); null = not documented → the post blocks. */
  file_extension?: string | null
  tool_length_mode?: ToolLengthMode | null
  /** Program stop the controller documents for an operator action (e.g. "M0"); null = none → no pause written. */
  operator_pause_code?: string | null
  /** Spindle / head select codes from the controller manual, per head (never guessed). */
  spindle_select?: { head_id: string; codes: string[] }[]
  /** Comment syntax of the controller (null = the family's documented style; 'none' = write no comments). */
  comment_style?: 'paren' | 'semicolon' | 'slash' | 'apostrophe' | 'block' | 'none' | null
  /** Saw blade (panel saw or router-mounted saw unit), mm. Kerf measured on a test cut. */
  saw?: { blade_diameter_mm: number | null; kerf_mm: number | null; max_cut_height_mm: number | null; cut_length_mm: number | null; orientation?: 'X' | 'Y' | null; trim_mm?: number | null }
  /** Table type and the head data of the catalogue (power, max rpm, holder) per head. */
  table?: string | null
  head_info?: { head_id: string; power_kw: number | null; rpm_max: number | null; holder: string | null }[]
  native_formats?: string[]
  vendor_cam?: string | null
  /** Layer names of the per-part DXF for vendor CAM (cam/vendorDxf.ts). */
  dxf_layers?: { outline: string; drill: string; groove: string; pocket: string } | null
  /** Notes of the controller family that say "not documented" (the profile must state them). */
  undocumented?: string[]
  /** Machine library template this profile was made from (reference data, catalogue values). */
  provenance?: { template_id: string; manufacturer: string; model: string; confidence: string; sources: { title: string; url: string }[]; picked_at: string; choices?: unknown } | null
  /** Operations qualified by commissioning beyond the base gate (e.g. SAW_CUT of a router saw unit). Set only by commission(). */
  qualified_ops?: OperationKind[]
}

/** The profile as the v2.2 schema defines it (the MD extension removed). */
export function schemaProfile(p: MachineProfile): Omit<MachineProfile, 'ext'> {
  const { ext: _ext, ...rest } = p
  void _ext
  return rest
}

/** Machine content of the extension (no provenance / qualification flags). */
const extContent = (e: MachineExt) => {
  const { provenance: _p, qualified_ops: _q, ...rest } = e
  void _p
  void _q
  return rest
}

/** Operations each tool kind can do (a tool that is UNASSIGNED does nothing). */
export const TOOL_OPS: Record<string, OperationKind[]> = {
  END_MILL: ['PROFILE', 'POCKET', 'SLOT', 'ENGRAVE'],
  SLOT_CUTTER: ['SLOT'],
  DRILL: ['DRILL_VERTICAL', 'DRILL_HORIZONTAL'],
  FORSTNER: ['DRILL_VERTICAL'],
  SAW_BLADE: ['SAW_CUT'],
  KNIFE: ['KNIFE_CUT'],
  UNASSIGNED: [],
}
/** Operations a head type can physically do; a saw blade never gets router (radius-compensated) paths. */
export const HEAD_OPS: Record<HeadType, OperationKind[]> = {
  ROUTER_SPINDLE: ['PROFILE', 'POCKET', 'SLOT', 'ENGRAVE', 'DRILL_VERTICAL'],
  SAW_BLADE: ['SAW_CUT'],
  DRILL_BANK: ['DRILL_VERTICAL', 'DRILL_HORIZONTAL'],
  KNIFE: ['KNIFE_CUT'],
}
/** No saw-blade / knife post adapter has been qualified in this build: SAW_CUT and KNIFE_CUT stay unsupported. */
export const SAW_ADAPTER_AVAILABLE = false
export const KNIFE_ADAPTER_AVAILABLE = false

const REQUIRED_QUALIFICATION = ['parser_pass', 'post_backplot_pass', 'air_cut_pass', 'first_article_pass', 'operator_signed', 'engineer_signed'] as const

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Machine-only blockers: a line-by-line port of release_blockers() in qa/reference_release_gate.py. */
export function machineBlockers(machine: MachineProfile): string[] {
  const errors: string[] = []
  if (machine.status !== 'VERIFIED') errors.push('MACHINE_PROFILE_NOT_VERIFIED')
  const c = machine.controller ?? ({} as MachineProfile['controller'])
  if (!(c.name && c.model && c.firmware && c.manual_reference)) errors.push('CONTROLLER_ID_OR_MANUAL_MISSING')
  const area = machine.work_envelope_mm ?? ({} as MachineProfile['work_envelope_mm'])
  if (!(['x', 'y', 'z'] as const).every((a) => num(area[a]) && (area[a] as number) > 0)) errors.push('WORK_ENVELOPE_UNCALIBRATED')
  const o = machine.origin ?? ({} as MachineProfile['origin'])
  if (!(o.stock_corner && o.z_reference && o.work_offset && o.home_calibrated)) errors.push('STOCK_ORIGIN_UNCALIBRATED')
  const fx = machine.fixtures ?? ({} as MachineProfile['fixtures'])
  if (!num(fx.safe_clearance_mm)) errors.push('SAFE_Z_NOT_DEFINED')
  const heads = machine.heads ?? []
  if (!heads.length) errors.push('NO_TOOL_HEADS')
  for (const h of heads) {
    const id = h.head_id || 'UNKNOWN'
    if (!(h.activation_mapping_verified && h.offset_calibrated)) errors.push(`HEAD_UNCALIBRATED:${id}`)
    if (!(['x', 'y', 'z'] as const).every((a) => num(h.offset_mm?.[a]))) errors.push(`HEAD_OFFSET_INCOMPLETE:${id}`)
    if (!h.tools?.length || !h.tools.every((t) => t.actual_calibrated && num(t.diameter_mm))) errors.push(`TOOLS_NOT_VERIFIED:${id}`)
    if (machine.motion_policy === 'PARALLEL_QUALIFIED' && !h.simultaneous_qualified) errors.push(`HEAD_PARALLEL_NOT_QUALIFIED:${id}`)
  }
  const p = machine.postprocessor ?? ({} as MachineProfile['postprocessor'])
  if (!(p.id && p.version && p.sha256 && p.approved_for_controller)) errors.push('POSTPROCESSOR_NOT_APPROVED')
  const q = machine.qualification ?? ({} as MachineProfile['qualification'])
  for (const k of REQUIRED_QUALIFICATION) if (!q[k]) errors.push(`QUALIFICATION_MISSING:${k}`)
  if (!q.evidence_refs?.length || !q.qualified_at) errors.push('QUALIFICATION_EVIDENCE_MISSING')
  if (!machine.production_export_allowed) errors.push('PRODUCTION_EXPORT_DISABLED')
  return errors
}

/** Hash of everything that changes what the machine does (not status / qualification / revision). */
export function profileContentHash(m: MachineProfile): string {
  return hashOf({
    profile_id: m.profile_id, machine_type: m.machine_type, manufacturer: m.manufacturer, machine_model: m.machine_model, serial_reference: m.serial_reference ?? null,
    controller: m.controller, axes: m.axes, work_envelope_mm: m.work_envelope_mm, origin: m.origin, heads: m.heads, motion_policy: m.motion_policy ?? 'SEQUENTIAL_ONLY',
    atc: m.atc, fixtures: m.fixtures, postprocessor: { id: m.postprocessor.id, version: m.postprocessor.version, sha256: m.postprocessor.sha256 },
    // older profiles have no extension: their hash is unchanged
    ...(m.ext ? { ext: extContent(m.ext) } : {}),
  })
}
/** Hash of the heads, tools and offsets only (the "tools" stage of a job's hash chain). */
export const toolsHash = (m: MachineProfile | null) => hashOf(m ? m.heads.map((h) => ({ head: h.head_id, type: h.type, offset: h.offset_mm, tools: h.tools })) : null)

/* ------------------------------------------------------------------ sample profiles (v2.3 examples) */

const blankQualification = (): MachineProfile['qualification'] => ({ parser_pass: false, post_backplot_pass: false, air_cut_pass: false, first_article_pass: false, operator_signed: false, engineer_signed: false, qualified_at: null, evidence_refs: [] })

function demoHead(n: number, type: HeadType): MachineHead {
  return {
    head_id: `HEAD_${n}`, type, offset_mm: { x: null, y: null, z: null }, offset_calibrated: false, activation_mapping_verified: false, kinematics_group: 'UNKNOWN_SHARED_GANTRY',
    tools: [{ tool_id: `TOOL_${n}`, kind: 'UNASSIGNED', diameter_mm: null, actual_calibrated: false }],
    supported_operations: type === 'SAW_BLADE' ? ['SAW_CUT'] : ['PROFILE', 'POCKET', 'SLOT'], simultaneous_qualified: false,
  }
}
function demo(id: string, type: MachineType, heads: MachineHead[]): MachineProfile {
  return {
    schema_version: '2.2.0', profile_id: id, revision: 1, status: 'UNVERIFIED', machine_type: type, manufacturer: null, machine_model: null, serial_reference: null,
    controller: { name: null, model: null, firmware: null, manual_reference: null, supported_codes: [] }, axes: ['X', 'Y', 'Z'], work_envelope_mm: { x: null, y: null, z: null },
    origin: { stock_corner: null, z_reference: null, work_offset: null, home_calibrated: false }, heads, motion_policy: 'SEQUENTIAL_ONLY', atc: { supported: false, magazine_slots: 0 },
    fixtures: { bed_type: null, vacuum_zones: [], clamp_no_go_shapes: [], safe_clearance_mm: null }, postprocessor: { id: null, version: null, sha256: null, approved_for_controller: false },
    qualification: blankQualification(), production_export_allowed: false,
  }
}
/**
 * The v2.3 example profiles (examples/machine_*_UNVERIFIED.json), shipped as samples with status UNVERIFIED.
 * The 2-saw example reuses the id DEMO_2_HEADS_NOT_FOR_MACHINE in the source file; it is renamed here so it can
 * sit next to the 2-router-head sample.
 */
export const SAMPLE_PROFILES: MachineProfile[] = [
  demo('DEMO_1_HEADS_NOT_FOR_MACHINE', 'CNC_ROUTER', [demoHead(1, 'ROUTER_SPINDLE')]),
  demo('DEMO_2_HEADS_NOT_FOR_MACHINE', 'CNC_ROUTER', [demoHead(1, 'ROUTER_SPINDLE'), demoHead(2, 'ROUTER_SPINDLE')]),
  demo('DEMO_3_HEADS_NOT_FOR_MACHINE', 'CNC_ROUTER', [demoHead(1, 'ROUTER_SPINDLE'), demoHead(2, 'ROUTER_SPINDLE'), demoHead(3, 'ROUTER_SPINDLE')]),
  demo('DEMO_2_SAW_BLADES_NOT_FOR_MACHINE', 'CNC_SAW', [demoHead(1, 'SAW_BLADE'), demoHead(2, 'SAW_BLADE')]),
]

/** A new empty profile (status DRAFT). */
export function blankProfile(id: string): MachineProfile {
  return { ...demo(id, 'CNC_ROUTER', [demoHead(1, 'ROUTER_SPINDLE')]), status: 'DRAFT' }
}

/* ------------------------------------------------------------------ capability, head scheduling */

export type CapabilityState = 'available' | 'head-only' | 'unsupported'
export interface Capability {
  op: OperationKind
  state: CapabilityState
  heads: string[]
  /** Why it is not available (code). */
  reason?: string
}

const toolOps = (t: MachineTool): OperationKind[] => TOOL_OPS[t.kind] ?? []

/** What the machine can do, per operation: a head that does it AND a registered tool for it → available. */
export function capabilities(m: MachineProfile): Capability[] {
  return OPERATIONS.map((op) => {
    if (op === 'SAW_CUT') {
      const heads = m.heads.filter((h) => h.type === 'SAW_BLADE').map((h) => h.head_id)
      if (!heads.length) return { op, state: 'unsupported', heads, reason: 'NO_HEAD_FOR_OPERATION' }
      // a beam / panel saw cuts guillotine patterns (cam/guillotine.ts), never router paths
      if (m.machine_type === 'PANEL_SAW') return { op, state: 'available', heads, reason: 'PANEL_SAW_PATTERNS' }
      // a saw unit on a router: straight edge-to-edge cuts only, after that operation was commissioned
      if (m.machine_type === 'CNC_ROUTER' || m.machine_type === 'HYBRID') {
        const why = sawAggregateBlock(m)
        return why ? { op, state: 'unsupported', heads, reason: why } : { op, state: 'available', heads }
      }
      if (!SAW_ADAPTER_AVAILABLE) return { op, state: 'unsupported', heads, reason: 'SAW_ADAPTER_NOT_AVAILABLE' }
    }
    if (op === 'KNIFE_CUT' && !KNIFE_ADAPTER_AVAILABLE) return { op, state: 'unsupported', heads: m.heads.filter((h) => h.type === 'KNIFE').map((h) => h.head_id), reason: 'KNIFE_ADAPTER_NOT_AVAILABLE' }
    const heads = m.heads.filter((h) => HEAD_OPS[h.type]?.includes(op) && h.supported_operations.includes(op))
    if (!heads.length) return { op, state: 'unsupported', heads: [], reason: 'NO_HEAD_FOR_OPERATION' }
    const withTool = heads.filter((h) => h.tools.some((t) => toolOps(t).includes(op)))
    return withTool.length ? { op, state: 'available', heads: withTool.map((h) => h.head_id) } : { op, state: 'head-only', heads: heads.map((h) => h.head_id), reason: 'NO_TOOL_REGISTERED' }
  })
}

/** Why a router-mounted saw unit may not cut yet (null = it may: VERIFIED with SAW_CUT qualified, kerf and orientation known). */
export function sawAggregateBlock(m: MachineProfile): string | null {
  const sw = m.ext?.saw
  if (!sw || !num(sw.kerf_mm) || !(sw.kerf_mm > 0)) return 'SAW_KERF_NOT_DEFINED'
  if (!sw.orientation) return 'SAW_ORIENTATION_NOT_DEFINED'
  if (m.status !== 'VERIFIED' || !m.ext?.qualified_ops?.includes('SAW_CUT')) return 'SAW_AGGREGATE_NOT_COMMISSIONED'
  return null
}

export interface HeadSummary {
  routerHeads: number
  sawHeads: number
  drillBanks: number
  knives: number
  tools: number
  atc: boolean
  magazine: number
  sequentialOnly: boolean
}
/** Counts by head TYPE: 1 spindle + 3-tool ATC is one head, two saw blades are not two router spindles. */
export function headSummary(m: MachineProfile): HeadSummary {
  const n = (t: HeadType) => m.heads.filter((h) => h.type === t).length
  return { routerHeads: n('ROUTER_SPINDLE'), sawHeads: n('SAW_BLADE'), drillBanks: n('DRILL_BANK'), knives: n('KNIFE'), tools: m.heads.reduce((a, h) => a + h.tools.filter((t) => t.kind !== 'UNASSIGNED').length, 0), atc: !!m.atc?.supported, magazine: m.atc?.magazine_slots ?? 0, sequentialOnly: (m.motion_policy ?? 'SEQUENTIAL_ONLY') === 'SEQUENTIAL_ONLY' }
}

export interface OpRequest {
  operation_id: string
  op: OperationKind
  /** Exact tool diameter needed (drills, forstner), mm. */
  diameter?: number
  /** Largest tool diameter that fits (closed grooves), mm. */
  maxDiameter?: number
}
export interface Assignment {
  operation_id: string
  op: OperationKind
  head_id: string | null
  tool_id: string | null
  tool?: MachineTool
  /** OK = head + tool found and calibrated; PENDING = found, not calibrated / mapped; UNSUPPORTED = none. */
  status: 'OK' | 'PENDING' | 'UNSUPPORTED'
  reasons: string[]
}

/**
 * Sequential head scheduling: each operation goes to the first head whose type and supported operations allow it
 * and that carries a tool for it (right diameter). Parallel motion is never planned. Saw / knife operations stay
 * unsupported while no adapter is qualified; a saw blade never takes a router operation.
 */
export function assignHeads(m: MachineProfile, reqs: OpRequest[]): Assignment[] {
  const caps = new Map(capabilities(m).map((c) => [c.op, c]))
  return reqs.map((r) => {
    const cap = caps.get(r.op)!
    if (cap.state === 'unsupported') return { operation_id: r.operation_id, op: r.op, head_id: null, tool_id: null, status: 'UNSUPPORTED', reasons: [cap.reason ?? 'NO_HEAD_FOR_OPERATION'] }
    const heads = m.heads.filter((h) => HEAD_OPS[h.type]?.includes(r.op) && h.supported_operations.includes(r.op))
    const fits = (t: MachineTool) => toolOps(t).includes(r.op) && (r.diameter === undefined || (num(t.diameter_mm) && Math.abs(t.diameter_mm - r.diameter) < 0.05)) && (r.maxDiameter === undefined || (num(t.diameter_mm) && t.diameter_mm <= r.maxDiameter + 1e-6))
    for (const h of heads) {
      const t = h.tools.find(fits)
      if (!t) continue
      const reasons: string[] = []
      if (!h.offset_calibrated || !(['x', 'y', 'z'] as const).every((a) => num(h.offset_mm[a]))) reasons.push(`HEAD_OFFSET_NOT_MEASURED:${h.head_id}`)
      if (!h.activation_mapping_verified) reasons.push(`HEAD_ACTIVATION_NOT_MAPPED:${h.head_id}`)
      if (!t.actual_calibrated) reasons.push(`TOOL_NOT_CALIBRATED:${t.tool_id}`)
      return { operation_id: r.operation_id, op: r.op, head_id: h.head_id, tool_id: t.tool_id, tool: t, status: reasons.length ? 'PENDING' : 'OK', reasons }
    }
    // a head can do it, but no registered tool of that size: the preview uses the CAM settings' tool
    return { operation_id: r.operation_id, op: r.op, head_id: heads[0]?.head_id ?? null, tool_id: null, status: 'PENDING', reasons: [r.diameter ? `NO_TOOL_OF_DIAMETER:${r.op}:${r.diameter}` : r.maxDiameter ? `NO_TOOL_FITS:${r.op}:${r.maxDiameter}` : `NO_TOOL_REGISTERED:${r.op}`] }
  })
}

/* ------------------------------------------------------------------ commissioning, revisions, import */

export interface CommissioningRecord {
  id: string
  profile_id: string
  profile_revision: number
  /** profileContentHash() of the profile that was commissioned. */
  profile_hash: string
  at: string
  parser_pass: boolean
  post_backplot_pass: boolean
  post_approved_for_controller: boolean
  air_cut: { pass: boolean; date: string; notes: string }
  first_article: { pass: boolean; date: string; measurements: string }
  operator: { name: string; at: string }
  engineer: { name: string; at: string }
  evidence_refs: string[]
  valid_until?: string | null
  /** Survey sheet (docs/09): item → confirmed. Required (all true) for a profile made from a library template. */
  survey?: Record<string, boolean> | null
  /** First article measurements vs tolerances (the wizard's table); any row out of tolerance fails. */
  first_article_rows?: { feature: string; nominal: number; tolerance: number; measured: number | null }[] | null
  /** Router saw unit: the supervised saw test passed (qualifies SAW_CUT). */
  saw_test?: { pass: boolean; notes: string } | null
  result: 'VERIFIED' | 'FAILED'
  failures: string[]
}

export type CommissioningInput = Omit<CommissioningRecord, 'id' | 'profile_id' | 'profile_revision' | 'profile_hash' | 'at' | 'result' | 'failures'>

/** Machine-level blockers that commissioning must clear before VERIFIED (everything but the status itself). */
const PRE_COMMISSIONING_SKIP = /^(MACHINE_PROFILE_NOT_VERIFIED|POSTPROCESSOR_NOT_APPROVED|QUALIFICATION_MISSING:.*|QUALIFICATION_EVIDENCE_MISSING|PRODUCTION_EXPORT_DISABLED)$/

/**
 * Record a commissioning run. VERIFIED only when the profile itself is complete (controller, envelope, origin,
 * safe Z, heads calibrated and mapped, tools measured, a known post id + version + hash) AND parser, backplot,
 * air cut, first article and the post approval pass AND an operator and an engineer signed with their names.
 * Otherwise the record is kept as FAILED and the profile stays (or becomes) UNVERIFIED.
 */
export function commission(profile: MachineProfile, input: CommissioningInput, now = new Date().toISOString()): { profile: MachineProfile; record: CommissioningRecord } {
  const failures = machineBlockers(profile).filter((b) => !PRE_COMMISSIONING_SKIP.test(b))
  if (!(profile.postprocessor.id && profile.postprocessor.version && profile.postprocessor.sha256)) failures.push('POSTPROCESSOR_ID_VERSION_HASH_MISSING')
  if (!profile.controller.supported_codes.length) failures.push('CONTROLLER_CODES_NOT_VERIFIED')
  if (!input.parser_pass) failures.push('PARSER_NOT_PASSED')
  if (!input.post_backplot_pass) failures.push('BACKPLOT_NOT_PASSED')
  if (!input.post_approved_for_controller) failures.push('POST_NOT_APPROVED_FOR_CONTROLLER')
  if (!input.air_cut.pass) failures.push('AIR_CUT_FAILED')
  if (!input.air_cut.date) failures.push('AIR_CUT_DATE_MISSING')
  if (!input.first_article.pass) failures.push('FIRST_ARTICLE_QC_FAILED')
  if (!input.first_article.measurements.trim()) failures.push('FIRST_ARTICLE_MEASUREMENTS_MISSING')
  if (!input.operator.name.trim()) failures.push('OPERATOR_SIGNOFF_MISSING')
  if (!input.engineer.name.trim()) failures.push('ENGINEER_SIGNOFF_MISSING')
  if (!input.evidence_refs.filter((x) => x.trim()).length) failures.push('EVIDENCE_REFS_MISSING')
  // catalogue values (machine library) are references: the survey sheet must confirm every item on the real machine
  const survey = input.survey ?? null
  if (survey && Object.values(survey).some((v) => !v)) failures.push('SURVEY_INCOMPLETE')
  if (!survey && profile.ext?.provenance) failures.push('SURVEY_MISSING')
  for (const r of input.first_article_rows ?? []) {
    if (r.measured === null || !Number.isFinite(r.measured)) failures.push(`FIRST_ARTICLE_NOT_MEASURED:${r.feature}`)
    else if (Math.abs(r.measured - r.nominal) > r.tolerance + 1e-9) failures.push(`FIRST_ARTICLE_OUT_OF_TOLERANCE:${r.feature}`)
  }
  const sawUnit = (profile.machine_type === 'CNC_ROUTER' || profile.machine_type === 'HYBRID') && profile.heads.some((h) => h.type === 'SAW_BLADE')
  if (input.saw_test && !input.saw_test.pass) failures.push('SAW_TEST_FAILED')
  const record: CommissioningRecord = {
    ...input, id: `COM-${profile.profile_id}-r${profile.revision}-${now.replace(/\D/g, '').slice(0, 14)}`, profile_id: profile.profile_id, profile_revision: profile.revision,
    profile_hash: profileContentHash(profile), at: now, result: failures.length ? 'FAILED' : 'VERIFIED', failures,
  }
  if (failures.length) return { profile: { ...profile, status: profile.status === 'VERIFIED' ? 'UNVERIFIED' : profile.status === 'DRAFT' ? 'DRAFT' : 'UNVERIFIED', production_export_allowed: false, qualification: blankQualification() }, record }
  const qualified: OperationKind[] = sawUnit && input.saw_test?.pass ? ['SAW_CUT'] : []
  return {
    profile: {
      ...profile, status: 'VERIFIED', production_export_allowed: true, postprocessor: { ...profile.postprocessor, approved_for_controller: true },
      ...(profile.ext || qualified.length ? { ext: { ...profile.ext, qualified_ops: qualified } } : {}),
      qualification: { parser_pass: true, post_backplot_pass: true, air_cut_pass: true, first_article_pass: true, operator_signed: true, engineer_signed: true, qualified_at: now, evidence_refs: input.evidence_refs.filter((x) => x.trim()) },
    },
    record,
  }
}

/** Reset to not-qualified (keeps everything else). */
export const unqualify = (p: MachineProfile, status: MachineStatus = 'UNVERIFIED'): MachineProfile => ({ ...p, status, production_export_allowed: false, qualification: blankQualification(), postprocessor: { ...p.postprocessor, approved_for_controller: false }, ...(p.ext ? { ext: { ...p.ext, qualified_ops: [] } } : {}) })

/**
 * A new revision of a profile after an edit: revision + 1; a content change (heads, tools, offsets, controller,
 * post, envelope, origin, fixtures…) drops a VERIFIED / IN_QUALIFICATION profile to UNVERIFIED and clears the
 * qualification. Status, qualification and production_export_allowed cannot be raised by an edit.
 */
export function reviseProfile(prev: MachineProfile, edited: MachineProfile): MachineProfile {
  const changed = profileContentHash(prev) !== profileContentHash(edited)
  const base: MachineProfile = { ...edited, profile_id: prev.profile_id, revision: prev.revision + 1, status: prev.status, qualification: prev.qualification, production_export_allowed: prev.production_export_allowed, postprocessor: { ...edited.postprocessor, approved_for_controller: prev.postprocessor.approved_for_controller } }
  // qualified operations are set by commissioning only, never by an edit
  if (base.ext || prev.ext?.qualified_ops?.length) base.ext = { ...base.ext, qualified_ops: prev.ext?.qualified_ops ?? [] }
  if (!changed) return base
  return unqualify(base, prev.status === 'DRAFT' ? 'DRAFT' : 'UNVERIFIED')
}

/** A copy under a new id: DRAFT, revision 1, not qualified. */
export const cloneProfile = (p: MachineProfile, id: string): MachineProfile => unqualify({ ...structuredClone(p), profile_id: id, revision: 1 }, 'DRAFT')

/**
 * Import a profile JSON (another workstation, a vendor file, an old export). Never trusts a stored status:
 * VERIFIED / IN_QUALIFICATION come in as UNVERIFIED, qualification flags are cleared, production export is off.
 */
export function importProfile(json: unknown): { profile: MachineProfile | null; errors: string[] } {
  const errors: string[] = []
  const o = (json ?? {}) as Partial<MachineProfile>
  if (o.schema_version !== '2.2.0') errors.push('SCHEMA_VERSION')
  if (!o.profile_id || typeof o.profile_id !== 'string') errors.push('PROFILE_ID')
  if (!Array.isArray(o.heads) || !o.heads.length) errors.push('HEADS')
  if (!o.controller || !Array.isArray(o.controller.supported_codes)) errors.push('CONTROLLER')
  if (!o.work_envelope_mm || !o.origin || !o.atc || !o.fixtures || !o.postprocessor) errors.push('SECTIONS')
  for (const h of o.heads ?? []) {
    if (!h.head_id || !['ROUTER_SPINDLE', 'SAW_BLADE', 'DRILL_BANK', 'KNIFE'].includes(h.type)) errors.push(`HEAD:${h.head_id ?? '?'}`)
    if (!Array.isArray(h.tools) || !Array.isArray(h.supported_operations)) errors.push(`HEAD_TOOLS:${h.head_id ?? '?'}`)
  }
  if (errors.length) return { profile: null, errors }
  const p = structuredClone(o) as MachineProfile
  p.revision = num(p.revision) && p.revision >= 1 ? Math.floor(p.revision) : 1
  p.fixtures.clamp_no_go_shapes = (p.fixtures.clamp_no_go_shapes ?? []).filter((z) => [z.x0, z.y0, z.x1, z.y1, z.z_top].every(num)).map((z, i) => ({ ...z, id: z.id ?? `CLAMP_${i + 1}` }))
  p.motion_policy = p.motion_policy ?? 'SEQUENTIAL_ONLY'
  return { profile: unqualify(p, p.status === 'DRAFT' ? 'DRAFT' : 'UNVERIFIED'), errors }
}

/* ------------------------------------------------------------------ the release gate */

/** Everything about the job the gate checks (structural, so the gate does not depend on the CAM modules). */
export interface JobGateInput {
  /** The profile id pinned on the job; undefined = an old project with no machine (LEGACY_UNASSIGNED). */
  machineProfileId: string | null | undefined
  machineProfileRevision?: number | null
  machineProfileHash?: string | null
  /** Each board in the job with its nominal and measured thickness and lot. */
  stocks: { material: string; nominal_mm: number; measured_thickness_mm: number | null; lot: string | null }[]
  /** Stock sheets used (mm) for the envelope check. */
  sheets?: { l: number; w: number; t: number }[]
  edgeBandConfirmed: boolean
  /** null = never reviewed (no recorded hash chain). */
  stale: { stale: boolean; from: string | null } | null
  /** Operator + engineer sign-off valid for the CURRENT hash chain (null = not signed). */
  approvals: { operator: string; engineer: string } | null
  /** Issues of the parser on the exact bytes of every program (null = not parsed / simulated). */
  ncIssues: { code: string; block: boolean }[] | null
  unsupported: { op: string; reason: string }[]
  /** Parts that do not fit any stock sheet (labels). */
  unplaced: string[]
  nestErrors: string[]
  firstArticle?: 'PASS' | 'FAIL' | null
  /** The post that wrote the NC (must be the profile's approved one). */
  post?: { id: string; version: string; sha256: string } | null
  /**
   * The source drawing the parts come from, when known: cad/provenance fabricationAllowed(doc). An uncalibrated
   * image / PDF import or an open review item blocks manufacturing.
   */
  sourceDrawing?: { file: string; ok: boolean } | null
  /** Cabinets whose dimensions are not real (image / AI concept / unconfirmed survey: interior/production). */
  unverifiedCabinets?: string[]
  /** Hardware drilling problems (cam/hardware.ts) as blocker codes: missing product data, through holes, edge distances. */
  hardware?: string[]
  /** Guillotine (panel saw) verification errors; undefined / null = not a saw job. */
  sawErrors?: string[] | null
}

const MEASURED_TOLERANCE = 0.3 // mm: a measured board further than this from nominal changes the part rules

/**
 * Production release blockers. Empty = production NC may be written. Order: machine (reference gate), then the
 * commissioning record, then the job.
 */
export function releaseBlockers(machine: MachineProfile | null, job: JobGateInput | null, commissioning?: CommissioningRecord | null): string[] {
  const out: string[] = []
  if (!machine) out.push(job?.machineProfileId === undefined ? 'LEGACY_UNASSIGNED' : 'MACHINE_NOT_SELECTED')
  else {
    out.push(...machineBlockers(machine))
    if (!machine.controller.supported_codes?.length) out.push('CONTROLLER_CODES_NOT_VERIFIED')
    if (machine.status === 'VERIFIED') {
      if (!commissioning || commissioning.result !== 'VERIFIED' || commissioning.profile_id !== machine.profile_id) out.push('COMMISSIONING_RECORD_MISSING')
      else {
        if (commissioning.profile_hash !== profileContentHash(machine)) out.push('COMMISSIONING_STALE')
        if (!(commissioning.air_cut.pass && commissioning.first_article.pass && commissioning.operator.name.trim() && commissioning.engineer.name.trim())) out.push('COMMISSIONING_INCOMPLETE')
        if (commissioning.valid_until && commissioning.valid_until < new Date().toISOString().slice(0, 10)) out.push('COMMISSIONING_EXPIRED')
      }
    }
  }
  if (!job) {
    out.push('JOB_NOT_DEFINED')
    return out
  }
  if (machine) {
    if (job.machineProfileId !== machine.profile_id) out.push('JOB_MACHINE_MISMATCH')
    if (job.machineProfileRevision != null && job.machineProfileRevision !== machine.revision) out.push('MACHINE_REVISION_CHANGED')
    if (job.machineProfileHash && job.machineProfileHash !== profileContentHash(machine)) out.push('MACHINE_PROFILE_CHANGED')
    const env = machine.work_envelope_mm
    for (const s of job.sheets ?? []) if (num(env.x) && num(env.y) && (s.l > env.x + 1e-6 || s.w > env.y + 1e-6)) out.push(`STOCK_EXCEEDS_ENVELOPE:${s.l}x${s.w}`)
    if (job.post && (job.post.id !== machine.postprocessor.id || job.post.version !== machine.postprocessor.version || job.post.sha256 !== machine.postprocessor.sha256)) out.push('POST_NOT_PROFILE_POST')
  }
  for (const s of job.stocks) {
    if (!num(s.measured_thickness_mm) || s.measured_thickness_mm <= 0) out.push(`STOCK_THICKNESS_NOT_MEASURED:${s.material}`)
    else if (Math.abs(s.measured_thickness_mm - s.nominal_mm) > MEASURED_TOLERANCE) out.push(`THICKNESS_DEVIATES_FROM_NOMINAL:${s.material}:${s.nominal_mm}->${s.measured_thickness_mm}`)
    if (!s.lot?.trim()) out.push(`STOCK_LOT_MISSING:${s.material}`)
  }
  if (!job.edgeBandConfirmed) out.push('EDGE_BAND_THICKNESS_NOT_CONFIRMED')
  if (job.unplaced.length) out.push(`PARTS_DO_NOT_FIT_STOCK:${job.unplaced.length}`)
  if (job.nestErrors.length) out.push('NEST_INVALID')
  for (const u of job.unsupported) out.push(`UNSUPPORTED_OPERATION:${u.op}:${u.reason}`)
  if (job.ncIssues === null) out.push('NC_NOT_PARSED')
  else {
    const codes = [...new Set(job.ncIssues.filter((i) => i.block).map((i) => i.code))]
    for (const c of codes) out.push(`NC_CHECK_FAILED:${c}`)
  }
  if (job.stale === null) out.push('JOB_NOT_REVIEWED')
  else if (job.stale.stale) out.push(`JOB_STALE:${job.stale.from}`)
  if (!job.approvals || !job.approvals.operator.trim() || !job.approvals.engineer.trim()) out.push('JOB_SIGNOFF_MISSING')
  if (job.firstArticle === 'FAIL') out.push('JOB_FIRST_ARTICLE_QC_FAILED')
  if (job.sourceDrawing && !job.sourceDrawing.ok) out.push(`SOURCE_DRAWING_NOT_FABRICATION_READY:${job.sourceDrawing.file}`)
  if (job.unverifiedCabinets?.length) out.push(`CABINET_DIMENSIONS_UNVERIFIED:${job.unverifiedCabinets.join(', ')}`)
  for (const h of job.hardware ?? []) out.push(h)
  for (const e of job.sawErrors ?? []) out.push(`SAW_PATTERN_INVALID:${e}`)
  return [...new Set(out)]
}
