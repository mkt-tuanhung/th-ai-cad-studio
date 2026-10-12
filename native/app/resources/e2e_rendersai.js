// AI Variations: the local model proposes lighting variations, approval adds them and queues thumbnails.
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(250) } return null }
  const qa = '/Users/mac/Downloads/TH_AI_CAD_Studio_UI_Handoff_v1/th-ai-cad-studio/qa/'
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  const btn = (txt) => [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === txt).pop()
  try {
    const h = await window.thcadHostReady
    ;[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === 'EN')?.click()
    location.hash = '#/renders'
    await until(() => window.__thcad?.renders)
    const R = window.__thcad.renders
    R.getState().edit('clear', (d) => ({ ...d, queue: [], custom: [] }))
    R.getState().set({ camera: 'cam3', mode: 'rendered', tab: 'studio' })
    await sleep(400)
    btn('AI Variations').click()
    const box = await until(() => document.querySelector('[role=dialog] textarea, [role=dialog] input[type=text]'))
    const setter = Object.getOwnPropertyDescriptor(box.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set
    setter.call(box, 'Two lighting variations: golden hour and a cool night')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await sleep(200)
    const send = [...document.querySelectorAll('[role=dialog] button')].find((b) => /Send/.test(b.getAttribute('aria-label') || b.textContent))
    send.click()
    const approve = await until(() => btn('Approve & Apply'), 240000)
    check('the local model proposes variations (pending approval)', !!approve, document.querySelector('[role=dialog]')?.textContent?.slice(0, 300))
    if (approve) {
      approve.click()
      await sleep(800)
      const custom = R.getState().doc.custom ?? []
      check('approved variations join the strip', custom.length >= 1, custom.map((v) => `${v.name} ${v.sky} ${v.sunAzimuth}/${v.sunElevation} T${v.temperature}`).join(' · '))
      const thumbs = await until(() => (R.getState().doc.custom ?? []).every((v) => v.preview), 240000)
      check('each variation gets a rendered thumbnail', !!thumbs)
      ;[...document.querySelectorAll('[role=dialog] button')].find((b) => b.getAttribute('aria-label') === 'Close')?.click()
      await sleep(500)
      await h.qaGrab(qa + 'renders_ai_variations.png')
    }
  } catch (e) {
    fails++
    log('FAIL exception ' + e)
  }
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
