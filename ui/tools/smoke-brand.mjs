// MD CAD AI STUDIO brand: intro → Dashboard, exact credit line, installer welcome, brand loader, icon.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const CREDIT = 'Xây dựng và phát triển bởi Minh Dũng'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1528, height: 957 } })
ctx.setDefaultTimeout(8000)
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
const results = []
const step = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]) } catch (e) { results.push(['FAIL', name + ' — ' + e.message.split('\n')[0]]) }
}

await step('intro plays (credit exact, status of the real start-up steps) and leaves into the Dashboard in 3.5–6 s', async () => {
  const t0 = Date.now()
  await page.goto('http://127.0.0.1:5173/?splash=1#/dashboard')
  await page.getByTestId('intro-screen').waitFor()
  await page.waitForTimeout(3600)
  assert.equal(await page.getByTestId('intro-screen').getByText(CREDIT, { exact: true }).count(), 1)
  assert.match(await page.getByTestId('intro-status').textContent(), /Initializing|Loading|Preparing|Đang/)
  await page.getByTestId('intro-screen').waitFor({ state: 'detached', timeout: 8000 })
  const ms = Date.now() - t0
  assert.ok(ms >= 3500 && ms <= 6500, `${ms} ms`)
  assert.ok(await page.getByRole('heading', { name: 'MD CAD AI STUDIO' }).isVisible())
  results.push(['INFO', `intro ${ms} ms`])
})

await step('Esc skips the intro', async () => {
  await page.goto('http://127.0.0.1:5173/?splash=1&run=2#/dashboard')
  await page.getByTestId('intro-screen').waitFor()
  await page.waitForTimeout(700)
  await page.keyboard.press('Escape')
  await page.getByTestId('intro-screen').waitFor({ state: 'detached', timeout: 3000 })
})

await step('sidebar shows the MD CAD AI STUDIO logo; no trace of the old name in the UI', async () => {
  await page.goto('http://127.0.0.1:5173/?splash=0#/dashboard')
  await page.getByRole('button', { name: 'MD CAD AI STUDIO' }).first().waitFor()
  assert.equal(await page.getByRole('img', { name: 'MD CAD AI STUDIO' }).first().isVisible(), true)
  assert.equal((await page.content()).includes('TH AI CAD'), false)
  assert.equal(await page.title(), 'MD CAD AI STUDIO')
})

await step('installer welcome screen: name, tagline, exact credit; hero visual', async () => {
  await page.goto('http://127.0.0.1:5173/?splash=0#/brand')
  const w = page.getByTestId('installer-welcome')
  await w.waitFor()
  assert.ok(await w.getByRole('heading', { name: 'MD CAD AI STUDIO' }).isVisible())
  assert.ok(await w.getByText('Design Smarter. Build Faster.').isVisible())
  assert.equal(await page.getByTestId('installer-credit').textContent(), CREDIT)
  assert.ok(await w.getByTestId('installer-hero').getByText(CREDIT, { exact: true }).isVisible())
})

await step('brand loader overlay appears and goes away; app icon preview', async () => {
  await page.getByRole('button', { name: 'Try the loader' }).click()
  await page.locator('[data-testid=brand-loader]').filter({ hasText: 'Loading local AI models...' }).last().waitFor()
  await page.waitForTimeout(2200)
  assert.equal(await page.locator('[data-testid=brand-loader]').filter({ hasText: 'Loading local AI models...' }).count(), 1) // only the static sample remains
  assert.equal(await page.getByTestId('app-icon-preview').locator('img').count(), 6)
})

await step('installer art export pages render (hero, DMG background)', async () => {
  await page.goto('http://127.0.0.1:5173/?splash=0#/brand?shot=hero')
  await page.getByTestId('installer-hero').waitFor()
  await page.goto('http://127.0.0.1:5173/?splash=0&run=3#/brand?shot=dmg')
  await page.getByText(CREDIT, { exact: true }).waitFor()
  assert.equal(await page.getByTestId('installer-hero').count(), 0)
})

await step('no console errors', async () => assert.deepEqual(errors, []))
for (const [s, n] of results) console.log(s, n)
await browser.close()
process.exitCode = results.some(([s]) => s === 'FAIL') ? 1 : 0
