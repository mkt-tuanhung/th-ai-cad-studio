// Interior elevations / sections from the browser: full-height walls, clip planes and a camera on the cut.
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100) } return null }
  const qa = '/Users/mac/Downloads/TH_AI_CAD_Studio_UI_Handoff_v1/th-ai-cad-studio/qa/'
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  const frame = () => document.querySelector('[data-testid=native-scene] img')?.getAttribute('src') || ''
  const nextFrame = async (prev) => (await until(() => frame() && frame() !== prev && frame(), 15000)) || frame()
  try {
    const h = await window.thcadHostReady
    ;[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === 'EN')?.click()
    location.hash = '#/interior'
    await until(() => window.__thcad?.interior)
    const I = window.__thcad.interior
    I.getState().set({ plan: null, view: 'perspective', mode: 'shaded', cut: null })
    let f = await nextFrame('')
    await sleep(1000); f = frame()
    for (const cut of ['elev-living', 'elev-kitchen', 'sec-a', 'sec-b']) {
      I.getState().set({ cut })
      const g = await nextFrame(f)
      await sleep(1500)
      check(`${cut}: clipped view with its label`, g !== f && !!document.querySelector('[data-testid=interior-cut]') && /Section box/.test(document.querySelector('[data-testid=scene-chips]')?.textContent || ''), document.querySelector('[data-testid=interior-cut]')?.textContent)
      await h.qaGrab(qa + `interior_${cut}.png`)
      f = frame()
    }
    I.getState().set({ cut: null })
    await sleep(800)
  } catch (e) {
    fails++
    log('FAIL exception ' + e)
  }
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
