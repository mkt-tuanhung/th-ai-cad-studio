/**
 * Versioned migrations of the persisted workspaces (V24-063: an old project opens without data loss).
 *
 * Rules: a migration only ADDS what an older version lacks (an empty list, a default setting) and repairs what was
 * provably broken; it never replaces the user's content with sample data. Each function takes the persisted state
 * and the version it was saved with, and is wired as the store's zustand `persist({ migrate })`.
 * tools/unit/platform.test.ts loads old-version fixtures through these functions and checks every value survives.
 */
import { ROOMS, roomOverlap, type Room } from '../interior/model'
import { LAYERS } from '../cad/seed'
import type { CadDocument } from '../cad/types'
import { DEFAULT_FX, DEFAULT_SETTINGS } from '../renders/model'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** Shallow default fill: keys missing in `v` (undefined) take the default; present values are kept as they are. */
function fill<T extends Obj>(v: unknown, defaults: T): T {
  if (!isObj(v)) return v as T
  const out: Obj = { ...v }
  for (const [k, d] of Object.entries(defaults)) if (out[k] === undefined) out[k] = d
  return out as T
}

/* ---------------------------------------------------------------- Interior (v1 → v2, fixed) */

/**
 * v1 → v2 corrected two sample outlines (Bedroom 1 / Laundry overlapped their neighbours). The old migration
 * replaced ALL rooms with the sample rooms, which lost the user's own rooms, names and finishes (and orphaned their
 * furniture). Now: every room is kept; only a sample room (same id) whose outline still overlaps a neighbour gets the
 * corrected sample outline — its name, height and finishes stay the user's.
 */
export function migrateInterior<S>(persisted: S, version: number): S {
  const st = persisted as { doc?: { rooms?: Room[] } }
  if (version >= 2 || !st?.doc || !Array.isArray(st.doc.rooms)) return persisted
  const rooms = st.doc.rooms
  const seed = new Map(ROOMS.map((r) => [r.id, r]))
  const fixed = rooms.map((r, i) => {
    const s = seed.get(r.id)
    if (!s || !Array.isArray(r.outline)) return r
    const overlaps = rooms.some((o, j) => j !== i && Array.isArray(o.outline) && roomOverlap(r.outline, o.outline) > 0)
    return overlaps ? { ...r, outline: s.outline } : r
  })
  return { ...st, doc: { ...st.doc, rooms: fixed } } as S
}

/* ---------------------------------------------------------------- CAD 2D (v1 → v2) */

/** v1 → v2: drawings kept; a drawing without layers / blocks / current layer gets the defaults; tabs and the
 *  active drawing point at drawings that exist. */
export function migrateCad<S>(persisted: S, version: number): S {
  const st = persisted as { docs?: Record<string, CadDocument>; tabs?: string[]; activeId?: string | null }
  if (version >= 2 || !isObj(st) || !isObj(st.docs)) return persisted
  const docs: Record<string, CadDocument> = {}
  for (const [id, d] of Object.entries(st.docs)) {
    if (!isObj(d)) continue
    const doc = d as unknown as CadDocument
    docs[id] = {
      ...doc,
      id: doc.id ?? id,
      entities: Array.isArray(doc.entities) ? doc.entities : [],
      layers: Array.isArray(doc.layers) && doc.layers.length ? doc.layers : LAYERS,
      currentLayer: doc.currentLayer ?? '0',
      blocks: Array.isArray(doc.blocks) ? doc.blocks : [],
      underlay: doc.underlay ?? null,
      dirty: !!doc.dirty,
      savedAt: doc.savedAt ?? null,
      source: doc.source ?? 'new',
    }
  }
  const tabs = (Array.isArray(st.tabs) ? st.tabs : Object.keys(docs)).filter((t) => docs[t])
  const activeId = st.activeId && docs[st.activeId] ? st.activeId : (tabs[0] ?? null)
  return { ...st, docs, tabs, activeId } as S
}

/* ---------------------------------------------------------------- Civil (v1 → v2) */

const CIVIL_PARAMS = { bottomWidth: 8, sideSlope: 2, freeboard: 0.5, manningN: 0.015, discharge: 6.7, slopeMin: 0.0005, slopeMax: 0.005, lining: 'Concrete (M250)', liningT: 0.12 }

/** v1 → v2: the route is kept as it is (survey, plan, sections…); missing design parameters and lists are filled. */
export function migrateCivil<S>(persisted: S, version: number): S {
  const st = persisted as { doc?: Obj }
  if (version >= 2 || !isObj(st) || !isObj(st.doc)) return persisted
  const doc = { ...st.doc, params: fill(st.doc.params ?? {}, CIVIL_PARAMS), culverts: Array.isArray(st.doc.culverts) ? st.doc.culverts : [], invert: Array.isArray(st.doc.invert) ? st.doc.invert : [] }
  return { ...st, doc } as S
}

/* ---------------------------------------------------------------- Mechanical (v1 → v2) */

export function migrateMech<S>(persisted: S, version: number): S {
  const st = persisted as { doc?: Obj }
  if (version >= 2 || !isObj(st) || !isObj(st.doc)) return persisted
  const d = st.doc
  const list = (k: string) => (Array.isArray(d[k]) ? d[k] : [])
  return { ...st, doc: { ...d, params: list('params'), components: list('components'), bom: list('bom'), mates: list('mates'), configs: list('configs'), parts: list('parts') } } as S
}

/* ---------------------------------------------------------------- Renders (v1 → v2) */

export function migrateRenders<S>(persisted: S, version: number): S {
  const st = persisted as { doc?: Obj; history?: unknown[] }
  if (version >= 2 || !isObj(st)) return persisted
  const out: Obj = { ...st, history: Array.isArray(st.history) ? st.history : [] }
  if (isObj(st.doc)) {
    const d = st.doc
    out.doc = { ...d, cameras: Array.isArray(d.cameras) ? d.cameras : [], queue: Array.isArray(d.queue) ? d.queue : [], custom: Array.isArray(d.custom) ? d.custom : [], settings: fill(d.settings ?? {}, DEFAULT_SETTINGS as unknown as Obj), fx: fill(d.fx ?? {}, DEFAULT_FX as unknown as Obj) }
  }
  return out as S
}

/* ---------------------------------------------------------------- Library (v1 → v2) */

const INSERT = { point: 'center', rotation: 0, autoAlign: true, explode: false, currentLayer: true, layer: '', color: 'ByLayer', linetype: 'ByLayer' }

export function migrateLibrary<S>(persisted: S, version: number): S {
  const st = persisted as Obj
  if (version >= 2 || !isObj(st)) return persisted
  const arr = (k: string) => (Array.isArray(st[k]) ? st[k] : [])
  return { ...st, favorites: arr('favorites'), recent: arr('recent'), uploads: arr('uploads'), uses: isObj(st.uses) ? st.uses : {}, layerFor: isObj(st.layerFor) ? st.layerFor : {}, insert: fill(st.insert ?? {}, INSERT) } as S
}
