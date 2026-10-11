// Interaction smoke test — Renders workspace (mockup 12). Fresh profile, dev server :5173.
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
await page.goto('http://127.0.0.1:5173/#/renders', { waitUntil: 'networkidle' })
const doc = () => page.evaluate(() => JSON.parse(localStorage.getItem('thcad.renders') ?? '{"state":{}}').state.doc)
const queueRows = () => page.getByRole('table', { name: 'Render Queue' }).getByRole('row')
const blank = () => page.locator('body').click({ position: { x: 900, y: 420 } })

await step('opens like the mockup: Render Studio, Cam 01 selected, Rendered mode, DEMO badge', async () => {
  assert.equal(await page.getByRole('tab', { name: 'Render Studio' }).getAttribute('aria-selected'), 'true')
  assert.equal(await page.getByRole('button', { name: /^Cam 01 Exterior/ }).getAttribute('aria-pressed'), 'true')
  assert.equal(await page.getByRole('radio', { name: 'Rendered' }).getAttribute('aria-checked'), 'true')
  assert.ok(await page.getByText('DEMO preview · renderer not connected').isVisible())
})

await step('no fake progress: the 3 queued jobs wait for the renderer at 0 %, nothing “Rendering”', async () => {
  assert.equal(await queueRows().count(), 4)
  const t = await page.getByRole('table', { name: 'Render Queue' }).innerText()
  assert.match(t, /Waiting — renderer not connected/)
  assert.doesNotMatch(t, /Rendering|68%/)
  assert.ok(await page.getByText('Render History (0)').isVisible())
})

await step('Render Current View queues a job with the current settings (4K · 1024 samples, PNG)', async () => {
  await page.getByRole('button', { name: 'Render Current View' }).click()
  assert.equal(await queueRows().count(), 5)
  assert.match(await queueRows().nth(4).innerText(), /Cam 01 - Exterior - Front View[\s\S]*4K · 1024 samples[\s\S]*PNG/)
})

await step('output estimate is arithmetic: 4K PNG ≈ 13.1 MB, 8.3 MP, 32.5 × 18.3 cm at 300 DPI; 8K updates it', async () => {
  assert.ok(await page.getByText(/≈ 13\.1 MB · 8\.3 MP · Print size: 32\.5 × 18\.3 cm/).isVisible())
  await page.getByRole('combobox', { name: 'Resolution' }).selectOption('7680x4320')
  assert.ok(await page.getByText(/≈ 52\.2 MB · 33\.2 MP/).isVisible())
  await blank(); await page.keyboard.press('Meta+z')
  assert.ok(await page.getByText(/≈ 13\.1 MB/).isVisible())
})

await step('samples slider/field validate (10 rejected, 2048 accepted) and the queue summary follows', async () => {
  const f = page.getByRole('textbox', { name: 'Samples value' })
  await f.fill('10')
  assert.equal((await doc()).settings.samples, 1024)
  await f.fill('2048')
  assert.equal((await doc()).settings.samples, 2048)
  await page.getByRole('button', { name: 'Render Current View' }).click()
  assert.match(await queueRows().last().innerText(), /2048 samples/)
})

await step('choosing a camera switches the preview; Add Camera duplicates the current one', async () => {
  await page.getByRole('button', { name: /^Cam 03 Interior/ }).click()
  assert.match(await page.getByRole('combobox', { name: 'Camera' }).inputValue(), /cam3/)
  await page.getByRole('button', { name: 'Add Camera' }).click()
  assert.equal((await doc()).cameras.length, 6)
  assert.ok(await page.getByRole('button', { name: /^Cam 06 From/ }).isVisible())
})

await step('Night Scene variation applies its lighting (sun 0, Sun & Sky off) and is undoable', async () => {
  await page.getByRole('button', { name: 'Night Scene' }).click()
  const s = (await doc()).settings
  assert.equal(s.sunIntensity, 0); assert.equal(s.sunSky, false)
  await blank(); await page.keyboard.press('Meta+z')
  assert.equal((await doc()).settings.sunSky, true)
})

await step('Post Processing exposure changes the preview filter live', async () => {
  await page.getByRole('tab', { name: 'Post Processing' }).click()
  await page.getByRole('textbox', { name: 'Exposure (EV) value' }).fill('1')
  const f = await page.locator('img[alt$="(DEMO)"]').evaluate((e) => e.style.filter)
  assert.match(f, /brightness\(2\)/)
  await page.getByRole('tab', { name: 'Render Settings' }).click()
})

await step('Batch Render queues every camera; removing a job works', async () => {
  const before = await queueRows().count()
  await page.getByRole('tab', { name: 'Batch Render' }).click()
  assert.equal(await queueRows().count(), before + (await doc()).cameras.length)
  await queueRows().nth(1).getByRole('button', { name: 'Remove' }).click()
  assert.equal(await queueRows().count(), before + (await doc()).cameras.length - 1)
})

await step('Save View → render settings JSON', async () => {
  await page.getByRole('button', { name: 'Save View' }).click()
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Export render settings (JSON)' }).click()])
  const json = JSON.parse(await (await dl.createReadStream()).toArray().then((c) => Buffer.concat(c).toString()))
  assert.equal(json.settings.resolution, '3840x2160')
})

await step('VI: tabs, settings and queue status are translated', async () => {
  await page.getByRole('radio', { name: 'VI', exact: true }).click()
  assert.ok(await page.getByRole('tab', { name: 'Phòng kết xuất' }).isVisible())
  assert.ok(await page.getByText('Độ phân giải').isVisible())
  assert.ok(await page.getByText('Đang chờ — chưa kết nối bộ kết xuất').first().isVisible())
  await page.getByRole('radio', { name: 'EN', exact: true }).click()
})

for (const [r, n] of results) console.log(`${r}  ${n}`)
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.join('\n'))
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed}/${results.length} passed${errors.length ? `, ${errors.length} console errors` : ''}`)
await browser.close()
process.exitCode = failed || errors.length ? 1 : 0
