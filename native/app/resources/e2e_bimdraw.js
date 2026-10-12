// BIM elements drawn in the plan (columns, roof, stair, railing, curtain wall, component, new walls) are
// built as exact OCCT solids in the live 3D view.
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
    await until(() => window.__thcad?.bim)
    const st = window.__thcad.bim.getState()
    st.reset()
    const add = (label, fn) => window.__thcad.bim.getState().edit(label, fn)
    add('elements', (m) => ({
      ...m,
      walls: [...m.walls, { id: 'W25', category: 'wall', mark: 'W25', typeId: 'CW100', baseLevel: 'L1', baseOffset: 0, topLevel: 'L2', topOffset: 0, length: 6000, x: 14800, y: 1500, angle: 90 }],
      columns: [0, 4600, 9200, 13800].map((x, i) => ({ id: 'col-' + i, category: 'column', mark: 'C' + (i + 1), level: 'L1', topLevel: 'L2', x, y: -2000, w: 400, d: 400 })),
      slabs: [
        { id: 'slab-1', category: 'slab', mark: 'S1', kind: 'floor', level: 'L2', offset: 0, thickness: 200, outline: [[-300, -2300], [14100, -2300], [14100, 0], [-300, 0]] },
        { id: 'slab-2', category: 'slab', mark: 'RF1', kind: 'roof', level: 'RF', offset: 0, thickness: 250, outline: [[600, 600], [13200, 600], [13200, 9200], [600, 9200]] },
      ],
      stairs: [{ id: 'stair-1', category: 'stair', mark: 'ST1', baseLevel: 'L1', topLevel: 'L2', x: 10400, y: 5600, angle: 90, length: 3600, width: 1000 }],
      railings: [{ id: 'rail-1', category: 'railing', mark: 'R1', level: 'L2', pts: [[-300, -2300], [14100, -2300], [14100, 0]], height: 1100 }],
      components: [{ id: 'comp-1', category: 'component', mark: 'F1', name: 'Bench', level: 'L1', x: 6900, y: -1200, w: 2000, d: 500, h: 450, rot: 0 }],
    }))
    ;[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === 'EN')?.click()
    location.hash = '#/bim'
    await sleep(600)
    const tab3d = await until(() => [...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.trim() === '3D'))
    tab3d.click()
    await until(() => btn('Shaded'))
    btn('Shaded').click()
    let f = await nextFrame('')
    const sel = await until(() => document.querySelector('select[aria-label="3D - Section View"]'))
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'exterior')
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    f = await nextFrame(f); await sleep(1500); f = frame()
    const m = /OCCT · (\d+) solids/.exec(badge())
    check('the building + 10 drawn elements are built (curtain wall glass + frame, 4 columns, 2 slabs, stair, railing, component)', m && Number(m[1]) >= 24 + 10, badge())
    await h.qaGrab(qa + 'bim_draw_3d.png')
    window.__thcad.bim.getState().set({ selection: { category: 'stair', id: 'stair-1' } })
    await sleep(300)
    document.querySelector('button[aria-label="Isolate selection"]').click()
    const g = await nextFrame(f); await sleep(500)
    check('isolating the stair shows its 17 steps alone', g !== f && /Isolated — 1 shown/.test(document.querySelector('[data-testid=scene-chips]')?.textContent || ''))
    await h.qaGrab(qa + 'bim_draw_stair.png')
    btn('Show all')?.click()
    await sleep(500)
    window.__thcad.bim.getState().reset()
  } catch (e) {
    fails++
    log('FAIL exception ' + e)
  }
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
