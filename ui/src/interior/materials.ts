/**
 * Space Planning materials (SP26 / SP27): physically based appearance of the interior materials and the
 * per-part finishes of furniture.
 *
 * A material is identified by its name (the id used everywhere in the interior model). Appearance only:
 * colour, roughness, metallic, a texture tile size in millimetres (the real-world period of the pattern —
 * one plank, one tile, one board sheet) and the grain direction. Changing a finish never changes geometry,
 * bounds or the cut list's sizes; for parametric cabinets the body / front finishes are the cabinet's board /
 * front boards (which the cut list already names), nothing else.
 */
import { MATERIALS, type Cabinet, type Item, type ItemCategory, type Material } from './model'

export interface MaterialSpec {
  id: string
  name: string
  kind: Material['kind']
  color: string
  /** 0 = mirror, 1 = fully diffuse. */
  roughness: number
  metallic: number
  /** Texture period on the surface (mm): along the grain × across it. Plain colours use [1000, 1000]. */
  tileMm: [number, number]
  /** Default grain / pattern direction (degrees from the part's length). */
  grainDeg: number
  /** Directional pattern (wood, board, fabric weave): its rotation matters. */
  directional: boolean
}

/** PBR defaults per kind, then per-material tile sizes where the product defines them. */
const KIND: Record<Material['kind'], Omit<MaterialSpec, 'id' | 'name' | 'kind' | 'color'>> = {
  fabric: { roughness: 0.9, metallic: 0, tileMm: [300, 300], grainDeg: 0, directional: true },
  wood: { roughness: 0.45, metallic: 0, tileMm: [2400, 200], grainDeg: 0, directional: true },
  stone: { roughness: 0.25, metallic: 0, tileMm: [1200, 600], grainDeg: 0, directional: false },
  metal: { roughness: 0.3, metallic: 1, tileMm: [1000, 1000], grainDeg: 0, directional: false },
  paint: { roughness: 0.85, metallic: 0, tileMm: [1000, 1000], grainDeg: 0, directional: false },
  tile: { roughness: 0.35, metallic: 0, tileMm: [600, 600], grainDeg: 0, directional: false },
  gypsum: { roughness: 0.95, metallic: 0, tileMm: [1000, 1000], grainDeg: 0, directional: false },
  board: { roughness: 0.5, metallic: 0, tileMm: [2440, 1220], grainDeg: 0, directional: true },
}
const TILE: Record<string, [number, number]> = {
  'Porcelain Tile - Beige': [600, 600],
  'Marble - White': [1200, 600],
  'Wood - Oak': [1800, 180],
  'Wood - Walnut': [2200, 190],
  'Wood - Ash Light': [2000, 180],
  'MFC 18 - Walnut': [2800, 2070],
  'MFC 18 - Oak': [2800, 2070],
  'HDF 6 - White': [2440, 1220],
}

export function materialSpec(name: string): MaterialSpec {
  const m = MATERIALS.find((x) => x.name === name) ?? { name, kind: 'paint' as const, color: '#c8c8c8' }
  const k = KIND[m.kind]
  return { id: m.name, name: m.name, kind: m.kind, color: m.color, ...k, tileMm: TILE[m.name] ?? k.tileMm }
}

/** Material info shipped with each scene item, for the render paths (GLB / Blender / OCCT path tracer). */
export interface SceneMaterial {
  id: string
  color: string
  roughness: number
  metallic: number
  tileMm: [number, number]
  grainDeg: number
}
export function sceneMaterial(name: string, grainDeg?: number): SceneMaterial {
  const s = materialSpec(name)
  return { id: s.id, color: s.color, roughness: s.roughness, metallic: s.metallic, tileMm: s.tileMm, grainDeg: grainDeg ?? s.grainDeg }
}

/**
 * Texture mapping of a rectangular face (V24-028): how many times the texture repeats along the face's length
 * and width, and the UV rotation. The period is the material's tile size in mm, so a 1200 mm panel of a
 * 600 mm tile shows exactly two tiles whatever the panel's mesh resolution.
 */
export function uvRepeat(name: string, faceLenMm: number, faceWidMm: number, grainDeg?: number) {
  const s = materialSpec(name)
  const g = grainDeg ?? s.grainDeg
  // grain across the length (90°) swaps which tile side runs along the face
  const across = Math.abs(((g % 180) + 180) % 180 - 90) < 45
  const [along, side] = across ? [s.tileMm[1], s.tileMm[0]] : s.tileMm
  return { u: faceLenMm / along, v: faceWidMm / side, rotDeg: g, periodMm: [along, side] as [number, number] }
}

/* ---------------- named parts of a furniture item ---------------- */

export const PARTS: Record<ItemCategory, string[]> = {
  sofas: ['body', 'back'],
  tables: ['top', 'legs'],
  chairs: ['seat', 'legs', 'back'],
  beds: ['frame', 'mattress'],
  cabinet: ['body', 'front'],
  lighting: ['shade'],
  decor: ['body'],
  rugs: ['body'],
}

/** Finish of one part: the part's own entry, the cabinet's board / front, else the item material. */
export function partMaterial(i: Item, part: string, cab?: Cabinet): { material: string; grainDeg?: number } {
  if (cab && part === 'body') return { material: cab.board, grainDeg: i.parts?.body?.grainDeg }
  if (cab && part === 'front') return { material: cab.front, grainDeg: i.parts?.front?.grainDeg }
  const p = i.parts?.[part]
  return p ? { material: p.material, grainDeg: p.grainDeg } : { material: i.material }
}

/** Every material an item uses (for validation and schedules). */
export const itemMaterials = (i: Item, cab?: Cabinet) => [...new Set(PARTS[i.category].map((p) => partMaterial(i, p, cab).material))]

/** Materials a part may take: boards for cabinet parts, any finish otherwise. */
export function partOptions(i: Item, part: string): Material[] {
  if (i.cabinet && (part === 'body' || part === 'front')) return MATERIALS.filter((m) => m.kind === 'board' && m.name.startsWith('MFC'))
  return MATERIALS.filter((m) => m.kind !== 'board')
}
