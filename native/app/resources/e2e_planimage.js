// v2.4 "Ảnh mặt bằng → nội thất 3D" in the desktop app: ⌘K "one command" → a floor-plan PICTURE ($THCAD_DWG_SAMPLE,
// e.g. qa/v2_4/fixtures/planimage/sketch_plan_SYNTHETIC.png) → plan review (Recognise: walls, doors, windows, rooms,
// OCR names, offline) → Approve and build → the dialog's review (elevations / sections by the OCCT kernel) →
// Approve → BIM + Interior applied, the package written into $THCAD_PICK_DIR. Run 1 uncalibrated: REVIEW REQUIRED,
// the CNC release blocked (SOURCE_DRAWING_NOT_FABRICATION_READY); run 2 calibrated with the dimension text read on the
// picture: no REVIEW REQUIRED. Screenshots into /tmp/thcad_planimage_e2e. The QA profile's stores are put back.
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(150) } return null }
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  const keys = ['thcad.bim', 'thcad.interior', 'thcad.civil', 'thcad.mep', 'thcad.cad']
  const saved = Object.fromEntries(keys.map((k) => [k, localStorage.getItem(k)]))
  const click = (el) => el && el.click()
  const byText = (sel, re) => [...document.querySelectorAll(sel)].find((b) => re.test(b.textContent.trim()))
  try {
    const h = await window.thcadHostReady
    // screenshots: a temp folder (not the repository's qa/ — parallel worktrees share the main checkout)
    const shots = '/tmp/thcad_planimage_e2e'
    const grab = async (name) => { if (shots) await h.qaGrab(shots + '/' + name) }
    await until(() => document.querySelector('[role=radio]'))
    ;[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === 'EN')?.click()
    const f = JSON.parse(await h.qaSampleFile(0))
    check('the picture is handed over by the host', !!f.name && /\.(png|jpe?g|webp|pdf)$/i.test(f.name), f.name)
    const file = () => new File([Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0))], f.name, { type: /\.png$/i.test(f.name) ? 'image/png' : 'image/jpeg' })
    const run = async (calibrate) => {
      location.hash = '#/dashboard'
      const bar = await until(() => document.querySelector('input[aria-label^="Search projects"]'), 15000)
      bar.focus()
      bar.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
      bar.dispatchEvent(new FocusEvent('focus'))
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(bar, 'one command')
      bar.dispatchEvent(new Event('input', { bubbles: true }))
      const opt = await until(() => [...document.querySelectorAll('[role=option]')].find((o) => /One command/.test(o.textContent)))
      opt.click()
      const dlg = await until(() => document.querySelector('[data-testid=auto]'))
      const input = dlg.querySelector('[data-testid=auto-file]')
      check('the one-command input takes pictures', /\.png/.test(input.getAttribute('accept') ?? ''))
      const dt = new DataTransfer()
      dt.items.add(file())
      input.files = dt.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
      const go = await until(() => { const b = document.querySelector('[data-testid=pi-analyse]'); return b && !b.disabled && b }, 20000)
      check('the plan review opens with the picture', !!go)
      const t0 = Date.now()
      click(go)
      const found = await until(() => document.querySelector('[data-testid=pi-found]'), 180000)
      const txt = found?.textContent ?? ''
      log(`recognised in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${txt}`)
      const m = /Found: (\d+) walls .*?, (\d+) doors, (\d+) windows, \d+ openings, \d+ columns, (\d+) rooms \((\d+) named\)/.exec(txt)
      check('walls, doors, windows and rooms recognised on the picture (OCR names offline)', !!m && +m[1] >= 7 && +m[2] >= 4 && +m[3] >= 2 && +m[4] >= 5 && +m[5] >= 3, txt)
      if (calibrate) {
        const row = [...document.querySelectorAll('[data-testid=pi-cal] li')].find((li) => /“9000”/.test(li.textContent))
        click(row && [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Use'))
        await sleep(300)
        const st = document.querySelector('[data-testid=pi-cal-status]')?.textContent ?? ''
        check('calibrated from the dimension text "9000" read on the picture (12.5 mm / px ± 3 %)', /Calibrated: 1 px = ([\d.]+) mm/.test(st) && Math.abs(Number(/1 px = ([\d.]+)/.exec(st)[1]) / 12.5 - 1) < 0.03, st)
      } else check('uncalibrated: said so before building', /NOT CALIBRATED/.test(document.querySelector('[data-testid=pi-cal-status]')?.textContent ?? ''))
      await grab(`planimage_review_${calibrate ? 'cal' : 'uncal'}_desktop.png`)
      click(document.querySelector('[data-testid=pi-approve]'))
      const ready = await until(() => document.querySelector('[data-testid=auto-approve]'), 300000)
      const hs = dlg.querySelector('[data-testid=auto-house]')?.innerText ?? ''
      log('house: ' + hs.replace(/\n/g, ' | '))
      check('built like a drawing: BIM levels / walls / rooms, Interior with furniture, model checks', !!ready && /2 levels · \d+ walls · \d+ doors · \d+ windows · \d+ rooms/.test(hs) && /Interior \(.+\): \d+ rooms · [1-9]\d* items/.test(hs) && /Model checks: all passed/.test(hs), hs.slice(0, 300))
      check('elevations and sections by the OCCT kernel of the desktop app', /Drawings: \d+ elevations · \d+ sections/.test(hs), hs.slice(0, 300))
      const rr = dlg.querySelector('[data-testid=auto-review-required]')
      const warn = [...dlg.querySelectorAll('details')].map((d) => d.textContent).join(' ')
      if (calibrate) check('calibrated: no REVIEW REQUIRED, the source does not block the CNC release', !rr && !/SOURCE_DRAWING_NOT_FABRICATION_READY/.test(warn))
      else check('uncalibrated: REVIEW REQUIRED and the CNC release blocked by the source', !!rr && /SOURCE_DRAWING_NOT_FABRICATION_READY/.test(warn), (rr?.textContent ?? 'no banner') + ' / ' + warn.slice(0, 200))
      await grab(`planimage_auto_review_${calibrate ? 'cal' : 'uncal'}_desktop.png`)
      click(document.querySelector('[data-testid=auto-approve]'))
      const done = await until(() => document.querySelector('[data-testid=auto-done]'), 300000)
      const dtxt = done?.innerText.replace(/\n/g, ' | ') ?? ''
      log('done: ' + dtxt)
      check('Approve: BIM + Interior applied, the package written into the folder', !!done && /BIM, Interior/.test(dtxt) && /files written to/.test(dtxt) && !/not written/.test(dtxt), dtxt)
      await sleep(500)
      const bim = JSON.parse(localStorage.getItem('thcad.bim') ?? '{}').state?.model
      const int = JSON.parse(localStorage.getItem('thcad.interior') ?? '{}').state?.doc
      check('the BIM workspace got the model (walls, doors, windows, rooms) and the Interior its rooms and furniture', bim?.walls?.length >= 7 && bim?.doors?.length >= 4 && bim?.rooms?.length >= 5 && int?.rooms?.length >= 5 && int?.items?.length > 0, `${bim?.walls?.length} walls, ${bim?.rooms?.length} rooms, ${int?.items?.length} items`)
      const cad = window.__thcad?.cad?.getState?.()
      const d = cad ? cad.docs[cad.activeId] : null
      if (d) check(`the recognised plan opened in CAD 2D (${calibrate ? 'calibrated' : 'REVIEW REQUIRED'})`, /sketch|plan/i.test(d.name) && !!d.provenance && d.provenance.reviewRequired === !calibrate, `${d.name} reviewRequired=${d.provenance?.reviewRequired}`)
      // the 3D of the built model
      const ob = byText('button', /^Open BIM 3D$/)
      check('"Open BIM 3D" offered after the build', !!ob)
      click(ob)
      await until(() => location.hash === '#/bim', 5000)
      await sleep(3000)
      await grab(`planimage_bim_${calibrate ? 'cal' : 'uncal'}_desktop.png`)
    }
    await run(false)
    await run(true)
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
