// End-to-end (v2.4 "Ảnh mẫu → phong cách nội thất"): the photo-reading model installed from Settings → Manage Models
// (resume / sha256 verify / install into <models>/vision); the Villa 150 house built by the one-command run from its
// master DWG; reference photos read by the local vision model (Qwen2.5-VL through the llama-mtmd-cli helper) for the
// living room; review → options (checked: no overlap, inside, ≥ 800 mm at doors) → apply (one undo step) → Blender
// render with the auto cameras and the mood's lighting preset, saved beside the reference.
//
//   qa/tools/rune2e.sh $PWD/native/app/resources/e2e_stylephoto.js 3600 THCAD_PROFILE=<p> THCAD_UI_URL=http://127.0.0.1:52XX THCAD_SPLASH=0 \
//     "THCAD_DWG_SAMPLE=<VILLA_150_MASTER.dwg>|<dir>/AR_living.jpg|<dir>/B_loft.jpg|…" THCAD_PICK_DIR=<out> \
//     THCAD_RENDER_OUT=<tmp>/renders THCAD_RENDER_CACHE=<tmp>/cache
// Photos are grouped by the prefix before "_": each group is one analysis (1–5 photos); a group whose prefix has an
// "R" is also applied to the living room and rendered. Results (analysis JSON, timings, side-by-side images) are
// written into THCAD_PICK_DIR. No network is used except the model download when the model is not installed yet.
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000, step = 200) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(step) } return null }
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  const info = (m) => log('INFO ' + m)
  const q = (sel) => document.querySelector(sel)
  const setVal = (el, v) => {
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  }
  const b64 = (s) => btoa(unescape(encodeURIComponent(s)))
  const results = { started: new Date().toISOString(), sets: [] }
  try {
    const h = await window.thcadHostReady
    await until(() => window.__thcad?.interior && window.__thcad?.styleRef && window.__thcad?.renders, 30000)
    const I = window.__thcad.interior, R = window.__thcad.renders
    const { styleRef: SR, styleApply: SA } = window.__thcad.styleRef
    const out = await h.pickFolder('out', '')
    info('output folder ' + out)
    // a clean Renders queue (jobs left by an earlier interrupted run of this QA profile would render first)
    R.getState().edit('e2e: clear queue', (d) => ({ ...d, queue: [] }))
    const save = async (name, text) => (await h.writeFileTo(out, name, b64(text))).ok
    const radio = (label) => [...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === label)
    await until(() => radio('EN'), 20000)

    // ── the sample files: DWG(s) for the house, photos grouped by prefix ─────────────────────────────
    const dwgs = [], photos = []
    for (let i = 0; ; i++) {
      const f = JSON.parse(await h.qaSampleFile(i))
      if (!f.name) break
      const file = new File([Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0))], f.name, { type: /\.jpe?g$/i.test(f.name) ? 'image/jpeg' : /\.png$/i.test(f.name) ? 'image/png' : '' })
      ;(/\.(jpe?g|png)$/i.test(f.name) ? photos : dwgs).push(file)
    }
    const groups = new Map()
    for (const p of photos) {
      const k = p.name.split('_')[0]
      groups.set(k, [...(groups.get(k) ?? []), p])
    }
    info(`files: ${dwgs.map((f) => f.name).join(', ')} · photo groups: ${[...groups].map(([k, v]) => `${k}(${v.length})`).join(', ')}`)

    // ── 1. the photo-reading model: Settings → Manage Models (download / resume → sha256 → install) ─────
    let vs = await h.visionStatus()
    info('vision status ' + JSON.stringify(vs))
    check('the llama-mtmd-cli helper is found', !!vs.helper, vs.helper)
    location.hash = '#/settings'
    await sleep(1500)
    const manage = await until(() => [...document.querySelectorAll('button')].find((b) => /Manage Models|Quản lý mô hình/.test(b.textContent)), 15000)
    manage?.click()
    const block = await until(() => q('[data-testid=vision-model]'), 10000)
    check('Settings → Manage Models shows the photo-reading model block', !!block, block?.innerText.replace(/\n/g, ' | ').slice(0, 200))
    if (!vs.available) {
      const dl = await until(() => q('[data-testid=vision-download]'), 10000)
      check('the download / resume button is offered', !!dl, dl?.textContent)
      const t0 = Date.now()
      dl?.click()
      const prog = await until(() => q('[data-testid=vision-progress]'), 30000, 100)
      info('progress: ' + (prog?.innerText ?? '—'))
      const res = await until(() => q('[data-testid=vision-result]'), 3600000, 1000)
      vs = await h.visionStatus()
      check('the model is downloaded / resumed, verified (sha256) and installed into <models>/vision', !!res && /verified|kiểm tra/.test(res.textContent) && vs.available, `${res?.textContent} · ${((Date.now() - t0) / 1000).toFixed(0)} s · ${JSON.stringify(vs)}`)
      results.install = { seconds: (Date.now() - t0) / 1000, status: vs }
    } else info('model already installed')
    check('vision model available (model + mmproj + helper)', vs.available, `${vs.model} + ${vs.mmproj} ${(vs.modelBytes / 1e9).toFixed(2)} GB`)
    const st2 = await until(() => /Đã cài|Installed/.test(q('[data-testid=vision-status]')?.textContent ?? ''), 10000)
    check('the block reports the installed model', !!st2, q('[data-testid=vision-status]')?.textContent)
    await h.qaGrab(out + '/00_settings_vision_model.png')
    document.querySelector('[aria-label=Close]')?.click()

    // ── 2. the Villa 150 house by the one-command run (EN for the command bar) ────────────────────────
    radio('EN')?.click()
    location.hash = '#/dashboard'
    const bar = await until(() => document.querySelector('input[aria-label^="Search projects"]'), 15000)
    bar.focus()
    bar.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(bar, 'one command')
    bar.dispatchEvent(new Event('input', { bubbles: true }))
    const opt = await until(() => [...document.querySelectorAll('[role=option]')].find((o) => /One command/.test(o.textContent)))
    opt?.click()
    const dlg = await until(() => q('[data-testid=auto]'))
    const dt = new DataTransfer()
    dwgs.forEach((f) => dt.items.add(f))
    const input = dlg.querySelector('[data-testid=auto-file]')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    const tb = Date.now()
    const ready = await until(() => q('[data-testid=auto-approve]'), 900000, 500)
    check('one-command run read and built the house', !!ready, q('[data-testid=auto-kind]')?.textContent ?? 'timeout')
    // the model only: no package files for this test
    const keepFiles = q('[data-testid=auto-keep-files]')
    if (keepFiles?.checked) keepFiles.click()
    q('[data-testid=auto-approve]')?.click()
    const done = await until(() => q('[data-testid=auto-done]'), 900000, 500)
    check('approved: the BIM / interior model applied', !!done, `${((Date.now() - tb) / 1000).toFixed(0)} s`)
    q('[data-testid=auto] [aria-label=Close]')?.click()
    ;[...document.querySelectorAll('button')].find((b) => /^(Close|Đóng)$/.test(b.textContent.trim()))?.click()
    await sleep(800)
    radio('VI')?.click()

    const area = (o) => Math.abs(o.reduce((a, p, i) => a + p.x * o[(i + 1) % o.length].y - o[(i + 1) % o.length].x * p.y, 0)) / 2e6
    const doc0 = I.getState().doc
    const living = doc0.rooms.filter((r) => /living|khách|khach/i.test(`${r.name} ${r.id}`)).sort((a, b) => area(b.outline) - area(a.outline))[0]
    check('the house has a living room in the interior model', !!living, doc0.rooms.map((r) => `${r.id}:${r.name}`).join(', '))
    if (!living) throw new Error('no living room')
    info(`living room ${living.id} "${living.name}" ${area(living.outline).toFixed(1)} m², ${doc0.items.filter((i) => i.room === living.id).length} items, doors ${living.doors?.length ?? 0}`)
    await save('villa_interior_before.json', JSON.stringify({ doc: doc0, bim: window.__thcad.bim?.getState().model ?? null }))

    // ── 3. reference photos → analysis (model), per group ────────────────────────────────────────────
    location.hash = '#/interior'
    await sleep(1500)
    for (const [key, files] of groups) {
      const set = { key, photos: files.map((f) => f.name) }
      results.sets.push(set)
      I.getState().set({ styleRef: null, styleDlg: null, right: 'ai', room: living.id, plan: null })
      await sleep(600)
      const pick = await until(() => q('[data-testid=style-ref-input]'), 10000)
      check(`[${key}] the AI panel shows the reference-photo block (no DEMO cards)`, !!pick && !!q('[data-testid=style-drop]'))
      const d2 = new DataTransfer()
      files.forEach((f) => d2.items.add(f))
      pick.files = d2.files
      const t0 = Date.now()
      pick.dispatchEvent(new Event('change', { bubbles: true }))
      const sess = await until(() => { const s = I.getState().styleRef; return s && s.status !== 'reading' && s }, 900000, 250)
      const wall = Date.now() - t0
      const a = sess?.analysis
      set.wallMs = wall
      set.analysis = a
      set.raw = sess?.raw
      set.device = sess?.device
      check(`[${key}] read by the local vision model (${files.length} photo${files.length > 1 ? 's' : ''})`, !!a && a.source === 'model' && !sess.modelError, a ? `${a.style} · conf ${a.confidence} · model ${a.ms} ms · total ${wall} ms · ${sess.device ?? ''}` : sess?.modelError ?? sess?.error ?? 'timeout')
      check(`[${key}] the analysis validates (schema)`, !!a && SR.validateAnalysis(a).ok, a ? JSON.stringify(a.materials) : '')
      if (a) info(`[${key}] ${a.description}`)
      await sleep(300)
      await h.qaGrab(`${out}/${key}_1_panel.png`)
      if (!a || !/R/.test(key)) continue

      // review dialog
      I.getState().set({ styleDlg: 'analysis' })
      const dl = await until(() => q('[data-testid=style-dialog]'), 5000)
      check(`[${key}] the review dialog opens on the analysis (style, palette, finishes, furniture, lighting)`, !!dl && !!q('[data-testid=style-mat-floor]'))
      await sleep(500)
      await h.qaGrab(`${out}/${key}_2_analysis.png`)
      q('[data-testid=style-step-options]').click()
      const make = await until(() => q('[data-testid=style-make]'), 5000)
      const before = JSON.stringify(I.getState().doc)
      const undo0 = I.getState().undoStack.length
      make.click()
      const opts = await until(() => q('[data-testid=style-options]'), 120000)
      const arts = [...document.querySelectorAll('[data-testid=style-options] article')]
      set.options = arts.map((x) => x.innerText.replace(/\n/g, ' | '))
      check(`[${key}] options made (layouts A–C and/or restyle K), nothing applied yet`, !!opts && arts.length >= 1 && JSON.stringify(I.getState().doc) === before, set.options.map((x) => x.slice(0, 160)).join(' ## '))
      await h.qaGrab(`${out}/${key}_3_options.png`)
      const pickOpt = arts.find((x) => x.dataset.option !== 'K' && !x.querySelector('[data-testid^=style-apply-]')?.disabled) ?? arts.find((x) => !x.querySelector('[data-testid^=style-apply-]')?.disabled)
      check(`[${key}] an option passes the checks`, !!pickOpt, pickOpt?.dataset.option)
      if (!pickOpt) continue
      set.applied = pickOpt.dataset.option
      pickOpt.querySelector('[data-testid^=style-apply-]').click()
      await sleep(500)
      const after = I.getState().doc
      const rr = after.rooms.find((r) => r.id === living.id)
      set.room = { floor: rr.floorFinish, wall: rr.wallFinish, ceiling: rr.ceilingFinish, items: after.items.filter((i) => i.room === living.id).map((i) => `${i.name} ${i.w ?? i.dia}×${i.d ?? i.dia}×${i.h} ${i.material}${i.asset ? ' → ' + i.asset : ''}`) }
      check(`[${key}] applied as one undo step`, I.getState().undoStack.length === undo0 + 1, `${undo0} → ${I.getState().undoStack.length}`)
      check(`[${key}] room finishes follow the analysis`, rr.floorFinish === SR.appFinish(a, 'floor') && rr.wallFinish === SR.appFinish(a, 'walls'), `${rr.floorFinish} / ${rr.wallFinish} / ${rr.ceilingFinish}`)
      const dc = SA.doorClearance(after, rr)
      check(`[${key}] the room after the style: inside the room, ≥ 800 mm clear at every door`, SA.insideRoom(after, rr) && (dc.min >= 800 || !Number.isFinite(dc.min)), `door clear ${dc.min} blocked ${dc.blocked.join(',')}`)
      const cab0 = new Map(JSON.parse(before).cabinets.map((c) => [c.id, JSON.stringify([c.board, c.front, c.w, c.d, c.h, c.t, c.doors, c.shelves])]))
      const kept = after.cabinets.filter((c) => cab0.has(c.id))
      check(`[${key}] cabinet manufacturing data unchanged for every kept cabinet (boards not opted in)`, kept.every((c) => cab0.get(c.id) === JSON.stringify([c.board, c.front, c.w, c.d, c.h, c.t, c.doors, c.shelves])), `${kept.length} kept`)
      info(`[${key}] room: ${JSON.stringify(set.room)}`)
      await save(`${key}_interior_after.json`, JSON.stringify(after))

      // render step (opened by apply)
      const rs = await until(() => q('[data-testid=style-render]'), 5000)
      check(`[${key}] the dialog moved to the render step`, !!rs)
      const sel = q('[data-testid=style-dialog] select')
      if (sel) setVal(sel, '2')
      set.preset = q('[data-testid=style-preset]')?.value
      const tr = Date.now()
      rs.click()
      // the jobs the dialog queued (kept in the style session) and their runs in the Renders store
      const jobs = await until(() => { const r = I.getState().styleRef?.renders; return r?.length && r }, 20000)
      const ids = (jobs ?? []).map((x) => x.id)
      info(`[${key}] queued ${ids.join(', ')} · ${(jobs ?? []).map((x) => x.cam).join(' | ')}`)
      const fin = ids.length && (await until(() => ids.every((id) => ['done', 'failed', 'cancelled'].includes(R.getState().runs[id]?.status)), 2400000, 2000))
      const runs = ids.map((id) => R.getState().runs[id])
      set.renders = runs.map((r) => r && { status: r.status, engine: r.engine, ms: r.ms, path: r.path, error: r.error })
      check(`[${key}] ${ids.length} auto views rendered with Blender (presentation only)`, !!fin && runs.every((r) => r?.status === 'done' && r.engine === 'blender'), JSON.stringify(set.renders) + ` · ${((Date.now() - tr) / 1000).toFixed(0)} s`)
      for (const r of runs) if (r?.sidecar || r?.path) {
        const sc = await h.renderReadSidecar(r.path)
        check(`[${key}] provenance: presentation only`, sc.ok && sc.sidecar?.presentationOnly === true, sc.path)
        break
      }
      await until(() => q('[data-testid=style-render-img]'), 30000)
      await sleep(800)
      await h.qaGrab(`${out}/${key}_4_render_dialog.png`)
      // side by side: reference | render (each view)
      for (let k = 0; k < runs.length; k++) {
        if (!runs[k]?.path) continue
        const img = await h.renderReadImage(runs[k].path, 1600)
        if (!img.ok) continue
        const load = (u) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = u })
        const ref = await load(I.getState().styleRef.images[0].url), ren = await load(img.url)
        const H = 900, W1 = Math.round((ref.width / ref.height) * H), W2 = Math.round((ren.width / ren.height) * H)
        const c = document.createElement('canvas')
        c.width = W1 + W2 + 24
        c.height = H + 56
        const g = c.getContext('2d')
        g.fillStyle = '#fff'
        g.fillRect(0, 0, c.width, c.height)
        g.drawImage(ref, 0, 0, W1, H)
        g.drawImage(ren, W1 + 24, 0, W2, H)
        g.fillStyle = '#1c2331'
        g.font = '22px sans-serif'
        g.fillText(`Ảnh mẫu (${files[0].name})`, 8, H + 36)
        g.fillText(`Render ${set.applied === 'K' ? 'giữ bố trí' : 'phương án ' + set.applied} — ${a.style}, ${set.preset} · chỉ để trình bày`, W1 + 32, H + 36)
        const ok = (await h.writeFileTo(out, `${key}_5_side_by_side_${k + 1}.png`, c.toDataURL('image/png').split(',')[1])).ok
        check(`[${key}] side-by-side image ${k + 1} written`, ok)
      }
      // one undo step back to the design before, redo again
      I.getState().undo()
      const back = JSON.stringify(I.getState().doc) === before
      I.getState().redo()
      check(`[${key}] undo restores the room exactly, redo re-applies`, back && JSON.stringify(I.getState().doc) === JSON.stringify(after))
      I.getState().set({ styleDlg: null })
    }
  } catch (e) {
    fails++
    log('FAIL exception ' + e + ' ' + (e.stack ?? ''))
  }
  try {
    const h = await window.thcadHostReady
    const out = await h.pickFolder('out', '')
    await h.writeFileTo(out, 'results.json', btoa(unescape(encodeURIComponent(JSON.stringify(results, null, 1)))))
  } catch (e) {
    log('INFO could not write results ' + e)
  }
  await sleep(1500)
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
