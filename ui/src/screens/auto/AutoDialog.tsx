import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Circle, FileUp, Loader2, MinusCircle, RotateCcw, Zap } from 'lucide-react'
import { fmt, useLang, useT } from '../../i18n'
import { Modal } from '../../components/ui/Modal'
import { ActionButton } from '../../components/ui/Button'
import { toast } from '../../state/toast'
import { useCad } from '../../state/cad'
import { useCivil } from '../../state/civil'
import { useInterior } from '../../state/interior'
import { useRouter } from '../../state/router'
import { useAutoRun } from '../../state/auto'
import { getHost, type HostApi } from '../../services/host'
import { readDrawing, type DrawingUnits } from '../../cad/batch'
import type { CadDocument } from '../../cad/types'
import { runAuto, withRoute, type AutoResult, type AutoStep } from '../../auto/pipeline'
import { allCabinets, cncPreview, earthSplit, makePackage, writePackage, type OutFile, type PackageInclude, type Written } from '../../auto/package'
import { useMachines } from '../../state/machines'
import { houseViews } from '../../auto/views'
import { reportHtml } from '../../auto/report'
import { latestBackups, restoreBackup, type BackupStore } from '../../auto/backup'
import { cutList } from '../../interior/model'
import { boq, priceOf, readPriceList, type PriceList } from '../../bim/quantities'
import { roofQuantities } from '../../bim/roof'
import { nestSettings } from '../interior/NestingDialog'
import { applyBim, applyCivil, applyInterior, applyMep, buildNames, checkBim, checkCivil, checkInterior, checkMep, type Applied } from '../bim/fromCadActions'
import { useAiStudio } from '../../state/aiStudio'
import { beginApply, createJob, finishStep, isApplied, markApplied, readyForReview, restartCompute, startStep, stepFailed, type AiJob } from '../../ai/jobs'
import { fabricationAllowed } from '../../cad/provenance'
import { isPlanPicture } from '../../planimage/pipeline'
import { PlanImageReview, type PlanBuilt } from './PlanImageReview'
import s from './Auto.module.css'

type Phase = 'pick' | 'image' | 'run' | 'review' | 'write' | 'done' | 'error'
type StepKey = 'read' | AutoStep | 'views'
type Part = 'house' | 'interior' | 'route' | 'mep'
const PARTS: Part[] = ['house', 'interior', 'route', 'mep']
const STORE_OF: Record<Part, BackupStore> = { house: 'bim', interior: 'interior', route: 'civil', mep: 'mep' }
const STEPS: StepKey[] = ['read', 'layers', 'ai', 'house', 'route', 'build', 'structure', 'check', 'views']
/** The job steps of one command (v2.4 AI job queue): the compute steps above, the approval, one apply step each. */
export const AUTO_STEPS: readonly string[] = STEPS
const APPLY = ['apply-bim', 'apply-interior', 'apply-route', 'apply-mep', 'write-files'] as const
const APPLY_OF: Record<Part, (typeof APPLY)[number]> = { house: 'apply-bim', interior: 'apply-interior', route: 'apply-route', mep: 'apply-mep' }
const jobSteps = () => [...STEPS.map((id) => ({ id, kind: 'compute' as const })), { id: 'approve', kind: 'user' as const }, ...APPLY.map((id) => ({ id, kind: 'apply' as const }))]
const n0 = (v: number) => Math.round(v).toLocaleString('en-US')
const why = (e: unknown) => (e instanceof Error ? e.message : String(e))

interface Outcome { applied: Part[]; rejected: { part: Part; why: string }[]; backupFailed: Part[]; noFolder: boolean }
interface WriteJob { files: OutFile[]; report: string; host: HostApi | null; dir: string | null; zipName: string }

/**
 * One command: drawings in → the app finds what each is, builds the models (BIM, Interior, Civil route, MEP) and
 * prepares the whole package (IFC, drawings, schedules, cut list, nesting, G-code, report). The model rules run in
 * the review (what they would reject is said there); one approval applies the accepted models (each an undoable edit
 * in its workspace, the replaced one backed up first) and writes the package of the parts applied.
 */
export function AutoDialog() {
  const T = useT()
  const t = T.auto
  const lang = useLang()
  const hide = useAutoRun((st) => st.hide)
  const jobId = useAutoRun((st) => st.jobId)
  // v2.4: a floor-plan picture (PNG / JPG / WebP / PDF page) goes through the plan-image review first
  const [image, setImage] = useState<{ file: File; page: number | null } | null>(null)
  const imageDoc = useRef<CadDocument | null>(null)
  // v2.4: the run is an AI job with step checkpoints (persisted) — resumable after a restart, applied steps never twice
  const aiJob = useRef<AiJob | null>(null)
  const saveJob = (j: AiJob) => { aiJob.current = j; useAiStudio.getState().saveJob(j) }
  const [resumedApplied, setResumedApplied] = useState(0)
  /** The source drawing's manufacturing gate (v2.4): an unverified import must not feed CNC files. */
  const [srcGate, setSrcGate] = useState<{ file: string; ok: boolean } | null>(null)
  const navigate = useRouter((st) => st.navigate)
  const cadDocs = useCad((st) => st.docs)
  const [phase, setPhase] = useState<Phase>('pick')
  const [steps, setSteps] = useState<Partial<Record<StepKey, 'run' | 'done' | 'skip'>>>({})
  const [res, setRes] = useState<AutoResult | null>(null)
  const [keep, setKeep] = useState({ house: true, interior: true, route: true, mep: true, files: true })
  const [written, setWritten] = useState<Written[] | null>(null)
  const [dir, setDir] = useState<string | null>(null)
  const [progress, setProgress] = useState<[number, number] | null>(null)
  const [desktop, setDesktop] = useState(false)
  const [aiOn, setAiOn] = useState(false)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const started = useRef(0)
  const [took, setTook] = useState(0)
  const [prices, setPrices] = useState<({ file: string } & PriceList) | null>(null)
  const [units, setUnits] = useState<Record<string, DrawingUnits>>({})
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  // a synchronous guard: a double click on Approve (or Retry) runs once
  const busy = useRef(false)
  // parts already applied: a retry never applies them again
  const applied = useRef(new Set<Part>())
  const job = useRef<WriteJob | null>(null)

  // backups of the models a build replaced (restore: the workspace's undoable edit)
  const [backups, setBackups] = useState<{ store: BackupStore; at: number; label: string }[]>([])
  const refreshBackups = useCallback(() => { latestBackups().then(setBackups, () => setBackups([])) }, [])
  useEffect(() => { refreshBackups() }, [refreshBackups])
  const restore = async (st: BackupStore) => {
    if (busy.current) return
    busy.current = true
    const what = t.backup.stores[st]
    try {
      const e = await restoreBackup(st, t.backup.restoreLabel)
      toast(e ? fmt(t.backup.restoreFailed, { what, why: e }) : fmt(t.backup.restored, { what }), e ? 'warning' : 'success')
    } catch (e) {
      toast(fmt(t.backup.restoreFailed, { what, why: why(e) }), 'warning')
    } finally {
      busy.current = false
      refreshBackups()
    }
  }

  const start = async (doc: CadDocument | null, picked?: File[], page?: number | null) => {
    const pictureIn = !doc ? picked?.find((x) => isPlanPicture(x) && !/\.(dwg|dxf|csv)$/i.test(x.name)) : undefined
    if (pictureIn) { setImage({ file: pictureIn, page: page ?? null }); setPhase('image'); return }
    imageDoc.current = null
    started.current = Date.now()
    setPhase('run')
    setSteps({ read: 'run' })
    setOutcome(null); setError(null); setWritten(null); setDir(null); applied.current = new Set(); job.current = null
    const f = picked?.find((x) => !/\.csv$/i.test(x.name))
    {
      const prev = jobId ? useAiStudio.getState().jobs.find((x) => x.id === jobId && x.status !== 'archived') : null
      const file = doc?.name ?? f?.name ?? ''
      const input = doc ? { docId: doc.id, file } : { file, files: (picked ?? []).map((x) => x.name) }
      // a resumed job recomputes (pure) and keeps what was already applied
      let j = prev ? restartCompute({ ...prev, input: { ...prev.input, ...input }, questions: prev.questions.filter((q) => q.code !== 'reselect-file' && q.code !== 'open-drawing') }) : createJob({ preset: 'one-command', title: fmt(T.importCal.jobs.jobTitleAuto, { file }), steps: jobSteps(), input })
      setResumedApplied(prev ? APPLY.filter((id) => isApplied(prev, id)).length : 0)
      j = startStep(j, 'read')
      saveJob(j)
    }
    try {
      // several files, in any order: the drawings (each classified by its content) and a unit price list (CSV)
      const drawingsIn = (picked ?? []).filter((x) => !/\.csv$/i.test(x.name))
      const csv = (picked ?? []).find((x) => /\.csv$/i.test(x.name))
      setPrices(csv ? { file: csv.name, ...readPriceList(await csv.text()) } : null)
      const reads = doc ? [] : await Promise.all(drawingsIn.map((x) => readDrawing(x)))
      const docs = doc ? [doc] : reads.map((r) => r.doc)
      const un = Object.fromEntries(reads.map((r) => [r.doc.name, r.units]))
      setUnits(un)
      const d = docs[0] ?? null
      setSrcGate(d ? { file: d.name, ok: fabricationAllowed(d).ok } : null)
      if (!d) return setPhase('pick')
      const host = await getHost()
      setDesktop(!!host)
      // the model is loaded on first use: a model file present is enough
      const useAi = !!host && !!(await host.localAiStatus()).modelName
      setAiOn(useAi)
      const seen: StepKey[] = ['read']
      setSteps({ read: 'done' })
      if (aiJob.current) saveJob(finishStep(aiJob.current, 'read', d.name))
      // checkpoint per step: the previous one done, this one running
      const mark = (st: StepKey) => { if (!aiJob.current) return; const prev = seen[seen.length - 2]; let j = aiJob.current; if (prev) j = finishStep(j, prev); saveJob(startStep(j, st)) }
      let r = await runAuto(d, {
        host, useAi, names: buildNames(T.bim.fromCad), levelName: (n) => fmt(T.bim.fromCad.levelDefault, { n }), civilBase: useCivil.getState().doc, extras: docs.slice(1), units: un,
        onStep: (st) => { seen.push(st); setSteps(Object.fromEntries(seen.map((k, i) => [k, i === seen.length - 1 ? 'run' : 'done']))); mark(st) },
      })
      // elevations and sections: the OCCT kernel of the desktop app
      if (host && r.house) {
        seen.push('views')
        setSteps(Object.fromEntries(seen.map((k, i) => [k, i === seen.length - 1 ? 'run' : 'done'])))
        const v = await houseViews(host, r.house.built.model, t.viewWords)
        r = { ...r, house: { ...r.house, views: v }, ms: r.ms + v.ms }
      }
      setSteps(Object.fromEntries(STEPS.map((k) => [k, seen.includes(k) ? 'done' : 'skip'])))
      if (aiJob.current) {
        let j = aiJob.current
        for (const k of STEPS) j = finishStep(j, k, undefined, seen.includes(k) ? 'done' : 'skipped')
        // waiting for the approval (the job queue can reopen this review)
        saveJob({ ...readyForReview(j), pre: [`${t.kinds[r.kind]} — ${r.file}`] })
      }
      setRes(r)
      setKeep({ house: !!r.house, interior: !!r.house?.interior, route: !!r.route, mep: !!r.mepModel, files: r.kind !== 'none' })
      setPhase('review')
    } catch (e) {
      const w = why(e)
      if (aiJob.current) saveJob({ ...aiJob.current, status: 'failed', error: w, updatedAt: Date.now() })
      toast(w === 'no-dwg-reader' ? T.bim.fromCad.noDwgReader : fmt(T.bim.fromCad.openFailed, { name: f?.name ?? doc?.name ?? '', why: w }), 'warning')
      setPhase('pick')
    }
  }

  /** The plan picture was reviewed and approved for building: the same review / approval / package as a drawing. */
  const fromPlan = async (b: PlanBuilt) => {
    started.current = Date.now()
    setOutcome(null); setError(null); setWritten(null); setDir(null); applied.current = new Set(); job.current = null
    imageDoc.current = b.doc
    setPhase('run')
    setSteps({ read: 'done', house: 'done', build: 'run' })
    setResumedApplied(0)
    {
      const file = b.res.file
      const prev = jobId ? useAiStudio.getState().jobs.find((x) => x.id === jobId && x.status !== 'archived') : null
      let j = prev ? restartCompute({ ...prev, input: { ...prev.input, file, files: [file] } }) : createJob({ preset: 'one-command', title: fmt(T.importCal.jobs.jobTitleAuto, { file }), steps: jobSteps(), input: { file, files: [file] } })
      j = finishStep(startStep(j, 'read'), 'read', file)
      saveJob(j)
    }
    try {
      setSrcGate(b.gate)
      setUnits({})
      setPrices(null)
      const host = await getHost()
      setDesktop(!!host)
      setAiOn(false)
      let r: AutoResult = b.res
      const seen: StepKey[] = ['read', 'house', 'build', 'check']
      if (host && r.house) {
        seen.push('views')
        setSteps(Object.fromEntries(seen.map((k, i) => [k, i === seen.length - 1 ? 'run' : 'done'])))
        const v = await houseViews(host, r.house.built.model, t.viewWords)
        r = { ...r, house: { ...r.house, views: v }, ms: r.ms + v.ms }
      }
      setSteps(Object.fromEntries(STEPS.map((k) => [k, seen.includes(k) ? 'done' : 'skip'])))
      if (aiJob.current) {
        let j = aiJob.current
        for (const k of STEPS) j = finishStep(j, k, undefined, seen.includes(k) ? 'done' : 'skipped')
        saveJob({ ...readyForReview(j), pre: [`${t.kinds[r.kind]} — ${r.file}`] })
      }
      setRes(r)
      setKeep({ house: !!r.house, interior: !!r.house?.interior, route: false, mep: false, files: true })
      setPhase('review')
    } catch (e) {
      const w = why(e)
      if (aiJob.current) saveJob({ ...aiJob.current, status: 'failed', error: w, updatedAt: Date.now() })
      toast(fmt(T.bim.fromCad.openFailed, { name: b.res.file, why: w }), 'warning')
      setPhase('image')
    }
  }

  // the model rules, run BEFORE the approval: what they would reject is said in the review and not applied
  const rejected = useMemo<Partial<Record<Part, string>>>(() => {
    if (!res) return {}
    const out: Partial<Record<Part, string>> = {}
    const run = (p: Part, f: () => string | null) => { try { const e = f(); if (e) out[p] = e } catch (e) { out[p] = why(e) } }
    // a wrong storey stack (two storeys at one elevation, numbers against elevations) is not offered at all
    if (res.house) run('house', () => {
      const pr = res.house!.built.problems ?? []
      if (pr.length) return pr.map((x) => { const [code, ...rest] = x.split(':'); return fmt((t.notes as Record<string, string>)[code] ?? x, { what: rest.join(':') }) }).join('; ')
      return checkBim(res.house!.built.model)
    })
    if (res.house?.interior) run('interior', () => checkInterior(res.house!.interior!))
    if (res.route) run('route', () => checkCivil(res.route!.model))
    if (res.mepModel) run('mep', () => checkMep(res.mepModel!.model))
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res])
  const takes = (p: Part) => keep[p] && !rejected[p]

  // the package and the numbers shown before approval (same code as the files written) — built outside the render,
  // an error is shown, never a crashed dialog
  const cam = useInterior((st) => st.cam)
  const machineRec = useMachines((st) => st.records.find((x) => x.profile.profile_id === cam.machineProfileId) ?? null)
  const camSetup = useMemo(() => ({ nest: nestSettings(cam), cnc: cam.cnc, prefs: cam, machine: machineRec?.profile ?? null, machineProfileId: cam.machineProfileId ?? null, source: srcGate }), [cam, machineRec, srcGate])
  const pkgText = useMemo(() => ({ plan: (lv: string) => fmt(t.plan, { level: lv }).trim(), views: t.viewsPdf, boq: { ...t.boq, prices }, mep: t.mep, profile: t.profile, sections: t.sections, words: t.words, report: (b: string) => b }), [t, prices])
  const include = useMemo<PackageInclude>(() => ({ house: takes('house'), interior: takes('interior'), route: takes('route'), mep: !res?.mepModel || keep.mep }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keep, rejected, res])
  const [pkg, setPkg] = useState<{ files: OutFile[]; error: string | null }>({ files: [], error: null })
  useEffect(() => {
    if (!res) { setPkg({ files: [], error: null }); return }
    let live = true
    const id = setTimeout(() => {
      try { const f = makePackage(res, camSetup, pkgText, include); if (live) setPkg({ files: f, error: null }) } catch (e) { if (live) setPkg({ files: [], error: why(e) }) }
    }, 0)
    return () => { live = false; clearTimeout(id) }
  }, [res, camSetup, pkgText, include])
  const files = pkg.files
  const cabinets = useMemo(() => (res ? allCabinets(res) : []), [res])
  // the CNC previews of the package (same code as the files written): sheets, oversize parts, release blockers
  const cncInfo = useMemo(() => { try { return res && cabinets.length ? cncPreview(cabinets, camSetup, res.file.replace(/\.(dwg|dxf)$/i, '')).cnc : null } catch { return null } }, [res, cabinets, camSetup])
  const nesting = cncInfo?.nest ?? null

  const summary = useMemo(() => {
    if (!res) return null
    const W = T.bim.fromCad, C = T.civil.fromCad
    const house: string[] = [], route: string[] = [], warnings: string[] = [], filesL: string[] = []
    let checks = ''
    // the files: what each was taken for, the units it was read in
    if (res.files.length > 1) for (const x of res.files) filesL.push(fmt(t.fileLine, { name: x.name, kind: t.fileKinds[x.kind], plans: x.plans ? fmt(t.filePlans, { n: x.plans }) : '', used: x.usedForPlans && res.files.length > 1 ? t.fileUsed : '' }))
    for (const [file, u] of Object.entries(units)) {
      if (u.factor !== 1) filesL.push(fmt(t.unitsLine, { file, unit: u.unit, src: u.source === 'header' ? fmt(t.unitsSrc.header, { n: u.insunits ?? '' }) : t.unitsSrc[u.source], k: u.factor }))
      if (u.note && t.unitNotes[u.note]) warnings.push(fmt(t.unitNotes[u.note], { file, n: u.insunits ?? '' }))
    }
    if (prices) {
      if (prices.noPriceColumn) warnings.push(fmt(t.priceNoCol, { file: prices.file }))
      if (prices.bad.length) warnings.push(fmt(t.priceBad, { file: prices.file, n: prices.bad.length, list: prices.bad.slice(0, 6).map((b) => `#${b.line} “${b.text}” (${t.priceBadWhy[b.why]})`).join('; ') }))
    }
    if (res.house) {
      const c = res.house.built.counts
      house.push(fmt(t.house, { levels: c.levels, walls: c.walls, doors: c.doors, windows: c.windows, rooms: c.rooms, columns: c.columns, furniture: c.components, stairs: c.stairs, railings: c.railings }))
      const it = res.house.interior
      if (it) {
        house.push(fmt(t.interior, { level: res.house.built.model.levels[res.house.interiorLevel ?? 0]?.name ?? '', rooms: it.rooms.length, items: it.items.length, cabinets: it.cabinets.length }))
        const parts = cabinets.flatMap(cutList).reduce((a, p) => a + p.qty, 0)
        if (cabinets.length) house.push(fmt(t.production, { n: res.house.interiors.filter((x) => x.build.cabinets.length).length || 1, cabinets: cabinets.length, parts, sheets: nesting?.sheets.length ?? 0, programs: files.filter((f) => / - CNC .*\.NOT_FOR_MACHINE\.txt$/.test(f.name)).length }))
        if (cncInfo) {
          warnings.push(fmt(t.cncPreviewOnly, { machine: camSetup.machine ? `${camSetup.machine.profile_id} (${camSetup.machine.status})` : 'NONE' }))
          if (cncInfo.nest.unplaced.length) warnings.push(fmt(t.cncUnplaced, { n: cncInfo.nest.unplaced.length, list: cncInfo.nest.unplaced.map((p) => `${p.label} ${p.l}×${p.w}`).join(', ') }))
          warnings.push(fmt(t.cncBlockers, { list: cncInfo.blockers.join(', ') }))
        }
      } else house.push(t.noInterior)
      const furnished = (res as { furnished?: string[] }).furnished
      if (furnished?.length) house.push(fmt(T.planImage.furnished, { list: furnished.join(', ') }))
      const roofs = res.house.built.model.roofs ?? []
      if (roofs.length) house.push(fmt(t.roof, { n: roofs.length, kinds: roofs.map((r) => `${r.kind === 'hip' ? T.auto.roofKinds.hip : T.auto.roofKinds.gable} ${r.slope.toFixed(0)}°`).join(', '), area: n0(roofs.reduce((a, r) => a + roofQuantities(r).area, 0)) }))
      for (const x of res.house.inferred ?? []) warnings.push(fmt(t.elevInferred, { level: x.level, e: `${x.elevation >= 0 ? '+' : ''}${(x.elevation / 1000).toFixed(3)}`, how: t.elevHow[x.how] }))
      for (const x of res.house.duplicates ?? []) warnings.push(fmt(t.dupLevel, x))
      for (const n of res.house.built.notes ?? []) { const [code, ...rest] = n.split(':'); warnings.push(fmt((t.notes as Record<string, string>)[code] ?? n, { what: rest.join(':') })) }
      for (const x of res.house.structure ?? []) {
        house.push(fmt(t.structure, { file: x.file, footings: x.footings, piles: x.piles, ties: x.ties, beams: x.beams, openings: x.openings }))
        for (const w of x.warnings) { const [code, ...rest] = w.split(':'); warnings.push(`${x.file}: ${fmt((t.structWarn as Record<string, string>)[code] ?? w, { what: rest.join(':') })}`) }
      }
      if (prices) {
        const rows = boq(res.house.built.model, t.boq.words)
        house.push(fmt(t.boq.priceNote, { file: prices.file, n: rows.filter((r) => priceOf(prices.map, r) !== undefined).length, m: rows.length }))
      }
      const v = res.house.views
      if (v?.views.length) house.push(fmt(t.views, { e: v.views.filter((x) => x.kind === 'elev').length, s: v.views.filter((x) => x.kind === 'section').length, t: (v.ms / 1000).toFixed(1) }))
      if (v?.error) warnings.push(fmt(t.viewsFailed, { why: v.error }))
      if (!desktop) house.push(t.viewsBrowser)
      const bad = res.house.checks.filter((k) => k.status === 'error' || k.status === 'warning')
      checks = bad.length ? fmt(t.checksBad, { n: bad.reduce((a, k) => a + k.count, 0), what: bad.map((k) => T.bim.coord.rows[k.key]).join(', ') }) : t.checksOk
      // each recognition's warnings under the level IT became (the levels are sorted by elevation, the plans not)
      res.house.recs.forEach((r, i) => r.warnings.forEach((w) => warnings.push(`${res.house!.recLevels?.[i] ?? r.region.levelName ?? r.region.title ?? ''}: ${fmt(W.warn[w.code], 'n' in w ? { n: w.n } : {})}`)))
      for (const k of bad) for (const x of k.items.slice(0, 3)) warnings.push(x.message)
    }
    if (res.route) {
      const v = res.route.volume
      route.push(fmt(t.route, { name: res.route.model.alignment.name, sections: res.route.chosen.sections.length, len: n0(v.length), cut: n0(v.cut), fill: n0(v.fill) }))
      {
        const sp = earthSplit(res.route.model, prices?.map), tt = sp.total
        const m = tt.cut > 0 ? tt.cutM / tt.cut : tt.fill > 0 ? tt.fillM / tt.fill : 0
        route.push(fmt(t.routeSplit, { m: Math.round(m * 100), h: Math.round((1 - m) * 100), cm: n0(tt.cutM), ch: n0(tt.cutH), fm: n0(tt.fillM), fh: n0(tt.fillH), src: t.splitSrc[sp.source] }))
      }
      if (v.drawn) route.push(fmt(t.routeDrawn, { cut: n0(v.drawn.cut), fill: n0(v.drawn.fill), dc: (((v.cut - v.drawn.cut) / Math.max(1e-9, v.drawn.cut)) * 100).toFixed(2), df: (((v.fill - v.drawn.fill) / Math.max(1e-9, v.drawn.fill)) * 100).toFixed(2) }))
      const ci = res.route.routes.indexOf(res.route.chosen)
      ;(res.route.all ?? []).forEach((o, i) => { if (i !== ci) route.push(fmt(t.routeAlso, { name: o.name, sections: res.route!.routes[i]?.sections.length ?? 0, len: n0(o.volume.length), cut: n0(o.volume.cut), fill: n0(o.volume.fill) })) })
      const r = res.route.chosen
      if (r.missing.length) warnings.push(fmt(C.missing, { list: r.missing.join(', ') }))
      const off = r.sections.filter((x) => x.tableOff > 0).length
      if (off) warnings.push(fmt(C.tableWarn, { n: off }))
      const anch = r.sections.filter((x) => x.map.vfit !== 'table').length
      if (anch) warnings.push(fmt(C.anchoredWarn, { n: anch }))
      if (!res.route.model.invert.some(([, z], i, a) => i && Math.abs(z - a[0][1]) > 1e-6)) warnings.push(C.noFlow)
    }
    const mepL: string[] = []
    for (const x of res.mep ?? []) {
      const sum = (f: (r: (typeof x.rows)[number]) => boolean) => x.rows.filter(f).reduce((a, r) => a + r.total, 0)
      const n = (role: string) => n0(sum((r) => r.role === role))
      const any = (roles: string[]) => x.rows.some((r) => roles.includes(r.role))
      if (any(['light', 'switch', 'socket', 'wire', 'cold', 'hot', 'waste', 'sewer', 'storm', 'vent', 'ac']))
        mepL.push(fmt(t.mepLine, { file: x.file, lights: n('light'), switches: n('switch'), sockets: n('socket'), ac: n('ac'), wire: n0(sum((r) => r.role === 'wire' || r.role === 'wireDrop')), pipe: n0(sum((r) => ['cold', 'hot', 'waste', 'sewer', 'storm', 'vent', 'riser'].includes(r.role))) }))
      if (any(['detector', 'alarm', 'extinguisher', 'exitSign', 'sprinkler', 'hydrant'])) mepL.push(fmt(t.mepFireLine, { file: x.file, detectors: n('detector'), alarms: n('alarm'), ext: n('extinguisher'), signs: n('exitSign'), sprinklers: n('sprinkler') }))
      if (any(['data', 'tv', 'ap', 'camera', 'intercom'])) mepL.push(fmt(t.mepElvLine, { file: x.file, data: n('data'), tv: n('tv'), ap: n('ap'), cam: n('camera'), intercom: n('intercom') }))
    }
    if (res.mepModel) { const mm = res.mepModel; mepL.push(fmt(t.mepModelLine, { pipes: mm.pipes, fixtures: mm.fixtures, beams: mm.beams, clashes: mm.pipeBeam, levels: Object.keys(mm.levels).join(', ') })) }
    if (mepL.length) warnings.push(t.mepNote)
    const ai = !res.ai ? (aiOn ? t.aiNotNeeded : t.noAi) : res.ai.set.length ? fmt(t.aiDone, { n: res.ai.set.length, m: res.ai.asked, s: res.ai.seconds.toFixed(1) }) : fmt(t.aiNone, { m: res.ai.asked, s: res.ai.seconds.toFixed(1) })
    return { house, route, mep: mepL, warnings, checks, ai, files: filesL }
  }, [res, t, T, files, nesting, cncInfo, camSetup, cabinets, aiOn, desktop, prices, units])

  const partName = (p: Part) => (p === 'house' ? 'BIM' : p === 'interior' ? T.nav.interior : p === 'route' ? T.nav.civil : 'MEP')
  const resultLines = (o: Outcome): { text: string; bad: boolean }[] => [
    ...(o.applied.length ? [{ text: fmt(t.result.applied, { list: o.applied.map(partName).join(', ') }), bad: false }] : []),
    ...(o.rejected.length ? [{ text: fmt(t.result.rejected, { list: o.rejected.map((x) => `${partName(x.part)} (${x.why})`).join(', ') }), bad: true }] : []),
    ...o.backupFailed.map((p) => ({ text: fmt(t.backup.failed, { what: t.backup.stores[STORE_OF[p]] }), bad: true })),
    ...(o.noFolder ? [{ text: t.result.noFolder, bad: true }] : []),
  ]

  /** Writes the package (desktop: into the folder; browser: one ZIP). An error leaves the models applied and offers a retry. */
  const write = async (j: WriteJob) => {
    setPhase('write')
    setError(null)
    const all = j.files.length + 1
    setProgress([0, all])
    try {
      if (aiJob.current) saveJob(beginApply(aiJob.current, 'write-files'))
      const w = await writePackage(j.files, j.report, j.host, j.dir, j.zipName, (n) => setProgress([n, all]))
      setWritten(w)
      setDir(j.dir)
      if (aiJob.current) saveJob(readyForReview(markApplied(aiJob.current, 'write-files', undefined, j.dir ?? j.zipName)))
      job.current = null
      setTook(Date.now() - started.current)
      setPhase('done')
    } catch (e) {
      if (aiJob.current) saveJob(stepFailed(aiJob.current, 'write-files', why(e)))
      setError(fmt(t.writeFailed, { why: why(e) }))
      setPhase('error')
    }
  }

  const approve = async () => {
    if (busy.current || !res || !summary) return
    busy.current = true
    setPhase('write')
    setProgress(null)
    try {
      const label = fmt(t.undoLabel, { name: res.file })
      if (aiJob.current) saveJob(finishStep(aiJob.current, 'approve'))
      const o: Outcome = { applied: [], rejected: [], backupFailed: [], noFolder: false }
      // each part: its own validated, undoable edit (the replaced model backed up first); never twice
      const run = async (p: Part, on: boolean, f: () => Promise<Applied>) => {
        const id = APPLY_OF[p]
        if (!on) { if (aiJob.current) saveJob(finishStep(aiJob.current, id, undefined, 'skipped')); return }
        // applied in this dialog, or by this job before a restart (resume): never twice
        if (applied.current.has(p)) { o.applied.push(p); return }
        if (aiJob.current && isApplied(aiJob.current, id)) { saveJob(finishStep(aiJob.current, id, T.importCal.jobs.skipped)); applied.current.add(p); o.applied.push(p); return }
        if (rejected[p]) { o.rejected.push({ part: p, why: rejected[p]! }); if (aiJob.current) saveJob(stepFailed(aiJob.current, id, rejected[p]!)); return }
        if (aiJob.current) saveJob(beginApply(aiJob.current, id))
        let r: Applied
        try { r = await f() } catch (e) { r = { error: why(e), backedUp: false } }
        if (r.error) { o.rejected.push({ part: p, why: r.error }); if (aiJob.current) saveJob(stepFailed(aiJob.current, id, r.error)); return }
        if (aiJob.current) saveJob(markApplied(aiJob.current, id, { store: STORE_OF[p], label }))
        applied.current.add(p)
        o.applied.push(p)
        if (!r.backedUp) o.backupFailed.push(p)
      }
      await run('house', keep.house && !!res.house, () => applyBim(res.house!.built.model, 'replace', label))
      await run('interior', keep.interior && !!res.house?.interior, () => applyInterior(res.house!.interior!, label))
      await run('route', keep.route && !!res.route, () => applyCivil(res.route!.model, label))
      await run('mep', keep.mep && !!res.mepModel, () => applyMep(res.mepModel!.model, label))
      // a plan picture: its recognised plan (with the picture underneath and its provenance) opens in CAD 2D
      if (imageDoc.current && o.applied.includes('house')) {
        const d = imageDoc.current
        imageDoc.current = null
        useCad.getState().openDocument(d)
        toast(fmt(T.planImage.cadRecord, { name: d.name, status: fabricationAllowed(d).ok ? T.planImage.statusCal : T.planImage.statusUncal }), 'info')
      }
      setOutcome(o)
      refreshBackups()
      if (o.rejected.length) toast(o.applied.length ? fmt(t.result.partial, { name: res.file, ok: o.applied.map(partName).join(', '), bad: o.rejected.map((x) => partName(x.part)).join(', ') }) : fmt(t.result.none, { bad: o.rejected.map((x) => partName(x.part)).join(', ') }), 'warning')
      else if (o.applied.length) toast(fmt(t.built, { name: res.file }), 'success')
      for (const p of o.backupFailed) toast(fmt(t.backup.failed, { what: t.backup.stores[STORE_OF[p]] }), 'warning')
      const noFiles = () => { if (aiJob.current) saveJob(readyForReview(finishStep(aiJob.current, 'write-files', undefined, 'skipped'))) }
      if (!keep.files) { noFiles(); setTook(Date.now() - started.current); setPhase('done'); return }
      // the package of the parts applied (a part rejected now leaves its files out too)
      const ok = (p: Part) => keep[p] && !o.rejected.some((x) => x.part === p)
      let out: OutFile[]
      try {
        out = makePackage(res, camSetup, pkgText, { house: ok('house'), interior: ok('interior'), route: ok('route'), mep: !res.mepModel || keep.mep })
      } catch (e) {
        setError(fmt(t.packageFailed, { why: why(e) }))
        setPhase('error')
        return
      }
      if (!out.length) { noFiles(); setTook(Date.now() - started.current); setPhase('done'); return }
      const host = await getHost()
      let d: string | null = null
      if (host) {
        d = (await host.pickFolder(t.pickFolder, '')) || null
        if (!d) { setOutcome({ ...o, noFolder: true }); setTook(Date.now() - started.current); setPhase('done'); return }
      }
      const report = reportHtml(res, t.report, { ai: summary.ai, house: [...summary.files, ...summary.house, ...summary.mep], route: summary.route, checks: summary.checks, warnings: [...resultLines(o).map((x) => x.text), ...summary.warnings], files: out }, lang)
      const zipName = `${res.file.replace(/\.(dwg|dxf|png|jpe?g|webp|pdf)$/i, '')} - MD CAD AI STUDIO.zip`
      job.current = { files: out, report, host, dir: d, zipName }
      await write(job.current)
    } catch (e) {
      setError(fmt(t.writeFailed, { why: why(e) }))
      setPhase('error')
    } finally {
      busy.current = false
    }
  }
  const retry = async () => {
    if (busy.current) return
    busy.current = true
    try {
      if (job.current) await write(job.current)
      else { busy.current = false; await approve(); return }
    } finally {
      busy.current = false
    }
  }

  const docList = Object.values(cadDocs)
  // a job resumed from the AI job queue: the drawing it ran on is opened again (its applied steps are skipped);
  // a file read from disk is not kept between sessions — the user selects it again
  const resumeJob = jobId ? useAiStudio.getState().jobs.find((x) => x.id === jobId) ?? null : null
  useEffect(() => {
    const st = useAutoRun.getState()
    if (st.files?.length && phase === 'pick') { void start(null, st.files, st.page); return }
    const d = resumeJob?.input.docId ? useCad.getState().docs[resumeJob.input.docId] : null
    if (d && phase === 'pick') void start(d)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const go = (r: 'bim' | 'interior' | 'civil' | 'mep') => { hide(); navigate(r) }
  const failed = written?.filter((w) => !w.ok) ?? []
  const icon = (k: StepKey) => {
    const st = steps[k]
    return st === 'run' ? <Loader2 size={15} className={s.spin} /> : st === 'done' ? <CheckCircle2 size={15} className={s.ok} /> : st === 'skip' ? <MinusCircle size={15} className={s.skip} /> : <Circle size={15} className={s.wait} />
  }
  const replacing = res ? PARTS.filter((p) => (p === 'house' ? !!res.house : p === 'interior' ? !!res.house?.interior : p === 'route' ? !!res.route : !!res.mepModel) && takes(p)) : []
  const restoreBox = backups.length > 0 && (phase === 'pick' || phase === 'done') && (
    <div className={s.small} data-testid="auto-restore">
      <b>{t.backup.restoreTitle}:</b>{' '}
      {backups.map((b) => (
        <button key={b.store} type="button" onClick={() => void restore(b.store)} title={b.label}>
          <RotateCcw size={12} /> {fmt(t.backup.restore, { what: t.backup.stores[b.store], when: new Date(b.at).toLocaleString(lang) })}
        </button>
      ))}
    </div>
  )

  return (
    <Modal title={t.title} onClose={hide} width={860}>
      <div className={s.box} data-testid="auto">
        <p className={s.note}>{t.intro}</p>
        {phase === 'pick' && resumeJob && !resumeJob.input.docId && resumeJob.input.file && (
          <p className={s.warnBox} role="alert" data-testid="auto-reselect">{fmt(T.importCal.jobs.q['reselect-file'], { file: resumeJob.input.file })}</p>
        )}
        {phase === 'pick' && (
          <>
            <div
              className={`${s.drop} ${over ? s.over : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOver(true) }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); const fs = [...(e.dataTransfer.files ?? [])]; if (fs.length) void start(null, fs) }}
            >
              <FileUp size={28} strokeWidth={1.5} />
              <span>{t.drop}</span>
              <ActionButton variant="primary" onClick={() => input.current?.click()}>{t.choose}</ActionButton>
              <span className={s.small} data-testid="auto-picture-hint">{T.planImage.pickHint}</span>
              <input ref={input} type="file" hidden multiple accept=".dwg,.dxf,.csv,.png,.jpg,.jpeg,.webp,.pdf" aria-label={t.choose} data-testid="auto-file" onChange={(e) => { const fs = [...(e.target.files ?? [])]; if (fs.length) void start(null, fs); e.target.value = '' }} />
            </div>
            {docList.length > 0 && (
              <div className={s.open}>
                <span>{t.orOpen}</span>
                {docList.slice(0, 6).map((d) => <button key={d.id} type="button" onClick={() => void start(d)}>{t.useOpen} “{d.name}”</button>)}
              </div>
            )}
            {restoreBox}
          </>
        )}
        {phase === 'image' && image && (
          <PlanImageReview key={image.file.name + image.file.size} file={image.file} page0={image.page} onCancel={() => { setImage(null); setPhase('pick') }} onBuilt={(b) => void fromPlan(b)} />
        )}
        {phase !== 'pick' && phase !== 'image' && (
          <ol className={s.steps} aria-label={t.found}>
            {STEPS.map((k) => <li key={k} className={steps[k] === 'skip' ? s.dim : undefined}>{icon(k)}{t.steps[k]}</li>)}
          </ol>
        )}
        {res && summary && phase !== 'run' && (
          <>
            <h4>{t.found}: <b data-testid="auto-kind">{t.kinds[res.kind]}</b> <span className={s.file}>{res.file} · {(res.ms / 1000).toFixed(1)} s · {summary.ai}</span></h4>
            {summary.files.length > 0 && <div className={s.small} data-testid="auto-files-list">{summary.files.map((l) => <div key={l}>{l}</div>)}</div>}
            {res.kind === 'none' && <p className={s.warnBox} role="alert">{t.none}</p>}
            {summary.house.length > 0 && <div className={s.card} data-testid="auto-house"><b>{t.kinds.house}</b>{summary.house.map((l) => <div key={l}>{l}</div>)}<div className={s.small}>{fmt(t.checks, { ok: summary.checks })}</div></div>}
            {summary.mep.length > 0 && <div className={s.card} data-testid="auto-mep"><b>{t.kinds.mep}</b>{summary.mep.map((l) => <div key={l}>{l}</div>)}</div>}
            {summary.route.length > 0 && (
              <div className={s.card} data-testid="auto-route">
                <b>{t.kinds.route}</b>
                {res.route && res.route.routes.length > 1 && (
                  <label className={s.pick}>
                    {t.routePick}
                    <select aria-label={t.routePick} value={res.route.routes.indexOf(res.route.chosen)} disabled={phase !== 'review'} onChange={(e) => setRes(withRoute(res, Number(e.target.value), useCivil.getState().doc))}>
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
                {PARTS.map((p) => {
                  const has = p === 'house' ? !!res.house : p === 'interior' ? !!res.house?.interior : p === 'route' ? !!res.route : !!res.mepModel
                  if (!has) return null
                  const bad = rejected[p]
                  return (
                    <label key={p}>
                      <input type="checkbox" checked={keep[p] && !bad} disabled={!!bad} onChange={(e) => setKeep({ ...keep, [p]: e.target.checked })} />
                      {t.part[p]}
                      {bad && <span className={s.bad} data-testid={`auto-rejected-${p}`}> — {fmt(t.rejectedPre, { why: bad })}</span>}
                    </label>
                  )
                })}
                <label><input type="checkbox" checked={keep.files} onChange={(e) => setKeep({ ...keep, files: e.target.checked })} data-testid="auto-keep-files" />{t.part.files} — <span data-testid="auto-files">{fmt(desktop ? t.files : t.filesBrowser, { n: files.length + 1 })}</span></label>
                {pkg.error && <div className={s.bad} role="alert">{fmt(t.packageFailed, { why: pkg.error })}</div>}
                {replacing.length > 0 && <div className={s.small} data-testid="auto-replace-note">{fmt(t.backup.replaceNote, { what: replacing.map((p) => t.backup.stores[STORE_OF[p]]).join(', ') })}</div>}
              </div>
            )}
            {summary.warnings.length > 0 && phase === 'review' && (
              <details className={s.warnBox}>
                <summary>{t.warnings} ({summary.warnings.length})</summary>
                <ul>{summary.warnings.slice(0, 12).map((w, i) => <li key={i}>{w}</li>)}</ul>
                {summary.warnings.length > 12 && <div>{fmt(t.more, { n: summary.warnings.length - 12 })}</div>}
              </details>
            )}
            {phase === 'review' && resumedApplied > 0 && <p className={s.note} role="status" data-testid="auto-resumed">{fmt(T.importCal.jobs.resumeNote, { n: resumedApplied })}</p>}
            {phase === 'review' && srcGate && !srcGate.ok && <p className={s.warnBox} role="alert" data-testid="auto-review-required">{fmt(T.importCal.review.autoBlocked, { file: srcGate.file })}</p>}
            {phase === 'write' && progress && <p className={s.note} role="status">{fmt(t.writing, { n: progress[0], m: progress[1] })}</p>}
            {phase === 'error' && (
              <div className={s.card} data-testid="auto-error">
                {outcome && resultLines(outcome).map((l) => <div key={l.text} className={l.bad ? s.bad : undefined}>{l.text}</div>)}
                <div className={s.bad} role="alert">{error}</div>
                <div className={s.go}><ActionButton variant="primary" onClick={() => void retry()} data-testid="auto-retry"><RotateCcw size={15} /> {t.retry}</ActionButton></div>
              </div>
            )}
            {phase === 'done' && (
              <div className={s.card} data-testid="auto-done">
                <b>{fmt(t.done, { s: (took / 1000).toFixed(1) })}</b>
                {outcome && resultLines(outcome).map((l) => <div key={l.text} className={l.bad ? s.bad : undefined} data-testid={l.bad ? 'auto-not-applied' : 'auto-applied'}>{l.text}</div>)}
                {written && (dir ? <div>{fmt(t.doneFiles, { ok: written.filter((w) => w.ok).length, dir })}</div> : <div>{fmt(t.doneZip, { name: written[0]?.name ?? '' })}</div>)}
                {failed.length > 0 && dir && <div className={s.bad}>{fmt(t.failedFiles, { n: failed.length, list: failed.map((f) => `${f.name} (${f.error})`).join(', ') })}</div>}
                <div className={s.go}>
                  {res.house && applied.current.has('house') && <ActionButton onClick={() => go('bim')}>{t.openBim}</ActionButton>}
                  {res.house?.interior && applied.current.has('interior') && <ActionButton onClick={() => go('interior')}>{t.openInterior}</ActionButton>}
                  {res.route && applied.current.has('route') && <ActionButton onClick={() => go('civil')}>{t.openCivil}</ActionButton>}
                  {res.mepModel && applied.current.has('mep') && <ActionButton onClick={() => go('mep')}>{t.openMep}</ActionButton>}
                </div>
                {restoreBox}
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
