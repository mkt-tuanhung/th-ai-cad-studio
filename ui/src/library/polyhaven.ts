/**
 * Poly Haven (https://polyhaven.com, every asset CC0) → the app's asset library: the curated starter set and the
 * download plan of any asset from the public API (api.polyhaven.com: /assets?t=…, /files/<id>).
 *
 * Network is used ONLY when the user presses a download / search button (the host fetches allow-listed Poly Haven
 * URLs; the page itself never goes online). This module is pure: it turns the API's JSON into the list of files the
 * host downloads and verifies (size + md5 from the API) and the manifest entry it then writes.
 */
import type { LibAsset, LibCategory } from './assets'

export const PH_API = 'https://api.polyhaven.com'
/** Hosts the library downloader may fetch from (the host checks the same list). */
export const PH_HOSTS = ['api.polyhaven.com', 'dl.polyhaven.org', 'cdn.polyhaven.com']
export const PH_LICENSE = 'CC0 1.0 (Poly Haven)'

export interface StarterModel {
  id: string
  category: LibCategory
  vi: string
  style?: string[]
  material?: string
  /** The file faces another way than −Y (checked on an orientation line-up render). */
  yaw?: number
}
export interface StarterMaterial {
  id: string
  vi: string
  /** App finishes this texture serves (interior MATERIALS names). */
  app: string[]
  /** Tint with the finish colour (neutral fabrics / plaster) instead of keeping the photo colour. */
  tint?: boolean
  /** Use on floors (planks / tiles) rather than furniture surfaces. */
  floor?: boolean
}
export interface StarterHdri {
  id: string
  vi: string
  lighting: NonNullable<LibAsset['lighting']>
}

/** Furniture / decor models covering the interior categories (modern pieces first where Poly Haven has them). */
export const STARTER_MODELS: StarterModel[] = [
  { id: 'sofa_02', category: 'sofa', vi: 'Sofa văng hiện đại', style: ['modern'] },
  { id: 'Sofa_01', category: 'sofa', vi: 'Sofa 2 chỗ', style: ['modern'] },
  { id: 'sofa_03', category: 'sofa', vi: 'Sofa da cổ điển', style: ['classic'] },
  { id: 'modern_arm_chair_01', category: 'armchair', vi: 'Ghế bành hiện đại', style: ['modern'] },
  { id: 'mid_century_lounge_chair', category: 'armchair', vi: 'Ghế thư giãn mid-century', style: ['modern'] },
  { id: 'GreenChair_01', category: 'armchair', vi: 'Ghế bành nỉ xanh' },
  { id: 'Ottoman_01', category: 'stool', vi: 'Đôn ottoman' },
  { id: 'dining_chair_02', category: 'chair', vi: 'Ghế ăn bọc da', style: ['modern'] },
  { id: 'painted_wooden_chair_01', category: 'chair', vi: 'Ghế gỗ sơn' },
  { id: 'gallinera_chair', category: 'chair', vi: 'Ghế mây Gallinera' },
  { id: 'bar_chair_round_01', category: 'stool', vi: 'Ghế bar tròn', style: ['modern'] },
  { id: 'wooden_stool_01', category: 'stool', vi: 'Ghế đẩu gỗ' },
  { id: 'metal_stool_02', category: 'stool', vi: 'Ghế đẩu khung kim loại' },
  { id: 'modern_coffee_table_01', category: 'coffeeTable', vi: 'Bàn trà chữ nhật hiện đại', style: ['modern'] },
  { id: 'modern_coffee_table_02', category: 'coffeeTable', vi: 'Bàn trà vuông hiện đại', style: ['modern'] },
  { id: 'coffee_table_round_01', category: 'coffeeTable', vi: 'Bàn trà tròn mặt đá', style: ['modern'] },
  { id: 'CoffeeTable_01', category: 'coffeeTable', vi: 'Bàn trà gỗ' },
  { id: 'WoodenTable_01', category: 'coffeeTable', vi: 'Bàn trà gỗ dài' },
  { id: 'side_table_01', category: 'sideTable', vi: 'Bàn phụ gỗ', style: ['modern'] },
  { id: 'side_table_tall_01', category: 'sideTable', vi: 'Bàn phụ cao' },
  { id: 'WoodenTable_02', category: 'sideTable', vi: 'Bàn góc tròn' },
  { id: 'small_wooden_table_01', category: 'sideTable', vi: 'Bàn console nhỏ' },
  { id: 'ClassicNightstand_01', category: 'nightstand', vi: 'Tab đầu giường' },
  { id: 'dining_table', category: 'diningTable', vi: 'Bàn ăn gỗ' },
  { id: 'round_wooden_table_02', category: 'diningTable', vi: 'Bàn ăn tròn nhỏ' },
  { id: 'wooden_table_02', category: 'diningTable', vi: 'Bàn gỗ 4 chỗ' },
  { id: 'metal_office_desk', category: 'desk', vi: 'Bàn làm việc' },
  { id: 'GothicBed_01', category: 'bed', vi: 'Giường gỗ cổ điển', style: ['classic'] },
  { id: 'modern_wooden_cabinet', category: 'tvCabinet', vi: 'Kệ tivi gỗ hiện đại', style: ['modern'] },
  { id: 'WoodenTable_03', category: 'sideboard', vi: 'Tủ console / sideboard' },
  { id: 'drawer_cabinet', category: 'cabinet', vi: 'Tủ ngăn kéo', style: ['modern'] },
  { id: 'painted_wooden_cabinet', category: 'cabinet', vi: 'Tủ gỗ sơn' },
  { id: 'Shelf_01', category: 'shelf', vi: 'Kệ gỗ treo', style: ['modern'] },
  { id: 'steel_frame_shelves_01', category: 'shelf', vi: 'Kệ sách khung thép', style: ['modern'] },
  { id: 'steel_frame_shelves_02', category: 'shelf', vi: 'Kệ sách khung thép hẹp', style: ['modern'] },
  { id: 'steel_frame_shelves_03', category: 'shelf', vi: 'Kệ trang trí lớn', style: ['modern'] },
  { id: 'wooden_display_shelves_01', category: 'shelf', vi: 'Kệ trưng bày gỗ', style: ['modern'], yaw: 90 },
  { id: 'modern_ceiling_lamp_01', category: 'pendant', vi: 'Đèn thả kính hiện đại', style: ['modern'] },
  { id: 'hanging_industrial_lamp', category: 'pendant', vi: 'Đèn thả công nghiệp' },
  { id: 'Chandelier_01', category: 'pendant', vi: 'Đèn chùm', style: ['classic'] },
  { id: 'desk_lamp_arm_01', category: 'lamp', vi: 'Đèn bàn tay gập', yaw: 90 },
  { id: 'industrial_pipe_lamp', category: 'lamp', vi: 'Đèn bàn ống' },
  { id: 'potted_plant_01', category: 'plant', vi: 'Chậu cây lớn' },
  { id: 'potted_plant_02', category: 'plant', vi: 'Chậu cây vừa' },
  { id: 'potted_plant_04', category: 'plant', vi: 'Chậu sen đá nhỏ' },
  { id: 'throw_pillows_01', category: 'decor', vi: 'Gối tựa trang trí' },
  { id: 'ceramic_vase_01', category: 'decor', vi: 'Bình gốm cao', style: ['modern'] },
  { id: 'ceramic_vase_02', category: 'decor', vi: 'Bình gốm tròn', style: ['modern'] },
  { id: 'ceramic_vase_03', category: 'decor', vi: 'Bình gốm thon', style: ['modern'] },
  { id: 'ceramic_vase_04', category: 'decor', vi: 'Bình gốm vẽ', style: ['modern'] },
  { id: 'wooden_bowl_01', category: 'decor', vi: 'Bát gỗ' },
  { id: 'wicker_basket_02', category: 'decor', vi: 'Giỏ mây' },
  { id: 'decorative_book_set_01', category: 'decor', vi: 'Bộ sách trang trí' },
  { id: 'book_encyclopedia_set_01', category: 'decor', vi: 'Bộ sách bách khoa' },
  { id: 'hanging_picture_frame_01', category: 'decor', vi: 'Khung tranh treo tường', style: ['modern'] },
  { id: 'standing_picture_frame_01', category: 'decor', vi: 'Khung ảnh để bàn', style: ['modern'], yaw: 90 },
  { id: 'wall_clock', category: 'decor', vi: 'Đồng hồ treo tường', style: ['modern'] },
  { id: 'jug_01', category: 'decor', vi: 'Bình sứ' },
  { id: 'wooden_cutting_board', category: 'decor', vi: 'Thớt gỗ' },
]

/** PBR materials for the app's finishes (wood, fabric, leather, stone, tile, plaster, concrete, metal). */
export const STARTER_MATERIALS: StarterMaterial[] = [
  { id: 'oak_veneer_01', vi: 'Gỗ sồi (veneer)', app: ['Wood - Oak', 'MFC 18 - Oak'] },
  { id: 'wood_floor', vi: 'Sàn gỗ sồi', app: ['Wood - Oak'], floor: true },
  { id: 'laminate_floor_02', vi: 'Sàn gỗ công nghiệp', app: ['Wood - Ash Light'], floor: true },
  { id: 'walnut_veneer', vi: 'Gỗ óc chó (veneer)', app: ['Wood - Walnut', 'MFC 18 - Walnut'] },
  { id: 'black_walnut_veneer_02', vi: 'Gỗ óc chó đen', app: [] },
  { id: 'rectangular_parquet', vi: 'Sàn gỗ parquet', app: ['Wood - Walnut'], floor: true },
  { id: 'herringbone_parquet', vi: 'Sàn gỗ xương cá', app: ['Parquet - Herringbone Oak'], floor: true },
  { id: 'ash_veneer', vi: 'Gỗ tần bì sáng', app: ['Wood - Ash Light'] },
  { id: 'white_oak_veneer', vi: 'Gỗ sồi trắng', app: ['Wood - White Oak'] },
  { id: 'kitchen_wood', vi: 'Gỗ thông phủ bóng', app: [] },
  { id: 'dark_wood', vi: 'Gỗ tối màu', app: ['Wood - Dark Stained'] },
  { id: 'terlenka', vi: 'Vải dệt màu be', app: ['Fabric - Beige'], tint: true },
  { id: 'cotton_jersey', vi: 'Vải cotton', app: ['Fabric - Grey'], tint: true },
  { id: 'poly_wool_herringbone', vi: 'Vải len xương cá', app: ['Fabric - Taupe'], tint: true },
  { id: 'rough_linen', vi: 'Vải lanh', app: ['Fabric - Linen'], tint: true },
  { id: 'ribbed_corduroy', vi: 'Vải nhung gân', app: ['Fabric - Olive'], tint: true },
  { id: 'wool_boucle', vi: 'Vải bouclé', app: ['Fabric - Bouclé White'], tint: true },
  { id: 'velour_velvet', vi: 'Vải nhung', app: ['Fabric - Blue'], tint: true },
  { id: 'brown_leather', vi: 'Da nâu', app: ['Leather - Cognac'] },
  { id: 'leather_white', vi: 'Da trắng', app: ['Leather - White'] },
  { id: 'marble_01', vi: 'Đá ốp lát be', app: ['Marble - Beige'] },
  { id: 'terrazzo_tiles', vi: 'Gạch terrazzo', app: ['Terrazzo'] },
  { id: 'floor_tiles_08', vi: 'Gạch men nâu mộc', app: ['Tile - Terracotta'], floor: true },
  { id: 'tiled_floor_001', vi: 'Gạch lát khổ lớn', app: ['Tile - Large Grey'], floor: true },
  { id: 'interior_tiles', vi: 'Gạch lát nội thất', app: [], floor: true },
  { id: 'granite_tile', vi: 'Gạch granite', app: ['Granite - Dark'], floor: true },
  { id: 'white_plaster_02', vi: 'Tường vữa trắng', app: ['Plaster - White'], tint: true },
  { id: 'white_stucco', vi: 'Tường vữa gai trắng', app: [], tint: true },
  { id: 'beige_wall_001', vi: 'Tường sơn be', app: [], tint: true },
  { id: 'ceiling_interior', vi: 'Trần sơn', app: [], tint: true },
  { id: 'plaster_grey_04', vi: 'Vữa xám', app: [] },
  { id: 'rough_concrete', vi: 'Bê tông thô', app: ['Concrete - Grey'] },
  { id: 'metal_plate', vi: 'Kim loại tấm', app: [] },
  { id: 'metal_plate_02', vi: 'Thép xước', app: ['Metal - Chrome'] },
]

export const STARTER_HDRIS: StarterHdri[] = [
  { id: 'studio_garden', vi: 'Ban ngày – sân vườn', lighting: ['day'] },
  { id: 'buikslotermeerplein', vi: 'Trời nhiều mây – khu phố', lighting: ['overcast', 'studio'] },
  { id: 'venice_sunset', vi: 'Hoàng hôn', lighting: ['golden'] },
  { id: 'shanghai_bund', vi: 'Ban đêm – thành phố', lighting: ['night'] },
]

/* ------------------------------------------------------------------ download plan */

export interface PlanFile {
  url: string
  /** Path inside the library, e.g. "models/sofa_02/sofa_02_2k.gltf". */
  path: string
  size: number
  md5?: string
}
export interface PlanAsset {
  id: string
  files: PlanFile[]
  entry: LibAsset
}

type FileRef = { url: string; size: number; md5?: string; include?: Record<string, { url: string; size: number; md5?: string }> }
type FilesJson = Record<string, Record<string, Record<string, FileRef>>>
export interface PhInfo {
  name?: string
  tags?: string[]
  authors?: Record<string, string>
  dimensions?: number[]
  categories?: string[]
  type?: number
}

const isPh = (u: string) => {
  try {
    const x = new URL(u)
    return x.protocol === 'https:' && PH_HOSTS.includes(x.hostname)
  } catch {
    return false
  }
}
/** File name of a URL path, safe for the library. */
const leaf = (p: string) => p.split('/').pop()!.replace(/[^A-Za-z0-9_.-]/g, '_')
/** A relative include path ("textures/x.jpg"), kept only when it is a plain relative path. */
const relOk = (p: string) => /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/.test(p) && !p.split('/').includes('..')

const pickRes = (byRes: Record<string, unknown> | undefined, want: string[]) => (byRes ? want.find((r) => byRes[r]) : undefined)

const authorOf = (info: PhInfo) => Object.keys(info.authors ?? {}).join(', ')

/** Model: the glTF (+ its .bin and textures) at 2k (else 1k), thumbnail from the CDN. */
export function planModel(id: string, files: FilesJson, info: PhInfo, s: StarterModel | null, now = Date.now()): PlanAsset | null {
  const g = files.gltf
  const res = pickRes(g, ['2k', '1k', '4k'])
  const ref = res ? g[res]?.gltf : undefined
  if (!ref || !isPh(ref.url)) return null
  const dir = `models/${id}`
  const main = leaf(new URL(ref.url).pathname)
  const out: PlanFile[] = [{ url: ref.url, path: `${dir}/${main}`, size: ref.size, md5: ref.md5 }]
  for (const [rel, f] of Object.entries(ref.include ?? {})) {
    if (!relOk(rel) || !isPh(f.url)) return null
    out.push({ url: f.url, path: `${dir}/${rel}`, size: f.size, md5: f.md5 })
  }
  out.push({ url: `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=256&height=256`, path: `${dir}/thumb.png`, size: 0 })
  const dm = info.dimensions
  const dims = dm && dm.length >= 3 && dm.every((v) => v > 0) ? { w: Math.round(dm[0]), d: Math.round(dm[1]), h: Math.round(dm[2]) } : undefined
  return {
    id,
    files: out,
    entry: {
      id, kind: 'model', name: info.name ?? id, nameVi: s?.vi ?? info.name ?? id, ...(s?.category ? { category: s.category } : {}), tags: info.tags ?? [],
      ...(dims ? { dims } : {}), files: { main }, dir, thumb: 'thumb.png',
      source: { site: 'Poly Haven', url: `https://polyhaven.com/a/${id}`, author: authorOf(info) }, license: PH_LICENSE, addedAt: now, origin: 'builtin-download',
      ...(s?.style ? { style: s.style } : {}), ...(s?.material ? { material: s.material } : {}), ...(s?.yaw ? { yaw: s.yaw } : {}),
    },
  }
}

const MAP_KEYS: [string, 'diff' | 'rough' | 'nor' | 'arm' | 'disp' | 'ao' | 'metal'][] = [['Diffuse', 'diff'], ['Rough', 'rough'], ['nor_gl', 'nor'], ['arm', 'arm'], ['Displacement', 'disp'], ['AO', 'ao'], ['Metal', 'metal']]

/** Material: diffuse, roughness, normal (GL), ARM, displacement maps as JPG at 2k (else 1k). */
export function planMaterial(id: string, files: FilesJson, info: PhInfo, s: StarterMaterial | null, now = Date.now()): PlanAsset | null {
  const dir = `materials/${id}`
  const out: PlanFile[] = []
  const maps: NonNullable<LibAsset['files']['maps']> = {}
  for (const [k, key] of MAP_KEYS) {
    const byRes = files[k]
    const res = pickRes(byRes, ['2k', '1k'])
    const f = res ? byRes[res]?.jpg ?? byRes[res]?.png : undefined
    if (!f || !isPh(f.url)) continue
    const name = leaf(new URL(f.url).pathname)
    out.push({ url: f.url, path: `${dir}/${name}`, size: f.size, md5: f.md5 })
    maps[key] = name
  }
  if (!maps.diff) return null
  out.push({ url: `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=256&height=256`, path: `${dir}/thumb.png`, size: 0 })
  const dm = info.dimensions
  return {
    id,
    files: out,
    entry: {
      id, kind: 'material', name: info.name ?? id, nameVi: s?.vi ?? info.name ?? id, tags: [...(info.categories ?? []), ...(info.tags ?? []), ...(s?.floor ? ['floor'] : [])],
      files: { maps }, dir, thumb: 'thumb.png', source: { site: 'Poly Haven', url: `https://polyhaven.com/a/${id}`, author: authorOf(info) }, license: PH_LICENSE, addedAt: now,
      origin: 'builtin-download', appMaterials: s?.app ?? [], ...(dm && dm[0] > 0 ? { sizeMm: [Math.round(dm[0]), Math.round(dm[1] || dm[0])] as [number, number] } : {}), ...(s?.tint ? { tint: true } : {}),
    },
  }
}

/** HDRI: the .hdr at 2k (else 1k). */
export function planHdri(id: string, files: FilesJson, info: PhInfo, s: StarterHdri | null, now = Date.now()): PlanAsset | null {
  const h = files.hdri
  const res = pickRes(h, ['2k', '1k'])
  const f = res ? h[res]?.hdr : undefined
  if (!f || !isPh(f.url)) return null
  const dir = `hdri/${id}`
  const main = leaf(new URL(f.url).pathname)
  return {
    id,
    files: [{ url: f.url, path: `${dir}/${main}`, size: f.size, md5: f.md5 }, { url: `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=256&height=128`, path: `${dir}/thumb.png`, size: 0 }],
    entry: {
      id, kind: 'hdri', name: info.name ?? id, nameVi: s?.vi ?? info.name ?? id, tags: [...(info.categories ?? []), ...(info.tags ?? [])], files: { main }, dir, thumb: 'thumb.png',
      source: { site: 'Poly Haven', url: `https://polyhaven.com/a/${id}`, author: authorOf(info) }, license: PH_LICENSE, addedAt: now, origin: 'builtin-download', lighting: s?.lighting ?? ['day'],
    },
  }
}

/** Plan of one asset of a given kind (the files JSON from /files/<id>, the info from /assets or /info/<id>). */
export function planAsset(kind: 'model' | 'material' | 'hdri', id: string, files: unknown, info: PhInfo, now = Date.now()): PlanAsset | null {
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(id) || !files || typeof files !== 'object') return null
  const f = files as FilesJson
  if (kind === 'model') return planModel(id, f, info, STARTER_MODELS.find((m) => m.id === id) ?? { id, category: guessCategory(info), vi: info.name ?? id }, now)
  if (kind === 'material') return planMaterial(id, f, info, STARTER_MATERIALS.find((m) => m.id === id) ?? null, now)
  return planHdri(id, f, info, STARTER_HDRIS.find((m) => m.id === id) ?? null, now)
}

/** Library category of a Poly Haven model outside the starter set (its category path / tags). */
export function guessCategory(info: PhInfo & { category?: string }): LibCategory {
  const s = `${info.category ?? ''} ${(info.categories ?? []).join(' ')} ${(info.tags ?? []).join(' ')}`.toLowerCase()
  const rules: [string[], LibCategory][] = [
    [['sofa', 'couch'], 'sofa'], [['bed'], 'bed'], [['armchair', 'lounge chair'], 'armchair'], [['stool', 'ottoman'], 'stool'], [['chair', 'seating'], 'chair'],
    [['coffee table'], 'coffeeTable'], [['side & end', 'nightstand'], 'sideTable'], [['dining'], 'diningTable'], [['desk'], 'desk'], [['shelv', 'bookcase'], 'shelf'],
    [['sideboard', 'console'], 'sideboard'], [['cabinet', 'cupboard', 'drawer', 'dresser'], 'cabinet'], [['chandelier', 'pendant', 'ceiling'], 'pendant'], [['lamp', 'light'], 'lamp'],
    [['potted', 'plant'], 'plant'], [['table'], 'diningTable'],
  ]
  for (const [w, c] of rules) if (w.some((x) => s.includes(x))) return c
  return 'decor'
}

/** Total bytes of a plan (thumbnails count as 0 until fetched). */
export const planBytes = (p: PlanAsset[]) => p.reduce((a, x) => a + x.files.reduce((b, f) => b + (f.size || 0), 0), 0)

/** Search the Poly Haven catalogue JSON (/assets?t=…) by words in id / name / tags / categories. */
export function searchCatalogue(cat: Record<string, PhInfo & { category?: string }>, q: string, limit = 60): { id: string; info: PhInfo & { category?: string } }[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  return Object.entries(cat)
    .filter(([id, v]) => words.every((w) => `${id} ${v.name ?? ''} ${(v.tags ?? []).join(' ')} ${(v.categories ?? []).join(' ')} ${v.category ?? ''}`.toLowerCase().includes(w)))
    .slice(0, limit)
    .map(([id, info]) => ({ id, info }))
}
