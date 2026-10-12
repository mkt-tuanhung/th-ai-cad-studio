// SYNTHETIC floor-plan fixtures for "Build from CAD plans" (plan → BIM). Written in a common Vietnamese office
// style that differs from the VILLA_150 test set on purpose: R12 DXF, exterior walls as LINE pairs broken at the
// openings, partitions as overlapping closed rectangles, doors / windows as blocks on ONE layer "CUA" (swing arcs,
// glazing lines), columns as squares + SOLID, room names / tags / titles in TCVN3 (.VnArial / .VnArialH fonts),
// grids with bubbles, furniture blocks with Vietnamese names. The ground truth (computed here from the same
// numbers) is written next to each DXF.
//   node tools/make-plan-fixtures.mjs   → qa/fixtures/bim/house_vn_SYNTHETIC.dxf (+ .truth.json), house_vn_rot30_SYNTHETIC.dxf
import { mkdirSync, writeFileSync } from 'node:fs'

const OUT = new URL('../../qa/fixtures/bim/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

// Unicode → TCVN3 (the inverse of the importer's table, src/cad/dxfImport.ts)
const FROM = '¸µ¶·¹¨¾»¼½Æ©ÊÇÈÉËÐÌÎÏÑªÕÒÓÔÖÝ×ØÜÞãßáâä«èåæçé¬íêëìîóïñòô­øõö÷ùýúûüþ®¡¢£¤¥¦§'
const TO = 'áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđĂÂÊÔƠƯĐ'
const ENC = new Map([...TO].map((c, i) => [c, [...FROM][i]]))
const tcvn3 = (s) => [...s.normalize('NFC')].map((c) => ENC.get(c) ?? c).join('')

function dxf(build) {
  const L = []
  const g = (c, v) => L.push(String(c), String(v))
  const layers = ['0', 'TUONG', 'CUA', 'COT', 'TEN PHONG', 'NOI THAT', 'TRUC', 'KICH THUOC', 'CHU', 'KHUNG TEN']
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$DWGCODEPAGE'); g(3, 'ANSI_1252'); g(9, '$INSUNITS'); g(70, 4); g(0, 'ENDSEC')
  g(0, 'SECTION'); g(2, 'TABLES')
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, layers.length)
  for (const n of layers) { g(0, 'LAYER'); g(2, n); g(70, 0); g(62, 7); g(6, 'CONTINUOUS') }
  g(0, 'ENDTAB')
  g(0, 'TABLE'); g(2, 'STYLE'); g(70, 2)
  for (const [n, f] of [['VN', '.VnArial'], ['VNH', '.VnArialH']]) { g(0, 'STYLE'); g(2, n); g(70, 0); g(40, 0); g(41, 1); g(50, 0); g(71, 0); g(42, 250); g(3, f); g(4, '') }
  g(0, 'ENDTAB'); g(0, 'ENDSEC')
  const ents = []
  const api = (out) => ({
    line: (layer, a, b) => { out.push(['LINE', layer, a, b]) },
    rect: (layer, x0, y0, x1, y1) => out.push(['POLY', layer, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]]),
    poly: (layer, pts) => out.push(['POLY', layer, pts]),
    solid: (layer, x0, y0, x1, y1) => out.push(['SOLID', layer, [x0, y0, x1, y1]]),
    circle: (layer, c, r) => out.push(['CIRCLE', layer, c, r]),
    arc: (layer, c, r, s, e) => out.push(['ARC', layer, c, r, s, e]),
    text: (layer, p, h, s, style = 'VN', rot = 0) => out.push(['TEXT', layer, p, h, tcvn3(s), style, rot]),
    insert: (layer, name, p, rot = 0) => out.push(['INSERT', layer, name, p, rot]),
  })
  const defs = new Map()
  const block = (name, fn) => { const b = []; fn(api(b)); defs.set(name, b) }
  build(api(ents), block)
  const emit = (e, [tx, ty, ang] = [0, 0, 0]) => {
    const c = Math.cos(ang), s = Math.sin(ang)
    const P = ([x, y]) => [tx + x * c - y * s, ty + x * s + y * c]
    const [k, layer] = e
    if (k === 'LINE') { const a = P(e[2]), b = P(e[3]); g(0, 'LINE'); g(8, layer); g(10, a[0]); g(20, a[1]); g(11, b[0]); g(21, b[1]) }
    if (k === 'POLY') { g(0, 'POLYLINE'); g(8, layer); g(66, 1); g(70, 1); for (const p of e[2]) { const q = P(p); g(0, 'VERTEX'); g(8, layer); g(10, q[0]); g(20, q[1]) } g(0, 'SEQEND') }
    if (k === 'SOLID') { const [x0, y0, x1, y1] = e[2]; const v = [P([x0, y0]), P([x1, y0]), P([x0, y1]), P([x1, y1])]; g(0, 'SOLID'); g(8, layer); v.forEach((q, i) => { g(10 + i, q[0]); g(20 + i, q[1]) }) }
    if (k === 'CIRCLE') { const q = P(e[2]); g(0, 'CIRCLE'); g(8, layer); g(10, q[0]); g(20, q[1]); g(40, e[3]) }
    if (k === 'ARC') { const q = P(e[2]); g(0, 'ARC'); g(8, layer); g(10, q[0]); g(20, q[1]); g(40, e[3]); g(50, e[4] + (ang * 180) / Math.PI); g(51, e[5] + (ang * 180) / Math.PI) }
    if (k === 'TEXT') { const q = P(e[2]); g(0, 'TEXT'); g(8, layer); g(10, q[0]); g(20, q[1]); g(40, e[3]); g(1, e[4]); g(7, e[5]); g(50, e[6] + (ang * 180) / Math.PI) }
    if (k === 'INSERT') { const q = P(e[3]); g(0, 'INSERT'); g(8, layer); g(2, e[2]); g(10, q[0]); g(20, q[1]); g(50, e[4] + (ang * 180) / Math.PI) }
  }
  g(0, 'SECTION'); g(2, 'BLOCKS')
  for (const [name, b] of defs) { g(0, 'BLOCK'); g(8, '0'); g(2, name); g(70, 0); g(10, 0); g(20, 0); for (const e of b) emit(e); g(0, 'ENDBLK'); g(8, '0') }
  g(0, 'ENDSEC')
  return { ents, finish: (xf) => { g(0, 'SECTION'); g(2, 'ENTITIES'); for (const e of ents) emit(e, xf); g(0, 'ENDSEC'); g(0, 'EOF'); return L.join('\r\n') + '\r\n' } }
}

/* ---------------- the house ---------------- */
const W = 12000, H = 9000, TE = 220, TI = 110
// openings in the exterior walls: [side, from, to, kind, tag, size]
const EXT = {
  1: [['S', 2000, 3600, 'door2', 'Đ5', '1600x2400'], ['S', 8000, 9500, 'win', 'S1', ''], ['W', 6000, 7200, 'win', 'S2', '1200x1400'], ['N', 2500, 3700, 'win', 'S3', ''], ['E', 6500, 7700, 'win', 'S4', ''], ['N', 8000, 9200, 'win', 'S5', ''], ['E', 3500, 4100, 'win', 'S6', '']],
  2: [['S', 2000, 3200, 'win', 'S7', ''], ['S', 8000, 9500, 'win', 'S8', ''], ['W', 6000, 7200, 'win', 'S9', ''], ['N', 2500, 3700, 'win', 'S10', ''], ['E', 6500, 7700, 'win', 'S11', ''], ['N', 8000, 9200, 'win', 'S12', ''], ['E', 3500, 4100, 'win', 'S13', '']],
}
// partitions (110, rectangles overlapping the wall they meet) with doors: [x0,y0,x1,y1 of the centre line, doors [from,to,tag]]
const PART = [
  [6000, 0, 6000, 9000, [[2000, 2900]]],
  [0, 4500, 6000, 4500, [[2500, 3400]]],
  [6000, 3000, 12000, 3000, [[7000, 7900]]],
  [9500, 3000, 9500, 5500, [[3800, 4500]]],
  [9445, 5500, 12000, 5500, []],
]
const DOOR_TAGS = { 1: ['Đ1', 'Đ2', 'Đ3', 'Đ4'], 2: ['Đ6', 'Đ7', 'Đ8', 'Đ9'] }
const ROOMS = {
  1: [['phòng khách', 3000, 2300], ['phòng ngủ 1', 3000, 6600], ['bếp + ăn', 8800, 1500], ['wc', 10600, 4200], ['phòng ngủ 2', 7700, 7000]],
  2: [['sinh hoạt chung', 3000, 2300], ['phòng ngủ 3', 3000, 6600], ['phòng làm việc', 8800, 1500], ['wc 2', 10600, 4200], ['phòng ngủ 4', 7700, 7000]],
}
const AREAS = [24.19, 24.19, 15.6, 5.32, 26.94] // computed from the inner faces (see QA_FROM_CAD.md)
const FURN = {
  1: [['SOFA_3', 3000, 1100, 0], ['BAN_TRA', 3000, 2400, 0], ['KE_TIVI', 3000, 4200, 180], ['GIUONG_DOI', 2000, 6600, 90], ['TU_AO_1600', 3500, 8460, 180], ['BAN_AN_6G', 8800, 1700, 0], ['TU_BEP_DUOI', 7500, 540, 0], ['BON_CAU', 11300, 3500, 90], ['LAVABO', 10200, 5150, 180], ['GIUONG_DON', 7300, 7300, 0], ['TU_AO_1200', 6375, 4800, 270]],
  2: [['SOFA_3', 3000, 1100, 0], ['GIUONG_DOI', 2000, 6600, 90], ['TU_AO_1600', 3500, 8460, 180], ['BAN_LAM_VIEC', 8800, 1500, 0], ['KE_SACH', 10400, 540, 0], ['BON_CAU', 11300, 3500, 90], ['GIUONG_DOI', 7700, 7300, 0]],
}

function house({ line, rect, solid, circle, text, insert }, block, ox, floor) {
  const X = (x) => ox + x
  // blocks (defined once; harmless if redefined)
  block('CUA_DI_900', (b) => { b.line('0', [0, 0], [0, 900]); b.arc('0', [0, 0], 900, 0, 90) })
  block('CUA_DI_700', (b) => { b.line('0', [0, 0], [0, 700]); b.arc('0', [0, 0], 700, 0, 90) })
  block('CUA_DI_2C_1600', (b) => { b.line('0', [0, 0], [0, 800]); b.arc('0', [0, 0], 800, 0, 90); b.line('0', [1600, 0], [1600, 800]); b.arc('0', [1600, 0], 800, 90, 180) })
  for (const w of [600, 1200, 1500]) block(`CUA_SO_${w}`, (b) => { for (const y of [0, 80, 140, 220]) b.line('0', [0, y], [w, y]); b.line('0', [0, 0], [0, 220]); b.line('0', [w, 0], [w, 220]) })
  const fblock = (name, w, d, extra) => block(name, (b) => { b.rect('0', -w / 2, -d / 2, w / 2, d / 2); extra?.(b) })
  fblock('SOFA_3', 2100, 850, (b) => b.line('0', [-1050, 200], [1050, 200]))
  fblock('BAN_TRA', 1000, 600)
  fblock('KE_TIVI', 1800, 400)
  fblock('GIUONG_DOI', 1600, 2000, (b) => b.line('0', [-800, 600], [800, 600]))
  fblock('GIUONG_DON', 1200, 2000)
  fblock('TU_AO_1600', 1600, 600, (b) => b.line('0', [0, -300], [0, 300]))
  fblock('TU_AO_1200', 1200, 600)
  fblock('BAN_AN_6G', 1600, 900)
  fblock('TU_BEP_DUOI', 2400, 600)
  fblock('BAN_LAM_VIEC', 1400, 700)
  fblock('KE_SACH', 1200, 350)
  fblock('BON_CAU', 400, 700, (b) => b.circle('0', [0, -100], 150))
  fblock('LAVABO', 500, 400, (b) => b.circle('0', [0, 0], 140))

  // exterior walls: LINE pairs, broken at the openings
  const ops = EXT[floor]
  const side = (s, len, outer, inner) => {
    const cuts = ops.filter((o) => o[0] === s).map((o) => [o[1], o[2]]).sort((a, b) => a[0] - b[0])
    for (const [face, lo, hi] of [[outer, 0, len], [inner, TE, len - TE]]) {
      let at = lo
      for (const [a, b] of cuts) { if (a > at) face(at, a); at = b }
      if (at < hi) face(at, hi)
    }
  }
  side('S', W, (a, b) => line('TUONG', [X(a), 0], [X(b), 0]), (a, b) => line('TUONG', [X(a), TE], [X(b), TE]))
  side('N', W, (a, b) => line('TUONG', [X(a), H], [X(b), H]), (a, b) => line('TUONG', [X(a), H - TE], [X(b), H - TE]))
  side('W', H, (a, b) => line('TUONG', [X(0), a], [X(0), b]), (a, b) => line('TUONG', [X(TE), a], [X(TE), b]))
  side('E', H, (a, b) => line('TUONG', [X(W), a], [X(W), b]), (a, b) => line('TUONG', [X(W - TE), a], [X(W - TE), b]))
  // jamb lines across the openings
  for (const [s, a, b] of ops)
    for (const v of [a, b]) {
      if (s === 'S') line('TUONG', [X(v), 0], [X(v), TE])
      if (s === 'N') line('TUONG', [X(v), H - TE], [X(v), H])
      if (s === 'W') line('TUONG', [X(0), v], [X(TE), v])
      if (s === 'E') line('TUONG', [X(W - TE), v], [X(W), v])
    }
  // exterior doors / windows + tags
  for (const [s, a, b, kind, tag, size] of ops) {
    const w = b - a, m = (a + b) / 2
    const name = kind === 'door2' ? 'CUA_DI_2C_1600' : `CUA_SO_${w}`
    if (s === 'S') { insert('CUA', name, [X(a), kind === 'door2' ? TE : 0], 0); text('CUA', [X(m - 200), -600], 200, tag); if (size) text('CUA', [X(m - 500), -900], 180, size) }
    if (s === 'N') { insert('CUA', name, [X(a), H - TE], 0); text('CUA', [X(m - 200), H + 400], 200, tag) }
    if (s === 'W') { insert('CUA', name, [X(TE), a], 90); text('CUA', [X(-700), m], 200, tag); if (size) text('CUA', [X(-1500), m - 300], 180, size) }
    if (s === 'E') { insert('CUA', name, [X(W), a], 90); text('CUA', [X(W + 400), m], 200, tag) }
  }
  // partitions: closed rectangles split at their doors, door blocks hinged at the first jamb
  PART.forEach(([x0, y0, x1, y1, doors], k) => {
    const vert = x0 === x1
    const lo = vert ? y0 : x0, hi = vert ? y1 : x1
    let at = lo
    const cuts = doors.map(([a, b]) => [a, b])
    for (const [a, b] of [...cuts, [hi, hi]]) {
      if (a > at) {
        if (vert) rect('TUONG', X(x0 - TI / 2), at, X(x0 + TI / 2), a)
        else rect('TUONG', X(at), y0 - TI / 2, X(a), y0 + TI / 2)
      }
      at = b
    }
    doors.forEach(([a, b]) => {
      const w = b - a
      const tag = DOOR_TAGS[floor][k]
      if (vert) { insert('CUA', `CUA_DI_${w}`, [X(x0 + TI / 2), a], 0); text('CUA', [X(x0 + 300), (a + b) / 2], 180, tag) }
      else { insert('CUA', `CUA_DI_${w}`, [X(a), y0 + TI / 2], 270); text('CUA', [X((a + b) / 2), y0 - 450], 180, tag) }
    })
  })
  // columns at the grid intersections (inside the exterior wall band)
  for (const [cx, cy] of [[110, 110], [6000, 110], [11890, 110], [110, 8890], [6000, 8890], [11890, 8890]]) {
    rect('COT', X(cx - 110), cy - 110, X(cx + 110), cy + 110)
    solid('COT', X(cx - 110), cy - 110, X(cx + 110), cy + 110)
  }
  // grids with bubbles
  for (const [lab, x] of [['1', 110], ['2', 6000], ['3', 11890]]) { line('TRUC', [X(x), -2500], [X(x), H + 2500]); circle('TRUC', [X(x), -2900], 400); text('TRUC', [X(x - 120), -3020], 300, lab) }
  for (const [lab, y] of [['A', 110], ['B', 8890]]) { line('TRUC', [X(-2500), y], [X(W + 2500), y]); circle('TRUC', [X(-2900), y], 400); text('TRUC', [X(-3020), y - 120], 300, lab) }
  // room names (capitals font) and furniture
  for (const [n, x, y] of ROOMS[floor]) text('TEN PHONG', [X(x - 600), y], 250, n, 'VNH')
  for (const [name, x, y, rot] of FURN[floor]) insert('NOI THAT', name, [X(x), y], rot)
  // a dimension line drawn as lines + text (ignored)
  line('KICH THUOC', [X(0), -1500], [X(W), -1500]); text('KICH THUOC', [X(W / 2), -1400], 200, '12000')
  // title under the plan
  text('CHU', [X(3000), -4500], 450, floor === 1 ? 'mặt bằng tầng 1   cos ±0.000' : 'mặt bằng tầng 2   cos +3.600', 'VNH')
}

for (const [file, ang] of [['house_vn_SYNTHETIC.dxf', 0], ['house_vn_rot30_SYNTHETIC.dxf', Math.PI / 6]]) {
  const d = dxf((api, block) => { house(api, block, 0, 1); house(api, block, 20000, 2) })
  writeFileSync(OUT + file, Buffer.from(d.finish([0, 0, ang]), 'latin1'))
}
const truth = {
  note: 'SYNTHETIC — generated by ui/tools/make-plan-fixtures.mjs; numbers computed from the generator, not measured.',
  floors: [1, 2].map((f) => ({
    title: f === 1 ? 'MẶT BẰNG TẦNG 1 COS ±0.000' : 'MẶT BẰNG TẦNG 2 COS +3.600',
    elevation: f === 1 ? 0 : 3600,
    walls: { exteriorThickness: TE, interiorThickness: TI },
    doors: (f === 1 ? 5 : 4),
    windows: f === 1 ? 6 : 7,
    rooms: ROOMS[f].map(([n], i) => ({ name: n.toLocaleUpperCase('vi'), area: AREAS[i] })),
    columns: 6,
    furniture: FURN[f].length,
    grids: ['1', '2', '3', 'A', 'B'],
  })),
}
writeFileSync(OUT + 'house_vn_SYNTHETIC.truth.json', JSON.stringify(truth, null, 1) + '\n')
console.log('written', OUT)
