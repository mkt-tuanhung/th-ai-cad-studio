// Components → AI Recommended: rule-based suggestions, then the local model re-ranks them.
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(250) } return null }
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  try {
    await window.thcadHostReady
    ;[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === 'EN')?.click()
    location.hash = '#/components'
    const tab = await until(() => [...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.trim() === 'AI Recommended'))
    tab.click()
    await sleep(500)
    const names = () => [...document.querySelectorAll('[class*=stripItems] article b')].map((b) => b.textContent)
    const before = names()
    check('rule-based suggestions from the project', before.length >= 3, before.join(', '))
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Rank with the local AI').click()
    const note = await until(() => /Ranked by the local model/.test(document.querySelector('[data-testid=ai-rec-note]')?.textContent || '') && document.querySelector('[data-testid=ai-rec-note]').textContent, 120000)
    check('the local model re-ranks them', !!note, (note || '') + ' → ' + names().join(', '))
  } catch (e) {
    fails++
    log('FAIL exception ' + e)
  }
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
