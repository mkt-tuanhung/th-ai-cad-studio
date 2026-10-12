// SYNTHETIC canal drawing for "Route from CAD" (Civil): a long-profile table and four cross sections in the
// Vietnamese office style of the real canal sets (scale 1:100 → 10 drawing units per metre; scale labels written
// a few units below their ticks; values of the elevation table just right of their drop lines; one section with
// its table written vertically; one table value deliberately off by 0.10 m; the designer's area boxes).
// The exact cut / fill areas are computed here analytically (crossing points, trapezoids) — independent of the
// 1 cm sampling the app uses.  node tools/make-route-fixtures.mjs → qa/fixtures/civil/canal_route_SYNTHETIC.dxf (+ .truth.json)
import { mkdirSync, writeFileSync } from 'node:fs'

const OUT = new URL('../../qa/fixtures/civil/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const K = 10 // drawing units per metre

const L = []
const g = (c, v) => L.push(String(c), String(v))
const layers = ['0', 'Mat dat tu nhien', 'Thietke', 'Thuoccaodo', 'caodo', 'khoangcach', 'tencoc', 'text ghi chú', 'đường trục tâm', 'duongdong', 'Text', 'khung']
g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1021'); g(9, '$INSUNITS'); g(70, 4); g(0, 'ENDSEC')
g(0, 'SECTION'); g(2, 'TABLES'); g(0, 'TABLE'); g(2, 'LAYER'); g(70, layers.length)
for (const n of layers) { g(0, 'LAYER'); g(2, n); g(70, 0); g(62, 7); g(6, 'CONTINUOUS') }
g(0, 'ENDTAB'); g(0, 'ENDSEC')
g(0, 'SECTION'); g(2, 'ENTITIES')
const line = (layer, x1, y1, x2, y2) => { g(0, 'LINE'); g(8, layer); g(10, x1); g(20, y1); g(11, x2); g(21, y2) }
const pline = (layer, pts) => { for (let i = 1; i < pts.length; i++) line(layer, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) }
const text = (layer, x, y, h, s, rot = 0) => { g(0, 'TEXT'); g(8, layer); g(10, x); g(20, y); g(40, h); g(1, s); g(50, rot) }

/** Exact cut / fill between a ground line and the final surface (design where defined, else ground). */
function exactAreas(ground, design) {
  const at = (l, o) => { for (let i = 1; i < l.length; i++) if (o <= l[i][0] + 1e-12) { const [a, za] = l[i - 1], [b, zb] = l[i]; return za + ((zb - za) * (o - a)) / (b - a) } return l[l.length - 1][1] }
  const lo = Math.max(ground[0][0], design[0][0]), hi = Math.min(ground[ground.length - 1][0], design[design.length - 1][0])
  const xs = [...new Set([lo, hi, ...ground.map((p) => p[0]), ...design.map((p) => p[0])].filter((x) => x >= lo && x <= hi))].sort((a, b) => a - b)
  let cut = 0, fill = 0
  for (let i = 1; i < xs.length; i++) {
    const a = xs[i - 1], b = xs[i]
    const da = at(design, a) - at(ground, a), db = at(design, b) - at(ground, b)
    if (da * db >= 0) { const m = ((da + db) / 2) * (b - a); if (m > 0) fill += m; else cut -= m; continue }
    // crossing inside: two triangles
    const x = a + ((b - a) * da) / (da - db)
    const t1 = (da / 2) * (x - a), t2 = (db / 2) * (b - x)
    for (const tv of [t1, t2]) { if (tv > 0) fill += tv; else cut -= tv }
  }
  return { cut, fill }
}

// four stakes, 50 m apart; ground and design lines (offset m, + right of the design centre line; elevation m)
const STAKES = [
  { name: 'C1', st: 0, groundCL: 0.2, ground: [[-12, 1.0], [-6, 1.0], [-5.2, 1.3], [-4.2, 1.3], [-3, 0.4], [-1, 0.2], [1, 0.2], [3, 0.45], [5, 1.2], [12, 1.2]], design: [[-8, 1.0], [-6, 2.0], [-4.375, 2.0], [-1.25, -1.0], [1.25, -1.0], [4.375, 2.0], [6, 2.0], [6.8, 1.2]] },
  { name: 'C2', st: 50, groundCL: 0.15, ground: [[-12, 0.9], [-6, 0.9], [-3.5, 0.5], [-1, 0.15], [1, 0.15], [3.5, 0.6], [6, 1.35], [12, 1.35]], design: [[-7.4, 0.9], [-5.6, 2.0], [-4.375, 2.0], [-1.25, -1.0], [1.25, -1.0], [4.375, 2.0], [5.6, 2.0], [6.25, 1.35]] },
  { name: 'C3', st: 100, groundCL: 0.1, ground: [[-12, 1.1], [-5, 1.1], [-3, 0.35], [-1, 0.1], [1, 0.1], [3, 0.3], [5, 1.0], [12, 1.0]], design: [[-1.25 - 1.25 * 1.1, 1.1], [-1.25, -1.0], [1.25, -1.0], [1.25 + 1.25 * 2.0, 1.5], [6.0, 1.5], [6.5, 1.0]], vertical: true },
  { name: 'C4', st: 150, groundCL: 0.05, ground: [[-12, 1.2], [-6, 1.2], [-3, 0.3], [-1, 0.05], [1, 0.05], [3, 0.35], [6, 1.25], [12, 1.25]], design: [[-8.2, 1.2], [-6.4, 2.0], [-4.375, 2.0], [-1.25, -1.0], [1.25, -1.0], [4.375, 2.0], [6.4, 2.0], [7.15, 1.25]], tableError: 4 },
]

// ---------------- long profile (table) ----------------
{
  const x0 = 0, y0 = 1200, rowH = 24, pitch = 100
  text('0', x0 + 150, y0 + 260, 12, 'CẮT DỌC TUYẾN')
  text('Text', x0 + 150, y0 + 240, 7, 'kênh mẫu 1, l=150m')
  const rows = [
    ['tên cọc', (k) => k.name],
    ['khoảng cách cộng dồn ( m )', (k) => String(k.st)],
    ['khoảng cách ( m )', (k, i) => (i ? '50' : '')],
    ['Cao trình bờ phải thiết kế', () => '2.00'],
    ['Cao trình đáy kênh thiết kế', () => '-1.00'],
    ['cao trình bờ trái thiết kế', () => '2.00'],
    ['cao trình đáy kênh hiện trạng', (k) => k.groundCL.toFixed(2)],
  ]
  rows.forEach(([label, f], r) => {
    const y = y0 + r * rowH
    text('Text', x0, y, 5, label)
    STAKES.forEach((k, i) => { const v = f(k, i); if (v) text('Text', x0 + 200 + i * pitch, y, 5, v) })
    line('khung', x0 - 5, y - 8, x0 + 200 + STAKES.length * pitch, y - 8)
  })
}

// ---------------- cross sections ----------------
const truth = []
STAKES.forEach((k, i) => {
  // two per column, stacked; columns 700 units apart
  const ox = Math.floor(i / 2) * 700, oy = -(i % 2) * 300
  const cx = ox + 200 // design centre line
  const datum = -3 // "mức so sánh"
  const Y = (z) => oy + (z - datum) * K
  const X = (o) => cx + o * K
  text('tencoc', cx - 5, Y(5.5), 10, k.name)
  // scale: ticks every 0.5 m on a bar at x = ox + 35; labels every 2 m, baseline 3.5 units below their tick
  const bx = ox + 35
  for (let z = datum; z < 4.5; z += 0.5) line('Thuoccaodo', bx, Y(z), bx, Y(z + 0.5))
  for (const z of [-2, 0, 2, 4]) text('Thuoccaodo', ox + 12, Y(z) - 3.5 + (z === 2 ? -0.8 : 0), 5, z > 0 ? `+${z.toFixed(2)}` : z.toFixed(2))
  // centre line + labels
  line('đường trục tâm', cx, Y(-1.5), cx, Y(4.6))
  text('text ghi chú', cx + 1.5, Y(4.4), 4, 'tim kênh tk')
  // ground and design lines
  pline('Mat dat tu nhien', k.ground.map(([o, z]) => [X(o), Y(z)]))
  pline('Thietke', k.design.map(([o, z]) => [X(o), Y(z)]))
  // drop lines and the table: "Cao độ mặt đất tự nhiên" values just right of each ground vertex, distances between
  text('Thuoccaodo', ox - 40, Y(datum) - 16, 5, 'Cao độ mặt đất tự nhiên')
  text('Thuoccaodo', ox - 40, Y(datum) - 30, 5, 'Khoảng cách')
  text('Thuoccaodo', ox - 40, Y(datum) + 2, 5, 'Mức so sánh')
  k.ground.forEach(([o, z], j) => {
    line('duongdong', X(o), Y(datum), X(o), Y(z))
    const bad = k.tableError === j ? 0.1 : 0
    if (k.vertical) text('caodo', X(o) + 5.5, Y(datum) - 18, 5, (z + bad).toFixed(2), 90)
    else text('caodo', X(o) + 2, Y(datum) - 18, 5, (z + bad).toFixed(2))
    if (j) { const d = o - k.ground[j - 1][0]; text('khoangcach', (X(o) + X(k.ground[j - 1][0])) / 2 - 5, Y(datum) - 32, 5, d.toFixed(2)) }
  })
  // the designer's area box (rounded to 0.01 m², as written on the drawings)
  const a = exactAreas(k.ground, k.design)
  const bx2 = ox + 520, by = Y(4.5)
  text('1', bx2, by, 5, k.name)
  text('text khao sat', bx2 + 5, by - 11, 5, 'đào đất'); text('text khao sat', bx2 + 50, by - 11, 5, a.cut.toFixed(2)); text('text khao sat', bx2 + 62, by - 11, 5, 'm2')
  text('text khao sat', bx2 + 5, by - 22, 5, 'đất đắp bằng máy'); text('text khao sat', bx2 + 50, by - 22, 5, a.fill.toFixed(2)); text('text khao sat', bx2 + 62, by - 22, 5, 'm2')
  truth.push({ name: k.name, station: k.st, cut: Math.round(a.cut * 1e4) / 1e4, fill: Math.round(a.fill * 1e4) / 1e4, tableError: k.tableError !== undefined, verticalTable: !!k.vertical })
})
g(0, 'ENDSEC'); g(0, 'EOF')
writeFileSync(OUT + 'canal_route_SYNTHETIC.dxf', L.join('\r\n') + '\r\n')
// average end areas over the exact areas
let cut = 0, fill = 0
for (let i = 1; i < truth.length; i++) { const d = truth[i].station - truth[i - 1].station; cut += ((truth[i - 1].cut + truth[i].cut) / 2) * d; fill += ((truth[i - 1].fill + truth[i].fill) / 2) * d }
writeFileSync(OUT + 'canal_route_SYNTHETIC.truth.json', JSON.stringify({ note: 'SYNTHETIC — ui/tools/make-route-fixtures.mjs; areas exact (analytic), volumes by average end areas.', route: 'kênh mẫu 1, l=150m', sections: truth, volume: { cut: Math.round(cut * 100) / 100, fill: Math.round(fill * 100) / 100 } }, null, 1) + '\n')
console.log('written', OUT, { cut, fill })
