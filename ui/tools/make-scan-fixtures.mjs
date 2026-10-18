// SYNTHETIC fixtures for the v2.4 import-calibration smoke tests (qa/fixtures/scan/):
//  - plan_dims_SYNTHETIC.png: 1600 × 1000 px plan at a true 5 mm/px. Bottom dimension "7000" over 1400 px (correct),
//    top right "3460" over 692 px (correct), top left "3600" over 708 px = 3540 mm (WRONG on purpose: V24-020).
//  - two_page_SYNTHETIC.pdf: vector PDF, page 1 a frame + "TRANG 1"; page 2 (A4 landscape) a 200 mm line with "4000"
//    (1:20) and a 100 mm line with "2100" (should be 2000 at 1:20: mismatch) — V24-019 page choice + calibration.
// run: node tools/make-scan-fixtures.mjs
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const OUT = new URL('../../qa/fixtures/scan/', import.meta.url).pathname

// ---- raster plan
const browser = await chromium.launch()
const page = await browser.newPage()
const b64 = await page.evaluate(() => {
  const c = document.createElement('canvas')
  c.width = 1600
  c.height = 1000
  const g = c.getContext('2d')
  g.fillStyle = '#fff'
  g.fillRect(0, 0, 1600, 1000)
  g.strokeStyle = '#000'
  g.fillStyle = '#000'
  g.lineWidth = 3
  const L = (x0, y0, x1, y1) => { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke() }
  g.strokeRect(100, 150, 1400, 700)
  L(808, 150, 808, 850)
  // dimension lines: extended 12 px past the ticks, ticks crossing at the measured ends
  const dim = (x0, x1, y, text) => {
    g.lineWidth = 2
    L(x0 - 12, y, x1 + 12, y)
    L(x0, y - 14, x0, y + 14)
    L(x1, y - 14, x1, y + 14)
    g.font = '30px Arial, Helvetica, sans-serif'
    g.textAlign = 'center'
    g.fillText(text, (x0 + x1) / 2, y - 12)
    g.lineWidth = 3
  }
  dim(100, 808, 90, '3600')
  dim(808, 1500, 90, '3460')
  dim(100, 1500, 930, '7000')
  g.font = '34px Arial, Helvetica, sans-serif'
  g.textAlign = 'left'
  g.fillText('PHÒNG KHÁCH', 200, 400)
  g.fillText('BẾP', 1050, 550)
  return c.toDataURL('image/png').split(',')[1]
})
writeFileSync(OUT + 'plan_dims_SYNTHETIC.png', Buffer.from(b64, 'base64'))
await browser.close()

// ---- two-page vector PDF (hand-written objects, exact positions)
const pt = (mm) => +(mm * 72 / 25.4).toFixed(3)
const page1 = `q 1 w 0 0 0 RG ${pt(20)} ${pt(20)} ${pt(170)} ${pt(257)} re S Q BT /F1 14 Tf ${pt(30)} ${pt(260)} Td (TRANG 1) Tj ET`
const page2 = [
  'q 0.8 w 0 0 0 RG',
  `${pt(40)} ${pt(100)} m ${pt(240)} ${pt(100)} l S`,
  `${pt(40)} ${pt(96)} m ${pt(40)} ${pt(104)} l S ${pt(240)} ${pt(96)} m ${pt(240)} ${pt(104)} l S`,
  `${pt(40)} ${pt(60)} m ${pt(140)} ${pt(60)} l S`,
  `${pt(40)} ${pt(56)} m ${pt(40)} ${pt(64)} l S ${pt(140)} ${pt(56)} m ${pt(140)} ${pt(64)} l S`,
  `${pt(30)} ${pt(30)} ${pt(237)} ${pt(150)} re S`,
  'Q',
  `BT /F1 12 Tf ${pt(140) - 13.3} ${pt(102)} Td (4000) Tj ET`,
  `BT /F1 12 Tf ${pt(90) - 13.3} ${pt(62)} Td (2100) Tj ET`,
  `BT /F1 14 Tf ${pt(35)} ${pt(170)} Td (TRANG 2 - MAT BANG 1:20) Tj ET`,
].join('\n')
const objs = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pt(210)} ${pt(297)}] /Contents 5 0 R /Resources << /Font << /F1 7 0 R >> >> >>`,
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pt(297)} ${pt(210)}] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>`,
  `<< /Length ${page1.length} >>\nstream\n${page1}\nendstream`,
  `<< /Length ${page2.length} >>\nstream\n${page2}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
]
let pdf = '%PDF-1.4\n'
const offs = []
objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n` })
const xref = pdf.length
pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
writeFileSync(OUT + 'two_page_SYNTHETIC.pdf', pdf, 'latin1')
console.log('written', OUT)
