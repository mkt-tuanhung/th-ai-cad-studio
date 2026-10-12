// Settings → Download AI model, in the desktop app with an empty models folder (THCAD_MODELS_DIR).
// Default run (real download from Hugging Face): the 7B model is recommended on this Mac; Download, Pause at
// ~15 % (nothing appears where the runtime looks, the .part stays), Resume (continues from there, not from
// 0), sha256 check, install, load and a test question — then the AI is ready and the folder holds exactly
// the model files. Failure runs set window.THCAD_E2E_MODEL first (a local mirror via THCAD_MODEL_MIRROR):
//   {id, expect: 'checksum' | 'http404' | 'nospace' | 'ok', retry?: true}
;(async () => {
  const cfg = Object.assign({ id: 'qwen2.5-7b-instruct-q4_k_m', expect: 'ok', pauseAt: 0.15, recommended: true }, window.THCAD_E2E_MODEL || {})
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(200) } return null }
  const qa = '/Users/mac/Downloads/TH_AI_CAD_Studio_UI_Handoff_v1/th-ai-cad-studio/qa/'
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  const btn = (re, root = document) => [...root.querySelectorAll('button')].find((b) => re.test(b.textContent.trim()))
  try {
    const h = await window.thcadHostReady
    const events = []
    h.on('modelProgress', (p) => events.push(p))
    const last = () => events[events.length - 1]
    const doneEvent = (from) => events.slice(from).find((e) => e.done)
    await until(() => document.querySelector('[role=radio]'))
    ;[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === 'EN')?.click()
    location.hash = '#/settings'
    const box = await until(() => document.querySelector('[data-testid=model-download]'), 15000)
    check('Settings shows “Download AI model”', !!box && /Download AI model/.test(box.textContent))
    const st0 = await h.modelDownloadState()
    log('state ' + JSON.stringify({ dir: st0.dir, free: Math.round(st0.freeBytes / 2 ** 30), ram: Math.round(st0.ramBytes / 2 ** 30), recommended: st0.recommended }))
    check('downloads go to the folder the runtime reads', st0.dir === (await h.systemInfo()).modelsDir, st0.dir)
    if (cfg.recommended) check('7B recommended for this computer’s memory', st0.recommended === 'qwen2.5-7b-instruct-q4_k_m' && /Recommended for this computer/.test(box.textContent))
    const item = [...box.querySelectorAll('label')].find((l) => l.textContent.includes(st0.models.find((m) => m.id === cfg.id).label))
    item.querySelector('input').click()
    await sleep(200)
    check('empty folder: no model loaded', !(await h.localAiStatus()).ready && (await h.systemInfo()).models.length === 0)
    const before = st0.models.find((m) => m.id === cfg.id).partialBytes
    if (before) log('an earlier run left ' + before + ' bytes: the button resumes (app closed mid-download)')
    btn(/^(Download|Resume) \(/, box).click()
    const t0 = Date.now()
    let from = 0  // events of the final run (after the Pause / Resume test)

    if (cfg.pauseAt) {
      const total = st0.models.find((m) => m.id === cfg.id).bytes
      await until(() => events.some((e) => e.phase === 'download' && e.received / total >= cfg.pauseAt && e.bytesPerSecond > 0), 600000)
      await sleep(300)
      const line = box.querySelector('[data-testid=model-download-progress]')?.textContent ?? ''
      const eta = /about (\d+) (min|s) left/.exec(line)
      check('progress: size, speed and a sensible time left', /Downloading [\d.]+ [MG]B \/ [\d.]+ GB · [\d.]+ MB\/s · about \d+ (min|s) left · part 1\/2/.test(line) && !!eta && (eta[2] === 's' || +eta[1] < 120), line)
      await h.qaGrab(qa + 'model_download_progress.png')
      const n = events.length
      btn(/^Pause$/, box).click()
      await until(() => doneEvent(n), 20000)
      check('Pause stops the download', doneEvent(n)?.cancelled === true, JSON.stringify(doneEvent(n)))
      await sleep(500)
      const st1 = await h.modelDownloadState()
      const m1 = st1.models.find((m) => m.id === cfg.id)
      check('paused: the partial file is kept, the model is not installed', m1.partialBytes > total * 0.1 && !m1.installed, JSON.stringify(m1))
      check('paused: nothing half-written where the runtime looks (no model listed, AI not ready)', (await h.systemInfo()).models.length === 0 && !(await h.localAiStatus()).ready)
      const resume = await until(() => btn(/^Resume \(/, box))
      check('button offers Resume with what is left', !!resume && /% downloaded — resumes from there/.test(box.textContent), resume?.textContent)
      await h.qaGrab(qa + 'model_download_paused.png')
      const k = events.length
      from = k
      resume.click()
      const first = await until(() => events.slice(k).find((e) => e.phase === 'download' && e.received > 0), 60000)
      check('Resume continues from the partial file (not from 0)', !!first && first.received >= m1.partialBytes, `${first?.received} ≥ ${m1.partialBytes}`)
    }

    // a refusal before the start (no space, busy) is the call's return value: the UI shows it, no event
    const end = cfg.expect === 'nospace'
      ? (await until(() => /Not enough disk space/.test(box.textContent), 20000), { ok: false, ...(await h.modelDownload(cfg.id)) })
      : await until(() => doneEvent(from), cfg.expect === 'ok' ? 1500000 : 300000)
    const secs = Math.round((Date.now() - t0) / 1000)
    log('result ' + JSON.stringify(end) + ' after ' + secs + ' s')
    const phases = [...new Set(events.slice(from).map((e) => e.phase).filter(Boolean))]
    log('phases ' + phases.join(','))
    await sleep(800)
    const st = await h.modelDownloadState()
    const m = st.models.find((x) => x.id === cfg.id)
    const sys = await h.systemInfo()
    const ai = await h.localAiStatus()
    const resultText = box.querySelector('[data-testid=model-download-result]')?.textContent ?? ''
    if (cfg.expect === 'ok') {
      check('sha256 checked before install', phases.includes('verify'))
      if (cfg.retry) check('connection drop → automatic retry', phases.includes('retry'))
      check('installed, loaded and answered the test question', end?.ok && end.loaded && !!end.test, JSON.stringify(end))
      check('UI: “Installed and tested … The AI assistant is ready.”', /Installed and tested: the model answered “.+” in [\d.]+ s on .+\. The AI assistant is ready\./.test(resultText), resultText)
      check('runtime ready with this model; it is the active one in Settings', ai.ready && sys.models.some((x) => x.active && x.path === end.path), JSON.stringify({ ready: ai.ready, model: ai.modelName, device: ai.device }))
      check('folder: complete model, no partial files left', m.installed && m.partialBytes === 0)
      await until(() => /Model Ready/.test(document.querySelector('[aria-label="AI Model Configuration"]')?.textContent ?? ''), 10000)
      check('AI card chip turns “Model Ready”', /Model Ready/.test(document.querySelector('[aria-label="AI Model Configuration"]')?.textContent ?? ''))
      await h.qaGrab(qa + 'model_download_done.png')
    } else if (cfg.expect === 'checksum') {
      check('damaged download → checksum mismatch reported', end && !end.ok && /checksum mismatch/.test(end.error), JSON.stringify(end))
      check('damaged file deleted; nothing installed; AI not given a bad model', !m.installed && m.partialBytes === 0 && sys.models.length === 0 && !ai.ready, JSON.stringify(m))
      check('UI explains it', /Download did not finish: checksum mismatch/.test(resultText), resultText)
      await h.qaGrab(qa + 'model_download_checksum.png')
    } else if (cfg.expect === 'http404') {
      check('missing file on the server → clear error, no endless retry', end && !end.ok && /HTTP 404/.test(end.error) && secs < 30 && !phases.includes('retry'), JSON.stringify(end) + ' ' + secs + ' s')
      check('nothing installed', !m.installed && sys.models.length === 0)
    } else if (cfg.expect === 'nospace') {
      check('not enough space → refused before downloading', end && !end.ok && end.needBytes > end.freeBytes && !phases.includes('download'), JSON.stringify(end))
      check('UI: “Not enough disk space: needs … free”', /Not enough disk space: needs [\d.]+ GB, [\d.]+ (MB|GB|KB) free/.test(resultText), resultText)
      await h.qaGrab(qa + 'model_download_nospace.png')
    }
  } catch (e) {
    fails++
    log('FAIL exception ' + e)
  }
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
