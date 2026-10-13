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
import { cutList, type Cabinet } from '../interior/model'
import { DEFAULT_NEST, layoutDxf, nest, piecesOf, type NestSettings } from '../cam/nesting'
import { camSheet, type CamSettings } from '../cam/gcode'
import { earthwork, interp, sta, type CivilModel } from '../civil/model'
import { planDocument, profileDocument, sectionDocuments, tableDocuments, type RouteWords, type TableRow } from './drawings'
import { boq, openingSchedule, type BoqWords } from '../bim/quantities'
import type { AutoResult } from './pipeline'

export type OutFile =
  | { name: string; kind: 'text'; text: string }
  | { name: string; kind: 'pdf'; pages: Page[] }
  | { name: string; kind: 'dwg'; doc: CadDocument }

export interface PackageText {
  plan: (level: string) => string
  /** the PDF of the elevations and sections */
  views: string
  profile: string
  sections: string
  report: (body: string) => string
  /** words on the route sheets (the drawings' own Vietnamese defaults when absent) */
  words?: RouteWords
  /** bill of quantities and door / window schedule */
  boq?: {
    title: string
    schedule: string
    words: BoqWords
    heads: { no: string; item: string; unit: string; total: string }
    sched: { mark: string; kind: string; family: string; width: string; height: string; sill: string; levels: string; count: string }
    kinds: { door: string; window: string }
  }
}

const csv = (rows: (string | number)[][]) => rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(',')).join('\n') + '\n'

export interface CamSetup {
  nest: NestSettings
  cnc: CamSettings
}
export const defaultCam = (cnc: CamSettings): CamSetup => ({ nest: DEFAULT_NEST, cnc })

/** The cabinets of every level for the cut list, nesting and CNC (named "<level> · <cabinet>" when several
 *  levels have some, so parts and programs say where they go). */
export function allCabinets(r: AutoResult): Cabinet[] {
  const ints = r.house?.interiors?.length ? r.house.interiors : r.house?.interior ? [{ level: '', build: r.house.interior }] : []
  const multi = ints.filter((x) => x.build.cabinets.length).length > 1
  return ints.flatMap(({ level, build }) => build.cabinets.map((c) => (multi ? { ...c, name: `${level} · ${c.name}` } : c)))
}

/** Every file of the package (in memory). `include` limits it to the parts the user kept. */
export function makePackage(r: AutoResult, cam: CamSetup, t: PackageText, include: { house: boolean; interior: boolean; route: boolean }): OutFile[] {
  const base = r.file.replace(/\.(dwg|dxf)$/i, '')
  const out: OutFile[] = []
  const add = (name: string, text: string) => out.push({ name: `${base} - ${name}`, kind: 'text', text })
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
    if (pages.length) out.push({ name: `${base} - ${t.plan('').replace(/\s*$/, '')}.pdf`, kind: 'pdf', pages })
    const vp: Page[] = []
    for (const v of views) drawing(v.title, v.doc, vp)
    if (vp.length) out.push({ name: `${base} - ${t.views}.pdf`, kind: 'pdf', pages: vp })
    if (t.boq) {
      const B = t.boq
      // bill of quantities: CSV (every level a column) and the table sheets
      const rows = boq(m, B.words)
      const lvs = [...m.levels].sort((a, b) => a.elevation - b.elevation).map((l) => l.name).filter((n) => rows.some((r) => r.byLevel[n]))
      const q = (v: number, unit: string) => (v ? (unit === B.words.units.pcs ? String(Math.round(v)) : v.toFixed(2)) : '')
      add(`${B.title}.csv`, csv([[B.heads.no, B.heads.item, B.heads.unit, ...lvs, B.heads.total], ...rows.map((r, i) => [i + 1, r.item, r.unit, ...lvs.map((l) => q(r.byLevel[l] ?? 0, r.unit)), q(r.total, r.unit)])]))
      const tr: TableRow[] = []
      let g = ''
      rows.forEach((r, i) => { if (r.group !== g) { g = r.group; tr.push({ group: g }) } tr.push([String(i + 1), r.item, r.unit, ...lvs.map((l) => q(r.byLevel[l] ?? 0, r.unit)), q(r.total, r.unit)]) })
      const bp: Page[] = []
      tableDocuments(B.title, [{ head: B.heads.no, w: 12, align: 'center' }, { head: B.heads.item, w: 110 }, { head: B.heads.unit, w: 18, align: 'center' }, ...lvs.map((l) => ({ head: l, w: 34, align: 'center' as const })), { head: B.heads.total, w: 38, align: 'center' }], tr).forEach((d, i, a) => drawing(a.length > 1 ? `${B.title} ${i + 1}` : B.title, d, bp))
      out.push({ name: `${base} - ${B.title}.pdf`, kind: 'pdf', pages: bp })
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
    const d = { cabinets: allCabinets(r) }
    const parts = d.cabinets.flatMap((c) => cutList(c))
    add('Cut list.csv', csv([['Cabinet', 'Part', 'Qty', 'Length (mm)', 'Width (mm)', 'Thickness (mm)', 'Material', 'Edge banding (mm/pc)'], ...parts.map((p) => [p.cabinet, p.part, p.qty, p.l, p.wd, p.t, p.material, p.edge])]))
    if (d.cabinets.length) {
      const n = nest(piecesOf(d.cabinets), cam.nest)
      const shelves = (name: string) => (d.cabinets.find((c: Cabinet) => c.name === name)?.shelves ?? 0) > 0
      const cams = n.sheets.map((sh) => camSheet(sh, cam.cnc, shelves, base))
      // programs are named "<job> - <material> #<sheet> T<tool>.nc": the package adds its own prefix
      add('Nesting.dxf', layoutDxf(n.sheets, cam.nest.trim, cams.flatMap((c, i) => c.holes.map((h) => ({ sheet: i, x: h.x, y: h.y, d: h.d })))))
      add('Part labels.csv', csv([['Sheet', 'Material', 'Part', 'Length (mm)', 'Width (mm)', 'Thickness (mm)', 'X (mm)', 'Y (mm)', 'Rotated'], ...n.sheets.flatMap((sh) => sh.parts.map((p) => [`${sh.material} #${sh.index}`, p.material, p.label, p.l, p.w, p.t, p.x.toFixed(1), p.y.toFixed(1), p.rotated ? 'yes' : 'no']))]))
      for (const c of cams) for (const p of c.programs) add(`CNC ${p.name.startsWith(`${base} - `) ? p.name.slice(base.length + 3) : p.name}`, p.text)
    }
  }
  if (r.route && include.route) {
    // every route of the drawing; with several, each file is named after its route
    const all = r.route.all?.length ? r.route.all : [{ name: r.route.model.alignment.name, model: r.route.model, volume: r.route.volume }]
    for (const rt of all) routeFiles(rt.model, all.length > 1 ? `${rt.name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()} - ` : '')
  }
  function routeFiles(m: CivilModel, pre: string) {
    const add = (name: string, text: string) => out.push({ name: `${base} - ${pre}${name}`, kind: 'text', text })
    const drawing = (title: string, doc: CadDocument, pages: Page[]) => {
      out.push({ name: `${base} - ${pre}${title}.dxf`, kind: 'text', text: toDxf2000(doc) })
      out.push({ name: `${base} - ${pre}${title}.dwg`, kind: 'dwg', doc })
      pages.push({ ...plotPage({ ...doc, name: `${base} — ${pre}${title}` }, 'A3', doc.layouts?.[0]?.scale ?? undefined), name: title })
    }
    add('Earthwork.csv', csv([['From', 'To', 'Length (m)', 'Cut (m3)', 'Fill (m3)', 'Net (m3)'], ...earthwork(m).map((x) => [sta(x.from), sta(x.to), x.length.toFixed(2), x.cut.toFixed(2), x.fill.toFixed(2), x.net.toFixed(2)])]))
    add('Cross sections.csv', csv([['Stake', 'Station', 'Cut (m2)', 'Fill (m2)', 'Drawing cut (m2)', 'Drawing fill (m2)'], ...(m.sections ?? []).map((x) => [x.name, sta(x.station), x.cut.toFixed(3), x.fill.toFixed(3), x.drawn?.cut?.toFixed(2) ?? '', x.drawn?.fill?.toFixed(2) ?? ''])]))
    add('Long profile.csv', csv([['Station', 'Existing (m)', 'Design invert (m)'], ...m.invert.map(([s, z]) => [sta(s), m.ground?.length ? interp(m.ground, s).toFixed(3) : '', z.toFixed(3)])]))
    const pages: Page[] = []
    drawing(t.profile, profileDocument(m, t.profile, t.words), pages)
    sectionDocuments(m, t.sections, t.words).forEach((d, i) => drawing(`${t.sections} ${i + 1}`, d, pages))
    out.push({ name: `${base} - ${pre}${t.profile} + ${t.sections}.pdf`, kind: 'pdf', pages })
  }
  return out
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
    const all: OutFile[] = [...files, { name: zipName.replace(/\.zip$/, ' - Report.html'), kind: 'text', text: report }]
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
  const bytes = zip(texts)
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }))
  const a = document.createElement('a')
  a.href = url
  a.download = zipName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  res.unshift({ name: zipName, ok: true, bytes: bytes.length })
  return res
}
