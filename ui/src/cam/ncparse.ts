/**
 * Modal-aware NC parser and backplot. It reads the EXACT text that will be written (never the CAM data) and
 * tracks the modal state of an RS-274 controller: units (G20/G21), distance mode (G90/G91), plane, work offset,
 * tool length compensation (G43 H / G49), cutter compensation (G40/41/42), spindle, selected / loaded tool,
 * motion mode and feed. Every issue that matters for safety is export-blocking:
 * - words outside the dialect, or outside the machine profile's verified codes;
 * - T / M6 on a machine without a verified tool changer; motion after M6 without G43 (dialects with G43);
 * - motion before units / distance mode are set; cutting without feed or with the spindle stopped;
 * - rapids inside the material, depth beyond the measured board + allowance, cut not through the board;
 * - moves outside the sheet / work envelope; rapids or cuts through a clamp / no-go zone;
 * - canned cycles the dialect does not have; for previews: no M0 before the first motion.
 * `simulate()` in cam/gcode.ts wraps this parser for the old callers.
 */
import type { ClampZone } from './machine'
import { segmentHitsRect } from './ir'

export interface NcIssue {
  code: string
  line: number
  msg: string
  block: boolean
}

export interface ParseContext {
  /** Codes the dialect accepts (G / M normalised + 'T', 'H'); null = no dialect restriction. */
  dialect?: ReadonlySet<string> | null
  dialectName?: string
  /** The machine profile's verified controller codes; null / undefined = no machine (not checked here). */
  profileCodes?: string[] | null
  /** Verified ATC on the machine; false → any T word / M6 is blocked. null = unknown. */
  atc?: boolean | null
  /** Dialect has G43 tool length offsets: motion after M6 needs G43 H. */
  requireTlo?: boolean
  /** Sheet size (mm) and the allowed margin outside it (cutter radius). */
  sheet?: { l: number; w: number } | null
  margin?: number
  /** Work envelope of the machine (mm). */
  envelope?: { x: number | null; y: number | null; z: number | null } | null
  /** Deepest allowed Z (positive mm below the board top). */
  maxDepth?: number | null
  /** Measured board thickness and the allowed cut into the spoilboard (mm). */
  stockT?: number | null
  allowance?: number
  /** The program must cut through the board (profile programs). */
  expectThrough?: boolean
  clamps?: ClampZone[]
  clearance?: number
  /** Tool radius by tool number (for clamp checks); default 0. */
  toolRadius?: (tool: number) => number
  /** Engineering preview: an M0 must come before the first motion. */
  preview?: boolean
  /** Rapid traverse for the time estimate (mm/min). */
  rapid?: number
  /** Deepest Z already cut by the earlier programs of the same job on this stock (split per-tool programs). */
  priorDeepest?: number
  /** Units codes of the dialect when not G21 / G20 (OSAI: G71 mm / G70 inch). */
  units?: { mm: string; inch: string }
}

export interface BackplotSeg {
  rapid: boolean
  x0: number
  y0: number
  z0: number
  x1: number
  y1: number
  z1: number
  tool: number
}

export interface ParseResult {
  lines: number
  issues: NcIssue[]
  segments: BackplotSeg[]
  cutLength: number
  rapidLength: number
  minZ: number
  maxZ: number
  bounds: { x0: number; y0: number; x1: number; y1: number }
  seconds: number
  toolChanges: number
  /** Deepest Z reached by a cutting move (for the next program of a split job). */
  deepestCut: number
  codes: string[]
  /** Final modal state. */
  state: { units: 'mm' | 'inch' | null; absolute: boolean | null; plane: number; wcs: string | null; tlo: number | null; comp: number; spindle: boolean; tool: number | null }
}

const CANNED = new Set(['G73', 'G74', 'G76', 'G81', 'G82', 'G83', 'G84', 'G85', 'G86', 'G87', 'G88', 'G89'])
const norm = (letter: string, v: string) => `${letter}${Number(v)}`

export function parseNc(text: string, ctx: ParseContext = {}): ParseResult {
  const issues: NcIssue[] = []
  const add = (code: string, line: number, msg: string, block = true) => issues.push({ code, line, msg, block })
  const profile = ctx.profileCodes ? new Set(ctx.profileCodes) : null
  const mmCode = ctx.units?.mm ?? 'G21', inchCode = ctx.units?.inch ?? 'G20'
  let units: 'mm' | 'inch' | null = null, absolute: boolean | null = null, plane = 17, wcs: string | null = null, tlo: number | null = null, comp = 40
  let spindle = false, tool: number | null = null, loaded: number | null = null, mode = -1, f = 0, toolChanges = 0, sawM0 = false, firstMotion = true
  let needTlo = false
  let deepestCut = Math.min(0, ctx.priorDeepest ?? 0)
  let x = 0, y = 0, z = 0, cut = 0, fast = 0, secs = 0, minZ = Infinity, maxZ = -Infinity
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  const segments: BackplotSeg[] = []
  const codes = new Set<string>()
  const rapid = ctx.rapid ?? 15000
  const outside = new Set<string>(), notInProfile = new Set<string>()
  const lines = text.split('\n')
  const grow = (px: number, py: number) => {
    b.x0 = Math.min(b.x0, px), b.x1 = Math.max(b.x1, px), b.y0 = Math.min(b.y0, py), b.y1 = Math.max(b.y1, py)
  }
  const clampHit = (ax: number, ay: number, bx: number, by: number, zLow: number, isRapid: boolean, ln: number) => {
    const r = ctx.toolRadius?.(loaded ?? tool ?? 0) ?? 0
    for (const c of ctx.clamps ?? []) {
      const top = c.z_top + (isRapid ? (ctx.clearance ?? 0) : 0)
      if (zLow < top - 1e-6 && segmentHitsRect(ax, ay, bx, by, c, r)) {
        add('CLAMP_COLLISION', ln, `line ${ln}: ${isRapid ? 'rapid' : 'cut'} at Z${zLow.toFixed(2)} crosses clamp ${c.id} (top Z${c.z_top})`)
        return
      }
    }
  }
  lines.forEach((raw, i) => {
    const ln = i + 1
    // comments in every style the posts write: ( … ), ; …, // …, ' …, /* … */
    const line = raw.replace(/\/\*.*?\*\//g, ' ').replace(/\(.*?\)/g, ' ').replace(/\/\/.*$/, '').replace(/[;'].*$/, '').trim().toUpperCase()
    if (!line || line === '%') return
    const words = [...line.matchAll(/([A-Z])\s*([-+]?\d*\.?\d+)/g)].map((m) => [m[1], m[2]] as const)
    const rest = line.replace(/([A-Z])\s*([-+]?\d*\.?\d+)/g, '').replace(/\s+/g, '')
    if (rest) add('UNPARSEABLE', ln, `line ${ln}: cannot read "${rest}"`)
    const w: Record<string, number> = {}
    const gs: string[] = [], ms: string[] = []
    for (const [L, v] of words) {
      if (L === 'G') gs.push(norm('G', v))
      else if (L === 'M') ms.push(norm('M', v))
      else w[L] = Number(v)
    }
    // ---- dialect / profile word check
    const used = [...gs, ...ms, ...('T' in w ? ['T'] : []), ...('H' in w ? ['H'] : [])]
    for (const c of used) {
      codes.add(c)
      if (ctx.dialect && !ctx.dialect.has(c)) outside.add(c)
      if (profile && !profile.has(c)) notInProfile.add(c)
    }
    for (const c of gs) if (CANNED.has(c) && ctx.dialect && !ctx.dialect.has(c)) add('CANNED_CYCLE_UNSUPPORTED', ln, `line ${ln}: canned cycle ${c} not supported by ${ctx.dialectName ?? 'the dialect'}`)
    // ---- modal state
    for (const g of gs) {
      if (g === inchCode) {
        units = 'inch'
        add('INCH_UNITS', ln, `line ${ln}: ${g} (inch) — production data is millimetres`)
      } else if (g === mmCode) units = 'mm'
      else if (g === 'G90') absolute = true
      else if (g === 'G91') absolute = false
      else if (g === 'G17' || g === 'G18' || g === 'G19') plane = Number(g.slice(1))
      else if (/^G5[4-9]$/.test(g)) wcs = g
      else if (g === 'G43') {
        tlo = 'H' in w ? w.H : loaded
        if (tlo !== null && loaded !== null && tlo !== loaded) add('TLO_MISMATCH', ln, `line ${ln}: G43 H${tlo} with T${loaded} loaded`)
        needTlo = false
      } else if (g === 'G49') tlo = null
      else if (g === 'G40' || g === 'G41' || g === 'G42') {
        comp = Number(g.slice(1))
        if (comp !== 40) add('CUTTER_COMP_UNVERIFIED', ln, `line ${ln}: ${g} cutter compensation is not used by this CAM — check the post`)
      } else if (g === 'G0' || g === 'G1' || g === 'G2' || g === 'G3') mode = Number(g.slice(1))
      else if (CANNED.has(g)) mode = -2
      else if (g === 'G80') mode = mode === -2 ? -1 : mode
    }
    if ('T' in w) {
      tool = w.T
      if (ctx.atc === false) add('ATC_ABSENT_TOOL_CHANGE', ln, `line ${ln}: T${w.T} on a machine without a verified tool changer`)
    }
    for (const m of ms) {
      if (m === 'M3' || m === 'M4') spindle = true
      else if (m === 'M5') spindle = false
      else if (m === 'M0' || m === 'M1') sawM0 = true
      else if (m === 'M6') {
        toolChanges++
        if (ctx.atc === false) add('ATC_ABSENT_TOOL_CHANGE', ln, `line ${ln}: M6 on a machine without a verified tool changer`)
        if (tool === null) add('M6_WITHOUT_T', ln, `line ${ln}: M6 without a T word`)
        if (spindle) add('M6_SPINDLE_RUNNING', ln, `line ${ln}: tool change with the spindle running`)
        loaded = tool
        tlo = null
        if (ctx.requireTlo) needTlo = true
      }
    }
    if ('F' in w) f = units === 'inch' ? w.F * 25.4 : w.F
    if (!('X' in w || 'Y' in w || 'Z' in w)) return
    // ---- motion
    if (firstMotion) {
      firstMotion = false
      if (units === null) add('UNITS_NOT_SET', ln, `line ${ln}: motion before G21 / G20`)
      if (absolute === null) add('DISTANCE_MODE_NOT_SET', ln, `line ${ln}: motion before G90 / G91`)
      if (ctx.preview && !sawM0) add('PREVIEW_WITHOUT_M0', ln, `line ${ln}: engineering preview must stop (M0) before the first motion`)
    }
    if (mode === -2) add('CANNED_CYCLE_MOTION', ln, `line ${ln}: motion inside a canned cycle`)
    if (needTlo && mode >= 0) {
      add('TLO_MISSING_AFTER_TOOL_CHANGE', ln, `line ${ln}: motion after M6 without G43 H`)
      needTlo = false
    }
    const k = units === 'inch' ? 25.4 : 1
    const rel = absolute === false
    const nx = 'X' in w ? (rel ? x + w.X * k : w.X * k) : x
    const ny = 'Y' in w ? (rel ? y + w.Y * k : w.Y * k) : y
    const nz = 'Z' in w ? (rel ? z + w.Z * k : w.Z * k) : z
    let len = Math.hypot(nx - x, ny - y, nz - z)
    let pts: [number, number][] = [[nx, ny]]
    if (mode === 2 || mode === 3) {
      if (plane !== 17) add('ARC_PLANE_UNSUPPORTED', ln, `line ${ln}: arc outside the XY plane`)
      const cx = x + (w.I ?? 0) * k, cy = y + (w.J ?? 0) * k, rad = Math.hypot(x - cx, y - cy)
      let a0 = Math.atan2(y - cy, x - cx), a1 = Math.atan2(ny - cy, nx - cx)
      if (mode === 2 && a1 >= a0) a1 -= 2 * Math.PI
      if (mode === 3 && a1 <= a0) a1 += 2 * Math.PI
      if (Math.abs(Math.hypot(nx - cx, ny - cy) - rad) > 0.01) add('ARC_END_OFF_CIRCLE', ln, `line ${ln}: arc end not on its circle`)
      len = Math.abs(a1 - a0) * rad
      pts = Array.from({ length: 17 }, (_, q) => [cx + rad * Math.cos(a0 + ((a1 - a0) * q) / 16), cy + rad * Math.sin(a0 + ((a1 - a0) * q) / 16)] as [number, number])
    }
    let px = x, py = y
    for (const [qx, qy] of pts) {
      grow(qx, qy)
      if (ctx.clamps?.length && (qx !== px || qy !== py)) clampHit(px, py, qx, qy, Math.min(z, nz), mode === 0, ln)
      segments.push({ rapid: mode === 0, x0: px, y0: py, z0: z, x1: qx, y1: qy, z1: nz, tool: loaded ?? tool ?? 0 })
      px = qx
      py = qy
    }
    if (mode === 0) {
      fast += len
      secs += (len / rapid) * 60
      if (Math.min(z, nz) < -1e-9 && (nx !== x || ny !== y)) add('RAPID_IN_MATERIAL', ln, `line ${ln}: rapid move below Z0`)
      else if (nz < -1e-9 && nz < z && nz < deepestCut - 1e-6 && (!ctx.sheet || (nx > 0 && ny > 0 && nx < ctx.sheet.l && ny < ctx.sheet.w)))
        // without a stock-removal model: a rapid plunge over the stock deeper than anything cut so far is in material
        add('RAPID_PLUNGE_IN_MATERIAL', ln, `line ${ln}: rapid plunge to Z${nz.toFixed(3)} below the deepest cut so far (Z${Number.isFinite(deepestCut) ? deepestCut.toFixed(3) : '0'})`)
    } else if (mode >= 1) {
      if (!f) add('NO_FEED', ln, `line ${ln}: cutting move without a feed`)
      if (!spindle) add('SPINDLE_STOPPED', ln, `line ${ln}: cutting with the spindle stopped`)
      cut += len
      secs += (len / Math.max(f, 1)) * 60
      deepestCut = Math.min(deepestCut, nz, z)
    } else add('NO_MOTION_MODE', ln, `line ${ln}: coordinates without a motion mode`)
    x = nx
    y = ny
    z = nz
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  })
  if (outside.size) add('CODE_NOT_IN_DIALECT', 0, `codes outside ${ctx.dialectName ?? 'the dialect'}: ${[...outside].join(', ')}`)
  if (notInProfile.size) add('CODE_NOT_IN_PROFILE', 0, `codes not verified in the machine profile: ${[...notInProfile].join(', ')}`)
  if (ctx.maxDepth != null && minZ < -ctx.maxDepth - 1e-6) add('DEPTH_EXCEEDED', 0, `depth ${minZ.toFixed(3)} below the allowed −${ctx.maxDepth}`)
  if (ctx.stockT != null) {
    const lim = ctx.stockT + (ctx.allowance ?? 0.5)
    if (minZ < -lim - 1e-6) add('DEPTH_BEYOND_STOCK', 0, `depth ${minZ.toFixed(3)} deeper than the measured board ${ctx.stockT} + allowance ${(ctx.allowance ?? 0.5).toFixed(2)} mm`)
    if (ctx.expectThrough && minZ > -ctx.stockT + 1e-6) add('CUT_NOT_THROUGH', 0, `deepest cut ${minZ.toFixed(3)} does not reach through the measured board ${ctx.stockT} mm`)
  }
  const m = ctx.margin ?? 0
  if (ctx.sheet && Number.isFinite(b.x0) && (b.x0 < -m || b.y0 < -m || b.x1 > ctx.sheet.l + m || b.y1 > ctx.sheet.w + m)) add('OUTSIDE_SHEET', 0, `moves leave the sheet: X ${b.x0.toFixed(1)}…${b.x1.toFixed(1)}, Y ${b.y0.toFixed(1)}…${b.y1.toFixed(1)}`)
  const env = ctx.envelope
  if (env && Number.isFinite(b.x0)) {
    if ((env.x != null && b.x1 - Math.min(0, b.x0) > env.x + 1e-6) || (env.y != null && b.y1 - Math.min(0, b.y0) > env.y + 1e-6)) add('OUTSIDE_ENVELOPE', 0, `program X ${b.x0.toFixed(1)}…${b.x1.toFixed(1)}, Y ${b.y0.toFixed(1)}…${b.y1.toFixed(1)} exceeds the work envelope ${env.x} × ${env.y}`)
    if (env.z != null && maxZ - Math.min(0, minZ) > env.z + 1e-6) add('OUTSIDE_ENVELOPE_Z', 0, `Z travel ${minZ.toFixed(1)}…${maxZ.toFixed(1)} exceeds ${env.z}`)
  }
  if (spindle) add('SPINDLE_ON_AT_END', 0, 'the program ends with the spindle running', false)
  if (!/\bM(30|2|02)\b/.test(text.replace(/\(.*?\)/g, '').toUpperCase())) add('NO_PROGRAM_END', 0, 'no M30 / M2 at the end')
  return {
    lines: lines.length, issues, segments, cutLength: cut, rapidLength: fast, minZ, maxZ, bounds: b, seconds: secs + toolChanges * 20, toolChanges, deepestCut, codes: [...codes].sort(),
    state: { units, absolute, plane, wcs, tlo, comp, spindle, tool: loaded ?? tool },
  }
}

/**
 * Parse the programs of ONE stock (sheet / blank) in run order: each program's context gets `priorDeepest` from
 * the programs before it (stored on the context, so later re-parses of the exact bytes see the same state).
 */
export function parseSequence<P extends { text: string; ctx: ParseContext }>(programs: P[]): ParseResult[] {
  let deepest = 0
  return programs.map((p) => {
    p.ctx = { ...p.ctx, priorDeepest: deepest }
    const r = parseNc(p.text, p.ctx)
    deepest = Math.min(deepest, r.deepestCut)
    return r
  })
}

/** Issue codes that come from geometry / motion (the simulation), as opposed to code-verification ones. */
export const MOTION_ISSUES = new Set(['RAPID_IN_MATERIAL', 'RAPID_PLUNGE_IN_MATERIAL', 'NO_FEED', 'SPINDLE_STOPPED', 'ARC_END_OFF_CIRCLE', 'DEPTH_EXCEEDED', 'DEPTH_BEYOND_STOCK', 'CUT_NOT_THROUGH', 'OUTSIDE_SHEET', 'OUTSIDE_ENVELOPE', 'OUTSIDE_ENVELOPE_Z', 'CLAMP_COLLISION', 'NO_MOTION_MODE', 'CANNED_CYCLE_MOTION'])
