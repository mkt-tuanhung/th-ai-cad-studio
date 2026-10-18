import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { RotateCcw, Sparkles } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { Modal } from '../../components/ui/Modal'
import { ActionButton } from '../../components/ui/Button'
import { toast } from '../../state/toast'
import { useCad } from '../../state/cad'
import { getHost, isDesktopHost } from '../../services/host'
import { readDrawing } from '../../cad/batch'
import type { CadDocument } from '../../cad/types'
import {
  DEFAULT_REC, LAYER_ROLES, boxOf, findPlans, layerStats, recognize, roofElevation, segsOf, wallRect,
  type LayerRole, type LayerStat, type PlanRegion, type RecOptions, type Recognition, type RecWarning, type RoleSource,
} from '../../bim/fromCad'
import { DEFAULT_BUILD, buildBimModel, buildInterior, type BuildOptions } from '../../bim/fromCadBuild'
import { suggestLayerRoles } from '../../ai/layerRoles'
import { applyBim, applyInterior, buildNames, checkBim, checkInterior } from './fromCadActions'
import { inferElevations } from '../../auto/pipeline'
import { latestBackups, restoreBackup, type BackupStore } from '../../auto/backup'
import s from './FromCad.module.css'

interface PlanRow {
  title: string | null
  use: boolean
  levelName: string
  elevation: string
  roof: boolean
}

const num = (v: string, d: number) => (Number.isFinite(Number(v)) && v.trim() !== '' ? Number(v) : d)

/**
 * Build model from CAD plans: drawing → layer roles (rules, geometry, optional local-AI suggestions, the user) →
 * plans → recognised walls / openings / rooms / columns / furniture → preview → Approve & build (one undo step).
 * Recognition depends on the drawing and the layer roles only; level names and elevations typed in the plan table
 * rebuild the model, never re-run the recognition. The model rules run before the approval (shown in the footer);
 * a replaced model is backed up first and can be restored here.
 */
export function FromCadDialog({ onClose, interior = false }: { onClose: () => void; interior?: boolean }) {
  const T = useT()
  const t = T.bim.fromCad
  const cadDocs = useCad((st) => st.docs)
  const activeId = useCad((st) => st.activeId)
  const [local, setLocal] = useState<CadDocument | null>(null)
  const [docId, setDocId] = useState<string | null>(() => activeId ?? Object.keys(useCad.getState().docs)[0] ?? null)
  const doc: CadDocument | null = docId === 'local' ? local : docId ? cadDocs[docId] ?? null : null
  const [busy, setBusy] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  // layer roles: rule / geometry by default, then AI suggestions and the user's choices on top
  const stats = useMemo<LayerStat[]>(() => (doc ? layerStats(doc) : []), [doc])
  const [over, setOver] = useState<Record<string, { role: LayerRole; by: RoleSource }>>({})
  useEffect(() => setOver({}), [doc])
  const roles = useMemo(() => Object.fromEntries(stats.map((st) => [st.name, over[st.name]?.role ?? st.role])) as Record<string, LayerRole>, [stats, over])
  const byOf = (st: LayerStat): RoleSource => over[st.name]?.by ?? st.by

  const regions = useMemo<PlanRegion[]>(() => (doc ? findPlans(doc, roles) : []), [doc, roles])
  const [rows, setRows] = useState<Record<string, PlanRow>>({})
  useEffect(() => {
    let n = 0
    // elevations the titles do not give: from the storey number and the titled neighbours (never two plans at one)
    const plansIn = regions.filter((r) => r.kind !== 'other')
    const el = inferElevations(plansIn.map((r) => ({ order: r.order, elevation: r.elevation, roof: r.kind === 'roof' })), DEFAULT_BUILD.storeyH, doc ? roofElevation(doc) : null)
    const elOf = new Map(plansIn.map((r, i) => [r.id, el[i].elevation]))
    // a role change re-finds the plans; rows the user already edited are kept (same plan title)
    setRows((prev) => Object.fromEntries(regions.map((r) => {
      const plan = r.kind !== 'other'
      if (plan) n++
      const old = prev[r.id]
      if (old && old.title === r.title) return [r.id, old]
      return [r.id, { title: r.title, use: plan, roof: r.kind === 'roof', levelName: r.levelName ?? fmt(t.levelDefault, { n: Math.max(1, n) }), elevation: String(r.elevation ?? elOf.get(r.id) ?? (n - 1) * DEFAULT_BUILD.storeyH) }]
    })))
  }, [regions, t.levelDefault, doc])

  const [rec, setRec] = useState<RecOptions>(DEFAULT_REC)
  const [bo, setBo] = useState<BuildOptions>(DEFAULT_BUILD)
  const [mode, setMode] = useState<'replace' | 'merge'>('replace')
  const [withBim, setWithBim] = useState(true)
  const [withInterior, setWithInterior] = useState(interior)
  const roofEl = useMemo(() => (doc ? roofElevation(doc) : null), [doc])

  // recognition: the drawing, the roles and the options only (typing a level name or an elevation never re-runs it)
  const recs = useMemo<Recognition[]>(() => (doc ? regions.map((r) => recognize(doc, roles, r, rec)) : []), [doc, regions, roles, rec])
  // the model follows the typed names / elevations a moment later (typing stays responsive)
  const lazyRows = useDeferredValue(rows)
  const picked = regions.map((r, i) => ({ r, rec: recs[i], row: lazyRows[r.id] })).filter((x) => x.rec && x.row?.use)
  const names = useMemo(() => buildNames(t), [t])

  // storey above the top plan follows the roof plan's title elevation when there is one
  const topEl = picked.length ? Math.max(...picked.map((p) => num(p.row.elevation, 0))) : 0
  const [storeyUser, setStoreyUser] = useState<number | null>(null)
  const storeyH = storeyUser ?? (roofEl !== null && roofEl > topEl + 1500 && !picked.some((p) => p.row.roof) ? roofEl - topEl : bo.storeyH)
  const built = useMemo(() => {
    if (!picked.length) return null
    return buildBimModel(picked.map((p) => ({ rec: p.rec, levelName: p.row.levelName.trim() || p.r.id, elevation: num(p.row.elevation, 0), roof: p.row.roof })), { ...bo, storeyH }, names)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recs, lazyRows, bo, storeyH, names])
  const [intLevel, setIntLevel] = useState<string>('L1')
  const intIdx = built ? Math.max(0, built.model.levels.findIndex((l) => l.id === intLevel)) : 0
  const sortedPicks = [...picked].sort((a, b) => num(a.row.elevation, 0) - num(b.row.elevation, 0))
  const interiorBuild = useMemo(() => {
    if (!built || !withInterior || !sortedPicks[intIdx]) return null
    return buildInterior(built.model, built.model.levels[intIdx].id, sortedPicks[intIdx].rec.furniture, built.align.origins[intIdx], names)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, withInterior, intIdx, names])

  const [view, setView] = useState(0)
  const shown = picked[Math.min(view, picked.length - 1)] ?? null

  const openFile = async (f: File) => {
    setBusy(fmt(t.opening, { name: f.name }))
    try {
      const r = await readDrawing(f)
      setLocal(r.doc)
      setDocId('local')
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e)
      toast(why === 'no-dwg-reader' ? t.noDwgReader : fmt(t.openFailed, { name: f.name, why }), 'warning')
    } finally {
      setBusy(null)
    }
  }

  const [aiMsg, setAiMsg] = useState<string | null>(null)
  const runAi = async () => {
    const host = await getHost()
    if (!host) return setAiMsg(t.aiBrowser)
    // only the layers no name rule knows are asked about (a name rule is never overridden by a suggestion)
    const ask = stats.filter((x) => x.by !== 'rule')
    if (!ask.length) return setAiMsg(t.aiNone)
    setAiMsg(fmt(t.aiRunning, { n: Math.min(60, ask.length) }))
    const r = await suggestLayerRoles(host, ask)
    if (r.error === 'no-model') return setAiMsg(t.aiNoModel)
    if (r.error) return setAiMsg(fmt(t.aiFailed, { why: r.error }))
    // suggestions never override the user's own choices, nor a name rule
    const next = { ...over }
    let n = 0
    for (const [name, role] of Object.entries(r.roles)) {
      if (over[name]?.by === 'user' || stats.find((x) => x.name === name)?.by === 'rule') continue
      const cur = over[name]?.role ?? stats.find((x) => x.name === name)?.role
      if (cur === role) continue
      next[name] = { role, by: 'ai' }
      n++
    }
    setOver(next)
    setAiMsg(n ? fmt(t.aiDone, { n, s: r.seconds.toFixed(1), model: r.model ?? 'local' }) : t.aiNone)
  }

  // the model rules before the approval (the same the stores run): said in the footer, Approve waits for a fix
  const preBim = useMemo(() => { try { return built && withBim ? checkBim(built.model, mode) : null } catch (e) { return e instanceof Error ? e.message : String(e) } }, [built, withBim, mode])
  const preInt = useMemo(() => { try { return interiorBuild && withInterior ? checkInterior(interiorBuild) : null } catch (e) { return e instanceof Error ? e.message : String(e) } }, [interiorBuild, withInterior])
  // a synchronous guard (a double click applies once); the BIM part applied stays applied — a second click after
  // the Interior part was rejected does not add it again
  const busyRef = useRef(false)
  const [applying, setApplying] = useState(false)
  const doneBim = useRef<object | null>(null)
  const [applyErr, setApplyErr] = useState<string | null>(null)
  useEffect(() => { doneBim.current = null }, [built, mode])
  const [backups, setBackups] = useState<{ store: BackupStore; at: number; label: string }[]>([])
  const refreshBackups = useCallback(() => { latestBackups(['bim', 'interior']).then(setBackups, () => setBackups([])) }, [])
  useEffect(() => { refreshBackups() }, [refreshBackups])
  const approve = async () => {
    if (busyRef.current) return
    if (!built) return toast(t.noPlan, 'warning')
    busyRef.current = true
    setApplying(true)
    setApplyErr(null)
    const name = doc?.name ?? ''
    const label = fmt(t.undoLabel, { name })
    const A = T.auto.backup
    try {
      if (withBim && doneBim.current !== built.model) {
        const r = await applyBim(built.model, mode, label)
        if (r.error) { setApplyErr(fmt(t.invalid, { mark: r.error })); toast(fmt(t.invalid, { mark: r.error }), 'warning'); return }
        doneBim.current = built.model
        if (!r.backedUp) toast(fmt(A.failed, { what: A.stores.bim }), 'warning')
        toast(fmt(t.built, { name, summary: summary(built.counts) }), 'success')
      }
      if (withInterior && interiorBuild) {
        const r = await applyInterior(interiorBuild, label)
        if (r.error) { setApplyErr(fmt(t.invalid, { mark: r.error })); toast(fmt(t.invalid, { mark: r.error }), 'warning'); return }
        if (!r.backedUp) toast(fmt(A.failed, { what: A.stores.interior }), 'warning')
        toast(fmt(t.builtInterior, { level: built.model.levels[intIdx]?.name ?? '', rooms: interiorBuild.rooms.length, items: interiorBuild.items.length, cabinets: interiorBuild.cabinets.length }), 'success')
      }
      onClose()
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e)
      setApplyErr(why)
      toast(fmt(t.invalid, { mark: why }), 'warning')
    } finally {
      busyRef.current = false
      setApplying(false)
      refreshBackups()
    }
  }
  const restore = async (st: BackupStore) => {
    if (busyRef.current) return
    busyRef.current = true
    const A = T.auto.backup, what = A.stores[st]
    try {
      const e = await restoreBackup(st, A.restoreLabel)
      toast(e ? fmt(A.restoreFailed, { what, why: e }) : fmt(A.restored, { what }), e ? 'warning' : 'success')
    } catch (e) {
      toast(fmt(A.restoreFailed, { what, why: e instanceof Error ? e.message : String(e) }), 'warning')
    } finally {
      busyRef.current = false
      refreshBackups()
    }
  }
  const summary = (c: NonNullable<typeof built>['counts']) => fmt(t.summary, { levels: c.levels, walls: c.walls, doors: c.doors, windows: c.windows, rooms: c.rooms, columns: c.columns, furniture: c.components })

  const docList = Object.values(cadDocs)
  const warnText = (w: RecWarning) => fmt(t.warn[w.code], 'n' in w ? { n: w.n } : {})
  const allWarnings = picked.flatMap((p) => p.rec.warnings.map((w) => `${p.row.levelName}: ${warnText(w)}`))

  return (
    <Modal title={t.title} onClose={onClose} width={1080}>
      <div className={s.wrap} data-testid="fromcad">
        <div className={s.side}>
          <p className={s.note}>{t.intro}</p>
          <div className={s.row}>
            <label className={s.grow}>
              <span>{t.source}</span>
              <select aria-label={t.source} value={docId ?? ''} onChange={(e) => setDocId(e.target.value || null)}>
                {!docList.length && !local && <option value="">{t.noDocs}</option>}
                {docList.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                {local && <option value="local">{local.name}</option>}
              </select>
            </label>
            <ActionButton onClick={() => input.current?.click()}>{t.open}</ActionButton>
            <input ref={input} type="file" hidden accept=".dwg,.dxf" aria-label={t.open} data-testid="fromcad-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void openFile(f); e.target.value = '' }} />
          </div>
          {busy && <p className={s.note}>{busy}</p>}

          {doc && (
            <>
              <div className={s.head}>
                <h4>{t.layers}</h4>
                <button type="button" className={s.ai} onClick={runAi} disabled={!isDesktopHost() || !stats.length} title={isDesktopHost() ? undefined : t.aiBrowser} data-testid="fromcad-ai">
                  <Sparkles size={13} /> {t.ai}
                </button>
              </div>
              {aiMsg && <p className={s.note} role="status">{aiMsg}</p>}
              <div className={s.layers}>
                <table aria-label={t.layers}>
                  <thead><tr><th>{t.layerCols.layer}</th><th>{t.layerCols.contents}</th><th>{t.layerCols.role}</th><th>{t.layerCols.by}</th></tr></thead>
                  <tbody>
                    {stats.map((st) => (
                      <tr key={st.name}>
                        <td className={s.lname} title={st.name}>{st.name}</td>
                        <td className={s.kinds} title={[...st.texts, ...st.blocks].join(' · ')}>{Object.entries(st.kinds).map(([k, n]) => `${n} ${k}`).join(', ')}</td>
                        <td>
                          <select aria-label={`${t.layerCols.role}: ${st.name}`} value={roles[st.name]} onChange={(e) => setOver({ ...over, [st.name]: { role: e.target.value as LayerRole, by: 'user' } })}>
                            {LAYER_ROLES.map((r) => <option key={r} value={r}>{t.roles[r]}</option>)}
                          </select>
                        </td>
                        <td><span className={`${s.by} ${s[`by_${byOf(st)}`] ?? ''}`}>{t.by[byOf(st)]}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h4>{t.plans}</h4>
              <table className={s.plans} aria-label={t.plans}>
                <thead><tr><th>{t.planCols.use}</th><th>{t.planCols.title}</th><th>{t.planCols.level}</th><th>{t.planCols.elevation}</th><th>{t.planCols.roof}</th></tr></thead>
                <tbody>
                  {regions.map((r, i) => {
                    const row = rows[r.id]
                    if (!row) return null
                    const set = (p: Partial<PlanRow>) => setRows({ ...rows, [r.id]: { ...row, ...p } })
                    const rc = recs[i]
                    return (
                      <tr key={r.id} className={row.use ? undefined : s.off}>
                        <td><input type="checkbox" checked={row.use} aria-label={`${t.planCols.use}: ${r.title ?? r.id}`} onChange={(e) => set({ use: e.target.checked })} /></td>
                        <td>
                          <div className={s.ptitle}>{r.title ?? fmt(t.untitled, { n: i + 1 })}</div>
                          <div className={s.pfound}>{r.kind === 'other' ? t.other : rc ? fmt(t.found, { walls: rc.walls.length, doors: rc.openings.filter((o) => o.kind !== 'window').length, windows: rc.openings.filter((o) => o.kind === 'window').length, rooms: rc.rooms.length }) : ''}</div>
                        </td>
                        <td><input aria-label={`${t.planCols.level}: ${r.title ?? r.id}`} value={row.levelName} onChange={(e) => set({ levelName: e.target.value })} /></td>
                        <td><input aria-label={`${t.planCols.elevation}: ${r.title ?? r.id}`} value={row.elevation} inputMode="numeric" onChange={(e) => set({ elevation: e.target.value })} /></td>
                        <td><input type="checkbox" checked={row.roof} aria-label={`${t.planCols.roof}: ${r.title ?? r.id}`} onChange={(e) => set({ roof: e.target.checked })} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              <h4>{t.options}</h4>
              <div className={s.opts}>
                {([['storeyH', storeyH, (v: number) => setStoreyUser(v)], ['slabT', bo.slabT, (v: number) => setBo({ ...bo, slabT: v })], ['parapetH', bo.parapetH, (v: number) => setBo({ ...bo, parapetH: v })],
                  ['doorH', rec.doorH, (v: number) => setRec({ ...rec, doorH: v })], ['winSill', rec.winSill, (v: number) => setRec({ ...rec, winSill: v })], ['winH', rec.winH, (v: number) => setRec({ ...rec, winH: v })]] as const).map(([k, v, f]) => (
                  <label key={k}>
                    <span>{t.opt[k]}</span>
                    <input aria-label={t.opt[k]} defaultValue={String(k === 'storeyH' ? storeyH : v)} key={k === 'storeyH' ? storeyH : undefined} inputMode="numeric" onBlur={(e) => { const n = num(e.target.value, v); if (n > 0) f(n) }} />
                  </label>
                ))}
              </div>
              {roofEl !== null && storeyUser === null && storeyH !== bo.storeyH && <p className={s.note}>{fmt(t.roofFromTitle, { e: `+${(roofEl / 1000).toFixed(3)}` })}</p>}
              <label className={s.check}><input type="checkbox" checked={bo.roofSlab} onChange={(e) => setBo({ ...bo, roofSlab: e.target.checked })} />{t.opt.roofSlab}</label>
              <label className={s.check}><input type="checkbox" checked={bo.furniture} onChange={(e) => setBo({ ...bo, furniture: e.target.checked })} />{t.opt.furniture}</label>
              <label className={s.check}>
                <input type="checkbox" checked={withBim} onChange={(e) => setWithBim(e.target.checked)} />
                <span>{t.opt.mode}:</span>
                <select aria-label={t.opt.mode} value={mode} disabled={!withBim} onChange={(e) => setMode(e.target.value as 'replace' | 'merge')}>
                  <option value="replace">{t.opt.replace}</option>
                  <option value="merge">{t.opt.merge}</option>
                </select>
              </label>
              {withBim && mode === 'replace' && <p className={s.note} data-testid="fromcad-replace-note">{fmt(T.auto.backup.replaceNote, { what: T.auto.backup.stores.bim })}</p>}
              <label className={s.check}><input type="checkbox" checked={withInterior} onChange={(e) => setWithInterior(e.target.checked)} data-testid="fromcad-interior" />{t.opt.interior}</label>
              {withInterior && <p className={s.note}>{fmt(T.auto.backup.replaceNote, { what: T.auto.backup.stores.interior })}</p>}
              {backups.length > 0 && (
                <div className={s.note} data-testid="fromcad-restore">
                  {backups.map((b) => (
                    <button key={b.store} type="button" className={s.ai} onClick={() => void restore(b.store)} title={b.label}>
                      <RotateCcw size={12} /> {fmt(T.auto.backup.restore, { what: T.auto.backup.stores[b.store], when: new Date(b.at).toLocaleString() })}
                    </button>
                  ))}
                </div>
              )}
              {withInterior && built && (
                <label className={s.check}>
                  <span>{t.opt.interiorLevel}</span>
                  <select aria-label={t.opt.interiorLevel} value={built.model.levels[intIdx]?.id} onChange={(e) => setIntLevel(e.target.value)}>
                    {built.model.levels.slice(0, sortedPicks.length).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </label>
              )}
            </>
          )}
        </div>

        <div className={s.main}>
          <div className={s.strip}>
            <h4>{t.preview}</h4>
            {picked.map((p, i) => (
              <button key={p.r.id} type="button" className={i === Math.min(view, picked.length - 1) ? s.on : undefined} onClick={() => setView(i)}>{p.row.levelName}</button>
            ))}
          </div>
          {doc && shown ? <PlanPreview doc={doc} rec={shown.rec} roles={roles} /> : <div className={s.empty}>{doc ? t.noPlan : t.noDocs}</div>}
          <div className={s.legend}>
            {(['wall', 'curtain', 'door', 'window', 'opening', 'column', 'room', 'furniture'] as const).map((k) => <span key={k}><i className={s[`lg_${k}`]} />{t.legend[k]}</span>)}
          </div>
          {built && <p className={s.note}>{built.align.method === 'grid' && built.align.grid ? fmt(t.align.grid, { v: built.align.grid[0], h: built.align.grid[1] }) : t.align.extent}</p>}
          {allWarnings.length > 0 && <ul className={s.warn}>{allWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
        </div>
      </div>
      <div className={s.foot}>
        <span data-testid="fromcad-summary">
          {built ? summary(built.counts) : t.noPlan}
          {interiorBuild && <><br />{fmt(t.interiorSummary, { rooms: interiorBuild.rooms.length, items: interiorBuild.items.length, cabinets: interiorBuild.cabinets.length })}</>}
          {preBim && <><br /><span role="alert" data-testid="fromcad-rejected">{fmt(t.invalid, { mark: preBim })}</span></>}
          {preInt && <><br /><span role="alert" data-testid="fromcad-rejected-interior">{fmt(t.invalid, { mark: preInt })}</span></>}
          {applyErr && !preBim && !preInt && <><br /><span role="alert">{applyErr}</span></>}
        </span>
        <ActionButton onClick={onClose}>{t.cancel}</ActionButton>
        <ActionButton variant="primary" onClick={() => void approve()} disabled={!built || (!withBim && !withInterior) || applying || !!preBim || !!preInt} data-testid="fromcad-approve">{t.approve}</ActionButton>
      </div>
    </Modal>
  )
}

/** The plan with what was recognised drawn over it (drawing coordinates, Y up). */
function PlanPreview({ doc, rec, roles }: { doc: CadDocument; rec: Recognition; roles: Record<string, LayerRole> }) {
  const b = rec.region.box
  const pad = Math.max(800, 0.05 * Math.max(b.x1 - b.x0, b.y1 - b.y0))
  const vb = { x: b.x0 - pad, y: b.y0 - pad, w: b.x1 - b.x0 + 2 * pad, h: b.y1 - b.y0 + 2 * pad }
  const src = useMemo(() => {
    const paths: string[] = []
    for (const e of doc.entities) {
      const eb = boxOf(e)
      if (eb.x1 < vb.x || eb.x0 > vb.x + vb.w || eb.y1 < vb.y || eb.y0 > vb.y + vb.h) continue
      for (const [p, q] of segsOf(e)) paths.push(`M${p.x.toFixed(0)} ${p.y.toFixed(0)}L${q.x.toFixed(0)} ${q.y.toFixed(0)}`)
      if (e.kind === 'arc' || e.kind === 'circle') {
        const sa = e.kind === 'arc' ? e.start : 0, ea = e.kind === 'arc' ? e.end : 2 * Math.PI - 1e-3
        let span = ea - sa
        while (span <= 0) span += 2 * Math.PI
        const k = Math.max(4, Math.ceil(span / 0.3))
        let d = ''
        for (let i = 0; i <= k; i++) { const a = sa + (span * i) / k; d += `${i ? 'L' : 'M'}${(e.c.x + e.r * Math.cos(a)).toFixed(0)} ${(e.c.y + e.r * Math.sin(a)).toFixed(0)}` }
        paths.push(d)
      }
    }
    return paths.join('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, rec.region.id, roles])
  const pts = (poly: [number, number][]) => poly.map((p) => `${p[0].toFixed(0)},${p[1].toFixed(0)}`).join(' ')
  const lw = vb.w / 900
  // the recognition ran in the plan's squared frame: turn the overlay back onto the drawing
  const { angle, pivot } = rec.frame
  const turn = angle ? `rotate(${(angle * 180) / Math.PI} ${pivot[0]} ${pivot[1]})` : undefined
  const back = ([x, y]: [number, number]): [number, number] => {
    const c = Math.cos(angle), sn = Math.sin(angle)
    return [pivot[0] + (x - pivot[0]) * c - (y - pivot[1]) * sn, pivot[1] + (x - pivot[0]) * sn + (y - pivot[1]) * c]
  }
  return (
    <svg className={s.preview} viewBox={`${vb.x} ${-(vb.y + vb.h)} ${vb.w} ${vb.h}`} data-testid="fromcad-preview" role="img" aria-label={rec.region.title ?? rec.region.id}>
      <g transform="scale(1,-1)">
        <path d={src} className={s.src} strokeWidth={lw} />
        <g transform={turn}>
        {rec.rooms.map((r, i) => <polygon key={`r${i}`} points={pts(r.outline)} className={s.room} strokeWidth={lw * 1.5} />)}
        {rec.walls.map((w, i) => <polygon key={`w${i}`} points={pts(wallRect(w))} className={w.curtain ? s.curtain : s.wall} strokeWidth={lw} />)}
        {rec.openings.map((o, i) => { const w = rec.walls[o.wall]; return w ? <polygon key={`o${i}`} points={pts(wallRect(w, o.s0, o.s1, 25))} className={s[o.kind]} /> : null })}
        {rec.columns.map((c, i) => <rect key={`c${i}`} x={c.x - c.w / 2} y={c.y - c.d / 2} width={c.w} height={c.d} className={s.column} />)}
        {rec.furniture.map((f, i) => (
          <rect key={`f${i}`} x={-f.w / 2} y={-f.d / 2} width={f.w} height={f.d} className={s.furn} strokeWidth={lw} transform={`translate(${f.x} ${f.y}) rotate(${f.rot})`} />
        ))}
        </g>
      </g>
      {rec.rooms.map((r, i) => {
        const [cx, cy] = back([r.outline.reduce((a, p) => a + p[0], 0) / r.outline.length, r.outline.reduce((a, p) => a + p[1], 0) / r.outline.length])
        return <text key={`t${i}`} x={cx} y={-cy} className={s.rlabel} fontSize={vb.w / 75} textAnchor="middle">{`${r.name ?? '?'} · ${r.area.toFixed(2)} m²`}</text>
      })}
    </svg>
  )
}
