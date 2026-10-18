/**
 * Machines & Tools: create / clone / edit / import / export machine profiles and record commissioning.
 * Every save is a new revision; status is read-only here (VERIFIED only through the commissioning record).
 */
import { useRef, useState } from 'react'
import { fmt, useT } from '../../i18n'
import { blockerText } from '../../i18n/ws/cnc'
import { Modal } from '../../components/ui/Modal'
import { downloadFile } from '../../components/workspace/Workspace'
import { toast } from '../../state/toast'
import { useMachines, type MachineRecord } from '../../state/machines'
import { HEAD_OPS, OPERATIONS, TOOL_KINDS, machineBlockers, type ClampZone, type HeadType, type MachineHead, type MachineProfile, type MachineType, type OperationKind } from '../../cam/machine'
import { POSTS, POST_IDS } from '../../cam/posts'
import s from './Cnc.module.css'

const HEAD_TYPES: HeadType[] = ['ROUTER_SPINDLE', 'SAW_BLADE', 'DRILL_BANK', 'KNIFE']
const MACHINE_TYPES: MachineType[] = ['CNC_ROUTER', 'CNC_SAW', 'PANEL_SAW', 'CNC_DRILL', 'HYBRID']
const numOrNull = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const str = (v: string) => (v.trim() === '' ? null : v)

export function MachinesDialog({ onClose, initial }: { onClose: () => void; initial?: string | null }) {
  const c = useT().cnc
  const m = c.mgr
  const st = useMachines()
  const [sel, setSel] = useState<string>(initial && st.records.some((r) => r.profile.profile_id === initial) ? initial : st.records[0]?.profile.profile_id ?? '')
  const [newId, setNewId] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const rec = st.records.find((r) => r.profile.profile_id === sel) ?? null
  const err = (e: string | null) => (e ? (toast(m.errors[e] ?? e, 'warning'), false) : true)
  const create = () => err(st.create(newId.trim())) && (setSel(newId.trim()), setNewId(''))
  const clone = () => rec && err(st.clone(sel, newId.trim())) && (setSel(newId.trim()), setNewId(''))
  const onImport = async (f: File) => {
    const r = st.importJson(await f.text())
    if (r.id) {
      setSel(r.id)
      toast(fmt(m.imported, { id: r.id, status: useMachines.getState().records.find((x) => x.profile.profile_id === r.id)?.profile.status ?? '' }), 'success')
    } else toast(fmt(m.importFailed, { e: r.errors.join(', ') }), 'warning')
  }
  return (
    <Modal title={m.title} onClose={onClose} width={1120}>
      <div className={s.mgr} data-testid="machines-dialog">
        <aside className={s.list}>
          <p className={s.small}>{m.intro}</p>
          {st.records.map((r) => (
            <button key={r.profile.profile_id} type="button" className={r.profile.profile_id === sel ? s.on : undefined} onClick={() => setSel(r.profile.profile_id)}>
              {r.profile.profile_id}
              <small>{c.status[r.profile.status]} · {fmt(c.rev, { n: r.profile.revision })} · {r.profile.heads.length}× {[...new Set(r.profile.heads.map((h) => h.type))].join('/')}</small>
            </button>
          ))}
        </aside>
        <section className={s.edit}>
          <div className={s.actions}>
            <input aria-label={m.newId} placeholder={m.newId} value={newId} onChange={(e) => setNewId(e.target.value)} />
            <button type="button" onClick={create} disabled={!newId.trim()}>{m.create}</button>
            <button type="button" onClick={clone} disabled={!newId.trim() || !rec}>{m.clone}</button>
            <button type="button" onClick={() => file.current?.click()}>{m.import}</button>
            <input ref={file} type="file" accept=".json,application/json" hidden aria-label={m.import} onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImport(f); e.target.value = '' }} />
            <button type="button" disabled={!rec} onClick={() => rec && downloadFile(`${rec.profile.profile_id}_r${rec.profile.revision}.json`, JSON.stringify(rec.profile, null, 2), 'application/json')}>{m.export}</button>
            <button type="button" disabled={!rec || rec.profile.status === 'SUSPENDED'} onClick={() => rec && st.suspend(rec.profile.profile_id)}>{m.suspend}</button>
            <button type="button" disabled={!rec} onClick={() => { if (rec && err(st.remove(rec.profile.profile_id))) setSel(useMachines.getState().records[0]?.profile.profile_id ?? '') }}>{m.remove}</button>
          </div>
          {rec && <Editor key={`${rec.profile.profile_id}-${rec.profile.revision}`} rec={rec} />}
        </section>
      </div>
    </Modal>
  )
}

function Editor({ rec }: { rec: MachineRecord }) {
  const c = useT().cnc
  const m = c.mgr
  const save = useMachines((st) => st.save)
  const [d, setD] = useState<MachineProfile>(() => structuredClone(rec.profile))
  const up = (patch: Partial<MachineProfile>) => setD({ ...d, ...patch })
  const upHead = (i: number, patch: Partial<MachineHead>) => up({ heads: d.heads.map((h, k) => (k === i ? { ...h, ...patch } : h)) })
  const gate = machineBlockers(rec.profile)
  const onSave = () => {
    const e = save(d)
    if (e) toast(m.errors[e] ?? e, 'warning')
    else toast(fmt(m.saved, { id: d.profile_id, n: rec.profile.revision + 1 }), 'success')
  }
  const field = (label: string, value: string | number | null | undefined, on: (v: string) => void, type = 'text') => (
    <label className={s.field}>
      {label}
      <input aria-label={label} type={type} value={value ?? ''} onChange={(e) => on(e.target.value)} />
    </label>
  )
  const clamp = (i: number, k: keyof ClampZone, v: string) => up({ fixtures: { ...d.fixtures, clamp_no_go_shapes: d.fixtures.clamp_no_go_shapes.map((z, j) => (j === i ? { ...z, [k]: k === 'id' ? v : Number(v) || 0 } : z)) } })
  return (
    <>
      <div className={s.small}>
        <span className={`${s.badge} ${rec.profile.status === 'VERIFIED' ? s.ok : ''}`}>{c.status[rec.profile.status]}</span> {fmt(c.rev, { n: rec.profile.revision })} · {fmt(m.provenance, { source: `${rec.provenance.source}${rec.provenance.from ? ` (${rec.provenance.from})` : ''}` })}
      </div>
      <h4>{m.general}</h4>
      <div className={s.grid}>
        <label className={s.field}>
          {m.type}
          <select aria-label={m.type} value={d.machine_type} onChange={(e) => up({ machine_type: e.target.value as MachineType })}>{MACHINE_TYPES.map((x) => <option key={x}>{x}</option>)}</select>
        </label>
        {field(m.manufacturer, d.manufacturer, (v) => up({ manufacturer: str(v) }))}
        {field(m.model, d.machine_model, (v) => up({ machine_model: str(v) }))}
        {field(m.serial, d.serial_reference, (v) => up({ serial_reference: str(v) }))}
      </div>
      <h4>{m.controller}</h4>
      <div className={s.grid}>
        {field(m.ctrlName, d.controller.name, (v) => up({ controller: { ...d.controller, name: str(v) } }))}
        {field(m.ctrlModel, d.controller.model, (v) => up({ controller: { ...d.controller, model: str(v) } }))}
        {field(m.firmware, d.controller.firmware, (v) => up({ controller: { ...d.controller, firmware: str(v) } }))}
        {field(m.manual, d.controller.manual_reference, (v) => up({ controller: { ...d.controller, manual_reference: str(v) } }))}
      </div>
      <label className={s.field}>
        {m.codes}
        <textarea aria-label={m.codes} value={d.controller.supported_codes.join(',')} onChange={(e) => up({ controller: { ...d.controller, supported_codes: [...new Set(e.target.value.toUpperCase().split(/[\s,;]+/).filter(Boolean))] } })} />
      </label>
      <div className={s.grid}>
        <label className={s.field}>
          {m.post}
          <select aria-label={m.post} value={d.postprocessor.id ?? ''} onChange={(e) => { const p = POSTS[e.target.value as keyof typeof POSTS]; up({ postprocessor: p ? { id: p.id, version: p.version, sha256: p.sha256, approved_for_controller: false } : { id: null, version: null, sha256: null, approved_for_controller: false } }) }}>
            <option value="">{m.postNone}</option>
            {POST_IDS.map((id) => <option key={id} value={id}>{POSTS[id].label} {POSTS[id].version} (UNVERIFIED)</option>)}
          </select>
        </label>
        <p className={s.small}>{m.postNote}</p>
      </div>
      <h4>{m.envelope}</h4>
      <div className={s.trio}>
        {(['x', 'y', 'z'] as const).map((a) => <input key={a} aria-label={`${m.envelope} ${a}`} value={d.work_envelope_mm[a] ?? ''} onChange={(e) => up({ work_envelope_mm: { ...d.work_envelope_mm, [a]: numOrNull(e.target.value) } })} />)}
      </div>
      <h4>{m.origin}</h4>
      <div className={s.grid}>
        {field(m.corner, d.origin.stock_corner, (v) => up({ origin: { ...d.origin, stock_corner: str(v) } }))}
        {field(m.zRef, d.origin.z_reference, (v) => up({ origin: { ...d.origin, z_reference: str(v) } }))}
        {field(m.wcs, d.origin.work_offset, (v) => up({ origin: { ...d.origin, work_offset: str(v) } }))}
        <label className={s.check}><input type="checkbox" checked={d.origin.home_calibrated} onChange={(e) => up({ origin: { ...d.origin, home_calibrated: e.target.checked } })} />{m.homed}</label>
        {field(m.safe, d.fixtures.safe_clearance_mm, (v) => up({ fixtures: { ...d.fixtures, safe_clearance_mm: numOrNull(v) } }))}
        <label className={s.check}><input type="checkbox" checked={d.atc.supported} onChange={(e) => up({ atc: { ...d.atc, supported: e.target.checked } })} />{m.atc}</label>
        {field(m.slots, d.atc.magazine_slots, (v) => up({ atc: { ...d.atc, magazine_slots: numOrNull(v) } }))}
      </div>
      <h4>{m.heads}</h4>
      {d.heads.map((h, i) => (
        <div key={i} className={s.card} data-testid={`head-${i}`}>
          <div className={s.cardHead}>
            <input aria-label="head id" value={h.head_id} onChange={(e) => upHead(i, { head_id: e.target.value })} style={{ width: 90 }} />
            <select aria-label={m.headType} value={h.type} onChange={(e) => { const type = e.target.value as HeadType; upHead(i, { type, supported_operations: h.supported_operations.filter((o) => HEAD_OPS[type].includes(o)) }) }}>{HEAD_TYPES.map((x) => <option key={x}>{x}</option>)}</select>
            <span>{m.offset}</span>
            <span className={s.trio}>{(['x', 'y', 'z'] as const).map((a) => <input key={a} aria-label={`${h.head_id} offset ${a}`} value={h.offset_mm[a] ?? ''} onChange={(e) => upHead(i, { offset_mm: { ...h.offset_mm, [a]: numOrNull(e.target.value) } })} />)}</span>
            <label className={s.check}><input type="checkbox" checked={h.offset_calibrated} onChange={(e) => upHead(i, { offset_calibrated: e.target.checked })} />{m.offsetCal}</label>
            <label className={s.check}><input type="checkbox" checked={h.activation_mapping_verified} onChange={(e) => upHead(i, { activation_mapping_verified: e.target.checked })} />{m.mapped}</label>
            <button type="button" className={s.miniBtn} onClick={() => up({ heads: d.heads.filter((_, k) => k !== i) })} disabled={d.heads.length < 2}>{m.remove1}</button>
          </div>
          <div className={s.ops}>
            <span>{m.supports}:</span>
            {OPERATIONS.filter((o) => HEAD_OPS[h.type].includes(o)).map((o: OperationKind) => (
              <label key={o} className={s.check}><input type="checkbox" checked={h.supported_operations.includes(o)} onChange={(e) => upHead(i, { supported_operations: e.target.checked ? [...h.supported_operations, o] : h.supported_operations.filter((x) => x !== o) })} />{c.ops[o]}</label>
            ))}
          </div>
          <table className={s.tools}>
            <tbody>
              <tr><td>{m.tools}</td><td>{m.toolKind}</td><td>{m.dia}</td><td>{m.number}</td><td>{m.calibrated}</td><td /></tr>
              {h.tools.map((t, k) => {
                const ut = (patch: object) => upHead(i, { tools: h.tools.map((x, j) => (j === k ? { ...x, ...patch } : x)) })
                return (
                  <tr key={k}>
                    <td><input aria-label="tool id" value={t.tool_id} onChange={(e) => ut({ tool_id: e.target.value })} /></td>
                    <td><select aria-label={m.toolKind} value={t.kind} onChange={(e) => ut({ kind: e.target.value })}>{TOOL_KINDS.map((x) => <option key={x}>{x}</option>)}</select></td>
                    <td><input aria-label={m.dia} value={t.diameter_mm ?? ''} onChange={(e) => ut({ diameter_mm: numOrNull(e.target.value) })} /></td>
                    <td><input aria-label={m.number} value={t.number ?? ''} onChange={(e) => ut({ number: numOrNull(e.target.value) })} /></td>
                    <td><input type="checkbox" aria-label={m.calibrated} checked={t.actual_calibrated} onChange={(e) => ut({ actual_calibrated: e.target.checked })} /></td>
                    <td><button type="button" className={s.miniBtn} onClick={() => upHead(i, { tools: h.tools.filter((_, j) => j !== k) })}>{m.remove1}</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div><button type="button" className={s.miniBtn} onClick={() => upHead(i, { tools: [...h.tools, { tool_id: `TOOL_${h.tools.length + 1}`, kind: 'UNASSIGNED', diameter_mm: null, actual_calibrated: false }] })}>{m.addTool}</button></div>
        </div>
      ))}
      <div><button type="button" className={s.miniBtn} onClick={() => up({ heads: [...d.heads, { head_id: `HEAD_${d.heads.length + 1}`, type: 'ROUTER_SPINDLE', offset_mm: { x: null, y: null, z: null }, offset_calibrated: false, activation_mapping_verified: false, kinematics_group: 'UNKNOWN_SHARED_GANTRY', tools: [], supported_operations: ['PROFILE'], simultaneous_qualified: false }] })}>{m.addHead}</button></div>
      <h4>{m.clamps}</h4>
      <table className={s.tools}>
        <tbody>
          <tr><td>id</td><td>X0</td><td>Y0</td><td>X1</td><td>Y1</td><td>Z top</td><td /></tr>
          {d.fixtures.clamp_no_go_shapes.map((z, i) => (
            <tr key={i}>
              {(['id', 'x0', 'y0', 'x1', 'y1', 'z_top'] as const).map((k) => <td key={k}><input aria-label={`clamp ${i + 1} ${k}`} value={z[k]} onChange={(e) => clamp(i, k, e.target.value)} /></td>)}
              <td><button type="button" className={s.miniBtn} onClick={() => up({ fixtures: { ...d.fixtures, clamp_no_go_shapes: d.fixtures.clamp_no_go_shapes.filter((_, j) => j !== i) } })}>{m.remove1}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div><button type="button" className={s.miniBtn} onClick={() => up({ fixtures: { ...d.fixtures, clamp_no_go_shapes: [...d.fixtures.clamp_no_go_shapes, { id: `CLAMP_${d.fixtures.clamp_no_go_shapes.length + 1}`, x0: 0, y0: 0, x1: 100, y1: 60, z_top: 30 }] } })}>{m.addClamp}</button></div>
      <div className={s.actions}><button type="button" onClick={onSave} data-testid="machine-save">{m.save}</button></div>
      <h4>{m.gate}</h4>
      <ul className={s.log} data-testid="machine-gate">{gate.map((b) => <li key={b}>{blockerText(b, c)}</li>)}</ul>
      <Commissioning rec={rec} />
      <h4>{m.history}</h4>
      <ul className={s.log}>{[...rec.log].reverse().slice(0, 12).map((l, i) => <li key={i}>{l.at.slice(0, 16).replace('T', ' ')} — {l.what}</li>)}</ul>
    </>
  )
}

function Commissioning({ rec }: { rec: MachineRecord }) {
  const c = useT().cnc
  const m = c.mgr
  const commission = useMachines((st) => st.commission)
  const today = new Date().toISOString().slice(0, 10)
  const [f, setF] = useState({ parser: false, backplot: false, post: false, air: false, airDate: today, airNotes: '', fa: false, faDate: today, faMeas: '', op: '', eng: '', evidence: '', validUntil: '' })
  const last = rec.commissioning[rec.commissioning.length - 1]
  const chk = (k: 'parser' | 'backplot' | 'post' | 'air' | 'fa', label: string) => <label className={s.check}><input type="checkbox" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />{label}</label>
  const txt = (k: 'airDate' | 'airNotes' | 'faDate' | 'faMeas' | 'op' | 'eng' | 'validUntil', label: string) => <label className={s.field}>{label}<input aria-label={label} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
  const run = () => {
    const at = new Date().toISOString()
    const r = commission(rec.profile.profile_id, {
      parser_pass: f.parser, post_backplot_pass: f.backplot, post_approved_for_controller: f.post,
      air_cut: { pass: f.air, date: f.airDate, notes: f.airNotes }, first_article: { pass: f.fa, date: f.faDate, measurements: f.faMeas },
      operator: { name: f.op, at }, engineer: { name: f.eng, at }, evidence_refs: f.evidence.split('\n').map((x) => x.trim()).filter(Boolean), valid_until: f.validUntil || null,
    })
    if (r) toast(r.result === 'VERIFIED' ? fmt(m.comResult, { result: c.status.VERIFIED }) : fmt(m.comFailed, { list: r.failures.join(', ') }), r.result === 'VERIFIED' ? 'success' : 'warning')
  }
  return (
    <div className={s.card} data-testid="commissioning">
      <h4>{m.commission}</h4>
      <p className={s.small}>{m.comNote}</p>
      <div className={s.grid}>
        {chk('parser', m.parserPass)}
        {chk('backplot', m.backplotPass)}
        {chk('post', m.postApproved)}
        {chk('air', m.airCut)}
        {txt('airDate', m.airDate)}
        {txt('airNotes', m.airNotes)}
        {chk('fa', m.faPass)}
        {txt('faDate', m.faDate)}
        {txt('faMeas', m.faMeas)}
        {txt('op', m.opName)}
        {txt('eng', m.engName)}
        {txt('validUntil', m.validUntil)}
      </div>
      <label className={s.field}>{m.evidence}<textarea aria-label={m.evidence} value={f.evidence} onChange={(e) => setF({ ...f, evidence: e.target.value })} /></label>
      <div className={s.actions}><button type="button" onClick={run} data-testid="commission-run">{m.record}</button></div>
      {last && <p className={s.small} data-testid="commission-last">{last.at.slice(0, 16).replace('T', ' ')} — {last.result}{last.failures.length ? `: ${last.failures.join(', ')}` : ''}</p>}
    </div>
  )
}
