// End-to-end: CAD 2D screen ⇄ native C++ command bus (THCAD_QA=1 THCAD_SCRIPT=…/e2e_cad.js).
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100) } return null }
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  try {
    const h = await window.thcadHostReady
    await until(() => document.querySelector('[role=radio]'))
    ;[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === 'EN')?.click()
    location.hash = '#/cad2d'
    const input = await until(() => document.querySelector('input[aria-label="Type a command or use AI..."]'))
    await until(() => window.thcadSyncStats && window.thcadSyncStats.loads > 0)
    const local = () => window.thcadActiveDoc()
    const native = () => h.cadDocument()
    const settle = async () => { await sleep(250) }
    const cmd = async (...lines) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      for (const l of lines) {
        setter.call(input, l)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await sleep(60)
      }
      await settle()
    }
    const same = async (name) => {
      const l = local(), n = await native()
      const ln = l.entities.length, nn = n.entities.length
      const ids = (xs) => xs.map((e) => e.id).sort().join(',')
      check(name, ln === nn && ids(l.entities) === ids(n.entities), `UI ${ln} · engine ${nn}`)
    }
    await same('engine starts with the open drawing')
    await cmd('L', '0,0', '@3000,0', '@0,2000', '')
    await same('LINE (2 segments) mirrored to the engine')
    const nl = (await native()).entities.filter((e) => e.kind === 'line').at(-1)
    check('engine geometry equals UI geometry (last segment ends at 3000,2000)', nl && nl.b[0] === 3000 && nl.b[1] === 2000)
    await cmd('REC', '5000,5000', '@1200,800')
    await same('RECTANG mirrored')
    await cmd('U')
    await same('UNDO mirrored')
    await cmd('REDO')
    await same('REDO mirrored')
    const before = local().entities.length
    await cmd('C', '1000,1000', '250')
    await same('CIRCLE on unlocked layer accepted')
    log('stats ' + JSON.stringify(window.thcadSyncStats) + ' · current layer ' + local().currentLayer + ' · count before ' + before)
    // engine-only lock on the CURRENT layer: the UI does not know → engine must reject, UI must roll back
    const cur = local().currentLayer
    await h.cadExecute(JSON.stringify({ type: 'layerProps', name: cur, locked: true }))
    const n0 = local().entities.length, r0 = window.thcadSyncStats.rejected
    await cmd('C', '2000,2000', '300')
    await sleep(300)
    check('engine rejects a circle on its locked layer ' + cur, window.thcadSyncStats.rejected === r0 + 1, window.thcadSyncStats.lastError || '')
    check('UI rolled the optimistic commit back', local().entities.length === n0, `UI ${local().entities.length} · before ${n0}`)
    await same('UI and engine agree after the rejection')
    await h.cadExecute(JSON.stringify({ type: 'layerProps', name: cur, locked: false }))
    // new drawing tab → engine re-seeded with the blank document
    document.querySelector('button[aria-label="New drawing"]').click()
    await sleep(500)
    await same('new drawing tab re-seeds the engine')
    await cmd('C', '0,0', '100')
    await same('drawing in the new tab mirrored')
    await h.qaGrab('/Users/mac/Downloads/TH_AI_CAD_Studio_UI_Handoff_v1/th-ai-cad-studio/qa/native_cad2d_sync.png')
    log('stats ' + JSON.stringify(window.thcadSyncStats))
  } catch (e) {
    fails++
    log('FAIL exception ' + e)
  }
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
