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

const SCALES = [1, 20, 50, 100, 200, 500]

/**
 * Scan to CAD. Vector PDF → real CAD geometry (pdf.js path operators, see cad/pdfImport.ts). A raster image —
 * or a PDF page without vector paths — is opened as an underlay to trace: vectorising pixels needs a vision
 * model that this build does not include, and the dialog says so.
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

  return (
    <Modal
      title={fmt(t.title, { file: file.name })}
      onClose={onClose}
      width={540}
      footer={
        isPdf ? (
          <>
            {empty && <ActionButton onClick={() => void pageUnderlay()}>{t.openUnderlay}</ActionButton>}
            <ActionButton variant="primary" disabled={busy || !res || !!empty} onClick={openVectors}>{t.open}</ActionButton>
          </>
        ) : (
          <ActionButton variant="primary" disabled={!img} onClick={() => img && openUnderlay(img.src, img.w, img.h, mmPerPx)}>{t.openUnderlay}</ActionButton>
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
        {(!isPdf || empty) && (
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
    </Modal>
  )
}
