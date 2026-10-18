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
import { sawCutList } from './posts/sawCutList'
import { hardwarePlan, type HwPlan } from './hardware'
import { cutSequenceCsv, cuttingListCsv, guillotineNest, verifyAll, type GuillotineResult, type GuillotineSettings } from './guillotine'
import type { NcProgram, ReleaseMeta } from './release'
import { hashOf } from '../lib/sha256'
import { manufacturableCabinet } from '../interior/production'
import type { InteriorDoc } from '../state/interior'

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
  /** The interior document the cabinets belong to (their furniture items' dimension sources count too). */
  doc?: InteriorDoc
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
  /** Hardware drilling plans per cabinet (cam/hardware.ts). */
  hardware: HwPlan[]
  /** Panel saw (PANEL_SAW profile): guillotine patterns and the files they write (no router programs). */
  saw?: GuillotineResult
  sawFiles?: { name: string; text: string }[]
  /** Operations this machine does not do and that belong to another machine (panel saw: drilling, grooves). */
  otherMachine?: { op: string; reason: string }[]
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
  const measured = (mat: string) => inp.job?.stocks.find((s) => s.material === mat)?.measured_thickness_mm ?? null
  // hardware (hinges / slides / connectors) → drilling plans, validated against the measured boards
  const plans = new Map(cabs.map((c) => [c.name, hardwarePlan(c, { shelfPins: inp.cam.cnc.shelfPins, thickness: { board: measured(c.board), front: measured(c.front) } })]))
  const hwIssues = [...new Set([...plans.values()].flatMap((p) => p.issues))]
  const extraD = [...new Set([...plans.values()].flatMap((p) => p.holes.filter((h) => h.op === 'DRILL_VERTICAL' && h.d !== 5 && h.d !== 35).map((h) => h.d)))].sort((x, y) => x - y)
  if (m?.machine_type === 'PANEL_SAW') return panelSawJob(inp, m, cabs, parts, hwIssues)
  // head scheduling for the operations this CAM writes
  const reqs = [
    { operation_id: 'PROFILE', op: 'PROFILE' as OperationKind },
    { operation_id: 'DRILL_5', op: 'DRILL_VERTICAL' as OperationKind, diameter: 5 },
    { operation_id: 'DRILL_35', op: 'DRILL_VERTICAL' as OperationKind, diameter: 35 },
    { operation_id: 'BACK_REBATE', op: 'SLOT' as OperationKind },
    ...extraD.map((d) => ({ operation_id: `DRILL_${d}`, op: 'DRILL_VERTICAL' as OperationKind, diameter: d })),
    { operation_id: 'SAW', op: 'SAW_CUT' as OperationKind },
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
  const hasShelves = (name: string) => (cabs.find((c) => c.name === name)?.shelves ?? 0) > 0
  // router saw unit: only when SAW_CUT is available (commissioned, kerf + orientation known)
  const sawA = a('SAW')
  const sawTool = m && sawA?.status !== 'UNSUPPORTED' && caps?.get('SAW_CUT')?.state === 'available' ? m.heads.find((h) => h.head_id === sawA?.head_id)?.tools.find((t) => t.kind === 'SAW_BLADE') : undefined
  const saw = m && sawTool && m.ext?.saw?.kerf_mm && m.ext.saw.orientation ? { n: sawTool.number ?? 90, d: sawTool.diameter_mm ?? m.ext.saw.blade_diameter_mm ?? 0, kerf: m.ext.saw.kerf_mm, orientation: m.ext.saw.orientation, rpm: Math.min(cnc.rpm, 6000), feed: Math.min(cnc.feed, 6000), head_id: sawA?.head_id, tool_id: sawTool.tool_id } : null
  const opts0 = { atc: m ? m.atc.supported : false, supportedCodes: m ? m.controller.supported_codes : null, ext: m?.ext ?? null }
  const requireTlo = post.tloFor ? post.tloFor(opts0) : post.tlo
  // a proprietary controller (Biesse / Homag / SCM…): the vendor CAM writes the program from the per-part DXF
  const vendorCam = !!m && (m.ext?.controller_family === 'PROPRIETARY' || (!getPost(m.postprocessor.id) && !!m.ext?.native_formats?.length))
  const sheets: SheetCnc[] = vendorCam ? [] : nr.sheets.map((sh) => {
    const T = measured(sh.material)
    const cam = camSheet(sh, cnc, hasShelves, inp.jobName, {
      post, atc: m ? m.atc.supported : undefined, supportedCodes: m ? m.controller.supported_codes : null, clamps, clearance: m?.fixtures.safe_clearance_mm ?? 5,
      thickness: T, allow: m ? allow : undefined,
      tools: m ? { profile: tool('PROFILE'), pin: tool('DRILL_5'), cup: tool('DRILL_35'), drills: Object.fromEntries(extraD.map((d) => [String(d), tool(`DRILL_${d}`)])) } : undefined,
      hardware: (name) => plans.get(name), saw, ext: m?.ext ?? null,
    })
    const radius = new Map(cam.tools.map((t) => [t.n, t.d / 2]))
    const programs: NcProgram[] = cam.programs.map((p) => ({
      name: p.name, text: p.text,
      ctx: {
        dialect: post.dialect, dialectName: post.label, profileCodes: m ? m.controller.supported_codes : null, atc: m ? m.atc.supported : null, requireTlo, units: post.unitsFor ? post.unitsFor(opts0) : post.units,
        sheet: sh, margin: saw && cam.sawLines?.length ? saw.d / 2 + 3 : cnc.cutterD / 2 + 0.01, envelope: m?.work_envelope_mm ?? null, maxDepth: (T ?? sh.t) + cnc.breakthrough, stockT: T, allowance: Math.max(0.5, cnc.breakthrough),
        expectThrough: p.tools.includes(cam.tools[0].n) && cam.profiles.length > 0, clamps, clearance: 0, toolRadius: (n) => radius.get(n) ?? Math.max(...radius.values()), rapid: cnc.rapid,
      },
    }))
    return { cam, programs, parses: parseSequence(programs) }
  })
  // unsupported operations (skipped features), the back rebate called out as manual work
  const unsupported = [...new Map(sheets.flatMap((s) => s.cam.skipped).map((k) => [`${k.op}|${k.reason}`, { op: k.op, reason: k.op === 'SLOT' ? `GROOVE_NOT_MACHINED_MANUAL/${k.reason}` : k.reason }])).values()]
  if (vendorCam) unsupported.push({ op: 'PROFILE', reason: 'VENDOR_CAM_GENERATES_PROGRAM' })
  // an operation the programs use whose tool is not registered on the machine (the preview used the CAM settings
  // tool): production would call a tool number the machine does not have
  if (m) {
    const used = new Set<string>()
    for (const s of sheets) {
      if (s.cam.ir.blocks.some((b) => b.op === 'PROFILE' || b.op === 'SLOT')) used.add('PROFILE')
      for (const h of s.cam.holes) used.add(`DRILL_${h.d}`)
      if (s.cam.sawLines?.length) used.add('SAW')
    }
    for (const x of assignments) if (used.has(x.operation_id) && x.status === 'PENDING' && !x.tool) unsupported.push({ op: x.op, reason: `TOOL_NOT_ON_MACHINE/${x.reasons.join('/')}` })
  }
  const postIssues = [...new Set(sheets.flatMap((s) => s.cam.postIssues))]
  const allPrograms = sheets.flatMap((s) => s.programs)
  const ncIssues = [...sheets.flatMap((s) => s.parses.flatMap((r) => r.issues)), ...postIssues.map((code) => ({ code, line: 0, msg: code, block: true }))]
  const tail = jobTail(inp, m, cabs, parts, post, {
    stockSheets: nr.sheets,
    nest: { trim: inp.cam.trim, web: inp.cam.web, grain: inp.cam.grain, gap: nestSettings.gap, placed: nr.sheets.map((s) => s.parts.map((p) => [p.id, p.x, p.y, p.rotated])) },
    cam: { cnc, ir: hashOf(sheets.map((s) => s.cam.ir)) },
    nc: allPrograms.map((p) => p.text),
    ncIssues: allPrograms.length ? ncIssues : null,
    unsupported, unplaced: nr.unplaced, nestErrors, hwIssues, sawErrors: null,
  })
  const simErrors = sheets.reduce((acc, s) => acc + s.parses.reduce((b, r) => b + r.issues.filter((i) => MOTION_ISSUES.has(i.code)).length, 0), 0)
  return { parts, nestSettings, nest: nr, nestErrors, sheets, post, assignments, unsupported, simErrors, hardware: [...plans.values()], ...tail }
}

/** Chain, gate, blockers, status and release meta of a job (router or panel saw). */
function jobTail(
  inp: InteriorCncInput, m: MachineProfile | null, cabs: Cabinet[], parts: CutPart[], post: Post,
  x: { stockSheets: { material: string; t: number; l: number; w: number }[]; nest: unknown; cam: unknown; nc: string[]; ncIssues: JobGateInput['ncIssues']; unsupported: { op: string; reason: string }[]; unplaced: { label: string; l: number; w: number }[]; nestErrors: string[]; hwIssues: string[]; sawErrors: string[] | null },
) {
  const mHash = m ? profileContentHash(m) : null
  const stocksUsed = [...new Set(x.stockSheets.map((s) => `${s.material}|${s.t}`))].map((k) => {
    const [material, t] = k.split('|')
    const rec = inp.job?.stocks.find((s) => s.material === material)
    return { material, nominal_mm: Number(t), measured_thickness_mm: rec?.measured_thickness_mm ?? null, lot: rec?.lot ?? null }
  })
  // hardware choices are part of the part definition (drilling); projects without any keep their old hash
  const hwSel = cabs.map((c) => c.hardware ?? null)
  const partList = parts.map((p) => ({ id: p.id, rev: p.rev, qty: p.qty }))
  const chain = chainOf({
    parts: hwSel.some(Boolean) ? { parts: partList, hardware: hwSel } : partList,
    stock: { stocks: stocksUsed, band: inp.job?.edge_band_mm ?? DEFAULT_EDGE_BAND, sizes: inp.cam.stock },
    machine: m ? { id: m.profile_id, revision: m.revision, hash: mHash } : { id: inp.machineProfileId ?? 'LEGACY_UNASSIGNED' },
    tools: toolsHash(m),
    nest: x.nest,
    cam: x.cam,
    post: { id: post.id, version: post.version, sha256: post.sha256 },
    nc: x.nc,
  })
  const job = inp.job
  const recorded = job?.approval?.chain ?? job?.reviewed?.chain ?? null
  const stale = isStale(recorded, chain)
  const approval = job ? validApproval(job, chain) : null
  const gate: JobGateInput = {
    machineProfileId: inp.machineProfileId === undefined ? undefined : (job?.machine_profile_id ?? inp.machineProfileId),
    machineProfileRevision: job?.machine_profile_revision ?? null,
    machineProfileHash: job?.machine_profile_hash ?? null,
    stocks: stocksUsed,
    sheets: [...new Map(x.stockSheets.map((s) => [`${s.l}x${s.w}x${s.t}`, { l: s.l, w: s.w, t: s.t }])).values()],
    edgeBandConfirmed: !!job?.edge_band_confirmed,
    stale: recorded ? stale : null,
    approvals: approval ? { operator: approval.operator, engineer: approval.engineer } : null,
    ncIssues: x.ncIssues,
    unsupported: x.unsupported,
    unplaced: x.unplaced.map((p) => `${p.label} ${p.l}×${p.w}`),
    nestErrors: x.nestErrors,
    firstArticle: approval?.firstArticle ?? null,
    post: { id: post.id, version: post.version, sha256: post.sha256 },
    sourceDrawing: inp.sourceDrawing ?? null,
    // a cabinet with no real dimensions (image import, AI concept, unconfirmed) never enters production (V24-024)
    unverifiedCabinets: inp.cabinets.filter((c) => !manufacturableCabinet(c, inp.doc).ok).map((c) => c.name),
    hardware: x.hwIssues,
    sawErrors: x.sawErrors,
  }
  const blockers = releaseBlockers(m, gate, inp.commissioning ?? null)
  const status: JobStatus = job ? jobStatus(job, chain, x.nc.length > 0) : inp.machineProfileId === undefined ? 'LEGACY_UNASSIGNED' : 'DRAFT'
  const meta: ReleaseMeta = { app: 'MD CAD AI STUDIO', job: { job_id: job?.job_id ?? `${inp.jobName} (no job)`, revision: job?.revision ?? 0, part_revision_hash: hashOf(parts.map((p) => [p.id, p.rev])), chain }, parts: parts.map((p) => ({ id: p.id, rev: p.rev })) }
  return { chain, stale, gate, blockers, status, meta }
}

/** Files a panel-saw job writes (the "programs" of its hash chain): cutting list + cut sequence (CSV). */
export function sawFiles(r: GuillotineResult, jobName: string): { name: string; text: string }[] {
  return [
    { name: `${jobName} - saw cutting list.csv`, text: cuttingListCsv(r) },
    { name: `${jobName} - saw cut sequence.csv`, text: cutSequenceCsv(r) },
  ]
}

/**
 * A PANEL_SAW profile: guillotine nesting with the profile's blade kerf (measured), trim, max cut height and cut
 * length; no router paths. Drilling / grooves / profiles are listed as not done on this machine.
 */
function panelSawJob(inp: InteriorCncInput, m: MachineProfile, cabs: Cabinet[], parts: CutPart[], hwIssues: string[]): InteriorCnc {
  const post = getPost(m.postprocessor.id) ?? sawCutList
  const sw = m.ext?.saw
  const blade = m.heads.find((h) => h.type === 'SAW_BLADE')?.tools.find((t) => t.kind === 'SAW_BLADE')
  const kerf = blade?.kerf_mm ?? sw?.kerf_mm ?? 0
  const trim = sw?.trim_mm ?? inp.cam.trim
  const gs: GuillotineSettings = { kerf, trim, sheetL: DEFAULT_NEST.sheetL, sheetW: DEFAULT_NEST.sheetW, stock: inp.cam.stock, grained: inp.cam.grain ? grainedDecor : () => false, maxCutHeight: sw?.max_cut_height_mm ?? null, cutLength: sw?.cut_length_mm ?? null }
  const pieces = piecesOf(cabs)
  const saw = guillotineNest(pieces, gs)
  const errors = verifyAll(saw, gs)
  // the router nest view needs a NestResult: one sheet per pattern (count shown in the pattern)
  const nestSheets = saw.patterns.map((p) => ({ material: p.material, t: p.t, index: p.index, l: p.l, w: p.w, parts: p.parts, yield: p.yield }))
  const byMaterial: NestResult['byMaterial'] = {}
  for (const p of saw.patterns) {
    const b = (byMaterial[p.material] ??= { sheets: 0, parts: 0, partArea: 0, sheetArea: 0 })
    b.sheets += p.count
    b.parts += p.parts.length * p.count
    b.partArea += (p.count * p.parts.reduce((s, q) => s + q.sx * q.sy, 0)) / 1e6
    b.sheetArea += (p.count * p.l * p.w) / 1e6
  }
  const nr: NestResult = { sheets: nestSheets, unplaced: saw.unplaced, byMaterial }
  const nestSettings: NestSettings = { ...DEFAULT_NEST, stock: inp.cam.stock, trim, gap: kerf, grained: gs.grained }
  // what a saw does not do
  const notDone: { op: string; reason: string }[] = []
  const anyHoles = cabs.some((c) => c.doors > 0 || (inp.cam.cnc.shelfPins && c.shelves > 0)) || hwIssues.length > 0
  if (anyHoles) notDone.push({ op: 'DRILL_VERTICAL', reason: 'PANEL_SAW_NO_DRILLING' })
  if (inp.cam.cnc.backGroove !== false && parts.some((p) => p.grooves?.length)) notDone.push({ op: 'SLOT', reason: 'GROOVE_NOT_MACHINED_MANUAL/PANEL_SAW_NO_GROOVING' })
  const files = sawFiles(saw, inp.jobName)
  const tail = jobTail(inp, m, cabs, parts, post, {
    stockSheets: saw.patterns,
    nest: { kerf, trim, grain: inp.cam.grain, patterns: saw.patterns.map((p) => [p.count, p.parts.map((q) => [q.id, q.x, q.y, q.rotated]), p.cuts.map((c) => [c.axis, c.pos, c.from, c.to])]) },
    cam: { saw: { kerf, trim, maxCutHeight: gs.maxCutHeight, cutLength: gs.cutLength } },
    nc: files.map((f) => f.text),
    ncIssues: [],
    unsupported: [], unplaced: saw.unplaced, nestErrors: [], hwIssues: [], sawErrors: [...saw.setup, ...errors],
  })
  return { parts, nestSettings, nest: nr, nestErrors: [], sheets: [], post, assignments: [], unsupported: [], otherMachine: notDone, simErrors: 0, hardware: [], saw, sawFiles: files, ...tail }
}
