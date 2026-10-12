// Voice CAD with local Whisper in the desktop app. Run with Chromium's fake microphone playing a synthetic
// Vietnamese recording (macOS voice "Linh"):
//   QTWEBENGINE_CHROMIUM_FLAGS="--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<qa/fixtures/voice/vi_window_SYNTHETIC.wav>"
// The page records (getUserMedia → 16 kHz WAV), the host runs whisper-cli, the text lands in the composer.
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100) } return null }
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  try {
    const h = await window.thcadHostReady
    const st = await h.whisperStatus()
    check('Whisper helper + model found', st.available, JSON.stringify(st))
    await until(() => document.querySelector('[role=radio]'))
    ;[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === 'VI')?.click()
    location.hash = '#/ai-studio'
    const input = await until(() => document.querySelector('form input[aria-label]'))
    window.dispatchEvent(new Event('thcad-voice'))
    await sleep(8500) // the recording: 1 s silence + speech + 3 s silence
    const t0 = Date.now()
    window.dispatchEvent(new Event('thcad-voice'))
    const text = await until(() => /tường|cửa/i.test(input.value) && input.value, 60000)
    log('transcript: ' + (text || input.value))
    check('the Vietnamese sentence is transcribed into the composer (not sent)', !!text && /cửa sổ/i.test(text) && /W[- ]?25/i.test(text), text || '')
    check('numbers come through (1 m 2 / 900 mm)', !!text && /(1[,.]2|1 ?m ?2|1 mét 2|một mét hai)/i.test(text) && /(900 ?mm|900 milimét|chín trăm)/i.test(text), text || '')
    log('transcribe wall time ' + (Date.now() - t0) + ' ms')
  } catch (e) {
    fails++
    log('FAIL exception ' + e)
  }
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
