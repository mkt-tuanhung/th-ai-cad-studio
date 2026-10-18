// Interaction smoke test for the Architecture / BIM workspace. Fresh profile.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1586, height: 992 }, acceptDownloads: true })

// the app's default language is Vietnamese (owner, 2026-10-18); these checks are written against the EN strings
await ctx.addInitScript(() => { if (!localStorage.getItem('thcad.settings')) localStorage.setItem('thcad.settings', JSON.stringify({ state: { language: 'en' }, version: 2 })) })
ctx.setDefaultTimeout(5000)
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
const results = []
const step = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]) } catch (e) { results.push(['FAIL', name + ' — ' + e.message.split('\n')[0]]) }
}
const bim = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__thcad.bim.getState())))
const prop = (label) => page.locator(`text="${label}"`).locator('xpath=following-sibling::span[1]').innerText()

await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/#/bim', { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__thcad?.bim)

await step('mockup state: 3D view, W1 in Properties, Walls (24), checks 0/3/5/0/0', async () => {
  assert.equal(await page.getByRole('tab', { name: '3D' }).getAttribute('aria-selected'), 'true')
  assert.ok(await page.getByText('Generic - 200mm Concrete').first().isVisible())
  assert.ok(await page.getByRole('tab', { name: 'Walls (24)' }).isVisible())
  assert.equal(await prop('Area'), '12.75 m²')
  assert.equal(await prop('Volume'), '2.55 m³')
  for (const s of ['No critical issues', '3 conflicts found', '5 warnings', 'All rooms placed', 'Passed']) assert.ok(await page.getByText(s, { exact: true }).isVisible(), s)
})

await step('schedule quantities are computed (W3: 2,800 mm × 3 m → 8.40 m², 150 mm → 1.26 m³)', async () => {
  const row = page.getByRole('row').filter({ hasText: 'W3' })
  assert.match(await row.innerText(), /2,800[\s\S]*8\.40[\s\S]*1\.26/)
})

await step('selecting a schedule row shows that element; doors tab lists 12 doors', async () => {
  await page.getByRole('row').filter({ hasText: 'W4' }).click()
  assert.equal(await prop('Base Level'), 'Level 2')
  await page.getByRole('tab', { name: 'Doors (12)' }).click()
  assert.equal(await page.locator('[role=row]').filter({ hasText: /^.*D\d+/ }).count(), 12)
  await page.getByRole('row').filter({ hasText: 'D3' }).click()
  assert.equal(await prop('Host Wall'), 'W2')
  await page.getByRole('tab', { name: 'Walls (24)' }).click()
})

await step('edit Top Level → height/area/volume recompute; invalid edit is rejected; ⌘Z undoes', async () => {
  await page.getByRole('row').filter({ hasText: 'W1' }).first().click()
  await page.getByRole('button', { name: 'Edit Top Level' }).click()
  await page.locator('select').filter({ hasText: 'Level 3' }).last().selectOption('L3')
  assert.equal(await prop('Area'), '25.50 m²')
  await page.getByRole('button', { name: 'Edit Top Level' }).click()
  await page.locator('select').filter({ hasText: 'Level 3' }).last().selectOption('L1')
  assert.ok(await page.getByText(/Not applied: W1/).isVisible())
  assert.equal(await prop('Area'), '25.50 m²')
  await page.locator('body').click({ position: { x: 900, y: 500 } })
  await page.keyboard.press('Meta+z')
  assert.equal(await prop('Area'), '12.75 m²')
})

await step('Type Mark inline edit updates the schedule', async () => {
  await page.getByRole('button', { name: 'Edit Type Mark' }).click()
  await page.keyboard.press('Meta+a'); await page.keyboard.type('W1-EXT'); await page.keyboard.press('Enter')
  assert.ok(await page.getByRole('row').filter({ hasText: 'W1-EXT' }).isVisible())
  await page.locator('body').click({ position: { x: 900, y: 500 } })
  await page.keyboard.press('Meta+z')
})

await step('Check Model re-runs deterministic checks', async () => {
  await page.getByRole('button', { name: 'Check Model' }).click()
  assert.ok(await page.getByText(/Model checked/).isVisible())
  assert.ok((await bim()).checkedAt > 0)
})

await step('Elevations / sections open the 2D drawing view; in a browser it explains the kernel draws them in the desktop app', async () => {
  await page.getByRole('button', { name: 'South Elevation', exact: true }).click()
  assert.ok(await page.getByTestId('bim-drawing').isVisible())
  assert.ok(await page.getByText(/drawn by the OCCT kernel \(hidden-line removal\) in the desktop app/).isVisible())
  assert.equal((await bim()).view, 'drawing')
  await page.getByRole('tab', { name: '3D', exact: true }).click()
})

await step('Coordination settings: a check can be turned off (shows “Off”) and back on; auto-check after edits', async () => {
  await page.getByRole('button', { name: 'Coordination settings' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Clash Detection' }).click()
  assert.equal(await page.getByRole('menuitemcheckbox', { name: 'Clash Detection' }).getAttribute('aria-checked'), 'false')
  await page.keyboard.press('Escape')
  assert.ok(await page.getByRole('button', { name: /^Clash Detection\s*Off/ }).isVisible())
  await page.getByRole('button', { name: 'Coordination settings' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Clash Detection' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Check after every edit' }).click()
  await page.keyboard.press('Escape')
  assert.equal((await bim()).coordAuto, true)
  assert.equal(await page.getByRole('button', { name: /^Clash Detection\s*Off/ }).count(), 0)
})

await step('AI recommendation: confirm → W1 type changes, volume 3.19 m³; undo restores', async () => {
  await page.getByRole('button', { name: 'Apply Suggestion' }).click()
  assert.ok(await page.getByRole('dialog').getByText(/not generated on this machine/).isVisible())
  await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click()
  assert.equal(await prop('Volume'), '3.19 m³')
  assert.equal(await prop('Thickness'), '250.0 mm')
  await page.locator('body').click({ position: { x: 900, y: 500 } })
  await page.keyboard.press('Meta+z')
  assert.equal(await prop('Thickness'), '200.0 mm')
})

await step('display modes switch (Wireframe applies a filter to the render)', async () => {
  await page.getByRole('radio', { name: 'Wireframe' }).click()
  const f = await page.locator('img[alt^="Villa Riverside — 3D"]').evaluate((el) => getComputedStyle(el).filter)
  assert.match(f, /url/)
  await page.getByRole('radio', { name: 'Realistic' }).click()
})

await step('Plan tab renders the Level 1 drawing; Schedule tab shows the full table', async () => {
  await page.getByRole('tab', { name: 'Plan' }).click()
  await page.locator('[data-native-viewport-slot="bim-plan"] > svg').waitFor()
  await page.getByRole('tab', { name: 'Schedule' }).click()
  assert.ok((await page.getByRole('row').count()) > 30)
  await page.getByRole('tab', { name: '3D' }).click()
})

await step('Project Browser: Level 2 opens plan view at Level 2; search filters; collapse', async () => {
  await page.getByRole('button', { name: 'Level 2', exact: true }).click()
  assert.equal(await page.getByRole('tab', { name: 'Plan' }).getAttribute('aria-selected'), 'true')
  assert.equal((await bim()).level, 'L2')
  await page.getByRole('textbox', { name: 'Search views, sheets, families...' }).fill('north')
  assert.ok(await page.getByText('North Elevation').isVisible())
  assert.equal(await page.getByText('South Elevation').count(), 0)
  await page.getByRole('textbox', { name: 'Search views, sheets, families...' }).fill('')
  await page.getByRole('button', { name: 'Collapse browser' }).click()
  assert.ok(await page.getByRole('button', { name: 'Expand browser' }).isVisible())
  await page.getByRole('button', { name: 'Expand browser' }).click()
  await page.getByRole('button', { name: 'Level 1', exact: true }).click()
  await page.getByRole('tab', { name: '3D' }).click()
})

await step('Wall tool opens the model plan with the tool armed; Esc returns to Select', async () => {
  await page.getByRole('button', { name: 'Wall', exact: true }).click()
  assert.equal(await page.getByTestId('bim-plan').getAttribute('data-tool'), 'wall')
  assert.ok(await page.getByText(/Click the start, then each corner/).isVisible())
  await page.keyboard.press('Escape')
  assert.equal(await page.getByTestId('bim-plan').getAttribute('data-tool'), 'select')
  await page.getByRole('tab', { name: '3D' }).click()
})

await step('Export → IFC 4: a STEP file with storeys, walls with openings, doors, windows, spaces', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), (async () => {
    await page.getByRole('button', { name: 'Export', exact: true }).first().click()
    await page.getByRole('menuitem', { name: 'IFC 4 (.ifc)' }).click()
  })()])
  assert.equal(dl.suggestedFilename(), 'Villa Riverside.ifc')
  const ifc = fs.readFileSync(await dl.path(), 'utf8')
  assert.match(ifc, /^ISO-10303-21;/)
  assert.match(ifc, /FILE_SCHEMA\(\('IFC4'\)\)/)
  const n = (e) => (ifc.match(new RegExp(`=${e}\\(`, 'g')) ?? []).length
  assert.deepEqual([n('IFCBUILDINGSTOREY'), n('IFCWALL'), n('IFCDOOR'), n('IFCWINDOW'), n('IFCOPENINGELEMENT'), n('IFCRELVOIDSELEMENT'), n('IFCSPACE')], [4, 24, 12, 18, 30, 30, 8])
  assert.ok(await page.getByText(/Exported Villa Riverside.ifc — IFC 4/).isVisible())
})

await step('Export → wall schedule CSV with computed quantities', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), (async () => {
    await page.getByRole('button', { name: 'Export', exact: true }).first().click()
    await page.getByRole('menuitem', { name: 'Wall schedule (CSV)' }).click()
  })()])
  const csv = fs.readFileSync(await dl.path(), 'utf8')
  assert.match(csv, /^Mark,Family and Type/)
  assert.match(csv, /W1,Generic - 200mm Concrete,Level 1,4250,12\.75,2\.55,1/)
  assert.equal(csv.trim().split('\n').length, 25)
})

await step('Comments: add a comment on W1, persists across reload', async () => {
  await page.getByRole('tab', { name: 'Comments' }).click()
  await page.getByRole('textbox', { name: /Add a comment/ }).fill('Check insulation detail')
  await page.getByRole('button', { name: /^Add/ }).click()
  await page.reload({ waitUntil: 'networkidle' })
  assert.ok(await page.getByText('Check insulation detail').isVisible())
  await page.getByRole('tab', { name: 'Properties' }).click()
})

await step('maximize viewer hides the bottom cards', async () => {
  await page.getByRole('button', { name: 'Maximize viewer' }).click()
  assert.equal(await page.getByText('Model Coordination').count(), 0)
  await page.getByRole('button', { name: 'Restore layout' }).click()
  assert.ok(await page.getByText('Model Coordination').isVisible())
})

await step('VI translates BIM chrome', async () => {
  await page.getByRole('radio', { name: 'VI' }).click()
  assert.ok(await page.getByText('Trình duyệt dự án').isVisible())
  assert.ok(await page.getByRole('tab', { name: 'Tường (24)' }).isVisible())
  await page.getByRole('radio', { name: 'EN' }).click()
})

await step('no console errors', async () => assert.deepEqual(errors, []))
for (const [s, n] of results) console.log(s, n)
await browser.close()
process.exitCode = results.some(([s]) => s === 'FAIL') ? 1 : 0
