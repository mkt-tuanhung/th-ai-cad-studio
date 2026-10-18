/**
 * Photoreal interior renders (v2.4): what the Blender worker gets besides the GLB snapshot.
 *
 *  - The SHELL: when the interior rooms come from the BIM model (the "1 lệnh" pipeline builds both), the render scene
 *    is the BIM building — walls with their window / door openings and glazing, door leaves, the floor slabs (the slab
 *    above is the ceiling; a double-height room sees the slab two storeys up, never open sky), stairs, railings,
 *    beams — shifted so the interior's level is at z = 0, plus the interior's room floors and furniture. Without a
 *    BIM match (the sample project) it stays the interior scene (walls to the ceiling) and Blender adds ceilings.
 *  - The DRESSING: for each furniture item, the library model (or composed piece) that replaces its placeholder in the
 *    render — explicit asset, else category + closest size — with its plan placements and W × D × H box; the app
 *    finishes of every surface and their PBR library materials; the HDRIs.
 *  - AUTO VIEWS: architectural cameras per room (eye 1.2–1.4 m, 24–28 mm full-frame-equivalent lens, level camera
 *    with lens shift, standing in a corner / at a wall looking across the longest diagonal at the furniture group).
 * Presentation only: nothing here feeds dimensions, BOM, quantities or CNC.
 */
import { MATERIALS, type Item, type Room } from '../interior/model'
import type { InteriorDoc } from '../state/interior'
import { interiorScene, itemPlacements, sceneItemOwner, type InteriorSceneItem, type Place } from '../interior/scene'
import { frontOf, rayToOutline } from '../interior/orient'
import { materialSpec } from '../interior/materials'
import { bimExtras, nativeBuildingModel } from '../bim/scene'
import type { BimModel } from '../bim/model'
import { assetFit, hdriFor, itemBox, libMaterialFor, matchAsset, type ComposedPart, type Dims, type LibAsset } from '../library/assets'
import { partsFor, presetAssets } from '../library/composer'
import type { CameraView } from './model'

/* ------------------------------------------------------------------ shell */

/** The BIM level the interior rooms come from (every room id is a BIM room of one level), else null. */
export function shellLevel(doc: InteriorDoc, bim: BimModel | null | undefined): string | null {
  if (!bim || !doc.rooms.length) return null
  const byId = new Map(bim.rooms.map((r) => [r.id, r]))
  const levels = new Set<string>()
  for (const r of doc.rooms) {
    const b = byId.get(r.id)
    if (!b) return null
    levels.add(b.level)
  }
  return levels.size === 1 ? [...levels][0] : null
}

/** Height (mm above the interior floor) of the ceiling a double-height room sees: the next slab over the void above it. */
export function openToHeight(bim: BimModel, levelId: string, room: Room): number | undefined {
  const lv = bim.levels.find((l) => l.id === levelId)
  if (!lv) return undefined
  const above = [...bim.levels].filter((l) => l.elevation > lv.elevation).sort((a, b) => a.elevation - b.elevation)
  const cx = room.outline.reduce((a, p) => a + p.x, 0) / room.outline.length, cy = room.outline.reduce((a, p) => a + p.y, 0) / room.outline.length
  const inside = (o: [number, number][], x: number, y: number) => {
    let c = false
    for (let i = 0, j = o.length - 1; i < o.length; j = i++) if (o[i][1] > y !== o[j][1] > y && x < ((o[j][0] - o[i][0]) * (y - o[i][1])) / (o[j][1] - o[i][1]) + o[i][0]) c = !c
    return c
  }
  let k = 0
  while (k < above.length && bim.rooms.some((r) => r.level === above[k].id && r.void && r.outline && inside(r.outline, cx, cy))) k++
  if (k === 0 || k >= above.length) return undefined
  const slab = bim.slabs.find((s) => s.level === above[k].id && s.kind !== 'ceiling')?.thickness ?? 120
  return above[k].elevation - lv.elevation - slab
}

/** The BIM building moved so `levelId` is at z = 0 (curtain / special walls as the live view builds them). */
export function shiftedBim(bim: BimModel, levelId: string): BimModel {
  const z = bim.levels.find((l) => l.id === levelId)?.elevation ?? 0
  return z ? { ...bim, levels: bim.levels.map((l) => ({ ...l, elevation: l.elevation - z })) } : bim
}

/* ------------------------------------------------------------------ dressing */

export interface MatSpec {
  kind: string
  color: string
  roughness: number
  metallic: number
  tileMm: [number, number]
  /** PBR library material (paths relative to the library root). */
  lib?: { id: string; dir: string; maps: NonNullable<LibAsset['files']['maps']>; sizeMm?: [number, number]; tint: boolean }
  floorLib?: MatSpec['lib']
}

export interface DressItem {
  item: string
  name: string
  /** Scene items (GLB nodes) of the placeholder to hide. */
  hide: string[]
  asset: string
  kind: 'model' | 'composed'
  /** glTF / GLB relative to the library root (models). */
  file?: string
  /** Composed parts at the item's size (composed / preset pieces). */
  parts?: ComposedPart[]
  /** Model size (mm) from its manifest — Blender measures the real bounding box anyway. */
  dims?: Dims
  /** Turn of the model (degrees) before the item's rotation: its front to −Y, or a table turned to fit. */
  yaw?: number
  box: Dims
  at: (Place & { z: number })[]
  /** Hung from the ceiling at this height (pendants). */
  hang?: number
  /** Item finish (app material) and whether it replaces the model's own materials. */
  finish: string
  keepModel: boolean
  /** Presentation staging (TV, rug, table decor): renders only, not in the model. */
  prop?: boolean
  /** A warm lamp glowing in the piece (bedside lamps): height above its base (mm) and power (W). */
  glow?: { z: number; watts: number }
}

export interface RenderDressing {
  version: 1
  shell: boolean
  /** Add a ceiling per room (no shell: the interior scene has none). */
  ceilings: boolean
  rooms: { id: string; name: string; outline: [number, number][]; ceiling: number; openTo?: number; floor: string; wall: string; ceilingFinish: string }[]
  items: DressItem[]
  /** Scene item id → app material (floors, walls, parametric furniture parts). */
  surfaces: Record<string, string>
  /** Finishes of the BIM shell (walls, slab undersides, slab tops outside the rooms). */
  shellFinish: { wall: string; ceiling: string; floor: string }
  materials: Record<string, MatSpec>
  /** Lighting preset → HDRI (relative to the library root). */
  hdri: Record<string, string>
}

const libRef = (a: LibAsset | null): MatSpec['lib'] => (a?.files.maps ? { id: a.id, dir: a.dir, maps: a.files.maps, ...(a.sizeMm ? { sizeMm: a.sizeMm } : {}), tint: !!a.tint } : undefined)

/** Appearance of every app finish used, with its PBR library material (furniture surfaces) and floor texture. */
export function materialTable(names: Iterable<string>, assets: LibAsset[]): Record<string, MatSpec> {
  const out: Record<string, MatSpec> = {}
  for (const n of new Set(names)) {
    if (!n || n === '—') continue
    const s = materialSpec(n)
    const lib = libRef(libMaterialFor(n, assets))
    const floorLib = libRef(libMaterialFor(n, assets, true))
    out[n] = { kind: s.kind, color: s.color, roughness: s.roughness, metallic: s.metallic, tileMm: s.tileMm, ...(lib ? { lib } : {}), ...(floorLib && floorLib.id !== lib?.id ? { floorLib } : {}) }
  }
  return out
}

/** Every library asset the matcher may use: the manifest's models plus the built-in parametric presets. */
export const renderAssets = (assets: LibAsset[]) => [...assets, ...presetAssets()]

/**
 * The dressing of an interior scene: library models for the furniture, finishes, materials, HDRIs. `scene` is the
 * interior scene the GLB was built from (its item ids are the GLB node names).
 */
/** A dining "table" block as large as a dining SET (table with its chairs drawn in one block, both sides ≥ 1.5 m). */
export const isDiningSet = (i: Item) => i.category === 'tables' && i.h >= 650 && Math.min(i.w ?? i.dia ?? 0, i.d ?? i.dia ?? 0) >= 1500 && ((i as Item & { kind?: string }).kind === 'dining' || /dining|bàn ăn/i.test(i.name))

/**
 * A dining set in a render: the table (inside the block, chairs' room left round it) and chairs along its long sides,
 * each facing the table; library models when the library has them, else the parametric presets.
 */
export function diningSet(item: Item, at: Place[], all: LibAsset[], hide: string[]): { items: DressItem[]; top: number } {
  const b = itemBox(item)
  const tw = b.w >= b.d ? b.w - 300 : Math.max(800, b.w - 1100)
  const td = b.w >= b.d ? Math.max(800, b.d - 1100) : b.d - 300
  const table = matchAsset({ category: 'tables', name: 'dining table', w: tw, d: td, h: item.h, kind: 'dining' } as Item & { kind: string }, all)
  const chair = matchAsset({ category: 'chairs', name: 'dining chair', w: 480, d: 560, h: 900, kind: 'chair' } as Item & { kind: string }, all)
  const out: DressItem[] = []
  const box = { w: tw, d: td, h: item.h }
  let top = item.h
  if (table) {
    const fit = assetFit(table, box)
    top = !table.files.main || !table.dims ? item.h : Math.min(item.h, table.dims.h * fit.s)
    out.push({ item: item.id, name: item.name, hide, asset: table.id, kind: table.files.main ? 'model' : 'composed', ...(table.files.main ? { file: `${table.dir}/${table.files.main}` } : { parts: partsFor(table, tw, td, item.h) }), ...(table.dims ? { dims: table.dims } : {}), ...(fit.yaw && table.files.main ? { yaw: fit.yaw } : {}), box, at: at.map((p) => ({ ...p, z: item.elev ?? 0 })), finish: item.material, keepModel: true })
  }
  if (chair) {
    const long = Math.max(tw, td), n = Math.max(1, Math.floor((long - 200) / 600))
    const cbox = chair.dims && chair.files.main ? { ...chair.dims } : { w: 480, d: 560, h: 900 }
    const places: (Place & { z: number })[] = []
    for (const p of at) {
      const a = (p.rot * Math.PI) / 180
      for (const side of [-1, 1])
        for (let k = 0; k < n; k++) {
          const s = -long / 2 + (long / n) * (k + 0.5)
          // local chair position: along the long side, just off the table edge (half under it)
          const lx = tw >= td ? s : side * (tw / 2 + 200), ly = tw >= td ? side * (td / 2 + 200) : s
          // facing the table: front (−Y turned by r) points back towards the table axis
          const dx = tw >= td ? 0 : -side, dy = tw >= td ? -side : 0
          const r = (Math.atan2(dx, -dy) * 180) / Math.PI
          places.push({ x: p.x + lx * Math.cos(a) - ly * Math.sin(a), y: p.y + lx * Math.sin(a) + ly * Math.cos(a), rot: p.rot + r, z: item.elev ?? 0 })
        }
    }
    out.push({ item: `${item.id}#chairs`, name: chair.nameVi, hide: [], asset: chair.id, kind: chair.files.main ? 'model' : 'composed', ...(chair.files.main ? { file: `${chair.dir}/${chair.files.main}` } : { parts: partsFor(chair, cbox.w, cbox.d, cbox.h) }), ...(chair.dims ? { dims: chair.dims } : {}), box: cbox, at: places, finish: 'Fabric - Taupe', keepModel: true, prop: true })
  }
  return { items: out, top }
}

/**
 * Presentation staging (renders only — never in the model, schedules or BOM): a TV on the wall over a TV cabinet, a
 * rug under the sofa group when the room has none, a vase / bowl on coffee, dining and kitchen tables. Library models
 * where the library has them; nothing when it does not.
 */
export function stagingProps(placed: ReturnType<typeof itemPlacements>, assets: LibAsset[], tops: Map<string, number>): DressItem[] {
  const out: DressItem[] = []
  const model = (id: string) => assets.find((a) => a.id === id && a.kind === 'model' && a.files.main && a.dims)
  const kindOf = (i: Item) => (i as Item & { kind?: string }).kind ?? ''
  const local = (p: Place, lx: number, ly: number) => {
    const a = (p.rot * Math.PI) / 180
    return { x: p.x + lx * Math.cos(a) - ly * Math.sin(a), y: p.y + lx * Math.sin(a) + ly * Math.cos(a) }
  }
  const decor = (item: Item, p: Place, ids: string[], k: number) => {
    const a = ids.map(model).find(Boolean)
    if (!a?.dims) return
    const z = tops.get(item.id) ?? item.h
    out.push({ item: `${item.id}#prop${k}`, name: a.nameVi, hide: [], asset: a.id, kind: 'model', file: `${a.dir}/${a.files.main}`, dims: a.dims, box: { ...a.dims }, at: [{ ...p, z }], finish: a.material ?? 'Wood - Oak', keepModel: true, prop: true })
  }
  const rugRooms = new Set(placed.filter((x) => x.item.category === 'rugs').map((x) => x.room.id))
  let k = 0
  for (const { item, room, at } of placed) {
    const kind = kindOf(item), n = item.name.toLowerCase()
    const b = itemBox(item)
    if (kind === 'tvCabinet' || (item.category === 'cabinet' && /\btv\b|tivi/.test(n))) {
      for (const p of at) {
        const w = Math.max(1000, Math.min(1650, b.w * 0.6)), h = Math.round(w * 0.5625) + 30
        // on the wall behind the cabinet (the room outline behind its back), else at the cabinet's back
        const [fx, fy] = frontOf(p.rot)
        const toWall = rayToOutline(room.outline, p, -fx, -fy)
        const back = Number.isFinite(toWall) && toWall < b.d / 2 + 1200 ? toWall - 25 : b.d / 2 - 35
        const c = local(p, 0, back)
        out.push({ item: `${item.id}#tv`, name: 'TV', hide: [], asset: 'preset-tv', kind: 'composed', parts: [{ shape: 'rbox', x: 0, y: 0, z: 0, w, d: 40, h, r: 4, material: 'Metal - Black', name: 'screen' }], box: { w, d: 40, h }, at: [{ x: c.x, y: c.y, rot: p.rot, z: (item.elev ?? 0) + b.h + 320 }], finish: 'Metal - Black', keepModel: true, prop: true })
      }
    }
    const coffee = kind === 'coffeeTable' || (item.category === 'tables' && item.h < 520 && Math.max(b.w, b.d) >= 700)
    if (coffee) {
      for (const p of at) {
        if (!rugRooms.has(room.id)) {
          const w = Math.min(3000, Math.max(1700, b.w + 1500)), d = Math.min(2400, Math.max(1400, b.d + 1300))
          out.push({ item: `${item.id}#rug`, name: 'Rug', hide: [], asset: 'preset-rug', kind: 'composed', parts: [{ shape: 'rbox', x: 0, y: 0, z: 0, w, d, h: 10, r: 3, material: 'Fabric - Taupe', name: 'rug' }], box: { w, d, h: 10 }, at: [{ ...p, z: 1 }], finish: 'Fabric - Taupe', keepModel: true, prop: true })
        }
        decor(item, p, ['ceramic_vase_02', 'wooden_bowl_01'], k++)
      }
    }
    if (kind === 'dining' || (item.category === 'tables' && item.h >= 700 && Math.max(b.w, b.d) >= 1200)) for (const p of at) decor(item, p, ['wooden_bowl_01', 'ceramic_vase_01'], k++)
    if (kind === 'island' || /island|đảo/.test(n))
      for (const p of at) {
        decor(item, { ...p, ...local(p, b.w * 0.25, 0) }, ['jug_01', 'ceramic_vase_04'], k++)
        // two pendants over the island
        const lamp = model('modern_ceiling_lamp_01') ?? model('hanging_industrial_lamp')
        if (lamp?.dims)
          out.push({ item: `${item.id}#pendants`, name: lamp.nameVi, hide: [], asset: lamp.id, kind: 'model', file: `${lamp.dir}/${lamp.files.main}`, dims: lamp.dims, box: { ...lamp.dims }, at: [-1, 1].map((sx) => ({ ...p, ...local(p, (sx * Math.max(b.w, b.d)) / 4, 0), z: 0 })), hang: room.ceilingHeight, finish: 'Metal - Brass', keepModel: true, prop: true })
      }
    if (kind === 'nightstand')
      for (const p of at) {
        // a bedside lamp (ceramic base, linen shade, warm light) and a small vase beside it
        const z = tops.get(item.id) ?? (item.elev ?? 0) + item.h
        const c = local(p, -Math.min(90, b.w / 5), Math.min(60, b.d / 6))
        out.push({
          item: `${item.id}#lamp${k++}`, name: 'Bedside lamp', hide: [], asset: 'preset-lamp', kind: 'composed',
          parts: [
            { shape: 'cyl', x: 0, y: 0, z: 0, w: 130, d: 130, h: 230, material: 'Gypsum - White', name: 'base' },
            { shape: 'cyl', x: 0, y: 0, z: 230, w: 12, d: 12, h: 60, material: 'Metal - Brass', name: 'stem' },
            { shape: 'cyl', x: 0, y: 0, z: 280, w: 280, d: 280, h: 210, material: 'Fabric - Linen', name: 'shade' },
          ],
          box: { w: 280, d: 280, h: 490 }, at: [{ x: c.x, y: c.y, rot: p.rot, z }], finish: 'Fabric - Linen', keepModel: true, prop: true, glow: { z: 360, watts: 18 },
        })
        decor(item, { ...p, ...local(p, Math.min(120, b.w / 4), -Math.min(40, b.d / 8)) }, ['ceramic_vase_04', 'potted_plant_04'], k++)
      }
    if (item.category === 'beds' && !rugRooms.has(room.id))
      for (const p of at) {
        const w = Math.min(3000, b.w + 1000), d = Math.min(2400, b.d * 0.62 + 600)
        const c = local(p, 0, -b.d / 2 - 600 + d / 2)
        out.push({ item: `${item.id}#rug${k++}`, name: 'Rug', hide: [], asset: 'preset-rug', kind: 'composed', parts: [{ shape: 'rbox', x: 0, y: 0, z: 0, w, d, h: 10, r: 3, material: 'Fabric - Taupe', name: 'rug' }], box: { w, d, h: 10 }, at: [{ x: c.x, y: c.y, rot: p.rot, z: 1 }], finish: 'Fabric - Taupe', keepModel: true, prop: true })
      }
  }
  return out
}

export function renderDressing(doc: InteriorDoc, scene: { items: InteriorSceneItem[] }, assets: LibAsset[], opts: { shell: boolean; openTo?: Record<string, number>; staging?: boolean } = { shell: false }): RenderDressing {
  const all = renderAssets(assets)
  const surfaces: Record<string, string> = {}
  for (const it of scene.items) if (it.material?.id) surfaces[it.id] = it.material.id
  const ownerIds = new Map<string, string[]>()
  for (const it of scene.items) {
    const o = sceneItemOwner(it.id)
    ownerIds.set(o, [...(ownerIds.get(o) ?? []), it.id])
  }
  const items: DressItem[] = []
  const placed = itemPlacements(doc)
  /** Top of an item as rendered (a model fitted into the box may be lower than the box). */
  const tops = new Map<string, number>()
  for (const { item, room, at } of placed) {
    if (isDiningSet(item) && !(item as Item & { asset?: string }).asset) {
      const set = diningSet(item, at, all, ownerIds.get(item.id) ?? [item.id])
      items.push(...set.items)
      tops.set(item.id, (item.elev ?? 0) + set.top)
      continue
    }
    const a = matchAsset(item as Item & { kind?: string; asset?: string }, all)
    if (!a) {
      tops.set(item.id, (item.elev ?? 0) + item.h)
      continue
    }
    const box = itemBox(item)
    const ext = item as Item & { assetFinish?: 'model' | 'item' }
    const composed = !a.files.main
    const pendant = item.category === 'lighting' && (a.category === 'pendant' || !!item.dia)
    const fit = assetFit(a, box)
    tops.set(item.id, (item.elev ?? 0) + (composed || !a.dims ? box.h : Math.min(box.h, (fit.yaw % 180 ? a.dims.h : a.dims.h) * fit.s)))
    items.push({
      item: item.id,
      name: item.name,
      hide: ownerIds.get(item.id) ?? [item.id],
      asset: a.id,
      kind: composed ? 'composed' : 'model',
      ...(composed ? { parts: partsFor(a, box.w, box.d, box.h) } : { file: `${a.dir}/${a.files.main}` }),
      ...(a.dims ? { dims: a.dims } : {}),
      ...(!composed && assetFit(a, box).yaw ? { yaw: assetFit(a, box).yaw } : {}),
      box,
      at: at.map((p) => ({ ...p, z: item.category === 'lighting' ? 0 : item.elev ?? 0 })),
      ...(pendant ? { hang: room.ceilingHeight } : {}),
      finish: item.material,
      keepModel: ext.assetFinish !== 'item',
    })
  }
  if (opts.staging !== false) items.push(...stagingProps(placed, assets, tops))
  const rooms = doc.rooms.map((r) => ({
    id: r.id, name: r.name, outline: r.outline.map((p) => [p.x, p.y] as [number, number]), ceiling: r.ceilingHeight, ...(opts.openTo?.[r.id] ? { openTo: opts.openTo[r.id] } : {}),
    floor: r.floorFinish, wall: r.wallFinish, ceilingFinish: r.ceilingFinish === '—' ? 'Gypsum - White' : r.ceilingFinish,
  }))
  // the shell's walls / ceilings take the most common room finish
  const common = (k: 'wall' | 'ceilingFinish' | 'floor') => {
    const n = new Map<string, number>()
    for (const r of rooms) n.set(r[k], (n.get(r[k]) ?? 0) + 1)
    return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? (k === 'wall' ? 'Paint - Warm White' : k === 'floor' ? 'Porcelain Tile - Beige' : 'Gypsum - White')
  }
  const shellFinish = { wall: common('wall'), ceiling: common('ceilingFinish'), floor: common('floor') }
  const used = [...Object.values(surfaces), ...items.map((i) => i.finish), ...items.flatMap((i) => i.parts?.map((p) => p.material) ?? []), ...Object.values(shellFinish), ...rooms.flatMap((r) => [r.floor, r.wall, r.ceilingFinish])]
  const hdri: Record<string, string> = {}
  for (const p of ['day', 'golden', 'night', 'overcast', 'studio']) {
    const h = hdriFor(p, assets)
    if (h?.files.main) hdri[p] = `${h.dir}/${h.files.main}`
  }
  return { version: 1, shell: opts.shell, ceilings: !opts.shell, rooms, items, surfaces, shellFinish, materials: materialTable(used.filter((m) => MATERIALS.some((x) => x.name === m)), assets), hdri }
}

/** The render scene of an interior camera: the BIM shell when the rooms come from the BIM model, else the interior scene. */
export function interiorRenderScene(doc: InteriorDoc, bim: BimModel | null | undefined, furniture: boolean) {
  const sc = interiorScene(doc, { fullWalls: true, furniture })
  const lv = shellLevel(doc, bim)
  if (!lv || !bim) return { items: sc.items as InteriorSceneItem[], bimModel: undefined, extras: [] as ReturnType<typeof bimExtras>['items'], level: null, openTo: {} as Record<string, number> }
  const moved = shiftedBim(bim, lv)
  // the BIM's own furniture blocks (components) are the interior items already; footings are underground
  const skip = new Set([...(bim.components ?? []).map((c) => c.id), ...(bim.footings ?? []).map((f) => f.id)])
  const extras = bimExtras(moved).items.filter((it) => !skip.has(it.id.split(':')[0]))
  const openTo: Record<string, number> = {}
  for (const r of doc.rooms) {
    const h = openToHeight(bim, lv, r)
    if (h && h > r.ceilingHeight) openTo[r.id] = h
  }
  return { items: (sc.items as InteriorSceneItem[]).filter((it) => !it.id.startsWith('walls:')), bimModel: nativeBuildingModel(moved), extras, level: lv, openTo }
}

/* ------------------------------------------------------------------ architectural auto views */

/** Vertical field of view (°) of a full-frame-equivalent focal length on an image of aspect w / h. */
export function vfovForLens(lensEq: number, aspect = 16 / 9) {
  const hf = 2 * Math.atan(18 / lensEq)
  return (2 * Math.atan(Math.tan(hf / 2) / aspect) * 180) / Math.PI
}

export interface AutoView extends CameraView {
  name: string
  room: string
  /** Full-frame-equivalent focal length (mm) and lens shift (fraction of the image) of a level camera. */
  lensEq: number
  shift: [number, number]
  level: true
}

const inPoly = (o: { x: number; y: number }[], x: number, y: number) => {
  let c = false
  for (let i = 0, j = o.length - 1; i < o.length; j = i++) if (o[i].y > y !== o[j].y > y && x < ((o[j].x - o[i].x) * (y - o[i].y)) / (o[j].y - o[i].y) + o[i].x) c = !c
  return c
}

/**
 * Up to `n` architectural views of a room: eye 1.3 m, level camera (vertical lines stay vertical; lens shift −6 %
 * shows a little more floor), 24 mm-equivalent lens in small rooms and 26 mm in larger ones. The eye stands near a
 * corner or a wall (and near the room's door when it has one) looking across the room at the furniture group; the
 * views are as different as possible (directions ≥ 50° apart).
 */
export function autoViews(doc: InteriorDoc, roomId: string, n = 3, aspect = 16 / 9): AutoView[] {
  const room = doc.rooms.find((r) => r.id === roomId)
  if (!room || room.outline.length < 3) return []
  const o = room.outline
  const xs = o.map((p) => p.x), ys = o.map((p) => p.y)
  const minSide = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  const eyeZ = 1300
  const lensEq = minSide < 3600 ? 24 : 26
  const fov = Math.round(vfovForLens(lensEq, aspect) * 100) / 100
  // furniture of the room (footprints, for the target and to keep the eye out of them)
  const foot: { x: number; y: number; w: number; d: number; a: number; main?: boolean }[] = []
  // the room's main piece (largest sofa / bed / seating): the views look at its front
  let main: { a: number; front: [number, number] } | null = null
  for (const { item, room: r, at } of itemPlacements(doc)) {
    if (r.id !== roomId || item.category === 'rugs' || item.category === 'lighting') continue
    const b = itemBox(item)
    for (const p of at) {
      const q = Math.abs(Math.cos((p.rot * Math.PI) / 180)) > 0.7
      const f = { x: p.x, y: p.y, w: q ? b.w : b.d, d: q ? b.d : b.w, a: b.w * b.d }
      foot.push(f)
      if ((item.category === 'sofas' || item.category === 'beds') && (!main || b.w * b.d > main.a)) {
        for (const g of foot) g.main = false
        ;(f as { main?: boolean }).main = true
        main = { a: b.w * b.d, front: frontOf(p.rot) }
      }
    }
  }
  const cx = o.reduce((s, p) => s + p.x, 0) / o.length, cy = o.reduce((s, p) => s + p.y, 0) / o.length
  // a sparsely furnished room (a kitchen with only its island) looks into the open-plan rooms next to it too
  const near: { x: number; y: number; a: number }[] = []
  if (foot.length < 3) {
    const touches = (r: Room) => r.id !== roomId && r.outline.some((p) => o.some((q, i) => { const q2 = o[(i + 1) % o.length]; const L = Math.hypot(q2.x - q.x, q2.y - q.y) || 1; const t = Math.max(0, Math.min(1, ((p.x - q.x) * (q2.x - q.x) + (p.y - q.y) * (q2.y - q.y)) / (L * L))); return Math.hypot(p.x - q.x - t * (q2.x - q.x), p.y - q.y - t * (q2.y - q.y)) < 250 }))
    for (const { item, room: r, at } of itemPlacements(doc)) {
      if (!touches(r) || item.category === 'rugs' || item.category === 'lighting') continue
      const b = itemBox(item)
      for (const p of at) near.push({ x: p.x, y: p.y, a: b.w * b.d * 0.35 })
    }
  }
  const wsum = [...foot, ...near]
  const area = wsum.reduce((s, f) => s + f.a, 0)
  const target = area > 0 ? { x: wsum.reduce((s, f) => s + f.x * f.a, 0) / area, y: wsum.reduce((s, f) => s + f.y * f.a, 0) / area } : { x: cx, y: cy }
  const blocked = (x: number, y: number) => foot.some((f) => Math.abs(x - f.x) < f.w / 2 + 200 && Math.abs(y - f.y) < f.d / 2 + 200)
  // candidates: inset from each corner along its bisector, and from each wall's middle along the inward normal
  const cands: { x: number; y: number; door: boolean }[] = []
  const inset = 380
  for (let k = 0; k < o.length; k++) {
    const p = o[k], prev = o[(k + o.length - 1) % o.length], next = o[(k + 1) % o.length]
    const u = { x: prev.x - p.x, y: prev.y - p.y }, v = { x: next.x - p.x, y: next.y - p.y }
    const lu = Math.hypot(u.x, u.y) || 1, lv = Math.hypot(v.x, v.y) || 1
    const bis = { x: u.x / lu + v.x / lv, y: u.y / lu + v.y / lv }
    const lb = Math.hypot(bis.x, bis.y) || 1
    cands.push({ x: p.x + (bis.x / lb) * inset * Math.SQRT2, y: p.y + (bis.y / lb) * inset * Math.SQRT2, door: false })
    const len = lv, nx = -(next.y - p.y) / len, ny = (next.x - p.x) / len
    cands.push({ x: (p.x + next.x) / 2 + nx * inset, y: (p.y + next.y) / 2 + ny * inset, door: false })
  }
  for (const dr of room.doors ?? []) {
    const p = o[dr.wall], q = o[(dr.wall + 1) % o.length]
    if (!p || !q) continue
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1
    const t = (dr.at + (dr.width ?? 900) / 2) / len
    cands.push({ x: p.x + (q.x - p.x) * t - ((q.y - p.y) / len) * 600, y: p.y + (q.y - p.y) * t + ((q.x - p.x) / len) * 600, door: true })
  }
  // nearest furniture edge to an eye (a piece right in front of the lens fills the frame)
  const clearance = (x: number, y: number) => foot.reduce((m, f) => Math.min(m, Math.hypot(Math.max(0, Math.abs(x - f.x) - f.w / 2), Math.max(0, Math.abs(y - f.y) - f.d / 2))), Infinity)
  const scored = cands
    .filter((c) => inPoly(o, c.x, c.y) && !blocked(c.x, c.y))
    .map((c) => {
      const dx = target.x - c.x, dy = target.y - c.y
      const dist = Math.hypot(dx, dy)
      // looking at the main piece's front (we see the sofa's seat / the bed's foot, not its back)
      const facing = main ? Math.max(0, -(main.front[0] * dx + main.front[1] * dy) / (dist || 1)) : 0
      const nearest = clearance(c.x, c.y)
      // furniture inside the horizontal field of view, farther than 1.2 m (the composition shows the room's pieces)
      const half = Math.atan(18 / lensEq) * 0.9
      const seen = foot.filter((f) => {
        const vx = f.x - c.x, vy = f.y - c.y, L = Math.hypot(vx, vy)
        return L > 1200 && Math.acos(Math.max(-1, Math.min(1, (vx * dx + vy * dy) / (L * (dist || 1))))) < half
      }).length
      // a piece in the frame close to the lens fills it: within 1 m it blocks the view, within 1.6 m it crowds it.
      // The main piece (sofa / bed) seen near the middle of the frame is the subject, not an obstacle.
      let block = 0
      for (const f of foot) {
        const vx = f.x - c.x, vy = f.y - c.y, L = Math.hypot(vx, vy)
        const edge = Math.hypot(Math.max(0, Math.abs(vx) - f.w / 2), Math.max(0, Math.abs(vy) - f.d / 2))
        const ang = Math.acos(Math.max(-1, Math.min(1, (vx * dx + vy * dy) / ((L || 1) * (dist || 1)))))
        if (ang > half + 0.25 || (f.main && facing > 0.3 && ang < half * 0.6)) continue
        block = Math.max(block, edge < 1000 ? 4000 : edge < 1700 ? 1800 : 0)
      }
      return { ...c, dist, dir: Math.atan2(dy, dx), score: dist + (c.door ? 1500 : 0) + facing * 2500 + seen * 700 - (nearest < 900 ? 2500 : 0) - block }
    })
    .filter((c) => c.dist >= 1500)
    .sort((a, b) => b.score - a.score)
  const out: AutoView[] = []
  const chosen: typeof scored = []
  for (const c of scored) {
    // different views: directions ≥ 35° apart or eyes ≥ 1.5 m apart (≥ 50° / 2.5 m in larger rooms)
    const [minAng, minDist] = minSide < 3600 ? [35, 1500] : [50, 2500]
    if (chosen.some((x) => { const d = Math.abs(((x.dir - c.dir + 3 * Math.PI) % (2 * Math.PI)) - Math.PI); return d < (minAng * Math.PI) / 180 && Math.hypot(x.x - c.x, x.y - c.y) < minDist })) continue
    chosen.push(c)
    if (chosen.length >= n) break
  }
  // fewer distinct candidates than asked: the best ones anyway
  for (const c of scored) {
    if (chosen.length >= n) break
    if (!chosen.includes(c)) chosen.push(c)
  }
  chosen.forEach((c, k) => {
    // look past the furniture group's centre (a little beyond it) so the view reads across the room, level
    const dx = target.x - c.x, dy = target.y - c.y, L = Math.hypot(dx, dy)
    out.push({
      scene: 'interior', name: `${k + 1}`, room: roomId,
      eye: [Math.round(c.x), Math.round(c.y), eyeZ], at: [Math.round(c.x + (dx / L) * (L + 1000)), Math.round(c.y + (dy / L) * (L + 1000)), eyeZ],
      up: [0, 0, 1], fov, lensEq, shift: [0, -0.06], level: true,
    })
  })
  return out
}
