import { useMemo, useState } from 'react'
import { fmt, useT } from '../../i18n'
import { Modal } from '../../components/ui/Modal'
import { ActionButton } from '../../components/ui/Button'
import { useCad } from '../../state/cad'
import { toast } from '../../state/toast'
import { SURVEY_LAYERS, surveyRoom, type SurveyDoor, type SurveyInput } from '../../cad/survey'
import { buildSurvey } from '../../cad/importReview'
import { addSource } from '../../cad/provenance'
import type { CadOp } from '../../cad/commandBus'
import { measurementWords } from './ReviewDialog'
import cs from '../ai/Calibration.module.css'

const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))

/**
 * Measured room (survey, v2.4 SP14): sides, corner angles, diagonals, wall thickness, ceiling height, tolerance and
 * doors typed as measured → CAD 2D geometry with survey provenance, added to the active drawing in one undo step.
 * The result (shape, misclosure, diagonals, squareness, tolerance, what is still missing) is shown before adding.
 */
export function SurveyRoomDialog({ onClose }: { onClose: () => void }) {
  const T = useT()
  const t = T.importCal.survey
  const [name, setName] = useState(t.defaultName)
  const [sides, setSides] = useState<string[]>(['4000', '3000', '4000', '3000'])
  const [angles, setAngles] = useState<string[]>(['', '', '', ''])
  const [d02, setD02] = useState('')
  const [d13, setD13] = useState('')
  const [wall, setWall] = useState('200')
  const [height, setHeight] = useState('')
  const [tol, setTol] = useState('10')
  const [doors, setDoors] = useState<{ side: string; offset: string; width: string }[]>([])

  const input: SurveyInput = useMemo(() => {
    const diagonals = sides.length === 4 ? ([[0, 2, d02], [1, 3, d13]] as const).filter(([, , v]) => (num(v) ?? 0) > 0).map(([from, to, v]) => ({ from, to, length: num(v)! })) : []
    const ds: SurveyDoor[] = doors.map((d) => ({ side: Math.max(0, Number(d.side) - 1), offset: num(d.offset), width: num(d.width) }))
    return {
      name: name.trim() || t.defaultName,
      sides: sides.map((x) => num(x) ?? 0),
      angles: angles.map((a) => num(a)),
      diagonals,
      wallThickness: num(wall) ?? 0,
      ceilingHeight: num(height) ?? 0,
      tolerance: Math.max(0, num(tol) ?? 0),
      doors: ds,
    }
  }, [name, sides, angles, d02, d13, wall, height, tol, doors, t.defaultName])
  const r = useMemo(() => surveyRoom(input), [input])

  const insert = () => {
    const b = buildSurvey(input, { area: t.area, height: t.heightShort, doorMissing: t.doorMissing })
    if (!b.ok) return
    const cad = useCad.getState()
    if (!cad.activeDoc()) cad.newDrawing()
    const doc = cad.activeDoc()!
    const ops: CadOp[] = [
      ...SURVEY_LAYERS.filter((l) => !doc.layers.some((x) => x.name === l.name)).map((l) => ({ type: 'addLayer' as const, name: l.name, color: l.color, label: 'SURVEYROOM' })),
      { type: 'add', entities: b.entities, label: 'SURVEYROOM' },
    ]
    const err = cad.execBatch(ops, `SURVEYROOM ${input.name}`, (d) => addSource(d, b.source, b.review))
    if (err) return cad.print(`${err.code} ${err.detail}`, 'error')
    const msg = fmt(t.inserted, { name: input.name, n: b.entities.length })
    cad.print(msg, 'info')
    toast(msg, b.review.length ? 'warning' : 'success')
    onClose()
  }

  const setAt = (arr: string[], i: number, v: string) => arr.map((x, j) => (j === i ? v : x))
  return (
    <Modal title={t.title} onClose={onClose} width={720} footer={<><ActionButton onClick={onClose}>{t.cancel}</ActionButton><ActionButton variant="primary" disabled={!r.ok} onClick={insert}>{t.insert}</ActionButton></>}>
      <div className={cs.scroll} data-testid="survey-dialog">
        <p className={cs.note}>{t.intro}</p>
        <div className={cs.grid}>
          <label>{t.name}<input aria-label={t.name} value={name} onChange={(e) => setName(e.target.value)} style={{ width: 140 }} /></label>
          <label>{t.wall}<input aria-label={t.wall} inputMode="decimal" value={wall} onChange={(e) => setWall(e.target.value)} /></label>
          <label>{t.height}<input aria-label={t.height} inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} /></label>
          <label>{t.tolerance}<input aria-label={t.tolerance} inputMode="decimal" value={tol} onChange={(e) => setTol(e.target.value)} /></label>
        </div>
        <section className={cs.section}>
          <h3>{t.sides}</h3>
          <div className={cs.grid}>
            {sides.map((v, i) => (
              <label key={`s${i}`}>{fmt(t.side, { n: i + 1 })}<input aria-label={fmt(t.side, { n: i + 1 })} inputMode="decimal" value={v} onChange={(e) => setSides(setAt(sides, i, e.target.value))} /></label>
            ))}
            {angles.map((v, i) => (
              <label key={`a${i}`}>{fmt(t.angle, { n: i + 1 })}<input aria-label={fmt(t.angle, { n: i + 1 })} inputMode="decimal" placeholder="90" value={v} onChange={(e) => setAngles(setAt(angles, i, e.target.value))} /></label>
            ))}
          </div>
          <div className={cs.row}>
            <button type="button" className={cs.linkBtn} onClick={() => { setSides([...sides, '']); setAngles([...angles, '']) }}>{t.addSide}</button>
            <button type="button" className={cs.linkBtn} disabled={sides.length <= 3} onClick={() => { setSides(sides.slice(0, -1)); setAngles(angles.slice(0, -1)) }}>{t.removeSide}</button>
          </div>
          {sides.length === 4 && (
            <>
              <b>{t.diagonals}</b>
              <div className={cs.grid}>
                <label>{fmt(t.diag, { a: 1, b: 3 })}<input aria-label={fmt(t.diag, { a: 1, b: 3 })} inputMode="decimal" value={d02} onChange={(e) => setD02(e.target.value)} /></label>
                <label>{fmt(t.diag, { a: 2, b: 4 })}<input aria-label={fmt(t.diag, { a: 2, b: 4 })} inputMode="decimal" value={d13} onChange={(e) => setD13(e.target.value)} /></label>
              </div>
            </>
          )}
        </section>
        <section className={cs.section}>
          <h3>{t.doors}</h3>
          {doors.map((d, i) => (
            <div key={i} className={cs.row}>
              <b>{fmt(t.door, { n: i + 1 })}</b>
              <label>{t.doorSide}<select aria-label={`${fmt(t.door, { n: i + 1 })} ${t.doorSide}`} value={d.side} onChange={(e) => setDoors(doors.map((x, j) => (j === i ? { ...x, side: e.target.value } : x)))}>{sides.map((_, k) => <option key={k} value={k + 1}>{k + 1}</option>)}</select></label>
              <label>{t.doorOffset}<input aria-label={`${fmt(t.door, { n: i + 1 })} ${t.doorOffset}`} inputMode="decimal" value={d.offset} onChange={(e) => setDoors(doors.map((x, j) => (j === i ? { ...x, offset: e.target.value } : x)))} /></label>
              <label>{t.doorWidth}<input aria-label={`${fmt(t.door, { n: i + 1 })} ${t.doorWidth}`} inputMode="decimal" value={d.width} onChange={(e) => setDoors(doors.map((x, j) => (j === i ? { ...x, width: e.target.value } : x)))} /></label>
              <button type="button" className={cs.linkBtn} onClick={() => setDoors(doors.filter((_, j) => j !== i))}>{t.removeDoor}</button>
            </div>
          ))}
          <div><button type="button" className={cs.linkBtn} onClick={() => setDoors([...doors, { side: '1', offset: '', width: '' }])}>{t.addDoor}</button></div>
        </section>
        <div role="status" data-testid="survey-result">
          {!r.ok ? (
            <p className={cs.warn}>{t.errors[r.error!]}</p>
          ) : (
            <>
              <p>{fmt(t.result, { area: (r.area / 1e6).toFixed(2), per: Math.round(r.perimeter), method: t.methods[r.method] })}</p>
              {r.method === 'traverse' && <p>{fmt(t.closure, { c: r.closure.toFixed(1) })}</p>}
              {r.diagonals.map((d) => <p key={`${d.from}-${d.to}`}>{fmt(t.diagRow, { a: d.from + 1, b: d.to + 1, m: d.measured, c: d.computed.toFixed(1), d: d.dev.toFixed(1) })}</p>)}
              {r.squareness !== null && <p>{fmt(t.square, { s: r.squareness.toFixed(2) })}</p>}
              <p className={r.withinTolerance ? cs.ok : cs.warn}>{fmt(r.withinTolerance ? t.within : t.outside, { tol: input.tolerance })}</p>
              {r.missing.length > 0 && <p className={cs.warn} data-testid="survey-missing">{fmt(t.missing, { list: r.missing.map((k) => measurementWords(T.importCal, k)).join(', ') })}</p>}
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
