import { Plus } from 'lucide-react'
import { useT } from '../../i18n'
import { useCad, type SheetTab } from '../../state/cad'
import { toast } from '../../state/toast'
import { ModelViewport } from './ModelViewport'
import { PaperSpace } from './PaperSpace'
import s from './CanvasCard.module.css'

const SHEETS: SheetTab[] = ['model', 'layout1', 'layout2']

/**
 * Drawing area. In the desktop host (architecture option A) the native OCCT viewport is placed into
 * this slot (`data-native-viewport-slot`); in the browser the prototype SVG viewport renders here.
 */
export function CanvasCard() {
  const t = useT().cad
  const doc = useCad((st) => st.activeDoc())
  const { sheet, set } = useCad()
  return (
    <section className={s.card}>
      <div className={s.tabs} role="tablist">
        {SHEETS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={sheet === k} className={`${s.tab} ${sheet === k ? s.on : ''}`} onClick={() => set({ sheet: k })}>
            {t.sheets[k]}
          </button>
        ))}
        <span className={s.sep} />
        <button type="button" className={s.add} aria-label={t.sheets.add} title={t.sheets.add} onClick={() => toast(t.toast.layoutNative)}>
          <Plus size={17} strokeWidth={1.6} />
        </button>
      </div>
      <div className={s.area} data-native-viewport-slot>
        {doc && sheet === 'model' && <ModelViewport key={doc.id} doc={doc} />}
        {doc && sheet !== 'model' && <PaperSpace doc={doc} sheet={t.sheets[sheet]} />}
      </div>
    </section>
  )
}
