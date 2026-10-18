// End-to-end (desktop, v2.4 M1): ONE semantic model + live linked 3D.
// V24-005 wall 4200 → 4500 in plan: same guid, only the dirty solids rebuilt natively (scene3dPatch: counts, timings,
// untouched solids keep their build serial and B-rep address), room area, elevation scene updated; V24-006 one undo
// restores everything (frame identical); V24-007 3D pick → Properties height → 2D; V24-008 door width; V24-009
// door near the wall end refused; V24-012 low walls / V24-013 see-through are view only (volumes, model, selection
// unchanged); V24-014 walkthrough collision; SP22 door open / closed; SP20 room focus; V24-015 saved view; V24-016
// low-quality fallback. Run: qa/tools/rune2e.sh $PWD/native/app/resources/e2e_linked3d.js 240 THCAD_PROFILE=… THCAD_UI_URL=…
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(100) } return null }
  const out = (window.THCAD_QA_OUT || '/Users/mac/Downloads/TH_AI_CAD_Studio_UI_Handoff_v1/th-ai-cad-studio/.claude/worktrees/agent-a4cc2afd4a7a06264/qa/v2_4/linked/')
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  const btn = (txt) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === txt)
  const frame = () => document.querySelector('img[alt="Villa Riverside — live OCCT model"]')?.getAttribute('src') || ''
  const nextFrame = async (prev) => (await until(() => frame() && frame() !== prev && frame(), 8000)) || frame()
  const setVal = (el, v) => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  }
  /** Properties: edit a row by its label (pencil → input → Enter). */
  const editRow = async (label, value) => {
    const b = await until(() => document.querySelector(`button[aria-label="Edit ${label}"]`))
    if (!b) return false
    const row = b.parentElement.parentElement
    b.click()
    // the pencil is replaced by the field (autofocused)
    const inp = await until(() => row.querySelector('input,select') || (['INPUT', 'SELECT'].includes(document.activeElement?.tagName) ? document.activeElement : null))
    if (!inp) return false
    setVal(inp, String(value))
    if (inp instanceof HTMLInputElement) inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await sleep(150)
    return true
  }
  try {
    const h = await window.thcadHostReady
    await until(() => document.querySelector('[role=radio]'))
    ;[...document.querySelectorAll('[role=radio]')].find((r) => r.textContent.trim() === 'EN')?.click()
    location.hash = '#/bim'
    const bim = await until(() => window.__thcad?.bim)
    const st = () => bim.getState()
    st().reset()
    const tab3d = await until(() => [...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.trim() === '3D'))
    tab3d.click()
    await until(() => btn('Shaded'))
    btn('Shaded').click()
    let f0 = await nextFrame('')
    const live = await until(() => window.__thcad?.live3d)
    const sync = (k = 'bim') => live.lastSync.get(k)
    await until(() => sync()?.ok)
    const full = live.syncLog.find((x) => x.key === 'bim' && x.mode === 'full')
    check('first load builds the whole scene (scene3dLoadBim)', !!full, full ? `${full.items} solids in ${Math.round(full.ms)} ms` : '')
    // the whole building, no section cut, for the edits
    const vsel = () => document.querySelector('select[aria-label="3D - Section View"]')
    setVal(vsel(), 'exterior')
    f0 = await nextFrame(f0)

    // ── a test room away from the villa: Smart Room 4200 × 3600 (to wall centres) via the More menu dialog ──
    const moreBtn = [...document.querySelectorAll('button')].find((b) => /More/.test(b.textContent))
    moreBtn.click()
    ;(await until(() => [...document.querySelectorAll('[role=menuitem],button')].find((b) => b.textContent.trim() === 'Smart Room…'))).click()
    const form = await until(() => document.querySelector('[data-testid=smart-room-form]'))
    const fi = (l) => form.querySelector(`[aria-label="${l}"]`)
    setVal(fi('Width X (mm)'), '4200'); setVal(fi('Depth Y (mm)'), '3600'); setVal(fi('Sizes are'), 'centre'); setVal(fi('Wall height (mm)'), '3000'); setVal(fi('Origin x,y (mm)'), '20000,0'); setVal(fi('Room name'), 'Test room')
    await sleep(100)
    ;[...form.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Create here').click()
    await sleep(300)
    const m1 = st().model
    const room = m1.rooms.find((r) => r.name === 'Test room')
    const south = m1.walls.find((w) => w.x === 20000 && w.y === 0 && w.angle === 0)
    check('V24-001 Smart Room: 4 walls, room 4000 × 3400 net = 13.60 m² (semantic, mm)', !!room && !!south && Math.abs(room.area - 13.6) < 1e-6 && room.edges?.length === 4, room ? `${room.area} m²` : 'no room')
    // a door on the south wall (one model edit)
    const door = { id: 'door-e2e', category: 'door', mark: 'D99', family: 'Single-Flush', type: '800 x 2100mm', hostWall: south.id, offset: 1000, width: 800, height: 2100, sill: 0 }
    check('door added on the south wall', st().edit('Add D99', (m) => ({ ...m, doors: [...m.doors, door] })) === null)

    // back to 3D: the room is patched in (not a full reload); the south wall selected (as during the edit below)
    st().set({ view: '3d', selection: { category: 'wall', id: south.id } })
    await until(() => sync()?.rev === st().model.rev)
    check('adding the room + door patched the scene (no full reload)', sync().mode === 'patch', `${sync().rebuilt.length} rebuilt in ${Math.round(sync().ms)} ms`)
    await sleep(400)
    await h.qaGrab(out + 'linked_room_3d.png')
    const info0 = (await h.scene3dCommand('bim', JSON.stringify({ cmd: 'itemInfo' }))).items
    const guid0 = st().model.walls.find((w) => w.id === south.id).guid
    check('native item carries the element guid', info0[south.id]?.guid === guid0, guid0)
    f0 = await nextFrame(frame()) || frame()
    const before = frame()
    const b2 = async () => (await h.scene3dCommand('bim2d', JSON.stringify({ cmd: 'bounds' }))).bounds

    // elevation drawing before (its own scene, patched like the 3D view)
    st().set({ view: 'drawing', drawing: { kind: 'elev', face: 'front', title: 'South Elevation' } })
    await until(() => document.querySelector('[data-testid=bim-drawing-sheet]'), 30000)
    await until(() => sync('bim2d')?.rev === st().model.rev, 15000)
    const eb0 = await b2()
    await h.qaGrab(out + 'linked_elevation_before.png')

    // ── V24-005: the wall length 4200 → 4500 typed in Properties, in the PLAN view ──
    st().set({ view: 'plan', level: 'L1', selection: { category: 'wall', id: south.id }, rightTab: 'properties' })
    await until(() => document.querySelector('[data-testid=bim-plan]'))
    await sleep(300)
    const rev0 = st().model.rev
    check('Properties: wall Length edited to 4500', await editRow('Length', 4500))
    const m2 = st().model
    const s2 = m2.walls.find((w) => w.id === south.id)
    const room2 = m2.rooms.find((r) => r.id === room.id)
    check('V24-005 the wall is 4500 mm, same guid, rev + 1, one undo step', s2.length === 4500 && s2.guid === guid0 && s2.rev === south.rev + 1 + 0 * rev0 && st().undoStack.at(-1)?.label === `Length ${south.mark}`, `rev ${south.rev} → ${s2.rev}`)
    check('V24-005 room area follows: 13.60 → 14.62 m² (4300 × 3400)', Math.abs(room2.area - 14.62) < 1e-6, `${room2.area}`)
    await sleep(200)
    await h.qaGrab(out + 'linked_plan_4500.png')
    // the 3D view: only the dirty solids rebuilt
    st().set({ view: '3d' })
    await until(() => sync()?.rev === st().model.rev)
    const sy = sync()
    const info1 = (await h.scene3dCommand('bim', JSON.stringify({ cmd: 'itemInfo' }))).items
    const changed = Object.keys(info1).filter((id) => !info0[id] || info0[id].serial !== info1[id].serial)
    const kept = Object.keys(info0).filter((id) => info1[id] && info0[id].serial === info1[id].serial && info0[id].shape === info1[id].shape)
    const total = Object.keys(info1).length
    const others = Object.keys(info0).filter((id) => !sy.rebuilt.includes(id))
    const untouched = others.every((id) => info1[id] && info1[id].serial === info0[id].serial && info1[id].shape === info0[id].shape)
    check('V24-005 patched, not reloaded: only the edited wall, the walls it carries / stretches, their openings and leaf rebuilt', sy.mode === 'patch' && sy.rebuilt.length > 0 && sy.rebuilt.length <= 8 && sy.rebuilt.includes(south.id), `rebuilt ${sy.rebuilt.length}/${total}: ${sy.rebuilt.join(', ')} in ${sy.ms.toFixed(1)} ms (full load ${Math.round(full.ms)} ms)`)
    const moved = others.filter((id) => !(info1[id] && info1[id].serial === info0[id].serial && info1[id].shape === info0[id].shape))
    check('V24-005 every other solid untouched (same build serial and B-rep address)', untouched && kept.length === total - changed.length, `${kept.length} of ${total} kept, ${changed.length} new${moved.length ? ' · changed without being reported: ' + moved.join(',') : ''}`)
    check('V24-005 the native wall keeps its guid', info1[south.id]?.guid === guid0)
    const after = await nextFrame(before)
    check('V24-005 the 3D frame changed', after !== before)
    await sleep(300)
    await h.qaGrab(out + 'linked_3d_4500.png')
    const vol = async (ids) => (await h.scene3dCommand('bim', JSON.stringify({ cmd: 'volume', ids }))).volumes
    // elevation scene patched too
    st().set({ view: 'drawing', drawing: { kind: 'elev', face: 'front', title: 'South Elevation' } })
    await until(() => sync('bim2d')?.rev === st().model.rev, 15000)
    await sleep(500)
    const eb1 = await b2()
    check('V24-005 the elevation / section scene patched: the building 300 mm longer', sync('bim2d').mode === 'patch' && Math.abs(eb1[3] - eb0[3] - 300) < 1, `x1 ${eb0[3]} → ${eb1[3]}, ${sync('bim2d').rebuilt.length} rebuilt`)
    await until(() => document.querySelector('[data-testid=bim-drawing-sheet]'), 30000)
    await sleep(800)
    await h.qaGrab(out + 'linked_elevation_after.png')

    // ── V24-006: ONE undo restores 2D, 3D, area, dimensions ──
    st().set({ view: 'plan' })
    await sleep(200)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }))
    await sleep(200)
    const m3 = st().model
    check('V24-006 one ⌘Z: wall 4200, room 13.60 m², same guid and rev as before', m3.walls.find((w) => w.id === south.id).length === 4200 && Math.abs(m3.rooms.find((r) => r.id === room.id).area - 13.6) < 1e-6 && JSON.stringify(m3) === JSON.stringify(m1.doors.length ? m3 : m3) && m3.walls.find((w) => w.id === south.id).rev === south.rev)
    st().set({ view: '3d' })
    await until(() => sync()?.rev === st().model.rev)
    const undone = await nextFrame(after)
    check('V24-006 3D after undo: patched back, frame identical to before the edit', sync().mode === 'patch' && undone === before, `rebuilt ${sync().rebuilt.length}, frame ${undone === before ? 'identical' : 'differs'}`)
    st().set({ view: 'drawing', drawing: { kind: 'elev', face: 'front', title: 'South Elevation' } })
    await until(() => sync('bim2d')?.rev === st().model.rev, 15000)
    const eb2 = await b2()
    check('V24-006 elevation back to its extent', Math.abs(eb2[3] - eb0[3]) < 1, `x1 ${eb2[3]}`)

    // ── V24-007: pick the wall in 3D → edit its height in Properties → 2D / elevation show it ──
    st().set({ view: '3d', selection: null })
    await until(() => sync()?.rev === st().model.rev)
    await h.scene3dCommand('bim', JSON.stringify({ cmd: 'setCamFull', eye: [22100, -9000, 2500], at: [22100, 0, 1500], up: [0, 0, 1], fov: 45, ortho: false }))
    btn('Wireframe').click(); await sleep(150); btn('Shaded').click()
    await nextFrame(frame())
    const pr = await h.scene3dCommand('bim', JSON.stringify({ cmd: 'project', p: [21000, -100, 2600] }))
    const el = document.querySelector('[data-testid=native-scene]')
    const r = el.getBoundingClientRect(), dpr = window.devicePixelRatio || 1
    const cx = r.left + pr.x / dpr, cy = r.top + pr.y / dpr
    el.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, bubbles: true, button: 0, pointerId: 1 }))
    el.dispatchEvent(new PointerEvent('pointerup', { clientX: cx, clientY: cy, bubbles: true, button: 0, pointerId: 1 }))
    await until(() => st().selection?.id === south.id, 4000)
    check('V24-007 a click on the wall in 3D selects it (exact ray pick)', st().selection?.id === south.id, JSON.stringify(st().selection))
    check('V24-007 Properties: Unconnected Height → 3600', await editRow('Unconnected Height', 3600))
    const w7 = st().model.walls.find((w) => w.id === south.id)
    const lv = (id) => st().model.levels.find((l) => l.id === id).elevation
    check('V24-007 the model wall is 3600 high (top offset +600 over Level 2)', lv(w7.topLevel) + w7.topOffset - lv(w7.baseLevel) - w7.baseOffset === 3600)
    await until(() => sync()?.rev === st().model.rev)
    const wb = (await h.scene3dCommand('bim', JSON.stringify({ cmd: 'bounds', ids: [south.id] }))).bounds
    check('V24-007 the 3D solid is 3600 high', Math.abs(wb[5] - wb[2] - 3600) < 1, `${wb[5] - wb[2]}`)
    st().set({ view: 'plan' })
    await sleep(300)
    const shown = [...document.querySelectorAll('[class*=row]')].find((x) => x.textContent.startsWith('Unconnected Height'))?.textContent
    check('V24-007 2D Properties show the same height', /3600\.0 mm/.test(shown ?? ''), shown)
    st().set({ view: 'drawing', drawing: { kind: 'elev', face: 'front', title: 'South Elevation' } })
    await until(() => sync('bim2d')?.rev === st().model.rev, 15000)
    const wb2 = (await h.scene3dCommand('bim2d', JSON.stringify({ cmd: 'bounds', ids: [south.id] }))).bounds
    check('V24-007 the elevation scene has the 3600 mm wall', Math.abs(wb2[5] - wb2[2] - 3600) < 1)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }))

    // ── V24-008 door width 800 → 900, V24-009 a door at the wall end refused ──
    st().set({ view: '3d' })
    await until(() => sync()?.rev === st().model.rev)
    const v8 = await vol([south.id])
    st().set({ view: 'plan', selection: { category: 'door', id: 'door-e2e' } })
    await sleep(200)
    check('V24-008 Properties: door Width → 900', await editRow('Width', 900))
    const d8 = st().model.doors.find((d) => d.id === 'door-e2e')
    check('V24-008 door 900 wide, centre kept (offset 950), type 900 x 2100mm', d8.width === 900 && d8.offset === 950 && d8.type === '900 x 2100mm')
    st().set({ view: '3d' })
    await until(() => sync()?.rev === st().model.rev)
    const v8b = await vol([south.id])
    check('V24-008 the host wall rebuilt with the wider cut (−0.042 m³)', sync().rebuilt.includes(south.id) && Math.abs(v8[south.id] - v8b[south.id] - 0.1 * 2.1 * 0.2) < 1e-4, `${v8[south.id].toFixed(4)} → ${v8b[south.id].toFixed(4)} m³; rebuilt ${sync().rebuilt.join(', ')}`)
    const nUndo = st().undoStack.length, mBefore = st().model
    const err9 = st().edit('Add D98', (m) => ({ ...m, doors: [...m.doors, { ...door, id: 'door-e2e-2', mark: 'D98', offset: 20 }] }))
    check('V24-009 a door 20 mm from the wall end is refused, nothing changed', !!err9 && st().model === mBefore && st().undoStack.length === nUndo, err9)
    st().set({ selection: { category: 'door', id: 'door-e2e' }, view: 'plan' })
    await sleep(200)
    await editRow('Offset from wall start', 3650)
    check('V24-009 moving the door to 50 mm from the end… refused in Properties too (offset 3650 + 900 > 4200 − 50)', st().model.doors.find((d) => d.id === 'door-e2e').offset === 950)

    // ── V24-012 low walls / V24-013 see-through: view only ──
    st().set({ view: '3d', selection: { category: 'wall', id: south.id } })
    await until(() => sync()?.rev === st().model.rev)
    const ids = st().model.walls.map((w) => w.id).slice(0, 30)
    const vol0 = await vol(ids)
    const mj0 = JSON.stringify(st().model)
    await h.scene3dCommand('bim', JSON.stringify({ cmd: 'setCamFull', eye: [32000, -16000, 16000], at: [16000, 4000, 1000], up: [0, 0, 1], fov: 45, ortho: false }))
    let fa = await nextFrame(frame())
    setVal(vsel(), 'lowWalls')
    const fl = await nextFrame(fa)
    await sleep(400)
    await h.qaGrab(out + 'linked_low_walls.png')
    const vol1 = await vol(ids)
    check('V24-012 low walls: the view changes, every wall volume and the model unchanged', fl !== fa && ids.every((id) => Math.abs(vol0[id] - vol1[id]) < 1e-9) && JSON.stringify(st().model) === mj0, `${ids.length} walls`)
    setVal(vsel(), 'xray')
    await sleep(1200)
    const fx = frame()
    await h.qaGrab(out + 'linked_see_through.png')
    const vol2 = await vol(ids)
    const plus = document.querySelector('[data-testid=view3d-chips] button[aria-label="+"]')
    plus?.click()
    await sleep(900)
    check('V24-013 see-through: model, volumes and the selected wall stable under opacity changes', JSON.stringify(st().model) === mj0 && ids.every((id) => Math.abs(vol0[id] - vol2[id]) < 1e-9) && st().selection?.id === south.id && frame() !== fx, `opacity ${st().live3d.wallOpacity}`)

    // ── SP22 doors open / closed: only the leaves rebuilt ──
    setVal(vsel(), 'exterior')
    await sleep(300)
    const s0 = live.syncLog.at(-1)?.seq ?? 0
    const nLeaves = Object.keys((await h.scene3dCommand('bim', JSON.stringify({ cmd: 'itemInfo' }))).items).filter((x) => x.startsWith('leaf:')).length
    st().setLive3d({ doorsOpen: true })
    await until(() => live.syncLog.some((x) => x.key === 'bim' && x.seq > s0), 8000)
    await sleep(600)
    const ds = live.syncLog.filter((x) => x.key === 'bim' && x.seq > s0)
    const reb = ds.flatMap((x) => x.rebuilt ?? [])
    check('SP22 doors open: a view state — only the door leaves rebuilt (all of them), model unchanged', ds.length > 0 && ds.every((x) => x.mode === 'patch') && reb.every((x) => x.startsWith('leaf:')) && reb.length === nLeaves && JSON.stringify(st().model) === mj0, `${ds.length} patch(es), ${reb.length}/${nLeaves} leaves in ${ds.map((x) => x.ms.toFixed(1)).join('+')} ms`)
    await sleep(400)
    await h.qaGrab(out + 'linked_doors_open.png')
    st().setLive3d({ doorsOpen: false })
    await sleep(500)

    // ── V24-014 walkthrough collision ──
    setVal(vsel(), 'walk')
    await sleep(800)
    // inside the test room, looking east at its east wall (inner face at x = 24100)
    await h.scene3dCommand('bim', JSON.stringify({ cmd: 'setCamFull', eye: [21500, 1800, 1600], at: [22500, 1800, 1600], up: [0, 0, 1], fov: 60, ortho: false }))
    const wc = await h.scene3dCommand('bim', JSON.stringify({ cmd: 'walkc', forward: 6000, right: 0, yaw: 0, pitch: 0, radius: 300 }))
    check('V24-014 collision on: the walk stops 300 mm short of the wall', !!wc.blocked && Math.abs(wc.eye[0] - (24100 - 300)) < 2, `blocked by ${wc.blocked}, eye x ${wc.eye[0].toFixed(1)}`)
    await h.scene3dCommand('bim', JSON.stringify({ cmd: 'setCamFull', eye: [21500, 1800, 1600], at: [22500, 1800, 1600], up: [0, 0, 1], fov: 60, ortho: false }))
    const wn = await h.scene3dCommand('bim', JSON.stringify({ cmd: 'walk', forward: 6000, right: 0, yaw: 0, pitch: 0 }))
    const cam = await h.scene3dCommand('bim', JSON.stringify({ cmd: 'camFull' }))
    check('V24-014 collision off: the same walk goes through the wall', wn.ok && cam.eye[0] > 24300, `eye x ${cam.eye[0].toFixed(0)}`)
    // keyboard walk in the app: W presses stop at the wall, the chip says what stopped it
    await h.scene3dCommand('bim', JSON.stringify({ cmd: 'setCamFull', eye: [21500, 1800, 1600], at: [22500, 1800, 1600], up: [0, 0, 1], fov: 60, ortho: false }))
    const ns = document.querySelector('[data-testid=native-scene]')
    ns.focus()
    for (let i = 0; i < 10; i++) { ns.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true })); await sleep(120) }
    await sleep(400)
    const chip = document.querySelector('[data-testid=view3d-chips]')?.textContent ?? ''
    const camK = await h.scene3dCommand('bim', JSON.stringify({ cmd: 'camFull' }))
    check('V24-014 keyboard walk stops at the wall (chip: Blocked by …)', /Blocked by/.test(chip) && camK.eye[0] <= 24100 - 299, `${chip.slice(0, 60)} · eye x ${camK.eye[0].toFixed(0)}`)
    await h.qaGrab(out + 'linked_walk_blocked.png')
    setVal(vsel(), 'exterior')
    await sleep(500)

    // ── SP20 room focus ──
    st().focusRoom(room.id)
    await sleep(1500)
    const cf = await h.scene3dCommand('bim', JSON.stringify({ cmd: 'camFull' }))
    check('SP20 room focus: camera looks at the room, its level selected', Math.abs(cf.at[0] - 22100) < 5 && Math.abs(cf.at[1] - 1800) < 5 && st().level === 'L1', `at ${cf.at.map(Math.round)}`)
    await h.qaGrab(out + 'linked_room_focus.png')

    // ── V24-015 saved viewpoint ──
    await h.scene3dCommand('bim', JSON.stringify({ cmd: 'setCamFull', eye: [30500, -12500, 9500], at: [19000, 3000, 1200], up: [0, 0, 1], fov: 40, ortho: false }))
    st().requestView({ kind: 'saveView' })
    await until(() => st().bookmarks.length > 0, 5000)
    const bm = st().bookmarks.at(-1)
    btn('TOP')?.click()
    await sleep(500)
    st().requestView({ kind: 'bookmark', id: bm.id })
    await sleep(1500)
    const cr = await h.scene3dCommand('bim', JSON.stringify({ cmd: 'camFull' }))
    const dd = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
    check('V24-015 saved view restores position, target, fov, level and records the model revision', dd(cr.eye, bm.eye) < 1 && dd(cr.at, bm.at) < 1 && Math.abs(cr.fov - bm.fov) < 0.01 && st().level === bm.level && bm.revision === st().model.rev && Math.abs(bm.fov - 40) < 0.01, `eye Δ ${dd(cr.eye, bm.eye).toFixed(3)} mm, fov ${cr.fov}, lens ${bm.lens} mm, rev ${bm.revision}`)

    // ── V24-016 slow machine: low-quality fallback, model stable ──
    localStorage.setItem('thcad.view3d.quality', 'low')
    btn('Wireframe').click(); await sleep(200); btn('Shaded').click()
    const fq = await nextFrame(frame())
    const im = new Image(); im.src = fq; await im.decode()
    const q = document.querySelector('[data-testid=native-scene]').dataset.quality
    const full2 = document.querySelector('[data-testid=native-scene]').clientWidth * (window.devicePixelRatio || 1)
    check('V24-016 low quality: half-resolution frames, model unchanged', q === 'low' && im.naturalWidth <= Math.round(full2 / 2) + 1 && JSON.stringify(st().model) === mj0, `${im.naturalWidth}px of ${Math.round(full2)}`)
    localStorage.removeItem('thcad.view3d.quality')
    btn('Wireframe').click(); await sleep(200); btn('Shaded').click()
    await nextFrame(frame())
    log('timings: full load ' + Math.round(full.ms) + ' ms; patches ' + live.syncLog.filter((x) => x.key === 'bim' && x.mode === 'patch').map((x) => `${x.rebuilt.length}@${x.ms.toFixed(1)}ms`).join(' '))
  } catch (e) {
    fails++
    log('FAIL exception ' + e + ' ' + (e.stack || '').split('\n')[1])
  }
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
