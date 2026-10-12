// CAD 2D layouts in the desktop app: add a layout, set its paper + scale, plot it to a vector PDF, then
// plot the whole sheet set as one multi-page PDF (THCAD_PDF_OUT=<file> skips the save dialog; the page
// count and page sizes of that file are checked afterwards — see qa/QA_CAD_EDIT.md).
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100) } return null }
  const qa = '/Users/mac/Downloads/TH_AI_CAD_Studio_UI_Handoff_v1/th-ai-cad-studio/qa/'
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  const toasts = () => [...document.querySelectorAll('[aria-live=polite] button')].map((t) => t.textContent).join(' | ')
  const pick = (sel, v) => {
    const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    set.call(sel, v)
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  }
  try {
    const h = await window.thcadHostReady
    await until(() => document.querySelector('[role=radio]'))
    ;[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === 'EN')?.click()
    location.hash = '#/cad2d'
    await until(() => window.thcadSyncStats && window.thcadSyncStats.loads > 0)
    const tabs = () => [...document.querySelectorAll('[role=tab]')].map((t) => t.textContent.trim())
    const add = await until(() => document.querySelector('button[aria-label="New layout"]'), 15000)  // the sheet tabs are drawn
    const before = tabs().filter((t) => /^Layout/.test(t)).length
    add.click()
    await until(() => tabs().filter((t) => /^Layout/.test(t)).length === before + 1)
    check('“+” adds a layout tab and opens it', tabs().filter((t) => /^Layout/.test(t)).length === before + 1, tabs().join(', '))
    pick(await until(() => document.querySelector('select[aria-label=Paper]')), 'A4')
    pick(document.querySelector('select[aria-label=Scale]'), '200')
    await sleep(400)
    const sheet = document.querySelector('[data-testid=paper-sheet]')
    check('preview follows the layout: A4 at 1:200', sheet?.dataset.scale === '200', 'data-scale=' + sheet?.dataset.scale)
    await h.qaGrab(qa + 'cad_layout_a4.png')
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Plot this layout').click()
    await until(() => /saved — vector PDF, A4, scale 1:200/.test(toasts()), 15000)
    check('plot this layout → vector PDF A4 1:200', /vector PDF, A4, scale 1:200/.test(toasts()), toasts())
    const n = window.thcadActiveDoc().layouts.length
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Sheet Set').click()
    await until(() => /Sheet set: \d+ layout/.test(toasts()), 20000)
    check(`sheet set → one PDF with ${n} pages`, new RegExp(`Sheet set: ${n} layout`).test(toasts()), toasts())
    // DWG with the layouts (DXF 2000 → LibreDWG dxf2dwg), read back by the app
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Export').click()
    await sleep(200)
    ;[...document.querySelectorAll('[role=menuitem]')].find((b) => /^DWG/.test(b.textContent.trim())).click()
    const dwgMsg = await until(() => toasts().match(/saved \(AutoCAD 2000\) — read back: \d+ entities, \d+ layers, \d+ layouts/)?.[0], 60000)
    check(`DWG keeps all ${n} layouts (read back)`, !!dwgMsg && new RegExp(`, ${n} layouts`).test(dwgMsg), dwgMsg || toasts())
  } catch (e) {
    fails++
    log('FAIL exception ' + e)
  }
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
