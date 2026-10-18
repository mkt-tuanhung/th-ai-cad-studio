/**
 * The output package of the one-command run (src/auto/pipeline.ts), made from the models by code:
 *  building — IFC 4; wall, room, door / window, furniture schedules (CSV); a floor-plan drawing per level
 *    (PDF sheet set, DXF, DWG); Interior furniture schedule and production cut list (CSV); nesting of the cut
 *    list on stock sheets (DXF) and the CNC programs (G-code) that cut them;
 *  route — earthwork per 100 m, cross-section areas, long profile (CSV); long-profile and cross-section drawings
 *    (PDF, DXF, DWG);
 *  a report (HTML) with what was found, the checks and every warning.
 * Writing: the desktop app writes into one folder the user picks (PDF and DWG need it); a plain browser downloads
 * one ZIP with the text files and the sheets as SVG.
 */
import type { HostApi } from '../services/host'
import type { CadDocument } from '../cad/types'
import { toDxf2000 } from '../cad/dxf2000'
import { toDwgAdd } from '../cad/dwgWrite'
import { pageSvg, plotPage, type Page } from '../cad/plot'
import { toBase64 } from '../services/dwg'
import { zip } from '../lib/zip'
import { toIfc } from '../bim/ifc'
import { wallsCsv, levelOf } from '../bim/model'
import type { Cabinet } from '../interior/model'
import { DEFAULT_NEST, cutListRows, labelRows, layoutDxf, type NestSettings } from '../cam/nesting'
import type { CamSettings } from '../cam/gcode'
import { profileContentHash, type MachineProfile } from '../cam/machine'
import { interiorCnc, type CamPrefsLike, type InteriorCnc } from '../cam/interiorJob'
import { previewFiles, type PreviewResult } from '../cam/release'
import { earthwork, interp, sta, type CivilModel, type DrawnSection } from '../civil/model'
import { planDocument, profileDocument, roofPlanDocument, sectionDocuments, structurePlanDocument, tableDocuments, type RouteWords, type TableRow } from './drawings'
import { boq, openingSchedule, priceOf, UNASSIGNED, type BoqRow, type BoqWords, type PriceBad } from '../bim/quantities'
import type { MepResult } from './mep'
import type { AutoResult } from './pipeline'

export type OutFile =
  | { name: string; kind: 'text'; text: string }
  | { name: string; kind: 'pdf'; pages: Page[] }
  | { name: string; kind: 'dwg'; doc: CadDocument }

export interface MepWords {
  title: string
  groups: { elec: string; hvac: string; plumb: string; fire: string; elv: string }
  items: Record<'panel' | 'light' | 'switch' | 'socket' | 'wire' | 'wireDrop' | 'lps' | 'ac' | 'fan' | 'cold' | 'hot' | 'waste' | 'sewer' | 'storm' | 'vent' | 'riser' | 'fixture' | 'detector' | 'alarm' | 'extinguisher' | 'exitSign' | 'sprinkler' | 'hydrant' | 'seal' | 'data' | 'tv' | 'ap' | 'camera' | 'intercom' | 'rack' | 'elvCable', string>
  acNone: string
  sizeNone: string
  sizeNote: string
}

export interface PackageText {
  plan: (level: string) => string
  /** the PDF of the elevations and sections */
  views: string
  profile: string
  sections: string
  report: (body: string) => string
  /** words on the route sheets (the drawings' own Vietnamese defaults when absent) */
  words?: RouteWords
  /** MEP quantities */
  mep?: MepWords
  /** bill of quantities and door / window schedule */
  boq?: {
    title: string
    schedule: string
    words: BoqWords
    heads: { no: string; item: string; unit: string; total: string }
    sched: { mark: string; kind: string; family: string; width: string; height: string; sill: string; levels: string; count: string }
    kinds: { door: string; window: string }
    estimate: string
    priceTemplate: string
    foundationPlan: string
    roofPlan: string
    beamPlan: string // "{level}"
    priceHeads: { key: string; price: string; amount: string }
    params: { pileLength: string; machineShare: string }
    /** a unit price list given with the drawings (BOQ key or item text → price; rows it could not read) */
    prices?: { file: string; map: Map<string, number>; bad?: PriceBad[] } | null
  }
}

const csv = (rows: (string | number)[][]) => rows.map((r) => r.map((c) => (/[",;\r\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(',')).join('\n') + '\n'
/** UTF-8 byte order mark: Excel on Windows reads a CSV without it in the ANSI code page (Vietnamese garbled). */
export const BOM = '﻿'
const withBom = (name: string, text: string) => (/\.csv$/i.test(name) && !text.startsWith(BOM) ? BOM + text : text)

/** A file name every system accepts: no \ / : * ? " < > | or control characters ("1/A" → "1-A"), no trailing
 *  dots / spaces, not empty. */
export function safeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const s = name.replace(/[\\/]+/g, '-').replace(/[:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '')
  return s || '_'
}

/** Names made unique (case-insensitive, as Windows and macOS compare them): "a.csv", "a (2).csv"… */
export function uniqueNames<T extends { name: string }>(files: T[]): T[] {
  const seen = new Set<string>()
  return files.map((f) => {
    let name = f.name
    const dot = name.lastIndexOf('.'), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : ''
    for (let k = 2; seen.has(name.toLowerCase()); k++) name = `${stem} (${k})${ext}`
    seen.add(name.toLowerCase())
    return name === f.name ? f : { ...f, name }
  })
}

export interface CamSetup {
  nest: NestSettings
  cnc: CamSettings
  /** Interior → Nesting & CNC settings (stock sizes, trim, web, grain). */
  prefs?: CamPrefsLike
  /** The machine profile chosen in Interior (null / absent = none: the previews say machine=NONE). */
  machine?: MachineProfile | null
  machineProfileId?: string | null
  /** The drawing the package was built from: fabricationAllowed(doc) of cad/provenance (uncalibrated imports block). */
  source?: { file: string; ok: boolean } | null
}
export const defaultCam = (cnc: CamSettings): CamSetup => ({ nest: DEFAULT_NEST, cnc })

/**
 * CNC of the package's cabinets: the same machine-aware pipeline as Interior → Nesting & CNC, written ONLY as
 * engineering previews (.NOT_FOR_MACHINE.txt + manifest). The one-command package never writes production NC;
 * oversize parts and every release blocker go into the report.
 */
export function cncPreview(cabinets: Cabinet[], cam: CamSetup, base: string): { cnc: InteriorCnc; preview: PreviewResult } {
  const prefs: CamPrefsLike = cam.prefs ?? { stock: cam.nest.stock ?? {}, trim: cam.nest.trim, web: Math.max(0, cam.nest.gap - cam.cnc.cutterD), grain: cam.nest.grained('Wood - Oak'), cnc: cam.cnc }
  const machine = cam.machine ?? null
  const cnc = interiorCnc({ cabinets, cam: prefs, machine, machineProfileId: machine ? machine.profile_id : (cam.machineProfileId ?? null), job: null, jobName: base, sourceDrawing: cam.source ?? null })
  const preview = previewFiles(cnc.sheets.flatMap((s) => s.programs), { machine, machineHash: machine ? profileContentHash(machine) : null, post: cnc.post, blockers: cnc.blockers, meta: cnc.meta })
  return { cnc, preview }
}

/** The cabinets of every level for the cut list, nesting and CNC (named "<level> · <cabinet>" when several
 *  levels have some, so parts and programs say where they go). */
export function allCabinets(r: AutoResult): Cabinet[] {
  const ints = r.house?.interiors?.length ? r.house.interiors : r.house?.interior ? [{ level: '', build: r.house.interior }] : []
  const multi = ints.filter((x) => x.build.cabinets.length).length > 1
  return ints.flatMap(({ level, build }) => build.cabinets.map((c) => (multi ? { ...c, name: `${level} · ${c.name}` } : c)))
}

/** The share of earthwork done by machine (the rest by hand) when the drawing gives none: 90 % as estimates usually
 *  take it, or the price list's line "machineShare" (0.95, 95 or "95%"). */
export const MACHINE_SHARE = 0.9
export function machineShare(prices?: Map<string, number>): number {
  const v = prices?.get('machineShare')
  if (v === undefined || !(v > 0)) return MACHINE_SHARE
  return v > 1 ? Math.min(1, v / 100) : v
}

export type SplitSource = 'drawing' | 'prices' | 'default'
export interface SplitRow { from: number; to: number; length: number; cut: number; fill: number; net: number; cutM: number; cutH: number; fillM: number; fillH: number; source: SplitSource }
export interface EarthSplit { rows: SplitRow[]; total: { cut: number; fill: number; cutM: number; cutH: number; fillM: number; fillH: number }; source: SplitSource | 'mixed' }

const numIn = (o: unknown, keys: string[]): number | undefined => {
  if (!o || typeof o !== 'object') return undefined
  for (const k of keys) { const v = (o as Record<string, unknown>)[k]; if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v }
  return undefined
}
/** The designer's machine / hand split of a section (or of the route), read defensively: machine and hand areas or
 *  volumes (cutMachine + cutManual, fillMachine + fillManual…), or a share (cutMachineShare / machineShare, 0.9 or 90). */
function splitOf(o: unknown, what: 'cut' | 'fill'): { m: number; h: number } | null {
  if (!o || typeof o !== 'object') return null
  const src = o as Record<string, unknown>
  const C = what === 'cut' ? 'Cut' : 'Fill'
  for (const x of [src, src.drawn, src.split, src.earthSplit, src.designerSplit]) {
    const m = numIn(x, [`${what}Machine`, `${what}ByMachine`, `machine${C}`])
    const h = numIn(x, [`${what}Manual`, `${what}Hand`, `${what}ByHand`, `manual${C}`, `hand${C}`])
    if (m !== undefined && h !== undefined && m + h > 0) return { m, h }
    const sh = numIn(x, [`${what}MachineShare`, 'machineShare'])
    if (sh !== undefined) { const f = sh > 1 ? sh / 100 : sh; if (f <= 1) return { m: f, h: 1 - f } }
  }
  return null
}

/**
 * Earthwork by machine and by hand, per row of the earthwork table: the designer's split read from the drawing
 * where the sections (or the route) carry one, else the price list's "machineShare", else 90 / 10. Each row says
 * which it used.
 */
export function earthSplit(m: CivilModel, prices?: Map<string, number>): EarthSplit {
  const ew = earthwork(m)
  const secs: DrawnSection[] = [...(m.sections ?? [])].sort((a, b) => a.station - b.station)
  const fallback: SplitSource = (prices?.get('machineShare') ?? 0) > 0 ? 'prices' : 'default'
  const ms = machineShare(prices)
  const route = splitOf(m, 'cut') || splitOf(m, 'fill') ? m : (m as unknown as { params?: unknown }).params
  const share = (from: number, to: number, what: 'cut' | 'fill'): { f: number; source: SplitSource } => {
    let near = secs.filter((x) => x.station >= from - 1e-6 && x.station <= to + 1e-6)
    if (!near.length) near = [secs.filter((x) => x.station < from).at(-1), secs.find((x) => x.station > to)].filter((x): x is DrawnSection => !!x)
    let sm = 0, sh = 0
    for (const x of near) { const p = splitOf(x, what); if (p) { sm += p.m; sh += p.h } }
    if (sm + sh > 0) return { f: sm / (sm + sh), source: 'drawing' }
    const rt = splitOf(route, what)
    if (rt) return { f: rt.m / (rt.m + rt.h), source: 'drawing' }
    return { f: ms, source: fallback }
  }
  const rows = ew.map((x): SplitRow => {
    const c = share(x.from, x.to, 'cut'), f = share(x.from, x.to, 'fill')
    const source: SplitSource = c.source === 'drawing' || f.source === 'drawing' ? 'drawing' : c.source
    return { ...x, cutM: x.cut * c.f, cutH: x.cut * (1 - c.f), fillM: x.fill * f.f, fillH: x.fill * (1 - f.f), source }
  })
  const total = rows.reduce((a, x) => ({ cut: a.cut + x.cut, fill: a.fill + x.fill, cutM: a.cutM + x.cutM, cutH: a.cutH + x.cutH, fillM: a.fillM + x.fillM, fillH: a.fillH + x.fillH }), { cut: 0, fill: 0, cutM: 0, cutH: 0, fillM: 0, fillH: 0 })
  const kinds = [...new Set(rows.map((x) => x.source))]
  return { rows, total, source: kinds.length === 1 ? kinds[0] : kinds.length ? 'mixed' : fallback }
}

/** Which parts of the result go in the package (the parts the user kept and the model rules accepted). */
export interface PackageInclude { house: boolean; interior: boolean; route: boolean; mep?: boolean }

/** Every file of the package (in memory). `include` limits it to the parts the user kept. File names are made
 *  safe for every system ("1/A" → "1-A") and unique. */
export function makePackage(r: AutoResult, cam: CamSetup, t: PackageText, include: PackageInclude): OutFile[] {
  return uniqueNames(packageFiles(r, cam, t, include).map((f) => ({ ...f, name: safeFileName(f.name) })))
}

function packageFiles(r: AutoResult, cam: CamSetup, t: PackageText, include: PackageInclude): OutFile[] {
  const base = r.file.replace(/\.(dwg|dxf|png|jpe?g|webp|pdf)$/i, '')
  const out: OutFile[] = []
  const priceRows: BoqRow[] = []
  const add = (name: string, text: string) => out.push({ name: `${base} - ${name}`, kind: 'text', text: withBom(name, text) })
  const drawing = (title: string, doc: CadDocument, pages: Page[]) => {
    out.push({ name: `${base} - ${title}.dxf`, kind: 'text', text: toDxf2000(doc) })
    out.push({ name: `${base} - ${title}.dwg`, kind: 'dwg', doc })
    // a sheet with its own scale (elevations, sections: 1:100) plots at it; the others at the scale that fits
    // the title block names the project (the drawing's file) and the sheet
    pages.push({ ...plotPage({ ...doc, name: `${base} — ${title}` }, 'A3', doc.layouts?.[0]?.scale ?? undefined), name: title })
  }
  if (r.house && include.house) {
    const m = r.house.built.model
    add('BIM.ifc', toIfc(m, base).text)
    add('Walls.csv', wallsCsv(m))
    add('Rooms.csv', csv([['Level', 'Number', 'Name', 'Area (m2)'], ...m.rooms.map((x) => [levelOf(m, x.level)?.name ?? x.level, x.number, x.name, x.area.toFixed(2)])]))
    const host = (id: string) => m.walls.find((w) => w.id === id)
    add('Doors and windows.csv', csv([['Mark', 'Kind', 'Family', 'Level', 'Host wall', 'Width (mm)', 'Height (mm)', 'Sill (mm)'], ...[...m.doors, ...m.windows].map((o) => [o.mark, o.category, o.family, levelOf(m, host(o.hostWall)?.baseLevel ?? '')?.name ?? '', o.hostWall, Math.round(o.width), Math.round(o.height), Math.round(o.sill)])]))
    if (m.components.length) add('Furniture (BIM).csv', csv([['Mark', 'Name', 'Level', 'W (mm)', 'D (mm)', 'H (mm)', 'X (mm)', 'Y (mm)', 'Rotation (°)'], ...m.components.map((c) => [c.mark, c.name, levelOf(m, c.level)?.name ?? '', c.w, c.d, c.h, c.x.toFixed(0), c.y.toFixed(0), c.rot])]))
    const pages: Page[] = []
    const views = r.house.views?.views ?? []
    const cuts = views.flatMap((v) => (v.cut ? [v.cut] : []))
    for (const lv of m.levels) if (m.walls.some((w) => w.baseLevel === lv.id)) drawing(t.plan(lv.name), planDocument(m, lv.id, t.plan(lv.name), cuts), pages)
    if (m.roofs?.length && t.boq) drawing(t.boq.roofPlan, roofPlanDocument(m, t.boq.roofPlan), pages)
    if (pages.length) out.push({ name: `${base} - ${t.plan('').replace(/\s*$/, '')}.pdf`, kind: 'pdf', pages })
    const vp: Page[] = []
    for (const v of views) drawing(v.title, v.doc, vp)
    if (vp.length) out.push({ name: `${base} - ${t.views}.pdf`, kind: 'pdf', pages: vp })
    if (t.boq) {
      const B = t.boq
      // bill of quantities: CSV (every level a column) and the table sheets
      const pl = B.prices?.map.get('pileLength')
      const rows = boq(m, B.words, { ...(pl ? { pileLength: pl } : {}) })
      // every level with a quantity, then the column of quantities on no level of the model: the columns add up
      const un = B.words.unassigned ?? UNASSIGNED
      const lvs = [...new Set([...m.levels].sort((a, b) => a.elevation - b.elevation).map((l) => l.name))].filter((n) => n !== un && rows.some((r) => r.byLevel[n]))
      if (rows.some((r) => r.byLevel[un])) lvs.push(un)
      const q = (v: number, unit: string) => (v ? (unit === B.words.units.pcs ? String(Math.round(v)) : v.toFixed(2)) : '')
      add(`${B.title}.csv`, csv([[B.heads.no, B.heads.item, B.heads.unit, ...lvs, B.heads.total], ...rows.map((r, i) => [i + 1, r.item, r.unit, ...lvs.map((l) => q(r.byLevel[l] ?? 0, r.unit)), q(r.total, r.unit)])]))
      const tr: TableRow[] = []
      let g = ''
      rows.forEach((r, i) => { if (r.group !== g) { g = r.group; tr.push({ group: g }) } tr.push([String(i + 1), r.item, r.unit, ...lvs.map((l) => q(r.byLevel[l] ?? 0, r.unit)), q(r.total, r.unit)]) })
      const bp: Page[] = []
      tableDocuments(B.title, [{ head: B.heads.no, w: 12, align: 'center' }, { head: B.heads.item, w: 110 }, { head: B.heads.unit, w: 18, align: 'center' }, ...lvs.map((l) => ({ head: l, w: 34, align: 'center' as const })), { head: B.heads.total, w: 38, align: 'center' }], tr).forEach((d, i, a) => drawing(a.length > 1 ? `${B.title} ${i + 1}` : B.title, d, bp))
      out.push({ name: `${base} - ${B.title}.pdf`, kind: 'pdf', pages: bp })
      priceRows.push(...rows)
      // structural sheets: the foundation plan and a beam plan per level, from the structural drawings
      if ((m.footings?.length ?? 0) || (m.beams?.length ?? 0)) {
        const sp2: Page[] = []
        if (m.footings?.length || m.beams?.some((b) => b.tie)) drawing(B.foundationPlan, structurePlanDocument(m, null, B.foundationPlan), sp2)
        for (const lv of [...m.levels].sort((a, b) => a.elevation - b.elevation)) if (m.beams?.some((b) => !b.tie && b.level === lv.id)) { const ti = B.beamPlan.replace('{level}', lv.name); drawing(ti, structurePlanDocument(m, lv.id, ti), sp2) }
        if (sp2.length) out.push({ name: `${base} - ${B.foundationPlan} + ${B.beamPlan.replace(' {level}', '')}.pdf`, kind: 'pdf', pages: sp2 })
      }
      // door and window schedule sheet
      const S = B.sched
      const sp: Page[] = []
      tableDocuments(B.schedule, [{ head: S.mark, w: 26, align: 'center' }, { head: S.kind, w: 26 }, { head: S.family, w: 60 }, { head: S.width, w: 26, align: 'center' }, { head: S.height, w: 26, align: 'center' }, { head: S.sill, w: 26, align: 'center' }, { head: S.levels, w: 80 }, { head: S.count, w: 24, align: 'center' }],
        openingSchedule(m).map((e) => [e.mark, B.kinds[e.kind], e.family, String(e.width), String(e.height), e.kind === 'door' ? '' : String(e.sill), e.levels.join(', '), String(e.count)])).forEach((d, i, a) => drawing(a.length > 1 ? `${B.schedule} ${i + 1}` : B.schedule, d, sp))
      out.push({ name: `${base} - ${B.schedule}.pdf`, kind: 'pdf', pages: sp })
    }
  }
  if (r.house?.interior && include.interior) {
    // every level with rooms: the furniture schedule, cut list, nesting and CNC of the whole house
    const ints = r.house.interiors?.length ? r.house.interiors : [{ level: '', build: r.house.interior }]
    add('Interior furniture.csv', csv([['Level', 'Item', 'Category', 'Room', 'W (mm)', 'D (mm)', 'H (mm)', 'Material', 'Qty'], ...ints.flatMap(({ level, build: d }) => d.items.map((i) => [level, i.name, i.category, d.rooms.find((x) => x.id === i.room)?.name ?? i.room, i.w ?? '', i.d ?? '', i.h, i.material, i.qty]))]))
    const cabinets = allCabinets(r)
    if (cabinets.length) {
      const { cnc, preview } = cncPreview(cabinets, cam, base)
      add('Cut list.csv', csv(cutListRows(cnc.parts)))
      const n = cnc.nest
      add('Nesting.dxf', layoutDxf(n.sheets, cnc.nestSettings.trim, cnc.sheets.flatMap((c, i) => c.cam.holes.map((h) => ({ sheet: i, x: h.x, y: h.y, d: h.d })))))
      add('Part labels.csv', csv(labelRows(n.sheets)))
      // previews are named "<job> - <material> #<sheet> T<tool>.NOT_FOR_MACHINE.txt": the package adds its own prefix
      for (const f of preview.files) add(`CNC ${f.name.startsWith(`${base} - `) ? f.name.slice(base.length + 3) : f.name}`, f.text)
    } else add('Cut list.csv', csv(cutListRows([])))
  }
  if (r.route && include.route) {
    // every route of the drawing; with several, each file is named after its route
    const all = r.route.all?.length ? r.route.all : [{ name: r.route.model.alignment.name, model: r.route.model, volume: r.route.volume }]
    for (const rt of all) routeFiles(rt.model, all.length > 1 ? `${safeFileName(rt.name)} - ` : '')
  }
  function routeFiles(m: CivilModel, pre: string) {
    const add = (name: string, text: string) => out.push({ name: `${base} - ${pre}${name}`, kind: 'text', text: withBom(name, text) })
    const drawing = (title: string, doc: CadDocument, pages: Page[]) => {
      out.push({ name: `${base} - ${pre}${title}.dxf`, kind: 'text', text: toDxf2000(doc) })
      out.push({ name: `${base} - ${pre}${title}.dwg`, kind: 'dwg', doc })
      pages.push({ ...plotPage({ ...doc, name: `${base} — ${pre}${title}` }, 'A3', doc.layouts?.[0]?.scale ?? undefined), name: title })
    }
    // by machine / by hand: the designer's split read from the drawing, else the price list's "machineShare", else 90 / 10
    const sp = earthSplit(m, t.boq?.prices?.map)
    const SRC: Record<SplitSource, string> = { drawing: 'drawing (designer)', prices: 'price list machineShare', default: 'usual 90/10' }
    const pct = (x: number, y: number) => (x + y > 0 ? ((x / (x + y)) * 100).toFixed(1) : '')
    const tot = sp.total
    add('Earthwork.csv', csv([
      ['From', 'To', 'Length (m)', 'Cut (m3)', 'Fill (m3)', 'Net (m3)', 'Cut by machine (m3)', 'Cut by hand (m3)', 'Fill by machine (m3)', 'Fill by hand (m3)', 'Cut by machine (%)', 'Fill by machine (%)', 'Machine / hand split from'],
      ...sp.rows.map((x) => [sta(x.from), sta(x.to), x.length.toFixed(2), x.cut.toFixed(2), x.fill.toFixed(2), x.net.toFixed(2), x.cutM.toFixed(2), x.cutH.toFixed(2), x.fillM.toFixed(2), x.fillH.toFixed(2), pct(x.cutM, x.cutH), pct(x.fillM, x.fillH), SRC[x.source]]),
      ['', 'Total', '', tot.cut.toFixed(2), tot.fill.toFixed(2), (tot.fill - tot.cut).toFixed(2), tot.cutM.toFixed(2), tot.cutH.toFixed(2), tot.fillM.toFixed(2), tot.fillH.toFixed(2), pct(tot.cutM, tot.cutH), pct(tot.fillM, tot.fillH), sp.source === 'mixed' ? 'mixed (see the rows)' : SRC[sp.source]],
    ]))
    add('Cross sections.csv', csv([['Stake', 'Station', 'Cut (m2)', 'Fill (m2)', 'Drawing cut (m2)', 'Drawing fill (m2)'], ...(m.sections ?? []).map((x) => [x.name, sta(x.station), x.cut.toFixed(3), x.fill.toFixed(3), x.drawn?.cut?.toFixed(2) ?? '', x.drawn?.fill?.toFixed(2) ?? ''])]))
    add('Long profile.csv', csv([['Station', 'Existing (m)', 'Design invert (m)'], ...m.invert.map(([s, z]) => [sta(s), m.ground?.length ? interp(m.ground, s).toFixed(3) : '', z.toFixed(3)])]))
    const pages: Page[] = []
    drawing(t.profile, profileDocument(m, t.profile, t.words), pages)
    sectionDocuments(m, t.sections, t.words).forEach((d, i) => drawing(`${t.sections} ${i + 1}`, d, pages))
    out.push({ name: `${base} - ${pre}${t.profile} + ${t.sections}.pdf`, kind: 'pdf', pages })
  }
  // MEP drawings: devices counted, wiring and pipes measured (src/auto/mep.ts)
  if (r.mep?.length && t.mep && t.boq && include.mep !== false) {
    const M = t.mep, B = t.boq
    const mrows = mepBoqRows(r.mep, M, B.words.units)
    const lvs = [...new Set(mrows.flatMap((x) => Object.keys(x.byLevel)))]
    const order = (r.house?.built.model.levels ?? []).map((l) => l.name)
    lvs.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
    const q = (v: number, unit: string) => (v ? (unit === B.words.units.pcs ? String(Math.round(v)) : v.toFixed(2)) : '')
    add(`${M.title}.csv`, csv([[B.heads.no, B.heads.item, B.heads.unit, ...lvs, B.heads.total], ...mrows.map((x, i) => [i + 1, x.item, x.unit, ...lvs.map((l) => q(x.byLevel[l] ?? 0, x.unit)), q(x.total, x.unit)])]))
    const tr: TableRow[] = []
    let g = ''
    mrows.forEach((x, i) => { if (x.group !== g) { g = x.group; tr.push({ group: g }) } tr.push([String(i + 1), x.item, x.unit, ...lvs.map((l) => q(x.byLevel[l] ?? 0, x.unit)), q(x.total, x.unit)]) })
    const mp: Page[] = []
    tableDocuments(M.title, [{ head: B.heads.no, w: 12, align: 'center' }, { head: B.heads.item, w: 130 }, { head: B.heads.unit, w: 18, align: 'center' }, ...lvs.map((l) => ({ head: l, w: 30, align: 'center' as const })), { head: B.heads.total, w: 34, align: 'center' }], tr).forEach((d, i, a) => drawing(a.length > 1 ? `${M.title} ${i + 1}` : M.title, d, mp))
    out.push({ name: `${base} - ${M.title}.pdf`, kind: 'pdf', pages: mp })
    priceRows.push(...mrows)
  }
  // unit prices for every line of the quantities (building and MEP), and the estimate with a price list given
  if (t.boq && priceRows.length) {
    // unit prices: a template with every line to fill in; with a price list given, the estimate
    const B = t.boq, H = B.heads, PH = B.priceHeads
    const rows = priceRows
    const q = (v: number, unit: string) => (v ? (unit === B.words.units.pcs ? String(Math.round(v)) : v.toFixed(2)) : '')
    // project figures the drawings do not give go in the same list (their value in the price column)
    const par = (k: string) => B.prices?.map.get(k) ?? ''
    add(`${B.priceTemplate}.csv`, csv([[PH.key, H.item, H.unit, H.total, PH.price], ...rows.map((r) => [r.key, r.item, r.unit, q(r.total, r.unit), B.prices ? (priceOf(B.prices.map, r) ?? '') : '']), ['pileLength', B.params.pileLength, 'm', '', par('pileLength')], ['machineShare', B.params.machineShare, '%', '', par('machineShare')]]))
    if (B.prices && rows.some((r) => priceOf(B.prices!.map, r) !== undefined)) {
      const P = B.prices.map
      const money = (v: number) => Math.round(v).toLocaleString('vi-VN')
      const priced = rows.map((r) => ({ r, p: priceOf(P, r) }))
      const sum = priced.reduce((a, x) => a + (x.p !== undefined ? x.p * x.r.total : 0), 0)
      add(`${B.estimate}.csv`, csv([[H.no, H.item, H.unit, H.total, PH.price, PH.amount], ...priced.map(({ r, p }, i) => [i + 1, r.item, r.unit, q(r.total, r.unit), p ?? '', p !== undefined ? Math.round(p * r.total) : '']), ['', B.words.all, '', '', '', Math.round(sum)]]))
      const er: TableRow[] = []
      let g2 = ''
      priced.forEach(({ r, p }, i) => { if (r.group !== g2) { g2 = r.group; er.push({ group: g2 }) } er.push([String(i + 1), r.item, r.unit, q(r.total, r.unit), p !== undefined ? money(p) : '', p !== undefined ? money(p * r.total) : '']) })
      er.push(['', B.words.all.toUpperCase(), '', '', '', money(sum)])
      const ep: Page[] = []
      tableDocuments(B.estimate, [{ head: H.no, w: 12, align: 'center' }, { head: H.item, w: 150 }, { head: H.unit, w: 18, align: 'center' }, { head: H.total, w: 40, align: 'center' }, { head: PH.price, w: 50, align: 'center' }, { head: PH.amount, w: 60, align: 'center' }], er).forEach((d, i, a) => drawing(a.length > 1 ? `${B.estimate} ${i + 1}` : B.estimate, d, ep))
      out.push({ name: `${base} - ${B.estimate}.pdf`, kind: 'pdf', pages: ep })
    }
  }
  return out
}

/** The MEP quantities as lines of a bill (group, item text, unit), the diameter split said to be by label. */
export function mepBoqRows(res: MepResult[], M: MepWords, U: BoqWords['units']): BoqRow[] {
  const map = new Map<string, BoqRow>()
  for (const r of res)
    for (const x of r.rows) {
      const group = ['panel', 'light', 'switch', 'socket', 'wire', 'wireDrop', 'lps'].includes(x.role) ? M.groups.elec : ['ac', 'fan'].includes(x.role) ? M.groups.hvac : ['detector', 'alarm', 'extinguisher', 'exitSign', 'sprinkler', 'hydrant', 'seal'].includes(x.role) ? M.groups.fire : ['data', 'tv', 'ap', 'camera', 'intercom', 'rack', 'elvCable'].includes(x.role) ? M.groups.elv : M.groups.plumb
      const pipe = ['cold', 'hot', 'waste', 'sewer', 'storm', 'vent', 'riser'].includes(x.role)
      const size = x.role === 'ac' ? (x.size ? x.size.toUpperCase() : M.acNone) : pipe ? (x.size ? `D${x.size} ${M.sizeNote}` : M.sizeNone) : ''
      const item = (M.items as Record<string, string>)[x.role].replace('{size}', size).trim()
      const e = map.get(x.key) ?? { key: x.key, group, item, unit: x.unit === 'pcs' ? U.pcs : U.m, byLevel: {}, total: 0 }
      for (const [k, v] of Object.entries(x.byLevel)) e.byLevel[k] = (e.byLevel[k] ?? 0) + v
      e.total += x.total
      map.set(x.key, e)
    }
  return [...map.values()]
}

export interface Written {
  name: string
  ok: boolean
  bytes?: number
  error?: string
}

/** Desktop: every file into `dir` (never overwrites). Browser: one ZIP download (sheets as SVG; no PDF / DWG). */
export async function writePackage(files: OutFile[], report: string, host: HostApi | null, dir: string | null, zipName: string, onFile?: (n: number) => void): Promise<Written[]> {
  const res: Written[] = []
  if (host && dir) {
    const all: OutFile[] = uniqueNames([...files, { name: safeFileName(zipName.replace(/\.zip$/, ' - Report.html')), kind: 'text' as const, text: report }])
    for (const f of all) {
      let r: { ok: boolean; bytes?: number; error?: string; path?: string }
      if (f.kind === 'text') r = await host.writeFileTo(dir, f.name, toBase64(new TextEncoder().encode(f.text)))
      else if (f.kind === 'pdf') r = await host.cadExportPdfTo(JSON.stringify({ name: f.name, pages: f.pages }), dir, f.name)
      else {
        r = await host.dwgWriteDxfTo(toDxf2000(f.doc, { leftText: true }), dir, f.name)
        if (r.error === 'no-writer') r = await host.dwgWriteTo(toDwgAdd(f.doc).script, dir, f.name)
      }
      res.push({ name: r.path?.split(/[\\/]/).pop() ?? f.name, ok: r.ok, bytes: r.bytes, ...(r.ok ? {} : { error: r.error ?? 'failed' }) })
      onFile?.(res.length)
    }
    return res
  }
  const texts: { name: string; text: string }[] = []
  for (const f of files) {
    if (f.kind === 'text') texts.push({ name: f.name, text: f.text })
    else if (f.kind === 'pdf') f.pages.forEach((p) => texts.push({ name: f.name.replace(/\.pdf$/, ` - ${p.name}.svg`), text: pageSvg(p) }))
    else res.push({ name: f.name, ok: false, error: 'desktop-only' })
  }
  texts.push({ name: 'Report.html', text: report })
  // every name safe and once in the ZIP (sheet names may repeat across the PDFs)
  const bytes = zip(uniqueNames(texts.map((x) => ({ ...x, name: safeFileName(x.name) }))))
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }))
  const a = document.createElement('a')
  a.href = url
  a.download = safeFileName(zipName)
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  res.unshift({ name: safeFileName(zipName), ok: true, bytes: bytes.length })
  return res
}
