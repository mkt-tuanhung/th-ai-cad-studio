// AI Studio chat with the local model: a question gets a grounded written answer; a drawing change goes to the
// edit pipeline (pending proposal).
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(250) } return null }
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  const ask = async (text) => {
    const input = document.querySelector('input[aria-label^="Ask"], form input[class*=input]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await sleep(150)
    document.querySelector('button[type=submit][aria-label]').click()
    await sleep(500)
    const S = window.__thcad.aiStudio
    const last = await until(() => { const t = S.getState().turns.at(-1); return t && t.role === 'assistant' && !t.pending && t }, 240000)
    return last
  }
  try {
    await window.thcadHostReady
    ;[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === 'EN')?.click()
    location.hash = '#/ai-studio'
    await until(() => window.__thcad?.aiStudio && document.querySelector('form input'))
    window.__thcad.aiStudio.getState().newChat()
    await sleep(300)
    const a = await ask('How many walls and levels does the BIM model of this project have?')
    // the count the model must report is the one of the open BIM model (other QA runs may have added walls)
    const nWalls = window.__thcad.bim.getState().model.walls.length, nLevels = window.__thcad.bim.getState().model.levels.length
    check(`a question gets a written answer grounded in the project (${nWalls} walls, ${nLevels} levels)`, !!a && new RegExp(`\\b${nWalls}\\b`).test(a.text) && new RegExp(`\\b${nLevels}\\b|four|five`, 'i').test(a.text) && !a.proposal, a?.text?.slice(0, 300) + ' | ' + a?.stats)
    const b = await ask('Draw a line from 0,0 to 5000,0 on layer 0')
    check('a drawing change becomes a pending proposal', !!b && !!b.proposal && b.proposal.status === 'pending', b?.text?.slice(0, 200) + ' | ' + b?.stats + ' | doc ' + !!window.__thcad.cad?.getState().activeDoc())
    const c = await ask('Tường dày 200 mm thì thể tích của bức tường dài 4 m cao 3 m là bao nhiêu?')
    check('Vietnamese question answered in Vietnamese with 2.4 m³', !!c && /\b2[,.]4\b(?!\d)/.test(c.text) && /thể tích|tường|là/i.test(c.text) && !c.proposal, c?.text?.slice(0, 300))
  } catch (e) {
    fails++
    log('FAIL exception ' + e)
  }
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
