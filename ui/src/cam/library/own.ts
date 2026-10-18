/**
 * "Enter my machine": a blank profile for a machine the library does not have, and the validation of what the
 * user typed (the form in Machines & Tools). Valid ≠ verified: the profile is stored UNVERIFIED and goes through
 * the same commissioning as any other.
 */
import type { HeadType, MachineHead, MachineProfile, MachineType } from '../machine'
import { POSTS, postIdForFamily } from '../posts'
import { familyById, familyCodes } from './index'
import type { ControllerFamilyId } from './types'

export function blankOwnProfile(id: string, family: ControllerFamilyId | null = null, type: MachineType = 'CNC_ROUTER'): MachineProfile {
  const postId = postIdForFamily(family, type)
  const post = postId ? POSTS[postId] : null
  const fam = familyById(family)
  return {
    schema_version: '2.2.0', profile_id: id, revision: 1, status: 'UNVERIFIED', machine_type: type, manufacturer: null, machine_model: null, serial_reference: null,
    controller: { name: fam && family !== 'PROPRIETARY' ? fam.vendor : null, model: null, firmware: null, manual_reference: null, supported_codes: familyCodes(fam) },
    axes: ['X', 'Y', 'Z'], work_envelope_mm: { x: null, y: null, z: null }, origin: { stock_corner: 'LOWER_LEFT', z_reference: 'BOARD_TOP', work_offset: 'G54', home_calibrated: false },
    heads: [newHead(1, type === 'PANEL_SAW' ? 'SAW_BLADE' : 'ROUTER_SPINDLE')], motion_policy: 'SEQUENTIAL_ONLY', atc: { supported: false, magazine_slots: 0 },
    fixtures: { bed_type: null, vacuum_zones: [], clamp_no_go_shapes: [], safe_clearance_mm: null },
    postprocessor: post ? { id: post.id, version: post.version, sha256: post.sha256, approved_for_controller: false } : { id: null, version: null, sha256: null, approved_for_controller: false },
    qualification: { parser_pass: false, post_backplot_pass: false, air_cut_pass: false, first_article_pass: false, operator_signed: false, engineer_signed: false, qualified_at: null, evidence_refs: [] },
    production_export_allowed: false,
    ext: { controller_family: family, file_extension: fam?.file_extensions[0] ?? null, tool_length_mode: null, operator_pause_code: null, spindle_select: [], comment_style: null, saw: type === 'PANEL_SAW' ? { blade_diameter_mm: null, kerf_mm: null, max_cut_height_mm: null, cut_length_mm: null, orientation: null, trim_mm: null } : undefined, qualified_ops: [] },
  }
}

const OPS_OF: Record<HeadType, MachineHead['supported_operations']> = {
  ROUTER_SPINDLE: ['PROFILE', 'POCKET', 'SLOT', 'ENGRAVE', 'DRILL_VERTICAL'],
  SAW_BLADE: ['SAW_CUT'],
  DRILL_BANK: ['DRILL_VERTICAL', 'DRILL_HORIZONTAL'],
  KNIFE: ['KNIFE_CUT'],
}

export function newHead(n: number, type: HeadType): MachineHead {
  const id = type === 'DRILL_BANK' ? `DRILL_BANK_${n}` : type === 'SAW_BLADE' ? `SAW_${n}` : type === 'KNIFE' ? `KNIFE_${n}` : `HEAD_${n}`
  return { head_id: id, type, offset_mm: { x: null, y: null, z: null }, offset_calibrated: false, activation_mapping_verified: false, kinematics_group: 'GANTRY_1', tools: [], supported_operations: [...OPS_OF[type]], simultaneous_qualified: false }
}

const pos = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)

/** Errors of a hand-entered profile (codes the form shows next to the field; empty = may be saved). */
export function validateOwnProfile(p: MachineProfile): string[] {
  const e: string[] = []
  if (!/^[A-Za-z0-9_.-]{2,64}$/.test(p.profile_id)) e.push('ID')
  if (!p.manufacturer?.trim() || !p.machine_model?.trim()) e.push('MAKE_MODEL')
  for (const a of ['x', 'y', 'z'] as const) if (!pos(p.work_envelope_mm[a])) e.push(`ENVELOPE_${a.toUpperCase()}`)
  if (!p.heads.length) e.push('NO_HEADS')
  const ids = p.heads.map((h) => h.head_id.trim())
  if (ids.some((x) => !x) || new Set(ids).size !== ids.length) e.push('HEAD_IDS')
  for (const h of p.heads) {
    for (const a of ['x', 'y', 'z'] as const) if (h.offset_mm[a] !== null && !num(h.offset_mm[a])) e.push(`OFFSET:${h.head_id}`)
    if (!h.supported_operations.length) e.push(`HEAD_OPS:${h.head_id}`)
    for (const t of h.tools) {
      if (!t.tool_id.trim()) e.push(`TOOL_ID:${h.head_id}`)
      if (t.diameter_mm !== null && !pos(t.diameter_mm)) e.push(`TOOL_DIAMETER:${t.tool_id}`)
      if (t.length_mm != null && !pos(t.length_mm)) e.push(`TOOL_LENGTH:${t.tool_id}`)
      if (t.kind === 'SAW_BLADE' && t.kerf_mm != null && !pos(t.kerf_mm)) e.push(`KERF:${t.tool_id}`)
    }
  }
  const numbers = p.heads.flatMap((h) => h.tools.map((t) => t.number)).filter((x): x is number => x != null)
  if (new Set(numbers).size !== numbers.length) e.push('TOOL_NUMBERS')
  if (p.atc.supported && !(num(p.atc.magazine_slots) && (p.atc.magazine_slots ?? 0) > 0)) e.push('ATC_SLOTS')
  if (p.atc.supported && numbers.some((x) => x > (p.atc.magazine_slots ?? 0)) && p.heads.filter((h) => h.type === 'ROUTER_SPINDLE').length === 1) e.push('ATC_POCKETS')
  if (p.fixtures.safe_clearance_mm !== null && !(num(p.fixtures.safe_clearance_mm) && p.fixtures.safe_clearance_mm >= 0)) e.push('SAFE_Z')
  for (const z of p.fixtures.clamp_no_go_shapes) if (!(z.x1 > z.x0 && z.y1 > z.y0 && num(z.z_top))) e.push(`CLAMP:${z.id}`)
  const fam = p.ext?.controller_family ?? null
  if (!fam) e.push('CONTROLLER_FAMILY')
  if (fam !== 'PROPRIETARY' && p.machine_type !== 'PANEL_SAW') {
    if (!p.controller.supported_codes.length) e.push('CODES')
    const ext = p.ext?.file_extension
    if (!ext || !/^\.[A-Za-z0-9]{1,6}$/.test(ext)) e.push('FILE_EXTENSION')
    if (!p.postprocessor.id) e.push('POST')
    const codes = new Set(p.controller.supported_codes)
    for (const s of p.ext?.spindle_select ?? []) for (const c of s.codes) if (!codes.has(c)) e.push(`SPINDLE_SELECT_CODE:${s.head_id}:${c}`)
    if (p.ext?.operator_pause_code && !codes.has(p.ext.operator_pause_code)) e.push('PAUSE_CODE')
  }
  if (p.machine_type === 'PANEL_SAW' || p.heads.some((h) => h.type === 'SAW_BLADE')) {
    const sw = p.ext?.saw
    if (sw?.kerf_mm != null && !pos(sw.kerf_mm)) e.push('SAW_KERF')
    if (p.machine_type === 'PANEL_SAW' && !pos(sw?.max_cut_height_mm)) e.push('SAW_CUT_HEIGHT')
  }
  return [...new Set(e)]
}
