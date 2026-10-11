// Interaction smoke test — Interior workspace (mockup 09). Fresh profile, dev server :5173.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1586, height: 992 }, acceptDownloads: true })
ctx.setDefaultTimeout(5000)
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
await page.goto('http://127.0.0.1:5173/#/interior', { waitUntil: 'networkidle' })
const doc = () => page.evaluate(() => JSON.parse(localStorage.getItem('thcad.interior') ?? '{"state":{}}').state.doc)
const table = (name) => page.getByRole('table', { name })
const rows = (name) => table(name).getByRole('row')
const cellText = async (name, rowName) => (await table(name).getByRole('row').filter({ hasText: rowName }).first().innerText())
const right = () => page.locator('section[aria-label]').filter({ has: page.getByRole('tab', { name: 'AI Assistant' }) }).last()
const undo = () => page.keyboard.press('Meta+z')

await step('opens like the mockup: Design tab, Living Room active, AI Assistant panel, 6 furniture rows, DEMO render badge', async () => {
  assert.equal(await page.getByRole('tab', { name: 'Design' }).getAttribute('aria-selected'), 'true')
  assert.equal(await page.getByRole('tab', { name: 'AI Assistant' }).getAttribute('aria-selected'), 'true')
  assert.ok(await page.locator('[aria-current="true"]').filter({ hasText: 'Living Room' }).isVisible())
  assert.equal(await rows('Furniture & Items').count(), 7) // header + 6
  assert.ok(await page.getByText('DEMO render · interior engine not connected').isVisible())
  assert.equal(await page.getByText('Model Ready').count(), 0)
})

await step('Room Information is computed from the room outline (28.6 m², 22.8 m) and follows the room picker', async () => {
  assert.ok(await page.getByText('28.6 m²').isVisible())
  assert.ok(await page.getByText('22.8 m', { exact: true }).isVisible())
  await page.getByRole('combobox', { name: 'Room Information' }).selectOption('dining')
  assert.ok(await page.getByText('21.3 m²').isVisible())
  await page.getByRole('combobox', { name: 'Room Information' }).selectOption('living')
})

await step('selecting a row opens Properties; quantity edit is validated (0 rejected), applied, and undoable with ⌘Z', async () => {
  await rows('Furniture & Items').filter({ hasText: 'Dining Chair' }).click()
  assert.equal(await page.getByRole('tab', { name: 'Properties' }).getAttribute('aria-selected'), 'true')
  const qty = page.getByRole('textbox', { name: 'Quantity' })
  await qty.fill('0'); await qty.press('Enter')
  assert.equal((await doc()).items.find((i) => i.name === 'Dining Chair').qty, 6)
  await qty.fill('8'); await qty.press('Enter')
  assert.equal((await doc()).items.find((i) => i.name === 'Dining Chair').qty, 8)
  assert.match(await cellText('Furniture & Items', 'Dining Chair'), /\b8\b/)
  await page.locator('body').click({ position: { x: 900, y: 500 } })
  await undo()
  assert.equal((await doc()).items.find((i) => i.name === 'Dining Chair').qty, 6)
})

await step('Japandi style preset re-materials the living room (rule-based) and ⌘Z restores it', async () => {
  await page.getByRole('tab', { name: 'AI Assistant' }).click()
  await page.getByRole('figure').filter({ hasText: 'Japandi Style' }).getByRole('button', { name: 'Apply' }).click()
  assert.equal((await doc()).items.find((i) => i.name === 'Sofa L-Shape').material, 'Fabric - Linen')
  assert.equal((await doc()).items.find((i) => i.name === 'Dining Table').material, 'Wood - Oak', 'other rooms untouched')
  await page.locator('body').click({ position: { x: 900, y: 500 } })
  await undo()
  assert.equal((await doc()).items.find((i) => i.name === 'Sofa L-Shape').material, 'Fabric - Beige')
})

await step('Cut List derives panels from the cabinets; resizing the TV Cabinet updates the top/bottom length', async () => {
  await page.getByRole('tab', { name: 'Cut List (Production)' }).click()
  const top = async () => cellText('Cut List (Production)', 'TV Cabinet').then(() => table('Cut List (Production)').getByRole('row').filter({ hasText: 'TV Cabinet' }).filter({ hasText: 'Top / bottom' }).innerText())
  assert.match(await top(), /3164 × 400/) // 3200 − 2 × 18
  assert.match(await page.getByText(/parts · board/).innerText(), /edge banding/)
  await page.getByRole('tab', { name: 'Furniture & Items' }).click()
  await rows('Furniture & Items').filter({ hasText: 'TV Cabinet' }).click()
  await page.getByRole('button', { name: /^TV Cabinet/ }).click()
  const w = page.getByRole('textbox', { name: 'Width' })
  await w.fill('2400'); await w.press('Enter')
  await page.getByRole('tab', { name: 'Cut List (Production)' }).click()
  assert.match(await top(), /2364 × 400/)
  assert.equal((await doc()).items.find((i) => i.name === 'TV Cabinet').w, 2400, 'furniture item follows the cabinet')
})

await step('Cabinet Parametric adds a cabinet with its cut list; impossible sizes keep Add disabled', async () => {
  await page.getByRole('button', { name: 'Cabinet Parametric' }).click()
  const dlg = page.getByRole('dialog', { name: 'New parametric cabinet' })
  await dlg.getByRole('textbox', { name: 'Width (mm)' }).fill('100')
  assert.equal(await dlg.getByRole('button', { name: 'Add cabinet' }).isDisabled(), true)
  await dlg.getByRole('textbox', { name: 'Width (mm)' }).fill('1200')
  await dlg.getByRole('button', { name: 'Add cabinet' }).click()
  const d = await doc()
  assert.equal(d.cabinets.length, 4)
  assert.ok(await table('Cut List (Production)').getByRole('row').filter({ hasText: 'Cabinet 4' }).first().isVisible())
})

await step('Room Quantities: Living Room floor 28.61, perimeter 22.80, gross walls 68.40', async () => {
  await page.getByRole('tab', { name: 'Room Quantities' }).click()
  const r = await cellText('Room Quantities', 'Living Room')
  assert.match(r, /28\.61/); assert.match(r, /22\.80/); assert.match(r, /68\.40/)
})

await step('Materials tab assigns a material to the selected item', async () => {
  await page.getByRole('tab', { name: 'Furniture & Items' }).click()
  await rows('Furniture & Items').filter({ hasText: 'Coffee Table' }).click()
  await page.getByRole('tab', { name: 'Materials' }).last().click()
  await page.getByRole('button', { name: /Wood - Oak/ }).click()
  assert.equal((await doc()).items.find((i) => i.name === 'Coffee Table').material, 'Wood - Oak')
})

await step('View all lists every item; display mode Wireframe applies', async () => {
  await page.getByRole('button', { name: 'View all' }).click()
  assert.equal(await rows('Furniture & Items').count(), (await doc()).items.length + 1)
  await page.getByRole('radio', { name: 'Wireframe' }).click()
  assert.equal(await page.getByRole('radio', { name: 'Wireframe' }).getAttribute('aria-checked'), 'true')
  await page.getByRole('radio', { name: 'Realistic' }).click()
})

await step('Export → Cut list CSV downloads real rows', async () => {
  await page.getByRole('button', { name: 'Export' }).click()
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Cut list — production (CSV)' }).click()])
  const text = await (await dl.createReadStream()).toArray().then((c) => Buffer.concat(c).toString())
  assert.match(text, /^Cabinet,Part,Qty/)
  assert.match(text, /Wardrobe,Shelf/)
})

await step('ribbon + header: Cut List tool opens the tab, Drawings goes to CAD 2D', async () => {
  await page.getByRole('tab', { name: 'Furniture & Items' }).click()
  await page.getByRole('button', { name: 'Cut List', exact: true }).click()
  assert.equal(await page.getByRole('tab', { name: 'Cut List (Production)' }).getAttribute('aria-selected'), 'true')
  await page.getByRole('tab', { name: 'Drawings' }).click()
  await page.waitForURL(/#\/cad2d/)
  await page.goto('http://127.0.0.1:5173/#/interior', { waitUntil: 'networkidle' })
})

await step('VI: workspace, tabs, rooms and default brief are translated', async () => {
  await page.getByRole('radio', { name: 'VI', exact: true }).click()
  assert.ok(await page.getByRole('tab', { name: 'Thiết kế' }).isVisible())
  await page.getByRole('tab', { name: 'Trợ lý AI' }).last().click()
  assert.ok(await page.getByText('Thông tin phòng').isVisible())
  assert.match(await page.locator('textarea').inputValue(), /^Gợi ý phòng khách/)
  assert.ok(await page.locator('[aria-current="true"]').filter({ hasText: 'Phòng khách' }).isVisible())
  await page.getByRole('radio', { name: 'EN', exact: true }).click()
})

for (const [r, n] of results) console.log(`${r}  ${n}`)
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.join('\n'))
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed}/${results.length} passed${errors.length ? `, ${errors.length} console errors` : ''}`)
await browser.close()
process.exitCode = failed || errors.length ? 1 : 0
