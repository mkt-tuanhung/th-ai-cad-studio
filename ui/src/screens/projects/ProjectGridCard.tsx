import { EllipsisVertical, Star } from 'lucide-react'
import { fmt, relativeTime, useLang, useT } from '../../i18n'
import { detailsOf, type Project } from '../../state/workspace'
import { MenuList, PopoverPanel, useDismissable, type MenuItem } from '../../components/ui/Popover'
import { DisciplineGlyph } from './DisciplineGlyph'
import s from './ProjectGridCard.module.css'

export interface ProjectGridCardProps {
  project: Project
  now: number
  layout: 'grid' | 'list'
  selected: boolean
  onSelect: () => void
  onOpen: () => void
  onToggleFavorite: () => void
  menu: MenuItem[]
}

/** Badge shown on the thumbnail: shared projects say "Shared", otherwise the project status. */
export function badgeOf(p: Project): 'active' | 'in-progress' | 'draft' | 'archived' | 'shared' {
  const d = detailsOf(p)
  return d.status === 'archived' ? 'archived' : d.sharedWithMe ? 'shared' : d.status
}

export function StatusBadge({ kind, className }: { kind: ReturnType<typeof badgeOf>; className?: string }) {
  const t = useT()
  return (
    <span className={`${s.badge} ${s[`b_${kind.replace('-', '_')}`]} ${className ?? ''}`}>
      <i />
      {t.projects.status[kind]}
    </span>
  )
}

export function ProjectGridCard({ project: p, now, layout, selected, onSelect, onOpen, onToggleFavorite, menu }: ProjectGridCardProps) {
  const t = useT()
  const T = t.projects
  const lang = useLang()
  const d = detailsOf(p)
  const [menuOpen, setMenuOpen, menuRef] = useDismissable<HTMLDivElement>()
  const [footOpen, setFootOpen, footRef] = useDismissable<HTMLDivElement>()
  const kind = badgeOf(p)
  const modified = fmt(T.modified, { time: relativeTime(p.modifiedAt, lang, now) })

  const thumb = d.cover ? (
    <img className={s.img} src={d.cover} alt="" draggable={false} />
  ) : (
    <div className={`${s.img} ${s.noImg}`}>
      <DisciplineGlyph discipline={p.discipline} />
    </div>
  )
  const tags = d.tags.slice(0, layout === 'grid' ? 2 : 3).map((tag, i) => (
    <span key={tag} className={`${s.tag} ${tag === 'bim' ? s.tagBlue : selected && i === 0 ? s.tagTeal : ''}`}>
      {T.tags[tag]}
    </span>
  ))
  const kebab = (open: boolean, setOpen: (v: boolean) => void, ref: React.RefObject<HTMLDivElement | null>, cls: string) => (
    <div className={cls} ref={ref}>
      <button type="button" className={s.kebab} aria-label={`${T.menu.more}: ${p.name}`} aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen(!open) }}>
        <EllipsisVertical size={16} strokeWidth={2} />
      </button>
      {open && (
        <PopoverPanel width={180}>
          <MenuList items={menu} onClose={() => setOpen(false)} />
        </PopoverPanel>
      )}
    </div>
  )
  const star = (
    <button
      type="button"
      className={`${s.star} ${p.favorite ? s.starOn : ''}`}
      aria-pressed={p.favorite}
      aria-label={p.favorite ? T.menu.unfavorite : T.menu.favorite}
      onClick={(e) => { e.stopPropagation(); onToggleFavorite() }}
    >
      <Star size={layout === 'grid' ? 18 : 15} strokeWidth={1.6} fill={p.favorite ? 'currentColor' : 'none'} />
    </button>
  )

  if (layout === 'list')
    return (
      <article className={`${s.row} ${selected ? s.selected : ''}`} onClick={onSelect} onDoubleClick={onOpen} aria-selected={selected}>
        <div className={s.rowThumb}>{thumb}</div>
        <div className={s.rowMain}>
          <h3 className={s.title}>{p.name}</h3>
          <p className={s.summary1}>{d.summary}</p>
        </div>
        <div className={s.rowTags}>{tags}</div>
        <StatusBadge kind={kind} className={s.rowBadge} />
        <span className={s.modified}>{modified}</span>
        {star}
        {kebab(menuOpen, setMenuOpen, menuRef, s.rowMenu)}
      </article>
    )

  return (
    <article
      className={`${s.card} ${selected ? s.selected : ''} ${menuOpen || footOpen ? s.raised : ''}`}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      tabIndex={0}
      aria-selected={selected}
      aria-label={p.name}
    >
      <div className={s.media}>
        {thumb}
        <StatusBadge kind={kind} className={s.mediaBadge} />
        {star}
      </div>
      <div className={s.body}>
        <div className={s.titleRow}>
          <h3 className={s.title}>{p.name}</h3>
          {kebab(menuOpen, setMenuOpen, menuRef, s.titleMenu)}
        </div>
        <div className={s.tags}>{tags}</div>
        <p className={s.summary}>{d.summary}</p>
        <div className={s.foot}>
          {d.team && <img className={s.team} src={d.team.image} width={d.team.width} height={23} alt="" />}
          {d.team && d.team.extra > 0 && <span className={s.extra}>+{d.team.extra}</span>}
          <span className={s.modified}>{modified}</span>
          {kebab(footOpen, setFootOpen, footRef, s.footMenu)}
        </div>
      </div>
    </article>
  )
}
