// Interaction smoke test — BIM / Interior "Build from CAD plans" (DWG/DXF floor plans → BIM model, Interior data).
// Fresh profile, dev server :5173. Uses the SYNTHETIC fixtures in qa/fixtures/bim (tools/make-plan-fixtures.mjs).
import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const FX = new URL('../../qa/fixtures/bim/', import.meta.url).pathname
const SHOTS = new URL('../../qa/fromcad/', import.meta.url).pathname
;(await import('node:fs')).mkdirSync(SHOTS, { recursive: true })
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1586, height: 992 } })
ctx.setDefaultTimeout(8000)
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
const results = []
const step = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]) } catch (e) { results.push(['FAIL', name + ' — ' + e.message.split('\n')[0]]) }
}
await page.addInitScript(() => {
  if (!sessionStorage.getItem('seeded')) {
    localStorage.setItem('thcad.settings', JSON.stringify({ state: { language: 'en' }, version: 1 }))
    sessionStorage.setItem('seeded', '1')
  }
})
await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/#/bim', { waitUntil: 'networkidle' })
const dlg = () => page.getByTestId('fromcad')
const summary = () => page.getByTestId('fromcad-summary').innerText()
const bim = () => page.evaluate(() => JSON.parse(localStorage.getItem('thcad.bim') ?? '{}').state?.model)
const interior = () => page.evaluate(() => JSON.parse(localStorage.getItem('thcad.interior') ?? '{}').state?.doc)
const openDialog = async () => {
  await page.getByRole('button', { name: /More Tools/ }).click()
  await page.getByRole('menuitem', { name: 'Build from CAD plans…' }).click()
  await dlg().waitFor()
}
let before

await step('BIM → More Tools → Build from CAD plans opens the dialog; a DXF (TCVN3 texts) is read and its layers get roles from their names', async () => {
  before = await bim()
  await openDialog()
  await page.getByTestId('fromcad-file').setInputFiles(FX + 'house_vn_SYNTHETIC.dxf')
  await page.getByRole('table', { name: 'Layer roles' }).waitFor()
  assert.equal(await page.getByLabel('Role: TUONG').inputValue(), 'wall')
  assert.equal(await page.getByLabel('Role: CUA').inputValue(), 'door')
  assert.equal(await page.getByLabel('Role: COT').inputValue(), 'column')
  assert.equal(await page.getByLabel('Role: TEN PHONG').inputValue(), 'room')
  assert.equal(await page.getByLabel('Role: NOI THAT').inputValue(), 'furniture')
  assert.equal(await page.getByLabel('Role: KICH THUOC').inputValue(), 'ignore')
})

await step('Both plans are found with level and elevation from their titles; the preview and the counts are shown', async () => {
  const plans = page.getByRole('table', { name: 'Plans in the drawing' })
  await plans.getByText('MẶT BẰNG TẦNG 1 COS ±0.000', { exact: false }).waitFor()
  assert.equal(await page.getByLabel(/^Level name: MẶT BẰNG TẦNG 1/).inputValue(), 'Tầng 1')
  assert.equal(await page.getByLabel(/^Elevation \(mm\): MẶT BẰNG TẦNG 2/).inputValue(), '3600')
  await page.getByTestId('fromcad-preview').waitFor()
  assert.match(await summary(), /3 levels · 18 walls · 9 doors · 13 windows · 10 rooms · 12 columns · 18 furniture/)
  assert.match(await dlg().innerText(), /Storeys aligned on grid 1 \/ A/)
  assert.match(await plans.innerText(), /9 walls · 5 doors · 6 windows · 5 rooms/)
  await page.getByRole('dialog').screenshot({ path: SHOTS + 'fromcad_dialog_en.png' })
})

await step('Changing a layer role re-recognises (CUA → Ignore: no symbols, the gaps become plain openings); the role is marked “You”', async () => {
  await page.getByLabel('Role: CUA').selectOption('ignore')
  assert.match(await summary(), / 0 windows /)
  assert.match(await dlg().innerText(), /openings without a door \/ window symbol/)
  await page.getByLabel('Role: CUA').selectOption('door')
  assert.match(await summary(), /9 doors · 13 windows/)
  assert.ok((await dlg().innerText()).includes('You'))
})

await step('AI suggestion needs the desktop app (button disabled in the browser, no fake result)', async () => {
  assert.equal(await page.getByTestId('fromcad-ai').isDisabled(), true)
})

await step('Interior option: rooms, furniture and cabinets of Tầng 1 for the cut list', async () => {
  await page.getByTestId('fromcad-interior').check()
  assert.match(await summary(), /Interior: 5 rooms · 9 furniture items · 4 cabinets for the cut list/)
})

await step('Approve & build: one BIM edit — levels, walls with openings, exact room areas, slabs; the 3D view is opened', async () => {
  await page.getByTestId('fromcad-approve').click()
  await page.getByText(/Model built from house_vn_SYNTHETIC\.dxf/).waitFor()
  const m = await bim()
  assert.deepEqual(m.levels.map((l) => [l.name, l.elevation]), [['Tầng 1', 0], ['Tầng 2', 3600], ['Roof', 6900]])
  assert.equal(m.walls.length, 18)
  assert.equal(m.doors.length, 9)
  assert.equal(m.windows.length, 13)
  assert.deepEqual(m.rooms.filter((r) => r.level === 'L1').map((r) => [r.name, r.area]).sort(), [['BẾP + ĂN', 15.6], ['PHÒNG KHÁCH', 24.19], ['PHÒNG NGỦ 1', 24.19], ['PHÒNG NGỦ 2', 26.94], ['WC', 5.32]])
  assert.deepEqual(m.slabs.map((s) => s.kind), ['floor', 'floor', 'roof'])
  assert.deepEqual([...new Set(m.wallTypes.map((t) => t.thickness))].sort(), [110, 220])
  assert.ok(m.doors.some((d) => d.mark === 'Đ5' && d.width === 1600 && d.height === 2400), 'main door tag + size')
  assert.ok(m.windows.some((w) => w.mark === 'S2' && w.height === 1400), 'window size from its tag')
})

await step('Model checks pass on the built model (no host-wall, overlap or zero-length errors)', async () => {
  await page.getByRole('button', { name: 'Check Model' }).click()
  const card = await page.getByText('Model Coordination').locator('..').locator('..').innerText()
  assert.match(card, /No critical issues/)
  assert.match(card, /No conflicts/)
})

await step('Interior data replaced: rooms with outlines, furniture placed, cabinets in the cut list and nesting', async () => {
  const d = await interior()
  assert.equal(d.rooms.length, 5)
  assert.ok(d.items.every((i) => i.at?.length === i.qty), 'every item placed')
  assert.equal(d.cabinets.length, 4)
  await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/#/interior', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Cut List/ }).first().click()
  const t = await page.locator('body').innerText()
  assert.match(t, /Wardrobe/)
  assert.match(t, /Kitchen cabinet/)
  await page.getByRole('button', { name: /More Tools/ }).click()
  await page.getByRole('menuitem', { name: 'Nesting (CAM)' }).click()
  await page.getByText(/sheet/i).first().waitFor()
  await page.keyboard.press('Escape')
})

await step('Undo restores the previous BIM model (one step)', async () => {
  await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/#/bim', { waitUntil: 'networkidle' })
  await page.locator('body').click({ position: { x: 5, y: 500 } })
  await page.keyboard.press('Meta+z')
  await page.waitForTimeout(300)
  const m = await bim()
  // a fresh profile has not persisted the sample yet: the Villa Riverside seed has 24 walls
  assert.equal(m.walls.length, before?.walls.length ?? 24)
  assert.ok(!m.walls.some((w) => w.typeId === 'E220'), 'imported walls gone')
})

await step('A plan drawn at 30° is squared: same rooms and areas as the straight one', async () => {
  await openDialog()
  await page.getByTestId('fromcad-file').setInputFiles(FX + 'house_vn_rot30_SYNTHETIC.dxf')
  await page.getByTestId('fromcad-preview').waitFor()
  assert.match(await summary(), /3 levels · 18 walls · 9 doors · 13 windows · 10 rooms · 12 columns · 18 furniture/)
  await page.getByTestId('fromcad-preview').screenshot({ path: SHOTS + 'fromcad_preview_rot30.png' })
  await page.getByRole('button', { name: 'Cancel' }).click()
})

await step('Vietnamese UI: dialog title and approve button', async () => {
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('thcad.settings')); s.state.language = 'vi'; localStorage.setItem('thcad.settings', JSON.stringify(s)) })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Thêm công cụ/ }).click()
  await page.getByRole('menuitem', { name: 'Dựng từ bản vẽ CAD…' }).click()
  await page.getByRole('dialog', { name: 'Dựng mô hình từ bản vẽ CAD' }).waitFor()
  await page.getByRole('button', { name: 'Duyệt & dựng' }).waitFor()
  await page.getByTestId('fromcad-file').setInputFiles(FX + 'house_vn_SYNTHETIC.dxf')
  await page.getByTestId('fromcad-preview').waitFor()
  await page.getByRole('dialog').screenshot({ path: SHOTS + 'fromcad_dialog_vi.png' })
  await page.getByRole('button', { name: 'Huỷ' }).click()
})

await step('No console errors', async () => assert.deepEqual(errors, []))

for (const [r, n] of results) console.log(r, n)
console.log(results.every(([r]) => r === 'PASS') ? 'ALL PASS' : 'SOME FAILED')
await browser.close()
