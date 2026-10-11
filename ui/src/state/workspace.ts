import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Project / file catalogue shown on the Dashboard.
 *
 * IMPORTANT: this is UI-level metadata only (name, type, size, timestamps). It does not parse or
 * hold CAD geometry — that is the native CAD engine's job (see docs/ARCHITECTURE.md). Seed entries
 * reproduce the approved mockup and are flagged `seed: true`.
 */

export type Discipline = 'architectural' | 'bim' | 'mechanical' | 'interior' | 'mep' | 'civil'
export type FileFormat = 'DWG' | 'DXF' | 'RVT' | 'IFC' | 'STEP' | 'STP' | 'IGES' | 'PDF' | 'SKP'

export interface Project {
  id: string
  name: string
  discipline: Discipline
  format: FileFormat
  thumbnail?: ThumbRef
  favorite: boolean
  /** Shown as a "V2" chip when > 1. */
  version: number
  /** Pre-composited avatar stack image (extracted from mockup until real user avatars exist). */
  collaborators?: { image: string; width: number; extra?: number }
  createdAt: number
  modifiedAt: number
  seed?: boolean
}

export interface RecentFile {
  id: string
  name: string
  format: FileFormat
  projectId: string | null
  modifiedAt: number
  sizeBytes: number
  source: 'seed' | 'local-import' | 'new'
}

/** Thumbnail asset + the clean region inside it (handoff assets contain bleed from the mockup). */
export interface ThumbRef {
  src: string
  natW: number
  natH: number
  crop: { x: number; y: number; w: number; h: number }
}

const H = 3600_000
const D = 24 * H

const SEED_PROJECTS = (now: number): Project[] => [
  {
    id: 'villa-riverside',
    name: 'Villa Riverside',
    discipline: 'architectural',
    format: 'DWG',
    thumbnail: {
      src: '/assets/dashboard_recent_project_01_floorplan.png',
      natW: 208,
      natH: 115,
      crop: { x: 8, y: 22, w: 188, h: 93 }, // stops before the star baked into the asset
    },
    favorite: true,
    version: 1,
    collaborators: { image: '/assets/extracted/avatars_villa.png', width: 38 },
    createdAt: now - 2 * D,
    modifiedAt: now - 2 * H,
    seed: true,
  },
  {
    id: 'th-office-building',
    name: 'TH Office Building',
    discipline: 'bim',
    format: 'RVT',
    thumbnail: {
      src: '/assets/dashboard_recent_project_02_building.png',
      natW: 208,
      natH: 118,
      crop: { x: 21, y: 24, w: 187, h: 94 },
    },
    favorite: false,
    version: 1,
    collaborators: { image: '/assets/extracted/avatars_office.png', width: 49 },
    createdAt: now - 4 * D,
    modifiedAt: now - 1 * D,
    seed: true,
  },
  {
    id: 'pump-assembly',
    name: 'Pump Assembly',
    discipline: 'mechanical',
    format: 'STEP',
    thumbnail: {
      src: '/assets/dashboard_recent_project_03_mechanical.png',
      natW: 206,
      natH: 118,
      crop: { x: 25, y: 24, w: 181, h: 94 },
    },
    favorite: true,
    version: 2,
    collaborators: { image: '/assets/extracted/avatars_pump.png', width: 23 },
    createdAt: now - 20 * D,
    modifiedAt: now - 3 * D,
    seed: true,
  },
  {
    id: 'apartment-interior',
    name: 'Apartment Interior',
    discipline: 'interior',
    format: 'DWG',
    thumbnail: {
      src: '/assets/dashboard_recent_project_04_interior.png',
      natW: 210,
      natH: 118,
      crop: { x: 32, y: 24, w: 178, h: 94 },
    },
    favorite: false,
    version: 1,
    collaborators: { image: '/assets/extracted/avatars_apartment.png', width: 46 },
    createdAt: now - 6 * D,
    modifiedAt: now - 5 * D,
    seed: true,
  },
  // Older active projects (not in the "recent" four) — make up the "12 Active Projects" stat.
  ...(
    [
      ['Riverside Clubhouse', 'architectural', 'DWG', 8, 9],
      ['Hoa Lac Data Center', 'mep', 'DWG', 9, 11],
      ['Gearbox GX-40', 'mechanical', 'STEP', 12, 14],
      ['Ring Road 4 – Section B', 'civil', 'DWG', 15, 16],
      ['Lakeview Penthouse', 'interior', 'DWG', 17, 18],
      ['TH Factory Phase 2', 'bim', 'IFC', 30, 21],
      ['Sky Garden Tower', 'bim', 'RVT', 40, 24],
      ['HVAC Retrofit – Block C', 'mep', 'DWG', 45, 27],
    ] as const
  ).map(([name, discipline, format, createdDaysAgo, modifiedDaysAgo], i) => ({
    id: `seed-${i}`,
    name,
    discipline,
    format,
    favorite: false,
    version: 1,
    createdAt: now - createdDaysAgo * D,
    modifiedAt: now - modifiedDaysAgo * D,
    seed: true,
  })),
]

const SEED_FILES = (now: number): RecentFile[] => [
  { id: 'f1', name: 'Floor Plan - Level 1.dwg', format: 'DWG', projectId: 'villa-riverside', modifiedAt: now - 2 * H, sizeBytes: 12.4 * 1024 ** 2, source: 'seed' },
  { id: 'f2', name: 'Office Tower - Structural.rvt', format: 'RVT', projectId: 'th-office-building', modifiedAt: now - 1 * D, sizeBytes: 86.2 * 1024 ** 2, source: 'seed' },
  { id: 'f3', name: 'Pump Housing v2.step', format: 'STEP', projectId: 'pump-assembly', modifiedAt: now - 3 * D, sizeBytes: 24.8 * 1024 ** 2, source: 'seed' },
  { id: 'f4', name: 'Living Room Layout.dwg', format: 'DWG', projectId: 'apartment-interior', modifiedAt: now - 5 * D, sizeBytes: 8.1 * 1024 ** 2, source: 'seed' },
]

interface WorkspaceState {
  projects: Project[]
  files: RecentFile[]
  hiddenFromRecent: string[]
  /** Last autosave as reported by the document service. */
  autosave: { at: number; fileName: string }
  seededAt: number
  createProject: (p: { name: string; discipline: Discipline; format: FileFormat }) => Project
  renameProject: (id: string, name: string) => void
  toggleFavorite: (id: string) => void
  removeFromRecent: (id: string) => void
  touchProject: (id: string) => void
  addFile: (f: Omit<RecentFile, 'id'>) => RecentFile
  removeFile: (id: string) => void
}

const uid = () => Math.random().toString(36).slice(2, 10)

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set, get) => {
      const now = Date.now()
      return {
        projects: SEED_PROJECTS(now),
        files: SEED_FILES(now),
        hiddenFromRecent: [],
        autosave: { at: now - 2 * 60_000, fileName: 'Project_Villa_A.dwg' },
        seededAt: now,
        createProject: ({ name, discipline, format }) => {
          const t = Date.now()
          const p: Project = { id: uid(), name, discipline, format, favorite: false, version: 1, createdAt: t, modifiedAt: t }
          set({ projects: [p, ...get().projects] })
          return p
        },
        renameProject: (id, name) =>
          set({ projects: get().projects.map((p) => (p.id === id ? { ...p, name, modifiedAt: Date.now() } : p)) }),
        toggleFavorite: (id) =>
          set({ projects: get().projects.map((p) => (p.id === id ? { ...p, favorite: !p.favorite } : p)) }),
        removeFromRecent: (id) => set({ hiddenFromRecent: [...get().hiddenFromRecent, id] }),
        touchProject: (id) =>
          set({
            projects: get().projects.map((p) => (p.id === id ? { ...p, modifiedAt: Date.now() } : p)),
            hiddenFromRecent: get().hiddenFromRecent.filter((x) => x !== id),
          }),
        addFile: (f) => {
          const file: RecentFile = { ...f, id: uid() }
          set({ files: [file, ...get().files] })
          return file
        },
        removeFile: (id) => set({ files: get().files.filter((f) => f.id !== id) }),
      }
    },
    { name: 'thcad.workspace', version: 1 },
  ),
)

export const recentProjects = (s: WorkspaceState) =>
  [...s.projects]
    .filter((p) => !s.hiddenFromRecent.includes(p.id))
    .sort((a, b) => b.modifiedAt - a.modifiedAt)
    .slice(0, 4)

export const SUPPORTED_EXTENSIONS: Record<string, FileFormat> = {
  dwg: 'DWG', dxf: 'DXF', rvt: 'RVT', ifc: 'IFC', step: 'STEP', stp: 'STP', iges: 'IGES', igs: 'IGES', pdf: 'PDF', skp: 'SKP',
}

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${n} B`
}
