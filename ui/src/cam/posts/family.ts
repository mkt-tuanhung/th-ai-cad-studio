/**
 * Controller-family posts (Syntec, Mach3, Fanuc, Siemens 840D ISO dialect, OSAI, RichAuto DSP, Weihong NcStudio),
 * all from the neutral IR (cam/ir.ts), all UNVERIFIED until a profile with that post is commissioned.
 *
 * The rule: a post writes ONLY codes that are both in its dialect and in the allowed set — the machine profile's
 * verified codes (prefilled from the controller family's documentation, edited by the user), or the family's
 * documented codes when there is no profile (preview). Nothing is guessed:
 * - a code the program cannot do without (units, G90, G0 / G1, M3 / M5, program end) that is not allowed is
 *   still written in the preview and reported as `<POST>_CODE_NOT_DOCUMENTED:<code>` (export-blocking);
 * - optional codes are left out when not allowed (G17 / G94 / G40 / G49 / G80 / G54); arcs G2 / G3 that are not
 *   allowed are written as short G1 chords (≤ 0.01 mm from the arc);
 * - T… M6 only with a verified ATC and M6 + T allowed; otherwise one program per tool, with the profile's
 *   documented operator pause (e.g. M0) or, when none is documented, no pause (each file is loaded by the operator);
 * - tool length: the profile's mode (G43 H n / applied by the controller on M6 / Z zeroed per program); with an ATC
 *   and no documented mode the post blocks (`<POST>_TOOL_LENGTH_MODE_NOT_DOCUMENTED`);
 * - several heads: the profile's spindle-select codes (from the controller manual) put them in one program; without
 *   them each head gets its own program, and Weihong multi-spindle / 4-process machines are BLOCKED
 *   (`WEIHONG_SPINDLE_SELECT_NOT_DOCUMENTED:<heads>`) because a program without the select code runs the wrong head;
 * - comments in the family's syntax (parentheses / semicolon) or none when it is not documented;
 * - file extension from the profile or the family; none documented → `<POST>_FILE_EXTENSION_NOT_DOCUMENTED`.
 */
import { hashOf } from '../../lib/sha256'
import { commentStyle, familyById, familyCodes } from '../library'
import type { ControllerFamilyId } from '../library/types'
import type { IrMove, IrProgram, IrTool } from '../ir'
import type { ToolLengthMode } from '../machine'
import { codesIn, f3, type Post, type PostId, type PostOptions, type PostProgram } from './common'

export interface FamilySpec {
  id: PostId
  version: string
  label: string
  family: ControllerFamilyId
  /** Every code this dialect may ever write. */
  dialect: string[]
  units?: { mm: string; inch: string }
  /** Tool length mode with an ATC when the profile does not state one (null = must be stated). */
  tloDefault: ToolLengthMode | null
  /** Several heads in one program need documented spindle-select codes (else blocked). */
  requireSpindleSelect?: boolean
  /** Lines before the program (Fanuc: %, O number). */
  start?: (allowed: Set<string>) => string[]
  /** Lines after the program end (Fanuc: %). */
  after?: string[]
  /** A header note for the operator (e.g. "ISO dialect mode must be active"). */
  note?: string
}

/** Chords of an arc from (x0, y0), within `tol` of the arc. */
export function arcChords(x0: number, y0: number, m: { cw: boolean; x: number; y: number; i: number; j: number }, tol = 0.01): [number, number][] {
  const cx = x0 + m.i, cy = y0 + m.j, r = Math.hypot(m.i, m.j)
  let a0 = Math.atan2(y0 - cy, x0 - cx), a1 = Math.atan2(m.y - cy, m.x - cx)
  if (m.cw && a1 >= a0) a1 -= 2 * Math.PI
  if (!m.cw && a1 <= a0) a1 += 2 * Math.PI
  const step = r > tol ? 2 * Math.acos(1 - tol / r) : Math.PI
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / step))
  return Array.from({ length: n }, (_, k) => (k === n - 1 ? [m.x, m.y] : [cx + r * Math.cos(a0 + ((a1 - a0) * (k + 1)) / n), cy + r * Math.sin(a0 + ((a1 - a0) * (k + 1)) / n)]))
}

export function familyPost(spec: FamilySpec): Post {
  const dialect = new Set(spec.dialect)
  const P = spec.id.toUpperCase()
  /** Units codes: fixed by the dialect (OSAI), else G21 / G20 when allowed, else G71 / G70 (Syntec, TwinCAT), else G21 (flagged). */
  const unitsOf = (allowed: Set<string>) => spec.units ?? (allowed.has('G21') ? { mm: 'G21', inch: 'G20' } : allowed.has('G71') ? { mm: 'G71', inch: 'G70' } : { mm: 'G21', inch: 'G20' })
  const sha256 = hashOf({ id: spec.id, version: spec.version, family: spec.family, dialect: [...dialect].sort(), units: spec.units ?? 'G21|G71', tlo: spec.tloDefault, sel: !!spec.requireSpindleSelect, start: String(spec.start), after: spec.after ?? [], render: String(render) })

  function render(ir: IrProgram, opts: PostOptions): { programs: PostProgram[]; issues: string[] } {
    const fam = familyById(spec.family)
    const allowed = new Set(opts.supportedCodes ?? familyCodes(fam))
    const ok = (c: string) => allowed.has(c) && dialect.has(c)
    const units = unitsOf(allowed)
    const issues = new Set<string>()
    const need = (c: string) => {
      if (!ok(c)) issues.add(`${P}_CODE_NOT_DOCUMENTED:${c}`)
      return c
    }
    const ext = opts.ext ?? null
    const style = ext?.comment_style ?? commentStyle(fam)
    const safe = (t: string) => t.replace(/[()]/g, (c) => (c === '(' ? '[' : ']')).replace(/;/g, ',').replace(/'/g, '').replace(/\/\*|\*\//g, '')
    const cm = (t: string): string | null => {
      switch (style) {
        case 'paren': return `(${safe(t)})`
        case 'semicolon': return `; ${safe(t)}`
        case 'slash': return `// ${safe(t)}`
        case 'apostrophe': return `' ${safe(t)}`
        case 'block': return `/* ${safe(t)} */`
        default: return null
      }
    }
    const fileExt = ext?.file_extension || fam?.file_extensions[0] || null
    if (!fileExt) issues.add(`${P}_FILE_EXTENSION_NOT_DOCUMENTED`)
    const end = ok('M30') ? 'M30' : ok('M2') ? 'M2' : need('M30')
    const arcs = ok('G2') && ok('G3')
    const atc = opts.atc && ok('M6') && allowed.has('T')
    if (opts.atc && !atc) issues.add(`${P}_TOOL_CHANGE_NOT_DOCUMENTED`)
    const tloMode: ToolLengthMode | null = ext?.tool_length_mode ?? (atc ? spec.tloDefault : 'ZERO_PER_TOOL')
    if (atc && !tloMode) issues.add(`${P}_TOOL_LENGTH_MODE_NOT_DOCUMENTED`)
    const g43 = tloMode === 'G43' && ok('G43') && allowed.has('H')
    if (tloMode === 'G43' && !g43) issues.add(`${P}_CODE_NOT_DOCUMENTED:G43`)
    const pauseRaw = ext?.operator_pause_code ?? (ok('M0') ? 'M0' : null)
    const pause = pauseRaw && ok(pauseRaw) ? pauseRaw : null
    if (pauseRaw && !pause) issues.add(`${P}_CODE_NOT_DOCUMENTED:${pauseRaw}`)
    const S = allowed.has('S')
    if (!S) issues.add(`${P}_CODE_NOT_DOCUMENTED:S`)
    const spindleOn = ok('M3') ? 'M3' : need('M3')
    const spindleOff = ok('M5') ? 'M5' : need('M5')

    // tools in use and their heads
    const used = [...new Set(ir.blocks.map((b) => b.tool))].map((n) => ir.tools.find((t) => t.n === n)!)
    const heads = [...new Set(used.map((t) => t.head_id ?? null))]
    // select codes: G / M codes as they are, other words (RichAuto T1…T4) checked by their letter
    const key = (c: string) => (/^[GM]/i.test(c) ? c.toUpperCase().replace(/^([GM])0*(\d)/, '$1$2') : c.charAt(0).toUpperCase())
    const sel = new Map((ext?.spindle_select ?? []).filter((x) => x.codes.length && x.codes.every((c) => ok(key(c)))).map((x) => [x.head_id, x.codes]))
    const multi = heads.length > 1
    const missingSel = multi ? heads.filter((h) => !h || !sel.has(h)).map((h) => h ?? 'UNASSIGNED').sort() : []
    const combine = multi && !missingSel.length
    if (multi && missingSel.length && spec.requireSpindleSelect) issues.add(`${P}_SPINDLE_SELECT_NOT_DOCUMENTED:${missingSel.join(',')}`)
    for (const x of ext?.spindle_select ?? []) for (const c of x.codes) if (!ok(key(c))) issues.add(`${P}_CODE_NOT_DOCUMENTED:${c}`)

    // program groups: with an ATC one program per head (or one for all heads with documented select codes);
    // without an ATC one program per tool — except heads selected by documented codes, each holding its own
    // mounted tool, which share one program as long as no head needs a second tool
    const groups: { head: string | null; tools: IrTool[] }[] = []
    for (const t of used) {
      const last = groups[groups.length - 1]
      const th = t.head_id ?? null
      const sameProgram = !!last && (atc ? combine || last.head === th : combine && !last.tools.some((x) => (x.head_id ?? null) === th))
      if (sameProgram) last.tools.push(t)
      else groups.push({ head: th, tools: [t] })
    }
    const split = groups.length > 1
    const programs: PostProgram[] = []
    groups.forEach((g, gi) => {
      const L: string[] = []
      const push = (l: string | null) => l !== null && L.push(l)
      L.push(...(spec.start?.(allowed) ?? []))
      for (const t of ir.title) push(cm(t))
      if (spec.note) push(cm(spec.note))
      if (split) push(cm(`Program ${gi + 1} of ${groups.length}${g.head ? ` - head ${g.head}` : ''} - tools ${g.tools.map((t) => `T${t.n}`).join(', ')}`))
      L.push([need(units.mm), need('G90'), ...['G17', 'G94', 'G40', 'G49', 'G80'].filter(ok)].join(' '))
      if (ok('G54')) L.push('G54')
      let x = 0, y = 0
      let head: string | null = null
      const move = (m: IrMove) => {
        if (m.k === 'comment') return push(cm(m.text))
        const xyz = (o: { x?: number; y?: number; z?: number }) => `${o.x !== undefined ? ` X${f3(o.x)}` : ''}${o.y !== undefined ? ` Y${f3(o.y)}` : ''}${o.z !== undefined ? ` Z${f3(o.z)}` : ''}`
        if (m.k === 'rapid' || m.k === 'feed') {
          L.push(`${m.k === 'rapid' ? need('G0') : need('G1')}${xyz(m)}${m.k === 'feed' && m.f !== undefined ? ` F${Math.round(m.f)}` : ''}`)
          x = m.x ?? x
          y = m.y ?? y
          return
        }
        if (arcs) L.push(`${m.cw ? 'G2' : 'G3'} X${f3(m.x)} Y${f3(m.y)} I${f3(m.i)} J${f3(m.j)}`)
        else for (const [px, py] of arcChords(x, y, m)) L.push(`G1 X${f3(px)} Y${f3(py)}`)
        x = m.x
        y = m.y
      }
      g.tools.forEach((t, i) => {
        if (i > 0) L.push(spindleOff, `G0 Z${f3(ir.clearZ)}`)
        const th = t.head_id ?? null
        if (combine && th && th !== head) {
          L.push(sel.get(th)!.join(' '))
          push(cm(`head ${th} selected by the profile's spindle-select codes`))
          head = th
        }
        const tlo = (z: number) => (g43 ? `G0 G43 H${t.n} Z${f3(z)}` : `G0 Z${f3(z)}`)
        if (atc) L.push(`T${t.n} M6`, ...(cm(t.name) ? [cm(t.name)!] : []))
        else if (combine && g.tools.length > 1) {
          // fixed tools on selected heads: one check stop at the start lists every head's tool
          if (i === 0) {
            const msg = `CHECK TOOLS: ${g.tools.map((x) => `T${x.n} ${x.name} ON ${x.head_id ?? '?'}`).join('; ')}, ZERO Z, THEN START`
            if (pause) L.push(cm(msg) ? `${pause} ${cm(msg)}` : pause)
            else push(cm(msg))
          }
        } else {
          const msg = `LOAD T${t.n} ${t.name}${th ? ` ON ${th}` : ''}, ${g43 ? `SET TOOL LENGTH H${t.n}` : 'ZERO Z ON THE BOARD TOP'}, THEN START`
          if (pause) L.push(cm(msg) ? `${pause} ${cm(msg)}` : pause)
          else push(cm(msg))
        }
        L.push(S ? `S${t.rpm} ${spindleOn}` : spindleOn, tlo(ir.clearZ))
        for (const b of ir.blocks.filter((q) => q.tool === t.n)) b.moves.forEach(move)
      })
      L.push(spindleOff, `G0 Z${f3(ir.clearZ)}`, 'G0 X0 Y0')
      if (g43 && ok('G49')) L.push('G49')
      L.push(end, ...(spec.after ?? []))
      const suffix = (groups.length > 1 && !atc ? ` T${g.tools[0].n}` : '') + (multi && !combine && g.head ? ` ${g.head}` : '')
      programs.push({ name: `${ir.name}${suffix}${fileExt ?? '.nc'}`, text: L.join('\n') + '\n', tools: g.tools.map((t) => t.n) })
    })
    // the profile check of the bytes written (the parser re-checks the same at export)
    const missing = [...new Set(programs.flatMap((p) => codesIn(p.text)))].filter((c) => !allowed.has(c))
    if (missing.length) issues.add(`${P}_CODES_NOT_IN_PROFILE:${missing.join(',')}`)
    return { programs, issues: [...issues] }
  }

  /** Does a program for these options write G43 H after each tool load (the parser then requires it after M6)? */
  const tloFor = (opts: PostOptions) => {
    const allowed = new Set(opts.supportedCodes ?? familyCodes(familyById(spec.family)))
    const ok = (c: string) => allowed.has(c) && dialect.has(c)
    const atc = opts.atc && ok('M6') && allowed.has('T')
    const mode = opts.ext?.tool_length_mode ?? (atc ? spec.tloDefault : 'ZERO_PER_TOOL')
    return mode === 'G43' && ok('G43') && allowed.has('H')
  }
  const unitsFor = (opts: PostOptions) => unitsOf(new Set(opts.supportedCodes ?? familyCodes(familyById(spec.family))))
  return { id: spec.id, version: spec.version, label: spec.label, status: 'UNVERIFIED', dialect, tlo: spec.tloDefault === 'G43', sha256, render, family: spec.family, units: spec.units, tloFor, unitsFor }
}

/** M0…M99: OEM M codes (spindle select) are allowed by the dialect but written only when the profile lists them. */
const M_ALL = Array.from({ length: 100 }, (_, i) => `M${i}`)
const ISO = ['G0', 'G1', 'G2', 'G3', 'G4', 'G17', 'G20', 'G21', 'G70', 'G71', 'G40', 'G43', 'G49', 'G54', 'G55', 'G56', 'G57', 'G58', 'G59', 'G80', 'G90', 'G91', 'G94', ...M_ALL, 'T', 'H', 'F', 'S']

export const syntec = familyPost({ id: 'syntec', version: '1.0.0', label: 'Syntec (ISO)', family: 'SYNTEC', dialect: ISO, tloDefault: 'G43' })
export const mach3 = familyPost({ id: 'mach3', version: '1.0.0', label: 'Mach3', family: 'MACH3', dialect: ISO, tloDefault: 'G43' })
export const fanuc = familyPost({ id: 'fanuc', version: '1.0.0', label: 'FANUC (0i-M style)', family: 'FANUC', dialect: ISO, tloDefault: 'G43', start: () => ['%', 'O1000'], after: ['%'] })
export const siemens840d = familyPost({
  id: 'siemens840d', version: '1.0.0', label: 'SINUMERIK 840D (ISO dialect mode)', family: 'SIEMENS_840D', dialect: [...ISO, 'G291'], tloDefault: 'G43',
  start: (a) => (a.has('G291') ? ['G291'] : []), note: 'ISO DIALECT MODE MUST BE ACTIVE ON THE CONTROL',
})
export const osai = familyPost({ id: 'osai', version: '1.0.0', label: 'OSAI (ISO, G71 metric)', family: 'OSAI', dialect: ISO.filter((c) => c !== 'G20' && c !== 'G21'), units: { mm: 'G71', inch: 'G70' }, tloDefault: null })
export const richauto = familyPost({ id: 'richauto', version: '1.0.0', label: 'RichAuto DSP', family: 'RICHAUTO_DSP', dialect: ISO, tloDefault: null, requireSpindleSelect: true })
export const lnc = familyPost({ id: 'lnc', version: '1.0.0', label: 'LNC (ISO)', family: 'LNC', dialect: ISO, tloDefault: 'G43' })
export const twincat = familyPost({ id: 'twincat', version: '1.0.0', label: 'Beckhoff TwinCAT CNC (codes from the profile)', family: 'BECKHOFF_TWINCAT', dialect: ISO, tloDefault: null })
export const weihong = familyPost({ id: 'weihong', version: '1.0.0', label: 'Weihong NcStudio (incl. 4-process / multi-spindle)', family: 'WEIHONG_NCSTUDIO', dialect: ISO, tloDefault: null, requireSpindleSelect: true })
