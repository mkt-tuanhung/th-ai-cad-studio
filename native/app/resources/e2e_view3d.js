// End-to-end: 3D view side tools on the live OCCT scenes (isolate, hide, section box, zoom region, pan,
// walkthrough, exploded, snapshot) in Interior, MEP, Mechanical and BIM.
// Run: THCAD_SCRIPT=…/e2e_view3d.js THCAD_DOWNLOAD_DIR=<dir> (snapshots are saved there without a dialog).
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100) } return null }
  const qa = '/Users/mac/Downloads/TH_AI_CAD_Studio_UI_Handoff_v1/th-ai-cad-studio/qa/'
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  const btn = (txt) => [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === txt).pop()
  const aria = (l) => [...document.querySelectorAll(`button[aria-label="${l}"]`)].pop()
  const view = () => document.querySelector('[data-testid=native-scene]')
  const frame = () => view()?.querySelector('img')?.getAttribute('src') || ''
  const nextFrame = async (prev) => (await until(() => frame() && frame() !== prev && frame(), 8000)) || frame()
  const chips = () => document.querySelector('[data-testid=scene-chips]')?.textContent || ''
  const toastText = () => [...document.querySelectorAll('[role=status], [class*=toast]')].map((x) => x.textContent).join(' | ')
  const pointer = (type, x, y) => {
    const r = view().getBoundingClientRect()
    view().dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: r.left + x, clientY: r.top + y, pointerId: 1, button: 0, isPrimary: true }))
  }
  const drag = async (x0, y0, x1, y1) => { pointer('pointerdown', x0, y0); await sleep(30); pointer('pointermove', (x0 + x1) / 2, (y0 + y1) / 2); await sleep(30); pointer('pointermove', x1, y1); await sleep(30); pointer('pointerup', x1, y1) }
  const select = (label, value) => {
    const el = document.querySelector(`select[aria-label="${label}"]`)
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const LABEL = { '#/interior': 'Interior 3D view', '#/mep': 'MEP 3D view', '#/mechanical': 'Mechanical 3D view', '#/bim': 'Villa Riverside — live OCCT model' }
  const live = async (route) => {
    location.hash = route
    await sleep(600)
    await until(() => btn('Shaded'))
    btn('Shaded').click()
    await until(() => view()?.getAttribute('aria-label') === LABEL[route])
    return await nextFrame('')
  }
  try {
    const h = await window.thcadHostReady
    await until(() => document.querySelector('[role=radio]'))
    ;[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === 'EN')?.click()

    // ── Interior ──────────────────────────────────────────────────────────
    let f = await live('#/interior')
    await sleep(800); f = frame()
    check('Interior: live OCCT frame', f.startsWith('data:image/jpeg'))
    aria('Isolate').click(); await sleep(300)
    check('Interior: Isolate with nothing selected asks for a selection', /Select an element first/.test(toastText()))
    // click-pick the solid in the middle of the view, then isolate it
    { const r = view().getBoundingClientRect(); pointer('pointerdown', r.width / 2, r.height * 0.6); pointer('pointerup', r.width / 2, r.height * 0.6) }
    let g = await nextFrame(f)
    check('Interior: click picks the solid under the cursor (highlighted)', g !== f)
    f = g
    aria('Isolate').click()
    g = await nextFrame(f)
    check('Interior: Isolate keeps only the selection', g !== f && /Isolated — \d+ shown/.test(chips()), chips())
    await sleep(300); await h.qaGrab(qa + 'view3d_interior_isolate.png')
    btn('Show all').click(); f = await nextFrame(g)
    check('Interior: Show all brings everything back', !chips(), chips())
    aria('Section box').click(); g = await nextFrame(f)
    check('Interior: Section box clips the view (chip shown)', g !== f && /Section box/.test(chips()))
    await sleep(300); await h.qaGrab(qa + 'view3d_interior_section.png')
    btn('Remove section box').click(); f = await nextFrame(g)
    aria('Zoom region').click(); await sleep(100)
    check('Interior: Zoom region arms the tool', view().dataset.tool === 'zoomRegion')
    await drag(300, 200, 520, 360); g = await nextFrame(f)
    check('Interior: dragging a rectangle zooms into it and ends the tool', g !== f && view().dataset.tool === 'orbit')
    aria('Pan').click(); await sleep(100)
    await drag(400, 300, 300, 250); f = await nextFrame(g)
    check('Interior: Pan tool drags the view', f !== g && view().dataset.tool === 'pan')
    aria('Pan').click()
    aria('Snapshot').click()
    const snap = await until(() => /Snapshot saved/.test(toastText()) && toastText(), 15000)
    check('Interior: Snapshot saves a PNG at 2× the view', !!snap && /\(\d{3,4} × \d{3,4} px\)/.test(snap), (snap || toastText()).slice(0, 160))
    select('Camera', 'exploded'); g = await nextFrame(frame())
    await sleep(1500); g = frame()
    check('Interior: Exploded view rebuilds with furniture lifted and cabinets opened', g !== f)
    await h.qaGrab(qa + 'view3d_interior_exploded.png')
    select('Camera', 'walk'); await sleep(1500); f = frame()
    check('Interior: Walkthrough arms first-person mode', view().dataset.tool === 'walk' && !!document.querySelector('[data-testid=scene-tool-hint]'))
    await h.qaGrab(qa + 'view3d_interior_walk.png')
    view().dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true })); g = await nextFrame(f)
    check('Interior: W walks forward', g !== f)
    view().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); f = await nextFrame(g)
    check('Interior: ← turns left', f !== g)
    await sleep(300); await h.qaGrab(qa + 'view3d_interior_walk2.png')
    view().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(500)
    check('Interior: Esc leaves the walkthrough', view().dataset.tool === 'orbit' && document.querySelector('select[aria-label="Camera"]').value === 'perspective')

    // ── MEP ───────────────────────────────────────────────────────────────
    f = await live('#/mep'); await sleep(1500); f = frame()
    aria('Hide selected').click(); g = await nextFrame(f)
    check('MEP: Hide selected (SA-01-L2) hides it', g !== f && /1 hidden/.test(chips()), chips() + ' / ' + toastText() + ' / ' + (g !== f))
    btn('Show all').click(); f = await nextFrame(g)
    aria('Isolate').click(); g = await nextFrame(f)
    check('MEP: Isolate with nothing selected isolates the clashing elements', g !== f && /Isolated — \d+ shown/.test(chips()), chips())
    await sleep(300); await h.qaGrab(qa + 'view3d_mep_isolate.png')
    btn('Show all').click(); f = await nextFrame(g)
    aria('Section box').click(); g = await nextFrame(f)
    check('MEP: Section box around the clashes', g !== f && /Section box/.test(chips()))
    await sleep(300); await h.qaGrab(qa + 'view3d_mep_section.png')
    btn('Remove section box').click(); await nextFrame(g)

    // ── Mechanical ────────────────────────────────────────────────────────
    location.hash = '#/mechanical'; await sleep(600)
    ;[...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.trim() === 'Assembly')?.click()
    f = await live('#/mechanical'); await sleep(1500); f = frame()
    aria('Isolate').click(); g = await nextFrame(f)
    check('Mechanical: Isolate the casing', g !== f && /Isolated — 1 shown/.test(chips()), chips())
    await sleep(300); await h.qaGrab(qa + 'view3d_mech_isolate.png')
    btn('Show all').click(); f = await nextFrame(g)
    aria('Remove from view').click(); g = await nextFrame(f)
    check('Mechanical: Remove from view hides the casing (the BOM is unchanged)', g !== f && /1 hidden/.test(chips()) && !!document.body.textContent.match(/Bill of Materials \(24\)/))
    await sleep(300); await h.qaGrab(qa + 'view3d_mech_removed.png')
    btn('Show all').click(); await nextFrame(g)

    // ── BIM ───────────────────────────────────────────────────────────────
    location.hash = '#/bim'
    const tab3d = await until(() => [...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.trim() === '3D'))
    tab3d.click()
    f = await live('#/bim'); await sleep(1500); f = frame()
    check('BIM: live OCCT building in the shared scene engine (section view cut at Level 1 + 1.5 m)', f.startsWith('data:image/jpeg') && document.querySelector('select[aria-label="3D - Section View"]').value === 'section')
    await h.qaGrab(qa + 'view3d_bim_section.png')
    select('3D - Section View', 'exterior'); g = await nextFrame(f)
    check('BIM: Exterior shows the whole building', g !== f)
    await sleep(300); await h.qaGrab(qa + 'view3d_bim_exterior.png')
    aria('Isolate selection').click(); f = await nextFrame(g)
    check('BIM: Isolate selection (W1)', f !== g && /Isolated — 1 shown/.test(chips()), chips())
    await sleep(300); await h.qaGrab(qa + 'view3d_bim_isolate.png')
    btn('Show all').click(); g = await nextFrame(f)
    // click-pick on the live building selects the wall under the cursor
    const r = view().getBoundingClientRect()
    pointer('pointerdown', r.width / 2, r.height / 2); pointer('pointerup', r.width / 2, r.height / 2)
    await sleep(800)
    log('BIM pick → ' + JSON.stringify(document.querySelector('[class*=propTitle], [class*=PropertiesPanel] h3')?.textContent || ''))
    select('3D - Section View', 'section'); await nextFrame(g)
  } catch (e) {
    fails++
    log('FAIL exception ' + e)
  }
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
