import { useState } from 'react'
import { fmt, useT } from '../../i18n'
import { Modal } from '../../components/ui/Modal'
import { ActionButton } from '../../components/ui/Button'
import { useCad } from '../../state/cad'
import { toast } from '../../state/toast'
import { bboxOf, unionBBox } from '../../cad/geometry'
import { fmtK } from '../../cad/calibration'
import { confirmable, fabricationAllowed, setReviewStatus, type ReviewItem, type SourceMeta } from '../../cad/provenance'
import { resurvey } from '../../cad/importReview'
import type { Messages } from '../../i18n/en'
import cs from '../ai/Calibration.module.css'

type IC = Messages['importCal']

/** Words of a missing survey measurement key (`door2.width` → "door 2 width"). */
export function measurementWords(T: IC, key: string): string {
  const m = /^door(\d+)\.(offset|width|height)$/.exec(key)
  if (m) return fmt(T.survey.what[m[2] as 'width'], { n: m[1] })
  return (T.survey.what as Record<string, string>)[key] ?? key
}

export function itemText(T: IC, it: ReviewItem, src: SourceMeta | undefined): string {
  const r = T.review
  switch (it.kind) {
    case 'uncalibrated':
      return fmt(r.itemUncal, { file: src?.file ?? it.text ?? '' })
    case 'ocr-low-confidence':
      return fmt(r.itemLow, { text: it.text ?? '', conf: it.conf ?? 0 })
    case 'ocr-dimension-mismatch':
      return fmt(r.itemMismatch, { text: it.text ?? '', ocr: it.ocrValue ?? 0, measured: Math.round(it.measuredMm ?? 0), delta: Math.round((it.measuredMm ?? 0) - (it.ocrValue ?? 0)) })
    case 'survey-tolerance':
      return fmt(r.itemTol, { name: it.text ?? '', dev: it.deviation ?? 0, tol: it.tolerance ?? 0 })
    case 'missing-measurement':
      return fmt(r.itemMissing, { name: it.text ?? '', what: measurementWords(T, it.key ?? '') })
  }
}

export function sourceLine(T: IC, s: SourceMeta): string {
  const r = T.review
  const head = `${r.kinds[s.kind]} “${s.file}”${s.page ? ` · ${fmt(r.page, { n: s.page })}` : ''} · ${r.status[s.status]}`
  if (s.kind === 'survey') return `${head} · ${fmt(r.tolInfo, { tol: s.tolerance ?? 0, dev: s.calibration?.residual ?? 0 })}`
  if (!s.calibration) return `${head} · ${fmt(r.calNone, { k: fmtK(s.nominal?.mmPerPx ?? 0) })}`
  return `${head} · ${fmt(r.calInfo, { method: s.calibration.method, n: s.calibration.refs.length, r: s.calibration.residual === null ? '—' : `${s.calibration.residual.toFixed(1)} mm` })}`
}

/**
 * REVIEW REQUIRED of the active drawing: the manufacturing gate, the sources and every review item with its
 * action. Confirm / re-open are document properties; a reject erases the OCR text (one undo step with the
 * decision); a missing survey measurement is typed in and the room rebuilt (one undo step).
 */
export function ReviewDialog({ onClose, onCalibrate, onSurvey }: { onClose: () => void; onCalibrate: (sourceId: string) => void; onSurvey: () => void }) {
  const T = useT()
  const I = T.importCal
  const r = I.review
  const doc = useCad((st) => st.activeDoc())
  const [values, setValues] = useState<Record<string, string>>({})
  if (!doc) return null
  const prov = doc.provenance
  const gate = fabricationAllowed(doc)
  const items = prov?.review ?? []
  const label = (what: string) => `REVIEW ${what}`
  const exec = useCad.getState().execBatch
  const print = useCad.getState().print

  const decide = (it: ReviewItem, status: ReviewItem['status']) => {
    const ent = it.entityId ? doc.entities.find((e) => e.id === it.entityId) : undefined
    // a rejected reading is erased with the decision, in one undo step
    const ops = status === 'rejected' && ent ? [{ type: 'erase' as const, ids: [ent.id], label: label('REJECT') }] : []
    const err = exec(ops, label(status.toUpperCase()), (d) => setReviewStatus(d, it.id, status))
    if (err) return print(`${err.code} ${err.detail}`, 'error')
    if (status === 'rejected' && ent?.kind === 'text') toast(fmt(r.erased, { text: ent.value }))
  }
  /** Every uncertain OCR word rejected (erased) in one undo step. */
  const lows = items.filter((x) => x.status === 'open' && x.kind === 'ocr-low-confidence')
  const rejectAll = () => {
    const ids = lows.map((x) => x.entityId).filter((id): id is string => !!id && doc.entities.some((e) => e.id === id))
    const err = exec(ids.length ? [{ type: 'erase', ids, label: label('REJECT') }] : [], label('REJECT'), (d) => lows.reduce((x, it) => setReviewStatus(x, it.id, 'rejected'), d))
    if (err) print(`${err.code} ${err.detail}`, 'error')
  }
  const setMeasurement = (it: ReviewItem) => {
    const v = Number((values[it.id] ?? '').replace(',', '.'))
    if (!(v > 0) || !it.key) return
    const rs = resurvey(doc, it.sourceId, it.key, v, { area: I.survey.area, height: I.survey.heightShort, doorMissing: I.survey.doorMissing })
    if (!rs) return
    const err = exec([{ type: 'erase', ids: rs.erase, label: 'SURVEY' }, { type: 'add', entities: rs.add, label: 'SURVEY' }], `SURVEY ${it.key} = ${v}`, (d) => ({ ...d, provenance: rs.provenance }))
    if (err) print(`${err.code} ${err.detail}`, 'error')
  }
  const show = (it: ReviewItem) => {
    const e = it.entityId && doc.entities.find((x) => x.id === it.entityId)
    if (!e) return
    const b = unionBBox([bboxOf(e)])
    useCad.getState().setSelection([e.id])
    if (b) useCad.getState().setView(doc.id, { center: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }, mmPerPx: Math.max(0.05, Math.max(b.maxX - b.minX, b.maxY - b.minY) / 200) })
  }
  const reasons = gate.reasons.map((x) => (x.code === 'uncalibrated' ? fmt(r.reasonUncal, { file: prov?.sources[x.sourceId ?? '']?.file ?? '' }) : fmt(r.reasonOpen, { n: x.items?.length ?? 0 })))

  return (
    <Modal title={fmt(r.title, { name: doc.name })} onClose={onClose} width={720} footer={<><ActionButton onClick={onSurvey}>{r.surveyRoom}</ActionButton><ActionButton variant="primary" onClick={onClose}>{r.close}</ActionButton></>}>
      <div className={cs.scroll} data-testid="review-dialog">
        <p className={cs.note}>{r.intro}</p>
        <p className={gate.ok ? cs.ok : cs.warn} role="status" data-testid="review-gate">
          {gate.ok ? r.gateOk : `${r.gateBlocked} — ${reasons.join(' · ')}`}
        </p>
        {prov && Object.values(prov.sources).length > 0 && (
          <section className={cs.section}>
            <h3>{r.sources}</h3>
            <ul className={cs.list}>
              {Object.values(prov.sources).map((s) => (
                <li key={s.id} data-testid="review-source">
                  <span>{sourceLine(I, s)}</span>
                  {(s.kind === 'image' || s.kind === 'pdf') && <button type="button" onClick={() => onCalibrate(s.id)}>{r.calibrate}</button>}
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className={cs.section}>
          <h3>{r.items} ({items.filter((x) => x.status === 'open').length} / {items.length})</h3>
          {items.length === 0 && <p className={cs.dim}>{r.none}</p>}
          {lows.length > 1 && <div><button type="button" className={cs.linkBtn} onClick={rejectAll}>{fmt(r.rejectAll, { n: lows.length })}</button></div>}
          <ul className={cs.list}>
            {items.map((it) => (
              <li key={it.id} data-testid="review-item" data-kind={it.kind} data-status={it.status}>
                <span>
                  <span className={`${cs.badge} ${it.status === 'open' ? cs.badgeWarn : cs.badgeOk}`}>{it.status === 'open' ? r.kind[it.kind] : r[it.status]}</span>{' '}
                  {itemText(I, it, prov?.sources[it.sourceId])}
                </span>
                <span className={cs.row}>
                  {it.entityId && <button type="button" onClick={() => show(it)}>{r.show}</button>}
                  {it.status === 'open' && it.kind === 'uncalibrated' && <button type="button" onClick={() => onCalibrate(it.sourceId)}>{r.calibrate}</button>}
                  {it.status === 'open' && it.kind === 'missing-measurement' && (
                    <>
                      <input aria-label={`${r.value} — ${measurementWords(I, it.key ?? '')}`} inputMode="decimal" style={{ width: 80 }} value={values[it.id] ?? ''} onChange={(e) => setValues({ ...values, [it.id]: e.target.value })} />
                      <button type="button" onClick={() => setMeasurement(it)}>{r.set}</button>
                    </>
                  )}
                  {it.status === 'open' && confirmable(it.kind) && <button type="button" onClick={() => decide(it, 'confirmed')}>{r.confirm}</button>}
                  {it.status === 'open' && (it.kind === 'ocr-low-confidence' || it.kind === 'ocr-dimension-mismatch') && <button type="button" onClick={() => decide(it, 'rejected')}>{r.reject}</button>}
                  {it.status === 'confirmed' && <button type="button" onClick={() => decide(it, 'open')}>{r.reopen}</button>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Modal>
  )
}
