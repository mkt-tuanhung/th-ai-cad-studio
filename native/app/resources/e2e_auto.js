// One command in the desktop app: ⌘K "one command" → the drawings $THCAD_DWG_SAMPLE ("a.dwg|b.dwg|prices.csv": real DWGs, LibreDWG) →
// recognised and built by itself (local AI on unknown layers when loaded) → Approve → the models applied and the
// whole package written into $THCAD_PICK_DIR (PDF sheet sets and DWG by the host, IFC / DXF / CSV / G-code /
// report). The QA profile's stores are put back at the end (see qa/tools/reset_qa_profile.js).
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(150) } return null }
  const qa = '/Users/mac/Downloads/TH_AI_CAD_Studio_UI_Handoff_v1/th-ai-cad-studio/qa/fromcad/'
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  const keys = ['thcad.bim', 'thcad.interior', 'thcad.civil']
  const saved = Object.fromEntries(keys.map((k) => [k, localStorage.getItem(k)]))
  try {
    const h = await window.thcadHostReady
    await until(() => document.querySelector('[role=radio]'))
    ;[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === 'EN')?.click()
    location.hash = '#/dashboard'
    // the command bar: type "one command" and pick the command
    const bar = await until(() => document.querySelector('input[aria-label^="Search projects"]'), 15000)
    bar.focus()
    // the window may not have the keyboard focus (another app in front): no focus event then — send it
    bar.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    bar.dispatchEvent(new FocusEvent('focus'))
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(bar, 'one command')
    bar.dispatchEvent(new Event('input', { bubbles: true }))
    const opt = await until(() => [...document.querySelectorAll('[role=option]')].find((o) => /One command/.test(o.textContent)))
    check('⌘K command bar offers "One command"', !!opt)
    opt.click()
    const dlg = await until(() => document.querySelector('[data-testid=auto]'))
    // every file of $THCAD_DWG_SAMPLE ("a.dwg|b.dwg|prices.csv"), under its own name
    const input = dlg.querySelector('[data-testid=auto-file]')
    const dt = new DataTransfer()
    for (let i = 0; ; i++) {
      const f = JSON.parse(await h.qaSampleFile(i))
      if (!f.name) break
      dt.items.add(new File([Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0))], f.name))
    }
    const names = [...dt.files].map((x) => x.name)
    log('files: ' + names.join(', '))
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    const t0 = Date.now()
    const ready = await until(() => document.querySelector('[data-testid=auto-approve]'), 600000)
    const kind = dlg.querySelector('[data-testid=auto-kind]')?.textContent
    log(`found: ${kind} in ${((Date.now() - t0) / 1000).toFixed(1)} s — ${dlg.querySelector('h4')?.textContent ?? ''}`)
    for (const id of ['auto-house', 'auto-route']) { const el = dlg.querySelector(`[data-testid=${id}]`); if (el) log(el.innerText.replace(/\n/g, ' | ')) }
    log('files: ' + (dlg.querySelector('[data-testid=auto-files]')?.textContent ?? ''))
    check('the drawing was read, recognised and built by itself', !!ready && !!kind && kind !== 'Nothing to build', kind || 'timeout')
    if (/Building/.test(kind ?? '')) {
      const hs = dlg.querySelector('[data-testid=auto-house]')?.innerText ?? ''
      check('elevations (named by their grids) and sections by the OCCT kernel', /Drawings: 4 elevations · 2 sections/.test(hs), hs.replace(/\n/g, ' | '))
      if (names.some((x) => /STRUCT/i.test(x))) check('the structural drawing read onto the building: pile caps, piles, tie beams, beams', /Structure \(.+\): [1-9]\d* pile caps · [1-9]\d* piles · [1-9]\d* tie beams · [1-9]\d* beams/.test(hs), hs.replace(/\n/g, ' | '))
      if (names.some((x) => /\.csv$/i.test(x))) check('unit prices read from the CSV', /Unit prices from .+ — [1-9]\d* of \d+ lines priced/.test(hs), hs.replace(/\n/g, ' | '))
    }
    await h.qaGrab(qa + `auto_${/route/i.test(kind ?? '') ? 'route' : 'house'}_review_desktop.png`)
    document.querySelector('[data-testid=auto-approve]').click()
    const done = await until(() => document.querySelector('[data-testid=auto-done]'), 600000)
    const txt = done?.innerText.replace(/\n/g, ' | ') ?? ''
    log('done: ' + txt)
    check('Approve: models applied, the package written into the folder, no file failed', !!done && /files written to/.test(txt) && !/not written/.test(txt), txt)
    await h.qaGrab(qa + `auto_${/route/i.test(kind ?? '') ? 'route' : 'house'}_done_desktop.png`)
  } catch (e) {
    fails++
    log('FAIL exception ' + e)
  }
  for (const [k, v] of Object.entries(saved)) { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v) }
  const set = Storage.prototype.setItem
  Storage.prototype.setItem = function (k, v) { if (!keys.includes(k)) set.call(this, k, v) }
  await sleep(6000)
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
