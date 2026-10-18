/**
 * Interior cabinets → cut list → machine-aware nesting → CAM → post → parse → release gate, in one deterministic
 * function shared by Interior → Nesting & CNC and the one-command package (and the unit tests).
 *
 * The machine profile is an input BEFORE nesting: its clamps / no-go zones are reserved on the sheets, its
 * capabilities decide which operations are written (a 1-head router without drilling gets no drilling, a saw-only
 * machine gets no router paths), its ATC decides T… M6 vs one program per tool, its post writes the text, and its
 * envelope / codes / clamps go into the parser. Every stage feeds the job's hash chain.
 */
import { DEFAULT_EDGE_BAND, cutList, type Cabinet, type CutPart } from '../interior/model'
import { DEFAULT_NEST, nest, piecesOf, verifyNest, type NestResult, type NestSettings } from './nesting'
import { camSheet, type CamResult, type CamSettings } from './gcode'
import { assignHeads, capabilities, profileContentHash, releaseBlockers, toolsHash, type Assignment, type CommissioningRecord, type JobGateInput, type MachineProfile, type OperationKind } from './machine'
import { chainOf, isStale, jobStatus, validApproval, type Chain, type JobStatus, type ManufacturingJob, type StaleReport } from './job'
import { parseSequence, MOTION_ISSUES, type ParseResult } from './ncparse'
import { getPost, postFor, type Post } from './posts'
import type { NcProgram, ReleaseMeta } from './release'
import { hashOf } from '../lib/sha256'

export interface CamPrefsLike {
  stock: Record<string, { l: number; w: number }>
  trim: number
  web: number
  grain: boolean
  cnc: CamSettings
}

export interface InteriorCncInput {
  cabinets: Cabinet[]
  cam: CamPrefsLike
  /** The selected profile (null = none / LEGACY_UNASSIGNED). */
  machine: MachineProfile | null
  /** undefined = an old project that never chose (LEGACY_UNASSIGNED). */
  machineProfileId: string | null | undefined
  commissioning?: CommissioningRecord | null
  job: ManufacturingJob | null
  jobName: string
  /** Source drawing gate (cad/provenance fabricationAllowed), when the parts come from a known drawing. */
  sourceDrawing?: { file: string; ok: boolean } | null
}

export interface SheetCnc {
  cam: CamResult
  programs: NcProgram[]
  parses: ParseResult[]
}

export interface InteriorCnc {
  parts: CutPart[]
  nestSettings: NestSettings
  nest: NestResult
  nestErrors: string[]
  sheets: SheetCnc[]
  post: Post
  assignments: Assignment[]
  unsupported: { op: string; reason: string }[]
  chain: Chain
  stale: StaleReport
  gate: JobGateInput
  blockers: string[]
  status: JobStatus
  /** Geometry / motion problems of the simulation (the ✓ / ✗ of each program). */
  simErrors: number
  meta: ReleaseMeta
}

const grainedDecor = DEFAULT_NEST.grained

/** Cut list of all cabinets with the job's edge band thickness (when the cabinet has none of its own). */
export function jobParts(cabinets: Cabinet[], job: ManufacturingJob | null): { cabs: Cabinet[]; parts: CutPart[] } {
  const band = job?.edge_band_mm ?? DEFAULT_EDGE_BAND
  const cabs = cabinets.map((c) => (c.edgeBand === undefined ? { ...c, edgeBand: band } : c))
  return { cabs, parts: cabs.flatMap(cutList) }
}

export function interiorCnc(inp: InteriorCncInput): InteriorCnc {
  const m = inp.machine
  const { cabs, parts } = jobParts(inp.cabinets, inp.job)
  const post = (m && getPost(m.postprocessor.id)) || postFor(inp.cam.cnc.dialect)
  // head scheduling for the operations this CAM writes
  const reqs = [
    { operation_id: 'PROFILE', op: 'PROFILE' as OperationKind },
    { operation_id: 'DRILL_5', op: 'DRILL_VERTICAL' as OperationKind, diameter: 5 },
    { operation_id: 'DRILL_35', op: 'DRILL_VERTICAL' as OperationKind, diameter: 35 },
    { operation_id: 'BACK_REBATE', op: 'SLOT' as OperationKind },
  ]
  const assignments = m ? assignHeads(m, reqs) : []
  const a = (id: string) => assignments.find((x) => x.operation_id === id)
  const tool = (id: string) => {
    const x = a(id)
    return x?.tool ? { n: x.tool.number ?? null, d: x.tool.diameter_mm, head_id: x.head_id, tool_id: x.tool_id } : x ? { head_id: x.head_id } : undefined
  }
  const caps = m ? new Map(capabilities(m).map((c) => [c.op, c])) : null
  const allow = (op: OperationKind) => {
    const c = caps?.get(op)
    return c && c.state === 'unsupported' ? c.reason ?? 'NO_HEAD_FOR_OPERATION' : null
  }
  const cnc: CamSettings = { ...inp.cam.cnc, cutterD: tool('PROFILE')?.d ?? inp.cam.cnc.cutterD }
  const clamps = m?.fixtures.clamp_no_go_shapes ?? []
  const nestSettings: NestSettings = { ...DEFAULT_NEST, stock: inp.cam.stock, trim: inp.cam.trim, gap: cnc.cutterD + inp.cam.web, grained: inp.cam.grain ? grainedDecor : () => false, noGo: clamps }
  const pieces = piecesOf(cabs)
  const nr = nest(pieces, nestSettings)
  const nestErrors = verifyNest(nr, nestSettings)
  const measured = (mat: string) => inp.job?.stocks.find((s) => s.material === mat)?.measured_thickness_mm ?? null
  const hasShelves = (name: string) => (cabs.find((c) => c.name === name)?.shelves ?? 0) > 0
  const sheets: SheetCnc[] = nr.sheets.map((sh) => {
    const T = measured(sh.material)
    const cam = camSheet(sh, cnc, hasShelves, inp.jobName, {
      post, atc: m ? m.atc.supported : undefined, supportedCodes: m ? m.controller.supported_codes : null, clamps, clearance: m?.fixtures.safe_clearance_mm ?? 5,
      thickness: T, allow: m ? allow : undefined, tools: m ? { profile: tool('PROFILE'), pin: tool('DRILL_5'), cup: tool('DRILL_35') } : undefined,
    })
    const radius = new Map(cam.tools.map((t) => [t.n, t.d / 2]))
    const programs: NcProgram[] = cam.programs.map((p) => ({
      name: p.name, text: p.text,
      ctx: {
        dialect: post.dialect, dialectName: post.label, profileCodes: m ? m.controller.supported_codes : null, atc: m ? m.atc.supported : null, requireTlo: post.tlo,
        sheet: sh, margin: cnc.cutterD / 2 + 0.01, envelope: m?.work_envelope_mm ?? null, maxDepth: (T ?? sh.t) + cnc.breakthrough, stockT: T, allowance: Math.max(0.5, cnc.breakthrough),
        expectThrough: p.tools.includes(cam.tools[0].n) && cam.profiles.length > 0, clamps, clearance: 0, toolRadius: (n) => radius.get(n) ?? Math.max(...radius.values()), rapid: cnc.rapid,
      },
    }))
    return { cam, programs, parses: parseSequence(programs) }
  })
  // unsupported operations (skipped features), the back rebate called out as manual work
  const unsupported = [...new Map(sheets.flatMap((s) => s.cam.skipped).map((k) => [`${k.op}|${k.reason}`, { op: k.op, reason: k.op === 'SLOT' ? `GROOVE_NOT_MACHINED_MANUAL/${k.reason}` : k.reason }])).values()]
  const postIssues = [...new Set(sheets.flatMap((s) => s.cam.postIssues))]
  const mHash = m ? profileContentHash(m) : null
  const stocksUsed = [...new Set(nr.sheets.map((s) => `${s.material}|${s.t}`))].map((k) => {
    const [material, t] = k.split('|')
    const rec = inp.job?.stocks.find((s) => s.material === material)
    return { material, nominal_mm: Number(t), measured_thickness_mm: rec?.measured_thickness_mm ?? null, lot: rec?.lot ?? null }
  })
  const allPrograms = sheets.flatMap((s) => s.programs)
  const chain = chainOf({
    parts: parts.map((p) => ({ id: p.id, rev: p.rev, qty: p.qty })),
    stock: { stocks: stocksUsed, band: inp.job?.edge_band_mm ?? DEFAULT_EDGE_BAND, sizes: inp.cam.stock },
    machine: m ? { id: m.profile_id, revision: m.revision, hash: mHash } : { id: inp.machineProfileId ?? 'LEGACY_UNASSIGNED' },
    tools: toolsHash(m),
    nest: { trim: inp.cam.trim, web: inp.cam.web, grain: inp.cam.grain, gap: nestSettings.gap, placed: nr.sheets.map((s) => s.parts.map((p) => [p.id, p.x, p.y, p.rotated])) },
    cam: { cnc, ir: hashOf(sheets.map((s) => s.cam.ir)) },
    post: { id: post.id, version: post.version, sha256: post.sha256 },
    nc: allPrograms.map((p) => p.text),
  })
  const job = inp.job
  const recorded = job?.approval?.chain ?? job?.reviewed?.chain ?? null
  const stale = isStale(recorded, chain)
  const approval = job ? validApproval(job, chain) : null
  const ncIssues = [...sheets.flatMap((s) => s.parses.flatMap((r) => r.issues)), ...postIssues.map((code) => ({ code, line: 0, msg: code, block: true }))]
  const gate: JobGateInput = {
    machineProfileId: inp.machineProfileId === undefined ? undefined : (job?.machine_profile_id ?? inp.machineProfileId),
    machineProfileRevision: job?.machine_profile_revision ?? null,
    machineProfileHash: job?.machine_profile_hash ?? null,
    stocks: stocksUsed,
    sheets: nr.sheets.map((s) => ({ l: s.l, w: s.w, t: s.t })),
    edgeBandConfirmed: !!job?.edge_band_confirmed,
    stale: recorded ? stale : null,
    approvals: approval ? { operator: approval.operator, engineer: approval.engineer } : null,
    ncIssues: allPrograms.length ? ncIssues : null,
    unsupported,
    unplaced: nr.unplaced.map((p) => `${p.label} ${p.l}×${p.w}`),
    nestErrors,
    firstArticle: approval?.firstArticle ?? null,
    post: { id: post.id, version: post.version, sha256: post.sha256 },
    sourceDrawing: inp.sourceDrawing ?? null,
  }
  const blockers = releaseBlockers(m, gate, inp.commissioning ?? null)
  const simErrors = sheets.reduce((acc, s) => acc + s.parses.reduce((b, r) => b + r.issues.filter((i) => MOTION_ISSUES.has(i.code)).length, 0), 0)
  const status = job ? jobStatus(job, chain, allPrograms.length > 0) : inp.machineProfileId === undefined ? 'LEGACY_UNASSIGNED' : 'DRAFT'
  return {
    parts, nestSettings, nest: nr, nestErrors, sheets, post, assignments, unsupported, chain, stale, gate, blockers, status, simErrors,
    meta: { app: 'MD CAD AI STUDIO', job: { job_id: job?.job_id ?? `${inp.jobName} (no job)`, revision: job?.revision ?? 0, part_revision_hash: hashOf(parts.map((p) => [p.id, p.rev])), chain }, parts: parts.map((p) => ({ id: p.id, rev: p.rev })) },
  }
}
