/**
 * CNC router CAM for nested panel sheets: drilling (shelf-pin rows, hinge cups), the back-panel rebate of sides
 * and top / bottom, and outside profiles with depth passes, onion-skin tabs and exact square corners (G2 arcs
 * around each corner). The toolpaths are built once as a neutral IR (cam/ir.ts) and written by a post
 * (cam/posts/*): GRBL 1.1 (one program per tool, M0 + operator message to load the tool and zero Z), LinuxCNC /
 * ISO generic (T… M6 + G43 H… after every tool change with an ATC; one program per tool without), NcStudio-style
 * (only the profile's verified codes). All posts are UNVERIFIED: the export layer (cam/release.ts) writes them as
 * engineering previews unless the release gate passes.
 * Machine zero: sheet lower-left corner, Z0 = top of the board. `simulate()` re-reads a program independently
 * (cam/ncparse.ts) to verify bounds / depths / rapids and to estimate the machining time.
 */
import type { Placement, Sheet } from './nesting'
import type { ClampZone, OperationKind } from './machine'
import { Traverse, groovePasses, groovesOf, toSheet, type IrBlock, type IrMove, type IrProgram, type IrTool, type SheetGroove } from './ir'
import { postFor, type Post } from './posts'
import { parseNc } from './ncparse'

export interface CamSettings {
  /** Post for previews when the machine profile names none: GRBL 1.1, ISO generic, LinuxCNC, NcStudio-style. */
  dialect: 'grbl' | 'iso' | 'linuxcnc' | 'ncstudio'
  cutterD: number // profile end mill Ø (mm)
  feed: number // mm/min
  plunge: number // mm/min
  rpm: number
  stepdown: number // mm per pass
  /** Cut this far into the spoilboard (mm). */
  breakthrough: number
  safeZ: number // mm above the board
  tabs: boolean
  tabW: number // mm
  tabH: number // mm of material left in a tab
  /** Drill 5 mm shelf-pin rows (32 mm system) in sides / dividers of cabinets with shelves. */
  shelfPins: boolean
  /** Hinge cups Ø35 × 12.5 in doors. */
  hingeCups: boolean
  /** Rapid traverse speed used for the time estimate (mm/min). */
  rapid: number
  /** Machine the back-panel rebate of sides and top / bottom (default on). */
  backGroove?: boolean
}

export const DEFAULT_CAM: CamSettings = {
  dialect: 'grbl', cutterD: 8, feed: 8000, plunge: 2000, rpm: 18000, stepdown: 9.5, breakthrough: 0.3, safeZ: 15,
  tabs: true, tabW: 10, tabH: 2, shelfPins: true, hingeCups: true, rapid: 15000, backGroove: true,
}

export interface Tool {
  n: number
  name: string
  d: number
  rpm: number
  feed: number
  plunge: number
}

/** Holes in sheet coordinates. */
export interface Hole {
  x: number
  y: number
  d: number
  depth: number
  part: string
}

/**
 * Drilling features of a placed part. Positions are set out from the FINISHED edges (part-local x along its
 * length, y across its width) and moved into the cut blank (minus the band on edges W1 / L1); a rotated part is
 * turned rigidly (never mirrored) so the features stay on face A with the same handing.
 */
export function holesOf(p: Placement, s: CamSettings, hasShelves: (cabinet: string) => boolean, thickness = p.t): Hole[] {
  const lf = p.finished?.l ?? p.l, wf = p.finished?.w ?? p.w
  const e = p.edges ?? { L1: 0, L2: 0, W1: 0, W2: 0 }
  const local: { x: number; y: number; d: number; depth: number }[] = []
  if (s.hingeCups && p.part === 'Door') {
    const n = lf <= 900 ? 2 : lf <= 1600 ? 3 : lf <= 2000 ? 4 : 5
    for (let k = 0; k < n; k++) local.push({ x: 100 + (k * (lf - 200)) / (n - 1), y: 22.5, d: 35, depth: 12.5 })
  }
  if (s.shelfPins && (p.part === 'Side panel' || p.part === 'Divider') && hasShelves(p.cabinet)) {
    // two rows 37 mm from the front and back edges, 32 mm pitch over the middle half of the height
    const x0 = Math.ceil((lf * 0.25) / 32) * 32, x1 = Math.floor((lf * 0.75) / 32) * 32
    for (let x = x0; x <= x1; x += 32) for (const y of [37, wf - 37]) local.push({ x, y, d: 5, depth: 12 })
  }
  return local.map((h) => {
    const [x, y] = toSheet(p, h.x - e.W1, h.y - e.L1)
    return { x, y, d: h.d, depth: Math.min(h.depth, thickness - 1), part: p.label }
  })
}

export interface Program {
  name: string
  text: string
  tools: number[]
}

export interface CamResult {
  programs: Program[]
  /** For the preview: profile paths (sheet coordinates) and holes. */
  profiles: { part: string; pts: [number, number][]; tabs: [number, number][] }[]
  holes: Hole[]
  grooves: SheetGroove[]
  tools: Tool[]
  /** The neutral program the post wrote. */
  ir: IrProgram
  /** Features left out because the machine cannot do the operation (or no tool fits). */
  skipped: { op: OperationKind; what: 'pins' | 'cups' | 'grooves' | 'profiles'; count: number; reason: string }[]
  /** Refusals of the post (e.g. codes not in the profile). */
  postIssues: string[]
  post: { id: string; version: string; sha256: string }
}

export interface CamOptions {
  /** Post to write (default: from `dialect`). */
  post?: Post
  /** The machine has a verified ATC (default: the legacy behaviour — ISO with T… M6, GRBL one program per tool). */
  atc?: boolean
  supportedCodes?: string[] | null
  clamps?: ClampZone[]
  /** Clearance above clamps for traverses (mm). */
  clearance?: number
  /** Measured board thickness (mm): depths follow it instead of the nominal sheet thickness. */
  thickness?: number | null
  /** Machine capability: operations the selected machine can do (default: all). */
  allow?: (op: OperationKind) => string | null
  /** Tool numbers / diameters / heads from the machine's head assignment. */
  tools?: Partial<Record<'profile' | 'pin' | 'cup', { n?: number | null; d?: number | null; head_id?: string | null; tool_id?: string | null }>>
}

const f3 = (v: number) => (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '') || '0'

/** Nearest-neighbour ordering from the sheet origin. */
function order<T extends { x: number; y: number }>(items: T[]): T[] {
  const left = [...items], out: T[] = []
  let cx = 0, cy = 0
  while (left.length) {
    let bi = 0, bd = Infinity
    left.forEach((h, i) => { const d = Math.hypot(h.x - cx, h.y - cy); if (d < bd) (bd = d), (bi = i) })
    const h = left.splice(bi, 1)[0]
    out.push(h)
    cx = h.x
    cy = h.y
  }
  return out
}

/** The neutral program of one sheet (drilling, rebates, profiles) + preview geometry. */
export function sheetIr(sheet: Sheet, s: CamSettings, hasShelves: (cabinet: string) => boolean, jobName: string, opts: CamOptions = {}) {
  const T = opts.thickness && opts.thickness > 0 ? opts.thickness : sheet.t
  const tp = opts.tools ?? {}
  const cutterD = tp.profile?.d ?? s.cutterD
  const r = cutterD / 2
  const tools: IrTool[] = [
    { n: tp.profile?.n ?? 1, name: `End mill Ø${cutterD} (profile)`, d: cutterD, rpm: s.rpm, feed: s.feed, plunge: s.plunge, kind: 'END_MILL', head_id: tp.profile?.head_id ?? null, tool_id: tp.profile?.tool_id ?? null },
    { n: tp.pin?.n ?? 2, name: 'Drill Ø5 (shelf pins)', d: 5, rpm: 6000, feed: 2000, plunge: 2000, kind: 'DRILL', head_id: tp.pin?.head_id ?? null, tool_id: tp.pin?.tool_id ?? null },
    { n: tp.cup?.n ?? 3, name: 'Forstner Ø35 (hinge cups)', d: 35, rpm: 4000, feed: 1000, plunge: 1000, kind: 'FORSTNER', head_id: tp.cup?.head_id ?? null, tool_id: tp.cup?.tool_id ?? null },
  ]
  // machine tool numbers must be distinct, else keep T1 / T2 / T3
  if (new Set(tools.map((t) => t.n)).size < tools.length) tools.forEach((t, i) => (t.n = i + 1))
  const [t1, t2, t3] = tools
  const allow = opts.allow ?? (() => null)
  const skipped: CamResult['skipped'] = []
  const clamps = opts.clamps ?? []
  const tr = new Traverse(clamps, opts.clearance ?? 5, s.safeZ)
  let holes = sheet.parts.flatMap((p) => holesOf(p, s, hasShelves, T))
  const drillWhy = allow('DRILL_VERTICAL')
  if (drillWhy && holes.length) {
    for (const [d, what] of [[5, 'pins'], [35, 'cups']] as const) {
      const n = holes.filter((h) => h.d === d).length
      if (n) skipped.push({ op: 'DRILL_VERTICAL', what, count: n, reason: drillWhy })
    }
    holes = []
  }
  let grooves = s.backGroove === false ? [] : sheet.parts.flatMap(groovesOf)
  const slotWhy = allow('SLOT')
  if (slotWhy && grooves.length) {
    skipped.push({ op: 'SLOT', what: 'grooves', count: grooves.length, reason: slotWhy })
    grooves = []
  }
  const noFit = grooves.filter((g) => !groovePasses(g, r))
  if (noFit.length) skipped.push({ op: 'SLOT', what: 'grooves', count: noFit.length, reason: `NO_TOOL_FITS:SLOT:${Math.min(...noFit.map((g) => g.width))}` })
  grooves = grooves.filter((g) => groovePasses(g, r))
  const depth = T + s.breakthrough
  const passes = Math.max(1, Math.ceil(depth / s.stepdown))
  const zs = Array.from({ length: passes }, (_, i) => -(depth * (i + 1)) / passes)
  const blocks: IrBlock[] = []

  // drilling (drills before the profile cut, while the parts are still held by the whole sheet)
  for (const [t, d] of [[t2, 5], [t3, 35]] as const) {
    const list = order(holes.filter((h) => h.d === d))
    if (!list.length) continue
    const m: IrMove[] = [{ k: 'comment', text: `${t.name}: ${list.length} holes` }]
    tr.reset()
    for (const h of list) {
      tr.to(m, h.x, h.y, t.d / 2)
      tr.rapidZ(m, 2)
      tr.feed(m, { z: -h.depth, f: t.plunge })
      tr.rapidZ(m, 2)
    }
    tr.rapidZ(m, s.safeZ)
    blocks.push({ op: 'DRILL_VERTICAL', tool: t.n, label: t.name, moves: m })
  }

  // profiles: smallest parts first (they lose vacuum hold-down first), each one clockwise (climb, M3)
  const profWhy = allow('PROFILE')
  const parts = profWhy ? [] : [...sheet.parts].sort((a, b) => a.sx * a.sy - b.sx * b.sy)
  if (profWhy) skipped.push({ op: 'PROFILE', what: 'profiles', count: sheet.parts.length, reason: profWhy })
  tr.reset()
  // back-panel rebates / grooves with the profile cutter, before the profiles
  if (grooves.length) {
    const m: IrMove[] = [{ k: 'comment', text: `Back-panel rebates: ${grooves.length}` }]
    for (const g of grooves) {
      const cs = groovePasses(g, r)!
      const gn = Math.max(1, Math.ceil(g.depth / s.stepdown))
      const gz = Array.from({ length: gn }, (_, i) => -(g.depth * (i + 1)) / gn)
      const along = (c: number, end: 0 | 1): [number, number] => (g.alongX ? [end ? g.x1 : g.x0, c] : [c, end ? g.y1 : g.y0])
      m.push({ k: 'comment', text: `${g.part}${g.partId ? ` [${g.partId}]` : ''} rebate ${f3(g.width)} x ${f3(g.depth)}` })
      let end: 0 | 1 = 0
      const [sx, sy] = along(cs[0], 0)
      tr.to(m, sx, sy, r)
      tr.rapidZ(m, 2)
      for (const z of gz) {
        tr.feed(m, { z, f: t1.plunge })
        cs.forEach((c, k) => {
          if (k) {
            const [ax, ay] = along(c, end)
            tr.feed(m, { x: ax, y: ay, f: t1.feed })
          }
          end = end ? 0 : 1
          const [bx, by] = along(c, end)
          tr.feed(m, { x: bx, y: by, f: t1.feed })
        })
        cs.reverse()
      }
      tr.rapidZ(m, s.safeZ)
    }
    blocks.push({ op: 'SLOT', tool: t1.n, label: 'back rebates', moves: m })
  }
  const profiles: CamResult['profiles'] = []
  for (const p of parts) {
    const x0 = p.x, y0 = p.y, x1 = p.x + p.sx, y1 = p.y + p.sy
    const tabsX = s.tabs && p.sx >= 200 ? [x0 + p.sx / 3, x0 + (2 * p.sx) / 3] : []
    profiles.push({ part: p.label, pts: [[x0 - r, y1 + r], [x1 + r, y1 + r], [x1 + r, y0 - r], [x0 - r, y0 - r]], tabs: tabsX.flatMap((x) => [[x, y1 + r], [x, y0 - r]] as [number, number][]) })
    const m: IrMove[] = [{ k: 'comment', text: `${p.label}${p.partId ? ` [${p.partId} r${p.rev}]` : ''} — ${p.sx} × ${p.sy}` }]
    tr.to(m, x0, y1 + r, r)
    tr.rapidZ(m, 2)
    zs.forEach((z, k) => {
      const last = k === zs.length - 1
      const zTab = Math.max(z, -(T - s.tabH))
      tr.feed(m, { z, f: t1.plunge })
      // top edge (left → right) with tabs on the final pass
      const edge = (xa: number, xb: number, y: number) => {
        const tabs = last ? tabsX.slice().sort((a, b) => (xb > xa ? a - b : b - a)) : []
        for (const tx of tabs) {
          const ta = tx - Math.sign(xb - xa) * (s.tabW / 2 + r), tb = tx + Math.sign(xb - xa) * (s.tabW / 2 + r)
          tr.feed(m, { x: ta, y, f: t1.feed })
          tr.feed(m, { z: zTab, f: t1.plunge })
          tr.feed(m, { x: tb, f: t1.feed })
          tr.feed(m, { z, f: t1.plunge })
        }
        tr.feed(m, { x: xb, y, f: t1.feed })
      }
      edge(x0, x1, y1 + r)
      tr.arc(m, { cw: true, x: x1 + r, y: y1, i: 0, j: -r })
      tr.feed(m, { x: x1 + r, y: y0 })
      tr.arc(m, { cw: true, x: x1, y: y0 - r, i: -r, j: 0 })
      edge(x1, x0, y0 - r)
      tr.arc(m, { cw: true, x: x0 - r, y: y0, i: 0, j: r })
      tr.feed(m, { x: x0 - r, y: y1 })
      tr.arc(m, { cw: true, x: x0, y: y1 + r, i: r, j: 0 })
    })
    tr.rapidZ(m, s.safeZ)
    blocks.push({ op: 'PROFILE', tool: t1.n, label: p.label, moves: m })
  }
  const base = `${jobName} - ${sheet.material.replace(/\W+/g, '_')} #${sheet.index}`
  const ir: IrProgram = {
    name: base,
    title: [
      base,
      `MD CAD AI STUDIO CAM · sheet ${sheet.material} ${sheet.l} × ${sheet.w} × ${f3(T)} mm #${sheet.index}${T !== sheet.t ? ` (measured; nominal ${sheet.t})` : ''}`,
      `Zero: sheet lower-left corner, Z0 = top of the board; depth ${f3(depth)} mm in ${passes} pass(es)`,
      ...(clamps.length ? [`Clamps: ${clamps.length}; traverses over them at Z${f3(tr.clearZ)}`] : []),
    ],
    safeZ: s.safeZ,
    clearZ: tr.clearZ,
    tools,
    blocks,
    stock: { l: sheet.l, w: sheet.w, t: T },
  }
  return { ir, profiles, holes, grooves, tools: tools.map(({ n, name, d, rpm, feed, plunge }) => ({ n, name, d, rpm, feed, plunge })), skipped }
}

export function camSheet(sheet: Sheet, s: CamSettings, hasShelves: (cabinet: string) => boolean, jobName: string, opts: CamOptions = {}): CamResult {
  const built = sheetIr(sheet, s, hasShelves, jobName, opts)
  const post = opts.post ?? postFor(s.dialect)
  // legacy (no machine profile): ISO wrote one program with T… M6; GRBL one program per tool
  const atc = opts.atc ?? post.id !== 'grbl11'
  const out = built.ir.blocks.length ? post.render(built.ir, { atc, supportedCodes: opts.supportedCodes ?? null }) : { programs: [], issues: [] }
  return { ...built, programs: out.programs, postIssues: out.issues, post: { id: post.id, version: post.version, sha256: post.sha256 } }
}

/* ------------------------------------------------------------------ independent verification */

export interface SimResult {
  lines: number
  cutLength: number // mm at feed
  rapidLength: number
  minZ: number
  bounds: { x0: number; y0: number; x1: number; y1: number }
  /** Seconds: cutting + plunging at their feeds, rapids at `rapid`, 20 s per tool change. */
  seconds: number
  errors: string[]
}

/**
 * Re-reads a program without using any CAM data (cam/ncparse.ts): checks that every cutting move has a feed,
 * the spindle runs, no rapid move runs below Z0, the depth never exceeds `maxDepth`, and all moves stay inside the
 * sheet ± `margin`. Kept for the old callers; the export gate uses parseNc() with the machine's full context.
 */
export function simulate(text: string, sheet: { l: number; w: number }, maxDepth: number, margin: number, rapid = 15000): SimResult {
  const r = parseNc(text, { sheet, maxDepth, margin, rapid })
  return { lines: r.lines, cutLength: r.cutLength, rapidLength: r.rapidLength, minZ: r.minZ, bounds: r.bounds, seconds: r.seconds, errors: r.issues.filter((i) => i.block).map((i) => i.msg) }
}
