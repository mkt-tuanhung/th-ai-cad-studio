import { useEffect, useState } from 'react'
import { ArrowRight, Cpu, Tag, Zap } from 'lucide-react'
import { useT } from '../../i18n'
import { getLocalAi, type LocalAiStatus } from '../../services/localAi'
import s from './LocalAiStrip.module.css'

export function LocalAiStrip({ onApply }: { onApply: () => void }) {
  const T = useT()
  const t = T.ai.local
  const L = T.dashboard.localAi
  const [st, setSt] = useState<LocalAiStatus | null>(null)
  useEffect(() => {
    getLocalAi().status().then(setSt)
  }, [])
  const pct = st ? (st.vramUsedGb / st.vramTotalGb) * 100 : 0
  // Browser preview: no runtime → never present the demo numbers as live status.
  const demo = st?.source === 'demo'
  const traitIcons = [<span key="p" className={s.privDot} />, <Zap key="f" size={12} strokeWidth={2} />, <Tag key="n" size={12} strokeWidth={2} />]
  return (
    <section className={s.strip} data-source={st?.source}>
      <div className={s.identity}>
        <span className={s.chip}>
          <Cpu size={52} strokeWidth={1.3} />
        </span>
        <div className={s.idText}>
          <div className={s.titleRow}>
            <h2 className={s.title}>{t.title}</h2>
            <span className={`${s.online} ${demo || st?.online === false ? s.off : ''}`}>
              <span className={s.dot} />
              {demo ? L.demoPill : st?.online === false ? L.offline : t.online}
            </span>
          </div>
          <p className={s.running}>{demo ? L.demoRunning : t.running}</p>
          <div className={s.traits}>
            {t.traits.map((tr, i) => (
              <span key={tr} className={s.trait}>
                {traitIcons[i]}
                {tr}
              </span>
            ))}
          </div>
        </div>
      </div>
      <dl className={s.metrics}>
        <div className={s.mrow}>
          <dt>{L.model}</dt>
          <dd>{!st ? '—' : demo ? L.notConnected : (st.modelName ?? L.noModel)}</dd>
        </div>
        <div className={s.mrow}>
          <dt>{L.status}</dt>
          <dd className={st?.ready && !demo ? s.ready : undefined}>{!st ? '—' : demo ? L.demoPill : st.ready ? L.ready : L.notLoaded}</dd>
        </div>
        <div className={s.mrow}>
          <dt>{L.vram}</dt>
          <dd className={s.vram}>
            <span className={s.track}>
              <span style={{ width: `${pct}%` }} />
            </span>
            {st ? `${st.vramUsedGb} / ${st.vramTotalGb} GB` : '—'}
            {demo && <em className={s.demoTag}>DEMO</em>}
          </dd>
        </div>
        <div className={s.mrow}>
          <dt>{L.speed}</dt>
          <dd>{st?.responseSeconds != null && !demo ? `${st.responseSeconds}s` : '—'}</dd>
        </div>
      </dl>
      <div className={s.apply}>
        <button type="button" className={s.applyBtn} onClick={onApply}>
          <ArrowRight size={19} strokeWidth={1.8} />
          {t.apply}
        </button>
        <p className={s.applyNote}>{t.applyNote}</p>
      </div>
    </section>
  )
}
