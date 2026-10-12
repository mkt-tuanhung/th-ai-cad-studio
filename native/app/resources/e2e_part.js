// Part Studio in the desktop app: the feature tree is built by OCCT, volume / mass come from the exact
// solid, a failing feature is reported in the tree, STEP export of the part.
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100) } return null }
  const qa = '/Users/mac/Downloads/TH_AI_CAD_Studio_UI_Handoff_v1/th-ai-cad-studio/qa/'
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  const text = (id) => document.querySelector(`[data-testid=${id}]`)?.textContent || ''
  const frame = () => document.querySelector('[data-testid=native-scene] img')?.getAttribute('src') || ''
  const nextFrame = async (prev) => (await until(() => frame() && frame() !== prev && frame(), 10000)) || frame()
  try {
    const h = await window.thcadHostReady
    ;[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === 'EN')?.click()
    location.hash = '#/mechanical'
    await sleep(800)
    const partTab = await until(() => [...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.trim() === 'Part'))
    partTab.click()
    await until(() => /mm³/.test(text('part-volume')), 15000)
    const vol = Number(text('part-volume').replace(/[^\d.]/g, ''))
    check('the bracket is built by OCCT: volume = 122,156.9 mm³ (exact, as the native unit test)', Math.abs(vol - 122156.9) < 0.2, text('part-volume'))
    check('mass = volume × AISI 1045 density 7,850 kg/m³ = 0.959 kg', text('part-mass') === '0.959 kg', text('part-mass'))
    await sleep(500)
    await h.qaGrab(qa + 'part_bracket_3d.png')
    // break it: fillet R20 on the vertical edges cannot fit a 12 mm plate's corners next to holes
    const M = window.__thcad?.mech
    if (M) {
      const st = M.getState()
      const p = st.doc.parts.find((x) => x.id === st.activePart)
      st.edit('bad fillet', (m) => ({ ...m, parts: m.parts.map((x) => (x.id === p.id ? { ...x, features: [...x.features, { id: 'fbad', name: 'Fillet 9 — R80', kind: 'fillet', edges: 'vertical', r: 80 }] } : x)) }))
      await until(() => document.querySelector('[data-testid=feature-fbad]')?.className.includes('bad'), 15000)
      check('a failing fillet is marked in the tree with the kernel reason; the part keeps the previous body', /does not fit/.test(document.querySelector('[data-testid=feature-fbad]')?.textContent || '') && Math.abs(Number(text('part-volume').replace(/[^\d.]/g, '')) - 122156.9) < 0.2, document.querySelector('[data-testid=feature-fbad]')?.textContent)
      await h.qaGrab(qa + 'part_bracket_error.png')
      st.undo()
      await sleep(1500)
    } else check('test hook', false, 'window.__thcad.mech missing')
    const r = await h.scene3dExportStep('mechpart', 'Bearing_Bracket.step')
    check('STEP export of the part', r.ok && r.bytes > 10000, JSON.stringify(r))
  } catch (e) {
    fails++
    log('FAIL exception ' + e)
  }
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
