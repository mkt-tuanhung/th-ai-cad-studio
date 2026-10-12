import { useMemo, useRef, useState } from 'react'
import { CheckCircle2, Circle, FileUp, Loader2, MinusCircle, Zap } from 'lucide-react'
import { fmt, useLang, useT } from '../../i18n'
import { Modal } from '../../components/ui/Modal'
import { ActionButton } from '../../components/ui/Button'
import { toast } from '../../state/toast'
import { useCad } from '../../state/cad'
import { useCivil } from '../../state/civil'
import { useInterior } from '../../state/interior'
import { useRouter } from '../../state/router'
import { useAutoRun } from '../../state/auto'
import { getHost } from '../../services/host'
import { readDrawing } from '../../cad/batch'
import type { CadDocument } from '../../cad/types'
import { runAuto, withRoute, type AutoResult, type AutoStep } from '../../auto/pipeline'
import { makePackage, writePackage, type Written } from '../../auto/package'
import { reportHtml } from '../../auto/report'
import { cutList } from '../../interior/model'
import { nest, piecesOf } from '../../cam/nesting'
import { nestSettings } from '../interior/NestingDialog'
import { applyBim, applyInterior, buildNames } from '../bim/fromCadActions'
import s from './Auto.module.css'

type Phase = 'pick' | 'run' | 'review' | 'write' | 'done'
type StepKey = 'read' | AutoStep
const STEPS: StepKey[] = ['read', 'layers', 'ai', 'house', 'route', 'build', 'check']
const n0 = (v: number) => Math.round(v).toLocaleString('en-US')

/**
 * One command: a drawing in → the app finds what it is, builds the models (BIM, Interior, Civil route) and
 * prepares the whole package (IFC, drawings, schedules, cut list, nesting, G-code, report). One approval applies
 * the models (each an undoable edit in its workspace) and writes the package.
 */
export function AutoDialog() {
  const T = useT()
  const t = T.auto
  const lang = useLang()
  const hide = useAutoRun((st) => st.hide)
  const navigate = useRouter((st) => st.navigate)
  const cadDocs = useCad((st) => st.docs)
  const [phase, setPhase] = useState<Phase>('pick')
  const [steps, setSteps] = useState<Partial<Record<StepKey, 'run' | 'done' | 'skip'>>>({})
  const [res, setRes] = useState<AutoResult | null>(null)
  const [keep, setKeep] = useState({ house: true, interior: true, route: true, files: true })
  const [written, setWritten] = useState<Written[] | null>(null)
  const [dir, setDir] = useState<string | null>(null)
  const [progress, setProgress] = useState<[number, number] | null>(null)
  const [desktop, setDesktop] = useState(false)
  const [aiOn, setAiOn] = useState(false)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const started = useRef(0)
  const [took, setTook] = useState(0)

  const start = async (doc: CadDocument | null, f?: File) => {
    started.current = Date.now()
    setPhase('run')
    setSteps({ read: 'run' })
    try {
      const d = doc ?? (f ? (await readDrawing(f)).doc : null)
      if (!d) return setPhase('pick')
      const host = await getHost()
      setDesktop(!!host)
      // the model is loaded on first use: a model file present is enough
      const useAi = !!host && !!(await host.localAiStatus()).modelName
      setAiOn(useAi)
      const seen: StepKey[] = ['read']
      setSteps({ read: 'done' })
      const r = await runAuto(d, {
        host, useAi, names: buildNames(T.bim.fromCad), levelName: (n) => fmt(T.bim.fromCad.levelDefault, { n }), civilBase: useCivil.getState().doc,
        onStep: (st) => { seen.push(st); setSteps(Object.fromEntries(seen.map((k, i) => [k, i === seen.length - 1 ? 'run' : 'done']))) },
      })
      setSteps(Object.fromEntries(STEPS.map((k) => [k, seen.includes(k) ? 'done' : 'skip'])))
      setRes(r)
      setKeep({ house: !!r.house, interior: !!r.house?.interior, route: !!r.route, files: r.kind !== 'none' })
      setPhase('review')
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e)
      toast(why === 'no-dwg-reader' ? T.bim.fromCad.noDwgReader : fmt(T.bim.fromCad.openFailed, { name: f?.name ?? doc?.name ?? '', why }), 'warning')
      setPhase('pick')
    }
  }

  // the package and the numbers shown before approval (same code as the files written)
  const cam = useInterior((st) => st.cam)
  const camSetup = useMemo(() => ({ nest: nestSettings(cam), cnc: cam.cnc }), [cam])
  const pkgText = useMemo(() => ({ plan: (lv: string) => fmt(t.plan, { level: lv }).trim(), profile: t.profile, sections: t.sections, words: t.words, report: (b: string) => b }), [t])
  const files = useMemo(() => (res ? makePackage(res, camSetup, pkgText, keep) : []), [res, camSetup, pkgText, keep])
  const nesting = useMemo(() => (res?.house?.interior?.cabinets.length ? nest(piecesOf(res.house.interior.cabinets), camSetup.nest) : null), [res, camSetup])

  const summary = useMemo(() => {
    if (!res) return null
    const W = T.bim.fromCad, C = T.civil.fromCad
    const house: string[] = [], route: string[] = [], warnings: string[] = []
    let checks = ''
    if (res.house) {
      const c = res.house.built.counts
      house.push(fmt(t.house, { levels: c.levels, walls: c.walls, doors: c.doors, windows: c.windows, rooms: c.rooms, columns: c.columns, furniture: c.components }))
      const it = res.house.interior
      if (it) {
        const parts = it.cabinets.flatMap(cutList).reduce((a, p) => a + p.qty, 0)
        house.push(fmt(t.interior, { level: res.house.built.model.levels[res.house.interiorLevel ?? 0]?.name ?? '', rooms: it.rooms.length, items: it.items.length, cabinets: it.cabinets.length, parts, sheets: nesting?.sheets.length ?? 0, programs: files.filter((f) => / - CNC /.test(f.name)).length }))
      } else house.push(t.noInterior)
      const bad = res.house.checks.filter((k) => k.status === 'error' || k.status === 'warning')
      checks = bad.length ? fmt(t.checksBad, { n: bad.reduce((a, k) => a + k.count, 0), what: bad.map((k) => T.bim.coord.rows[k.key]).join(', ') }) : t.checksOk
      res.house.recs.forEach((r, i) => r.warnings.forEach((w) => warnings.push(`${res.house!.built.model.levels[i]?.name ?? ''}: ${fmt(W.warn[w.code], 'n' in w ? { n: w.n } : {})}`)))
      for (const k of bad) for (const x of k.items.slice(0, 3)) warnings.push(x.message)
    }
    if (res.route) {
      const v = res.route.volume
      route.push(fmt(t.route, { name: res.route.model.alignment.name, sections: res.route.chosen.sections.length, len: n0(v.length), cut: n0(v.cut), fill: n0(v.fill) }))
      if (v.drawn) route.push(fmt(t.routeDrawn, { cut: n0(v.drawn.cut), fill: n0(v.drawn.fill), dc: (((v.cut - v.drawn.cut) / Math.max(1e-9, v.drawn.cut)) * 100).toFixed(2), df: (((v.fill - v.drawn.fill) / Math.max(1e-9, v.drawn.fill)) * 100).toFixed(2) }))
      const r = res.route.chosen
      if (r.missing.length) warnings.push(fmt(C.missing, { list: r.missing.join(', ') }))
      const off = r.sections.filter((x) => x.tableOff > 0).length
      if (off) warnings.push(fmt(C.tableWarn, { n: off }))
      const anch = r.sections.filter((x) => x.map.vfit !== 'table').length
      if (anch) warnings.push(fmt(C.anchoredWarn, { n: anch }))
      if (!res.route.model.invert.some(([, z], i, a) => i && Math.abs(z - a[0][1]) > 1e-6)) warnings.push(C.noFlow)
    }
    const ai = !res.ai ? (aiOn ? t.aiNotNeeded : t.noAi) : res.ai.set.length ? fmt(t.aiDone, { n: res.ai.set.length, m: res.ai.asked, s: res.ai.seconds.toFixed(1) }) : fmt(t.aiNone, { m: res.ai.asked, s: res.ai.seconds.toFixed(1) })
    return { house, route, warnings, checks, ai }
  }, [res, t, T, files, nesting, aiOn])

  const approve = async () => {
    if (!res || !summary) return
    const label = fmt(t.undoLabel, { name: res.file })
    if (keep.house && res.house) { const e = applyBim(res.house.built.model, 'replace', label); if (e) toast(fmt(t.invalid, { what: 'BIM', why: e }), 'warning') }
    if (keep.interior && res.house?.interior) { const e = applyInterior(res.house.interior, label); if (e) toast(fmt(t.invalid, { what: T.nav.interior, why: e }), 'warning') }
    if (keep.route && res.route) {
      const st = useCivil.getState()
      const m = res.route.model
      const e = st.edit(label, () => m)
      if (e) toast(fmt(t.invalid, { what: T.nav.civil, why: e }), 'warning')
      else st.set({ station: m.sections?.[0]?.station ?? m.alignment.start, profileRange: null, view: 'profile', bottom: 'earthwork' })
    }
    toast(fmt(t.built, { name: res.file }), 'success')
    if (keep.files && files.length) {
      const host = await getHost()
      let d: string | null = null
      if (host) {
        d = (await host.pickFolder(t.pickFolder, '')) || null
        if (!d) { setTook(Date.now() - started.current); return setPhase('done') }
      }
      setPhase('write')
      const all = files.length + 1
      setProgress([0, all])
      const report = reportHtml(res, t.report, { ai: summary.ai, house: summary.house, route: summary.route, checks: summary.checks, warnings: summary.warnings, files }, lang)
      const zipName = `${res.file.replace(/\.(dwg|dxf)$/i, '')} - MD CAD AI STUDIO.zip`
      const w = await writePackage(files, report, host, d, zipName, (n) => setProgress([n, all]))
      setWritten(w)
      setDir(d)
    }
    setTook(Date.now() - started.current)
    setPhase('done')
  }

  const docList = Object.values(cadDocs)
  const go = (r: 'bim' | 'interior' | 'civil') => { hide(); navigate(r) }
  const failed = written?.filter((w) => !w.ok) ?? []
  const icon = (k: StepKey) => {
    const st = steps[k]
    return st === 'run' ? <Loader2 size={15} className={s.spin} /> : st === 'done' ? <CheckCircle2 size={15} className={s.ok} /> : st === 'skip' ? <MinusCircle size={15} className={s.skip} /> : <Circle size={15} className={s.wait} />
  }

  return (
    <Modal title={t.title} onClose={hide} width={860}>
      <div className={s.box} data-testid="auto">
        <p className={s.note}>{t.intro}</p>
        {phase === 'pick' && (
          <>
            <div
              className={`${s.drop} ${over ? s.over : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOver(true) }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) void start(null, f) }}
            >
              <FileUp size={28} strokeWidth={1.5} />
              <span>{t.drop}</span>
              <ActionButton variant="primary" onClick={() => input.current?.click()}>{t.choose}</ActionButton>
              <input ref={input} type="file" hidden accept=".dwg,.dxf" aria-label={t.choose} data-testid="auto-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void start(null, f); e.target.value = '' }} />
            </div>
            {docList.length > 0 && (
              <div className={s.open}>
                <span>{t.orOpen}</span>
                {docList.slice(0, 6).map((d) => <button key={d.id} type="button" onClick={() => void start(d)}>{t.useOpen} “{d.name}”</button>)}
              </div>
            )}
          </>
        )}
        {phase !== 'pick' && (
          <ol className={s.steps} aria-label={t.found}>
            {STEPS.map((k) => <li key={k} className={steps[k] === 'skip' ? s.dim : undefined}>{icon(k)}{t.steps[k]}</li>)}
          </ol>
        )}
        {res && summary && phase !== 'run' && (
          <>
            <h4>{t.found}: <b data-testid="auto-kind">{t.kinds[res.kind]}</b> <span className={s.file}>{res.file} · {(res.ms / 1000).toFixed(1)} s · {summary.ai}</span></h4>
            {res.kind === 'none' && <p className={s.warnBox} role="alert">{t.none}</p>}
            {summary.house.length > 0 && <div className={s.card} data-testid="auto-house"><b>{t.kinds.house}</b>{summary.house.map((l) => <div key={l}>{l}</div>)}<div className={s.small}>{fmt(t.checks, { ok: summary.checks })}</div></div>}
            {summary.route.length > 0 && (
              <div className={s.card} data-testid="auto-route">
                <b>{t.kinds.route}</b>
                {res.route && res.route.routes.length > 1 && (
                  <label className={s.pick}>
                    {t.routePick}
                    <select aria-label={t.routePick} value={res.route.routes.indexOf(res.route.chosen)} onChange={(e) => setRes(withRoute(res, Number(e.target.value), useCivil.getState().doc))}>
                      {res.route.routes.map((r, i) => <option key={i} value={i}>{`${r.name} · ${r.sections.length}`}</option>)}
                    </select>
                  </label>
                )}
                {summary.route.map((l) => <div key={l}>{l}</div>)}
              </div>
            )}
            {phase === 'review' && res.kind !== 'none' && (
              <div className={s.keep}>
                <b>{t.parts}</b>
                {res.house && <label><input type="checkbox" checked={keep.house} onChange={(e) => setKeep({ ...keep, house: e.target.checked })} />{t.part.house}</label>}
                {res.house?.interior && <label><input type="checkbox" checked={keep.interior} onChange={(e) => setKeep({ ...keep, interior: e.target.checked })} />{t.part.interior}</label>}
                {res.route && <label><input type="checkbox" checked={keep.route} onChange={(e) => setKeep({ ...keep, route: e.target.checked })} />{t.part.route}</label>}
                <label><input type="checkbox" checked={keep.files} onChange={(e) => setKeep({ ...keep, files: e.target.checked })} data-testid="auto-keep-files" />{t.part.files} — <span data-testid="auto-files">{fmt(desktop ? t.files : t.filesBrowser, { n: files.length + 1 })}</span></label>
              </div>
            )}
            {summary.warnings.length > 0 && phase === 'review' && (
              <details className={s.warnBox}>
                <summary>{t.warnings} ({summary.warnings.length})</summary>
                <ul>{summary.warnings.slice(0, 12).map((w, i) => <li key={i}>{w}</li>)}</ul>
                {summary.warnings.length > 12 && <div>{fmt(t.more, { n: summary.warnings.length - 12 })}</div>}
              </details>
            )}
            {phase === 'write' && progress && <p className={s.note} role="status">{fmt(t.writing, { n: progress[0], m: progress[1] })}</p>}
            {phase === 'done' && (
              <div className={s.card} data-testid="auto-done">
                <b>{fmt(t.done, { s: (took / 1000).toFixed(1) })}</b>
                {written && (dir ? <div>{fmt(t.doneFiles, { ok: written.filter((w) => w.ok).length, dir })}</div> : <div>{fmt(t.doneZip, { name: written[0]?.name ?? '' })}</div>)}
                {failed.length > 0 && dir && <div className={s.bad}>{fmt(t.failedFiles, { n: failed.length, list: failed.map((f) => `${f.name} (${f.error})`).join(', ') })}</div>}
                <div className={s.go}>
                  {res.house && keep.house && <ActionButton onClick={() => go('bim')}>{t.openBim}</ActionButton>}
                  {res.house?.interior && keep.interior && <ActionButton onClick={() => go('interior')}>{t.openInterior}</ActionButton>}
                  {res.route && keep.route && <ActionButton onClick={() => go('civil')}>{t.openCivil}</ActionButton>}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <div className={s.foot}>
        <ActionButton onClick={hide}>{phase === 'done' ? t.close : t.cancel}</ActionButton>
        {phase === 'review' && res && res.kind !== 'none' && (
          <ActionButton variant="primary" onClick={() => void approve()} data-testid="auto-approve"><Zap size={15} /> {t.approve}</ActionButton>
        )}
      </div>
    </Modal>
  )
}
