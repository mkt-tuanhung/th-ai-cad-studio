/**
 * Structural drawings (mặt bằng móng, mặt bằng kết cấu sàn) → beams, foundations and slab data for the BIM model
 * the architectural plans built (src/bim/fromCadBuild.ts). Read by code from the drawing:
 *  - layers by name: beams (S-BEAM, DẦM), tie beams (S-TIE, GIẰNG), foundations (S-FOUND, MÓNG, ĐÀI), piles
 *    (S-PILE, CỌC), slab outlines (S-SLAB, SÀN), slab openings (S-OPEN, LỖ), grids (S-GRID, TRỤC);
 *  - each structural plan: the entities of those layers grouped by place, its title under it ("MẶT BẰNG MÓNG …",
 *    "MẶT BẰNG KẾT CẤU SÀN TẦNG 2 (MẶT SÀN KC +3.850)") — the level by its name, else by the elevation written;
 *  - it is placed on the model by the grid intersection the model was aligned on (grid 1 / A);
 *  - a beam: two parallel lines 100…500 mm apart along each other (the width b); its size "D2-1 220x300" from the
 *    nearest tag along it (b × h); without a tag, h of the plan's tagged beams of that width (flagged);
 *  - a pile cap: a closed outline on a foundation layer, its tag "M3 (2 cọc)", the pile squares inside it; its top
 *    and bottom from the texts "ĐỈNH ĐÀI −0.950" / "ĐÁY ĐÀI −1.600" (or "H=700");
 *  - a tie beam: a pair of lines on a tie layer, its size "GM 250×450"; its top at the pile caps' top;
 *  - slab openings: closed outlines on an opening layer (drawn crossed); slab thickness "h=120".
 * Nothing is designed here: what the drawing does not say is reported as a warning.
 */
import type { CadDocument, Entity, Vec2 } from '../cad/types'
import type { Beam, BimModel, Footing, P2, RebarSpec } from './model'
import { boxOf, norm, parseElevation, parseSize, segsOf, type Box } from './fromCad'

export type StructRole = 'beam' | 'tie' | 'found' | 'pile' | 'slab' | 'open' | 'grid' | 'text' | 'ignore'

export function structRole(layer: string): StructRole {
  const n = norm(layer)
  if (/(CUT|CAT|DIM|KICH ?THUOC|REBAR|THEP|HATCH)/.test(n)) return 'ignore'
  if (/(TIE|GIANG)/.test(n)) return 'tie'
  if (/(PILE|\bCOC\b)/.test(n)) return 'pile'
  if (/(FOUND|FOOTING|PILE ?CAP|\bMONG\b|\bDAI\b)/.test(n)) return 'found'
  if (/(BEAM|\bDAM\b)/.test(n)) return 'beam'
  if (/(OPEN|\bLO\b|VOID)/.test(n)) return 'open'
  if (/(SLAB|\bSAN\b)/.test(n)) return 'slab'
  if (/(GRID|AXIS|\bTRUC\b)/.test(n)) return 'grid'
  if (/(TAG|TEXT|\bCHU\b|LEVEL|COS|CAO ?DO)/.test(n)) return 'text'
  return 'ignore'
}

export interface StructPlan {
  kind: 'foundation' | 'floor'
  title: string
  box: Box
  /** the model level it belongs to (null: not matched) */
  level: string | null
  /** elevation written in the title (structural top), mm */
  elevation: number | null
}

export interface StructResult {
  plans: StructPlan[]
  beams: Beam[]
  footings: Footing[]
  /** per level: openings in the slab (model coordinates) and its thickness when written */
  slabs: { level: string; openings: P2[][]; thickness: number | null }[]
  /** the reinforcement of the typical details, when written */
  rebar?: RebarSpec
  warnings: string[]
}

type Txt = Extract<Entity, { kind: 'text' }>
const grow = (b: Box, o: Box) => ({ x0: Math.min(b.x0, o.x0), y0: Math.min(b.y0, o.y0), x1: Math.max(b.x1, o.x1), y1: Math.max(b.y1, o.y1) })
const near = (a: Box, b: Box, pad: number) => a.x0 - pad <= b.x1 && b.x0 - pad <= a.x1 && a.y0 - pad <= b.y1 && b.y0 - pad <= a.y1
const inBox = (p: Vec2, b: Box, pad = 0) => p.x >= b.x0 - pad && p.x <= b.x1 + pad && p.y >= b.y0 - pad && p.y <= b.y1 + pad
const r1 = (v: number) => Math.round(v * 10) / 10

/** Grid lines of a plan: long lines on grid layers labelled by the short text at one of their ends. */
export function gridsIn(ents: Entity[], texts: Txt[], box: Box): { label: string; a: P2; b: P2 }[] {
  const out: { label: string; a: P2; b: P2 }[] = []
  // grid bubbles sit past the line ends, well outside a narrow plan
  const labels = texts.filter((t) => /^([A-Z]{1,2}|\d{1,2}[A-Z]?)'?$/i.test(t.value.trim()) && !/^D\d/i.test(t.value.trim()) && inBox(t.p, box, 12000))
  for (const e of ents) {
    for (const [a, b] of segsOf(e)) {
      const L = Math.hypot(b.x - a.x, b.y - a.y)
      // a grid line runs across the plan (its extent overlaps the plan's, 3 m round)
      if (L < 3000 || !near({ x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) }, box, 3000)) continue
      let best: string | null = null, bd = 1500
      for (const t of labels) for (const p of [a, b]) { const d = Math.hypot(t.p.x - p.x, t.p.y - p.y); if (d < bd) { bd = d; best = t.value.trim() } }
      if (best && !out.some((g) => g.label === best)) out.push({ label: best, a: [a.x, a.y], b: [b.x, b.y] })
    }
  }
  return out
}

export const cross = (g: { a: P2; b: P2 }, h: { a: P2; b: P2 }): P2 | null => {
  const d1: P2 = [g.b[0] - g.a[0], g.b[1] - g.a[1]], d2: P2 = [h.b[0] - h.a[0], h.b[1] - h.a[1]]
  const det = d1[0] * d2[1] - d1[1] * d2[0]
  if (Math.abs(det) < 1e-6) return null
  const t = ((h.a[0] - g.a[0]) * d2[1] - (h.a[1] - g.a[1]) * d2[0]) / det
  return [g.a[0] + d1[0] * t, g.a[1] + d1[1] * t]
}

/** Pairs of parallel lines 100…500 mm apart overlapping along each other: centre line, width, extent. */
function pairs(segs: [Vec2, Vec2][]): { a: P2; b: P2; w: number }[] {
  type S = { ux: number; uy: number; c: number; s0: number; s1: number; used: boolean }
  const ls: S[] = []
  for (const [a, b] of segs) {
    const L = Math.hypot(b.x - a.x, b.y - a.y)
    if (L < 300) continue
    let ux = (b.x - a.x) / L, uy = (b.y - a.y) / L
    if (ux < -1e-9 || (Math.abs(ux) < 1e-9 && uy < 0)) { ux = -ux; uy = -uy }
    const p0 = a.x * ux + a.y * uy, p1 = b.x * ux + b.y * uy
    ls.push({ ux, uy, c: -a.x * uy + a.y * ux, s0: Math.min(p0, p1), s1: Math.max(p0, p1), used: false })
  }
  const out: { a: P2; b: P2; w: number }[] = []
  for (const l of ls) {
    if (l.used) continue
    let best: S | null = null, bd = Infinity
    for (const m of ls) {
      if (m === l || m.used || Math.abs(l.ux * m.ux + l.uy * m.uy) < 0.999) continue
      const d = Math.abs(m.c - l.c)
      if (d < 100 || d > 500) continue
      const ov = Math.min(l.s1, m.s1) - Math.max(l.s0, m.s0)
      if (ov < 0.8 * Math.min(l.s1 - l.s0, m.s1 - m.s0)) continue
      if (d < bd) { bd = d; best = m }
    }
    if (!best) continue
    l.used = best.used = true
    const c = (l.c + best.c) / 2, s0 = Math.max(l.s0, best.s0), s1 = Math.min(l.s1, best.s1)
    const nx = -l.uy, ny = l.ux
    out.push({ a: [l.ux * s0 + nx * c, l.uy * s0 + ny * c], b: [l.ux * s1 + nx * c, l.uy * s1 + ny * c], w: Math.round(bd) })
  }
  return out
}

const segDist = (p: Vec2, a: P2, b: P2) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / L2))
  return Math.hypot(p.x - (a[0] + dx * t), p.y - (a[1] + dy * t))
}

/** Is there any structural plan in the drawing (a quick test before reading it all). */
export const hasStructure = (doc: CadDocument) => doc.entities.some((e) => { const r = structRole(e.layer); return r === 'beam' || r === 'found' || r === 'tie' })

export function readStructure(doc: CadDocument, m: BimModel, alignGrid: [string, string] | null): StructResult {
  const warnings: string[] = []
  const role = new Map<string, StructRole>()
  const R = (layer: string) => { let r = role.get(layer); if (!r) { r = structRole(layer); role.set(layer, r) } return r }
  const texts = doc.entities.filter((e): e is Txt => e.kind === 'text')
  const allText = texts.map((t) => ({ t, n: norm(t.value) }))
  // 1. plans: structural entities grouped by place (within 3 m of each other)
  const geo = doc.entities.filter((e) => ['beam', 'tie', 'found', 'pile', 'slab', 'open'].includes(R(e.layer)))
  const groups: { box: Box; ents: Entity[] }[] = []
  for (const e of geo) {
    const b = boxOf(e)
    const hit = groups.filter((g) => near(g.box, b, 3000))
    if (!hit.length) { groups.push({ box: b, ents: [e] }); continue }
    const g0 = hit[0]
    g0.box = grow(g0.box, b)
    g0.ents.push(e)
    for (const g of hit.slice(1)) { g0.box = grow(g0.box, g.box); g0.ents.push(...g.ents); groups.splice(groups.indexOf(g), 1) }
  }
  const plans: StructPlan[] = []
  const lvByName = (name: string) => m.levels.find((l) => norm(l.name) === name)
  const sortedLv = [...m.levels].sort((a, b) => a.elevation - b.elevation)
  const out: StructResult = { plans, beams: [], footings: [], slabs: [], warnings }
  // the model point of the alignment grid intersection
  const mg = (lab: string) => m.grids.find((g) => g.label === lab)
  const modelO = alignGrid && mg(alignGrid[0]) && mg(alignGrid[1]) ? cross(mg(alignGrid[0])!, mg(alignGrid[1])!) : null
  if (!modelO) warnings.push('noGrid')
  // pile-cap levels written anywhere in the drawing
  const topCap = allText.find((x) => /DINH DAI/.test(x.n))
  const botCap = allText.find((x) => /DAY DAI/.test(x.n))
  const capH = allText.map((x) => /DAI MONG.*\bH (\d{3,4})\b/.exec(x.n)).find(Boolean)
  for (const g of groups) {
    // the title: a "MẶT BẰNG …" text under the group (or just over it), across its width
    const title = allText.filter(({ t, n }) => /MAT BANG/.test(n) && t.p.x >= g.box.x0 - 500 && t.p.x <= g.box.x1 + 500 && t.p.y < g.box.y0 + 200 && t.p.y > g.box.y0 - 8000).sort((a, b) => b.t.p.y - a.t.p.y)[0]
    if (!title) continue
    const isFound = /MONG/.test(title.n) || g.ents.some((e) => R(e.layer) === 'found')
    const isFloor = /(KET CAU|DAM|SAN)/.test(title.n) && g.ents.some((e) => R(e.layer) === 'beam')
    if (!isFound && !isFloor) continue
    const kind: StructPlan['kind'] = isFound ? 'foundation' : 'floor'
    const el = parseElevation(title.t.value)
    let level: string | null = null
    if (kind === 'foundation') level = sortedLv[0]?.id ?? null
    else {
      const tn = /TANG\s*(\d+)/.exec(title.n)
      const byName = tn ? m.levels.find((l) => new RegExp(`\\b${tn[1]}\\b`).test(norm(l.name)) && /TANG|LEVEL|FLOOR/.test(norm(l.name))) : undefined
      const roof = /\bMAI\b|ROOF/.test(title.n) ? sortedLv[sortedLv.length - 1] : undefined
      const byEl = el !== null ? sortedLv.find((l) => Math.abs(l.elevation - el) < 400) : undefined
      level = (byName ?? roof ?? byEl ?? lvByName(title.n))?.id ?? null
    }
    plans.push({ kind, title: title.t.value, box: g.box, level, elevation: el })
    if (!level) { warnings.push(`noLevel:${title.t.value}`); continue }
    // 2. placement on the model by the alignment grid
    const grids = gridsIn(doc.entities.filter((e) => R(e.layer) === 'grid'), texts.filter((t) => R(t.layer) === 'grid' || R(t.layer) === 'text'), g.box)
    const gv = alignGrid ? grids.find((x) => x.label === alignGrid[0]) : undefined, gh = alignGrid ? grids.find((x) => x.label === alignGrid[1]) : undefined
    const planO = gv && gh ? cross(gv, gh) : null
    if (!planO || !modelO) { warnings.push(`noPlace:${title.t.value}`); continue }
    const T = (p: P2): P2 => [r1(p[0] - planO[0] + modelO[0]), r1(p[1] - planO[1] + modelO[1])]
    const lvEl = m.levels.find((l) => l.id === level)!.elevation
    const tags = texts.filter((t) => inBox(t.p, g.box, 1500) && parseSize(t.value))
    const segsOfRole = (r: StructRole) => g.ents.filter((e) => R(e.layer) === r).flatMap(segsOf)
    const lineBeams = (r: StructRole, tie: boolean) => {
      const found = pairs(segsOfRole(r)).map((p) => {
        // the nearest size tag along the beam whose width matches
        let tag: { mark: string; b: number; h: number } | null = null, td = 900
        for (const t of tags) {
          const sz = parseSize(t.value)!
          const d = segDist(t.p, p.a, p.b)
          if (d < td && Math.abs(sz[0] - p.w) <= 30) { td = d; tag = { mark: t.value.replace(/\s*\d{3,4}\s*[xX×*]\s*\d{3,4}.*/, '').trim(), b: sz[0], h: sz[1] } }
        }
        return { p, tag }
      })
      // untagged beams: the h of the tagged ones of that width on the plan (most common)
      const hOf = (w: number) => { const hs = found.filter((x) => x.tag && Math.abs(x.tag.b - w) <= 30).map((x) => x.tag!.h); if (!hs.length) return null; const c = new Map<number, number>(); hs.forEach((h) => c.set(h, (c.get(h) ?? 0) + 1)); return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0] }
      let missing = 0
      for (const { p, tag } of found) {
        const h = tag?.h ?? hOf(p.w)
        if (!h) { missing++; continue }
        const a = T(p.a), b = T(p.b)
        const L = Math.hypot(b[0] - a[0], b[1] - a[1])
        const n = out.beams.length + 1
        out.beams.push({ id: `beam-${n}`, category: 'beam', mark: tag?.mark || (tie ? `GM${n}` : `B${n}`), level: level!, topOffset: 0, x: a[0], y: a[1], angle: Math.round((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI * 1000) / 1000, length: r1(L), b: tag?.b ?? p.w, h, ...(tie ? { tie: true } : {}), ...(tag ? {} : { assumedH: true }) })
      }
      if (missing) warnings.push(`beamNoSize:${missing}`)
      return found.length
    }
    if (kind === 'floor') {
      const top = el !== null ? el - lvEl : 0
      const first = out.beams.length
      lineBeams('beam', false)
      for (const bm of out.beams.slice(first)) bm.topOffset = r1(top)
      // slab: openings (closed outlines on opening layers), thickness "h=120"
      const openings = g.ents.filter((e): e is Extract<Entity, { kind: 'polyline' }> => R(e.layer) === 'open' && e.kind === 'polyline' && e.closed && e.pts.length >= 4).map((e) => e.pts.map((q) => T([q.x, q.y])))
      const th = texts.map((t) => (inBox(t.p, g.box, 500) ? /\bh\s*=\s*(\d{2,3})\b/i.exec(t.value) : null)).find(Boolean)
      out.slabs.push({ level, openings, thickness: th ? Number(th[1]) : null })
    } else {
      const capTop = topCap ? parseElevation(topCap.t.value) : null, capBot = botCap ? parseElevation(botCap.t.value) : null
      const H = capTop !== null && capBot !== null ? capTop - capBot : capH ? Number(capH[1]) : null
      const top = capTop ?? (capBot !== null && H ? capBot + H : null)
      if (top === null || H === null) warnings.push('capLevels')
      const piles = g.ents.filter((e): e is Extract<Entity, { kind: 'polyline' }> => R(e.layer) === 'pile' && e.kind === 'polyline' && e.closed)
      for (const e of g.ents) {
        if (R(e.layer) !== 'found' || e.kind !== 'polyline' || !e.closed || e.pts.length < 4) continue
        const b = boxOf(e)
        const w = b.x1 - b.x0, d = b.y1 - b.y0
        if (w < 300 || d < 300) continue
        const inside = piles.filter((p) => { const pb = boxOf(p); return pb.x0 >= b.x0 - 5 && pb.x1 <= b.x1 + 5 && pb.y0 >= b.y0 - 5 && pb.y1 <= b.y1 + 5 })
        const tag = allText.find(({ t, n }) => /^M[A-Z]*\d/.test(n) && inBox(t.p, b, 400))
        // the pile number the tag writes ("M3 (2 cọc)") against the piles drawn in the cap
        const said = tag ? /\b(\d+) COC\b/.exec(tag.n) : null
        if (said && Number(said[1]) !== inside.length) warnings.push(`piles:${tag!.t.value}:${inside.length}`)
        const [cx, cy] = T([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2])
        const pb = inside[0] ? boxOf(inside[0]) : null
        out.footings.push({ id: `footing-${out.footings.length + 1}`, category: 'footing', mark: tag ? tag.t.value.replace(/\s*\(.*$/, '').trim() : `M${out.footings.length + 1}`, level, x: cx, y: cy, w: r1(w), d: r1(d), top: top ?? -500, bottom: top !== null && H !== null ? top - H : (top ?? -500) - 600, piles: inside.length, ...(pb ? { pileSize: Math.round(Math.min(pb.x1 - pb.x0, pb.y1 - pb.y0)) } : {}) })
      }
      // tie beams: their top at the caps' top
      const first = out.beams.length
      lineBeams('tie', true)
      for (const bm of out.beams.slice(first)) bm.topOffset = top ?? -500
    }
  }
  const rb = readRebar(doc)
  if (rb) out.rebar = rb
  return out
}

/** The structure applied to the model: beams and footings added, slabs given their openings and thickness. */
export function applyStructure(m: BimModel, s: StructResult): BimModel {
  const slabs = m.slabs.map((sl) => {
    const x = s.slabs.find((q) => q.level === sl.level)
    // floor and roof slabs (not landings, not ceilings)
    if (!x || sl.kind === 'ceiling' || sl.landing) return sl
    // openings the architecture did not already cut (half of their area not covered by one)
    const area = (o: P2[]) => Math.abs(o.reduce((a, p, i) => a + p[0] * o[(i + 1) % o.length][1] - o[(i + 1) % o.length][0] * p[1], 0)) / 2
    const bb = (o: P2[]) => ({ x0: Math.min(...o.map((p) => p[0])), y0: Math.min(...o.map((p) => p[1])), x1: Math.max(...o.map((p) => p[0])), y1: Math.max(...o.map((p) => p[1])) })
    const ov = (a: P2[], b: P2[]) => { const A = bb(a), B = bb(b); return Math.max(0, Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0)) * Math.max(0, Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0)) }
    const add = x.openings.filter((o) => !(sl.openings ?? []).some((e) => ov(o, e) > 0.5 * Math.min(area(o), area(e))))
    return { ...sl, ...(x.thickness ? { thickness: x.thickness } : {}), ...(add.length ? { openings: [...(sl.openings ?? []), ...add] } : {}) }
  })
  return { ...m, slabs, beams: [...(m.beams ?? []), ...s.beams], footings: [...(m.footings ?? []), ...s.footings], ...(s.rebar ? { rebar: s.rebar } : {}) }
}

/* ---------------- reinforcement from the typical details ---------------- */

/** Accents off, upper case, symbols kept; the diameter sign (Φ, φ, Ø, ø, %%c) written "Φ". */
const up = (s: string) => s.replace(/%%[cC]|[φØø∅]/g, 'Φ').normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'D').toUpperCase()

/**
 * The typical details of a structural drawing ("CHI TIẾT ĐIỂN HÌNH"): a heading and the lines written under it —
 *  "CỘT C1 250×250" / "4Φ16 • ĐAI Φ6a100/200"; a beam section "220×350" / "dưới 4Φ12" / "trên 2Φ16 …" /
 *  "Φ8a200 (gối) / a200"; "ĐÀI MÓNG …" / "DƯỚI Φ16a150 • TRÊN Φ12a200"; "BẢN THANG …" / "Φ10a150 dưới • Φ8a200 trên".
 * Null when none is written.
 */
export function readRebar(doc: CadDocument): RebarSpec | null {
  const texts = doc.entities.filter((e): e is Txt => e.kind === 'text').map((t) => ({ t, u: up(t.value) }))
  const under = (h: Txt) => texts.filter(({ t }) => Math.abs(t.p.x - h.p.x) <= 150 && t.p.y < h.p.y && t.p.y > h.p.y - Math.max(400, h.height * 6)).map((x) => x.u).join(' • ')
  const spec: RebarSpec = { beams: [] }
  const stir = (s: string) => { const m = /Φ\s*(\d+)\s*A\s*(\d+)(?:\s*\(GOI\))?\s*\/\s*A?\s*(\d+)/.exec(s) ?? /Φ\s*(\d+)\s*A\s*(\d+)()/.exec(s); return m ? { d: +m[1], aEnd: +m[2], aMid: +(m[3] || m[2]) } : null }
  const bars = (s: string, word: string) => { const m = new RegExp(`${word}\\s*(\\d+)\\s*Φ\\s*(\\d+)`).exec(s); return m ? { n: +m[1], d: +m[2] } : null }
  const mesh = (s: string, before: string | null, after: string | null) => {
    const m = before ? new RegExp(`${before}\\s*Φ\\s*(\\d+)\\s*A\\s*(\\d+)`).exec(s) : new RegExp(`Φ\\s*(\\d+)\\s*A\\s*(\\d+)\\s*${after}`).exec(s)
    return m ? { d: +m[1], a: +m[2] } : null
  }
  for (const { t, u } of texts) {
    if (/^COT\s*[A-Z]*\d/.test(u) && !spec.column) {
      const b = under(t), main = /(\d+)\s*Φ\s*(\d+)/.exec(b), s = stir(b.replace(/^.*?DAI/, ''))
      if (main && s) spec.column = { main: { n: +main[1], d: +main[2] }, stirrups: s }
    } else if (/^\s*\d{3}\s*[×X*]\s*\d{3}\s*$/.test(u)) {
      const b = under(t), bot = bars(b, 'DUOI'), top = bars(b, 'TREN'), s = stir(b)
      const h = +(/[×X*]\s*(\d{3})/.exec(u)![1])
      if (bot && top && s && !spec.beams.some((x) => x.h === h)) spec.beams.push({ h, bottom: bot, top, stirrups: s })
    } else if (/DAI MONG/.test(u) && !spec.cap) {
      const b = under(t), bot = mesh(b, 'DUOI', null), top = mesh(b, 'TREN', null)
      if (bot && top) spec.cap = { bottom: bot, top }
    } else if (/BAN THANG/.test(u) && !spec.stair) {
      const b = under(t), bot = mesh(b, null, 'DUOI'), top = mesh(b, null, 'TREN')
      if (bot && top) spec.stair = { bottom: bot, top }
    }
  }
  spec.beams.sort((a, b) => a.h - b.h)
  return spec.column || spec.beams.length || spec.cap || spec.stair ? spec : null
}
