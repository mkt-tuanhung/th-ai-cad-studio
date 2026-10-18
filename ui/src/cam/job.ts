/**
 * Manufacturing job (schema: manufacturing_job.schema.json v2.2) with a chained content-hash record.
 *
 * The machine profile (id + revision + content hash) is chosen BEFORE nesting / CAM and pinned on the job. Every
 * stage of the chain hashes its own input together with the previous stage's hash:
 *   parts → stock → machine → tools → nest → cam → post → nc
 * so a change anywhere upstream (cabinet width, measured thickness, another machine, a tool offset, nest
 * settings, CAM settings, post version, NC bytes) changes every hash downstream. `isStale()` compares the chain
 * recorded at review / approval with the current one: the first stage that differs and everything after it are
 * STALE, and the job needs a recompute and a new approval. A PRODUCTION_RELEASED record is frozen; changing
 * anything afterwards needs a new job revision (`forkJob`).
 */
import { hashOf, sha256 } from '../lib/sha256'

export type JobStatus = 'LEGACY_UNASSIGNED' | 'DRAFT' | 'PARTS_READY' | 'NESTED' | 'CAM_PLANNED' | 'POSTED_FOR_REVIEW' | 'VALIDATED' | 'PRODUCTION_RELEASED' | 'STALE'
export const STAGES = ['parts', 'stock', 'machine', 'tools', 'nest', 'cam', 'post', 'nc'] as const
export type Stage = (typeof STAGES)[number]
export type Chain = Record<Stage, string>

/** The inputs of every stage (any JSON-able data; `nc` is the exact text of the programs, in order). */
export interface ChainInputs {
  parts: unknown
  stock: unknown
  machine: unknown
  tools: unknown
  nest: unknown
  cam: unknown
  post: unknown
  nc: string[]
}

export function chainOf(inp: ChainInputs): Chain {
  const out = {} as Chain
  let prev = ''
  for (const st of STAGES) {
    prev = st === 'nc' ? ncStageHash(prev, inp.nc) : sha256(`${st}|${prev}|${hashOf(inp[st])}`)
    out[st] = prev
  }
  return out
}

/** The `nc` stage of a chain from the post stage's hash and the exact program texts (checked again at export). */
export const ncStageHash = (postStage: string, texts: string[]) => sha256(`nc|${postStage}|${sha256(texts.join('\u0000'))}`)

export interface StaleReport {
  stale: boolean
  /** First stage that changed. */
  from: Stage | null
  stages: Record<Stage, 'CURRENT' | 'STALE' | 'MISSING'>
}

/** Recorded vs current chain: everything from the first changed stage downstream is STALE. */
export function isStale(recorded: Chain | null | undefined, current: Chain): StaleReport {
  const stages = {} as StaleReport['stages']
  if (!recorded) {
    for (const st of STAGES) stages[st] = 'MISSING'
    return { stale: false, from: null, stages }
  }
  let from: Stage | null = null
  for (const st of STAGES) {
    if (!from && recorded[st] !== current[st]) from = st
    stages[st] = from ? 'STALE' : 'CURRENT'
  }
  return { stale: !!from, from, stages }
}

export interface StockRecord {
  material: string
  nominal_mm: number
  measured_thickness_mm: number | null
  lot: string | null
  length_mm: number | null
  width_mm: number | null
  grain_axis: 'X' | 'Y' | 'NONE' | 'UNSPECIFIED'
  face_a: string | null
}

export interface Approval {
  operator: string
  engineer: string
  at: string
  /** The chain the approval was given for; it is valid only while the chain is unchanged. */
  chain: Chain
  /** First article result recorded with the approval, if any. */
  firstArticle?: 'PASS' | 'FAIL' | null
}

export interface ReleaseRecord {
  job_id: string
  job_revision: number
  at: string
  machine_profile_id: string
  machine_profile_revision: number
  machine_profile_hash: string
  post: { id: string; version: string; sha256: string }
  chain: Chain
  files: { name: string; sha256: string; bytes: number }[]
  approvals: { operator: string; engineer: string; at: string }
}

export interface ManufacturingJob {
  job_id: string
  /** Job revision: + 1 on every fork after a release. */
  revision: number
  part_revision_hash: string
  machine_profile_id: string | null
  machine_profile_revision: number | null
  machine_profile_hash: string | null
  machine_selected: boolean
  status: JobStatus
  stock: StockRecord
  /** Every board of the job (the schema's `stock` is the first one). */
  stocks: StockRecord[]
  edge_band_mm: number
  edge_band_confirmed: boolean
  head_assignments: { operation_id: string; head_id: string; tool_id: string }[]
  controller_dialect: string | null
  post_hash: string | null
  validation: { fixture_collision_pass: boolean; safe_z_pass: boolean; dialect_parse_pass: boolean; nc_backplot_pass: boolean; revision_current: boolean }
  nc_release: { allowed: boolean; approval_state: 'BLOCKED' | 'PENDING_REVIEW' | 'RELEASED'; sha256: string | null }
  /** Chain recorded at the last review (preview export or approval). */
  reviewed: { chain: Chain; at: string } | null
  approval: Approval | null
  released: ReleaseRecord | null
}

export function newJob(id: string, machine: { profile_id: string; revision: number; hash: string } | null | undefined): ManufacturingJob {
  const stock: StockRecord = { material: '', nominal_mm: 0, measured_thickness_mm: null, lot: null, length_mm: null, width_mm: null, grain_axis: 'UNSPECIFIED', face_a: null }
  return {
    job_id: id, revision: 1, part_revision_hash: 'UNSET', machine_profile_id: machine?.profile_id ?? null, machine_profile_revision: machine?.revision ?? null, machine_profile_hash: machine?.hash ?? null,
    machine_selected: !!machine, status: machine === undefined ? 'LEGACY_UNASSIGNED' : 'DRAFT', stock, stocks: [], edge_band_mm: 1, edge_band_confirmed: false, head_assignments: [], controller_dialect: null, post_hash: null,
    validation: { fixture_collision_pass: false, safe_z_pass: false, dialect_parse_pass: false, nc_backplot_pass: false, revision_current: false },
    nc_release: { allowed: false, approval_state: 'BLOCKED', sha256: null }, reviewed: null, approval: null, released: null,
  }
}

/** Pin another machine: the job keeps its parts but every downstream stage becomes STALE (new chain). */
export function selectMachine(job: ManufacturingJob, machine: { profile_id: string; revision: number; hash: string } | null): ManufacturingJob {
  if (job.status === 'PRODUCTION_RELEASED') job = forkJob(job)
  return { ...job, machine_profile_id: machine?.profile_id ?? null, machine_profile_revision: machine?.revision ?? null, machine_profile_hash: machine?.hash ?? null, machine_selected: !!machine, status: machine ? job.status === 'LEGACY_UNASSIGNED' ? 'DRAFT' : job.status : job.status === 'LEGACY_UNASSIGNED' ? 'LEGACY_UNASSIGNED' : 'DRAFT' }
}

/** The approval still valid for the current chain (null when missing or stale). */
export const validApproval = (job: ManufacturingJob, current: Chain): Approval | null => (job.approval && !isStale(job.approval.chain, current).stale ? job.approval : null)

/** Status shown for the job given the current chain. */
export function jobStatus(job: ManufacturingJob, current: Chain | null, hasNc: boolean): JobStatus {
  if (job.status === 'PRODUCTION_RELEASED') return current && job.released && isStale(job.released.chain, current).stale ? 'STALE' : 'PRODUCTION_RELEASED'
  if (!job.machine_selected) return job.status === 'LEGACY_UNASSIGNED' ? 'LEGACY_UNASSIGNED' : 'DRAFT'
  if (!current) return 'PARTS_READY'
  const rec = job.approval?.chain ?? job.reviewed?.chain ?? null
  if (rec && isStale(rec, current).stale) return 'STALE'
  if (validApproval(job, current)) return 'VALIDATED'
  return hasNc ? 'POSTED_FOR_REVIEW' : 'CAM_PLANNED'
}

/** Approve (operator + engineer names) for the current chain. A released job cannot be approved again. */
export function approveJob(job: ManufacturingJob, current: Chain, who: { operator: string; engineer: string; firstArticle?: 'PASS' | 'FAIL' | null }, at = new Date().toISOString()): ManufacturingJob {
  if (job.status === 'PRODUCTION_RELEASED') throw new Error('RELEASED_JOB_IS_IMMUTABLE')
  if (!who.operator.trim() || !who.engineer.trim()) throw new Error('SIGNOFF_NAMES_REQUIRED')
  return { ...job, approval: { operator: who.operator.trim(), engineer: who.engineer.trim(), at, chain: current, firstArticle: who.firstArticle ?? null }, reviewed: { chain: current, at } }
}

/** Remember the chain of the last preview export (so a later change shows STALE). */
export const markReviewed = (job: ManufacturingJob, current: Chain, at = new Date().toISOString()): ManufacturingJob => (job.status === 'PRODUCTION_RELEASED' ? job : { ...job, reviewed: { chain: current, at } })

const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o as object)) deepFreeze(v)
  }
  return o
}

/** Freeze a job as PRODUCTION_RELEASED (called by the production export only, after the gate passed). */
export function releaseJob(job: ManufacturingJob, rec: ReleaseRecord): ManufacturingJob {
  if (job.status === 'PRODUCTION_RELEASED') throw new Error('RELEASED_JOB_IS_IMMUTABLE')
  return deepFreeze({ ...structuredClone(job), status: 'PRODUCTION_RELEASED' as JobStatus, released: structuredClone(rec), nc_release: { allowed: true, approval_state: 'RELEASED' as const, sha256: sha256(rec.files.map((f) => f.sha256).join('')) } })
}

/** A new revision of a released job (the release stays as it was). */
export function forkJob(job: ManufacturingJob): ManufacturingJob {
  const c = structuredClone(job) as ManufacturingJob
  return { ...c, revision: job.revision + 1, status: job.machine_selected ? 'DRAFT' : 'LEGACY_UNASSIGNED', approval: null, reviewed: null, released: null, nc_release: { allowed: false, approval_state: 'BLOCKED', sha256: null } }
}
