import { useMemo, useRef, useState } from 'react'
import { Archive, ChevronDown, Clock, FileText, Folder, FolderOpen, LayoutGrid, List, Plus, Search, Upload, Users } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { detailsOf, statusOf, SUPPORTED_EXTENSIONS, useWorkspace, type Discipline, type Project } from '../../state/workspace'
import type { DisciplineTag, EntryCategory, ProjectStatus } from '../../state/projectSeed'
import { ALL_TAGS } from '../../state/projectSeed'
import { useRouter } from '../../state/router'
import { toast } from '../../state/toast'
import { routeForDiscipline } from '../../lib/routes'
import { useDismissable, PopoverPanel, MenuList } from '../../components/ui/Popover'
import { NewProjectModal, RenameProjectModal } from '../dashboard/ProjectModals'
import { ProjectGridCard } from './ProjectGridCard'
import { ProjectInspector } from './ProjectInspector'
import { ProjectFiles, sessionFiles } from './ProjectFiles'
import { NewFolderModal, TemplateModal } from './ProjectsModals'
import { openHistory } from '../../platform/ui'
import { createFromTemplate } from '../../platform/templateApply'
import { templateById } from '../../platform/templates'
import s from './ProjectsScreen.module.css'

type Tab = 'all' | 'recent' | 'shared' | 'archived'
type Sort = 'modified' | 'name' | 'created'
const WEEK = 7 * 24 * 3600_000
/** Tab slot widths measured on mockup 05 (tab icons at x 297 / 465 / 579 / 692). */
const TAB_W = [171, 112, 113, 0] // incl. 14 px trailing padding

const CATEGORY_OF: Record<string, EntryCategory> = {
  DWG: 'drawing', DXF: 'drawing', PDF: 'document', RVT: 'model', IFC: 'model', STEP: 'model', STP: 'model', IGES: 'model', SKP: 'model',
}

export function ProjectsScreen() {
  const t = useT()
  const T = t.projects
  const navigate = useRouter((st) => st.navigate)
  const ws = useWorkspace()
  const [tab, setTab] = useState<Tab>('all')
  const [query, setQuery] = useState('')
  const [discipline, setDiscipline] = useState<'' | DisciplineTag>('')
  const [status, setStatus] = useState<'' | ProjectStatus>('')
  const [sort, setSort] = useState<Sort>('modified')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [selectedId, setSelectedId] = useState<string>('villa-riverside')
  const [modal, setModal] = useState<null | 'new' | 'folder' | 'template' | { rename: Project }>(null)
  const [splitOpen, setSplitOpen, splitRef] = useDismissable<HTMLDivElement>()
  const fileInput = useRef<HTMLInputElement>(null)
  const now = Date.now()

  const counts = useMemo(() => {
    const ps = ws.projects
    return {
      all: ps.length,
      recent: ps.filter((p) => now - p.modifiedAt < WEEK).length,
      shared: ps.filter((p) => detailsOf(p).sharedWithMe).length,
      archived: ps.filter((p) => statusOf(p) === 'archived').length,
    }
  }, [ws.projects, now])

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = ws.projects.filter((p) => {
      const d = detailsOf(p)
      if (tab === 'recent' && now - p.modifiedAt >= WEEK) return false
      if (tab === 'shared' && !d.sharedWithMe) return false
      if (tab === 'archived' && d.status !== 'archived') return false
      if (discipline && !d.tags.includes(discipline)) return false
      if (status && d.status !== status) return false
      if (q && !`${p.name} ${d.summary} ${d.tags.join(' ')}`.toLowerCase().includes(q)) return false
      return true
    })
    rows.sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : sort === 'created' ? b.createdAt - a.createdAt : b.modifiedAt - a.modifiedAt))
    return rows
  }, [ws.projects, tab, discipline, status, sort, query, now])

  const selected = ws.projects.find((p) => p.id === selectedId) ?? null

  const open = (p: Project) => {
    ws.touchProject(p.id)
    navigate(routeForDiscipline(p.discipline))
  }

  const archiveToggle = (p: Project) => {
    const archived = statusOf(p) === 'archived'
    ws.setStatus(p.id, archived ? 'active' : 'archived')
    toast(fmt(archived ? T.toast.restored : T.toast.archived, { name: p.name }), 'success')
  }

  const importFiles = (files: FileList | null) => {
    if (!files?.length || !selected) return
    const picked = Array.from(files)
    const entries = picked.map((f) => {
      const ext = f.name.split('.').pop()?.toUpperCase() ?? ''
      const known = SUPPORTED_EXTENSIONS[ext.toLowerCase()]
      const category: EntryCategory = known ? CATEGORY_OF[known] : /^(PNG|JPE?G|TIFF?|EXR|HDR)$/.test(ext) ? 'render' : 'document'
      return { kind: 'file' as const, name: f.name, category, type: ext || '—', sizeBytes: f.size, modifiedAt: f.lastModified || Date.now(), modifiedBy: 'hoang' }
    })
    // keep the content of this session's imports so "Open in CAD 2D" works (catalogue = metadata)
    ws.addEntries(selected.id, entries).forEach((e, i) => sessionFiles.set(e.id, picked[i]))
    ws.log({ projectId: selected.id, who: 'hoang', kind: 'imported', count: entries.length })
    toast(fmt(T.toast.imported, { n: entries.length, project: selected.name }), 'success')
    if (fileInput.current) fileInput.current.value = ''
  }

  const tabs: { id: Tab; label: string; Icon: typeof Folder }[] = [
    { id: 'all', label: T.tabs.all, Icon: Folder },
    { id: 'recent', label: T.tabs.recent, Icon: Clock },
    { id: 'shared', label: T.tabs.shared, Icon: Users },
    { id: 'archived', label: T.tabs.archived, Icon: Archive },
  ]

  return (
    <div className={s.screen}>
      <header className={s.header}>
        <div>
          <h1 className={s.title}>{T.title}</h1>
          <p className={s.subtitle}>{T.subtitle}</p>
        </div>
        <div className={s.actions}>
          <div className={s.split} ref={splitRef}>
            <button type="button" className={s.splitMain} onClick={() => setModal('new')}>
              <Plus size={19} strokeWidth={2} />
              <span>{T.newProject}</span>
            </button>
            <button type="button" className={s.splitMore} aria-label={T.newProjectMenu} aria-expanded={splitOpen} onClick={() => setSplitOpen(!splitOpen)}>
              <ChevronDown size={16} strokeWidth={2} />
            </button>
            {splitOpen && (
              <PopoverPanel width={210}>
                <MenuList
                  onClose={() => setSplitOpen(false)}
                  items={[
                    { label: T.blankProject, onSelect: () => setModal('new') },
                    { label: T.fromTemplate, onSelect: () => setModal('template') },
                    { label: T.importFiles, onSelect: () => fileInput.current?.click() },
                  ]}
                />
              </PopoverPanel>
            )}
          </div>
          <button type="button" className={s.action} style={{ width: 157 }} onClick={() => fileInput.current?.click()} disabled={!selected}>
            <Upload size={19} strokeWidth={1.7} />
            <span>{T.importFiles}</span>
          </button>
          <button type="button" className={s.action} style={{ width: 158 }} onClick={() => setModal('folder')} disabled={!selected}>
            <FolderOpen size={19} strokeWidth={1.7} />
            <span>{T.newFolder}</span>
          </button>
          <button type="button" className={s.action} style={{ width: 202, paddingLeft: 40 }} onClick={() => setModal('template')}>
            <FileText size={19} strokeWidth={1.7} />
            <span>{T.fromTemplate}</span>
          </button>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => importFiles(e.target.files)} />
        </div>
      </header>

      <section className={s.left}>
        <div className={s.tabs} role="tablist">
          {tabs.map(({ id, label, Icon }, i) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`${s.tab} ${tab === id ? s.tabOn : ''}`} onClick={() => setTab(id)}
              style={{ minWidth: TAB_W[i] }}>
              {id === 'all' && tab === id ? <Folder size={17} strokeWidth={1.8} fill="currentColor" /> : <Icon size={17} strokeWidth={1.7} />}
              <span>{label}</span>
              {id === 'all' && <span className={s.count}>{counts.all}</span>}
              {id !== 'all' && tab === id && <span className={s.count}>{counts[id]}</span>}
            </button>
          ))}
        </div>

        <div className={s.filters}>
          <label className={s.search}>
            <Search size={17} strokeWidth={1.8} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={T.search} aria-label={T.search} />
          </label>
          <SelectBox width={156} value={discipline} onChange={(v) => setDiscipline(v as DisciplineTag | '')} label={T.allDisciplines}
            options={[['', T.allDisciplines], ...ALL_TAGS.map((k) => [k, T.tags[k]] as [string, string])]} />
          <SelectBox width={142} value={status} onChange={(v) => setStatus(v as ProjectStatus | '')} label={T.allStatuses}
            options={[['', T.allStatuses], ...(['active', 'in-progress', 'draft', 'archived'] as const).map((k) => [k, T.status[k]] as [string, string])]} />
          <SelectBox width={192} value={sort} onChange={(v) => setSort(v as Sort)} label={T.sort.modified}
            options={(['modified', 'name', 'created'] as const).map((k) => [k, T.sort[k]] as [string, string])} />
          <div className={s.viewToggle}>
            <button type="button" className={`${s.viewBtn} ${view === 'grid' ? s.viewOn : ''}`} aria-pressed={view === 'grid'} aria-label={T.gridView} onClick={() => setView('grid')}>
              <LayoutGrid size={17} strokeWidth={1.8} />
            </button>
            <button type="button" className={`${s.viewBtn} ${view === 'list' ? s.viewOn : ''}`} aria-pressed={view === 'list'} aria-label={T.listView} onClick={() => setView('list')}>
              <List size={17} strokeWidth={1.8} />
            </button>
          </div>
        </div>

        <div className={view === 'grid' ? s.grid : s.listView}>
          {list.map((p) => (
            <ProjectGridCard
              key={p.id}
              project={p}
              now={now}
              layout={view}
              selected={p.id === selectedId}
              onSelect={() => setSelectedId(p.id)}
              onOpen={() => open(p)}
              onToggleFavorite={() => ws.toggleFavorite(p.id)}
              menu={[
                { label: T.menu.open, onSelect: () => open(p) },
                { label: T.menu.rename, onSelect: () => setModal({ rename: p }) },
                { label: p.favorite ? T.menu.unfavorite : T.menu.favorite, onSelect: () => ws.toggleFavorite(p.id) },
                { label: statusOf(p) === 'archived' ? T.menu.restore : T.menu.archive, onSelect: () => archiveToggle(p) },
                { label: t.platform.history.open, onSelect: () => { ws.touchProject(p.id); openHistory() } },
              ]}
            />
          ))}
          {list.length === 0 && <p className={s.empty}>{T.empty}</p>}
        </div>

        <ProjectFiles project={selected} />
      </section>

      <ProjectInspector project={selected} />

      {modal === 'new' && (
        <NewProjectModal
          onClose={() => setModal(null)}
          onCreate={(p) => {
            const created = ws.createProject(p)
            setSelectedId(created.id)
            setTab('all')
            setModal(null)
            toast(fmt(t.toast.projectCreated, { name: created.name }), 'success')
          }}
        />
      )}
      {modal === 'template' && (
        <TemplateModal
          onClose={() => setModal(null)}
          onCreateContent={async (id, name) => {
            const { project, result } = await createFromTemplate(id, name, fmt(t.platform.templates.created, { name, tpl: t.platform.templates.items[id].name, v: templateById(id).version }))
            setSelectedId(project.id)
            setTab('all')
            setModal(null)
            for (const e of result.errors) toast(fmt(t.platform.history.failed, { store: t.platform.history.stores[e.store], error: e.error }), 'warning')
            toast(fmt(t.platform.templates.created, { name, tpl: t.platform.templates.items[id].name, v: templateById(id).version }), 'success')
          }}
          onCreate={(name: string, discipline: Discipline, folders: string[]) => {
            const created = ws.createProject({ name, discipline, format: discipline === 'mechanical' ? 'STEP' : discipline === 'bim' ? 'IFC' : 'DWG' })
            ws.addEntries(created.id, folders.map((f) => ({ kind: 'folder' as const, name: f, category: null, type: 'Folder', sizeBytes: null, modifiedAt: Date.now(), modifiedBy: 'hoang' })))
            setSelectedId(created.id)
            setTab('all')
            setModal(null)
            toast(fmt(t.toast.projectCreated, { name }), 'success')
          }}
        />
      )}
      {modal === 'folder' && selected && (
        <NewFolderModal
          onClose={() => setModal(null)}
          onCreate={(name) => {
            ws.addEntries(selected.id, [{ kind: 'folder', name, category: null, type: 'Folder', sizeBytes: null, modifiedAt: Date.now(), modifiedBy: 'hoang' }])
            ws.log({ projectId: selected.id, who: 'hoang', kind: 'folder', target: name })
            toast(fmt(T.toast.folderCreated, { name }), 'success')
            setModal(null)
          }}
        />
      )}
      {modal && typeof modal === 'object' && 'rename' in modal && (
        <RenameProjectModal
          project={modal.rename}
          onClose={() => setModal(null)}
          onSave={(name) => {
            ws.renameProject(modal.rename.id, name)
            ws.log({ projectId: modal.rename.id, who: 'hoang', kind: 'renamed', target: name })
            setModal(null)
          }}
        />
      )}
    </div>
  )
}

/** Native select styled like the mockup's dropdown fields (keyboard + screen-reader friendly). */
export function SelectBox({ value, onChange, options, width, label, className }: {
  value: string
  onChange: (v: string) => void
  options: [string, string][]
  width?: number
  label: string
  className?: string
}) {
  return (
    <label className={`${s.select} ${className ?? ''}`} style={{ width }}>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
      <ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
    </label>
  )
}
