import { Folder, Plus } from 'lucide-react'
import { useT } from '../../i18n'
import { ActionButton } from '../../components/ui/Button'
import s from './HeroCard.module.css'

export function HeroCard({ onNewProject, onOpenFile }: { onNewProject: () => void; onOpenFile: () => void }) {
  const t = useT()
  const items = t.dashboard.taglineItems
  return (
    <section className={s.hero}>
      <img className={s.art} src="/assets/dashboard_hero_building.png" alt={t.dashboard.heroAlt} draggable={false} />
      <div className={s.text}>
        <p className={s.welcome}>{t.dashboard.welcome}</p>
        <h1 className={s.title}>{t.app.name}</h1>
        <p className={s.subtitle}>{t.dashboard.subtitle}</p>
        <p className={s.tags}>
          {items.map((it, i) => (
            <span key={it}>
              {i > 0 && <span className={s.dot}>•</span>}
              {it}
            </span>
          ))}
        </p>
        <div className={s.actions}>
          <ActionButton variant="primary" className={s.btn} icon={<Plus size={19} strokeWidth={1.8} />} onClick={onNewProject}>
            {t.dashboard.newProject}
          </ActionButton>
          <ActionButton variant="secondary" className={s.btn} icon={<Folder size={19} strokeWidth={1.6} />} onClick={onOpenFile}>
            {t.dashboard.openFile}
          </ActionButton>
        </div>
      </div>
    </section>
  )
}
