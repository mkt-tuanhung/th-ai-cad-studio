// The photo-reading model download through the app's downloader (real network, the pinned Hugging Face revision):
// with a partly downloaded shard on disk (".part"), Download resumes it with an HTTP Range request, checks the size
// and sha256 of every shard and installs atomically into <models>/vision; then the helper can read with it.
//   rune2e.sh e2e_visiondl.js 900 THCAD_PROFILE=… THCAD_UI_URL=…   (prepare <models>/vision/<shard>.part first)
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  try {
    const h = await window.thcadHostReady
    const id = 'qwen2.5-vl-7b-instruct-q4_k_m'
    const st0 = await h.modelDownloadState()
    const m0 = st0.models.find((m) => m.id === id)
    check('the vision model is in the downloader catalogue (kind vision, 5.54 GB)', !!m0 && m0.kind === 'vision' && Math.abs(m0.bytes - 5536191744) < 1, JSON.stringify(m0))
    check('a partial download is on disk (resume)', !!m0 && !m0.installed && m0.partialBytes > 0 && m0.partialBytes < m0.bytes, `${m0?.partialBytes} of ${m0?.bytes}`)
    const events = []
    const done = new Promise((resolve) => h.on('modelProgress', (p) => { if (p.id === id) { events.push(p); if (p.done) resolve(p) } }))
    const t0 = Date.now()
    const r = await h.modelDownload(id)
    check('download starts', r.ok, JSON.stringify(r))
    const fin = await Promise.race([done, new Promise((x) => setTimeout(() => x(null), 840000))])
    const dl = events.filter((e) => e.phase === 'download')
    const vf = events.filter((e) => e.phase === 'verify')
    log(`INFO ${((Date.now() - t0) / 1000).toFixed(1)} s · ${dl.length} download events (first ${dl[0]?.received} B) · ${vf.length} verify events · final ${JSON.stringify(fin)}`)
    check('resumed (the first progress starts past the bytes already on disk), verified, installed; kind vision, nothing loaded in-process', !!fin && fin.ok && fin.kind === 'vision' && (dl[0]?.received ?? 0) >= m0.partialBytes && vf.length > 0, JSON.stringify(fin))
    const st = await h.visionStatus()
    check('the helper sees the installed model + projector', st.available, JSON.stringify(st))
    const st1 = await h.modelDownloadState()
    check('the catalogue says installed', st1.models.find((m) => m.id === id)?.installed === true)
  } catch (e) {
    fails++
    log('FAIL exception ' + e)
  }
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
