import { Ellipsis, EllipsisVertical, Star } from 'lucide-react'
import { fmt, relativeTime, useLang, useT } from '../../i18n'
import type { Project } from '../../state/workspace'
import { CroppedImage } from '../../components/ui/CroppedImage'
import { MenuList, PopoverPanel, useDismissable, type MenuItem } from '../../components/ui/Popover'
import s from './ProjectCard.module.css'

export interface ProjectCardProps {
  project: Project
  now: number
  onOpen: () => void
  onToggleFavorite: () => void
  menu: MenuItem[]
}

export function ProjectCard({ project: p, now, onOpen, onToggleFavorite, menu }: ProjectCardProps) {
  const t = useT()
  const lang = useLang()
  const [menuOpen, setMenuOpen, menuRef] = useDismissable<HTMLDivElement>()
  const [moreOpen, setMoreOpen, moreRef] = useDismissable<HTMLDivElement>()
  const hasVersion = p.version > 1

  const avatars = p.collaborators && (
    <img className={s.avatars} src={p.collaborators.image} width={p.collaborators.width} height={22} alt="" />
  )

  return (
    <article className={`${s.card} ${menuOpen || moreOpen ? s.raised : ''}`}>
      <button type="button" className={s.thumbBtn} onClick={onOpen} aria-label={`${t.dashboard.projectMenu.open} ${p.name}`}>
        {p.thumbnail ? (
          <CroppedImage className={s.thumb} {...p.thumbnail} alt={p.name} />
        ) : (
          <div className={`${s.thumb} ${s.placeholder}`}>{p.format}</div>
        )}
      </button>
      <button
        type="button"
        className={`${s.star} ${p.favorite ? s.starOn : ''}`}
        aria-pressed={p.favorite}
        aria-label={p.favorite ? t.dashboard.unfavorite : t.dashboard.favorite}
        title={p.favorite ? t.dashboard.unfavorite : t.dashboard.favorite}
        onClick={onToggleFavorite}
      >
        <Star size={15} strokeWidth={1.5} fill="currentColor" />
      </button>

      <div className={s.head}>
        <h3 className={s.name} title={p.name}>
          <button type="button" onClick={onOpen}>
            {p.name}
          </button>
        </h3>
        <div className={s.anchor} ref={menuRef}>
          <button
            type="button"
            className={s.kebab}
            aria-label={t.dashboard.moreActions}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <EllipsisVertical size={17} strokeWidth={2} />
          </button>
          {menuOpen && (
            <PopoverPanel>
              <MenuList items={menu} onClose={() => setMenuOpen(false)} />
            </PopoverPanel>
          )}
        </div>
      </div>
      <div className={s.meta}>
        {t.disciplines[p.discipline]}
        <span className={s.sep}>•</span>
        {p.format}
      </div>
      <div className={s.foot}>
        {hasVersion ? <span className={s.version}>V{p.version}</span> : avatars}
        <span className={s.modified}>{fmt(t.dashboard.modified, { when: relativeTime(p.modifiedAt, lang, now) })}</span>
        {hasVersion ? (
          <span className={s.trailingAvatar}>{avatars}</span>
        ) : (
          <div className={`${s.anchor} ${s.more}`} ref={moreRef}>
            <button
              type="button"
              className={s.kebab}
              aria-label={t.dashboard.moreActions}
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen(!moreOpen)}
            >
              <Ellipsis size={17} strokeWidth={2.2} />
            </button>
            {moreOpen && (
              <PopoverPanel>
                <MenuList items={menu} onClose={() => setMoreOpen(false)} />
              </PopoverPanel>
            )}
          </div>
        )}
      </div>
    </article>
  )
}
