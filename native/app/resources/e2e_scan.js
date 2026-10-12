// Scan to CAD in the desktop app (run on the bundled UI, thcad://, to prove the pdf.js worker loads there):
// a small vector PDF written here (a 100 × 50 pt rectangle, one diagonal, one text) becomes CAD geometry
// at 1:100 with exact sizes (100 pt = 35.278 mm → 3 527.8 mm).
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100) } return null }
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  const pdf = () => {
    const content = '0.5 w 0 0 1 RG 100 100 100 50 re S 100 100 m 200 150 l S BT /F1 12 Tf 110 120 Td (ROOM 101) Tj ET'
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ]
    let out = '%PDF-1.4\n'
    const offs = []
    objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
    const xref = out.length
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    return new File([out], 'room_sketch.pdf', { type: 'application/pdf' })
  }
  try {
    await window.thcadHostReady
    await until(() => document.querySelector('[role=radio]'))
    ;[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === 'EN')?.click()
    log('origin ' + location.origin)
    location.hash = '#/ai-studio'
    const input = await until(() => document.querySelector('input[type=file][accept="image/*,.pdf"]'))
    const dt = new DataTransfer()
    dt.items.add(pdf())
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    const res = await until(() => /Vector geometry found/.test(document.querySelector('[data-testid=scan-result]')?.textContent || '') && document.querySelector('[data-testid=scan-result]').textContent, 20000)
    check('pdf.js reads the PDF in the desktop app (worker loads over thcad://)', !!res, res || document.querySelector('[data-testid=scan-result]')?.textContent || 'no dialog')
    ;[...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent.trim() === 'Open in CAD 2D').click()
    await until(() => location.hash === '#/cad2d')
    const d = window.thcadActiveDoc()
    const rect = d.entities.find((e) => e.kind === 'polyline' && e.closed)
    const w = rect && Math.max(...rect.pts.map((p) => p.x)) - Math.min(...rect.pts.map((p) => p.x))
    const line = d.entities.find((e) => e.kind === 'line')
    const text = d.entities.find((e) => e.kind === 'text')
    check('rectangle 100 pt wide → 3 527.8 mm at 1:100', rect && Math.abs(w - (100 * 25.4 / 72) * 100) < 0.01, String(w))
    check('diagonal line and the text “ROOM 101” come through', !!line && text?.value === 'ROOM 101', JSON.stringify(text?.value))
    check('blue stroke → layer PDF-0000FF', rect?.layer === 'PDF-0000FF', rect?.layer)
    // raster: a picture drawn here (rectangle 800 × 400 px + Vietnamese label) → Vectorise (lines + OCR)
    const c = document.createElement('canvas')
    c.width = 1000; c.height = 600
    const g = c.getContext('2d')
    g.fillStyle = '#fff'; g.fillRect(0, 0, 1000, 600)
    g.strokeStyle = '#000'; g.lineWidth = 4; g.strokeRect(100, 100, 800, 400)
    g.fillStyle = '#000'; g.font = '44px Arial'; g.fillText('MẶT BẰNG TẦNG 1', 200, 330)
    const png = await new Promise((r) => c.toBlob(r, 'image/png'))
    location.hash = '#/ai-studio'
    const input2 = await until(() => document.querySelector('input[type=file][accept="image/*,.pdf"]'))
    const dt2 = new DataTransfer()
    dt2.items.add(new File([png], 'sketch.png', { type: 'image/png' }))
    input2.files = dt2.files
    input2.dispatchEvent(new Event('change', { bubbles: true }))
    const vbtn = await until(() => [...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent.trim() === 'Vectorise' && !b.disabled))
    vbtn.click()
    const traced = await until(() => /^Traced:/.test(document.querySelector('[data-testid=scan-vector]')?.textContent || '') && document.querySelector('[data-testid=scan-vector]').textContent, 120000)
    log('raster: ' + traced)
    ;[...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent.trim() === 'Open vectors in CAD 2D').click()
    await until(() => location.hash === '#/cad2d')
    await sleep(500)
    const d2 = window.thcadActiveDoc()
    const words = d2.entities.filter((e) => e.kind === 'text').map((e) => e.value).join(' ')
    const ls = d2.entities.filter((e) => e.layer === 'SCAN-LINES')
    const xs = ls.flatMap((e) => (e.kind === 'line' ? [e.a.x, e.b.x] : e.kind === 'polyline' ? e.pts.map((p) => p.x) : []))
    const wmm = Math.max(...xs) - Math.min(...xs)
    check('raster in the desktop app: OCR (Vietnamese) runs offline over thcad://', /MẶT/.test(words) && /BẰNG/.test(words) && /TẦNG/.test(words), words)
    check('raster lines at true size: 800 px at 150 dpi, 1:100 = 13 547 mm', Math.abs(wmm - 800 * 25.4 / 150 * 100) < 0.01 * 13547, String(Math.round(wmm)))
  } catch (e) {
    fails++
    log('FAIL exception ' + e)
  }
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
