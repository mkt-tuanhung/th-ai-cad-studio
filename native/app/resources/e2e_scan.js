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
  } catch (e) {
    fails++
    log('FAIL exception ' + e)
  }
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
