import { useEffect, useState } from 'react'
import { fmt, useLang, useT } from '../../i18n'
import { Modal } from '../../components/ui/Modal'
import { ActionButton } from '../../components/ui/Button'
import { useAiStudio } from '../../state/aiStudio'
import { useCad } from '../../state/cad'
import { useBim } from '../../state/bim'
import { useInterior } from '../../state/interior'
import { useRouter, type Route } from '../../state/router'
import { useAutoRun } from '../../state/auto'
import { cadUi } from '../../state/cadSession'
import { toast } from '../../state/toast'
import { PRESETS, type PresetDef } from '../../ai/presets'
import { answer, createJob, needUser, openQuestions, readyForReview, resolveInterrupted, STATUS_ORDER, type AiJob, type JobQuestion } from '../../ai/jobs'
import { approveJob, checkLayoutInputs, rejectJob, saveJob, uncalibrated, undoLast } from '../../ai/jobActions'
import { AUTO_STEPS } from '../auto/AutoDialog'
import { fabricationAllowed, openReview } from '../../cad/provenance'
import { resurvey } from '../../cad/importReview'
import { measurementWords } from '../cad2d/ReviewDialog'
import type { Messages } from '../../i18n/en'
import cs from './Calibration.module.css'

type Tab = 'presets' | 'jobs'
type IC = Messages['importCal']

const statusClass = (st: PresetDef['status']) => (st === 'available' ? cs.badgeOk : st === 'partial' ? cs.badgeInfo : cs.badgeDev)

/** Opens CAD 2D on a drawing and its Calibrate dialog. */
function calibrateIn(docId: string | undefined, navigate: (r: Route) => void) {
  if (docId && useCad.getState().docs[docId]) useCad.getState().setActive(docId)
  navigate('cad2d')
  setTimeout(() => cadUi.calibrate?.(), 50)
}

export function questionText(I: IC, q: JobQuestion): string {
  const p = { ...(q.params ?? {}) }
  if (q.code === 'missing-measurement') p.what = String(p.room ? `${p.room}: ` : '') + measurementWords(I, String(p.what ?? ''))
  if (q.code === 'interrupted-apply') p.step = (I.jobs.steps as Record<string, string>)[String(p.step)] ?? String(p.step)
  return fmt(I.jobs.q[q.code], p as Record<string, string | number>)
}

/**
 * AI task presets + AI job queue (AI Intelligence Studio, opened from the chat ⋯ menu). A preset starts the
 * existing feature (Scan to CAD, one command, Interior, Renders, BIM drawings, Nesting & CNC) — the feature's own
 * preview and approval apply; the job keeps checkpoints, questions and Approve / Reject / Undo of what it applied.
 */
export function TaskPresetsDialog({ tab: initial, onClose, onStartScan }: { tab: Tab; onClose: () => void; onStartScan: (jobId?: string) => void }) {
  const T = useT()
  const I = T.importCal
  const P = I.presets
  const J = I.jobs
  const lang = useLang()
  const [tab, setTab] = useState<Tab>(initial)
  const jobs = useAiStudio((st) => st.jobs)
  const doc = useCad((st) => st.activeDoc())
  const docs = useCad((st) => st.docs)
  const walls = useBim((st) => st.model.walls.length)
  const navigate = useRouter((st) => st.navigate)
  const [values, setValues] = useState<Record<string, string>>({})
  const go = (r: Route) => { onClose(); navigate(r) }
  const screenName = (r: Route) => (T.nav as Record<string, string>)[r === 'bim' ? 'bim' : r] ?? r

  // calibration questions answer themselves once the drawing is calibrated
  useEffect(() => {
    for (const j of jobs) {
      const q = openQuestions(j).find((x) => x.code === 'calibration-required')
      if (!q || !j.input.docId) continue
      const d = docs[j.input.docId]
      if (d && !uncalibrated(d).length) {
        let k = answer(j, q.key, true)
        if (j.preset === 'scan' && !openQuestions(k).length) k = readyForReview(k, [fmt(J.postScan, { name: d.name, n: d.entities.length, cal: J.calYes, items: openReview(d).length })])
        if (j.preset === 'layout') k = checkLayoutInputs(d, j.title, k, (n, b) => fmt(J.layoutPost, { n, blocked: b ? J.layoutBlocked : '' }))
        saveJob(k)
      }
    }
  }, [jobs, docs, J])

  const startCad3d = () => {
    if (!doc) return
    const steps = [...AUTO_STEPS.map((id) => ({ id, kind: 'compute' as const })), { id: 'approve', kind: 'user' as const }, ...(['apply-bim', 'apply-interior', 'apply-route', 'apply-mep', 'write-files'] as const).map((id) => ({ id, kind: 'apply' as const }))]
    let j = createJob({ preset: 'cad3d', title: fmt(J.jobTitleAuto, { file: doc.name }), steps, input: { docId: doc.id, file: doc.name } })
    const unc = uncalibrated(doc)
    if (unc.length) {
      // never build a model from an unscaled import: ask for the calibration
      j = needUser(j, unc.map((s) => ({ key: `cal|${s.id}`, code: 'calibration-required' as const, params: { file: s.file } })))
      saveJob(j)
      return setTab('jobs')
    }
    saveJob(j)
    onClose()
    useAutoRun.getState().show(j.id)
  }
  const checkLayout = () => {
    saveJob(checkLayoutInputs(doc, fmt(J.jobTitleLayout, { file: doc?.name ?? '—' }), null, (n, b) => fmt(J.layoutPost, { n, blocked: b ? J.layoutBlocked : '' })))
    setTab('jobs')
  }
  const gate = fabricationAllowed(doc)
  // Interior → Space Planning → Layouts (rule-based generator, preview / apply / reject)
  const openLayouts = () => {
    useInterior.getState().set({ bottom: 'space', spTab: 'layouts' })
    go('interior')
  }

  const presetActions = (p: PresetDef) => {
    switch (p.id) {
      case 'scan':
        return <ActionButton variant="primary" onClick={() => onStartScan()}>{P.start}</ActionButton>
      case 'cad3d':
        return (
          <>
            <ActionButton variant="primary" disabled={!doc} onClick={startCad3d}>{P.start}</ActionButton>
            {!doc && <span className={cs.dim}>{fmt(P.blocked, { why: P.noDoc })}</span>}
          </>
        )
      case 'layout':
        return (
          <>
            <ActionButton variant="primary" onClick={openLayouts}>{fmt(P.open, { screen: screenName('interior') })}</ActionButton>
            <ActionButton onClick={checkLayout}>{P.checkInputs}</ActionButton>
          </>
        )
      case 'options3':
        return <ActionButton variant="primary" onClick={openLayouts}>{fmt(P.open, { screen: screenName('interior') })}</ActionButton>
      case 'render4k':
        return <ActionButton onClick={() => go('renders')}>{fmt(P.open, { screen: screenName('renders') })}</ActionButton>
      case 'views':
        return (
          <>
            <ActionButton disabled={!walls} onClick={() => { useBim.setState({ view: 'drawing', drawing: { kind: 'elev', face: 'front', title: P.items.views.title } }); go('bim') }}>{fmt(P.open, { screen: screenName('bim') })}</ActionButton>
            {!walls && <span className={cs.dim}>{fmt(P.blocked, { why: P.noModel })}</span>}
          </>
        )
      case 'cnc':
        return (
          <>
            <ActionButton disabled={!!doc && !gate.ok} onClick={() => { useInterior.getState().set({ nestingOpen: true }); go('interior') }}>{fmt(P.open, { screen: screenName('interior') })}</ActionButton>
            {doc && !gate.ok && <span className={cs.dim} data-testid="preset-cnc-blocked">{fmt(P.blocked, { why: `${doc.name} — ${I.review.banner}` })}</span>}
          </>
        )
    }
  }

  const sorted = [...jobs].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || b.updatedAt - a.updatedAt)
  const active = jobs.filter((j) => j.status !== 'archived').length

  return (
    <Modal title={P.title} onClose={onClose} width={960}>
      <div className={cs.scroll} data-testid="ai-presets">
        <div className={cs.tabs} role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'presets'} onClick={() => setTab('presets')}>{P.tabPresets}</button>
          <button type="button" role="tab" aria-selected={tab === 'jobs'} onClick={() => setTab('jobs')}>{fmt(P.tabJobs, { n: active })}</button>
        </div>
        {tab === 'presets' && (
          <>
            <p className={cs.note}>{P.intro}</p>
            <div className={cs.cards}>
              {PRESETS.map((p) => {
                const it = P.items[p.id]
                return (
                  <article key={p.id} className={cs.card} data-testid={`preset-${p.id}`} data-status={p.status}>
                    <h3>{it.title}<span className={`${cs.badge} ${statusClass(p.status)}`}>{P.status[p.status]}</span></h3>
                    <p className={cs.note}>{it.desc}</p>
                    <span className={cs.label}>{P.stages}</span>
                    <ol>{it.stages.map((x) => <li key={x}>{x}</li>)}</ol>
                    <span className={cs.label}>{P.needs}</span>
                    <ul>{it.needs.map((x) => <li key={x}>{x}</li>)}</ul>
                    <span className={cs.label}>{P.uncertain}</span>
                    <ul>{it.uncertain.map((x) => <li key={x}>{x}</li>)}</ul>
                    <div className={cs.actions}>{presetActions(p)}</div>
                  </article>
                )
              })}
            </div>
          </>
        )}
        {tab === 'jobs' && (
          <ul className={cs.list} style={{ display: 'grid', gap: 8 }} data-testid="job-list">
            {!sorted.length && <p className={cs.dim}>{J.empty}</p>}
            {sorted.map((j) => (
              <JobRow key={j.id} j={j} I={I} lang={lang} values={values} setValues={setValues} onClose={onClose} onStartScan={onStartScan} navigate={navigate} />
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

function JobRow({ j, I, lang, values, setValues, onClose, onStartScan, navigate }: {
  j: AiJob
  I: IC
  lang: string
  values: Record<string, string>
  setValues: (v: Record<string, string>) => void
  onClose: () => void
  onStartScan: (jobId?: string) => void
  navigate: (r: Route) => void
}) {
  const J = I.jobs
  const docs = useCad((st) => st.docs)
  const qs = openQuestions(j)
  const auto = j.preset === 'cad3d' || j.preset === 'one-command'
  const approvedOnce = j.steps.some((s) => s.id === 'approve' && s.status === 'done') || j.preset === 'scan'
  const applied = j.applied.length > 0
  const preApproval = auto && j.steps.some((s) => s.id === 'approve' && s.status !== 'done')
  const canResume = j.status !== 'archived' && !qs.length && ((auto && (j.status === 'queued' || j.status === 'in-progress' || j.status === 'failed' || preApproval)) || (j.preset === 'scan' && !applied && j.status !== 'ready-for-review'))
  const resume = () => {
    onClose()
    if (auto) useAutoRun.getState().show(j.id)
    else if (j.preset === 'scan') onStartScan(j.id)
  }
  const answerMeasurement = (q: JobQuestion) => {
    const v = Number((values[`${j.id}${q.key}`] ?? '').replace(',', '.'))
    if (!(v > 0)) return
    const [srcId, key] = q.key.split('|')
    const d = j.input.docId ? docs[j.input.docId] : null
    if (!d || !key) return saveJob(answer(j, q.key, v))
    // the measurement goes into the drawing (one undo step there), then the inputs are checked again
    useCad.getState().setActive(d.id)
    const rs = resurvey(d, srcId, key, v, { area: I.survey.area, height: I.survey.heightShort, doorMissing: I.survey.doorMissing })
    if (rs) useCad.getState().execBatch([{ type: 'erase', ids: rs.erase, label: 'SURVEY' }, { type: 'add', entities: rs.add, label: 'SURVEY' }], `SURVEY ${key} = ${v}`, (x) => ({ ...x, provenance: rs.provenance }))
    const after = useCad.getState().docs[d.id]
    saveJob(checkLayoutInputs(after, j.title, answer(j, q.key, v), (n, b) => fmt(J.layoutPost, { n, blocked: b ? J.layoutBlocked : '' })))
  }
  const when = new Date(j.updatedAt).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
  const badge = j.status === 'needs-user' || j.status === 'failed' ? cs.badgeWarn : j.status === 'ready-for-review' ? cs.badgeInfo : j.status === 'archived' ? cs.badgeDev : cs.badgeOk
  return (
    <li className={cs.card} data-testid="job" data-status={j.status} data-preset={j.preset} style={{ display: 'grid', background: '#fff' }}>
      <h3>
        <span>{j.title}</span>
        <span className={`${cs.badge} ${badge}`}>{J.status[j.status]}{j.outcome ? ` · ${J.outcome[j.outcome]}` : ''}</span>
      </h3>
      <span className={cs.dim}>{when}{j.resumed ? ` · ${J.resumed}` : ''}{j.error ? ` · ${j.error}` : ''}</span>
      <div className={cs.steps}>
        {j.steps.map((s) => (
          <span key={s.id} className={cs.step} data-status={s.status} title={`${J.stepStatus[s.status]}${s.note ? ` — ${s.note}` : ''}`}>
            {(J.steps as Record<string, string>)[s.id] ?? s.id}: {J.stepStatus[s.status]}
          </span>
        ))}
      </div>
      {qs.map((q) => (
        <div key={q.key} className={cs.question} data-testid="job-question" data-code={q.code}>
          <span>{questionText(I, q)}</span>
          {q.code === 'missing-measurement' && q.key.includes('|') && (
            <>
              <input aria-label={J.answer} inputMode="decimal" value={values[`${j.id}${q.key}`] ?? ''} onChange={(e) => setValues({ ...values, [`${j.id}${q.key}`]: e.target.value })} />
              <button type="button" className={cs.linkBtn} onClick={() => answerMeasurement(q)}>{J.answer}</button>
            </>
          )}
          {q.code === 'missing-measurement' && !q.key.includes('|') && (
            <button type="button" className={cs.linkBtn} onClick={() => { onClose(); navigate('cad2d'); setTimeout(() => cadUi.surveyRoom?.(), 50) }}>{I.review.surveyRoom}</button>
          )}
          {q.code === 'calibration-required' && <button type="button" className={cs.linkBtn} onClick={() => { onClose(); calibrateIn(j.input.docId, navigate) }}>{I.review.calibrate}</button>}
          {q.code === 'interrupted-apply' && (
            <>
              <button type="button" className={cs.linkBtn} onClick={() => saveJob(resolveInterrupted(j, String(q.params?.step), true))}>{J.yesApplied}</button>
              <button type="button" className={cs.linkBtn} onClick={() => saveJob(resolveInterrupted(j, String(q.params?.step), false))}>{J.noApplied}</button>
            </>
          )}
          {(q.code === 'open-drawing' || q.code === 'reselect-file') && <button type="button" className={cs.linkBtn} onClick={resume}>{J.resume}</button>}
        </div>
      ))}
      {!!j.pre?.length && (
        <details>
          <summary>{J.pre}</summary>
          <ul>{j.pre.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </details>
      )}
      {!!j.post?.length && (
        <div>
          <span className={cs.label}>{J.post}</span>
          <ul>{j.post.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}
      <div className={cs.actions}>
        {canResume && <ActionButton variant="primary" onClick={resume}>{preApproval && j.status === 'ready-for-review' ? J.reviewIt : J.resume}</ActionButton>}
        {j.status === 'ready-for-review' && approvedOnce && !preApproval && (
          <>
            <ActionButton variant="primary" onClick={() => { approveJob(j); toast(J.approvedToast, 'success') }}>{J.approve}</ActionButton>
            <ActionButton onClick={() => { const r = rejectJob(j); toast(r.ok ? J.rejectedToast : fmt(J.cantUndo, { label: r.label ?? '' }), r.ok ? 'info' : 'warning') }}>{J.reject}</ActionButton>
          </>
        )}
        {j.status !== 'archived' && !!j.undo?.length && (
          <ActionButton onClick={() => { const r = undoLast(j); toast(r.ok ? fmt(J.undone, { label: r.label }) : fmt(J.cantUndo, { label: r.label }), r.ok ? 'info' : 'warning') }}>{J.undo}</ActionButton>
        )}
        {(j.status === 'archived' || j.status === 'failed' || (!applied && j.status !== 'in-progress')) && (
          <ActionButton variant="ghost" onClick={() => useAiStudio.getState().removeJob(j.id)}>{J.remove}</ActionButton>
        )}
      </div>
    </li>
  )
}
