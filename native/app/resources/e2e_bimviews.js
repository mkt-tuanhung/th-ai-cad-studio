// BIM Project Browser in the desktop app: elevations put an orthographic camera on that side of the
// building, sections cut it with a clip plane through the centre, sheets open the view placed on them.
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100) } return null }
  const qa = '/Users/mac/Downloads/TH_AI_CAD_Studio_UI_Handoff_v1/th-ai-cad-studio/qa/'
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  const leaf = (txt) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === txt)
  const frame = () => document.querySelector('img[alt="Villa Riverside — live OCCT model"]')?.getAttribute('src') || ''
  const settle = async () => { let f = frame(); for (let i = 0; i < 20; i++) { await sleep(250); const g = frame(); if (g && g === f) return g; f = g } return f }
  const dir = (c) => { const d = [c.eye[0] - c.at[0], c.eye[1] - c.at[1], c.eye[2] - c.at[2]]; const l = Math.hypot(...d); return d.map((x) => Math.round((x / l) * 100) / 100) }
  try {
    const h = await window.thcadHostReady
    await until(() => document.querySelector('[role=radio]'))
    ;[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === 'EN')?.click()
    location.hash = '#/bim'
    await until(() => leaf('East Elevation'), 15000)
    const views = [['East Elevation', [1, 0, 0]], ['West Elevation', [-1, 0, 0]], ['North Elevation', [0, 1, 0]], ['South Elevation', [0, -1, 0]]]
    for (const [name, want] of views) {
      leaf(name).click()
      await until(() => frame(), 15000)
      await settle()
      const c = await h.scene3dCommand('bim', JSON.stringify({ cmd: 'getCamera' }))
      const d = dir(c)
      check(`${name}: camera looks from ${JSON.stringify(want)}`, d.every((x, i) => Math.abs(x - want[i]) < 0.02), JSON.stringify(d))
      if (name === 'South Elevation') await h.qaGrab(qa + 'bim_elevation_south.png')
    }
    const whole = await settle()
    leaf('Section 1').click()
    await sleep(500)
    const cut = await settle()
    const b = (await h.scene3dCommand('bim', JSON.stringify({ cmd: 'bounds' }))).bounds
    const c = await h.scene3dCommand('bim', JSON.stringify({ cmd: 'getCamera' }))
    check('Section 1: seen from the south, the picture changes (cut through the middle)', JSON.stringify(dir(c)) === JSON.stringify([0, -1, 0]) && cut !== whole, `bounds y ${b[1].toFixed(0)}…${b[4].toFixed(0)}`)
    check('the Section chip shows the cut is on', /Section/i.test(document.body.innerText))
    await h.qaGrab(qa + 'bim_section_1.png')
    leaf('Section 2').click()
    await sleep(500)
    await settle()
    const c2 = await h.scene3dCommand('bim', JSON.stringify({ cmd: 'getCamera' }))
    check('Section 2: seen from the west', JSON.stringify(dir(c2)) === JSON.stringify([-1, 0, 0]), JSON.stringify(dir(c2)))
    await h.qaGrab(qa + 'bim_section_2.png')
    leaf('A201 - Elevations').click()
    await sleep(800)
    await settle()
    const c3 = await h.scene3dCommand('bim', JSON.stringify({ cmd: 'getCamera' }))
    check('sheet A201 opens the South elevation', JSON.stringify(dir(c3)) === JSON.stringify([0, -1, 0]) && /A201 - Elevations shows South Elevation/.test(document.body.innerText))
  } catch (e) {
    fails++
    log('FAIL exception ' + e)
  }
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
