import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box, FileDown, PenTool } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { useBim } from '../../state/bim'
import { useCad } from '../../state/cad'
import { useRouter } from '../../state/router'
import { toast } from '../../state/toast'
import { useHost } from '../../services/host'
import { bimExtras, nativeBuildingModel } from '../../bim/scene'
import { drawingDocument, nativeRequest, type NativeDrawing } from '../../bim/drawing2d'
import { pageSvg, plotPage } from '../../cad/plot'
import type { CadDocument } from '../../cad/types'
import s from './BimDrawing.module.css'

/**
 * 2D elevation / section of the model (Project Browser → Elevations, Sections, Sheets): drawn by the OCCT
 * kernel's hidden-line removal on its own scene ('bim2d', kept in step with the model), annotated from the
 * model, shown as the A3 1:100 sheet it plots to. Opens in CAD 2D for editing and DWG / DXF / PDF export.
 */
export function BimDrawing() {
  const T = useT()
  const t = T.bim.toast
  const { model, drawing, requestView } = useBim()
  const host = useHost()
  const navigate = useRouter((st) => st.navigate)
  const [doc, setDoc] = useState<CadDocument | null>(null)
  const [info, setInfo] = useState<{ lines: number; cut: number; ms: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const modelJson = useMemo(() => JSON.stringify(nativeBuildingModel(model)), [model])
  const extrasJson = useMemo(() => JSON.stringify(bimExtras(model)), [model])
  // the whole A3 sheet fits the area (title block included)
  const area = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    const fit = () => {
      const W = el.clientWidth - 28, H = el.clientHeight - 28
      const w = Math.max(0, Math.min(W, H * (420 / 297)))
      setBox({ w, h: w * (297 / 420) })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!host || !drawing) return
    let live = true
    setDoc(null)
    setError(null)
    void (async () => {
      const load = await host.scene3dLoadBim('bim2d', modelJson, extrasJson)
      if (!load.ok) return live && setError(load.error ?? 'scene')
      const b = (await host.scene3dCommand('bim2d', JSON.stringify({ cmd: 'bounds' }))).bounds ?? [0, 0, 0, 0, 0, 0]
      const req = nativeRequest(drawing, b)
      const r = (await host.scene3dCommand('bim2d', JSON.stringify(req))) as unknown as { ok: boolean; error?: string } & NativeDrawing
      if (!live) return
      if (!r.ok) return setError(r.error ?? 'HLR')
      setInfo({ lines: r.lines.length, cut: r.cut.length, ms: Math.round(r.ms) })
      setDoc(drawingDocument(model, drawing, r, 'at' in req ? req.at : undefined))
    })()
    return () => {
      live = false
    }
  }, [host, drawing, modelJson, extrasJson, model])

  const page = useMemo(() => (doc ? plotPage(doc, 'A3', 100) : null), [doc])
  const svg = useMemo(() => (page ? pageSvg(page).replace(/width="[^"]+mm" height="[^"]+mm"/, 'width="100%" height="100%"') : ''), [page])

  if (!drawing) return null
  const open = () => {
    if (!doc) return
    useCad.getState().openDocument({ ...doc, id: `${doc.id}-${Date.now().toString(36)}` })
    toast(fmt(t.drawingOpened, { name: doc.name, layout: drawing.title }), 'success')
    navigate('cad2d')
  }
  const pdf = async () => {
    if (!host || !page) return
    const r = await host.cadExportPdf(JSON.stringify({ ...page, name: drawing.title }), `Villa Riverside - ${drawing.title}.pdf`)
    if (r.ok) toast(fmt(T.cad.toast.pdfSaved, { file: r.path!.split(/[\\/]/).pop()!, paper: 'A3', scale: 100 }), 'success')
    else if (!r.cancelled) toast(r.error ?? 'PDF', 'warning')
  }
  const to3d = () =>
    requestView(drawing.kind === 'section' ? { kind: 'section', axis: drawing.axis, face: drawing.face } : { kind: 'elev', face: drawing.face })

  return (
    <section className={s.wrap} aria-label={drawing.title} data-testid="bim-drawing">
      <div className={s.bar}>
        <b>{drawing.title}</b>
        <span className={s.info}>{info && doc ? fmt(t.drawingInfo, info) : host ? fmt(t.drawingMaking, { title: drawing.title }) : ''}</span>
        <button type="button" onClick={to3d}><Box size={14} />{t.drawing3d}</button>
        <button type="button" disabled={!page} onClick={() => void pdf()}><FileDown size={14} />{t.drawingPdf}</button>
        <button type="button" className={s.primary} disabled={!doc} onClick={open}><PenTool size={14} />{t.drawingOpen}</button>
      </div>
      <div ref={area} className={s.sheetArea}>
        {!host && <p className={s.note}>{t.drawingDesktop}</p>}
        {error && <p className={s.note}>{fmt(t.drawingFailed, { why: error })}</p>}
        {svg && <div className={s.sheet} style={{ width: box.w, height: box.h }} data-testid="bim-drawing-sheet" dangerouslySetInnerHTML={{ __html: svg }} />}
      </div>
    </section>
  )
}
