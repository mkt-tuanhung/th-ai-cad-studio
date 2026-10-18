/**
 * Creates a project from a content template: the project with its folders and file entries, then the template's
 * BIM model / Interior design loaded into those workspaces (each one an undo step, after a "before template"
 * snapshot in Version history) and its plan drawing opened in CAD 2D as a new drawing.
 */
import { useCad } from '../state/cad'
import { useWorkspace, type Project } from '../state/workspace'
import { applyStores, snapshotOn, type ApplyResult } from './snapshots'
import { templateById, type TemplateId } from './templates'

export async function createFromTemplate(id: TemplateId, name: string, label: string): Promise<{ project: Project; result: ApplyResult }> {
  const t = templateById(id)
  const ws = useWorkspace.getState()
  const now = Date.now()
  const content = t.build(now)
  const project = ws.createProject({ name, discipline: t.discipline, format: t.discipline === 'bim' ? 'IFC' : 'DWG' })
  const folders = ws.addEntries(project.id, t.folders.map((f) => ({ kind: 'folder' as const, name: f, category: null, type: 'Folder', sizeBytes: null, modifiedAt: now, modifiedBy: 'hoang' })))
  const size = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length
  const files: Parameters<typeof ws.addEntries>[1] = [
    { kind: 'file', name: content.cad.name, category: 'drawing', type: 'DWG', sizeBytes: size(content.cad), modifiedAt: now, modifiedBy: 'hoang', parentId: folders[1]?.id },
  ]
  if (content.bim) files.push({ kind: 'file', name: `${name} - BIM model (template ${t.id} v${t.version}).ifc`, category: 'model', type: 'IFC', sizeBytes: size(content.bim), modifiedAt: now, modifiedBy: 'hoang', parentId: folders[0]?.id })
  if (content.interior) files.push({ kind: 'file', name: `${name} - Interior (template ${t.id} v${t.version}).json`, category: 'model', type: 'JSON', sizeBytes: size(content.interior), modifiedAt: now, modifiedBy: 'hoang', parentId: folders[2]?.id ?? folders[0]?.id })
  ws.addEntries(project.id, files)
  await snapshotOn('risky', `${label} — before`)
  const result = applyStores({ bim: content.bim, interior: content.interior }, label)
  useCad.getState().openDocument(content.cad)
  await snapshotOn('template', label)
  return { project, result }
}
