import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Check, Eye, ImagePlus, Loader2, Sparkles, X } from 'lucide-react'
import { fmt, getMessages, useT } from '../../i18n'
import { toast } from '../../state/toast'
import { useSettings } from '../../state/settings'
import { useInterior, type InteriorDoc, type StyleStep } from '../../state/interior'
import { useRenders } from '../../state/renders'
import { useBim } from '../../state/bim'
import { getHost, useHost, type HostApi } from '../../services/host'
import { loadRefImages, readStyle, type VisionStatus } from '../../services/vision'
import { ensureLibrary } from '../../library/assetService'
import { useAssetLibrary } from '../../library/assets'
import { MATERIALS } from '../../interior/model'
import { FINISHES, finishById, finishesFor, libIdOf, STYLE_DEFAULTS, STYLE_KEYS, SURFACES, validateAnalysis, type FurnCat, type StyleAnalysis, type StyleKey, type Surface } from '../../interior/styleRef'
import { PALETTE_ROLES, type PaletteRole } from '../../interior/palette'
import { boardFor, DEFAULT_APPLY, lightingPreset, planStyle, type StyleApplyOptions, type StyleOption, type StylePlan } from '../../interior/styleApply'
import { appFinish } from '../../interior/styleRef'
import { addAutoCameras } from '../../renders/autoCameras'
import { styleViews } from '../../interior/styleViews'
import type { Camera } from '../../renders/model'
import { LIGHTING_PATCH } from '../../renders/provenance'
import { startJob } from '../../renders/runner'
import { Modal } from '../../components/ui/Modal'
import { rulesOf } from './spaceKit'
import s from './Interior.module.css'
import st from './StyleFromPhoto.module.css'

/* ------------------------------------------------------------------ reading (shared by the panel, the plan drop and QA) */

const msgs = () => getMessages(useSettings.getState().language)

/** Reads 1–5 photos for a room: palette by code, style by the local model (or the basic analysis). */
export async function startStyleReading(files: File[], roomId: string): Promise<void> {
  const t = msgs().styleRef.panel
  const { images, pixels, rejected, dropped } = await loadRefImages(files)
  rejected.forEach((n) => toast(fmt(t.notImage, { name: n }), 'warning'))
  if (dropped) toast(t.tooMany, 'warning')
  if (!images.length) return
  const host = await getHost()
  const withModel = host ? !!(await host.visionStatus().catch(() => null))?.available : false
  const started = Date.now()
  useInterior.getState().set({ styleRef: { room: roomId, images, status: 'reading', withModel, started }, room: roomId, right: 'ai' })
  try {
    const r = await readStyle(host, images, pixels)
    const cur = useInterior.getState().styleRef
    if (!cur || cur.started !== started) return // replaced by a newer reading
    useInterior.getState().set({ styleRef: { ...cur, status: 'done', analysis: r.analysis, raw: r.raw, modelError: r.modelError, device: r.device } })
    if (r.modelError) toast(fmt(t.modelFailed, { why: r.modelError }), 'warning')
  } catch (e) {
    const cur = useInterior.getState().styleRef
    if (cur && cur.started === started) useInterior.getState().set({ styleRef: { ...cur, status: 'error', error: String(e) } })
    toast(fmt(t.failed, { why: String(e) }), 'warning')
  }
}

/** Image files of a drag (photos dropped from Finder / a browser). */
export const imageFilesOf = (e: DragEvent) => [...(e.dataTransfer?.files ?? [])].filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name))
export const dragHasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files')

/** Is the photo-reading model installed (desktop)? null while unknown / in a browser. */
export function useVisionStatus(): VisionStatus | null {
  const host = useHost()
  const [v, setV] = useState<VisionStatus | null>(null)
  useEffect(() => {
    if (host) void host.visionStatus().then(setV).catch(() => setV(null))
  }, [host])
  return v
}

/* ------------------------------------------------------------------ the AI panel block (replaces the DEMO cards) */

/**
 * Interior → AI → Suggestions: the real "style from photos" block, in the box of the DEMO suggestion cards (same
 * header, two cards and strip — no layout change).
 */
export function StylePanel({ vision }: { vision: VisionStatus | null }) {
  const T = useT()
  const t = T.styleRef
  const p = t.panel
  const { styleRef, room, doc, set } = useInterior()
  const input = useRef<HTMLInputElement>(null)
  const rn = (n: string) => T.interior.roomNames[n] ?? n
  const mn = (m: string | null) => (m ? T.interior.matNames[m] ?? m : '—')
  const roomName = rn(doc.rooms.find((r) => r.id === (styleRef?.room ?? room))?.name ?? room)
  const a = styleRef?.analysis
  const pick = (
    <input ref={input} type="file" accept="image/*" multiple hidden data-testid="style-ref-input" onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) void startStyleReading(f, room) }} />
  )
  return (
    <>
      <header>
        <Sparkles size={16} strokeWidth={1.6} />
        <b className={st.title}>{p.title}</b>
        {a && <em className={a.source === 'model' ? st.srcAi : st.srcBasic} title={a.source === 'model' ? p.model : p.basic} data-testid="style-source">{a.source === 'model' ? 'AI' : p.basicShort}</em>}
        {a ? (
          <button type="button" className={st.link} onClick={() => set({ styleDlg: 'analysis' })} data-testid="style-review">{p.review}</button>
        ) : (
          <button type="button" className={st.link} onClick={() => input.current?.click()}>{p.pick}</button>
        )}
      </header>
      {pick}
      {!styleRef && (
        <div className={st.drop} data-testid="style-drop">
          <ImagePlus size={26} strokeWidth={1.4} />
          <span>{p.drop}</span>
          <button type="button" onClick={() => input.current?.click()} data-testid="style-pick">{p.pick}</button>
          <small>{vision?.available ? `${p.model}: ${vision.model.replace(/\.gguf$/i, '')}` : p.noModelHint}</small>
        </div>
      )}
      {styleRef && (
        <>
          <figure className={`${s.suggCard} ${st.card}`} data-testid="style-card">
            <img src={styleRef.images[0].url} alt={styleRef.images[0].name} draggable={false} />
            {styleRef.images.length > 1 && <span className={st.more}>+{styleRef.images.length - 1}</span>}
            <figcaption>
              {styleRef.status === 'reading' ? (
                <><Loader2 size={11} className={st.spin} /> {styleRef.withModel ? p.reading : p.readingBasic}</>
              ) : a ? (
                <>{t.styles[a.style]} · {fmt(p.confidence, { pct: Math.round(a.confidence * 100) })}</>
              ) : (
                styleRef.error ?? '—'
              )}
            </figcaption>
            {a && <button type="button" onClick={() => set({ styleDlg: 'options' })} data-testid="style-apply">{T.interior.aiPanel.apply}</button>}
          </figure>
          <figure className={`${s.suggCard} ${st.card}`}>
            <div className={st.stripes}>
              {(a?.palette ?? []).map((c, k) => <i key={k} style={{ background: c.hex, flexGrow: Math.max(0.05, c.share) }} title={`${c.hex} · ${t.roles[c.role]}`} />)}
            </div>
            <figcaption className={st.matCap}>
              {a ? `${t.surfaces.floor}: ${mn(appFinish(a, 'floor'))} · ${t.surfaces.walls}: ${mn(appFinish(a, 'walls'))}` : fmt(p.forRoom, { room: roomName })}
            </figcaption>
            {a && <button type="button" onClick={() => set({ styleDlg: 'analysis' })}>{p.review}</button>}
          </figure>
          <div className={st.strip}>
            <button type="button" onClick={() => input.current?.click()} title={p.more}><ImagePlus size={11} /> {p.more}</button>
            <span>{a?.ms ? fmt(p.took, { secs: (a.ms / 1000).toFixed(1) }) : ''}</span>
            <button type="button" onClick={() => set({ styleRef: null })} title={p.clear}><X size={11} /> {p.clear}</button>
          </div>
        </>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ the dialog */

/** Review / edit the analysis → options (apply = one undo step) → render beside the reference. */
export function StyleDialog() {
  const T = useT()
  const t = T.styleRef
  const d = t.dialog
  const { styleRef, styleDlg, set } = useInterior()
  const host = useHost()
  if (!styleRef || !styleDlg) return null
  const step = styleDlg
  const go = (k: StyleStep) => set({ styleDlg: k })
  return (
    <Modal title={d.title} onClose={() => set({ styleDlg: null })} width={1040}>
      <div className={st.dlg} data-testid="style-dialog">
        <nav className={st.steps} role="tablist">
          {(['analysis', 'options', 'render'] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={step === k} className={step === k ? st.on : undefined} onClick={() => go(k)} data-testid={`style-step-${k}`} disabled={k !== 'analysis' && !styleRef.analysis}>
              {d.steps[k]}
            </button>
          ))}
        </nav>
        <div className={st.cols}>
          <aside className={st.refs}>
            {styleRef.images.map((im) => <img key={im.name + im.w} src={im.url} alt={im.name} title={im.name} />)}
            {styleRef.analysis && (
              <small>
                {d.source}: {styleRef.analysis.source === 'model' ? `${t.panel.model} — ${styleRef.analysis.model ?? ''}${styleRef.device ? ` · ${styleRef.device}` : ''}` : t.panel.basic}
                {styleRef.analysis.ms ? ` · ${fmt(t.panel.took, { secs: (styleRef.analysis.ms / 1000).toFixed(1) })}` : ''}
              </small>
            )}
          </aside>
          <section className={st.main}>
            {step === 'analysis' && <AnalysisStep />}
            {step === 'options' && <OptionsStep host={host} />}
            {step === 'render' && <RenderStep host={host} />}
          </section>
        </div>
      </div>
    </Modal>
  )
}

function AnalysisStep() {
  const T = useT()
  const t = T.styleRef
  const d = t.dialog
  const { styleRef, doc, set } = useInterior()
  const a = styleRef!.analysis
  const mn = (m: string) => T.interior.matNames[m] ?? m
  const [showJson, setShowJson] = useState(false)
  if (!a) return <p className={st.note}>{styleRef!.status === 'reading' ? (styleRef!.withModel ? t.panel.reading : t.panel.readingBasic) : styleRef!.error}</p>
  const up = (patch: Partial<StyleAnalysis>) => {
    const v = validateAnalysis({ ...a, ...patch })
    if (v.ok) set({ styleRef: { ...styleRef!, analysis: v.value } })
  }
  const allCats = [...new Set([...a.furniture.map((f) => f.category), ...STYLE_DEFAULTS[a.style].furniture])] as FurnCat[]
  return (
    <div className={st.form}>
      <div className={st.row}>
        <label>{d.room}</label>
        <select value={styleRef!.room} onChange={(e) => set({ styleRef: { ...styleRef!, room: e.target.value }, room: e.target.value })} data-testid="style-room">
          {doc.rooms.map((r) => <option key={r.id} value={r.id}>{T.interior.roomNames[r.name] ?? r.name}</option>)}
        </select>
      </div>
      <div className={st.row}>
        <label>{d.style}</label>
        <select value={a.style} onChange={(e) => up({ style: e.target.value as StyleKey })} data-testid="style-style">
          {STYLE_KEYS.map((k) => <option key={k} value={k}>{t.styles[k]}</option>)}
        </select>
        <span className={st.muted}>{fmt(t.panel.confidence, { pct: Math.round(a.confidence * 100) })}</span>
        <button type="button" className={st.link} onClick={() => up({ materials: { ...STYLE_DEFAULTS[a.style].materials } })}>{d.defaults}</button>
      </div>
      <h4>{d.palette}</h4>
      <div className={st.palette}>
        {a.palette.map((c, k) => (
          <span key={k} className={st.sw}>
            <input type="color" value={c.hex} aria-label={`${d.palette} ${k + 1}`} onChange={(e) => up({ palette: a.palette.map((x, j) => (j === k ? { ...x, hex: e.target.value } : x)) })} />
            <select value={c.role} onChange={(e) => up({ palette: a.palette.map((x, j) => (j === k ? { ...x, role: e.target.value as PaletteRole } : x)) })}>
              {PALETTE_ROLES.map((r) => <option key={r} value={r}>{t.roles[r]}</option>)}
            </select>
            <small>{Math.round(c.share * 100)}%</small>
          </span>
        ))}
      </div>
      <h4>{d.materials}</h4>
      <div className={st.mats}>
        {SURFACES.map((sf) => {
          const f = finishById(a.materials[sf])
          const lib = f ? libIdOf(f, sf) : null
          const color = MATERIALS.find((m) => m.name === f?.app)?.color
          return (
            <div key={sf} className={st.matRow} data-surface={sf}>
              <label>{t.surfaces[sf]}</label>
              <i style={{ background: color ?? 'transparent' }} />
              <select value={a.materials[sf] ?? ''} onChange={(e) => up({ materials: { ...a.materials, [sf]: e.target.value || null } as Record<Surface, string | null> })} data-testid={`style-mat-${sf}`}>
                {sf === 'stone' && <option value="">{t.none}</option>}
                {finishesFor(sf).map((x) => <option key={x.id} value={x.id}>{mn(x.app)}</option>)}
              </select>
              <small>{f ? (lib ? fmt(d.texture, { id: lib }) : d.plain) : ''}</small>
            </div>
          )
        })}
      </div>
      <h4>{d.furniture}</h4>
      <div className={st.chips}>
        {allCats.map((c) => {
          const on = a.furniture.some((f) => f.category === c)
          const hint = a.furniture.find((f) => f.category === c)?.hint
          return (
            <label key={c} className={on ? st.chipOn : undefined} title={hint}>
              <input type="checkbox" checked={on} data-cat={c} onChange={() => {
                const ex = styleRef!.excluded ?? []
                const v = validateAnalysis({ ...a, furniture: on ? a.furniture.filter((f) => f.category !== c) : [...a.furniture, { category: c, hint: '' }] })
                if (v.ok) set({ styleRef: { ...styleRef!, analysis: v.value, excluded: on ? [...new Set([...ex, c])] : ex.filter((x) => x !== c) } })
              }} />
              {T.assetLib.cats[c] ?? c}
              {hint ? <em> — {hint}</em> : null}
            </label>
          )
        })}
      </div>
      <div className={st.row}>
        <label>{d.lighting}</label>
        <select value={a.lighting.tone} onChange={(e) => up({ lighting: { ...a.lighting, tone: e.target.value as 'warm' } })}>
          {(['warm', 'neutral'] as const).map((k) => <option key={k} value={k}>{t.tone[k]}</option>)}
        </select>
        <select value={a.lighting.time} onChange={(e) => up({ lighting: { ...a.lighting, time: e.target.value as 'day' } })}>
          {(['day', 'evening'] as const).map((k) => <option key={k} value={k}>{t.time[k]}</option>)}
        </select>
      </div>
      <h4>{d.description}</h4>
      <textarea className={st.desc} value={a.description} onChange={(e) => set({ styleRef: { ...styleRef!, analysis: { ...a, description: e.target.value.slice(0, 400) } } })} />
      <button type="button" className={st.link} onClick={() => setShowJson((v) => !v)}>{d.json}</button>
      {showJson && <pre className={st.json} data-testid="style-json">{JSON.stringify(a, null, 1)}</pre>}
      <footer className={st.foot}>
        <button type="button" className={st.primary} onClick={() => set({ styleDlg: 'options' })} data-testid="style-to-options">{d.steps.options} →</button>
      </footer>
    </div>
  )
}

/** Options are computed for a snapshot of the design; applying a stale one is refused. */
let lastPlan: { doc: InteriorDoc; room: string; analysis: StyleAnalysis; opts: StyleApplyOptions; plan: StylePlan } | null = null

function OptionsStep({ host }: { host: HostApi | null }) {
  const T = useT()
  const t = T.styleRef
  const d = t.dialog
  const { styleRef, doc, preview, set, edit } = useInterior()
  const assets = useAssetLibrary((x) => x.assets)
  const bim = useBim((x) => x.model)
  const a = styleRef!.analysis!
  const roomId = styleRef!.room
  const r = doc.rooms.find((x) => x.id === roomId)
  const rn = (n: string) => T.interior.roomNames[n] ?? n
  const mn = (m: string) => T.interior.matNames[m] ?? m
  // only what the user switched off is left out: the photo's list is a wish list (rug, plant…), not the whole room
  const [opts, setOpts] = useState<StyleApplyOptions>(() => ({ ...DEFAULT_APPLY, exclude: styleRef!.excluded ?? [] }))
  const [plan, setPlan] = useState<StylePlan | null>(() => (lastPlan && lastPlan.room === roomId && lastPlan.analysis === a ? lastPlan.plan : null))
  useEffect(() => {
    if (host) void ensureLibrary(host)
  }, [host])
  const stale = !!plan && (!lastPlan || lastPlan.doc !== doc || lastPlan.analysis !== a)
  const make = () => {
    const p = planStyle(doc, roomId, a, assets, opts, { rules: rulesOf(doc), bim })
    lastPlan = { doc, room: roomId, analysis: a, opts, plan: p }
    setPlan(p)
    set({ preview: null })
  }
  const label = (o: StyleOption) => (o.kind === 'restyle' ? d.optK : fmt(d.optLayout, { id: o.id, template: T.interior.space.layouts.templates[o.template as keyof typeof T.interior.space.layouts.templates] ?? o.template ?? '' }))
  const apply = (o: StyleOption) => {
    if (stale) return toast(d.stale, 'warning')
    const full = `${t.styles[a.style]} — ${label(o)}`
    const err = edit(full, () => o.doc)
    if (err) return toast(fmt(T.interior.toast.invalid, { why: err }), 'warning')
    set({ preview: null, styleDlg: 'render' })
    lastPlan = null
    setPlan(null)
    toast(fmt(d.applied, { label: full, room: rn(r?.name ?? roomId) }), 'success')
  }
  const joinery = appFinish(a, 'joinery')
  return (
    <div className={st.form}>
      <label className={st.check}><input type="checkbox" checked={opts.finishes} onChange={(e) => setOpts({ ...opts, finishes: e.target.checked })} />{d.optFinishes}</label>
      <label className={st.check}><input type="checkbox" checked={opts.furnish} onChange={(e) => setOpts({ ...opts, furnish: e.target.checked })} data-testid="style-opt-furnish" />{d.optFurnish}</label>
      <label className={st.check}><input type="checkbox" checked={opts.cabinetBoards} onChange={(e) => setOpts({ ...opts, cabinetBoards: e.target.checked })} data-testid="style-opt-boards" />{d.optBoards}</label>
      {opts.cabinetBoards && !boardFor(joinery) && <small className={st.warn}>{fmt(d.noBoard, { finish: mn(joinery ?? '—') })}</small>}
      <div className={st.row}>
        <button type="button" className={st.primary} onClick={make} data-testid="style-make">{plan ? d.remake : d.make}</button>
        <small className={st.muted}>{d.nothingYet}</small>
      </div>
      {stale && <p className={st.warn}>{d.stale}</p>}
      {plan?.status === 'needs-input' && <p className={st.warn} data-testid="style-needs">{fmt(d.needs, { what: plan.missing.map((m) => d.missing[m] ?? m).join(', ') })}</p>}
      {plan?.notes.includes('no-layout') && <p className={st.warn}>{d.noLayout}</p>}
      {plan && plan.notes.filter((n) => n.startsWith('rejected-')).length > 0 && <p className={st.muted}>{fmt(d.rejected, { n: plan.notes.filter((n) => n.startsWith('rejected-')).length })}</p>}
      {plan && (
        <div className={st.options} data-testid="style-options">
          {plan.options.map((o) => {
            const on = preview?.label === `style:${o.id}`
            const fin = [o.finishes.floor && `${t.surfaces.floor} ${mn(o.finishes.floor)}`, o.finishes.wall && `${t.surfaces.walls} ${mn(o.finishes.wall)}`, o.finishes.ceiling && `${t.surfaces.ceiling} ${mn(o.finishes.ceiling)}`].filter(Boolean)
            return (
              <article key={o.id} className={on ? st.optOn : undefined} data-option={o.id}>
                <header>
                  <b>{label(o)}</b>
                  {o.score && <span>{fmt(d.score, { v: o.score.total })}</span>}
                </header>
                {fin.length > 0 && <p>{fmt(d.finishes, { list: fin.join(' · ') })}</p>}
                {o.kind === 'layout' && <p>{fmt(d.added, { n: o.added.length, r: o.removed })}: {o.added.map((i) => `${i.name} ${i.w}×${i.d}×${i.h}`).join(' · ')}</p>}
                <p>{o.models.length ? fmt(d.models, { list: o.models.map((m) => `${m.name} → ${m.assetName}`).join(' · ') }) : d.noModels}</p>
                {o.boards.length > 0 && <p className={st.warn}>{fmt(d.boards, { board: o.boards[0].board, names: o.boards.map((b) => b.name).join(', ') })}</p>}
                {o.doors.length > 0 && <p>{fmt(d.doorsBim, { list: o.doors.map((x) => `${x.width} mm`).join(', ') })}</p>}
                <p className={o.checks.ok ? st.ok : st.warn} data-testid={`style-checks-${o.id}`}>
                  {!o.checks.ok ? fmt(d.failedChecks, { list: o.checks.issues.slice(0, 4).join(', ') }) : o.checks.doorClear < 800 ? fmt(d.checksKept, { d: `${o.checks.doorClear} mm` }) : fmt(d.checks, { d: Number.isFinite(o.checks.doorClear) ? `${o.checks.doorClear >= 2000 ? '≥ 2000' : o.checks.doorClear} mm` : d.noDoor })}
                </p>
                <footer>
                  <button type="button" onClick={() => set({ preview: on ? null : { label: `style:${o.id}`, doc: o.doc }, plan: useInterior.getState().plan ?? 'floor' })} aria-pressed={on}><Eye size={12} /> {d.preview}</button>
                  <button type="button" className={st.primary} disabled={stale || !o.checks.ok} onClick={() => apply(o)} data-testid={`style-apply-${o.id}`}><Check size={12} /> {d.apply}</button>
                </footer>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ render beside the reference */

/** Starts the given render jobs one at a time (waits while another render runs), each when the previous ended. */
async function renderInOrder(host: HostApi, ids: string[], onError: (id: string, why: string) => void) {
  const ended = (id: string) => ['done', 'failed', 'cancelled'].includes(useRenders.getState().runs[id]?.status ?? '')
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  for (const id of ids) {
    if (ended(id)) continue
    for (let tries = 0; ; tries++) {
      const err = await startJob(host, id)
      if (!err) break
      if (err !== 'busy' || tries > 3600) {
        onError(id, err)
        break
      }
      await wait(1000)
      if (ended(id)) break // the runner's own queue order reached it
    }
    while (!ended(id)) await wait(1000)
  }
}

interface RenderRow {
  id: string
  cam: string
}

function RenderStep({ host }: { host: HostApi | null }) {
  const T = useT()
  const t = T.styleRef
  const d = t.dialog
  const { styleRef, doc } = useInterior()
  const runs = useRenders((x) => x.runs)
  const a = styleRef!.analysis!
  const roomId = styleRef!.room
  const roomName = doc.rooms.find((r) => r.id === roomId)?.name ?? roomId
  const [n, setN] = useState(1)
  const [preset, setPreset] = useState<'day' | 'golden' | 'night'>(lightingPreset(a))
  // the renders of this session live in the store (the dialog may be closed / reopened while Blender works)
  const rows: RenderRow[] = styleRef!.renders ?? []
  const setRows = (r: RenderRow[]) => { const s = useInterior.getState(); if (s.styleRef) s.set({ styleRef: { ...s.styleRef, renders: r } }) }
  const [imgs, setImgs] = useState<Record<string, string>>({})
  const [ref, setRef] = useState(0)
  const go = async () => {
    if (!host) return
    const A = T.assetLib.render
    const rname = T.interior.roomNames[roomName] ?? roomName
    const cur = useInterior.getState().doc
    // views that show what a reference photo shows (the main piece from its front); the Interior auto views otherwise
    const sv = styleViews(cur, roomId, n)
    const R = useRenders.getState()
    let cameras: Camera[]
    if (sv.length) {
      cameras = sv.map((v, k) => ({ id: `cam-style-${roomId}-${k + 1}`, name: fmt(d.camName, { n: k + 1, room: rname }), kind: 'Interior - Bookmark', aspect: '16:9', w: 1920, h: 1080, thumb: '/assets/v2/renders/cam3.png', view: { scene: 'interior', eye: v.eye, at: v.at, up: v.up, fov: v.fov, level: true, shift: v.shift, lensEq: v.lensEq, room: roomId } }))
      const ids = new Set(cameras.map((c) => c.id))
      R.edit(`${d.render} — ${rname}`, (dd) => ({ ...dd, cameras: [...dd.cameras.filter((c) => !ids.has(c.id) && !c.id.startsWith(`cam-style-${roomId}-`)), ...cameras] }))
    } else {
      const all = addAutoCameras(cur, roomId, (k) => fmt(A.view, { n: k, room: rname }), n).cameras
      // a small room may give the same spot twice: one render per distinct eye
      const eye = (c: Camera) => (c.view as { eye: number[] }).eye
      cameras = all.filter((c, k) => !all.slice(0, k).some((p) => Math.hypot(eye(p)[0] - eye(c)[0], eye(p)[1] - eye(c)[1]) < 1000))
    }
    if (!cameras.length) return toast(d.noViews, 'warning')
    const settings = { ...R.doc.settings, ...LIGHTING_PATCH[preset], engine: 'Blender Cycles (local)' as const, samples: 128, denoise: true, format: 'png' as const }
    const now = Date.now()
    const jobs = cameras.map((c, k) => ({ id: `style-${now.toString(36)}-${k}`, cameraId: c.id, camera: c.name, settings: '1600 × 900', output: 'PNG', status: 'waiting' as const, created: now, cfg: { settings, fx: R.doc.fx }, special: { w: 1600, h: 900, samples: 128 } }))
    R.edit(`${d.render} — ${roomName}`, (dd) => ({ ...dd, queue: [...dd.queue, ...jobs] }))
    setRows(jobs.map((j) => ({ id: j.id, cam: j.camera })))
    toast(fmt(d.queued, { n: jobs.length, preset: d.presets[preset] }), 'success')
    // one after the other (each job's scene captured when queued, presentation-only provenance), ahead of older
    // waiting jobs of the Renders queue; keeps going when the dialog is closed
    void renderInOrder(host, jobs.map((j) => j.id), (id, why) => toast(fmt(d.renderFailed, { cam: jobs.find((j) => j.id === id)?.camera ?? id, why }), 'warning'))
  }
  // finished renders → images beside the reference
  useEffect(() => {
    if (!host) return
    for (const r of rows) {
      const run = runs[r.id]
      if (run?.status === 'done' && run.path && !imgs[r.id]) void host.renderReadImage(run.path, 1280).then((x) => x.ok && x.url && setImgs((m) => ({ ...m, [r.id]: x.url! })))
    }
  }, [runs, rows, host, imgs])
  const [pick, setPick] = useState<string | null>(null)
  const shown = useMemo(() => rows.find((r) => r.id === pick && imgs[r.id]) ?? rows.find((r) => imgs[r.id]), [rows, imgs, pick])
  if (!host) return <p className={st.note}>{d.renderNeedsHost}</p>
  return (
    <div className={st.form}>
      <div className={st.row}>
        <label>{d.views}</label>
        <select value={n} onChange={(e) => setN(Number(e.target.value))}>{[1, 2, 3].map((k) => <option key={k} value={k}>{k}</option>)}</select>
        <label>{d.lighting}</label>
        <select value={preset} onChange={(e) => setPreset(e.target.value as 'day')} data-testid="style-preset">{(['day', 'golden', 'night'] as const).map((k) => <option key={k} value={k}>{d.presets[k]}</option>)}</select>
        <button type="button" className={st.primary} onClick={() => void go()} data-testid="style-render">{d.render}</button>
      </div>
      <small className={st.muted}>{d.presentation}</small>
      <ul className={st.jobs}>
        {rows.map((r) => {
          const run = runs[r.id]
          const pct = run?.total ? Math.round(((run.samples ?? 0) / run.total) * 100) : 0
          return (
            <li key={r.id} data-job={r.id} data-status={run?.status ?? 'waiting'}>
              {run?.status === 'done' ? fmt(d.renderDone, { cam: r.cam, secs: ((run.ms ?? 0) / 1000).toFixed(0), engine: run.engine ?? '' }) : run?.status === 'failed' || run?.status === 'cancelled' ? fmt(d.renderFailed, { cam: r.cam, why: run.error ?? run.status }) : fmt(d.rendering, { cam: r.cam, pct })}
            </li>
          )
        })}
      </ul>
      <div className={st.compare} data-testid="style-compare">
        <figure>
          <img src={styleRef!.images[ref]?.url} alt={d.reference} onClick={() => setRef((ref + 1) % styleRef!.images.length)} />
          <figcaption>{d.reference}{styleRef!.images.length > 1 ? ` ${ref + 1}/${styleRef!.images.length}` : ''}</figcaption>
        </figure>
        <figure>
          {shown ? <img src={imgs[shown.id]} alt={d.result} data-testid="style-render-img" /> : <div className={st.placeholder}>{rows.length ? <Loader2 size={18} className={st.spin} /> : d.render}</div>}
          <figcaption>{d.result}{shown ? ` — ${shown.cam}` : ''}</figcaption>
        </figure>
      </div>
      {rows.length > 1 && (
        <div className={st.thumbs}>
          {rows.filter((r) => imgs[r.id]).map((r) => <img key={r.id} src={imgs[r.id]} alt={r.cam} title={r.cam} className={shown?.id === r.id ? st.thumbOn : undefined} onClick={() => setPick(r.id)} />)}
        </div>
      )}
    </div>
  )
}

/** Finish vocabulary size (for the docs / QA). */
export const FINISH_COUNT = FINISHES.length
