// Space Planning (v2.4 M2) — V24-024…031, V24-037 and SP23–SP29 / SP33 logic.
// Run: cd ui && UNIT=spaceplan node tools/test-cam.mjs run
import { CABINETS, ITEMS, ROOMS, cutList, type Room } from '../../src/interior/model'
import { validateInterior, type InteriorDoc } from '../../src/state/interior'
import { undoableActions } from '../../src/state/undoable'
import { assetByKey, searchCatalog, spaceCatalog } from '../../src/interior/catalog'
import { interiorScene, itemPlacements, type InteriorSceneItem } from '../../src/interior/scene'
import { primsBounds, wallFaces } from '../../src/interior/geom'
import { alignToWall, itemBounds, moveInstance, placeAsset, placesOf, replaceInPlace, resizeItem, rotateInstance, setElevation, setHost, setLocked, setPartFinish, duplicateItem, groupItems } from '../../src/interior/layout'
import { checkClearance, fixesFor, DEFAULT_RULES } from '../../src/interior/clearance'
import { materialSpec, uvRepeat } from '../../src/interior/materials'
import { applyChangeSet, generateLayouts, missingInputs, workTriangle } from '../../src/interior/options'
import { manufacturable, productionGate, roomSchedule, confirmDims } from '../../src/interior/production'
import { wallElevation } from '../../src/interior/elevation'
import { doorsFromBim } from '../../src/interior/bimDoors'

const base = (): InteriorDoc => JSON.parse(JSON.stringify({ rooms: ROOMS, items: ITEMS, cabinets: CABINETS }))
const near = (a: number, b: number, tol = 0.5) => Math.abs(a - b) <= tol
const ok = (r: { doc?: InteriorDoc; error?: string }) => {
  if (!r.doc) throw new Error(r.error)
  return r.doc
}
let roomSeq = 0
/** A small room with one 900 mm door, for the generator and checks (each one 8 m further along X). */
function testRoom(id: string, name: string, w: number, d: number, door?: { wall: number; at: number; width?: number }): Room {
  const x = 20000 + 8000 * (roomSeq++), y = 0
  return {
    id, name, ceilingHeight: 2800, floorFinish: 'Wood - Oak', wallFinish: 'Paint - Warm White', ceilingFinish: 'Gypsum - White',
    outline: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + d }, { x, y: y + d }],
    ...(door ? { doors: [{ id: `${id}-d1`, ...door }] } : {}),
  }
}
const sceneItem = (doc: InteriorDoc, id: string) => (interiorScene(doc).items as InteriorSceneItem[]).filter((s) => s.id === id || s.id.startsWith(`${id}::`))
const geomOf = (doc: InteriorDoc, id: string) => JSON.stringify(sceneItem(doc, id).flatMap((s) => s.parts).map((p) => [p.k, p.o.map(Math.round), p.s.map(Math.round)]).sort())

export function run() {
  const r: Record<string, unknown> = {}
  const t0 = Date.now()
  roomSeq = 0

  /* ---------- V24-025 / SP23: real-size catalog, origin convention, bounds in the scene ---------- */
  const chair = assetByKey('Dining Chair')!
  r.chairCatalog = chair && chair.w === 480 && chair.d === 520 && chair.h === 900
  r.searchChair = searchCatalog('dining chair').some((a) => a.key === 'Dining Chair') && searchCatalog('', 'chairs', 'scandi').every((a) => a.cat === 'chairs' && a.styles.includes('scandi'))
  r.catalogSize = spaceCatalog().length
  const d0 = base()
  const placed = placeAsset(d0, chair, 'living', { x: 3000, y: 1800 })
  const dc = ok(placed)
  const cid = placed.id!
  const b = itemBounds(dc, cid, 0)!
  // origin = footprint centre at the bottom: x ± 240, y ± 260, z 0 … 900
  r.V24_025_bounds = near(b.x1 - b.x0, 480) && near(b.y1 - b.y0, 520) && near(b.z1 - b.z0, 900) && near((b.x0 + b.x1) / 2, 3000) && near((b.y0 + b.y1) / 2, 1800) && near(b.z0, 0)
  r.V24_025_sceneItem = (() => {
    const pb = primsBounds(sceneItem(dc, cid).flatMap((s) => s.parts))
    return near(pb.x1 - pb.x0, 480) && near(pb.y1 - pb.y0, 520) && near(pb.z1 - pb.z0, 900)
  })()
  const rot = ok(rotateInstance(dc, cid, 0, 90))
  const br = itemBounds(rot, cid, 0)!
  r.rotate90SwapsBounds = near(br.x1 - br.x0, 520) && near(br.y1 - br.y0, 480)
  // every placeable catalog product: scene bounds == catalog W × D × H (cabinets: doors overlay t in front; lighting: fixture only)
  const bad: string[] = []
  for (const a of spaceCatalog()) {
    const p = placeAsset(base(), a, 'living', { x: 3800, y: 1800 })
    if (!p.doc) {
      bad.push(`${a.key}: ${p.error}`)
      continue
    }
    const free = ok(setHost(p.doc, p.id!, null))
    const q = ok(rotateInstance(free, p.id!, 0, -placesOf(free, p.id!)[0].rot))
    const bb = itemBounds(q, p.id!, 0)!
    const it = q.items.find((i) => i.id === p.id)!
    const dd = a.d + (it.cabinet ? 18 : 0)
    const hOk = a.cat === 'lighting' ? true : near(bb.z1 - bb.z0, a.h, 1)
    if (!(near(bb.x1 - bb.x0, a.w, 1) && near(bb.y1 - bb.y0, dd, 1) && hOk)) bad.push(`${a.key}: ${Math.round(bb.x1 - bb.x0)}×${Math.round(bb.y1 - bb.y0)}×${Math.round(bb.z1 - bb.z0)} vs ${a.w}×${dd}×${a.h}`)
  }
  r.allCatalogBounds = bad.length === 0
  r.boundsMismatch = bad

  /* ---------- SP23: auto-align to the nearest wall, wall hosting ---------- */
  const near1 = ok(placeAsset(base(), assetByKey('Bookshelf 800')!, 'living', { x: 6000, y: 3300 }))
  const bs = near1.items.at(-1)!
  const bsb = itemBounds(near1, bs.id, 0)!
  // living room top wall face: y = 3730 − 50; the bookshelf's back touches it, facing −Y (rot 0)
  r.autoAlignToWall = near(bsb.y1, 3680) && placesOf(near1, bs.id)[0].rot === 0
  const wc = assetByKey('Wall Cabinet 600')!
  const pw = placeAsset(base(), wc, 'dining', { x: 9000, y: 3900 })
  const dw = ok(pw)
  const wci = dw.items.find((i) => i.id === pw.id)!
  const wcb = itemBounds(dw, wci.id, 0)!
  r.wallCabinetHosted = !!wci.host && wci.elev === 1450 && near(wcb.z0, 1450) && near(wcb.z1, 1450 + 720) && near(wcb.y1, 4100 - 50)
  // a hosted item slides along its wall only
  const slid = ok(moveInstance(dw, wci.id, 0, 300, -400))
  const sp = placesOf(slid, wci.id)[0], sp0 = placesOf(dw, wci.id)[0]
  r.hostRuleSlideOnly = near(sp.x - sp0.x, 300) && near(sp.y, sp0.y)
  r.hostNoRotate = rotateInstance(dw, wci.id, 0, 90).error === 'hosted'

  /* ---------- SP25: resize within limits, elevation, lock ---------- */
  r.fixedProductNoResize = !!resizeItem(dc, cid, { w: 600 }).error
  const run = ok(placeAsset(base(), assetByKey('Base Cabinet Run')!, 'dining', { x: 10000, y: 3700 }))
  const runItem = run.items.at(-1)!
  const runBig = resizeItem(run, runItem.id, { w: 1800 })
  r.parametricResize = !!runBig.doc && runBig.doc.cabinets.find((c) => c.id === runItem.cabinet)!.w === 1800 && !resizeItem(run, runItem.id, { w: 4000 }).doc
  const sh = ok(placeAsset(base(), assetByKey('Wall Shelf')!, 'living', { x: 1500, y: 3500 }))
  const shi = sh.items.at(-1)!
  r.elevation = itemBounds(ok(setElevation(sh, shi.id, 1600)), shi.id, 0)!.z0 === 1600 && !!setElevation(sh, shi.id, 2990).error
  const locked = ok(setLocked(dc, cid, true))
  r.lockBlocksEdits = moveInstance(locked, cid, 0, 100, 0).error === 'locked' && rotateInstance(locked, cid, 0, 90).error === 'locked' && replaceInPlace(locked, cid, 'Office Chair').error === 'locked' && resizeItem(locked, cid, { h: 800 }).error === 'locked'
  r.hostSetAligns = (() => {
    const h = ok(setHost(dc, cid, 0))
    const p = placesOf(h, cid)[0]
    return p.rot === 180 && near(itemBounds(h, cid, 0)!.y0, 50) // living room wall 0 is y = 0, face at 50
  })()

  /* ---------- group / duplicate ---------- */
  const dup = duplicateItem(dc, cid, 0)
  const dd = ok(dup)
  const g = ok(groupItems(dd, [cid, dup.id!]))
  const gm = ok(moveInstance(g, cid, 0, 0, -200))
  r.groupMovesTogether = near(placesOf(gm, dup.id!)[0].y, placesOf(dd, dup.id!)[0].y - 200) && near(placesOf(gm, cid)[0].y, 1600)
  r.duplicateBeside = near(placesOf(dd, dup.id!)[0].x, 3000 + 480 + 100)

  /* ---------- V24-026 / SP24: replace in place (same transform, new dimensions, clearance re-checked) ---------- */
  const p0 = placesOf(dc, cid)[0]
  const rep = ok(replaceInPlace(dc, cid, 'Ergonomic Office Chair'))
  const ri = rep.items.find((i) => i.id === cid)!
  const rb = itemBounds(rep, cid, 0)!
  r.V24_026_sameTransform = JSON.stringify(placesOf(rep, cid)[0]) === JSON.stringify(p0)
  r.V24_026_newDims = ri.w === 680 && ri.d === 680 && ri.h === 1200 && near(rb.x1 - rb.x0, 680) && near((rb.x0 + rb.x1) / 2, p0.x)
  // replacing a cabinet by a bigger one re-runs the clearance check: the sample TV cabinet (rot 180, y 280) becomes a 2200 tall unit…
  const tvRep = ok(replaceInPlace(base(), 'i3', 'Tall Cabinet 600'))
  r.V24_026_cabinetReplace = (() => {
    const it = tvRep.items.find((i) => i.id === 'i3')!
    const c = tvRep.cabinets.find((x) => x.id === it.cabinet)!
    return c.w === 600 && c.h === 2200 && JSON.stringify(placesOf(tvRep, 'i3')[0]) === JSON.stringify(placesOf(base(), 'i3')[0]) && cutList(c).find((p) => p.part === 'Side panel')!.l === 2200
  })()
  // … and a replacement that collides is reported with measured overlap and fixes
  const crowd = ok(placeAsset(base(), assetByKey('Armchair')!, 'living', { x: 2600, y: 1500 }))
  const crowdId = crowd.items.at(-1)!.id
  const repBig = ok(replaceInPlace(crowd, crowdId, 'Sofa 2-Seater'))
  const issues = checkClearance(repBig, DEFAULT_RULES, { room: 'living' })
  const col = issues.find((x) => x.kind === 'collision' && x.items.some(([id]) => id === crowdId))
  r.V24_026_clearanceRerun = !!col && (col.measured ?? 0) > 0
  r.collisionMeasured = col?.measured

  /* ---------- SP29: clearance & collision checks, fixes ---------- */
  const sampleIssues = checkClearance(base(), DEFAULT_RULES).filter((x) => x.kind !== 'needsInput')
  r.sampleClean = sampleIssues.length === 0
  r.sampleIssues = sampleIssues.map((x) => x.id)
  // a chair in front of the kitchen base cabinet (drawer pull-out 500 mm)
  const kc = ok(placeAsset(base(), chair, 'dining', { x: 11950, y: 2050 }))
  const kcId = kc.items.at(-1)!.id
  const cl = checkClearance(kc, DEFAULT_RULES, { room: 'dining' }).find((x) => x.kind === 'clearance' && x.items[0][0] === kcId)
  r.clearanceZone = !!cl && cl.required === 500 && (cl.measured ?? 999) < 500
  r.clearanceMeasured = cl && { measured: cl.measured, required: cl.required }
  const fx = cl ? fixesFor(kc, cl) : []
  r.fixes = fx.map((f) => ({ kind: f.kind, dir: f.dir, dist: f.dist, deg: f.deg, after: f.after }))
  const applied = fx[0]?.doc
  r.fixResolves = !!applied && !checkClearance(applied, DEFAULT_RULES, { room: 'dining' }).some((x) => x.id === cl!.id) && (fx[0].after ?? 0) >= 500
  // one undo step for an applied fix
  const st = { doc: kc, undoStack: [] as { label: string; doc: InteriorDoc }[], redoStack: [] as { label: string; doc: InteriorDoc }[] }
  const store = undoableActions<InteriorDoc, typeof st>(() => st, (p) => Object.assign(st, p), validateInterior)
  store.edit('Fix', () => applied!)
  r.fixOneUndo = st.undoStack.length === 1 && (store.undo(), st.doc === kc)
  // blocked door + needs input
  const roomD = testRoom('t1', 'Bedroom T', 3600, 3400, { wall: 0, at: 300, width: 900 })
  const docD: InteriorDoc = { ...base(), rooms: [...base().rooms, roomD] }
  const blk = ok(placeAsset(docD, assetByKey('Nightstand 450')!, 't1', { x: 20750, y: 350 }))
  r.doorBlocked = checkClearance(blk, DEFAULT_RULES, { room: 't1' }).some((x) => x.kind === 'door')
  const noWidth: InteriorDoc = { ...base(), rooms: [...base().rooms, testRoom('t2', 'Bedroom U', 3600, 3400, { wall: 0, at: 300 })] }
  r.doorWidthNeedsInput = checkClearance(noWidth, DEFAULT_RULES, { room: 't2' }).some((x) => x.kind === 'needsInput' && x.missing === 'door.width')
  // circulation: a wardrobe that walls off the bed from the door
  r.labelGuidance = DEFAULT_RULES.circulation === 800 && DEFAULT_RULES.cabinetFront === 500 && DEFAULT_RULES.bedSide === 600

  /* ---------- V24-027 / V24-028: per-part finish changes appearance only; texture period in mm ---------- */
  const before = geomOf(dc, cid)
  const fin = ok(setPartFinish(dc, cid, 'legs', { material: 'Metal - Black' }))
  const parts = sceneItem(fin, cid)
  r.V24_027_geometrySame = geomOf(fin, cid) === before && JSON.stringify(itemBounds(fin, cid)) === JSON.stringify(itemBounds(dc, cid))
  r.V24_027_appearanceChanges = parts.length === 2 && parts.some((s) => s.id === `${cid}::legs` && s.material?.id === 'Metal - Black') && parts.some((s) => s.id === cid && s.material?.id === 'Fabric - Taupe')
  const cabFin = ok(setPartFinish(base(), 'i3', 'front', { material: 'MFC 18 - Oak', grainDeg: 90 }))
  const tvc = cabFin.cabinets.find((c) => c.id === 'c1')!
  r.V24_027_cabinetBoards = tvc.front === 'MFC 18 - Oak' && tvc.board === 'MFC 18 - Walnut' && JSON.stringify(cutList(tvc).map((p) => [p.part, p.l, p.wd, p.t])) === JSON.stringify(cutList(CABINETS[0]).map((p) => [p.part, p.l, p.wd, p.t]))
  const tile = materialSpec('Porcelain Tile - Beige')
  const uv = uvRepeat('Porcelain Tile - Beige', 1200, 600)
  const oak = uvRepeat('Wood - Oak', 3600, 360)
  const oak90 = uvRepeat('Wood - Oak', 3600, 360, 90)
  r.V24_028_tileMm = tile.tileMm[0] === 600 && uv.u === 2 && uv.v === 1 && oak.u === 2 && oak.v === 2 && oak90.u === 20 && near(oak90.v, 0.2, 1e-9)
  r.V24_028_sceneExport = (() => {
    const s = sceneItem(cabFin, 'i3')
    const fr = s.find((x) => x.material?.id === 'MFC 18 - Oak')
    return !!fr && fr.material!.grainDeg === 90 && fr.material!.tileMm[0] === 2800
  })()

  /* ---------- V24-029 / 030 / 031: three layout options ---------- */
  const bedRoom = testRoom('b1', 'Bedroom 3', 3600, 4000, { wall: 0, at: 300, width: 900 })
  const lr = testRoom('l1', 'Living Room 2', 5200, 4200, { wall: 0, at: 300, width: 900 })
  const kr = testRoom('k1', 'Kitchen', 3600, 3000, { wall: 0, at: 2400, width: 900 })
  const docL: InteriorDoc = { ...base(), rooms: [...base().rooms, bedRoom, lr, kr] }
  const snapshot = JSON.stringify(docL)
  const gb = generateLayouts(docL, 'b1', 'bedroom')
  const gl = generateLayouts(docL, 'l1', 'living')
  const gk = generateLayouts(docL, 'k1', 'kitchen')
  const summary = (g: ReturnType<typeof generateLayouts>) => (g.status === 'ok' ? { opts: g.options.map((o) => ({ id: o.id, t: o.template, walls: o.walls, n: o.changes.adds.length, score: o.score })), rejected: g.rejected } : g)
  r.options = { bedroom: summary(gb), living: summary(gl), kitchen: summary(gk) }
  const allOpts = [gb, gl, gk].flatMap((g) => (g.status === 'ok' ? g.options : []))
  r.V24_029_threeOptions = gb.status === 'ok' && gb.options.length === 3 && gl.status === 'ok' && gl.options.length >= 2 && gk.status === 'ok' && gk.options.length >= 2
  r.V24_029_distinctChangeSets = [gb, gl, gk].every((g) => g.status === 'ok' && new Set(g.options.map((o) => JSON.stringify(o.changes.adds.map((i) => [i.catalog, i.at, i.w])))).size === g.options.length)
  r.V24_029_geometryValid = allOpts.every((o) => checkClearance(o.doc, DEFAULT_RULES, { room: o.doc.items.find((i) => o.changes.adds[0].id === i.id)!.room }).filter((x) => x.kind !== 'needsInput').length === 0 && !validateInterior(o.doc))
  r.V24_029_deterministic = JSON.stringify(summary(generateLayouts(docL, 'b1', 'bedroom'))) === JSON.stringify(summary(gb))
  r.V24_029_applyOneUndo = (() => {
    if (gb.status !== 'ok') return false
    const s2 = { doc: docL, undoStack: [] as { label: string; doc: InteriorDoc }[], redoStack: [] as { label: string; doc: InteriorDoc }[] }
    const st2 = undoableActions<InteriorDoc, typeof s2>(() => s2, (p) => Object.assign(s2, p), validateInterior)
    const e = st2.edit('Layout A', (d) => applyChangeSet(d, gb.options[0].changes))
    const appliedOk = !e && s2.doc.items.filter((i) => i.room === 'b1').length === gb.options[0].changes.adds.length
    st2.undo()
    return appliedOk && s2.undoStack.length === 0 && JSON.stringify(s2.doc) === snapshot
  })()
  r.V24_030_rejectIntact = JSON.stringify(docL) === snapshot // generating / previewing / rejecting never mutates the drawing
  const docMissing: InteriorDoc = { ...base(), rooms: [...base().rooms, testRoom('m1', 'Bedroom 4', 3600, 4000, { wall: 0, at: 300 })] }
  const gm1 = generateLayouts(docMissing, 'm1', 'bedroom')
  const gm2 = generateLayouts(base(), 'master', 'bedroom')
  r.V24_031_needsInput = gm1.status === 'needs-input' && gm1.missing.includes('door.width') && gm2.status === 'needs-input' && gm2.missing.includes('door') && missingInputs(bedRoom).length === 0
  // doors measured in the BIM model (room built from a CAD plan): a 900 door 300 mm from the wall start, wall centred 100 mm outside
  const rbd = testRoom('bd', 'Bedroom 5', 3600, 4000)
  const bx = rbd.outline[0].x
  const found = doorsFromBim({ walls: [{ id: 'w1', length: 3600, x: bx, y: -100, angle: 0 }, { id: 'w2', length: 4000, x: bx + 3700, y: 0, angle: 90 }], doors: [{ id: 'd1', mark: 'D1', hostWall: 'w1', offset: 300, width: 900 }, { id: 'd2', mark: 'D2', hostWall: 'w2', offset: 1000, width: 800 }] }, rbd)
  r.doorsFromBim = found.length === 2 && found[0].wall === 0 && found[0].at === 300 && found[0].width === 900 && found[1].wall === 1 && found[1].at === 1000 && generateLayouts({ ...base(), rooms: [...base().rooms, { ...rbd, doors: found }] }, 'bd', 'bedroom').status === 'ok'
  r.kitchenTriangle = gk.status === 'ok' ? gk.options.map((o) => workTriangle(o.doc, 'k1')) : null

  /* ---------- V24-037: room item schedule matches the scene ---------- */
  const sched = roomSchedule(base())
  const scene = interiorScene(base())
  const plc = itemPlacements(base())
  r.V24_037_schedule = sched.length === base().items.length && sched.every((row) => {
    const pl = plc.find((p) => p.item.id === row.item)!
    const inScene = (scene.items as InteriorSceneItem[]).some((s) => s.id === row.item)
    const it = base().items.find((i) => i.id === row.item)!
    const dOk = it.cabinet ? near(row.bounds.d, row.d + 18, 1) : near(row.bounds.d, row.d, 1)
    return inScene && row.count === pl.at.length && row.count === it.qty && near(row.bounds.w, row.w, 1) && dOk && (it.category === 'lighting' || near(row.bounds.h, row.h, 1))
  })
  r.scheduleChairs = sched.find((x) => x.item === 'i5')?.count === 6

  /* ---------- V24-024: no real dimensions → no manufacturing ---------- */
  const ai: InteriorDoc = (() => {
    const d = base()
    d.cabinets.push({ id: 'cai', name: 'AI concept cabinet', room: 'living', w: 1200, d: 400, h: 800, t: 18, shelves: 1, doors: 2, board: 'MFC 18 - Oak', front: 'MFC 18 - Oak', src: { kind: 'ai', reviewRequired: true } })
    d.items.push({ id: 'iai', name: 'AI concept cabinet', category: 'cabinet', room: 'living', w: 1200, d: 400, h: 800, material: 'Wood - Oak', qty: 1, status: 'planned', cabinet: 'cai', src: { kind: 'ai', reviewRequired: true } })
    d.items.push({ id: 'iimg', name: 'Traced sideboard', category: 'cabinet', room: 'living', w: 1500, d: 450, h: 800, material: 'Wood - Oak', qty: 1, status: 'planned', src: { kind: 'image', reviewRequired: true } })
    return d
  })()
  const gate = productionGate(ai)
  r.V24_024_blocked = !manufacturable(ai.items.find((i) => i.id === 'iai')!, ai).ok && manufacturable(ai.items.find((i) => i.id === 'iai')!, ai).reason === 'ai-concept' && manufacturable(ai.items.find((i) => i.id === 'iimg')!, ai).reason === 'image-trace' && gate.blocked.length === 1 && gate.blocked[0].cabinet.id === 'cai' && gate.ok.length === 3
  r.V24_024_sampleOk = manufacturable(base().items.find((i) => i.id === 'i3')!, base()).ok && !manufacturable(base().items.find((i) => i.id === 'i1')!, base()).ok
  r.V24_024_confirm = productionGate(confirmDims(ai, 'iai')).blocked.length === 0

  /* ---------- SP33: cabinet wall elevation ---------- */
  const ke = ok(placeAsset(ok(placeAsset(base(), wc, 'dining', { x: 12000, y: 3900 })), assetByKey('Base Cabinet 600')!, 'dining', { x: 12000, y: 3700 }))
  const top = wallFaces(base().rooms.find((x) => x.id === 'dining')!).find((f) => f.n[1] < -0.9)!
  const el = wallElevation(ke, 'dining', top.index)
  const dims = el.doc.entities.filter((e) => e.kind === 'dimension')
  r.SP33_elevation = el.cabinets.length === 2 && dims.length >= 5 && el.cabinets.some((c) => c.z0 === 1450 && c.z1 === 2170) && el.cabinets.some((c) => c.z0 === 0 && c.z1 === 870) && el.doc.layouts?.[0].paper === 'A3'
  r.SP33_stable = JSON.stringify(wallElevation(ke, 'dining', top.index).doc.entities) === JSON.stringify(el.doc.entities)
  r.elevationCabinets = el.cabinets

  r.ms = Date.now() - t0
  const keys = Object.keys(r).filter((k) => typeof r[k] === 'boolean')
  r.failed = keys.filter((k) => r[k] !== true)
  r.all = keys.every((k) => r[k] === true)
  return r
}
