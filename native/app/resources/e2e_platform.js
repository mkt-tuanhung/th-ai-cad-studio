// v2.4 platform in the desktop app (V24-035): two new CAD 2D layouts — A0 1:50 and A4 1:100, both with the check
// ruler — plotted with the sheet set through the host's QPdfWriter into one PDF (THCAD_PDF_OUT=<file>). The PDF's
// page sizes and the plotted ruler lengths are then measured by qa/tools/check-pdf-ruler.py (see QA_PLATFORM.md).
// Also: the cheatsheet opens in the desktop page, and a host error is shown in Vietnamese.
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100) } return null }
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  const toasts = () => [...document.querySelectorAll('[aria-live=polite] button')].map((t) => t.textContent).join(' | ')
  const pick = (sel, v) => {
    const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    set.call(sel, v)
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const tabs = () => [...document.querySelectorAll('[role=tab]')].map((t) => t.textContent.trim())
  try {
    await window.thcadHostReady
    await until(() => document.querySelector('[role=radio]'))
    ;[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === 'EN')?.click()
    location.hash = '#/cad2d'
    await until(() => window.thcadSyncStats && window.thcadSyncStats.loads > 0, 20000)
    for (const [paper, scale] of [['A0', '50'], ['A4', '100']]) {
      const add = await until(() => document.querySelector('button[aria-label="New layout"]'), 15000)
      const n = tabs().filter((t) => /^Layout/.test(t)).length
      add.click()
      await until(() => tabs().filter((t) => /^Layout/.test(t)).length === n + 1)
      pick(await until(() => document.querySelector('select[aria-label=Paper]')), paper)
      pick(document.querySelector('select[aria-label=Scale]'), scale)
      await sleep(200)
      const box = document.querySelector('input[aria-label="Check ruler"]')
      if (!box.checked) box.click()
      await sleep(300)
      const html = document.querySelector('[data-testid=paper-sheet]')?.innerHTML ?? ''
      check(`${paper} 1:${scale} sheet with the check ruler`, html.includes('100 mm (paper)') && html.includes(`(model, 1:${scale})`))
    }
    const layouts = window.thcadActiveDoc().layouts
    log('LAYOUTS ' + JSON.stringify(layouts.map((l) => ({ paper: l.paper, scale: l.scale, ruler: !!l.ruler }))))
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Sheet Set').click()
    await until(() => /Sheet set: \d+ layout/.test(toasts()), 30000)
    check(`sheet set → one PDF with ${layouts.length} pages`, new RegExp(`Sheet set: ${layouts.length} layout`).test(toasts()), toasts())
    // cheatsheet in the desktop page
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', code: 'Slash', metaKey: true, bubbles: true }))
    await until(() => document.querySelector('[data-testid=cheatsheet]'), 3000)
    check('cheatsheet opens (⌘/)', !!document.querySelector('[data-testid=cheatsheet]'))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    // clean up: the two QA layouts go away again
    for (let i = 0; i < 2; i++) {
      const t = [...document.querySelectorAll('[role=tab]')].filter((x) => /^Layout/.test(x.textContent.trim())).at(-1)
      t?.click()
      await sleep(200)
      document.querySelector('button[aria-label="Delete layout"]')?.click()
      await sleep(200)
    }
  } catch (e) {
    fails++
    log('FAIL exception ' + e)
  }
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
