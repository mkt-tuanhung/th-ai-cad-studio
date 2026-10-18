import { useMemo, useState } from 'react'
import { Box, Check, FileDown, PenTool, Sparkles, X } from 'lucide-react'
import { fmt, useLang, useT } from '../../i18n'
import { useRouter } from '../../state/router'
import { toast } from '../../state/toast'
import { useCad } from '../../state/cad'
import { useHost } from '../../services/host'
import { useInterior, type SpaceTab, type SpaceView } from '../../state/interior'
import { Modal } from '../../components/ui/Modal'
import { Select, Table, csv, downloadFile, type Column } from '../../components/workspace/Workspace'
import { searchCatalog, STYLES, type SpaceAsset, type Style } from '../../interior/catalog'
import { placeAsset } from '../../interior/layout'
import { checkClearance, fixesFor, type Fix, type Issue } from '../../interior/clearance'
import { applyChangeSet, generateLayouts, rankOptionsWithModel, roomTypeOf, ROOM_TYPES, type GenerateResult, type LayoutOption, type RoomType } from '../../interior/options'
import { wallCabinets, wallElevation } from '../../interior/elevation'
import { wallFaces } from '../../interior/geom'
import { roomSchedule, scheduleCsvRows, type ScheduleRow } from '../../interior/production'
import { pageSvg, plotPage } from '../../cad/plot'
import type { InteriorDoc } from '../../state/interior'
import type { ItemCategory } from '../../interior/model'
import { commit, fixText, issueText, rulesOf } from './spaceKit'
import s from './SpacePlanning.module.css'
import { AssetLibraryDialog } from './AssetLibraryDialog'

/**
 * Interior → Space Planning (bottom card tab): view modes, furniture library, clearance checks with fixes,
 * three rule-based layout options, cabinet wall elevation and the room item schedule. Edits go through the
 * interior store (one undo step each); previews never change the design.
 */
export function SpacePlanning() {
  const T = useT()
  const t = T.interior.space
  const { doc, room, spTab, set } = useInterior()
  const rn = (n: string) => T.interior.roomNames[n] ?? n
  const subs: SpaceTab[] = ['library', 'checks', 'layouts', 'elevation', 'schedule']
  return (
    <div className={s.wrap} data-testid="space-planning">
      <div className={s.head}>
        <ViewModes />
        <div className={s.subs} role="tablist" aria-label={t.tab}>
          {subs.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={spTab === k} className={spTab === k ? s.on : undefined} onClick={() => set({ spTab: k })}>
              {t.subs[k]}
            </button>
          ))}
        </div>
        <Select label={t.room} value={room} onChange={(v) => set({ room: v, browserSel: `room-${v}` })} options={doc.rooms.map((r) => ({ value: r.id, label: rn(r.name) }))} className={s.roomSel} />
      </div>
      <div className={s.body}>
        {spTab === 'library' && <LibraryPanel />}
        {spTab === 'checks' && <ChecksPanel />}
        {spTab === 'layouts' && <LayoutsPanel />}
        {spTab === 'elevation' && <ElevationPanel />}
        {spTab === 'schedule' && <SchedulePanel />}
      </div>
    </div>
  )
}

/** 2D Floorplan | 3D Live | Walkthrough | Render | Production — each opens an existing view. */
function ViewModes() {
  const T = useT()
  const t = T.interior.space
  const host = useHost()
  const navigate = useRouter((st) => st.navigate)
  const { plan, view, mode, set } = useInterior()
  const cur: SpaceView = plan ? 'plan' : view === 'walk' ? 'walk' : 'live'
  const go = (v: SpaceView) => {
    const shaded = mode === 'realistic' ? 'shaded' : mode
    if (v === 'plan') return set({ plan: 'floor', cut: null })
    if (v === 'live') return set({ plan: null, cut: null, view: 'perspective', mode: host ? shaded : mode })
    if (v === 'walk') {
      if (!host) toast(fmt(T.interior.toast.native, { what: t.views.walk }))
      return set({ plan: null, cut: null, view: host ? 'walk' : view, mode: host ? shaded : mode })
    }
    if (v === 'render') {
      toast(t.viewNote.render)
      return navigate('renders')
    }
    toast(t.viewNote.production)
    set({ nestingOpen: true })
  }
  return (
    <div className={s.views} role="radiogroup" aria-label={t.viewLabel}>
      {(['plan', 'live', 'walk', 'render', 'production'] as SpaceView[]).map((v) => (
        <button key={v} type="button" role="radio" aria-checked={cur === v} className={cur === v ? s.on : undefined} onClick={() => go(v)}>
          {t.views[v]}
        </button>
      ))}
    </div>
  )
}

/* ---------------- library ---------------- */

function LibraryPanel() {
  const T = useT()
  const t = T.interior.space
  const { doc, room, plan, set } = useInterior()
  const host = useHost()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<ItemCategory | 'all'>('all')
  const [style, setStyle] = useState<Style | 'all'>('all')
  const [lib3d, setLib3d] = useState(false)
  const list = useMemo(() => searchCatalog(q, cat, style), [q, cat, style])
  const rn = (id: string) => {
    const r = doc.rooms.find((x) => x.id === id)
    return r ? T.interior.roomNames[r.name] ?? r.name : id
  }
  const place = (a: SpaceAsset) => {
    const r = placeAsset(useInterior.getState().doc, a, room)
    if (!commit(`Place ${a.name}`, r)) return
    set({ sel: { kind: 'item', id: r.id! }, inst: 0, right: 'properties', ...(!plan && !host ? { plan: 'floor' as const } : {}) })
    toast(fmt(t.lib.placed, { name: a.name, dims: `${a.w} × ${a.d} × ${a.h}`, room: rn(room) }), 'success')
  }
  return (
    <div className={s.lib}>
      <div className={s.filters}>
        <input className={s.search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.lib.search} aria-label={t.lib.search} />
        <Select label={t.lib.all} value={cat} onChange={(v) => setCat(v)} options={[{ value: 'all' as const, label: t.lib.all }, ...(Object.keys(T.interior.cats) as ItemCategory[]).map((k) => ({ value: k, label: T.interior.cats[k] }))]} className={s.fsel} />
        <Select label={t.lib.allStyles} value={style} onChange={(v) => setStyle(v)} options={[{ value: 'all' as const, label: t.lib.allStyles }, ...STYLES.map((k) => ({ value: k, label: t.lib.styles[k] }))]} className={s.fsel} />
        <small className={s.count}>{fmt(t.lib.count, { n: list.length })}</small>
        <button type="button" className={s.primary} onClick={() => setLib3d(true)} data-testid="open-asset-library">{T.assetLib.open}</button>
      </div>
      {lib3d && <AssetLibraryDialog onClose={() => setLib3d(false)} />}
      <ul className={s.assets} aria-label={t.subs.library}>
        {list.map((a) => (
          <li key={a.key} draggable onDragStart={(e) => { e.dataTransfer.setData('application/x-md-asset', a.key); e.dataTransfer.effectAllowed = 'copy' }} data-asset={a.key}>
            <b>{a.name}</b>
            <span>{a.round ? `Ø${a.w} × ${a.h}` : `${a.w} × ${a.d} × ${a.h}`} mm</span>
            <em>
              {T.interior.cats[a.cat]}
              {a.parametric ? ` · ${t.lib.parametric}` : ''}
              {a.hosted ? ` · ${t.lib.wall}` : ''}
              {a.cabinet ? ` · ${t.lib.cabinet}` : ''}
            </em>
            <button type="button" onClick={() => place(a)} aria-label={`${t.lib.place} ${a.name}`}>{t.lib.place}</button>
          </li>
        ))}
        {!list.length && <li className={s.empty}>{t.lib.none}</li>}
      </ul>
      <p className={s.hint}>{t.lib.hint}</p>
    </div>
  )
}

/* ---------------- checks ---------------- */

function ChecksPanel() {
  const T = useT()
  const t = T.interior.space
  const { doc, room, set, edit } = useInterior()
  const rules = useMemo(() => rulesOf(doc), [doc])
  const issues = useMemo(() => checkClearance(doc, rules, { room }), [doc, room, rules])
  const [open, setOpen] = useState<{ id: string; doc: InteriorDoc; fixes: Fix[] } | null>(null)
  const r = doc.rooms.find((x) => x.id === room)
  const rn = r ? T.interior.roomNames[r.name] ?? r.name : room
  const toggle = (is: Issue) => setOpen(open?.id === is.id && open.doc === doc ? null : { id: is.id, doc, fixes: fixesFor(doc, is, rules) })
  const apply = (f: Fix, is: Issue) => {
    const label = fixText(doc, f)
    if (!commit(label, { doc: f.doc })) return
    set({ preview: null })
    setOpen(null)
    toast(fmt(t.checks.applied, { label }), 'success')
    void is
  }
  const setRule = (k: keyof typeof t.checks.rules, v: number) => {
    const err = edit(`${t.checks.rules[k]} ${v} mm`, (d) => ({ ...d, clearance: { ...(d.clearance ?? {}), [k]: v } }))
    if (err) toast(err, 'warning')
  }
  return (
    <div className={s.checks}>
      <div className={s.rules}>
        <b>{t.checks.guidance}</b>
        {(Object.keys(t.checks.rules) as (keyof typeof t.checks.rules)[]).map((k) => (
          <label key={k}>
            <span>{t.checks.rules[k]}</span>
            <input aria-label={t.checks.rules[k]} defaultValue={rules[k]} key={`${k}-${rules[k]}`} inputMode="numeric" onBlur={(e) => { const v = Number(e.target.value); if (v >= 0 && v <= 3000 && v !== rules[k]) setRule(k, v); else e.target.value = String(rules[k]) }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
            <small>mm</small>
          </label>
        ))}
      </div>
      <div className={s.issues} data-testid="space-issues">
        <p className={issues.length ? s.warn : s.ok}>{issues.length ? fmt(t.checks.count, { n: issues.length, room: rn }) : fmt(t.checks.none, { room: rn })}</p>
        <ul>
          {issues.map((is) => (
            <li key={is.id} data-issue={is.kind}>
              <div className={s.issueRow}>
                <span>{issueText(doc, is)}</span>
                {is.kind !== 'needsInput' && (
                  <button type="button" onClick={() => toggle(is)} aria-expanded={open?.id === is.id}>{t.checks.showFixes}</button>
                )}
                {is.items[0] && <button type="button" onClick={() => set({ sel: { kind: 'item', id: is.items[0][0] }, inst: is.items[0][1], right: 'properties' })} aria-label="select"><Box size={12} /></button>}
              </div>
              {open?.id === is.id && open.doc === doc && (
                <ul className={s.fixes}>
                  {open.fixes.map((f, n) => (
                    <li key={n}>
                      <span>{fixText(doc, f)}</span>
                      <button type="button" onClick={() => set({ preview: { label: fixText(doc, f), doc: f.doc }, plan: useInterior.getState().plan ?? 'floor' })}>{t.checks.preview}</button>
                      <button type="button" className={s.primary} onClick={() => apply(f, is)}>{t.checks.apply}</button>
                    </li>
                  ))}
                  {!open.fixes.length && <li className={s.empty}>{t.checks.noFix}</li>}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/* ---------------- layout options ---------------- */

function LayoutsPanel() {
  const T = useT()
  const t = T.interior.space.layouts
  const lang = useLang()
  const host = useHost()
  const { doc, room, preview, set, edit } = useInterior()
  const r = doc.rooms.find((x) => x.id === room)
  const [type, setType] = useState<RoomType | null>(null)
  const kind = type ?? (r ? roomTypeOf(r) : 'living')
  const [res, setRes] = useState<{ doc: InteriorDoc; room: string; r: GenerateResult; rejected: string[] } | null>(null)
  const [ai, setAi] = useState<{ busy?: boolean; text?: string } | null>(null)
  const stale = res && (res.doc !== doc || res.room !== room)
  const gen = () => {
    setAi(null)
    set({ preview: null })
    setRes({ doc, room, r: generateLayouts(doc, room, kind, rulesOf(doc)), rejected: [] })
  }
  const label = (o: LayoutOption) => `${fmt(t.option, { id: o.id })} — ${t.templates[o.template as keyof typeof t.templates] ?? o.template}`
  const apply = (o: LayoutOption) => {
    const err = edit(label(o), (d) => applyChangeSet(d, o.changes))
    if (err) return toast(fmt(T.interior.toast.invalid, { why: err }), 'warning')
    set({ preview: null })
    setRes(null)
    toast(fmt(t.applied, { label: label(o) }), 'success')
  }
  const reject = (o: LayoutOption) => {
    if (preview?.label === label(o)) set({ preview: null })
    setRes((x) => (x ? { ...x, rejected: [...x.rejected, o.id] } : x))
    toast(t.rejected)
  }
  const rank = async (opts: LayoutOption[]) => {
    if (!host) return toast(t.rankNone)
    setAi({ busy: true })
    const out = await rankOptionsWithModel(host, opts, lang)
    setAi(out ? { text: fmt(t.aiOrder, { order: out.order.join(' > '), why: out.why }) } : { text: t.rankNone })
  }
  const g = res?.r
  const shown = g?.status === 'ok' ? g.options.filter((o) => !res!.rejected.includes(o.id)) : []
  return (
    <div className={s.layouts}>
      <div className={s.genBar}>
        <Select label={t.type} value={kind} onChange={(v) => setType(v)} options={ROOM_TYPES.map((k) => ({ value: k, label: t.types[k] }))} className={s.fsel} />
        <button type="button" className={s.primary} onClick={gen} data-testid="gen-layouts"><Sparkles size={13} />{t.generate}</button>
        {g?.status === 'ok' && shown.length > 1 && <button type="button" onClick={() => void rank(shown)} disabled={ai?.busy}>{ai?.busy ? t.ranking : t.rank}</button>}
        <small>{t.rules}</small>
      </div>
      {stale && <p className={s.warn}>{t.stale}</p>}
      {g?.status === 'needs-input' && (
        <div className={s.needs} data-testid="layouts-needs-input">
          <b>{t.needs}</b>
          <ul>{g.missing.map((m) => <li key={m}>{t.missing[m]}</li>)}</ul>
          <small>{t.needsHint}</small>
        </div>
      )}
      {g?.status === 'none' && <p className={s.warn}>{fmt(t.none, { n: g.rejected.length })}</p>}
      {g?.status === 'ok' && (
        <>
          <small className={s.count}>{fmt(t.tried, { n: g.tried, r: g.rejected.length })} · {t.formula}</small>
          {ai?.text && <p className={s.ai}><Sparkles size={12} /> {ai.text} <em>{t.aiNote}</em></p>}
          <div className={s.options} data-testid="layout-options">
            {shown.map((o) => {
              const on = preview?.label === label(o)
              return (
                <article key={o.id} className={on ? s.optOn : undefined} data-option={o.id}>
                  <header>
                    <b>{label(o)}</b>
                    <span>{fmt(t.score, { v: o.score.total })}</span>
                  </header>
                  <p className={s.items}>{o.items.map((i) => `${i.name} ${i.w}×${i.d}×${i.h}`).join(' · ')}</p>
                  <dl>
                    <dt>{t.usable}</dt><dd>{o.score.usable.toFixed(2)} m² ({Math.round(o.score.usableShare * 100)}%) · +{o.score.parts.usable}</dd>
                    <dt>{t.storage}</dt><dd>{o.score.storageL.toLocaleString('en-US')} L · +{o.score.parts.storage}</dd>
                    <dt>{t.door}</dt><dd>{o.score.doorClear >= 2000 ? '≥ 2000' : o.score.doorClear} mm · +{o.score.parts.door}</dd>
                    <dt>{t.cost}</dt><dd>{o.score.cost === null ? t.noPrice : o.score.cost.toLocaleString('en-US')}</dd>
                    {o.score.triangle && (
                      <>
                        <dt>{t.triangle}</dt>
                        <dd>{o.score.triangle.legs.join(' + ')} = {o.score.triangle.sum} mm · {o.score.triangle.ok ? t.triOk : t.triOut} · +{o.score.parts.triangle}</dd>
                      </>
                    )}
                  </dl>
                  <footer>
                    <button type="button" onClick={() => set({ preview: on ? null : { label: label(o), doc: o.doc }, plan: on ? useInterior.getState().plan : useInterior.getState().plan ?? 'floor' })} aria-pressed={on}>{t.preview}</button>
                    <button type="button" className={s.primary} disabled={!!stale} onClick={() => apply(o)}><Check size={12} />{t.apply}</button>
                    <button type="button" onClick={() => reject(o)}><X size={12} />{t.reject}</button>
                  </footer>
                </article>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

/* ---------------- wall elevation ---------------- */

function ElevationPanel() {
  const T = useT()
  const t = T.interior.space.elev
  const { doc, room } = useInterior()
  const r = doc.rooms.find((x) => x.id === room)
  const faces = r ? wallFaces(r) : []
  const [wall, setWall] = useState<number | null>(null)
  const counts = faces.map((f) => ({ f, n: wallCabinets(doc, room, f.index)?.cabinets.length ?? 0 }))
  const w = wall ?? counts.slice().sort((a, b) => b.n - a.n)[0]?.f.index ?? 0
  const cabs = wallCabinets(doc, room, w)
  const [open, setOpen] = useState(false)
  return (
    <div className={s.elev}>
      <div className={s.genBar}>
        <Select label={t.wall} value={String(w)} onChange={(v) => setWall(Number(v))} options={counts.map(({ f, n }) => ({ value: String(f.index), label: `${fmt(t.wallN, { n: f.index + 1, len: Math.round(f.len) })} · ${n}` }))} className={s.fsel} />
        <button type="button" className={s.primary} onClick={() => setOpen(true)} disabled={!cabs?.cabinets.length} data-testid="open-elevation"><PenTool size={13} />{t.open}</button>
        <small>{cabs?.cabinets.length ? fmt(t.cabinets, { n: cabs.cabinets.length }) : t.noCab}</small>
      </div>
      <ul className={s.elevList}>
        {cabs?.cabinets.map((c, k) => <li key={k}><b>{c.name}</b> <span>u {c.u0}–{c.u1} · z {c.z0}–{c.z1} mm</span></li>)}
      </ul>
      {open && r && <ElevationDialog roomId={room} wall={w} title={`${T.interior.roomNames[r.name] ?? r.name} — ${fmt(t.wallN, { n: w + 1, len: Math.round(faces.find((f) => f.index === w)?.len ?? 0) })}`} onClose={() => setOpen(false)} />}
    </div>
  )
}

function ElevationDialog({ roomId, wall, title, onClose }: { roomId: string; wall: number; title: string; onClose: () => void }) {
  const T = useT()
  const t = T.interior.space.elev
  const host = useHost()
  const navigate = useRouter((st) => st.navigate)
  const doc = useInterior((st) => st.doc)
  const el = useMemo(() => wallElevation(doc, roomId, wall, title), [doc, roomId, wall, title])
  const page = useMemo(() => plotPage(el.doc, 'A3', el.scale), [el])
  const svg = useMemo(() => pageSvg(page).replace(/width="[^"]+mm" height="[^"]+mm"/, 'width="100%" height="100%"'), [page])
  const toCad = () => {
    useCad.getState().openDocument({ ...el.doc, id: `${el.doc.id}-${Date.now().toString(36)}` })
    toast(fmt(t.opened, { name: el.doc.name }), 'success')
    onClose()
    navigate('cad2d')
  }
  const pdf = async () => {
    const file = `${el.doc.name.replace(/\.dwg$/, '')}.pdf`
    if (!host) {
      downloadFile(file.replace(/\.pdf$/, '.svg'), pageSvg(page), 'image/svg+xml')
      return toast(fmt(t.saved, { file: file.replace(/\.pdf$/, '.svg') }), 'success')
    }
    const r = await host.cadExportPdf(JSON.stringify({ ...page, name: title }), file)
    if (r.ok) toast(fmt(t.saved, { file: r.path!.split(/[\\/]/).pop()! }), 'success')
    else if (!r.cancelled) toast(r.error ?? 'PDF', 'warning')
  }
  const dims = el.doc.entities.filter((e) => e.kind === 'dimension').length
  return (
    <Modal
      title={fmt(t.title, { name: title })}
      onClose={onClose}
      width={880}
      footer={
        <>
          <small className={s.count}>{fmt(t.info, { scale: el.scale, n: el.cabinets.length, dims })}</small>
          <button type="button" className={s.dlgBtn} onClick={() => void pdf()}><FileDown size={14} />{host ? t.pdf : t.svg}</button>
          <button type="button" className={`${s.dlgBtn} ${s.primary}`} onClick={toCad}><PenTool size={14} />{t.toCad}</button>
        </>
      }
    >
      <div className={s.sheet} data-testid="elevation-sheet" dangerouslySetInnerHTML={{ __html: svg }} />
    </Modal>
  )
}

/* ---------------- schedule ---------------- */

function SchedulePanel() {
  const T = useT()
  const t = T.interior.space.sched
  const { doc, room } = useInterior()
  const [all, setAll] = useState(false)
  const rows = useMemo(() => roomSchedule(doc, all ? undefined : room), [doc, room, all])
  const rn = (id: string) => {
    const r = doc.rooms.find((x) => x.id === id)
    return r ? T.interior.roomNames[r.name] ?? r.name : id
  }
  const cols: Column<ScheduleRow>[] = [
    { key: 'name', label: t.cols.name, w: 'minmax(120px,1.4fr)', render: (r) => (all ? `${r.name} · ${rn(r.room)}` : r.name) },
    { key: 'n', label: t.cols.count, w: '44px', align: 'center', render: (r) => r.count },
    { key: 'size', label: t.cols.size, w: 'minmax(100px,1fr)', align: 'right', render: (r) => `${r.w} × ${r.d} × ${r.h}` },
    { key: 'b', label: t.cols.bounds, w: 'minmax(100px,1fr)', align: 'right', render: (r) => `${r.bounds.w} × ${r.bounds.d} × ${r.bounds.h}` },
    { key: 'e', label: t.cols.elev, w: '52px', align: 'right', render: (r) => r.elev },
    { key: 'f', label: t.cols.finishes, w: 'minmax(120px,1.6fr)', render: (r) => r.finishes },
    { key: 'm', label: t.cols.made, w: '44px', align: 'center', render: (r) => (r.manufacturable ? t.yes : t.no) },
  ]
  const exportCsv = () => {
    const file = `Villa Riverside - ${T.interior.space.csvName}${all ? '' : ` - ${rn(room)}`}.csv`
    downloadFile(file, csv(scheduleCsvRows(rows, rn)))
    toast(fmt(T.interior.toast.exported, { file }), 'success')
  }
  return (
    <div className={s.sched}>
      <div className={s.genBar}>
        <label className={s.check}><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />{t.all}</label>
        <button type="button" onClick={exportCsv}><FileDown size={13} />{t.export}</button>
        <small>{t.note}</small>
      </div>
      <Table label={T.interior.space.subs.schedule} columns={cols} rows={rows} rowKey={(r) => r.item} rowH={22} />
    </div>
  )
}
