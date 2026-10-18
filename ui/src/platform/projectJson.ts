/**
 * Project JSON exchange (SP39): every model workspace in one versioned file — BIM, Interior, CAD 2D drawings, MEP,
 * Civil, Mechanical, Renders — with the persist version of each store, a revision id per workspace (V24-062:
 * renders, drawings and NC made from this file can name the design revision they came from) and the project.
 *
 * Import validates the format, migrates an older store version with that store's own migration, takes a "before
 * import" snapshot and applies each workspace through its validated, undoable edit. Round trip: tools/unit/platform.test.ts.
 */
import { applyStores, APP_VERSION, captureStores, countsOf, MODEL_STORES, revisionOf, snapshotOn, storeVersions, type ApplyResult, type ModelStore, type StoreDocs } from './snapshots'
import { useWorkspace, type Project } from '../state/workspace'

export const PROJECT_FORMAT = 'md-cad-ai-studio/project'
export const PROJECT_SCHEMA = 1
export const PROJECT_EXT = '.mdproj.json'

export interface ProjectFile {
  format: typeof PROJECT_FORMAT
  schema: number
  appVersion: string
  exportedAt: string
  project: Pick<Project, 'id' | 'name' | 'discipline' | 'format'> | null
  storeVersions: Record<ModelStore, number>
  revisions: Record<ModelStore, string>
  counts: Record<ModelStore, Record<string, number>>
  stores: StoreDocs
}

export function exportProject(project?: Project | null, now = new Date()): ProjectFile {
  const ws = useWorkspace.getState()
  const p = project ?? ws.projects.find((x) => x.id === ws.currentId) ?? null
  const stores = captureStores()
  const revisions = {} as Record<ModelStore, string>
  const counts = {} as Record<ModelStore, Record<string, number>>
  for (const s of MODEL_STORES) { revisions[s] = revisionOf(stores[s]); counts[s] = countsOf(s, stores[s]) }
  return {
    format: PROJECT_FORMAT, schema: PROJECT_SCHEMA, appVersion: APP_VERSION, exportedAt: now.toISOString(),
    project: p ? { id: p.id, name: p.name, discipline: p.discipline, format: p.format } : null,
    storeVersions: storeVersions(), revisions, counts, stores,
  }
}

export const projectFileName = (f: ProjectFile) => `${(f.project?.name ?? 'Project').replace(/[\\/:*?"<>|]+/g, '-')}${PROJECT_EXT}`

/** Reads a project file: the parsed file, or why it is not one (`format`, `schema`, `json`, `stores`). */
export function parseProject(text: string): { ok: true; file: ProjectFile } | { ok: false; error: 'json' | 'format' | 'schema' | 'stores' } {
  let v: unknown
  try { v = JSON.parse(text) } catch { return { ok: false, error: 'json' } }
  const f = v as Partial<ProjectFile>
  if (!f || f.format !== PROJECT_FORMAT) return { ok: false, error: 'format' }
  if (typeof f.schema !== 'number' || f.schema > PROJECT_SCHEMA) return { ok: false, error: 'schema' }
  if (!f.stores || typeof f.stores !== 'object' || !Object.keys(f.stores).some((k) => (MODEL_STORES as string[]).includes(k))) return { ok: false, error: 'stores' }
  return { ok: true, file: f as ProjectFile }
}

/** Applies a project file to the workspaces (each one an undo step), after a "before import" snapshot. */
export async function importProject(file: ProjectFile, label: string): Promise<ApplyResult> {
  await snapshotOn('risky', `${label} — before`)
  const r = applyStores(file.stores, label, file.storeVersions)
  await snapshotOn('import', label)
  return r
}
