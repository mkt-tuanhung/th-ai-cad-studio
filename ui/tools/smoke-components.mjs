// Interaction smoke test — Components Library (mockup 07). Fresh profile, dev server :5173.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'

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
    localStorage.setItem('thcad.settings', JSON.stringify({ state: { language: 'en' }, version: 1 }))
    sessionStorage.setItem('seeded', '1')
  }
})
await page.goto('http://127.0.0.1:5173/#/components', { waitUntil: 'networkidle' })
const lib = () => page.evaluate(() => JSON.parse(localStorage.getItem('thcad.library') ?? '{"state":{}}').state)
const grid = () => page.locator('section[aria-label="Components Library"] article')
const tile = (n) => page.getByRole('tab', { name: new RegExp(`^${n}`) })
const itemsOf = async (n) => Number((await tile(n).innerText()).match(/([\d,]+) items/)[1].replace(/,/g, ''))
const names = () => grid().evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
const panel = () => page.locator('aside[aria-label]').last()

await step('opens like the mockup: 7 group tiles, category tree, Modern Sofa 3-Seater selected with 2D Preview', async () => {
  for (const n of ['All Components', 'Blocks', 'Families', 'Mechanical Parts', 'MEP Objects', 'Materials', 'Interior Modules']) assert.ok(await tile(n).isVisible(), n)
  assert.equal(await tile('All Components').getAttribute('aria-selected'), 'true')
  assert.ok(await page.getByRole('navigation', { name: 'Categories' }).isVisible())
  assert.equal(await page.locator('article[aria-selected="true"]').getAttribute('aria-label'), 'Modern Sofa 3-Seater')
  assert.ok(await panel().getByText('A-FURN-FIXT').first().isVisible())
  assert.equal(await page.getByRole('radio', { name: '2D Preview' }).getAttribute('aria-checked'), 'true')
})

await step('tile counts are real: groups add up to All Components and match the grid', async () => {
  const all = await itemsOf('All Components')
  let sum = 0
  for (const n of ['Blocks', 'Families', 'Mechanical Parts', 'MEP Objects', 'Materials', 'Interior Modules']) sum += await itemsOf(n)
  assert.equal(sum, all)
  assert.equal(await grid().count(), all)
  await tile('Blocks').click()
  assert.equal(await grid().count(), await itemsOf('Blocks'))
  await tile('All Components').click()
})

await step('category tree filters the grid (Families › Doors) and its search narrows the tree', async () => {
  const tree = page.getByRole('navigation', { name: 'Categories' })
  await tree.getByRole('button', { name: /^Doors/ }).click()
  const n = await grid().count()
  assert.ok(n > 0)
  assert.ok((await names()).every((x) => /door|gate|opening/i.test(x)), (await names()).join(','))
  await tree.getByRole('textbox', { name: 'Search categories...' }).fill('light')
  assert.ok(await tree.getByRole('button', { name: /^Lighting/ }).isVisible())
  assert.equal(await tree.getByRole('button', { name: /^Doors/ }).count(), 0)
  await tree.getByRole('textbox', { name: 'Search categories...' }).fill('')
  await tree.getByRole('button', { name: /^All Components/ }).click()
})

await step('search + filter chips + Reset', async () => {
  await page.getByRole('textbox', { name: 'Search components, tags, or keyword...' }).fill('toilet')
  assert.ok((await names()).includes('Toilet WC'))
  assert.ok((await names()).every((x) => /toilet|wc/i.test(x)))
  await page.getByRole('button', { name: 'Reset' }).click()
  await page.getByRole('button', { name: 'Discipline' }).click()
  await page.getByRole('menuitem', { name: 'MEP' }).click()
  assert.equal(await page.locator('[class*="chipWrap"] button').first().innerText(), 'MEP', 'chip shows the value')
  assert.ok((await names()).includes('LED Downlight'))
  assert.ok(!(await names()).includes('Modern Sofa 3-Seater'))
  await page.getByRole('button', { name: 'Reset' }).click()
  assert.equal(await grid().count(), await itemsOf('All Components'))
})

await step('sort by Name is alphabetical, reverse button flips it, list view shows rows', async () => {
  await page.getByRole('combobox', { name: 'Sort by:' }).selectOption('name')
  const a = await names()
  assert.deepEqual(a, [...a].sort((x, y) => x.localeCompare(y, 'en', { numeric: true })))
  await page.getByRole('button', { name: 'Reverse order' }).click()
  const b = await names()
  assert.equal(b[0], a.at(-1))
  await page.getByRole('button', { name: 'Reverse order' }).click()
  await page.getByRole('button', { name: 'List view' }).click()
  assert.ok(await grid().first().isVisible())
  assert.equal(await page.locator('[class*="rows"]').count(), 1)
  await page.getByRole('button', { name: 'Grid view' }).click()
  await page.getByRole('combobox', { name: 'Sort by:' }).selectOption('popular')
})

await step('star toggles a favourite and persists', async () => {
  const card = page.locator('article[aria-label="Wooden Door - Single"]').first()
  await card.getByRole('button', { name: 'Add to favourites' }).click()
  assert.ok((await lib()).favorites.length === 1)
  await card.getByRole('button', { name: 'Remove from favourites' }).click()
  assert.equal((await lib()).favorites.length, 0)
})

await step('selecting a card fills the panel; Details / Version History / References tabs work', async () => {
  await page.locator('article[aria-label="Office Desk"]').first().click()
  assert.ok(await panel().getByRole('cell', { name: 'Office Desk' }).isVisible())
  await panel().getByRole('tab', { name: 'Details' }).click()
  assert.ok(await panel().getByText('Built-in parametric library').isVisible())
  await panel().getByRole('tab', { name: 'Version History' }).click()
  assert.ok(await panel().getByText('Initial release').isVisible())
  await panel().getByRole('tab', { name: 'References' }).click()
  assert.ok(await panel().getByText('Not used in any open drawing yet.').isVisible())
  await panel().getByRole('tab', { name: 'Preview' }).click()
})

await step('Insertion Options are locked until Edit; rotation persists', async () => {
  assert.equal(await panel().getByRole('combobox', { name: 'Rotation' }).isDisabled(), true)
  await panel().getByRole('button', { name: 'Edit' }).click()
  await panel().getByRole('combobox', { name: 'Rotation' }).selectOption('90')
  await panel().getByRole('button', { name: 'Done' }).click()
  assert.equal((await lib()).insert.rotation, 90)
})

await step('Associated Files downloads a real DXF of the component', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), panel().getByRole('button', { name: 'Download Office_Desk.dxf' }).click()])
  assert.equal(dl.suggestedFilename(), 'Office_Desk.dxf')
  const text = await (await dl.createReadStream()).toArray().then((c) => Buffer.concat(c).toString())
  assert.match(text, /SECTION[\s\S]*ENTITIES[\s\S]*EOF/)
})

let blockId = null
await step('Insert → CAD 2D INSERT at a typed point: block on its layer, rotated 90°, logged', async () => {
  await page.locator('article[aria-label="Office Desk"]').first().getByRole('button', { name: 'Insert into drawing: Office Desk' }).click()
  await page.waitForURL(/#\/cad2d/)
  assert.match(await page.getByRole('log').innerText(), /Command: INSERT$/)
  assert.ok(await page.getByText('Specify insertion point:').first().isVisible())
  const before = await page.evaluate(() => { const s = window.__thcad.cad.getState(); return s.docs[s.activeId].entities.length })
  const input = page.getByRole('textbox', { name: 'Type a command or use AI...' })
  await input.fill('20000,20000'); await input.press('Enter')
  const st = await page.evaluate(() => { const s = window.__thcad.cad.getState(); const d = s.docs[s.activeId]; return { n: d.entities.length, ents: d.entities.filter((e) => e.block?.name === 'Office Desk'), layers: d.layers.map((l) => l.name) } })
  assert.ok(st.n > before)
  assert.equal(st.ents.length, st.n - before)
  assert.equal(new Set(st.ents.map((e) => e.block.id)).size, 1)
  blockId = st.ents[0].block.id
  const xs = st.ents.flatMap((e) => (e.kind === 'line' ? [e.a, e.b] : e.pts ?? [])), w = (k) => Math.max(...xs.map((p) => p[k])) - Math.min(...xs.map((p) => p[k]))
  assert.ok(w('y') > w('x'), 'rotated 90°: the 1600 mm desk now runs along Y')
  assert.ok(st.layers.includes(st.ents[0].layer), 'layer exists')
  assert.match(await page.getByRole('log').innerText(), /Inserted “Office Desk” \(\d+ objects\) on layer/)
})

await step('clicking one line of the inserted block selects the whole block; the Blocks tab lists it', async () => {
  await page.getByRole('button', { name: 'Select' }).click()
  await page.evaluate(() => { const s = window.__thcad.cad.getState(); s.setView(s.activeId, { center: { x: 20000, y: 20000 }, mmPerPx: 6 }) })
  await page.waitForTimeout(200)
  const pt = await page.evaluate(() => {
    const s = window.__thcad.cad.getState(); const d = s.docs[s.activeId]; const v = s.views[s.activeId]
    const e = d.entities.find((x) => x.block?.name === 'Office Desk' && (x.kind === 'line' || x.kind === 'polyline'))
    const a = e.kind === 'line' ? e.a : e.pts[0], b = e.kind === 'line' ? e.b : e.pts[1]
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const el = document.querySelector('[data-native-viewport-slot] > div').getBoundingClientRect()
    return { x: (m.x - v.center.x) / v.mmPerPx + el.width / 2, y: el.height / 2 - (m.y - v.center.y) / v.mmPerPx }
  })
  await page.locator('[data-native-viewport-slot] > div').click({ position: pt })
  const sel = await page.evaluate((id) => { const s = window.__thcad.cad.getState(); const d = s.docs[s.activeId]; return { sel: s.selection.length, n: d.entities.filter((e) => e.block?.id === id).length } }, blockId)
  assert.equal(sel.sel, sel.n)
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: 'Blocks' }).click()
  const row = page.getByRole('button', { name: /^Office Desk/ })
  assert.match(await row.innerText(), /1 instances · \d+ objects/)
  await row.click()
  assert.equal(await page.evaluate(() => window.__thcad.cad.getState().selection.length), sel.n)
  await page.getByRole('tab', { name: 'Properties' }).click()
})

await step('back in the library: Recently Used starts with it and References counts the instance', async () => {
  await page.goto('http://127.0.0.1:5173/#/components', { waitUntil: 'networkidle' })
  const first = page.locator('section[aria-label="Recently Used"] article').first()
  assert.equal(await first.getAttribute('aria-label'), 'Office Desk')
  assert.match(await first.innerText(), /Used (just now|\d+ (seconds?|minutes?) ago)/)
  await page.locator('article[aria-label="Office Desk"]').first().click()
  await panel().getByRole('tab', { name: 'References' }).click()
  assert.ok(await panel().getByText('1 instances').isVisible())
  await panel().getByRole('tab', { name: 'Preview' }).click()
})

await step('Upload Component (DXF) adds a real, selectable, insertable item', async () => {
  const dxf = ['0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '1000', '21', '0', '0', 'CIRCLE', '8', '0', '10', '500', '20', '500', '40', '250', '0', 'ENDSEC', '0', 'EOF'].join('\n')
  await page.locator('input[type=file]').setInputFiles({ name: 'Smoke Bracket.dxf', mimeType: 'application/dxf', buffer: Buffer.from(dxf) })
  await page.getByText('“Smoke Bracket” added to the library (2 objects)').waitFor()
  assert.equal((await lib()).uploads.length, 1)
  assert.equal(await page.locator('article[aria-selected="true"]').getAttribute('aria-label'), 'Smoke Bracket')
  assert.ok(await panel().getByText('1000 mm').first().isVisible())
})

await step('Team Shared lists shared items; AI Recommended is an honest "Not connected" state', async () => {
  await page.getByRole('tab', { name: 'Team Shared' }).click()
  assert.ok(await page.locator('section[aria-label="Team Shared"] article').count() > 0)
  await page.getByRole('tab', { name: 'AI Recommended' }).click()
  assert.ok(await page.getByText('Not connected — the local AI does not rank components yet.').isVisible())
  assert.equal(await page.getByRole('button', { name: 'View all' }).isDisabled(), true)
  await page.getByRole('tab', { name: 'Recently Used' }).click()
  await page.getByRole('button', { name: 'View all' }).click()
  assert.equal(await grid().count(), (await lib()).recent.length)
  await page.getByRole('button', { name: 'Reset' }).click()
})

await step('materials are not insertable (button disabled with reason)', async () => {
  await tile('Materials').click()
  const btn = grid().first().getByRole('button', { name: /^Insert into drawing/ })
  assert.equal(await btn.isDisabled(), true)
  await tile('All Components').click()
})

await step('export catalogue (… menu) downloads JSON of every component', async () => {
  await page.getByRole('button', { name: 'More', exact: true }).first().click()
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Export catalogue (JSON)' }).click()])
  const json = JSON.parse(await (await dl.createReadStream()).toArray().then((c) => Buffer.concat(c).toString()))
  assert.equal(json.length, await itemsOf('All Components'))
})

await step('VI: labels, tags and kinds are translated', async () => {
  await page.getByRole('radio', { name: 'VI', exact: true }).click()
  assert.ok(await page.getByRole('heading', { name: 'Thư viện cấu kiện' }).isVisible())
  assert.ok(await tile('Tất cả cấu kiện').isVisible())
  const card = page.locator('article[aria-label="Modern Sofa 3-Seater"]').first()
  assert.match(await card.innerText(), /Nội thất/)
  assert.match(await card.innerText(), /Đồ nội thất/)
  await page.getByRole('radio', { name: 'EN', exact: true }).click()
})

for (const [r, n] of results) console.log(`${r}  ${n}`)
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.join('\n'))
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed}/${results.length} passed${errors.length ? `, ${errors.length} console errors` : ''}`)
await browser.close()
process.exitCode = failed || errors.length ? 1 : 0
