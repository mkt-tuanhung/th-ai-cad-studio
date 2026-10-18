// Unit tests of the 3D asset library and the photoreal interior render logic (v2.4):
// manifest validation, size fitting, model matching, material mapping, Poly Haven download plans, composed pieces,
// furniture orientation from CAD, render dressing / staging and the architectural auto cameras.
// run: cd ui && UNIT=library node tools/test-cam.mjs run
import { assetFit, fitScale, libCategoriesFor, libMaterialFor, matchAsset, parseManifest, safeRel, type LibAsset } from '../../src/library/assets'
import { PH_LICENSE, planAsset, planHdri, planMaterial, planModel, STARTER_HDRIS, STARTER_MATERIALS, STARTER_MODELS } from '../../src/library/polyhaven'
import { composedPrims, partsFor, presetAssets, PRESETS, validateParts } from '../../src/library/composer'
import { composedDims } from '../../src/library/assets'
import { frontOf, orientItems, rayToOutline } from '../../src/interior/orient'
import { autoViews, diningSet, isDiningSet, materialTable, renderDressing, vfovForLens } from '../../src/renders/interiorRender'
import { interiorScene } from '../../src/interior/scene'
import type { InteriorDoc } from '../../src/state/interior'
import type { Item, Room } from '../../src/interior/model'

const results: [string, boolean, string?][] = []
const t = (name: string, ok: boolean, extra?: unknown) => results.push([name, ok, extra === undefined ? undefined : JSON.stringify(extra)])

const model = (id: string, category: LibAsset['category'], dims: { w: number; d: number; h: number }, extra: Partial<LibAsset> = {}): LibAsset => ({
  id, kind: 'model', name: id, nameVi: id, category, tags: [], dims, files: { main: `${id}.gltf` }, dir: `models/${id}`, source: { site: 'Poly Haven' }, license: PH_LICENSE, addedAt: 1, origin: 'builtin-download', ...extra,
})
const material = (id: string, extra: Partial<LibAsset> = {}): LibAsset => ({
  id, kind: 'material', name: id, nameVi: id, tags: [], files: { maps: { diff: `${id}_diff.jpg` } }, dir: `materials/${id}`, source: { site: 'Poly Haven' }, license: PH_LICENSE, addedAt: 1, origin: 'user-import', ...extra,
})
const rect = (x: number, y: number, w: number, d: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + d }, { x, y: y + d }]
const room = (id: string, x: number, y: number, w: number, d: number): Room => ({ id, name: id, outline: rect(x, y, w, d), ceilingHeight: 3000, floorFinish: 'Porcelain Tile - Beige', wallFinish: 'Paint - Warm White', ceilingFinish: 'Gypsum - White' })
const item = (id: string, p: Partial<Item> & Pick<Item, 'category' | 'h'>, at: { x: number; y: number; rot: number }[], kind?: string): Item & { kind?: string } => ({
  id, name: id, room: 'living', material: 'Fabric - Beige', qty: at.length, status: 'placed', at, ...p, ...(kind ? { kind } : {}),
})

export function run() {
  /* ---------------- manifest */
  const m = parseManifest({
    version: 1,
    items: [
      model('sofa_02', 'sofa', { w: 1807, d: 818, h: 709 }),
      { ...model('evil', 'sofa', { w: 1, d: 1, h: 1 }), dir: '../outside' },
      { ...model('evil2', 'sofa', { w: 1, d: 1, h: 1 }), files: { main: '/etc/passwd' } },
      { ...model('bad id!', 'sofa', { w: 1, d: 1, h: 1 }) },
      { ...model('nofile', 'sofa', { w: 1, d: 1, h: 1 }), files: {} },
      model('sofa_02', 'sofa', { w: 9, d: 9, h: 9 }),
      { id: 'u-1', kind: 'model', name: 'Ghế', dir: 'user/u-1', parts: [{ shape: 'box', x: 0, y: 0, z: 0, w: 500, d: 500, h: 450, material: 'Wood - Oak' }, { shape: 'box', x: 0, y: 0, z: 0, w: -5, d: 1, h: 1 }], origin: 'user-drawn', license: 'tự vẽ' },
      'garbage',
    ],
  })
  t('manifest: valid entries kept, traversal / absolute paths / bad ids / no file / duplicates dropped', m.items.map((a) => a.id).join(',') === 'sofa_02,u-1' && m.items[0].dims?.w === 1807, m.items.map((a) => a.id))
  t('manifest: a composed piece keeps only its valid parts', m.items[1].parts?.length === 1 && m.items[1].origin === 'user-drawn')
  t('safeRel rejects .., absolute, drive letters and backslashes', !safeRel('../a') && !safeRel('/a') && !safeRel('C:/a') && !safeRel('a\\b') && !safeRel('a//b') && safeRel('models/x/y.gltf') === 'models/x/y.gltf')

  /* ---------------- fitting */
  const f = fitScale({ w: 1807, d: 818, h: 709 }, { w: 2400, d: 900, h: 800 })
  t('fit: uniform scale = tightest axis, proportions kept, inside the box', Math.abs(f.s - 900 / 818) < 1e-9 && f.size.w <= 2400 && f.size.d <= 900 + 1e-9 && f.size.h <= 800 && Math.abs(f.size.w / f.size.h - 1807 / 709) < 1e-9, f)
  const turned = assetFit(model('ct', 'coffeeTable', { w: 600, d: 1200, h: 390 }), { w: 1200, d: 650, h: 420 })
  t('fit: a front-less table modelled along y is turned 90° to fill its box', turned.yaw === 90 && turned.fill > 0.75, turned)
  const sofaFit = assetFit(model('s', 'sofa', { w: 900, d: 2000, h: 800 }), { w: 2400, d: 900, h: 800 })
  t('fit: a sofa (it has a front) is never turned to fit', sofaFit.yaw === 0, sofaFit)

  /* ---------------- matching */
  const lib = [
    model('sofa_02', 'sofa', { w: 1807, d: 818, h: 709 }, { style: ['modern'] }),
    model('sofa_03', 'sofa', { w: 2731, d: 925, h: 1118 }, { tags: ['victorian'] }),
    model('dining_chair_02', 'chair', { w: 434, d: 576, h: 973 }),
    model('modern_arm_chair_01', 'armchair', { w: 820, d: 987, h: 1023 }),
    model('GothicBed_01', 'bed', { w: 1494, d: 2040, h: 1534 }, { tags: ['gothic'] }),
    model('ct', 'coffeeTable', { w: 600, d: 1202, h: 390 }),
    ...presetAssets(),
  ]
  const sofa = item('s1', { category: 'sofas', w: 2400, d: 900, h: 800 }, [{ x: 0, y: 0, rot: 0 }], 'sofa')
  t('match: category + closest size (the modern sofa that fits, not the oversize Victorian one)', matchAsset(sofa, lib)?.id === 'sofa_02', matchAsset(sofa, lib)?.id)
  t('match: an explicit asset wins', matchAsset({ ...sofa, asset: 'sofa_03' }, lib)?.id === 'sofa_03')
  t('match: an explicit asset that is gone → no model (the parametric shape stays)', matchAsset({ ...sofa, asset: 'missing' }, lib) === null)
  t('match: a parametric cabinet is never swapped for a model', matchAsset(item('c', { category: 'cabinet', w: 2000, d: 600, h: 2400, cabinet: 'c1' }, [{ x: 0, y: 0, rot: 0 }], 'wardrobe'), lib) === null)
  const bed = item('b', { category: 'beds', w: 1600, d: 2000, h: 500 }, [{ x: 0, y: 0, rot: 0 }], 'bed')
  t('match: no model fits a low CAD bed → the parametric bed preset', matchAsset(bed, lib)?.id === 'preset-bed', matchAsset(bed, lib)?.id)
  const arm = item('a', { category: 'chairs', w: 850, d: 850, h: 850 }, [{ x: 0, y: 0, rot: 0 }], 'chair')
  t('match: a wide chair is an armchair, a narrow one a dining chair', matchAsset(arm, lib)?.id === 'modern_arm_chair_01' && matchAsset({ ...arm, w: 480, d: 560, h: 900 }, lib)?.id === 'dining_chair_02')
  t('categories: tables split by size / name (coffee, side, dining), kinds from CAD first', libCategoriesFor({ category: 'tables', name: 'x', w: 1200, d: 600, h: 420 })[0] === 'coffeeTable' && libCategoriesFor({ category: 'tables', name: 'x', w: 1800, d: 900, h: 750 })[0] === 'diningTable' && libCategoriesFor({ category: 'tables', name: 'x', w: 450, d: 400, h: 550, kind: 'nightstand' })[0] === 'nightstand')

  /* ---------------- materials */
  const mats = [material('my_oak', { appMaterials: ['Wood - Oak'] }), material('oak_floor', { appMaterials: ['Wood - Oak'], tags: ['floor'] }), material('linen', { tags: ['fabric'] })]
  t('material: the texture that names the finish; floors take the floor texture', libMaterialFor('Wood - Oak', mats)?.id === 'my_oak' && libMaterialFor('Wood - Oak', mats, true)?.id === 'oak_floor')
  t('material: else one of its kind (fabric → a fabric texture); tiles / stone / metal stay procedural', libMaterialFor('Fabric - Olive', mats)?.id === 'linen' && libMaterialFor('Porcelain Tile - Beige', mats) === null && libMaterialFor('Metal - Brass', mats) === null)
  const ph = [material('walnut_veneer', { origin: 'builtin-download', appMaterials: [] })]
  t('material: a built-in download follows the current curated mapping', libMaterialFor('Wood - Walnut', ph)?.id === 'walnut_veneer')
  const table = materialTable(['Wood - Oak', 'Porcelain Tile - Beige', 'nonsense', '—'], mats)
  t('material table: PBR library maps for furniture and floors, plain PBR spec otherwise', table['Wood - Oak']?.lib?.id === 'my_oak' && table['Wood - Oak']?.floorLib?.id === 'oak_floor' && !table['Porcelain Tile - Beige']?.lib && table['Porcelain Tile - Beige']?.kind === 'tile' && !('—' in table), Object.keys(table))

  /* ---------------- Poly Haven plans */
  const files = {
    gltf: { '2k': { gltf: { url: 'https://dl.polyhaven.org/file/ph-assets/Models/gltf/2k/sofa_02/sofa_02_2k.gltf', size: 4183, md5: 'd58b', include: { 'sofa_02.bin': { url: 'https://dl.polyhaven.org/file/ph-assets/Models/gltf/4k/sofa_02/sofa_02.bin', size: 74864, md5: '024d' }, 'textures/sofa_02_diff_2k.jpg': { url: 'https://dl.polyhaven.org/file/x.jpg', size: 5, md5: 'aa' } } } } },
  }
  const p = planModel('sofa_02', files, { name: 'Sofa 02', authors: { 'Jane Doe': 'All' }, dimensions: [1807, 818, 709], tags: ['modern'] }, STARTER_MODELS.find((s) => s.id === 'sofa_02')!, 1)
  t('plan: model glTF + bin + textures under models/<id>/, md5 kept, thumbnail, CC0 author in the manifest',
    !!p && p.files.length === 4 && p.files.every((x) => x.path.startsWith('models/sofa_02/')) && p.files[1].md5 === '024d' && p.entry.license === PH_LICENSE && p.entry.source.author === 'Jane Doe' && p.entry.dims?.w === 1807 && p.entry.category === 'sofa' && p.entry.nameVi === 'Sofa văng hiện đại', p)
  t('plan: a non-Poly-Haven URL or a ".." include path refuses the asset',
    planModel('x', { gltf: { '1k': { gltf: { url: 'https://evil.example/x.gltf', size: 1 } } } }, {}, null) === null && planModel('x', { gltf: { '1k': { gltf: { url: 'https://dl.polyhaven.org/a.gltf', size: 1, include: { '../../x': { url: 'https://dl.polyhaven.org/b', size: 1 } } } } } }, {}, null) === null)
  const pm = planMaterial('oak_veneer_01', { Diffuse: { '2k': { jpg: { url: 'https://dl.polyhaven.org/d.jpg', size: 10, md5: 'm' } } }, nor_gl: { '1k': { jpg: { url: 'https://dl.polyhaven.org/n.jpg', size: 10 } } } }, { dimensions: [1830, 1830] }, STARTER_MATERIALS[0], 1)
  t('plan: material maps (2k, else 1k), real size, the finishes it serves', !!pm && pm.entry.files.maps?.diff === 'd.jpg' && pm.entry.files.maps?.nor === 'n.jpg' && pm.entry.sizeMm?.[0] === 1830 && !!pm.entry.appMaterials?.includes('Wood - Oak'), pm?.entry)
  const ph2 = planHdri('studio_garden', { hdri: { '2k': { hdr: { url: 'https://dl.polyhaven.org/h.hdr', size: 100, md5: 'x' } } } }, {}, STARTER_HDRIS[0], 1)
  t('plan: HDRI .hdr with its lighting presets', !!ph2 && ph2.entry.files.main === 'h.hdr' && !!ph2.entry.lighting?.includes('day'))
  t('plan: the starter set covers the interior categories, ~30 materials, 3+ HDRIs', new Set(STARTER_MODELS.map((x) => x.category)).size >= 18 && STARTER_MODELS.length >= 40 && STARTER_MATERIALS.length >= 30 && STARTER_HDRIS.length >= 3)
  t('plan: bad ids are refused', planAsset('model', '../x', files, {}) === null)

  /* ---------------- composer */
  const bedParts = partsFor(presetAssets().find((a) => a.id === 'preset-bed')!, 1800, 2100, 1000)
  const bd = composedDims(bedParts)
  t('composer: a preset is rebuilt at the item size (bed 1800 × 2100, headboard 60 mm wider)', bd.w === 1860 && bd.d === 2100 && bd.h === 1000, bd)
  const user: LibAsset = { ...model('u', 'chair', { w: 500, d: 500, h: 900 }), origin: 'user-drawn', files: {}, parts: PRESETS.find((x) => x.key === 'chair')!.make(500, 500, 900) }
  const scaled = composedDims(partsFor(user, 1000, 1000, 1800))
  t('composer: a user piece scales uniformly into a box', scaled.w === 1000 && scaled.h === 1800, scaled)
  t('composer: OCCT preview prims at the plan placement; validation refuses empty / below-floor parts', composedPrims(bedParts, { x: 1000, y: 0, rot: 90 }).length === bedParts.length && validateParts([]) === 'parts' && validateParts([{ shape: 'box', x: 0, y: 0, z: -5, w: 1, d: 1, h: 1, material: 'Wood - Oak' }]) === 'size' && validateParts(bedParts) === null)

  /* ---------------- orientation from CAD */
  const rooms = [room('living', 0, 0, 4100, 6200), room('bed', 6300, 0, 3300, 4100)]
  const items0 = [
    item('tv', { category: 'cabinet', w: 2200, d: 450, h: 500 }, [{ x: 675, y: 4400, rot: 90 }], 'tvCabinet'),
    item('ct', { category: 'tables', w: 1200, d: 650, h: 420 }, [{ x: 1825, y: 4400, rot: 90 }], 'coffeeTable'),
    item('sofa', { category: 'sofas', w: 2400, d: 900, h: 800 }, [{ x: 3250, y: 4400, rot: 90 }], 'sofa'),
    { ...item('bed1', { category: 'beds', w: 1600, d: 2000, h: 500 }, [{ x: 8600, y: 2100, rot: 90 }], 'bed'), room: 'bed' },
    { ...item('ns', { category: 'tables', w: 450, d: 400, h: 550 }, [{ x: 9350, y: 1055, rot: 90 }, { x: 9350, y: 3175, rot: 90 }], 'nightstand'), room: 'bed' },
  ]
  const o = orientItems(rooms, items0)
  const rot = (id: string, k = 0) => o.find((i) => i.id === id)!.at![k].rot
  t('orient: the TV cabinet (back to the wall) stays, the sofa turns to face its coffee table', rot('tv') === 90 && rot('sofa') === -90, o.map((i) => `${i.id}:${i.at!.map((a) => a.rot)}`))
  t('orient: a bed whose foot stood at the wall turns its headboard to it; nightstands too', rot('bed1') === -90 && rot('ns', 0) === -90 && rot('ns', 1) === -90)
  t('orient: geometry untouched (positions, sizes, counts)', o.every((i, k) => i.at!.every((a, j) => a.x === items0[k].at![j].x && a.y === items0[k].at![j].y) && i.w === items0[k].w))
  const [fx, fy] = frontOf(90)
  t('frontOf / rayToOutline: rot 90 faces +X; the ray from the centre reaches the wall', Math.abs(fx - 1) < 1e-9 && Math.abs(fy) < 1e-9 && Math.abs(rayToOutline(rect(0, 0, 4000, 3000), { x: 1000, y: 1500 }, 1, 0) - 3000) < 1e-6)

  /* ---------------- dressing / staging */
  const doc: InteriorDoc = { rooms, items: [...o, item('dining', { category: 'tables', w: 1800, d: 1900, h: 750, material: 'Wood - Oak' }, [{ x: 2000, y: 1500, rot: 90 }], 'dining')], cabinets: [] }
  const sc = interiorScene(doc, { fullWalls: true, furniture: true })
  const dr = renderDressing(doc, sc, lib, { shell: false })
  const sofaD = dr.items.find((d) => d.item === 'sofa')
  t('dressing: the sofa placeholder is hidden and replaced by the library model, at its plan placement', !!sofaD && sofaD.asset === 'sofa_02' && sofaD.hide.includes('sofa') && sofaD.at[0].x === 3250 && sofaD.file === 'models/sofa_02/sofa_02.gltf', sofaD)
  t('dressing: every floor / wall / furniture surface carries its app finish; ceilings added without a BIM shell', dr.surfaces['room:living'] === 'Porcelain Tile - Beige' && dr.surfaces['walls:living'] === 'Paint - Warm White' && dr.ceilings && dr.rooms.length === 2)
  t('dressing: staging props (rug, TV, table decor) are marked presentation-only and hide nothing', dr.items.filter((d) => d.prop).every((d) => d.hide.length === 0) && dr.items.some((d) => d.item === 'ct#rug') && dr.items.some((d) => d.item === 'tv#tv'))
  const tv = dr.items.find((d) => d.item === 'tv#tv')!
  t('dressing: the TV hangs on the wall behind its cabinet', Math.abs(tv.at[0].x - 25) < 1 && tv.at[0].z > 500, tv.at[0])
  const din = doc.items.find((i) => i.id === 'dining')!
  t('dining set: a dining block as large as a set becomes a table + chairs facing it', isDiningSet(din))
  const ds = diningSet(din, din.at!, lib, ['dining'])
  const chairs = ds.items.find((d) => d.item === 'dining#chairs')!
  const tableD = ds.items.find((d) => d.item === 'dining')!
  const facesTable = chairs.at.every((c) => { const [ax, ay] = frontOf(c.rot); return ax * (2000 - c.x) + ay * (1500 - c.y) > 0 })
  t('dining set: chairs along the long sides, each facing the table; the table fits inside the block', chairs.at.length === 4 && facesTable && tableD.box.w <= 1800 && tableD.box.d <= 1900, { chairs: chairs.at, box: tableD.box })

  /* ---------------- auto views */
  const views = autoViews(doc, 'living', 3)
  const inside = (x: number, y: number) => x > 0 && x < 4100 && y > 0 && y < 6200
  t('views: 3 views of the room', views.length === 3, views.length)
  t('views: eye 1.2–1.4 m, level camera (target at eye height), lens 24–28 mm full-frame equivalent, lens shift', views.every((v) => v.eye[2] >= 1200 && v.eye[2] <= 1400 && v.at[2] === v.eye[2] && v.lensEq >= 24 && v.lensEq <= 28 && v.level && v.shift[1] < 0), views.map((v) => v.eye))
  t('views: eyes inside the room and out of the furniture', views.every((v) => inside(v.eye[0], v.eye[1])) && views.every((v) => !o.some((i) => i.room === 'living' && i.at!.some((a) => Math.hypot(a.x - v.eye[0], a.y - v.eye[1]) < 400))))
  t('views: distinct (positions or directions differ)', new Set(views.map((v) => `${v.eye[0]},${v.eye[1]}`)).size === 3)
  t('views: each looks towards the furniture group', views.every((v) => { const dx = v.at[0] - v.eye[0], dy = v.at[1] - v.eye[1]; return dx * (2500 - v.eye[0]) + dy * (4400 - v.eye[1]) > 0 }))
  t('views: the field of view of a 24 mm full-frame lens on a 16:9 image is 45.7° vertical', Math.abs(vfovForLens(24) - 45.75) < 0.05 && Math.abs(vfovForLens(28) - 39.76) < 0.05, [vfovForLens(24), vfovForLens(28)])

  const all = results.every((r) => r[1])
  return { all, passed: results.filter((r) => r[1]).length, total: results.length, results: results.map(([n, ok, x]) => `${ok ? 'PASS' : 'FAIL'} ${n}${!ok && x ? ' — ' + x : ''}`) }
}
