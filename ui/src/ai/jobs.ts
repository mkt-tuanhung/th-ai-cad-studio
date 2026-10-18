/**
 * AI job queue with step checkpoints (v2.4 SP30, V24-031 / V24-032). Pure functions over plain data — the store
 * (state/aiStudio.ts) persists the jobs, so a job interrupted by an app restart resumes at its last checkpoint.
 *
 *  - Steps are 'compute' (pure, may run again), 'apply' (changes a model; done once — its idempotency key is
 *    recorded in `applied` and a resumed run skips it) or 'user' (waits for an answer / approval).
 *  - An apply step is marked 'applying' (checkpoint) before its side effect and 'done' + key recorded right after.
 *    Found 'applying' after a restart, nobody knows whether the change landed: the job goes to 'needs user' with
 *    that question instead of applying it a second time.
 *  - A required measurement that is missing puts the job in 'needs user' with the question; nothing is guessed.
 */
export type JobStatus = 'queued' | 'in-progress' | 'needs-user' | 'ready-for-review' | 'failed' | 'archived'
export type StepStatus = 'pending' | 'running' | 'applying' | 'done' | 'skipped' | 'failed'
export type StepKind = 'compute' | 'apply' | 'user'

export interface JobStep {
  id: string
  kind: StepKind
  status: StepStatus
  /** Idempotency key of an apply step (job id + step id + input revision). */
  key: string
  note?: string
  at?: number
}

export interface JobQuestion {
  key: string
  /** i18n code of the question (the UI words it) and its parameters. */
  code: 'missing-measurement' | 'calibration-required' | 'interrupted-apply' | 'reselect-file' | 'open-drawing' | 'review-required'
  params?: Record<string, string | number>
  unit?: 'mm'
  answer?: string | number | boolean
}

export interface AiJob {
  id: string
  preset: string
  title: string
  status: JobStatus
  steps: JobStep[]
  /** Idempotency keys of apply steps already done. */
  applied: string[]
  questions: JobQuestion[]
  input: { docId?: string; file?: string; files?: string[]; rev?: number }
  /** What the job produced / will produce (shown as pre / post preview). */
  pre?: string[]
  post?: string[]
  /** How the job ended once archived. */
  outcome?: 'approved' | 'rejected' | 'cancelled' | 'done'
  /** Applied changes, for Undo: store + undo label. */
  undo?: { store: string; label: string; ref?: string }[]
  error?: string
  /** Set when restored after an app restart in a state that had to be repaired. */
  resumed?: number
  createdAt: number
  updatedAt: number
}

let seq = 0
export const jobId = () => `job-${Date.now().toString(36)}-${(++seq).toString(36)}`

export function createJob(p: { preset: string; title: string; steps: { id: string; kind: StepKind }[]; input?: AiJob['input']; pre?: string[]; id?: string; now?: number }): AiJob {
  const id = p.id ?? jobId()
  const now = p.now ?? Date.now()
  const rev = p.input?.rev ?? 0
  return {
    id, preset: p.preset, title: p.title, status: 'queued', applied: [], questions: [], input: p.input ?? {}, pre: p.pre, createdAt: now, updatedAt: now,
    steps: p.steps.map((s) => ({ id: s.id, kind: s.kind, status: 'pending', key: `${id}:${s.id}:${rev}` })),
  }
}

const touch = (j: AiJob, patch: Partial<AiJob>): AiJob => ({ ...j, ...patch, updatedAt: Date.now() })
const setStep = (j: AiJob, id: string, patch: Partial<JobStep>): AiJob => touch(j, { steps: j.steps.map((s) => (s.id === id ? { ...s, ...patch, at: Date.now() } : s)) })

export const stepOf = (j: AiJob, id: string) => j.steps.find((s) => s.id === id)
export const isApplied = (j: AiJob, id: string) => { const s = stepOf(j, id); return !!s && j.applied.includes(s.key) }

export function startStep(j: AiJob, id: string): AiJob {
  return setStep({ ...j, status: j.status === 'archived' ? j.status : 'in-progress' }, id, { status: 'running' })
}
export function finishStep(j: AiJob, id: string, note?: string, status: 'done' | 'skipped' = 'done'): AiJob {
  return setStep(j, id, { status, note })
}
/** Checkpoint before an apply step's side effect. */
export function beginApply(j: AiJob, id: string): AiJob {
  return setStep({ ...j, status: 'in-progress' }, id, { status: 'applying' })
}
/** Checkpoint right after the side effect: step done, key recorded (never applied again). */
export function markApplied(j: AiJob, id: string, undo?: { store: string; label: string; ref?: string }, note?: string): AiJob {
  const s = stepOf(j, id)
  if (!s) return j
  const k = setStep(j, id, { status: 'done', note })
  return touch(k, { applied: k.applied.includes(s.key) ? k.applied : [...k.applied, s.key], undo: undo ? [...(j.undo ?? []), undo] : j.undo })
}
export function failJob(j: AiJob, error: string, stepId?: string): AiJob {
  const k = stepId ? setStep(j, stepId, { status: 'failed', note: error }) : j
  return touch(k, { status: 'failed', error })
}
export function needUser(j: AiJob, questions: JobQuestion[]): AiJob {
  const keys = new Set(questions.map((q) => q.key))
  return touch(j, { status: 'needs-user', questions: [...j.questions.filter((q) => !keys.has(q.key)), ...questions] })
}
export function answer(j: AiJob, key: string, value: string | number | boolean): AiJob {
  const questions = j.questions.map((q) => (q.key === key ? { ...q, answer: value } : q))
  const open = questions.some((q) => q.answer === undefined)
  return touch(j, { questions, status: open ? 'needs-user' : j.status === 'needs-user' ? 'queued' : j.status })
}
export const openQuestions = (j: AiJob) => j.questions.filter((q) => q.answer === undefined)
export function readyForReview(j: AiJob, post?: string[]): AiJob {
  return touch(j, { status: 'ready-for-review', post: post ?? j.post })
}
export function archive(j: AiJob, outcome: NonNullable<AiJob['outcome']>): AiJob {
  return touch(j, { status: 'archived', outcome })
}
/** Undo of applied steps: the step goes back to pending and its key is forgotten (it may be applied again). */
export function unapply(j: AiJob, id: string): AiJob {
  const s = stepOf(j, id)
  if (!s) return j
  return touch(setStep(j, id, { status: 'pending', note: undefined }), { applied: j.applied.filter((k) => k !== s.key), undo: (j.undo ?? []).slice(0, -1) })
}

/**
 * After an app restart: a running compute step is just pending again (it is pure); an apply step caught
 * 'applying' becomes a question for the user (applied or not?); an in-progress job is queued for resume.
 */
export function recoverAfterRestart(j: AiJob): AiJob {
  if (j.status === 'archived' || j.status === 'failed') return j
  let k = j
  const questions: JobQuestion[] = []
  for (const s of j.steps) {
    if (s.status === 'running') k = setStep(k, s.id, { status: 'pending', note: 'interrupted' })
    if (s.status === 'applying') {
      k = setStep(k, s.id, { status: 'pending', note: 'interrupted while applying' })
      questions.push({ key: `applied:${s.id}`, code: 'interrupted-apply', params: { step: s.id } })
    }
  }
  if (k === j && j.status !== 'in-progress') return j
  k = touch(k, { resumed: Date.now(), status: questions.length ? 'needs-user' : j.status === 'in-progress' ? 'queued' : j.status })
  return questions.length ? needUser(k, questions) : k
}

/** The user's answer to an interrupted apply: true = it was applied (record the key), false = run it again. */
export function resolveInterrupted(j: AiJob, stepId: string, applied: boolean): AiJob {
  let k = answer(j, `applied:${stepId}`, applied)
  if (applied) k = markApplied(k, stepId)
  return k
}

export interface StepHandlers {
  /** Runs a step (compute: returns a note; apply: performs the change and returns undo info). Throwing fails the job. */
  run: (step: JobStep, job: AiJob) => Promise<{ note?: string; undo?: { store: string; label: string; ref?: string }; skip?: boolean; questions?: JobQuestion[] } | void>
  /** Persists the job (called at every checkpoint). */
  save: (job: AiJob) => void
  /** Stop before this step (e.g. an apply step that needs approval first). */
  stopBefore?: (step: JobStep, job: AiJob) => boolean
}

/**
 * Runs a job from its first unfinished step. Apply steps whose key is in `applied` are skipped (idempotent resume);
 * a step returning questions parks the job in 'needs user'. Returns the job at its last checkpoint.
 */
export async function runJob(job: AiJob, h: StepHandlers): Promise<AiJob> {
  let j = job
  if (openQuestions(j).length) return j
  for (const s of j.steps) {
    const cur = stepOf(j, s.id)!
    if (cur.status === 'done' || cur.status === 'skipped') continue
    if (cur.kind === 'apply' && j.applied.includes(cur.key)) {
      j = finishStep(j, cur.id, 'already applied — skipped', 'done')
      h.save(j)
      continue
    }
    if (h.stopBefore?.(cur, j)) {
      j = readyForReview(j)
      h.save(j)
      return j
    }
    j = cur.kind === 'apply' ? beginApply(j, cur.id) : startStep(j, cur.id)
    h.save(j)
    let r: Awaited<ReturnType<StepHandlers['run']>>
    try {
      r = await h.run(stepOf(j, cur.id)!, j)
    } catch (e) {
      // a crash between the checkpoints leaves the job as it was saved last (the restart path)
      if ((e as Error)?.message === 'crash') throw e
      j = failJob(j, (e as Error)?.message ?? String(e), cur.id)
      h.save(j)
      return j
    }
    if (r?.questions?.length) {
      j = needUser(setStep(j, cur.id, { status: 'pending' }), r.questions)
      h.save(j)
      return j
    }
    j = cur.kind === 'apply' ? markApplied(j, cur.id, r?.undo, r?.note) : finishStep(j, cur.id, r?.note, r?.skip ? 'skipped' : 'done')
    h.save(j)
  }
  j = readyForReview(j)
  h.save(j)
  return j
}

/** A resumed run recomputes its pure steps (their results are not persisted); apply steps keep their state. */
export function restartCompute(j: AiJob): AiJob {
  return touch(j, { status: 'in-progress', steps: j.steps.map((s) => (s.kind === 'compute' ? { ...s, status: 'pending' as const, note: undefined } : s)) })
}
/** One step failed (the job goes on — e.g. one model rejected by its validation while the others apply). */
export function stepFailed(j: AiJob, id: string, note: string): AiJob {
  return setStep(j, id, { status: 'failed', note })
}

export const STATUS_ORDER: JobStatus[] = ['needs-user', 'in-progress', 'queued', 'ready-for-review', 'failed', 'archived']
