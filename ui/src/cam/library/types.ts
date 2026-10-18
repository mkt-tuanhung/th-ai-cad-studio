/**
 * Machine library data contract (reference data, NOT machine profiles).
 *
 * - MachineTemplate: one machine model / configuration from a catalogue, dealer listing or a generic class
 *   description. The values are catalogue references; a template never becomes a VERIFIED profile by itself —
 *   `templateToProfile()` turns it into the user's own UNVERIFIED profile, which must be measured and commissioned.
 * - ControllerFamily: what the documentation of a controller family says about its NC dialect (units, distance
 *   mode, tool change, tool length offset, spindle, multi-spindle, canned cycles, arcs, comments, program end).
 *   Notes are kept as text; `familyCodes()` extracts the G / M codes they name. A note that is null or says
 *   "not documented" means the profile must state it (the UI asks for it) — the posts never guess it.
 * - HardwareItem: hinges, drawer slides and connectors with their drilling data (cam/hardware.ts).
 *
 * Generated data lives in ./data/*.ts (ui/tools/import-machinelib.mjs converts the research JSON files).
 */

export type MachineCategory = 'nesting-router' | 'ptp-router' | '4-process-router' | 'multi-spindle-router' | 'panel-saw' | 'cnc-boring' | 'hybrid-router-saw'
export const CATEGORIES: MachineCategory[] = ['nesting-router', 'ptp-router', '4-process-router', 'multi-spindle-router', 'panel-saw', 'cnc-boring', 'hybrid-router-saw']

export type ControllerFamilyId =
  | 'SYNTEC'
  | 'WEIHONG_NCSTUDIO'
  | 'RICHAUTO_DSP'
  | 'MACH3'
  | 'FANUC'
  | 'SIEMENS_840D'
  | 'OSAI'
  | 'BECKHOFF_TWINCAT'
  | 'LNC'
  | 'LINUXCNC'
  | 'GRBL'
  | 'PROPRIETARY'
export const CONTROLLER_FAMILY_IDS: ControllerFamilyId[] = ['SYNTEC', 'WEIHONG_NCSTUDIO', 'RICHAUTO_DSP', 'MACH3', 'FANUC', 'SIEMENS_840D', 'OSAI', 'BECKHOFF_TWINCAT', 'LNC', 'LINUXCNC', 'GRBL', 'PROPRIETARY']

export type Confidence = 'manufacturer' | 'dealer' | 'generic'

export interface Source {
  title: string
  url: string
}

export interface TemplateSpindle {
  count: number
  power_kw: number | null
  rpm_max: number | null
  holder: string | null
}

export interface MachineTemplate {
  /** kebab-case, unique (manufacturer-model). */
  id: string
  manufacturer: string
  country: string
  series: string
  model: string
  category: MachineCategory
  machine_type: 'CNC_ROUTER' | 'PANEL_SAW' | 'CNC_DRILL' | 'HYBRID'
  work_envelope_mm: { x: number | null; y: number | null; z: number | null }
  table: string | null
  spindles: TemplateSpindle[]
  atc: { type: string | null; slots: number | null }
  drill_bank: { vertical: number | null; horizontal: number | null; groove_saw: boolean | null } | null
  saw: { blade_diameter_mm: number | null; kerf_mm: number | null; max_cut_height_mm: number | null; cut_length_mm: number | null } | null
  controller_family: ControllerFamilyId | null
  controller_models: string[]
  native_program_formats: string[]
  vendor_cam: string | null
  sources: Source[]
  confidence: Confidence
  notes: string
}

/** A documentation note: text (with the codes it names) or null = not documented. */
export type Note = string | null

export interface ControllerFamily {
  id: ControllerFamilyId
  vendor: string
  models: string[]
  /** Program file extensions, with the dot (".nc"). */
  file_extensions: string[]
  units_codes: Note
  absolute: Note
  tool_change: Note
  tool_length_offset: Note
  spindle: Note
  multi_spindle: Note
  canned_cycles: Note
  arcs: Note
  comments: Note
  program_end: Note
  /** Codes / features the documentation says are not supported. */
  known_unsupported: string[]
  sources: Source[]
  confidence: Confidence
  notes?: string
}

export type HardwareKind = 'hinge' | 'slide' | 'connector'

/**
 * Drilling data of a hardware product, mm. Keys by kind (cam/hardware.ts reads them; a missing required key
 * means "needs data" and blocks — nothing is guessed):
 * - hinge: cup_diameter_mm, cup_depth_mm, boring_distance_mm (C: door edge → cup edge), boring_distance_min_mm /
 *   boring_distance_max_mm, end_distance_mm (door end → cup centre), min_door_thickness_mm; optional
 *   cup_screw_holes { spacing_mm, offset_mm, diameter_mm, depth_mm }; optional plate { setback_mm, spacing_mm,
 *   diameter_mm, depth_mm } (mounting plate holes on the side panel, system 32).
 * - slide: setback_mm (front edge → first hole), positions_mm { [nominal length]: hole positions from the front },
 *   diameter_mm, depth_mm, min_inside_depth_extra_mm (cabinet depth needed beyond the nominal length).
 * - connector: cam_diameter_mm, cam_depth_mm, cam_distance_mm (B: board end → cam centre), bolt_diameter_mm,
 *   bolt_depth_mm (side-panel face hole), edge_hole_diameter_mm (horizontal, into the board end), positions_mm
 *   (from the front and back edges), min_board_thickness_mm / max_board_thickness_mm.
 */
export type Drilling = Record<string, unknown>

export interface HardwareItem {
  id: string
  brand: string
  product: string
  kind: HardwareKind
  drilling: Drilling
  sources: Source[]
  confidence: Confidence
  notes?: string
}

export interface LibraryData {
  machines: MachineTemplate[]
  controllers: ControllerFamily[]
  hardware: HardwareItem[]
  /** Where the data came from (seed, or the research import with its date). */
  origin: { kind: 'seed' | 'research'; imported_at: string | null; counts: { machines: number; controllers: number; hardware: number } }
}
