/**
 * Seed catalogue for the Projects screen (mockup 05): project details, the files / folders of
 * each project and the activity log. Like the rest of the workspace store this is metadata only —
 * the CAD engine owns geometry. All seed entries are demo data (`seed: true`) and the images are
 * DEMO crops from the approved mockup (see MISSING_PRODUCTION_ASSETS.md).
 */
import type { Discipline, FileFormat } from './workspace'

export type ProjectStatus = 'active' | 'in-progress' | 'draft' | 'archived'
export type DisciplineTag = 'architecture' | 'interior' | 'bim' | 'mechanical' | 'mep' | 'civil' | 'structural'
export const ALL_TAGS: DisciplineTag[] = ['architecture', 'interior', 'bim', 'mechanical', 'mep', 'civil', 'structural']
export type EntryCategory = 'drawing' | 'model' | 'document' | 'render'

export interface Person {
  id: string
  name: string
  avatar: string
}

/** Demo people (avatars cropped from the mockup). */
export const PEOPLE: Record<string, Person> = {
  hoang: { id: 'hoang', name: 'Hoàng Trần', avatar: '/assets/v2/people/hoang.png' },
  linh: { id: 'linh', name: 'Linh Nguyễn', avatar: '/assets/v2/people/linh.png' },
  minh: { id: 'minh', name: 'Minh Phạm', avatar: '/assets/v2/people/minh.png' },
}

export interface ProjectDetails {
  status: ProjectStatus
  sharedWithMe?: boolean
  tags: DisciplineTag[]
  /** One-line card text. */
  summary: string
  /** Inspector text. */
  description: string
  cover?: string
  hero?: string
  /** Pre-composited avatar pair on the card (+ count of further members). */
  team?: { image: string; width: number; extra: number }
  members: string[]
  createdBy: string
  startDate: string
  storageQuotaGb: number
  autoSave: { enabled: boolean; minutes: number }
  units: 'metric' | 'imperial'
}

export interface ProjectEntry {
  id: string
  projectId: string
  kind: 'folder' | 'file'
  name: string
  category: EntryCategory | null
  /** Display type: "Folder", "DWG", "RVT" … */
  type: string
  sizeBytes: number | null
  modifiedAt: number
  modifiedBy: string
  /** Containing folder entry; undefined = project root. */
  parentId?: string
}

export interface Activity {
  id: string
  projectId: string
  who: string
  kind: 'updated' | 'added' | 'commented' | 'generated' | 'created' | 'renamed' | 'archived' | 'restored' | 'imported' | 'folder'
  target?: string
  count?: number
  at: number
}

const H = 3600_000
const D = 24 * H
const MB = 1024 ** 2
const GB = 1024 ** 3

const pair = (name: string, extra: number) => ({ image: `/assets/v2/people/pair_${name}.png`, width: 42, extra })
const base = { members: ['hoang', 'linh', 'minh'], createdBy: 'hoang', storageQuotaGb: 20, autoSave: { enabled: true, minutes: 2 }, units: 'metric' as const }

/** Details of the eight projects shown in mockup 05 plus the rest of the 24-project catalogue. */
export const SEED_DETAILS: Record<string, ProjectDetails> = {
  'villa-riverside': {
    ...base,
    status: 'active',
    tags: ['architecture', 'interior', 'mep', 'bim'],
    summary: 'Luxury villa with modern design and landscape integration',
    description: 'Modern luxury villa with pool, landscape and full architectural, interior and MEP design.',
    cover: '/assets/v2/projects/villa-riverside.png',
    hero: '/assets/v2/projects/villa-riverside-hero.png',
    team: pair('villa', 2),
    startDate: '2024-01-10',
  },
  'th-office-building': {
    ...base,
    status: 'active',
    tags: ['bim', 'architecture'],
    summary: '6-storey office building with sustainable design',
    description: 'Six-storey office building with a sustainable façade, coordinated in BIM.',
    cover: '/assets/v2/projects/th-office-building.png',
    team: pair('office', 4),
    startDate: '2024-02-05',
  },
  'pump-assembly': {
    ...base,
    status: 'in-progress',
    tags: ['mechanical', 'mep'],
    summary: 'Centrifugal pump assembly design and documentation',
    description: 'Centrifugal pump assembly: parts, assembly, drawings and bill of materials.',
    cover: '/assets/v2/projects/pump-assembly.png',
    team: pair('pump', 1),
    startDate: '2024-03-18',
  },
  'apartment-interior': {
    ...base,
    status: 'active',
    tags: ['interior', 'architecture'],
    summary: 'Modern apartment interior design and visualization',
    description: 'Apartment interior: layout, furniture, materials and visualisation.',
    cover: '/assets/v2/projects/apartment-interior.png',
    team: pair('apartment', 3),
    startDate: '2024-04-02',
  },
  'factory-extension': {
    ...base,
    status: 'draft',
    tags: ['civil', 'structural'],
    summary: 'Steel structure extension for manufacturing facility',
    description: 'Steel-frame extension of a manufacturing facility.',
    cover: '/assets/v2/projects/factory-extension.png',
    team: pair('factory', 1),
    startDate: '2024-05-06',
  },
  'urban-master-plan': {
    ...base,
    status: 'active',
    tags: ['civil', 'architecture'],
    summary: 'Mixed-use urban development master plan',
    description: 'Master plan for a mixed-use urban development.',
    cover: '/assets/v2/projects/urban-master-plan.png',
    team: pair('urban', 5),
    startDate: '2024-01-22',
  },
  'hospital-building': {
    ...base,
    status: 'active',
    sharedWithMe: true,
    createdBy: 'linh',
    tags: ['architecture', 'mep', 'bim'],
    summary: 'General hospital design with full BIM coordination',
    description: 'General hospital, coordinated across architecture, MEP and structure in BIM.',
    cover: '/assets/v2/projects/hospital-building.png',
    team: pair('hospital', 8),
    startDate: '2023-11-14',
  },
  'bridge-structure': {
    ...base,
    status: 'archived',
    createdBy: 'minh',
    tags: ['civil', 'structural'],
    summary: 'Cable-stayed bridge design and analysis',
    description: 'Cable-stayed bridge: design and structural analysis.',
    cover: '/assets/v2/projects/bridge-structure.png',
    team: pair('bridge', 2),
    startDate: '2023-09-01',
  },
}

const DISC_TAG: Record<Discipline, DisciplineTag> = {
  architectural: 'architecture', bim: 'bim', mechanical: 'mechanical', interior: 'interior', mep: 'mep', civil: 'civil',
}

/** Defaults for projects without seeded details (older seeds, user-created projects). */
export function defaultDetails(discipline: Discipline, status: ProjectStatus = 'active'): ProjectDetails {
  return { ...base, status, tags: [DISC_TAG[discipline]], summary: '', description: '', members: ['hoang'], startDate: new Date().toISOString().slice(0, 10) }
}

/** Extra catalogue projects (not featured in the mockup) so the "All Projects" count is 24. */
export const EXTRA_PROJECTS: [string, string, Discipline, FileFormat, number, number, ProjectStatus, boolean][] = [
  ['factory-extension', 'Factory Extension', 'civil', 'DWG', 60, 7, 'draft', false],
  ['urban-master-plan', 'Urban Master Plan', 'civil', 'DWG', 90, 8, 'active', false],
  ['hospital-building', 'Hospital Building', 'bim', 'RVT', 120, 14, 'active', true],
  ['bridge-structure', 'Bridge Structure', 'civil', 'DWG', 200, 21, 'archived', false],
  ['seed-x1', 'Riverside Park Pavilion', 'architectural', 'DWG', 70, 38, 'draft', false],
  ['seed-x2', 'Warehouse W3 Fit-out', 'interior', 'DWG', 75, 41, 'draft', false],
  ['seed-x3', 'Ring Road Interchange', 'civil', 'DWG', 300, 60, 'archived', false],
  ['seed-x4', 'Hydro Pump Station', 'mep', 'DWG', 260, 75, 'archived', false],
  ['seed-x5', 'Campus Library', 'bim', 'IFC', 100, 30, 'active', true],
  ['seed-x6', 'Conveyor Line CL-2', 'mechanical', 'STEP', 110, 33, 'in-progress', true],
  ['seed-x7', 'Boutique Hotel Lobby', 'interior', 'DWG', 80, 35, 'draft', false],
  ['seed-x8', 'Stormwater Network', 'civil', 'DWG', 150, 45, 'active', true],
]

/** Files and folders of the selected demo project, matching the counts in mockup 05. */
export function seedEntries(now: number): ProjectEntry[] {
  let n = 0
  const out: ProjectEntry[] = []
  const add = (projectId: string, kind: 'folder' | 'file', name: string, category: EntryCategory | null, type: string, size: number | null, ago: number, by: string, parentId?: string) => {
    const id = `e${++n}`
    out.push({ id, projectId, kind, name, category, type, sizeBytes: size, modifiedAt: now - ago, modifiedBy: by, ...(parentId ? { parentId } : {}) })
    return id
  }
  const v = 'villa-riverside'
  // shown rows (mockup order)
  add(v, 'folder', '01_Concept', null, 'Folder', null, 2 * H, 'hoang')
  const arch = add(v, 'folder', '02_Architecture', null, 'Folder', null, 1 * D, 'linh')
  const str = add(v, 'folder', '03_Structural', null, 'Folder', null, 2 * D, 'minh')
  add(v, 'file', 'Floor Plan - Level 1.dwg', 'drawing', 'DWG', 12.4 * MB, 2 * H + 60_000, 'hoang')
  add(v, 'file', '3D Model - Villa.rvt', 'model', 'RVT', 156 * MB, 1 * D + 60_000, 'linh')
  // rest of the project
  const sheets = add(v, 'folder', 'Sheets', null, 'Folder', null, 3 * D, 'linh', arch)
  const details = add(v, 'folder', 'Details', null, 'Folder', null, 4 * D, 'linh', arch)
  add(v, 'folder', 'Calculations', null, 'Folder', null, 5 * D, 'minh', str)
  const drawings = ['Floor Plan - Level 2.dwg', 'Roof Plan.dwg', 'Site Plan.dwg', 'Elevations - North & South.dwg', 'Elevations - East & West.dwg', 'Section A-A.dwg', 'Section B-B.dwg', 'Details - Stair.dwg', 'Details - Pool.dwg', 'Reflected Ceiling Plan.dwg', 'MEP Coordination.dxf']
  drawings.forEach((f, i) => add(v, 'file', f, 'drawing', f.endsWith('.dxf') ? 'DXF' : 'DWG', (4 + i * 0.7) * MB, (3 + i) * D, ['hoang', 'linh', 'minh'][i % 3], f.startsWith('Details') ? details : f.startsWith('Elevations') || f.startsWith('Section') ? sheets : undefined))
  const models = ['Villa - Structure.ifc', 'Villa - MEP.ifc', 'Pool Pump.step', 'Facade Panel.step', 'Site Terrain.skp', 'Furniture Set.skp', 'Site Scan - Point Cloud.e57']
  const msize = [48, 64, 6.5, 3.2, 22, 41, 5_745]
  models.forEach((f, i) => add(v, 'file', f, 'model', f.split('.').pop()!.toUpperCase(), msize[i] * MB, (4 + i) * D, ['linh', 'minh', 'hoang'][i % 3]))
  const docs = ['Design Brief.pdf', 'Area Schedule.xlsx', 'Door Schedule.xlsx', 'Window Schedule.xlsx', 'Specification - Architecture.pdf', 'Specification - MEP.pdf', 'Structural Calculations.pdf', 'Energy Report.pdf', 'Permit Application.pdf', 'Meeting Notes 01.docx', 'Meeting Notes 02.docx', 'Cost Estimate.xlsx', 'Material Board.pdf', 'Landscape Notes.pdf', 'Fire Strategy.pdf', 'Handover Checklist.docx']
  docs.forEach((f, i) => add(v, 'file', f, 'document', f.split('.').pop()!.toUpperCase(), (0.4 + (i % 5) * 0.9) * MB, (5 + i) * D, ['hoang', 'linh', 'minh'][i % 3]))
  const renders = ['Exterior - Front.png', 'Exterior - Pool.png', 'Living Room.png', 'Aerial.png']
  renders.forEach((f, i) => add(v, 'file', f, 'render', 'PNG', (18 + i * 3) * MB, (6 + i) * D, 'hoang'))
  return out
}

export function seedActivity(now: number): Activity[] {
  const v = 'villa-riverside'
  return [
    { id: 'a1', projectId: v, who: 'hoang', kind: 'updated', target: 'Floor Plan - Level 1', at: now - 2 * H },
    { id: 'a2', projectId: v, who: 'linh', kind: 'added', count: 3, at: now - 5 * H },
    { id: 'a3', projectId: v, who: 'minh', kind: 'commented', target: 'Section A-A', at: now - 1 * D },
    { id: 'a4', projectId: v, who: 'ai', kind: 'generated', count: 2, at: now - 1 * D - 60_000 },
  ]
}

export const GB_BYTES = GB
