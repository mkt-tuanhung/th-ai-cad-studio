import { Plus, X } from 'lucide-react'
import { useT } from '../../i18n'
import { useCad } from '../../state/cad'
import s from './FileTabs.module.css'

export function FileTabs() {
  const t = useT()
  const { tabs, docs, activeId, setActive, closeTab, newDrawing } = useCad()
  return (
    <div className={s.bar} role="tablist">
      {tabs.map((id) => {
        const d = docs[id]
        if (!d) return null
        const active = id === activeId
        return (
          <div key={id} className={`${s.tab} ${active ? s.active : ''}`} role="tab" aria-selected={active}>
            <button type="button" className={s.main} onClick={() => setActive(id)} title={d.name}>
              <DwgBadge />
              <span className={s.name}>{d.name}</span>
              {d.dirty && <span className={s.dirty} title={t.cad.tabs.unsaved} />}
            </button>
            <button type="button" className={s.close} aria-label={`${t.cad.tabs.close} ${d.name}`} onClick={() => closeTab(id)}>
              <X size={15} strokeWidth={1.8} />
            </button>
          </div>
        )
      })}
      <button type="button" className={s.add} aria-label={t.cad.tabs.newTab} title={t.cad.tabs.newTab} onClick={() => newDrawing()}>
        <Plus size={18} strokeWidth={1.7} />
      </button>
    </div>
  )
}

/** Teal outlined drawing-file glyph used on document tabs. */
function DwgBadge() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1d8d93" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 3.5h6.5L18 8v10.5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z" />
      <path d="M12 9v6M9.5 12.5 12 15l2.5-2.5" />
    </svg>
  )
}
