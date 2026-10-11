import { Ellipsis } from 'lucide-react'
import { relativeTime, useLang, useT } from '../../i18n'
import { formatBytes, type RecentFile, type Project } from '../../state/workspace'
import { MenuList, PopoverPanel, useDismissable, type MenuItem } from '../../components/ui/Popover'
import s from './RecentFilesTable.module.css'

export function RecentFilesTable({
  files,
  projects,
  now,
  onOpen,
  menuFor,
}: {
  files: RecentFile[]
  projects: Project[]
  now: number
  onOpen: (f: RecentFile) => void
  menuFor: (f: RecentFile) => MenuItem[]
}) {
  const t = useT()
  const lang = useLang()
  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name ?? '—'
  return (
    <div className={s.table} role="table">
      <div className={`${s.row} ${s.header}`} role="row">
        <span role="columnheader">{t.dashboard.table.name}</span>
        <span role="columnheader">{t.dashboard.table.type}</span>
        <span role="columnheader">{t.dashboard.table.project}</span>
        <span role="columnheader">{t.dashboard.table.modified}</span>
        <span role="columnheader">{t.dashboard.table.size}</span>
        <span />
      </div>
      {files.map((f) => (
        <div key={f.id} className={`${s.row} ${s.body}`} role="row" onDoubleClick={() => onOpen(f)}>
          <span role="cell" className={s.nameCell}>
            <FileBadge format={f.format} />
            <button type="button" className={s.name} onClick={() => onOpen(f)}>
              {f.name}
            </button>
          </span>
          <span role="cell">{f.format}</span>
          <span role="cell">{projectName(f.projectId)}</span>
          <span role="cell">{relativeTime(f.modifiedAt, lang, now)}</span>
          <span role="cell">{formatBytes(f.sizeBytes)}</span>
          <RowMenu items={menuFor(f)} label={t.dashboard.moreActions} />
        </div>
      ))}
    </div>
  )
}

function RowMenu({ items, label }: { items: MenuItem[]; label: string }) {
  const [open, setOpen, ref] = useDismissable<HTMLDivElement>()
  return (
    <div className={s.menu} ref={ref} role="cell">
      <button type="button" className={s.more} aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Ellipsis size={17} strokeWidth={2.2} />
      </button>
      {open && (
        <PopoverPanel>
          <MenuList items={items} onClose={() => setOpen(false)} />
        </PopoverPanel>
      )}
    </div>
  )
}

const BADGE: Record<string, { bg: string; letter: string }> = {
  DWG: { bg: 'linear-gradient(160deg, #f0455a 0%, #c8102e 100%)', letter: 'A' },
  DXF: { bg: 'linear-gradient(160deg, #f0455a 0%, #c8102e 100%)', letter: 'A' },
  RVT: { bg: 'linear-gradient(160deg, #3b8cf0 0%, #1f5fc4 100%)', letter: 'R' },
  IFC: { bg: 'linear-gradient(160deg, #2bb3a8 0%, #157f7a 100%)', letter: 'I' },
  STEP: { bg: 'linear-gradient(160deg, #8a96a8 0%, #5b6678 100%)', letter: 'S' },
  STP: { bg: 'linear-gradient(160deg, #8a96a8 0%, #5b6678 100%)', letter: 'S' },
}

export function FileBadge({ format }: { format: string }) {
  const b = BADGE[format] ?? { bg: 'linear-gradient(160deg, #9aa4b2 0%, #6b7586 100%)', letter: format[0] }
  return (
    <span className={s.badge} style={{ background: b.bg }} aria-hidden="true">
      {b.letter}
    </span>
  )
}
