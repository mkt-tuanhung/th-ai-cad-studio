import { useState } from 'react'
import { fmt, useT } from '../../i18n'
import { ActionButton } from '../../components/ui/Button'
import { solveScale, type CalRef } from '../../cad/calibration'
import type { Vec2 } from '../../cad/types'
import s from './Calibration.module.css'

let n = 0
const refId = () => `ref-${Date.now().toString(36)}-${++n}`

/**
 * Two-point calibration on a picture (image, PDF page, CAD underlay): click two points of a known distance, type
 * the true distance, add — as many references as wanted. `unitPerPx` turns picture px into the units the caller
 * measures in (1 for image px, 25.4/dpi for PDF sheet mm, the underlay's mm/px for a CAD drawing).
 */
export function CalibrationPicker({ src, w, h, unitPerPx = 1, refs, onAdd, crop }: {
  src: string
  w: number
  h: number
  unitPerPx?: number
  refs: CalRef[]
  onAdd: (r: CalRef) => void
  /** Part of the picture shown (underlay crop), px. */
  crop?: { x: number; y: number; w: number; h: number }
}) {
  const t = useT().importCal.cal
  const [pts, setPts] = useState<Vec2[]>([])
  const [dist, setDist] = useState('')
  const [zoom, setZoom] = useState(0)
  const c = crop ?? { x: 0, y: 0, w, h }
  const fitW = 600
  const scale = zoom === 0 ? Math.min(1, fitW / c.w) : zoom
  const px = pts.length === 2 ? Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) : 0
  const add = () => {
    const v = Number(dist.replace(',', '.'))
    if (pts.length !== 2 || !(v > 0) || px < 1) return
    onAdd({ id: refId(), method: 'two-point', a: { x: pts[0].x * unitPerPx, y: pts[0].y * unitPerPx }, b: { x: pts[1].x * unitPerPx, y: pts[1].y * unitPerPx }, measured: px * unitPerPx, refDistance: v })
    setPts([])
    setDist('')
  }
  const r = Math.max(2, 5 / scale)
  return (
    <div className={s.picker}>
      <div className={s.pickBar}>
        <span role="status" data-testid="cal-pick-status">{pts.length === 0 ? t.pickA : pts.length === 1 ? t.pickB : fmt(t.picked, { px: px.toFixed(1) })}</span>
        <label>
          {t.zoom}{' '}
          <select aria-label={t.zoom} value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
            <option value={0}>{t.fit}</option>
            {[0.5, 1, 2, 4].map((z) => <option key={z} value={z}>{z * 100} %</option>)}
          </select>
        </label>
      </div>
      <div className={s.pickArea}>
        <div
          className={s.pickInner}
          style={{ width: c.w * scale, height: c.h * scale }}
          data-testid="cal-picker"
          data-w={c.w}
          data-h={c.h}
          onMouseDown={(e) => {
            const b = e.currentTarget.getBoundingClientRect()
            const p = { x: c.x + ((e.clientX - b.left) / b.width) * c.w, y: c.y + ((e.clientY - b.top) / b.height) * c.h }
            setPts((q) => (q.length >= 2 ? [p] : [...q, p]))
          }}
        >
          <img src={src} alt="" draggable={false} style={{ width: w * scale, height: h * scale, marginLeft: -c.x * scale, marginTop: -c.y * scale }} />
          <svg viewBox={`${c.x} ${c.y} ${c.w} ${c.h}`} preserveAspectRatio="none">
            {refs.filter((x) => x.method !== 'entity-reference').map((x) => (
              <line key={x.id} x1={x.a.x / unitPerPx} y1={x.a.y / unitPerPx} x2={x.b.x / unitPerPx} y2={x.b.y / unitPerPx} className={s.refLine} style={{ strokeWidth: 2 / scale }} />
            ))}
            {pts.length === 2 && <line x1={pts[0].x} y1={pts[0].y} x2={pts[1].x} y2={pts[1].y} className={s.pickLine} style={{ strokeWidth: 2 / scale }} />}
            {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={r} className={s.pickDot} style={{ strokeWidth: 1.5 / scale }} />)}
          </svg>
        </div>
      </div>
      <div className={s.pickBar}>
        <label>
          {t.trueDist}{' '}
          <input aria-label={t.trueDist} data-testid="cal-true" inputMode="decimal" value={dist} disabled={pts.length !== 2} onChange={(e) => setDist(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        </label>
        <ActionButton disabled={pts.length !== 2 || !(Number(dist.replace(',', '.')) > 0)} onClick={add}>{t.add}</ActionButton>
        <ActionButton variant="ghost" disabled={!pts.length} onClick={() => setPts([])}>{t.clear}</ActionButton>
      </div>
    </div>
  )
}

/** The references, the fitted scale and its residual, and the dimension-text candidates. */
export function CalibrationRefs({ refs, onRemove, candidates, onUse, unit, perUnitLabel }: {
  refs: CalRef[]
  onRemove: (id: string) => void
  candidates: CalRef[]
  onUse: (r: CalRef[]) => void
  unit: string
  /** How the fitted factor reads ("1 px = {k} mm"…). */
  perUnitLabel: (k: number) => string
}) {
  const t = useT().importCal.cal
  const fit = solveScale(refs)
  const used = new Set(refs.map((r) => r.id))
  const free = candidates.filter((c) => !used.has(c.id))
  return (
    <div className={s.refs}>
      {fit && (
        <p className={s.fit} data-testid="cal-fit">
          {perUnitLabel(fit.k)} · {fit.residual === null ? t.oneRef : fmt(t.residual, { r: fit.residual.toFixed(1), max: (fit.maxErr ?? 0).toFixed(1) })}
        </p>
      )}
      {refs.length > 0 && (
        <ul className={s.refList} aria-label={t.refs}>
          {refs.map((r) => {
            const pr = fit?.perRef.find((p) => p.id === r.id)
            return (
              <li key={r.id}>
                <span>
                  {fmt(t.refRow, { method: t.methods[r.method] + (r.text ? ` “${r.text}”` : ''), measured: r.measured.toFixed(1), unit, true: r.refDistance })}
                  {pr && refs.length > 1 && <em> — {fmt(t.refFit, { fit: pr.fitted.toFixed(1), err: `${pr.err >= 0 ? '+' : ''}${pr.err.toFixed(1)} mm` })}</em>}
                </span>
                <button type="button" onClick={() => onRemove(r.id)}>{t.remove}</button>
              </li>
            )
          })}
        </ul>
      )}
      <div className={s.ocr}>
        <b>{t.ocrTitle}</b>
        {candidates.length === 0 && <span className={s.dim}>{t.ocrNone}</span>}
        {free.length > 1 && <button type="button" onClick={() => onUse(free)}>{t.useAllOcr}</button>}
        <ul>
          {free.map((c) => (
            <li key={c.id}>
              <span>{fmt(t.ocrRow, { text: c.text ?? '', measured: c.measured.toFixed(1), unit })}</span>
              <button type="button" onClick={() => onUse([c])}>{t.useOcr}</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

