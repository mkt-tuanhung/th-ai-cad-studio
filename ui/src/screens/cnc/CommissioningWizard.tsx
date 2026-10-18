/**
 * Commissioning wizard (Machines & Tools): survey → measurements → automated parser / backplot → supervised air
 * cut → first article vs tolerances → operator + engineer sign-off → commission() decides VERIFIED (with expiry)
 * or FAILED. The rules are in cam/commissioning.ts + cam/machine.ts (unit-tested); this is only the form.
 */
import { useState } from 'react'
import { fmt, useT } from '../../i18n'
import { blockerText } from '../../i18n/ws/cnc'
import { downloadFile } from '../../components/workspace/Workspace'
import { toast } from '../../state/toast'
import { useMachines, type MachineRecord } from '../../state/machines'
import { machineBlockers } from '../../cam/machine'
import { SURVEY_ITEMS, automatedChecks, newWizard, rowPass, wizardInput, type AutoCheck, type WizardState } from '../../cam/commissioning'
import { zip } from '../../lib/zip'
import s from './Cnc.module.css'

/** Machine-data gaps the measurements step must close (qualification items are closed by the wizard itself). */
const QUAL = /^(MACHINE_PROFILE_NOT_VERIFIED|POSTPROCESSOR_NOT_APPROVED|QUALIFICATION_MISSING:.*|QUALIFICATION_EVIDENCE_MISSING|PRODUCTION_EXPORT_DISABLED)$/

export function CommissioningWizard({ rec }: { rec: MachineRecord }) {
  const T = useT()
  const c = T.cnc
  const W = T.machlib.wiz
  const commission = useMachines((st) => st.commission)
  const [w, setW] = useState<WizardState>(() => newWizard())
  const [step, setStep] = useState(0)
  const [auto, setAuto] = useState<AutoCheck | null>(null)
  const last = rec.commissioning[rec.commissioning.length - 1]
  const p = rec.profile
  const sawUnit = (p.machine_type === 'CNC_ROUTER' || p.machine_type === 'HYBRID') && p.heads.some((h) => h.type === 'SAW_BLADE')
  const gaps = machineBlockers(p).filter((b) => !QUAL.test(b))
  const up = (patch: Partial<WizardState>) => setW({ ...w, ...patch })
  const run = () => {
    const a = automatedChecks(p)
    setAuto(a)
    up({ auto: { parser_pass: a.parser_pass, post_backplot_pass: a.post_backplot_pass } })
  }
  const record = () => {
    const r = commission(p.profile_id, wizardInput(w))
    if (r) toast(r.result === 'VERIFIED' ? fmt(W.verified, { id: p.profile_id, until: r.valid_until ?? '—' }) : fmt(W.failed, { list: r.failures.join(', ') }), r.result === 'VERIFIED' ? 'success' : 'warning')
  }
  const txt = (label: string, value: string, on: (v: string) => void, type = 'text') => <label className={s.field}>{label}<input aria-label={label} type={type} value={value} onChange={(e) => on(e.target.value)} /></label>
  return (
    <div className={s.card} data-testid="commissioning">
      <h4>{W.title}</h4>
      <p className={s.small}>{W.intro}</p>
      <div className={s.steps} role="tablist" aria-label={W.title}>
        {W.steps.map((label, i) => (
          <button key={label} type="button" role="tab" aria-selected={step === i} className={step === i ? s.on : undefined} onClick={() => setStep(i)} data-testid={`wiz-step-${i + 1}`}>{label}</button>
        ))}
      </div>
      {step === 0 && (
        <div className={s.stepBody}>
          {SURVEY_ITEMS.map((k) => (
            <label key={k} className={s.check}><input type="checkbox" checked={w.survey[k]} onChange={(e) => up({ survey: { ...w.survey, [k]: e.target.checked } })} />{W.survey[k]}</label>
          ))}
          <div className={s.grid}>
            {txt(W.serial, w.serial, (v) => up({ serial: v }))}
            {txt(W.maintenance, w.maintenance, (v) => up({ maintenance: v }))}
          </div>
        </div>
      )}
      {step === 1 && (
        <div className={s.stepBody}>
          {gaps.length ? (
            <>
              <p className={s.small}>{W.measIntro}</p>
              <ul className={s.log}>{gaps.map((b) => <li key={b}>{blockerText(b, c)}</li>)}</ul>
            </>
          ) : <p className={s.pass}>{W.measOk}</p>}
          <table className={s.tools}>
            <tbody>
              {p.heads.flatMap((h) => h.tools.map((t) => (
                <tr key={`${h.head_id}-${t.tool_id}`}><td>{h.head_id}</td><td>{t.tool_id}</td><td>{t.kind}</td><td>Ø {t.diameter_mm ?? '—'}</td><td>L {t.length_mm ?? '—'}</td><td>{t.actual_calibrated ? '✓' : '✗'}</td></tr>
              )))}
            </tbody>
          </table>
        </div>
      )}
      {step === 2 && (
        <div className={s.stepBody}>
          <p className={s.small}>{W.autoIntro}</p>
          <div className={s.actions}><button type="button" onClick={run} data-testid="wiz-auto">{W.runAuto}</button></div>
          {auto && (
            <>
              <p className={auto.parser_pass && auto.post_backplot_pass ? s.pass : s.dangerText} data-testid="wiz-auto-result">{fmt(W.autoPass, { p: auto.parser_pass ? W.pass : W.fail, b: auto.post_backplot_pass ? W.pass : W.fail, n: auto.programs.length, s: auto.segments, z: auto.minZ.toFixed(2) })}</p>
              {auto.issues.length > 0 && <details><summary>{W.issues} ({auto.issues.length})</summary><ul className={s.log}>{auto.issues.slice(0, 40).map((x, i) => <li key={i}>{x.code} — {x.msg}</li>)}</ul></details>}
            </>
          )}
        </div>
      )}
      {step === 3 && (
        <div className={s.stepBody}>
          <p className={s.small}>{W.airIntro}</p>
          <div className={s.actions}>
            <button type="button" disabled={!auto?.airCut.length} onClick={() => auto && downloadFile(`${p.profile_id} - commissioning air cut.zip`, zip(auto.airCut), 'application/zip')} data-testid="wiz-aircut">{W.airFiles}</button>
          </div>
          <label className={s.check}><input type="checkbox" checked={w.air.pass} onChange={(e) => up({ air: { ...w.air, pass: e.target.checked } })} />{W.airPass}</label>
          <div className={s.grid}>
            {txt(W.airDate, w.air.date, (v) => up({ air: { ...w.air, date: v } }))}
            {txt(W.supervisor, w.air.supervisor, (v) => up({ air: { ...w.air, supervisor: v } }))}
            {txt(W.airNotes, w.air.notes, (v) => up({ air: { ...w.air, notes: v } }))}
          </div>
          {sawUnit && <label className={s.check}><input type="checkbox" checked={!!w.sawTest?.pass} onChange={(e) => up({ sawTest: { pass: e.target.checked, notes: w.sawTest?.notes ?? '' } })} />{W.sawTest}</label>}
          <label className={s.check}><input type="checkbox" checked={w.postApproved} onChange={(e) => up({ postApproved: e.target.checked })} />{W.postApproved}</label>
        </div>
      )}
      {step === 4 && (
        <div className={s.stepBody}>
          <p className={s.small}>{W.faIntro}</p>
          <table className={s.tools} data-testid="wiz-fa">
            <tbody>
              <tr><td>{W.feature}</td><td>{W.nominal}</td><td>{W.tol}</td><td>{W.measured}</td><td>{W.result}</td></tr>
              {w.rows.map((r, i) => {
                const set = (patch: object) => up({ rows: w.rows.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
                return (
                  <tr key={r.feature}>
                    <td>{r.feature}</td>
                    <td><input aria-label={`${r.feature} ${W.nominal}`} value={r.nominal} onChange={(e) => Number.isFinite(Number(e.target.value)) && set({ nominal: Number(e.target.value) })} /></td>
                    <td><input aria-label={`${r.feature} ${W.tol}`} value={r.tolerance} onChange={(e) => Number.isFinite(Number(e.target.value)) && set({ tolerance: Math.abs(Number(e.target.value)) })} /></td>
                    <td><input aria-label={`${r.feature} ${W.measured}`} value={r.measured ?? ''} onChange={(e) => set({ measured: e.target.value.trim() === '' || !Number.isFinite(Number(e.target.value)) ? null : Number(e.target.value) })} /></td>
                    <td>{r.measured === null ? '—' : rowPass(r) ? `✓ ${W.pass}` : `✗ ${W.fail}`}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className={s.grid}>{txt(W.faDate, w.faDate, (v) => up({ faDate: v }))}</div>
        </div>
      )}
      {step === 5 && (
        <div className={s.stepBody}>
          <div className={s.grid}>
            {txt(W.opName, w.operator, (v) => up({ operator: v }))}
            {txt(W.engName, w.engineer, (v) => up({ engineer: v }))}
            {txt(W.signedAt, w.signedAt, (v) => up({ signedAt: v }))}
            {txt(W.validUntil, w.validUntil, (v) => up({ validUntil: v }))}
          </div>
          <label className={s.field}>{W.evidence}<textarea aria-label={W.evidence} value={w.evidence} onChange={(e) => up({ evidence: e.target.value })} /></label>
        </div>
      )}
      <div className={s.actions}>
        <button type="button" onClick={record} data-testid="commission-run">{W.record}</button>
        <span className={s.small}>{fmt(W.status, { status: c.status[p.status] ?? p.status })}</span>
      </div>
      {last && <p className={s.small} data-testid="commission-last">{last.at.slice(0, 16).replace('T', ' ')} — {last.result}{last.valid_until && last.result === 'VERIFIED' ? ` (→ ${last.valid_until})` : ''}{last.failures.length ? `: ${last.failures.join(', ')}` : ''}</p>}
    </div>
  )
}
