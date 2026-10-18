/**
 * v2.4 local render pipeline — pure logic (no host, unit-tested in tools/unit/render.test.ts):
 * scene revisions, camera bookmarks, render provenance, Day / Golden / Night presets, material option
 * batches, the render memory guard and a GLB reader for round-trip checks.
 *
 * Every render, its sidecar and every GLB snapshot are PRESENTATION ONLY: the semantic mm model stays the
 * source of truth and nothing here feeds dimensions, BOM, quantities or CNC.
 */
import type { Scene, SceneItem } from '../engine3d/scene'

export const PRESENTATION_ONLY = 'PRESENTATION ONLY - not for dimensions, BOM, quantities or CNC'

/* ------------------------------------------------------------------ revisions */

/** FNV-1a 64-bit of a string (hex, 16 chars) — stable across sessions and platforms. */
export function fnv1a64(s: string): string {
  let h = 0xcbf29ce484222325n
  const p = 0x100000001b3n
  const bytes = new TextEncoder().encode(s)
  for (const b of bytes) h = ((h ^ BigInt(b)) * p) & 0xffffffffffffffffn
  return h.toString(16).padStart(16, '0')
}

/** JSON with sorted keys, so two equal models give the same text whatever the key order. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

/** Revision of the scene a render sees: hash of its full specification (geometry, colours, layers). */
export const sceneRevision = (spec: unknown) => fnv1a64(canonicalJson(spec)).slice(0, 12)

/* ------------------------------------------------------------------ camera bookmarks (SP41, V24-015) */

export type V3 = [number, number, number]
export type BookmarkSource = 'bim' | 'interior' | 'renders'

export interface CameraBookmark {
  id: string
  name: string
  source: BookmarkSource
  /** Camera (mm, scene frame, Z up): position, target, up vector, vertical field of view (°), lens (mm on a 24 mm sensor height). */
  eye: V3
  at: V3
  up: V3
  fov: number
  lens: number
  /** BIM level / interior level shown, the hidden + isolated items and the section (clip) state. */
  level?: string
  visibility: { hidden: string[]; keep: string[] }
  section: { on: boolean; around: string[]; top?: number; planes?: number[][] }
  /** Viewport display mode + lighting preset when it was saved. */
  mode?: string
  lighting?: LightingPreset
  /** Scene id and revision the view was saved against. */
  sceneId: string
  sceneRev: string
  /** Render settings saved with the view (Renders); others use the current settings. */
  render?: Record<string, unknown>
  created: number
}

/** 35 mm-style lens for a vertical field of view on a 24 mm sensor height (and back). */
export const lensFromFov = (fovDeg: number) => 12 / Math.tan(((fovDeg * Math.PI) / 180) / 2)
export const fovFromLens = (lensMm: number) => (2 * Math.atan(12 / lensMm) * 180) / Math.PI

export function makeBookmark(p: Omit<CameraBookmark, 'id' | 'lens' | 'created' | 'up'> & { up?: V3; lens?: number; id?: string; created?: number }): CameraBookmark {
  return {
    ...p,
    id: p.id ?? `bm-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    up: p.up ?? [0, 0, 1],
    lens: p.lens ?? Math.round(lensFromFov(p.fov) * 100) / 100,
    created: p.created ?? Date.now(),
    visibility: { hidden: [...p.visibility.hidden], keep: [...p.visibility.keep] },
    section: { ...p.section, around: [...p.section.around], ...(p.section.planes ? { planes: p.section.planes.map((q) => [...q]) } : {}) },
  }
}

const near = (a: number[], b: number[], tol: number) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= tol)

/** Two camera states are the same view (restore check): position / target within `tol` mm, up and fov exact to 1e-6. */
export function sameCamera(a: { eye: number[]; at: number[]; up?: number[]; fov: number }, b: { eye: number[]; at: number[]; up?: number[]; fov: number }, tol = 0.01): boolean {
  const ua = a.up ?? [0, 0, 1], ub = b.up ?? [0, 0, 1]
  const n = (v: number[]) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l) }
  return near(a.eye, b.eye, tol) && near(a.at, b.at, tol) && near(n(ua), n(ub), 1e-6) && Math.abs(a.fov - b.fov) < 1e-6
}

/** Bookmark restore: every part of the saved state is back (camera, level, visibility, section). */
export function sameBookmarkState(bm: CameraBookmark, s: { eye: number[]; at: number[]; up?: number[]; fov: number; level?: string; hidden: string[]; keep: string[]; section: CameraBookmark['section'] }): boolean {
  const eqSet = (x: string[], y: string[]) => x.length === y.length && [...x].sort().join('|') === [...y].sort().join('|')
  return sameCamera(bm, s) && (bm.level ?? '') === (s.level ?? '') && eqSet(bm.visibility.hidden, s.hidden) && eqSet(bm.visibility.keep, s.keep) &&
    bm.section.on === s.section.on && canonicalJson({ ...bm.section, on: undefined }) === canonicalJson({ ...s.section, on: undefined })
}

/* ------------------------------------------------------------------ lighting presets (SP40, V24-044) */

export type LightingPreset = 'standard' | 'day' | 'golden' | 'night'
export const LIGHTING_PRESETS: LightingPreset[] = ['day', 'golden', 'night']

/** Render-settings side of a preset (sun / sky); never geometry. */
export const LIGHTING_PATCH: Record<'day' | 'golden' | 'night', { lighting: 'day' | 'golden' | 'night'; sunSky: boolean; sunIntensity: number; sunDirection: number; sunElevation: number; hdri: string }> = {
  day: { lighting: 'day', sunSky: true, sunIntensity: 1.2, sunDirection: 320, sunElevation: 40, hdri: 'Outdoor - Clear Sky' },
  golden: { lighting: 'golden', sunSky: true, sunIntensity: 0.8, sunDirection: 250, sunElevation: 9, hdri: 'Outdoor - Clear Sky' },
  night: { lighting: 'night', sunSky: false, sunIntensity: 0, sunDirection: 320, sunElevation: 40, hdri: 'Outdoor - Clear Sky' },
}

/** Lighting preset of render settings (explicit, else derived from the sun / sky the OCCT renderer uses). */
export function lightingOf(s: { lighting?: string; sunSky: boolean; sunIntensity: number; sunElevation?: number; hdri: string }): 'day' | 'golden' | 'night' | 'overcast' | 'studio' {
  if (s.lighting === 'day' || s.lighting === 'golden' || s.lighting === 'night') return s.lighting
  if (!s.sunSky && s.sunIntensity === 0) return 'night'
  if (s.hdri === 'Outdoor - Overcast') return 'overcast'
  if (s.hdri === 'Studio - Soft Box') return 'studio'
  return (s.sunElevation ?? 40) <= 15 ? 'golden' : 'day'
}

/* ------------------------------------------------------------------ material groups + options (SP46) */

export interface MaterialOverride { rgb: V3; mat: NonNullable<SceneItem['mat']> }
export type MaterialOptionKey = 'design' | 'timber' | 'concrete' | 'marble'

/** Presentation material options of the same model: each recolours whole material groups, geometry identical. */
export const MATERIAL_OPTIONS: { key: MaterialOptionKey; overrides: Record<string, MaterialOverride> }[] = [
  { key: 'design', overrides: {} },
  { key: 'timber', overrides: { floor: { rgb: [0.55, 0.38, 0.22], mat: 'glossy' }, furniture: { rgb: [0.62, 0.44, 0.28], mat: 'glossy' }, cabinet: { rgb: [0.58, 0.4, 0.25], mat: 'glossy' }, stair: { rgb: [0.5, 0.34, 0.2], mat: 'glossy' } } },
  { key: 'concrete', overrides: { wall: { rgb: [0.6, 0.6, 0.58], mat: 'matte' }, 'wall-exterior': { rgb: [0.55, 0.55, 0.53], mat: 'matte' }, floor: { rgb: [0.5, 0.5, 0.49], mat: 'matte' }, furniture: { rgb: [0.7, 0.72, 0.75], mat: 'metal' }, cabinet: { rgb: [0.25, 0.25, 0.27], mat: 'matte' } } },
  { key: 'marble', overrides: { floor: { rgb: [0.93, 0.92, 0.89], mat: 'glossy' }, wall: { rgb: [0.96, 0.95, 0.93], mat: 'matte' }, 'wall-exterior': { rgb: [0.95, 0.94, 0.91], mat: 'matte' }, cabinet: { rgb: [0.95, 0.95, 0.95], mat: 'glossy' }, structure: { rgb: [0.9, 0.89, 0.86], mat: 'glossy' } } },
]

/** Material group of an interior scene item (room floor, room walls, glass, light fixtures, cabinets, furniture). */
export function interiorGroup(it: SceneItem, category?: string, cabinet?: boolean): string {
  if (it.id.startsWith('room:')) return 'floor'
  if (it.id.startsWith('walls:')) return 'wall'
  if (it.mat === 'glass') return 'glass'
  if (category === 'lighting' || it.mat === 'emissive') return 'light'
  if (cabinet) return 'cabinet'
  return 'furniture'
}

/** Material group of a BIM extra (columns, slabs, stairs, roofs, railings, components; the building walls / glazing / floor slabs are grouped natively). */
export function bimGroup(id: string, kinds: { columns: Set<string>; slabs: Set<string>; ceilings: Set<string>; stairs: Set<string>; railings: Set<string>; roofs: Set<string>; components: Set<string> }): string {
  if (id.endsWith(':frame')) return 'metal'
  const base = id.split(':')[0]
  if (kinds.ceilings.has(base)) return 'ceiling'
  if (kinds.slabs.has(base)) return 'floor'
  if (kinds.stairs.has(base)) return 'stair'
  if (kinds.railings.has(base)) return 'metal'
  if (kinds.roofs.has(base)) return 'roof'
  if (kinds.components.has(base)) return 'furniture'
  return 'structure'
}

/** Scene with the overrides applied (OCCT path: the same primitives, only rgb / mat change). */
export function applyOverrides<T extends Scene>(scene: T, overrides: Record<string, MaterialOverride>): T {
  if (!Object.keys(overrides).length) return scene
  return { ...scene, items: scene.items.map((it) => { const o = it.group ? overrides[it.group] : undefined; return o ? { ...it, rgb: [...o.rgb] as V3, mat: o.mat } : it }) }
}

/** Geometry of a scene without colours / surfaces (two material options must give the same text). */
export const geometryKey = (scene: Scene) => canonicalJson(scene.items.map((it) => ({ id: it.id, parts: it.parts, cuts: it.cuts, part: it.part, fuse: it.fuse })))

/** Same naming as the native GLB writer (native/libs/geom_occt/src/gltf.cpp glbMaterialName). */
export function glbMaterialName(mat: string | undefined, rgb: number[], transparency = 0): string {
  const b = (c: number) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')
  const t = Math.round(Math.min(1, Math.max(0, transparency)) * 100)
  return `md:${mat || 'matte'}:${b(rgb[0])}${b(rgb[1])}${b(rgb[2])}${t > 0 ? `:t${t}` : ''}`
}

/* ------------------------------------------------------------------ memory guard (SP44, V24-046) */

/** Same estimate as the host (HostBridge renderMemoryBytes), bytes. */
export function renderMemoryBytes(w: number, h: number, engine: 'occt' | 'blender'): number {
  const px = w * h
  return engine === 'blender' ? 900 * 1024 * 1024 + px * 120 : 300 * 1024 * 1024 + px * 110
}
export const memoryOk = (w: number, h: number, engine: 'occt' | 'blender', budgetBytes: number) => renderMemoryBytes(w, h, engine) <= budgetBytes

/* ------------------------------------------------------------------ jobs */

export type RunStatus = 'waiting' | 'rendering' | 'done' | 'failed' | 'cancelled'

/** Final status of a job from the host's last progress event: a cancelled or broken render is never "done". */
export function finalStatus(p: { ok?: boolean; error?: string; path?: string; preview?: string }, needsFile = true): RunStatus {
  if (p.error === 'cancelled') return 'cancelled'
  if (!p.ok) return 'failed'
  return needsFile && !p.path && !p.preview ? 'failed' : 'done'
}

/** What a queued job captured when it was queued (scene snapshot). */
export interface JobSnapshot {
  sceneId: string
  sceneRev: string
  /** Geometry hash from the kernel (ids, exact volumes, bounds). */
  geomHash?: string
  /** GLB of the scene (Blender jobs), its hash and size. */
  glb?: string
  glbSha256?: string
  nodes?: number
  /** Live OCCT frame from the job camera at queue time (before / after comparison). */
  frame?: string
  camera: { eye: number[]; at: number[]; up: number[]; fov: number; lens: number }
  capturedAt: number
}

/** The provenance the host writes next to the image (plus image / engine info it adds itself). */
export function provenanceOf(job: { id: string; camera: string; cameraId?: string; created: number; bookmarkId?: string; variant?: { key: string; overrides: Record<string, MaterialOverride> } }, snap: JobSnapshot | undefined, settings: Record<string, unknown>, engine: 'blender' | 'occt', fallback?: string) {
  return {
    presentationOnly: true,
    label: PRESENTATION_ONLY,
    scene: snap ? { id: snap.sceneId, revision: snap.sceneRev, geometryHash: snap.geomHash, glb: snap.glb, glbSha256: snap.glbSha256, nodes: snap.nodes, capturedAt: new Date(snap.capturedAt).toISOString() } : null,
    camera: snap?.camera ?? null,
    cameraName: job.camera,
    cameraId: job.cameraId,
    bookmarkId: job.bookmarkId,
    frame3d: snap?.frame,
    materialOption: job.variant ? { key: job.variant.key, overrides: job.variant.overrides } : null,
    settings,
    requestedEngine: engine,
    fallback: fallback ?? null,
    enqueuedAt: new Date(job.created || Date.now()).toISOString(),
  }
}

/* ------------------------------------------------------------------ GLB reader (round-trip checks) */

export interface GlbInfo {
  version: number
  nodes: { name: string; mesh?: number; extras?: Record<string, unknown> }[]
  materials: string[]
  /** Material name used by each node (by node name). */
  nodeMaterial: Record<string, string>
  /** Bounds from the POSITION accessors' min / max, glTF metres Y up. */
  boundsM: [number, number, number, number, number, number]
  /** The same box back in the scene frame (mm, Z up): x0 y0 z0 x1 y1 z1. */
  boundsMm: [number, number, number, number, number, number]
  triangles: number
  asset: Record<string, unknown>
}

/** Parses a GLB (header, JSON chunk, BIN chunk length) and reads its accessors' bounds. */
export function parseGlb(bytes: Uint8Array): GlbInfo {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB (magic)')
  const version = dv.getUint32(4, true)
  const total = dv.getUint32(8, true)
  if (total !== bytes.byteLength) throw new Error(`GLB length ${total} ≠ file ${bytes.byteLength}`)
  const jsonLen = dv.getUint32(12, true)
  if (dv.getUint32(16, true) !== 0x4e4f534a) throw new Error('first chunk is not JSON')
  const gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)))
  const binAt = 20 + jsonLen
  const binLen = dv.getUint32(binAt, true)
  if (dv.getUint32(binAt + 4, true) !== 0x004e4942) throw new Error('second chunk is not BIN')
  if (binLen !== gltf.buffers?.[0]?.byteLength) throw new Error('BIN length ≠ buffers[0].byteLength')
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  let triangles = 0
  const nodeMaterial: Record<string, string> = {}
  for (const n of gltf.nodes ?? []) {
    const mesh = gltf.meshes?.[n.mesh]
    for (const p of mesh?.primitives ?? []) {
      const a = gltf.accessors[p.attributes.POSITION]
      for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k], a.min[k])), (hi[k] = Math.max(hi[k], a.max[k]))
      const view = gltf.bufferViews[gltf.accessors[p.indices].bufferView]
      if (view.byteOffset + view.byteLength > binLen) throw new Error('bufferView past the BIN chunk')
      triangles += gltf.accessors[p.indices].count / 3
      nodeMaterial[n.name] = gltf.materials[p.material]?.name
    }
  }
  const boundsM = [lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]] as GlbInfo['boundsM']
  // glTF (x, y, z) m = scene (x, z, −y) / 1000  ⇒  scene x = gx, y = −gz, z = gy
  const boundsMm = [lo[0] * 1000, -hi[2] * 1000, lo[1] * 1000, hi[0] * 1000, -lo[2] * 1000, hi[1] * 1000] as GlbInfo['boundsMm']
  return { version, nodes: gltf.nodes ?? [], materials: (gltf.materials ?? []).map((m: { name: string }) => m.name), nodeMaterial, boundsM, boundsMm, triangles, asset: gltf.asset ?? {} }
}
