// MEP elements drawn in the plan are built in the live OCCT 3D view; colour filter, visibility and a
// plan section line act on it.
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100) } return null }
  const qa = '/Users/mac/Downloads/TH_AI_CAD_Studio_UI_Handoff_v1/th-ai-cad-studio/qa/'
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  const btn = (txt) => [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === txt).pop()
  const frame = () => document.querySelector('[data-testid=native-scene] img')?.getAttribute('src') || ''
  const badge = () => document.querySelector('[data-testid=native-scene] [class*=badge]')?.textContent || ''
  const nextFrame = async (prev) => (await until(() => frame() && frame() !== prev && frame(), 10000)) || frame()
  try {
    const h = await window.thcadHostReady
    await until(() => window.__thcad?.mep)
    const M = window.__thcad.mep
    M.getState().reset()
    M.getState().edit('elements', (m) => ({
      ...m,
      trays: [{ id: 'tray-1', mark: 'TR-01', kind: 'Power', x: 1000, y: 8000, axis: 'x', length: 9000, elevation: 2400, level: 'L2', w: 300, h: 100 }],
      fixtures: [
        ...[2000, 4000, 6000].map((x, i) => ({ id: 'l-' + i, mark: 'L-0' + (i + 1), kind: 'Downlight', level: 'L2', x, y: 6000, elevation: 2700 })),
        { id: 'wc-1', mark: 'PF-01', kind: 'WC', level: 'L2', x: 12500, y: 10000, elevation: 0 },
        { id: 'b-1', mark: 'PF-02', kind: 'Basin', level: 'L2', x: 13500, y: 10000, elevation: 0 },
      ],
      terminals: [{ id: 'sd-1', mark: 'SD-01', kind: 'Supply Diffuser', level: 'L2', x: 3500, y: 4000, size: 600, flow: 150, elevation: 2700 }],
      fittings: [{ id: 'ft-1', mark: 'FT-01', kind: 'Cap', level: 'L2', x: 5000, y: 4000, on: 'SA-01-L2', runs: ['SA-01-L2'] }],
    }))
    ;[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === 'EN')?.click()
    location.hash = '#/mep'
    await sleep(600)
    M.getState().set({ view: 'coord', mode: 'shaded', colorBy: 'system', hiddenCats: [], section: null })
    let f = await nextFrame('')
    await sleep(1500); f = frame()
    const n0 = Number(/OCCT · (\d+) solids/.exec(badge())?.[1] ?? 0)
    check('the drawn tray, 5 fixtures, diffuser and fitting are built with the runs', n0 > 0, badge())
    await h.qaGrab(qa + 'mep_draw_3d.png')
    M.getState().set({ colorBy: 'velocity' })
    let g = await nextFrame(f); await sleep(800); g = frame()
    check('colour filter "By velocity" recolours the runs', g !== f)
    await h.qaGrab(qa + 'mep_draw_velocity.png')
    M.getState().set({ colorBy: 'system', hiddenCats: ['beams'] })
    f = await nextFrame(g); await sleep(800)
    const n1 = Number(/OCCT · (\d+) solids/.exec(badge())?.[1] ?? 0)
    check('Visibility: hiding beams removes them from the 3D scene', n1 > 0 && n1 < n0, `${n0} → ${n1}`)
    M.getState().set({ hiddenCats: [] })
    await sleep(800)
    M.getState().edit('section', (m) => ({ ...m, sections: [{ id: 'sec-1', mark: 'S-1', level: 'L2', a: [7000, 500], b: [7000, 11000] }] }))
    M.getState().set({ section: 'sec-1' })
    g = await nextFrame(frame()); await sleep(1500); g = frame()
    check('a plan section line cuts the 3D view to a slice and looks across it', g !== f && /Section box/.test(document.querySelector('[data-testid=scene-chips]')?.textContent || ''))
    await h.qaGrab(qa + 'mep_draw_section.png')
    btn('Remove section box')?.click()
    await sleep(500)
    check('removing the section box clears the plan section', M.getState().section === null)
    M.getState().reset()
  } catch (e) {
    fails++
    log('FAIL exception ' + e)
  }
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
