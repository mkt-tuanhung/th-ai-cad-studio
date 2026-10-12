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
import { actionIcons as I, AllActionsModal, BatchModal, GuideModal } from './DashboardDialogs'
import { cadInbox } from '../../state/cadSession'
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
  const [dialog, setDialog] = useState<'batch' | 'all' | 'guide' | null>(null)

  const openProject = (p: Project) => {
    ws.touchProject(p.id)
    navigate(routeForDiscipline(p.discipline))
  }

  /**
   * Open File: DWG / DXF open in CAD 2D (which reads them and lists them in Recent Files). Other formats
   * are listed only — this build has no reader for them, and we never pretend to have parsed a file.
   */
  const onFilesChosen = (list: FileList | null) => {
    if (!list) return
    const drawings = Array.from(list).filter((f) => /\.(dwg|dxf)$/i.test(f.name))
    if (drawings.length) {
      cadInbox.files = drawings
      navigate('cad2d')
    }
    for (const file of Array.from(list)) {
      if (drawings.includes(file)) continue
      const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
      const format = SUPPORTED_EXTENSIONS[ext]
      if (!format) {
        toast(fmt(t.toast.unsupported, { ext: `.${ext}` }), 'warning')
        continue
      }
      ws.addFile({ name: file.name, format, projectId: null, modifiedAt: file.lastModified || Date.now(), sizeBytes: file.size, source: 'local-import' })
      toast(fmt(t.toast.fileAdded, { name: file.name, format }), 'info')
    }
    if (fileInput.current) fileInput.current.value = ''
  }

  const newDrawing = () => {
    const { name } = useCad.getState().newDrawing()
    ws.addFile({ name, format: 'DWG', projectId: null, modifiedAt: Date.now(), sizeBytes: 0, source: 'new' })
    toast(fmt(t.toast.drawingCreated, { name }), 'success')
    navigate('cad2d')
  }

  const A = t.dashboard.all, Q = t.dashboard.quickActions
  const allActions = [
    { label: Q.newDrawing, icon: <I.File size={18} />, run: newDrawing },
    { label: A.openFile, icon: <I.Upload size={18} />, run: () => fileInput.current?.click() },
    { label: A.newProject, icon: <I.FolderPlus size={18} />, run: () => setNewOpen(true) },
    { label: Q.batch, icon: <I.Layers size={18} />, run: () => setDialog('batch') },
    { label: Q.aiFromSketch, icon: <I.Sparkles size={18} />, run: () => navigate('ai-studio') },
    { label: A.projects, icon: <I.FolderOpen size={18} />, run: () => navigate('projects') },
    { label: A.bim, icon: <I.Box size={18} />, run: () => navigate('bim') },
    { label: A.components, icon: <I.Cpu size={18} />, run: () => navigate('components') },
    { label: A.renders, icon: <I.Image size={18} />, run: () => navigate('renders') },
    { label: A.settings, icon: <I.Settings size={18} />, run: () => navigate('settings') },
  ]

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
          onBatch={() => setDialog('batch')}
          onSeeAll={() => setDialog('all')}
        />
        <LearningCard onOpenGuide={() => setDialog('guide')} />
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
      {dialog === 'batch' && <BatchModal onClose={() => setDialog(null)} />}
      {dialog === 'all' && <AllActionsModal onClose={() => setDialog(null)} actions={allActions} />}
      {dialog === 'guide' && <GuideModal onClose={() => setDialog(null)} go={navigate} />}
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
