/**
 * Interior design model (Villa Riverside, Level 1). Geometry is in millimetres.
 *
 * Everything shown on the Interior workspace is derived from this data: room areas and perimeters come
 * from the room outlines, quantities from finishes × geometry, and the production cut list from the
 * parametric cabinets. Nothing here is AI output; the 3D view is a DEMO image until the interior engine
 * is connected.
 */

export interface Pt {
  x: number
  y: number
}

export interface Room {
  id: string
  name: string
  /** Closed outline, mm, counter-clockwise. */
  outline: Pt[]
  ceilingHeight: number
  floorFinish: string
  wallFinish: string
  ceilingFinish: string
}

export type ItemCategory = 'sofas' | 'tables' | 'cabinet' | 'chairs' | 'lighting' | 'beds' | 'decor' | 'rugs'
export type ItemStatus = 'placed' | 'planned'

export interface Item {
  id: string
  name: string
  category: ItemCategory
  room: string
  /** W × D × H (mm); round items use `dia` instead of W × D. */
  w?: number
  d?: number
  h: number
  dia?: number
  material: string
  qty: number
  status: ItemStatus
  thumb?: string
  /** Links a cabinet item to its parametric definition (cut list). */
  cabinet?: string
  /** Plan placement of each instance (centre, rotation in degrees) — items built from a CAD plan. */
  at?: { x: number; y: number; rot: number }[]
}

export interface Material {
  name: string
  kind: 'fabric' | 'wood' | 'stone' | 'metal' | 'paint' | 'tile' | 'gypsum' | 'board'
  color: string
}

export interface Cabinet {
  id: string
  name: string
  room: string
  w: number
  d: number
  h: number
  /** Carcass board thickness (mm). */
  t: number
  shelves: number
  doors: number
  board: string
  front: string
}

export interface CutPart {
  cabinet: string
  part: string
  qty: number
  /** Finished length × width (mm), grain along length. */
  l: number
  wd: number
  t: number
  material: string
  /** Edge banding on this part (mm per piece). */
  edge: number
}

export const MATERIALS: Material[] = [
  { name: 'Fabric - Beige', kind: 'fabric', color: '#d8cdbb' },
  { name: 'Fabric - Taupe', kind: 'fabric', color: '#9c8f80' },
  { name: 'Fabric - Linen', kind: 'fabric', color: '#e4dccd' },
  { name: 'Fabric - Olive', kind: 'fabric', color: '#5d6b4c' },
  { name: 'Marble - White', kind: 'stone', color: '#ecebe7' },
  { name: 'Wood - Walnut', kind: 'wood', color: '#6e4a33' },
  { name: 'Wood - Oak', kind: 'wood', color: '#b88a5c' },
  { name: 'Wood - Ash Light', kind: 'wood', color: '#d9c3a2' },
  { name: 'Metal - Brass', kind: 'metal', color: '#b8964f' },
  { name: 'Metal - Black', kind: 'metal', color: '#2b2b2b' },
  { name: 'Paint - Warm White', kind: 'paint', color: '#f3eee6' },
  { name: 'Porcelain Tile - Beige', kind: 'tile', color: '#e2d6c3' },
  { name: 'Gypsum - White', kind: 'gypsum', color: '#f7f7f5' },
  { name: 'MFC 18 - Walnut', kind: 'board', color: '#7a5238' },
  { name: 'MFC 18 - Oak', kind: 'board', color: '#c49a6c' },
  { name: 'HDF 6 - White', kind: 'board', color: '#f1f0ec' },
]

const rect = (x: number, y: number, w: number, d: number): Pt[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + d },
  { x, y: y + d },
]

const FIN = { floorFinish: 'Porcelain Tile - Beige', wallFinish: 'Paint - Warm White', ceilingFinish: 'Gypsum - White', ceilingHeight: 3000 }

export const ROOMS: Room[] = [
  { id: 'living', name: 'Living Room', outline: rect(0, 0, 7670, 3730), ...FIN },
  { id: 'dining', name: 'Dining & Kitchen', outline: rect(7670, 0, 5200, 4100), ...FIN },
  { id: 'master', name: 'Master Bedroom', outline: rect(0, 3730, 4500, 4000), ...FIN, floorFinish: 'Wood - Oak' },
  { id: 'bed1', name: 'Bedroom 1', outline: rect(4500, 3730, 3170, 3400), ...FIN, floorFinish: 'Wood - Oak' },
  { id: 'bed2', name: 'Bedroom 2', outline: rect(8300, 4100, 3600, 3300), ...FIN, floorFinish: 'Wood - Oak' },
  { id: 'bath1', name: 'Bathroom 1', outline: rect(11900, 4100, 2400, 2100), ...FIN, ceilingHeight: 2700 },
  { id: 'bath2', name: 'Bathroom 2', outline: rect(4500, 7130, 2200, 1900), ...FIN, ceilingHeight: 2700 },
  { id: 'laundry', name: 'Laundry', outline: rect(6700, 7130, 1600, 1600), ...FIN, ceilingHeight: 2700 },
  { id: 'balcony', name: 'Balcony', outline: rect(0, -1500, 3600, 1500), ...FIN, ceilingFinish: '—', ceilingHeight: 3000 },
]

const T = '/assets/v2/interior/'
export const ITEMS: Item[] = [
  { id: 'i1', name: 'Sofa L-Shape', category: 'sofas', room: 'living', w: 3200, d: 1800, h: 780, material: 'Fabric - Beige', qty: 1, status: 'placed', thumb: T + 'item-sofa.png' },
  { id: 'i2', name: 'Coffee Table', category: 'tables', room: 'living', dia: 900, h: 350, material: 'Marble - White', qty: 1, status: 'placed', thumb: T + 'item-coffee-table.png' },
  { id: 'i3', name: 'TV Cabinet', category: 'cabinet', room: 'living', w: 3200, d: 400, h: 500, material: 'Wood - Walnut', qty: 1, status: 'placed', thumb: T + 'item-tv-cabinet.png', cabinet: 'c1' },
  { id: 'i4', name: 'Dining Table', category: 'tables', room: 'dining', w: 2400, d: 1000, h: 750, material: 'Wood - Oak', qty: 1, status: 'placed', thumb: T + 'item-dining-table.png' },
  { id: 'i5', name: 'Dining Chair', category: 'chairs', room: 'dining', w: 520, d: 580, h: 820, material: 'Fabric - Taupe', qty: 6, status: 'placed', thumb: T + 'item-dining-chair.png' },
  { id: 'i6', name: 'Pendant Light', category: 'lighting', room: 'dining', dia: 400, h: 300, material: 'Metal - Brass', qty: 3, status: 'placed', thumb: T + 'item-pendant.png' },
  { id: 'i7', name: 'Lounge Armchair', category: 'chairs', room: 'living', w: 860, d: 820, h: 760, material: 'Fabric - Olive', qty: 1, status: 'placed' },
  { id: 'i8', name: 'Area Rug', category: 'rugs', room: 'living', w: 3000, d: 2400, h: 12, material: 'Fabric - Linen', qty: 1, status: 'placed' },
  { id: 'i9', name: 'Kitchen Base Cabinet', category: 'cabinet', room: 'dining', w: 2400, d: 600, h: 850, material: 'Wood - Oak', qty: 1, status: 'placed', cabinet: 'c2' },
  { id: 'i10', name: 'Linear Pendant', category: 'lighting', room: 'living', w: 1200, d: 60, h: 80, material: 'Metal - Brass', qty: 1, status: 'planned' },
  { id: 'i11', name: 'Wardrobe', category: 'cabinet', room: 'master', w: 2000, d: 600, h: 2400, material: 'Wood - Walnut', qty: 1, status: 'planned', cabinet: 'c3' },
  { id: 'i12', name: 'Queen Bed', category: 'beds', room: 'master', w: 1600, d: 2000, h: 1050, material: 'Fabric - Linen', qty: 1, status: 'planned' },
]

export const CABINETS: Cabinet[] = [
  { id: 'c1', name: 'TV Cabinet', room: 'living', w: 3200, d: 400, h: 500, t: 18, shelves: 1, doors: 4, board: 'MFC 18 - Walnut', front: 'MFC 18 - Walnut' },
  { id: 'c2', name: 'Kitchen Base Cabinet', room: 'dining', w: 2400, d: 600, h: 850, t: 18, shelves: 1, doors: 4, board: 'MFC 18 - Oak', front: 'MFC 18 - Oak' },
  { id: 'c3', name: 'Wardrobe', room: 'master', w: 2000, d: 600, h: 2400, t: 18, shelves: 4, doors: 4, board: 'MFC 18 - Walnut', front: 'MFC 18 - Walnut' },
]

/* ---------------- geometry ---------------- */

export function area(o: Pt[]): number {
  let a = 0
  for (let i = 0; i < o.length; i++) {
    const p = o[i], q = o[(i + 1) % o.length]
    a += p.x * q.y - q.x * p.y
  }
  return Math.abs(a) / 2 / 1e6 // m²
}

/** Overlap area (m²) of two rooms; exact for axis-aligned rectangles, 0 for other outlines (not checked). */
export function roomOverlap(a: Pt[], b: Pt[]): number {
  const rect = (o: Pt[]) => o.length === 4 && o.every((p, i) => { const q = o[(i + 1) % 4]; return p.x === q.x || p.y === q.y })
  if (!rect(a) || !rect(b)) return 0
  const bb = (o: Pt[]) => ({ x0: Math.min(...o.map((p) => p.x)), x1: Math.max(...o.map((p) => p.x)), y0: Math.min(...o.map((p) => p.y)), y1: Math.max(...o.map((p) => p.y)) })
  const p = bb(a), q = bb(b)
  return (Math.max(0, Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0)) * Math.max(0, Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0))) / 1e6
}

export function perimeter(o: Pt[]): number {
  let l = 0
  for (let i = 0; i < o.length; i++) {
    const p = o[i], q = o[(i + 1) % o.length]
    l += Math.hypot(q.x - p.x, q.y - p.y)
  }
  return l / 1000 // m
}

export interface RoomQty {
  room: Room
  floor: number
  perimeter: number
  /** Gross wall area (perimeter × height); openings are not modelled yet. */
  wall: number
  ceiling: number
  skirting: number
}

export function roomQuantities(r: Room): RoomQty {
  const floor = area(r.outline)
  const per = perimeter(r.outline)
  return { room: r, floor, perimeter: per, wall: (per * r.ceilingHeight) / 1000, ceiling: r.ceilingFinish === '—' ? 0 : floor, skirting: per }
}

export const dimsLabel = (i: Pick<Item, 'w' | 'd' | 'h' | 'dia'>) => (i.dia ? `Ø${i.dia} × ${i.h}` : `${i.w} × ${i.d} × ${i.h}`)

/* ---------------- production cut list ---------------- */

/**
 * Carcass cut list for a frameless (European) cabinet: sides run full height, top/bottom sit between the
 * sides, a 6 mm back is grooved in, shelves are set back 20 mm, doors overlay with 3 mm gaps. Vertical
 * dividers are added every 1200 mm so the span stays within the board's sag limit.
 */
export function cutList(c: Cabinet): CutPart[] {
  const inner = c.w - 2 * c.t
  const dividers = Math.max(0, Math.ceil(c.w / 1200) - 1)
  const bays = dividers + 1
  const bayW = (inner - dividers * c.t) / bays
  const gap = 3
  const doorW = Math.round(c.w / c.doors - gap)
  const doorH = c.h - gap
  const parts: CutPart[] = [
    { cabinet: c.name, part: 'Side panel', qty: 2, l: c.h, wd: c.d, t: c.t, material: c.board, edge: c.h },
    { cabinet: c.name, part: 'Top / bottom', qty: 2, l: inner, wd: c.d, t: c.t, material: c.board, edge: inner },
    { cabinet: c.name, part: 'Back panel', qty: 1, l: c.w - 2 * c.t + 16, wd: c.h - 2 * c.t + 16, t: 6, material: 'HDF 6 - White', edge: 0 },
  ]
  if (dividers) parts.push({ cabinet: c.name, part: 'Divider', qty: dividers, l: c.h - 2 * c.t, wd: c.d - 6, t: c.t, material: c.board, edge: c.h - 2 * c.t })
  if (c.shelves) parts.push({ cabinet: c.name, part: 'Shelf', qty: c.shelves * bays, l: Math.round(bayW - 2), wd: c.d - 20 - 6, t: c.t, material: c.board, edge: Math.round(bayW - 2) })
  if (c.doors) parts.push({ cabinet: c.name, part: 'Door', qty: c.doors, l: doorH, wd: doorW, t: c.t, material: c.front, edge: 2 * (doorH + doorW) })
  return parts
}

export interface CutTotals {
  parts: number
  boardArea: number
  edge: number
  /** Full 2440 × 1220 sheets at an assumed 80 % yield — an estimate until nesting runs. */
  sheets: Record<string, number>
}

export function cutTotals(parts: CutPart[]): CutTotals {
  const byBoard: Record<string, number> = {}
  let boardArea = 0, edge = 0, n = 0
  for (const p of parts) {
    const a = (p.l * p.wd * p.qty) / 1e6
    boardArea += a
    edge += (p.edge * p.qty) / 1000
    n += p.qty
    byBoard[p.material] = (byBoard[p.material] ?? 0) + a
  }
  const sheets: Record<string, number> = {}
  for (const [m, a] of Object.entries(byBoard)) sheets[m] = Math.ceil(a / (2.44 * 1.22 * 0.8))
  return { parts: n, boardArea, edge, sheets }
}

/* ---------------- style presets (rule-based, not AI) ---------------- */

export interface StylePreset {
  key: 'modernLuxury' | 'japandi'
  image: string
  /** category → material */
  materials: Partial<Record<ItemCategory, string>>
  wallFinish: string
}

export const PRESETS: StylePreset[] = [
  { key: 'modernLuxury', image: T + 'sugg-modern-luxury.png', materials: { sofas: 'Fabric - Beige', tables: 'Marble - White', cabinet: 'Wood - Walnut', chairs: 'Fabric - Taupe', lighting: 'Metal - Brass' }, wallFinish: 'Paint - Warm White' },
  { key: 'japandi', image: T + 'sugg-japandi.png', materials: { sofas: 'Fabric - Linen', tables: 'Wood - Ash Light', cabinet: 'Wood - Oak', chairs: 'Fabric - Linen', lighting: 'Metal - Black' }, wallFinish: 'Paint - Warm White' },
]
