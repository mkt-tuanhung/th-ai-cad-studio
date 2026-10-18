/**
 * Shared machinery of the post-processors (IR → controller text). Every post here is UNVERIFIED: none has been
 * run on a real controller of a commissioned machine, so their output is only ever written as an engineering
 * preview unless the machine profile is VERIFIED with that exact post id + version + hash.
 *
 * Program split: one program per head (head activation codes are OEM-specific and never guessed) and, without
 * an ATC (or on GRBL), one program per tool. Each split program starts with an M0 operator stop that says which
 * head / tool to load and that the tool length / Z zero must be set — never only a comment.
 */
import { hashOf } from '../../lib/sha256'
import type { IrMove, IrProgram, IrTool } from '../ir'
import type { MachineExt } from '../machine'

export type PostId = 'grbl11' | 'linuxcnc' | 'iso_generic' | 'ncstudio' | 'syntec' | 'mach3' | 'fanuc' | 'siemens840d' | 'osai' | 'richauto' | 'weihong' | 'lnc' | 'twincat' | 'saw_cutlist'

export interface PostOptions {
  /** The machine has a verified automatic tool changer (T… M6 allowed). */
  atc: boolean
  /** The machine profile's verified controller codes; null = no machine profile (preview only). */
  supportedCodes?: string[] | null
  /** The profile's extension: file extension, tool-length mode, pause code, spindle-select codes, comment style. */
  ext?: MachineExt | null
}

export interface PostProgram {
  name: string
  text: string
  tools: number[]
}

export interface PostResult {
  programs: PostProgram[]
  /** Codes the post needed but the profile does not list (and other post-level refusals). */
  issues: string[]
}

export interface Post {
  id: PostId
  version: string
  label: string
  status: 'UNVERIFIED'
  /** Words / codes this dialect accepts (G and M codes normalised: G0, G43, M6…; letters: F, S, T…). */
  dialect: ReadonlySet<string>
  /** Tool length compensation word after every tool load (ISO / LinuxCNC: G43 H n; GRBL has none). */
  tlo: boolean
  sha256: string
  render: (ir: IrProgram, opts: PostOptions) => PostResult
  /** Controller family (cam/library) the post is written for; undefined = the generic posts of v2.4. */
  family?: string
  /** Units codes when not G21 / G20 (OSAI: G71 / G70), for the parser. */
  units?: { mm: string; inch: string }
  /** Writes no NC (panel saw cutting list): only for PANEL_SAW profiles. */
  noNc?: boolean
  /** Whether G43 H follows each tool load for these options (default: `tlo`). */
  tloFor?: (opts: PostOptions) => boolean
}

export const f3 = (v: number) => (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '') || '0'
/** Comments may not nest parentheses. */
export const cmt = (s: string) => `(${s.replace(/[()]/g, (c) => (c === '(' ? '[' : ']'))})`

export function moveLine(m: IrMove): string {
  if (m.k === 'comment') return cmt(m.text)
  const xyz = (o: { x?: number; y?: number; z?: number }) => `${o.x !== undefined ? ` X${f3(o.x)}` : ''}${o.y !== undefined ? ` Y${f3(o.y)}` : ''}${o.z !== undefined ? ` Z${f3(o.z)}` : ''}`
  if (m.k === 'rapid') return `G0${xyz(m)}`
  if (m.k === 'feed') return `G1${xyz(m)}${m.f !== undefined ? ` F${Math.round(m.f)}` : ''}`
  return `${m.cw ? 'G2' : 'G3'} X${f3(m.x)} Y${f3(m.y)} I${f3(m.i)} J${f3(m.j)}`
}

export interface Group {
  head: string | null
  tools: IrTool[]
}

/** Programs to write: split by head always, and by tool when there is no tool changer. */
export function groupsOf(ir: IrProgram, perTool: boolean): Group[] {
  const used = [...new Set(ir.blocks.map((b) => b.tool))].map((n) => ir.tools.find((t) => t.n === n)!)
  const out: Group[] = []
  for (const t of used) {
    const last = out[out.length - 1]
    if (last && !perTool && last.head === (t.head_id ?? null)) last.tools.push(t)
    else out.push({ head: t.head_id ?? null, tools: [t] })
  }
  return out
}

export interface Style {
  /** Safety / modal line at the top. */
  modal: string
  /** Lines that load a tool in the middle of a program (ATC) — after M5 + retract. */
  atcChange: (t: IrTool, clearZ: number) => string[]
  /** Lines that make the operator load a tool at the start of a split program. */
  manualLoad: (t: IrTool, head: string | null, clearZ: number) => string[]
  /** Lines before M30. */
  end: string[]
}

/** Render the IR with a style; `perTool` = one program per tool. */
export function renderWith(ir: IrProgram, style: Style, perTool: boolean): PostProgram[] {
  const programs: PostProgram[] = []
  const groups = groupsOf(ir, perTool)
  const split = groups.length > 1
  const multiHead = new Set(groups.map((g) => g.head)).size > 1
  for (const g of groups) {
    const lines: string[] = []
    const suffix = (perTool ? ` T${g.tools[0].n}` : '') + (multiHead && g.head ? ` ${g.head}` : '')
    for (const l of ir.title) lines.push(cmt(l))
    if (split) lines.push(cmt(`Program ${programs.length + 1} of ${groups.length}${g.head ? ` · head ${g.head}` : ''} · tools ${g.tools.map((t) => `T${t.n}`).join(', ')}`))
    lines.push(style.modal, 'G54')
    g.tools.forEach((t, i) => {
      if (i === 0) lines.push(...style.manualLoad(t, g.head, ir.clearZ))
      else lines.push('M5', `G0 Z${f3(ir.clearZ)}`, ...style.atcChange(t, ir.clearZ))
      for (const b of ir.blocks.filter((x) => x.tool === t.n)) lines.push(...b.moves.map(moveLine))
    })
    lines.push('M5', `G0 Z${f3(ir.clearZ)}`, 'G0 X0 Y0', ...style.end, 'M30')
    programs.push({ name: `${ir.name}${suffix}.nc`, text: lines.join('\n') + '\n', tools: g.tools.map((t) => t.n) })
  }
  return programs
}

/** Codes a program uses (G / M normalised, plus T / H words), for the profile check. */
export function codesIn(text: string): string[] {
  const set = new Set<string>()
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\(.*?\)/g, '').replace(/;.*$/, '').toUpperCase()
    for (const m of line.matchAll(/([GM])\s*(\d+(?:\.\d+)?)/g)) set.add(`${m[1]}${Number(m[2])}`)
    for (const m of line.matchAll(/([TH])\s*\d+/g)) set.add(m[1])
  }
  return [...set].sort()
}

export function makePost(p: Omit<Post, 'sha256' | 'render' | 'status'> & { style: (opts: PostOptions) => Style; perTool: (opts: PostOptions) => boolean; profileStrict?: boolean }): Post {
  const sha256 = hashOf({ id: p.id, version: p.version, dialect: [...p.dialect].sort(), tlo: p.tlo, style: String(p.style), perTool: String(p.perTool), strict: !!p.profileStrict })
  return {
    id: p.id, version: p.version, label: p.label, status: 'UNVERIFIED', dialect: p.dialect, tlo: p.tlo, sha256,
    render: (ir, opts) => {
      const ext = opts.ext?.file_extension
      const programs = renderWith(ir, p.style(opts), p.perTool(opts)).map((x) => (ext ? { ...x, name: x.name.replace(/\.nc$/, ext) } : x))
      const issues: string[] = []
      if (p.profileStrict) {
        // OEM dialects: only codes the machine profile lists (verified on that controller) may be used
        const allowed = new Set(opts.supportedCodes ?? [])
        const missing = [...new Set(programs.flatMap((x) => codesIn(x.text)))].filter((c) => !allowed.has(c))
        if (missing.length) issues.push(`${p.id.toUpperCase()}_CODES_NOT_IN_PROFILE:${missing.join(',')}`)
      }
      return { programs, issues }
    },
  }
}

const range = (a: number, b: number, pre: string) => Array.from({ length: b - a + 1 }, (_, i) => `${pre}${a + i}`)
/** Base codes shared by the dialects (motion, plane, units, distance, WCS). */
export const BASE_CODES = ['G0', 'G1', 'G2', 'G3', 'G4', 'G17', 'G18', 'G19', 'G20', 'G21', 'G40', 'G49', 'G80', 'G90', 'G91', 'G94', ...range(54, 59, 'G'), 'M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M8', 'M9', 'M30', 'F', 'S', 'T']
