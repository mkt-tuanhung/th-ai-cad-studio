// Reference photo → style with the network unusable (qa/tools/offline-run.sh samples every socket of the app and its
// helpers, the llama-mtmd-cli child included): one photo of $THCAD_DWG_SAMPLE read by the local vision model, the
// answer validated. Also the honest fallback: a missing helper / model is reported, never faked.
//   THCAD_SCRIPT=$PWD/native/app/resources/e2e_visionoffline.js THCAD_UI_URL=… "THCAD_DWG_SAMPLE=<photo.jpg>" OUT=<dir> qa/tools/offline-run.sh 300
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 200)) } return null }
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  try {
    const h = await window.thcadHostReady
    await until(() => window.__thcad?.styleRef, 30000)
    const { styleRef: SR, palette: P } = window.__thcad.styleRef
    const st = await h.visionStatus()
    check('vision model + helper available', st.available, JSON.stringify(st))
    const f = JSON.parse(await h.qaSampleFile(0))
    check('a photo to read', !!f.base64, f.name)
    const pal = [{ hex: '#f0ece4', role: 'wall', share: 0.5 }, { hex: '#b08052', role: 'floor', share: 0.3 }]
    const id = 'off-' + Date.now()
    const res = new Promise((resolve) => h.on('visionResult', (r) => r.id === id && resolve(r)))
    const t0 = Date.now()
    const r0 = await h.visionAnalyze(JSON.stringify({ id, images: [f.base64], system: SR.STYLE_SYSTEM, prompt: SR.stylePrompt(pal, 1), grammar: SR.styleGrammar(), maxTokens: 700 }))
    check('analysis started', r0.ok, JSON.stringify(r0))
    const r = await Promise.race([res, new Promise((x) => setTimeout(() => x(null), 280000))])
    const p = r?.ok ? SR.parseModelAnswer(r.text, pal) : null
    check('read offline by the local model, answer valid', !!p?.ok, `${((Date.now() - t0) / 1000).toFixed(1)} s · ${r?.device ?? ''} · ${p?.ok ? p.value.style + ' ' + JSON.stringify(p.value.materials) : r?.error ?? 'timeout'}`)
    const bad = await h.visionAnalyze(JSON.stringify({ id: 'bad', images: [btoa('not an image')], prompt: 'x' }))
    check('a non-image is refused by the host', !bad.ok, bad.error)
    check('palette code present', typeof P.extractPalette === 'function')
  } catch (e) {
    fails++
    log('FAIL exception ' + e)
  }
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
