/**
 * Cabinet hardware → drilling. The products (hinges, drawer slides, connectors) come from the machine library
 * (cam/library, reference data with sources); the placement (boring distance, end distance, slide heights) is a
 * design decision stored on the cabinet (interior/model.ts CabinetHardware). Nothing is guessed: a product field
 * the drilling needs that is missing, or a placement that is not set, gives `HW_NEEDS_DATA:<product>:<field>` and
 * blocks production NC.
 *
 * Frame: every hole is in the FINISHED part-local frame of cutList(): x along the part length from its W1 end,
 * y across from its L1 edge (front edge of carcass parts, hinge edge of doors), on face A (the cabinet inside, up
 * on the CNC table). Side panels: x = height from the cabinet bottom, y = depth from the front. The second side
 * panel (piece 2/2, the right side) is the mirror of the first: a hole at height h is at x = H − h on it.
 * Door: x = height from the door's lower end, y from the hinge edge. Top / bottom: x from the left end.
 *
 * System 32: hole lines 37 mm from the front edge, 32 mm pitch (shelf pins, hinge mounting plates, slides).
 * Validation: every hole fully inside the part, no two holes overlapping, depth leaves ≥ MIN_REMAINING_MM of the
 * (measured) board, door thickness within the hinge's range, slide length within the carcass depth.
 */
import type { Cabinet, CabinetHardware } from '../interior/model'
import { hardwareById } from './library'
import type { HardwareItem } from './library/types'

/** Material left under a blind hole (mm): less than this and the hole breaks through the face. */
export const MIN_REMAINING_MM = 1
/** The hinge used when a cabinet chose none (the behaviour of earlier versions: cups only). */
export const LEGACY_HINGE = 'generic-hinge-35'

export type PartCode = 'SIDE' | 'TB' | 'DOOR' | 'DIV' | 'SHELF' | 'BACK'

export interface HwHole {
  part: PartCode
  /** Finished part-local position (mm). For an edge hole: x = 0 (W1 end) or the length (W2 end), y across. */
  x: number
  y: number
  d: number
  depth: number
  op: 'DRILL_VERTICAL' | 'DRILL_HORIZONTAL'
  product: string
  purpose: 'hinge-cup' | 'hinge-fixing' | 'hinge-plate' | 'slide' | 'cam' | 'bolt' | 'edge' | 'shelf-pin'
  /** Only on this piece of a pair (1 = left side, 2 = right side); undefined = every piece. */
  piece?: 1 | 2
}

export interface HwPlan {
  cabinet: string
  holes: HwHole[]
  /** Export-blocking problems (blocker codes). */
  issues: string[]
  /** Informational (not blocking), e.g. plate screws without pre-drilling. */
  notes: string[]
  /** No hinge product chosen: the legacy cup pattern of gcode.ts is used for doors. */
  legacyHinge: boolean
}

const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

/** Hinges per door by door height (the app's rule; check the manufacturer's weight chart for heavy doors). */
export const hingeCountFor = (doorH: number) => (doorH <= 900 ? 2 : doorH <= 1600 ? 3 : doorH <= 2000 ? 4 : 5)

/** Shelf-pin rows (system 32): 37 mm from the front and back edges, 32 mm pitch over the middle half of the length. */
export function shelfPinHoles(lf: number, wf: number): { x: number; y: number; d: number; depth: number }[] {
  const out: { x: number; y: number; d: number; depth: number }[] = []
  const x0 = Math.ceil((lf * 0.25) / 32) * 32, x1 = Math.floor((lf * 0.75) / 32) * 32
  for (let x = x0; x <= x1; x += 32) for (const y of [37, wf - 37]) out.push({ x, y, d: 5, depth: 12 })
  return out
}

/** Door geometry of cutList(): height h − 3, width w / doors − 3, its lower end 1.5 mm above the carcass bottom. */
export const doorOf = (c: Cabinet) => ({ l: c.h - 3, w: Math.round(c.w / Math.max(1, c.doors) - 3), bottom: 1.5 })

function needs(issues: string[], p: HardwareItem, field: string) {
  issues.push(`HW_NEEDS_DATA:${p.id}:${field}`)
}

export interface HwThickness {
  /** Measured carcass board thickness (null = nominal c.t). */
  board?: number | null
  /** Measured front (door) board thickness (null = nominal c.t). */
  front?: number | null
}

/** All hardware drilling of one cabinet (plus its shelf pins when `shelfPins`), validated. */
export function hardwarePlan(c: Cabinet, opts: { shelfPins?: boolean; thickness?: HwThickness } = {}): HwPlan {
  const sel: CabinetHardware = c.hardware ?? {}
  const issues: string[] = []
  const notes: string[] = []
  const holes: HwHole[] = []
  const tBoard = opts.thickness?.board ?? c.t, tFront = opts.thickness?.front ?? c.t
  const door = doorOf(c)
  const inner = c.w - 2 * c.t
  const legacyHinge = !sel.hinge
  const missing = (id: string | null | undefined) => {
    if (id && !hardwareById(id)) issues.push(`HW_PRODUCT_UNKNOWN:${id}`)
    return id ? hardwareById(id) : null
  }

  // product value: the cabinet's entered value (from the manufacturer's template / measured) or the catalogue value;
  // a list of options (e.g. B = 24 | 34) needs a choice, a missing value needs data — never a guess
  const field = (p: HardwareItem, key: string, report = true): number | null => {
    const o = sel.overrides?.[p.id]?.[key]
    if (typeof o === 'number' && Number.isFinite(o)) return o
    const v = p.drilling[key]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (report) {
      if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'number')) issues.push(`HW_NEEDS_CHOICE:${p.id}:${key}:${v.join('|')}`)
      else needs(issues, p, key)
    }
    return null
  }
  const list = (p: HardwareItem, key: string, fallback: unknown): number[] => {
    const o = sel.overrides?.[p.id]?.[key]
    const v = Array.isArray(o) ? o : fallback
    return Array.isArray(v) ? v.map(n).filter((x): x is number => x !== null) : []
  }

  // ---- hinges (doors + mounting plates on the side panels)
  const hinge = missing(sel.hinge)
  const hingeX: number[] = []
  if (hinge && c.doors > 0) {
    const d = hinge.drilling
    const D = field(hinge, 'cup_diameter_mm'), depth = field(hinge, 'cup_depth_mm')
    const C = n(sel.boringDistance) ?? field(hinge, 'boring_distance_mm', false)
    const end = n(sel.hingeEndDistance) ?? field(hinge, 'end_distance_mm', false)
    if (C === null) needs(issues, hinge, 'boring_distance')
    if (end === null) needs(issues, hinge, 'end_distance')
    const cMin = n(d.boring_distance_min_mm), cMax = n(d.boring_distance_max_mm)
    if (C !== null && ((cMin !== null && C < cMin - 1e-9) || (cMax !== null && C > cMax + 1e-9))) issues.push(`HW_BORING_DISTANCE_OUT_OF_RANGE:${hinge.id}:${C}:${cMin ?? '-'}-${cMax ?? '-'}`)
    const tMin = n(d.min_door_thickness_mm), tMax = n(d.max_door_thickness_mm)
    if ((tMin !== null && tFront < tMin - 1e-9) || (tMax !== null && tFront > tMax + 1e-9)) issues.push(`HW_DOOR_THICKNESS_OUT_OF_RANGE:${hinge.id}:${tFront}`)
    if (D !== null && depth !== null && C !== null && end !== null) {
      const count = Math.max(2, Math.round(n(sel.hingeCount) ?? hingeCountFor(door.l)))
      const y = C + D / 2
      for (let k = 0; k < count; k++) hingeX.push(end + (k * (door.l - 2 * end)) / (count - 1))
      for (const x of hingeX) holes.push({ part: 'DOOR', x, y, d: D, depth, op: 'DRILL_VERTICAL', product: hinge.id, purpose: 'hinge-cup' })
      const fx = obj(d.cup_screw_holes)
      if (fx && sel.hingeFixings !== false) {
        const sp = n(fx.spacing_mm), off = n(fx.offset_mm), fd = n(fx.diameter_mm), fdep = n(fx.depth_mm)
        if (sp === null || off === null || fd === null || fdep === null) needs(issues, hinge, 'cup_screw_holes')
        else for (const x of hingeX) for (const s of [-1, 1]) holes.push({ part: 'DOOR', x: x + (s * sp) / 2, y: y + off, d: fd, depth: fdep, op: 'DRILL_VERTICAL', product: hinge.id, purpose: 'hinge-fixing' })
      } else if (obj(d.cup_screw_pattern)) notes.push(`HW_HINGE_SCREW_ON:${hinge.id}`)
      // mounting-plate holes are pre-drilled only when the product states setback, spacing, Ø and depth
      const pl = obj(d.plate)
      if (pl) {
        const sb = n(pl.setback_mm), sp = n(pl.spacing_mm), pd = n(pl.diameter_mm), pdep = n(pl.depth_mm)
        if (sb === null || sp === null || pd === null || pdep === null) notes.push(`HW_PLATE_NOT_PREDRILLED:${hinge.id}`)
        else for (const x of hingeX) for (const s of [-1, 1]) holes.push({ part: 'SIDE', x: door.bottom + x + (s * sp) / 2, y: sb, d: pd, depth: pdep, op: 'DRILL_VERTICAL', product: hinge.id, purpose: 'hinge-plate' })
        if (c.w > 1200) notes.push(`HW_PLATES_ON_DIVIDERS_MANUAL:${hinge.id}`)
      }
    }
  }

  // ---- drawer slides (side panels, both sides, mirrored)
  const slide = missing(sel.slide)
  if (slide) {
    const d = slide.drilling
    const dia = field(slide, 'diameter_mm'), depth = field(slide, 'depth_mm')
    const pos = obj(d.positions_mm)
    if (!pos) needs(issues, slide, 'positions_mm')
    const extra = n(d.min_inside_depth_extra_mm) ?? 0
    const lengths = pos ? Object.keys(pos).map(Number).filter(Number.isFinite).sort((a, b) => a - b) : []
    const want = n(sel.slideLength)
    const len = want ?? [...lengths].reverse().find((L) => L + extra <= c.d - 6 + 1e-9) ?? null
    if (want !== null && !lengths.includes(want)) issues.push(`HW_SLIDE_LENGTH_UNKNOWN:${slide.id}:${want}`)
    else if (len === null && pos) issues.push(`HW_SLIDE_TOO_LONG:${slide.id}:${c.d}`)
    else if (len !== null && len + extra > c.d - 6 + 1e-9) issues.push(`HW_SLIDE_TOO_LONG:${slide.id}:${len}>${c.d}`)
    const rows = sel.slideRows ?? []
    if (!rows.length) issues.push(`HW_NEEDS_DATA:${slide.id}:slide_rows`)
    const ys = len !== null ? list(slide, `positions_mm.${len}`, pos?.[String(len)]) : []
    if (len !== null && pos && !ys.length) needs(issues, slide, `positions_mm.${len}`)
    if (dia !== null && depth !== null)
      for (const h of rows)
        for (const y of ys) {
          holes.push({ part: 'SIDE', x: h, y, d: dia, depth, op: 'DRILL_VERTICAL', product: slide.id, purpose: 'slide', piece: 1 })
          holes.push({ part: 'SIDE', x: c.h - h, y, d: dia, depth, op: 'DRILL_VERTICAL', product: slide.id, purpose: 'slide', piece: 2 })
        }
  }

  // ---- connectors (top / bottom ↔ sides): cam connectors; other types are not drilled by this plan
  const con = missing(sel.connector)
  if (con) {
    const d = con.drilling
    if (typeof d.type === 'string' && d.type !== 'cam_connector') issues.push(`HW_CONNECTOR_TYPE_UNSUPPORTED:${con.id}:${d.type}`)
    else {
      const tbl = obj(d.cam_depth_by_thickness_mm)
      const tabled = tbl ? n(tbl[String(tBoard)]) ?? n(tbl[String(Math.round(tBoard))]) : null
      const camD = field(con, 'cam_diameter_mm'), camDep = tabled !== null && sel.overrides?.[con.id]?.cam_depth_mm === undefined ? tabled : field(con, 'cam_depth_mm')
      const B = field(con, 'cam_distance_mm'), boltD = field(con, 'bolt_diameter_mm'), boltDep = field(con, 'bolt_depth_mm'), edgeD = field(con, 'edge_hole_diameter_mm')
      const ps = list(con, 'positions_mm', d.positions_mm)
      if (!ps.length) needs(issues, con, 'positions_mm')
      const tMin = n(d.min_board_thickness_mm), tMax = n(d.max_board_thickness_mm)
      if ((tMin !== null && tBoard < tMin - 1e-9) || (tMax !== null && tBoard > tMax + 1e-9)) issues.push(`HW_BOARD_THICKNESS_OUT_OF_RANGE:${con.id}:${tBoard}`)
      if (camD !== null && camDep !== null && B !== null && boltD !== null && boltDep !== null && edgeD !== null && ps.length) {
        const ys = [...new Set(ps.flatMap((p) => [p, c.d - p]))]
        for (const y of ys) {
          for (const x of [B, inner - B]) holes.push({ part: 'TB', x, y, d: camD, depth: camDep, op: 'DRILL_VERTICAL', product: con.id, purpose: 'cam' })
          // the edge hole must reach the cam bore: its depth is B when the product states none
          for (const x of [0, inner]) holes.push({ part: 'TB', x, y, d: edgeD, depth: n(d.edge_hole_depth_mm) ?? B, op: 'DRILL_HORIZONTAL', product: con.id, purpose: 'edge' })
          for (const x of [tBoard / 2, c.h - tBoard / 2]) holes.push({ part: 'SIDE', x, y, d: boltD, depth: boltDep, op: 'DRILL_VERTICAL', product: con.id, purpose: 'bolt' })
        }
      }
    }
  }

  // ---- shelf pins (checked against the hardware holes)
  const pins: HwHole[] = opts.shelfPins && c.shelves > 0 ? shelfPinHoles(c.h, c.d).map((h) => ({ part: 'SIDE' as const, ...h, op: 'DRILL_VERTICAL' as const, product: 'system32-shelf-pin', purpose: 'shelf-pin' as const })) : []

  // ---- validation
  const size: Record<string, { l: number; w: number; t: number }> = { SIDE: { l: c.h, w: c.d, t: tBoard }, TB: { l: inner, w: c.d, t: tBoard }, DOOR: { l: door.l, w: door.w, t: tFront } }
  for (const h of holes) {
    const s = size[h.part]
    if (!s) continue
    if (h.op === 'DRILL_VERTICAL') {
      if (h.x - h.d / 2 < -1e-9 || h.x + h.d / 2 > s.l + 1e-9 || h.y - h.d / 2 < -1e-9 || h.y + h.d / 2 > s.w + 1e-9) issues.push(`HW_HOLE_OUTSIDE_PART:${h.product}:${h.part}`)
      if (s.t - h.depth < MIN_REMAINING_MM - 1e-9) issues.push(`HW_THROUGH_HOLE:${h.product}:${h.part}:${h.depth}/${s.t}`)
    } else if (h.y - h.d / 2 < -1e-9 || h.y + h.d / 2 > s.w + 1e-9 || h.d > s.t + 1e-9) issues.push(`HW_HOLE_OUTSIDE_PART:${h.product}:${h.part}:edge`)
  }
  const face = [...holes.filter((h) => h.op === 'DRILL_VERTICAL'), ...pins]
  for (let i = 0; i < face.length; i++)
    for (let j = i + 1; j < face.length; j++) {
      const a = face[i], b = face[j]
      if (a.part !== b.part || (a.piece && b.piece && a.piece !== b.piece) || (a.purpose === b.purpose && a.product === b.product)) continue
      if (Math.hypot(a.x - b.x, a.y - b.y) < (a.d + b.d) / 2 + 1 - 1e-9) issues.push(`HW_HOLE_CLASH:${a.part}:${a.purpose}/${b.purpose}`)
    }
  return { cabinet: c.name, holes, issues: [...new Set(issues)], notes: [...new Set(notes)], legacyHinge }
}
