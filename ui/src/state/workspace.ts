import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  defaultDetails, EXTRA_PROJECTS, seedActivity, seedEntries, SEED_DETAILS,
  type Activity, type ProjectDetails, type ProjectEntry, type ProjectStatus,
} from './projectSeed'

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
  /** Projects screen (mockup 05): status, tags, team, settings … */
  details?: ProjectDetails
}

export const detailsOf = (p: Project): ProjectDetails => p.details ?? defaultDetails(p.discipline)
export const statusOf = (p: Project): ProjectStatus => detailsOf(p).status
/** "Active Projects" on the Dashboard: my own projects that are being worked on. */
export const isActiveOwn = (p: Project) => {
  const d = detailsOf(p)
  return (d.status === 'active' || d.status === 'in-progress') && !d.sharedWithMe
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

const SEED_PROJECTS = (now: number): Project[] => ([
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
      ['Riverside Clubhouse', 'architectural', 'DWG', 28, 22],
      ['Hoa Lac Data Center', 'mep', 'DWG', 29, 23],
      ['Gearbox GX-40', 'mechanical', 'STEP', 32, 24],
      ['Ring Road 4 – Section B', 'civil', 'DWG', 35, 25],
      ['Lakeview Penthouse', 'interior', 'DWG', 37, 26],
      ['TH Factory Phase 2', 'bim', 'IFC', 40, 27],
      ['Sky Garden Tower', 'bim', 'RVT', 45, 29],
      ['HVAC Retrofit – Block C', 'mep', 'DWG', 50, 36],
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
    details: defaultDetails(discipline, name.startsWith('HVAC') ? 'archived' : 'active'),
  })),
  // rest of the 24-project catalogue (mockup 05)
  ...EXTRA_PROJECTS.map(([id, name, discipline, format, createdDaysAgo, modifiedDaysAgo, status, shared]) => ({
    id,
    name,
    discipline,
    format,
    favorite: false,
    version: 1,
    createdAt: now - createdDaysAgo * D,
    modifiedAt: now - modifiedDaysAgo * D,
    seed: true,
    details: SEED_DETAILS[id] ?? { ...defaultDetails(discipline, status), sharedWithMe: shared, createdBy: shared ? 'linh' : 'hoang' },
  })),
] as Project[]).map((p) => (SEED_DETAILS[p.id] && !p.details ? { ...p, details: SEED_DETAILS[p.id] } : p))

const SEED_FILES = (now: number): RecentFile[] => [
  { id: 'f1', name: 'Floor Plan - Level 1.dwg', format: 'DWG', projectId: 'villa-riverside', modifiedAt: now - 2 * H, sizeBytes: 12.4 * 1024 ** 2, source: 'seed' },
  { id: 'f2', name: 'Office Tower - Structural.rvt', format: 'RVT', projectId: 'th-office-building', modifiedAt: now - 1 * D, sizeBytes: 86.2 * 1024 ** 2, source: 'seed' },
  { id: 'f3', name: 'Pump Housing v2.step', format: 'STEP', projectId: 'pump-assembly', modifiedAt: now - 3 * D, sizeBytes: 24.8 * 1024 ** 2, source: 'seed' },
  { id: 'f4', name: 'Living Room Layout.dwg', format: 'DWG', projectId: 'apartment-interior', modifiedAt: now - 5 * D, sizeBytes: 8.1 * 1024 ** 2, source: 'seed' },
]

interface WorkspaceState {
  projects: Project[]
  files: RecentFile[]
  /** Files and folders inside projects (Projects screen). */
  entries: ProjectEntry[]
  activity: Activity[]
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
  updateDetails: (id: string, patch: Partial<ProjectDetails>) => void
  setStatus: (id: string, status: ProjectStatus) => void
  addEntries: (projectId: string, entries: Omit<ProjectEntry, 'id' | 'projectId'>[]) => ProjectEntry[]
  renameEntry: (id: string, name: string) => void
  removeEntries: (ids: string[]) => void
  log: (a: Omit<Activity, 'id' | 'at'>) => void
}

const uid = () => Math.random().toString(36).slice(2, 10)

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set, get) => {
      const now = Date.now()
      return {
        projects: SEED_PROJECTS(now),
        files: SEED_FILES(now),
        entries: seedEntries(now),
        activity: seedActivity(now),
        hiddenFromRecent: [],
        autosave: { at: now - 2 * 60_000, fileName: 'Project_Villa_A.dwg' },
        seededAt: now,
        createProject: ({ name, discipline, format }) => {
          const t = Date.now()
          const p: Project = { id: uid(), name, discipline, format, favorite: false, version: 1, createdAt: t, modifiedAt: t, details: defaultDetails(discipline) }
          set({ projects: [p, ...get().projects] })
          get().log({ projectId: p.id, who: 'hoang', kind: 'created', target: name })
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
        updateDetails: (id, patch) =>
          set({
            projects: get().projects.map((p) => (p.id === id ? { ...p, details: { ...detailsOf(p), ...patch }, modifiedAt: Date.now() } : p)),
          }),
        setStatus: (id, status) => {
          const before = get().projects.find((p) => p.id === id)
          get().updateDetails(id, { status })
          if (before && statusOf(before) !== status && (status === 'archived' || statusOf(before) === 'archived'))
            get().log({ projectId: id, who: 'hoang', kind: status === 'archived' ? 'archived' : 'restored', target: before.name })
        },
        addEntries: (projectId, list) => {
          const t = Date.now()
          const created = list.map((e) => ({ ...e, id: uid(), projectId, modifiedAt: e.modifiedAt ?? t }))
          set({
            entries: [...created, ...get().entries],
            projects: get().projects.map((p) => (p.id === projectId ? { ...p, modifiedAt: t } : p)),
          })
          return created
        },
        renameEntry: (id, name) => set({ entries: get().entries.map((e) => (e.id === id ? { ...e, name, modifiedAt: Date.now(), modifiedBy: 'hoang' } : e)) }),
        removeEntries: (ids) => {
          const drop = new Set(ids)
          set({ entries: get().entries.filter((e) => !drop.has(e.id)) })
        },
        log: (a) => set({ activity: [{ ...a, id: uid(), at: Date.now() }, ...get().activity].slice(0, 500) }),
      }
    },
    {
      name: 'thcad.workspace',
      version: 2,
      // v1 → v2 (Projects screen): keep the user's projects and files, add details, the rest of the
      // seed catalogue, project entries and the activity log.
      migrate: (old, version) => {
        const s = old as Partial<WorkspaceState>
        if (version < 2) {
          const now = Date.now()
          const seed = SEED_PROJECTS(now)
          const byId = new Map(seed.map((p) => [p.id, p]))
          const projects = (s.projects ?? []).map((p) => {
            const sp = byId.get(p.id)
            return p.details ? p : { ...p, details: sp?.details ?? defaultDetails(p.discipline), ...(sp && p.seed ? { modifiedAt: sp.modifiedAt } : {}) }
          })
          const have = new Set(projects.map((p) => p.id))
          return { ...s, projects: [...projects, ...seed.filter((p) => !have.has(p.id))], entries: seedEntries(now), activity: seedActivity(now) }
        }
        return s
      },
    },
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
