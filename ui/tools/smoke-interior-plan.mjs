// Interior plans (layout / ceiling / finish) from the model, Dimension and Tag tools. Fresh profile.
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
await page.addInitScript(() => {
  if (!sessionStorage.getItem('seeded')) {
    localStorage.clear()
    localStorage.setItem('thcad.settings', JSON.stringify({ state: { language: 'en' }, version: 1 }))
    sessionStorage.setItem('seeded', '1')
  }
})
await page.goto('http://127.0.0.1:5173/#/interior', { waitUntil: 'networkidle' })
const plan = () => page.getByTestId('interior-plan')
const at = async (x, y) => {
  const box = await plan().boundingBox()
  const [cx, cy, k] = (await plan().getAttribute('data-view')).split(',').map(Number)
  return { x: box.x + (x - cx) / k + box.width / 2, y: box.y + (cy - y) / k + box.height / 2 }
}
const clickAt = async (x, y) => { const p = await at(x, y); await page.mouse.move(p.x, p.y); await page.mouse.click(p.x, p.y) }
const tool = (name) => page.getByRole('toolbar').getByRole('button', { name, exact: true }).first().click()

await step('the plan inset opens the model plan: 9 rooms with areas, every furniture item drawn', async () => {
  await page.getByRole('button', { name: 'Open plan', exact: true }).click()
  await plan().waitFor()
  assert.equal(await page.locator('[data-testid=interior-plan] [data-room]').count(), 9)
  assert.ok(await page.locator('[data-testid=interior-plan] [data-item]').count() >= 12)
  assert.match(await plan().innerText(), /Living Room[\s\S]*28\.61 m²/)
})

await step('Dimension: living room width snaps to the corners → 7,670', async () => {
  await tool('Dimension')
  await clickAt(10, 20); await clickAt(7660, 25)
  assert.match(await plan().innerText(), /7,670/)
})

await step('Tag: clicking the sofa tags it with its name and size', async () => {
  await tool('Tag')
  await clickAt(3600, 2780)
  assert.match(await plan().innerText(), /Sofa L-Shape · 3200 × 1800 × 780/)
  await tool('Tag')
})

await step('select picks a room in the plan (Properties shows it)', async () => {
  await clickAt(10000, 3500)
  assert.deepEqual(await page.evaluate(() => window.__thcad.interior.getState().sel), { kind: 'room', id: 'dining' })
})

await step('Ceiling and Finish plans; 3D view returns', async () => {
  await page.evaluate(() => window.__thcad.interior.getState().set({ plan: 'ceiling' }))
  const c = await plan().innerText(); assert.match(c, /Reflected Ceiling Plan/); assert.match(c, /Bathroom 1\nCH 2,700/)
  await page.evaluate(() => window.__thcad.interior.getState().set({ plan: 'finish' }))
  const f = await plan().innerText(); assert.match(f, /Finish Plan/); assert.match(f, /Master Bedroom\nWood - Oak/)
  await page.getByRole('button', { name: '3D view' }).click()
  assert.equal(await plan().count(), 0)
})

for (const [r, n] of results) console.log(`${r}  ${n}`)
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.join('\n'))
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed}/${results.length} passed${errors.length ? `, ${errors.length} console errors` : ''}`)
await browser.close()
process.exitCode = failed || errors.length ? 1 : 0
