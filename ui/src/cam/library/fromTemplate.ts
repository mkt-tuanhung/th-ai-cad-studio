/**
 * Machine library template → the user's own machine profile.
 *
 * The profile starts UNVERIFIED with every value marked as a catalogue reference: heads from the template's
 * spindles / drill bank / saw (offsets, tools and calibration empty — they are measured on the machine), ATC, work
 * envelope, the controller family's post and its documented codes (prefill of the verified codes, editable), no
 * clamps, no origin, no safe Z, no firmware. Commissioning (MachinesDialog wizard) is the only way to VERIFIED, and
 * for a library-made profile it requires the survey sheet that confirms the catalogue values on the real machine.
 */
import type { HeadType, MachineExt, MachineHead, MachineProfile, MachineTool, MachineType, OperationKind, ToolLengthMode } from '../machine'
import { POSTS, postIdForFamily } from '../posts'
import { familyById, familyCodes, codesFromText, documented, undocumentedNotes } from './index'
import type { MachineTemplate } from './types'

export interface TemplateChoices {
  profileId: string
  /** Spindle groups to include (index into template.spindles; default all). */
  spindleGroups?: number[]
  includeDrillBank?: boolean
  includeSaw?: boolean
  controllerModel?: string | null
  /** Override the ATC slot count (a smaller magazine option); null = the template's. */
  atcSlots?: number | null
  at?: string
}

export interface TemplateProfile {
  profile: MachineProfile
  /** What the user must measure / fill before commissioning (codes for the UI). */
  todo: string[]
}

const blankQ = (): MachineProfile['qualification'] => ({ parser_pass: false, post_backplot_pass: false, air_cut_pass: false, first_article_pass: false, operator_signed: false, engineer_signed: false, qualified_at: null, evidence_refs: [] })
const ROUTER_OPS: OperationKind[] = ['PROFILE', 'POCKET', 'SLOT', 'ENGRAVE', 'DRILL_VERTICAL']

function head(id: string, type: HeadType, ops: OperationKind[], tools: MachineTool[], group = 'GANTRY_1'): MachineHead {
  return { head_id: id, type, offset_mm: { x: null, y: null, z: null }, offset_calibrated: false, activation_mapping_verified: false, kinematics_group: group, tools, supported_operations: ops, simultaneous_qualified: false }
}
const placeholder = (id: string, n: number, kind: string = 'UNASSIGNED', d: number | null = null): MachineTool => ({ tool_id: id, kind, diameter_mm: d, actual_calibrated: false, number: n })

/** Profile id from a template id (valid for the store: 2–64 of A–Z a–z 0–9 _ . -). */
export const suggestProfileId = (t: MachineTemplate) => `MY_${t.id.replace(/[^A-Za-z0-9_.-]+/g, '-')}`.slice(0, 60)

export function templateToProfile(t: MachineTemplate, choices: TemplateChoices): TemplateProfile {
  const fam = familyById(t.controller_family)
  const groups = choices.spindleGroups ?? t.spindles.map((_, i) => i)
  const heads: MachineHead[] = []
  const info: NonNullable<MachineExt['head_info']> = []
  let n = 0
  const panelSaw = t.machine_type === 'PANEL_SAW'
  if (!panelSaw)
    for (const gi of groups) {
      const sp = t.spindles[gi]
      if (!sp) continue
      for (let k = 0; k < sp.count; k++) {
        n++
        const id = `HEAD_${n}`
        heads.push(head(id, 'ROUTER_SPINDLE', ROUTER_OPS, [placeholder(`TOOL_${n}`, n)]))
        info.push({ head_id: id, power_kw: sp.power_kw, rpm_max: sp.rpm_max, holder: sp.holder })
      }
    }
  const db = t.drill_bank
  if (!panelSaw && db && choices.includeDrillBank !== false && ((db.vertical ?? 0) > 0 || (db.horizontal ?? 0) > 0)) {
    const ops: OperationKind[] = [...((db.vertical ?? 0) > 0 ? ['DRILL_VERTICAL' as const] : []), ...((db.horizontal ?? 0) > 0 ? ['DRILL_HORIZONTAL' as const] : [])]
    const tools = [...Array.from({ length: db.vertical ?? 0 }, (_, i) => placeholder(`DB_V${i + 1}`, 100 + i + 1, 'DRILL')), ...Array.from({ length: db.horizontal ?? 0 }, (_, i) => placeholder(`DB_H${i + 1}`, 200 + i + 1, 'DRILL'))]
    heads.push(head('DRILL_BANK_1', 'DRILL_BANK', ops, tools))
    if (db.groove_saw) heads.push(head('GROOVE_SAW_1', 'SAW_BLADE', ['SAW_CUT'], [placeholder('GROOVE_BLADE', 300, 'SAW_BLADE')]))
  }
  const sw = t.saw
  if (sw && (panelSaw || choices.includeSaw !== false)) heads.push(head(panelSaw ? 'MAIN_SAW' : 'SAW_UNIT_1', 'SAW_BLADE', ['SAW_CUT'], [{ ...placeholder('BLADE_1', 1, 'SAW_BLADE', sw.blade_diameter_mm), kerf_mm: sw.kerf_mm }], panelSaw ? 'SAW_CARRIAGE' : 'GANTRY_1'))
  const machine_type: MachineType = panelSaw ? 'PANEL_SAW' : t.machine_type === 'CNC_DRILL' ? 'CNC_DRILL' : t.machine_type === 'HYBRID' || (sw && choices.includeSaw !== false) ? 'HYBRID' : 'CNC_ROUTER'
  const postId = postIdForFamily(t.controller_family, machine_type)
  const post = postId ? POSTS[postId] : null
  const slots = choices.atcSlots ?? t.atc.slots
  const atc = !!t.atc.type && t.atc.type !== 'none' && (slots ?? 0) > 0
  const codes = familyCodes(fam)
  const tlo = fam && documented(fam.tool_length_offset) && codesFromText(fam.tool_length_offset).includes('G43') && codes.includes('G43') ? ('G43' as ToolLengthMode) : null
  const undocumented = fam ? undocumentedNotes(fam) : []
  const at = choices.at ?? new Date().toISOString()
  const ext: MachineExt = {
    controller_family: t.controller_family,
    file_extension: fam?.file_extensions[0] ?? null,
    tool_length_mode: atc ? tlo : null,
    operator_pause_code: codes.includes('M0') ? 'M0' : null,
    spindle_select: [],
    comment_style: null,
    saw: sw ? { blade_diameter_mm: sw.blade_diameter_mm, kerf_mm: sw.kerf_mm, max_cut_height_mm: sw.max_cut_height_mm, cut_length_mm: sw.cut_length_mm, orientation: null, trim_mm: null } : undefined,
    table: t.table,
    head_info: info,
    native_formats: t.native_program_formats,
    vendor_cam: t.vendor_cam,
    dxf_layers: t.controller_family === 'PROPRIETARY' ? { outline: 'OUTLINE', drill: 'DRILL_D{d}_Z{z}', groove: 'GROOVE_W{w}_Z{z}', pocket: 'POCKET_Z{z}' } : null,
    undocumented,
    provenance: { template_id: t.id, manufacturer: t.manufacturer, model: `${t.series} ${t.model}`.trim(), confidence: t.confidence, sources: t.sources, picked_at: at, choices: { spindleGroups: groups, includeDrillBank: choices.includeDrillBank !== false, includeSaw: choices.includeSaw !== false, atcSlots: slots } },
    qualified_ops: [],
  }
  const profile: MachineProfile = {
    schema_version: '2.2.0', profile_id: choices.profileId, revision: 1, status: 'UNVERIFIED', machine_type,
    manufacturer: t.manufacturer, machine_model: `${t.series} ${t.model}`.trim(), serial_reference: null,
    controller: { name: t.controller_family && t.controller_family !== 'PROPRIETARY' ? `${fam?.vendor ?? t.controller_family}` : null, model: choices.controllerModel ?? t.controller_models[0] ?? null, firmware: null, manual_reference: null, supported_codes: codes },
    axes: ['X', 'Y', 'Z'], work_envelope_mm: { ...t.work_envelope_mm },
    origin: { stock_corner: null, z_reference: null, work_offset: null, home_calibrated: false },
    heads, motion_policy: 'SEQUENTIAL_ONLY', atc: { supported: atc, magazine_slots: atc ? slots : 0 },
    fixtures: { bed_type: t.table, vacuum_zones: [], clamp_no_go_shapes: [], safe_clearance_mm: null },
    postprocessor: post ? { id: post.id, version: post.version, sha256: post.sha256, approved_for_controller: false } : { id: null, version: null, sha256: null, approved_for_controller: false },
    qualification: blankQ(), production_export_allowed: false, ext,
  }
  const todo = [
    'FIRMWARE', 'MANUAL', 'ORIGIN', 'SAFE_Z', 'HEAD_OFFSETS', 'TOOLS_MEASURED', 'ENVELOPE_MEASURED', 'CODES_CHECKED',
    ...(!post ? ['VENDOR_CAM'] : []),
    ...(atc && !tlo ? ['TOOL_LENGTH_MODE'] : []),
    ...(heads.filter((h) => h.type === 'ROUTER_SPINDLE').length > 1 ? ['SPINDLE_SELECT'] : []),
    ...(!ext.file_extension && post && !post.noNc ? ['FILE_EXTENSION'] : []),
    ...(sw && !panelSaw ? ['SAW_ORIENTATION'] : []),
    ...(sw && sw.kerf_mm == null ? ['SAW_KERF'] : []),
    ...undocumented.map((k) => `NOTE:${k}`),
  ]
  return { profile, todo }
}
