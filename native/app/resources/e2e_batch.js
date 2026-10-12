// Dashboard → Batch Process Files in the desktop app: a real DWG ($THCAD_DWG_SAMPLE) and a DXF are
// converted to PDF + DXF + DWG + PNG in the folder $THCAD_PICK_DIR (the folder dialog is skipped). Run it
// twice into the same folder: the second run must not overwrite (“name (2).ext”).
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100) } return null }
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  const btn = (root, label) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
  try {
    const h = await window.thcadHostReady
    await until(() => document.querySelector('[role=radio]'))
    ;[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === 'EN')?.click()
    location.hash = '#/dashboard'
    const b64 = await h.qaSampleDwg()
    check('sample DWG readable', b64.length > 1000, String(b64.length))
    const dwg = new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'Sample.dwg')
    const dxf = new File([['0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '5000', '21', '3000', '0', 'CIRCLE', '8', '0', '10', '2500', '20', '1500', '40', '800', '0', 'ENDSEC', '0', 'EOF'].join('\n')], 'Small.dxf')
    for (const pass of [1, 2]) {
      btn(document, 'Batch Process Files').click()
      const dlg = await until(() => document.querySelector('[role=dialog][aria-label="Batch Process Files"]'))
      const input = dlg.querySelector('input[type=file]')
      const dt = new DataTransfer()
      dt.items.add(dwg)
      dt.items.add(dxf)
      input.files = dt.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await sleep(200)
      for (const l of ['DXF', 'DWG (AutoCAD 2000)', 'PNG (200 dpi)']) {
        const cb = [...dlg.querySelectorAll('label')].find((x) => x.textContent.trim() === l)?.querySelector('input')
        if (cb && !cb.checked) cb.click()
      }
      btn(dlg, 'Choose folder…').click()
      await sleep(300)
      btn(dlg, 'Run batch').click()
      const done = await until(() => /Batch finished/.test(dlg.textContent) && dlg.textContent.match(/Batch finished[^\n]*converted/)?.[0], 90000)
      const res = dlg.querySelector('[data-testid=batch-results]')?.innerText || ''
      log(res.replace(/\n/g, ' | '))
      check(`run ${pass}: both drawings converted to 4 formats`, done === 'Batch finished: 2 of 2 file(s) converted', done || 'timeout')
      if (pass === 2) check('second run into the same folder writes “(2)” copies, nothing is overwritten', /Sample \(2\)\.pdf/.test(res) && /Small \(2\)\.dwg/.test(res), res)
      dlg.querySelector('button[aria-label=Close]').click()
      await sleep(300)
    }
  } catch (e) {
    fails++
    log('FAIL exception ' + e)
  }
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
