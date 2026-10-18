/** Machine selection, capability summary and release-blocker list, shared by Nesting & CNC and Part Studio CAM. */
import { fmt, useT } from '../../i18n'
import { blockerText } from '../../i18n/ws/cnc'
import { capabilities, headSummary, type MachineProfile } from '../../cam/machine'
import { useMachines } from '../../state/machines'
import s from './Cnc.module.css'

export function MachinePicker({ value, legacy, onChange, onManage }: { value: string | null | undefined; legacy?: boolean; onChange: (id: string | null) => void; onManage: () => void }) {
  const c = useT().cnc
  const records = useMachines((st) => st.records)
  const cur = records.find((r) => r.profile.profile_id === value)?.profile ?? null
  return (
    <div className={s.picker} data-testid="machine-picker">
      <div className={s.pickRow}>
        <select aria-label={c.machine} value={cur?.profile_id ?? ''} onChange={(e) => onChange(e.target.value || null)} data-testid="machine-select">
          <option value="">{c.choose}</option>
          {records.map((r) => (
            <option key={r.profile.profile_id} value={r.profile.profile_id}>
              {r.profile.profile_id} · {c.status[r.profile.status] ?? r.profile.status} · {fmt(c.rev, { n: r.profile.revision })}
            </option>
          ))}
        </select>
        <button type="button" className={s.linkBtn} onClick={onManage} data-testid="open-machines">{c.manage}</button>
      </div>
      {!cur && <p className={s.small} role="note">{legacy ? c.legacy : c.none}</p>}
      {cur && <MachineSummary m={cur} />}
    </div>
  )
}

export function MachineSummary({ m }: { m: MachineProfile }) {
  const c = useT().cnc
  const h = headSummary(m)
  return (
    <>
      <div className={s.small}>
        <span className={`${s.badge} ${m.status === 'VERIFIED' ? s.ok : ''}`} data-testid="machine-status">{c.status[m.status] ?? m.status}</span>{' '}
        {[m.manufacturer, m.machine_model].filter(Boolean).join(' ') || m.machine_type} · {m.controller.name ?? '—'} {m.controller.firmware ?? ''}
      </div>
      <div className={s.small} data-testid="machine-heads">{fmt(c.heads, { router: h.routerHeads, saw: h.sawHeads, drill: h.drillBanks, atc: h.atc ? `${c.yes} (${h.magazine})` : c.no, tools: h.tools })}</div>
      <ul className={s.caps} aria-label={c.caps} data-testid="machine-caps">
        {capabilities(m).map((x) => (
          <li key={x.op} className={x.state === 'available' ? s.capOk : x.state === 'head-only' ? s.capHead : s.capNo} title={x.reason}>
            <b>{x.state === 'unsupported' ? '✗' : x.state === 'available' ? '✓' : '~'}</b>
            {c.ops[x.op] ?? x.op}: {c.capState[x.state]}{x.heads.length ? ` (${x.heads.join(', ')})` : ''}{x.reason && x.state === 'unsupported' ? ` — ${x.reason}` : ''}
          </li>
        ))}
      </ul>
    </>
  )
}

export function BlockerList({ blockers, testid = 'blockers' }: { blockers: string[]; testid?: string }) {
  const c = useT().cnc
  if (!blockers.length) return <p className={s.pass} data-testid={testid}>{c.blockersNone}</p>
  return (
    <details className={s.blockers} data-testid={testid}>
      <summary>{fmt(c.blockers, { n: blockers.length })}</summary>
      <ul>{blockers.map((b) => <li key={b}>{blockerText(b, c)}</li>)}</ul>
    </details>
  )
}
