// Machine library import: research JSON → ui/src/cam/library/data/*.ts (typed, bundled by Vite).
//
//   node tools/import-machinelib.mjs [dir] [--no-seed] [--dry]
//
// dir (default: src/cam/library/seed) may contain, in the formats of ui/src/cam/library/types.ts:
//   machines.json            an array of MachineTemplate            (or part_*.json arrays, concatenated)
//   controllers.json         an array of ControllerFamily           (or parts/*.json, one family per file)
//   hardware.json            an array of HardwareItem, or the research form { hinges[], drawer_slides[], connectors[] }
// Every record is normalised (enums checked, numbers coerced, unknown → null) and listed when it is dropped.
// The seed records (generic class references) are kept unless --no-seed, after the imported ones, for ids the
// import does not have. Values stay reference data: the app turns a template into an UNVERIFIED profile only.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ui = new URL('..', import.meta.url).pathname
const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const dir = resolve(args.find((a) => !a.startsWith('--')) ?? join(ui, 'src/cam/library/seed'))
const seedDir = join(ui, 'src/cam/library/seed')
const outDir = join(ui, 'src/cam/library/data')
const warnings = []
const warn = (m) => warnings.push(m)

const CATEGORIES = ['nesting-router', 'ptp-router', '4-process-router', 'multi-spindle-router', 'panel-saw', 'cnc-boring', 'hybrid-router-saw']
const TYPES = ['CNC_ROUTER', 'PANEL_SAW', 'CNC_DRILL', 'HYBRID']
const FAMILIES = ['SYNTEC', 'WEIHONG_NCSTUDIO', 'RICHAUTO_DSP', 'MACH3', 'FANUC', 'SIEMENS_840D', 'OSAI', 'BECKHOFF_TWINCAT', 'LNC', 'LINUXCNC', 'GRBL', 'PROPRIETARY']
const CONF = ['manufacturer', 'dealer', 'generic']
const NOTE_KEYS = ['units_codes', 'absolute', 'tool_change', 'tool_length_offset', 'spindle', 'multi_spindle', 'canned_cycles', 'arcs', 'comments', 'program_end']

const read = (f) => JSON.parse(readFileSync(f, 'utf8'))
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v])
const sources = (v) => arr(v).map((s) => (typeof s === 'string' ? { title: s, url: s } : { title: str(s?.title) ?? str(s?.url) ?? '', url: str(s?.url) ?? '' })).filter((s) => s.title || s.url)
const conf = (v, id) => (CONF.includes(v) ? v : (warn(`${id}: confidence "${v}" → generic`), 'generic'))
const note = (v) => (v == null ? null : typeof v === 'string' ? v.trim() || null : Array.isArray(v) ? v.join('; ') : typeof v === 'object' ? JSON.stringify(v) : String(v))

function machine(m) {
  const id = str(m?.id)
  if (!id) return warn(`machine without id dropped: ${JSON.stringify(m).slice(0, 80)}`), null
  const category = CATEGORIES.includes(m.category) ? m.category : null
  if (!category) return warn(`${id}: unknown category "${m.category}" — dropped`), null
  const machine_type = TYPES.includes(m.machine_type) ? m.machine_type : category === 'panel-saw' ? 'PANEL_SAW' : category === 'cnc-boring' ? 'CNC_DRILL' : category === 'hybrid-router-saw' ? 'HYBRID' : 'CNC_ROUTER'
  if (m.machine_type !== machine_type) warn(`${id}: machine_type "${m.machine_type}" → ${machine_type}`)
  const fam = m.controller_family == null ? null : FAMILIES.includes(m.controller_family) ? m.controller_family : (warn(`${id}: controller_family "${m.controller_family}" → null`), null)
  const env = m.work_envelope_mm ?? {}
  const db = m.drill_bank && typeof m.drill_bank === 'object' ? { vertical: num(m.drill_bank.vertical), horizontal: num(m.drill_bank.horizontal), groove_saw: typeof m.drill_bank.groove_saw === 'boolean' ? m.drill_bank.groove_saw : null } : null
  const sw = m.saw && typeof m.saw === 'object' ? { blade_diameter_mm: num(m.saw.blade_diameter_mm), kerf_mm: num(m.saw.kerf_mm), max_cut_height_mm: num(m.saw.max_cut_height_mm), cut_length_mm: num(m.saw.cut_length_mm) } : null
  return {
    id, manufacturer: str(m.manufacturer) ?? '—', country: str(m.country) ?? '—', series: str(m.series) ?? '', model: str(m.model) ?? id, category, machine_type,
    work_envelope_mm: { x: num(env.x), y: num(env.y), z: num(env.z) }, table: str(m.table),
    spindles: arr(m.spindles).map((s) => ({ count: num(s?.count) ?? 1, power_kw: num(s?.power_kw), rpm_max: num(s?.rpm_max), holder: str(s?.holder) })).filter((s) => s.count > 0),
    atc: { type: str(m.atc?.type), slots: num(m.atc?.slots) }, drill_bank: db, saw: sw, controller_family: fam,
    controller_models: arr(m.controller_models).map(str).filter(Boolean), native_program_formats: arr(m.native_program_formats).map(str).filter(Boolean), vendor_cam: str(m.vendor_cam),
    sources: sources(m.sources), confidence: conf(m.confidence, id), notes: str(m.notes) ?? '',
  }
}

function controller(c) {
  const id = c?.id
  if (!FAMILIES.includes(id)) return warn(`controller "${id}" is not a known family — dropped`), null
  const out = { id, vendor: str(c.vendor) ?? '—', models: arr(c.models).map(str).filter(Boolean), file_extensions: [...new Set(arr(c.file_extensions).map((e) => /^\s*(\.[A-Za-z0-9]{1,6})\b/.exec(String(e ?? ''))?.[1]?.toLowerCase()).filter(Boolean))] }
  for (const k of NOTE_KEYS) out[k] = note(c[k])
  return { ...out, known_unsupported: arr(c.known_unsupported).map(note).filter(Boolean), sources: sources(c.sources), confidence: conf(c.confidence, id), notes: str(c.notes) ?? '' }
}

/* ---------------------------------------------------------------- hardware */

const pick = (o, ...keys) => {
  for (const k of keys) if (o && o[k] != null) return o[k]
  return undefined
}
/** Hinge of the research form → drilling keys of cam/hardware.ts. */
function hingeDrilling(h) {
  const bd = h.boring_distance_mm
  const fp = h.fixing_pattern ?? {}
  const mp = h.mounting_plate ?? null
  const dt = h.door_thickness_mm ?? {}
  const d = {
    cup_diameter_mm: num(h.cup_diameter_mm), cup_depth_mm: num(h.cup_depth_mm),
    boring_distance_mm: typeof bd === 'number' ? bd : null, boring_distance_min_mm: num(bd?.min ?? h.boring_distance_min_mm), boring_distance_max_mm: num(bd?.max ?? h.boring_distance_max_mm),
    end_distance_mm: num(h.end_distance_mm), min_door_thickness_mm: num(dt.min ?? h.min_door_thickness_mm), max_door_thickness_mm: num(dt.max ?? h.max_door_thickness_mm),
    cup_screw_pattern: num(fp.pattern_spacing_mm) != null ? { spacing_mm: num(fp.pattern_spacing_mm), offset_mm: num(fp.eccentric_offset_mm), type: str(fp.type) } : null,
    cup_screw_holes: num(fp.fixing_hole_diameter_mm) != null && num(fp.fixing_hole_depth_mm) != null && num(fp.pattern_spacing_mm) != null ? { spacing_mm: num(fp.pattern_spacing_mm), offset_mm: num(fp.eccentric_offset_mm), diameter_mm: num(fp.fixing_hole_diameter_mm), depth_mm: num(fp.fixing_hole_depth_mm) } : null,
    plate: mp ? { setback_mm: num(pick(mp, 'hole_line_setback_mm', 'setback_mm')), spacing_mm: num(pick(mp, 'hole_spacing_mm', 'spacing_mm')), diameter_mm: num(pick(mp, 'hole_diameter_mm', 'diameter_mm')), depth_mm: num(pick(mp, 'hole_depth_mm', 'depth_mm')) } : null,
  }
  return d
}
const nums = (v) => (Array.isArray(v) ? v.map(num).filter((x) => x !== null) : [])
/** "Ø5 mm hole" / "(Ø5 hole)" / "into Ø5 mm hole" in a fasteners text → 5. */
const holeDiameter = (fasteners) => {
  const t = JSON.stringify(fasteners ?? '')
  const m = /[ØøØ]\s*(\d+(?:\.\d+)?)\s*(?:mm\s*)?hole/i.exec(t)
  return m ? Number(m[1]) : null
}
/**
 * Drawer slides of the research form → one item per runner variant: positions (from the cabinet front edge) per
 * nominal length = holes for system screws ("both" + "B_only"; chipboard-screw-only positions are not pre-drilled),
 * range keys ("500-550") expanded to the variant's runner lengths. Hettich form: front hole + computed rear hole.
 * Hole depth is not in the catalogue tables → left missing ("needs data").
 */
function slideItems(s) {
  const id = str(s?.id)
  if (!id) return []
  const csh = s.cabinet_side_holes ?? {}
  const lengths = s.runner_lengths_NL_mm
  const base = { brand: str(s.brand) ?? str(s.manufacturer) ?? '—', kind: 'slide', sources: sources(s.sources), confidence: conf(s.confidence, id) }
  const diameter_mm = holeDiameter(csh.fasteners)
  const common = { setback_mm: num(csh.front_hole_mm) ?? 37, diameter_mm, depth_mm: null, min_inside_depth_extra_mm: 0, fixing_height_mm: num(csh.fixing_height_mm), reference: str(csh.reference) }
  const out = []
  if (num(csh.front_hole_mm) !== null && csh.rear_hole_from_front_mm_computed && typeof csh.rear_hole_from_front_mm_computed === 'object') {
    const positions_mm = Object.fromEntries(Object.entries(csh.rear_hole_from_front_mm_computed).map(([L, r]) => [L, [num(csh.front_hole_mm), num(r)].filter((x) => x !== null)]))
    out.push({ ...base, id, product: str(s.product) ?? id, drilling: { ...common, positions_mm }, notes: str(s.notes) ?? '' })
  }
  for (const [variant, table] of Object.entries(csh)) {
    if (!table || typeof table !== 'object' || Array.isArray(table) || ['fasteners', 'legend'].includes(variant) || /base_fixing/.test(variant)) continue
    const rows = Object.entries(table).filter(([k, v]) => /^\d+(?:-\d+)?$/.test(k) && v && typeof v === 'object')
    if (!rows.length) continue
    const vKey = variant.replace(/^profile_/, '')
    const all = Array.isArray(lengths) ? nums(lengths) : nums(lengths?.[vKey] ?? lengths?.[variant] ?? Object.values(lengths ?? {}).flat())
    const positions_mm = {}
    for (const [k, v] of rows) {
      const [a, b] = k.split('-').map(Number)
      const ls = b ? [...new Set([a, b, ...all.filter((L) => L >= a && L <= b)])] : [a]
      const ys = [...new Set([...nums(v.both), ...nums(v.B_only)])].sort((p, q) => p - q)
      for (const L of ls) positions_mm[String(L)] = ys
    }
    out.push({ ...base, id: `${id}:${vKey}`, product: `${str(s.product) ?? id} — ${vKey}`, drilling: { ...common, positions_mm, variant: vKey }, notes: [str(s.notes), str(table.note)].filter(Boolean).join(' ') })
  }
  if (!out.length) out.push({ ...base, id, product: str(s.product) ?? id, drilling: { ...common, raw: csh }, notes: str(s.notes) ?? '' })
  return out
}
/** Connectors of the research form: cam connectors mapped to the cam keys; other types kept with their type. */
function connectorItem(c) {
  const id = str(c?.id)
  if (!id) return null
  const base = { id, brand: str(c.brand) ?? str(c.manufacturer) ?? '—', product: str(c.product) ?? id, kind: 'connector', sources: sources(c.sources), confidence: conf(c.confidence, id), notes: str(c.notes) ?? '' }
  if (!c.cam_bore) return { ...base, drilling: { type: str(c.type) ?? 'unknown', raw: Object.fromEntries(Object.entries(c).filter(([k]) => !['id', 'manufacturer', 'product', 'sources', 'confidence', 'notes'].includes(k))) } }
  const edge = c.bolt_edge_hole ?? c.edge_hole ?? {}
  const opt = (v) => (Array.isArray(v) ? (nums(v).length === 1 ? nums(v)[0] : nums(v)) : num(v))
  return {
    ...base,
    drilling: {
      type: 'cam_connector', cam_diameter_mm: num(c.cam_bore.diameter_mm), cam_depth_by_thickness_mm: c.cam_bore.depth_by_panel_thickness_mm ?? null,
      cam_distance_mm: opt(c.drilling_distance_B_mm), edge_hole_diameter_mm: opt(edge.diameter_mm), edge_hole_depth_mm: num(edge.depth_mm),
      min_board_thickness_mm: num(c.min_panel_thickness_mm),
    },
  }
}

/** Slide / connector of the research form: numeric fields copied, common aliases mapped. */
function looseDrilling(o, aliases) {
  const d = {}
  for (const [k, v] of Object.entries(o)) if (!['id', 'manufacturer', 'brand', 'product', 'sources', 'confidence', 'notes', 'kind'].includes(k)) d[k] = v
  for (const [key, names] of Object.entries(aliases)) {
    if (d[key] != null) continue
    const v = pick(o, ...names)
    if (v !== undefined) d[key] = v
  }
  return d
}
const SLIDE_ALIASES = { setback_mm: ['front_setback_mm', 'first_hole_from_front_mm', 'hole_line_setback_mm'], diameter_mm: ['hole_diameter_mm', 'screw_hole_diameter_mm'], depth_mm: ['hole_depth_mm'], positions_mm: ['hole_positions_mm', 'cabinet_hole_positions_mm', 'positions_by_length_mm'] }
const CONNECTOR_ALIASES = { cam_diameter_mm: ['housing_diameter_mm', 'cam_bore_diameter_mm'], cam_depth_mm: ['housing_depth_mm', 'cam_bore_depth_mm'], cam_distance_mm: ['distance_b_mm', 'housing_centre_from_edge_mm', 'b_mm'], bolt_diameter_mm: ['bolt_hole_diameter_mm', 'face_hole_diameter_mm'], bolt_depth_mm: ['bolt_hole_depth_mm', 'face_hole_depth_mm'], edge_hole_diameter_mm: ['edge_bore_diameter_mm', 'horizontal_hole_diameter_mm'] }

function hardwareItem(h, kind) {
  const id = str(h?.id)
  if (!id) return warn(`hardware without id dropped`), null
  const k = kind ?? h.kind
  if (!['hinge', 'slide', 'connector'].includes(k)) return warn(`${id}: kind "${k}" — dropped`), null
  const drilling = h.drilling && typeof h.drilling === 'object' ? h.drilling : k === 'hinge' ? hingeDrilling(h) : looseDrilling(h, k === 'slide' ? SLIDE_ALIASES : CONNECTOR_ALIASES)
  return { id, brand: str(h.brand) ?? str(h.manufacturer) ?? '—', product: str(h.product) ?? id, kind: k, drilling, sources: sources(h.sources), confidence: conf(h.confidence, id), notes: str(h.notes) ?? '' }
}

/* ---------------------------------------------------------------- load */

function load(d) {
  const has = (f) => existsSync(join(d, f))
  let machines = [], controllers = [], hardware = []
  if (has('machines.json')) machines = arr(read(join(d, 'machines.json')))
  else for (const f of readdirSync(d).filter((x) => /^part_.*\.json$/.test(x)).sort()) machines.push(...arr(read(join(d, f))))
  if (has('controllers.json')) controllers = arr(read(join(d, 'controllers.json')))
  else if (existsSync(join(d, 'parts'))) for (const f of readdirSync(join(d, 'parts')).filter((x) => x.endsWith('.json')).sort()) controllers.push(...arr(read(join(d, 'parts', f))))
  if (has('hardware.json')) {
    const h = read(join(d, 'hardware.json'))
    if (Array.isArray(h)) hardware = h.map((x) => hardwareItem(x))
    else hardware = [...arr(h.hinges).map((x) => hardwareItem(x, 'hinge')), ...arr(h.drawer_slides ?? h.slides).flatMap(slideItems), ...arr(h.connectors).map(connectorItem)]
  }
  return { machines: machines.map(machine).filter(Boolean), controllers: controllers.map(controller).filter(Boolean), hardware: hardware.filter(Boolean) }
}

const dedupe = (list, what) => {
  const seen = new Map()
  for (const x of list) {
    if (seen.has(x.id)) warn(`${what} ${x.id}: duplicate id — the first one kept`)
    else seen.set(x.id, x)
  }
  return [...seen.values()]
}

const main = load(dir)
const isSeed = resolve(dir) === resolve(seedDir)
const seed = isSeed || flags.has('--no-seed') ? { machines: [], controllers: [], hardware: [] } : load(seedDir)
// imported records first (duplicates within the import are reported); a seed record only fills an id the
// import does not have (a researched family replaces the seed family of the same id)
const withSeed = (list, extra, what) => {
  const d = dedupe(list, what)
  const ids = new Set(d.map((x) => x.id))
  return [...d, ...extra.filter((x) => !ids.has(x.id))]
}
const data = {
  machines: withSeed(main.machines, seed.machines, 'machine'),
  controllers: withSeed(main.controllers, seed.controllers, 'controller'),
  hardware: withSeed(main.hardware, seed.hardware, 'hardware'),
}
const origin = { kind: isSeed ? 'seed' : 'research', imported_at: isSeed ? null : new Date().toISOString().slice(0, 10), counts: { machines: data.machines.length, controllers: data.controllers.length, hardware: data.hardware.length } }

const header = (what) => `// GENERATED by ui/tools/import-machinelib.mjs from ${isSeed ? 'src/cam/library/seed' : 'the research data'} — do not edit by hand (re-run the import).\n// ${what}: reference data only (catalogue / dealer / generic values). See ui/src/cam/library/types.ts.\n`
const files = {
  'machines.ts': `${header('Machine templates')}import type { MachineTemplate } from '../types'\n\nexport const MACHINES: MachineTemplate[] = ${JSON.stringify(data.machines, null, 1)}\n`,
  'controllers.ts': `${header('Controller families')}import type { ControllerFamily } from '../types'\n\nexport const CONTROLLERS: ControllerFamily[] = ${JSON.stringify(data.controllers, null, 1)}\n`,
  'hardware.ts': `${header('Hardware (hinges / slides / connectors)')}import type { HardwareItem } from '../types'\n\nexport const HARDWARE: HardwareItem[] = ${JSON.stringify(data.hardware, null, 1)}\n`,
  'origin.ts': `${header('Origin of the library data')}import type { LibraryData } from '../types'\n\nexport const ORIGIN: LibraryData['origin'] = ${JSON.stringify(origin)}\n`,
}
if (!flags.has('--dry')) for (const [f, text] of Object.entries(files)) writeFileSync(join(outDir, f), text)
console.log(JSON.stringify({ dir, wrote: flags.has('--dry') ? [] : Object.keys(files), ...origin.counts, families: data.controllers.map((c) => c.id), warnings }, null, 1))
