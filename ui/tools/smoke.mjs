// Interaction smoke test for the Dashboard + shell. Fresh profile; exits non-zero on any failure.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const URL = 'http://127.0.0.1:5173/'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1586, height: 992 } })
ctx.setDefaultTimeout(5000)
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
const results = []
const goHome = () => page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Dashboard', exact: true }).click()
const statValue = (label) => page.getByText(label, { exact: true }).locator('xpath=following-sibling::div[1]').textContent()
const step = async (name, fn) => {
  console.error('…', name)
  try { await fn(); results.push(['PASS', name]) } catch (e) { results.push(['FAIL', name + ' — ' + e.message.split('\n')[0]]) }
}

await page.goto(URL + '#/dashboard', { waitUntil: 'networkidle' })

await step('default language is EN (as in mockup)', async () => {
  assert.equal(await page.locator('h1').first().textContent(), 'MD CAD AI STUDIO')
  assert.ok(await page.getByText('WELCOME TO').isVisible())
})

await step('VI toggle translates UI and persists across reload', async () => {
  await page.getByRole('radio', { name: 'VI' }).click()
  assert.ok(await page.getByText('CHÀO MỪNG ĐẾN VỚI').isVisible())
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'vi')
  await page.reload({ waitUntil: 'networkidle' })
  assert.ok(await page.getByText('Dự án gần đây').isVisible())
  await page.getByRole('radio', { name: 'EN' }).click()
  assert.ok(await page.getByText('Recent Projects').isVisible())
})

await step('sidebar navigation + hash routing + back', async () => {
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'CAD Tools' }).click()
  assert.match(page.url(), /#\/cad2d$/)
  assert.equal(await page.getByRole('button', { name: 'CAD Tools' }).getAttribute('aria-current'), 'page')
  await page.goBack()
  await page.waitForURL(/#\/dashboard$/)
  assert.ok(await page.getByText('Recent Projects').isVisible())
})

await step('category card navigates (BIM → #/bim)', async () => {
  await page.locator('button', { hasText: 'Building' }).first().click()
  assert.match(page.url(), /#\/bim$/)
  await goHome()
})

await step('New Project: validation, create, appears first in Recent Projects, stat +1', async () => {
  const before = await statValue('Active Projects')
  await page.getByRole('button', { name: 'New Project' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Create Project' }).click()
  assert.ok(await page.getByText('Please enter a project name').isVisible())
  await page.getByRole('dialog').getByRole('textbox').fill('Smoke Test Tower')
  await page.getByRole('dialog').locator('select').first().selectOption('bim')
  await page.getByRole('dialog').getByRole('button', { name: 'Create Project' }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  const first = await page.locator('article h3').first().textContent()
  assert.equal(first, 'Smoke Test Tower')
  const after = await statValue('Active Projects')
  assert.equal(Number(after), Number(before) + 1)
})

await step('favorite toggle (aria-pressed) persists', async () => {
  const star = page.locator('article').first().getByRole('button', { name: 'Add to favorites' })
  await star.click()
  assert.equal(await page.locator('article').first().getByRole('button', { name: 'Remove from favorites' }).getAttribute('aria-pressed'), 'true')
  await page.reload({ waitUntil: 'networkidle' })
  assert.equal(await page.locator('article').first().locator('[aria-pressed]').getAttribute('aria-pressed'), 'true')
})

await step('kebab menu → Rename project', async () => {
  await page.locator('article').first().getByRole('button', { name: 'More actions' }).first().click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  await page.getByRole('dialog').getByRole('textbox').fill('Smoke Tower v2')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  assert.equal(await page.locator('article h3').first().textContent(), 'Smoke Tower v2')
})

await step('kebab menu → Remove from recent', async () => {
  await page.locator('article').first().getByRole('button', { name: 'More actions' }).first().click()
  await page.getByRole('menuitem', { name: 'Remove from recent' }).click()
  assert.notEqual(await page.locator('article h3').first().textContent(), 'Smoke Tower v2')
})

await step('⌘K focuses search; typing shows results; Enter opens project', async () => {
  await page.locator('body').click({ position: { x: 700, y: 700 } })
  await page.keyboard.press('Meta+k')
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'INPUT')
  await page.keyboard.type('pump')
  assert.ok(await page.getByRole('option', { name: /Pump Assembly/ }).isVisible())
  await page.keyboard.press('Enter')
  assert.match(page.url(), /#\/mechanical$/)
  await goHome()
})

const DXF = (n) => ['0', 'SECTION', '2', 'ENTITIES', ...Array.from({ length: n }, (_, i) => ['0', 'LINE', '8', '0', '10', String(i * 1000), '20', '0', '11', String(i * 1000 + 800), '21', '500']).flat(), '0', 'ENDSEC', '0', 'EOF'].join('\n')

await step('Open File: a .dxf opens in CAD 2D; .ifc is listed with an honest note; unsupported types rejected', async () => {
  const input = page.locator('input[type=file]').last()
  await input.setInputFiles({ name: 'Site Plan.dxf', mimeType: 'application/dxf', buffer: Buffer.from(DXF(3)) })
  await page.waitForURL(/#\/cad2d$/)
  await page.getByRole('tab', { name: /Site Plan\.dxf/ }).waitFor()
  await goHome()
  assert.ok(await page.getByRole('button', { name: 'Site Plan.dxf', exact: true }).isVisible())
  await page.locator('input[type=file]').last().setInputFiles({ name: 'Tower.ifc', mimeType: 'application/x-step', buffer: Buffer.from('ISO-10303-21;') })
  assert.ok(await page.getByText(/“Tower.ifc” added to Recent Files\. IFC files cannot be opened in this build/).isVisible())
  await page.locator('input[type=file]').last().setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') })
  assert.ok(await page.getByText('Unsupported file type: .txt').isVisible())
})

await step('Batch Process Files (browser): 2 DXF → DXF + PNG downloads; PDF reports that it needs the desktop app', async () => {
  await page.getByRole('button', { name: 'Batch Process Files' }).click()
  const dlg = page.getByRole('dialog', { name: 'Batch Process Files' })
  await dlg.locator('input[type=file]').setInputFiles([
    { name: 'A.dxf', mimeType: 'application/dxf', buffer: Buffer.from(DXF(2)) },
    { name: 'B.dxf', mimeType: 'application/dxf', buffer: Buffer.from(DXF(5)) },
  ])
  assert.equal(await dlg.getByTestId('batch-count').textContent(), '2 file(s) selected')
  await dlg.getByLabel('DXF', { exact: true }).check()
  await dlg.getByLabel('PNG (200 dpi)').check()
  const downloads = []
  page.on('download', (d) => downloads.push(d.suggestedFilename()))
  await dlg.getByRole('button', { name: 'Run batch' }).click()
  await dlg.getByText('Batch finished: 0 of 2 file(s) converted').waitFor()
  const txt = await dlg.getByTestId('batch-results').textContent()
  assert.match(txt, /A\.dxf · 2 entities/)
  assert.match(txt, /B\.dxf · 5 entities/)
  assert.match(txt, /✕ A\.pdf: needs the desktop app/)
  assert.match(txt, /✓ B\.dxf/)
  await page.waitForTimeout(500)
  assert.deepEqual(downloads.sort(), ['A.dxf', 'A.png', 'B.dxf', 'B.png'])
  await dlg.getByRole('button', { name: 'Close' }).click()
})

await step('See all: every quick action; Learning opens the getting-started guide that navigates', async () => {
  await page.getByRole('button', { name: 'See all' }).click()
  const all = page.getByRole('dialog', { name: 'All quick actions' })
  assert.equal(await all.getByRole('button').count(), 11) // 10 actions + close
  await all.getByRole('button', { name: 'Component library' }).click()
  assert.match(page.url(), /#\/components$/)
  await goHome()
  await page.getByRole('button', { name: /Get started with/ }).click()
  const guide = page.getByRole('dialog', { name: 'Get started with MD CAD AI STUDIO' })
  assert.equal(await guide.getByRole('listitem').count(), 6)
  await guide.getByRole('listitem').filter({ hasText: 'Design parts' }).getByRole('button', { name: 'Open' }).click()
  assert.match(page.url(), /#\/mechanical$/)
  await goHome()
})

await step('Quick action "New Drawing (DWG)" creates a drawing and opens CAD workspace', async () => {
  await page.getByRole('button', { name: 'New Drawing (DWG)' }).click()
  assert.match(page.url(), /#\/cad2d$/)
  await goHome()
  assert.ok(await page.getByRole('button', { name: /^Drawing1\.dwg$/ }).isVisible())
})

await step('Learning & Resources collapse state persists', async () => {
  await page.getByRole('button', { name: /^Open$/ }).click()
  assert.ok(!(await page.getByText('Tutorials, templates and best practices').isVisible()))
  await page.reload({ waitUntil: 'networkidle' })
  assert.ok(!(await page.getByText('Tutorials, templates and best practices').isVisible()))
  await page.getByRole('button', { name: /^Collapse$/ }).click()
  assert.ok(await page.getByText('Tutorials, templates and best practices').isVisible())
})

await step('notifications + account popovers open and close on Escape', async () => {
  await page.getByRole('button', { name: 'Notifications' }).click()
  assert.ok(await page.getByText('You are all caught up').isVisible())
  await page.keyboard.press('Escape')
  assert.ok(!(await page.getByText('You are all caught up').isVisible()))
  await page.getByRole('button', { name: 'Account menu' }).click()
  assert.ok(await page.getByText('Local profile (offline)').isVisible())
  await page.keyboard.press('Escape')
})

await step('no console errors', async () => assert.deepEqual(errors, []))

for (const [s, n] of results) console.log(s, n)
await browser.close()
process.exitCode = results.some(([s]) => s === 'FAIL') ? 1 : 0
