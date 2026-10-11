import { ChevronDown, Focus, LayoutGrid } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { useCad, type DraftToggle } from '../../state/cad'
import { useCursor } from '../../state/cursor'
import { toast } from '../../state/toast'
import { LayoutToolIcon } from '../../components/icons'
import s from './StatusBar.module.css'

/** Widths and gaps from mockup 02 (ORTHO 630–702 … MODEL 1046–1127). */
const TOGGLES: { k: DraftToggle; label: string; style: 'pill' | 'switch'; key: string; w: number; ml: number }[] = [
  { k: 'ortho', label: 'ORTHO', style: 'pill', key: 'F8', w: 72, ml: 0 },
  { k: 'osnap', label: 'OSNAP', style: 'pill', key: 'F3', w: 70, ml: 10 },
  { k: 'grid', label: 'GRID', style: 'switch', key: 'F7', w: 67, ml: 13 },
  { k: 'snap', label: 'SNAP', style: 'switch', key: 'F9', w: 70, ml: 14 },
  { k: 'polar', label: 'POLAR', style: 'switch', key: 'F10', w: 72, ml: 14 },
  { k: 'model', label: 'MODEL', style: 'switch', key: '', w: 81, ml: 14 },
]

export const SCALES = ['1:1', '1:20', '1:50', '1:100', '1:200', '1:500']

export function CursorReadout() {
  const w = useCursor((st) => st.world)
  return <span className={s.coords}>{`${w.x.toFixed(3)}, ${w.y.toFixed(3)}, 0.000`}</span>
}

export function StatusBar() {
  const T = useT()
  const { toggles, toggle, sheet, set } = useCad()
  const isOn = (k: DraftToggle) => (k === 'model' ? sheet === 'model' : toggles[k])
  return (
    <div className={s.bar}>
      <CursorReadout />
      <div className={s.icons}>
        <button type="button" className={s.ibtn} aria-pressed={toggles.grid} aria-label={T.cad.status.gridDisplay} title={T.cad.status.gridDisplay} onClick={() => toggle('grid')}>
          <LayoutGrid size={18} strokeWidth={1.6} />
        </button>
        <button type="button" className={s.ibtn} aria-label={T.cad.status.snapTo} title={T.cad.status.snapTo} onClick={() => toast(fmt(T.toast.notImplemented, { feature: T.cad.status.snapTo }))}>
          <Focus size={18} strokeWidth={1.6} />
        </button>
      </div>
      <div className={s.toggles}>
        {TOGGLES.map(({ k, label, style, key, w, ml }) => {
          const on = isOn(k)
          return (
            <button
              key={k}
              type="button"
              className={`${s.tg} ${s[style]} ${on ? s.on : ''}`}
              aria-pressed={on}
              style={{ width: w, marginLeft: ml }}
              title={key ? `${label} (${key})` : label}
              onClick={() => (k === 'model' ? set({ sheet: sheet === 'model' ? 'layout1' : 'model' }) : toggle(k))}
            >
              {style === 'switch' && <span className={s.knob} />}
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function StatusRight() {
  const T = useT()
  const { scale, set, sheet } = useCad()
  return (
    <div className={s.right}>
      <label className={s.scale} title={T.cad.status.scale}>
        <span>{scale}</span>
        <ChevronDown size={14} strokeWidth={1.8} />
        <select value={scale} onChange={(e) => set({ scale: e.target.value })} aria-label={T.cad.status.scale}>
          {SCALES.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </label>
      <button type="button" className={s.paper} aria-label={T.cad.status.paper} title={T.cad.status.paper} onClick={() => set({ sheet: sheet === 'model' ? 'layout1' : 'model' })}>
        <LayoutToolIcon size={21} strokeWidth={1.5} />
      </button>
    </div>
  )
}
