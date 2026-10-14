/**
 * One command: a drawing in → everything the app can make from it, ready for one approval.
 *
 *  1. layer roles from their names (house and route rules); the local AI (when loaded) is asked ONLY about the
 *     layers no rule recognised, and its answer only fills those — it never overrides a name rule;
 *  2. what the drawing is: floor plans (walls + rooms recognised) → a building; long-profile tables with cross
 *     sections → canal / road routes; both can be present;
 *  3. building → BIM model (levels from the plan titles, roof elevation from the roof-plan title), model checks,
 *     Interior data of the level with the most furniture (rooms, items, parametric cabinets);
 *     route → Civil model of the route with the most sections, volumes against the designer's areas;
 *  4. the output package is made from these models by src/auto/package.ts.
 * Every number comes from code; nothing is written until the user approves (src/screens/auto/AutoDialog.tsx).
 */
import type { HostApi } from '../services/host'
import type { HouseViews } from './views'
import { applyStructure, hasStructure, readStructure } from '../bim/structure'
import { readRoofs } from '../bim/roof'
import { hasMep, readMep, type MepResult } from './mep'
import type { CadDocument } from '../cad/types'
import { DEFAULT_REC, findPlans, layerStats, recognize, roofElevation, type LayerRole, type LayerStat, type PlanRegion, type Recognition } from '../bim/fromCad'
import { DEFAULT_BUILD, buildBimModel, buildInterior, type BuildNames, type BuildResult, type InteriorBuild } from '../bim/fromCadBuild'
import { runModelChecks, type CheckResult } from '../bim/model'
import { civilRuleRole, findRoutes, volumes, type CivilRole, type Route } from '../civil/fromCad'
import { buildCivilModel } from '../civil/fromCadBuild'
import type { CivilModel } from '../civil/model'
import { suggestCivilRoles, suggestLayerRoles } from '../ai/layerRoles'

export type AutoStep = 'layers' | 'ai' | 'house' | 'route' | 'build' | 'structure' | 'check'

export interface AutoHouse {
  plans: PlanRegion[]
  recs: Recognition[]
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
}

export interface AutoRoute {
  routes: Route[]
  chosen: Route
  model: CivilModel
  volume: ReturnType<typeof volumes>
  /** every route of the drawing (the package has them all; the Civil workspace gets `model`) */
  all: { name: string; model: CivilModel; volume: ReturnType<typeof volumes> }[]
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
  /** quantities from the MEP drawings (electrical, plumbing, air conditioning) */
  mep: MepResult[]
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
  /** More drawings of the same project: structural drawings (beams, foundations) are read onto the building,
   *  their routes added; the architectural plans are taken from `doc`. */
  extras?: CadDocument[]
}

const pause = () => new Promise((r) => setTimeout(r, 0))

export async function runAuto(doc: CadDocument, opt: AutoOptions): Promise<AutoResult> {
  const t0 = Date.now()
  opt.onStep?.('layers')
  await pause()
  const stats: LayerStat[] = layerStats(doc)
  const houseRoles = Object.fromEntries(stats.map((s) => [s.name, s.role])) as Record<string, LayerRole>
  const civilRoles = Object.fromEntries(stats.map((s) => [s.name, civilRuleRole(s.name) ?? 'ignore'])) as Record<string, CivilRole>

  // the AI only on layers no rule knew (and that hold enough geometry to matter)
  let ai: AutoResult['ai'] = null
  const unknown = stats.filter((s) => s.by === 'none' && s.count >= 5)
  if (opt.useAi && opt.host && unknown.length) {
    opt.onStep?.('ai')
    const set: string[] = []
    const r = await suggestLayerRoles(opt.host, unknown.slice(0, 40))
    for (const [name, role] of Object.entries(r.roles)) if (role !== 'ignore' && unknown.some((u) => u.name === name)) { houseRoles[name] = role; set.push(name) }
    const lines = unknown.filter((u) => (u.kinds.line ?? 0) + (u.kinds.polyline ?? 0) >= 5).slice(0, 40).map((u) => ({ name: u.name, lines: (u.kinds.line ?? 0) + (u.kinds.polyline ?? 0), texts: u.texts }))
    let seconds = r.seconds, error = r.error
    if (lines.length) {
      const c = await suggestCivilRoles(opt.host, lines)
      seconds += c.seconds
      error = error ?? c.error
      for (const [name, role] of Object.entries(c.roles)) if (role !== 'ignore') { civilRoles[name] = role; if (!set.includes(name)) set.push(name) }
    }
    ai = { asked: unknown.length, set, seconds, model: r.model, ...(error && !set.length ? { error } : {}) }
  }

  // building
  opt.onStep?.('house')
  await pause()
  let house: AutoHouse | null = null
  const plans = findPlans(doc, houseRoles).filter((p) => p.kind !== 'other')
  const recs = plans.map((p) => recognize(doc, houseRoles, p, DEFAULT_REC))
  const plan = recs.filter((r) => r.walls.length >= 4 && (r.rooms.length >= 1 || r.openings.length >= 2))
  // a building needs at least one plan with rooms: parallel lines with gaps alone (a canal's lining, a road's
  // kerbs in a long profile sheet) are not a house. Roof / room-less plans come along with the plans that have rooms.
  const real = plan.some((r) => r.rooms.length >= 1) ? plan : []
  if (real.length) {
    opt.onStep?.('build')
    await pause()
    const ordered = real.map((r, i) => ({ r, i })).sort((a, b) => (a.r.region.elevation ?? a.i * 1e6) - (b.r.region.elevation ?? b.i * 1e6))
    // levels named by the plan titles ("Tầng 2"); untitled plans get the default name
    const picks = ordered.map(({ r }, i) => ({ rec: r, levelName: r.region.levelName ?? opt.levelName(i + 1), elevation: r.region.elevation ?? i * DEFAULT_BUILD.storeyH, roof: r.region.kind === 'roof' }))
    const topEl = Math.max(...picks.map((p) => p.elevation))
    const roofEl = roofElevation(doc)
    const storeyH = roofEl !== null && roofEl > topEl + 1500 && !picks.some((p) => p.roof) ? roofEl - topEl : DEFAULT_BUILD.storeyH
    const built = buildBimModel(picks, { ...DEFAULT_BUILD, storeyH }, opt.names)
    // Interior: the level with the most furniture (the first level when none has any)
    const sorted = [...picks].sort((a, b) => a.elevation - b.elevation)
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
    house = { plans, recs: real, built, checks: runModelChecks(built.model), interior, interiorLevel: interior ? li : null, interiors, structure: [] }
    // structural drawings of the project (this one or the others given): beams, pile caps, ties, slab openings
    const sdocs = [doc, ...(opt.extras ?? [])].filter(hasStructure)
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
    for (const d of [doc, ...(opt.extras ?? [])]) {
      const rr = readRoofs(d, built.model, built.align.grid)
      if (rr.roofs.length) built.model = { ...built.model, roofs: [...(built.model.roofs ?? []), ...rr.roofs.map((r, i) => ({ ...r, id: `roof-${(built.model.roofs?.length ?? 0) + i + 1}`, mark: `R${(built.model.roofs?.length ?? 0) + i + 1}` }))] }
      built.notes.push(...rr.warnings)
    }
  }

  // routes
  opt.onStep?.('route')
  await pause()
  let route: AutoRoute | null = null
  const routes = [doc, ...(opt.extras ?? [])].flatMap((d) => {
    const roles = d === doc ? civilRoles : (Object.fromEntries(layerStats(d).map((s) => [s.name, civilRuleRole(s.name) ?? 'ignore'])) as Record<string, CivilRole>)
    return findRoutes(d, roles).filter((r) => r.sections.length >= 2)
  })
  if (routes.length) {
    const chosen = [...routes].sort((a, b) => b.sections.length - a.sections.length)[0]
    route = { routes, chosen, model: buildCivilModel(opt.civilBase, chosen, doc.name), volume: volumes(chosen.sections), all: routes.map((x) => ({ name: x.name, model: buildCivilModel(opt.civilBase, x, doc.name), volume: volumes(x.sections) })) }
  }
  // MEP drawings of the project: devices and runs per level
  const mep = [doc, ...(opt.extras ?? [])].filter(hasMep).map((d) => readMep(d, house?.built.model.levels.map((l) => l.name) ?? [], opt.names.roofLevel)).filter((x) => x.plans.length && x.rows.length)
  opt.onStep?.('check')
  const kind = house && route ? 'both' : house ? 'house' : route ? 'route' : mep.length ? 'mep' : 'none'
  return { file: doc.name, kind, houseRoles, civilRoles, ai, house, route, mep, ms: Date.now() - t0 }
}

/** Builds the Civil model of another route of the same result (the user picked it). */
export function withRoute(r: AutoResult, i: number, base: CivilModel): AutoResult {
  if (!r.route) return r
  const chosen = r.route.routes[i]
  return { ...r, route: { ...r.route, chosen, model: buildCivilModel(base, chosen, r.file), volume: volumes(chosen.sections) } }
}
