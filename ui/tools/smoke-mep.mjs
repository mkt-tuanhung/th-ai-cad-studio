// Interaction smoke test — MEP workspace (mockup 08). Fresh profile, dev server :5173.
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
    localStorage.setItem('thcad.settings', JSON.stringify({ state: { language: 'en' }, version: 2 }))
    sessionStorage.setItem('seeded', '1')
  }
})
await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/#/mep', { waitUntil: 'networkidle' })
const doc = () => page.evaluate(() => JSON.parse(localStorage.getItem('thcad.mep') ?? '{"state":{}}').state.doc)
const tableRows = (re) => page.getByRole('table', { name: re }).getByRole('row')
const row = (re, text) => tableRows(re).filter({ hasText: text }).first()
const clashTab = () => page.getByRole('tab', { name: /^Clash Detection/ })
const clashN = async () => Number((await clashTab().innerText()).match(/\((\d+)\)/)[1])
const blank = () => page.locator('body').click({ position: { x: 900, y: 500 } })

await step('opens like the mockup: HVAC tab, Duct Schedule (48), SA-01 in Properties, DEMO render badge, no fake runtime', async () => {
  assert.equal(await page.getByRole('tab', { name: 'HVAC' }).getAttribute('aria-selected'), 'true')
  assert.equal(await page.getByRole('tab', { name: 'Duct Schedule (48)' }).getAttribute('aria-selected'), 'true')
  assert.ok(await page.getByText('Rectangular Duct').first().isVisible())
  assert.equal(await page.getByRole('textbox', { name: 'Width' }).inputValue(), '600')
  assert.ok(await page.getByText('DEMO render · the OCCT 3D engine runs in the desktop app').isVisible())
  assert.equal(await page.getByText('Model Ready').count(), 0)
})

await step('SA-01 velocity and friction are computed: 5.00 m/s, 0.57 Pa/m (mockup showed 6.5 m/s / 45 Pa/m)', async () => {
  assert.ok(await page.getByText('5.00 m/s').isVisible())
  assert.ok(await page.getByText('0.57 Pa/m').isVisible())
})

await step('narrowing SA-01 to 300 mm doubles the velocity, flags the duct, and ⌘Z restores it', async () => {
  const w = page.getByRole('textbox', { name: 'Width' })
  await w.fill('50'); await w.press('Enter')
  assert.equal(await w.inputValue(), '600', '50 mm rejected')
  assert.ok(await page.getByText('5.00 m/s').isVisible())
  await w.fill('300'); await w.press('Enter')
  assert.ok(await page.getByText('10.00 m/s').isVisible())
  assert.match(await row(/^Duct Schedule/, 'SA-01').innerText(), /Check/)
  await blank(); await page.keyboard.press('Meta+z')
  assert.equal((await doc()).ducts.find((d) => d.mark === 'SA-01' && d.level === 'L2').w, 600)
})

await step('clash detection is computed; “Lower to clear the beam” resolves one and ⌘Z brings it back', async () => {
  const n = await clashN()
  assert.ok(n > 0)
  await clashTab().click()
  assert.equal(await tableRows(/^Clash Detection/).count(), n + 1)
  await tableRows(/^Clash Detection/).nth(1).getByRole('button', { name: /Lower to clear the beam/ }).click()
  assert.equal(await clashN(), n - 1)
  await blank(); await page.keyboard.press('Meta+z')
  assert.equal(await clashN(), n)
})

await step('pipe schedule: Level 2 rows by default, View all shows all 32 with computed velocity', async () => {
  await page.getByRole('tab', { name: 'System Schedules' }).click()
  await page.getByRole('tab', { name: 'Pipe Schedule (32)' }).click()
  const lvl = await tableRows(/^Pipe Schedule/).count()
  assert.ok(lvl > 1 && lvl < 33)
  await page.getByRole('button', { name: 'View all' }).click()
  assert.equal(await tableRows(/^Pipe Schedule/).count(), 33)
  await page.getByRole('button', { name: 'Current level' }).click()
})

await step('AI Suggestions lists rule-based findings; the voltage-drop fix upsizes the cable', async () => {
  await page.getByRole('tab', { name: 'AI Suggestions' }).click()
  const fix = page.getByRole('button', { name: /^Resize to .*mm²/ }).first()
  const before = (await doc()).circuits.map((c) => c.cable).join()
  await fix.click()
  assert.notEqual((await doc()).circuits.map((c) => c.cable).join(), before)
})

await step('Coordination Status summarises the three systems; System Data totals render', async () => {
  await page.getByRole('tab', { name: 'Coordination Status' }).click()
  assert.equal(await tableRows(/^Coordination Status/).count(), 4)
  await page.getByRole('tab', { name: 'System Data' }).click()
  assert.ok(await page.getByText('Supply airflow').isVisible())
  assert.match(await page.getByText(/\d[\d,]* L\/s/).first().innerText(), /L\/s/)
  await page.getByRole('tab', { name: 'Properties' }).click()
})

await step('AI Recommendations “Apply Suggestion” lowers the first clashing duct (rule-based, undoable)', async () => {
  const n = await clashN()
  await page.getByRole('button', { name: 'Apply Suggestion' }).click()
  assert.equal(await clashN(), n - 1)
  await blank(); await page.keyboard.press('Meta+z')
  assert.equal(await clashN(), n)
})

await step('Export → Clash report CSV', async () => {
  await page.getByRole('button', { name: 'Export' }).click()
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Clash report (CSV)' }).click()])
  const text = await (await dl.createReadStream()).toArray().then((c) => Buffer.concat(c).toString())
  assert.match(text, /^Element,Clashes with,Kind/)
  assert.match(text, /duct-beam/)
})

await step('Plumbing tab opens the pipe schedule; Level 1 filter changes the rows', async () => {
  await page.getByRole('tab', { name: 'Plumbing' }).click()
  assert.equal(await page.getByRole('tab', { name: 'Pipe Schedule (32)' }).getAttribute('aria-selected'), 'true')
  await page.getByRole('combobox', { name: 'Level' }).selectOption('L1')
  const texts = await tableRows(/^Pipe Schedule/).allInnerTexts()
  assert.ok(texts.slice(1).every((t) => /Level 1/.test(t)))
})

await step('VI: tabs, duct types and statuses are translated', async () => {
  await page.getByRole('tab', { name: 'HVAC' }).click()
  await page.getByRole('combobox', { name: 'Level' }).selectOption('L2')
  await page.getByRole('radio', { name: 'VI', exact: true }).click()
  assert.ok(await page.getByRole('tab', { name: 'Cấp thoát nước' }).isVisible())
  assert.ok(await page.getByText('Ống gió cấp').first().isVisible())
  assert.ok(await page.getByText('Đạt').first().isVisible())
  await page.getByRole('radio', { name: 'EN', exact: true }).click()
})

for (const [r, n] of results) console.log(`${r}  ${n}`)
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.join('\n'))
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed}/${results.length} passed${errors.length ? `, ${errors.length} console errors` : ''}`)
await browser.close()
process.exitCode = failed || errors.length ? 1 : 0
