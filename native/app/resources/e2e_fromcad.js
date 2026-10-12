// BIM → Build from CAD plans in the desktop app: a real DWG ($THCAD_DWG_SAMPLE, read by the bundled LibreDWG
// helper) → layer roles (rules, then the local AI's suggestion) → recognised plans → Approve & build → the OCCT
// 3D model (walls with openings, slabs, columns, furniture), an elevation by hidden-line removal, and the
// Interior workspace (rooms, furniture, cabinets) with its native 3D scene.
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(150) } return null }
  const qa = '/Users/mac/Downloads/TH_AI_CAD_Studio_UI_Handoff_v1/th-ai-cad-studio/qa/fromcad/'
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  const btn = (txt, root = document) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === txt)
  const toasts = () => [...document.querySelectorAll('[aria-live=polite] button')].map((t) => t.textContent).join(' | ')
  const solids = () => /OCCT · (\d+) solids · build (\d+) ms/.exec(document.body.innerText)
  // the QA profile is left as it was found (other e2e scripts expect the sample model): stores saved here, put back at the end
  const saved = Object.fromEntries(['thcad.bim', 'thcad.interior'].map((k) => [k, localStorage.getItem(k)]))
  log(`QA profile at start: thcad.bim ${saved['thcad.bim']?.length ?? 'absent'}, thcad.interior ${saved['thcad.interior']?.length ?? 'absent'}`)
  try {
    const h = await window.thcadHostReady
    await until(() => document.querySelector('[role=radio]'))
    ;[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === 'EN')?.click()
    location.hash = '#/bim'
    await until(() => btn('More Tools'), 15000)
    btn('More Tools').click()
    await sleep(200)
    ;[...document.querySelectorAll('[role=menuitem]')].find((m) => m.textContent.trim() === 'Build from CAD plans…').click()
    const dlg = await until(() => document.querySelector('[data-testid=fromcad]'))
    const b64 = await h.qaSampleDwg()
    check('sample DWG readable', b64.length > 1000, String(b64.length))
    const file = new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'VILLA_150_MASTER.dwg')
    const input = dlg.querySelector('[data-testid=fromcad-file]')
    const dt = new DataTransfer()
    dt.items.add(file)
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    const plans = await until(() => /MẶT BẰNG TẦNG 3/.test(dlg.innerText) && dlg.querySelector('[aria-label="Plans in the drawing"]'), 60000)
    check('DWG read through LibreDWG; three floor plans found by their titles', !!plans, (plans?.innerText || dlg.innerText).slice(0, 300).replace(/\n/g, ' | '))
    const summary = () => document.querySelector('[data-testid=fromcad-summary]').innerText
    const s0 = summary()
    log('summary (rules): ' + s0.replace(/\n/g, ' | '))
    check('recognised: 4 levels, walls, doors, windows, rooms, columns, furniture', /^4 levels · \d+ walls · \d+ doors · \d+ windows · 4\d rooms · \d+ columns · \d+ furniture/.test(s0), s0)
    const p1 = plans.querySelector('tbody tr').innerText
    check('Tầng 1: 9 doors · 7 windows · 14 rooms (the ground truth of the test set)', /\d+ walls · 9 doors · 7 windows · 14 rooms/.test(p1), p1.replace(/\n/g, ' | '))
    await h.qaGrab(qa + 'villa150_dialog.png')

    // local AI suggestion (real model) — shown, marked "AI", never applied silently to the model
    btn('Suggest roles with AI', dlg).click()
    const st = await until(() => { const t = dlg.querySelector('[role=status]')?.textContent || ''; return /AI suggested|AI kept|failed|not loaded|Needs the desktop/.test(t) && t }, 300000)
    log('AI: ' + st)
    check('local AI answered (grammar-constrained layer roles)', !!st && /AI suggested|AI kept/.test(st), st || 'timeout')
    const role = (n) => dlg.querySelector(`select[aria-label="Role: ${n}"]`)?.value
    const keyRoles = { 'A-WALL-EXT': 'wall', 'A-WALL-INT': 'wall', 'A-DOOR': 'door', 'A-WINDOW': 'window', 'A-COLUMN': 'column', 'A-ROOM': 'room', 'A-FURN': 'furniture' }
    const wrong = Object.entries(keyRoles).filter(([n, r]) => role(n) !== r).map(([n]) => `${n}→${role(n)}`)
    check('after the AI suggestion the key layers keep their roles', !wrong.length, wrong.join(', ') || 'all kept')
    const aiRows = [...dlg.querySelectorAll('tbody tr')].filter((tr) => [...tr.querySelectorAll('span')].some((s) => s.textContent === 'AI')).map((tr) => `${tr.cells[0].textContent} → ${tr.querySelector('select').value}`)
    log(`layers marked AI: ${aiRows.join(', ') || 'none'}; summary now: ${summary().replace(/\n/g, ' | ')}`)

    dlg.querySelector('[data-testid=fromcad-interior]').click()
    await sleep(300)
    check('interior data from Tầng 1: rooms, furniture, cabinets', /Interior: 14 rooms · \d+ furniture items · [1-9]\d* cabinets/.test(summary()), summary())
    const s1 = summary()
    document.querySelector('[data-testid=fromcad-approve]').click()
    const built = await until(() => /Model built from VILLA_150_MASTER\.dwg/.test(toasts()) && toasts(), 10000)
    check('Approve & build: one undoable edit, toast with the counts', !!built, (built || toasts()).slice(0, 300))
    log('built: ' + s1.replace(/\n/g, ' | '))

    // native OCCT 3D of the built model
    await until(() => btn('Shaded'), 10000)
    btn('Shaded')?.click()
    const sm = await until(() => { const m = solids(); return m && +m[1] > 200 && m }, 90000)
    check('OCCT 3D: the building is built natively (walls with openings, slabs, columns, furniture)', !!sm, sm?.[0] || document.body.innerText.match(/OCCT[^\n]*/)?.[0] || 'no scene')
    await sleep(1500)
    await h.qaGrab(qa + 'villa150_3d_occt.png')
    btn('3D - Exterior')?.click()
    await sleep(2500)
    await h.qaGrab(qa + 'villa150_3d_exterior.png')

    // an elevation of the new model by hidden-line removal
    btn('South Elevation')?.click()
    const info = await until(() => { const t = document.querySelector('[data-testid=bim-drawing] span')?.textContent || ''; return /(\d+) edges · \d+ cut faces/.test(t) && t }, 60000)
    const edges = +(/(\d+) edges/.exec(info || '')?.[1] ?? 0)
    check('South Elevation of the built model (OCCT HLR)', edges > 100, info || 'timeout')
    await sleep(500)
    await h.qaGrab(qa + 'villa150_elevation_south.png')

    // Interior workspace with the imported rooms / furniture / cabinets
    location.hash = '#/interior'
    await until(() => btn('Shaded'), 10000)
    btn('Shaded')?.click()
    const im = await until(() => { const m = solids(); return m && +m[1] > 20 && m }, 90000)
    check('Interior 3D (native) from the imported rooms and furniture', !!im, im?.[0] || 'no scene')
    await sleep(1500)
    await h.qaGrab(qa + 'villa150_interior_3d.png')
    btn('Cut List')?.click()
    await sleep(600)
    const cut = document.body.innerText
    check('cut list holds the imported cabinets', /Wardrobe|TV cabinet/.test(cut), (cut.match(/Wardrobe[^\n]*/) || [''])[0])
  } catch (e) {
    fails++
    log('FAIL exception ' + e)
  }
  for (const [k, v] of Object.entries(saved)) {
    if (v === null) localStorage.removeItem(k)
    else localStorage.setItem(k, v)
  }
  // the stores would write the built model again on their next change: no more writes of these keys in this run
  const set = Storage.prototype.setItem
  Storage.prototype.setItem = function (k, v) { if (!(k in saved)) set.call(this, k, v) }
  await sleep(6000) // the runner kills the app after DONE: give Chromium time to write local storage to disk
  log(`QA profile restored: thcad.bim ${localStorage.getItem('thcad.bim')?.length ?? 'absent'}, thcad.interior ${localStorage.getItem('thcad.interior')?.length ?? 'absent'}`)
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
