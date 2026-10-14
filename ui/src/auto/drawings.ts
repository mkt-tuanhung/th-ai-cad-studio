/**
 * Drawings made from the models (no AI): floor plans of a BIM model, the long profile and the cross-section sheets
 * of a Civil route. Each is a CAD document (layers, A3 layout) that plots to PDF and writes DXF / DWG like any
 * drawing of CAD 2D. Units: millimetres (BIM), and for the route: drawing millimetres with the scales stated on
 * the sheet (horizontal and vertical, the vertical exaggerated as on hand-drawn long profiles).
 */
import type { CadDocument, Entity, Layer, Vec2 } from '../cad/types'
import { createBlankDocument } from '../cad/seed'
import { levelOf, typeOf, type BimModel } from '../bim/model'
import { wallEnds, wallsOn } from '../bim/geometry'
import { interiorPoint } from '../bim/fromCad'
import { stairFlight } from '../bim/scene'
import { roofFrame } from '../bim/roof'
import { sta, type CivilModel, type DrawnSection } from '../civil/model'

let seq = 0
const base = (layer: string) => ({ id: `auto-${Date.now().toString(36)}-${++seq}`, layer, color: 'ByLayer', linetype: 'ByLayer' as const, lineweight: 'ByLayer' as const, transparency: 0 })
const L = (layer: string, a: Vec2, b: Vec2): Entity => ({ ...base(layer), kind: 'line', a, b })
const P = (layer: string, pts: Vec2[], closed: boolean, filled = false): Entity => ({ ...base(layer), kind: 'polyline', pts, closed, ...(filled ? { filled: true } : {}) })
const T = (layer: string, p: Vec2, h: number, value: string, align: 'left' | 'center' = 'left', rotation = 0): Entity => ({ ...base(layer), kind: 'text', p, height: h, value, rotation, align })
const C = (layer: string, c: Vec2, r: number): Entity => ({ ...base(layer), kind: 'circle', c, r })
const A = (layer: string, c: Vec2, r: number, start: number, end: number): Entity => ({ ...base(layer), kind: 'arc', c, r, start, end })
const D = (layer: string, a: Vec2, b: Vec2, offset: number, h: number): Entity => ({ ...base(layer), kind: 'dimension', a, b, offset, override: null, textHeight: h })
const lay = (name: string, color: string, lineweight: number, linetype: Layer['linetype'] = 'Continuous'): Layer => ({ name, color, visible: true, locked: false, linetype, lineweight })

function doc(name: string, layers: Layer[], entities: Entity[]): CadDocument {
  const d = createBlankDocument(name)
  return { ...d, layers: [d.layers[0], ...layers], entities, source: 'bim-drawing', layouts: [{ id: 'layout1', name: 'A3', paper: 'A3', scale: null }] }
}

const PLAN_LAYERS = [
  lay('A-WALL', '#111827', 0.5), lay('A-DOOR', '#0f766e', 0.25), lay('A-GLAZ', '#2563eb', 0.25), lay('A-COLS', '#111827', 0.35),
  lay('A-AREA', '#1f2937', 0.18), lay('A-GRID', '#9aa1ab', 0.13, 'DashDot'), lay('A-ANNO-DIMS', '#3f4654', 0.13), lay('A-ANNO-TEXT', '#1f2937', 0.25), lay('A-FURN', '#9aa1ab', 0.13),
  lay('A-SECT', '#111827', 0.5), lay('A-STRS', '#1f2937', 0.18),
]

/** A section's cutting plane on the plan: a plane of constant `axis` at `at` mm, looked at towards +axis. */
export interface PlanCut { axis: 'x' | 'y'; at: number; look?: 1 | -1; label: string }

/** Floor plan of one level at the plan cut: walls (poche) broken at their openings, doors with swings, windows,
 *  columns, room names and areas, grids, overall dimensions, the section cuts and the title. */
export function planDocument(m: BimModel, levelId: string, title: string, cuts: PlanCut[] = []): CadDocument {
  const out: Entity[] = []
  const v = (p: [number, number]): Vec2 => ({ x: p[0], y: p[1] })
  const walls = wallsOn(m, levelId)
  const doorIds = new Set(m.doors.map((d) => d.id))
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const grow = (p: Vec2) => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y) }
  for (const w of walls) {
    const { a, dir } = wallEnds(w)
    const t = typeOf(m, w)?.thickness ?? 200
    const n = { x: -dir[1], y: dir[0] }
    const at = (s: number, o: number): Vec2 => ({ x: a[0] + dir[0] * s + n.x * o, y: a[1] + dir[1] * s + n.y * o })
    const ops = [...m.doors, ...m.windows].filter((o) => o.hostWall === w.id).sort((p, q) => p.offset - q.offset)
    // solid stretches between the openings
    let s0 = 0
    for (const o of [...ops, { offset: w.length, width: 0 }]) {
      const s1 = Math.max(s0, o.offset)
      if (s1 - s0 > 1) { const q = [at(s0, -t / 2), at(s1, -t / 2), at(s1, t / 2), at(s0, t / 2)]; out.push(P('A-WALL', q, true, true)); q.forEach(grow) }
      s0 = Math.max(s0, o.offset + o.width)
    }
    for (const o of ops) {
      if (doorIds.has(o.id)) {
        // leaves open at 90° on the +n side; wider than 1.2 m: two leaves from both jambs
        const ang = Math.atan2(dir[1], dir[0])
        if (o.width > 1200) {
          const half = o.width / 2
          const h1 = at(o.offset, t / 2), h2 = at(o.offset + o.width, t / 2)
          out.push(L('A-DOOR', h1, at(o.offset, t / 2 + half)), A('A-DOOR', h1, half, ang, ang + Math.PI / 2))
          out.push(L('A-DOOR', h2, at(o.offset + o.width, t / 2 + half)), A('A-DOOR', h2, half, ang + Math.PI / 2, ang + Math.PI))
        } else {
          const hinge = at(o.offset, t / 2)
          out.push(L('A-DOOR', hinge, at(o.offset, t / 2 + o.width)), A('A-DOOR', hinge, o.width, ang, ang + Math.PI / 2))
        }
      } else {
        for (const off of [-t / 2, 0, t / 2]) out.push(L('A-GLAZ', at(o.offset, off), at(o.offset + o.width, off)))
        out.push(L('A-GLAZ', at(o.offset, -t / 2), at(o.offset, t / 2)), L('A-GLAZ', at(o.offset + o.width, -t / 2), at(o.offset + o.width, t / 2)))
      }
    }
  }
  for (const c of m.columns.filter((c) => c.level === levelId)) {
    if (c.round) out.push(C('A-COLS', { x: c.x, y: c.y }, c.w / 2))
    else out.push(P('A-COLS', [{ x: c.x - c.w / 2, y: c.y - c.d / 2 }, { x: c.x + c.w / 2, y: c.y - c.d / 2 }, { x: c.x + c.w / 2, y: c.y + c.d / 2 }, { x: c.x - c.w / 2, y: c.y + c.d / 2 }], true, true))
  }
  for (const r of m.rooms.filter((r) => r.level === levelId && r.outline && r.outline.length >= 3)) {
    const ip = interiorPoint(r.outline!)
    // text shrunk to the room's width so names in small rooms (WC, store) do not run into the next room
    const xs = r.outline!.map((p) => p[0]), width = Math.max(...xs) - Math.min(...xs)
    const fit = (s: string, h: number) => Math.max(90, Math.min(h, (0.85 * width) / (0.6 * Math.max(1, s.length))))
    const area = `S = ${r.area.toFixed(2)} m²`
    out.push(T('A-AREA', { x: ip[0], y: ip[1] + 120 }, fit(r.name, 220), r.name, 'center'), T('A-AREA', { x: ip[0], y: ip[1] - 260 }, fit(area, 180), area, 'center'))
  }
  for (const f of m.components.filter((c) => c.level === levelId)) {
    const a = (f.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
    const pt = (u: number, w2: number): Vec2 => ({ x: f.x + u * c - w2 * s, y: f.y + u * s + w2 * c })
    out.push(P('A-FURN', [pt(-f.w / 2, -f.d / 2), pt(f.w / 2, -f.d / 2), pt(f.w / 2, f.d / 2), pt(-f.w / 2, f.d / 2)], true))
  }
  // stairs: the flights starting on this level (the top plan shows the ones arriving), treads, the up arrow,
  // landings
  let flights = m.stairs.filter((st) => st.baseLevel === levelId)
  if (!flights.length) flights = m.stairs.filter((st) => st.topLevel === levelId)
  for (const st of flights) {
    const { n } = stairFlight(m, st)
    if (st.spiral) {
      const s = st.spiral, a0 = (s.a0 * Math.PI) / 180, da = (s.sweep * Math.PI) / 180 / n
      out.push(C('A-STRS', { x: st.x, y: st.y }, s.r0), C('A-STRS', { x: st.x, y: st.y }, s.r1))
      for (let i = 0; i <= n; i++) { const a = a0 + i * da; out.push(L('A-STRS', { x: st.x + Math.cos(a) * s.r0, y: st.y + Math.sin(a) * s.r0 }, { x: st.x + Math.cos(a) * s.r1, y: st.y + Math.sin(a) * s.r1 })) }
      continue
    }
    const t = (st.angle * Math.PI) / 180, u: Vec2 = { x: Math.cos(t), y: Math.sin(t) }, nn: Vec2 = { x: -u.y, y: u.x }
    const pt = (along: number, across: number): Vec2 => ({ x: st.x + u.x * along + nn.x * across, y: st.y + u.y * along + nn.y * across })
    const h = st.width / 2
    out.push(P('A-STRS', [pt(0, -h), pt(st.length, -h), pt(st.length, h), pt(0, h)], true))
    for (let i = 1; i < n; i++) out.push(L('A-STRS', pt((i * st.length) / n, -h), pt((i * st.length) / n, h)))
    out.push(L('A-STRS', pt(150, 0), pt(st.length - 150, 0)), P('A-STRS', [pt(st.length - 330, -90), pt(st.length - 150, 0), pt(st.length - 330, 90)], false), C('A-STRS', pt(150, 0), 50))
  }
  const lvIds = new Set(flights.map((st) => st.baseLevel))
  for (const sl of m.slabs) if (sl.landing && lvIds.has(sl.level)) out.push(P('A-STRS', sl.outline.map(v), true))
  // railings: the stair rails with their flights, the guard rails of this floor
  for (const r of m.railings) if ((lvIds.has(r.level) || r.level === levelId) && r.pts.length >= 2) out.push(P('A-STRS', r.pts.map(v), false))
  if (!Number.isFinite(x0)) { x0 = 0; y0 = 0; x1 = 10000; y1 = 10000 }
  for (const g of m.grids) {
    const a = v(g.a), b = v(g.b)
    out.push(L('A-GRID', a, b))
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const end = { x: b.x + ((b.x - a.x) / d) * 450, y: b.y + ((b.y - a.y) / d) * 450 }
    out.push(C('A-GRID', end, 400), T('A-GRID', { x: end.x, y: end.y - 120 }, 300, g.label, 'center'))
  }
  out.push(D('A-ANNO-DIMS', { x: x0, y: y0 }, { x: x1, y: y0 }, -1400, 250), D('A-ANNO-DIMS', { x: x0, y: y0 }, { x: x0, y: y1 }, 1400, 250))
  // section cuts, as drawn by hand: a thick stroke outside the building at both ends, an arrow towards the side
  // that is seen and the section number
  for (const c of cuts) {
    const lo = c.axis === 'y' ? x0 : y0, hi = c.axis === 'y' ? x1 : y1
    const pt = (along: number, across: number): Vec2 => (c.axis === 'y' ? { x: along, y: c.at + across } : { x: c.at + across, y: along })
    // the low side (left / bottom) is past the overall dimensions; the high side before the grid bubbles
    const k = c.look ?? 1
    for (const [e0, e1] of [[lo - 4200, lo - 2600], [hi + 1000, hi + 2600]]) {
      out.push(L('A-SECT', pt(e0, 0), pt(e1, 0)))
      const mid = (e0 + e1) / 2
      out.push(L('A-SECT', pt(mid, 0), pt(mid, 700 * k)), P('A-SECT', [pt(mid - 180, 650 * k), pt(mid + 180, 650 * k), pt(mid, 1000 * k)], true, true))
      out.push(T('A-ANNO-TEXT', pt(mid, -600 * k - (k < 0 ? 400 : 0)), 400, c.label, 'center'))
    }
  }
  const lv = levelOf(m, levelId)
  const el = lv ? (lv.elevation === 0 ? '±0.000' : `${lv.elevation > 0 ? '+' : '−'}${(Math.abs(lv.elevation) / 1000).toFixed(3)}`) : ''
  out.push(T('A-ANNO-TEXT', { x: (x0 + x1) / 2, y: y0 - (cuts.length ? 5600 : 3200) }, 450, `${title.toUpperCase()}  ${el}`, 'center'))
  return doc(title, PLAN_LAYERS, out)
}

/* ---------------- route ---------------- */

const ROUTE_LAYERS = [lay('C-GRND', '#6b7280', 0.25, 'Dashed'), lay('C-DSGN', '#b91c1c', 0.5), lay('C-BANK', '#b45309', 0.25, 'Dashed'), lay('C-TABL', '#1f2937', 0.13), lay('C-TEXT', '#1f2937', 0.25), lay('C-AREA', '#0f766e', 0.18)]

const zAt = (p: [number, number][], s: number) => {
  if (!p.length) return null
  if (s <= p[0][0]) return p[0][1]
  for (let i = 1; i < p.length; i++) if (s <= p[i][0]) { const [a, za] = p[i - 1], [b, zb] = p[i]; return b - a < 1e-9 ? zb : za + ((zb - za) * (s - a)) / (b - a) }
  return p[p.length - 1][1]
}

/** Words on the route sheets (the UI language). */
export interface RouteWords {
  stake: string; station: string; ground: string; invert: string; cutArea: string; fillArea: string
  ve: string // "{n}" = the vertical exaggeration
  lGround: string; lInvert: string; lBank: string
  areas: string // "{cut}", "{fill}"
  drawn: string // the designer's areas: "{cut}", "{fill}"
}
export const ROUTE_WORDS_VI: RouteWords = {
  stake: 'Tên cọc', station: 'Lý trình', ground: 'Cao độ hiện trạng (m)', invert: 'Cao độ đáy thiết kế (m)', cutArea: 'Diện tích đào (m²)', fillArea: 'Diện tích đắp (m²)',
  ve: 'tỷ lệ đứng ×{n}', lGround: 'Mặt đất tự nhiên', lInvert: 'Đáy thiết kế', lBank: 'Đỉnh bờ thiết kế',
  areas: 'S đào = {cut} m²   S đắp = {fill} m²', drawn: '(hồ sơ: đào {cut} · đắp {fill} m²)',
}
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''))

/** Long profile: existing ground, design invert, design banks, and a table per stake (name, station, existing,
 *  invert, cut and fill areas). Horizontal 1 m = 1 drawing mm × hs; vertical exaggerated ve times. */
export function profileDocument(m: CivilModel, title: string, w: RouteWords = ROUTE_WORDS_VI): CadDocument {
  const out: Entity[] = []
  const s0 = m.alignment.start, s1 = m.alignment.end
  const zs = [...(m.ground ?? []), ...m.invert, ...(m.banks?.left ?? []), ...(m.banks?.right ?? [])].map(([, z]) => z)
  const zMin = Math.floor(Math.min(...zs) - 1), zMax = Math.ceil(Math.max(...zs) + 1)
  // sheet proportion: the profile about 4 × as long as it is high
  const hs = 1000, len = (s1 - s0) * hs
  const ve = Math.max(1, Math.round(len / 4 / ((zMax - zMin) * 1000)))
  const X = (s: number) => (s - s0) * hs, Y = (z: number) => (z - zMin) * 1000 * ve
  // each line named at its right end (a bank drawn once when both banks are level with each other)
  const named = new Set<string>()
  const line = (layer: string, p: [number, number][], label: string) => {
    if (p.length < 2) return
    out.push(P(layer, p.map(([s, z]) => ({ x: X(s), y: Y(z) })), false))
    const [s, z] = p[p.length - 1]
    const key = `${label}@${z.toFixed(2)}`
    if (!named.has(key)) { named.add(key); out.push(T('C-TEXT', { x: X(s) + len * 0.004, y: Y(z) - len * 0.002 }, len * 0.005, label, 'left')) }
  }
  line('C-GRND', m.ground ?? [], w.lGround)
  line('C-DSGN', m.invert, w.lInvert)
  line('C-BANK', m.banks?.left ?? [], w.lBank)
  line('C-BANK', m.banks?.right ?? [], w.lBank)
  // elevation scale (labels left of the ticks: text is left-aligned only)
  for (let z = zMin; z <= zMax; z++) { out.push(L('C-TABL', { x: -len * 0.01, y: Y(z) }, { x: 0, y: Y(z) }), T('C-TEXT', { x: -len * 0.032, y: Y(z) - len * 0.002 }, len * 0.006, z.toFixed(2), 'left')) }
  out.push(L('C-TABL', { x: 0, y: Y(zMin) }, { x: 0, y: Y(zMax) }))
  // table
  const rowH = len * 0.018, th = len * 0.0055
  const rows: [string, (x: DrawnSection | { station: number; name: string }) => string][] = [
    [w.stake, (x) => x.name],
    [w.station, (x) => sta(x.station)],
    [w.ground, (x) => { const z = zAt(m.ground ?? [], x.station); return z === null ? '' : z.toFixed(2) }],
    [w.invert, (x) => { const z = zAt(m.invert, x.station); return z === null ? '' : z.toFixed(2) }],
    [w.cutArea, (x) => ('cut' in x ? x.cut.toFixed(2) : '')],
    [w.fillArea, (x) => ('fill' in x ? x.fill.toFixed(2) : '')],
  ]
  const stakes = m.sections?.length ? m.sections : m.invert.map(([s]) => ({ station: s, name: sta(s) }))
  rows.forEach(([label, f], i) => {
    const y = Y(zMin) - (i + 1) * rowH
    out.push(L('C-TABL', { x: -len * 0.12, y }, { x: len, y }), T('C-TEXT', { x: -len * 0.118, y: y + rowH * 0.3 }, th, label))
    for (const x of stakes) out.push(T('C-TEXT', { x: X(x.station), y: y + rowH * 0.3 }, th * 0.85, f(x), 'center'))
  })
  for (const x of stakes) out.push(L('C-TABL', { x: X(x.station), y: Y(zMin) - rows.length * rowH }, { x: X(x.station), y: Y(zMin) }))
  out.push(T('C-TEXT', { x: len / 2, y: Y(zMax) + rowH }, len * 0.012, `${title.toUpperCase()} — ${fill(w.ve, { n: ve }).toUpperCase()}`, 'center'))
  return doc(title, ROUTE_LAYERS, out)
}

/** Cross sections, six to an A3 sheet (2 columns × 3 rows), true scale both ways: ground, design, name, station,
 *  areas (and the drawing's own areas when it wrote them). Cells sized on the widest section of the sheet. */
export function sectionDocuments(m: CivilModel, title: string, words: RouteWords = ROUTE_WORDS_VI, per = 6): CadDocument[] {
  const secs = m.sections ?? []
  const docs: CadDocument[] = []
  const cols = 2
  for (let k = 0; k < secs.length; k += per) {
    const page = secs.slice(k, k + per)
    const out: Entity[] = []
    const w = Math.max(10, ...page.flatMap((s) => [...s.ground, ...s.design].map(([o]) => Math.abs(o)))) * 2 * 1000 + 4000
    const zr = Math.max(4, ...page.map((s) => { const z = [...s.ground, ...s.design].map(([, q]) => q); return Math.max(...z) - Math.min(...z) })) * 1000 + 4500
    // a cell about the proportion of a third of the sheet height by half its width
    const h = Math.max(zr, w / 2.4)
    page.forEach((s, i) => {
      const cx = (i % cols) * w + w / 2, cy = -Math.floor(i / cols) * h
      const zb = Math.min(...[...s.ground, ...s.design].map(([, q]) => q))
      const at = ([o, z]: [number, number]): Vec2 => ({ x: cx + o * 1000, y: cy + (z - zb) * 1000 })
      if (s.ground.length >= 2) out.push(P('C-GRND', s.ground.map(at), false))
      if (s.design.length >= 2) out.push(P('C-DSGN', s.design.map(at), false))
      out.push(L('C-TABL', at([0, zb - 0.3]), at([0, zb + (zr - 2500) / 1000])))
      const th = w / 70
      out.push(T('C-TEXT', { x: cx, y: cy + zr - 1200 }, th * 1.4, `${s.name}  ·  Km ${sta(s.station)}`, 'center'))
      out.push(T('C-AREA', { x: cx, y: cy - th * 2.2 }, th, fill(words.areas, { cut: s.cut.toFixed(2), fill: s.fill.toFixed(2) }), 'center'))
      if (s.drawn?.cut !== undefined) out.push(T('C-AREA', { x: cx, y: cy - th * 4 }, th * 0.85, fill(words.drawn, { cut: s.drawn.cut.toFixed(2), fill: (s.drawn.fill ?? 0).toFixed(2) }), 'center'))
    })
    docs.push(doc(`${title} ${docs.length + 1}`, ROUTE_LAYERS, out))
  }
  return docs
}

/* ---------------- tables (bill of quantities, door and window schedule) ---------------- */

export interface TableCol {
  head: string
  /** width on paper (mm) */
  w: number
  align?: 'left' | 'center'
}
export type TableRow = string[] | { group: string }

/**
 * A table as A3 sheets at 1:1 (paper millimetres): the title, the header row, the rows (a group row spans the
 * width in bold-sized text), 6.5 mm a row and up to `perSheet` rows a sheet; wider tables are scaled to 390 mm.
 */
export function tableDocuments(title: string, cols: TableCol[], rows: TableRow[], perSheet = 34): CadDocument[] {
  const W0 = cols.reduce((a, c) => a + c.w, 0)
  const k = W0 > 390 ? 390 / W0 : 1
  const ws = cols.map((c) => c.w * k), W = ws.reduce((a, b) => a + b, 0)
  const rh = 6.5, th = 2.4
  const sheets: TableRow[][] = []
  for (let i = 0; i < rows.length; i += perSheet) sheets.push(rows.slice(i, i + perSheet))
  if (!sheets.length) sheets.push([])
  return sheets.map((page, si) => {
    const out: Entity[] = []
    const name = sheets.length > 1 ? `${title} (${si + 1}/${sheets.length})` : title
    out.push(T('A-ANNO-TEXT', { x: 0, y: rh * 1.6 }, 5, name.toUpperCase()))
    const xs = ws.reduce<number[]>((a, w) => [...a, a[a.length - 1] + w], [0])
    const line = (i: number, cells: string[] | null, group?: string) => {
      const y = -i * rh
      out.push(L('A-TABL', { x: 0, y }, { x: W, y }))
      if (group !== undefined) out.push(T('A-ANNO-TEXT', { x: 1.5, y: y - rh + 1.9 }, th * 1.05, group.toUpperCase()))
      else if (cells) cells.forEach((v, c) => {
        const center = (cols[c]?.align ?? 'left') === 'center'
        out.push(T('A-ANNO-TEXT', { x: center ? (xs[c] + xs[c + 1]) / 2 : xs[c] + 1.5, y: y - rh + 1.9 }, th, v, center ? 'center' : 'left'))
      })
    }
    line(0, cols.map((c) => c.head))
    page.forEach((r, i) => line(i + 1, Array.isArray(r) ? r : null, Array.isArray(r) ? undefined : r.group))
    const n = page.length + 1
    out.push(L('A-TABL', { x: 0, y: -n * rh }, { x: W, y: -n * rh }), L('A-TABL', { x: 0, y: -rh + 0.01 }, { x: W, y: -rh + 0.01 }))
    // column lines, row by row: a group row is one cell across the width (only its outer edges)
    const allRows: (TableRow | null)[] = [null, ...page]
    allRows.forEach((r, i) => {
      const y0 = -i * rh, y1 = -(i + 1) * rh
      const at = r && !Array.isArray(r) ? [xs[0], xs[xs.length - 1]] : xs
      at.forEach((x) => out.push(L('A-TABL', { x, y: y0 }, { x, y: y1 })))
    })
    const d = doc(name, [lay('A-TABL', '#1f2937', 0.18), lay('A-ANNO-TEXT', '#1f2937', 0.25)], out)
    return { ...d, layouts: [{ id: 'layout1', name: 'A3', paper: 'A3', scale: 1 }] }
  })
}

/* ---------------- structure (from the structural drawings) ---------------- */

const STRUCT_LAYERS = [lay('S-BEAM', '#111827', 0.35), lay('S-FOUND', '#111827', 0.5), lay('S-PILE', '#374151', 0.25), lay('S-COLS', '#111827', 0.35), lay('S-OPEN', '#6b7280', 0.18), lay('S-SLAB', '#6b7280', 0.18), lay('A-GRID', '#9aa1ab', 0.13, 'DashDot'), lay('A-ANNO-TEXT', '#1f2937', 0.25)]

/** Foundation plan (`levelId` null) or the beam plan of a level: grids, columns, and the structure with its marks
 *  — pile caps, piles (crossed squares), tie beams; or the beams (both faces, mark and size at mid-span), the
 *  slab outline and its openings (crossed). */
export function structurePlanDocument(m: BimModel, levelId: string | null, title: string): CadDocument {
  const out: Entity[] = []
  const v = (p: [number, number]): Vec2 => ({ x: p[0], y: p[1] })
  const lowest = [...m.levels].sort((a, b) => a.elevation - b.elevation)[0]?.id
  const beams = (m.beams ?? []).filter((b) => (levelId === null ? b.tie : !b.tie && b.level === levelId))
  for (const b of beams) {
    const t = (b.angle * Math.PI) / 180, u = { x: Math.cos(t), y: Math.sin(t) }, n = { x: -u.y * (b.b / 2), y: u.x * (b.b / 2) }
    const a = { x: b.x, y: b.y }, e = { x: b.x + u.x * b.length, y: b.y + u.y * b.length }
    out.push(L('S-BEAM', { x: a.x + n.x, y: a.y + n.y }, { x: e.x + n.x, y: e.y + n.y }), L('S-BEAM', { x: a.x - n.x, y: a.y - n.y }, { x: e.x - n.x, y: e.y - n.y }))
    if (b.length > 1200) out.push(T('A-ANNO-TEXT', { x: (a.x + e.x) / 2 + n.x * 2.2, y: (a.y + e.y) / 2 + n.y * 2.2 }, 150, `${b.mark} ${b.b}x${b.h}`, 'center', Math.abs(u.y) > 0.7 ? Math.PI / 2 : 0))
  }
  if (levelId === null)
    for (const f of m.footings ?? []) {
      out.push(P('S-FOUND', [v([f.x - f.w / 2, f.y - f.d / 2]), v([f.x + f.w / 2, f.y - f.d / 2]), v([f.x + f.w / 2, f.y + f.d / 2]), v([f.x - f.w / 2, f.y + f.d / 2])], true))
      out.push(T('A-ANNO-TEXT', { x: f.x, y: f.y + f.d / 2 + 120 }, 180, `${f.mark}${f.piles ? ` (${f.piles})` : ''}`, 'center'))
      // the piles: evenly along the long side of the cap (their places are not kept, only their number)
      const k = f.piles, s = f.pileSize ?? 250, along = f.w >= f.d
      for (let i = 0; i < k; i++) {
        const o = ((i + 0.5) / k - 0.5) * (along ? f.w : f.d)
        const c = along ? { x: f.x + o, y: f.y } : { x: f.x, y: f.y + o }
        const q = [v([c.x - s / 2, c.y - s / 2]), v([c.x + s / 2, c.y - s / 2]), v([c.x + s / 2, c.y + s / 2]), v([c.x - s / 2, c.y + s / 2])]
        out.push(P('S-PILE', q, true), L('S-PILE', q[0], q[2]), L('S-PILE', q[1], q[3]))
      }
    }
  else {
    const sl = m.slabs.find((s) => s.level === levelId && s.kind !== 'ceiling' && !s.landing)
    if (sl) {
      out.push(P('S-SLAB', sl.outline.map(v), true))
      for (const o of sl.openings ?? []) { const q = o.map(v); out.push(P('S-OPEN', q, true)); if (q.length === 4) out.push(L('S-OPEN', q[0], q[2]), L('S-OPEN', q[1], q[3])) }
      out.push(T('A-ANNO-TEXT', { x: sl.outline[0][0] + 300, y: sl.outline[0][1] + 300 }, 180, `h=${sl.thickness}`))
    }
  }
  // the columns standing on this level (foundation: those of the lowest level)
  for (const c of m.columns.filter((c) => c.level === (levelId ?? lowest) || (levelId !== null && c.topLevel === levelId))) {
    if (c.round) out.push(C('S-COLS', { x: c.x, y: c.y }, c.w / 2))
    else out.push(P('S-COLS', [{ x: c.x - c.w / 2, y: c.y - c.d / 2 }, { x: c.x + c.w / 2, y: c.y - c.d / 2 }, { x: c.x + c.w / 2, y: c.y + c.d / 2 }, { x: c.x - c.w / 2, y: c.y + c.d / 2 }], true, true))
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const e of out) for (const p of e.kind === 'line' ? [e.a, e.b] : e.kind === 'polyline' ? e.pts : []) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y) }
  if (!Number.isFinite(x0)) { x0 = 0; y0 = 0; x1 = 10000; y1 = 10000 }
  for (const g of m.grids) {
    const a = v(g.a), b = v(g.b)
    out.push(L('A-GRID', a, b))
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const end = { x: b.x + ((b.x - a.x) / d) * 450, y: b.y + ((b.y - a.y) / d) * 450 }
    out.push(C('A-GRID', end, 400), T('A-GRID', { x: end.x, y: end.y - 120 }, 300, g.label, 'center'))
  }
  out.push(T('A-ANNO-TEXT', { x: (x0 + x1) / 2, y: y0 - 3200 }, 450, title.toUpperCase(), 'center'))
  return doc(title, STRUCT_LAYERS, out)
}

/** Roof plan of the pitched roofs: the eaves, ridge and hips (or the gable ridge), the slope, grids. */
export function roofPlanDocument(m: BimModel, title: string): CadDocument {
  const out: Entity[] = []
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity
  for (const r of m.roofs ?? []) {
    const f = roofFrame(r)
    const P2 = (along: number, across: number): Vec2 => ({ x: f.o[0] + f.u[0] * along + f.v[0] * across, y: f.o[1] + f.u[1] * along + f.v[1] * across })
    const eaves = [P2(0, 0), P2(f.L, 0), P2(f.L, f.W), P2(0, f.W)]
    out.push(P('A-ROOF', eaves, true))
    eaves.forEach((p) => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x) })
    if (r.kind === 'gable') out.push(L('A-ROOF', P2(0, f.W / 2), P2(f.L, f.W / 2)))
    else {
      const a = P2(Math.min(f.W / 2, f.L / 2), f.W / 2), b = P2(Math.max(f.L - f.W / 2, f.L / 2), f.W / 2)
      out.push(L('A-ROOF', a, b), L('A-ROOF', eaves[0], a), L('A-ROOF', eaves[3], a), L('A-ROOF', eaves[1], b), L('A-ROOF', eaves[2], b))
    }
    const pc = Math.round(f.tan * 100)
    out.push(T('A-ANNO-TEXT', P2(f.L / 2, f.W / 4), 250, `i = ${pc}% (${r.slope.toFixed(0)}°)`, 'center'), T('A-ANNO-TEXT', P2(f.L / 2, (3 * f.W) / 4), 250, `i = ${pc}%`, 'center'))
  }
  if (!Number.isFinite(x0)) { x0 = 0; y0 = 0; x1 = 10000 }
  for (const g of m.grids) {
    const a = { x: g.a[0], y: g.a[1] }, b = { x: g.b[0], y: g.b[1] }
    out.push(L('A-GRID', a, b))
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const end = { x: b.x + ((b.x - a.x) / d) * 450, y: b.y + ((b.y - a.y) / d) * 450 }
    out.push(C('A-GRID', end, 400), T('A-GRID', { x: end.x, y: end.y - 120 }, 300, g.label, 'center'))
  }
  out.push(T('A-ANNO-TEXT', { x: (x0 + x1) / 2, y: y0 - 3200 }, 450, title.toUpperCase(), 'center'))
  return doc(title, [lay('A-ROOF', '#7c2d12', 0.35), lay('A-GRID', '#9aa1ab', 0.13, 'DashDot'), lay('A-ANNO-TEXT', '#1f2937', 0.25)], out)
}
