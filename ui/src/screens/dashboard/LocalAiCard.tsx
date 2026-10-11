import { useEffect, useState } from 'react'
import { Cpu } from 'lucide-react'
import { useT } from '../../i18n'
import { getLocalAi, type LocalAiStatus } from '../../services/localAi'
import { AiSparkIcon } from '../../components/icons'
import { ActionButton } from '../../components/ui/Button'
import s from './LocalAiCard.module.css'

export function LocalAiCard({ onOpenAssistant }: { onOpenAssistant: () => void }) {
  const t = useT()
  const [st, setSt] = useState<LocalAiStatus | null>(null)
  useEffect(() => {
    getLocalAi().status().then(setSt)
  }, [])
  const L = t.dashboard.localAi
  const pct = st ? (st.vramUsedGb / st.vramTotalGb) * 100 : 0

  return (
    <section className={s.card} data-source={st?.source}>
      <div className={s.head}>
        <Cpu size={58} strokeWidth={1.3} className={s.chip} />
        <div className={s.headText}>
          <div className={s.titleRow}>
            <h2 className={s.title}>{st && !st.ready ? L.titleNotReady : L.title}</h2>
            <span className={`${s.pill} ${st?.online ? '' : s.off}`}>
              <span className={s.dot} />
              {st?.online === false ? L.offline : L.online}
            </span>
          </div>
          <p className={s.desc}>{L.desc}</p>
          <p className={s.desc}>
            {L.traits.map((tr, i) => (
              <span key={tr}>
                {i > 0 && <span className={s.sep}>•</span>}
                {tr}
              </span>
            ))}
          </p>
        </div>
      </div>
      <div className={s.inner}>
        <dl className={s.rows}>
          <div className={s.row}>
            <dt>{L.model}</dt>
            <dd>{st ? (st.modelName ?? L.noModel) : '—'}</dd>
          </div>
          <div className={s.row}>
            <dt>{L.status}</dt>
            <dd className={st?.ready ? s.ready : undefined}>{st ? (st.ready ? L.ready : L.notLoaded) : '—'}</dd>
          </div>
          <div className={`${s.row} ${s.vramRow}`}>
            <dt>{L.vram}</dt>
            <dd>{st ? `${st.vramUsedGb} / ${st.vramTotalGb} GB` : '—'}</dd>
            <div className={s.track} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div className={s.row}>
            <dt>{L.speed}</dt>
            <dd>{st?.responseSeconds != null ? `${st.responseSeconds}s` : '—'}</dd>
          </div>
        </dl>
        <ActionButton variant="primary" block className={s.open} icon={<AiSparkIcon size={20} strokeWidth={1.7} />} onClick={onOpenAssistant}>
          {L.open}
        </ActionButton>
      </div>
    </section>
  )
}
