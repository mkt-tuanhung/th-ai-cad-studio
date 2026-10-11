// End-to-end: BIM 3D slot shows the live OCCT model with web overlays on top.
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100) } return null }
  const qa = '/Users/mac/Downloads/TH_AI_CAD_Studio_UI_Handoff_v1/th-ai-cad-studio/qa/'
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  const btn = (txt) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === txt)
  const frame = () => document.querySelector('img[alt="Villa Riverside — live OCCT model"]')?.getAttribute('src') || ''
  const nextFrame = async (prev) => (await until(() => frame() && frame() !== prev && frame(), 8000)) || frame()
  try {
    const h = await window.thcadHostReady
    await until(() => document.querySelector('[role=radio]'))
    ;[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === 'EN')?.click()
    location.hash = '#/bim'
    const tab3d = await until(() => [...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.trim() === '3D'))
    tab3d.click()
    await until(() => btn('Realistic'))
    btn('Realistic').click()
    await sleep(300)
    check('Realistic keeps the approved render', !!document.querySelector('img[alt="Villa Riverside — 3D section view"]'))
    btn('Shaded').click()
    let f = await nextFrame('')
    check('Shaded shows a live OCCT frame (JPEG from the engine)', f.startsWith('data:image/jpeg;base64,') && f.length > 20000, (f.length / 1024).toFixed(0) + ' KB')
    check('web overlays stay on top (plan preview, level bar, modes visible)', !!document.querySelector('[class*=planHead]') && !!btn('Wireframe') && !!document.querySelector('select[aria-label="Level"]'))
    await sleep(300); await h.qaGrab(qa + 'native_bim3d_shaded.png')
    btn('Wireframe').click()
    let g = await nextFrame(f)
    check('Wireframe re-renders', g !== f)
    btn('Hidden Line').click()
    let k = await nextFrame(g)
    check('Hidden Line re-renders (HLR)', k !== g)
    await sleep(300); await h.qaGrab(qa + 'native_bim3d_hidden.png')
    btn('Shaded').click(); f = await nextFrame(k)
    btn('TOP').click()
    const top = await nextFrame(f)
    check('view cube TOP changes the camera', top !== f)
    btn('FRONT').click(); await nextFrame(top)
    document.querySelector('button[aria-label="Home view"]').click()
    const home = await nextFrame(frame())
    // selecting a wall highlights it
    ;[...document.querySelectorAll('[role=row]')].find((r) => r.textContent.includes('W7'))?.click()
    const sel = await nextFrame(home)
    check('selecting W7 in the schedule highlights it in the 3D model', sel !== home)
    // model edit (Top Level of W1 → Level 3) → solids rebuilt; then undo
    ;[...document.querySelectorAll('[role=row]')].find((r) => /^\s*W1Generic/.test(r.textContent) || r.textContent.trim().startsWith('W1G'))?.click()
    await sleep(300)
    const before = frame()
    document.querySelector('button[aria-label="Edit Top Level"]').click()
    const selEl = await until(() => [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === 'L3') && x.closest('[class*=value]')))
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    setter.call(selEl, 'L3')
    selEl.dispatchEvent(new Event('change', { bubbles: true }))
    const after = await nextFrame(before)
    check('editing W1 Top Level → Level 3 rebuilds the OCCT solids', after !== before)
    await sleep(300); await h.qaGrab(qa + 'native_bim3d_edited.png')
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }))
    const undone = await nextFrame(after)
    check('⌘Z restores the model and the 3D view', undone !== after)
    await sleep(300); await h.qaGrab(qa + 'native_bim3d_selected.png')
    const ms = document.querySelector('[class*=badge]')?.textContent
    log('render time ' + ms)
    btn('Realistic').click()
    await sleep(300)
  } catch (e) {
    fails++
    log('FAIL exception ' + e)
  }
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
