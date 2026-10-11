import { useRef, useState } from 'react'
import { fmt, useT } from '../../i18n'
import { useRouter } from '../../state/router'
import { toast } from '../../state/toast'
import {
  recentProjects,
  SUPPORTED_EXTENSIONS,
  useWorkspace,
  type Project,
} from '../../state/workspace'
import { routeForDiscipline } from '../../lib/routes'
import { useCad } from '../../state/cad'
import { useNow } from '../../lib/useNow'
import { LinkButton, SectionHeader } from '../../components/ui/SectionHeader'
import { HeroCard } from './HeroCard'
import { CategoryGrid } from './CategoryGrid'
import { StatsRow } from './StatsRow'
import { ProjectCard } from './ProjectCard'
import { RecentFilesTable } from './RecentFilesTable'
import { LocalAiCard } from './LocalAiCard'
import { QuickActions } from './QuickActions'
import { LearningCard } from './LearningCard'
import { NewProjectModal, RenameProjectModal } from './ProjectModals'
import s from './DashboardScreen.module.css'

const ACCEPT = Object.keys(SUPPORTED_EXTENSIONS).map((e) => `.${e}`).join(',')

export function DashboardScreen() {
  const t = useT()
  const navigate = useRouter((st) => st.navigate)
  const ws = useWorkspace()
  const recent = recentProjects(ws)
  const now = useNow(30_000)
  const fileInput = useRef<HTMLInputElement>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [renaming, setRenaming] = useState<Project | null>(null)

  const openProject = (p: Project) => {
    ws.touchProject(p.id)
    navigate(routeForDiscipline(p.discipline))
  }

  /**
   * Open File: the browser prototype can only read file metadata. Geometry is opened by the native
   * CAD engine once the desktop host is attached — we never pretend to have parsed the file.
   */
  const onFilesChosen = (list: FileList | null) => {
    if (!list) return
    for (const file of Array.from(list)) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
      const format = SUPPORTED_EXTENSIONS[ext]
      if (!format) {
        toast(fmt(t.toast.unsupported, { ext: `.${ext}` }), 'warning')
        continue
      }
      ws.addFile({ name: file.name, format, projectId: null, modifiedAt: file.lastModified || Date.now(), sizeBytes: file.size, source: 'local-import' })
      toast(fmt(t.toast.fileAdded, { name: file.name }), 'success')
    }
    if (fileInput.current) fileInput.current.value = ''
  }

  const newDrawing = () => {
    const { name } = useCad.getState().newDrawing()
    ws.addFile({ name, format: 'DWG', projectId: null, modifiedAt: Date.now(), sizeBytes: 0, source: 'new' })
    toast(fmt(t.toast.drawingCreated, { name }), 'success')
    navigate('cad2d')
  }

  const notImplemented = (feature: string) => toast(fmt(t.toast.notImplemented, { feature }))

  return (
    <div className={s.layout}>
      <main className={`${s.main} scroll-y`}>
        <HeroCard onNewProject={() => setNewOpen(true)} onOpenFile={() => fileInput.current?.click()} />
        <div className={s.gapCats}>
          <CategoryGrid />
        </div>
        <div className={s.gapStats}>
          <StatsRow />
        </div>

        <SectionHeader
          className={s.sectionHead}
          title={t.dashboard.recentProjects}
          action={<LinkButton onClick={() => navigate('projects')}>{t.dashboard.viewAll}</LinkButton>}
        />
        <div className={s.projects}>
          {recent.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              now={now}
              onOpen={() => openProject(p)}
              onToggleFavorite={() => ws.toggleFavorite(p.id)}
              menu={[
                { label: t.dashboard.projectMenu.open, onSelect: () => openProject(p) },
                { label: t.dashboard.projectMenu.rename, onSelect: () => setRenaming(p) },
                { label: t.dashboard.projectMenu.removeRecent, onSelect: () => ws.removeFromRecent(p.id), danger: true },
              ]}
            />
          ))}
        </div>

        <SectionHeader
          className={s.sectionHead2}
          title={t.dashboard.recentFiles}
          action={<LinkButton onClick={() => navigate('projects')}>{t.dashboard.viewAll}</LinkButton>}
        />
        <div className={s.files}>
          <RecentFilesTable
            files={ws.files}
            projects={ws.projects}
            now={now}
            onOpen={(f) => navigate(f.format === 'RVT' || f.format === 'IFC' ? 'bim' : 'cad2d')}
            menuFor={(f) => [
              { label: t.dashboard.fileMenu.open, onSelect: () => navigate(f.format === 'RVT' || f.format === 'IFC' ? 'bim' : 'cad2d') },
              { label: t.dashboard.fileMenu.remove, onSelect: () => ws.removeFile(f.id), danger: true },
            ]}
          />
        </div>
      </main>

      <aside className={`${s.rail} scroll-y`}>
        <LocalAiCard onOpenAssistant={() => navigate('ai-studio')} />
        <QuickActions
          onNewDrawing={newDrawing}
          onImport={() => fileInput.current?.click()}
          onAiSketch={() => navigate('ai-studio')}
          onBatch={() => notImplemented(t.dashboard.quickActions.batch)}
          onSeeAll={() => notImplemented(t.dashboard.quickActions.title)}
        />
        <LearningCard onOpenGuide={() => notImplemented(t.dashboard.learning.title)} />
      </aside>

      <input ref={fileInput} type="file" accept={ACCEPT} multiple hidden onChange={(e) => onFilesChosen(e.target.files)} />

      {newOpen && (
        <NewProjectModal
          onClose={() => setNewOpen(false)}
          onCreate={(data) => {
            const p = ws.createProject(data)
            setNewOpen(false)
            toast(fmt(t.toast.projectCreated, { name: p.name }), 'success')
          }}
        />
      )}
      {renaming && (
        <RenameProjectModal
          project={renaming}
          onClose={() => setRenaming(null)}
          onSave={(name) => {
            ws.renameProject(renaming.id, name)
            setRenaming(null)
          }}
        />
      )}
    </div>
  )
}
