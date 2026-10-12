// Part Studio (Mechanical → Part): feature tree, sketch / feature dialogs, CAM Prep with simulated G-code. Fresh profile.
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
    localStorage.clear()
    localStorage.setItem('thcad.settings', JSON.stringify({ state: { language: 'en' }, version: 1 }))
    sessionStorage.setItem('seeded', '1')
  }
})
await page.goto('http://127.0.0.1:5173/#/mechanical', { waitUntil: 'networkidle' })
const tool = (name) => page.getByRole('toolbar').getByRole('button', { name, exact: true }).first().click()
const tree = () => page.getByRole('region', { name: 'Feature Tree' })

await step('Part tab opens the sample Bearing Bracket: document tab, 2 sketches, 8 features, sketch preview', async () => {
  await page.getByRole('tab', { name: 'Part', exact: true }).first().click()
  assert.ok(await page.getByRole('tab', { name: /Bearing_Bracket\.prt/ }).isVisible())
  const t = await tree().innerText()
  assert.match(t, /Sketch 1 — plate/); assert.match(t, /Sketch 2 — boss/)
  for (const f of ['Extrude 1 — plate 12', 'Fillet 1 — corners R6', 'Hole 1 — bore Ø25', 'Pattern 2 — ×2, 90 mm']) assert.match(t, new RegExp(f))
  assert.ok(await page.getByText(/Sketch preview \(top view\)/).isVisible())
})

await step('Sketch: draw a 14 × 16 rectangle on the plate top (offset 12) by dragging, save → Sketch 3', async () => {
  await tool('Sketch')
  const c = page.getByTestId('sketch-canvas')
  const [vx0, vy1, k] = (await c.getAttribute('data-view')).split(',').map(Number)
  const box = await c.boundingBox()
  const P = (x, y) => ({ x: box.x + (x - vx0) / k, y: box.y + (vy1 - y) / k })
  const a = P(20, 32), b = P(34, 48)
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up()
  const w = Number(await page.getByRole('spinbutton', { name: 'Rectangle 1 w' }).inputValue())
  assert.ok(Math.abs(w - 14) <= 1, `w ${w}`)
  await page.getByRole('spinbutton', { name: 'Offset (mm)' }).fill('12')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  assert.match(await tree().innerText(), /Sketch 3/)
})

await step('Extrude defaults to the new sketch; 6 mm cut downwards → pocket “Extrude 3” in the tree', async () => {
  await tool('Extrude')
  await page.getByRole('combobox', { name: 'Operation' }).selectOption('cut')
  await page.getByRole('spinbutton', { name: 'Depth (mm)' }).fill('6')
  await page.getByRole('checkbox', { name: 'Reverse direction' }).check()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  assert.match(await tree().innerText(), /Extrude 3/)
})

await step('Hole Ø6 at (100, 40); Chamfer top edges 1 mm; suppress / delete / undo from the tree', async () => {
  await tool('Hole')
  await page.getByRole('spinbutton', { name: 'X (mm)' }).fill('100')
  await page.getByRole('spinbutton', { name: 'Y (mm)' }).fill('40')
  await page.getByRole('spinbutton', { name: 'Diameter (mm)' }).fill('6')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await tool('Chamfer')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  assert.match(await tree().innerText(), /Hole 4/); assert.match(await tree().innerText(), /Chamfer 1/)
  await page.getByRole('button', { name: 'Suppress Chamfer 1' }).click()
  assert.ok(await page.getByRole('button', { name: 'Unsuppress Chamfer 1' }).isVisible())
  await page.getByRole('button', { name: 'Delete Chamfer 1' }).click()
  assert.doesNotMatch(await tree().innerText(), /Chamfer 1/)
  await page.mouse.click(5, 500)
  await page.keyboard.press('Meta+z')
  assert.match(await tree().innerText(), /Chamfer 1/)
})

await step('Dimension shows the overall size from the model (120 × 80 × 30 mm)', async () => {
  await tool('Dimension')
  assert.equal(await page.getByTestId('overall-dims').innerText(), '120.0 × 80.0 × 30.0 mm')
  await tool('Dimension')
})

await step('CAM Prep: stock 124 × 84 × 31, face / profiles / pocket / bores / drills, independent simulation without errors; G-code download', async () => {
  await tool('CAM Prep')
  const d = page.getByTestId('cam-dialog')
  await d.waitFor()
  assert.match(await d.innerText(), /Stock 124 × 84 × 31 mm/)
  const ops = await page.getByTestId('cam-ops').innerText()
  for (const o of ['Face', 'Profile Extrude 2', 'Profile Extrude 1', 'Pocket Extrude 3', 'Bores and counterbores', 'Drill Ø9 (4)', 'Drill Ø6 (1)']) assert.match(ops, new RegExp(o.replace(/[()]/g, '\\$&')))
  assert.match(await page.getByTestId('cam-sim').innerText(), /no errors/)
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download G-code' }).click()])
  assert.equal(dl.suggestedFilename(), 'Bearing_Bracket.nc')
  const text = await (await dl.createReadStream()).toArray().then((c) => Buffer.concat(c).toString())
  assert.match(text, /^%\n\(MD CAD AI STUDIO — Bearing Bracket — AISI 1045\)/)
  assert.match(text, /T2 M6/); assert.match(text, /M30/)
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
})

await step('+ opens a blank part; Assembly tab returns to the pump', async () => {
  await page.getByRole('button', { name: 'New document' }).click()
  assert.ok(await page.getByRole('tab', { name: /Part_2\.prt/ }).isVisible())
  assert.match(await tree().innerText(), /No features yet/)
  await page.getByRole('tab', { name: 'Assembly', exact: true }).first().click()
  assert.ok(await page.getByText('Parameters (8)').isVisible())
})

for (const [r, n] of results) console.log(`${r}  ${n}`)
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.join('\n'))
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed}/${results.length} passed${errors.length ? `, ${errors.length} console errors` : ''}`)
await browser.close()
process.exitCode = failed || errors.length ? 1 : 0
