// Civil 3D tab in the desktop app: corridor, terrain strip and culverts as an OCCT scene.
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100) } return null }
  const qa = '/Users/mac/Downloads/TH_AI_CAD_Studio_UI_Handoff_v1/th-ai-cad-studio/qa/'
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  const frame = () => document.querySelector('[data-testid=native-scene] img')?.getAttribute('src') || ''
  const badge = () => document.querySelector('[data-testid=native-scene] [class*=badge]')?.textContent || ''
  const nextFrame = async (prev) => (await until(() => frame() && frame() !== prev && frame(), 15000)) || frame()
  try {
    const h = await window.thcadHostReady
    ;[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === 'EN')?.click()
    location.hash = '#/civil'
    await sleep(800)
    ;[...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.trim() === '3D')?.click()
    let f = await nextFrame('')
    await sleep(1500); f = frame()
    check('3D corridor built by OCCT (terrain, banks, lining, water, 2 culverts)', /OCCT · 6 solids/.test(badge()), badge() + ' · ' + document.querySelector('[data-testid=civil-3d-stats]')?.textContent)
    await h.qaGrab(qa + 'civil_3d.png')
    const sel = document.querySelector('select[aria-label="Vertical exaggeration"]')
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, '10')
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    const g = await nextFrame(f)
    check('vertical exaggeration ×10 rebuilds the scene', g !== f)
    await sleep(800); await h.qaGrab(qa + 'civil_3d_ve10.png')
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, '3')
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    await sleep(800)
    ;[...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.trim() === 'Plan')?.click()
  } catch (e) {
    fails++
    log('FAIL exception ' + e)
  }
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
