// End-to-end (v2.4 render pipeline): GLB round trip, Blender Cycles worker (separate process), queue-time scene
// snapshot + provenance sidecar, cancel, UI responsiveness during a render, Day / Golden / Night (lighting only),
// camera bookmarks, before / after comparison, material option batch, memory guard and the OCCT fallback.
//
// Run A (Blender installed):
//   qa/tools/rune2e.sh $PWD/native/app/resources/e2e_blender.js 600 THCAD_PROFILE=<p> THCAD_UI_URL=http://127.0.0.1:52XX THCAD_SPLASH=0 \
//     THCAD_RENDER_OUT=<qa>/v2_4/render THCAD_DOWNLOAD_DIR=<qa>/v2_4/render THCAD_RENDER_CACHE=<tmp>/cache \
//     THCAD_GLB_OUT=<tmp>/e2e.glb THCAD_DWG_SAMPLE=<tmp>/e2e.glb
// Run B (fallback + memory guard): the same plus THCAD_BLENDER=none THCAD_RENDER_MEM_LIMIT_MB=1200
// (THCAD_DWG_SAMPLE = the GLB path lets the page read the exported file back through qaSampleFile.)
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(150) } return null }
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  const info = (m) => log('INFO ' + m)
  const btn = (txt) => [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === txt).pop()
  const toastText = () => [...document.querySelectorAll('[role=status], [class*=toast]')].map((x) => x.textContent).join(' | ')
  const select = (label, value) => {
    const el = document.querySelector(`select[aria-label="${label}"]`)
    if (!el) throw new Error('no select ' + label)
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const b64bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const near = (a, b, tol) => Math.abs(a - b) <= tol
  try {
    const h = await window.thcadHostReady
    await until(() => document.querySelector('[role=radio]'))
    ;[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === 'EN')?.click()
    location.hash = '#/renders'
    await until(() => window.__thcad?.renders && window.__thcad?.render24 && window.__thcad?.bim && window.__thcad?.interior, 20000)
    const R = window.__thcad.renders, B = window.__thcad.bim, I = window.__thcad.interior
    const { provenance: P, snapshot: S, runner: RUN } = window.__thcad.render24
    const bl = await h.blenderInfo(true)
    info('blender ' + JSON.stringify(bl))
    const hostInfo = await h.info()
    check('Settings info reports the Blender detection (path / version or not found)', !!hostInfo.blender && hostInfo.blender.found === bl.found, JSON.stringify(hostInfo.blender))
    await sleep(800)
    // a clean queue: no seed jobs (their snapshots would share the host with this test)
    R.getState().edit('e2e clear', (d) => ({ ...d, queue: [] }))
    R.getState().set({ camera: 'cam1', mode: 'rendered', tab: 'studio' })
    const baseSettings = { ...R.getState().doc.settings }
    const runOf = (id) => R.getState().runs[id]
    const jobOf = (id) => R.getState().doc.queue.find((j) => j.id === id)
    let n = 0
    const addJob = (cameraId, name, w, hh, samples, engine, extra = {}) => {
      const id = `e2e-${Date.now()}-${n++}`
      const settings = { ...baseSettings, engine, samples, denoise: true, format: 'png' }
      R.getState().edit('e2e queue', (d) => ({ ...d, queue: [...d.queue, { id, cameraId, camera: name, settings: `${w} × ${hh} · ${samples} samples`, output: 'PNG', status: 'waiting', created: Date.now(), cfg: { settings, fx: d.fx }, special: { w, h: hh, samples }, ...extra }] }))
      return id
    }
    let outDir = ''
    const waitDone = (id, ms) => until(() => ['done', 'failed', 'cancelled'].includes(runOf(id)?.status) && runOf(id), ms)

    if (bl.found) {
      // ── V24-036 GLB round trip: BIM villa and interior ───────────────────────────────────────────
      for (const [label, spec, name] of [['BIM villa', S.bimSpec(B.getState().model, { architecture: true, landscape: false }), 'villa.glb'], ['interior', S.interiorSpec(I.getState().doc, { furniture: true }), 'interior.glb']]) {
        const r1 = await S.exportGlb(h, spec, name)
        const exact = (await h.scene3dCommand('export-glb', JSON.stringify({ cmd: 'bounds' }))).bounds
        const file = JSON.parse(await h.qaSampleFile(0))
        const g = P.parseGlb(b64bytes(file.base64))
        const dims = (b) => [b[3] - b[0], b[4] - b[1], b[5] - b[2]]
        const dG = dims(g.boundsMm), dK = dims(exact)
        check(`GLB ${label}: file re-read (magic, JSON + BIN chunks, accessors) — ${g.nodes.length} nodes, ${Math.round(g.triangles)} triangles`, r1.ok && g.version === 2 && g.nodes.length === r1.nodes && g.nodes.length > 0, JSON.stringify({ ok: r1.ok, nodes: r1.nodes, err: r1.error }))
        check(`GLB ${label}: bounding box in mm equals the exact OCCT box (±1 mm; m → mm, Y-up → Z-up)`, dG.every((x, k) => near(x, dK[k], 1)) && g.boundsMm.every((x, k) => near(x, exact[k], 1)), `glb ${dG.map((x) => x.toFixed(1)).join(' × ')} mm vs OCCT ${dK.map((x) => x.toFixed(1)).join(' × ')} mm`)
        // every UI-built item carries its own material id (surface + colour), stable across exports
        const expect = Object.fromEntries(spec.items.map((it) => [it.id, P.glbMaterialName(it.mat, it.rgb, it.mat === 'glass' ? Math.max(0.6, it.transparency ?? 0) : it.transparency ?? 0)]))
        const wrong = Object.entries(expect).filter(([id, m]) => g.nodeMaterial[id] && g.nodeMaterial[id] !== m)
        const missing = Object.keys(expect).filter((id) => !g.nodeMaterial[id])
        check(`GLB ${label}: material ids per item match the model (${g.materials.length} materials)`, !wrong.length && missing.length <= spec.items.filter((it) => !it.parts?.length && !it.part).length, JSON.stringify({ wrong: wrong.slice(0, 3), missing: missing.slice(0, 5) }))
        check(`GLB ${label}: marked presentation only (asset.extras), metres, Y up`, g.asset?.extras?.presentationOnly === true && g.asset.extras.units === 'm' && g.asset.extras.upAxis === 'Y')
        const r2 = await S.exportGlb(h, spec, name)
        const g2 = P.parseGlb(b64bytes(JSON.parse(await h.qaSampleFile(0)).base64))
        check(`GLB ${label}: a second export is identical (material ids, bounds, sha256)`, r2.sha256 === r1.sha256 && JSON.stringify(g2.materials) === JSON.stringify(g.materials), `${r1.sha256?.slice(0, 12)} / ${r2.sha256?.slice(0, 12)}`)
        info(`GLB ${label}: ${r1.bytes} bytes, materials ${g.materials.join(', ')}`)
      }

      // ── Blender render of the villa: queue-time snapshot, revision lock, responsiveness, provenance ─
      const villa = addJob('cam1', 'Cam 01 - e2e Blender villa', 480, 270, 32, 'Blender Cycles (local)')
      const snap = await RUN.snapshotReady(villa)
      check('Queued job captured its scene at enqueue: revision, geometry hash, GLB, live 3D frame', !!(snap && snap.sceneRev && snap.geomHash && snap.glb && snap.glbSha256 && snap.frame), JSON.stringify(snap))
      // edit the model after queueing: the queued job keeps its revision (and renders the snapshot)
      const before = JSON.stringify(B.getState().model)
      const revQueued = snap?.sceneRev
      B.getState().edit('e2e move wall', (m) => ({ ...m, walls: m.walls.map((w, i) => (i === 0 ? { ...w, length: w.length + 500 } : w)) }))
      const revNow = S.specRevision(S.bimSpec(B.getState().model, R.getState().layers))
      check('Editing the model after queueing changes the live revision but not the job’s', revNow !== revQueued && jobOf(villa).snap.sceneRev === revQueued, `${revQueued} → live ${revNow}`)
      const t0 = Date.now()
      const err = await RUN.startJob(h, villa)
      check('Blender job starts (separate process)', err === null && runOf(villa)?.engine === 'blender', String(err))
      // V24-042: the UI stays responsive — host round trips and timers while Blender renders
      const lat = []
      let rendering = false
      while (Date.now() - t0 < 60000 && !['done', 'failed', 'cancelled'].includes(runOf(villa)?.status)) {
        const a = performance.now()
        await h.blenderInfo(false)
        lat.push(performance.now() - a)
        if (runOf(villa)?.status === 'rendering') rendering = true
        await sleep(100)
      }
      const max = Math.max(...lat), med = lat.sort((a, b) => a - b)[Math.floor(lat.length / 2)]
      check(`UI responsive during the Blender render: ${lat.length} host calls, median ${med?.toFixed(1)} ms, max ${max.toFixed(1)} ms (< 250 ms)`, rendering && lat.length >= 3 && max < 250)
      B.getState().undo()
      check('The model edit is undone (the project is back to its state before the test)', JSON.stringify(B.getState().model) === before)
      const run = await waitDone(villa, 120000)
      check('Blender render finishes: done, PNG written, preview shown', run?.status === 'done' && !!run.path && !!R.getState().previews[villa], JSON.stringify({ status: run?.status, path: run?.path, error: run?.error }))
      info(`villa render ${run?.ms} ms on ${run?.device}`)
      const side = run?.path ? await h.renderReadSidecar(run.path) : { ok: false }
      const sc = side.sidecar ?? {}
      check('Provenance sidecar next to the image: presentation only, never BOM / CNC', side.ok && sc.presentationOnly === true && sc.feedsBom === false && sc.feedsCnc === false && /PRESENTATION ONLY/.test(sc.label ?? ''), side.path)
      check('Sidecar records the queue-time scene revision (not the later edit), GLB hash and camera', sc.scene?.revision === revQueued && sc.scene?.glbSha256 === snap.glbSha256 && JSON.stringify(sc.camera?.eye) === JSON.stringify(snap.camera.eye) && sc.camera?.lens > 0, JSON.stringify(sc.scene))
      check('Sidecar engine = Blender Cycles, external process, network denied (sandbox)', sc.engine?.name === 'blender-cycles' && sc.engine?.process === 'external (QProcess)' && sc.engine?.sandboxNetworkDenied === bl.sandbox, JSON.stringify(sc.engine))
      const img = run?.path ? await h.renderReadImage(run.path, 0) : { ok: false }
      check('Output image is the requested size (480 × 270)', img.ok && img.w === 480 && img.h === 270, `${img.w} × ${img.h}`)

      // ── V24-045 before / after: live 3D frame vs render, same camera revision ─────────────────────
      R.getState().set({ camera: 'cam1' })
      await sleep(300)
      btn('Save View').click()
      await sleep(200)
      ;[...document.querySelectorAll('[role=menuitem]')].find((x) => /Compare live 3D/.test(x.textContent))?.click()
      const cmp = await until(() => document.querySelector('[data-testid=compare-live]')?.getAttribute('src') && document.querySelector('[data-testid=compare-render]')?.getAttribute('src') && document.querySelector('[data-testid=compare-rev]'), 15000)
      const same = document.querySelector('[data-testid=compare-rev]')
      check('Before / after dialog: live OCCT frame and render, both at the same scene revision', !!cmp && same?.dataset.same === '1' && same.textContent.includes(revQueued), same?.textContent)
      const slider = document.querySelector('input[aria-label="Comparison position"]')
      if (slider) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '35'); slider.dispatchEvent(new Event('input', { bubbles: true })); slider.dispatchEvent(new Event('change', { bubbles: true })) }
      await sleep(400)
      check('The slider wipes between the two images', /inset\(0px 65%|inset\(0 65%/.test(document.querySelector('[data-testid=compare-live]')?.style.clipPath ?? ''), document.querySelector('[data-testid=compare-live]')?.style.clipPath)
      outDir = run?.path ? run.path.replace(/[\\/][^\\/]*$/, '') : ''
      await sleep(1500)
      if (outDir) await h.qaGrab(outDir + '/compare-dialog.png')
      document.querySelector('[role=dialog] button[aria-label="Close"]')?.click()

      // ── V24-043 cancel: worker killed, nothing marked complete, partial output removed ─────────────
      const long = addJob('cam1', 'Cam 01 - e2e cancel', 1280, 720, 4096, 'Blender Cycles (local)')
      await RUN.snapshotReady(long)
      await RUN.startJob(h, long)
      await until(() => runOf(long)?.status === 'rendering' && (runOf(long)?.samples ?? 0) > 0, 30000)
      await sleep(800)
      const lat2 = []
      for (let k = 0; k < 5; k++) { const a = performance.now(); await h.blenderInfo(false); lat2.push(performance.now() - a); await sleep(80) }
      const tc = Date.now()
      RUN.cancelJob(h, long)
      const cr = await waitDone(long, 20000)
      check('Cancel: the job ends as cancelled (not done), quickly', cr?.status === 'cancelled' && !cr.path && Date.now() - tc < 10000, JSON.stringify({ status: cr?.status, ms: Date.now() - tc, samples: cr?.samples }))
      const cancelledPng = outDir + '/Cam 01 - e2e cancel.png'
      check('Cancel: no image and no sidecar were written for the cancelled job', !!outDir && !(await h.renderReadImage(cancelledPng, 64)).ok && !(await h.renderReadSidecar(cancelledPng)).ok && !R.getState().history.some((x) => x.jobId === long), cancelledPng)
      // the worker exited: a new job starts at once (the host is not busy)
      const quick = addJob('cam3', 'Cam 03 - e2e Blender interior', 320, 180, 16, 'Blender Cycles (local)')
      await RUN.snapshotReady(quick)
      const qe = await RUN.startJob(h, quick)
      check('After cancel the worker is gone: the next Blender job starts immediately', qe === null, String(qe))
      const qr = await waitDone(quick, 90000)
      check('Interior Blender render done', qr?.status === 'done', qr?.error)
      info(`UI latency while rendering before cancel: ${lat2.map((x) => x.toFixed(1)).join(', ')} ms`)

      // ── SP46 material options: same model, materials only ──────────────────────────────────────
      const names = { design: 'As designed', timber: 'Warm timber', concrete: 'Concrete & steel', marble: 'White marble' }
      R.getState().edit('e2e settings', (d) => ({ ...d, settings: { ...d.settings, engine: 'Blender Cycles (local)', samples: 16 } }))
      const cnt = R.getState().enqueueMaterialOptions('cam3', names)
      const vids = R.getState().doc.queue.slice(-cnt).map((j) => j.id)
      R.getState().edit('e2e small', (d) => ({ ...d, queue: d.queue.map((j) => (vids.includes(j.id) ? { ...j, special: { w: 320, h: 180, samples: 16 } } : j)) }))
      const snaps = []
      for (const id of vids) snaps.push(await RUN.snapshotReady(id))
      check(`Material options: ${cnt} jobs share one scene snapshot (same GLB, geometry hash, revision)`, cnt === 4 && snaps.every((s) => s && s.glbSha256 === snaps[0].glbSha256 && s.geomHash === snaps[0].geomHash && s.sceneRev === snaps[0].sceneRev), JSON.stringify(snaps.map((s) => s?.glbSha256?.slice(0, 8))))
      await RUN.startNext(h)
      const outs = []
      for (const id of vids) outs.push(await waitDone(id, 120000))
      const sides = []
      for (const o of outs) sides.push(o?.path ? (await h.renderReadSidecar(o.path)).sidecar : null)
      const shas = sides.map((s) => s?.image?.sha256)
      check('Material options: every option rendered, images differ, sidecars name the option', outs.every((o) => o?.status === 'done') && new Set(shas).size === shas.length && sides.every((s, k) => s?.materialOption?.key === ['design', 'timber', 'concrete', 'marble'][k]), JSON.stringify(outs.map((o) => o?.status)))
      R.getState().edit('e2e settings back', (d) => ({ ...d, settings: baseSettings }))

      // ── V24-044 Day / Golden / Night in the realtime viewport: lighting only ──────────────────────
      await S.loadSpec(h, 'e2e-light', S.bimSpec(B.getState().model, { architecture: true, landscape: true }))
      await h.scene3dCommand('e2e-light', JSON.stringify({ cmd: 'camera', eye: [-7000, -15500, 1700], at: [6900, 4900, 3800], fov: 50 }))
      const g0 = await h.scene3dCommand('e2e-light', JSON.stringify({ cmd: 'geomHash' }))
      const frames = {}
      let same3 = true
      for (const p of ['day', 'golden', 'night', 'standard']) {
        await h.scene3dCommand('e2e-light', JSON.stringify({ cmd: 'lighting', preset: p }))
        const f = await h.scene3dCommand('e2e-light', JSON.stringify({ cmd: 'snapshot', w: 480, h: 270 }))
        frames[p] = f.url
        const gh = await h.scene3dCommand('e2e-light', JSON.stringify({ cmd: 'geomHash' }))
        same3 = same3 && gh.hash === g0.hash && gh.items === g0.items && Math.abs(gh.volumeM3 - g0.volumeM3) < 1e-9
        if (p !== 'standard') { const a = document.createElement('a'); a.href = f.url; a.download = `realtime-${p}.png`; a.click(); await sleep(300) }
      }
      check(`Day / Golden / Night: geometry unchanged (hash ${g0.hash}, ${g0.items} items, ${g0.volumeM3?.toFixed(3)} m³)`, same3)
      check('Day / Golden / Night: the frames differ (lighting really changes)', new Set([frames.day, frames.golden, frames.night]).size === 3)

      // ── V24-015 camera bookmark from the BIM 3D view: exact restore ───────────────────────────────
      location.hash = '#/bim'
      await sleep(800)
      B.getState().set({ view: '3d', display: 'shaded', level: 'L1' })
      const live = await until(() => document.querySelector('[data-testid=native-scene] img'), 30000)
      await sleep(1500)
      select('3D - Section View', 'light:golden')
      await sleep(400)
      select('3D - Section View', 'bm:save')
      const bm = await until(() => (R.getState().doc.bookmarks ?? []).find((b) => b.source === 'bim'), 8000)
      const camA = await h.scene3dCommand('bim', JSON.stringify({ cmd: 'getCamera' }))
      check('Bookmark saved from the BIM view menu (also a Renders camera)', !!live && !!bm && R.getState().doc.cameras.some((c) => c.bookmarkId === bm.id) && bm.lens > 0 && bm.lighting === 'golden', JSON.stringify(bm && { eye: bm.eye, fov: bm.fov, lens: bm.lens, level: bm.level, section: bm.section, rev: bm.sceneRev, lighting: bm.lighting }))
      // move away: orbit, another level, section off, standard lighting
      await h.scene3dCamera('bim', 'orbitStart', 200, 200, 0)
      await h.scene3dCamera('bim', 'orbit', 420, 330, 0)
      B.getState().set({ level: 'L2' })
      await sleep(600)
      select('3D - Section View', 'light:standard')
      await sleep(400)
      const camB = await h.scene3dCommand('bim', JSON.stringify({ cmd: 'getCamera' }))
      select('3D - Section View', `bm:${bm.id}`)
      await sleep(1500)
      const camC = await h.scene3dCommand('bim', JSON.stringify({ cmd: 'getCamera' }))
      const st = B.getState()
      check('Bookmark restore: exact camera (eye / target / up / fov)', !P.sameCamera(camA, camB) && P.sameCamera(bm, camC, 0.01), JSON.stringify({ saved: [bm.eye, bm.at, bm.fov], restored: [camC.eye, camC.at, camC.fov] }))
      check('Bookmark restore: level, lighting and scene revision', st.level === bm.level && camC.lighting === bm.lighting && bm.sceneRev === window.__thcad.render24.bookmarks.sourceRevision('bim').rev, `${st.level} / ${camC.lighting} / ${bm.sceneRev}`)
      await sleep(300)
      if (outDir) await h.qaGrab(outDir + '/bim-bookmark-restored.png')
    } else {
      // ── Run B: Blender not installed (THCAD_BLENDER=none) → OCCT fallback, said in the UI ─────────
      check('Blender not found is reported', bl.found === false && /not found|disabled/i.test(bl.reason ?? ''), bl.reason)
      const fb = addJob('cam1', 'Cam 01 - e2e fallback', 320, 180, 16, 'Blender Cycles (local)')
      await RUN.snapshotReady(fb)
      R.getState().set({ camera: 'cam1', mode: 'rendered' })
      const e = await RUN.startJob(h, fb)
      check('Blender job without Blender renders with the OCCT path tracer', e === null && runOf(fb)?.engine === 'occt' && runOf(fb)?.note === 'blender-missing', JSON.stringify(runOf(fb)))
      const r = await waitDone(fb, 120000)
      await sleep(500)
      const badge = document.querySelector('[data-testid=render-badge]')?.textContent ?? ''
      check('Fallback render done, and the preview badge says Blender was not found', r?.status === 'done' && /Blender not found/.test(badge), badge)
      const sd = r?.path ? (await h.renderReadSidecar(r.path)).sidecar : null
      check('Fallback sidecar: OCCT engine, fallback noted, presentation only', sd?.engine?.name === 'occt-path-tracing' && sd?.fallback === 'blender-missing' && sd?.presentationOnly === true, JSON.stringify(sd?.engine))

      // ── V24-046 memory guard (THCAD_RENDER_MEM_LIMIT_MB=1200 simulates a small machine) ──────────
      const modelBefore = JSON.stringify(B.getState().model), interiorBefore = JSON.stringify(I.getState().doc)
      const mc = await h.renderMemoryCheck(3840, 2160, 'blender')
      check('Memory pre-check refuses a 4K Blender render under the limit', mc.ok === false && /not enough memory/.test(mc.reason ?? ''), mc.reason)
      const big = addJob('cam1', 'Cam 01 - e2e 8K', 7680, 4320, 16, 'Path Tracing (Physically Based)')
      await RUN.snapshotReady(big)
      const be = await RUN.startJob(h, big)
      check('8K OCCT render fails gracefully with a memory message (nothing allocated)', !!be && /not enough memory/i.test(be) && runOf(big)?.status === 'failed', be)
      const a = performance.now()
      await h.info()
      check('App still responsive, project untouched (BIM + interior models identical, renders store intact)', performance.now() - a < 500 && JSON.stringify(B.getState().model) === modelBefore && JSON.stringify(I.getState().doc) === interiorBefore && !!JSON.parse(localStorage.getItem('thcad.renders')).state.doc)
      const small = addJob('cam1', 'Cam 01 - e2e after memory', 320, 180, 16, 'Path Tracing (Physically Based)')
      await RUN.snapshotReady(small)
      await RUN.startJob(h, small)
      const sr = await waitDone(small, 120000)
      check('A smaller render works right after the refused one', sr?.status === 'done', sr?.error)
    }
  } catch (e) {
    fails++
    log('FAIL exception ' + e + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' | '))
  }
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
