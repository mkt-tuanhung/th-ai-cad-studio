// Interior plans (layout / ceiling / finish) from the model, Dimension and Tag tools, and Space Planning (v2.4 M2). Fresh profile.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1586, height: 992 } })
ctx.setDefaultTimeout(8000)
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
await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/#/interior', { waitUntil: 'networkidle' })
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

// ---------------- Space Planning (v2.4 M2) ----------------
const SHOTS = new URL('../../qa/v2_4/spaceplan/', import.meta.url).pathname
mkdirSync(SHOTS, { recursive: true })
const shot = async (name) => { await page.waitForTimeout(600); await page.screenshot({ path: SHOTS + name }) }
const sp = () => page.getByTestId('space-planning')
const st = () => page.evaluate(() => { const s = window.__thcad.interior.getState(); return { doc: s.doc, sel: s.sel, preview: s.preview && s.preview.label, undo: s.undoStack.length } })
const item = async (pred) => (await st()).doc.items.find(pred)
const undoKey = () => page.keyboard.press('Meta+z')
const blank = () => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())

await step('Space Planning tab: view modes 2D Floorplan / 3D Live / Walkthrough / Render / Production and five sub-panels', async () => {
  await page.getByRole('tab', { name: 'Space Planning' }).click()
  await sp().waitFor()
  for (const v of ['2D Floorplan', '3D Live', 'Walkthrough', 'Render', 'Production']) assert.ok(await sp().getByRole('radio', { name: v }).isVisible(), v)
  for (const v of ['Library', 'Checks', 'Layouts', 'Wall elevation', 'Schedule']) assert.ok(await sp().getByRole('tab', { name: v }).isVisible(), v)
  await sp().getByRole('radio', { name: '2D Floorplan' }).click()
  await plan().waitFor()
  assert.equal(await sp().getByRole('radio', { name: '2D Floorplan' }).getAttribute('aria-checked'), 'true')
  await sp().getByRole('radio', { name: '3D Live' }).click()
  assert.equal(await plan().count(), 0, '3D Live returns to the 3D viewport')
  await sp().getByRole('radio', { name: 'Production' }).click()
  await page.getByTestId('nesting-dialog').waitFor()
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).first().click()
  await sp().getByRole('radio', { name: '2D Floorplan' }).click()
})

await step('V24-025 library: search "dining chair" → Dining Chair 480 × 520 × 900; Place puts the real size in the scene (3D bounds = catalog)', async () => {
  await sp().getByRole('combobox', { name: 'Room', exact: true }).selectOption('living')
  await sp().getByPlaceholder(/Search furniture/).fill('dining chair')
  const row = sp().locator('[data-asset="Dining Chair"]')
  assert.match(await row.innerText(), /480 × 520 × 900 mm/)
  await row.getByRole('button', { name: 'Place Dining Chair' }).click()
  const it = await item((i) => i.catalog === 'Dining Chair')
  assert.ok(it && it.w === 480 && it.d === 520 && it.h === 900, JSON.stringify(it))
  assert.ok(await page.locator(`[data-testid=interior-plan] [data-item="${it.id}"]`).count() === 1)
  await shot('01-library-place.png')
})

await step('drag from the library onto the plan: a bookshelf dropped near the living-room wall snaps back to it', async () => {
  await sp().getByPlaceholder(/Search furniture/).fill('bookshelf 800')
  const p = await at(6000, 3300)
  const box = await plan().boundingBox()
  await sp().locator('[data-asset="Bookshelf 800"]').dragTo(plan(), { targetPosition: { x: p.x - box.x, y: p.y - box.y } })
  const it = await item((i) => i.catalog === 'Bookshelf 800')
  assert.ok(it, 'dropped')
  // back on the wall face y = 3730 − 50, front facing into the room (rot 0)
  assert.equal(Math.round(it.at[0].y + it.d / 2), 3680)
  assert.equal(it.at[0].rot, 0)
})

await step('move by drag in the plan (one undo step); a locked item does not move', async () => {
  const it = await item((i) => i.catalog === 'Dining Chair')
  await page.evaluate((id) => window.__thcad.interior.getState().set({ sel: { kind: 'item', id }, inst: 0 }), it.id)
  const a = await at(it.at[0].x, it.at[0].y), b = await at(it.at[0].x + 600, it.at[0].y - 300)
  const undo0 = (await st()).undo
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2); await page.mouse.move(b.x, b.y); await page.mouse.up()
  const moved = await item((i) => i.id === it.id)
  assert.ok(Math.abs(moved.at[0].x - (it.at[0].x + 600)) < 30 && Math.abs(moved.at[0].y - (it.at[0].y - 300)) < 30, JSON.stringify(moved.at))
  assert.equal((await st()).undo, undo0 + 1)
  await page.getByRole('tab', { name: 'Properties' }).click()
  await page.getByRole('button', { name: 'Lock', exact: true }).click()
  const c = await at(moved.at[0].x, moved.at[0].y)
  await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x + 40, c.y + 40); await page.mouse.move(c.x + 80, c.y + 80); await page.mouse.up()
  assert.deepEqual((await item((i) => i.id === it.id)).at, moved.at, 'locked: not moved')
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
})

await step('V24-026 replace in place keeps the transform, takes the new size; V24-027 per-part finish changes appearance only', async () => {
  const it = await item((i) => i.catalog === 'Dining Chair')
  await page.getByRole('combobox', { name: 'Replace with' }).selectOption('Ergonomic Office Chair')
  const r = await item((i) => i.id === it.id)
  assert.deepEqual(r.at, it.at)
  assert.ok(r.w === 680 && r.d === 680 && r.h === 1200 && r.catalog === 'Ergonomic Office Chair')
  await page.getByRole('combobox', { name: /Legs — Material/ }).selectOption('Metal - Black')
  const f = await item((i) => i.id === it.id)
  assert.equal(f.parts.legs.material, 'Metal - Black')
  assert.deepEqual([f.w, f.d, f.h, f.at], [r.w, r.d, r.h, r.at])
  await shot('02-inspector.png')
})

await step('SP29 checks: a chair placed on the dining table is reported with the measured overlap; a fix applies in one undo step', async () => {
  await sp().getByRole('tab', { name: 'Library' }).click()
  await sp().getByRole('combobox', { name: 'Room', exact: true }).selectOption('dining')
  await sp().getByPlaceholder(/Search furniture/).fill('dining chair')
  await sp().getByRole('button', { name: 'Place Dining Chair' }).click()
  await sp().getByRole('tab', { name: 'Checks' }).click()
  assert.match(await sp().innerText(), /Clearance guidance — not a legal/)
  const issue = page.getByTestId('space-issues').locator('[data-issue="collision"]').filter({ hasText: /Dining Chair overlaps Dining Table by \d+ mm/ }).first()
  await issue.waitFor()
  await issue.getByRole('button', { name: 'Fixes' }).click()
  const fix = issue.locator('li').filter({ hasText: /Move Dining Chair \d+ mm/ }).first()
  await fix.waitFor()
  await shot('03-checks-fixes.png')
  const undo0 = (await st()).undo
  await fix.getByRole('button', { name: 'Apply' }).click()
  assert.equal((await st()).undo, undo0 + 1)
  assert.equal(await page.getByTestId('space-issues').locator('[data-issue="collision"]').filter({ hasText: /Dining Chair overlaps Dining Table/ }).count(), 0)
  await blank(); await undoKey()
  assert.ok(await page.getByTestId('space-issues').locator('[data-issue="collision"]').filter({ hasText: /Dining Chair overlaps Dining Table/ }).count() >= 1, 'undo brings the issue back')
  await blank(); await undoKey() // remove the chair again
})

await step('V24-031 layouts need a door: Master Bedroom without a door → "needs input"; a door of unknown width still needs input', async () => {
  await sp().getByRole('combobox', { name: 'Room', exact: true }).selectOption('master')
  await sp().getByRole('tab', { name: 'Layouts' }).click()
  await page.getByTestId('gen-layouts').click()
  assert.match(await page.getByTestId('layouts-needs-input').innerText(), /a door of this room/)
  await shot('04-needs-input.png')
  await page.evaluate(() => window.__thcad.interior.getState().set({ sel: { kind: 'room', id: 'master' }, right: 'properties' }))
  await page.getByRole('button', { name: /Add door/ }).click()
  await page.getByTestId('gen-layouts').click()
  assert.match(await page.getByTestId('layouts-needs-input').innerText(), /the door width/)
  const w = page.getByRole('textbox', { name: 'Width 1' })
  await w.fill('900'); await w.press('Enter')
  assert.equal((await st()).doc.rooms.find((r) => r.id === 'master').doors[0].width, 900)
})

await step('V24-029/030: three scored options; preview shows one in the plan; reject leaves the drawing intact; apply is one undo step', async () => {
  await page.getByTestId('gen-layouts').click()
  const opts = page.getByTestId('layout-options').locator('article')
  assert.equal(await opts.count(), 3)
  assert.match(await opts.first().innerText(), /Usable floor[\s\S]*Storage volume[\s\S]*Door clearance[\s\S]*Approximate cost[\s\S]*n\/a \(no prices\)/)
  const before = JSON.stringify((await st()).doc)
  await opts.nth(1).getByRole('button', { name: 'Preview' }).click()
  assert.match(await plan().getAttribute('data-preview'), /Option B/)
  assert.equal(JSON.stringify((await st()).doc), before, 'preview changes nothing')
  await shot('05-layout-options-preview.png')
  await opts.nth(1).getByRole('button', { name: 'Reject' }).click()
  assert.equal(JSON.stringify((await st()).doc), before, 'V24-030 reject: intact')
  assert.equal(await plan().getAttribute('data-preview'), null)
  const undo0 = (await st()).undo
  await page.getByTestId('layout-options').locator('[data-option="A"]').getByRole('button', { name: 'Preview' }).click()
  await page.getByTestId('layout-options').locator('[data-option="A"]').getByRole('button', { name: 'Apply' }).click()
  const after = (await st()).doc
  assert.equal((await st()).undo, undo0 + 1)
  assert.ok(after.items.some((i) => i.room === 'master' && /Bed/.test(i.name) && i.catalog))
  await shot('06-layout-applied.png')
  await blank(); await undoKey()
  assert.equal(JSON.stringify((await st()).doc), before, 'one undo restores the room')
})

await step('SP33 cabinet wall elevation of the kitchen wall: dimensioned A3 drawing, opens in CAD 2D', async () => {
  await sp().getByRole('combobox', { name: 'Room', exact: true }).selectOption('dining')
  await sp().getByRole('tab', { name: 'Wall elevation' }).click()
  assert.match(await sp().innerText(), /1 cabinet\(s\) on this wall/)
  await page.getByTestId('open-elevation').click()
  await page.getByTestId('elevation-sheet').locator('svg').waitFor()
  assert.match(await page.getByRole('dialog').innerText(), /1:\d+ · A3 · 1 cabinet\(s\), \d+ dimensions/)
  await shot('07-wall-elevation.png')
  await page.getByRole('button', { name: 'Open in CAD 2D' }).click()
  await page.waitForURL(/#\/cad2d/)
  const cad = await page.evaluate(() => { const s = window.__thcad.cad.getState(); const d = s.docs[s.activeId]; return { name: d.name, dims: d.entities.filter((e) => e.kind === 'dimension').length, layers: d.layers.map((l) => l.name) } })
  assert.match(cad.name, /Elevation/)
  assert.ok(cad.dims >= 4 && cad.layers.includes('I-ELEV-CASE'), JSON.stringify(cad))
  await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/#/interior', { waitUntil: 'networkidle' })
})

await step('V24-037 room item schedule: one row per item, counts = scene instances, sizes measured from 3D; CSV export', async () => {
  await page.getByRole('tab', { name: 'Space Planning' }).click()
  await sp().getByRole('combobox', { name: 'Room', exact: true }).selectOption('dining')
  await sp().getByRole('tab', { name: 'Schedule' }).click()
  const d = (await st()).doc
  const rows = sp().getByRole('table').getByRole('row')
  assert.equal(await rows.count(), d.items.filter((i) => i.room === 'dining').length + 1)
  assert.match(await rows.filter({ hasText: 'Dining Chair' }).first().innerText(), /\b6\b[\s\S]*520 × 580 × 820[\s\S]*520 × 580 × 820/)
  const [dl] = await Promise.all([page.waitForEvent('download'), sp().getByRole('button', { name: 'Export CSV' }).click()])
  const text = await (await dl.createReadStream()).toArray().then((c) => Buffer.concat(c).toString())
  assert.match(text, /^Room,Item,Category,Count/)
  await shot('08-schedule.png')
})

await step('V24-028 finish plan draws each floor finish at its real texture tile (600 × 600 tile, 1800 × 180 oak)', async () => {
  await page.evaluate(() => window.__thcad.interior.getState().set({ plan: 'finish' }))
  await plan().waitFor()
  assert.equal(await page.locator('pattern[id="tile-living"]').getAttribute('data-tile-mm'), '600x600')
  assert.equal(await page.locator('pattern[id="tile-master"]').getAttribute('data-tile-mm'), '1800x180')
  await shot('09-finish-tiles.png')
  await page.evaluate(() => window.__thcad.interior.getState().set({ plan: 'floor' }))
})

await step('AI Assistant → Generate points to the rule-based layouts; VI labels', async () => {
  await page.getByRole('tab', { name: 'AI Assistant' }).click()
  await page.getByRole('tab', { name: 'Generate' }).click()
  await page.getByTestId('open-layouts').click()
  assert.equal(await sp().getByRole('tab', { name: 'Layouts' }).getAttribute('aria-selected'), 'true')
  await page.getByRole('radio', { name: 'VI', exact: true }).click()
  assert.ok(await page.getByRole('tab', { name: 'Bố trí không gian' }).isVisible())
  assert.ok(await sp().getByRole('radio', { name: 'Mặt bằng 2D' }).isVisible())
  await shot('10-vi.png')
  await page.getByRole('radio', { name: 'EN', exact: true }).click()
})

for (const [r, n] of results) console.log(`${r}  ${n}`)
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.join('\n'))
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed}/${results.length} passed${errors.length ? `, ${errors.length} console errors` : ''}`)
await browser.close()
process.exitCode = failed || errors.length ? 1 : 0
