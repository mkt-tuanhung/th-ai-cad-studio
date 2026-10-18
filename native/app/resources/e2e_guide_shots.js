// Install-guide screenshots of desktop-only screens (local AI settings) in Vietnamese. Run with an empty
// THCAD_MODELS_DIR so the screens look like a fresh install: qa/tools/rune2e.sh <this> 120 THCAD_MODELS_DIR=<empty>
// THCAD_GUIDE_OUT is read by the page through the out-folder constant below (edit for another folder).
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(200) } return null }
  const out = '/private/tmp/claude-501/-Users-mac-Downloads-TH-AI-CAD-Studio-UI-Handoff-v1/aa7cf3d6-234f-4ab3-89a4-30970fddf811/scratchpad/guide/shots/'
  const h = await window.thcadHostReady
  await until(() => document.querySelector('[role=radio]'))
  ;[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === 'VI')?.click()
  location.hash = '#/settings'
  const box = await until(() => document.querySelector('[data-testid=model-download]'))
  await sleep(1200)
  box?.scrollIntoView({ block: 'center' })
  await sleep(400)
  await h.qaGrab(out + '30_settings_ai.png')
  const m = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Quản lý mô hình')
  m?.click()
  await sleep(1200)
  await h.qaGrab(out + '31_manage_models.png')
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(500)
  const perf = [...document.querySelectorAll('section')].find((s) => /Hiệu năng/.test(s.getAttribute('aria-label') || ''))
  perf?.scrollIntoView({ block: 'center' })
  await sleep(600)
  await h.qaGrab(out + '32_settings_performance.png')
  log('DONE OK')
})()
