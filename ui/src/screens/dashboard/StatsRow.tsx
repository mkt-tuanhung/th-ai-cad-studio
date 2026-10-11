import { useEffect, useState } from 'react'
import { Check, Cloud, Database, Folder } from 'lucide-react'
import { fmt, relativeTime, useLang, useT } from '../../i18n'
import { useWorkspace } from '../../state/workspace'
import { getLocalAi, type AiActivityStats } from '../../services/localAi'
import { getLibraryStats, type LibraryStats } from '../../services/componentLibrary'
import { AiSparkIcon } from '../../components/icons'
import { useNow } from '../../lib/useNow'
import { StatCard } from './StatCard'
import s from './StatsRow.module.css'

const WEEK = 7 * 24 * 3600_000

export function StatsRow() {
  const t = useT()
  const lang = useLang()
  const now = useNow(30_000)
  const projects = useWorkspace((st) => st.projects)
  const autosave = useWorkspace((st) => st.autosave)
  const [lib, setLib] = useState<LibraryStats | null>(null)
  const [ai, setAi] = useState<AiActivityStats | null>(null)

  useEffect(() => {
    getLibraryStats().then(setLib)
    getLocalAi().activity().then(setAi)
  }, [])

  const createdThisWeek = projects.filter((p) => now - p.createdAt < WEEK).length
  const nf = new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-US')

  return (
    <div className={s.row}>
      <StatCard
        tone="teal"
        icon={<Folder size={25} strokeWidth={1.7} />}
        label={t.dashboard.stats.activeProjects}
        value={projects.length}
        delta={fmt(t.dashboard.stats.thisWeek, { n: createdThisWeek })}
        bars={[0.42, 0.68, 0.96, 0.88]}
      />
      <StatCard
        tone="teal"
        icon={<Database size={25} strokeWidth={1.7} />}
        label={t.dashboard.stats.componentsLibrary}
        value={lib ? nf.format(lib.total) : '—'}
        delta={lib ? fmt(t.dashboard.stats.newItems, { n: lib.addedRecently }) : undefined}
        bars={[0.36, 0.62, 1, 0.8]}
      />
      <StatCard
        tone="blue"
        icon={<AiSparkIcon size={28} strokeWidth={1.7} />}
        label={t.dashboard.stats.aiSuggestions}
        value={ai ? nf.format(ai.suggestionsTotal) : '—'}
        delta={ai ? fmt(t.dashboard.stats.today, { n: ai.suggestionsToday }) : undefined}
        bars={[0.36, 0.62, 1, 0.8]}
      />
      <StatCard
        tone="blue"
        icon={<Cloud size={27} strokeWidth={1.7} />}
        label={t.dashboard.stats.lastAutosave}
        value={relativeTime(autosave.at, lang, now)}
        compactValue
        footnote={autosave.fileName}
        trailing={
          <span className={s.check}>
            <Check size={12} strokeWidth={3} />
          </span>
        }
      />
    </div>
  )
}
