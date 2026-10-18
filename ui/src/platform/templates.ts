/**
 * Project templates with real, editable content (SP49): apartment, house, one room, kitchen cabinetry, office,
 * interior fit-out. Each one builds a BIM model and / or an Interior design and a CAD 2D plan drawing from the
 * app's own sample data (bim/model.ts villa, interior/model.ts apartment) — subsets of it, or small shells drawn
 * with the same element types — so everything opens in the normal editors and passes their model rules.
 * Versioned: a template's `version` changes whenever its content does (recorded in the project's files).
 */
import { createVillaBim, LEVELS, WALL_TYPES, type BimModel, type Opening, type Room as BimRoom, type Wall } from '../bim/model'
import { CABINETS, ITEMS, ROOMS, area, type Cabinet, type Item, type Room } from '../interior/model'
import { createVillaDocument, LAYERS } from '../cad/seed'
import type { CadDocument, Entity } from '../cad/types'
import type { InteriorDoc } from '../state/interior'
import type { Discipline } from '../state/workspace'

export type TemplateId = 'apartment' | 'house' | 'oneRoom' | 'kitchen' | 'office' | 'fitout'
export const TEMPLATE_IDS: TemplateId[] = ['apartment', 'house', 'oneRoom', 'kitchen', 'office', 'fitout']

export interface TemplateContent { bim?: BimModel; interior?: InteriorDoc; cad: CadDocument }
export interface ProjectTemplate {
  id: TemplateId
  version: number
  discipline: Discipline
  folders: string[]
  build: (now?: number) => TemplateContent
}

/* ---------------------------------------------------------------- BIM shells */

const wall = (id: string, typeId: string, x: number, y: number, angle: number, length: number): Wall =>
  ({ id, category: 'wall', mark: id, typeId, baseLevel: 'L1', baseOffset: 0, topLevel: 'L2', topOffset: 0, length, x, y, angle })
const opening = (category: 'door' | 'window', id: string, mark: string, hostWall: string, offset: number, width: number): Opening =>
  category === 'door'
    ? { id, category, mark, family: 'Single-Flush', type: `${width} x 2100mm`, hostWall, offset, width, height: 2100, sill: 0 }
    : { id, category, mark, family: 'Fixed', type: `${width} x 1500mm`, hostWall, offset, width, height: 1500, sill: 900 }
const bimRoom = (n: string, name: string, outline: [number, number][]): BimRoom =>
  ({ id: `room-${n}`, category: 'room', number: n, name, level: 'L1', area: Math.round(area(outline.map(([x, y]) => ({ x, y }))) * 10) / 10, outline })

function bimModel(walls: Wall[], doors: Opening[], windows: Opening[], rooms: BimRoom[]): BimModel {
  return {
    levels: LEVELS.slice(0, 2), wallTypes: WALL_TYPES, walls, doors, windows, rooms,
    columns: [], slabs: [], stairs: [], railings: [], components: [], grids: [], annotations: [],
  }
}

/** A closed rectangular room shell of four exterior walls (counter-clockwise from the origin). */
function shell(w: number, d: number, prefix = 'W'): Wall[] {
  return [wall(`${prefix}1`, 'C200', 0, 0, 0, w), wall(`${prefix}2`, 'C200', w, 0, 90, d), wall(`${prefix}3`, 'C200', w, d, 180, w), wall(`${prefix}4`, 'C200', 0, d, 270, d)]
}

/** Villa Level 1 only (an apartment floor): its walls, their openings and rooms. */
function villaLevel1(): BimModel {
  const m = createVillaBim()
  const walls = m.walls.filter((w) => w.baseLevel === 'L1')
  const ids = new Set(walls.map((w) => w.id))
  return { ...m, levels: m.levels.slice(0, 2), walls, doors: m.doors.filter((o) => ids.has(o.hostWall)), windows: m.windows.filter((o) => ids.has(o.hostWall)), rooms: m.rooms.filter((r) => r.level === 'L1') }
}

/* ---------------------------------------------------------------- CAD plan drawing */

let seq = 0
const base = (layer: string) => ({ id: `tpl-${++seq}`, layer, color: 'ByLayer', linetype: 'ByLayer' as const, lineweight: 'ByLayer' as const, transparency: 0 })

/** A plan drawing of a BIM model and / or interior rooms: walls as outlines, openings, room names with areas,
 *  overall dimensions — plain CAD 2D entities, editable like any drawing. */
export function planDrawing(name: string, bim: BimModel | undefined, rooms: Room[] | undefined, now = Date.now()): CadDocument {
  const ents: Entity[] = []
  const thick = (m: BimModel, w: Wall) => m.wallTypes.find((t) => t.id === w.typeId)?.thickness ?? 200
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const grow = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  if (bim) {
    for (const w of bim.walls) {
      if (w.x === undefined || w.y === undefined || w.angle === undefined || w.baseLevel !== 'L1') continue
      const a = (w.angle * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux, h = thick(bim, w) / 2
      const p = (s: number, o: number) => ({ x: w.x! + ux * s + nx * o, y: w.y! + uy * s + ny * o })
      ents.push({ ...base('A-Wall'), kind: 'polyline', pts: [p(0, -h), p(w.length, -h), p(w.length, h), p(0, h)], closed: true })
      grow(p(0, 0).x, p(0, 0).y); grow(p(w.length, 0).x, p(w.length, 0).y)
      for (const o of [...bim.doors, ...bim.windows].filter((q) => q.hostWall === w.id)) {
        const layer = o.category === 'door' ? 'A-Door' : 'A-Window'
        ents.push({ ...base(layer), kind: 'line', a: p(o.offset, 0), b: p(o.offset + o.width, 0) })
        if (o.category === 'door') ents.push({ ...base(layer), kind: 'arc', c: p(o.offset, 0), r: o.width, start: a, end: a + Math.PI / 2 })
      }
    }
  }
  for (const r of rooms ?? []) {
    ents.push({ ...base('A-Anno'), kind: 'polyline', pts: r.outline, closed: true, linetype: 'Dashed' })
    r.outline.forEach((q) => grow(q.x, q.y))
    const cx = r.outline.reduce((s, q) => s + q.x, 0) / r.outline.length, cy = r.outline.reduce((s, q) => s + q.y, 0) / r.outline.length
    ents.push({ ...base('A-Anno'), kind: 'text', p: { x: cx, y: cy + 120 }, height: 220, value: r.name, rotation: 0, align: 'center' })
    ents.push({ ...base('A-Anno'), kind: 'text', p: { x: cx, y: cy - 220 }, height: 160, value: `${area(r.outline).toFixed(2)} m²`, rotation: 0, align: 'center' })
  }
  if (!bim && rooms?.length === 0) grow(0, 0)
  if (Number.isFinite(x0)) {
    ents.push({ ...base('A-Dims'), kind: 'dimension', a: { x: x0, y: y0 }, b: { x: x1, y: y0 }, offset: -900, override: null, textHeight: 200 })
    ents.push({ ...base('A-Dims'), kind: 'dimension', a: { x: x1, y: y0 }, b: { x: x1, y: y1 }, offset: -900, override: null, textHeight: 200 })
  }
  return {
    id: `tpl-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name, entities: ents, layers: LAYERS, currentLayer: 'A-Wall',
    underlay: null, blocks: [], dirty: false, createdAt: now, savedAt: now, source: 'new',
    layouts: [{ id: 'layout1', name: 'A3 1-50', paper: 'A3', scale: 50 }, { id: 'layout2', name: 'A1', paper: 'A1', scale: null }],
  }
}

/* ---------------------------------------------------------------- interior subsets */

const pick = (rooms: string[], extraItems: Item[] = [], extraCabinets: Cabinet[] = []): InteriorDoc => ({
  rooms: ROOMS.filter((r) => rooms.includes(r.id)),
  items: [...ITEMS.filter((i) => rooms.includes(i.room)), ...extraItems],
  cabinets: [...CABINETS.filter((c) => rooms.includes(c.room)), ...extraCabinets],
})

const rect = (x: number, y: number, w: number, d: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + d }, { x, y: y + d }]
const FIN = { ceilingHeight: 2900, floorFinish: 'Porcelain Tile - Beige', wallFinish: 'Paint - Warm White', ceilingFinish: 'Gypsum - White' }

/* ---------------------------------------------------------------- templates */

export const TEMPLATES: ProjectTemplate[] = [
  {
    id: 'apartment', version: 1, discipline: 'interior',
    folders: ['01_Brief', '02_Plan', '03_Interior', '04_Joinery', '05_Renders'],
    build: (now) => { const bim = villaLevel1(); const interior = pick(ROOMS.map((r) => r.id)); return { bim, interior, cad: planDrawing('Apartment - Plan.dwg', undefined, interior.rooms, now) } },
  },
  {
    id: 'house', version: 1, discipline: 'architectural',
    folders: ['01_Concept', '02_Architecture', '03_Structural', '04_MEP', '05_Interior'],
    build: (now) => { const bim = createVillaBim(); return { bim, cad: { ...createVillaDocument(now), id: `tpl-house-${(now ?? Date.now()).toString(36)}`, name: 'House - Floor Plan.dwg', source: 'new' as const } } },
  },
  {
    id: 'oneRoom', version: 1, discipline: 'interior',
    folders: ['01_Survey', '02_Layout', '03_Renders'],
    build: (now) => {
      const walls = shell(4000, 3500)
      const bim = bimModel(walls, [opening('door', 'door-1', 'D1', 'W1', 600, 900)], [opening('window', 'window-1', 'WN1', 'W3', 1400, 1200)], [bimRoom('101', 'Room', [[0, 0], [4000, 0], [4000, 3500], [0, 3500]])])
      const room: Room = { id: 'room', name: 'Room', outline: rect(0, 0, 4000, 3500), ...FIN, floorFinish: 'Wood - Oak' }
      const items: Item[] = [
        { id: 'r1', name: 'Queen Bed', category: 'beds', room: 'room', w: 1600, d: 2000, h: 1050, material: 'Fabric - Linen', qty: 1, status: 'planned', at: [{ x: 2000, y: 2400, rot: 0 }] },
        { id: 'r2', name: 'Wardrobe', category: 'cabinet', room: 'room', w: 1600, d: 600, h: 2400, material: 'Wood - Oak', qty: 1, status: 'planned', cabinet: 'rc1', at: [{ x: 3100, y: 400, rot: 0 }] },
      ]
      const cabinets: Cabinet[] = [{ id: 'rc1', name: 'Wardrobe', room: 'room', w: 1600, d: 600, h: 2400, t: 18, shelves: 4, doors: 4, board: 'MFC 18 - Oak', front: 'MFC 18 - Oak' }]
      return { bim, interior: { rooms: [room], items, cabinets }, cad: planDrawing('One Room - Plan.dwg', bim, [room], now) }
    },
  },
  {
    id: 'kitchen', version: 1, discipline: 'interior',
    folders: ['01_Survey', '02_Kitchen_Layout', '03_Cut_Lists', '04_CNC_Preview'],
    build: (now) => {
      const extraCab: Cabinet[] = [
        { id: 'kc-wall', name: 'Kitchen Wall Cabinet', room: 'dining', w: 2400, d: 350, h: 700, t: 18, shelves: 1, doors: 4, board: 'MFC 18 - Oak', front: 'MFC 18 - Oak' },
        { id: 'kc-tall', name: 'Pantry Tall Cabinet', room: 'dining', w: 600, d: 600, h: 2200, t: 18, shelves: 4, doors: 1, board: 'MFC 18 - Oak', front: 'MFC 18 - Oak' },
      ]
      const extraItems: Item[] = [
        { id: 'k1', name: 'Kitchen Wall Cabinet', category: 'cabinet', room: 'dining', w: 2400, d: 350, h: 700, material: 'Wood - Oak', qty: 1, status: 'planned', cabinet: 'kc-wall' },
        { id: 'k2', name: 'Pantry Tall Cabinet', category: 'cabinet', room: 'dining', w: 600, d: 600, h: 2200, material: 'Wood - Oak', qty: 1, status: 'planned', cabinet: 'kc-tall' },
      ]
      const interior = pick(['dining'], extraItems, extraCab)
      const r = interior.rooms[0]
      const xs = r.outline.map((p) => p.x), ys = r.outline.map((p) => p.y)
      const w = Math.max(...xs) - Math.min(...xs), d = Math.max(...ys) - Math.min(...ys)
      // the kitchen's own shell, at the room's position
      const walls = shell(w, d).map((q) => ({ ...q, x: q.x! + Math.min(...xs), y: q.y! + Math.min(...ys) }))
      const bim = bimModel(walls, [opening('door', 'door-1', 'D1', 'W4', 800, 900)], [opening('window', 'window-1', 'WN1', 'W1', 1800, 1500)], [bimRoom('101', r.name, r.outline.map((p) => [p.x, p.y]))])
      return { bim, interior, cad: planDrawing('Kitchen - Plan.dwg', bim, interior.rooms, now) }
    },
  },
  {
    id: 'office', version: 1, discipline: 'bim',
    folders: ['01_Model', '02_Views', '03_Sheets', '04_Schedules', '05_Fit-out'],
    build: (now) => {
      // 12 × 8 m floor; a 4 × 4 m meeting room in the north-east corner
      const walls = [...shell(12000, 8000), wall('W5', 'P150', 8000, 4000, 0, 4000), wall('W6', 'P150', 8000, 4000, 90, 4000)]
      const doors = [opening('door', 'door-1', 'D1', 'W1', 1000, 1000), opening('door', 'door-2', 'D2', 'W6', 1500, 900)]
      const windows = [opening('window', 'window-1', 'WN1', 'W1', 3500, 1800), opening('window', 'window-2', 'WN2', 'W1', 7500, 1800), opening('window', 'window-3', 'WN3', 'W3', 2000, 1800), opening('window', 'window-4', 'WN4', 'W3', 6500, 1800)]
      const open: [number, number][] = [[0, 0], [12000, 0], [12000, 4000], [8000, 4000], [8000, 8000], [0, 8000]]
      const meet: [number, number][] = [[8000, 4000], [12000, 4000], [12000, 8000], [8000, 8000]]
      const bim = bimModel(walls, doors, windows, [bimRoom('101', 'Open Office', open), bimRoom('102', 'Meeting Room', meet)])
      const rooms: Room[] = [
        { id: 'open', name: 'Open Office', outline: open.map(([x, y]) => ({ x, y })), ...FIN, ceilingHeight: 2800 },
        { id: 'meet', name: 'Meeting Room', outline: meet.map(([x, y]) => ({ x, y })), ...FIN, ceilingHeight: 2800, floorFinish: 'Wood - Oak' },
      ]
      const items: Item[] = [
        { id: 'o1', name: 'Desk', category: 'tables', room: 'open', w: 1400, d: 700, h: 750, material: 'Wood - Oak', qty: 6, status: 'planned' },
        { id: 'o2', name: 'Office Chair', category: 'chairs', room: 'open', w: 600, d: 600, h: 1000, material: 'Fabric - Taupe', qty: 6, status: 'planned' },
        { id: 'o3', name: 'Meeting Table', category: 'tables', room: 'meet', w: 2400, d: 1200, h: 750, material: 'Wood - Walnut', qty: 1, status: 'planned' },
        { id: 'o4', name: 'Meeting Chair', category: 'chairs', room: 'meet', w: 520, d: 580, h: 820, material: 'Fabric - Taupe', qty: 8, status: 'planned' },
        { id: 'o5', name: 'Storage Cabinet', category: 'cabinet', room: 'open', w: 1600, d: 450, h: 2000, material: 'Wood - Oak', qty: 1, status: 'planned', cabinet: 'oc1' },
        { id: 'o6', name: 'Linear Pendant', category: 'lighting', room: 'open', w: 1200, d: 60, h: 80, material: 'Metal - Black', qty: 6, status: 'planned' },
      ]
      const cabinets: Cabinet[] = [{ id: 'oc1', name: 'Storage Cabinet', room: 'open', w: 1600, d: 450, h: 2000, t: 18, shelves: 4, doors: 4, board: 'MFC 18 - Oak', front: 'MFC 18 - Oak' }]
      return { bim, interior: { rooms, items, cabinets }, cad: planDrawing('Office - Plan.dwg', bim, rooms, now) }
    },
  },
  {
    id: 'fitout', version: 1, discipline: 'interior',
    folders: ['01_Existing', '02_Finishes', '03_Ceilings', '04_Lighting', '05_Schedules'],
    build: (now) => {
      // finishes, ceilings and lighting of the sample apartment — the furniture comes later
      const interior: InteriorDoc = { rooms: ROOMS, items: ITEMS.filter((i) => i.category === 'lighting').map((i) => ({ ...i, status: 'planned' as const })), cabinets: [] }
      return { interior, cad: planDrawing('Fit-out - Finishes Plan.dwg', undefined, interior.rooms, now) }
    },
  },
]

export const templateById = (id: TemplateId) => TEMPLATES.find((t) => t.id === id)!
