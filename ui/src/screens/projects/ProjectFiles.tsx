import { useMemo, useState } from 'react'
import { ChevronLeft, Ellipsis, Folder, Image as ImageIcon, LayoutGrid, List, Plus } from 'lucide-react'
import { fmt, relativeTime, useLang, useT } from '../../i18n'
import { formatBytes, useWorkspace, type Project } from '../../state/workspace'
import { PEOPLE, type EntryCategory, type ProjectEntry } from '../../state/projectSeed'
import { useCad } from '../../state/cad'
import { cadInbox } from '../../state/cadSession'
import { useRouter } from '../../state/router'
import { MenuList, PopoverPanel, useDismissable, type MenuItem } from '../../components/ui/Popover'
import { RenameEntryModal } from './ProjectsModals'
import s from './ProjectFiles.module.css'

/** Content of files imported in this session (the catalogue itself only keeps metadata). */
export const sessionFiles = new Map<string, File>()

type FileTab = 'all' | EntryCategory | 'folder'
/** Tab slot widths measured on mockup 05 (its tab text centres are not evenly spaced). */
const TAB_W = [71, 98, 87, 118, 97, 90]

const BADGE: Record<string, [string, string]> = {
  DWG: ['A', '#d6303f'], DXF: ['A', '#d6303f'], RVT: ['R', '#1f5fd1'], IFC: ['I', '#0f8a8f'], STEP: ['S', '#56657a'], STP: ['S', '#56657a'],
  IGES: ['G', '#56657a'], SKP: ['S', '#c2410c'], E57: ['P', '#7c3aed'], PDF: ['P', '#b91c1c'], XLSX: ['X', '#15803d'], DOCX: ['W', '#1d4ed8'],
}

export function EntryIcon({ e }: { e: ProjectEntry }) {
  if (e.kind === 'folder') return <Folder className={s.folderIcon} size={18} strokeWidth={1.2} fill="currentColor" />
  if (e.category === 'render') return <span className={s.imgIcon}><ImageIcon size={13} strokeWidth={2} /></span>
  const [letter, color] = BADGE[e.type] ?? [e.type.slice(0, 1) || '?', '#64748b']
  return <span className={s.badge} style={{ background: color }}>{letter}</span>
}

export function ProjectFiles({ project }: { project: Project | null }) {
  const t = useT()
  const F = t.projects.files
  const lang = useLang()
  const ws = useWorkspace()
  const navigate = useRouter((st) => st.navigate)
  const newDrawing = useCad((st) => st.newDrawing)
  const [tab, setTab] = useState<FileTab>('all')
  const [folder, setFolder] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'grid'>('list')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<ProjectEntry | null>(null)
  const [newOpen, setNewOpen, newRef] = useDismissable<HTMLDivElement>()
  const now = Date.now()

  const all = useMemo(() => (project ? ws.entries.filter((e) => e.projectId === project.id) : []), [ws.entries, project])
  const count = (c: FileTab) => all.filter((e) => (c === 'folder' ? e.kind === 'folder' : e.category === c)).length

  const rows = useMemo(() => {
    let r: ProjectEntry[]
    if (tab === 'all') r = all.filter((e) => (e.parentId ?? null) === folder)
    else if (tab === 'folder') r = all.filter((e) => e.kind === 'folder')
    else r = all.filter((e) => e.category === tab)
    // folders first (by name), then files, newest first
    return [...r].sort((a, b) => (a.kind !== b.kind ? (a.kind === 'folder' ? -1 : 1) : a.kind === 'folder' ? a.name.localeCompare(b.name) : b.modifiedAt - a.modifiedAt))
  }, [all, tab, folder])

  const openFolder = all.find((e) => e.id === folder)
  const tabs: [FileTab, string][] = [
    ['all', F.all],
    ['drawing', fmt(F.drawings, { n: count('drawing') })],
    ['model', fmt(F.models, { n: count('model') })],
    ['document', fmt(F.documents, { n: count('document') })],
    ['render', fmt(F.renders, { n: count('render') })],
    ['folder', fmt(F.folders, { n: count('folder') })],
  ]

  const openInCad = (e: ProjectEntry) => {
    const file = sessionFiles.get(e.id)
    if (!file) return
    cadInbox.files = [file]
    navigate('cad2d')
  }

  const menuFor = (e: ProjectEntry): MenuItem[] => [
    ...(e.kind === 'folder' ? [{ label: t.projects.menu.open, onSelect: () => { setTab('all'); setFolder(e.id) } }] : []),
    ...(sessionFiles.has(e.id) && /^(DWG|DXF)$/.test(e.type) ? [{ label: F.openInCad, onSelect: () => openInCad(e) }] : []),
    { label: F.rename, onSelect: () => setRenaming(e) },
    { label: F.remove, onSelect: () => ws.removeEntries([e.id, ...all.filter((x) => x.parentId === e.id).map((x) => x.id)]), danger: true },
  ]

  const allChecked = rows.length > 0 && rows.every((r) => checked.has(r.id))
  const toggle = (id: string) => setChecked((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <section className={s.card} aria-label={F.title}>
      <div className={s.head}>
        <h2 className={s.title}>{F.title}</h2>
        <div className={s.tabs} role="tablist">
          {tabs.map(([id, label], i) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`${s.tab} ${tab === id ? s.tabOn : ''}`}
              style={{ minWidth: TAB_W[i] }}
              onClick={() => { setTab(id); setFolder(null) }}>
              {label}
            </button>
          ))}
        </div>
        <div className={s.newWrap} ref={newRef}>
          <button type="button" className={s.newBtn} disabled={!project} aria-expanded={newOpen} onClick={() => setNewOpen(!newOpen)}>
            <Plus size={16} strokeWidth={2} />
            {F.newFile}
          </button>
          {newOpen && project && (
            <PopoverPanel width={200}>
              <MenuList onClose={() => setNewOpen(false)} items={[{
                label: F.newDrawing,
                onSelect: () => {
                  const doc = newDrawing()
                  ws.addEntries(project.id, [{ kind: 'file', name: doc.name, category: 'drawing', type: 'DWG', sizeBytes: 0, modifiedAt: Date.now(), modifiedBy: 'hoang', ...(folder ? { parentId: folder } : {}) }])
                  navigate('cad2d')
                },
              }]} />
            </PopoverPanel>
          )}
        </div>
        <div className={s.views}>
          <button type="button" className={`${s.viewBtn} ${view === 'grid' ? s.viewOn : ''}`} aria-pressed={view === 'grid'} aria-label={t.projects.gridView} onClick={() => setView('grid')}>
            <LayoutGrid size={16} strokeWidth={1.8} />
          </button>
          <button type="button" className={`${s.viewBtn} ${view === 'list' ? s.viewOn : ''}`} aria-pressed={view === 'list'} aria-label={t.projects.listView} onClick={() => setView('list')}>
            <List size={16} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {openFolder && tab === 'all' && (
        <button type="button" className={s.up} onClick={() => setFolder(openFolder.parentId ?? null)}>
          <ChevronLeft size={14} strokeWidth={2} /> {F.all} / {openFolder.name}
        </button>
      )}

      {!project ? (
        <p className={s.empty}>{F.noProject}</p>
      ) : view === 'list' ? (
        <div className={s.table} role="table">
          <div className={`${s.row} ${s.headRow}`} role="row">
            <span role="columnheader"><input type="checkbox" checked={allChecked} aria-label={F.selectAll}
              onChange={() => setChecked(allChecked ? new Set() : new Set(rows.map((r) => r.id)))} /></span>
            <span role="columnheader" className={s.nameHead}>{F.cols.name}</span>
            <span role="columnheader">{F.cols.type}</span>
            <span role="columnheader">{F.cols.size}</span>
            <span role="columnheader">{F.cols.modified}</span>
            <span role="columnheader">{F.cols.by}</span>
            <span />
          </div>
          <div className={s.body}>
            {rows.map((e) => (
              <FileRow key={e.id} e={e} checked={checked.has(e.id)} onCheck={() => toggle(e.id)} menu={menuFor(e)}
                onOpen={() => (e.kind === 'folder' ? (setTab('all'), setFolder(e.id)) : openInCad(e))}
                typeLabel={e.kind === 'folder' ? F.folder : e.type} time={relativeTime(e.modifiedAt, lang, now)} />
            ))}
            {rows.length === 0 && <p className={s.empty}>{F.empty}</p>}
          </div>
        </div>
      ) : (
        <div className={s.tiles}>
          {rows.map((e) => (
            <button key={e.id} type="button" className={s.tile} onDoubleClick={() => (e.kind === 'folder' ? (setTab('all'), setFolder(e.id)) : openInCad(e))}>
              <EntryIcon e={e} />
              <span>{e.name}</span>
            </button>
          ))}
          {rows.length === 0 && <p className={s.empty}>{F.empty}</p>}
        </div>
      )}

      {renaming && (
        <RenameEntryModal entry={renaming} onClose={() => setRenaming(null)} onSave={(name) => { ws.renameEntry(renaming.id, name); setRenaming(null) }} />
      )}
    </section>
  )
}

function FileRow({ e, checked, onCheck, menu, onOpen, typeLabel, time }: {
  e: ProjectEntry; checked: boolean; onCheck: () => void; menu: MenuItem[]; onOpen: () => void; typeLabel: string; time: string
}) {
  const t = useT()
  const [open, setOpen, ref] = useDismissable<HTMLDivElement>()
  const by = PEOPLE[e.modifiedBy]
  return (
    <div className={`${s.row} ${checked ? s.rowOn : ''}`} role="row" onDoubleClick={onOpen}>
      <span role="cell"><input type="checkbox" checked={checked} onChange={onCheck} aria-label={fmt(t.projects.files.select, { name: e.name })} /></span>
      <span role="cell" className={s.iconCell}><EntryIcon e={e} /></span>
      <span role="cell" className={s.name}>{e.name}</span>
      <span role="cell" className={s.muted}>{typeLabel}</span>
      <span role="cell" className={s.muted}>{e.sizeBytes == null ? '--' : formatBytes(e.sizeBytes).replace(/\.0 /, ' ')}</span>
      <span role="cell" className={s.muted}>{time}</span>
      <span role="cell" className={s.by}>
        {by && <img src={by.avatar} alt="" />}
        {by?.name ?? e.modifiedBy}
      </span>
      <span role="cell" className={s.menu} ref={ref}>
        <button type="button" aria-label={`${t.projects.menu.more}: ${e.name}`} aria-expanded={open} onClick={() => setOpen(!open)}>
          <Ellipsis size={16} strokeWidth={2} />
        </button>
        {open && (
          <PopoverPanel width={190}>
            <MenuList items={menu} onClose={() => setOpen(false)} />
          </PopoverPanel>
        )}
      </span>
    </div>
  )
}
