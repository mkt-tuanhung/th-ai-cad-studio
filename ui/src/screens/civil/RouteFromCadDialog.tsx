import { useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { Modal } from '../../components/ui/Modal'
import { ActionButton } from '../../components/ui/Button'
import { toast } from '../../state/toast'
import { useCad } from '../../state/cad'
import { useCivil } from '../../state/civil'
import { getHost, isDesktopHost } from '../../services/host'
import { readDrawing } from '../../cad/batch'
import type { CadDocument } from '../../cad/types'
import { civilRuleRole, findRoutes, routeHasDesign, volumes, type CivilRole, type CrossSection, type Route, type SectionWarning } from '../../civil/fromCad'
import { buildCivilModel } from '../../civil/fromCadBuild'
import { sta } from '../../civil/model'
import { suggestCivilRoles } from '../../ai/layerRoles'
import { DrawnSectionChart } from './CivilCharts'
import s from '../bim/FromCad.module.css'

type By = 'rule' | 'ai' | 'user' | 'none'
const NO_OVER: Record<string, { role: CivilRole; by: By }> = {}
const n0 = (v: number) => Math.round(v).toLocaleString('en-US')
const n2 = (v?: number) => (v === undefined ? '—' : v.toFixed(2))
// the designer's total fill (a box that writes the cut and no fill: no fill) — never a total plus its breakdown
const drawnFill = (x: CrossSection) => (x.drawn ? x.drawn.fill ?? 0 : undefined)
const hasW = (x: CrossSection, k: SectionWarning['kind']) => (x.warnings ?? []).some((w) => w.kind === k)

/**
 * Civil → Route from CAD: drawing → ground / design line layers (name rules, local-AI suggestion, the user) →
 * routes found in the long-profile tables → every cross section with computed vs designer areas → preview →
 * Approve & build (one undo step) replaces the Civil model with the route.
 */
export function RouteFromCadDialog({ onClose }: { onClose: () => void }) {
  const T = useT()
  const t = T.civil.fromCad
  const cadDocs = useCad((st) => st.docs)
  const activeId = useCad((st) => st.activeId)
  const [local, setLocal] = useState<CadDocument | null>(null)
  const [docId, setDocId] = useState<string | null>(() => activeId ?? Object.keys(useCad.getState().docs)[0] ?? null)
  const doc: CadDocument | null = docId === 'local' ? local : docId ? cadDocs[docId] ?? null : null
  const [busy, setBusy] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  // line layers with their default role
  const layers = useMemo(() => {
    if (!doc) return []
    const by = new Map<string, { lines: number; texts: string[] }>()
    for (const e of doc.entities) {
      const l = by.get(e.layer) ?? { lines: 0, texts: [] }
      if (e.kind === 'line' || e.kind === 'polyline') l.lines++
      if (e.kind === 'text' && l.texts.length < 3 && e.value.trim()) l.texts.push(e.value.trim())
      by.set(e.layer, l)
    }
    return [...by.entries()].filter(([, v]) => v.lines > 0).map(([name, v]) => ({ name, ...v, rule: civilRuleRole(name) })).sort((a, b) => Number(!!b.rule) - Number(!!a.rule) || b.lines - a.lines)
  }, [doc])
  // the user's / AI's roles, per drawing
  const [overBy, setOverBy] = useState<Record<string, Record<string, { role: CivilRole; by: By }>>>({})
  const dk = docId === 'local' ? `local:${local?.id ?? ''}` : docId ?? ''
  const over = overBy[dk] ?? NO_OVER
  const setOver = (v: Record<string, { role: CivilRole; by: By }>) => setOverBy({ ...overBy, [dk]: v })
  const roles = useMemo(() => Object.fromEntries(layers.map((l) => [l.name, over[l.name]?.role ?? l.rule ?? 'ignore'])) as Record<string, CivilRole>, [layers, over])
  const byOf = (name: string, rule: CivilRole | null): By => over[name]?.by ?? (rule ? 'rule' : 'none')

  // reading a large drawing takes a moment: computed after the dialog has painted
  const [found, setFound] = useState<{ doc: CadDocument; roles: Record<string, CivilRole>; routes: Route[] } | null>(null)
  const routes = found && found.doc === doc && found.roles === roles ? found.routes : null
  useEffect(() => {
    if (!doc) return
    const id = setTimeout(() => setFound({ doc, roles, routes: findRoutes(doc, roles) }), 30)
    return () => clearTimeout(id)
  }, [doc, roles])
  const [ri, setRi] = useState(0)
  const route = routes?.[Math.min(ri, (routes?.length ?? 1) - 1)] ?? null
  const [sel, setSel] = useState(0)
  const sec = route?.sections[Math.min(sel, route.sections.length - 1)] ?? null
  const vol = useMemo(() => (route ? volumes(route.sections) : null), [route])

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
    // the layers that can hold section lines (≥ 5 lines), at most 40: a short prompt and a short reply
    const ask = layers.filter((l) => l.lines >= 5).slice(0, 40)
    setAiMsg(fmt(t.aiRunning, { n: ask.length }))
    const r = await suggestCivilRoles(host, ask)
    if (r.error === 'no-model') return setAiMsg(t.aiNoModel)
    if (r.error) return setAiMsg(fmt(t.aiFailed, { why: r.error }))
    const next = { ...over }
    let n = 0
    for (const [name, role] of Object.entries(r.roles)) {
      if (over[name]?.by === 'user') continue
      if ((over[name]?.role ?? layers.find((l) => l.name === name)?.rule ?? 'ignore') === role) continue
      next[name] = { role, by: 'ai' }
      n++
    }
    setOver(next)
    setAiMsg(n ? fmt(t.aiDone, { n, s: r.seconds.toFixed(1), model: r.model ?? 'local' }) : t.aiNone)
  }

  // without a design line there is nothing to build (no invert, no cut / fill): the user picks its layer first
  const hasDesign = !!route && routeHasDesign(route)
  const summary = route && vol ? fmt(t.summary, { n: route.sections.length, len: n0(vol.length), cut: n0(vol.cut), fill: n0(vol.fill) }) : ''
  const drawnSummary = vol?.drawn ? fmt(t.drawnSummary, { cut: n0(vol.drawn.cut), fill: n0(vol.drawn.fill), dc: (((vol.cut - vol.drawn.cut) / Math.max(1e-9, vol.drawn.cut)) * 100).toFixed(2), df: (((vol.fill - vol.drawn.fill) / Math.max(1e-9, vol.drawn.fill)) * 100).toFixed(2) }) : null
  const warnings: string[] = []
  if (route) {
    if (route.missing.length) warnings.push(fmt(t.missing, { list: route.missing.join(', ') }))
    if (route.unmatched.length) warnings.push(fmt(t.unmatched, { list: route.unmatched.join(', ') }))
    const off = route.sections.filter((x) => x.tableOff > 0).length
    if (off) warnings.push(fmt(t.tableWarn, { n: off }))
    const anch = route.sections.filter((x) => x.map.vfit !== 'table').length
    if (anch) warnings.push(fmt(t.anchoredWarn, { n: anch }))
    const inv = route.stakes.map((k) => k.invert).filter((z): z is number => z !== undefined)
    if (inv.length >= 2 && Math.abs(inv[0] - inv[inv.length - 1]) < 1e-6) warnings.push(t.noFlow)
    // what could not be read or computed as drawn, per kind (each section's detail is in its row and preview)
    const of = (pred: (w: SectionWarning) => boolean) => route.sections.filter((x) => (x.warnings ?? []).some(pred))
    const names = (xs: CrossSection[]) => (xs.length > 8 ? `${xs.slice(0, 8).map((x) => x.name).join(', ')}…` : xs.map((x) => x.name).join(', '))
    const nd = of((w) => w.kind === 'noDesign')
    if (nd.length && hasDesign) warnings.push(fmt(t.secNoDesign, { n: nd.length, list: names(nd) }))
    const gj = route.sections.flatMap((x) => (x.warnings ?? []).flatMap((w) => (w.kind === 'groundJoined' ? [w.gap] : [])))
    if (gj.length) warnings.push(fmt(t.groundJoinedWarn, { n: gj.length, gap: gj.reduce((a, g) => a + g, 0).toFixed(2) }))
    const gs = of((w) => w.kind === 'groundShort')
    if (gs.length) warnings.push(fmt(t.groundShortWarn, { n: gs.length, list: names(gs) }))
    const dg = of((w) => w.kind === 'designGap')
    if (dg.length) warnings.push(fmt(t.designGapWarn, { n: dg.length, list: names(dg) }))
    const hf = of((w) => w.kind === 'hScale' && w.from === 'few')
    if (hf.length) warnings.push(fmt(t.hScaleFewWarn, { n: hf.length, list: names(hf) }))
    const ha = of((w) => w.kind === 'hScale' && w.from === 'assumed')
    if (ha.length) warnings.push(fmt(t.hScaleAssumedWarn, { n: ha.length, list: names(ha) }))
    const lined = route.sections.filter((x) => x.channel)
    if (lined.length) warnings.push(fmt(t.linedWarn, { n: lined.length }))
    const fd = route.stakes.filter((k) => k.stationFrom === 'distances')
    if (fd.length) warnings.push(fmt(t.stationsFromDist, { n: fd.length }) + (fd.length === route.stakes.length ? fmt(t.stationsFromZero, { sta: sta(route.stakes[0].station) }) : ''))
  }
  /** One section's notes, for its row and its preview. */
  const notes = (x: CrossSection) => [
    ...(x.warnings ?? []).map((w) =>
      w.kind === 'groundJoined' ? fmt(t.w.groundJoined, { pieces: w.pieces, gap: w.gap.toFixed(2) })
      : w.kind === 'groundShort' ? fmt(t.w.groundShort, { left: w.left.toFixed(2), right: w.right.toFixed(2) })
      : w.kind === 'noDesign' ? t.w.noDesign
      : w.kind === 'designGap' ? fmt(t.w.designGap, { gap: w.gap.toFixed(2) })
      : w.from === 'few' ? fmt(t.w.hScaleFew, { n: w.n }) : t.w.hScaleAssumed),
    ...(x.channel ? [t.w.lined] : []),
  ]
  /** The designer's split by machine / by hand, when the area box writes it. */
  const splitOf = (x: CrossSection) => {
    const d = x.drawn
    if (!d) return ''
    return ([['cut', d.cutMachine, d.cutManual], ['fill', d.fillMachine, d.fillManual]] as const)
      .filter(([, m, h]) => m !== undefined || h !== undefined)
      .map(([k, m, h]) => fmt(t.split, { what: t.cols[k], m: n2(m), h: n2(h) })).join(' · ')
  }

  const approve = () => {
    if (!route || !doc || !hasDesign) return
    const st = useCivil.getState()
    const m = buildCivilModel(st.doc, route, doc.name)
    const err = st.edit(fmt(t.undoLabel, { name: m.alignment.name }), () => m)
    if (err) return toast(fmt(t.invalid, { why: err }), 'warning')
    st.set({ station: m.sections?.[0]?.station ?? m.alignment.start, profileRange: null, view: 'profile', bottom: 'earthwork' })
    toast(fmt(t.built, { name: m.alignment.name, summary }), 'success')
    onClose()
  }

  const check = (x: CrossSection) => {
    const df = drawnFill(x)
    if (hasW(x, 'noDesign')) return t.w.noDesign
    if (x.drawn?.cut === undefined || df === undefined) return t.noDrawn
    const d = Math.max(Math.abs(x.cut - x.drawn.cut), Math.abs(x.fill - df))
    return d <= 0.02 ? t.ok : fmt(t.diff, { d: d.toFixed(2) })
  }
  const docList = Object.values(cadDocs)
  return (
    <Modal title={t.title} onClose={onClose} width={1080}>
      <div className={s.wrap} data-testid="routefromcad">
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
            <input ref={input} type="file" hidden accept=".dwg,.dxf" aria-label={t.open} data-testid="routefromcad-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void openFile(f); e.target.value = '' }} />
          </div>
          {busy && <p className={s.note}>{busy}</p>}
          {doc && (
            <>
              <div className={s.head}>
                <h4 title={t.layerHint}>{t.layers}</h4>
                <button type="button" className={s.ai} onClick={runAi} disabled={!isDesktopHost() || !layers.length} title={isDesktopHost() ? undefined : t.aiBrowser} data-testid="routefromcad-ai">
                  <Sparkles size={13} /> {t.ai}
                </button>
              </div>
              {aiMsg && <p className={s.note} role="status">{aiMsg}</p>}
              <div className={s.layers}>
                <table aria-label={t.layers}>
                  <tbody>
                    {layers.map((l) => (
                      <tr key={l.name}>
                        <td className={s.lname} title={l.name}>{l.name}</td>
                        <td className={s.kinds}>{l.lines}</td>
                        <td>
                          <select aria-label={`${t.layers}: ${l.name}`} value={roles[l.name]} onChange={(e) => setOver({ ...over, [l.name]: { role: e.target.value as CivilRole, by: 'user' } })}>
                            {(['ground', 'design', 'ignore'] as const).map((r) => <option key={r} value={r}>{t.roles[r]}</option>)}
                          </select>
                        </td>
                        <td>{byOf(l.name, l.rule) !== 'none' && <span className={`${s.by} ${s[`by_${byOf(l.name, l.rule)}`] ?? ''}`}>{t.by[byOf(l.name, l.rule)]}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {routes === null && <p className={s.note} role="status">{t.reading}</p>}
              {routes && !routes.length && <p className={s.note} role="alert">{t.noRoute}</p>}
              {routes && routes.length > 0 && (
                <label className={s.grow}>
                  <span>{t.route}</span>
                  <select aria-label={t.route} value={Math.min(ri, routes.length - 1)} onChange={(e) => { setRi(Number(e.target.value)); setSel(0) }}>
                    {routes.map((r, i) => <option key={i} value={i}>{`${r.name} · ${r.sections.length} / ${r.stakes.length}`}</option>)}
                  </select>
                </label>
              )}
              {route && (
                <div className={s.layers} style={{ maxHeight: 330 }}>
                  <table aria-label={t.route} data-testid="routefromcad-table">
                    <thead><tr><th>{t.cols.stake}</th><th>{t.cols.station}</th><th>{t.cols.cut}</th><th>{t.cols.fill}</th><th>{t.cols.drawn}</th><th>{t.cols.check}</th></tr></thead>
                    <tbody>
                      {route.sections.map((x, i) => (
                        <tr key={x.name} onClick={() => setSel(i)} style={{ cursor: 'pointer', background: i === sel ? '#e3f3f2' : undefined }}>
                          <td>{x.name}</td>
                          <td>{x.station !== null ? sta(x.station) : '—'}</td>
                          <td>{hasW(x, 'noDesign') ? '—' : n2(x.cut)}</td>
                          <td>{hasW(x, 'noDesign') ? '—' : n2(x.fill)}</td>
                          <td title={splitOf(x) || undefined}>{x.drawn ? `${n2(x.drawn.cut)} / ${n2(drawnFill(x))}` : '—'}</td>
                          <td className={s.kinds} title={[x.tableOff ? fmt(t.tableOff, { n: x.tableOff }) : '', x.map.vfit === 'profile' ? t.anchored : '', ...notes(x)].filter(Boolean).join(' · ')}>{check(x)}{x.tableOff ? ' *' : ''}{x.map.vfit !== 'table' ? ' †' : ''}{notes(x).length ? ' !' : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
        <div className={s.main}>
          <div className={s.strip}><h4>{t.preview}</h4>{sec && <b>{sec.name}</b>}</div>
          {sec && sec.station !== null ? (
            <div className={s.preview} style={{ height: 'auto' }} data-testid="routefromcad-preview">
              <DrawnSectionChart m={useCivil.getState().doc} sec={{ name: sec.name, station: sec.station, ground: sec.ground, design: sec.design, ...(sec.channel ? { channel: sec.channel } : {}), cut: sec.cut, fill: sec.fill, drawn: sec.drawn ? { cut: sec.drawn.cut, fill: drawnFill(sec) } : undefined }} w={600} h={330} />
              {(notes(sec).length > 0 || !!splitOf(sec)) && <p className={s.note} data-testid="routefromcad-secnotes">{[splitOf(sec), ...notes(sec)].filter(Boolean).join(' · ')}</p>}
            </div>
          ) : (
            <div className={s.empty}>{doc ? (routes === null ? t.reading : t.noRoute) : t.noDocs}</div>
          )}
          {route && !hasDesign && <p className={s.warn} role="alert" data-testid="routefromcad-nodesign">{t.noDesign}</p>}
          {warnings.length > 0 && <ul className={s.warn}>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
        </div>
      </div>
      <div className={s.foot}>
        <span data-testid="routefromcad-summary">{summary}{drawnSummary && <><br />{drawnSummary}</>}</span>
        <ActionButton onClick={onClose}>{t.cancel}</ActionButton>
        <ActionButton variant="primary" onClick={approve} disabled={!route || !route.sections.length || !hasDesign} title={route && !hasDesign ? t.noDesign : undefined} data-testid="routefromcad-approve">{t.approve}</ActionButton>
      </div>
    </Modal>
  )
}
