import { useMemo, useState } from 'react'
import { fmt, useT } from '../../i18n'
import { Modal } from '../../components/ui/Modal'
import { ActionButton } from '../../components/ui/Button'
import { useCad } from '../../state/cad'
import { toast } from '../../state/toast'
import { fmtK, ocrReferences, solveScale, type CalRef } from '../../cad/calibration'
import { recalibrate } from '../../cad/importReview'
import { CalibrationPicker, CalibrationRefs } from '../ai/CalibrationPicker'
import cs from '../ai/Calibration.module.css'

let n = 0

/**
 * CAD 2D → Calibrate an imported drawing after it was opened: two points on its underlay image, a selected line /
 * dimension of the drawing, or dimension texts — each with its true length. The whole drawing (and the image) is
 * scaled by the fitted factor about the origin in ONE undo step; the source records the calibration and residual,
 * and the dimension texts are checked against the new geometry.
 */
export function CalibrateDialog({ sourceId, onClose }: { sourceId: string | null; onClose: () => void }) {
  const T = useT()
  const c = T.importCal.cal
  const doc = useCad((st) => st.activeDoc())
  const selection = useCad((st) => st.selection)
  const sources = Object.values(doc?.provenance?.sources ?? {}).filter((s) => s.kind === 'image' || s.kind === 'pdf')
  const [sid, setSid] = useState(sourceId ?? sources.find((s) => !s.calibration)?.id ?? sources[0]?.id ?? '')
  const [refs, setRefs] = useState<CalRef[]>([])
  const [len, setLen] = useState('')
  const u = doc?.underlay
  const candidates = useMemo(() => (doc ? ocrReferences(doc.entities.filter((e) => e.src?.id === sid), 1) : []), [doc, sid])
  if (!doc) return null
  const fit = solveScale(refs)
  const sel = doc.entities.filter((e) => selection.includes(e.id))
  const one = sel.length === 1 ? sel[0] : null
  const selLen = one && (one.kind === 'line' || one.kind === 'dimension') ? Math.hypot(one.b.x - one.a.x, one.b.y - one.a.y) : one?.kind === 'polyline' && one.pts.length === 2 ? Math.hypot(one.pts[1].x - one.pts[0].x, one.pts[1].y - one.pts[0].y) : null
  const addSel = () => {
    const v = Number(len.replace(',', '.'))
    if (!one || selLen === null || !(v > 0)) return
    const [a, b] = one.kind === 'polyline' ? one.pts : one.kind === 'line' || one.kind === 'dimension' ? [one.a, one.b] : []
    if (!a || !b) return
    setRefs((r) => [...r, { id: `sel-${++n}`, method: 'entity-reference', a, b, measured: selLen, refDistance: v }])
    setLen('')
  }
  const apply = () => {
    const rc = recalibrate(doc, sid, refs)
    if (!rc) return
    const label = `CALIBRATE ×${rc.ratio.toFixed(4)}`
    // an image-only drawing changes no entity: a no-op op (current layer) keeps it one undo step, mirrored to the engine
    const err = useCad.getState().execBatch(rc.doc.entities.length ? [{ type: 'replace', entities: rc.doc.entities, label }] : [{ type: 'setCurrentLayer', layer: doc.currentLayer, label }], label, () => rc.doc)
    if (err) return useCad.getState().print(`${err.code} ${err.detail}`, 'error')
    const msg = fmt(c.applied, { name: doc.name, ratio: rc.ratio.toFixed(4), n: refs.length, res: rc.fit.residual === null ? '' : `, ±${rc.fit.residual.toFixed(1)} mm` })
    useCad.getState().print(msg, 'info')
    toast(msg, 'success')
    onClose()
  }

  return (
    <Modal
      title={fmt(c.dlgTitle, { name: doc.name })}
      onClose={onClose}
      width={680}
      footer={<><ActionButton onClick={onClose}>{c.cancel}</ActionButton><ActionButton variant="primary" disabled={!fit || !sid} onClick={apply}>{c.apply}</ActionButton></>}
    >
      <div className={cs.scroll} data-testid="calibrate-dialog">
        {!sources.length && <p className={cs.warn}>{c.noSource}</p>}
        {sources.length > 1 && (
          <label className={cs.row}>
            {c.source}
            <select aria-label={c.source} value={sid} onChange={(e) => setSid(e.target.value)}>
              {sources.map((s) => <option key={s.id} value={s.id}>{s.file}{s.page ? ` p.${s.page}` : ''}</option>)}
            </select>
          </label>
        )}
        <p className={cs.note}>{u ? c.dlgUnderlay : c.dlgNoUnderlay}</p>
        {u && <CalibrationPicker src={u.src} w={u.natW} h={u.natH} crop={u.crop} unitPerPx={u.mmPerPx} refs={refs} onAdd={(r) => setRefs((x) => [...x, r])} />}
        <div className={cs.row}>
          <span>{selLen !== null ? fmt(c.selectionLen, { len: selLen.toFixed(1) }) : c.noSelection}</span>
          <label>
            {c.trueDist} <input aria-label={`${c.trueDist} (${c.useSelection})`} inputMode="decimal" value={len} disabled={selLen === null} onChange={(e) => setLen(e.target.value)} />
          </label>
          <ActionButton disabled={selLen === null || !(Number(len.replace(',', '.')) > 0)} onClick={addSel}>{c.useSelection}</ActionButton>
        </div>
        <CalibrationRefs refs={refs} onRemove={(id) => setRefs((x) => x.filter((r) => r.id !== id))} candidates={candidates} onUse={(x) => setRefs((r) => [...r, ...x])} unit={c.unitMm} perUnitLabel={(k) => fmt(c.ratio, { ratio: fmtK(k) })} />
      </div>
    </Modal>
  )
}
