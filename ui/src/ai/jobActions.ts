/**
 * AI job queue ↔ the workspaces (UI side of ai/jobs.ts): saving checkpoints, undoing applied steps through each
 * workspace's own undo (only when that step is still the last one there — never undoing someone else's edit),
 * approving / rejecting a finished job, and the input check of the room-layout preset (V24-031).
 */
import { useAiStudio } from '../state/aiStudio'
import { useCad } from '../state/cad'
import { useBim } from '../state/bim'
import { useInterior } from '../state/interior'
import { useCivil } from '../state/civil'
import { useMep } from '../state/mep'
import { archive, createJob, needUser, readyForReview, unapply, type AiJob, type JobQuestion } from './jobs'
import { fabricationAllowed } from '../cad/provenance'
import type { CadDocument } from '../cad/types'

export const getJob = (id: string | null | undefined) => (id ? (useAiStudio.getState().jobs.find((j) => j.id === id) ?? null) : null)
export const saveJob = (j: AiJob) => useAiStudio.getState().saveJob(j)

type Undoer = { getState: () => { undoStack: { label: string }[]; undo: () => string | null } }
const STORES: Record<string, Undoer> = { bim: useBim as unknown as Undoer, interior: useInterior as unknown as Undoer, civil: useCivil as unknown as Undoer, mep: useMep as unknown as Undoer }

/** Undoes the job's last applied step. ok=false (and nothing changed) when other edits came after it. */
export function undoLast(j: AiJob): { ok: boolean; label: string; job: AiJob } {
  const u = j.undo?.at(-1)
  if (!u) return { ok: false, label: '', job: j }
  // the step the undo entry belongs to: the last applied apply step
  const step = [...j.steps].reverse().find((s) => s.kind === 'apply' && j.applied.includes(s.key))
  if (u.store === 'cad-doc') {
    if (u.ref && useCad.getState().tabs.includes(u.ref)) useCad.getState().closeTab(u.ref)
  } else {
    const st = STORES[u.store]
    if (!st) return { ok: false, label: u.label, job: j }
    if (st.getState().undoStack.at(-1)?.label !== u.label) return { ok: false, label: u.label, job: j }
    st.getState().undo()
  }
  const job = step ? unapply(j, step.id) : { ...j, undo: j.undo?.slice(0, -1) }
  saveJob(job)
  return { ok: true, label: u.label, job }
}

/** Reject: every applied step undone (newest first), then archived as rejected. Stops at the first that cannot. */
export function rejectJob(j: AiJob): { ok: boolean; label?: string; job: AiJob } {
  let k = j
  while (k.undo?.length) {
    const r = undoLast(k)
    if (!r.ok) return { ok: false, label: r.label, job: k }
    k = r.job
  }
  k = archive(k, 'rejected')
  saveJob(k)
  return { ok: true, job: k }
}

export function approveJob(j: AiJob): AiJob {
  const k = archive(j, 'approved')
  saveJob(k)
  return k
}

/** Open uncalibrated image / PDF sources of a drawing (what a job must ask about instead of guessing a scale). */
export const uncalibrated = (d: CadDocument | null | undefined) => Object.values(d?.provenance?.sources ?? {}).filter((s) => s.calibration === null && (s.kind === 'image' || s.kind === 'pdf'))

/**
 * Room-layout preset, input stage: the measured rooms of the drawing must have every measurement the layout
 * needs (ceiling height, every door's position and width). Missing → 'needs user' with one question each.
 */
export function checkLayoutInputs(doc: CadDocument | null, title: string, existing: AiJob | null, post: (rooms: number, blocked: boolean) => string): AiJob {
  let j = existing ?? createJob({ preset: 'layout', title, steps: [{ id: 'inputs', kind: 'compute' }, { id: 'layout', kind: 'compute' }], input: { docId: doc?.id, file: doc?.name } })
  if (!doc) return needUser(j, [{ key: 'open-drawing', code: 'open-drawing' }])
  const surveys = Object.values(doc.provenance?.sources ?? {}).filter((s) => s.kind === 'survey' && s.survey)
  const q: JobQuestion[] = []
  if (!surveys.length) q.push({ key: 'survey', code: 'missing-measurement', params: { what: 'survey' } })
  for (const s of surveys) for (const key of s.survey!.missing) q.push({ key: `${s.id}|${key}`, code: 'missing-measurement', unit: 'mm', params: { what: key, room: s.file } })
  for (const s of uncalibrated(doc)) q.push({ key: `cal|${s.id}`, code: 'calibration-required', params: { file: s.file } })
  // answered questions whose measurement is now in the drawing are dropped; the rest stay open
  j = { ...j, questions: j.questions.filter((x) => q.some((y) => y.key === x.key) && x.answer === undefined), steps: j.steps.map((s) => (s.id === 'inputs' ? { ...s, status: q.length ? ('pending' as const) : ('done' as const) } : s)) }
  if (q.length) return needUser(j, q)
  const gate = fabricationAllowed(doc)
  return readyForReview({ ...j, questions: [] }, [post(surveys.length, !gate.ok)])
}
