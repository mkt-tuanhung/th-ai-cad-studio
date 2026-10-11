// End-to-end: real local model through the real UI (THCAD_QA=1 THCAD_SCRIPT=…/e2e_ai.js).
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(150) } return null }
  const btn = (label) => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.textContent.trim()) === label)
  const activeDoc = () => window.thcadActiveDoc()
  let fails = 0
  const check = (name, ok) => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name) }
  try {
    const host = await window.thcadHostReady
    await until(() => document.querySelector('[role=radio]'))
    ;[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === 'EN')?.click()  // labels below are EN
    await sleep(200)
    const shots = (window.__E2E_SHOTS = '/Users/mac/Downloads/TH_AI_CAD_Studio_UI_Handoff_v1/th-ai-cad-studio/qa/')
    const st = await host.localAiStatus()
    log('model ' + st.modelName + ' · ' + st.vramUsedGb.toFixed(2) + '/' + Math.round(st.vramTotalGb) + ' GB')
    check('local model loaded and ready', st.ready && st.online)
    location.hash = '#/cad2d'
    await sleep(800)
    const isTarget = (e) => e.kind === 'circle' && e.layer === 'A-Furniture' && Math.abs(e.r - 600) < 1 && Math.abs(e.c.x - 3000) < 1 && Math.abs(e.c.y - 3000) < 1
    const before = activeDoc().entities.length
    const targetsBefore = activeDoc().entities.filter(isTarget).length
    location.hash = '#/ai-studio'
    await until(() => document.querySelector('input[aria-label="Ask or describe your CAD task..."]'))
    btn('New Chat').click()  // clean conversation: no stale buttons from earlier runs
    await sleep(200)
    check('no approve button before sending', ![...document.querySelectorAll('[data-source] button')].some((b) => b.textContent.trim() === 'Approve & Apply'))
    const input = document.querySelector('input[aria-label="Ask or describe your CAD task..."]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    const request = 'Vẽ đường tròn bán kính 600, tâm tại 3000,3000, trên layer A-Furniture.'
    setter.call(input, request)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await sleep(100)
    const t0 = performance.now()
    btn('Send').click()
    // the live proposal's button lives inside the chat list (the workspace below has its own one for the sample)
    await sleep(300)
    await until(() => !JSON.parse(localStorage.getItem('thcad.aiStudio')).state.turns.some((x) => x.pending), 40000)
    const last = JSON.parse(localStorage.getItem('thcad.aiStudio')).state.turns.at(-1)
    log('assistant turn: ' + last.text + (last.proposal ? ' · ops ' + JSON.stringify(last.proposal.ops) : ''))
    const approve = [...document.querySelectorAll('[data-source] button')].find((b) => b.textContent.trim() === 'Approve & Apply')
    const secs = ((performance.now() - t0) / 1000).toFixed(1)
    check('proposal shown in chat (' + secs + 's end to end)', !!approve)
    const after1 = activeDoc().entities.length
    check('drawing unchanged before approval', after1 === before)
    const card = [...document.querySelectorAll('[data-source] p')].map((p) => p.textContent).find((t) => t.startsWith('Proposal:'))
    log('chat says: ' + card)
    check('proposal reports exactly +1 entity', /^Proposal: \+1 \/ −0/.test(card || ''))
    await sleep(400)
    await host.qaGrab(shots + 'native_ai_live_proposal.png')
    approve.click()
    await sleep(600)
    const doc = activeDoc()
    check('approved: exactly one new entity, a circle r=600 at 3000,3000 on A-Furniture, in "' + doc.name + '"', doc.entities.length === before + 1 && doc.entities.filter(isTarget).length === targetsBefore + 1)
    await host.qaGrab(shots + 'native_ai_live_approved.png')
    location.hash = '#/cad2d'
    await sleep(1200)
    await host.qaGrab(shots + 'native_ai_live_cad2d.png')
    location.hash = '#/dashboard'
    await sleep(1200)
    const dash = document.body.innerText
    check('dashboard Local AI card shows the real model (' + st.modelName.split(' ')[0] + ') and a measured response speed', dash.includes(st.modelName.split(' ')[0]) && /Response Speed\s*\n?\s*\d+(\.\d)?s/.test(dash))
    await host.qaGrab(shots + 'native_dashboard_live_ai.png')
  } catch (e) {
    fails++
    log('FAIL exception ' + e)
  }
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
