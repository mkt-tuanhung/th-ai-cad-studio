// Settings → Local AI → Manage: with an empty models folder (THCAD_MODELS_DIR) the Whisper model is missing;
// Download fetches it (547 MB), the host checks its sha256 and Voice CAD then reports it ready.
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(200) } return null }
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  try {
    const h = await window.thcadHostReady
    await until(() => document.querySelector('[role=radio]'))
    ;[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === 'EN')?.click()
    location.hash = '#/settings'
    const manage = await until(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Manage Models'))
    manage.click()
    const box = await until(() => document.querySelector('[data-testid=speech-model]'))
    await until(() => /No Whisper model yet/.test(box.textContent))
    check('empty models folder → “No Whisper model yet”', /No Whisper model yet/.test(box.textContent), box.textContent)
    const t0 = Date.now()
    ;[...box.querySelectorAll('button')].find((b) => /Download Whisper/.test(b.textContent)).click()
    await until(() => /Downloading… \d+%/.test(box.textContent), 10000)
    check('progress is shown', /Downloading… \d+%/.test(box.textContent), box.textContent)
    await until(() => /Whisper large-v3-turbo/.test(box.textContent), 600000)
    check('downloaded, checksum verified, ready', /Whisper large-v3-turbo-q5_0 \(/.test(box.textContent), box.textContent)
    log('download ' + Math.round((Date.now() - t0) / 1000) + ' s')
    const st = await h.whisperStatus()
    check('whisperStatus available', st.available && st.modelBytes === 574041195, JSON.stringify(st))
  } catch (e) {
    fails++
    log('FAIL exception ' + e)
  }
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
