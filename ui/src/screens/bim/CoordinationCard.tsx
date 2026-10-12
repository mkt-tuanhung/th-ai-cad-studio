import { AlertTriangle, Check, RefreshCw, Settings, TriangleAlert } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { AnchoredMenu } from '../../components/ui/AnchoredMenu'
import { useBim } from '../../state/bim'
import { toast } from '../../state/toast'
import type { CheckResult } from '../../bim/model'
import s from './CoordinationCard.module.css'

export function CoordinationCard() {
  const T = useT()
  const t = T.bim.coord
  const { checks, runChecks, set, model, coordOff, coordAuto, setCoord } = useBim()
  const run = () => {
    runChecks()
    const res = useBim.getState().checks
    const bad = res.filter((c) => c.count).map((c) => `${t.rows[c.key]}: ${c.count}`)
    toast(fmt(t.checked, { summary: bad.length ? bad.join(' · ') : t.ok.params }), bad.length ? 'warning' : 'success')
  }
  const selectFirst = (c: CheckResult) => {
    const id = c.items[0]?.elementId
    if (!id) return
    const category = model.walls.some((w) => w.id === id) ? 'wall' : id.startsWith('door') ? 'door' : id.startsWith('window') ? 'window' : 'room'
    set({ selection: { category, id }, rightTab: 'properties' })
  }
  return (
    <section className={s.card}>
      <header className={s.head}>
        <h2 className={s.title}>{t.title}</h2>
        <button type="button" className={s.check} onClick={run}>
          <RefreshCw size={14} strokeWidth={1.9} />
          {t.check}
        </button>
        <AnchoredMenu
          label={t.settings}
          className={s.gear}
          icon={<Settings size={15} strokeWidth={1.7} />}
          direction="down"
          align="right"
          width={230}
          items={[
            ...(Object.keys(t.rows) as CheckResult['key'][]).map((k) => ({
              label: t.rows[k],
              checked: !coordOff.includes(k),
              onSelect: () => setCoord({ coordOff: coordOff.includes(k) ? coordOff.filter((x) => x !== k) : [...coordOff, k] }),
            })),
            { label: t.auto, checked: coordAuto, onSelect: () => setCoord({ coordAuto: !coordAuto }) },
          ]}
        />
      </header>
      <ul className={s.list}>
        {checks.map((c) => (
          <li key={c.key}>
            <button type="button" className={s.row} onClick={() => selectFirst(c)} title={c.items.map((i) => i.message).join('\n')}>
              <StatusDot c={c} big />
              <span className={s.name}>{t.rows[c.key]}</span>
              <StatusDot c={c} />
              <span className={`${s.status} ${s[c.status]}`}>{c.status === 'off' ? t.off : c.count ? fmt(t.bad[c.key], { n: c.count }) : t.ok[c.key]}</span>
              <span className={s.count}>{c.count}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function StatusDot({ c, big }: { c: CheckResult; big?: boolean }) {
  const size = big ? 17 : 14
  const cls = `${s.dot} ${big ? s.dotBig : ''} ${s[`d_${c.status}`]}`
  return (
    <span className={cls} style={{ width: size, height: size }}>
      {c.status === 'off' ? null : c.status === 'ok' ? <Check size={big ? 10 : 9} strokeWidth={3.2} /> : c.key === 'clash' ? <TriangleAlert size={big ? 10 : 8} strokeWidth={2.6} /> : <AlertTriangle size={big ? 10 : 8} strokeWidth={2.6} />}
    </span>
  )
}
