// End-to-end (v2.4 3D asset library): the library dialog from Interior → Space Planning → Library; "Thêm từ file" of an
// OBJ in centimetres (converted by Blender, unit guessed, size confirmed, licence required) and of a GLB in metres; place
// the imported piece into the room; render the room with Blender — the placed item is dressed with the imported model;
// export / import the user library as a zip; path confinement and the network allow-list of the host.
//
//   qa/tools/rune2e.sh $PWD/native/app/resources/e2e_library.js 900 THCAD_PROFILE=<p> THCAD_UI_URL=http://127.0.0.1:52XX THCAD_SPLASH=0 \
//     THCAD_LIBRARY_DIR=<tmp>/library "THCAD_PICK_FILE=$PWD/qa/v2_4/fixtures/library/stool_cm.obj|$PWD/qa/v2_4/fixtures/library/side_table_m.glb" \
//     THCAD_LIBRARY_ZIP=<tmp>/mine.zip THCAD_RENDER_OUT=<tmp>/renders THCAD_RENDER_CACHE=<tmp>/cache THCAD_PICK_DIR=<tmp>/grabs
// (THCAD_PICK_FILE answers the file dialog: the first pick is the OBJ, the second the GLB; nothing is fetched online.)
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(150) } return null }
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  const info = (m) => log('INFO ' + m)
  const setVal = (el, v) => {
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  }
  const q = (sel) => document.querySelector(sel)
  try {
    const h = await window.thcadHostReady
    await until(() => document.querySelector('[role=radio]'))
    ;[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === 'EN')?.click()
    await until(() => window.__thcad?.interior && window.__thcad?.assetLib && window.__thcad?.render24 && window.__thcad?.renders, 20000)
    const I = window.__thcad.interior, R = window.__thcad.renders
    const { assets: A, service: SV, interiorRender: IR } = window.__thcad.assetLib
    const { snapshot: S, runner: RUN } = window.__thcad.render24
    const grabs = await h.pickFolder('grabs', '')
    const lib0 = await h.libraryList()
    info('library ' + lib0.dir + ' items ' + (lib0.manifest?.items?.length ?? 0) + ' blender ' + lib0.blender)
    check('the library folder is the QA one (THCAD_LIBRARY_DIR), outside the project', /library/.test(lib0.dir) && lib0.ok)

    // ── the dialog from Interior → Space Planning → Library ────────────────────────────────────────
    location.hash = '#/interior'
    await sleep(1500)
    I.getState().set({ bottom: 'space', spTab: 'library' })
    const open = await until(() => q('[data-testid=open-asset-library]'), 10000)
    check('Space Planning → Library has the “3D library…” button', !!open)
    open?.click()
    const dlg = await until(() => q('[data-testid=asset-library]'), 5000)
    check('the 3D library dialog opens (tabs: library, add from file, download, draw your own, export / import)', !!dlg && document.querySelectorAll('[data-testid^=assetlib-tab-]').length === 5)
    await sleep(600)
    await h.qaGrab(grabs + '/library_dialog.png')

    // ── “Thêm từ file”: an OBJ in centimetres through the open dialog (THCAD_PICK_FILE) ─────────────
    q('[data-testid=assetlib-tab-import]').click()
    const pick = await until(() => q('[data-testid=assetlib-import-pick]'), 5000)
    pick.click()
    const form = await until(() => q('[data-testid=assetlib-import-form]') || q('[data-testid=assetlib-import-error]'), 180000)
    check('the OBJ is converted by Blender and measured (form shown)', !!form && form.dataset.testid === 'assetlib-import-form', form?.textContent?.slice(0, 200))
    const w = +q('[data-testid=assetlib-import-w]')?.value, d = +q('[data-testid=assetlib-import-d]')?.value, hh = +q('[data-testid=assetlib-import-h]')?.value
    check('the OBJ written in centimetres is read as cm: 400 × 400 × 450 mm', Math.abs(w - 400) <= 3 && Math.abs(d - 400) <= 3 && Math.abs(hh - 450) <= 3 && /\bcm\b/.test(form?.textContent ?? ''), `${w} × ${d} × ${hh}`)
    setVal(q('[data-testid=assetlib-import-name]'), 'Ghế đôn thử nghiệm')
    setVal(q('[data-testid=assetlib-import-cat]'), 'stool')
    // the licence is required
    q('[data-testid=assetlib-import-save]').click()
    await sleep(400)
    const before = (await h.libraryList()).manifest.items.length
    check('saving without a source / licence is refused', before === (lib0.manifest?.items?.length ?? 0))
    setVal(q('[data-testid=assetlib-import-licence]'), 'Tự tạo cho kiểm thử — CC0')
    q('[data-testid=assetlib-import-save]').click()
    const objEntry = await until(async () => (await h.libraryList()).manifest.items.find((e) => e.nameVi === 'Ghế đôn thử nghiệm'), 8000)
    check('the imported OBJ is in the library: user-import, model.glb in user/<id>/, real size, licence kept', !!objEntry && objEntry.origin === 'user-import' && objEntry.files?.main === 'model.glb' && /^user\//.test(objEntry.dir) && objEntry.dims?.h === 450 && /CC0/.test(objEntry.license) && objEntry.category === 'stool', JSON.stringify(objEntry))
    check('a thumbnail was rendered for it', objEntry?.thumb === 'thumb.png')

    // ── a GLB in metres (the second pick of THCAD_PICK_FILE, through the host API) ─────────────────
    let glbEntry = null
    const evt = new Promise((resolve) => SV.onLibraryEvent((e) => e.type === 'import' && resolve(e)))
    const r = await h.libraryImport('')
    check('the GLB import starts', r.ok, JSON.stringify(r))
    if (r.ok) {
      const e = await Promise.race([evt, sleep(120000).then(() => null)])
      check('the GLB in metres measures 600 × 450 × 550 mm (unit m)', !!e && e.ok && Math.abs(e.dims.w - 600) <= 3 && Math.abs(e.dims.d - 450) <= 3 && Math.abs(e.dims.h - 550) <= 3 && e.unit === 'm', JSON.stringify(e && { dims: e.dims, unit: e.unit }))
      if (e?.ok) {
        glbEntry = { id: e.id, kind: 'model', name: 'Side table test', nameVi: 'Bàn phụ thử nghiệm', category: 'sideTable', tags: [], dims: e.dims, files: { main: e.file }, dir: e.dir, thumb: 'thumb.png', source: { site: 'test' }, license: 'CC0 (test)', addedAt: Date.now(), origin: 'user-import' }
        check('the GLB entry is committed', (await h.libraryPut(JSON.stringify(glbEntry), '')).ok)
      }
    }
    await SV.refreshLibrary(h)

    // ── place the imported piece in the room from the dialog ───────────────────────────────────────
    q('[data-testid=assetlib-tab-browse]').click()
    await sleep(300)
    setVal(q('[data-testid=assetlib-search]'), 'thử nghiệm')
    await sleep(500)
    const card = [...document.querySelectorAll('[data-asset]')].find((c) => c.dataset.asset === objEntry?.id)
    check('the library grid lists the imported piece (search)', !!card)
    await h.qaGrab(grabs + '/library_imported.png')
    const itemsBefore = I.getState().doc.items.length
    card?.querySelector('[data-testid=assetlib-place]')?.click()
    await sleep(500)
    const placed = I.getState().doc.items.find((i) => i.asset === objEntry?.id)
    check('“Place in room” adds an interior item linked to the library asset, with its real size', !!placed && I.getState().doc.items.length === itemsBefore + 1 && placed.w === 400 && placed.h === 450, JSON.stringify(placed && { w: placed.w, d: placed.d, h: placed.h, room: placed.room }))
    document.querySelector('[aria-label=Close]')?.click()

    // ── render the room with Blender: the placed item is dressed with the imported model ──────────
    const doc = I.getState().doc
    const spec = S.interiorSpec(doc, { furniture: true })
    const dressed = spec.dressing?.items.find((x) => x.item === placed?.id)
    check('the render dressing uses the imported model for the placed item (file in the library, placeholder hidden)', !!dressed && dressed.asset === objEntry?.id && dressed.file === `${objEntry?.dir}/model.glb` && dressed.hide.includes(placed?.id), JSON.stringify(dressed))
    const bl = await h.blenderInfo(false)
    if (bl.found && placed) {
      const room = placed.room
      const views = IR.autoViews(doc, room, 1)
      check('an auto view of the room exists (eye 1.3 m, level camera)', views.length === 1 && views[0].eye[2] === 1300 && views[0].at[2] === 1300)
      const at = placed.at[0]
      // a close camera on the placed piece (the auto view looks at the room; this one at the item)
      const cam = { id: 'cam-e2e-lib', name: 'E2E library', kind: 'Interior - Bookmark', aspect: '16:9', w: 640, h: 360, thumb: '/assets/v2/renders/cam3.png', view: { scene: 'interior', eye: [at.x - 1800, at.y - 1800, 1300], at: [at.x, at.y, 1300], fov: 45, level: true, shift: [0, -0.15], room } }
      R.getState().edit('e2e cam', (dd) => ({ ...dd, queue: [], cameras: [...dd.cameras.filter((c) => c.id !== cam.id), cam] }))
      const id = 'e2e-lib-' + Date.now()
      const settings = { ...R.getState().doc.settings, engine: 'Blender Cycles (local)', samples: 24, denoise: true, format: 'png', lighting: 'day' }
      R.getState().edit('e2e queue', (dd) => ({ ...dd, queue: [{ id, cameraId: cam.id, camera: cam.name, settings: '640 × 360', output: 'PNG', status: 'waiting', created: Date.now(), cfg: { settings, fx: dd.fx }, special: { w: 640, h: 360, samples: 24 } }] }))
      await RUN.snapshotReady(id)
      const err = await RUN.startJob(h, id)
      check('the Blender render starts', !err, String(err))
      const run = await until(() => ['done', 'failed', 'cancelled'].includes(R.getState().runs[id]?.status) && R.getState().runs[id], 600000)
      check('the render finishes with Blender (engine blender, a PNG in the Renders folder)', run?.status === 'done' && run.engine === 'blender' && /\.png$/.test(run.path ?? ''), JSON.stringify(run && { status: run.status, engine: run.engine, path: run.path, error: run.error, note: run.note }))
      if (run?.path) {
        const img = await h.renderReadImage(run.path, 640)
        check('the render image reads back (640 × 360)', img.ok && img.w === 640 && img.h === 360)
      }
    } else info('Blender not installed — render step skipped')

    // ── export / import the user library ───────────────────────────────────────────────────────────
    const ex = await h.libraryExport()
    check('export: the user items in one zip', ex.ok && ex.items === (glbEntry ? 2 : 1) && ex.files >= 3, JSON.stringify(ex))
    if (glbEntry) {
      await h.libraryRemove(glbEntry.id)
      const gone = !(await h.libraryList()).manifest.items.some((e) => e.id === glbEntry.id)
      check('delete: the entry and its folder go', gone)
      const im = await h.libraryImportZip()
      const back = (await h.libraryList()).manifest.items.find((e) => e.id === glbEntry.id)
      check('import zip: the deleted user item comes back with its files', im.ok && !!back && back.files.main === 'model.glb', JSON.stringify(im))
    }

    // ── confinement and the allow-list (no network is used by these calls) ────────────────────────
    check('a manifest entry outside the library is refused', !(await h.libraryPut(JSON.stringify({ id: 'evil', kind: 'model', dir: '../evil', files: { main: 'x.glb' } }), '')).ok)
    check('a model file outside its folder is refused', !(await h.libraryPut(JSON.stringify({ id: 'evil2', kind: 'model', dir: 'user/evil2', files: { main: '../../x.glb' } }), '')).ok)
    check('fetching a non-Poly-Haven URL is refused', !(await h.libraryFetch('x', 'https://example.com/a.json')).ok)
    check('a download plan with a foreign URL is refused', !(await h.libraryDownload(JSON.stringify([{ id: 'x', files: [{ url: 'https://example.com/x.glb', path: 'models/x/x.glb', size: 1 }], entry: { id: 'x', dir: 'models/x' } }]))).ok)
    check('a download plan writing outside its asset folder is refused', !(await h.libraryDownload(JSON.stringify([{ id: 'x', files: [{ url: 'https://dl.polyhaven.org/x.glb', path: 'models/y/../../x.glb', size: 1 }], entry: { id: 'x', dir: 'models/x' } }]))).ok)

    // clean-up: the placed test item leaves the design
    if (placed) I.getState().edit('e2e cleanup', (dd) => ({ ...dd, items: dd.items.filter((i) => i.id !== placed.id) }))
  } catch (e) {
    fails++
    log('FAIL exception ' + e + ' ' + (e.stack ?? ''))
  }
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
