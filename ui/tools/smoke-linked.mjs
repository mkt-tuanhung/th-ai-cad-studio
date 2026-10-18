// v2.4 M1 linked model in the BIM plan (browser): typed wall lengths, grips, snaps, arc walls, Smart Room, the
// Properties edits and rules, L / U stair and roof dialogs. Fresh profile. THCAD_UI=http://127.0.0.1:52XX node tools/smoke-linked.mjs
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
const shots = process.env.THCAD_SHOTS
const bim = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__thcad.bim.getState().model)))
const st = (fn, arg) => page.evaluate(fn, arg)
await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/#/bim', { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__thcad?.bim)
const plan = () => page.getByTestId('bim-plan')
const at = async (x, y) => {
  const box = await plan().boundingBox()
  const v = await page.evaluate(() => {
    const svg = document.querySelector('[data-testid=bim-plan] svg')
    const pts = (id) => svg.querySelector(`[data-id="${id}"]`).getAttribute('points').split(' ').map((p) => p.split(',').map(Number))
    return { w6: pts('W6'), w8: pts('W8') }
  })
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
const editRow = async (label, value) => {
  await page.getByRole('button', { name: `Edit ${label}`, exact: true }).click()
  const inp = page.locator('[class*=value] input, [class*=value] select').first()
  if ((await inp.evaluate((e) => e.tagName)) === 'SELECT') await inp.selectOption(String(value))
  else {
    await inp.fill(String(value))
    await inp.press('Enter')
  }
}

await page.getByRole('tab', { name: 'Plan' }).click()
await plan().waitFor()
// zoom out: room for the test elements east of the villa
{
  const b = await plan().boundingBox()
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.5)
  await page.mouse.wheel(0, 500)
  await page.waitForTimeout(200)
}

await step('Typed length: Wall tool, click the start, type 4200 + Enter → a 4200 mm wall (V24-001 / SP04)', async () => {
  await tool('Wall')
  await clickAt(1000, 2000)
  const p = await at(3000, 2000)
  await page.mouse.move(p.x, p.y) // the direction
  await page.keyboard.type('4200')
  await page.getByTestId('typed-input').press('Enter')
  await page.keyboard.type('@3600<90')
  await page.getByTestId('typed-input').press('Enter')
  await page.keyboard.press('Escape')
  const m = await bim()
  const w = m.walls.find((x) => x.mark === 'W25'), w2 = m.walls.find((x) => x.mark === 'W26')
  assert.ok(w && w.length === 4200 && w.angle === 0 && w.x === 1000 && w.y === 2000, JSON.stringify(w))
  assert.ok(w2 && w2.length === 3600 && w2.angle === 90 && w2.x === 5200, JSON.stringify(w2))
  assert.ok(w.guid && /^[0-9a-f-]{36}$/.test(w.guid) && w.rev === 1 && w.src.kind === 'drawn', 'identity')
})

await step('Snaps: a midpoint of a wall is named and snapped to (SP05)', async () => {
  await tool('Wall')
  const p = await at(3100, 2000)
  await page.mouse.move(p.x, p.y)
  await page.waitForSelector('[data-testid=snap-kind]')
  const kind = await page.getAttribute('[data-testid=snap-kind]', 'data-kind')
  assert.equal(kind, 'mid')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
})

await step('Grip: drag the end of W25 from 5200 to 5700 → 4700 long, W26 (joined) follows, one undo step', async () => {
  await tool('Select')
  await st(() => window.__thcad.bim.getState().set({ selection: { category: 'wall', id: 'W25' } }))
  await page.waitForSelector('[data-grip=b]')
  const n0 = await st(() => window.__thcad.bim.getState().undoStack.length)
  const g = await page.locator('[data-grip=b]').boundingBox()
  const to = await at(5700, 2000)
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 6 })
  await page.mouse.up()
  const m = await bim()
  const w = m.walls.find((x) => x.mark === 'W25'), w2 = m.walls.find((x) => x.mark === 'W26')
  assert.ok(Math.abs(w.length - 4700) <= 25, `W25 ${w.length}`)
  assert.ok(Math.abs(w2.x - 5700) <= 25, `W26 start ${w2.x}`)
  assert.equal(await st(() => window.__thcad.bim.getState().undoStack.length), n0 + 1)
  assert.ok(await page.getByTestId('wall-faces').isVisible())
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  const u = await bim()
  assert.equal(u.walls.find((x) => x.mark === 'W25').length, 4200)
})

await step('Smart Room dialog: L-shape, clear sizes, placed by a click → walls + room with the computed area (V24-002)', async () => {
  await page.getByRole('button', { name: /More/ }).first().click()
  await page.getByText('Smart Room…').click()
  const f = page.getByTestId('smart-room-form')
  await f.getByLabel('Template').selectOption('L')
  await f.getByLabel('Width X (mm)').fill('6000')
  await f.getByLabel('Depth Y (mm)').fill('5000')
  await f.getByLabel('Cut width (mm)').fill('2400')
  await f.getByLabel('Cut depth (mm)').fill('2000')
  await f.getByRole('button', { name: 'Place in plan' }).click()
  assert.equal(await plan().getAttribute('data-tool'), 'smartRoom')
  const p = await at(16000, 0)
  await page.mouse.move(p.x, p.y)
  await page.waitForSelector('[data-testid=smart-preview]')
  if (shots) await page.screenshot({ path: shots + '/linked_smart_room_preview.png' })
  await page.mouse.click(p.x, p.y)
  const m = await bim()
  const r = m.rooms.at(-1)
  // clear 6000 × 5000 less 2400 × 2000
  assert.ok(Math.abs(r.area - (30 - 4.8)) < 1e-3, `area ${r.area}`)
  assert.equal(r.edges.length, 6)
  if (shots) await page.screenshot({ path: shots + '/linked_smart_room_plan.png' })
})

await step('Properties: room shows net / gross / perimeter computed from its walls; a wall 200 → 250 updates it (V24-004)', async () => {
  const m0 = await bim()
  const r = m0.rooms.at(-1)
  await st((id) => window.__thcad.bim.getState().set({ selection: { category: 'room', id }, rightTab: 'properties' }), r.id)
  await page.getByText('Net area (inside faces)').waitFor()
  const wid = r.edges[0].wall
  await st((id) => window.__thcad.bim.getState().set({ selection: { category: 'wall', id } }), wid)
  await editRow('Thickness', 250)
  const m1 = await bim()
  const r1 = m1.rooms.find((x) => x.id === r.id)
  assert.ok(r1.area < r.area - 0.05, `${r.area} → ${r1.area}`)
  assert.ok(m1.walls.find((w) => w.id === wid).typeId !== m0.walls.find((w) => w.id === wid).typeId, 'new type')
})

await step('Properties: length 4200 → 4500 keeps the guid; door near the end refused with the rule message (V24-005 / V24-009)', async () => {
  await st(() => window.__thcad.bim.getState().set({ selection: { category: 'wall', id: 'W25' } }))
  const g0 = (await bim()).walls.find((w) => w.id === 'W25').guid
  await editRow('Length', 4500)
  const w = (await bim()).walls.find((x) => x.id === 'W25')
  assert.ok(w.length === 4500 && w.guid === g0 && w.rev === 2, JSON.stringify([w.length, w.rev]))
  await tool('Door')
  await clickAt(5600, 2000) // at the far end: clamped inside the clearance, so it fits
  const d = (await bim()).doors.at(-1)
  assert.ok(d.hostWall === 'W25' && d.offset + d.width <= 4500 - 50, JSON.stringify(d))
  await tool('Select')
  await st((id) => window.__thcad.bim.getState().set({ selection: { category: 'door', id } }), d.id)
  await editRow('Offset from wall start', 4000)
  await page.getByText(/would reach past the end of its host wall|closer than 50 mm/).first().waitFor()
  assert.equal((await bim()).doors.find((x) => x.id === d.id).offset, d.offset)
  await editRow('Hinge side', 'right')
  assert.equal((await bim()).doors.find((x) => x.id === d.id).hinge, 'right')
})

await step('Level elevation 3000 → 3300 in Properties: walls to Level 2 are 3300 high (V24-010)', async () => {
  await st(() => window.__thcad.bim.getState().set({ selection: { category: 'level', id: 'L2' } }))
  await editRow('Elevation', 3300)
  const m = await bim()
  assert.equal(m.levels.find((l) => l.id === 'L2').elevation, 3300)
  const w = m.walls.find((x) => x.id === 'W6')
  assert.equal(w.topLevel, 'L2')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
})

await step('Arc wall: Arc mode, start / end / a point on the arc → radius kept exactly (V24-003)', async () => {
  await tool('Wall')
  await page.getByLabel('Wall shape').selectOption('arc')
  await clickAt(16000, 8000)
  await page.keyboard.type('R2500')
  await page.getByTestId('typed-input').press('Enter')
  await page.keyboard.type('@3000,0')
  await page.getByTestId('typed-input').press('Enter')
  await page.keyboard.press('Escape')
  const w = (await bim()).walls.at(-1)
  assert.ok(w.arc && w.arc.radius === 2500 && w.length === 3000, JSON.stringify(w.arc))
  await page.getByLabel('Wall shape').selectOption('straight').catch(() => {})
  await page.keyboard.press('Escape')
})

await step('L / U stair dialog: a U stair to Level 2, risers from the storey', async () => {
  await page.getByRole('button', { name: /More/ }).first().click()
  await page.getByText('L / U stair…').click()
  await page.getByLabel('Start x,y (mm)').fill('16000,12000')
  await page.getByRole('button', { name: 'Create stair' }).click()
  const s = (await bim()).stairs.at(-1)
  assert.ok(s.run && s.run.kind === 'U' && s.topLevel === 'L2', JSON.stringify(s))
  if (shots) await page.screenshot({ path: shots + '/linked_u_stair_plan.png' })
})

await step('Roof from perimeter: a hip roof over the level\'s walls, walls unchanged (V24-011)', async () => {
  const before = JSON.stringify((await bim()).walls)
  await page.getByRole('button', { name: /More/ }).first().click()
  await page.getByText('Roof from perimeter…').click()
  await page.getByRole('button', { name: 'Create roof' }).click()
  const m = await bim()
  assert.ok(m.roofs?.length === 1 && m.roofs[0].level === 'L2', JSON.stringify(m.roofs))
  assert.equal(JSON.stringify(m.walls), before)
})

await step('VI: the new strings are translated', async () => {
  await st(() => { const s = JSON.parse(localStorage.getItem('thcad.settings')); s.state.language = 'vi'; localStorage.setItem('thcad.settings', JSON.stringify(s)) })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__thcad?.bim)
  await page.evaluate(() => window.__thcad.bim.getState().set({ view: 'plan', tool: 'wall' }))
  await page.getByText(/khoá góc 15°/).first().waitFor()
})

assert.deepEqual(errors.filter((e) => !/favicon|DevTools/.test(e)), [])
for (const [s, n] of results) console.log(s.padEnd(5), n)
console.log(`\n${results.filter((r) => r[0] === 'PASS').length}/${results.length} passed${errors.length ? ' · console errors: ' + errors.length : ''}`)
await browser.close()
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0)
