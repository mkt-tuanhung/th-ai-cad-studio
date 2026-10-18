// "Ảnh mẫu → phong cách nội thất" (v2.4): schema / grammar, palette extraction, finish + model mapping, auto-furnish
// constraints (no overlap, ≥ 800 mm clear at doors, inside the room), locked items, one undo step, determinism.
// Run: cd ui && UNIT=styleref node tools/test-cam.mjs run
import { CABINETS, ITEMS, MATERIALS, ROOMS, type Item, type Room } from '../../src/interior/model'
import { validateInterior, type InteriorDoc } from '../../src/state/interior'
import { undoableActions } from '../../src/state/undoable'
import { assetByKey, itemFromAsset } from '../../src/interior/catalog'
import { checkClearance, DEFAULT_RULES } from '../../src/interior/clearance'
import { primBounds, primPoly, satOverlap, wallFaces } from '../../src/interior/geom'
import { itemPartPrims, itemPlacements } from '../../src/interior/scene'
import { libMaterialFor, parseManifest, type LibAsset } from '../../src/library/assets'
import { STARTER_MATERIALS } from '../../src/library/polyhaven'
import { deltaE, extractPalette, kmeansPalette, labOfHex, type Pixels } from '../../src/interior/palette'
import { basicAnalysis, FINISHES, finishById, finishesFor, FURN_CATS, libIdOf, parseModelAnswer, STYLE_DEFAULTS, STYLE_KEYS, STYLE_SYSTEM, styleGrammar, stylePrompt, SURFACES, validateAnalysis, type StyleAnalysis } from '../../src/interior/styleRef'
import { styleViews } from '../../src/interior/styleViews'
import { autoViews } from '../../src/renders/interiorRender'
import { boardFor, DEFAULT_APPLY, doorClearance, insideRoom, lightingPreset, planStyle, restyleItem, styleAssetFor } from '../../src/interior/styleApply'

/** Grammar + prompt for a palette (QA: the real model run uses exactly these). */
export function grammar() {
  const palette = [{ hex: '#f2efe9', role: 'wall' as const, share: 0.42 }, { hex: '#b58a5e', role: 'floor' as const, share: 0.22 }, { hex: '#2f4f86', role: 'accent' as const, share: 0.08 }]
  return { system: STYLE_SYSTEM, grammar: styleGrammar(), prompt: stylePrompt(palette, 1) }
}

/** A real answer of Qwen2.5-VL-7B (Q4_K_M, llama-mtmd-cli b11429, this grammar) for the CC0 photo "Living room (Unsplash)". */
const REAL_ANSWER = '{"style":"scandinavian","materials":{"floor":"herringbone_oak","walls":"warm_white","ceiling":"warm_white","joinery":"white_lacquer","upholstery":"fabric_blue","metal":"chrome","stone":"none"},"furniture":[{"category":"sofa","hint":"ghế sofa màu xanh dương, vải nhung"},{"category":"chair","hint":"ghế bọc da màu trắng, chân kim loại"},{"category":"tvCabinet","hint":"tủ tivi màu trắng, mặt kính"}],"lighting":{"tone":"neutral","time":"day"},"confidence":0.95,"description":"Phòng khách phong cách Scandinavian với màu sắc trung tính, nội thất đơn giản và hiện đại, sử dụng gỗ sồi herringbone và vải nhung màu xanh dương."}'

/* ---------------- synthetic photos ---------------- */

/** An RGBA image painted by a function of (x, y). */
function paint(w: number, h: number, f: (x: number, y: number) => [number, number, number]): Pixels {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = f(x, y)
      const i = (y * w + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  return { data, w, h }
}
/** White flat wall above, oak planks (grain stripes) below, a blue sofa block in the middle. */
const living = () =>
  paint(160, 120, (x, y) => {
    if (y > 84) return (x + Math.floor(y / 3)) % 7 < 2 ? [150, 104, 62] : [176, 128, 82] // planks with grain
    if (y > 58 && x > 40 && x < 120) return [47, 85, 151] // blue sofa
    return [240, 236, 228] // warm white wall
  })
/** Red brick wall (bricks + mortar) above a grey concrete floor. */
const loft = () =>
  paint(160, 120, (x, y) => {
    if (y > 84) return [128, 126, 122]
    const row = Math.floor(y / 6), off = row % 2 ? 9 : 0
    return y % 6 === 0 || (x + off) % 18 === 0 ? [170, 160, 150] : [150, 78, 56]
  })

/* ---------------- rooms ---------------- */

let seq = 0
function room(id: string, name: string, w: number, d: number, door?: { wall: number; at: number; width?: number }): Room {
  const x = 30000 + 9000 * seq++, y = 0
  return {
    id, name, ceilingHeight: 2800, floorFinish: 'Porcelain Tile - Beige', wallFinish: 'Paint - Warm White', ceilingFinish: 'Gypsum - White',
    outline: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + d }, { x, y: y + d }],
    ...(door ? { doors: [{ id: `${id}-d1`, ...door }] } : {}),
  }
}
const base = (): InteriorDoc => JSON.parse(JSON.stringify({ rooms: ROOMS, items: ITEMS, cabinets: CABINETS }))

/** Independent geometry checks of a room (not the planner's own): pairwise overlap of active items, inside, doors. */
function geometry(doc: InteriorDoc, roomId: string) {
  const r = doc.rooms.find((x) => x.id === roomId)!
  const solids = itemPlacements(doc).filter((p) => p.room.id === roomId && p.item.category !== 'rugs').flatMap((p) => p.at.map((at, k) => ({ id: `${p.item.id}#${k}`, parts: itemPartPrims(doc, p.item, p.room, [at]).map((t) => ({ poly: primPoly(t.prim), b: primBounds(t.prim) })) })))
  let overlaps = 0
  for (let i = 0; i < solids.length; i++)
    for (let j = i + 1; j < solids.length; j++)
      for (const p of solids[i].parts)
        for (const q of solids[j].parts) if (Math.min(p.b.z1, q.b.z1) - Math.max(p.b.z0, q.b.z0) > 1 && satOverlap(p.poly, q.poly) > 5) overlaps++
  return { overlaps, inside: insideRoom(doc, r), door: doorClearance(doc, r, 800) }
}

const fakeLib = (): LibAsset[] =>
  parseManifest({
    items: [
      { id: 'sofa_02', kind: 'model', name: 'Modern sofa', nameVi: 'Sofa văng hiện đại', category: 'sofa', tags: ['sofa'], style: ['modern'], dims: { w: 2200, d: 950, h: 800 }, files: { main: 'sofa_02.gltf' }, dir: 'models/sofa_02', source: { site: 'Poly Haven' }, license: 'CC0', addedAt: 1, origin: 'builtin-download' },
      { id: 'sofa_03', kind: 'model', name: 'Chesterfield leather sofa', nameVi: 'Sofa da cổ điển', category: 'sofa', tags: ['sofa', 'chesterfield', 'leather'], style: ['classic'], dims: { w: 2200, d: 950, h: 800 }, files: { main: 'sofa_03.gltf' }, dir: 'models/sofa_03', source: { site: 'Poly Haven' }, license: 'CC0', addedAt: 1, origin: 'builtin-download' },
      { id: 'hanging_industrial_lamp', kind: 'model', name: 'Hanging industrial lamp', nameVi: 'Đèn thả công nghiệp', category: 'pendant', tags: ['lamp'], dims: { w: 400, d: 400, h: 500 }, files: { main: 'l.gltf' }, dir: 'models/l', source: { site: 'Poly Haven' }, license: 'CC0', addedAt: 1, origin: 'builtin-download' },
      { id: 'modern_ceiling_lamp_01', kind: 'model', name: 'Modern ceiling lamp', nameVi: 'Đèn thả kính', category: 'pendant', tags: ['lamp'], style: ['modern'], dims: { w: 400, d: 400, h: 500 }, files: { main: 'm.gltf' }, dir: 'models/m', source: { site: 'Poly Haven' }, license: 'CC0', addedAt: 1, origin: 'builtin-download' },
      ...STARTER_MATERIALS.map((m) => ({ id: m.id, kind: 'material', name: m.id, nameVi: m.vi, tags: [], files: { maps: { diff: 'd.jpg' } }, dir: `materials/${m.id}`, source: { site: 'Poly Haven' }, license: 'CC0', addedAt: 1, origin: 'builtin-download' })),
    ],
  }).items

export function run() {
  const r: Record<string, unknown> = {}
  const t0 = Date.now()
  seq = 0

  /* ---------- schema + grammar ---------- */
  const g = styleGrammar()
  const defined = new Set([...g.matchAll(/^([a-z][a-z-]*) ::=/gm)].map((m) => m[1]))
  const used = new Set([...g.replace(/"(?:[^"\\]|\\.)*"/g, '').replace(/\[[^\]]*\]/g, '').matchAll(/\b([a-z][a-z-]*)\b/g)].map((m) => m[1]))
  r.grammarRulesDefined = [...used].every((u) => defined.has(u)) && defined.has('root')
  r.grammarEverySurface = SURFACES.every((s) => g.includes(`m-${s} ::=`) && finishesFor(s).every((f) => g.split('\n').find((l) => l.startsWith(`m-${s} ::=`))!.includes(`\\"${f.id}\\"`)))
  r.grammarNoForeignFinish = !g.split('\n').find((l) => l.startsWith('m-floor ::='))!.includes('brick') && g.includes('"\\"none\\""')
  r.grammarStyles = STYLE_KEYS.every((k) => g.includes(`\\"${k}\\"`)) && FURN_CATS.every((c) => g.includes(`\\"${c}\\"`))
  const pal = [{ hex: '#f2efe9', role: 'wall' as const, share: 0.42 }, { hex: '#b58a5e', role: 'floor' as const, share: 0.22 }]
  const real = parseModelAnswer(REAL_ANSWER, pal, { model: 'Qwen2.5-VL-7B-Instruct-Q4_K_M', ms: 14000, images: 1 })
  r.realAnswerValid = real.ok && real.value.style === 'scandinavian' && real.value.materials.floor === 'herringbone_oak' && real.value.materials.stone === null && real.value.furniture.length === 3 && real.value.source === 'model' && real.value.palette.length === 2
  const bad = (patch: Record<string, unknown>) => !parseModelAnswer(JSON.stringify({ ...JSON.parse(REAL_ANSWER), ...patch }), pal).ok
  r.rejectUnknownStyle = bad({ style: 'baroque' })
  r.rejectFinishOnWrongSurface = bad({ materials: { ...JSON.parse(REAL_ANSWER).materials, floor: 'brick' } })
  r.rejectUnknownFinish = bad({ materials: { ...JSON.parse(REAL_ANSWER).materials, walls: 'gold_leaf' } })
  r.rejectConfidence = bad({ confidence: 1.5 })
  r.rejectShortDescription = bad({ description: 'ok' })
  r.rejectCategory = bad({ furniture: [{ category: 'spaceship', hint: '' }] })
  r.rejectNotJson = !parseModelAnswer('the style is modern', pal).ok
  r.rejectBadPaletteHex = !validateAnalysis({ ...(real.ok ? real.value : {}), palette: [{ hex: 'red', role: 'wall', share: 0.5 }] }).ok
  r.everyFinishIsAnAppMaterial = FINISHES.every((f) => MATERIALS.some((m) => m.name === f.app) && f.surfaces.length > 0)
  r.finishIdsUnique = new Set(FINISHES.map((f) => f.id)).size === FINISHES.length
  r.styleDefaultsValid = STYLE_KEYS.every((k) => SURFACES.every((s) => { const id = STYLE_DEFAULTS[k].materials[s]; return id === null ? s === 'stone' : !!finishById(id)?.surfaces.includes(s) }))

  /* ---------- palette ---------- */
  const p1 = kmeansPalette([living()])
  const p2 = kmeansPalette([living()])
  r.paletteDeterministic = JSON.stringify(p1) === JSON.stringify(p2)
  const near = (hex: string, want: string, tol = 8) => deltaE(labOfHex(hex), labOfHex(want)) < tol
  const roles = extractPalette([living()])
  const wall = roles.find((s) => s.role === 'wall'), floor = roles.find((s) => s.role === 'floor'), accent = roles.find((s) => s.role === 'accent')
  r.paletteWall = !!wall && near(wall.hex, '#f0ece4') && wall.top > 0.5 && wall.texture < 3
  r.paletteFloor = !!floor && (near(floor.hex, '#b08052', 14)) && floor.bottom > 0.8 && floor.texture > 4
  r.paletteAccent = !!accent && near(accent.hex, '#2f5597')
  r.paletteShares = Math.abs(roles.reduce((a, s) => a + s.share, 0) - 1) < 1e-6 && roles.length <= 6
  r.paletteDetail = roles.map((s) => `${s.hex} ${s.role} ${Math.round(s.share * 100)}% tex ${s.texture.toFixed(1)}`)
  const basic = basicAnalysis(roles)
  r.basicValid = validateAnalysis(basic).ok && basic.source === 'basic' && basic.confidence <= 0.4
  r.basicWoodFloor = ['oak', 'ash', 'walnut'].includes(basic.materials.floor ?? '') && ['warm_white', 'pure_white', 'greige'].includes(basic.materials.walls ?? '')
  r.basicBlueUpholstery = basic.materials.upholstery === 'fabric_blue'
  const lb = basicAnalysis(extractPalette([loft()]))
  r.basicBrickIndustrial = lb.materials.walls === 'brick' && lb.style === 'industrial' && lb.materials.floor === 'concrete'
  r.basicDetail = { living: [basic.style, basic.materials], loft: [lb.style, lb.materials] }

  /* ---------- finish → library texture / model mapping ---------- */
  const lib = fakeLib()
  r.libTextureIds = libIdOf(finishById('herringbone_oak')!, 'floor') === 'herringbone_parquet' && libIdOf(finishById('oak')!, 'floor') === 'wood_floor' && libIdOf(finishById('oak')!, 'joinery') === 'oak_veneer_01' && libIdOf(finishById('concrete')!, 'walls') === 'rough_concrete' && libIdOf(finishById('warm_white')!, 'walls') === null
  r.libMaterialForNewFinishes = libMaterialFor('Concrete - Grey', lib)?.id === 'rough_concrete' && libMaterialFor('Parquet - Herringbone Oak', lib, true)?.id === 'herringbone_parquet' && libMaterialFor('Fabric - Blue', lib)?.id === 'velour_velvet' && libMaterialFor('Brick - Red', lib) === null
  const a0 = real.ok ? real.value : basic
  const asStyle = (style: StyleAnalysis['style']): StyleAnalysis => ({ ...a0, style })
  const sofa: Item = { id: 's', name: 'Sofa', category: 'sofas', room: 'living', w: 2200, d: 950, h: 800, material: 'Fabric - Beige', qty: 1, status: 'placed' }
  r.modelScandiSofa = styleAssetFor(sofa, lib, asStyle('scandinavian'))?.id === 'sofa_02'
  r.modelClassicSofa = styleAssetFor(sofa, lib, asStyle('classic'))?.id === 'sofa_03'
  const pend: Item = { id: 'p', name: 'Pendant', category: 'lighting', room: 'living', dia: 400, h: 500, material: 'Metal - Black', qty: 1, status: 'placed' }
  r.modelIndustrialLamp = styleAssetFor(pend, lib, asStyle('industrial'))?.id === 'hanging_industrial_lamp' && styleAssetFor(pend, lib, asStyle('modern'))?.id === 'modern_ceiling_lamp_01'
  r.noModelForCabinet = styleAssetFor({ ...sofa, category: 'cabinet', cabinet: 'c1' }, lib, a0) === null
  const rs = restyleItem(sofa, a0, 'Fabric - Linen')
  r.restyleSofa = rs.material === 'Fabric - Blue' && rs.parts?.body?.material === 'Fabric - Blue' && rs.w === 2200 && rs.h === 800 && rs.assetFinish === 'item'
  r.restyleLockedUntouched = restyleItem({ ...sofa, locked: true }, a0, 'Fabric - Linen').material === 'Fabric - Beige'
  const cabItem = ITEMS.find((i) => i.cabinet)!
  r.restyleCabinetKeepsBoards = (() => { const x = restyleItem(cabItem, a0, 'x'); return x.parts?.body === undefined && x.cabinet === cabItem.cabinet })()
  r.boardFor = boardFor('Wood - Oak') === 'MFC 18 - Oak' && boardFor('Wood - Dark Stained') === 'MFC 18 - Walnut' && boardFor('Lacquer - White') === null
  r.lightingPresets = lightingPreset({ lighting: { tone: 'neutral', time: 'day' } }) === 'day' && lightingPreset({ lighting: { tone: 'warm', time: 'day' } }) === 'golden' && lightingPreset({ lighting: { tone: 'warm', time: 'evening' } }) === 'night'

  /* ---------- auto-furnish: constraints, options, locked items, one undo step ---------- */
  const lv = room('sl', 'Living Room S', 5200, 4200, { wall: 0, at: 400, width: 900 })
  const locked = itemFromAsset(assetByKey('Potted Plant')!, 'sl', { x: lv.outline[2].x - 400, y: lv.outline[2].y - 400, rot: 0 }, { item: 'locked-plant' }).item
  const doc: InteriorDoc = { ...base(), rooms: [...base().rooms, lv], items: [...base().items, { ...locked, locked: true }] }
  const snap = JSON.stringify(doc)
  const an: StyleAnalysis = { ...a0, furniture: [...a0.furniture, { category: 'rug', hint: '' }, { category: 'plant', hint: '' }] }
  const plan = planStyle(doc, 'sl', an, lib, DEFAULT_APPLY, { rules: DEFAULT_RULES })
  const layouts = plan.options.filter((o) => o.kind === 'layout')
  r.planOk = plan.status === 'ok' && layouts.length >= 1 && layouts.length <= 3 && plan.options.some((o) => o.id === 'K')
  r.planSummary = plan.options.map((o) => `${o.id} ${o.template ?? 'restyle'} +${o.added.length} door ${o.checks.doorClear} ok ${o.checks.ok}`)
  const geo = plan.options.map((o) => ({ id: o.id, ...geometry(o.doc, 'sl'), valid: validateInterior(o.doc) }))
  r.noOverlap = geo.every((x) => x.overlaps === 0)
  r.insideRoom = geo.every((x) => x.inside)
  r.doorClear800 = geo.every((x) => x.door.min >= 800 && x.door.blocked.length === 0)
  r.validDocs = geo.every((x) => x.valid === null)
  r.plannerChecksAgree = plan.options.every((o) => o.checks.ok && o.checks.collisions === 0 && o.checks.outside === 0)
  r.noNewClearanceIssues = plan.options.every((o) => checkClearance(o.doc, DEFAULT_RULES, { room: 'sl' }).filter((x) => x.kind !== 'needsInput').length === 0)
  r.realSizes = layouts.every((o) => o.doc.items.filter((i) => i.room === 'sl' && i.catalog && i.catalog !== 'Area Rug').every((i) => { const c = assetByKey(i.catalog)!; return c.limits.w[0] <= (i.w ?? i.dia ?? 0) && (i.w ?? i.dia ?? 0) <= c.limits.w[1] && i.h === c.h }))
  r.lockedKept = plan.options.every((o) => JSON.stringify(o.doc.items.find((i) => i.id === 'locked-plant')) === JSON.stringify(doc.items.find((i) => i.id === 'locked-plant')))
  r.finishesApplied = plan.options.every((o) => { const x = o.doc.rooms.find((y) => y.id === 'sl')!; return x.floorFinish === 'Parquet - Herringbone Oak' && x.wallFinish === 'Paint - Warm White' })
  r.extrasRugPlant = layouts.some((o) => o.doc.items.some((i) => i.room === 'sl' && i.category === 'rugs'))
  r.otherRoomsUntouched = plan.options.every((o) => JSON.stringify(o.doc.items.filter((i) => i.room !== 'sl')) === JSON.stringify(doc.items.filter((i) => i.room !== 'sl')) && JSON.stringify(o.doc.rooms.filter((x) => x.id !== 'sl')) === JSON.stringify(doc.rooms.filter((x) => x.id !== 'sl')))
  r.cabinetBoardsUntouchedByDefault = plan.options.every((o) => JSON.stringify(o.doc.cabinets.filter((c) => doc.cabinets.some((d) => d.id === c.id))) === JSON.stringify(doc.cabinets))
  r.nothingAppliedBeforePick = JSON.stringify(doc) === snap
  r.deterministic = JSON.stringify(planStyle(doc, 'sl', an, lib, DEFAULT_APPLY, { rules: DEFAULT_RULES }).options.map((o) => o.doc)) === JSON.stringify(plan.options.map((o) => o.doc))
  r.oneUndoStep = (() => {
    const s2 = { doc, undoStack: [] as { label: string; doc: InteriorDoc }[], redoStack: [] as { label: string; doc: InteriorDoc }[] }
    const st2 = undoableActions<InteriorDoc, typeof s2>(() => s2, (p) => Object.assign(s2, p), validateInterior)
    const e = st2.edit('Style A', () => plan.options[0].doc)
    const applied = !e && s2.undoStack.length === 1 && s2.doc === plan.options[0].doc
    st2.undo()
    return applied && JSON.stringify(s2.doc) === snap
  })()
  // explicit opt-in: joinery → cabinet boards of the room (a walnut style on a room with a parametric cabinet)
  const kc = room('sk', 'Living Room K', 5200, 4200, { wall: 0, at: 400, width: 900 })
  const tv = itemFromAsset(assetByKey('Wardrobe (parametric)')!, 'sk', { x: kc.outline[3].x + 1300, y: kc.outline[3].y - 350, rot: 180 }, { item: 'wk', cabinet: 'cwk' })
  const docK: InteriorDoc = { ...base(), rooms: [...base().rooms, kc], items: [...base().items, tv.item], cabinets: [...base().cabinets, tv.cabinet!] }
  const walnut: StyleAnalysis = { ...an, style: 'classic', materials: { ...an.materials, joinery: 'walnut' } }
  const kOpt = planStyle(docK, 'sk', walnut, lib, { ...DEFAULT_APPLY, furnish: false, cabinetBoards: true }).options[0]
  r.cabinetBoardsOptIn = kOpt.boards.length === 1 && kOpt.doc.cabinets.find((c) => c.id === 'cwk')!.board === 'MFC 18 - Walnut' && kOpt.doc.cabinets.find((c) => c.id === 'cwk')!.w === tv.cabinet!.w
  r.cabinetBoardsOffByDefault = planStyle(docK, 'sk', walnut, lib, { ...DEFAULT_APPLY, furnish: false }).options[0].doc.cabinets.find((c) => c.id === 'cwk')!.board === tv.cabinet!.board
  // a room without a door: layouts need input (never guessed) — restyle is still offered
  const nd = room('sn', 'Living Room N', 5000, 4000)
  const pn = planStyle({ ...base(), rooms: [...base().rooms, nd] }, 'sn', an, lib)
  r.noDoorNeedsInput = pn.status === 'needs-input' && pn.missing.includes('door') && pn.options.length === 1 && pn.options[0].id === 'K'
  // doors measured in the BIM model are used (listed for the user)
  const bd = room('sb', 'Living Room B', 5000, 4000)
  const o = bd.outline[0]
  const bim = { walls: [{ id: 'w1', length: 5000, x: o.x, y: o.y, angle: 0 }], doors: [{ id: 'd1', mark: 'D1', hostWall: 'w1', offset: 600, width: 900 }] }
  const pb = planStyle({ ...base(), rooms: [...base().rooms, bd] }, 'sb', an, lib, DEFAULT_APPLY, { bim })
  r.doorsFromBim = pb.status === 'ok' && pb.options[0].doors.length === 1 && pb.options[0].doors[0].width === 900 && pb.options.every((x) => x.checks.doorClear >= 800)
  // the 800 mm door check itself: an item right in front of a door is caught
  const blocker = itemFromAsset(assetByKey('Armchair')!, 'sl', { x: lv.outline[0].x + 400 + 450, y: lv.outline[0].y + 50 + 500, rot: 0 }, { item: 'blk' }).item
  r.doorCheckCatches = doorClearance({ ...doc, items: [...doc.items, blocker] }, lv).blocked.includes('blk') && doorClearance(doc, lv).min >= 800
  r.wallFacesSane = wallFaces(lv).length === 4

  r.ms = Date.now() - t0
  const skip = new Set(['ms', 'planSummary', 'paletteDetail', 'basicDetail'])
  const failed = Object.entries(r).filter(([k, v]) => !skip.has(k) && v !== true).map(([k]) => k)
  return { all: failed.length === 0, failed, ...r }
}

/** QA: style cameras vs the Interior auto views for a dumped interior document (argument: JSON file). */
export function views(json: string) {
  const doc = JSON.parse(json) as InteriorDoc
  const room = doc.rooms.find((r) => /KH/i.test(r.name)) ?? doc.rooms[0]
  return { room: room.id, style: styleViews(doc, room.id, 2).map((v) => [v.eye, v.at, v.lensEq]), auto: autoViews(doc, room.id, 2).map((v) => [v.eye, v.at]) }
}
