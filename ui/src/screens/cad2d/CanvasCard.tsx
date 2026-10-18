import { Plus } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { useCad } from '../../state/cad'
import { toast } from '../../state/toast'
import { DEFAULT_LAYOUTS } from '../../cad/types'
import { openReview, reviewRequired } from '../../cad/provenance'
import { ModelViewport } from './ModelViewport'
import { PaperSpace } from './PaperSpace'
import s from './CanvasCard.module.css'

/**
 * Drawing area: Model plus the document's paper-space layouts (paper size + plot scale, previewed exactly as
 * they plot). In the desktop host the native viewport is placed into this slot (`data-native-viewport-slot`).
 */
export function CanvasCard({ onPlot, onReview }: { onPlot?: (layoutId: string) => void; onReview?: () => void }) {
  const T = useT()
  const t = T.cad
  const doc = useCad((st) => st.activeDoc())
  const { sheet, set, setLayouts } = useCad()
  const layouts = doc?.layouts ?? DEFAULT_LAYOUTS
  const current = layouts.find((l) => l.id === sheet)
  const addLayout = () => {
    const n = layouts.length + 1
    const l = { id: `layout-${Date.now().toString(36)}`, name: `Layout${n}`, paper: 'A3' as const, scale: null }
    setLayouts([...layouts, l])
    set({ sheet: l.id })
    toast(fmt(t.sheets.added, { name: l.name }))
  }
  return (
    <section className={s.card}>
      <div className={s.tabs} role="tablist">
        <button type="button" role="tab" aria-selected={sheet === 'model' || !current} className={`${s.tab} ${sheet === 'model' || !current ? s.on : ''}`} onClick={() => set({ sheet: 'model' })}>
          {t.sheets.model}
        </button>
        {layouts.map((l) => (
          <button key={l.id} type="button" role="tab" aria-selected={sheet === l.id} className={`${s.tab} ${sheet === l.id ? s.on : ''}`} onClick={() => set({ sheet: l.id })}>
            {l.name}
          </button>
        ))}
        <span className={s.sep} />
        <button type="button" className={s.add} aria-label={t.sheets.add} title={t.sheets.add} onClick={addLayout}>
          <Plus size={17} strokeWidth={1.6} />
        </button>
        {doc && reviewRequired(doc) && (
          // v2.4: imported geometry not verified (no calibration / open review items) — outside the native viewport slot
          <button type="button" className={s.review} data-testid="review-banner" title={fmt(T.importCal.review.bannerTitle, { n: openReview(doc).length })} onClick={onReview}>
            {T.importCal.review.banner} · {openReview(doc).length}
          </button>
        )}
      </div>
      <div className={s.area} data-native-viewport-slot>
        {doc && !current && <ModelViewport key={doc.id} doc={doc} />}
        {doc && current && <PaperSpace doc={doc} layout={current} onPlot={() => onPlot?.(current.id)} />}
      </div>
    </section>
  )
}
