import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Printer, Trash2 } from 'lucide-react'
import type { CadDocument, Layout } from '../../cad/types'
import { DEFAULT_LAYOUTS } from '../../cad/types'
import { fmt, useT } from '../../i18n'
import { useCad } from '../../state/cad'
import { toast } from '../../state/toast'
import { pageSvg, plotPage, PAPERS, type Paper } from '../../cad/plot'
import s from './PaperSpace.module.css'

const SCALES = [10, 20, 25, 50, 75, 100, 200, 500]

/** Layout tab: the plotted sheet itself (same page as the PDF / PNG plot), with paper and scale. */
export function PaperSpace({ doc, layout, onPlot }: { doc: CadDocument; layout: Layout; onPlot: () => void }) {
  const t = useT()
  const L = t.cad.sheets
  const { setLayouts, set } = useCad()
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [W, H] = PAPERS[layout.paper]
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const k = Math.min((e.contentRect.width * 0.92) / W, (e.contentRect.height * 0.86) / H)
      setBox({ w: Math.round(W * k), h: Math.round(H * k) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [W, H])
  const page = useMemo(() => plotPage(doc, layout.paper, layout.scale ?? undefined), [doc, layout.paper, layout.scale])
  const svg = useMemo(() => pageSvg(page).replace(/width="[^"]+mm" height="[^"]+mm"/, 'width="100%" height="100%"'), [page])
  const layouts = doc.layouts ?? DEFAULT_LAYOUTS
  const patch = (p: Partial<Layout>) => setLayouts(layouts.map((l) => (l.id === layout.id ? { ...l, ...p } : l)))
  const auto = plotPage(doc, layout.paper).scale
  return (
    <div ref={ref} className={s.paper}>
      <div className={s.bar}>
        <input aria-label={L.rename} value={layout.name} onChange={(e) => patch({ name: e.target.value })} />
        <label>
          {L.paperSize}
          <select aria-label={L.paperSize} value={layout.paper} onChange={(e) => patch({ paper: e.target.value as Paper })}>
            {(Object.keys(PAPERS) as Paper[]).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label>
          {L.scale}
          <select aria-label={L.scale} value={layout.scale ?? ''} onChange={(e) => patch({ scale: e.target.value ? Number(e.target.value) : null })}>
            <option value="">{fmt(L.auto, { n: auto })}</option>
            {SCALES.map((n) => <option key={n} value={n}>1:{n}</option>)}
          </select>
        </label>
        <button type="button" onClick={onPlot}><Printer size={14} />{L.plot}</button>
        <button
          type="button"
          aria-label={L.remove}
          title={L.remove}
          disabled={layouts.length <= 1}
          onClick={() => {
            setLayouts(layouts.filter((l) => l.id !== layout.id))
            set({ sheet: 'model' })
            toast(fmt(L.removed, { name: layout.name }))
          }}
        >
          <Trash2 size={14} />
        </button>
      </div>
      {box.w > 0 && <div className={s.sheet} style={{ width: box.w, height: box.h }} data-testid="paper-sheet" data-scale={page.scale} dangerouslySetInnerHTML={{ __html: svg }} />}
    </div>
  )
}
