/**
 * Prototype BIM data model for "Villa Riverside" (Architecture discipline).
 *
 * A typed element store for the UI, the schedules and the model checks; the desktop app builds the
 * exact solids from it with OCCT (walls with openings natively, the other elements as primitives —
 * src/bim/scene.ts). Quantities (area, volume) are COMPUTED from parameters, never typed in.
 * Plan coordinates: mm, X east, Y north; a wall starts at (x, y) and runs `length` along `angle` (degrees).
 */
import { ensureIdentity } from './identity'

export type P2 = [number, number]

/** Where an element came from (v2.4): drawn by hand, imported from a CAD / PDF file, proposed by the local AI and
 *  approved, from a survey, or traced from an image. Imported / image data may need a review before production. */
export interface Provenance {
  kind: 'drawn' | 'imported' | 'ai' | 'survey' | 'image'
  /** 0…1 (recognition confidence) */
  confidence?: number
  reviewRequired?: boolean
}

/** Identity every BIM entity carries (schema v3): a UUID v4 kept for the life of the element (edits and moves keep
 *  it, a copy gets a new one), a revision bumped whenever the element changes, and its provenance. Optional in the
 *  type so older code and fixtures still type-check; `edit()` and the v2→v3 migration fill them in. */
export interface Identity {
  guid?: string
  rev?: number
  src?: Provenance
}

export interface Level extends Identity {
  id: string
  name: string
  elevation: number // mm
}

export interface WallType extends Identity {
  id: string
  family: 'Basic Wall' | 'Curtain Wall'
  name: string
  thickness: number // mm
  structure: string
  finishExt: string
  finishInt: string
  description: string
}

export interface Wall extends Identity {
  id: string
  category: 'wall'
  mark: string
  typeId: string
  baseLevel: string
  baseOffset: number
  topLevel: string
  topOffset: number
  length: number // mm
  description?: string
  /** Start point (mm) and direction (degrees CCW from +X); the wall is centred on this line. */
  x?: number
  y?: number
  angle?: number
  /** An arc wall (v2.4): the centre line is a circular arc through the start and end points (`length` stays the
   *  chord); signed radius — positive bulges to the left of start → end, |radius| ≥ length / 2 (the minor arc). */
  arc?: { radius: number }
  /** A sloped top (v2.4): the wall's height at its end (mm); the height at its start is the level-to-level height
   *  with the offsets. The top runs straight from one to the other. */
  heightEnd?: number
}

export interface Opening extends Identity {
  id: string
  category: 'door' | 'window'
  mark: string
  family: string
  type: string
  hostWall: string
  /** Distance of the opening's left edge from the host wall start (mm). */
  offset: number
  width: number
  height: number
  sill: number
  /** Door hinge side seen from the wall's start → end direction, and the side the leaf opens to (v2.4, SP06). */
  hinge?: 'left' | 'right'
  swing?: 'in' | 'out'
}

export interface Room extends Identity {
  id: string
  category: 'room'
  number: string
  name: string
  level: string
  area: number // m²
  /** Boundary placed in plan (rooms of the original survey carry only their area). */
  outline?: P2[]
  /** Inner boundaries (a core or shaft the room runs round): not part of the room; `area` is net of them. */
  holes?: P2[][]
  /** A double-height void (no floor of its own: the slab is cut out under it). */
  void?: boolean
  /** Bounding walls in order round the room, counter-clockwise (v2.4): each edge lies on that wall's centre line
   *  (`rev`: the edge runs from the wall's end to its start). With them the outline (inside faces), the net and gross
   *  areas and the perimeter are computed from the walls on every edit — a room follows its walls. */
  edges?: { wall: string; rev?: boolean }[]
  /** Gross area to the wall centre lines (m², computed) and the net perimeter along the inside faces (mm, computed). */
  areaGross?: number
  perimeter?: number
}

export interface Column extends Identity {
  id: string
  category: 'column'
  mark: string
  level: string
  topLevel: string
  x: number
  y: number
  w: number
  d: number
  round?: boolean
}

/** Floor slab (top at level + offset), roof (bottom at level + offset) or ceiling (at level + offset). */
export interface Slab extends Identity {
  id: string
  category: 'slab'
  mark: string
  kind: 'floor' | 'roof' | 'ceiling'
  level: string
  offset: number
  thickness: number
  outline: P2[]
  /** Holes through the slab (a stair well), each a closed outline. */
  openings?: P2[][]
  /** A stair landing (a floor slab part way up a storey; IFC .LANDING.). */
  landing?: boolean
}

/** Straight-run stair from its base level to its top level; risers follow the storey height.
 *  A flight of a stair with landings climbs only `rise` mm from `baseOffset` above its base level, in `risers`
 *  risers (a U stair: two flights and the landing between them). */
export interface Stair extends Identity {
  id: string
  category: 'stair'
  mark: string
  baseLevel: string
  topLevel: string
  x: number
  y: number
  angle: number
  length: number
  width: number
  baseOffset?: number
  rise?: number
  risers?: number
  /** a spiral stair: (x, y) is its centre, width = r1 − r0; treads from angle a0 (deg) through sweep (deg, signed) */
  spiral?: { r0: number; r1: number; a0: number; sweep: number }
  /** An L or U stair from the authoring tool (v2.4): flight 1 from (x, y) along `angle` (length = its run), a landing
   *  `landing` mm deep, flight 2 turning left or right (L: at 90°, U: back alongside, `gap` mm between the flights).
   *  `split` = risers in flight 1 (half when absent). Risers follow the storey height, so a level change re-shapes it. */
  run?: { kind: 'L' | 'U'; turn: 'left' | 'right'; landing: number; length2: number; gap?: number; split?: number }
}

export interface Railing extends Identity {
  id: string
  category: 'railing'
  mark: string
  level: string
  pts: P2[]
  height: number
  /** Base height above the level at each point (a stair rail climbs with its flight); 0 when absent. */
  z?: number[]
}

/** Loadable component placed as its bounding box (furniture, equipment). */
export interface Component extends Identity {
  id: string
  category: 'component'
  mark: string
  name: string
  level: string
  x: number
  y: number
  w: number
  d: number
  h: number
  rot: number
}

export interface GridLine extends Identity {
  id: string
  category: 'grid'
  label: string
  a: P2
  b: P2
}

/** Plan annotations: model text, aligned dimension (a → b), tag (shows the target's mark). */
export interface Annotation extends Identity {
  id: string
  category: 'annotation'
  kind: 'text' | 'dimension' | 'tag'
  level: string
  a: P2
  b?: P2
  text?: string
  target?: string
}

export interface Comment {
  id: string
  elementId: string | null
  text: string
  at: number
}

/** A beam (or a foundation tie beam) from the structural plans: its top `topOffset` from its level (structural
 *  slab top), centre line from (x, y) along `angle`, section b × h (h counted from its top, the slab included). */
export interface Beam extends Identity {
  id: string
  category: 'beam'
  mark: string
  level: string
  topOffset: number
  x: number
  y: number
  angle: number
  length: number
  b: number
  h: number
  /** a foundation tie beam (giằng móng) */
  tie?: boolean
  /** h not written on the plan: taken from the plan's beams of the same width */
  assumedH?: boolean
}

/** A pile cap / pad footing from the foundation plan: centre, size, top and bottom from its level, its piles. */
export interface Footing extends Identity {
  id: string
  category: 'footing'
  mark: string
  level: string
  x: number
  y: number
  w: number
  d: number
  top: number
  bottom: number
  piles: number
  /** pile section side (mm) */
  pileSize?: number
}

/** A pitched roof over a rectangle (plan corners in order), its eaves on its level: hip (four slopes) or gable
 *  (two slopes, a ridge end to end), slope in degrees. */
export interface PitchedRoof extends Identity {
  id: string
  category: 'roof'
  mark: string
  level: string
  outline: P2[]
  kind: 'hip' | 'gable'
  slope: number
  /** the rectangle stood for another outline (an L-shaped roof…): its box */
  approx?: boolean
}

/** Reinforcement as the typical details of the structural drawings give it (bars: number × diameter; meshes and
 *  stirrups: diameter at spacing, stirrups closer at the supports). */
export interface RebarSpec {
  column?: { main: { n: number; d: number }; stirrups: { d: number; aEnd: number; aMid: number } }
  /** a section per beam depth: the bars of the deepest-reinforced beam of that depth */
  beams: { h: number; bottom: { n: number; d: number }; top: { n: number; d: number }; stirrups: { d: number; aEnd: number; aMid: number } }[]
  cap?: { bottom: { d: number; a: number }; top: { d: number; a: number } }
  stair?: { bottom: { d: number; a: number }; top: { d: number; a: number } }
}

export interface BimModel {
  levels: Level[]
  wallTypes: WallType[]
  walls: Wall[]
  doors: Opening[]
  windows: Opening[]
  rooms: Room[]
  columns: Column[]
  slabs: Slab[]
  stairs: Stair[]
  railings: Railing[]
  components: Component[]
  grids: GridLine[]
  annotations: Annotation[]
  /** from the structural drawings (one-command import) */
  beams?: Beam[]
  footings?: Footing[]
  roofs?: PitchedRoof[]
  rebar?: RebarSpec
  /** Schema version of the saved model (3 = identities on every element) and the model revision, bumped by every
   *  committed edit (a render / bookmark records the revision it was made from). */
  schema?: number
  rev?: number
}

export type ElementCategory = 'wall' | 'door' | 'window' | 'room' | 'level' | 'column' | 'slab' | 'stair' | 'railing' | 'component' | 'grid' | 'annotation'
export type ElementRef = { category: ElementCategory; id: string }

export const LEVELS: Level[] = [
  { id: 'L1', name: 'Level 1', elevation: 0 },
  { id: 'L2', name: 'Level 2', elevation: 3000 },
  { id: 'L3', name: 'Level 3', elevation: 6000 },
  { id: 'RF', name: 'Roof', elevation: 9000 },
]

export const WALL_TYPES: WallType[] = [
  { id: 'C200', family: 'Basic Wall', name: 'Generic - 200mm Concrete', thickness: 200, structure: 'Concrete - C30', finishExt: 'Paint - Light Gray', finishInt: 'Paint - White', description: 'Exterior wall with insulation' },
  { id: 'P150', family: 'Basic Wall', name: 'Generic - 150mm Partition', thickness: 150, structure: 'Masonry - AAC Block', finishExt: 'Paint - White', finishInt: 'Paint - White', description: 'Interior partition' },
  { id: 'I250', family: 'Basic Wall', name: 'Generic - 250mm Insulated Concrete', thickness: 250, structure: 'Concrete - C30 + 50mm PIR', finishExt: 'Paint - Light Gray', finishInt: 'Paint - White', description: 'Exterior wall, improved insulation' },
  { id: 'CW100', family: 'Curtain Wall', name: 'Curtain Wall - 1500mm Grid', thickness: 100, structure: 'Aluminium mullions + double glazing', finishExt: 'Anodised aluminium', finishInt: 'Anodised aluminium', description: 'Glazed curtain wall, mullions every 1500 mm' },
]

/** Plan placement of the 24 villa walls: start (x, y) and direction, as the native seed (libs/bim/model.cpp). */
export const WALL_PLACEMENTS: Record<string, [number, number, number]> = {
  W6: [0, 0, 0], W7: [13800, 0, 90], W8: [13800, 9800, 180], W9: [0, 9800, 270],
  W1: [4200, 0, 90], W2: [7200, 9800, 270], W3: [4200, 6200, 0], W10: [0, 3600, 0],
  W11: [9600, 0, 90], W12: [9600, 4200, 0], W13: [4200, 9800, 270],
  W14: [0, 0, 0], W15: [13800, 0, 90], W16: [13800, 9800, 180], W17: [0, 9800, 270],
  W4: [4200, 0, 90], W5: [9600, 9800, 270], W18: [9600, 0, 90], W19: [0, 4200, 0], W20: [4200, 9800, 270],
  W21: [1200, 1200, 0], W22: [12600, 1200, 90], W23: [12600, 8600, 180], W24: [1200, 8600, 270],
}

/** Fills in what older saved models lack (placements, the element lists added later) and — schema v3 — a guid,
 *  rev 1 and provenance on every element (data otherwise untouched). `seeded`: guids derived from the element ids
 *  (the sample model, so it keeps the same GlobalIds); else random UUID v4s. */
export function upgradeModel(m: BimModel, seeded = false): BimModel {
  const types = m.wallTypes.some((t) => t.id === 'CW100') ? m.wallTypes : [...m.wallTypes, WALL_TYPES.find((t) => t.id === 'CW100')!]
  return ensureIdentity({
    ...m,
    wallTypes: types,
    walls: m.walls.map((w) => (w.x === undefined && WALL_PLACEMENTS[w.id] ? { ...w, x: WALL_PLACEMENTS[w.id][0], y: WALL_PLACEMENTS[w.id][1], angle: WALL_PLACEMENTS[w.id][2] } : w)),
    columns: m.columns ?? [],
    slabs: m.slabs ?? [],
    stairs: m.stairs ?? [],
    railings: m.railings ?? [],
    components: m.components ?? [],
    grids: m.grids ?? [],
    annotations: m.annotations ?? [],
  }, { kind: 'drawn' }, seeded)
}

// Walls W1–W5 are exactly the rows visible in mockup 04; W6–W24 complete the 24-wall model.
const WALL_ROWS: [string, string, string, string, number][] = [
  ['W1', 'C200', 'L1', 'L2', 4250],
  ['W2', 'C200', 'L1', 'L2', 3600],
  ['W3', 'P150', 'L1', 'L2', 2800],
  ['W4', 'C200', 'L2', 'L3', 4200],
  ['W5', 'C200', 'L2', 'L3', 3900],
  ['W6', 'C200', 'L1', 'L2', 13800],
  ['W7', 'C200', 'L1', 'L2', 9800],
  ['W8', 'C200', 'L1', 'L2', 13800],
  ['W9', 'C200', 'L1', 'L2', 9800],
  ['W10', 'P150', 'L1', 'L2', 3200],
  ['W11', 'P150', 'L1', 'L2', 4200],
  ['W12', 'P150', 'L1', 'L2', 3000],
  ['W13', 'P150', 'L1', 'L2', 3600],
  ['W14', 'C200', 'L2', 'L3', 13800],
  ['W15', 'C200', 'L2', 'L3', 9800],
  ['W16', 'C200', 'L2', 'L3', 13800],
  ['W17', 'C200', 'L2', 'L3', 9800],
  ['W18', 'P150', 'L2', 'L3', 4200],
  ['W19', 'P150', 'L2', 'L3', 3000],
  ['W20', 'P150', 'L2', 'L3', 3600],
  ['W21', 'C200', 'L3', 'RF', 11400],
  ['W22', 'C200', 'L3', 'RF', 7400],
  ['W23', 'C200', 'L3', 'RF', 11400],
  ['W24', 'C200', 'L3', 'RF', 7400],
]

const DOOR_ROWS: [string, string, number, number][] = [
  // mark, host, offset, width — D3 and D9 overlap on their hosts; D12 runs past its host's end
  ['D1', 'W6', 1200, 1000], ['D2', 'W1', 900, 900], ['D3', 'W2', 600, 900], ['D4', 'W3', 400, 800],
  ['D5', 'W10', 600, 800], ['D6', 'W11', 1700, 800], ['D7', 'W12', 1100, 800], ['D8', 'W13', 1400, 800],
  ['D9', 'W2', 1300, 900], ['D10', 'W18', 1700, 800], ['D11', 'W19', 1100, 800], ['D12', 'W20', 3200, 900],
]

const WINDOW_ROWS: [string, string, number, number][] = [
  // the five empty marks are deliberate model-standard violations; WN18 overlaps WN17
  ['WN1', 'W6', 3200, 1800], ['WN2', 'W6', 7400, 1800], ['WN3', 'W6', 10800, 1800], ['WN4', 'W7', 1500, 1500],
  ['WN5', 'W7', 6200, 1500], ['', 'W8', 1800, 1800], ['WN7', 'W8', 6000, 2400], ['', 'W8', 10400, 1800],
  ['WN9', 'W9', 2400, 1500], ['WN10', 'W14', 2400, 1800], ['', 'W14', 7400, 1800], ['WN12', 'W15', 3000, 1500],
  ['', 'W16', 2000, 1800], ['WN14', 'W16', 8400, 2400], ['WN15', 'W17', 3600, 1500], ['', 'W21', 2400, 1800],
  ['WN17', 'W22', 2000, 1500], ['WN18', 'W22', 3000, 1500],
]

const ROOM_ROWS: [string, string, string, number][] = [
  ['101', 'Living Room', 'L1', 28.6], ['102', 'Kitchen', 'L1', 12.8], ['103', 'Bedroom 1', 'L1', 14.5], ['104', 'Bedroom 2', 'L1', 13.2],
  ['105', 'Bath', 'L1', 5.2], ['106', 'Terrace', 'L1', 12.0], ['201', 'Master Bedroom', 'L2', 22.4], ['202', 'Family Room', 'L2', 26.0],
]

export function createVillaBim(): BimModel {
  return upgradeModel({
    levels: LEVELS,
    wallTypes: WALL_TYPES,
    walls: WALL_ROWS.map(([mark, typeId, baseLevel, topLevel, length]) => ({
      id: mark,
      category: 'wall',
      mark,
      typeId,
      baseLevel,
      baseOffset: 0,
      topLevel,
      topOffset: 0,
      length,
    })),
    doors: DOOR_ROWS.map(([mark, hostWall, offset, width], i) => ({
      id: `door-${i + 1}`,
      category: 'door',
      mark,
      family: 'Single-Flush',
      type: `${width} x 2100mm`,
      hostWall,
      offset,
      width,
      height: 2100,
      sill: 0,
    })),
    windows: WINDOW_ROWS.map(([mark, hostWall, offset, width], i) => ({
      id: `window-${i + 1}`,
      category: 'window',
      mark,
      family: 'Fixed',
      type: `${width} x 1500mm`,
      hostWall,
      offset,
      width,
      height: 1500,
      sill: 900,
    })),
    rooms: ROOM_ROWS.map(([number, name, level, area]) => ({ id: `room-${number}`, category: 'room', number, name, level, area })),
  } as BimModel, true)
}

/* ---------- derived quantities ---------- */

export const levelOf = (m: BimModel, id: string) => m.levels.find((l) => l.id === id)
export const typeOf = (m: BimModel, w: Wall) => m.wallTypes.find((t) => t.id === w.typeId)!

/** Unconnected height (mm) = top level + top offset − (base level + base offset). */
export function wallHeight(m: BimModel, w: Wall): number {
  const base = (levelOf(m, w.baseLevel)?.elevation ?? 0) + w.baseOffset
  const top = (levelOf(m, w.topLevel)?.elevation ?? 0) + w.topOffset
  return top - base
}

/** Centre-line run of a wall: its length, or the arc length of an arc wall (|R| · sweep). */
export function wallRunLength(w: Wall): number {
  const R = Math.abs(w.arc?.radius ?? 0)
  return R > 0 && R >= w.length / 2 ? R * 2 * Math.asin(Math.min(1, w.length / (2 * R))) : w.length
}
/** Mean height of a wall (a sloped top: the mean of its start and end heights). */
export const wallMeanHeight = (m: BimModel, w: Wall) => (w.heightEnd !== undefined && w.heightEnd > 0 ? (wallHeight(m, w) + w.heightEnd) / 2 : wallHeight(m, w))
/** Side area (m²) = centre-line run × mean height (an arc wall's arc length, a sloped wall's mean height). */
export const wallArea = (m: BimModel, w: Wall) => (wallRunLength(w) * wallMeanHeight(m, w)) / 1e6 // m²
export const wallVolume = (m: BimModel, w: Wall) => (wallArea(m, w) * typeOf(m, w).thickness) / 1000 // m³

/* ---------- model checks (deterministic, local) ---------- */

export interface CheckResult {
  key: 'health' | 'clash' | 'standards' | 'rooms' | 'params'
  /** 'off' = disabled in Coordination settings. */
  status: 'ok' | 'error' | 'warning' | 'off'
  count: number
  items: { elementId: string; message: string }[]
}

export function runModelChecks(m: BimModel): CheckResult[] {
  const health: CheckResult['items'] = []
  for (const w of m.walls) {
    if (wallHeight(m, w) <= 0) health.push({ elementId: w.id, message: `${w.mark}: top constraint is not above base` })
    if (w.length <= 0) health.push({ elementId: w.id, message: `${w.mark}: zero length` })
  }
  // ids are unique across the model (3D items, IFC GlobalIds and selection go by them); levels stack upwards
  const seen = new Map<string, string>()
  const lists: [string, { id: string }[] | undefined][] = [['wall', m.walls], ['door', m.doors], ['window', m.windows], ['room', m.rooms], ['column', m.columns], ['slab', m.slabs], ['stair', m.stairs], ['railing', m.railings], ['component', m.components], ['grid', m.grids], ['annotation', m.annotations], ['beam', m.beams], ['footing', m.footings], ['roof', m.roofs]]
  for (const [cat, xs] of lists)
    for (const x of xs ?? []) {
      const prev = seen.get(x.id)
      if (prev) health.push({ elementId: x.id, message: `${x.id}: id used twice (${prev}, ${cat})` })
      else seen.set(x.id, cat)
    }
  const lv = [...m.levels].sort((a, b) => a.elevation - b.elevation)
  for (let i = 1; i < lv.length; i++) if (Math.abs(lv[i].elevation - lv[i - 1].elevation) < 1) health.push({ elementId: lv[i].id, message: `${lv[i - 1].name} / ${lv[i].name}: two levels at the same elevation (${lv[i].elevation})` })
  const clash: CheckResult['items'] = []
  const openings = [...m.doors, ...m.windows]
  for (const o of openings) {
    const host = m.walls.find((w) => w.id === o.hostWall)
    if (!host) {
      health.push({ elementId: o.id, message: `${o.mark || o.id}: host wall missing` })
      continue
    }
    if (o.offset < 0 || o.offset + o.width > host.length)
      clash.push({ elementId: o.id, message: `${o.mark || o.id} extends beyond host wall ${host.mark}` })
  }
  for (let i = 0; i < openings.length; i++)
    for (let j = i + 1; j < openings.length; j++) {
      const a = openings[i]
      const b = openings[j]
      if (a.hostWall !== b.hostWall) continue
      const overlapX = a.offset < b.offset + b.width && b.offset < a.offset + a.width
      const overlapY = a.sill < b.sill + b.height && b.sill < a.sill + a.height
      if (overlapX && overlapY) clash.push({ elementId: b.id, message: `${a.mark || a.id} ↔ ${b.mark || b.id} overlap on ${a.hostWall}` })
    }
  const standards = openings.filter((o) => !o.mark.trim()).map((o) => ({ elementId: o.id, message: `${o.category === 'door' ? 'Door' : 'Window'} on ${o.hostWall} has no Mark` }))
  const rooms = m.rooms.filter((r) => !levelOf(m, r.level) || !(r.area > 0)).map((r) => ({ elementId: r.id, message: `Room ${r.number} not placed` }))
  const params = m.walls.filter((w) => !typeOf(m, w)?.structure).map((w) => ({ elementId: w.id, message: `${w.mark}: structure material missing` }))
  const res = (key: CheckResult['key'], items: CheckResult['items'], bad: 'error' | 'warning'): CheckResult => ({ key, items, count: items.length, status: items.length ? bad : 'ok' })
  return [res('health', health, 'error'), res('clash', clash, 'error'), res('standards', standards, 'warning'), res('rooms', rooms, 'warning'), res('params', params, 'warning')]
}

/* ---------- schedule export ---------- */

export function wallsCsv(m: BimModel): string {
  const head = ['Mark', 'Family and Type', 'Base Level', 'Length (mm)', 'Area (m2)', 'Volume (m3)', 'Count']
  const rows = m.walls.map((w) => [w.mark, typeOf(m, w).name, levelOf(m, w.baseLevel)?.name ?? '', w.length, wallArea(m, w).toFixed(2), wallVolume(m, w).toFixed(2), 1])
  return [head, ...rows].map((r) => r.map((c) => (/[",]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\n') + '\n'
}
