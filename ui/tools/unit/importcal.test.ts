// v2.4 import calibration, provenance gate, OCR review, measured room, AI job resume
// (run: UNIT=importcal node tools/test-cam.mjs run). Every case asserts; `all` is true only when every one passes.
import { dimensionTexts, ocrReferences, parseDimensionText, solveScale, type CalRef } from '../../src/cad/calibration'
import { buildImport, buildSurvey, recalibrate, resurvey } from '../../src/cad/importReview'
import { addSource, fabricationAllowed, reviewRequired, setReviewStatus } from '../../src/cad/provenance'
import { surveyRoom, type SurveyInput } from '../../src/cad/survey'
import { classifyWord } from '../../src/cad/vectorize'
import { createBlankDocument } from '../../src/cad/seed'
import { answer, createJob, openQuestions, recoverAfterRestart, resolveInterrupted, runJob, type AiJob, type StepHandlers } from '../../src/ai/jobs'
import type { CadDocument, Entity } from '../../src/cad/types'

type Case = { name: string; ok: boolean; got?: unknown }
const near = (a: number | null | undefined, b: number, tol: number) => a !== null && a !== undefined && Math.abs(a - b) <= tol

const base = { color: 'ByLayer', linetype: 'ByLayer', lineweight: 'ByLayer', transparency: 0 } as const
const line = (id: string, x0: number, y0: number, x1: number, y1: number): Entity => ({ ...base, id, kind: 'line', layer: 'SCAN-LINES', a: { x: x0, y: y0 }, b: { x: x1, y: y1 } })
/** An OCR word above (x0..x1, y): box 20 high starting 8 above the line, like the vectoriser makes them. */
const word = (id: string, value: string, x0: number, x1: number, y: number, conf = 0.92): Entity => ({
  ...base, id, kind: 'text', layer: 'SCAN-TEXT', p: { x: x0, y: y + 8 }, height: 14.4, value, rotation: 0, align: 'left',
  src: { id: '', confidence: conf, bbox: { x0, y0: y + 8, x1, y1: y + 28 } },
})
/** A scanned plan at 1 mm/px nominal: a 1400 px dimension line "7000", a 708 px one "3600" (true 3540 at 5 mm/px), a 680 px "3400". */
const plan = (): Entity[] => [
  line('l1', 0, 0, 1400, 0), word('t1', '7000', 660, 740, 0),
  line('l2', 0, 1000, 708, 1000), word('t2', '3600', 314, 394, 1000),
  line('l3', 720, 1000, 1400, 1000), word('t3', '3400', 1020, 1100, 1000),
  word('t4', 'BẾP', 300, 360, 500, 0.41),
]
const nominal = { dpi: 254, scale: 10, mmPerPx: 1 }
const docWith = (r: ReturnType<typeof buildImport>): CadDocument => addSource({ ...createBlankDocument('scan.dwg', 1), entities: r.entities }, r.source, r.review)

export function run() {
  const cases: Case[] = []
  const check = (name: string, ok: boolean, got?: unknown) => cases.push({ name, ok, got })

  // ---- calibration math
  const two = solveScale([{ id: 'a', measured: 1400, refDistance: 7000 }, { id: 'b', measured: 680, refDistance: 3400 }])
  check('two exact references → k = 5, residual 0', !!two && near(two.k, 5, 1e-9) && near(two.residual, 0, 1e-9), two)
  const noisy = solveScale([{ id: 'a', measured: 1400, refDistance: 7000 }, { id: 'b', measured: 700, refDistance: 3540 }])
  // k = (1400·7000 + 700·3540) / (1400² + 700²) = 12.278e6 / 2.45e6; misfits +16.0 / −32.0 mm → RMS √640
  check('two disagreeing references → least-squares k and RMS residual', !!noisy && near(noisy.k, 12.278e6 / 2.45e6, 1e-9) && near(noisy.residual, Math.sqrt(640), 0.05) && near(noisy.maxErr, 32, 0.05), noisy)
  const three = solveScale([{ id: 'a', measured: 1400, refDistance: 7000 }, { id: 'b', measured: 700, refDistance: 3540 }, { id: 'c', measured: 600, refDistance: 3000 }])
  check('three references → residual reported, every misfit listed', !!three && three.perRef.length === 3 && three.residual !== null && three.residual > 0, three)
  const one = solveScale([{ id: 'a', measured: 200, refDistance: 1000 }])
  check('one reference → scale, residual null (nothing to compare)', !!one && near(one.k, 5, 1e-12) && one.residual === null, one)
  check('no usable reference → no calibration', solveScale([]) === null && solveScale([{ id: 'x', measured: 0, refDistance: 100 }]) === null)
  const parsed = ['3600', '3.600', '3,600', '3600mm', '3.6m', '3,6 m', '1', '12', 'TẦNG', '(2400)'].map(parseDimensionText)
  check('dimension texts parsed (3600 / 3.600 / 3,6 m …), level numbers are not dimensions', JSON.stringify(parsed) === JSON.stringify([3600, 3600, 3600, 3600, 3600, 3600, null, null, null, 2400]), parsed)

  // ---- uncalibrated import → REVIEW REQUIRED, fabrication blocked, nothing invented
  const unc = buildImport({ kind: 'image', file: 'plan.png', page: null, entities: plan(), nominal, refs: [] })
  const dUnc = docWith(unc)
  const gUnc = fabricationAllowed(dUnc)
  check('uncalibrated → fabricationAllowed false with reason "uncalibrated"', !gUnc.ok && gUnc.reasons.some((r) => r.code === 'uncalibrated'), gUnc)
  check('uncalibrated → doc property reviewRequired, every entity tagged unscaled with its source', reviewRequired(dUnc) && dUnc.provenance!.reviewRequired && dUnc.entities.every((e) => e.src?.id === unc.source.id && e.src.unscaled), dUnc.provenance)
  check('uncalibrated → geometry kept exactly as pixel-derived (no scale invented)', (dUnc.entities[0] as Extract<Entity, { kind: 'line' }>).b.x === 1400 && unc.source.calibration === null && unc.source.status === 'unscaled')
  check('uncalibrated → no dimension mismatch items (comparison would be meaningless)', !unc.review.some((r) => r.kind === 'ocr-dimension-mismatch'), unc.review.map((r) => r.kind))
  check('low-confidence OCR word kept as a review item with its confidence', unc.review.some((r) => r.kind === 'ocr-low-confidence' && r.text === 'BẾP' && r.conf === 41) && dUnc.entities.some((e) => e.kind === 'text' && e.value === 'BẾP' && e.src?.reviewRequired))
  check('fabricationAllowed(null) is false', !fabricationAllowed(null).ok)
  check('a drawing without provenance (drawn here) is not blocked by this gate', fabricationAllowed(createBlankDocument('x.dwg', 1)).ok)

  // ---- calibrated by OCR dimension texts: mismatch flagged with both values
  const refs = ocrReferences(plan(), nominal.mmPerPx)
  check('OCR references: the three dimension texts found with their lines', refs.length === 3 && refs.map((r) => r.text).sort().join() === '3400,3600,7000', refs.map((r) => [r.text, r.measured]))
  const use = refs.filter((r) => r.text !== '3600')
  const cal = buildImport({ kind: 'image', file: 'plan.png', page: null, entities: plan(), nominal, refs: use })
  const mm = cal.review.filter((r) => r.kind === 'ocr-dimension-mismatch')
  check('calibrated with "7000" + "3400" → k = 5 mm/px, residual 0', near(cal.fit?.k, 5, 1e-9) && near(cal.fit?.residual, 0, 1e-6) && cal.source.calibration?.method === 'ocr-dimension', cal.fit)
  check('OCR "3600" next to a 3540 mm line → mismatch item with both values', mm.length === 1 && mm[0].ocrValue === 3600 && near(mm[0].measuredMm, 3540, 0.01), mm)
  let dCal = docWith(cal)
  check('calibrated but items open → still blocked ("open-review")', !fabricationAllowed(dCal).ok && fabricationAllowed(dCal).reasons.every((r) => r.code === 'open-review'), fabricationAllowed(dCal))
  check('an uncalibrated item cannot be "confirmed" away', setReviewStatus(dUnc, unc.review.find((r) => r.kind === 'uncalibrated')!.id, 'confirmed') === dUnc)
  for (const r of cal.review) dCal = setReviewStatus(dCal, r.id, r.kind === 'ocr-low-confidence' ? 'rejected' : 'confirmed')
  check('every item resolved → fabricationAllowed true, review flag cleared', fabricationAllowed(dCal).ok && !reviewRequired(dCal) && dCal.entities.every((e) => !e.src?.reviewRequired), fabricationAllowed(dCal))
  const dims = dimensionTexts(cal.entities)
  check('dimension check after calibration: 7000 / 3400 ok, 3600 not', dims.filter((d) => d.ok).map((d) => d.value).sort().join() === '3400,7000' && dims.some((d) => d.value === 3600 && !d.ok), dims.map((d) => [d.value, Math.round(d.measured), d.ok]))

  // ---- calibrating afterwards (CAD 2D): two points on a line of the drawing as it is (mm)
  const ref2: CalRef[] = [{ id: 'p', method: 'two-point', a: { x: 0, y: 0 }, b: { x: 1400, y: 0 }, measured: 1400, refDistance: 7000 }]
  const rc = recalibrate(dUnc, unc.source.id, ref2)
  check('recalibrate: drawing × 5, uncalibrated item gone, mismatch flagged, source calibrated', !!rc && near(rc.ratio, 5, 1e-9) && !rc.doc.provenance!.review.some((r) => r.kind === 'uncalibrated') && rc.doc.provenance!.review.some((r) => r.kind === 'ocr-dimension-mismatch' && r.ocrValue === 3600) && rc.doc.provenance!.sources[unc.source.id].status === 'calibrated' && rc.doc.entities.every((e) => !e.src?.unscaled), rc && rc.doc.provenance)

  // ---- OCR word classification (vectorize keeps uncertain words instead of dropping them)
  const box = { x0: 10, y0: 10, x1: 60, y1: 30 }
  const cls = [classifyWord('BẾP', 90, box, 1000, 800), classifyWord('BẾP', 40, box, 1000, 800), classifyWord('—', 90, box, 1000, 800), classifyWord('X', 90, { x0: 0, y0: 0, x1: 900, y1: 20 }, 1000, 800)]
  check('classifyWord: confident → keep, uncertain → review (not dropped), lines → drop', cls.join() === 'keep,review,drop,drop', cls)

  // ---- measured room survey
  const rect = (o: Partial<SurveyInput> = {}): SurveyInput => ({ name: 'R', sides: [4000, 3000, 4000, 3000], wallThickness: 200, ceilingHeight: 3300, tolerance: 10, ...o })
  const r1 = surveyRoom(rect({ diagonals: [{ from: 0, to: 2, length: 5000 }, { from: 1, to: 3, length: 5000 }] }))
  check('rectangle 4000 × 3000 with both diagonals 5000 → built from the diagonal, closes, square, 12 m², within tolerance', r1.ok && r1.method === 'diagonal' && near(r1.area, 12e6, 1) && near(r1.squareness, 0, 1e-6) && r1.withinTolerance && near(r1.diagonals[1].dev, 0, 1e-6), r1)
  const r2 = surveyRoom(rect({ diagonals: [{ from: 0, to: 2, length: 5030 }, { from: 1, to: 3, length: 5000 }] }))
  check('diagonal 5030 vs 5000 → out of square, second diagonal deviates beyond ±10 mm', r2.ok && (r2.squareness ?? 0) > 0.3 && Math.abs(r2.diagonals[1].dev) > 10 && !r2.withinTolerance, { sq: r2.squareness, dev: r2.diagonals[1].dev })
  const r3 = surveyRoom(rect({ sides: [4000, 3000, 4010, 3000] }))
  check('traverse 4000/3000/4010/3000 at 90° → misclosure 10 mm reported and distributed (polygon closed)', r3.ok && r3.method === 'traverse' && near(r3.closure, 10, 1e-6) && r3.pts.length === 4, r3.closure)
  const r4 = surveyRoom(rect({ sides: [4000, 3000, 4030, 3000], tolerance: 10 }))
  check('misclosure 30 mm > tolerance 10 → outside tolerance', r4.ok && !r4.withinTolerance && near(r4.closure, 30, 1e-6))
  const L = surveyRoom({ name: 'L', sides: [6000, 3000, 3000, 2000, 3000, 5000], angles: [90, 90, 90, 270, 90, 90], wallThickness: 200, ceilingHeight: 3000, tolerance: 5 })
  check('L-shaped room (one 270° corner) closes exactly, area 24 m²', L.ok && near(L.closure, 0, 1e-6) && near(L.area, 24e6, 1) && L.withinTolerance, { closure: L.closure, area: L.area })
  const tri = surveyRoom({ name: 'T', sides: [3000, 4000, 5000], wallThickness: 100, ceilingHeight: 2800, tolerance: 5 })
  check('triangle 3-4-5 → right angle, 6 m²', tri.ok && near(tri.area, 6e6, 1) && tri.angles.some((a) => near(a, 90, 1e-6)))
  check('impossible lengths → inconsistent, nothing drawn', !surveyRoom(rect({ sides: [1000, 1000, 5000], diagonals: [] })).ok)
  const outer = r1.outer
  check('outer wall face offset by the wall thickness (4400 × 3400)', near(Math.max(...outer.map((p) => p.x)) - Math.min(...outer.map((p) => p.x)), 4400, 1e-6) && near(Math.max(...outer.map((p) => p.y)) - Math.min(...outer.map((p) => p.y)), 3400, 1e-6))
  const lbl = { area: 'Area', height: 'H', doorMissing: '?' }
  const sv = buildSurvey(rect({ doors: [{ side: 0, offset: 500, width: null }] }), lbl)
  check('door without a width → missing measurement "door1.width", nothing guessed', sv.ok && sv.result.missing.includes('door1.width') && sv.review.some((r) => r.kind === 'missing-measurement' && r.key === 'door1.width'))
  if (sv.ok) {
    let d = addSource({ ...createBlankDocument('s.dwg', 1), entities: sv.entities }, sv.source, sv.review)
    check('survey with a missing measurement → fabrication blocked', !fabricationAllowed(d).ok && d.provenance!.sources[sv.source.id].status === 'measured')
    const rs = resurvey(d, sv.source.id, 'door1.width', 900, lbl)
    d = rs ? { ...d, entities: [...d.entities.filter((e) => !rs.erase.includes(e.id)), ...rs.add], provenance: rs.provenance } : d
    check('width entered → item resolved, door drawn (two jambs), fabrication allowed', !!rs && fabricationAllowed(d).ok && d.entities.filter((e) => e.layer === 'SURVEY-DOOR' && e.kind === 'line').length === 2, rs && rs.provenance.review)
  }

  return { all: cases.every((c) => c.ok), passed: cases.filter((c) => c.ok).length, total: cases.length, failed: cases.filter((c) => !c.ok) }
}

/** Queue resume: a crash in the middle of an apply step, an app restart, then resume — every side effect once. */
export async function queue() {
  const cases: Case[] = []
  const check = (name: string, ok: boolean, got?: unknown) => cases.push({ name, ok, got })
  const effects: Record<string, number> = {}
  let saved: AiJob | null = null
  const persist = (j: AiJob) => { saved = JSON.parse(JSON.stringify(j)) }
  const handlers = (crashAt?: string, crashAfterEffect = true): StepHandlers => ({
    save: persist,
    run: async (s) => {
      if (s.kind === 'apply') {
        if (s.id === crashAt && !crashAfterEffect) throw new Error('crash')
        effects[s.id] = (effects[s.id] ?? 0) + 1
        if (s.id === crashAt) throw new Error('crash')
        return { undo: { store: 'test', label: s.id } }
      }
      return { note: 'ok' }
    },
  })
  const steps = [{ id: 'c1', kind: 'compute' as const }, { id: 'a1', kind: 'apply' as const }, { id: 'a2', kind: 'apply' as const }, { id: 'a3', kind: 'apply' as const }]

  // 1. crash right after a2's side effect, before its checkpoint
  let j = createJob({ preset: 't', title: 't', steps, id: 'job-1', now: 1 })
  try { await runJob(j, handlers('a2')) } catch { /* the app died */ }
  check('checkpoint at the crash: a1 applied, a2 "applying"', !!saved && saved!.applied.includes('job-1:a1:0') && saved!.steps.find((s) => s.id === 'a2')!.status === 'applying', saved)
  j = recoverAfterRestart(saved!)
  check('after restart: a2 caught applying → "needs user" with the question (not re-applied)', j.status === 'needs-user' && openQuestions(j).some((q) => q.code === 'interrupted-apply'), j.questions)
  j = resolveInterrupted(j, 'a2', true)
  j = await runJob(j, handlers())
  check('resume: every side effect exactly once, job ready for review', effects.a1 === 1 && effects.a2 === 1 && effects.a3 === 1 && j.status === 'ready-for-review', { effects, status: j.status })
  check('resume skipped the applied steps by their idempotency keys', j.applied.length === 3 && j.steps.every((s) => s.status === 'done'), j.steps)
  j = await runJob(j, handlers())
  check('running the finished job again applies nothing', effects.a1 === 1 && effects.a2 === 1 && effects.a3 === 1, effects)

  // 2. crash before a2's side effect: the user says "not applied" → applied once on resume
  for (const k of Object.keys(effects)) delete effects[k]
  saved = null
  let k2 = createJob({ preset: 't', title: 't', steps, id: 'job-2', now: 1 })
  try { await runJob(k2, handlers('a2', false)) } catch { /* died */ }
  k2 = resolveInterrupted(recoverAfterRestart(saved!), 'a2', false)
  k2 = await runJob(k2, handlers())
  check('interrupted before the change, answered "not applied" → a2 applied once, a1 not again', effects.a1 === 1 && effects.a2 === 1 && effects.a3 === 1 && k2.status === 'ready-for-review', effects)

  // 3. crash between two checkpoints of compute steps → compute pending again, nothing applied twice
  for (const k of Object.keys(effects)) delete effects[k]
  saved = null
  let k3 = createJob({ preset: 't', title: 't', steps: [{ id: 'c1', kind: 'compute' }, { id: 'a1', kind: 'apply' }, { id: 'c2', kind: 'compute' }, { id: 'a2', kind: 'apply' }], id: 'job-3', now: 1 })
  const crashC2: StepHandlers = { save: persist, run: async (s) => { if (s.id === 'c2') throw new Error('crash'); if (s.kind === 'apply') effects[s.id] = (effects[s.id] ?? 0) + 1 } }
  try { await runJob(k3, crashC2) } catch { /* died */ }
  k3 = recoverAfterRestart(saved!)
  check('restart during a compute step → queued, step pending again (no question needed)', k3.status === 'queued' && k3.steps.find((s) => s.id === 'c2')!.status === 'pending' && !openQuestions(k3).length, k3)
  k3 = await runJob(k3, handlers())
  check('resume after compute crash: a1 once, a2 once', effects.a1 === 1 && effects.a2 === 1 && k3.status === 'ready-for-review', effects)

  // 4. V24-031: a required measurement is missing → needs user with the question, then continues with the answer
  let asked = 0
  let k4 = createJob({ preset: 'layout', title: 'layout', steps: [{ id: 'inputs', kind: 'compute' }, { id: 'apply', kind: 'apply' }], id: 'job-4', now: 1 })
  const needs: StepHandlers = {
    save: persist,
    run: async (s, job) => {
      if (s.id === 'inputs') {
        const w = job.questions.find((q) => q.key === 'door1.width')?.answer
        if (w === undefined) { asked++; return { questions: [{ key: 'door1.width', code: 'missing-measurement', unit: 'mm', params: { what: 'door 1 width' } }] } }
        return { note: `door1.width = ${w}` }
      }
      effects.layout = (effects.layout ?? 0) + 1
    },
  }
  k4 = await runJob(k4, needs)
  check('missing door width → job "needs user" with the question, nothing applied, no default width', k4.status === 'needs-user' && openQuestions(k4)[0]?.key === 'door1.width' && !effects.layout, k4)
  k4 = await runJob(k4, needs)
  check('still unanswered → stays parked (does not guess)', k4.status === 'needs-user' && !effects.layout && asked === 1)
  k4 = answer(k4, 'door1.width', 900)
  k4 = await runJob(k4, needs)
  check('answered 900 → continues and applies once', k4.status === 'ready-for-review' && effects.layout === 1 && k4.steps[0].note === 'door1.width = 900', k4.steps)

  return { all: cases.every((c) => c.ok), passed: cases.filter((c) => c.ok).length, total: cases.length, failed: cases.filter((c) => !c.ok) }
}
