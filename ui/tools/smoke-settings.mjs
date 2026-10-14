// Interaction smoke test — Settings & Local AI Models (mockup 06). Fresh profile, dev server :5173.
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
    localStorage.setItem('thcad.settings', JSON.stringify({ state: { language: 'en' }, version: 1 }))
    sessionStorage.setItem('seeded', '1')
  }
})
await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/#/settings', { waitUntil: 'networkidle' })
const settings = () => page.evaluate(() => JSON.parse(localStorage.getItem('thcad.settings')).state)
const save = () => page.getByRole('button', { name: 'Save Changes', exact: true }).click()

await step('opens on General with the six cards of the mockup and the right rail', async () => {
  for (const n of ['AI Model Configuration', 'File Locations', 'Units & Precision', 'Interface & Appearance', 'File Handling Options', 'Performance', 'Current Configuration', 'Storage Usage', 'Help & Resources'])
    assert.ok(await page.locator(`section[aria-label="${n}"]`).isVisible(), n)
})

await step('browser preview never shows fake runtime status: AI marked Demo UI / Not connected, VRAM tagged DEMO', async () => {
  assert.ok(await page.locator('section[aria-label="AI Model Configuration"]').getByText('Demo UI / Not connected').first().isVisible())
  assert.ok(await page.locator('section[aria-label="AI Model Configuration"]').getByText('DEMO', { exact: true }).isVisible())
  assert.equal(await page.getByText('Model Ready').count(), 0)
})

await step('edits are drafts: unit system change shows "Unsaved changes" and updates the preview but not the saved value', async () => {
  await page.getByRole('radio', { name: 'm', exact: true }).click()
  assert.ok(await page.getByText('Unsaved changes').isVisible())
  assert.ok(await page.getByText('1.23 m', { exact: true }).isVisible())
  assert.equal((await settings()).units ?? 'mm', 'mm')
})

await step('Save Changes persists units / precision / angle units and the rail reflects them', async () => {
  await page.getByRole('combobox', { name: 'Precision' }).selectOption('3')
  await page.getByRole('combobox', { name: 'Angle Units' }).selectOption('rad')
  await save()
  const st = await settings()
  assert.equal(st.units, 'm'); assert.equal(st.precision, 3); assert.equal(st.angleUnits, 'rad')
  const rail = page.locator('section[aria-label="Current Configuration"]')
  assert.ok(await rail.getByText('Meters (m)').isVisible())
  assert.ok(await rail.getByText('Radians (rad)').isVisible())
  assert.equal(await page.getByText('Unsaved changes').count(), 0)
})

await step('DIST in CAD 2D reports in the saved units and precision', async () => {
  await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/#/cad2d', { waitUntil: 'networkidle' })
  const input = page.getByRole('textbox', { name: 'Type a command or use AI...' })
  for (const l of ['DIST', '0,0', '3000,4000']) { await input.fill(l); await input.press('Enter') }
  const log = await page.getByRole('log').innerText()
  assert.match(log, /Distance = 5\.000 m/)
  assert.match(log, /Angle in XY Plane = 0\.927 rad/)
  for (const l of ['AREA', '0,0', '2000,0', '2000,3000', '0,3000', '']) { await input.fill(l); await input.press('Enter') }
  assert.match(await page.getByRole('log').innerText(), /Area = 6\.000 m²,\s+Perimeter = 10\.000 m/)
  await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/#/settings', { waitUntil: 'networkidle' })
})

await step('language select switches the whole UI to Vietnamese after Save', async () => {
  await page.getByRole('combobox', { name: 'Language' }).selectOption('vi')
  await save()
  assert.ok(await page.getByRole('heading', { name: 'Cài đặt', exact: true }).isVisible())
  await page.getByRole('combobox', { name: 'Ngôn ngữ' }).selectOption('en')
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
  assert.ok(await page.getByRole('heading', { name: 'Settings', exact: true }).isVisible())
})

await step('interface toggles: compact UI and animations apply to <html> after Save', async () => {
  await page.getByRole('switch', { name: 'Compact UI Mode' }).click()
  await page.getByRole('switch', { name: 'Enable Animations' }).click()
  await save()
  assert.ok(await page.evaluate(() => document.documentElement.classList.contains('compact')))
  assert.ok(await page.evaluate(() => document.documentElement.classList.contains('no-anim')))
})

await step('theme Dark is stored but the app stays light (no approved dark design) and says so', async () => {
  await page.getByRole('radio', { name: 'Dark' }).click()
  assert.ok(await page.getByText('Only the light theme has an approved design').isVisible())
  await page.getByRole('radio', { name: 'Light' }).click()
})

await step('Hardware Acceleration off → CAD 2D draws large drawings with SVG (GPU layer off)', async () => {
  await page.getByRole('switch', { name: 'Hardware Acceleration (GPU)' }).click()
  await save()
  assert.equal(await page.evaluate(() => window.thcadGpuPref.force), false)
  await page.getByRole('switch', { name: 'Hardware Acceleration (GPU)' }).click()
  await save()
  assert.equal(await page.evaluate(() => window.thcadGpuPref.force), null)
})

await step('Max Undo Steps caps the CAD 2D history', async () => {
  await page.getByRole('spinbutton', { name: 'Max Undo Steps' }).fill('10')
  await save()
  await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/#/cad2d', { waitUntil: 'networkidle' })
  const input = page.getByRole('textbox', { name: 'Type a command or use AI...' })
  for (let i = 0; i < 14; i++) for (const l of ['LINE', `${i * 100},0`, `${i * 100},50`, '']) { await input.fill(l); await input.press('Enter') }
  const n = await page.evaluate(() => { const s = window.__thcad.cad.getState(); return s.history[s.activeId].undo.length })
  assert.equal(n, 10)
  await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/#/settings', { waitUntil: 'networkidle' })
})

await step('keyboard shortcut remap: OSNAP moves from F3 to F4 and works in CAD 2D', async () => {
  await page.getByRole('button', { name: 'Keyboard Shortcuts' }).click()
  await page.getByRole('button', { name: /Toggle OSNAP: F3/ }).click()
  await page.keyboard.press('F4')
  await save()
  assert.equal((await settings()).shortcuts.osnap, 'F4')
  await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/#/cad2d', { waitUntil: 'networkidle' })
  const before = await page.evaluate(() => window.__thcad.cad.getState().toggles.osnap)
  await page.keyboard.press('F4')
  assert.equal(await page.evaluate(() => window.__thcad.cad.getState().toggles.osnap), !before)
  await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/#/settings', { waitUntil: 'networkidle' })
})

await step('folder Change… in a browser opens a path editor; the new path shows in the rail after Save', async () => {
  await page.getByRole('button', { name: 'Change... Project Default Folder' }).click()
  await page.getByRole('dialog').getByRole('textbox').fill('/Volumes/Work/Projects')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await save()
  assert.equal((await settings()).projectsDir, '/Volumes/Work/Projects')
  assert.ok(await page.locator('section[aria-label="Current Configuration"]').getByText('.../Work/Projects').isVisible())
})

await step('Reset to Default restores the factory values (after Save)', async () => {
  await page.getByRole('button', { name: 'Reset to Default' }).click()
  await save()
  const st = await settings()
  assert.equal(st.units, 'mm'); assert.equal(st.precision, 2); assert.equal(st.compactUi, false); assert.equal(st.shortcuts.osnap, 'F3'); assert.equal(st.projectsDir, '')
})

await step('left menu sections: Updates, Privacy, Integrations show honest facts; Help opens a guide', async () => {
  await page.getByRole('button', { name: /^Updates/ }).click()
  assert.ok(await page.getByText(/never checks for updates online/).isVisible())
  await page.getByRole('button', { name: /^Privacy/ }).first().click()
  assert.ok(await page.getByText('Off — not collected').isVisible())
  await page.getByRole('button', { name: /^Integrations/ }).click()
  assert.ok(await page.getByText(/LibreDWG/).isVisible())
  await page.getByRole('button', { name: /Settings Guide/ }).click()
  assert.ok(await page.getByRole('dialog', { name: 'Settings Guide' }).isVisible())
  await page.keyboard.press('Escape')
})

await step('card collapse chevrons hide and show the card body', async () => {
  await page.getByRole('button', { name: /^General/ }).click()
  const card = page.locator('section[aria-label="File Locations"]')
  await card.getByRole('button', { name: 'Collapse' }).click()
  assert.equal(await card.getByText('Project Default Folder').count(), 0)
  await card.getByRole('button', { name: 'Expand' }).click()
  assert.ok(await card.getByText('Project Default Folder').isVisible())
})

await step('no console errors', async () => assert.deepEqual(errors, []))
for (const [r, n] of results) console.log(`${r} ${n}`)
await browser.close()
process.exitCode = results.some(([s]) => s === 'FAIL') ? 1 : 0
