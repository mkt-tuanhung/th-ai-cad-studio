import type { ReactNode } from 'react'
import { ChevronRight, File, Layers, Upload } from 'lucide-react'
import { useT } from '../../i18n'
import { AiSparkIcon } from '../../components/icons'
import { LinkButton, SectionHeader } from '../../components/ui/SectionHeader'
import s from './RailCards.module.css'

export function QuickActions({
  onNewDrawing,
  onImport,
  onAiSketch,
  onBatch,
  onSeeAll,
}: {
  onNewDrawing: () => void
  onImport: () => void
  onAiSketch: () => void
  onBatch: () => void
  onSeeAll: () => void
}) {
  const t = useT()
  const q = t.dashboard.quickActions
  const items: { label: string; icon: ReactNode; run: () => void }[] = [
    { label: q.newDrawing, icon: <File size={22} strokeWidth={1.5} />, run: onNewDrawing },
    { label: q.importConvert, icon: <Upload size={22} strokeWidth={1.5} />, run: onImport },
    { label: q.aiFromSketch, icon: <AiSparkIcon size={23} strokeWidth={1.6} className={s.aiIcon} />, run: onAiSketch },
    { label: q.batch, icon: <Layers size={22} strokeWidth={1.5} />, run: onBatch },
  ]
  return (
    <section className={s.card}>
      <SectionHeader title={q.title} className={s.header} action={<LinkButton onClick={onSeeAll}>{q.seeAll}</LinkButton>} />
      <ul className={s.list}>
        {items.map((it) => (
          <li key={it.label}>
            <button type="button" className={s.action} onClick={it.run}>
              <span className={s.actionIcon}>{it.icon}</span>
              <span className={s.actionLabel}>{it.label}</span>
              <ChevronRight size={15} strokeWidth={1.8} className={s.chev} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
