/**
 * Interior furniture library (SP23) — the Components library (library/catalog.ts BUILTIN) seen from Space
 * Planning: every interior product with real W × D × H in mm, mapped to an interior item category, with style
 * tags, parametric resize limits and wall hosting.
 *
 * ORIGIN CONVENTION (one for the whole interior model, tested in tools/unit/spaceplan.test.ts):
 *   an item's placement point is the CENTRE of its W × D footprint at the BOTTOM of the item (z = elev);
 *   before rotation the front faces −Y and the back +Y; rotation is degrees counter-clockwise about +Z.
 * So a 480 × 520 × 900 chair placed at (x, y) with rot 0 occupies [x ± 240] × [y ± 260] × [elev, elev + 900].
 * Parametric cabinets keep the same frame: the carcass is W × D, doors overlay `t` mm in front of it.
 */
import { BUILTIN, type LibComponent } from '../library/catalog'
import type { Cabinet, Item, ItemCategory } from './model'

export type Style = NonNullable<LibComponent['style']>[number]
export const STYLES: Style[] = ['modern', 'classic', 'scandi', 'industrial', 'minimal']

export interface SpaceAsset {
  /** Stable key = library component name (ids are sequence numbers). */
  key: string
  libId: string
  name: string
  cat: ItemCategory
  styles: Style[]
  w: number
  d: number
  h: number
  /** Round products (pendants, downlights): Ø = w. */
  round: boolean
  /** Resize limits; fixed-size products have [v, v]. */
  limits: { w: [number, number]; d: [number, number]; h: [number, number] }
  parametric: boolean
  hosted?: 'wall'
  elev: number
  /** Becomes a parametric cabinet with a production cut list. */
  cabinet: boolean
  /** Counts as storage (layout scoring). */
  storage: boolean
  price?: number
  material: string
}

const has = (n: string, ...w: string[]) => w.some((x) => n.toLowerCase().includes(x))

/** Interior item category of a library product (null = not furniture: doors, columns, fixtures, symbols). */
function categoryOf(c: LibComponent): ItemCategory | null {
  const n = c.name
  if (c.group === 'materials' || c.group === 'mechanical' || c.group === 'mep') return null
  if (c.category === 'lighting') return has(n, 'sconce') ? null : 'lighting'
  if (c.category === 'site') return has(n, 'potted plant') ? 'decor' : null
  if (c.discipline !== 'Interior') return null
  if (has(n, 'rug')) return 'rugs'
  if (has(n, 'sofa')) return 'sofas'
  if (has(n, 'chair', 'armchair')) return 'chairs'
  if (has(n, 'bed') && !has(n, 'bedside')) return 'beds'
  if (has(n, 'table', 'desk')) return 'tables'
  if (has(n, 'cabinet', 'wardrobe', 'shelf', 'bookshelf', 'tv unit', 'vanity', 'island', 'nightstand', 'refrigerator')) return 'cabinet'
  return 'decor'
}

const CAB_MAT = 'Wood - Oak'
const DEFAULT_MAT: Record<ItemCategory, string> = { sofas: 'Fabric - Beige', tables: 'Wood - Oak', cabinet: CAB_MAT, chairs: 'Fabric - Taupe', lighting: 'Metal - Brass', beds: 'Fabric - Linen', decor: 'Wood - Ash Light', rugs: 'Fabric - Linen' }

/** Style tags for older library entries (new entries carry their own). */
function stylesOf(c: LibComponent): Style[] {
  if (c.style) return c.style
  const n = c.name.toLowerCase()
  if (n.includes('modern')) return ['modern']
  if (n.includes('office') || n.includes('meeting')) return ['modern', 'industrial']
  if (n.includes('bed') || n.includes('wardrobe')) return ['modern', 'scandi', 'minimal']
  return ['modern', 'minimal']
}

let cache: SpaceAsset[] | null = null

/** All placeable interior products, in library order. */
export function spaceCatalog(): SpaceAsset[] {
  if (cache) return cache
  const out: SpaceAsset[] = []
  for (const c of BUILTIN) {
    const cat = categoryOf(c)
    const s = c.size
    if (!cat || !s || !s.h) continue // only products with real W × D × H
    const round = /Ø/.test(c.sizeLabel ?? '') && cat === 'lighting'
    const wall = c.hosted ?? (has(c.name, 'wall cabinet') ? 'wall' : undefined)
    const fixed = (v: number): [number, number] => [v, v]
    const parametric = !!c.limits
    out.push({
      key: c.name,
      libId: c.id,
      name: c.name,
      cat,
      styles: stylesOf(c),
      w: s.w,
      d: s.d,
      h: s.h,
      round,
      limits: { w: c.limits?.w ?? fixed(s.w), d: c.limits?.d ?? fixed(s.d), h: c.limits?.h ?? fixed(s.h) },
      parametric,
      hosted: wall,
      elev: c.elev ?? (wall && has(c.name, 'wall cabinet') ? 1450 : 0),
      // kitchen / storage / bath modules become parametric cabinets (cut list), except appliances and the island (D > 900)
      cabinet: c.group === 'interior' && c.kind === 'Module' && s.d >= 250 && s.d <= 900 && s.w >= 300 && s.h >= 300,
      storage: cat === 'cabinet',
      price: c.price,
      material: cat === 'cabinet' ? CAB_MAT : DEFAULT_MAT[cat],
    })
  }
  cache = out
  return out
}

export const assetByKey = (key: string | undefined) => (key ? spaceCatalog().find((a) => a.key === key) : undefined)

/** Search by words in the name / category / style, then filter by category and style. */
export function searchCatalog(q: string, cat: ItemCategory | 'all' = 'all', style: Style | 'all' = 'all'): SpaceAsset[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  return spaceCatalog().filter((a) => (cat === 'all' || a.cat === cat) && (style === 'all' || a.styles.includes(style)) && words.every((w) => `${a.name} ${a.cat} ${a.styles.join(' ')} ${a.w}x${a.d}x${a.h}`.toLowerCase().includes(w)))
}

/** Limits that apply to an item: its catalog product's, else the model's general bounds (older items). */
export function limitsOf(i: Pick<Item, 'catalog'>) {
  const a = assetByKey(i.catalog)
  return a?.limits ?? { w: [100, 8000] as [number, number], d: [100, 8000] as [number, number], h: [5, 3000] as [number, number] }
}

let seq = 0
export const newId = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`

/** Doors of a parametric cabinet: as few leaves as keep each ≤ 600 mm and ≥ 250 mm. */
export const doorsFor = (w: number) => Math.max(1, Math.min(12, Math.ceil(w / 600)))

/** A new item (and its parametric cabinet) from a catalog product, placed at one point. */
export function itemFromAsset(a: SpaceAsset, room: string, at: { x: number; y: number; rot: number }, ids: { item?: string; cabinet?: string } = {}): { item: Item; cabinet?: Cabinet } {
  const id = ids.item ?? newId('i')
  const base: Item = {
    id,
    name: a.name,
    category: a.cat,
    room,
    ...(a.round ? { dia: a.w } : { w: a.w, d: a.d }),
    h: a.h,
    material: a.material,
    qty: 1,
    status: 'planned',
    catalog: a.key,
    at: [at],
    src: { kind: 'catalog' },
    ...(a.elev ? { elev: a.elev } : {}),
  }
  if (!a.cabinet) return { item: base }
  const cid = ids.cabinet ?? newId('c')
  const cabinet: Cabinet = { id: cid, name: a.name, room, w: a.w, d: a.d, h: a.h, t: 18, shelves: a.h > 1500 ? 4 : a.h > 600 ? 1 : 0, doors: doorsFor(a.w), board: 'MFC 18 - Oak', front: 'MFC 18 - Oak', src: { kind: 'catalog' } }
  return { item: { ...base, cabinet: cid }, cabinet }
}
