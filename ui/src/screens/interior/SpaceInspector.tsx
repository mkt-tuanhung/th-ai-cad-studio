import { useMemo } from 'react'
import { Copy, Lock, LockOpen, RotateCcw, RotateCw, Trash2, Magnet } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { toast } from '../../state/toast'
import { useInterior } from '../../state/interior'
import { NumField, PRow, PSelect, Section, wsStyles as w } from '../../components/workspace/Workspace'
import type { Item, Room, RoomDoor } from '../../interior/model'
import { assetByKey, limitsOf, newId, spaceCatalog } from '../../interior/catalog'
import { alignToWall, duplicateItem, groupItems, placesOf, replaceInPlace, rotateInstance, setElevation, setHost, setLocked, setPartFinish, setPlace, ungroup } from '../../interior/layout'
import { materialSpec, partMaterial, partOptions, PARTS } from '../../interior/materials'
import { checkClearance } from '../../interior/clearance'
import { confirmDims, manufacturable } from '../../interior/production'
import { wallFaces } from '../../interior/geom'
import { doorsFromBim } from '../../interior/bimDoors'
import { useBim } from '../../state/bim'
import { commit, issueText, rulesOf } from './spaceKit'
import s from './SpacePlanning.module.css'

const r0 = (v: number) => Math.round(v)

/** Properties → Space Planning sections of a furniture item: placement, host, lock, replace, per-part finishes, clearance, manufacturing. */
export function ItemSpaceSections({ it }: { it: Item }) {
  const T = useT()
  const t = T.interior.space.insp
  const { doc, inst, checked, set } = useInterior()
  const at = placesOf(doc, it.id)
  const k = Math.min(inst, Math.max(0, at.length - 1))
  const p = at[k]
  const room = doc.rooms.find((r) => r.id === it.room)
  const faces = room ? wallFaces(room) : []
  const cab = it.cabinet ? doc.cabinets.find((c) => c.id === it.cabinet) : undefined
  const lim = limitsOf(it)
  const asset = assetByKey(it.catalog)
  const fresh = () => useInterior.getState().doc
  const label = (what: string) => `${it.name}: ${what}`
  const issues = useMemo(() => (room ? checkClearance(doc, rulesOf(doc), { room: room.id }).filter((x) => x.items.some(([id]) => id === it.id)) : []), [doc, room, it.id])
  const made = manufacturable(it, doc)
  const madeByDims = made.reason === 'ai-concept' || made.reason === 'image-trace' || made.reason === 'unverified-dimensions'
  const replaceOpts = spaceCatalog().filter((a) => a.cat === it.category || a.key === it.catalog)
  const fixed = lim.w[0] === lim.w[1] && lim.d[0] === lim.d[1] && lim.h[0] === lim.h[1]
  const group = it.group ? doc.items.filter((x) => x.group === it.group).length : 0
  return (
    <>
      <Section title={t.placement}>
        {at.length > 1 && (
          <PRow label={t.instance}>
            <PSelect label={t.instance} value={String(k)} onChange={(v) => set({ inst: Number(v) })} options={at.map((_, n) => ({ value: String(n), label: `${n + 1} / ${at.length}` }))} />
          </PRow>
        )}
        {p && (
          <>
            <PRow label={t.x}><NumField label={`${t.x} (mm)`} value={r0(p.x)} onCommit={(v) => commit(label(t.x), setPlace(fresh(), it.id, k, { ...p, x: v }))} unit="mm" /></PRow>
            <PRow label={t.y}><NumField label={`${t.y} (mm)`} value={r0(p.y)} onCommit={(v) => commit(label(t.y), setPlace(fresh(), it.id, k, { ...p, y: v }))} unit="mm" /></PRow>
            <PRow label={t.rot}><NumField label={t.rot} value={Math.round(p.rot * 10) / 10} min={-360} max={360} onCommit={(v) => commit(label(t.rot), rotateInstance(fresh(), it.id, k, v - p.rot))} unit="°" /></PRow>
          </>
        )}
        {it.category !== 'lighting' && (
          <PRow label={t.elev}><NumField label={t.elev} value={it.elev ?? 0} min={0} max={room?.ceilingHeight ?? 6000} onCommit={(v) => commit(label(t.elev), setElevation(fresh(), it.id, v))} unit="mm" /></PRow>
        )}
        <div className={s.inspBtns}>
          <button type="button" title={t.rotL} aria-label={t.rotL} onClick={() => commit(label(t.rotL), rotateInstance(fresh(), it.id, k, -90))}><RotateCcw size={13} /></button>
          <button type="button" title={t.rotR} aria-label={t.rotR} onClick={() => commit(label(t.rotR), rotateInstance(fresh(), it.id, k, 90))}><RotateCw size={13} /></button>
          <button type="button" title={t.align} onClick={() => commit(label(t.align), alignToWall(fresh(), it.id, k))}><Magnet size={13} />{t.align}</button>
          <button type="button" title={t.duplicate} onClick={() => { const r = duplicateItem(fresh(), it.id, k); if (commit(label(t.duplicate), r)) set({ sel: { kind: 'item', id: r.id! }, inst: 0 }) }}><Copy size={13} />{t.duplicate}</button>
          <button type="button" aria-pressed={!!it.locked} onClick={() => commit(label(it.locked ? t.unlock : t.lock), setLocked(fresh(), it.id, !it.locked))}>{it.locked ? <Lock size={13} /> : <LockOpen size={13} />}{it.locked ? t.unlock : t.lock}</button>
        </div>
        {it.locked && <p className={s.inspNote}>{t.locked}</p>}
        <PRow label={t.host}>
          <PSelect label={t.host} value={it.host ? String(it.host.wall) : 'none'} onChange={(v) => commit(label(t.host), setHost(fresh(), it.id, v === 'none' ? null : Number(v)))} options={[{ value: 'none', label: t.hostNone }, ...faces.map((f) => ({ value: String(f.index), label: fmt(t.hostWall, { n: f.index + 1 }) }))]} />
        </PRow>
        <div className={s.inspBtns}>
          {it.group ? (
            <>
              <span className={s.inspNote}>{fmt(t.grouped, { n: group })}</span>
              <button type="button" onClick={() => commit(t.ungroup, ungroup(fresh(), it.id))}>{t.ungroup}</button>
            </>
          ) : (
            <button type="button" disabled={![...new Set([it.id, ...checked])].filter((id) => doc.items.some((x) => x.id === id)).slice(1).length} onClick={() => commit(t.group, groupItems(fresh(), [...new Set([it.id, ...checked])]))}>{t.group}</button>
          )}
        </div>
      </Section>
      <Section title={t.replace}>
        <PRow label={t.limits}><span className={s.inspNote}>{fixed ? t.fixed : `W ${lim.w[0]}–${lim.w[1]} · D ${lim.d[0]}–${lim.d[1]} · H ${lim.h[0]}–${lim.h[1]} mm`}</span></PRow>
        <PRow label={t.replaceWith}>
          <PSelect
            label={t.replaceWith}
            value={asset?.key ?? ''}
            onChange={(v) => {
              const r = replaceInPlace(fresh(), it.id, v)
              if (!commit(`${it.name} → ${v}`, r)) return
              const n = room ? checkClearance(r.doc!, rulesOf(r.doc!), { room: room.id }).filter((x) => x.items.some(([id]) => id === it.id)).length : 0
              toast(fmt(t.replaced, { name: v, n }), n ? 'warning' : 'success')
            }}
            options={[...(asset ? [] : [{ value: '', label: '—' }]), ...replaceOpts.map((a) => ({ value: a.key, label: `${a.name} · ${a.w}×${a.d}×${a.h}` }))]}
          />
        </PRow>
      </Section>
      <Section title={t.parts}>
        {PARTS[it.category].map((part) => {
          const f = partMaterial(it, part, cab)
          const spec = materialSpec(f.material)
          return (
            <div key={part} className={s.partRow}>
              <PRow label={t.part[part as keyof typeof t.part] ?? part}>
                <PSelect label={`${t.part[part as keyof typeof t.part] ?? part} — ${T.interior.props.material}`} value={f.material} onChange={(v) => commit(label(part), setPartFinish(fresh(), it.id, part, { material: v, grainDeg: f.grainDeg }))} options={partOptions(it, part).map((m) => ({ value: m.name, label: T.interior.matNames[m.name] ?? m.name }))} />
              </PRow>
              {spec.directional && (
                <PRow label={t.grain}><NumField label={`${t.part[part as keyof typeof t.part] ?? part} — ${t.grain}`} value={f.grainDeg ?? spec.grainDeg} min={-180} max={180} onCommit={(v) => commit(label(t.grain), setPartFinish(fresh(), it.id, part, { material: f.material, grainDeg: v }))} unit="°" /></PRow>
              )}
              <small className={s.inspNote}>{fmt(t.tile, { w: spec.tileMm[0], h: spec.tileMm[1] })} · R {spec.roughness} · M {spec.metallic}</small>
            </div>
          )
        })}
      </Section>
      <Section title={t.clearance}>
        {issues.length ? <ul className={s.inspIssues}>{issues.map((x) => <li key={x.id}>{issueText(doc, x)}</li>)}</ul> : <p className={s.inspNote}>{t.clearOk}</p>}
      </Section>
      <Section title={t.production}>
        <p className={made.ok ? s.inspNote : s.inspBad} data-testid="manufacturable">{made.ok ? t.madeOk : fmt(t.madeNo, { why: t.reasons[made.reason!] })}</p>
        {madeByDims && (
          <button type="button" className={w.link} onClick={() => { const e = useInterior.getState().edit(t.confirm, (d) => confirmDims(d, it.id)); if (!e) toast(fmt(t.confirmed, { name: it.name }), 'success') }}>{t.confirm}</button>
        )}
      </Section>
    </>
  )
}

/** Room → Doors: wall, position, width (unknown = needs input, never guessed) and swing. */
export function RoomDoors({ r }: { r: Room }) {
  const T = useT()
  const t = T.interior.space.doors
  const edit = useInterior((st) => st.edit)
  const faces = wallFaces(r)
  const up = (label: string, fn: (ds: RoomDoor[]) => RoomDoor[]) => {
    const err = edit(`${r.name}: ${label}`, (d) => ({ ...d, rooms: d.rooms.map((x) => (x.id === r.id ? { ...x, doors: fn(x.doors ?? []) } : x)) }))
    if (err) toast(fmt(T.interior.toast.invalid, { why: err }), 'warning')
  }
  const doors = r.doors ?? []
  // doors measured in the BIM model on this room's outline (rooms built from a CAD plan share its coordinates)
  const bim = useBim((st) => st.model)
  const fromBim = useMemo(() => doorsFromBim(bim, r).filter((d) => !doors.some((x) => x.id === d.id)), [bim, r, doors])
  return (
    <Section title={t.title}>
      {!doors.length && <p className={s.inspNote}>{t.none}</p>}
      {doors.map((dr, n) => (
        <div key={dr.id} className={s.partRow} data-door={dr.id}>
          <PRow label={`${t.wall} ${n + 1}`}>
            <PSelect label={`${t.wall} ${n + 1}`} value={String(dr.wall)} onChange={(v) => up(t.wall, (ds) => ds.map((x) => (x.id === dr.id ? { ...x, wall: Number(v) } : x)))} options={faces.map((f) => ({ value: String(f.index), label: `${f.index + 1} · ${Math.round(f.len)} mm` }))} />
          </PRow>
          <PRow label={t.at}><NumField label={`${t.at} ${n + 1}`} value={dr.at} min={0} onCommit={(v) => up(t.at, (ds) => ds.map((x) => (x.id === dr.id ? { ...x, at: v } : x)))} unit="mm" /></PRow>
          <PRow label={t.width}>
            <NumField label={`${t.width} ${n + 1}`} value={dr.width ?? 0} min={500} max={3000} onCommit={(v) => up(t.width, (ds) => ds.map((x) => (x.id === dr.id ? { ...x, width: v } : x)))} unit="mm" />
          </PRow>
          {!dr.width && <small className={s.inspBad}>{t.unknown}</small>}
          <PRow label={t.swing}>
            <PSelect label={`${t.swing} ${n + 1}`} value={dr.swing ?? 'in'} onChange={(v) => up(t.swing, (ds) => ds.map((x) => (x.id === dr.id ? { ...x, swing: v as RoomDoor['swing'] } : x)))} options={(['in', 'out', 'sliding'] as const).map((k) => ({ value: k, label: t.swings[k] }))} />
          </PRow>
          <button type="button" className={w.link} onClick={() => up(t.remove, (ds) => ds.filter((x) => x.id !== dr.id))}><Trash2 size={11} /> {t.remove}</button>
        </div>
      ))}
      <button type="button" className={w.link} onClick={() => up(t.add, (ds) => [...ds, { id: newId('door'), wall: 0, at: 300 }])}>+ {t.add}</button>
      {fromBim.length > 0 && (
        <button type="button" className={w.link} data-testid="doors-from-bim" onClick={() => up(fmt(t.fromBim, { n: fromBim.length }), (ds) => [...ds, ...fromBim])}>+ {fmt(t.fromBim, { n: fromBim.length })}</button>
      )}
    </Section>
  )
}
