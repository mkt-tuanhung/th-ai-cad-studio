/**
 * Machines & Tools: the user's machine profiles (create / clone / edit / import / export, commissioning wizard),
 * the machine library (pick a machine close to yours or the exact one) and "Enter my machine" (a hand-entered
 * profile). Every save is a new revision; status is read-only here (VERIFIED only through the commissioning wizard).
 */
import { Fragment, useRef, useState } from 'react'
import { fmt, useT } from '../../i18n'
import { blockerText } from '../../i18n/ws/cnc'
import { Modal } from '../../components/ui/Modal'
import { PanelTabs, downloadFile } from '../../components/workspace/Workspace'
import { toast } from '../../state/toast'
import { useMachines, type MachineRecord } from '../../state/machines'
import { HEAD_OPS, OPERATIONS, TOOL_KINDS, machineBlockers, type ClampZone, type HeadType, type MachineExt, type MachineHead, type MachineProfile, type MachineType, type OperationKind, type ToolLengthMode } from '../../cam/machine'
import { POSTS, POST_IDS, postIdForFamily } from '../../cam/posts'
import { CONTROLLER_FAMILY_IDS, familyById, familyCodes, type ControllerFamilyId } from '../../cam/library'
import { blankOwnProfile, newHead, validateOwnProfile } from '../../cam/library/own'
import { MachineLibrary } from './MachineLibrary'
import { CommissioningWizard } from './CommissioningWizard'
import s from './Cnc.module.css'

const HEAD_TYPES: HeadType[] = ['ROUTER_SPINDLE', 'SAW_BLADE', 'DRILL_BANK', 'KNIFE']
const MACHINE_TYPES: MachineType[] = ['CNC_ROUTER', 'CNC_SAW', 'PANEL_SAW', 'CNC_DRILL', 'HYBRID']
const numOrNull = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v.replace(',', '.'))) ? null : Number(v.replace(',', '.')))
const str = (v: string) => (v.trim() === '' ? null : v)
const codesOf = (v: string) => [...new Set(v.toUpperCase().split(/[\s,;]+/).filter(Boolean))]

export type MachinesTab = 'profiles' | 'library' | 'own'

export function MachinesDialog({ onClose, initial, tab: tab0 = 'profiles', onUse }: { onClose: () => void; initial?: string | null; tab?: MachinesTab; onUse?: (id: string) => void }) {
  const T = useT()
  const c = T.cnc
  const L = T.machlib
  const m = c.mgr
  const st = useMachines()
  const [tab, setTab] = useState<MachinesTab>(tab0)
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
  const created = (id: string) => {
    setSel(id)
    setTab('profiles')
    onUse?.(id)
  }
  return (
    <Modal title={m.title} onClose={onClose} width={1160}>
      <div data-testid="machines-dialog">
        <PanelTabs tabs={(['profiles', 'library', 'own'] as MachinesTab[]).map((k) => ({ key: k, label: L.tabs[k] }))} active={tab} onTab={setTab} />
        {tab === 'library' && <MachineLibrary onCreated={created} />}
        {tab === 'own' && <OwnMachine onCreated={created} />}
        {tab === 'profiles' && (
          <div className={s.mgr}>
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
              {rec && <Editor key={`${rec.profile.profile_id}-${rec.profile.revision}`} rec={rec} initial={rec.profile} />}
            </section>
          </div>
        )}
      </div>
    </Modal>
  )
}

/** Enter my machine: family + type + id → the full form (Editor in 'own' mode) → stored UNVERIFIED. */
function OwnMachine({ onCreated }: { onCreated: (id: string) => void }) {
  const T = useT()
  const L = T.machlib
  const [fam, setFam] = useState<ControllerFamilyId>('SYNTEC')
  const [type, setType] = useState<MachineType>('CNC_ROUTER')
  const [id, setId] = useState('MY_MACHINE_1')
  const [draft, setDraft] = useState<MachineProfile | null>(null)
  return (
    <div className={`${s.edit} ${s.scrollPane}`} data-testid="own-machine">
      <p className={s.small}>{L.own.intro}</p>
      <div className={s.actions}>
        <label className={s.field}>{T.cnc.mgr.newId}<input aria-label={T.cnc.mgr.newId} value={id} onChange={(e) => setId(e.target.value)} /></label>
        <label className={s.field}>{L.own.family}<select aria-label={L.own.family} value={fam} onChange={(e) => setFam(e.target.value as ControllerFamilyId)}>{CONTROLLER_FAMILY_IDS.map((f) => <option key={f}>{f}</option>)}</select></label>
        <label className={s.field}>{L.own.type}<select aria-label={L.own.type} value={type} onChange={(e) => setType(e.target.value as MachineType)}>{MACHINE_TYPES.map((x) => <option key={x}>{x}</option>)}</select></label>
        <button type="button" onClick={() => setDraft(blankOwnProfile(id.trim(), fam, type))} data-testid="own-start">{L.own.start}</button>
      </div>
      {draft && <Editor key={`${draft.profile_id}-${fam}-${type}`} rec={null} initial={draft} own onCreated={onCreated} />}
    </div>
  )
}

function Editor({ rec, initial, own, onCreated }: { rec: MachineRecord | null; initial: MachineProfile; own?: boolean; onCreated?: (id: string) => void }) {
  const T = useT()
  const c = T.cnc
  const m = c.mgr
  const L = T.machlib
  const save = useMachines((st) => st.save)
  const addOwn = useMachines((st) => st.addOwn)
  const [d, setD] = useState<MachineProfile>(() => structuredClone(initial))
  const up = (patch: Partial<MachineProfile>) => setD({ ...d, ...patch })
  const upExt = (patch: Partial<MachineExt>) => setD({ ...d, ext: { ...d.ext, ...patch } })
  const upHead = (i: number, patch: Partial<MachineHead>) => up({ heads: d.heads.map((h, k) => (k === i ? { ...h, ...patch } : h)) })
  const gate = rec ? machineBlockers(rec.profile) : []
  const errs = own ? validateOwnProfile(d) : []
  const onSave = () => {
    if (own) {
      if (errs.length) return toast(fmt(L.own.invalid, { list: errs.map((e) => L.own.errors[e.split(':')[0]] ?? e).join(', ') }), 'warning')
      const e = addOwn(d)
      if (e) return toast(L.own.errors[e] ?? m.errors[e] ?? e, 'warning')
      toast(fmt(L.own.saved, { id: d.profile_id }), 'success')
      return onCreated?.(d.profile_id)
    }
    const e = save(d)
    if (e) toast(m.errors[e] ?? e, 'warning')
    else toast(fmt(m.saved, { id: d.profile_id, n: (rec?.profile.revision ?? 0) + 1 }), 'success')
  }
  const field = (label: string, value: string | number | null | undefined, on: (v: string) => void, type = 'text') => (
    <label className={s.field}>
      {label}
      <input aria-label={label} type={type} value={value ?? ''} onChange={(e) => on(e.target.value)} />
    </label>
  )
  const clamp = (i: number, k: keyof ClampZone, v: string) => up({ fixtures: { ...d.fixtures, clamp_no_go_shapes: d.fixtures.clamp_no_go_shapes.map((z, j) => (j === i ? { ...z, [k]: k === 'id' ? v : Number(v) || 0 } : z)) } })
  const fam = (d.ext?.controller_family ?? null) as ControllerFamilyId | null
  const famInfo = familyById(fam)
  const info = (id: string) => d.ext?.head_info?.find((x) => x.head_id === id)
  const setInfo = (id: string, patch: Partial<NonNullable<MachineExt['head_info']>[number]>) => {
    const list = d.ext?.head_info ?? []
    const cur = list.find((x) => x.head_id === id) ?? { head_id: id, power_kw: null, rpm_max: null, holder: null }
    upExt({ head_info: [...list.filter((x) => x.head_id !== id), { ...cur, ...patch }] })
  }
  const selOf = (id: string) => d.ext?.spindle_select?.find((x) => x.head_id === id)?.codes.join(' ') ?? ''
  const setSel = (id: string, v: string) => upExt({ spindle_select: [...(d.ext?.spindle_select ?? []).filter((x) => x.head_id !== id), ...(v.trim() ? [{ head_id: id, codes: codesOf(v) }] : [])] })
  const saw = d.ext?.saw ?? { blade_diameter_mm: null, kerf_mm: null, max_cut_height_mm: null, cut_length_mm: null, orientation: null, trim_mm: null }
  const upSaw = (patch: Partial<typeof saw>) => upExt({ saw: { ...saw, ...patch } })
  const hasSaw = d.machine_type === 'PANEL_SAW' || d.heads.some((h) => h.type === 'SAW_BLADE')
  const layers = d.ext?.dxf_layers ?? null
  return (
    <>
      {rec && (
        <div className={s.small}>
          <span className={`${s.badge} ${rec.profile.status === 'VERIFIED' ? s.ok : ''}`}>{c.status[rec.profile.status]}</span> {fmt(c.rev, { n: rec.profile.revision })} · {fmt(m.provenance, { source: `${rec.provenance.source}${rec.provenance.from ? ` (${rec.provenance.from})` : ''}` })}
        </div>
      )}
      {d.ext?.provenance && <p className={s.refNote}>{L.lib.refNote} ({d.ext.provenance.template_id} · {L.lib.confidence[d.ext.provenance.confidence] ?? d.ext.provenance.confidence})</p>}
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
        <label className={s.field}>
          {L.ext.family}
          <select aria-label={L.ext.family} value={fam ?? ''} onChange={(e) => { const f = (e.target.value || null) as ControllerFamilyId | null; const pid = postIdForFamily(f, d.machine_type); const p = pid ? POSTS[pid] : null; setD({ ...d, ext: { ...d.ext, controller_family: f }, postprocessor: p ? { id: p.id, version: p.version, sha256: p.sha256, approved_for_controller: false } : d.postprocessor }) }}>
            <option value="">—</option>
            {CONTROLLER_FAMILY_IDS.map((f) => <option key={f}>{f}</option>)}
          </select>
        </label>
        {field(m.ctrlName, d.controller.name, (v) => up({ controller: { ...d.controller, name: str(v) } }))}
        {field(m.ctrlModel, d.controller.model, (v) => up({ controller: { ...d.controller, model: str(v) } }))}
        {field(m.firmware, d.controller.firmware, (v) => up({ controller: { ...d.controller, firmware: str(v) } }))}
        {field(m.manual, d.controller.manual_reference, (v) => up({ controller: { ...d.controller, manual_reference: str(v) } }))}
      </div>
      <label className={s.field}>
        {m.codes}
        <textarea aria-label={m.codes} value={d.controller.supported_codes.join(',')} onChange={(e) => up({ controller: { ...d.controller, supported_codes: codesOf(e.target.value) } })} />
      </label>
      {famInfo && (
        <div className={s.actions}>
          <button type="button" onClick={() => { up({ controller: { ...d.controller, supported_codes: familyCodes(famInfo) } }); toast(fmt(L.ext.prefilled, { family: famInfo.id }), 'info') }}>{L.ext.prefill}</button>
          {(d.ext?.undocumented?.length ?? 0) > 0 && <span className={s.small}>{fmt(L.lib.undocumented, { list: d.ext!.undocumented!.join(', ') })}</span>}
        </div>
      )}
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
      <h4>{L.ext.title}</h4>
      <div className={s.grid}>
        {field(L.ext.fileExt, d.ext?.file_extension, (v) => upExt({ file_extension: str(v.trim()) }))}
        <label className={s.field}>
          {L.ext.tlo}
          <select aria-label={L.ext.tlo} value={d.ext?.tool_length_mode ?? ''} onChange={(e) => upExt({ tool_length_mode: (e.target.value || null) as ToolLengthMode | null })}>{['', 'G43', 'AUTO_ON_TOOL_CHANGE', 'ZERO_PER_TOOL'].map((k) => <option key={k} value={k}>{L.ext.tloModes[k]}</option>)}</select>
        </label>
        {field(L.ext.pause, d.ext?.operator_pause_code, (v) => upExt({ operator_pause_code: str(v.trim().toUpperCase()) }))}
        <label className={s.field}>
          {L.ext.comments}
          <select aria-label={L.ext.comments} value={d.ext?.comment_style ?? ''} onChange={(e) => upExt({ comment_style: (e.target.value || null) as MachineExt['comment_style'] })}>{['', 'paren', 'semicolon', 'none'].map((k) => <option key={k} value={k}>{L.ext.commentModes[k]}</option>)}</select>
        </label>
      </div>
      {layers && (
        <div className={s.grid}>
          {(['outline', 'drill', 'groove', 'pocket'] as const).map((k) => <Fragment key={k}>{field(`${L.ext.layers} · ${k}`, layers[k], (v) => upExt({ dxf_layers: { ...layers, [k]: v } }))}</Fragment>)}
        </div>
      )}
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
      {hasSaw && (
        <>
          <h4>{L.ext.sawTitle}</h4>
          <div className={s.grid}>
            {field(L.ext.kerf, saw.kerf_mm, (v) => upSaw({ kerf_mm: numOrNull(v) }))}
            {field(L.ext.bladeD, saw.blade_diameter_mm, (v) => upSaw({ blade_diameter_mm: numOrNull(v) }))}
            {field(L.ext.cutH, saw.max_cut_height_mm, (v) => upSaw({ max_cut_height_mm: numOrNull(v) }))}
            {field(L.ext.cutL, saw.cut_length_mm, (v) => upSaw({ cut_length_mm: numOrNull(v) }))}
            {field(L.ext.trim, saw.trim_mm, (v) => upSaw({ trim_mm: numOrNull(v) }))}
            <label className={s.field}>
              {L.ext.orient}
              <select aria-label={L.ext.orient} value={saw.orientation ?? ''} onChange={(e) => upSaw({ orientation: (e.target.value || null) as 'X' | 'Y' | null })}><option value="">—</option><option>X</option><option>Y</option></select>
            </label>
          </div>
        </>
      )}
      <h4>{m.heads}</h4>
      {d.heads.map((h, i) => (
        <div key={i} className={s.card} data-testid={`head-${i}`}>
          <div className={s.cardHead}>
            <input aria-label="head id" value={h.head_id} onChange={(e) => upHead(i, { head_id: e.target.value })} style={{ width: 110 }} />
            <select aria-label={m.headType} value={h.type} onChange={(e) => { const type = e.target.value as HeadType; upHead(i, { type, supported_operations: h.supported_operations.filter((o) => HEAD_OPS[type].includes(o)) }) }}>{HEAD_TYPES.map((x) => <option key={x}>{x}</option>)}</select>
            <span>{m.offset}</span>
            <span className={s.trio}>{(['x', 'y', 'z'] as const).map((a) => <input key={a} aria-label={`${h.head_id} offset ${a}`} value={h.offset_mm[a] ?? ''} onChange={(e) => upHead(i, { offset_mm: { ...h.offset_mm, [a]: numOrNull(e.target.value) } })} />)}</span>
            <label className={s.check}><input type="checkbox" checked={h.offset_calibrated} onChange={(e) => upHead(i, { offset_calibrated: e.target.checked })} />{m.offsetCal}</label>
            <label className={s.check}><input type="checkbox" checked={h.activation_mapping_verified} onChange={(e) => upHead(i, { activation_mapping_verified: e.target.checked })} />{m.mapped}</label>
            <button type="button" className={s.miniBtn} onClick={() => up({ heads: d.heads.filter((_, k) => k !== i) })} disabled={d.heads.length < 2}>{m.remove1}</button>
          </div>
          <div className={s.cardHead}>
            <input aria-label={`${h.head_id} ${L.ext.power}`} placeholder={L.ext.power} value={info(h.head_id)?.power_kw ?? ''} onChange={(e) => setInfo(h.head_id, { power_kw: numOrNull(e.target.value) })} style={{ width: 60 }} />
            <input aria-label={`${h.head_id} ${L.ext.rpm}`} placeholder={L.ext.rpm} value={info(h.head_id)?.rpm_max ?? ''} onChange={(e) => setInfo(h.head_id, { rpm_max: numOrNull(e.target.value) })} style={{ width: 80 }} />
            <input aria-label={`${h.head_id} ${L.ext.holder}`} placeholder={L.ext.holder} value={info(h.head_id)?.holder ?? ''} onChange={(e) => setInfo(h.head_id, { holder: str(e.target.value) })} style={{ width: 80 }} />
            <input aria-label={`${h.head_id} ${L.ext.select}`} placeholder={L.ext.select} title={L.ext.select} value={selOf(h.head_id)} onChange={(e) => setSel(h.head_id, e.target.value)} style={{ width: 240 }} />
          </div>
          <div className={s.ops}>
            <span>{m.supports}:</span>
            {OPERATIONS.filter((o) => HEAD_OPS[h.type].includes(o)).map((o: OperationKind) => (
              <label key={o} className={s.check}><input type="checkbox" checked={h.supported_operations.includes(o)} onChange={(e) => upHead(i, { supported_operations: e.target.checked ? [...h.supported_operations, o] : h.supported_operations.filter((x) => x !== o) })} />{c.ops[o]}</label>
            ))}
          </div>
          <table className={s.tools}>
            <tbody>
              <tr><td>{m.tools}</td><td>{m.toolKind}</td><td>{m.dia}</td><td>{L.ext.length}</td>{h.type === 'SAW_BLADE' && <td>{L.ext.kerf}</td>}<td>{m.number}</td><td>{m.calibrated}</td><td /></tr>
              {h.tools.map((t, k) => {
                const ut = (patch: object) => upHead(i, { tools: h.tools.map((x, j) => (j === k ? { ...x, ...patch } : x)) })
                return (
                  <tr key={k}>
                    <td><input aria-label="tool id" value={t.tool_id} onChange={(e) => ut({ tool_id: e.target.value })} /></td>
                    <td><select aria-label={m.toolKind} value={t.kind} onChange={(e) => ut({ kind: e.target.value })}>{TOOL_KINDS.map((x) => <option key={x}>{x}</option>)}</select></td>
                    <td><input aria-label={m.dia} value={t.diameter_mm ?? ''} onChange={(e) => ut({ diameter_mm: numOrNull(e.target.value) })} /></td>
                    <td><input aria-label={L.ext.length} value={t.length_mm ?? ''} onChange={(e) => ut({ length_mm: numOrNull(e.target.value) })} /></td>
                    {h.type === 'SAW_BLADE' && <td><input aria-label={L.ext.kerf} value={t.kerf_mm ?? ''} onChange={(e) => ut({ kerf_mm: numOrNull(e.target.value) })} /></td>}
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
      <div className={s.actions}>
        {HEAD_TYPES.map((ht) => <button key={ht} type="button" className={s.miniBtn} onClick={() => up({ heads: [...d.heads, newHead(d.heads.length + 1, ht)] })}>{m.addHead}: {ht}</button>)}
      </div>
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
      {own && errs.length > 0 && <ul className={s.log} data-testid="own-errors">{errs.map((e) => <li key={e}>{L.own.errors[e.split(':')[0]] ?? e}{e.includes(':') ? ` (${e.slice(e.indexOf(':') + 1)})` : ''}</li>)}</ul>}
      <div className={s.actions}><button type="button" onClick={onSave} data-testid={own ? 'own-save' : 'machine-save'}>{own ? L.own.save : m.save}</button></div>
      {rec && (
        <>
          <h4>{m.gate}</h4>
          <ul className={s.log} data-testid="machine-gate">{gate.map((b) => <li key={b}>{blockerText(b, c)}</li>)}</ul>
          <CommissioningWizard rec={rec} />
          <h4>{m.history}</h4>
          <ul className={s.log}>{[...rec.log].reverse().slice(0, 12).map((l, i) => <li key={i}>{l.at.slice(0, 16).replace('T', ' ')} — {l.what}</li>)}</ul>
        </>
      )}
    </>
  )
}
