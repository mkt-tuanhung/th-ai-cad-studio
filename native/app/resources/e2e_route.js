// Civil → Route from CAD in the desktop app: a real canal DWG ($THCAD_DWG_SAMPLE, read by the bundled LibreDWG
// helper) → ground / design layers (rules, then the local AI's suggestion) → the long-profile route with all its
// cross sections, computed areas against the designer's → Approve & build → profile, drawn section, the OCCT 3D
// corridor lofted from the sections. The QA profile's Civil store is put back at the end.
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(150) } return null }
  const qa = '/Users/mac/Downloads/TH_AI_CAD_Studio_UI_Handoff_v1/th-ai-cad-studio/qa/fromcad/'
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  const btn = (txt, root = document) => [...root.querySelectorAll('button,[role=tab]')].find((b) => b.textContent.trim() === txt)
  const toasts = () => [...document.querySelectorAll('[aria-live=polite] button')].map((t) => t.textContent).join(' | ')
  const saved = localStorage.getItem('thcad.civil')
  try {
    const h = await window.thcadHostReady
    await until(() => document.querySelector('[role=radio]'))
    ;[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === 'EN')?.click()
    location.hash = '#/civil'
    await until(() => [...document.querySelectorAll('button')].find((b) => /More Tools/.test(b.textContent)), 15000)
    ;[...document.querySelectorAll('button')].find((b) => /More Tools/.test(b.textContent)).click()
    await sleep(200)
    ;[...document.querySelectorAll('[role=menuitem]')].find((m) => /Route from CAD/.test(m.textContent)).click()
    const dlg = await until(() => document.querySelector('[data-testid=routefromcad]'))
    const b64 = await h.qaSampleDwg()
    check('sample DWG readable', b64.length > 100000, String(b64.length))
    const file = new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'kenh_duc_phong.dwg')
    const input = dlg.querySelector('[data-testid=routefromcad-file]')
    const dt = new DataTransfer()
    dt.items.add(file)
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    const t0 = Date.now()
    const table = await until(() => dlg.querySelector('[data-testid=routefromcad-table]'), 120000)
    check('DWG read through LibreDWG; the long profile and the cross sections found', !!table, `${((Date.now() - t0) / 1000).toFixed(1)} s`)
    const routes = [...dlg.querySelectorAll('select[aria-label=Route] option')].map((o) => o.textContent)
    log('routes: ' + routes.join(' | '))
    check('two routes: Đức Phong 1 (33 / 33 sections) and Đức Phong 3 (27 / 27)', routes.length === 2 && /đức phong 1 · 33 \/ 33/.test(routes[0]) && /đức phong 3.* · 27 \/ 27/.test(routes[1]), routes.join(' | '))
    const summary = () => document.querySelector('[data-testid=routefromcad-summary]')?.innerText ?? '(no summary)'
    log('summary: ' + summary().replace(/\n/g, ' | '))
    check('volumes within 1 % of the designer’s areas', (() => { const m = /difference (-?[\d.]+) % \/ (-?[\d.]+) %/.exec(summary()); return m && Math.abs(+m[1]) < 1 && Math.abs(+m[2]) < 1 })(), summary())
    // local AI on the layers (real model) — suggestions only
    btn('Suggest with AI', dlg).click()
    const st = await until(() => { const t = dlg.querySelector('[role=status]')?.textContent || ''; return /AI suggested|AI kept|failed|not loaded/.test(t) && t }, 480000)
    log('AI: ' + st)
    check('local AI answered (grammar-constrained ground / design roles)', !!st && /AI suggested|AI kept/.test(st), st || 'timeout')
    const role = (n) => dlg.querySelector(`select[aria-label="Ground and design lines: ${n}"]`)?.value
    const keys = { 'Mat dat tu nhien': 'ground', Thietke: 'design' }
    const wrong = Object.entries(keys).filter(([n, r]) => role(n) !== r).map(([n]) => `${n}→${role(n)}`)
    check('after the AI suggestion the section ground / design layers keep their roles', !wrong.length, wrong.join(', ') || 'kept')
    await until(() => dlg.querySelector('[data-testid=routefromcad-table]'), 120000)
    log('summary after AI: ' + summary().replace(/\n/g, ' | '))
    await h.qaGrab(qa + 'route_kenh_dialog.png')
    document.querySelector('[data-testid=routefromcad-approve]').click()
    const built = await until(() => /Route .* built/.test(toasts()) && toasts(), 15000)
    check('Approve & build: one undoable Civil edit', !!built, (built || toasts()).slice(0, 240))
    await sleep(800)
    await h.qaGrab(qa + 'route_kenh_profile.png')
    btn('Section')?.click()
    await sleep(800)
    const sec = document.querySelector('[data-testid=section-chart]')
    check('Section view shows the drawn section with computed and designer areas', !!sec && /Computed: cut/.test(sec.innerHTML) && /Designer: cut/.test(sec.innerHTML), sec?.getAttribute('data-section') || 'none')
    await h.qaGrab(qa + 'route_kenh_section.png')
    btn('3D')?.click()
    const m3 = await until(() => { const m = /OCCT · (\d+) solids · build (\d+) ms/.exec(document.body.innerText); return m && +m[1] > 0 && m }, 120000)
    const stats = document.querySelector('[data-testid=civil-3d-stats]')?.textContent || ''
    check('OCCT 3D corridor lofted from the drawn sections', !!m3 && /33 sections|33 /.test(stats), `${m3?.[0] ?? 'no scene'} · ${stats}`)
    await sleep(1500)
    await h.qaGrab(qa + 'route_kenh_3d.png')
  } catch (e) {
    fails++
    log('FAIL exception ' + e)
  }
  if (saved === null) localStorage.removeItem('thcad.civil')
  else localStorage.setItem('thcad.civil', saved)
  const set = Storage.prototype.setItem
  Storage.prototype.setItem = function (k, v) { if (k !== 'thcad.civil') set.call(this, k, v) }
  await sleep(6000)
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
