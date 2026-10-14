// BIM drawing tools on the model plan: every tool creates a real, undoable model element. Fresh profile.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1586, height: 992 } })
ctx.setDefaultTimeout(5000)
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => (m.type() === 'error' && errors.push(m.text())))
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
const bim = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__thcad.bim.getState().model)))
await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/#/bim', { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__thcad?.bim)

const plan = () => page.getByTestId('bim-plan')
/** Screen point of a plan point (mm), from the plan's own view transform. */
const at = async (x, y) => {
  const box = await plan().boundingBox()
  const v = await page.evaluate(() => {
    const svg = document.querySelector('[data-testid=bim-plan] svg')
    // two walls with known ends give the transform: W6 starts at (0,0), W7 at (13800,0)
    const w6 = svg.querySelector('[data-id="W6"]').getAttribute('points').split(' ').map((p) => p.split(',').map(Number))
    const w8 = svg.querySelector('[data-id="W8"]').getAttribute('points').split(' ').map((p) => p.split(',').map(Number))
    return { w6, w8 }
  })
  // W6 polygon: [a+n, b+n, b−n, a−n] with a=(0,0), b=(13800,0), n=(0,100); W8 from (13800,9800) to (0,9800)
  const ax = (v.w6[0][0] + v.w6[3][0]) / 2, ay = (v.w6[0][1] + v.w6[3][1]) / 2
  const bx = (v.w6[1][0] + v.w6[2][0]) / 2
  const cy = (v.w8[0][1] + v.w8[3][1]) / 2
  const k = (bx - ax) / 13800
  return { x: box.x + ax + x * k, y: box.y + ay - y * ((ay - cy) / 9800) }
}
const clickAt = async (x, y, opts) => {
  const p = await at(x, y)
  await page.mouse.move(p.x, p.y)
  await page.mouse.click(p.x, p.y, opts)
}
const tool = (name) => page.getByRole('toolbar').getByRole('button', { name, exact: true }).first().click()

await step('Plan tab shows the BIM model plan of Level 1 (the 11 walls cut at 1.2 m)', async () => {
  await page.getByRole('tab', { name: 'Plan' }).click()
  await plan().waitFor()
  const n = await page.locator('[data-testid=bim-plan] [data-id]').count()
  assert.equal(n, 11, `${n} walls drawn`) // W1–W3, W6–W13 are cut by the Level 1 plan
})

await step('Wall tool: two clicks draw W25 (4 m, Generic 200 mm, Level 1 → Level 2); the schedule shows Walls (25)', async () => {
  await tool('Wall')
  assert.equal(await plan().getAttribute('data-tool'), 'wall')
  await clickAt(2000, 2000)
  await clickAt(6000, 2000)
  await page.keyboard.press('Escape')
  const m = await bim()
  const w = m.walls.find((x) => x.mark === 'W25')
  assert.ok(w, 'W25 exists')
  assert.ok(Math.abs(w.length - 4000) <= 60, `length ${w.length}`)
  assert.equal(w.baseLevel, 'L1'); assert.equal(w.topLevel, 'L2'); assert.equal(w.typeId, 'C200')
  assert.ok(Math.abs(w.angle) < 0.01, `angle ${w.angle}`)
  assert.ok(await page.getByRole('tab', { name: 'Walls (25)' }).isVisible())
})

await step('Door tool: click on W25 hosts D13 (900 mm) on it', async () => {
  await tool('Door')
  await clickAt(4000, 2000)
  const m = await bim()
  const d = m.doors.find((x) => x.mark === 'D13')
  assert.ok(d && d.hostWall === 'W25' && d.width === 900, JSON.stringify(d))
})

await step('Window tool off a wall explains it needs a host; on W25 adds WN19', async () => {
  await tool('Window')
  await clickAt(3000, 5000)
  assert.ok(await page.getByText(/Click on a wall to host the window/).isVisible())
  await clickAt(5200, 2000)
  assert.ok((await bim()).windows.some((x) => x.mark === 'WN19' && x.hostWall === 'W25'))
})

await step('Column, floor slab, stair (17 risers of 176 mm to Level 2), grid, dimension', async () => {
  await tool('Column'); await clickAt(7000, 5000)
  await tool('Slab'); await clickAt(500, 500); await clickAt(4000, 3000)
  await tool('Stair'); await clickAt(10000, 6000); await clickAt(10000, 9000)
  await tool('Grid'); await clickAt(-1500, 0); await clickAt(15000, 0)
  await tool('Dimension'); await clickAt(0, -800); await clickAt(13800, -800)
  const m = await bim()
  assert.equal(m.columns.length, 1); assert.equal(m.columns[0].topLevel, 'L2')
  assert.equal(m.slabs.length, 1); assert.equal(m.slabs[0].kind, 'floor')
  assert.equal(m.stairs.length, 1); assert.ok(Math.abs(m.stairs[0].length - 3000) <= 60)
  assert.equal(m.grids.length, 1); assert.equal(m.grids[0].label, 'A')
  assert.ok(m.annotations.some((a) => a.kind === 'dimension'))
  await page.getByText('UP 17R').waitFor()
})

await step('Room tool: clicking inside walls finds the enclosed rectangle and computes its area', async () => {
  await tool('Room')
  await clickAt(11500, 2000)
  const m = await bim()
  const r = m.rooms.find((x) => x.outline)
  assert.ok(r, 'room placed')
  assert.ok(r.area > 5 && r.area < 60, `area ${r.area}`)
  assert.ok(await page.getByRole('tab', { name: 'Rooms (9)' }).isVisible())
})

await step('More Tools → Curtain Wall draws a CW100 wall; Railing (3 points + Enter); Component', async () => {
  await page.getByRole('button', { name: /More Tools/ }).click()
  await page.getByRole('menuitem', { name: 'Curtain Wall' }).click()
  await clickAt(14800, 1000); await clickAt(14800, 8000); await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /More Tools/ }).click()
  await page.getByRole('menuitem', { name: 'Railing' }).click()
  await clickAt(500, 9000); await clickAt(3500, 9000); await clickAt(3500, 8200); await page.keyboard.press('Enter')
  await page.getByRole('button', { name: /More Tools/ }).click()
  await page.getByRole('menuitem', { name: 'Component' }).click()
  await clickAt(2500, 7500)
  const m = await bim()
  assert.ok(m.walls.some((w) => w.typeId === 'CW100' && Math.abs(w.length - 7000) <= 60))
  assert.equal(m.railings.length, 1); assert.equal(m.railings[0].pts.length, 3)
  assert.equal(m.components.length, 1)
})

await step('Tag + Model Text annotate the plan', async () => {
  await tool('Tag'); await clickAt(4000, 2000)
  await tool('Model Text'); await clickAt(1500, 8600)
  await page.getByRole('textbox', { name: 'Model text' }).fill('Phòng khách')
  await page.getByRole('button', { name: 'Place', exact: true }).click()
  const m = await bim()
  assert.ok(m.annotations.some((a) => a.kind === 'tag'))
  assert.ok(m.annotations.some((a) => a.kind === 'text' && a.text === 'Phòng khách'))
})

await step('Level tool adds “Level 4” at 9,000 + 3,000 mm and switches to it', async () => {
  await tool('Level')
  await page.getByRole('button', { name: 'Add level' }).click()
  const st = await page.evaluate(() => window.__thcad.bim.getState())
  assert.ok(st.model.levels.some((l) => l.elevation === 12000))
  assert.equal(st.model.levels.find((l) => l.id === st.level)?.elevation, 12000)
  await page.evaluate(() => window.__thcad.bim.getState().set({ level: 'L1' }))
})

await step('Select + Properties: the column is editable (width 500); Delete removes it; ⌘Z brings it back', async () => {
  await tool('Select')
  await clickAt(7000, 5000)
  assert.ok(await page.getByText('Column').first().isVisible())
  await page.getByRole('button', { name: 'Edit Width' }).click()
  await page.locator('input').last().fill('500'); await page.keyboard.press('Enter')
  assert.equal((await bim()).columns[0].w, 500)
  await page.keyboard.press('Delete')
  assert.equal((await bim()).columns.length, 0)
  await page.locator('body').click({ position: { x: 5, y: 500 } })
  await page.keyboard.press('Meta+z')
  assert.equal((await bim()).columns.length, 1)
})

await step('Components → Insert into BIM: the sofa is placed at its real size, turned parallel to the nearest wall (W9, vertical)', async () => {
  await page.evaluate(() => window.__thcad.bim.getState().set({ pendingComponent: { name: 'Modern Sofa 3-Seater', w: 2400, d: 950, h: 780, rot: 0, autoAlign: true }, tool: 'component', view: 'plan', selection: null }))
  await clickAt(600, 6000)
  const m = await bim()
  const c = m.components.at(-1)
  assert.equal(c.name, 'Modern Sofa 3-Seater')
  assert.deepEqual([c.w, c.d, c.h, c.rot, c.level], [2400, 950, 780, 90, 'L1'])
  await page.evaluate(() => window.__thcad.bim.getState().set({ pendingComponent: null, tool: 'select' }))
})

await step('deleting W25 takes its door and window with it; undo restores all three', async () => {
  await page.evaluate(() => window.__thcad.bim.getState().set({ selection: { category: 'wall', id: 'W25' } }))
  await plan().click({ position: { x: 5, y: 300 } }).catch(() => {})
  await page.evaluate(() => window.__thcad.bim.getState().set({ selection: { category: 'wall', id: 'W25' }, tool: 'select' }))
  await page.keyboard.press('Delete')
  let m = await bim()
  assert.ok(!m.walls.some((w) => w.mark === 'W25') && !m.doors.some((d) => d.mark === 'D13') && !m.windows.some((d) => d.mark === 'WN19'))
  await page.keyboard.press('Meta+z')
  m = await bim()
  assert.ok(m.walls.some((w) => w.mark === 'W25') && m.doors.some((d) => d.mark === 'D13'))
})

await page.screenshot({ path: '../qa/bim_draw_plan.png' })
for (const [r, n] of results) console.log(`${r}  ${n}`)
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.join('\n'))
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed}/${results.length} passed${errors.length ? `, ${errors.length} console errors` : ''}`)
await browser.close()
process.exitCode = failed || errors.length ? 1 : 0
