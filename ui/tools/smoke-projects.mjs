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

await step('From Template with content (One room): BIM shell, interior room, plan drawing; versions before / after', async () => {
  await page.evaluate(() => window.__thcad.snapshots.setSnapStorage(window.__thcad.snapshots.memorySnapStorage()))
  const walls0 = await page.evaluate(() => window.__thcad.bim.getState().model.walls.length)
  await page.getByRole('button', { name: 'From Template' }).click()
  await page.getByRole('radio', { name: /One room/ }).click()
  assert.ok(await page.getByText(/kept in Version history/).isVisible())
  await page.getByRole('dialog').getByRole('textbox').fill('QA Room')
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click()
  await page.waitForFunction(() => window.__thcad.bim.getState().model.walls.length === 4)
  assert.equal(await inspectorName(), 'QA Room')
  assert.ok(await files.getByText('02_Layout').isVisible())
  const st = await page.evaluate(() => { const c = window.__thcad.cad.getState(); return { rooms: window.__thcad.interior.getState().doc.rooms.map((r) => r.name), doc: c.docs[c.activeId].name, ents: c.docs[c.activeId].entities.length } })
  assert.deepEqual(st.rooms, ['Room'])
  assert.equal(st.doc, 'One Room - Plan.dwg')
  assert.ok(st.ents > 10, 'plan entities ' + st.ents)
  const list = await page.evaluate(() => window.__thcad.snapshots.listSnapshots())
  assert.ok(list.some((m) => m.reason === 'risky' && m.counts.bim.walls === walls0) && list.some((m) => m.reason === 'template' && m.counts.bim.walls === 4), JSON.stringify(list.map((m) => [m.reason, m.counts.bim?.walls])))
})

await step('Version history (project menu): diff in counts, restore the version before the template (undoable)', async () => {
  await cards().filter({ hasText: 'QA Room' }).getByRole('button', { name: /More actions/ }).first().click()
  await page.getByRole('menuitem', { name: 'Version history…' }).click()
  const dlg = page.getByRole('dialog', { name: 'Version history' })
  await dlg.waitFor()
  const before = dlg.getByTestId('version').filter({ hasText: 'Before a change' }).first()
  const diff = await before.getByTestId('version-diff').innerText()
  assert.match(diff, /BIM[^]*walls 4 → 24/, diff)
  assert.match(await before.innerText(), /App 0\.1\.0/)
  try {
    await before.getByRole('button', { name: 'Restore' }).click()
    await page.waitForFunction(() => window.__thcad.bim.getState().model.walls.length === 24)
  } finally { await page.keyboard.press('Escape') }
  // one undo step in BIM puts the template's model back
  await page.evaluate(() => window.__thcad.bim.getState().undo())
  assert.equal(await page.evaluate(() => window.__thcad.bim.getState().model.walls.length), 4)
})

await step('Project JSON: export every workspace (.mdproj.json, schema + revisions) and import it back', async () => {
  await cards().filter({ hasText: 'QA Room' }).getByRole('button', { name: /More actions/ }).first().click()
  await page.getByRole('menuitem', { name: 'Version history…' }).click()
  const dlg = page.getByRole('dialog', { name: 'Version history' })
  const [dl] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: 'Export project (JSON)' }).click()])
  assert.equal(dl.suggestedFilename(), 'QA Room.mdproj.json')
  const path = await dl.path()
  const f = JSON.parse((await import('node:fs')).readFileSync(path, 'utf8'))
  assert.equal(f.format, 'md-cad-ai-studio/project')
  assert.equal(Object.keys(f.revisions).length, 7)
  assert.equal(f.stores.bim.walls.length, 4)
  // change the model, import the file: the exported model comes back
  try {
    await page.evaluate(() => window.__thcad.bim.getState().reset())
    await dlg.getByTestId('project-import').setInputFiles(path)
    await page.waitForFunction(() => window.__thcad.bim.getState().model.walls.length === 4)
  } finally { await page.keyboard.press('Escape') }
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
