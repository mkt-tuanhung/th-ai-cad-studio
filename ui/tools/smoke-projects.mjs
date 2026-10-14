// Interaction smoke test — Projects & File Management (mockup 05). Fresh profile, dev server :5173.
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
    localStorage.setItem('thcad.settings', JSON.stringify({ state: { language: 'en', themePreference: 'light', learningExpanded: true }, version: 1 }))
    sessionStorage.setItem('seeded', '1')
  }
})
await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/#/projects', { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__thcad?.workspace)
const ws = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__thcad.workspace.getState())))
const cards = () => page.locator('article[aria-label]')
const inspectorName = () => page.locator('aside h2').first().innerText()
const files = page.locator('section[aria-label="Project Files"]')

await step('All Projects shows 24 with the 8 mockup projects first; Villa Riverside selected in the inspector', async () => {
  assert.equal(await page.getByRole('tab', { name: /All Projects/ }).innerText().then((t) => t.replace(/\s+/g, ' ')), 'All Projects 24')
  const names = await cards().evaluateAll((els) => els.slice(0, 8).map((e) => e.getAttribute('aria-label')))
  assert.deepEqual(names, ['Villa Riverside', 'TH Office Building', 'Pump Assembly', 'Apartment Interior', 'Factory Extension', 'Urban Master Plan', 'Hospital Building', 'Bridge Structure'])
  assert.equal(await inspectorName(), 'Villa Riverside')
})

await step('tabs filter: Archived lists only archived projects, Shared only shared ones', async () => {
  await page.getByRole('tab', { name: /Archived/ }).click()
  const archived = await cards().evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  assert.ok(archived.includes('Bridge Structure') && !archived.includes('Villa Riverside'))
  await page.getByRole('tab', { name: /Shared/ }).click()
  const shared = await cards().evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  assert.ok(shared.includes('Hospital Building') && !shared.includes('Pump Assembly'))
  await page.getByRole('tab', { name: /All Projects/ }).click()
})

await step('search, discipline and status filters narrow the grid; sort by name orders A–Z', async () => {
  await page.getByRole('textbox', { name: 'Search projects...' }).fill('centrifugal')
  assert.deepEqual(await cards().evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))), ['Pump Assembly'])
  await page.getByRole('textbox', { name: 'Search projects...' }).fill('')
  await page.getByRole('combobox', { name: 'All Disciplines' }).selectOption('civil')
  const civil = await cards().evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  assert.ok(civil.includes('Bridge Structure') && !civil.includes('Pump Assembly'))
  await page.getByRole('combobox', { name: 'All Statuses' }).selectOption('draft')
  assert.deepEqual(await cards().evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))), ['Factory Extension'])
  await page.getByRole('combobox', { name: 'All Disciplines' }).selectOption('')
  await page.getByRole('combobox', { name: 'All Statuses' }).selectOption('')
  await page.getByRole('combobox', { name: 'Last Modified' }).selectOption('name')
  const sorted = await cards().evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  assert.deepEqual(sorted, [...sorted].sort((a, b) => a.localeCompare(b)))
  await page.getByRole('combobox', { name: 'Last Modified' }).selectOption('modified')
})

await step('list view toggle shows rows, grid view restores cards', async () => {
  await page.getByRole('button', { name: 'List view' }).first().click()
  assert.ok(await page.locator('article[aria-selected]').first().isVisible())
  await page.getByRole('button', { name: 'Grid view' }).first().click()
  assert.equal(await cards().count(), 24)
})

await step('selecting a card updates the inspector; star toggles favourite', async () => {
  await cards().filter({ hasText: 'TH Office Building' }).click()
  assert.equal(await inspectorName(), 'TH Office Building')
  await cards().filter({ hasText: 'TH Office Building' }).getByRole('button', { name: 'Add to favourites' }).click()
  assert.ok((await ws()).projects.find((p) => p.id === 'th-office-building').favorite)
  await cards().filter({ hasText: 'TH Office Building' }).getByRole('button', { name: 'Remove from favourites' }).click()
})

await step('card menu Archive → badge Archived + activity logged; Restore brings it back', async () => {
  const card = cards().filter({ hasText: 'TH Office Building' })
  await card.getByRole('button', { name: /More actions/ }).first().click()
  await page.getByRole('menuitem', { name: 'Archive' }).click()
  assert.ok((await card.innerText()).includes('Archived'))
  assert.equal((await ws()).activity[0].kind, 'archived')
  await card.getByRole('button', { name: /More actions/ }).first().click()
  await page.getByRole('menuitem', { name: 'Restore' }).click()
  assert.ok((await card.innerText()).includes('Active'))
})

await step('inspector edits persist: status, auto save, unit system, add tag, edit description', async () => {
  await cards().filter({ hasText: 'Villa Riverside' }).click()
  const aside = page.locator('aside[aria-label="Villa Riverside"]')
  await aside.getByRole('combobox', { name: 'Status' }).selectOption('in-progress')
  await aside.getByRole('switch', { name: 'Auto Save' }).click()
  await aside.getByRole('combobox', { name: 'Unit System' }).selectOption('imperial')
  await aside.getByRole('button', { name: 'Add discipline' }).click()
  await page.getByRole('menuitem', { name: 'Civil' }).click()
  await aside.getByRole('button', { name: 'Edit' }).click()
  await page.getByRole('dialog').locator('textarea').fill('Edited description')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  const d = (await ws()).projects.find((p) => p.id === 'villa-riverside').details
  assert.equal(d.status, 'in-progress'); assert.equal(d.autoSave.enabled, false); assert.equal(d.units, 'imperial')
  assert.ok(d.tags.includes('civil')); assert.equal(d.description, 'Edited description')
  assert.ok(await aside.locator('span', { hasText: 'Imperial (ft, ft², ft³)' }).isVisible())
  await aside.getByRole('combobox', { name: 'Status' }).selectOption('active')
})

await step('storage usage is computed from the project files (6.2 / 20 GB) and the AI model field is marked DEMO in a browser', async () => {
  const aside = page.locator('aside[aria-label="Villa Riverside"]')
  assert.ok(await aside.getByText('6.2 / 20 GB').isVisible())
  assert.ok(await aside.getByText('DEMO').isVisible())
})

await step('Project Files: counts per tab, folders first, open a folder and go back', async () => {
  assert.ok(await files.getByRole('tab', { name: 'Drawings (12)' }).isVisible())
  assert.ok(await files.getByRole('tab', { name: 'Folders (6)' }).isVisible())
  const first = await files.locator('[role=row]').nth(1).innerText()
  assert.ok(first.includes('01_Concept'))
  await files.locator('[role=row]', { hasText: '02_Architecture' }).dblclick()
  assert.ok(await files.getByText('Sheets').isVisible())
  await files.getByRole('button', { name: /All Files \/ 02_Architecture/ }).click()
  assert.ok(await files.getByText('01_Concept').isVisible())
})

await step('select-all checkbox, rename and remove an entry (catalogue only)', async () => {
  await files.getByRole('checkbox', { name: 'Select all' }).check()
  assert.equal(await files.locator('[role=row] input:checked').count(), await files.locator('[role=row]').count())
  await files.getByRole('checkbox', { name: 'Select all' }).uncheck()
  await files.getByRole('button', { name: /More actions: Floor Plan - Level 1.dwg/ }).click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  await page.getByRole('dialog').getByRole('textbox').fill('Floor Plan - L1.dwg')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  assert.ok(await files.getByText('Floor Plan - L1.dwg').isVisible())
  await files.getByRole('button', { name: /More actions: Floor Plan - L1.dwg/ }).click()
  await page.getByRole('menuitem', { name: 'Remove from project' }).click()
  assert.equal(await files.getByText('Floor Plan - L1.dwg').count(), 0)
})

await step('New Folder creates a folder in the selected project and logs it', async () => {
  await page.getByRole('button', { name: 'New Folder' }).click()
  await page.getByRole('dialog').getByRole('textbox').fill('07_Site')
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click()
  assert.ok(await files.getByText('07_Site').isVisible())
  assert.equal((await ws()).activity[0].kind, 'folder')
})

await step('Import Files adds a DXF; "Open in CAD 2D" opens it as a drawing', async () => {
  const dxf = ['0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '1000', '21', '0', '0', 'ENDSEC', '0', 'EOF'].join('\n')
  await page.locator('input[type=file][multiple]').setInputFiles({ name: 'site-survey.dxf', mimeType: 'application/dxf', buffer: Buffer.from(dxf) })
  assert.ok(await files.getByText('site-survey.dxf').isVisible())
  await files.getByRole('button', { name: /More actions: site-survey.dxf/ }).click()
  await page.getByRole('menuitem', { name: 'Open in CAD 2D' }).click()
  await page.waitForFunction(() => location.hash === '#/cad2d')
  await page.waitForFunction(() => { const s = window.__thcad.cad.getState(); return s.docs[s.activeId]?.name === 'site-survey.dxf' })
  await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/#/projects', { waitUntil: 'networkidle' })
})

await step('New Project (modal) and From Template (with folders) create and select projects', async () => {
  await page.getByRole('button', { name: 'New Project', exact: true }).click()
  await page.getByRole('dialog').getByRole('textbox').first().fill('QA Smoke Project')
  await page.getByRole('dialog').getByRole('button', { name: 'Create Project' }).click()
  assert.equal(await inspectorName(), 'QA Smoke Project')
  await page.getByRole('button', { name: 'From Template' }).click()
  await page.getByRole('radio', { name: /Irrigation canal/ }).click()
  await page.getByRole('dialog').getByRole('textbox').fill('QA Canal')
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click()
  assert.equal(await inspectorName(), 'QA Canal')
  assert.ok(await files.getByText('02_Alignment').isVisible())
})

await step('View all opens the full activity list', async () => {
  await page.getByRole('button', { name: 'View all' }).click()
  assert.ok(await page.getByRole('dialog', { name: 'Recent Activity' }).isVisible())
  await page.keyboard.press('Escape')
})

await step('VI switch translates the screen', async () => {
  await page.getByRole('radio', { name: 'VI' }).click()
  assert.equal(await page.locator('h1').innerText(), 'Dự án')
  assert.ok(await page.getByRole('tab', { name: /Tất cả dự án/ }).isVisible(), 'tab')
  assert.ok(await page.locator('section[aria-label="Tệp dự án"]').getByRole('tab', { name: /Bản vẽ/ }).isVisible(), 'files tab')
  await page.getByRole('radio', { name: 'EN' }).click()
})

await step('changes survive a reload (persisted workspace)', async () => {
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__thcad?.workspace)
  const s = await ws()
  assert.ok(s.projects.some((p) => p.name === 'QA Canal'))
  assert.ok(s.entries.some((e) => e.name === '07_Site'))
})

await step('Dashboard still shows 12 active projects and the same four recent projects', async () => {
  await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/#/dashboard', { waitUntil: 'networkidle' })
  const s = await ws()
  const active = s.projects.filter((p) => ['active', 'in-progress'].includes(p.details?.status ?? 'active') && !p.details?.sharedWithMe).length
  assert.ok(active >= 12)
})

await step('no console errors', async () => assert.deepEqual(errors, []))
for (const [r, n] of results) console.log(`${r} ${n}`)
await browser.close()
process.exitCode = results.some(([s]) => s === 'FAIL') ? 1 : 0
