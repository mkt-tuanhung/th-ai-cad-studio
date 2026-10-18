/**
 * Cabinet hardware (Interior → cabinet Properties → Production): hinge / drawer slide / connector products from the
 * machine library and their placement. The drilling plan is computed and validated live (cam/hardware.ts); missing
 * product data shows as "needs data" and blocks CNC drilling. Applying is one undo step.
 */
import { useState } from 'react'
import { fmt, useT } from '../../i18n'
import { blockerText } from '../../i18n/ws/cnc'
import { toast } from '../../state/toast'
import { useInterior } from '../../state/interior'
import { Modal } from '../../components/ui/Modal'
import { ActionButton } from '../../components/ui/Button'
import type { Cabinet, CabinetHardware } from '../../interior/model'
import { hardwareById, hardwareOf } from '../../cam/library'
import type { HardwareKind } from '../../cam/library/types'
import { hardwarePlan } from '../../cam/hardware'
import c0 from '../cnc/Cnc.module.css'

const num = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v.replace(',', '.'))) ? null : Number(v.replace(',', '.')))

export function HardwareDialog({ cabinet, onClose }: { cabinet: Cabinet; onClose: () => void }) {
  const T = useT()
  const H = T.machlib.hw
  const L = T.machlib.lib
  const { edit, cam } = useInterior()
  const [hw, setHw] = useState<CabinetHardware>(() => ({ ...(cabinet.hardware ?? {}) }))
  const [rows, setRows] = useState((cabinet.hardware?.slideRows ?? []).join(', '))
  const draft: Cabinet = { ...cabinet, hardware: { ...hw, slideRows: rows.split(/[,;\s]+/).map(Number).filter((x) => Number.isFinite(x) && x > 0) } }
  const plan = hardwarePlan(draft, { shelfPins: cam.cnc.shelfPins })
  const up = (patch: Partial<CabinetHardware>) => setHw({ ...hw, ...patch })
  const apply = () => {
    const next = draft.hardware && Object.values(draft.hardware).some((v) => (Array.isArray(v) ? v.length : v !== null && v !== undefined && v !== '')) ? draft.hardware : undefined
    const e = edit(`${cabinet.name}: hardware`, (d) => ({ ...d, cabinets: d.cabinets.map((x) => (x.id === cabinet.id ? { ...x, hardware: next } : x)) }))
    if (e) return toast(e, 'warning')
    toast(fmt(H.applied, { name: cabinet.name }), 'success')
    onClose()
  }
  const pick = (kind: HardwareKind, key: 'hinge' | 'slide' | 'connector', label: string) => {
    const id = hw[key] ?? ''
    const p = hardwareById(id)
    return (
      <div className={c0.card}>
        <label className={c0.field}>
          {label}
          <select aria-label={label} value={id} onChange={(e) => up({ [key]: e.target.value || null })} data-testid={`hw-${key}`}>
            <option value="">{key === 'hinge' ? H.legacy : H.none}</option>
            {hardwareOf(kind).map((x) => <option key={x.id} value={x.id}>{x.brand} — {x.product}</option>)}
          </select>
        </label>
        {p && (
          <details className={c0.small}>
            <summary>{H.data} · <span className={`${c0.conf} ${c0[`conf_${p.confidence}`] ?? ''}`}>{L.confidence[p.confidence]}</span></summary>
            <table className={c0.detail}><tbody>{Object.entries(p.drilling).map(([k, v]) => <tr key={k}><td>{k}</td><td>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</td></tr>)}</tbody></table>
            <div>{H.sources}: {p.sources.length ? p.sources.map((x) => `${x.title}${x.url && x.url !== x.title ? ` — ${x.url}` : ''}`).join(' · ') : L.noSources}</div>
            {p.notes && <div>{p.notes}</div>}
          </details>
        )}
      </div>
    )
  }
  // product fields the catalogue does not state (or offers as options): entered here from the manufacturer's
  // drilling template / measured, stored on the cabinet — never filled in by the app
  const PLACEMENT = new Set(['boring_distance', 'end_distance', 'slide_rows'])
  const missingFields = [hw.hinge, hw.slide, hw.connector].filter((x): x is string => !!x).flatMap((pid) =>
    plan.issues.flatMap((code) => {
      const d = `HW_NEEDS_DATA:${pid}:`, ch = `HW_NEEDS_CHOICE:${pid}:`
      if (code.startsWith(d) && !PLACEMENT.has(code.slice(d.length))) return [{ pid, field: code.slice(d.length), options: null as number[] | null }]
      if (code.startsWith(ch)) {
        const rest = code.slice(ch.length), k = rest.lastIndexOf(':')
        return [{ pid, field: rest.slice(0, k), options: rest.slice(k + 1).split('|').map(Number) }]
      }
      return []
    }),
  )
  const setOv = (pid: string, field: string, v: number | number[] | null) => {
    const cur = { ...(hw.overrides?.[pid] ?? {}) }
    if (v === null || (Array.isArray(v) && !v.length)) delete cur[field]
    else cur[field] = v
    up({ overrides: { ...hw.overrides, [pid]: cur } })
  }
  const ovText = (pid: string, field: string) => {
    const v = hw.overrides?.[pid]?.[field]
    return v === undefined ? '' : Array.isArray(v) ? v.join(', ') : String(v)
  }
  const hinge = hardwareById(hw.hinge)
  const range = hinge ? { min: hinge.drilling.boring_distance_min_mm, max: hinge.drilling.boring_distance_max_mm } : null
  return (
    <Modal title={`${H.title} — ${cabinet.name}`} onClose={onClose} width={760} footer={<><ActionButton onClick={onClose}>{T.interior.cabinet.cancel}</ActionButton><ActionButton variant="primary" onClick={apply}>{H.apply}</ActionButton></>}>
      <div className={c0.edit} data-testid="hardware-dialog">
        <p className={c0.refNote}>{H.intro}</p>
        {pick('hinge', 'hinge', H.hinge)}
        {hinge && (
          <div className={c0.grid}>
            <label className={c0.field}>{H.boring}{range && (range.min != null || range.max != null) ? ` (${fmt(H.range, { min: String(range.min ?? '—'), max: String(range.max ?? '—') })})` : ''}<input aria-label={H.boring} value={hw.boringDistance ?? ''} onChange={(e) => up({ boringDistance: num(e.target.value) })} /></label>
            <label className={c0.field}>{H.endDist}<input aria-label={H.endDist} value={hw.hingeEndDistance ?? ''} onChange={(e) => up({ hingeEndDistance: num(e.target.value) })} /></label>
            <label className={c0.field}>{H.count}<input aria-label={H.count} value={hw.hingeCount ?? ''} onChange={(e) => up({ hingeCount: num(e.target.value) })} /></label>
            <label className={c0.check}><input type="checkbox" checked={hw.hingeFixings !== false} onChange={(e) => up({ hingeFixings: e.target.checked })} />{H.fixings}</label>
          </div>
        )}
        {pick('slide', 'slide', H.slide)}
        {hw.slide && (
          <div className={c0.grid}>
            <label className={c0.field}>{H.slideLen}<input aria-label={H.slideLen} value={hw.slideLength ?? ''} onChange={(e) => up({ slideLength: num(e.target.value) })} /></label>
            <label className={c0.field}>{H.rows}<input aria-label={H.rows} value={rows} onChange={(e) => setRows(e.target.value)} /></label>
          </div>
        )}
        {pick('connector', 'connector', H.connector)}
        {missingFields.length > 0 && (
          <div className={c0.card} data-testid="hw-missing">
            <b>{H.enter}</b>
            <div className={c0.grid}>
              {missingFields.map(({ pid, field, options }) => {
                const label = `${pid} · ${field}`
                return options ? (
                  <label key={label} className={c0.field}>{label}
                    <select aria-label={label} value={ovText(pid, field)} onChange={(e) => setOv(pid, field, e.target.value === '' ? null : Number(e.target.value))}>
                      <option value="">—</option>
                      {options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                ) : (
                  <label key={label} className={c0.field}>{label}{field.startsWith('positions') ? ` (${H.listHint})` : ''}
                    <input aria-label={label} defaultValue={ovText(pid, field)} onBlur={(e) => { const vals = e.target.value.split(/[,;\s]+/).map((x) => Number(x.replace(',', '.'))).filter((x) => Number.isFinite(x) && x > 0); setOv(pid, field, field.startsWith('positions') ? vals : vals[0] ?? null) }} />
                  </label>
                )
              })}
            </div>
          </div>
        )}
        <p className={c0.small} data-testid="hw-holes">{fmt(H.holes, { n: plan.holes.length })}</p>
        {plan.issues.length ? (
          <div className={c0.blockers} data-testid="hw-issues"><b>{H.issues}</b><ul>{plan.issues.map((x) => <li key={x}>{blockerText(x, T.cnc)}</li>)}</ul></div>
        ) : <p className={c0.pass} data-testid="hw-issues">{H.ok}</p>}
        {plan.notes.length > 0 && <p className={c0.small}>{H.notes}: {plan.notes.join('; ')}</p>}
      </div>
    </Modal>
  )
}
