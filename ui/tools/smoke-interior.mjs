// Interaction smoke test — Interior workspace (mockup 09). Fresh profile, dev server :5173.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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
await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/#/interior', { waitUntil: 'networkidle' })
const doc = () => page.evaluate(() => JSON.parse(localStorage.getItem('thcad.interior') ?? '{"state":{}}').state.doc)
const table = (name) => page.getByRole('table', { name })
const rows = (name) => table(name).getByRole('row')
const cellText = async (name, rowName) => (await table(name).getByRole('row').filter({ hasText: rowName }).first().innerText())
const right = () => page.locator('section[aria-label]').filter({ has: page.getByRole('tab', { name: 'AI Assistant' }) }).last()
const undo = () => page.keyboard.press('Meta+z')

await step('opens like the mockup: Design tab, Living Room active, AI Assistant panel, 6 furniture rows, DEMO render badge', async () => {
  assert.equal(await page.getByRole('tab', { name: 'Design' }).getAttribute('aria-selected'), 'true')
  assert.equal(await page.getByRole('tab', { name: 'AI Assistant' }).getAttribute('aria-selected'), 'true')
  assert.ok(await page.locator('[aria-current="true"]').filter({ hasText: 'Living Room' }).isVisible())
  assert.equal(await rows('Furniture & Items').count(), 7) // header + 6
  assert.ok(await page.getByText('DEMO render · the OCCT 3D engine runs in the desktop app').isVisible())
  assert.equal(await page.getByText('Model Ready').count(), 0)
})

await step('Room Information is computed from the room outline (28.6 m², 22.8 m) and follows the room picker', async () => {
  assert.ok(await page.getByText('28.6 m²').isVisible())
  assert.ok(await page.getByText('22.8 m', { exact: true }).isVisible())
  await page.getByRole('combobox', { name: 'Room Information' }).selectOption('dining')
  assert.ok(await page.getByText('21.3 m²').isVisible())
  await page.getByRole('combobox', { name: 'Room Information' }).selectOption('living')
})

await step('selecting a row opens Properties; quantity edit is validated (0 rejected), applied, and undoable with ⌘Z', async () => {
  await rows('Furniture & Items').filter({ hasText: 'Dining Chair' }).click()
  assert.equal(await page.getByRole('tab', { name: 'Properties' }).getAttribute('aria-selected'), 'true')
  const qty = page.getByRole('textbox', { name: 'Quantity' })
  await qty.fill('0'); await qty.press('Enter')
  assert.equal((await doc()).items.find((i) => i.name === 'Dining Chair').qty, 6)
  await qty.fill('8'); await qty.press('Enter')
  assert.equal((await doc()).items.find((i) => i.name === 'Dining Chair').qty, 8)
  assert.match(await cellText('Furniture & Items', 'Dining Chair'), /\b8\b/)
  await page.locator('body').click({ position: { x: 900, y: 500 } })
  await undo()
  assert.equal((await doc()).items.find((i) => i.name === 'Dining Chair').qty, 6)
})

await step('Japandi style preset re-materials the living room (rule-based) and ⌘Z restores it', async () => {
  await page.getByRole('tab', { name: 'AI Assistant' }).click()
  await page.getByRole('figure').filter({ hasText: 'Japandi Style' }).getByRole('button', { name: 'Apply' }).click()
  assert.equal((await doc()).items.find((i) => i.name === 'Sofa L-Shape').material, 'Fabric - Linen')
  assert.equal((await doc()).items.find((i) => i.name === 'Dining Table').material, 'Wood - Oak', 'other rooms untouched')
  await page.locator('body').click({ position: { x: 900, y: 500 } })
  await undo()
  assert.equal((await doc()).items.find((i) => i.name === 'Sofa L-Shape').material, 'Fabric - Beige')
})

await step('Cut List derives panels from the cabinets; resizing the TV Cabinet updates the top/bottom length', async () => {
  await page.getByRole('tab', { name: 'Cut List (Production)' }).click()
  const top = async () => cellText('Cut List (Production)', 'TV Cabinet').then(() => table('Cut List (Production)').getByRole('row').filter({ hasText: 'TV Cabinet' }).filter({ hasText: 'Top / bottom' }).innerText())
  assert.match(await top(), /3164 × 400/) // 3200 − 2 × 18
  assert.match(await page.getByText(/parts · board/).innerText(), /edge banding/)
  await page.getByRole('tab', { name: 'Furniture & Items' }).click()
  await rows('Furniture & Items').filter({ hasText: 'TV Cabinet' }).click()
  await page.getByRole('button', { name: /^TV Cabinet/ }).click()
  const w = page.getByRole('textbox', { name: 'Width' })
  await w.fill('2400'); await w.press('Enter')
  await page.getByRole('tab', { name: 'Cut List (Production)' }).click()
  assert.match(await top(), /2364 × 400/)
  assert.equal((await doc()).items.find((i) => i.name === 'TV Cabinet').w, 2400, 'furniture item follows the cabinet')
})

await step('Cabinet Parametric adds a cabinet with its cut list; impossible sizes keep Add disabled', async () => {
  await page.getByRole('button', { name: 'Cabinet Parametric' }).click()
  const dlg = page.getByRole('dialog', { name: 'New parametric cabinet' })
  await dlg.getByRole('textbox', { name: 'Width (mm)' }).fill('100')
  assert.equal(await dlg.getByRole('button', { name: 'Add cabinet' }).isDisabled(), true)
  await dlg.getByRole('textbox', { name: 'Width (mm)' }).fill('1200')
  await dlg.getByRole('button', { name: 'Add cabinet' }).click()
  const d = await doc()
  assert.equal(d.cabinets.length, 4)
  assert.ok(await table('Cut List (Production)').getByRole('row').filter({ hasText: 'Cabinet 4' }).first().isVisible())
})

await step('Room Quantities: Living Room floor 28.61, perimeter 22.80, gross walls 68.40', async () => {
  await page.getByRole('tab', { name: 'Room Quantities' }).click()
  const r = await cellText('Room Quantities', 'Living Room')
  assert.match(r, /28\.61/); assert.match(r, /22\.80/); assert.match(r, /68\.40/)
})

await step('Materials tab assigns a material to the selected item', async () => {
  await page.getByRole('tab', { name: 'Furniture & Items' }).click()
  await rows('Furniture & Items').filter({ hasText: 'Coffee Table' }).click()
  await page.getByRole('tab', { name: 'Materials' }).last().click()
  await page.getByRole('button', { name: /Wood - Oak/ }).click()
  assert.equal((await doc()).items.find((i) => i.name === 'Coffee Table').material, 'Wood - Oak')
})

await step('View all lists every item; display mode Wireframe applies', async () => {
  await page.getByRole('button', { name: 'View all' }).click()
  assert.equal(await rows('Furniture & Items').count(), (await doc()).items.length + 1)
  await page.getByRole('radio', { name: 'Wireframe' }).click()
  assert.equal(await page.getByRole('radio', { name: 'Wireframe' }).getAttribute('aria-checked'), 'true')
  await page.getByRole('radio', { name: 'Realistic' }).click()
})

await step('Export → Cut list CSV downloads real rows', async () => {
  await page.getByRole('button', { name: 'Export' }).click()
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Cut list — production (CSV)' }).click()])
  const text = await (await dl.createReadStream()).toArray().then((c) => Buffer.concat(c).toString())
  assert.match(text, /^Cabinet,Part,Qty/)
  assert.match(text, /Wardrobe,Shelf/)
})

await step('ribbon + header: Cut List tool opens the tab, Drawings goes to CAD 2D', async () => {
  await page.getByRole('tab', { name: 'Furniture & Items' }).click()
  await page.getByRole('button', { name: 'Cut List', exact: true }).click()
  assert.equal(await page.getByRole('tab', { name: 'Cut List (Production)' }).getAttribute('aria-selected'), 'true')
  await page.getByRole('tab', { name: 'Drawings' }).click()
  await page.waitForURL(/#\/cad2d/)
  await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/#/interior', { waitUntil: 'networkidle' })
})

await step('VI: workspace, tabs, rooms and default brief are translated', async () => {
  await page.getByRole('radio', { name: 'VI', exact: true }).click()
  assert.ok(await page.getByRole('tab', { name: 'Thiết kế' }).isVisible())
  await page.getByRole('tab', { name: 'Trợ lý AI' }).last().click()
  assert.ok(await page.getByText('Thông tin phòng').isVisible())
  assert.match(await page.locator('textarea').inputValue(), /^Gợi ý phòng khách/)
  assert.ok(await page.locator('[aria-current="true"]').filter({ hasText: 'Phòng khách' }).isVisible())
  await page.getByRole('radio', { name: 'EN', exact: true }).click()
})

/** Names in a ZIP (central directory). */
const zipNames = (buf) => {
  const out = []
  for (let i = 0; i + 46 < buf.length; i++) if (buf.readUInt32LE(i) === 0x02014b50) { const n = buf.readUInt16LE(i + 28); out.push(buf.slice(i + 46, i + 46 + n).toString('utf8')); i += 45 + n }
  return out
}

await step('Cut list → Nesting & CNC: machine first, then real sheets, simulated (preview) programs, preview ZIP; production blocked', async () => {
  await page.getByRole('tab', { name: 'Cut List (Production)' }).click()
  assert.match(await page.locator('[class*=cutSum]').innerText(), /Sheets \(nested, 2440 × 1830\): MFC 18 - Walnut × \d+/)
  await page.getByTestId('open-nesting').click()
  const d = page.getByTestId('nesting-dialog')
  await d.waitFor()
  // no machine profile yet: nesting / CAM wait for one, nothing can be exported
  assert.match(await page.getByTestId('nesting-no-machine').innerText(), /Choose the machine first/)
  assert.equal(await page.getByTestId('export-preview').count(), 0)
  await page.getByTestId('machine-select').selectOption('DEMO_1_HEADS_NOT_FOR_MACHINE')
  assert.match(await page.getByTestId('nesting-summary').innerText(), /\d+ parts on \d+ sheets/)
  const text = await d.innerText()
  assert.match(text, /\d+ part\(s\) larger than the stock/)
  const chips = await d.locator('[class*=cncRow]').innerText()
  assert.ok(chips.includes('✓') && !chips.includes('✗'), chips)
  assert.ok(!/verified ✓|verified:/.test(text), 'the old "verified" wording is gone')
  assert.match(await page.getByTestId('not-for-machine').innerText(), /NOT FOR MACHINE: this profile is UNVERIFIED/)
  assert.match(await page.getByTestId('machine-heads').innerText(), /1 router spindle\(s\) · 0 saw blade\(s\)/)
  // a 1-head router without drilling: drilling is listed as not machined instead of being written
  assert.match(await page.getByTestId('not-machined').innerText(), /Vertical drilling: NO_HEAD_FOR_OPERATION/)
  assert.ok(await page.getByTestId('export-production').isDisabled())
  await page.getByTestId('blockers').locator('summary').click()
  assert.match(await page.getByTestId('blockers').innerText(), /MACHINE_PROFILE_NOT_VERIFIED — machine profile is not VERIFIED/)
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-preview').click()])
  assert.match(dl.suggestedFilename(), /NOT FOR MACHINE/)
  const buf = readFileSync(await dl.path())
  assert.equal(buf.readUInt32LE(0), 0x04034b50) // ZIP local header
  const names = zipNames(buf)
  assert.ok(names.length > 1 && names.every((n) => n.endsWith('.NOT_FOR_MACHINE.txt') || n === 'manifest.json') && names.includes('manifest.json'), names.join(' | '))
  for (const s of ['(ENGINEERING PREVIEW - NOT FOR MACHINE USE)', '(machine=DEMO_1_HEADS_NOT_FOR_MACHINE status=UNVERIFIED', 'M0 (ENGINEERING PREVIEW - NOT FOR MACHINE USE - STOP)', 'G21 G90 G17 G94', '"kind": "ENGINEERING_PREVIEW"']) assert.ok(buf.includes(Buffer.from(s)), s)
  // after the review a changed measured thickness makes the job STALE
  await page.getByLabel('MFC 18 - Walnut Measured thickness (mm)').fill('18.4')
  assert.match(await page.getByTestId('job-stale').innerText(), /STALE: stock changed after the last review/)
  assert.match(await page.getByTestId('job-status').innerText(), /STALE/)
  // Machines & Tools opens from the dialog: the four v2.3 samples, all UNVERIFIED
  await page.getByTestId('open-machines').click()
  const m = page.getByTestId('machines-dialog')
  await m.waitFor()
  for (const id of ['DEMO_1_HEADS_NOT_FOR_MACHINE', 'DEMO_2_HEADS_NOT_FOR_MACHINE', 'DEMO_3_HEADS_NOT_FOR_MACHINE', 'DEMO_2_SAW_BLADES_NOT_FOR_MACHINE']) assert.ok((await m.innerText()).includes(id), id)
  assert.match(await page.getByTestId('machine-gate').innerText(), /MACHINE_PROFILE_NOT_VERIFIED/)
  // commissioning without the required evidence never verifies
  await page.getByTestId('commission-run').click()
  assert.match(await page.getByTestId('commission-last').innerText(), /FAILED: .*AIR_CUT_FAILED/)
  await page.getByRole('dialog', { name: 'Machines & Tools' }).getByRole('button', { name: 'Close' }).click()
  await page.getByRole('dialog', { name: 'Nesting & CNC' }).getByRole('button', { name: 'Close' }).click()
})

// ---- machine library (v2.4): pick a machine, panel saw patterns, commissioning wizard, own machine, hardware
const shots = process.env.QA_SHOTS ?? new URL('../../qa/v2_4/machlib/', import.meta.url).pathname
const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: shots + name }) }

await step('Machine library: filter + detail card (confidence, reference note, sources) → "Use this machine" makes an UNVERIFIED profile and picks it for the job', async () => {
  await page.getByTestId('open-nesting').click()
  await page.getByTestId('nesting-dialog').waitFor()
  await page.getByTestId('open-library').click()
  await page.getByTestId('machine-library').waitFor()
  await page.getByTestId('library-category').selectOption('panel-saw')
  assert.match(await page.getByTestId('library-list').innerText(), /3800|panel|saw/i)
  await page.getByTestId('library-list').locator('button').first().click()
  assert.match(await page.getByTestId('library-refnote').innerText(), /catalogue references — measure and confirm/)
  assert.ok((await page.getByTestId('library-confidence').innerText()).length > 0)
  assert.ok((await page.getByTestId('library-similar').locator('button').count()) > 0, 'similar machines listed')
  await shot('01_library_detail.png')
  await page.getByTestId('library-profile-id').fill('MY_PANEL_SAW_1')
  await page.getByTestId('library-use').click()
  // back on "My machines" with the new profile, UNVERIFIED, and the job now uses it
  assert.match(await page.getByTestId('machines-dialog').innerText(), /MY_PANEL_SAW_1/)
  assert.match(await page.getByTestId('machine-gate').innerText(), /MACHINE_PROFILE_NOT_VERIFIED/)
  // catalogues give no kerf: nothing is nested until the measured blade kerf is entered
  await page.getByTestId('machines-dialog').getByLabel('Kerf (mm, measured)').first().fill('4.4')
  await page.getByTestId('machine-save').click()
  await page.getByRole('dialog', { name: 'Machines & Tools' }).getByRole('button', { name: 'Close' }).click()
  assert.equal(await page.getByTestId('machine-select').inputValue(), 'MY_PANEL_SAW_1')
})

await step('Panel saw profile: guillotine cutting patterns (no router programs), cut-list CSV, production release blocked until commissioned', async () => {
  assert.match(await page.getByTestId('saw-summary').innerText(), /never router paths/)
  assert.ok(await page.getByTestId('saw-pattern').locator('svg').isVisible())
  assert.equal(await page.getByTestId('export-preview').count(), 0, 'no router NC preview for a saw')
  assert.ok(await page.getByTestId('export-production').isDisabled())
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-saw-list').click()])
  const text = readFileSync(await dl.path(), 'utf8')
  assert.match(text, /^Pattern,Sheets,Books,Sheets per book,Material/)
  await shot('02_panel_saw_patterns.png')
})

await step('Commissioning wizard: survey checklist, automated parser / backplot run, first-article table; recording without evidence never verifies', async () => {
  await page.getByTestId('machine-select').selectOption('DEMO_1_HEADS_NOT_FOR_MACHINE')
  await page.getByTestId('open-machines').click()
  await page.getByTestId('commissioning').scrollIntoViewIfNeeded()
  await shot('03_wizard_survey.png')
  await page.getByTestId('wiz-step-3').click()
  await page.getByTestId('wiz-auto').click()
  assert.match(await page.getByTestId('wiz-auto-result').innerText(), /Parser .* backplot .* program/)
  await page.getByTestId('commissioning').scrollIntoViewIfNeeded()
  await shot('04_wizard_automated.png')
  await page.getByTestId('wiz-step-5').click()
  assert.ok(await page.getByTestId('wiz-fa').isVisible())
  await page.getByTestId('commission-run').click()
  assert.match(await page.getByTestId('commission-last').innerText(), /FAILED: .*SURVEY|FAILED: .*AIR_CUT_FAILED/)
})

await step('Enter my machine: the form validates (make / model / envelope required) before it can be saved', async () => {
  await page.getByRole('tab', { name: 'Enter my machine' }).click()
  await page.getByTestId('own-start').click()
  assert.match(await page.getByTestId('own-errors').innerText(), /manufacturer and model/)
  await shot('05_own_machine.png')
  await page.getByRole('dialog', { name: 'Machines & Tools' }).getByRole('button', { name: 'Close' }).click()
  await page.getByRole('dialog', { name: 'Nesting & CNC' }).getByRole('button', { name: 'Close' }).click()
})

await step('Cabinet hardware dialog: Blum-like hinge → needs boring distance; with it the plan is valid; Apply stores it (one undo step)', async () => {
  await page.getByRole('tab', { name: 'Furniture & Items' }).click()
  await rows('Furniture & Items').filter({ hasText: 'TV Cabinet' }).click()
  await page.getByRole('button', { name: /^TV Cabinet/ }).click()
  await page.getByTestId('open-hardware').click()
  await page.getByTestId('hardware-dialog').waitFor()
  await page.getByTestId('hw-hinge').selectOption('generic-hinge-35-system32')
  assert.match(await page.getByTestId('hw-issues').innerText(), /HW_NEEDS_DATA/)
  await page.getByRole('textbox', { name: /Boring distance C/ }).fill('4')
  await page.getByRole('textbox', { name: 'Hinge from the door ends (mm)' }).fill('100')
  assert.match(await page.getByTestId('hw-issues').innerText(), /No problem found/)
  await shot('06_hardware_dialog.png')
  await page.getByRole('button', { name: 'Apply' }).click()
  const c = (await doc()).cabinets.find((x) => x.name === 'TV Cabinet')
  assert.equal(c.hardware.hinge, 'generic-hinge-35-system32')
  assert.equal(c.hardware.boringDistance, 4)
})

await step('VI: machine library tab and reference note are translated', async () => {
  await page.getByRole('tab', { name: 'Cut List (Production)' }).click()
  await page.getByRole('radio', { name: 'VI', exact: true }).click()
  await page.getByTestId('open-nesting').click()
  await page.getByTestId('open-library').click()
  assert.ok(await page.getByRole('tab', { name: 'Thư viện máy' }).isVisible())
  assert.match(await page.getByTestId('library-refnote').innerText(), /tham khảo catalogue/)
  await shot('07_library_vi.png')
  await page.getByRole('dialog', { name: 'Máy & Dao' }).getByRole('button', { name: 'Close' }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('radio', { name: 'EN', exact: true }).click()
})

for (const [r, n] of results) console.log(`${r}  ${n}`)
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.join('\n'))
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed}/${results.length} passed${errors.length ? `, ${errors.length} console errors` : ''}`)
await browser.close()
process.exitCode = failed || errors.length ? 1 : 0
