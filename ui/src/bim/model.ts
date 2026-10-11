/**
 * Prototype BIM data model for "Villa Riverside" (Architecture discipline).
 *
 * Like src/cad, this is NOT the BIM engine: it is a typed element store that lets the UI, the
 * schedules and the model checks be built and tested. Quantities (area, volume) are COMPUTED from
 * parameters, never typed in. The 3D view is the approved raster render (bim_main_3d_model.png).
 */
export interface Level {
  id: string
  name: string
  elevation: number // mm
}

export interface WallType {
  id: string
  family: 'Basic Wall'
  name: string
  thickness: number // mm
  structure: string
  finishExt: string
  finishInt: string
  description: string
}

export interface Wall {
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
}

export interface Opening {
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
}

export interface Room {
  id: string
  category: 'room'
  number: string
  name: string
  level: string
  area: number // m²
}

export interface Comment {
  id: string
  elementId: string | null
  text: string
  at: number
}

export interface BimModel {
  levels: Level[]
  wallTypes: WallType[]
  walls: Wall[]
  doors: Opening[]
  windows: Opening[]
  rooms: Room[]
}

export type ElementRef = { category: 'wall' | 'door' | 'window' | 'room' | 'level'; id: string }

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
]

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
  return {
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
  }
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

export const wallArea = (m: BimModel, w: Wall) => (w.length * wallHeight(m, w)) / 1e6 // m²
export const wallVolume = (m: BimModel, w: Wall) => (wallArea(m, w) * typeOf(m, w).thickness) / 1000 // m³

/* ---------- model checks (deterministic, local) ---------- */

export interface CheckResult {
  key: 'health' | 'clash' | 'standards' | 'rooms' | 'params'
  status: 'ok' | 'error' | 'warning'
  count: number
  items: { elementId: string; message: string }[]
}

export function runModelChecks(m: BimModel): CheckResult[] {
  const health: CheckResult['items'] = []
  for (const w of m.walls) {
    if (wallHeight(m, w) <= 0) health.push({ elementId: w.id, message: `${w.mark}: top constraint is not above base` })
    if (w.length <= 0) health.push({ elementId: w.id, message: `${w.mark}: zero length` })
  }
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
