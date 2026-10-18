/**
 * 3D asset library (v2.4 interior render + user furniture library).
 *
 * The library lives on disk OUTSIDE the repo and the installer: `<app data>/library/` (host: LibraryStore) with a
 * `library.json` manifest. It holds furniture / decor MODELS (glTF / GLB), PBR MATERIALS (texture maps) and HDRIs,
 * downloaded on the user's explicit request (Poly Haven, CC0), imported from files the user downloaded elsewhere,
 * or composed in the app ("Tự vẽ": parametric parts). This module is pure logic + a small mirror of the host's
 * manifest (not persisted: the host's file is the source of truth):
 *   - manifest types and validation (anything malformed is dropped, never trusted);
 *   - interior item → library category, and the best library model for an item (explicit asset id, else category
 *     + closest size);
 *   - uniform size fitting (keep proportions, fit inside the item's W × D × H, base on the floor);
 *   - app material name → library PBR material.
 * A library model is presentation only: the item's W × D × H in the semantic model stays the truth for plans,
 * clearances, schedules, BOM and CNC; the model is scaled into that box for renders.
 */
import { create } from 'zustand'
import { MATERIALS, type Item, type ItemCategory } from '../interior/model'
import { STARTER_HDRIS, STARTER_MATERIALS } from './polyhaven'

export type AssetKind = 'model' | 'material' | 'hdri'
export type AssetOrigin = 'builtin-download' | 'user-import' | 'user-drawn' | 'builtin-preset'

/** Library categories of furniture / decor models (finer than the interior ItemCategory). */
export const LIB_CATEGORIES = [
  'sofa', 'armchair', 'chair', 'stool', 'coffeeTable', 'sideTable', 'diningTable', 'desk', 'bed', 'nightstand', 'wardrobe',
  'tvCabinet', 'sideboard', 'shelf', 'cabinet', 'kitchen', 'lamp', 'pendant', 'plant', 'rug', 'curtain', 'decor',
] as const
export type LibCategory = (typeof LIB_CATEGORIES)[number]

/** Interior item category a library category is placed as. */
export const ITEM_CATEGORY_OF: Record<LibCategory, ItemCategory> = {
  sofa: 'sofas', armchair: 'chairs', chair: 'chairs', stool: 'chairs', coffeeTable: 'tables', sideTable: 'tables', diningTable: 'tables', desk: 'tables',
  bed: 'beds', nightstand: 'tables', wardrobe: 'cabinet', tvCabinet: 'cabinet', sideboard: 'cabinet', shelf: 'cabinet', cabinet: 'cabinet', kitchen: 'cabinet',
  lamp: 'lighting', pendant: 'lighting', plant: 'decor', rug: 'rugs', curtain: 'decor', decor: 'decor',
}

export interface Dims {
  w: number
  d: number
  h: number
}

/** One part of a composed ("Tự vẽ") piece, item-local mm: origin = footprint centre at the bottom, front −Y. */
export interface ComposedPart {
  shape: 'box' | 'rbox' | 'cyl'
  /** Centre of the part's footprint (x, y) and its bottom (z). */
  x: number
  y: number
  z: number
  w: number
  d: number
  h: number
  /** Corner radius (rbox) — presentation only (renders bevel the edges). */
  r?: number
  /** App material name (interior MATERIALS). */
  material: string
  name?: string
}

export interface LibAsset {
  id: string
  kind: AssetKind
  name: string
  nameVi: string
  category?: LibCategory
  tags: string[]
  /** Real size (mm) from the model's bounding box (W along x, D along y = front-to-back, H up). */
  dims?: Dims
  /** Paths relative to the asset folder: main (glb / gltf / hdr), maps {diff, rough, nor, arm, disp, ao}. */
  files: { main?: string; maps?: Partial<Record<'diff' | 'rough' | 'nor' | 'arm' | 'disp' | 'ao' | 'metal', string>> }
  /** Folder relative to the library root ("models/sofa_02", "user/u-…"). */
  dir: string
  thumb?: string
  source: { site: string; url?: string; author?: string }
  license: string
  addedAt: number
  origin: AssetOrigin
  /** Materials: the app finishes this texture serves, its real-world size (mm) and whether to tint it with the finish colour. */
  appMaterials?: string[]
  sizeMm?: [number, number]
  tint?: boolean
  /** HDRIs: the lighting presets this sky serves. */
  lighting?: ('day' | 'golden' | 'night' | 'overcast' | 'studio')[]
  /** Composed pieces: their parts (rendered from primitives). */
  parts?: ComposedPart[]
  /** Default finish of a model placed into the plan (app material name). */
  material?: string
  /** Size on disk (bytes). */
  bytes?: number
  /** Model style hints for matching (modern / classic / vintage …). */
  style?: string[]
  /** Turn (degrees about Z) that brings the model's front to −Y (files modelled facing another way). */
  yaw?: number
}

export interface LibraryManifest {
  version: 1
  items: LibAsset[]
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
/** A relative path inside the library: no absolute path, no "..", no backslash tricks. */
export const safeRel = (p: unknown): string | undefined => {
  const s = str(p)
  if (!s || s.length > 300 || s.startsWith('/') || s.includes('\\') || /^[a-zA-Z]:/.test(s) || s.split('/').some((x) => x === '..' || x === '')) return undefined
  return s
}

function parsePart(p: unknown): ComposedPart | null {
  if (!p || typeof p !== 'object') return null
  const o = p as Record<string, unknown>
  const shape = o.shape === 'box' || o.shape === 'rbox' || o.shape === 'cyl' ? o.shape : null
  const vals = ['x', 'y', 'z', 'w', 'd', 'h'].map((k) => num(o[k]))
  if (!shape || vals.some((v) => v === undefined)) return null
  const [x, y, z, w, d, h] = vals as number[]
  if (!(w > 0 && d > 0 && h > 0 && w <= 10000 && d <= 10000 && h <= 6000 && z >= -10 && z <= 6000)) return null
  const material = str(o.material) ?? 'Wood - Oak'
  return { shape, x, y, z, w, d, h, ...(num(o.r) !== undefined ? { r: Math.max(0, Math.min(num(o.r)!, Math.min(w, d, h) / 2)) } : {}), material: MATERIALS.some((m) => m.name === material) ? material : 'Wood - Oak', ...(str(o.name) ? { name: str(o.name) } : {}) }
}

/** One manifest entry, validated (null = dropped). */
export function parseAsset(v: unknown): LibAsset | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const id = str(o.id)
  const kind = o.kind === 'model' || o.kind === 'material' || o.kind === 'hdri' ? o.kind : null
  const dir = safeRel(o.dir)
  if (!id || !/^[A-Za-z0-9_.-]{1,80}$/.test(id) || !kind || !dir) return null
  const files = (o.files && typeof o.files === 'object' ? o.files : {}) as Record<string, unknown>
  const main = files.main === undefined ? undefined : safeRel(files.main)
  if (files.main !== undefined && !main) return null
  const maps: LibAsset['files']['maps'] = {}
  for (const [k, p] of Object.entries((files.maps ?? {}) as Record<string, unknown>)) {
    if (!['diff', 'rough', 'nor', 'arm', 'disp', 'ao', 'metal'].includes(k)) continue
    const r = safeRel(p)
    if (r) maps[k as keyof typeof maps] = r
  }
  const d = o.dims as Record<string, unknown> | undefined
  const dims = d && num(d.w)! > 0 && num(d.d)! > 0 && num(d.h)! > 0 ? { w: num(d.w)!, d: num(d.d)!, h: num(d.h)! } : undefined
  const cat = LIB_CATEGORIES.includes(o.category as LibCategory) ? (o.category as LibCategory) : undefined
  const origin: AssetOrigin = (['builtin-download', 'user-import', 'user-drawn', 'builtin-preset'] as const).find((x) => x === o.origin) ?? 'user-import'
  const src = (o.source && typeof o.source === 'object' ? o.source : {}) as Record<string, unknown>
  const parts = Array.isArray(o.parts) ? o.parts.map(parsePart).filter((p): p is ComposedPart => !!p) : undefined
  if (kind === 'model' && !main && !parts?.length) return null
  if (kind !== 'model' && !main && !Object.keys(maps).length) return null
  const sz = Array.isArray(o.sizeMm) && num(o.sizeMm[0])! > 0 && num(o.sizeMm[1])! > 0 ? ([num(o.sizeMm[0])!, num(o.sizeMm[1])!] as [number, number]) : undefined
  return {
    id,
    kind,
    name: str(o.name) ?? id,
    nameVi: str(o.nameVi) ?? str(o.name) ?? id,
    ...(cat ? { category: cat } : {}),
    tags: Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === 'string').slice(0, 40) : [],
    ...(dims ? { dims } : {}),
    files: { ...(main ? { main } : {}), ...(Object.keys(maps).length ? { maps } : {}) },
    dir,
    ...(safeRel(o.thumb) ? { thumb: safeRel(o.thumb) } : {}),
    source: { site: str(src.site) ?? '', ...(str(src.url) ? { url: str(src.url) } : {}), ...(str(src.author) ? { author: str(src.author) } : {}) },
    license: str(o.license) ?? '',
    addedAt: num(o.addedAt) ?? 0,
    origin,
    ...(Array.isArray(o.appMaterials) ? { appMaterials: o.appMaterials.filter((t): t is string => typeof t === 'string') } : {}),
    ...(sz ? { sizeMm: sz } : {}),
    ...(typeof o.tint === 'boolean' ? { tint: o.tint } : {}),
    ...(Array.isArray(o.lighting) ? { lighting: o.lighting.filter((t): t is NonNullable<LibAsset['lighting']>[number] => ['day', 'golden', 'night', 'overcast', 'studio'].includes(t as string)) } : {}),
    ...(parts?.length ? { parts } : {}),
    ...(str(o.material) && MATERIALS.some((m) => m.name === o.material) ? { material: str(o.material) } : {}),
    ...(num(o.bytes) !== undefined ? { bytes: num(o.bytes) } : {}),
    ...(Array.isArray(o.style) ? { style: o.style.filter((t): t is string => typeof t === 'string') } : {}),
    ...(num(o.yaw) !== undefined && [0, 90, 180, 270, -90].includes(num(o.yaw)!) ? { yaw: num(o.yaw) } : {}),
  }
}

/** The manifest, validated: malformed entries and duplicate ids are dropped. */
export function parseManifest(v: unknown): LibraryManifest {
  const items: LibAsset[] = []
  const seen = new Set<string>()
  const list = v && typeof v === 'object' && Array.isArray((v as { items?: unknown }).items) ? (v as { items: unknown[] }).items : Array.isArray(v) ? v : []
  for (const x of list) {
    const a = parseAsset(x)
    if (a && !seen.has(a.id)) {
      seen.add(a.id)
      items.push(a)
    }
  }
  return { version: 1, items }
}

/* ------------------------------------------------------------------ item → library category */

const has = (s: string, ...w: string[]) => w.some((x) => s.includes(x))

/** Library categories an interior item can take, best first (its CAD furniture kind, else category + name + size). */
export function libCategoriesFor(i: Pick<Item, 'category' | 'name' | 'w' | 'd' | 'h' | 'dia' | 'cabinet'> & { kind?: string }): LibCategory[] {
  const n = (i.name ?? '').toLowerCase()
  const w = i.w ?? i.dia ?? 0, d = i.d ?? i.dia ?? 0
  switch (i.kind) {
    case 'sofa': return ['sofa']
    case 'bed': return ['bed']
    case 'wardrobe': return ['wardrobe', 'cabinet']
    case 'tvCabinet': return ['tvCabinet', 'sideboard']
    case 'kitchen': case 'island': return ['kitchen']
    case 'shoeCabinet': case 'cabinet': return ['cabinet', 'sideboard']
    case 'altar': return ['sideboard', 'cabinet']
    case 'shelf': return ['shelf']
    case 'dining': return ['diningTable']
    case 'desk': return ['desk', 'diningTable']
    case 'coffeeTable': return ['coffeeTable']
    case 'nightstand': return ['nightstand', 'sideTable']
    case 'table': return i.h < 600 ? ['coffeeTable', 'sideTable'] : ['diningTable', 'desk']
    case 'chair': return w >= 700 || has(n, 'arm', 'bành', 'lounge') ? ['armchair', 'chair'] : ['chair', 'armchair']
    case 'bench': return ['stool', 'chair']
    case 'plant': return ['plant']
    case 'rug': return ['rug']
    case 'light': return i.dia || has(n, 'pendant', 'thả') ? ['pendant', 'lamp'] : ['lamp', 'pendant']
  }
  switch (i.category) {
    case 'sofas': return ['sofa']
    case 'beds': return ['bed']
    case 'rugs': return ['rug']
    case 'chairs': return has(n, 'stool', 'đôn', 'bar') ? ['stool', 'chair'] : w >= 700 || has(n, 'arm', 'lounge', 'bành') ? ['armchair', 'chair'] : ['chair', 'armchair']
    case 'lighting': return i.dia || has(n, 'pendant', 'chandelier', 'thả') ? ['pendant', 'lamp'] : ['lamp', 'pendant']
    case 'decor': return has(n, 'plant', 'cây', 'chậu') ? ['plant'] : has(n, 'curtain', 'rèm') ? ['curtain'] : ['decor', 'plant']
    case 'tables':
      if (has(n, 'desk', 'bàn làm việc', 'bàn học')) return ['desk', 'diningTable']
      if (has(n, 'night', 'bedside', 'tab đầu giường')) return ['nightstand', 'sideTable']
      if (has(n, 'coffee', 'trà', 'sofa')) return ['coffeeTable', 'sideTable']
      if (has(n, 'dining', 'bàn ăn')) return ['diningTable']
      if (i.h < 500) return Math.max(w, d) < 700 ? ['sideTable', 'coffeeTable'] : ['coffeeTable', 'sideTable']
      if (i.h < 680 && Math.max(w, d) < 700) return ['nightstand', 'sideTable']
      return ['diningTable', 'desk']
    case 'cabinet':
      if (has(n, 'tv')) return ['tvCabinet', 'sideboard']
      if (has(n, 'kitchen', 'island', 'bếp', 'đảo')) return ['kitchen']
      if (has(n, 'wardrobe', 'tủ áo', 'quần áo')) return ['wardrobe', 'cabinet']
      if (has(n, 'shelf', 'book', 'kệ', 'giá sách')) return ['shelf']
      if (i.h >= 1800) return ['wardrobe', 'shelf', 'cabinet']
      if (i.h <= 900) return ['sideboard', 'tvCabinet', 'cabinet']
      return ['cabinet', 'shelf', 'sideboard']
  }
  return ['decor']
}

/* ------------------------------------------------------------------ size fitting */

/** Footprint of an item (round items: Ø × Ø). */
export const itemBox = (i: Pick<Item, 'w' | 'd' | 'h' | 'dia'>): Dims => ({ w: i.w ?? i.dia ?? 500, d: i.d ?? i.dia ?? 500, h: i.h })

/**
 * Uniform scale that fits a model of size `m` inside the box `b` (keeps proportions; the model touches the box on
 * its tightest axis) and how much of the box it fills (volume ratio, 0…1).
 */
export function fitScale(m: Dims, b: Dims): { s: number; fill: number; size: Dims } {
  if (!(m.w > 0 && m.d > 0 && m.h > 0 && b.w > 0 && b.d > 0 && b.h > 0)) return { s: 1, fill: 0, size: { ...m } }
  const s = Math.min(b.w / m.w, b.d / m.d, b.h / m.h)
  const size = { w: m.w * s, d: m.d * s, h: m.h * s }
  return { s, fill: (size.w * size.d * size.h) / (b.w * b.d * b.h), size }
}

/** Categories without a front: a model may be turned 90° when that fits the item's box better (a table drawn along y). */
export const FREE_TURN: LibCategory[] = ['coffeeTable', 'sideTable', 'diningTable', 'rug', 'plant', 'pendant', 'stool']

/** Size of a model turned by `yaw` (90° / 270° swap W and D). */
export const turnedDims = (d: Dims, yaw: number): Dims => (Math.abs(((yaw % 180) + 180) % 180) === 90 ? { w: d.d, d: d.w, h: d.h } : d)

/** How a model fits an item box: the turn (its own yaw, or +90° for front-less pieces when that fills more) and the scale. */
export function assetFit(a: LibAsset, box: Dims): { yaw: number; s: number; fill: number } {
  const dims = a.dims ?? (a.parts?.length ? composedDims(a.parts) : undefined)
  const base = a.yaw ?? 0
  if (!dims) return { yaw: base, s: 1, fill: 0 }
  const turns = a.category && FREE_TURN.includes(a.category) ? [base, base + 90] : [base]
  let best = { yaw: base, s: 1, fill: -1 }
  for (const y of turns) {
    const f = fitScale(turnedDims(dims, y), box)
    if (f.fill > best.fill + 1e-9) best = { yaw: y % 360, s: f.s, fill: f.fill }
  }
  return best
}

/** Library styles that read as modern / contemporary (the projects are modern villas and apartments). */
const MODERN = ['modern', 'contemporary', 'minimalist', 'minimal', 'scandi', 'mid-century', 'sleek', 'clean']
const DATED = ['gothic', 'victorian', 'antique', 'rustic', 'worn', 'old', 'rusty', 'aged', 'medieval', 'hospital']

/**
 * Score of a model for an item box: the fill of the fitted model, less a penalty when it must be scaled far from its
 * real size (a 1.5× chair looks wrong), plus a small style preference. Higher is better; < 0.15 = not a match.
 */
export function matchScore(a: LibAsset, box: Dims, want: LibCategory[]): number {
  if (a.kind !== 'model' || !a.category) return -1
  const rank = want.indexOf(a.category)
  if (rank < 0) return -1
  // built-in presets are rebuilt at the item's exact size: a fixed, modest score (a real model that fits well wins)
  if (a.origin === 'builtin-preset') return 0.45 - rank * 0.2
  if (!a.dims && !a.parts?.length) return -1
  const f = assetFit(a, box)
  let score = f.fill
  const dev = Math.abs(Math.log(f.s))
  score -= Math.max(0, dev - 0.15) * 0.9
  const style = [...(a.style ?? []), ...a.tags].map((t) => t.toLowerCase())
  if (style.some((t) => MODERN.includes(t))) score += 0.12
  if (style.some((t) => DATED.includes(t))) score -= 0.18
  if (a.origin === 'user-import' || a.origin === 'user-drawn') score += 0.05
  return score - rank * 0.2
}

/** The library model for an item: its explicit asset, else the best match of its categories (null = keep the parametric shape). */
export function matchAsset(i: Pick<Item, 'category' | 'name' | 'w' | 'd' | 'h' | 'dia' | 'cabinet'> & { kind?: string; asset?: string }, assets: LibAsset[]): LibAsset | null {
  if (i.asset) return assets.find((a) => a.id === i.asset && a.kind === 'model') ?? null
  // parametric cabinets are built panel by panel from their cut list: that IS the product, never swapped
  if (i.cabinet) return null
  const want = libCategoriesFor(i)
  const box = itemBox(i)
  let best: LibAsset | null = null, bs = 0.15
  for (const a of assets) {
    const s = matchScore(a, box, want)
    if (s > bs || (s === bs && best && a.id < best.id)) {
      bs = s
      best = a
    }
  }
  return best
}

/* ------------------------------------------------------------------ composed pieces */

/** Bounding size of composed parts (mm). */
export function composedDims(parts: ComposedPart[]): Dims {
  if (!parts.length) return { w: 0, d: 0, h: 0 }
  const x0 = Math.min(...parts.map((p) => p.x - p.w / 2)), x1 = Math.max(...parts.map((p) => p.x + p.w / 2))
  const y0 = Math.min(...parts.map((p) => p.y - p.d / 2)), y1 = Math.max(...parts.map((p) => p.y + p.d / 2))
  const z1 = Math.max(...parts.map((p) => p.z + p.h)), z0 = Math.min(0, ...parts.map((p) => p.z))
  return { w: Math.round(x1 - x0), d: Math.round(y1 - y0), h: Math.round(z1 - z0) }
}

/* ------------------------------------------------------------------ materials */

const KIND_TAGS: Record<string, string[]> = {
  fabric: ['fabric'], wood: ['wood'], stone: ['marble', 'stone'], metal: ['metal'], paint: ['plaster', 'paint'], tile: ['tile'], gypsum: ['plaster', 'paint'], board: ['wood'],
}

/**
 * The library PBR material of an app finish: one that names it (on floors, a floor texture — planks / tiles — first),
 * else one of its kind (null = plain colour).
 */
export function libMaterialFor(name: string, assets: LibAsset[], floor = false): LibAsset | null {
  // a built-in download follows the CURRENT curated mapping (polyhaven.ts), not the one it was downloaded with
  const mats = assets.filter((a) => a.kind === 'material').map((a) => {
    const s = a.origin === 'builtin-download' ? STARTER_MATERIALS.find((m) => m.id === a.id) : undefined
    return s ? { ...a, appMaterials: s.app, tint: !!s.tint, tags: s.floor ? [...new Set([...a.tags, 'floor'])] : a.tags.filter((t) => t !== 'floor') } : a
  })
  const isFloor = (a: LibAsset) => a.tags.includes('floor') && !!a.appMaterials?.length
  const named = mats.filter((a) => a.appMaterials?.includes(name))
  const pick = floor ? named.find(isFloor) ?? named[0] : named.find((a) => !isFloor(a)) ?? named[0]
  if (pick) return pick
  const kind = MATERIALS.find((m) => m.name === name)?.kind
  if (!kind) return null
  // tiles and stone stay procedural (porcelain grid / polished marble) unless a texture names the finish
  if (kind === 'tile' || kind === 'stone' || kind === 'metal') return null
  const tags = KIND_TAGS[kind] ?? []
  return mats.find((a) => a.tags.some((t) => tags.includes(t.toLowerCase()))) ?? null
}

/** HDRI for a lighting preset (null = the procedural sky); built-in downloads follow the current curated presets. */
export const hdriFor = (preset: string, assets: LibAsset[]) => {
  const light = (a: LibAsset) => (a.origin === 'builtin-download' ? STARTER_HDRIS.find((h) => h.id === a.id)?.lighting : undefined) ?? a.lighting ?? []
  return assets.find((a) => a.kind === 'hdri' && light(a).includes(preset as never)) ?? null
}

/* ------------------------------------------------------------------ the host mirror */

export interface LibraryProgress {
  phase?: 'plan' | 'download' | 'verify' | 'probe' | 'retry' | 'asset' | 'done'
  received?: number
  total?: number
  asset?: string
  assets?: number
  index?: number
  bytesPerSecond?: number
  done?: boolean
  ok?: boolean
  error?: string
  cancelled?: boolean
  added?: number
  failed?: string[]
}

interface AssetLibraryState {
  dir: string
  assets: LibAsset[]
  loaded: boolean
  bytes: number
  thumbs: Record<string, string>
  progress: LibraryProgress | null
  /** Blender found (needed to import 3D files). */
  blender?: boolean
  freeBytes?: number
  set: (p: Partial<Omit<AssetLibraryState, 'set'>>) => void
}

/** Mirror of the host's library.json (not persisted: the file on disk is the source of truth). */
export const useAssetLibrary = create<AssetLibraryState>()((set) => ({ dir: '', assets: [], loaded: false, bytes: 0, thumbs: {}, progress: null, set: (p) => set(p) }))
