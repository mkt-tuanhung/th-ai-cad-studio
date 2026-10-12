/**
 * Canal / road route from 2D CAD drawings: the long profile (trắc dọc) table and the cross sections (trắc ngang)
 * by chainage (lý trình). Everything is read by code — the AI may only suggest which layers hold the ground and
 * the design lines; no number comes from a model.
 *
 *  - Long profile: the table anchored on its "tên cọc" row (stake names), with the rows the Vietnamese standard
 *    uses (khoảng cách cộng dồn / lý trình → station; cao trình đáy kênh hiện trạng / cao độ tự nhiên → existing
 *    ground; cao trình đáy kênh thiết kế / cao độ thiết kế → design invert; cao trình bờ trái / phải hiện trạng /
 *    thiết kế). Each route is named by the text under its "CẮT DỌC" title; several sheets of one route merge.
 *  - Cross sections: each stake title ("C12") with the elevation scale (thước cao độ) under it gives the vertical
 *    scale; the "Khoảng cách" row gives the horizontal one (else the same as the vertical); the design centre
 *    line ("tim kênh tk", else "tim khảo sát") is offset 0. Ground and design lines are taken from their layers.
 *  - Areas: the final surface is the design line where there is one, the ground elsewhere; cut = ground above it,
 *    fill = below it, integrated every 1 cm. The designer's own areas ("S đào đất = 4.37 m2", "S đất đắp…") are
 *    read for comparison. Volumes: average end areas between consecutive stations (the usual hand method).
 * Units: offsets and elevations in metres; stations in metres.
 */
import type { CadDocument, Entity, Vec2 } from '../cad/types'
import { boxOf, norm, segsOf, type Box } from '../bim/fromCad'

export type CivilRole = 'ground' | 'design' | 'ignore'
export const CIVIL_ROLES: CivilRole[] = ['ground', 'design', 'ignore']

/** Layer name → ground / design line role (null: none of the two). */
export function civilRuleRole(layer: string): CivilRole | null {
  const n = norm(layer)
  if (/HATCH|TEXT|\bCHU\b|KHUNG|KICH ?THUOC|\bDIM|THUOC|DONG\b|DUONG ?DONG|TRUC|TIM\b|CAO ?DO\b|KHOANG|TEN ?COC/.test(n)) return null
  if (/MAT ?DAT|TU ?NHIEN|GROUND|\bEG\b|\bTN\b|DIA ?HINH|MAT ?CAT ?TN/.test(n)) return 'ground'
  if (/THIET ?KE|\bTK\d*\b|DESIGN|\bFG\b/.test(n)) return 'design'
  return null
}

type Text = Extract<Entity, { kind: 'text' }>
const texts = (doc: CadDocument) => doc.entities.filter((e): e is Text => e.kind === 'text')
const numOf = (s: string): number | null => {
  const t = s.trim().replace(',', '.')
  return /^[+-]?\d+(\.\d+)?$/.test(t) || /^[+-]?\.\d+$/.test(t) ? Number(t) : null
}

/* ================================================================ long profile */

export interface Stake {
  name: string
  station: number
  /** Existing centre-line ground (canal bottom) and design invert (m). */
  ground?: number
  invert?: number
  leftEx?: number
  rightEx?: number
  leftDes?: number
  rightDes?: number
}

type RowKey = 'station' | 'dist' | 'ground' | 'invert' | 'leftEx' | 'rightEx' | 'leftDes' | 'rightDes' | 'names'
const ROW_RULES: [RowKey, RegExp][] = [
  ['names', /\bTEN ?COC\b|\bCOC\b$/],
  ['station', /CONG ?DON|LY ?TRINH/],
  ['dist', /KHOANG ?CACH|CU ?LY/],
  ['leftEx', /BO ?TRAI.*HIEN ?TRANG/],
  ['rightEx', /BO ?PHAI.*HIEN ?TRANG/],
  ['leftDes', /BO ?TRAI.*THIET ?KE/],
  ['rightDes', /BO ?PHAI.*THIET ?KE/],
  ['ground', /DAY.*HIEN ?TRANG|TU ?NHIEN|DIA ?HINH|MAT ?DAT/],
  ['invert', /DAY.*THIET ?KE|CAO ?(DO|TRINH) ?THIET ?KE|CAO ?DO ?DAY/],
]
const rowKey = (label: string): RowKey | null => {
  const n = norm(label)
  for (const [k, re] of ROW_RULES) if (re.test(n)) return k
  return null
}
const STAKE = /^(C|MC|K|COC|CỌC|TC|H|P)\s*\d+[A-Z']?$/i

export interface ProfileSheet {
  title: string | null
  box: Box
  stakes: Stake[]
}

/** Long-profile tables: anchored on "tên cọc"; row labels share its column. */
export function findProfiles(doc: CadDocument): ProfileSheet[] {
  const all = texts(doc)
  const out: ProfileSheet[] = []
  for (const a of all) {
    if (rowKey(a.value) !== 'names') continue
    // the label column: texts left-aligned with the anchor, above it, within 40 row heights
    const labels = all.filter((t) => Math.abs(t.p.x - a.p.x) < Math.max(3, a.height) && t.p.y >= a.p.y - 1 && t.p.y <= a.p.y + 40 * a.height && rowKey(t.value))
    const rows = new Map<RowKey, Text>()
    for (const l of labels.sort((p, q) => p.p.y - q.p.y)) { const k = rowKey(l.value)!; if (!rows.has(k)) rows.set(k, l) }
    if (!rows.has('station') && !rows.has('dist')) continue
    const ys = [...rows.values()].map((t) => t.p.y).sort((p, q) => p - q)
    const gaps = ys.slice(1).map((y, i) => y - ys[i]).filter((g) => g > 0.5).sort((p, q) => p - q)
    const rowH = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 5 * a.height
    // stake names: texts on the anchor row, right of the label column
    const names = all.filter((t) => Math.abs(t.p.y - a.p.y) < 0.5 * rowH && t.p.x > a.p.x + 5 * a.height && STAKE.test(t.value.trim())).sort((p, q) => p.p.x - q.p.x)
    if (names.length < 2) continue
    const pitch = Math.min(...names.slice(1).map((n, i) => n.p.x - names[i].p.x).filter((d) => d > 0))
    const xMin = names[0].p.x - 0.6 * pitch, xMax = names[names.length - 1].p.x + 0.6 * pitch
    const top = Math.max(...ys) + rowH
    const value = (k: RowKey) => {
      const l = rows.get(k)
      if (!l) return new Map<number, number>()
      const vals = all.filter((t) => t !== l && Math.abs(t.p.y - l.p.y) < 0.45 * rowH && t.p.x >= xMin && t.p.x <= xMax && numOf(t.value) !== null)
      const m = new Map<number, number>()
      for (const v of vals) {
        // the value of a stake column: the nearest stake name by x (within half a pitch)
        let bi = -1, bd = 0.5 * pitch
        names.forEach((n, i) => { const d = Math.abs(v.p.x - n.p.x); if (d < bd) { bd = d; bi = i } })
        if (bi >= 0 && !m.has(bi)) m.set(bi, numOf(v.value)!)
      }
      return m
    }
    const st = value('station'), gr = value('ground'), inv = value('invert'), le = value('leftEx'), re = value('rightEx'), ld = value('leftDes'), rd = value('rightDes')
    const stakes: Stake[] = []
    names.forEach((n, i) => {
      if (!st.has(i)) return
      stakes.push({ name: n.value.trim().toUpperCase(), station: st.get(i)!, ground: gr.get(i), invert: inv.get(i), leftEx: le.get(i), rightEx: re.get(i), leftDes: ld.get(i), rightDes: rd.get(i) })
    })
    if (stakes.length < 2) continue
    // title: the text above the table naming the route ("kênh đức phong 1, l=1.600m")
    const box: Box = { x0: a.p.x, y0: a.p.y - rowH, x1: xMax, y1: top }
    const above = all.filter((t) => t.p.y > top && t.p.y < top + 0.9 * (xMax - a.p.x) && t.p.x > a.p.x - 50 && t.p.x < xMax && /\b(KENH|TUYEN|DUONG|MUONG|SONG|ROUTE|CANAL|ROAD)\b/.test(norm(t.value)) && !/\b(CAT DOC|TRAC DOC|DUONG CAO DO|CAO DO|CAO TRINH|TIM)\b/.test(norm(t.value)))
    const title = above.sort((p, q) => p.p.y - q.p.y)[0]?.value.trim() ?? null
    out.push({ title, box, stakes })
  }
  return out
}

/* ================================================================ cross sections */

interface Ruler {
  x: number
  yTop: number
  yBot: number
  /** z = z0 + (y − y0) / a (a = drawing units per metre). */
  a: number
  y0: number
  z0: number
  step: number
  /** The labels (baseline y, value, text height) — matched to the scale's ticks when the table cannot be used. */
  labels: [number, number, number][]
}

/** Elevation scales: ≥ 3 aligned labels ("+4.00", "0.00", "-2.00") on one vertical, evenly spaced, linear. */
export function findRulers(doc: CadDocument): Ruler[] {
  const cand = texts(doc).filter((t) => /^[+-]?\d+[.,]\d{2}$/.test(t.value.trim()))
  cand.sort((p, q) => p.p.x - q.p.x)
  const out: Ruler[] = []
  const used = new Set<Text>()
  for (const t of cand) {
    if (used.has(t)) continue
    const col = cand.filter((u) => !used.has(u) && Math.abs(u.p.x - t.p.x) < Math.max(4, 1.2 * t.height)).sort((p, q) => p.p.y - q.p.y)
    // split the column into runs whose values rise evenly with y (two sections can share one column)
    let run: Text[] = []
    const flush = () => {
      if (run.length >= 3) {
        const ys = run.map((u) => u.p.y), zs = run.map((u) => numOf(u.value)!)
        const n = run.length, my = ys.reduce((a, b) => a + b, 0) / n, mz = zs.reduce((a, b) => a + b, 0) / n
        let sxy = 0, szz = 0
        for (let i = 0; i < n; i++) { sxy += (ys[i] - my) * (zs[i] - mz); szz += (zs[i] - mz) ** 2 }
        const a = sxy / szz // units per metre
        const res = Math.max(...ys.map((y, i) => Math.abs(y - (my + a * (zs[i] - mz)))))
        const step = (ys[n - 1] - ys[0]) / (n - 1)
        if (a > 0 && res < 0.25 * step) {
          run.forEach((u) => used.add(u))
          out.push({ x: Math.min(...run.map((u) => u.p.x)), yTop: ys[n - 1], yBot: ys[0], a, y0: my, z0: mz, step, labels: run.map((u) => [u.p.y, numOf(u.value)!, u.height]) })
        }
      }
      run = []
    }
    for (const u of col) {
      const last = run[run.length - 1]
      if (last) {
        const dz = numOf(u.value)! - numOf(last.value)!, dy = u.p.y - last.p.y
        const prev = run.length >= 2 ? [numOf(last.value)! - numOf(run[run.length - 2].value)!, last.p.y - run[run.length - 2].p.y] : null
        const even = prev ? Math.abs(dz - prev[0]) < 1e-6 && Math.abs(dy - prev[1]) < 0.3 * prev[1] : dz > 0 && dy > 0.5 && dy < 12 * u.height
        if (!even) flush()
      }
      run.push(u)
    }
    flush()
  }
  return out
}

export interface DrawnArea {
  cut?: number
  fillMachine?: number
  fillManual?: number
  fill?: number
}

export interface CrossSection {
  name: string
  /** Station from the long profile (null if the stake is not in it). */
  station: number | null
  /** Ground and design lines across the section: [offset, elevation] (m), offset + to the right. */
  ground: [number, number][]
  design: [number, number][]
  /** Computed areas (m²). */
  cut: number
  fill: number
  /** The designer's areas written next to the section. */
  drawn: DrawnArea | null
  /** Largest difference between the ground line and the "Cao độ mặt đất tự nhiên" row (m), null without a table;
   *  tableOff = ground points where the table and the drawn line disagree by more than 3 cm. */
  tableDev: number | null
  tableOff: number
  scale: { h: number; v: number }
  /** Where it is in the drawing (preview): title point and the frame. */
  at: Vec2
  box: Box
  axis: 'design' | 'survey' | 'middle'
  /** Drawing ↔ section: x = cx + offset·sx, y = y0 + (z − z0)·a; `vfit` = vertical scale from the elevation table. */
  map: { cx: number; sx: number; a: number; y0: number; z0: number; vfit: 'table' | 'profile' | 'scale' }
}

/** Connected polylines from segments (end points within tol). */
function chains(segs: [Vec2, Vec2][], tol: number): Vec2[][] {
  const left = segs.map((s) => [...s] as Vec2[])
  const out: Vec2[][] = []
  const near = (a: Vec2, b: Vec2) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol
  while (left.length) {
    const c = left.pop()!
    let grew = true
    while (grew) {
      grew = false
      for (let i = left.length - 1; i >= 0; i--) {
        const [p, q] = [left[i][0], left[i][1]]
        if (near(c[c.length - 1], p)) c.push(q)
        else if (near(c[c.length - 1], q)) c.push(p)
        else if (near(c[0], q)) c.unshift(p)
        else if (near(c[0], p)) c.unshift(q)
        else continue
        left.splice(i, 1)
        grew = true
      }
    }
    out.push(c)
  }
  return out
}

/** Value of a piecewise-linear line at x (max over overlapping pieces), null outside it. */
function zAt(segs: [number, number, number, number][], x: number): number | null {
  let best: number | null = null
  for (const [x0, z0, x1, z1] of segs) {
    const lo = Math.min(x0, x1), hi = Math.max(x0, x1)
    if (x < lo - 1e-9 || x > hi + 1e-9) continue
    const z = hi - lo < 1e-9 ? Math.max(z0, z1) : z0 + ((z1 - z0) * (x - x0)) / (x1 - x0)
    if (best === null || z > best) best = z
  }
  return best
}

/** Cut and fill areas (m²) between a ground line and the final surface (design where defined, else ground). */
export function cutFill(ground: [number, number][], design: [number, number][], dx = 0.01): { cut: number; fill: number } {
  const seg = (p: [number, number][]) => p.slice(1).map((q, i) => [p[i][0], p[i][1], q[0], q[1]] as [number, number, number, number])
  const gs = seg(ground), ds = seg(design)
  if (!gs.length || !ds.length) return { cut: 0, fill: 0 }
  const lo = Math.max(Math.min(...ground.map((p) => p[0])), Math.min(...design.map((p) => p[0])))
  const hi = Math.min(Math.max(...ground.map((p) => p[0])), Math.max(...design.map((p) => p[0])))
  let cut = 0, fill = 0
  for (let x = lo + dx / 2; x < hi; x += dx) {
    const g = zAt(gs, x), d = zAt(ds, x)
    if (g === null || d === null) continue
    if (g > d) cut += (g - d) * dx
    else fill += (d - g) * dx
  }
  return { cut, fill }
}

/** The designer's area box near a section: "S đào đất = 4.37 m2", "S đất đắp bằng máy = 5.05", "… tc = 0.95". */
function readAreas(all: Text[], title: Text): DrawnArea | null {
  // the box title is another text with the same stake name; take the label rows under it
  const boxes = all.filter((t) => t !== title && t.value.trim().toUpperCase() === title.value.trim().toUpperCase())
  let best: DrawnArea | null = null, bd = Infinity
  for (const b of boxes) {
    const rows = all.filter((t) => t.p.y < b.p.y && t.p.y > b.p.y - 12 * b.height && t.p.x >= b.p.x - 3 * b.height && t.p.x <= b.p.x + 25 * b.height)
    const area: DrawnArea = {}
    for (const r of rows) {
      const n = norm(r.value)
      const kind = /\bDAO\b/.test(n) ? 'cut' : /\bDAP\b/.test(n) ? (/\b(TC|THU ?CONG)\b/.test(n) ? 'fillManual' : /\bMAY\b/.test(n) ? 'fillMachine' : 'fill') : null
      if (!kind) continue
      // the number on that row, right of the label
      const v = all.filter((t) => Math.abs(t.p.y - r.p.y) < 0.6 * r.height && t.p.x > r.p.x && numOf(t.value) !== null).sort((p, q) => p.p.x - q.p.x)[0]
      if (v) area[kind] = numOf(v.value)!
    }
    if (!Object.keys(area).length) continue
    const d = Math.hypot(b.p.x - title.p.x, b.p.y - title.p.y)
    if (d < bd) { bd = d; best = area }
  }
  return best
}

/** Cross sections: every stake title with an elevation scale under it. */
export function findSections(doc: CadDocument, roles: Record<string, CivilRole>, rulers = findRulers(doc)): (Omit<CrossSection, 'station'> & { title: Text })[] {
  const all = texts(doc)
  const titles = all.filter((t) => STAKE.test(t.value.trim()))
  const lines = doc.entities.filter((e) => e.kind === 'line' || e.kind === 'polyline')
  const out: (Omit<CrossSection, 'station'> & { title: Text })[] = []
  const taken = new Set<Ruler>()
  // larger titles first (the box titles repeat the stake name in a smaller size)
  for (const tt of [...titles].sort((p, q) => q.height - p.height)) {
    const r = rulers.filter((u) => !taken.has(u) && u.yTop < tt.p.y && tt.p.y - u.yTop < 30 * tt.height && u.x < tt.p.x && tt.p.x - u.x < 120 * tt.height)
      .sort((p, q) => tt.p.y - p.yTop + 0.2 * (tt.p.x - p.x) - (tt.p.y - q.yTop + 0.2 * (tt.p.x - q.x)))[0]
    if (!r) continue
    taken.add(r)
    // the frame ends before the next section's scale to the right (sheets sit side by side)
    const nextX = Math.min(...rulers.filter((u) => u !== r && u.x > r.x + 4 * r.step && u.yBot < tt.p.y && u.yTop > r.yBot - 2 * r.step).map((u) => u.x), r.x + 160 * tt.height)
    const frame: Box = { x0: r.x - 2 * r.step, y0: r.yBot - 1.5 * r.step, x1: nextX - 2 * r.step, y1: tt.p.y }
    const inFrame = (e: Entity) => { const b = boxOf(e); return b.x0 >= frame.x0 && b.x1 <= frame.x1 && b.y0 >= frame.y0 && b.y1 <= frame.y1 }
    const pick = (role: CivilRole) => lines.filter((e) => roles[e.layer] === role && inFrame(e)).flatMap(segsOf)
    const gSegs = pick('ground'), dSegs = pick('design')
    if (!gSegs.length) continue
    // ground: the connected line that starts nearest the scale (the longest if several start there)
    const span = (c: Vec2[]) => Math.max(...c.map((v) => v.x)) - Math.min(...c.map((v) => v.x))
    const start = (c: Vec2[]) => Math.min(...c.map((v) => v.x)) - r.x
    const gch = chains(gSegs, 0.05 * r.step).filter((c) => span(c) > 2 * r.step).sort((p, q) => Math.round(start(p) / (2 * r.step)) - Math.round(start(q) / (2 * r.step)) || span(q) - span(p))[0]
    if (!gch) continue
    const gx0 = Math.min(...gch.map((v) => v.x)), gx1 = Math.max(...gch.map((v) => v.x))
    frame.x1 = Math.min(frame.x1, gx1 + r.step)
    // horizontal scale from the "Khoảng cách" row (else as vertical)
    // table rows of THIS section: the nearest label under its scale (another section may sit right below)
    const rowLabel = (re: RegExp) => all.filter((t) => re.test(norm(t.value)) && t.p.y < r.yBot && t.p.y > frame.y0 - 6 * r.step && t.p.x < r.x + 2 * r.step && t.p.x > r.x - 60 * tt.height).sort((p, q) => q.p.y - p.p.y)[0]
    const kc = rowLabel(/^KHOANG ?CACH$/)
    let sx = r.a
    if (kc) {
      const ds = all.filter((t) => Math.abs(t.p.y - kc.p.y) < 0.6 * kc.height && t.p.x > r.x && t.p.x < gx1 + r.step && numOf(t.value) !== null).sort((p, q) => p.p.x - q.p.x)
      const est: number[] = []
      for (let i = 1; i < ds.length; i++) {
        const d = (numOf(ds[i - 1].value)! + numOf(ds[i].value)!) / 2
        if (d >= 1) est.push((ds[i].p.x - ds[i - 1].p.x) / d)
      }
      est.sort((p, q) => p - q)
      if (est.length >= 3) sx = est[Math.floor(est.length / 2)]
    }
    // centre line: the vertical next to "tim kênh tk", else "tim khảo sát", else the middle of the ground line
    const mark = (re: RegExp) => all.find((t) => re.test(norm(t.value)) && t.p.x >= frame.x0 && t.p.x <= frame.x1 && t.p.y <= tt.p.y + tt.height && t.p.y >= r.yTop - r.step)
    const vertNear = (t: Text) => {
      let bx: number | null = null, bd = 3 * t.height
      for (const [p, q] of lines.filter(inFrame).flatMap(segsOf)) {
        if (Math.abs(p.x - q.x) > 0.01 * Math.abs(p.y - q.y) || Math.abs(p.y - q.y) < r.step) continue
        const d = t.p.x - p.x
        if (d >= -0.5 * t.height && d < bd) { bd = d; bx = p.x }
      }
      return bx
    }
    let axis: CrossSection['axis'] = 'middle', cx = (gx0 + gx1) / 2
    const tk = mark(/^TIM KENH( TK| THIET KE)?$/) ?? mark(/^TIM (TUYEN|DUONG)( TK)?$/)
    const ks = mark(/^TIM KHAO SAT$/)
    const vx = tk ? vertNear(tk) : null, vs = ks ? vertNear(ks) : null
    if (vx !== null) { cx = vx; axis = 'design' } else if (vs !== null) { cx = vs; axis = 'survey' }
    // vertical scale: fitted on the "Cao độ mặt đất tự nhiên" row (each value sits just right of its ground
    // vertex) — the scale labels are only a fallback (their text sits off the ticks by about half its height)
    const cd = rowLabel(/CAO ?DO ?(MAT ?DAT ?)?TU ?NHIEN|CAO ?DO ?MAT ?DAT/)
    const pairs: [number, number][] = []
    if (cd) {
      const vals = all.filter((t) => Math.abs(t.p.y - cd.p.y) < 0.6 * cd.height && t.p.x > r.x && t.p.x < gx1 + r.step && numOf(t.value) !== null)
      for (const v of vals) {
        const vert = gch.filter((g) => g.x <= v.p.x + 0.2 * v.height && v.p.x - g.x < 2 * v.height).sort((p, q) => q.x - p.x)[0]
        if (vert) pairs.push([vert.y, numOf(v.value)!])
      }
    }
    // fallback (no usable table): the scale labels, raised by half their height; refined on the long profile later
    let map: CrossSection['map'] = { cx, sx, a: r.a, y0: r.y0 + 0.5 * (r.labels[0]?.[2] ?? 0), z0: r.z0, vfit: 'scale' }
    let tableDev: number | null = null, tableOff = 0
    // least squares, dropping the worst pair while it is off by > 3 cm and ≥ 70 % of the pairs remain: a table
    // value that disagrees with the drawn line is reported, not followed
    const fit = (ps: [number, number][]) => {
      const n = ps.length, my = ps.reduce((s2, p) => s2 + p[0], 0) / n, mz = ps.reduce((s2, p) => s2 + p[1], 0) / n
      let syz = 0, szz = 0
      for (const [y, z] of ps) { syz += (y - my) * (z - mz); szz += (z - mz) ** 2 }
      return szz > 1e-9 ? { a: syz / szz, my, mz } : null
    }
    let use = [...pairs]
    let f = use.length >= 3 ? fit(use) : null
    while (f && use.length > Math.max(3, Math.ceil(0.7 * pairs.length))) {
      const ff = f
      const err = use.map(([y, z]) => Math.abs(z - (ff.mz + (y - ff.my) / ff.a)))
      const worst = err.indexOf(Math.max(...err))
      if (err[worst] <= 0.03) break
      use = use.filter((_, i) => i !== worst)
      f = fit(use)
    }
    if (f && f.a > 0 && Math.abs(f.a - r.a) < 0.2 * r.a) {
      const ff = f
      const errs = pairs.map(([y, z]) => Math.abs(z - (ff.mz + (y - ff.my) / ff.a)))
      const kept = use.map(([y, z]) => Math.abs(z - (ff.mz + (y - ff.my) / ff.a)))
      // only a table that agrees with the drawing on the kept points (± 3 cm) sets the scale
      if (Math.max(...kept) <= 0.03) {
        map = { cx, sx, a: f.a, y0: f.my, z0: f.mz, vfit: 'table' }
        tableDev = Math.max(...errs)
        tableOff = new Set(pairs.filter((_, i) => errs[i] > 0.03).map(([y]) => y)).size
      }
    }
    const Z = (y: number) => map.z0 + (y - map.y0) / map.a
    const O = (x: number) => (x - cx) / sx
    const poly = (pts: Vec2[]) => pts.map((v) => [Math.round(O(v.x) * 1000) / 1000, Math.round(Z(v.y) * 1000) / 1000] as [number, number])
    let ground = poly(gch)
    if (ground.length && ground[0][0] > ground[ground.length - 1][0]) ground = ground.reverse()
    // design: every design piece in the frame, as one envelope sorted by offset
    const dch = chains(dSegs, 0.05 * r.step).map(poly).map((c) => (c.length && c[0][0] > c[c.length - 1][0] ? c.reverse() : c))
    const design = mergeEnvelope(dch)
    const { cut, fill } = cutFill(ground, design)
    out.push({ title: tt, name: tt.value.trim().toUpperCase(), ground, design, cut, fill, drawn: readAreas(all, tt), tableDev, tableOff, scale: { h: sx, v: map.a }, at: tt.p, box: frame, axis, map })
  }
  return out
}

/** One design line from its pieces: sorted by offset, overlapping pieces kept as they are (zAt takes the top). */
function mergeEnvelope(chs: [number, number][][]): [number, number][] {
  const pts = chs.filter((c) => c.length >= 2)
  if (!pts.length) return []
  if (pts.length === 1) return pts[0]
  // sample the envelope at every vertex offset
  const seg = pts.flatMap((p) => p.slice(1).map((q, i) => [p[i][0], p[i][1], q[0], q[1]] as [number, number, number, number]))
  const xs = [...new Set(pts.flat().map((p) => p[0]))].sort((a, b) => a - b)
  const out: [number, number][] = []
  for (const x of xs) { const z = zAt(seg, x); if (z !== null) out.push([x, z]) }
  return out
}

/* ================================================================ routes */

export interface Route {
  /** As written under the long-profile title. */
  name: string
  stakes: Stake[]
  sections: CrossSection[]
  /** Sections whose stake is not in the long profile, and stakes without a section. */
  unmatched: string[]
  missing: string[]
}

const key = (s: string | null) => norm((s ?? '').replace(/[,;]?\s*L\s*=.*$/i, ''))

/**
 * A section whose elevation table could not be used: the vertical scale is taken equal to the horizontal one
 * (drawn sections are undistorted) when the scale labels agree within 5 %, and the lowest design point is put on
 * the stake's design invert from the long profile.
 */
function anchorOnProfile(s: CrossSection, st: Stake): CrossSection {
  if (s.map.vfit !== 'scale' || st.invert === undefined || s.design.length < 2) return s
  const m = s.map
  const a = Math.abs(m.a - m.sx) < 0.05 * m.sx ? m.sx : m.a
  // back to drawing y, then to the new scale; the offset puts the design bottom on the invert
  const y = (z: number) => m.y0 + (z - m.z0) * m.a
  const lowY = Math.min(...s.design.map(([, z]) => y(z)))
  const z0 = st.invert
  const Z = (z: number) => Math.round((z0 + (y(z) - lowY) / a) * 1000) / 1000
  const ground = s.ground.map(([o, z]) => [o, Z(z)] as [number, number])
  const design = s.design.map(([o, z]) => [o, Z(z)] as [number, number])
  return { ...s, ground, design, ...cutFill(ground, design), map: { ...m, a, y0: lowY, z0, vfit: 'profile' }, scale: { h: m.sx, v: a } }
}

/** Long profiles merged per route, cross sections attached to the route whose sheets are nearest. */
export function findRoutes(doc: CadDocument, roles: Record<string, CivilRole>): Route[] {
  const sheets = findProfiles(doc)
  const groups = new Map<string, ProfileSheet[]>()
  for (const s of sheets) { const k = key(s.title) || `route-${groups.size + 1}`; groups.set(k, [...(groups.get(k) ?? []), s]) }
  const routes = [...groups.values()].map((g) => {
    const byName = new Map<string, Stake>()
    for (const s of g) for (const st of s.stakes) if (!byName.has(st.name)) byName.set(st.name, st)
    const stakes = [...byName.values()].sort((a, b) => a.station - b.station)
    const cy = g.reduce((a, s) => a + (s.box.y0 + s.box.y1) / 2, 0) / g.length
    return { name: g[0].title ?? '', stakes, cy, sections: [] as CrossSection[], unmatched: [] as string[], missing: [] as string[] }
  })
  for (const s of findSections(doc, roles)) {
    // the route that has this stake, nearest by sheet row
    const cand = routes.filter((r) => r.stakes.some((k) => k.name === s.name))
    const r = (cand.length ? cand : routes).sort((a, b) => Math.abs(a.cy - s.at.y) - Math.abs(b.cy - s.at.y))[0]
    if (!r) continue
    const st = r.stakes.find((k) => k.name === s.name)
    if (!st) { r.unmatched.push(s.name); continue }
    if (r.sections.some((x) => x.name === s.name)) continue
    const { title: _t, ...rest } = s
    r.sections.push(anchorOnProfile({ ...rest, station: st.station }, st))
  }
  for (const r of routes) {
    r.sections.sort((a, b) => (a.station ?? 0) - (b.station ?? 0))
    r.missing = r.stakes.filter((k) => !r.sections.some((s) => s.name === k.name)).map((k) => k.name)
  }
  return routes.map(({ cy: _c, ...r }) => r)
}

/** Average-end-area volumes over the sections (m³), with the same sum over the designer's areas when given. */
export function volumes(sections: CrossSection[]) {
  const s = sections.filter((x) => x.station !== null).sort((a, b) => a.station! - b.station!)
  let cut = 0, fill = 0, dCut = 0, dFill = 0, dOk = true
  const dfill = (x: CrossSection) => x.drawn ? (x.drawn.fill ?? 0) + (x.drawn.fillMachine ?? 0) + (x.drawn.fillManual ?? 0) : null
  for (let i = 1; i < s.length; i++) {
    const L = s[i].station! - s[i - 1].station!
    cut += ((s[i - 1].cut + s[i].cut) / 2) * L
    fill += ((s[i - 1].fill + s[i].fill) / 2) * L
    const a = s[i - 1].drawn, b = s[i].drawn
    if (a?.cut !== undefined && b?.cut !== undefined) dCut += ((a.cut + b.cut) / 2) * L
    else dOk = false
    const fa = dfill(s[i - 1]), fb = dfill(s[i])
    if (fa !== null && fb !== null) dFill += ((fa + fb) / 2) * L
    else dOk = false
  }
  return { cut, fill, length: s.length ? s[s.length - 1].station! - s[0].station! : 0, drawn: dOk && s.length > 1 ? { cut: dCut, fill: dFill } : null }
}
