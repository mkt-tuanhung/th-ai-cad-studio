/**
 * Canal / road route from 2D CAD drawings: the long profile (trắc dọc) table and the cross sections (trắc ngang)
 * by chainage (lý trình). Everything is read by code — the AI may only suggest which layers hold the ground and
 * the design lines; no number comes from a model.
 *
 *  - Long profile: the table anchored on its "tên cọc" row (stake names), with the rows the Vietnamese standard
 *    uses (khoảng cách cộng dồn / lý trình → station; cao trình đáy kênh hiện trạng / cao độ tự nhiên → existing
 *    ground; cao trình đáy kênh thiết kế / cao độ thiết kế → design invert; cao trình bờ trái / phải hiện trạng /
 *    thiết kế). Each route is named by the text under its "CẮT DỌC" title; several sheets of one route merge.
 *    Stations are read as metres or "Km0+050" / "0+050.00" / "Km 1+250,5"; a table with only "khoảng cách lẻ"
 *    (distances between stakes) is accumulated into stations (flagged). Stake names: C12, "C 12", "Cọc 12", KM0,
 *    H1, P1, TĐ1 / TD1, TC1, NĐ1 / ND1, NC1… matched by stakeKey.
 *  - Cross sections: each stake title ("C12") with the elevation scale (thước cao độ) under it gives the vertical
 *    scale; the "Khoảng cách" row gives the horizontal one (else a row of offsets, else the vertical one — warned);
 *    the design centre line ("tim kênh tk", else "tim khảo sát") is offset 0. Ground and design lines are taken
 *    from their layers: a ground line drawn in pieces is joined (warned), the design pieces make one surface
 *    (designSurface: vertical walls kept, a lined canal measured to its outer face).
 *  - Areas: the final surface is the design line where there is one, the ground elsewhere; cut = ground above it,
 *    fill = below it, integrated every 1 cm; where the design reaches beyond the drawn ground nothing is computed
 *    (warned). The designer's own areas ("S đào đất = 4.37 m2", "S đất đắp bằng máy…", "… thủ công") are read for
 *    comparison, with their machine / hand split. Volumes: average end areas between consecutive stations.
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

/** A station as written in a table: "Km0+050", "KM0+050.00", "0+050", "Km 1+250,5" (comma decimal), or plain
 *  metres ("1250.5") → metres; null when it is not a station. */
export function stationOf(s: string): number | null {
  const t = s.trim().replace(/\s+/g, '')
  const m = /^(?:KM)?(\d+)\+(\d+(?:[.,]\d+)?)$/i.exec(t)
  if (m) return Number(m[1]) * 1000 + Number(m[2].replace(',', '.'))
  return numOf(t)
}

/** A stake name for matching: upper case without diacritics (Đ → D), no spaces, "Cọc 12" / "COC12" → "C12"
 *  ("C 12", "c12" and "Cọc 12" are the same stake). */
export function stakeKey(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'D').toUpperCase().replace(/\s+/g, '').replace(/^COC(?=\d)/, 'C')
}
/** As shown: upper case, no inner spaces, "Cọc 12" → "C12"; the Vietnamese Đ is kept ("TĐ1"). */
const stakeName = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '').replace(/^(COC|CỌC)(?=\d)/, 'C')

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
  /** The station is not written in the table: accumulated from the "khoảng cách lẻ" distances between stakes
   *  (from 0+000 at the first stake when no station is written at all). */
  stationFrom?: 'distances'
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
/** Stake names: C12, MC3, K5, KM0, H1–H9 (hectometre), P1 (apex), TĐ1 / TD1, TC1 (tangent points), NĐ1 / ND1,
 *  NC1 (curve ends), "Cọc 12", "C 12", with a letter / prime / "-1" suffix ("C12A", "C12'", "C12-1"). */
const STAKE_KEY = /^(C|MC|K|KM|H|P|TC|TD|ND|NC)\d+([A-Z]|'+|[.-]\d+)?$/
const isStake = (v: string) => STAKE_KEY.test(stakeKey(v))

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
    const names = all.filter((t) => Math.abs(t.p.y - a.p.y) < 0.5 * rowH && t.p.x > a.p.x + 5 * a.height && isStake(t.value)).sort((p, q) => p.p.x - q.p.x)
    if (names.length < 2) continue
    const pitch = Math.min(...names.slice(1).map((n, i) => n.p.x - names[i].p.x).filter((d) => d > 0))
    const xMin = names[0].p.x - 0.6 * pitch, xMax = names[names.length - 1].p.x + 0.6 * pitch
    const top = Math.max(...ys) + rowH
    // the value of each stake column: the text nearest its stake name by x (within half a pitch)
    const value = (k: RowKey, parse: (v: string) => number | null = numOf) => {
      const l = rows.get(k)
      if (!l) return new Map<number, number>()
      const vals = all.filter((t) => t !== l && Math.abs(t.p.y - l.p.y) < 0.45 * rowH && t.p.x >= xMin && t.p.x <= xMax && parse(t.value) !== null)
      const m = new Map<number, number>(), md = new Map<number, number>()
      for (const v of vals) {
        let bi = -1, bd = 0.5 * pitch
        names.forEach((n, i) => { const d = Math.abs(v.p.x - n.p.x); if (d < bd) { bd = d; bi = i } })
        if (bi >= 0 && !(bd >= (md.get(bi) ?? Infinity))) { m.set(bi, parse(v.value)!); md.set(bi, bd) }
      }
      return m
    }
    // "khoảng cách lẻ" (distance between two stakes): written between their columns, or at the column of the
    // second stake (the distance from the previous one) → interval i = stake i … i + 1
    const between = (() => {
      const l = rows.get('dist')
      const m = new Map<number, number>()
      if (!l) return m
      const vals = all.filter((t) => t !== l && Math.abs(t.p.y - l.p.y) < 0.45 * rowH && t.p.x >= xMin && t.p.x <= xMax && (numOf(t.value) ?? 0) > 0)
      const md = new Map<number, number>()
      for (const v of vals) {
        // the middle of the text (left-aligned texts start before it)
        const x = v.align === 'center' ? v.p.x : v.p.x + 0.3 * v.height * v.value.trim().length
        let iv = -1, bd = Infinity
        for (let i = 0; i + 1 < names.length; i++) {
          const t = (x - names[i].p.x) / Math.max(1e-9, names[i + 1].p.x - names[i].p.x)
          if (t > 0.2 && t < 0.8 && Math.abs(t - 0.5) < bd) { bd = Math.abs(t - 0.5); iv = i }
        }
        if (iv < 0) {
          let bi = -1, bn = 0.3 * pitch
          names.forEach((n, i) => { const d = Math.abs(v.p.x - n.p.x); if (d < bn) { bn = d; bi = i } })
          if (bi > 0) { iv = bi - 1; bd = 1 + bn }
        }
        if (iv >= 0 && !(bd >= (md.get(iv) ?? Infinity))) { m.set(iv, numOf(v.value)!); md.set(iv, bd) }
      }
      return m
    })()
    const st = value('station', stationOf), gr = value('ground'), inv = value('invert'), le = value('leftEx'), re = value('rightEx'), ld = value('leftDes'), rd = value('rightDes')
    // stations: "khoảng cách cộng dồn" / "lý trình" as written; where missing, accumulated from the distances
    // between stakes (forwards, then backwards); with no station at all the first stake is 0+000 (KMn: n km)
    const station: (number | undefined)[] = names.map((_, i) => st.get(i))
    const fromDist = new Set<number>()
    if (!st.size && between.size) {
      const km = /^KM(\d+)$/.exec(stakeKey(names[0].value))
      station[0] = km ? Number(km[1]) * 1000 : 0
      fromDist.add(0)
    }
    for (let i = 1; i < names.length; i++) if (station[i] === undefined && station[i - 1] !== undefined && between.has(i - 1)) { station[i] = station[i - 1]! + between.get(i - 1)!; fromDist.add(i) }
    for (let i = names.length - 2; i >= 0; i--) if (station[i] === undefined && station[i + 1] !== undefined && between.has(i)) { station[i] = station[i + 1]! - between.get(i)!; fromDist.add(i) }
    const stakes: Stake[] = []
    names.forEach((n, i) => {
      if (station[i] === undefined) return
      const r3 = Math.round(station[i]! * 1000) / 1000
      stakes.push({ name: stakeName(n.value), station: r3, ground: gr.get(i), invert: inv.get(i), leftEx: le.get(i), rightEx: re.get(i), leftDes: ld.get(i), rightDes: rd.get(i), ...(fromDist.has(i) ? { stationFrom: 'distances' as const } : {}) })
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

/** The designer's areas written next to a section (m²). `cut` / `fill` are the totals: as written, else the sum
 *  of the written parts; the split by machine / by hand is kept when the box gives it. */
export interface DrawnArea {
  cut?: number
  fill?: number
  cutMachine?: number
  cutManual?: number
  fillMachine?: number
  fillManual?: number
}

/** What could not be read or computed as drawn on one section (shown in the dialog, never hidden). */
export type SectionWarning =
  /** the ground line is drawn in `pieces` pieces: joined in offset order, `gap` m bridged straight in total */
  | { kind: 'groundJoined'; pieces: number; gap: number }
  /** the design line reaches `left` / `right` m beyond the drawn ground line: no area is computed there */
  | { kind: 'groundShort'; left: number; right: number }
  /** no design line in the frame: cut and fill cannot be computed (0 is not a result) */
  | { kind: 'noDesign' }
  /** the design pieces leave `gap` m uncovered in total, bridged straight */
  | { kind: 'designGap'; gap: number }
  /** horizontal scale from only `n` distance labels ('few'), or none found and taken equal to the vertical one ('assumed') */
  | { kind: 'hScale'; from: 'few' | 'assumed'; n: number }

export interface CrossSection {
  name: string
  /** Station from the long profile (null if the stake is not in it). */
  station: number | null
  /** Ground and design lines across the section: [offset, elevation] (m), offset + to the right. The design
   *  line is the excavation / formation face (see designSurface); a vertical wall is two points at one offset. */
  ground: [number, number][]
  design: [number, number][]
  /** A lined canal drawn with both faces: the inner (water) face, where the typical section is measured. */
  channel?: [number, number][]
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
  warnings: SectionWarning[]
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

/** The designer's area box near a section: "S đào đất = 4.37 m2", "S đất đắp bằng máy = 5.05", "… tc = 0.95".
 *  Rows of one kind add up ("đào đất cấp II" + "đào đất cấp III"); a written total and its machine / hand
 *  breakdown are not added: the total is used and the breakdown kept beside it. */
function readAreas(all: Text[], title: Text): DrawnArea | null {
  // the box title is another text with the same stake name; take the label rows under it
  const key = stakeKey(title.value)
  const boxes = all.filter((t) => t !== title && stakeKey(t.value) === key)
  let best: DrawnArea | null = null, bd = Infinity
  type K = keyof DrawnArea
  const r6 = (v: number) => Math.round(v * 1e6) / 1e6
  for (const b of boxes) {
    const rows = all.filter((t) => t.p.y < b.p.y && t.p.y > b.p.y - 12 * b.height && t.p.x >= b.p.x - 3 * b.height && t.p.x <= b.p.x + 25 * b.height)
    const sum: Partial<Record<K, number>> = {}
    const used = new Set<Text>()
    for (const r of rows.sort((p, q) => q.p.y - p.p.y || p.p.x - q.p.x)) {
      const n = norm(r.value)
      const what = /\bDAO\b/.test(n) ? 'cut' : /\bDAP\b/.test(n) ? 'fill' : null
      if (!what) continue
      const how = /\b(TC|THU ?CONG)\b/.test(n) ? 'Manual' : /\b(MAY|CO ?GIOI)\b/.test(n) ? 'Machine' : ''
      // the number on that row: in the label ("= 4.37 m2"), else the nearest text right of it (each number once)
      const inline = /=\s*([+-]?\d+(?:[.,]\d+)?)/.exec(r.value)
      let val: number | null = inline ? numOf(inline[1]) : null
      if (val === null) {
        const v = all.filter((t) => t !== r && !used.has(t) && Math.abs(t.p.y - r.p.y) < 0.6 * r.height && t.p.x > r.p.x && numOf(t.value) !== null).sort((p, q) => p.p.x - q.p.x)[0]
        if (v) { used.add(v); val = numOf(v.value) }
      }
      if (val === null) continue
      const k = (what + how) as K
      sum[k] = r6((sum[k] ?? 0) + val)
    }
    const area: DrawnArea = {}
    for (const w of ['cut', 'fill'] as const) {
      const tot = sum[w], m = sum[`${w}Machine`], h = sum[`${w}Manual`]
      if (m !== undefined) area[`${w}Machine`] = m
      if (h !== undefined) area[`${w}Manual`] = h
      if (tot !== undefined) area[w] = tot
      else if (m !== undefined || h !== undefined) area[w] = r6((m ?? 0) + (h ?? 0))
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
  const titles = all.filter((t) => isStake(t.value))
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
    const warnings: SectionWarning[] = []
    // ground: the connected line that starts nearest the scale (the longest if several start there); a ground line
    // drawn in several pieces is joined on to it in offset order (see joinPieces)
    const span = (c: Vec2[]) => Math.max(...c.map((v) => v.x)) - Math.min(...c.map((v) => v.x))
    const start = (c: Vec2[]) => Math.min(...c.map((v) => v.x)) - r.x
    const gAll = chains(gSegs, 0.05 * r.step).filter((c) => c.length >= 2).map((c) => (c[0].x > c[c.length - 1].x ? c.reverse() : c))
    const main = gAll.filter((c) => span(c) > 2 * r.step).sort((p, q) => Math.round(start(p) / (2 * r.step)) - Math.round(start(q) / (2 * r.step)) || span(q) - span(p))[0]
      ?? [...gAll].sort((p, q) => span(q) - span(p))[0]
    if (!main) continue
    const dxs = dSegs.flatMap(([p, q]) => [p.x, q.x])
    const joined = joinPieces(main, gAll, dxs.length ? [Math.min(...dxs), Math.max(...dxs)] : null, 3 * r.a, 2 * r.a, 0.1 * r.a, 0.1 * r.a)
    const gch = joined.line
    if (span(gch) <= 2 * r.step) continue
    const gx0 = Math.min(...gch.map((v) => v.x)), gx1 = Math.max(...gch.map((v) => v.x))
    frame.x1 = Math.min(frame.x1, gx1 + r.step)
    // table rows of THIS section: the nearest label under its scale (another section may sit right below)
    const rowLabel = (re: RegExp) => all.filter((t) => re.test(norm(t.value)) && t.p.y < r.yBot && t.p.y > frame.y0 - 6 * r.step && t.p.x < r.x + 2 * r.step && t.p.x > r.x - 60 * tt.height).sort((p, q) => q.p.y - p.p.y)[0]
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
    // horizontal scale: the "Khoảng cách" row (distances between the drop lines, ≥ 4 labels); else a row of
    // offsets ("khoảng cách cộng dồn" from the left end, or "cách tim" from the centre line); else 2–3 distance
    // labels that agree; else the vertical scale (drawn sections are usually undistorted) — the last two warned
    let sx = r.a
    const kc = rowLabel(/^KHOANG ?CACH( LE)?$/)
    const est: number[] = []
    if (kc) {
      const ds = all.filter((t) => Math.abs(t.p.y - kc.p.y) < 0.6 * kc.height && t.p.x > r.x && t.p.x < gx1 + r.step && numOf(t.value) !== null).sort((p, q) => p.p.x - q.p.x)
      for (let i = 1; i < ds.length; i++) {
        const d = (numOf(ds[i - 1].value)! + numOf(ds[i].value)!) / 2
        if (d >= 1) est.push((ds[i].p.x - ds[i - 1].p.x) / d)
      }
      est.sort((p, q) => p - q)
    }
    const fromOffsets = () => {
      const lb = rowLabel(/(KHOANG ?CACH|CU ?LY) ?(CONG ?DON|DEN ?TIM|TIM)|^CACH ?TIM/)
      if (!lb) return null
      const vs2 = all.filter((t) => t !== lb && Math.abs(t.p.y - lb.p.y) < 0.6 * lb.height && t.p.x > r.x && t.p.x < gx1 + r.step && numOf(t.value) !== null).sort((p, q) => p.p.x - q.p.x)
      if (vs2.length < 3) return null
      const xs = vs2.map((t) => t.p.x), ds = vs2.map((t) => numOf(t.value)!)
      // cumulative from the left end (rising with x), else distances either side of the centre line
      const rising = ds.every((d, i) => !i || d > ds[i - 1])
      const o = rising ? ds : ds.map((d, i) => (xs[i] < cx ? -Math.abs(d) : Math.abs(d)))
      const n = o.length, mo = o.reduce((a, b) => a + b, 0) / n, mx = xs.reduce((a, b) => a + b, 0) / n
      let sxo = 0, soo = 0
      for (let i = 0; i < n; i++) { sxo += (xs[i] - mx) * (o[i] - mo); soo += (o[i] - mo) ** 2 }
      if (soo < 1e-9) return null
      const k = sxo / soo
      const res = Math.max(...xs.map((x, i) => Math.abs(x - (mx + k * (o[i] - mo)))))
      return k > 0 && res < 0.02 * (Math.max(...xs) - Math.min(...xs)) + 0.5 * vs2[0].height ? k : null
    }
    if (est.length >= 3) sx = est[Math.floor(est.length / 2)]
    else {
      const k = fromOffsets()
      if (k !== null) sx = k
      else if (est.length && (est[est.length - 1] - est[0]) <= 0.03 * est[0]) { sx = est.reduce((a, b) => a + b, 0) / est.length; warnings.push({ kind: 'hScale', from: 'few', n: est.length + 1 }) }
      else warnings.push({ kind: 'hScale', from: 'assumed', n: 0 })
    }
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
    const ground = poly(gch)
    if (joined.pieces > 1) warnings.push({ kind: 'groundJoined', pieces: joined.pieces, gap: Math.round((joined.gap / sx) * 100) / 100 })
    // design: every design piece in the frame, as one surface (the excavation / formation face)
    const dch = chains(dSegs, 0.05 * r.step).map(poly).map((c) => (c.length && c[0][0] > c[c.length - 1][0] ? c.reverse() : c))
    const surf = designSurface(dch)
    const design = surf.line
    if (design.length < 2) warnings.push({ kind: 'noDesign' })
    // a stretch between design pieces is bridged straight: where both ends sit on the natural ground (± 10 cm) the
    // bridge is the ground itself (no area either way); elsewhere it is reported
    const gSeg = ground.slice(1).map((q, i) => [ground[i][0], ground[i][1], q[0], q[1]] as [number, number, number, number])
    const onGround = (o: number, z: number) => { const g = zAt(gSeg, o); return g !== null && Math.abs(g - z) <= 0.1 }
    const off = surf.gaps.filter(([o0, z0, o1, z1]) => !(onGround(o0, z0) && onGround(o1, z1))).reduce((a, [o0, , o1]) => a + o1 - o0, 0)
    if (off > 0.05) warnings.push({ kind: 'designGap', gap: Math.round(off * 100) / 100 })
    const short = groundShort(ground, design)
    if (short) warnings.push(short)
    const { cut, fill } = cutFill(ground, design)
    out.push({ title: tt, name: stakeName(tt.value), ground, design, ...(surf.channel ? { channel: surf.channel } : {}), cut, fill, drawn: readAreas(all, tt), tableDev, tableOff, scale: { h: sx, v: map.a }, at: tt.p, box: frame, axis, map, warnings })
  }
  return out
}

/** The design line reaching beyond the drawn ground (more than 5 cm): reported, never extrapolated. */
function groundShort(ground: [number, number][], design: [number, number][]): SectionWarning | null {
  if (ground.length < 2 || design.length < 2) return null
  const g0 = Math.min(...ground.map(([o]) => o)), g1 = Math.max(...ground.map(([o]) => o))
  const d0 = Math.min(...design.map(([o]) => o)), d1 = Math.max(...design.map(([o]) => o))
  const left = Math.max(0, g0 - d0), right = Math.max(0, d1 - g1)
  return left > 0.05 || right > 0.05 ? { kind: 'groundShort', left: Math.round(left * 100) / 100, right: Math.round(right * 100) / 100 } : null
}

/**
 * A line drawn in several pieces (drawing units, each piece left → right): while the line does not yet reach
 * `need` (the extent of the design line — beyond it the ground changes no area), the other pieces are added to
 * `main` on that side, in offset order, when the next one starts within `maxGap` of the line's end and `maxDy` of
 * its level (bridged straight), or overlaps its end at the same level (± `tolY`; only the part beyond is used).
 * Stubs shorter than `minSpan` (ticks, marks) are not ground.
 */
function joinPieces(main: Vec2[], pieces: Vec2[][], need: [number, number] | null, maxGap: number, maxDy: number, tolY: number, minSpan: number): { line: Vec2[]; pieces: number; gap: number } {
  let line = [...main], n = 1, gap = 0
  if (!need) return { line, pieces: n, gap }
  const left = new Set(pieces.filter((c) => c !== main && Math.max(...c.map((v) => v.x)) - Math.min(...c.map((v) => v.x)) >= minSpan))
  const zOn = (c: Vec2[], x: number) => {
    for (let i = 1; i < c.length; i++) {
      const a = c[i - 1], b = c[i]
      if (x >= Math.min(a.x, b.x) - 1e-9 && x <= Math.max(a.x, b.x) + 1e-9) return Math.abs(b.x - a.x) < 1e-9 ? Math.max(a.y, b.y) : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x)
    }
    return null
  }
  for (let grew = true; grew; ) {
    grew = false
    const end = line[line.length - 1], beg = line[0]
    // to the right: the piece whose start is nearest the end of the line
    const right = end.x >= need[1] - tolY ? undefined : [...left].filter((c) => c[c.length - 1].x > end.x + 1e-6).map((c) => {
      if (c[0].x > end.x) return { c, d: c[0].x - end.x, ok: c[0].x - end.x <= maxGap && Math.abs(c[0].y - end.y) <= maxDy }
      const z = zOn(c, end.x)
      return { c, d: 0, ok: z !== null && Math.abs(z - end.y) <= tolY }
    }).filter((x) => x.ok).sort((p, q) => p.d - q.d)[0]
    if (right) {
      left.delete(right.c)
      line = [...line, ...right.c.filter((v) => v.x > end.x + 1e-6)]
      gap += right.d; n++; grew = true
      continue
    }
    const lft = beg.x <= need[0] + tolY ? undefined : [...left].filter((c) => c[0].x < beg.x - 1e-6).map((c) => {
      const e = c[c.length - 1]
      if (e.x < beg.x) return { c, d: beg.x - e.x, ok: beg.x - e.x <= maxGap && Math.abs(e.y - beg.y) <= maxDy }
      const z = zOn(c, beg.x)
      return { c, d: 0, ok: z !== null && Math.abs(z - beg.y) <= tolY }
    }).filter((x) => x.ok).sort((p, q) => p.d - q.d)[0]
    if (lft) {
      left.delete(lft.c)
      line = [...lft.c.filter((v) => v.x < beg.x - 1e-6), ...line]
      gap += lft.d; n++; grew = true
    }
  }
  return { line, pieces: n, gap }
}

/**
 * The design surface of a section from its drawn pieces ([offset, elevation] m, each oriented left → right).
 *  - One piece drawn left to right is used as drawn (a vertical wall is two points at one offset).
 *  - Several pieces: an envelope of all of them with every vertical edge kept — wherever the envelope jumps, its
 *    left and right limits are both points of the line (a rectangular channel whose banks are drawn as separate
 *    lines keeps its bottom and its walls); a wall drawn at an end of the surface is kept too.
 *  - Which envelope:
 *     · a STRUCTURE drawn with both faces — a lined canal (two U-shaped faces over the channel bottom, the inner
 *       one higher) or a closed outline (lining, wall): the LOWER envelope, i.e. the outer face. It is the
 *       excavation face (the excavation makes room for the lining) and the bottom of the structure for fill
 *       (concrete is no earth fill), so the lining is neither cut nor fill — the usual earthwork measurement;
 *       `channel` = the inner (water) face, where the typical bottom width and side slope are measured.
 *     · otherwise (earth layers drawn as separate lines, e.g. the body filled by machine and the outer layer
 *       compacted by hand): the UPPER envelope, the finished earth surface — every earth layer is fill.
 *  - Offsets no piece covers are bridged straight; `gaps` lists them ([o0, z0, o1, z1]) so that the caller can
 *    report the ones that do not simply meet the natural ground.
 */
export function designSurface(pieces: [number, number][][]): { line: [number, number][]; gaps: [number, number, number, number][]; channel?: [number, number][] } {
  const ps = pieces.filter((c) => c.length >= 2)
  if (!ps.length) return { line: [], gaps: [] }
  const monotone = (c: [number, number][]) => c.every(([o], i) => !i || o >= c[i - 1][0] - 1e-9)
  if (ps.length === 1 && monotone(ps[0])) return { line: ps[0], gaps: [] }
  type S = [number, number, number, number]
  const segs: S[] = ps.flatMap((p) => p.slice(1).map((q, i) => (p[i][0] <= q[0] ? [p[i][0], p[i][1], q[0], q[1]] : [q[0], q[1], p[i][0], p[i][1]]) as S))
  const EPS = 1e-6
  const slanted = segs.filter(([a, , b]) => b - a > EPS), vertical = segs.filter(([a, , b]) => b - a <= EPS)
  const zOf = ([a, za, b, zb]: S, x: number) => za + ((zb - za) * (Math.min(b, Math.max(a, x)) - a)) / (b - a)
  // breakpoints: every vertex and every crossing of two pieces (both envelopes are linear between them)
  const xs0: number[] = segs.flatMap(([a, , b]) => [a, b])
  for (let i = 0; i < slanted.length; i++)
    for (let j = i + 1; j < slanted.length; j++) {
      const p = slanted[i], q = slanted[j]
      const lo = Math.max(p[0], q[0]), hi = Math.min(p[2], q[2])
      if (hi - lo <= EPS) continue
      const da = zOf(p, lo) - zOf(q, lo), db = zOf(p, hi) - zOf(q, hi)
      if (da * db < 0) xs0.push(lo + ((hi - lo) * da) / (da - db))
    }
  const xs = [...xs0].sort((a, b) => a - b).filter((x, i, a) => !i || x - a[i - 1] > EPS)
  const r3 = (v: number) => Math.round(v * 1000) / 1000
  const envelope = (up: boolean) => {
    const better = (v: number, z: number | null) => z === null || (up ? v > z : v < z)
    // the limit just left (−1) / right (+1) of x
    const lim = (x: number, side: -1 | 1) => {
      let z: number | null = null
      for (const sg of slanted) {
        const ok = side < 0 ? sg[0] < x - EPS && sg[2] >= x - EPS : sg[0] <= x + EPS && sg[2] > x + EPS
        if (ok) { const v = zOf(sg, x); if (better(v, z)) z = v }
      }
      return z
    }
    // a vertical edge drawn at an end of the surface (a wall rising from the bottom with no bank drawn beyond it)
    const wallFrom = (x: number, z: number) => {
      let lo = z, hi = z
      for (let grew = true; grew; ) {
        grew = false
        for (const [a, za, , zb] of vertical) {
          if (Math.abs(a - x) > 1e-3) continue
          const v0 = Math.min(za, zb), v1 = Math.max(za, zb)
          if (v0 <= hi + 1e-3 && v1 >= lo - 1e-3 && (v0 < lo - 1e-9 || v1 > hi + 1e-9)) { lo = Math.min(lo, v0); hi = Math.max(hi, v1); grew = true }
        }
      }
      return Math.abs(hi - z) >= Math.abs(lo - z) ? hi : lo
    }
    const out: [number, number][] = []
    const gaps: [number, number, number, number][] = []
    let lastEnd: number | null = null
    for (const x of xs) {
      const zl = lim(x, -1), zr = lim(x, 1)
      if (zl === null && zr === null) continue
      if (zl === null) {
        // a stretch begins: with the wall drawn up (or down) from its first point
        const w = wallFrom(x, zr!)
        const z0 = Math.abs(w - zr!) > 1e-6 ? w : zr!
        if (lastEnd !== null) gaps.push([r3(lastEnd), r3(out[out.length - 1][1]), r3(x), r3(z0)])
        if (z0 !== zr) out.push([x, z0])
      }
      if (zl !== null) out.push([x, zl])
      if (zr !== null && (zl === null || Math.abs(zr - zl) > 1e-6)) out.push([x, zr])
      if (zr === null) {
        // a stretch ends: with the wall drawn from its last point
        const w = wallFrom(x, zl!)
        if (Math.abs(w - zl!) > 1e-6) out.push([x, w])
        lastEnd = x
      }
    }
    const line = out.map(([o, z]) => [r3(o), r3(z)] as [number, number]).filter((p, i, a) => !i || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1])
    return { line, gaps }
  }
  const lower = envelope(false), upper = envelope(true)
  // a structure drawn with both faces over the channel bottom: two U-shaped faces, or one closed outline
  let channel: [number, number][] | undefined, closed = false
  if (lower.line.length >= 2) {
    // the channel bottom: the middle of the lowest stretch (not its corner, where an inner face may not reach)
    const zLow = Math.min(...lower.line.map(([, z]) => z))
    const bottom = lower.line.filter(([, z]) => z - zLow < 0.01).map(([o]) => o)
    const low: [number, number] = [(Math.min(...bottom) + Math.max(...bottom)) / 2, zLow]
    // [lowest, highest] of a piece over an offset
    const at = (c: [number, number][], x: number) => {
      let lo: number | null = null, hi: number | null = null
      for (let i = 1; i < c.length; i++) {
        const [a, za] = c[i - 1], [b, zb] = c[i]
        if (Math.abs(b - a) > EPS && x >= Math.min(a, b) && x <= Math.max(a, b)) {
          const v = za + ((zb - za) * (x - a)) / (b - a)
          if (lo === null || v < lo) lo = v
          if (hi === null || v > hi) hi = v
        }
      }
      return lo === null || hi === null ? null : [lo, hi]
    }
    closed = ps.some((c) => {
      if (c.length < 4 || Math.hypot(c[0][0] - c[c.length - 1][0], c[0][1] - c[c.length - 1][1]) > 1e-3) return false
      const z = at(c, low[0])
      return !!z && z[1] - z[0] > 0.01
    })
    // U-shaped: ≥ 4 vertices, drawn left to right, both ends at least 0.3 m above its point over the bottom
    const u = ps.filter((c) => c.length >= 4 && monotone(c)).map((c) => ({ c, z: at(c, low[0])?.[1] ?? null }))
      .filter((x): x is { c: [number, number][]; z: number } => x.z !== null && x.c[0][1] - x.z > 0.3 && x.c[x.c.length - 1][1] - x.z > 0.3)
    if (u.length >= 2) {
      const top = u.reduce((b, x) => (x.z > b.z ? x : b))
      if (top.z - low[1] > 0.01) channel = top.c
    }
  }
  return channel || closed ? { ...lower, ...(channel ? { channel } : {}) } : upper
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

/** A route has a design line: a design invert in its long profile (≥ 2 stakes) or a drawn design line in ≥ 2 of
 *  its sections. Without one there is no invert, no cut / fill — the route cannot be built (the user is asked to
 *  pick the layer that holds the design line). */
export const routeHasDesign = (r: Route) => r.stakes.filter((k) => k.invert !== undefined).length >= 2 || r.sections.filter((s) => s.station !== null && s.design.length >= 2).length >= 2

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
  const re = (l: [number, number][]) => l.map(([o, z]) => [o, Z(z)] as [number, number])
  const ground = re(s.ground), design = re(s.design)
  return { ...s, ground, design, ...(s.channel ? { channel: re(s.channel) } : {}), ...cutFill(ground, design), map: { ...m, a, y0: lowY, z0, vfit: 'profile' }, scale: { h: m.sx, v: a } }
}

/** Long profiles merged per route, cross sections attached to the route whose sheets are nearest. Stakes match
 *  by stakeKey ("C 12" = "C12" = "Cọc 12", "TĐ1" = "TD1"). */
export function findRoutes(doc: CadDocument, roles: Record<string, CivilRole>): Route[] {
  const sheets = findProfiles(doc)
  const groups = new Map<string, ProfileSheet[]>()
  for (const s of sheets) { const k = key(s.title) || `route-${groups.size + 1}`; groups.set(k, [...(groups.get(k) ?? []), s]) }
  const routes = [...groups.values()].map((g) => {
    const byName = new Map<string, Stake>()
    for (const s of g) for (const st of s.stakes) if (!byName.has(stakeKey(st.name))) byName.set(stakeKey(st.name), st)
    const stakes = [...byName.values()].sort((a, b) => a.station - b.station)
    const cy = g.reduce((a, s) => a + (s.box.y0 + s.box.y1) / 2, 0) / g.length
    return { name: g[0].title ?? '', stakes, cy, sections: [] as CrossSection[], unmatched: [] as string[], missing: [] as string[] }
  })
  for (const s of findSections(doc, roles)) {
    // the route that has this stake, nearest by sheet row
    const sk = stakeKey(s.name)
    const cand = routes.filter((r) => r.stakes.some((k) => stakeKey(k.name) === sk))
    const r = (cand.length ? cand : routes).sort((a, b) => Math.abs(a.cy - s.at.y) - Math.abs(b.cy - s.at.y))[0]
    if (!r) continue
    const st = r.stakes.find((k) => stakeKey(k.name) === sk)
    if (!st) { r.unmatched.push(s.name); continue }
    if (r.sections.some((x) => stakeKey(x.name) === sk)) continue
    const { title: _t, ...rest } = s
    // shown under the long profile's name of the stake
    r.sections.push(anchorOnProfile({ ...rest, name: st.name, station: st.station }, st))
  }
  for (const r of routes) {
    r.sections.sort((a, b) => (a.station ?? 0) - (b.station ?? 0))
    r.missing = r.stakes.filter((k) => !r.sections.some((s) => stakeKey(s.name) === stakeKey(k.name))).map((k) => k.name)
  }
  return routes.map(({ cy: _c, ...r }) => r)
}

/** The designer's split by machine / by hand, summed by average end areas (m³): a part is given only when every
 *  section with designer's areas writes it. */
export type DrawnSplit = { cutMachine?: number; cutManual?: number; fillMachine?: number; fillManual?: number }
const SPLIT = ['cutMachine', 'cutManual', 'fillMachine', 'fillManual'] as const

/** Average-end-area volumes over the sections (m³), with the same sum over the designer's areas when given (a box
 *  that writes the cut but no fill counts as no fill, as the designers write it). */
export function volumes(sections: CrossSection[]) {
  const s = sections.filter((x) => x.station !== null).sort((a, b) => a.station! - b.station!)
  let cut = 0, fill = 0, dCut = 0, dFill = 0, dOk = true
  const split: Record<(typeof SPLIT)[number], number | null> = { cutMachine: 0, cutManual: 0, fillMachine: 0, fillManual: 0 }
  for (let i = 1; i < s.length; i++) {
    const L = s[i].station! - s[i - 1].station!
    cut += ((s[i - 1].cut + s[i].cut) / 2) * L
    fill += ((s[i - 1].fill + s[i].fill) / 2) * L
    const a = s[i - 1].drawn, b = s[i].drawn
    if (a?.cut !== undefined && b?.cut !== undefined) dCut += ((a.cut + b.cut) / 2) * L
    else dOk = false
    if (a && b) dFill += (((a.fill ?? 0) + (b.fill ?? 0)) / 2) * L
    else dOk = false
    for (const k of SPLIT) {
      const pa = a?.[k], pb = b?.[k], v = split[k]
      split[k] = v !== null && pa !== undefined && pb !== undefined ? v + ((pa + pb) / 2) * L : null
    }
  }
  const drawnSplit: DrawnSplit = {}
  for (const k of SPLIT) { const v = split[k]; if (v !== null && s.length > 1) drawnSplit[k] = v }
  return { cut, fill, length: s.length ? s[s.length - 1].station! - s[0].station! : 0, drawn: dOk && s.length > 1 ? { cut: dCut, fill: dFill, ...drawnSplit } : null }
}
