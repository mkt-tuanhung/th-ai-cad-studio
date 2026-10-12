// Panorama 360° and video renders in the desktop app (small sizes): files written, panorama 2:1 with GPano XMP.
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(200) } return null }
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
    // only this test's jobs in the queue (finished jobs start the next waiting one)
    R.getState().edit('clear queue', (d) => ({ ...d, queue: [] }))
    R.getState().set({ camera: 'cam3', pano: { face: 256, samples: 8 }, video: { path: 'orbit', seconds: 1, fps: 12, resolution: '1280x720', samples: 4 }, tab: 'panorama' })
    await sleep(500)
    btn('Render 360°').click()
    const pj = await until(() => [...R.getState().doc.queue].reverse().find((j) => j.kind === 'panorama' && ['done', 'failed'].includes(R.getState().runs[j.id]?.status)), 180000)
    const pr = pj && R.getState().runs[pj.id]
    check('panorama: 6 faces rendered and stitched to a JPG', pr?.status === 'done' && /\.jpg$/.test(pr.path || ''), JSON.stringify(pr))
    log('PANO ' + (pr?.path || ''))
    await sleep(400); await h.qaGrab(qa + 'renders_pano.png')
    R.getState().set({ tab: 'video' })
    await sleep(500)
    btn('Render video').click()
    const vj = await until(() => [...R.getState().doc.queue].reverse().find((j) => j.kind === 'video' && ['done', 'failed'].includes(R.getState().runs[j.id]?.status)), 300000)
    const vr = vj && R.getState().runs[vj.id]
    check('video: 12 frames rendered and encoded to MP4', vr?.status === 'done' && /\.mp4$/.test(vr.path || ''), JSON.stringify(vr))
    log('VIDEO ' + (vr?.path || ''))
    await sleep(400); await h.qaGrab(qa + 'renders_video.png')
    R.getState().set({ tab: 'studio', mode: 'shaded', camera: 'cam3' })
    await sleep(2500)
    check('live OCCT view of the render camera in Shaded mode', !!document.querySelector('[data-testid=native-scene] img'))
    await h.qaGrab(qa + 'renders_live.png')
    R.getState().set({ mode: 'rendered' })
  } catch (e) {
    fails++
    log('FAIL exception ' + e)
  }
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
