/**
 * One command: drawings in → everything the app can make from them, ready for one approval.
 *
 *  1. layer roles from their names (house and route rules); the local AI (when loaded) is asked ONLY about the
 *     layers NEITHER rule knows (a layer a rule leaves out on purpose — dimensions, drop lines — counts as known),
 *     and its answer only fills those — it never overrides a name rule;
 *  2. what each file is, by its CONTENT (floor plans with rooms, structural plans, MEP symbols, long profiles) with
 *     its name as a hint (NHA_KC.dwg, DIEN NUOC.dwg…): floor plans are read from every architectural file (levels
 *     merged, a level found twice is said so); structural / MEP files go onto the building; routes from any file;
 *  3. building → BIM model (levels from the plan titles; a title without an elevation gets one inferred from its
 *     storey number and its neighbours, flagged in the review; roof elevation from the roof-plan title), model
 *     checks, Interior data of the level with the most furniture (rooms, items, parametric cabinets);
 *     route → Civil model of the route with the most sections, volumes against the designer's areas;
 *  4. the output package is made from these models by src/auto/package.ts.
 * Every number comes from code; nothing is written until the user approves (src/screens/auto/AutoDialog.tsx).
 */
import type { HostApi } from '../services/host'
import type { HouseViews } from './views'
import { applyStructure, hasStructure, readStructure } from '../bim/structure'
import { readRoofs } from '../bim/roof'
import { hasMep, readMep, type MepResult } from './mep'
import { buildMepModel, type MepBuild } from './mepModel'
import { cross } from '../bim/structure'
import type { CadDocument } from '../cad/types'
import type { DrawingUnits } from '../cad/batch'
import { DEFAULT_REC, findPlans, layerStats, norm, recognize, roofElevation, type LayerRole, type LayerStat, type PlanRegion, type Recognition } from '../bim/fromCad'
import { DEFAULT_BUILD, buildBimModel, buildInterior, type BuildNames, type BuildResult, type InteriorBuild } from '../bim/fromCadBuild'
import { runModelChecks, type CheckResult } from '../bim/model'
import { civilRuleRole, findRoutes, routeHasDesign, volumes, type CivilRole, type Route } from '../civil/fromCad'
import { buildCivilModel } from '../civil/fromCadBuild'
import type { CivilModel } from '../civil/model'
import { civilExcluded, suggestCivilRoles, suggestLayerRoles } from '../ai/layerRoles'

export type AutoStep = 'layers' | 'ai' | 'house' | 'route' | 'build' | 'structure' | 'check'

/** How an elevation missing from a plan title was found. */
export type ElevHow = 'between' | 'storey' | 'free' | 'top' | 'roof'

export interface AutoHouse {
  plans: PlanRegion[]
  recs: Recognition[]
  /** the level each of `recs` became (same order as `recs`; the levels of the model are sorted by elevation) */
  recLevels: string[]
  built: BuildResult
  checks: CheckResult[]
  interior: InteriorBuild | null
  /** Index (in sorted levels) of the level the Interior data comes from. */
  interiorLevel: number | null
  /** Interior data of every level with rooms (the package's furniture schedule, cut list, nesting, CNC cover
   *  them all; the Interior workspace gets `interior`, one level). */
  interiors: { level: string; build: InteriorBuild }[]
  /** Elevations and sections by the OCCT kernel (desktop; added after the run by src/auto/views.ts). */
  views?: HouseViews
  /** What the structural drawings added (beams, foundations, slab openings / thickness). */
  structure: { file: string; plans: number; beams: number; ties: number; footings: number; piles: number; openings: number; warnings: string[] }[]
  /** levels whose elevation the title did not give ("cao độ suy ra") */
  inferred: { level: string; elevation: number; how: ElevHow }[]
  /** a level found on more than one plan (of the same or another file): the one kept and the ones left out */
  duplicates: { level: string; kept: string; dropped: string }[]
}

export interface AutoRoute {
  routes: Route[]
  chosen: Route
  model: CivilModel
  volume: ReturnType<typeof volumes>
  /** every route of the drawing (the package has them all; the Civil workspace gets `model`) */
  all: { name: string; model: CivilModel; volume: ReturnType<typeof volumes> }[]
}

export type FileKind = 'arch' | 'structure' | 'mep' | 'route' | 'unknown'

/** What a file of the run was taken for, and why. */
export interface AutoFile {
  name: string
  kind: FileKind
  /** what its name says (null: nothing) */
  hint: FileKind | null
  /** floor plans with rooms found in it */
  plans: number
  structure: boolean
  mep: boolean
  /** its plans were used for the building */
  usedForPlans: boolean
  units?: DrawingUnits
}

export interface AutoResult {
  file: string
  kind: 'house' | 'route' | 'both' | 'mep' | 'none'
  houseRoles: Record<string, LayerRole>
  civilRoles: Record<string, CivilRole>
  /** Layers the AI classified (only those no rule knew), null when the AI was not asked. */
  ai: { asked: number; set: string[]; seconds: number; model?: string; error?: string } | null
  house: AutoHouse | null
  route: AutoRoute | null
  /** quantities from the MEP drawings (electrical, plumbing, air conditioning, fire, low-current) */
  mep: MepResult[]
  /** the MEP coordination model built from them on the building (pipes, fixtures, the beams), with its clashes */
  mepModel: MepBuild | null
  /** every file of the run, what it was taken for (one entry with a single drawing) */
  files: AutoFile[]
  ms: number
}

export interface AutoOptions {
  host: HostApi | null
  /** Ask the local AI about unknown layers (desktop with a loaded model). */
  useAi: boolean
  names: BuildNames
  /** Default name of the n-th level ("Level n" / "Tầng n"). */
  levelName: (n: number) => string
  civilBase: CivilModel
  onStep?: (s: AutoStep) => void
  /** More drawings of the same project, in any order: each is classified by its content (and its name). */
  extras?: CadDocument[]
  /** the units each file was read in (by file name; src/cad/batch.ts readDrawing) */
  units?: Record<string, DrawingUnits>
}

const pause = () => new Promise((r) => setTimeout(r, 0))

/* ================================================================ AI on the layers no rule knows */

/** A layer the AI may be asked about: no house rule (nor the geometry) and no route rule knows it — not even as a
 *  layer the route rule leaves out on purpose — and it holds enough to matter. */
export function aiCandidate(s: LayerStat): boolean {
  return s.by === 'none' && civilRuleRole(s.name) === null && !civilExcluded(s.name) && s.count >= 5
}

/**
 * Merges the AI's answers into the rule roles: a house answer only where the house rule has nothing (by 'none'),
 * a route answer only where the route rule has nothing (no role, not excluded on purpose); "ignore" answers change
 * nothing. Returns the layers the AI set (marked "AI" in the review).
 */
export function mergeAiRoles(
  stats: LayerStat[], houseRoles: Record<string, LayerRole>, civilRoles: Record<string, CivilRole>,
  houseAi: Record<string, LayerRole>, civilAi: Record<string, CivilRole>,
): string[] {
  const set: string[] = []
  const by = new Map(stats.map((s) => [s.name, s]))
  for (const [name, role] of Object.entries(houseAi)) {
    const s = by.get(name)
    if (!s || s.by !== 'none' || role === 'ignore') continue
    houseRoles[name] = role
    if (!set.includes(name)) set.push(name)
  }
  for (const [name, role] of Object.entries(civilAi)) {
    if (!by.has(name) || role === 'ignore' || civilRuleRole(name) !== null || civilExcluded(name)) continue
    civilRoles[name] = role
    if (!set.includes(name)) set.push(name)
  }
  return set
}

/* ================================================================ elevations missing from the titles */

export interface ElevIn { order: number | null; elevation: number | null; roof: boolean }
export interface ElevOut { elevation: number; inferred: ElevHow | null }

/**
 * Elevations of the plans, the missing ones inferred — never two plans at one elevation:
 *  - a numbered storey ("TẦNG 2", order 2; basement 0, ground 1, mezzanine 1.5) between two titled ones: by its
 *    number between theirs ("TẦNG 1 ±0.000", "TẦNG 2", "TẦNG 3 +6.600" → +3.300); with titled ones on one side only:
 *    a storey height a number from the nearest; with none: (number − 1) × storey height from ±0.000 (basements
 *    negative);
 *  - an untitled plan: ±0.000 when no plan is there yet (an untitled plan beside a basement is the ground floor),
 *    else a storey above the highest;
 *  - a roof plan: the roof-plan title's elevation when it is above the top storey, else a storey above it.
 */
export function inferElevations(items: ElevIn[], storeyH: number, roofEl: number | null = null): ElevOut[] {
  const H = storeyH > 0 ? storeyH : DEFAULT_BUILD.storeyH
  const out: (ElevOut | null)[] = items.map((x) => (x.elevation !== null ? { elevation: x.elevation, inferred: null } : null))
  const titled = items.flatMap((x) => (x.elevation !== null && x.order !== null && x.order !== 99 ? [{ o: x.order, e: x.elevation }] : []))
  // numbered storeys
  items.forEach((x, i) => {
    if (out[i] || x.roof || x.order === null || x.order === 99) return
    const o = x.order
    const lo = titled.filter((k) => k.o < o).sort((a, b) => b.o - a.o)[0]
    const hi = titled.filter((k) => k.o > o).sort((a, b) => a.o - b.o)[0]
    if (lo && hi) out[i] = { elevation: Math.round(lo.e + ((hi.e - lo.e) * (o - lo.o)) / (hi.o - lo.o)), inferred: 'between' }
    else if (lo) out[i] = { elevation: Math.round(lo.e + (o - lo.o) * H), inferred: 'storey' }
    else if (hi) out[i] = { elevation: Math.round(hi.e - (hi.o - o) * H), inferred: 'storey' }
    else out[i] = { elevation: Math.round((o - 1) * H), inferred: 'storey' }
  })
  const taken = () => out.flatMap((x, i) => (x && !items[i].roof ? [x.elevation] : []))
  const free = (e: number, except = -1) => out.every((x, i) => i === except || !x || Math.abs(x.elevation - e) >= Math.min(H / 2, 1000))
  // untitled plans
  items.forEach((x, i) => {
    if (out[i] || x.roof) return
    const t = taken()
    out[i] = free(0) ? { elevation: 0, inferred: 'free' } : { elevation: Math.max(...t) + H, inferred: 'top' }
  })
  // no inferred elevation on (or within a fraction of a storey of) another plan's
  out.forEach((x, i) => {
    if (!x?.inferred || items[i].roof || free(x.elevation, i)) return
    out[i] = { elevation: Math.max(...taken()) + H, inferred: 'top' }
  })
  // roof plans
  items.forEach((_, i) => {
    if (out[i]) return
    const t = taken()
    const top = t.length ? Math.max(...t) : -H
    out[i] = { elevation: roofEl !== null && roofEl > top + 1500 && free(roofEl) ? roofEl : top + H, inferred: 'roof' }
  })
  return out as ElevOut[]
}

/* ================================================================ what a file is */

/** Plan titles of MEP and structural sheets. */
const MEP_TITLE = /\b(DIEN|NUOC|CAP THOAT|THOAT NUOC|PCCC|BAO CHAY|CHUA CHAY|DIEU HOA|THONG GIO|CHIEU SANG|O CAM|CAMERA|ELV|MEP|ELECTRICAL|LIGHTING|POWER|PLUMBING|DRAINAGE|FIRE|HVAC)\b/
const STRUCT_TITLE = /\b(KET CAU|BO TRI DAM|DAM SAN|MONG|DINH VI COC|COC|FOUNDATION|FRAMING|BEAM|STRUCTURAL)\b/

/**
 * What a file's NAME says it is (a hint; the content decides): structure (KC, KẾT CẤU, STRUCT, S-101), MEP (ĐIỆN,
 * NƯỚC, CTN, PCCC, FIRE, ELV, MEP, ĐIỀU HOÀ, E-101 / P-101 / M-101), architecture (KT, KIẾN TRÚC, ARCH, A-101).
 * Underscores, dashes and diacritics do not matter ("NHA_KC.dwg", "DIEN NUOC.dwg", "Bản vẽ KẾT CẤU.dxf").
 */
export function fileHint(name: string): FileKind | null {
  const n = ` ${norm(name.replace(/\.(dwg|dxf)$/i, ''))} `
  if (/ (KC|KET ?CAU|STRUCT\w*|STR|KCS) /.test(n) || /^ S \d/.test(n)) return 'structure'
  if (/ (DIEN|NUOC|DIEN NUOC|CTN|CAP THOAT NUOC|CAP NUOC|THOAT NUOC|PCCC|FIRE|FA|FP|ELV|DIEN NHE|MEP|M E P|HVAC|DIEU HOA|THONG GIO|ELEC\w*|PLUMB\w*|SPRINKLER|BAO CHAY|CHONG SET) /.test(n) || /^ [EPMF] \d/.test(n)) return 'mep'
  if (/ (KT|KIEN TRUC|ARCH\w*|ARC) /.test(n) || /^ A \d/.test(n)) return 'arch'
  if (/ (TUYEN|KENH|DUONG|TRAC DOC|TRAC NGANG|ROUTE|CANAL|ROAD) /.test(n)) return 'route'
  return null
}

/** Real floor plans of a drawing: walls with rooms or openings (parallel lines alone are not a house). */
function realPlans(doc: CadDocument, roles: Record<string, LayerRole>) {
  const plans = findPlans(doc, roles).filter((p) => p.kind !== 'other')
  const recs = plans.map((p) => recognize(doc, roles, p, DEFAULT_REC))
  const plan = recs.filter((r) => r.walls.length >= 4 && (r.rooms.length >= 1 || r.openings.length >= 2))
  return { plans, recs: plan.some((r) => r.rooms.length >= 1) ? plan : [] }
}

/**
 * A file classified by its content, its name as a hint: a name saying structure / MEP decides (their drawings carry
 * the architecture underneath — its plans are used only when no other file has plans); else floor plans with rooms
 * → architecture, unless most plan titles say MEP / structure ("MẶT BẰNG CẤP NƯỚC TẦNG 1"); else structural layers
 * → structure; MEP symbols → MEP.
 */
export function classifyFile(name: string, content: { plans: Recognition[]; structure: boolean; mep: boolean }): FileKind {
  const hint = fileHint(name)
  const titles = content.plans.map((r) => norm(r.region.title ?? ''))
  const most = (re: RegExp) => titles.length > 0 && titles.filter((t) => re.test(t)).length * 2 > titles.length
  if (hint === 'structure' || hint === 'mep') return hint
  if (content.plans.length) {
    if (content.mep && most(MEP_TITLE)) return 'mep'
    if (content.structure && most(STRUCT_TITLE)) return 'structure'
    return 'arch'
  }
  if (content.structure) return 'structure'
  if (content.mep) return 'mep'
  return hint ?? 'unknown'
}

/* ================================================================ the run */

export async function runAuto(doc: CadDocument, opt: AutoOptions): Promise<AutoResult> {
  const t0 = Date.now()
  opt.onStep?.('layers')
  await pause()
  const docs = [doc, ...(opt.extras ?? [])]
  const statsOf: LayerStat[][] = docs.map((d) => layerStats(d))
  const rolesOf = statsOf.map((st) => Object.fromEntries(st.map((s) => [s.name, s.role])) as Record<string, LayerRole>)
  const civilOf = statsOf.map((st) => Object.fromEntries(st.map((s) => [s.name, civilRuleRole(s.name) ?? 'ignore'])) as Record<string, CivilRole>)

  // the AI only on layers NO rule knew (and that hold enough geometry to matter), the same name in every file once
  let ai: AutoResult['ai'] = null
  const seen = new Set<string>()
  const unknown = statsOf.flat().filter((s) => aiCandidate(s) && !seen.has(s.name) && (seen.add(s.name), true))
  if (opt.useAi && opt.host && unknown.length) {
    opt.onStep?.('ai')
    const r = await suggestLayerRoles(opt.host, unknown.slice(0, 40))
    const lines = unknown.filter((u) => (u.kinds.line ?? 0) + (u.kinds.polyline ?? 0) >= 5).slice(0, 40).map((u) => ({ name: u.name, lines: (u.kinds.line ?? 0) + (u.kinds.polyline ?? 0), texts: u.texts }))
    let seconds = r.seconds, error = r.error
    let civilAi: Record<string, CivilRole> = {}
    if (lines.length) {
      const c = await suggestCivilRoles(opt.host, lines)
      seconds += c.seconds
      error = error ?? c.error
      civilAi = c.roles
    }
    const set: string[] = []
    docs.forEach((_, i) => { for (const n of mergeAiRoles(statsOf[i], rolesOf[i], civilOf[i], r.roles, civilAi)) if (!set.includes(n)) set.push(n) })
    ai = { asked: unknown.length, set, seconds, model: r.model, ...(error && !set.length ? { error } : {}) }
  }
  const houseRoles = Object.assign({}, ...[...rolesOf].reverse()) as Record<string, LayerRole>
  const civilRoles = Object.assign({}, ...[...civilOf].reverse()) as Record<string, CivilRole>

  // what each file is: by its content, its name as a hint
  opt.onStep?.('house')
  await pause()
  const content = docs.map((d, i) => ({ ...realPlans(d, rolesOf[i]), structure: hasStructure(d), mep: hasMep(d) }))
  const kinds = docs.map((d, i) => classifyFile(d.name, { plans: content[i].recs, structure: content[i].structure, mep: content[i].mep }))
  let archIdx = docs.map((_, i) => i).filter((i) => kinds[i] === 'arch')
  // no architectural file: the plans of any file that has some (MEP drawings carry the architecture underneath)
  if (!archIdx.length) { const any = docs.map((_, i) => i).filter((i) => content[i].recs.length); archIdx = any.slice(0, 1) }
  const files: AutoFile[] = docs.map((d, i) => ({ name: d.name, kind: kinds[i], hint: fileHint(d.name), plans: content[i].recs.length, structure: content[i].structure, mep: content[i].mep, usedForPlans: archIdx.includes(i), ...(opt.units?.[d.name] ? { units: opt.units[d.name] } : {}) }))

  // building: the floor plans of every architectural file, levels merged
  let house: AutoHouse | null = null
  const plans = archIdx.flatMap((i) => content[i].plans)
  type Cand = { rec: Recognition; file: string; roof: boolean }
  const cands: Cand[] = archIdx.flatMap((i) => content[i].recs.map((rec) => ({ rec, file: docs[i].name, roof: rec.region.kind === 'roof' })))
  // a level found twice (two files, or two plans of one file): the richer plan is kept, the other said so
  const duplicates: AutoHouse['duplicates'] = []
  const byName = new Map<string, Cand>()
  const rich = (c: Cand) => c.rec.rooms.length * 1000 + c.rec.walls.length + c.rec.furniture.length
  const label = (c: Cand) => `${c.rec.region.title ?? c.rec.region.id} (${c.file})`
  const real: Cand[] = []
  for (const c of cands) {
    const n = c.rec.region.levelName ? norm(c.rec.region.levelName) : null
    const prev = n ? byName.get(n) : undefined
    if (!n || !prev) { if (n) byName.set(n, c); real.push(c); continue }
    const [keep, drop] = rich(c) > rich(prev) ? [c, prev] : [prev, c]
    duplicates.push({ level: c.rec.region.levelName!, kept: label(keep), dropped: label(drop) })
    if (keep === c) { real.splice(real.indexOf(prev), 1, c); byName.set(n, c) }
  }
  if (real.length) {
    opt.onStep?.('build')
    await pause()
    const roofEl = archIdx.map((i) => roofElevation(docs[i])).reduce<number | null>((a, v) => (v === null ? a : a === null ? v : Math.max(a, v)), null)
    const elev = inferElevations(real.map((c) => ({ order: c.rec.region.order, elevation: c.rec.region.elevation, roof: c.roof })), DEFAULT_BUILD.storeyH, roofEl)
    const ordered = real.map((c, i) => ({ c, i, e: elev[i] })).sort((a, b) => a.e.elevation - b.e.elevation || a.i - b.i)
    // levels named by the plan titles ("Tầng 2"); untitled plans get the default name (never one already used)
    const used = new Set(real.flatMap((c) => (c.rec.region.levelName ? [norm(c.rec.region.levelName)] : [])))
    const picks = ordered.map(({ c, e }, k) => {
      let name = c.rec.region.levelName
      if (!name) { let n = k + 1; while (used.has(norm(opt.levelName(n)))) n++; name = opt.levelName(n); used.add(norm(name)) }
      return { rec: c.rec, levelName: name, elevation: e.elevation, roof: c.roof, how: e.inferred }
    })
    const inferred = picks.flatMap((p) => (p.how ? [{ level: p.levelName, elevation: p.elevation, how: p.how }] : []))
    const topEl = Math.max(...picks.map((p) => p.elevation))
    const storeyH = roofEl !== null && roofEl > topEl + 1500 && !picks.some((p) => p.roof) ? roofEl - topEl : DEFAULT_BUILD.storeyH
    const built = buildBimModel(picks.map(({ rec, levelName, elevation, roof }) => ({ rec, levelName, elevation, roof })), { ...DEFAULT_BUILD, storeyH }, opt.names)
    // Interior: the level with the most furniture (the first level when none has any)
    const sorted = picks
    let li = 0
    sorted.forEach((p, i) => { if (p.rec.furniture.length > sorted[li].rec.furniture.length) li = i })
    const lv = built.model.levels[li]
    const interior = lv && built.model.rooms.some((r) => r.level === lv.id) ? buildInterior(built.model, lv.id, sorted[li].rec.furniture, built.align.origins[li], opt.names) : null
    const interiors = sorted.flatMap((p, i) => {
      const l = built.model.levels[i]
      if (!l || p.roof || !built.model.rooms.some((r) => r.level === l.id && !r.void)) return []
      const b = i === li && interior ? interior : buildInterior(built.model, l.id, p.rec.furniture, built.align.origins[i], opt.names)
      return b.rooms.length ? [{ level: l.name, build: b }] : []
    })
    const recs = real.map((c) => c.rec)
    const recLevels = recs.map((r) => picks.find((p) => p.rec === r)?.levelName ?? r.region.levelName ?? '')
    house = { plans, recs, recLevels, built, checks: runModelChecks(built.model), interior, interiorLevel: interior ? li : null, interiors, structure: [], inferred, duplicates }
    // structural drawings of the project (any of the files): beams, pile caps, ties, slab openings
    const sdocs = docs.filter((_, i) => content[i].structure)
    if (sdocs.length) {
      opt.onStep?.('structure')
      await pause()
      for (const d of sdocs) {
        const s = readStructure(d, built.model, built.align.grid)
        if (!s.plans.length) continue
        const before = built.model.slabs.reduce((a, x) => a + (x.openings?.length ?? 0), 0)
        built.model = applyStructure(built.model, s)
        const after = built.model.slabs.reduce((a, x) => a + (x.openings?.length ?? 0), 0)
        house.structure.push({ file: d.name, plans: s.plans.length, beams: s.beams.filter((b) => !b.tie).length, ties: s.beams.filter((b) => b.tie).length, footings: s.footings.length, piles: s.footings.reduce((a, f) => a + f.piles, 0), openings: after - before, warnings: s.warnings })
      }
      house.checks = runModelChecks(built.model)
    }
    // pitched roofs on the roof plans of any of the drawings
    for (const d of docs) {
      const rr = readRoofs(d, built.model, built.align.grid)
      if (rr.roofs.length) built.model = { ...built.model, roofs: [...(built.model.roofs ?? []), ...rr.roofs.map((r, i) => ({ ...r, id: `roof-${(built.model.roofs?.length ?? 0) + i + 1}`, mark: `R${(built.model.roofs?.length ?? 0) + i + 1}` }))] }
      built.notes.push(...rr.warnings)
    }
  }

  // routes
  opt.onStep?.('route')
  await pause()
  let route: AutoRoute | null = null
  const routes = docs.flatMap((d, i) => {
    const rs = findRoutes(d, civilOf[i]).filter((r) => r.sections.length >= 2)
    if (rs.length && files[i].kind === 'unknown') files[i].kind = 'route'
    return rs
  })
  if (routes.length) {
    // a route with a design line first (one without can't be built: validateCivil refuses it in the review),
    // then the one with the most sections
    const chosen = [...routes].sort((a, b) => Number(routeHasDesign(b)) - Number(routeHasDesign(a)) || b.sections.length - a.sections.length)[0]
    route = { routes, chosen, model: buildCivilModel(opt.civilBase, chosen, doc.name), volume: volumes(chosen.sections), all: routes.map((x) => ({ name: x.name, model: buildCivilModel(opt.civilBase, x, doc.name), volume: volumes(x.sections) })) }
  }
  // MEP drawings of the project: devices and runs per level
  const bm = house?.built.model
  const mlevels = bm ? [...bm.levels].sort((a, b) => a.elevation - b.elevation).map((l) => ({ name: l.name, elevation: l.elevation })) : []
  // placed on the building by its alignment grid (for the coordination model)
  const g = house?.built.align.grid ?? null
  const mg = (lab: string) => bm?.grids.find((x) => x.label === lab)
  const at = g && mg(g[0]) && mg(g[1]) ? cross(mg(g[0])!, mg(g[1])!) : null
  const mep = docs.filter((_, i) => content[i].mep).map((d) => readMep(d, mlevels, opt.names.roofLevel, g && at ? { grid: g, at } : undefined)).filter((x) => x.plans.length && x.rows.length)
  const mepModel = bm && mep.some((x) => x.items.length) ? buildMepModel(mep.flatMap((x) => x.items), bm) : null
  opt.onStep?.('check')
  const kind = house && route ? 'both' : house ? 'house' : route ? 'route' : mep.length ? 'mep' : 'none'
  const main = archIdx.length ? docs[archIdx[0]].name : doc.name
  return { file: main, kind, houseRoles, civilRoles, ai, house, route, mep, mepModel, files, ms: Date.now() - t0 }
}

/** Builds the Civil model of another route of the same result (the user picked it). */
export function withRoute(r: AutoResult, i: number, base: CivilModel): AutoResult {
  if (!r.route) return r
  const chosen = r.route.routes[i]
  return { ...r, route: { ...r.route, chosen, model: buildCivilModel(base, chosen, r.file), volume: volumes(chosen.sections) } }
}
