/**
 * Interior edits with library assets (3D library dialog): place a library model / composed piece into a room, replace
 * a placed item keeping its position, or only use a model for an item's renders. Each is a pure function returning an
 * EditResult (one undo step through the interior store); sizes come from the asset's real dimensions.
 */
import { placeAsset, type EditResult } from '../interior/layout'
import type { SpaceAsset } from '../interior/catalog'
import type { InteriorDoc } from '../state/interior'
import type { Item } from '../interior/model'
import { MATERIALS } from '../interior/model'
import { ITEM_CATEGORY_OF, composedDims, type LibAsset } from './assets'

const DEFAULT_MAT: Record<string, string> = { sofas: 'Fabric - Beige', tables: 'Wood - Oak', cabinet: 'Wood - Oak', chairs: 'Fabric - Taupe', lighting: 'Metal - Brass', beds: 'Fabric - Linen', decor: 'Wood - Ash Light', rugs: 'Fabric - Linen' }

/** Real size of a library model (mm, rounded); composed pieces from their parts. */
export function assetDims(a: LibAsset) {
  const d = a.dims ?? (a.parts?.length ? composedDims(a.parts) : { w: 500, d: 500, h: 500 })
  const turned = Math.abs(((((a.yaw ?? 0) % 180) + 180) % 180) - 90) < 1
  return { w: Math.max(10, Math.round(turned ? d.d : d.w)), d: Math.max(10, Math.round(turned ? d.w : d.d)), h: Math.max(5, Math.round(d.h)) }
}

/** A library model seen as a Space Planning catalogue entry (so the layout code places it like any product). */
export function libSpaceAsset(a: LibAsset, lang: 'vi' | 'en' = 'vi'): SpaceAsset {
  const cat = ITEM_CATEGORY_OF[a.category ?? 'decor']
  const { w, d, h } = assetDims(a)
  const fixed = (v: number): [number, number] => [v, v]
  return {
    key: `lib:${a.id}`, libId: a.id, name: lang === 'vi' ? a.nameVi : a.name, cat, styles: [], w, d, h, round: false,
    limits: { w: fixed(w), d: fixed(d), h: fixed(h) }, parametric: false, elev: 0, cabinet: false, storage: cat === 'cabinet',
    material: a.material && MATERIALS.some((m) => m.name === a.material) ? a.material : DEFAULT_MAT[cat],
  }
}

/** Place a library asset in a room (centre, or a point; snapped to a near wall like the catalogue). */
export function placeLibAsset(doc: InteriorDoc, a: LibAsset, roomId: string, point?: { x: number; y: number }): EditResult {
  const r = placeAsset(doc, libSpaceAsset(a), roomId, point)
  if (!r.doc || !r.id) return r
  return { doc: { ...r.doc, items: r.doc.items.map((i) => (i.id === r.id ? withAsset(i, a) : i)) }, id: r.id }
}

const withAsset = (i: Item, a: LibAsset): Item => ({ ...i, asset: a.id, kind: a.category ?? i.kind, src: { kind: 'catalog' } })

/**
 * Replace an item by a library asset at the same placements: name, category and size from the asset. A parametric
 * cabinet it used (and no other item uses) leaves the cut list; locked items are refused.
 */
export function replaceWithLib(doc: InteriorDoc, id: string, a: LibAsset): EditResult {
  const i = doc.items.find((x) => x.id === id)
  if (!i) return { error: 'item' }
  if (i.locked) return { error: 'locked' }
  const s = libSpaceAsset(a)
  const cabinets = i.cabinet && !doc.items.some((x) => x.id !== id && x.cabinet === i.cabinet) ? doc.cabinets.filter((c) => c.id !== i.cabinet) : doc.cabinets
  const same = s.cat === i.category
  const next: Item = {
    ...i, name: s.name, category: s.cat, w: s.w, d: s.d, dia: undefined, h: s.h, material: same ? i.material : s.material, parts: same ? i.parts : undefined,
    cabinet: undefined, catalog: s.key, asset: a.id, kind: a.category ?? i.kind, src: { kind: 'catalog' },
  }
  return { doc: { ...doc, items: doc.items.map((x) => (x.id === id ? next : x)), cabinets }, id }
}

/** Use a library model for an item's renders only (the item keeps its size, cut list and schedule). */
export function assignLib(doc: InteriorDoc, id: string, a: LibAsset | null): EditResult {
  const i = doc.items.find((x) => x.id === id)
  if (!i) return { error: 'item' }
  return { doc: { ...doc, items: doc.items.map((x) => (x.id === id ? { ...x, asset: a?.id } : x)) }, id }
}
