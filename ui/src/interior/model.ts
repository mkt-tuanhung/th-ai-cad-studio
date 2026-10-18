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
  /** Doors in the room outline (Space Planning). `wall` = outline edge index (edge k runs outline[k] → outline[k+1]),
   *  `at` = distance (mm) from the edge start to the door's near jamb; width unknown = needs input, never guessed. */
  doors?: RoomDoor[]
}

export interface RoomDoor {
  id: string
  wall: number
  at: number
  width?: number
  /** Leaf swings into the room (default) or out of it / sliding (no swing zone inside). */
  swing?: 'in' | 'out' | 'sliding'
}

/** Where an item's / cabinet's dimensions come from. AI concepts and image traces are not real dimensions until
 *  someone measures them (reviewRequired) — such items cannot enter manufacturing (interior/production.ts). */
export interface DimSource {
  kind: 'drawn' | 'catalog' | 'survey' | 'imported' | 'image' | 'ai'
  confidence?: number
  reviewRequired?: boolean
}

/** A finish on one named part of a furniture item (body / front / top / legs / seat / …). */
export interface PartFinish {
  material: string
  /** Grain / texture direction in degrees from the part's length (0 = along the length). */
  grainDeg?: number
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
  /* ---- Space Planning (v2.4) — all optional, older projects load unchanged ---- */
  /** Library catalog key (LibComponent name) the item was placed from. */
  catalog?: string
  /** Height of the item's underside above the floor (mm): wall cabinets, shelves, sconces. */
  elev?: number
  /** Locked items cannot be moved, rotated, resized or replaced (and layout options keep them). */
  locked?: boolean
  /** Wall-hosted: the item keeps its back on this wall of its room (outline edge index). */
  host?: { wall: number }
  /** Items moved together. */
  group?: string
  /** Per-part finishes (part → material); parts without an entry use `material`. */
  parts?: Record<string, PartFinish>
  src?: DimSource
  /* ---- 3D asset library (v2.4) — optional, presentation only ---- */
  /** Furniture kind of the CAD block it was built from (sofa, bed, dining, coffeeTable …): finer than `category`. */
  kind?: string
  /** Library asset shown for this item in renders (library/assets.ts); unset = the best match by category and size. */
  asset?: string
  /** Renders: keep the library model's own materials (default) or show it in this item's finish. */
  assetFinish?: 'model' | 'item'
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
  /** Edge band thickness (mm); DEFAULT_EDGE_BAND when absent. */
  edgeBand?: number
  /** Dimension provenance (see DimSource); undefined = drawn / parametric in this app. */
  src?: DimSource
  /** Hinge / drawer slide / connector products and their placement (cam/hardware.ts); undefined = the generic hinge cups. */
  hardware?: CabinetHardware
}

/**
 * Hardware chosen for a cabinet (ids of cam/library hardware items) and the placement decisions that belong to
 * the design, not to the product: hinge boring distance and end distance, hinge count, slide length and the
 * heights of the slide hole lines. Missing product data or placement → CNC drilling is blocked ("needs data").
 */
export interface CabinetHardware {
  hinge?: string | null
  /** Door edge → cup edge (mm), within the product's range. */
  boringDistance?: number | null
  /** Door end → first / last cup centre (mm). */
  hingeEndDistance?: number | null
  /** Hinges per door (null = 2 / 3 / 4 / 5 by door height ≤ 900 / 1600 / 2000 / more). */
  hingeCount?: number | null
  /** Drill the hinge fixing holes (press-in / INSERTA dowels) when the product documents them. */
  hingeFixings?: boolean
  slide?: string | null
  /** Nominal slide length (mm); null = the longest that fits the carcass depth. */
  slideLength?: number | null
  /** Heights of the slide hole lines from the bottom of the side panel (mm), one per drawer. */
  slideRows?: number[]
  connector?: string | null
  /**
   * Values entered for a product field the catalogue does not state (from the manufacturer's drilling template or
   * measured), or a choice among the catalogue's options: product id → field → value (positions as a list).
   */
  overrides?: Record<string, Record<string, number | number[]>>
}

export type EdgeSide = 'L1' | 'L2' | 'W1' | 'W2'

/** A groove / rebate on face A of a part, parallel to an edge (part-local, finished size). */
export interface PartGroove {
  kind: 'groove'
  /** Edge the groove runs along (L2 = the back edge of sides / top / bottom). */
  edge: 'L2'
  /** Distance of the groove's near side from that edge (0 = a rebate open on the edge), mm. */
  setback: number
  width: number
  depth: number
  purpose: 'back'
}

export interface CutPart {
  cabinet: string
  part: string
  qty: number
  /** Finished length × width (mm), grain along length. Kept for compatibility: same as `finished`. */
  l: number
  wd: number
  t: number
  material: string
  /** Edge banding on this part (mm per piece). */
  edge: number
  /** Stable part id (cabinet id + part code) and content revision (changes whenever the part changes). */
  id: string
  rev: string
  /** Grain along the part length (L), across it (W) or none (plain boards). */
  grain: 'L' | 'W' | 'NONE'
  /** Face A = the face machined (up on the CNC table): the cabinet inside for carcass parts and doors. */
  faceA: 'inside' | 'outside'
  /**
   * Edge band thickness per side (mm, 0 = not banded). Part-local frame: x along the length, y across the
   * width; L1 is the edge at y = 0 (front edge / hinge side), L2 at y = width, W1 at x = 0, W2 at x = length.
   */
  edges: Record<EdgeSide, number>
  /** Finished size (after edge banding) and the cut blank size (finished − band thickness per banded side). */
  finished: { l: number; w: number }
  cut: { l: number; w: number }
  grooves?: PartGroove[]
}

/** Default edge band thickness (PVC / ABS, mm) used until the job confirms the measured band. */
export const DEFAULT_EDGE_BAND = 1

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
 * sides, a 6 mm back sits in a 6.5 × 8 mm rebate along the back edge (L2) of the sides and top / bottom (the
 * back is inner + 2 × 8 mm each way; shelves, 20 mm behind the front and 26 mm shallower than the carcass, end
 * against it), doors overlay with 3 mm gaps. Vertical dividers are added every 1200 mm so the span stays within
 * the board's sag limit.
 *
 * Sizes: `l` × `wd` (= `finished`) are the finished sizes; `cut` is the blank cut on the CNC = finished minus the
 * band thickness on each banded side (front edge L1 of carcass parts and shelves; all four sides of doors).
 */
export function cutList(c: Cabinet): CutPart[] {
  const inner = c.w - 2 * c.t
  const dividers = Math.max(0, Math.ceil(c.w / 1200) - 1)
  const bays = dividers + 1
  const bayW = (inner - dividers * c.t) / bays
  const gap = 3
  const doorW = Math.round(c.w / c.doors - gap)
  const doorH = c.h - gap
  const b = c.edgeBand ?? DEFAULT_EDGE_BAND
  const backT = 6
  const back: PartGroove = { kind: 'groove', edge: 'L2', setback: 0, width: backT + 0.5, depth: 8, purpose: 'back' }
  const front = { L1: b, L2: 0, W1: 0, W2: 0 }
  const none = { L1: 0, L2: 0, W1: 0, W2: 0 }
  const all4 = { L1: b, L2: b, W1: b, W2: b }
  type Def = Omit<CutPart, 'id' | 'rev' | 'finished' | 'cut' | 'cabinet' | 'grain'> & { code: string; grain?: CutPart['grain'] }
  const defs: Def[] = [
    { code: 'SIDE', part: 'Side panel', qty: 2, l: c.h, wd: c.d, t: c.t, material: c.board, edge: c.h, faceA: 'inside', edges: front, grooves: [back] },
    { code: 'TB', part: 'Top / bottom', qty: 2, l: inner, wd: c.d, t: c.t, material: c.board, edge: inner, faceA: 'inside', edges: front, grooves: [back] },
    { code: 'BACK', part: 'Back panel', qty: 1, l: c.w - 2 * c.t + 16, wd: c.h - 2 * c.t + 16, t: backT, material: 'HDF 6 - White', edge: 0, faceA: 'inside', edges: none, grain: 'NONE' },
  ]
  if (dividers) defs.push({ code: 'DIV', part: 'Divider', qty: dividers, l: c.h - 2 * c.t, wd: c.d - 6, t: c.t, material: c.board, edge: c.h - 2 * c.t, faceA: 'inside', edges: front })
  if (c.shelves) defs.push({ code: 'SHELF', part: 'Shelf', qty: c.shelves * bays, l: Math.round(bayW - 2), wd: c.d - 20 - 6, t: c.t, material: c.board, edge: Math.round(bayW - 2), faceA: 'inside', edges: front })
  if (c.doors) defs.push({ code: 'DOOR', part: 'Door', qty: c.doors, l: doorH, wd: doorW, t: c.t, material: c.front, edge: 2 * (doorH + doorW), faceA: 'inside', edges: all4 })
  return defs.map(({ code, grain, ...d }) => {
    const finished = { l: d.l, w: d.wd }
    const cut = { l: +(d.l - d.edges.W1 - d.edges.W2).toFixed(2), w: +(d.wd - d.edges.L1 - d.edges.L2).toFixed(2) }
    const p = { ...d, cabinet: c.name, grain: grain ?? ('L' as const), finished, cut }
    return { ...p, id: `${c.id}.${code}`, rev: partRev(p) }
  })
}

/** Short content revision of a part (FNV-1a of its definition): changes when size, board, banding or ops change. */
function partRev(p: object): string {
  const s = JSON.stringify(p)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0')
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
