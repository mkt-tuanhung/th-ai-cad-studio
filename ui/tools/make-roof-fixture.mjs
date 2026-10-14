// SYNTHETIC roof plan for the house fixture (qa/fixtures/bim/house_vn_SYNTHETIC.dxf: 12 × 9 m, grid 1 at x 110,
// grid A at y 110): its grids, the eaves 500 mm past the walls, a hip roof "i = 35%". Written as DXF R12.
// usage: node tools/make-roof-fixture.mjs  → qa/fixtures/bim/roof_hip_SYNTHETIC.dxf
import { writeFileSync } from 'node:fs'
const L = []
const g = (c, v) => L.push(String(c), String(v))
const layers = ['0', 'TRUC', 'MAI', 'CHU']
g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$INSUNITS'); g(70, 4); g(0, 'ENDSEC')
g(0, 'SECTION'); g(2, 'TABLES'); g(0, 'TABLE'); g(2, 'LAYER'); g(70, layers.length)
for (const n of layers) { g(0, 'LAYER'); g(2, n); g(70, 0); g(62, 7); g(6, 'CONTINUOUS') }
g(0, 'ENDTAB'); g(0, 'ENDSEC'); g(0, 'SECTION'); g(2, 'ENTITIES')
const line = (layer, a, b) => { g(0, 'LINE'); g(8, layer); g(10, a[0]); g(20, a[1]); g(11, b[0]); g(21, b[1]) }
const text = (layer, p, h, s) => { g(0, 'TEXT'); g(8, layer); g(10, p[0]); g(20, p[1]); g(40, h); g(1, s) }
const poly = (layer, pts) => { g(0, 'POLYLINE'); g(8, layer); g(66, 1); g(70, 1); for (const p of pts) { g(0, 'VERTEX'); g(8, layer); g(10, p[0]); g(20, p[1]) } g(0, 'SEQEND') }
const W = 12000, H = 9000
for (const [lab, x] of [['1', 110], ['2', 6000], ['3', 11890]]) { line('TRUC', [x, -2500], [x, H + 2500]); text('TRUC', [x - 120, -3020], 300, lab) }
for (const [lab, y] of [['A', 110], ['B', 8890]]) { line('TRUC', [-2500, y], [W + 2500, y]); text('TRUC', [-3020, y - 120], 300, lab) }
poly('MAI', [[-500, -500], [W + 500, -500], [W + 500, H + 500], [-500, H + 500]])
text('MAI', [4000, 3000], 250, 'MAI DOC i = 35% - LOP NGOI')
text('CHU', [4000, -4500], 400, 'MAT BANG MAI')
g(0, 'ENDSEC'); g(0, 'EOF')
const out = new URL('../../qa/fixtures/bim/roof_hip_SYNTHETIC.dxf', import.meta.url).pathname
writeFileSync(out, L.join('\r\n') + '\r\n')
console.log('wrote', out)
