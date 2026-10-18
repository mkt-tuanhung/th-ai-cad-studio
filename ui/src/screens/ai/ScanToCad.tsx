import { useEffect, useMemo, useState } from 'react'
import { fmt, useT } from '../../i18n'
import { Modal } from '../../components/ui/Modal'
import { ActionButton } from '../../components/ui/Button'
import { useCad } from '../../state/cad'
import { useRouter } from '../../state/router'
import { useAutoRun } from '../../state/auto'
import { toast } from '../../state/toast'
import { createBlankDocument } from '../../cad/seed'
import { importPdf, renderPdfPage, type PdfImport } from '../../cad/pdfImport'
import type { CadDocument, Entity } from '../../cad/types'
import { vectorize, type VectorizeResult } from '../../cad/vectorize'
import { fmtK, ocrReferences, solveScale, type CalRef } from '../../cad/calibration'
import { buildImport } from '../../cad/importReview'
import { addSource, openReview } from '../../cad/provenance'
import { beginApply, finishStep, markApplied, needUser, readyForReview, type AiJob } from '../../ai/jobs'
import { getJob, saveJob } from '../../ai/jobActions'
import { CalibrationPicker, CalibrationRefs } from './CalibrationPicker'
import cs from './Calibration.module.css'

const SCALES = [1, 20, 50, 100, 200, 500]

/**
 * Scan to CAD. Vector PDF → real CAD geometry (pdf.js path operators, see cad/pdfImport.ts). A raster image —
 * or a PDF page without vector paths — is vectorised (cad/vectorize.ts: traced lines + OCR text, offline) or
 * opened as an underlay to trace by hand; the dialog says plainly that this is image processing, not AI.
 *
 * v2.4: the scale is calibrated here (two points + true distance, or dimension texts; several references give a
 * residual), per page of a multi-page PDF whose page must be chosen explicitly. Without a calibration the drawing
 * still opens at the nominal dpi × scale selected, but labelled unscaled and REVIEW REQUIRED (cad/provenance.ts).
 */
export function ScanToCadModal({ file, onClose, jobId }: { file: File; onClose: () => void; jobId?: string | null }) {
  const T = useT()
  const t = T.ai.scan
  const c = T.importCal.cal
  const J = T.importCal.jobs
  const navigate = useRouter((st) => st.navigate)
  const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf'
  const [scale, setScale] = useState(100)
  const [page, setPage] = useState(1)
  const [pageChosen, setPageChosen] = useState(false)
  const [res, setRes] = useState<PdfImport | null>(null)
  const [busy, setBusy] = useState(isPdf)
  const [dpi, setDpi] = useState(150)
  const [img, setImg] = useState<{ src: string; w: number; h: number } | null>(null)
  const [vec, setVec] = useState<VectorizeResult | null>(null)
  const [step, setStep] = useState<string | null>(null)
  const [opt, setOpt] = useState({ ocr: true, ortho: true })
  const [refsByPage, setRefsByPage] = useState<Record<number, CalRef[]>>({})
  const [calPic, setCalPic] = useState<{ src: string; w: number; h: number; dpi: number; key: string } | null>(null)
  const base = file.name.replace(/\.[^.]+$/, '')
  const job = (fn: (j: AiJob) => AiJob) => { const j = getJob(jobId); if (j) saveJob(fn(j)) }

  useEffect(() => {
    let live = true
    if (isPdf) {
      setBusy(true)
      file.arrayBuffer().then((b) => importPdf(new Uint8Array(b), scale, page)).then(
        (r) => live && (setRes(r), setBusy(false)),
        (e) => { if (live) { toast(fmt(t.failed, { why: (e as Error).message }), 'warning'); onClose() } },
      )
    } else {
      const r = new FileReader()
      r.onload = () => {
        const src = String(r.result)
        const im = new Image()
        im.onload = () => live && setImg({ src, w: im.naturalWidth, h: im.naturalHeight })
        im.src = src
      }
      r.readAsDataURL(file)
    }
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, page])

  const multi = isPdf && !!res && res.pages > 1
  const needPage = multi && !pageChosen
  const empty = res && res.entities.filter((e) => e.kind !== 'text').length === 0
  const rasterMode = !isPdf || !!empty

  // job checkpoints: the file is in, the page is known
  useEffect(() => { job((j) => finishStep(j, 'intake', file.name)) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isPdf && res && !needPage) job((j) => finishStep(j, 'page', `${page} / ${res.pages}`))
    if (!isPdf && img) job((j) => finishStep(j, 'page', undefined, 'skipped'))
  }, [res, img, needPage, page]) // eslint-disable-line react-hooks/exhaustive-deps

  // a traced result belongs to the dpi / scale / page it was made at
  useEffect(() => setVec(null), [dpi, scale, page])

  // Calibration units: picture px for an image; mm on the sheet for a PDF page (the same at any rendering dpi).
  const nominalPerUnit = isPdf ? scale : (25.4 / dpi) * scale
  const unitLabel = isPdf ? c.unitSheet : c.unitPx
  const calDpi = rasterMode ? dpi : 100
  useEffect(() => {
    if (!isPdf || !res || needPage) return
    const key = `${page}@${calDpi}`
    if (calPic?.key === key) return
    let live = true
    file.arrayBuffer().then((b) => renderPdfPage(new Uint8Array(b), page, calDpi)).then((r) => live && setCalPic({ ...r, dpi: calDpi, key }))
    return () => { live = false }
  }, [res, page, calDpi, needPage]) // eslint-disable-line react-hooks/exhaustive-deps
  const pic = isPdf ? (calPic && calPic.key === `${page}@${calDpi}` ? calPic : null) : img && { ...img, dpi }
  const unitPerPx = isPdf && pic ? 25.4 / pic.dpi : 1

  const refs = refsByPage[page] ?? []
  const setRefs = (f: (r: CalRef[]) => CalRef[]) => setRefsByPage((m) => ({ ...m, [page]: f(m[page] ?? []) }))
  const fit = solveScale(refs)
  /** Entities whose dimension texts can calibrate: the traced scan, or the vector page. */
  const candidates = useMemo(() => {
    const ents: Entity[] = vec ? vec.entities : res && !empty ? res.entities : []
    return ocrReferences(ents, nominalPerUnit)
  }, [vec, res, empty, nominalPerUnit])
  const perUnitLabel = (k: number) => (isPdf ? fmt(c.calibratedSheet, { k: Math.abs(k - Math.round(k)) < 0.05 ? String(Math.round(k)) : k.toFixed(2), n: refs.length }) : fmt(c.calibrated, { k: fmtK(k), n: refs.length })) + (Math.abs(k / nominalPerUnit - 1) > 1e-9 ? ` · ${fmt(c.ratio, { ratio: (k / nominalPerUnit).toFixed(4) })}` : '')

  /** Builds the document: entities scaled by the calibration (or kept unscaled), provenance + review list. */
  const finish = (d: CadDocument, entities: Entity[], underlay?: { src: string; w: number; h: number; unitPerPx: number }) => {
    const r = buildImport({ kind: isPdf ? 'pdf' : 'image', file: file.name, page: isPdf ? page : null, entities, nominal: { dpi: rasterMode ? dpi : 0, scale, mmPerPx: nominalPerUnit }, refs })
    d.entities = r.entities
    if (underlay) {
      const mmPerPx = r.mmPerPx * underlay.unitPerPx
      d.underlay = { name: file.name, src: underlay.src, natW: underlay.w, natH: underlay.h, crop: { x: 0, y: 0, w: underlay.w, h: underlay.h }, origin: { x: 0, y: underlay.h * mmPerPx }, mmPerPx, drawIndex: 0 }
    }
    const out = addSource(d, r.source, r.review)
    return { doc: { ...out, dirty: false }, r }
  }

  const openDoc = (d: CadDocument) => {
    job((j) => beginApply(finishStep(finishStep(j, 'calibrate', fit ? `k ${fmtK(fit.k)}${fit.residual !== null ? `, ±${fit.residual.toFixed(1)} mm` : ''}` : undefined, fit ? 'done' : 'skipped'), 'vectorise', vec ? `${vec.entities.length}` : undefined, vec ? 'done' : 'skipped'), 'open'))
    useCad.getState().openDocument(d)
    job((j) => {
      let k = markApplied({ ...j, input: { ...j.input, docId: d.id, file: file.name } }, 'open', { store: 'cad-doc', label: d.name, ref: d.id }, d.name)
      const post = [fmt(J.postScan, { name: d.name, n: d.entities.length, cal: fit ? J.calYes : J.calNo, items: openReview(d).length })]
      k = { ...k, post }
      // no scale: the job waits for the user's calibration instead of guessing one
      return fit ? readyForReview(k, post) : needUser(k, [{ key: 'calibration', code: 'calibration-required', params: { file: file.name } }])
    })
    onClose()
    navigate('cad2d')
  }
  const openVectors = () => {
    if (!res) return
    const d0 = createBlankDocument(`${base}.dwg`)
    const known = new Set(d0.layers.map((l) => l.name))
    d0.layers = [...d0.layers, ...res.layers.filter((l) => !known.has(l.name)).map((l) => ({ name: l.name, color: l.color, visible: true, locked: false, linetype: 'Continuous' as const, lineweight: 0.25 }))]
    d0.currentLayer = res.layers[0]?.name ?? d0.currentLayer
    const { doc: d } = finish(d0, res.entities)
    openDoc(d)
    toast(fmt(t.opened, { name: d.name, n: res.entities.length }), 'success')
  }
  /** Underlay: the picture placed at the calibrated (or nominal) scale, its top-left corner at (0, height). */
  const openUnderlay = (src: string, w: number, h: number, pxUnit: number) => {
    const { doc: d } = finish(createBlankDocument(`${base}.dwg`), [], { src, w, h, unitPerPx: pxUnit })
    openDoc(d)
    toast(fmt(t.openedUnderlay, { name: d.name, w: Math.round(w * d.underlay!.mmPerPx), h: Math.round(h * d.underlay!.mmPerPx) }), 'success')
  }
  const pageUnderlay = async () => {
    // a scanned PDF page: rendered at `dpi`, placed at the drawing scale (or the calibration)
    const r = await renderPdfPage(new Uint8Array(await file.arrayBuffer()), page, dpi)
    openUnderlay(r.src, r.w, r.h, 25.4 / dpi)
  }
  const mmPerPx = (25.4 / dpi) * scale
  const shownMmPerPx = fit ? fit.k * (isPdf ? 25.4 / dpi : 1) : mmPerPx
  /** The picture to vectorise: the image, or the scanned PDF page rendered at `dpi`. */
  const picture = async () => (isPdf ? renderPdfPage(new Uint8Array(await file.arrayBuffer()), page, dpi) : img!)
  const runVectorize = async () => {
    setVec(null)
    const p = await picture()
    const el = new Image()
    await new Promise((r) => ((el.onload = r), (el.src = p.src)))
    const r = await vectorize(el, { mmPerPx, ...opt, onStep: (s, pct) => setStep(`${t.steps[s]}${pct !== undefined ? ` ${pct}%` : ''}`) })
    setStep(null)
    setVec(r)
    job((j) => finishStep(j, 'vectorise', `${r.entities.length}`))
    ;(window as unknown as { __lastVectorize?: unknown }).__lastVectorize = r
  }
  const openVector = async () => {
    if (!vec) return
    const p = await picture()
    const d0 = createBlankDocument(`${base}.dwg`)
    d0.layers = [
      ...d0.layers,
      { name: 'SCAN-LINES', color: '#111827', visible: true, locked: false, linetype: 'Continuous' as const, lineweight: 0.25 },
      { name: 'SCAN-TEXT', color: '#2563eb', visible: true, locked: false, linetype: 'Continuous' as const, lineweight: 0.18 },
      // uncertain OCR words: kept for review (v2.4), never silently dropped
      { name: 'SCAN-TEXT-REVIEW', color: '#d97706', visible: true, locked: false, linetype: 'Continuous' as const, lineweight: 0.18 },
    ]
    d0.currentLayer = 'SCAN-LINES'
    // the scan stays behind the vectors, at the same scale, to compare
    const { doc: d } = finish(d0, vec.entities, { src: p.src, w: p.w, h: p.h, unitPerPx: isPdf ? 25.4 / dpi : 1 })
    openDoc(d)
    toast(fmt(t.openedVector, { name: d.name, n: vec.entities.length }), 'success')
  }

  /** v2.4: the picture straight to the one-command dialog's plan review (walls, rooms → BIM + Interior). */
  const to3d = () => { onClose(); useAutoRun.getState().show(undefined, [file], isPdf ? page : undefined) }

  return (
    <Modal
      title={fmt(t.title, { file: file.name })}
      onClose={onClose}
      width={680}
      footer={
        rasterMode ? (
          <>
            <ActionButton disabled={(isPdf ? !res : !img) || needPage} onClick={() => (isPdf ? void pageUnderlay() : img && openUnderlay(img.src, img.w, img.h, 1))}>{t.openUnderlay}</ActionButton>
            <ActionButton disabled={(isPdf ? !res : !img) || !!step || needPage} onClick={() => void runVectorize()}>{t.vectorize}</ActionButton>
            <ActionButton variant="primary" disabled={!vec || needPage} onClick={() => void openVector()}>{t.openVector}</ActionButton>
            <ActionButton disabled={(isPdf ? !res : !img) || needPage} onClick={to3d} data-testid="scan-to-3d">{T.planImage.scanTo3d}</ActionButton>
          </>
        ) : (
          <>
            <ActionButton variant="primary" disabled={busy || !res || needPage} onClick={openVectors}>{t.open}</ActionButton>
            <ActionButton disabled={busy || !res || needPage} onClick={to3d} data-testid="scan-to-3d">{T.planImage.scanTo3d}</ActionButton>
          </>
        )
      }
    >
      <div className={cs.scroll}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
          <label>
            {t.scale}{' '}
            <select aria-label={t.scale} value={scale} onChange={(e) => setScale(Number(e.target.value))}>
              {SCALES.map((n) => <option key={n} value={n}>1:{n}</option>)}
            </select>
          </label>
          {multi && (
            <label>
              {t.page}{' '}
              <select aria-label={t.page} value={pageChosen ? page : 0} onChange={(e) => { setPage(Number(e.target.value)); setPageChosen(true) }}>
                {!pageChosen && <option value={0} disabled>{c.pageChoose}</option>}
                {Array.from({ length: res!.pages }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
              </select>
            </label>
          )}
          {rasterMode && (
            <>
              <label><input type="checkbox" checked={opt.ocr} onChange={(e) => setOpt({ ...opt, ocr: e.target.checked })} /> {t.optOcr}</label>
              <label><input type="checkbox" checked={opt.ortho} onChange={(e) => setOpt({ ...opt, ortho: e.target.checked })} /> {t.optOrtho}</label>
            </>
          )}
          {rasterMode && (
            <label>
              {t.dpi}{' '}
              <select aria-label={t.dpi} value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
                {[72, 100, 150, 200, 300, 600].map((n) => <option key={n}>{n}</option>)}
              </select>
            </label>
          )}
        </div>
        {needPage && <p className={cs.warn} role="alert" data-testid="scan-page-required">{fmt(c.pageRequired, { n: res!.pages })}</p>}
        <p role="status" data-testid="scan-result" style={{ fontSize: 13, lineHeight: 1.5 }}>
          {isPdf
            ? busy
              ? t.reading
              : res && (empty ? t.noVector : fmt(t.found, { ...res.counts, w: Math.round(res.paper.w), h: Math.round(res.paper.h) }))
            : <>{t.raster}{img && <><br />{fmt(t.size, { w: Math.round(img.w * shownMmPerPx), h: Math.round(img.h * shownMmPerPx) })}</>}</>}
        </p>
        {(step || vec) && (
          <p role="status" data-testid="scan-vector" title={vec?.words.map((w) => `${w.text} ${w.conf}%`).join(' · ')} style={{ fontSize: 13, lineHeight: 1.5 }}>
            {step ? fmt(t.vectorizing, { step }) : fmt(t.vectorized, { ...vec!.counts, ms: vec!.ms })}
            {vec && vec.review.length > 0 && <><br /><span data-testid="scan-review-words">{fmt(c.reviewWords, { n: vec.review.length })}</span></>}
          </p>
        )}
        {!needPage && (isPdf ? !!res : !!img) && (
          <section className={cs.section} data-testid="cal-section">
            <h3>{multi ? fmt(c.perPage, { n: page }) : c.title}</h3>
            <p className={fit ? cs.ok : cs.warn} data-testid="cal-status">
              {fit
                ? perUnitLabel(fit.k)
                : rasterMode
                  ? fmt(c.notCalibrated, { dpi, scale, k: fmtK(mmPerPx) })
                  : fmt(c.notCalibratedVector, { scale })}
            </p>
            <p className={cs.note}>{c.intro}</p>
            {pic && <CalibrationPicker key={`${page}-${pic.w}`} src={pic.src} w={pic.w} h={pic.h} unitPerPx={unitPerPx} refs={refs} onAdd={(r) => setRefs((x) => [...x, r])} />}
            <CalibrationRefs refs={refs} onRemove={(id) => setRefs((x) => x.filter((r) => r.id !== id))} candidates={candidates} onUse={(cs2) => setRefs((x) => [...x, ...cs2])} unit={unitLabel} perUnitLabel={perUnitLabel} />
          </section>
        )}
      </div>
    </Modal>
  )
}
