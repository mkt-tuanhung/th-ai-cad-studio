import { useEffect, useState } from 'react'
import { fmt, useT } from '../../i18n'
import { Modal } from '../../components/ui/Modal'
import { ActionButton } from '../../components/ui/Button'
import { useCad } from '../../state/cad'
import { useRouter } from '../../state/router'
import { toast } from '../../state/toast'
import { createBlankDocument } from '../../cad/seed'
import { importPdf, renderPdfPage, type PdfImport } from '../../cad/pdfImport'
import type { CadDocument } from '../../cad/types'
import { vectorize, type VectorizeResult } from '../../cad/vectorize'

const SCALES = [1, 20, 50, 100, 200, 500]

/**
 * Scan to CAD. Vector PDF → real CAD geometry (pdf.js path operators, see cad/pdfImport.ts). A raster image —
 * or a PDF page without vector paths — is vectorised (cad/vectorize.ts: traced lines + OCR text, offline) or
 * opened as an underlay to trace by hand; the dialog says plainly that this is image processing, not AI.
 */
export function ScanToCadModal({ file, onClose }: { file: File; onClose: () => void }) {
  const t = useT().ai.scan
  const navigate = useRouter((st) => st.navigate)
  const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf'
  const [scale, setScale] = useState(100)
  const [page, setPage] = useState(1)
  const [res, setRes] = useState<PdfImport | null>(null)
  const [busy, setBusy] = useState(isPdf)
  const [dpi, setDpi] = useState(150)
  const [img, setImg] = useState<{ src: string; w: number; h: number } | null>(null)
  const [vec, setVec] = useState<VectorizeResult | null>(null)
  const [step, setStep] = useState<string | null>(null)
  const [opt, setOpt] = useState({ ocr: true, ortho: true })
  const base = file.name.replace(/\.[^.]+$/, '')

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

  const openDoc = (d: CadDocument) => {
    useCad.getState().openDocument(d)
    onClose()
    navigate('cad2d')
  }
  const openVectors = () => {
    if (!res) return
    const d = createBlankDocument(`${base}.dwg`)
    const known = new Set(d.layers.map((l) => l.name))
    d.layers = [...d.layers, ...res.layers.filter((l) => !known.has(l.name)).map((l) => ({ name: l.name, color: l.color, visible: true, locked: false, linetype: 'Continuous' as const, lineweight: 0.25 }))]
    d.entities = res.entities
    d.currentLayer = res.layers[0]?.name ?? d.currentLayer
    openDoc(d)
    toast(fmt(t.opened, { name: d.name, n: res.entities.length }), 'success')
  }
  /** Underlay: the picture placed at `mmPerPx`, its top-left corner at (0, height). */
  const openUnderlay = (src: string, w: number, h: number, mmPerPx: number) => {
    const d = createBlankDocument(`${base}.dwg`)
    d.underlay = { name: file.name, src, natW: w, natH: h, crop: { x: 0, y: 0, w, h }, origin: { x: 0, y: h * mmPerPx }, mmPerPx, drawIndex: 0 }
    openDoc(d)
    toast(fmt(t.openedUnderlay, { name: d.name, w: Math.round(w * mmPerPx), h: Math.round(h * mmPerPx) }), 'success')
  }
  const pageUnderlay = async () => {
    // a scanned PDF page: rendered at `dpi`, placed at the drawing scale
    const r = await renderPdfPage(new Uint8Array(await file.arrayBuffer()), page, dpi)
    openUnderlay(r.src, r.w, r.h, (25.4 / dpi) * scale)
  }
  const mmPerPx = (25.4 / dpi) * scale
  const empty = res && res.entities.filter((e) => e.kind !== 'text').length === 0
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
    ;(window as unknown as { __lastVectorize?: unknown }).__lastVectorize = r
  }
  const openVector = async () => {
    if (!vec) return
    const p = await picture()
    const d = createBlankDocument(`${base}.dwg`)
    d.layers = [...d.layers, { name: 'SCAN-LINES', color: '#111827', visible: true, locked: false, linetype: 'Continuous' as const, lineweight: 0.25 }, { name: 'SCAN-TEXT', color: '#2563eb', visible: true, locked: false, linetype: 'Continuous' as const, lineweight: 0.18 }]
    d.entities = vec.entities
    d.currentLayer = 'SCAN-LINES'
    // the scan stays behind the vectors, at the same scale, to compare
    d.underlay = { name: file.name, src: p.src, natW: p.w, natH: p.h, crop: { x: 0, y: 0, w: p.w, h: p.h }, origin: { x: 0, y: p.h * mmPerPx }, mmPerPx, drawIndex: 0 }
    openDoc(d)
    toast(fmt(t.openedVector, { name: d.name, n: vec.entities.length }), 'success')
  }
  const rasterMode = !isPdf || !!empty

  return (
    <Modal
      title={fmt(t.title, { file: file.name })}
      onClose={onClose}
      width={540}
      footer={
        rasterMode ? (
          <>
            <ActionButton disabled={isPdf ? !res : !img} onClick={() => (isPdf ? void pageUnderlay() : img && openUnderlay(img.src, img.w, img.h, mmPerPx))}>{t.openUnderlay}</ActionButton>
            <ActionButton disabled={(isPdf ? !res : !img) || !!step} onClick={() => void runVectorize()}>{t.vectorize}</ActionButton>
            <ActionButton variant="primary" disabled={!vec} onClick={() => void openVector()}>{t.openVector}</ActionButton>
          </>
        ) : (
          <ActionButton variant="primary" disabled={busy || !res} onClick={openVectors}>{t.open}</ActionButton>
        )
      }
    >
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
        <label>
          {t.scale}{' '}
          <select aria-label={t.scale} value={scale} onChange={(e) => setScale(Number(e.target.value))}>
            {SCALES.map((n) => <option key={n} value={n}>1:{n}</option>)}
          </select>
        </label>
        {isPdf && res && res.pages > 1 && (
          <label>
            {t.page}{' '}
            <select aria-label={t.page} value={page} onChange={(e) => setPage(Number(e.target.value))}>
              {Array.from({ length: res.pages }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
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
      <p role="status" data-testid="scan-result" style={{ fontSize: 13, lineHeight: 1.5, paddingBottom: 6 }}>
        {isPdf
          ? busy
            ? t.reading
            : res && (empty ? t.noVector : fmt(t.found, { ...res.counts, w: Math.round(res.paper.w), h: Math.round(res.paper.h) }))
          : <>{t.raster}{img && <><br />{fmt(t.size, { w: Math.round(img.w * mmPerPx), h: Math.round(img.h * mmPerPx) })}</>}</>}
      </p>
      {(step || vec) && (
        <p role="status" data-testid="scan-vector" title={vec?.words.map((w) => `${w.text} ${w.conf}%`).join(' · ')} style={{ fontSize: 13, lineHeight: 1.5, paddingBottom: 6 }}>
          {step ? fmt(t.vectorizing, { step }) : fmt(t.vectorized, { ...vec!.counts, ms: vec!.ms })}
        </p>
      )}
    </Modal>
  )
}
