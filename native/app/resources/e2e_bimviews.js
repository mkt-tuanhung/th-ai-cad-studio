// BIM Project Browser in the desktop app: elevations and sections are 2D drawings made by the OCCT kernel
// (hidden-line removal; sections with cut faces), annotated from the model and shown as an A3 1:100 sheet;
// "3D view" puts the orthographic camera on that side; "Open in CAD 2D" gives an editable drawing with
// its layout, which exports to DWG with that layout (THCAD_DWG_OUT skips the dialog).
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100) } return null }
  const qa = '/Users/mac/Downloads/TH_AI_CAD_Studio_UI_Handoff_v1/th-ai-cad-studio/qa/'
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  const btn = (txt, root = document) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === txt)
  const toasts = () => [...document.querySelectorAll('[aria-live=polite] button')].map((t) => t.textContent).join(' | ')
  const dir = (c) => { const d = [c.eye[0] - c.at[0], c.eye[1] - c.at[1], c.eye[2] - c.at[2]]; const l = Math.hypot(...d); return d.map((x) => Math.round((x / l) * 100) / 100) }
  const info = () => document.querySelector('[data-testid=bim-drawing] span')?.textContent || ''
  const drawn = async (prev) => until(() => /edges · \d+ cut faces/.test(info()) && info() !== prev && info(), 30000)
  try {
    const h = await window.thcadHostReady
    await until(() => document.querySelector('[role=radio]'))
    ;[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === 'EN')?.click()
    location.hash = '#/bim'
    await until(() => btn('South Elevation'), 15000)
    let last = ''
    for (const name of ['South Elevation', 'East Elevation', 'North Elevation', 'West Elevation']) {
      btn(name).click()
      last = await drawn(last)
      const m = /(\d+) edges · (\d+) cut faces · (\d+) ms/.exec(last || '')
      check(`${name}: 2D drawing by hidden-line removal`, !!m && +m[1] > 40 && +m[2] === 0 && !!document.querySelector('[data-testid=bim-drawing-sheet] svg'), last || 'timeout')
      if (name === 'South Elevation') {
        const svg = document.querySelector('[data-testid=bim-drawing-sheet]').innerHTML
        check('annotated: level names and elevations, dimensions, title', /Level 1/.test(svg) && /±0\.000/.test(svg) && /\+3\.000/.test(svg) && /SOUTH ELEVATION/.test(svg) && /13[ ,.]?800|14[ ,.]?000/.test(svg), '')
        await sleep(400)
        await h.qaGrab(qa + 'bim_elevation_south_2d.png')
      }
    }
    btn('Section 1').click()
    last = await drawn(last)
    const s1 = /(\d+) edges · (\d+) cut faces/.exec(last || '')
    check('Section 1: cut faces (walls, slabs) are filled', !!s1 && +s1[2] >= 8, last || 'timeout')
    await sleep(400)
    await h.qaGrab(qa + 'bim_section_1_2d.png')
    btn('Section 2').click()
    last = await drawn(last)
    check('Section 2 drawn', /cut faces/.test(last || ''), last || '')
    // 3D view of the same side
    btn('3D view').click()
    await until(() => document.querySelector('img[alt="Villa Riverside — live OCCT model"]')?.src, 20000)
    await sleep(1500)
    const c = await h.scene3dCommand('bim', JSON.stringify({ cmd: 'getCamera' }))
    check('3D view: Section 2 seen from the west', JSON.stringify(dir(c)) === JSON.stringify([-1, 0, 0]), JSON.stringify(dir(c)))
    // sheet → drawing, then CAD 2D
    btn('A201 - Elevations').click()
    last = await drawn('')
    check('sheet A201 shows the South Elevation drawing', /South Elevation/.test(document.querySelector('[data-testid=bim-drawing] b')?.textContent || '') && /A201 - Elevations shows South Elevation/.test(toasts()))
    btn('Open in CAD 2D').click()
    await until(() => location.hash === '#/cad2d')
    await sleep(800)
    const d = window.thcadActiveDoc()
    const kinds = d.entities.reduce((a, e) => ((a[e.kind] = (a[e.kind] ?? 0) + 1), a), {})
    check('CAD 2D drawing: elevation lines, level texts, dimensions; layout A3 1:100', d.name === 'Villa Riverside - South Elevation.dwg' && kinds.dimension >= 3 && kinds.text >= 6 && d.layouts?.[0]?.paper === 'A3' && d.layouts?.[0]?.scale === 100, JSON.stringify(kinds))
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Export').click()
    await sleep(200)
    ;[...document.querySelectorAll('[role=menuitem]')].find((b) => /^DWG/.test(b.textContent.trim())).click()
    const msg = await until(() => toasts().match(/saved \(AutoCAD 2000\) — read back: \d+ entities, \d+ layers, \d+ layouts/)?.[0], 60000)
    check('DWG of the elevation with its layout', !!msg && /, 1 layouts/.test(msg), msg || toasts())
  } catch (e) {
    fails++
    log('FAIL exception ' + e)
  }
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
