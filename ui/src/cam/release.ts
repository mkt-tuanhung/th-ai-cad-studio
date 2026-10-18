/**
 * The only way NC text leaves the app.
 *
 * - `previewFiles()` — the default: every program is an ENGINEERING PREVIEW. File extension
 *   `.NOT_FOR_MACHINE.txt` (no controller loads it as a program), a header that says so, which machine / status /
 *   post it was made for and every release blocker, and an M0 before the first motion. Plus manifest.json with
 *   the job / part / machine / post revisions, the sha256 of every file and the blockers. The parser re-reads the
 *   exact bytes written.
 * - `productionFiles()` — `.nc` + manifest with sha256 and sign-offs, ONLY when releaseBlockers() is empty for
 *   the exact bytes being written. It re-checks the gate itself and throws otherwise, so no UI, shortcut, script
 *   or imported state can bypass it. Nothing is ever sent to a machine or started.
 */
import { sha256 } from '../lib/sha256'
import { releaseBlockers, type CommissioningRecord, type JobGateInput, type MachineProfile } from './machine'
import { parseNc, type ParseContext, type ParseResult } from './ncparse'
import type { Post } from './posts'
import { ncStageHash, type Chain } from './job'

export const PREVIEW_EXT = '.NOT_FOR_MACHINE.txt'
export const WATERMARK = 'ENGINEERING PREVIEW - NOT FOR MACHINE USE'

export interface NcProgram {
  /** Post output name (…nc). */
  name: string
  /** Post output text (no watermark). */
  text: string
  /** Parser context for this program (sheet, depth, clamps…); `preview` is set by the writers. */
  ctx: ParseContext
}

export interface ReleaseMeta {
  app: string
  job: { job_id: string; revision: number; part_revision_hash: string; chain: Chain | null }
  parts: { id: string; rev: string }[]
}

const safe = (s: string) => s.replace(/[()]/g, (c) => (c === '(' ? '[' : ']'))

/** Comment lines + M0 before the first motion. */
export function watermark(text: string, info: { machine: string; status: string; post: string; blockers: string[]; job?: string }): string {
  const lines = text.replace(/\n$/, '').split('\n')
  const head = [
    `(${WATERMARK})`,
    `(machine=${safe(info.machine)} status=${safe(info.status)} post=${safe(info.post)})`,
    ...(info.job ? [`(job=${safe(info.job)})`] : []),
  ]
  const list = info.blockers.length ? info.blockers : ['none listed - still a preview']
  for (let i = 0; i < list.length; i += 6) head.push(`(blockers${list.length > 6 ? ` ${i / 6 + 1}/${Math.ceil(list.length / 6)}` : ''}: ${safe(list.slice(i, i + 6).join(', '))})`)
  const at = lines[0]?.trim() === '%' ? 1 : 0
  lines.splice(at, 0, ...head)
  // before the spindle starts or the first line with an axis word (comments removed)
  const motion = lines.findIndex((l) => /[XYZ]\s*[-+.\d]|\bM0*[34]\b/.test(l.replace(/\(.*?\)/g, '').replace(/;.*$/, '').toUpperCase()))
  lines.splice(motion < 0 ? lines.length : motion, 0, `M0 (${WATERMARK} - STOP)`)
  return lines.join('\n') + '\n'
}

export interface WrittenFile {
  name: string
  text: string
}

export interface PreviewResult {
  files: WrittenFile[]
  manifest: Record<string, unknown>
  /** Parse of the exact bytes of every preview file. */
  parses: { name: string; parse: ParseResult }[]
  blockers: string[]
}

const fileHash = (text: string) => ({ sha256: sha256(text), bytes: new TextEncoder().encode(text).length })

function machineInfo(m: MachineProfile | null, contentHash: string | null) {
  return m ? { profile_id: m.profile_id, revision: m.revision, status: m.status, content_hash: contentHash, controller: m.controller, atc: m.atc.supported, heads: m.heads.map((h) => ({ head_id: h.head_id, type: h.type })) } : null
}

/**
 * Engineering preview of the programs. `blockers` = releaseBlockers() for the job (shown in every header and in
 * the manifest); the preview is written whatever they are.
 */
export function previewFiles(programs: NcProgram[], o: { machine: MachineProfile | null; machineHash: string | null; post: Post; blockers: string[]; meta: ReleaseMeta; prefix?: string; at?: string }): PreviewResult {
  const files: WrittenFile[] = []
  const parses: PreviewResult['parses'] = []
  for (const p of programs) {
    const text = watermark(p.text, { machine: o.machine?.profile_id ?? 'NONE', status: o.machine?.status ?? 'NO_MACHINE_PROFILE', post: `${o.post.id} ${o.post.version} UNVERIFIED`, blockers: o.blockers, job: `${o.meta.job.job_id} r${o.meta.job.revision}` })
    // any program extension (.nc / .tap / .mpf…) becomes the preview extension no controller loads
    const name = `${o.prefix ?? ''}${p.name.replace(/\.(nc|tap|ngc|mpf|cnc|iso|gcode|txt)$/i, '')}${PREVIEW_EXT}`
    files.push({ name, text })
    parses.push({ name, parse: parseNc(text, { ...p.ctx, preview: true }) })
  }
  const manifest = {
    kind: 'ENGINEERING_PREVIEW',
    not_for_machine: true,
    notice: WATERMARK,
    generated_at: o.at ?? new Date().toISOString(),
    app: o.meta.app,
    job: o.meta.job,
    parts: o.meta.parts,
    machine: machineInfo(o.machine, o.machineHash),
    post: { id: o.post.id, version: o.post.version, sha256: o.post.sha256, status: o.post.status },
    blockers: o.blockers,
    files: files.map((f, i) => ({ name: f.name, ...fileHash(f.text), parse: { issues: parses[i].parse.issues.map((x) => ({ code: x.code, line: x.line, block: x.block })), min_z: +parses[i].parse.minZ.toFixed(3), bounds: parses[i].parse.bounds, codes: parses[i].parse.codes } })),
  }
  files.push({ name: `${o.prefix ?? ''}manifest.json`, text: JSON.stringify(manifest, null, 2) + '\n' })
  return { files, manifest, parses, blockers: o.blockers }
}

export class ProductionBlocked extends Error {
  blockers: string[]
  constructor(blockers: string[]) {
    super(`PRODUCTION_BLOCKED: ${blockers.join(', ')}`)
    this.blockers = blockers
  }
}

/**
 * Production NC: re-parses the exact bytes, re-runs the release gate with those parse results and throws
 * ProductionBlocked unless it is empty. Writes `.nc` files and a manifest with sha256, revisions and sign-offs.
 */
export function productionFiles(programs: NcProgram[], o: { machine: MachineProfile | null; machineHash: string | null; commissioning: CommissioningRecord | null; post: Post; gate: JobGateInput; meta: ReleaseMeta; prefix?: string; at?: string }): { files: WrittenFile[]; manifest: Record<string, unknown> } {
  const parses = programs.map((p) => parseNc(p.text, { ...p.ctx, preview: false }))
  const gate: JobGateInput = { ...o.gate, ncIssues: parses.flatMap((r) => r.issues), post: { id: o.post.id, version: o.post.version, sha256: o.post.sha256 } }
  const blockers = releaseBlockers(o.machine, gate, o.commissioning)
  // the bytes written must be the bytes the job's hash chain (and so its approval) was computed from
  const chain = o.meta.job.chain
  if (!chain || ncStageHash(chain.post, programs.map((p) => p.text)) !== chain.nc) blockers.push('NC_BYTES_NOT_APPROVED')
  if (blockers.length) throw new ProductionBlocked(blockers)
  const files: WrittenFile[] = programs.map((p) => ({ name: `${o.prefix ?? ''}${p.name}`, text: p.text }))
  const manifest = {
    kind: 'PRODUCTION_RELEASE',
    not_for_machine: false,
    generated_at: o.at ?? new Date().toISOString(),
    app: o.meta.app,
    job: o.meta.job,
    parts: o.meta.parts,
    machine: machineInfo(o.machine, o.machineHash),
    commissioning: o.commissioning ? { id: o.commissioning.id, at: o.commissioning.at, operator: o.commissioning.operator, engineer: o.commissioning.engineer, evidence_refs: o.commissioning.evidence_refs } : null,
    post: { id: o.post.id, version: o.post.version, sha256: o.post.sha256 },
    signoffs: o.gate.approvals,
    files: files.map((f) => ({ name: f.name, ...fileHash(f.text) })),
    notice: 'Manual transfer only. The operator starts the machine; the app never sends or starts a program.',
  }
  files.push({ name: `${o.prefix ?? ''}manifest.json`, text: JSON.stringify(manifest, null, 2) + '\n' })
  return { files, manifest }
}

/* ------------------------------------------------------------------ commissioning air cut */

export const AIRCUT_MARK = 'COMMISSIONING AIR CUT - SUPERVISED DRY RUN - NO MATERIAL'

/**
 * The commissioning air-cut test program (docs/09 step 5): the post's program with EVERY Z raised by `lift` so the
 * deepest move stays `gap` mm above the board top (and above every clamp top + clearance), feeds unchanged, a
 * header in the controller's comment syntax and the file name marked AIRCUT_TEST. It is run without material,
 * under supervision, to check motion, head / tool selection and the program end — it is not production NC.
 * The parser re-reads the lifted bytes: any move below `gap` throws.
 */
export function airCutFiles(programs: NcProgram[], o: { gap: number; clampTop?: number }): WrittenFile[] {
  return programs.map((p) => {
    const parsed = parseNc(p.text, { ...p.ctx, preview: false })
    const lift = Math.max(0, -parsed.minZ) + o.gap + Math.max(0, o.clampTop ?? 0)
    const style = /\(/.test(p.text) ? 'paren' : /;/.test(p.text) ? 'semicolon' : 'none'
    const c = (s: string) => (style === 'paren' ? `(${s})` : style === 'semicolon' ? `; ${s}` : null)
    const lines = p.text.replace(/\n$/, '').split('\n').map((raw) => {
      const i = raw.search(/[(;]/)
      const code = i < 0 ? raw : raw.slice(0, i), rest = i < 0 ? '' : raw.slice(i)
      return code.replace(/Z\s*([-+]?\d*\.?\d+)/gi, (_, v: string) => `Z${(Math.round((Number(v) + lift) * 1000) / 1000).toString()}`) + rest
    })
    const head = [c(AIRCUT_MARK), c(`ALL Z RAISED BY ${lift.toFixed(3)} MM - DEEPEST MOVE ${o.gap} MM ABOVE THE BOARD TOP`), c('OPERATOR: E-STOP IN REACH, FEED OVERRIDE LOW, WATCH EVERY TOOL / HEAD CHANGE')].filter((x): x is string => !!x)
    const at = lines[0]?.trim() === '%' ? 1 : 0
    lines.splice(at, 0, ...head)
    const text = lines.join('\n') + '\n'
    const check = parseNc(text, { ...p.ctx, stockT: null, expectThrough: false, maxDepth: null, preview: false })
    if (check.minZ < o.gap - 1e-6) throw new Error(`AIRCUT_NOT_LIFTED:${p.name}:${check.minZ}`)
    const m = /^(.*?)(\.[A-Za-z0-9]{1,6})?$/.exec(p.name)!
    return { name: `${m[1]}.AIRCUT_TEST${m[2] ?? '.nc'}`, text }
  })
}

/* ------------------------------------------------------------------ panel saw (cutting list, no NC) */

export const SAW_PREVIEW_EXT = '.NOT_FOR_MACHINE.csv'

/** Panel-saw engineering preview: the cutting list / cut sequence with a watermark row, the patterns (SVG), a manifest. */
export function previewSawFiles(files: WrittenFile[], svgs: WrittenFile[], o: { machine: MachineProfile | null; machineHash: string | null; post: Post; blockers: string[]; meta: ReleaseMeta; at?: string }): { files: WrittenFile[]; manifest: Record<string, unknown> } {
  const out: WrittenFile[] = [
    ...files.map((f) => ({ name: f.name.replace(/\.csv$/i, SAW_PREVIEW_EXT), text: `"${WATERMARK}"\r\n${f.text}` })),
    ...svgs.map((f) => ({ name: f.name.replace(/\.svg$/i, '.NOT_FOR_MACHINE.svg'), text: f.text })),
  ]
  const manifest = {
    kind: 'ENGINEERING_PREVIEW', not_for_machine: true, notice: WATERMARK, generated_at: o.at ?? new Date().toISOString(), app: o.meta.app, job: o.meta.job, parts: o.meta.parts,
    machine: machineInfo(o.machine, o.machineHash), post: { id: o.post.id, version: o.post.version, sha256: o.post.sha256, status: o.post.status }, blockers: o.blockers,
    files: out.map((f) => ({ name: f.name, ...fileHash(f.text) })),
  }
  out.push({ name: 'manifest.json', text: JSON.stringify(manifest, null, 2) + '\n' })
  return { files: out, manifest }
}

/**
 * Panel-saw production release: the cutting list + cut sequence (CSV) whose bytes the job's chain approved, the
 * patterns (SVG) and a manifest with sha256 + sign-offs — only when the release gate is empty (re-checked here).
 * The saw's optimiser / controller program is made on the saw from this list; nothing is sent to the machine.
 */
export function productionSawFiles(files: WrittenFile[], svgs: WrittenFile[], o: { machine: MachineProfile | null; machineHash: string | null; commissioning: CommissioningRecord | null; post: Post; gate: JobGateInput; meta: ReleaseMeta; at?: string }): { files: WrittenFile[]; manifest: Record<string, unknown> } {
  const gate: JobGateInput = { ...o.gate, post: { id: o.post.id, version: o.post.version, sha256: o.post.sha256 } }
  const blockers = releaseBlockers(o.machine, gate, o.commissioning)
  if (o.machine && o.machine.machine_type !== 'PANEL_SAW') blockers.push('SAW_LIST_FOR_A_NON_SAW_MACHINE')
  const chain = o.meta.job.chain
  if (!chain || ncStageHash(chain.post, files.map((f) => f.text)) !== chain.nc) blockers.push('NC_BYTES_NOT_APPROVED')
  if (blockers.length) throw new ProductionBlocked(blockers)
  const out = [...files, ...svgs]
  const manifest = {
    kind: 'PRODUCTION_RELEASE', not_for_machine: false, format: 'MDCAD-SAW-CSV-1', generated_at: o.at ?? new Date().toISOString(), app: o.meta.app, job: o.meta.job, parts: o.meta.parts,
    machine: machineInfo(o.machine, o.machineHash),
    commissioning: o.commissioning ? { id: o.commissioning.id, at: o.commissioning.at, operator: o.commissioning.operator, engineer: o.commissioning.engineer, evidence_refs: o.commissioning.evidence_refs } : null,
    post: { id: o.post.id, version: o.post.version, sha256: o.post.sha256 }, signoffs: o.gate.approvals,
    files: out.map((f) => ({ name: f.name, ...fileHash(f.text) })),
    notice: 'Cutting list for the panel saw (manual transfer). The saw operator starts every cut; the app never sends or starts a program.',
  }
  out.push({ name: 'manifest.json', text: JSON.stringify(manifest, null, 2) + '\n' })
  return { files: out, manifest }
}
