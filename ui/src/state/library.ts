import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Entity } from '../cad/types'
import { BUILTIN, SEED_RECENT, type LibComponent } from '../library/catalog'
import { bounds } from '../library/shapes'
import { migrateLibrary } from './migrations'

/** Components uploaded by the user (from DXF / DWG): geometry is kept, normalised to (0, 0). */
export interface UploadedComponent {
  id: string
  name: string
  fileName: string
  format: 'DXF' | 'DWG'
  entities: Entity[]
  addedAt: number
  bytes: number
}

export interface InsertPrefs {
  point: 'center' | 'bottom-left' | 'bottom-center'
  rotation: 0 | 90 | 180 | 270
  autoAlign: boolean
  explode: boolean
  currentLayer: boolean
  layer: string
  color: string
  linetype: 'ByLayer' | 'Continuous' | 'Dashed' | 'DashDot'
}

interface LibraryState {
  favorites: string[]
  /** Insert history, newest first. */
  recent: { id: string; at: number }[]
  uses: Record<string, number>
  uploads: UploadedComponent[]
  insert: InsertPrefs
  /** Layer overrides chosen per component in Layer Mapping. */
  layerFor: Record<string, string>
  toggleFavorite: (id: string) => void
  recordUse: (id: string) => void
  addUpload: (u: Omit<UploadedComponent, 'id' | 'addedAt'>) => UploadedComponent
  setInsert: (p: Partial<InsertPrefs>) => void
  setLayerFor: (id: string, layer: string) => void
}

const H = 3_600_000

export const useLibrary = create<LibraryState>()(
  persist(
    (set, get) => {
      const now = Date.now()
      const byName = new Map(BUILTIN.map((c) => [c.name, c.id]))
      return {
        favorites: [],
        recent: SEED_RECENT.map(([name, hours]) => ({ id: byName.get(name)!, at: now - hours * H })),
        uses: {},
        uploads: [],
        insert: { point: 'center', rotation: 0, autoAlign: true, explode: false, currentLayer: true, layer: '', color: 'ByLayer', linetype: 'ByLayer' },
        layerFor: {},
        toggleFavorite: (id) => set({ favorites: get().favorites.includes(id) ? get().favorites.filter((x) => x !== id) : [...get().favorites, id] }),
        recordUse: (id) =>
          set({ recent: [{ id, at: Date.now() }, ...get().recent.filter((r) => r.id !== id)].slice(0, 30), uses: { ...get().uses, [id]: (get().uses[id] ?? 0) + 1 } }),
        addUpload: (u) => {
          const up: UploadedComponent = { ...u, id: `up-${Date.now().toString(36)}`, addedAt: Date.now() }
          set({ uploads: [up, ...get().uploads] })
          return up
        },
        setInsert: (p) => set({ insert: { ...get().insert, ...p } }),
        setLayerFor: (id, layer) => set({ layerFor: { ...get().layerFor, [id]: layer } }),
      }
    },
    // v2: explicit migration (state/migrations.ts)
    { name: 'thcad.library', version: 2, migrate: (p, v) => migrateLibrary(p, v) as LibraryState },
  ),
)

/** An uploaded drawing as a library component (user content, not demo). */
export function uploadAsComponent(u: UploadedComponent): LibComponent {
  const b = bounds(u.entities)
  const w = Math.round(b.max.x - b.min.x), d = Math.round(b.max.y - b.min.y)
  return {
    id: u.id, name: u.name, group: 'blocks', category: 'architecture', kind: 'Block', discipline: 'Architecture', tags: ['Uploaded', u.format],
    size: { w, d }, sizeLabel: `${w} × ${d} mm`, version: 'v1.0', versions: [{ v: 'v1.0', date: new Date(u.addedAt).toISOString().slice(0, 10), note: 'upload', file: u.fileName }],
    addedAt: u.addedAt, popularity: 0, manufacturer: '—', layer: '0', source: 'upload', software: 'AutoCAD',
    plan: () => u.entities,
  }
}

export function allComponents(uploads: UploadedComponent[]): LibComponent[] {
  return [...uploads.map(uploadAsComponent), ...BUILTIN]
}

/** Dashboard stat: real number of components and those added in the last 30 days. */
export function libraryStats(uploads: UploadedComponent[]) {
  const all = allComponents(uploads)
  const month = Date.now() - 30 * 24 * H
  return { total: all.length, addedRecently: all.filter((c) => c.addedAt >= month).length }
}
