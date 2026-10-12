// Bridge self-test, run inside the real app page (THCAD_SELFTEST=1). Prints SELFTEST lines.
;(async () => {
  const out = (k, v) => console.log('SELFTEST ' + k + ' ' + JSON.stringify(v))
  let fails = 0
  const check = (name, cond) => { if (!cond) fails++; console.log('SELFTEST ' + (cond ? 'PASS ' : 'FAIL ') + name) }
  try {
    const h = await window.thcadHostReady
    const info = await h.info()
    out('info', info)
    check('engine reports OCCT + llama.cpp', !!info.occt && info.aiBackend === 'llama.cpp')
    const ai = await h.localAiStatus()
    out('localAi', ai)
    check('AI status is measured (source native, real memory)', ai.source === 'native' && ai.vramTotalGb > 8)
    check('no model → not ready, not online', ai.modelName === null ? !ai.ready && !ai.online : true)
    // the desktop UI seeds the engine with the open drawing first (after its IndexedDB hydration, which can take
    // several seconds on a busy machine); work on a blank one for determinism
    for (let i = 0; i < 200 && !(window.thcadSyncStats && window.thcadSyncStats.loads > 0); i++) await new Promise((r) => setTimeout(r, 100))
    // the restored drawing (IndexedDB) can be loaded a second time: wait until no load happened for 1.5 s
    for (let last = -1, calm = 0, i = 0; i < 40 && calm < 3; i++) {
      await new Promise((r) => setTimeout(r, 500))
      const n = window.thcadSyncStats ? window.thcadSyncStats.loads : 0
      calm = n === last ? calm + 1 : 0
      last = n
    }
    await h.cadLoad(JSON.stringify({ id: 'selftest', name: 'selftest.dwg', currentLayer: '0', layers: [], entities: [] }))
    const line = { type: 'add', label: 'LINE', entities: [{ kind: 'line', layer: 'A-Wall', a: [0, 0], b: [3600, 0] }] }
    const r1 = await h.cadExecute(JSON.stringify(line))
    check('cadExecute commits through the native command bus', r1.ok && r1.document.entities.length === 1 && r1.canUndo)
    const r2 = await h.cadExecute(JSON.stringify({ type: 'add', entities: [{ kind: 'line', layer: 'NOPE', a: [0, 0], b: [1, 0] }] }))
    check('validation errors come back from C++', !r2.ok && r2.error.code === 'unknown-layer')
    const p = await h.proposeOps('Add partition', JSON.stringify({ ops: [{ type: 'add', entities: [{ kind: 'line', layer: 'A-Wall', a: [0, 0], b: [0, 2800] }] }] }))
    const before = (await h.cadDocument()).entities.length
    check('proposal does not change the drawing', p.ok && before === 1)
    const a = await h.approveProposal(p.proposal.id)
    check('approve commits as one undo step', a.ok && a.document.entities.length === 2)
    const u = await h.cadUndo()
    check('undo reverts the approved proposal', u.label === 'AI: Add partition' && u.document.entities.length === 1)
    const b = await h.bimSummary()
    out('bim', { w1: b.walls[0], checks: b.checks })
    check('BIM quantities + OCCT net volume', Math.abs(b.walls[0].volume - 2.55) < 1e-9 && b.walls[0].netVolume < 2.55 && b.checks.join() === '0,3,5,0,0')
    // OCCT scene engine (Mechanical / Interior / MEP): exact volumes, boolean overlap, offscreen frame, pick
    const box = (id, x) => ({ id, rgb: [0.5, 0.5, 0.5], parts: [{ k: 'box', o: [x, 0, 0], s: [1000, 1000, 1000] }] })
    const sc = await h.scene3dLoad('selftest', JSON.stringify({ volumes: true, items: [box('a', 0), box('b', 500)] }))
    if (!sc.ok && sc.error === 'OpenGL unavailable') console.log('SELFTEST SKIP 3D scene: no OpenGL on this machine')
    else {
      check('3D scene: exact volumes (1 m³ boxes)', sc.ok && sc.failures === 0 && Math.abs(sc.volumes.a - 1) < 1e-9 && Math.abs(sc.volumes.b - 1) < 1e-9)
      const ov = await h.scene3dOverlaps('selftest')
      check('3D scene: boolean overlap 0.5 m³', ov.length === 1 && Math.abs(ov[0].m3 - 0.5) < 1e-9)
      await h.scene3dCamera('selftest', 'home', 0, 0, 0)
      const fr = await h.scene3dFrame('selftest', 320, 240, 'shaded', '', '')
      check('3D scene: offscreen frame', fr.ok && fr.url.startsWith('data:image/'))
      check('3D scene: pick at the centre hits a box', ['a', 'b'].includes(await h.scene3dPick('selftest', 160, 120)))
      // final renderer (OCCT ray / path tracing), tiny job, nothing written to disk
      let rdone = null
      h.on('renderProgress', (p) => { if (p.done && p.id === 'selftest-render') rdone = p })
      const rs = await h.renderStart(JSON.stringify({ id: 'selftest-render', name: 'selftest', save: false, denoise: true, scene: { items: [box('a', 0), box('b', 500)] }, params: { w: 64, h: 48, samples: 8, bounces: 2, engine: 'path', camera: { eye: [4000, -4000, 3000], at: [750, 500, 500], fov: 45 } }, fx: {}, format: 'png' }))
      if (!rs.ok && /ray-tracing|OpenGL unavailable/.test(rs.error || '')) console.log('SELFTEST SKIP renderer: ' + rs.error)
      else {
        for (let i = 0; i < 100 && !rdone; i++) await new Promise((r) => setTimeout(r, 100))
        out('render', { start: rs, done: rdone && { ...rdone, preview: rdone.preview ? rdone.preview.length : 0 } })
        check('renderer: path-traced image produced', rs.ok && !!rdone && rdone.ok && rdone.samples >= 8 && String(rdone.preview).startsWith('data:image/'))
      }
    }
    // discipline assistants: generic grammar-constrained generation (refused when no model is installed)
    let taskRes = null
    h.on('aiTaskResult', (p) => { if (p.id === 'selftest-task') taskRes = p })
    const started = await h.aiTask(JSON.stringify({ id: 'selftest-task', system: 'Reply with JSON only.', prompt: 'Give {"ok": true}.', grammar: 'root ::= "{" ws "\\"ok\\"" ws ":" ws ("true" | "false") ws "}"\nws ::= [ ]{0,2}', maxTokens: 24 }))
    if (!ai.ready) check('aiTask without a model is refused (nothing generated)', started === false)
    else {
      for (let i = 0; i < 600 && !taskRes; i++) await new Promise((r) => setTimeout(r, 100))
      check('aiTask: grammar-constrained JSON from the local model', !!taskRes && taskRes.ok && /^\{\s*"ok"\s*:\s*(true|false)\s*\}$/.test(taskRes.text.trim()))
    }
    // DWG writer (LibreDWG dwgadd) + read-back verification
    const dw = await h.dwgWrite('version 2000\nlayer "A-Wall"\nline (0 0 0) (3600 0 0)\nline.layer = "A-Wall"\ncircle (1000 1000 0) 300\ntext "PH\\U+00D2NG" (0 0 0) 250\n', 'selftest.dwg')
    if (!dw.ok && dw.error === 'no-writer') console.log('SELFTEST SKIP DWG writer not installed')
    else check('DWG writer: AutoCAD 2000 file read back with 3 entities and the layer', dw.ok && dw.entities === 3 && dw.layers >= 1 && dw.bytes > 1000)
    let result = null
    h.on('aiResult', (r) => { result = r; out('aiResult', { ok: r.ok, message: r.message, proposal: r.proposal && { added: r.proposal.added, status: r.proposal.status } }) })
    const docBefore = (await h.cadDocument()).entities.length
    await h.aiRequest('Draw a line from 0,0 to 2000,0 on layer A-Wall.')
    for (let i = 0; i < 200 && !result; i++) await new Promise((res) => setTimeout(res, 100))
    if (ai.ready) check('with a local model: AI returns a pending proposal and the drawing is unchanged', !!result && result.ok && result.proposal.status === 'pending' && (await h.cadDocument()).entities.length === docBefore)
    else check('without a model: AI answers honestly (no fabricated ops)', !!result && !result.ok)
  } catch (e) {
    fails++
    console.log('SELFTEST FAIL exception ' + e)
  }
  console.log('SELFTEST DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
