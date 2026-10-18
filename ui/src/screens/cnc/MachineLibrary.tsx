/**
 * Machine library tab (Machines & Tools): search + filters, a detail card with every catalogue value (units,
 * sources as text, confidence badge, "reference values — measure and confirm"), similar machines and
 * "Use this machine" (the template becomes the user's own UNVERIFIED profile).
 */
import { useMemo, useState } from 'react'
import { fmt, useT } from '../../i18n'
import { toast } from '../../state/toast'
import { useMachines } from '../../state/machines'
import { LIBRARY, NOTE_KEYS, documented, facets, familyById, searchTemplates, similarTemplates, type LibraryFilter, type MachineTemplate } from '../../cam/library'
import { suggestProfileId } from '../../cam/library/fromTemplate'
import { POSTS, postIdForFamily } from '../../cam/posts'
import s from './Cnc.module.css'

const v = (x: number | string | null | undefined, unit = '') => (x === null || x === undefined || x === '' ? '—' : `${x}${unit}`)

export function MachineLibrary({ onCreated }: { onCreated: (id: string) => void }) {
  const T = useT()
  const L = T.machlib.lib
  const [f, setF] = useState<LibraryFilter>({ q: '', manufacturer: '', country: '', category: '', controller: '', minL: null, minW: null })
  const list = useMemo(() => searchTemplates(f), [f])
  const fc = useMemo(() => facets(), [])
  const [sel, setSel] = useState<string>(list[0]?.id ?? '')
  const t = LIBRARY.machines.find((m) => m.id === sel) ?? list[0] ?? null
  const o = LIBRARY.origin
  const num = (x: string) => (x.trim() === '' || !Number.isFinite(Number(x)) ? null : Number(x))
  return (
    <div className={s.lib} data-testid="machine-library">
      <aside className={s.libSide}>
        <p className={s.small}>{L.intro}</p>
        <p className={s.small} data-testid="library-origin">{fmt(L.origin, { kind: L.originKind[o.kind] ?? o.kind, machines: o.counts.machines, controllers: o.counts.controllers, hardware: o.counts.hardware, date: o.imported_at ? ` · ${o.imported_at}` : '' })}</p>
        <input className={s.libSearch} aria-label={L.search} placeholder={L.search} value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} data-testid="library-search" />
        <div className={s.libFilters}>
          <select aria-label={L.manufacturer} value={f.manufacturer} onChange={(e) => setF({ ...f, manufacturer: e.target.value })}><option value="">{L.manufacturer}: {L.any}</option>{fc.manufacturers.map((x) => <option key={x}>{x}</option>)}</select>
          <select aria-label={L.country} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}><option value="">{L.country}: {L.any}</option>{fc.countries.map((x) => <option key={x}>{x}</option>)}</select>
          <select aria-label={L.category} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as LibraryFilter['category'] })} data-testid="library-category"><option value="">{L.category}: {L.any}</option>{fc.categories.map((x) => <option key={x} value={x}>{L.categories[x] ?? x}</option>)}</select>
          <select aria-label={L.controller} value={f.controller} onChange={(e) => setF({ ...f, controller: e.target.value as LibraryFilter['controller'] })}><option value="">{L.controller}: {L.any}</option>{fc.controllers.map((x) => <option key={x}>{x}</option>)}</select>
          <span className={s.small}>{L.sheet}</span>
          <span className={s.trio}>
            <input aria-label={`${L.sheet} L`} placeholder="2440" value={f.minL ?? ''} onChange={(e) => setF({ ...f, minL: num(e.target.value) })} />
            <input aria-label={`${L.sheet} W`} placeholder="1830" value={f.minW ?? ''} onChange={(e) => setF({ ...f, minW: num(e.target.value) })} />
          </span>
        </div>
        <p className={s.small}>{fmt(L.count, { n: list.length })}</p>
        <div className={s.list} data-testid="library-list">
          {list.map((m) => (
            <button key={m.id} type="button" className={t?.id === m.id ? s.on : undefined} onClick={() => setSel(m.id)}>
              {m.manufacturer} · {m.model}
              <small>{L.categories[m.category] ?? m.category} · {m.controller_family ?? '—'} · {v(m.work_envelope_mm.x)} × {v(m.work_envelope_mm.y)} · <span className={`${s.conf} ${s[`conf_${m.confidence}`] ?? ''}`}>{L.confidence[m.confidence]}</span></small>
            </button>
          ))}
          {!list.length && <p className={s.small}>{L.none}</p>}
        </div>
      </aside>
      <section className={s.edit}>{t && <Detail key={t.id} t={t} onPick={setSel} onCreated={onCreated} />}</section>
    </div>
  )
}

function Detail({ t, onPick, onCreated }: { t: MachineTemplate; onPick: (id: string) => void; onCreated: (id: string) => void }) {
  const T = useT()
  const L = T.machlib.lib
  const add = useMachines((st) => st.addFromTemplate)
  const [id, setId] = useState(suggestProfileId(t))
  const [groups, setGroups] = useState<number[]>(t.spindles.map((_, i) => i))
  const [drill, setDrill] = useState(true)
  const [saw, setSaw] = useState(true)
  const fam = familyById(t.controller_family)
  const postId = postIdForFamily(t.controller_family, t.machine_type)
  const sim = similarTemplates(t, 5)
  const use = () => {
    const r = add(t, { profileId: id, spindleGroups: groups, includeDrillBank: drill, includeSaw: saw })
    if (r.error) return toast(T.cnc.mgr.errors[r.error] ?? r.error, 'warning')
    toast(fmt(L.used, { id: r.id!, todo: (r.todo ?? []).filter((x) => !x.startsWith('NOTE:')).map((x) => T.machlib.todo[x] ?? x).join(', ') }), 'success')
    onCreated(r.id!)
  }
  const row = (label: string, value: string) => <tr><td>{label}</td><td>{value}</td></tr>
  return (
    <div className={s.card} data-testid="library-detail">
      <div className={s.cardHead}>
        <h4 style={{ margin: 0 }}>{t.manufacturer} — {t.series} {t.model}</h4>
        <span className={`${s.conf} ${s[`conf_${t.confidence}`] ?? ''}`} data-testid="library-confidence">{L.confidence[t.confidence]}</span>
      </div>
      <p className={s.refNote} data-testid="library-refnote">{L.refNote}</p>
      <table className={s.detail}>
        <tbody>
          {row(L.category, `${L.categories[t.category] ?? t.category} (${t.machine_type}) · ${t.country}`)}
          {row(L.envelope, `${v(t.work_envelope_mm.x)} × ${v(t.work_envelope_mm.y)} × ${v(t.work_envelope_mm.z)} mm`)}
          {row(L.table, v(t.table))}
          {row(L.spindles, t.spindles.length ? t.spindles.map((sp) => fmt(L.spindle, { count: sp.count, kw: v(sp.power_kw), rpm: v(sp.rpm_max), holder: v(sp.holder) })).join(' + ') : '—')}
          {row(L.atc, !t.atc.type || t.atc.type === 'none' ? L.atcNone : fmt(L.atcOf, { type: t.atc.type, slots: v(t.atc.slots) }))}
          {row(L.drill, t.drill_bank ? fmt(L.drillOf, { v: v(t.drill_bank.vertical), h: v(t.drill_bank.horizontal), saw: t.drill_bank.groove_saw ? L.grooveSaw : '' }) : '—')}
          {row(L.saw, t.saw ? fmt(L.sawOf, { d: v(t.saw.blade_diameter_mm), k: v(t.saw.kerf_mm), h: v(t.saw.max_cut_height_mm), l: v(t.saw.cut_length_mm) }) : '—')}
          {row(L.ctrl, `${t.controller_family ?? '—'}${t.controller_models.length ? ` (${t.controller_models.join(', ')})` : ''}`)}
          {row(L.post, postId ? `${POSTS[postId].label} ${POSTS[postId].version} (UNVERIFIED)` : L.postNone)}
          {row(L.formats, t.native_program_formats.join(', ') || '—')}
          {row(L.vendorCam, v(t.vendor_cam))}
          {row(L.notes, t.notes || '—')}
        </tbody>
      </table>
      <div className={s.small}>
        <b>{L.sources}:</b>{' '}
        {t.sources.length ? <ul className={s.log} data-testid="library-sources">{t.sources.map((x, i) => <li key={i}>{x.title}{x.url && x.url !== x.title ? ` — ${x.url}` : ''}</li>)}</ul> : L.noSources}
      </div>
      {fam && (
        <details className={s.small}>
          <summary>{L.familyNotes}: {fam.id} ({L.confidence[fam.confidence]})</summary>
          <table className={s.detail}><tbody>{NOTE_KEYS.map((k) => <tr key={k}><td>{k}</td><td className={documented(fam[k]) ? undefined : s.dangerText}>{fam[k] ?? 'not documented'}</td></tr>)}</tbody></table>
        </details>
      )}
      <div className={s.grid}>
        <label className={s.field}>{L.profileId}<input aria-label={L.profileId} value={id} onChange={(e) => setId(e.target.value)} data-testid="library-profile-id" /></label>
        {t.spindles.length > 1 && (
          <div className={s.field}>
            {L.groups}
            {t.spindles.map((sp, i) => <label key={i} className={s.check}><input type="checkbox" checked={groups.includes(i)} onChange={(e) => setGroups(e.target.checked ? [...groups, i].sort() : groups.filter((g) => g !== i))} />{fmt(L.spindle, { count: sp.count, kw: v(sp.power_kw), rpm: v(sp.rpm_max), holder: v(sp.holder) })}</label>)}
          </div>
        )}
        {t.drill_bank && <label className={s.check}><input type="checkbox" checked={drill} onChange={(e) => setDrill(e.target.checked)} />{L.includeDrill}</label>}
        {t.saw && t.machine_type !== 'PANEL_SAW' && <label className={s.check}><input type="checkbox" checked={saw} onChange={(e) => setSaw(e.target.checked)} />{L.includeSaw}</label>}
      </div>
      <div className={s.actions}><button type="button" onClick={use} data-testid="library-use">{L.use}</button></div>
      <h4>{L.similar}</h4>
      <div className={s.simList} data-testid="library-similar">
        {sim.map((m) => <button key={m.id} type="button" className={s.miniBtn} onClick={() => onPick(m.id)}>{m.manufacturer} · {m.model} ({m.controller_family ?? '—'}, {v(m.work_envelope_mm.x)} × {v(m.work_envelope_mm.y)})</button>)}
      </div>
    </div>
  )
}
