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
]

/** Floor plan of one level at the plan cut: walls (poche) broken at their openings, doors with swings, windows,
 *  columns, room names and areas, grids, overall dimensions and the title. */
export function planDocument(m: BimModel, levelId: string, title: string): CadDocument {
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
    out.push(T('A-AREA', { x: ip[0], y: ip[1] + 120 }, 220, r.name, 'center'), T('A-AREA', { x: ip[0], y: ip[1] - 260 }, 180, `S = ${r.area.toFixed(2)} m²`, 'center'))
  }
  for (const f of m.components.filter((c) => c.level === levelId)) {
    const a = (f.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
    const pt = (u: number, w2: number): Vec2 => ({ x: f.x + u * c - w2 * s, y: f.y + u * s + w2 * c })
    out.push(P('A-FURN', [pt(-f.w / 2, -f.d / 2), pt(f.w / 2, -f.d / 2), pt(f.w / 2, f.d / 2), pt(-f.w / 2, f.d / 2)], true))
  }
  if (!Number.isFinite(x0)) { x0 = 0; y0 = 0; x1 = 10000; y1 = 10000 }
  for (const g of m.grids) {
    const a = v(g.a), b = v(g.b)
    out.push(L('A-GRID', a, b))
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const end = { x: b.x + ((b.x - a.x) / d) * 450, y: b.y + ((b.y - a.y) / d) * 450 }
    out.push(C('A-GRID', end, 400), T('A-GRID', { x: end.x, y: end.y - 120 }, 300, g.label, 'center'))
  }
  out.push(D('A-ANNO-DIMS', { x: x0, y: y0 }, { x: x1, y: y0 }, -1400, 250), D('A-ANNO-DIMS', { x: x0, y: y0 }, { x: x0, y: y1 }, 1400, 250))
  const lv = levelOf(m, levelId)
  const el = lv ? (lv.elevation === 0 ? '±0.000' : `${lv.elevation > 0 ? '+' : '−'}${(Math.abs(lv.elevation) / 1000).toFixed(3)}`) : ''
  out.push(T('A-ANNO-TEXT', { x: (x0 + x1) / 2, y: y0 - 3200 }, 450, `${title.toUpperCase()}  ${el}`, 'center'))
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
