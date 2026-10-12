// Interaction smoke test for AI Intelligence Studio. Fresh profile.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1586, height: 992 } })
ctx.setDefaultTimeout(5000)
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
const results = []
const step = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]) } catch (e) { results.push(['FAIL', name + ' — ' + e.message.split('\n')[0]]) }
}
const cadState = () => page.evaluate(() => { const s = window.__thcad.cad.getState(); return { tabs: s.tabs, active: s.docs[s.activeId]?.name } })

await page.goto('http://127.0.0.1:5173/#/ai-studio', { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__thcad)

await step('mockup state: sample session, Option 1 selected, Proposal Details 120 m²', async () => {
  assert.ok(await page.getByRole('heading', { name: 'AI Intelligence Studio' }).isVisible())
  assert.equal(await page.locator('[data-source="demo"]').count() >= 1, true)
  assert.equal(await page.getByRole('button', { name: /^Option 1/ }).getAttribute('aria-pressed'), 'true')
  assert.ok(await page.getByText('120 m²', { exact: true }).isVisible())
  assert.ok(await page.getByText('Option 1 – Office Layout Plan').isVisible())
})

await step('Preview in chat selects Option 2 (no rendered preview → honest empty state)', async () => {
  await page.getByRole('button', { name: 'Preview', exact: true }).nth(1).click()
  assert.equal(await page.getByRole('button', { name: /^Option 2/ }).getAttribute('aria-pressed'), 'true')
  assert.ok(await page.getByText('No rendered preview for this sample option.').isVisible())
  assert.ok(await page.getByText('110 m²', { exact: true }).isVisible())
  await page.getByRole('button', { name: /^Option 1/ }).click()
})

await step('preview viewport zoom buttons change the view', async () => {
  const img = () => page.locator('svg svg image').first().boundingBox()
  const t0 = await img()
  await page.getByRole('button', { name: 'Zoom in' }).click()
  const t1 = await img()
  assert.ok(t1.width > t0.width * 1.2)
  await page.getByRole('button', { name: 'Frame drawing' }).click()
  const t2 = await img()
  assert.ok(Math.abs(t2.width - t0.width) < 1)
})

await step('Side by Side Comparison shows two previews', async () => {
  await page.getByRole('button', { name: 'Side by Side Comparison' }).click()
  assert.equal(await page.getByText(/Option \d – Office Layout Plan/).count(), 2)
  await page.getByRole('button', { name: 'Side by Side Comparison' }).click()
})

await step('Preview Changes → Structured Actions list for Option 1', async () => {
  await page.getByRole('button', { name: 'Preview Changes' }).click()
  assert.ok(await page.getByText('Structured CAD actions for Option 1').isVisible())
  assert.ok(await page.getByText('WALL', { exact: true }).isVisible())
})

await step('Approve & Apply asks for confirmation, opens the proposal in CAD 2D', async () => {
  await page.getByRole('button', { name: 'Approve & Apply' }).click()
  assert.ok(await page.getByRole('dialog').getByText(/not generated on this machine/).isVisible())
  await page.getByRole('dialog').getByRole('button', { name: 'Approve & open in CAD 2D' }).click()
  await page.waitForURL(/#\/cad2d$/)
  assert.equal((await cadState()).active, 'Office Layout - Option 1.dwg')
})

await step('Undo in the studio closes the applied drawing', async () => {
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'AI Assistant' }).click()
  const n = (await cadState()).tabs.length
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  assert.equal((await cadState()).tabs.length, n - 1)
})

await step('Reject Option 3 marks it rejected and disables approve', async () => {
  await page.getByRole('button', { name: /^Option 3/ }).click()
  await page.getByRole('button', { name: 'Reject' }).click()
  assert.ok(await page.getByRole('button', { name: 'Rejected', exact: true }).isDisabled())
  assert.ok(await page.getByRole('button', { name: 'Approve & Apply' }).isDisabled())
  await page.getByRole('button', { name: /^Option 1/ }).click()
})

await step('Geometry Doctor runs local checks on the open drawing (3 findings)', async () => {
  await page.getByRole('button', { name: /Geometry\s*Doctor/ }).click()
  assert.ok(await page.getByText(/Geometry Doctor — local check of/).isVisible())
  assert.equal(await page.getByText(/≠ measured/).count(), 3)
})

await step('sending a message gets an honest "runtime not integrated" reply, no fabricated answer', async () => {
  await page.getByRole('textbox', { name: 'Ask or describe your CAD task...' }).fill('Add a door to office 4')
  await page.getByRole('button', { name: 'Send' }).click()
  assert.ok(await page.getByText('Add a door to office 4').isVisible())
  assert.ok(await page.getByText(/No local AI model is available here/).isVisible())
})

await step('New Chat clears; menu re-opens the sample session; persisted across reload', async () => {
  await page.getByRole('button', { name: 'New Chat' }).click()
  assert.ok(await page.getByText(/Describe a CAD task/).isVisible())
  await page.reload({ waitUntil: 'networkidle' })
  assert.ok(await page.getByText(/Describe a CAD task/).isVisible())
  await page.getByRole('button', { name: 'Chat options' }).click()
  await page.getByRole('menuitem', { name: 'Open sample session' }).click()
  assert.ok(await page.getByText(/Tạo phương án cải tạo/).isVisible())
})

await step('suggestion chip fills the composer', async () => {
  await page.getByRole('button', { name: '"Fix wall intersections"' }).click()
  assert.equal(await page.getByRole('textbox', { name: 'Ask or describe your CAD task...' }).inputValue(), 'Fix wall intersections')
})

await step('VI translates studio chrome', async () => {
  await page.getByRole('tab', { name: /Preview 3 Options/ }).click()
  await page.getByRole('radio', { name: 'VI' }).click()
  assert.ok(await page.getByRole('button', { name: 'Duyệt & Áp dụng' }).isVisible())
  assert.ok(await page.getByText('Chi tiết đề xuất').isVisible())
  await page.getByRole('radio', { name: 'EN' }).click()
})

await step('no console errors', async () => assert.deepEqual(errors, []))
for (const [s, n] of results) console.log(s, n)
await browser.close()
process.exitCode = results.some(([s]) => s === 'FAIL') ? 1 : 0
