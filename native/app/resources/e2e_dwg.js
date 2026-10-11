// End-to-end: open a real DWG through the CAD 2D file input → bundled LibreDWG helper → DXF import.
// THCAD_QA=1 THCAD_DWG_SAMPLE=/path/drawing.dwg THCAD_SCRIPT=…/e2e_dwg.js
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100) } return null }
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  try {
    const h = await window.thcadHostReady
    const info = await h.info()
    check('DWG reader bundled', !!info.dwgReader, info.dwgReader || 'none')
    const b64 = await h.qaSampleDwg()
    check('sample DWG readable (THCAD_QA=1, THCAD_DWG_SAMPLE)', b64.length > 1000, String(b64.length))
    ;[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === 'EN')?.click()
    location.hash = '#/cad2d'
    const input = await until(() => document.querySelector('input[type=file][accept=".dxf,.dwg"]'))
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const dt = new DataTransfer()
    dt.items.add(new File([bytes], 'sample.dwg', { type: 'application/acad' }))
    const t0 = performance.now()
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    const failed = () => document.body.innerText.match(/Could not read sample\.dwg[^\n]*/)
    await until(() => { const d = window.thcadActiveDoc(); return (d && d.name === 'sample.dwg') || failed() }, 90000)
    if (failed()) log('reader error: ' + failed()[0])
    const doc = (() => { const d = window.thcadActiveDoc(); return d && d.name === 'sample.dwg' ? d : null })()
    const ms = performance.now() - t0
    check('DWG opened as a drawing', !!doc && doc.entities.length > 100, doc ? `${doc.entities.length} entities in ${Math.round(ms)} ms` : 'not opened')
    const lines = [...document.querySelectorAll('[class*=history] div, [class*=log] div')].map((d) => d.textContent)
    const converted = document.body.innerText.match(/Converted sample\.dwg from DWG in \d+ ms[^\n]*/)
    check('command line reports the conversion', !!converted, converted ? converted[0] : lines.slice(-3).join(' | '))
    const texts = doc ? doc.entities.filter((e) => e.kind === 'text').map((e) => e.value) : []
    const vi = texts.find((t) => /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(t))
    check('Vietnamese text survives DWG → DXF → import', !!vi, vi || `${texts.length} texts, none Vietnamese`)
    // legacy TCVN3 (.VnTime fonts) must come out as Unicode, not as "®é mÆt"
    // only code points TCVN3 uses that never occur in Vietnamese Unicode text (Ê, Ô, Ý, × are legitimate)
    const garbled = texts.filter((t) => /[®¸¶¹¾»¼½Æ©ÇËÐÎÏÑªÖØÜÞ«¬¡¢£¤¥¦§]/.test(t))
    check('no legacy TCVN3 characters left', garbled.length === 0, garbled.length ? `${garbled.length}: ${garbled.slice(0, 3).join(' · ')}` : `${texts.length} texts`)
    await until(() => window.thcadGpuStats && window.thcadGpuStats.frames > 0, 5000)
    check('drawn by the GPU layer (≥ 2 000 entities)', doc && (doc.entities.length < 2000 || (window.thcadGpuStats.segments > 0 && !window.thcadGpuStats.failed)), JSON.stringify(window.thcadGpuStats))
    await sleep(1500) // zoom-extents + first GPU frame
    await h.qaGrab('/tmp/thcad_e2e_dwg.png')
  } catch (e) {
    fails++
    log('FAIL exception ' + e)
  }
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
