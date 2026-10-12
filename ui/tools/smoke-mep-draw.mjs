// MEP drawing tools on the floor / ceiling plan: every tool makes a real, undoable model element. Fresh profile.
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
await page.goto('http://127.0.0.1:5173/#/mep', { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__thcad?.mep)
const doc = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__thcad.mep.getState().doc)))
const plan = () => page.getByTestId('mep-plan')
const at = async (x, y) => {
  const box = await plan().boundingBox()
  const [cx, cy, k] = (await plan().getAttribute('data-view')).split(',').map(Number)
  return { x: box.x + (x - cx) / k + box.width / 2, y: box.y + (cy - y) / k + box.height / 2 }
}
const clickAt = async (x, y) => {
  const p = await at(x, y)
  await page.mouse.move(p.x, p.y)
  await page.mouse.click(p.x, p.y)
}
const tool = (name) => page.getByRole('toolbar').getByRole('button', { name, exact: true }).first().click()

await step('Floor Plan - MEP opens the model plan of Level 2 (ducts, pipes, beams drawn)', async () => {
  await page.getByText('Floor Plan - MEP', { exact: true }).click()
  await plan().waitFor()
  assert.match(await plan().innerText(), /Level 2 · Floor Plan - MEP/)
})

await step('Duct tool: two clicks draw SA-xx 400 × 300 along X on Level 2; the duct schedule grows', async () => {
  const before = (await doc()).ducts.length
  await tool('Duct')
  await clickAt(1000, 1500); await clickAt(5000, 1600)
  await page.keyboard.press('Escape')
  const m = await doc()
  assert.equal(m.ducts.length, before + 1)
  const d = m.ducts.at(-1)
  assert.equal(d.axis, 'x'); assert.equal(d.level, 'L2'); assert.equal(d.w, 400)
  assert.ok(Math.abs(d.length - 4000) <= 60, `length ${d.length}`)
})

await step('Pipe tool with Sanitary Drain: DN100 run along Y', async () => {
  await tool('Pipe')
  await page.getByRole('combobox', { name: 'Service' }).selectOption('Sanitary Drain')
  await clickAt(9000, 1000); await clickAt(9000, 4000)
  await page.keyboard.press('Escape')
  const p = (await doc()).pipes.at(-1)
  assert.equal(p.service, 'Sanitary Drain'); assert.equal(p.dn, 100); assert.equal(p.axis, 'y')
})

await step('Cable Tray, Fixture (WC), Terminal (supply diffuser)', async () => {
  await tool('Cable Tray'); await clickAt(1000, 8000); await clickAt(6000, 8000); await page.keyboard.press('Escape')
  await tool('Fixture')
  await page.getByRole('combobox', { name: 'Fixture' }).selectOption('WC')
  await clickAt(12000, 9000)
  await tool('Terminal'); await clickAt(3000, 1500)
  const m = await doc()
  assert.equal(m.trays.length, 1); assert.equal(m.trays[0].w, 300)
  assert.equal(m.fixtures.length, 1); assert.equal(m.fixtures[0].kind, 'WC')
  assert.equal(m.terminals.length, 1); assert.equal(m.terminals[0].kind, 'Supply Diffuser')
})

await step('Fitting: at the duct end it is a Cap; where the drawn pipe meets a second pipe at right angles it is an Elbow', async () => {
  await tool('Fitting'); await clickAt(5000, 1600)
  await tool('Pipe'); await clickAt(9000, 4000); await clickAt(11000, 4000); await page.keyboard.press('Escape')
  await tool('Fitting'); await clickAt(9000, 4000)
  const f = (await doc()).fittings
  assert.equal(f.length, 2)
  assert.equal(f[0].kind, 'Cap')
  assert.equal(f[1].kind, 'Elbow')
})

await step('Annotation, Dimension, Tag, Section', async () => {
  await tool('Annotation'); await clickAt(2000, 10000)
  await page.getByRole('textbox', { name: 'Note' }).fill('Ống gió cấp tầng 2')
  await page.getByRole('button', { name: 'Place', exact: true }).click()
  await tool('Dimension'); await clickAt(1000, 500); await clickAt(5000, 500)
  await tool('Tag'); await clickAt(3000, 1600)
  await tool('Section'); await clickAt(7000, 500); await clickAt(7000, 11000)
  const m = await doc()
  assert.ok(m.annotations.some((a) => a.kind === 'text' && a.text === 'Ống gió cấp tầng 2'))
  assert.ok(m.annotations.some((a) => a.kind === 'dimension'))
  assert.ok(m.annotations.some((a) => a.kind === 'tag'))
  assert.equal(m.sections.length, 1)
  assert.ok(await page.getByText(/Section S-1/).first().isVisible())
})

await step('Colour filter → By velocity shows the legend; Visibility hides beams from the plan', async () => {
  await page.getByRole('button', { name: 'Color Filter' }).click()
  await page.getByRole('menuitemcheckbox', { name: /By velocity/ }).click()
  assert.ok(await page.getByText(/green ≤ 60 % of the limit/).isVisible())
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Visibility' }).click()
  await page.getByRole('menuitemcheckbox', { name: /Beams/ }).click()
  assert.deepEqual(await page.evaluate(() => window.__thcad.mep.getState().hiddenCats), ['beams'])
  await page.getByRole('menuitemcheckbox', { name: /Beams/ }).click()
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.__thcad.mep.getState().set({ colorBy: 'system' }))
})

await step('Select the tray, edit its width to 400, Delete removes it, ⌘Z restores it', async () => {
  await tool('Select')
  // the sample's pipes cross the tray; pick it where nothing else is drawn, else select it from the model
  await clickAt(5800, 8000)
  if ((await page.evaluate(() => window.__thcad.mep.getState().sel))?.kind !== 'tray') await page.evaluate(() => { const s = window.__thcad.mep.getState(); s.set({ sel: { kind: 'tray', id: s.doc.trays[0].id }, right: 'properties' }) })
  const f = page.getByRole('textbox', { name: 'Width' })
  await f.fill('400'); await f.press('Enter')
  assert.equal((await doc()).trays[0].w, 400, 'width')
  await page.mouse.move(5, 500)
  await page.keyboard.press('Delete')
  assert.equal((await doc()).trays.length, 0, 'deleted')
  await page.keyboard.press('Meta+z')
  assert.equal((await doc()).trays.length, 1, 'restored')
})

await page.screenshot({ path: '../qa/mep_draw_plan.png' })
for (const [r, n] of results) console.log(`${r}  ${n}`)
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.join('\n'))
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed}/${results.length} passed${errors.length ? `, ${errors.length} console errors` : ''}`)
await browser.close()
process.exitCode = failed || errors.length ? 1 : 0
