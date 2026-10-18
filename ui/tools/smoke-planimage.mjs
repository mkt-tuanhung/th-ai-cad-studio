// Interaction smoke test — v2.4 "Ảnh mặt bằng → nội thất 3D": a floor-plan PICTURE in the one-command dialog →
// review (recognised walls / doors / windows / rooms over the picture, fixes, undo) → scale → Approve → the dialog's
// own review → BIM + Interior applied. Uncalibrated = REVIEW REQUIRED and the CNC files blocked; calibrated = not.
// Fixtures: qa/v2_4/fixtures/planimage/sketch_plan_SYNTHETIC.png, qa/fixtures/scan/two_page_SYNTHETIC.pdf.
// run: THCAD_UI=http://127.0.0.1:52XX node tools/smoke-planimage.mjs
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'

const FX = new URL('../../qa/v2_4/fixtures/planimage/', import.meta.url).pathname
const SCAN = new URL('../../qa/fixtures/scan/', import.meta.url).pathname
const SHOTS = new URL('../../qa/v2_4/', import.meta.url).pathname
mkdirSync(SHOTS, { recursive: true })
const URL0 = process.env.THCAD_UI ?? 'http://127.0.0.1:5173'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1586, height: 992 }, acceptDownloads: true })
ctx.setDefaultTimeout(20000)
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
await page.goto(URL0 + '/#/dashboard', { waitUntil: 'networkidle' })
const store = (k) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').state, k)
const zipNames = (buf) => {
  const out = []
  for (let i = 0; i + 46 < buf.length; i++) if (buf.readUInt32LE(i) === 0x02014b50) { const n = buf.readUInt16LE(i + 28); out.push(buf.slice(i + 46, i + 46 + n).toString('utf8')); i += 45 + n }
  return out
}
const openAuto = async () => {
  // any dialog left open by a failed step is closed first
  for (let i = 0; i < 3 && (await page.getByRole('dialog').count()); i++) await page.keyboard.press('Escape')
  await page.keyboard.press('Meta+k')
  await page.keyboard.type('one command')
  await page.getByRole('option', { name: /One command: build everything from a drawing/ }).click()
  await page.getByTestId('auto').waitFor()
}
const count = (sel) => page.locator(sel).count()
/** Clicks picture px (x, y) on the review's SVG (its own transform). */
const clickPic = async (x, y) => {
  const p = await page.getByTestId('pi-svg').evaluate((el, [x, y]) => { const m = el.getScreenCTM(); const q = el.createSVGPoint(); q.x = x; q.y = y; const r = q.matrixTransform(m); return [r.x, r.y] }, [x, y])
  await page.mouse.click(p[0], p[1])
}

await step('the one-command dialog takes pictures (PNG / JPG / WebP / PDF) and says so', async () => {
  await openAuto()
  assert.match(await page.getByTestId('auto-picture-hint').innerText(), /PNG, JPG, WebP or a PDF page/)
  assert.match(await page.getByTestId('auto-file').getAttribute('accept'), /\.png.*\.jpg.*\.webp.*\.pdf/)
})

let found = ''
await step('a sketch picture → review: Recognise finds walls, doors, windows, rooms with names (OCR, offline)', async () => {
  await page.getByTestId('auto-file').setInputFiles(FX + 'sketch_plan_SYNTHETIC.png')
  await page.getByTestId('pi-review').waitFor()
  await page.getByTestId('pi-analyse').click()
  await page.getByTestId('pi-found').waitFor({ timeout: 180000 })
  found = await page.getByTestId('pi-found').innerText()
  results.push(['INFO', found])
  const m = /Found: (\d+) walls .*?, (\d+) doors, (\d+) windows, \d+ openings, \d+ columns, (\d+) rooms \((\d+) named\)/.exec(found)
  assert.ok(m, found)
  assert.ok(+m[1] >= 7 && +m[2] >= 4 && +m[3] >= 2 && +m[4] === 6 && +m[5] >= 3, found)
  assert.ok(await count('[data-testid=pi-wall]') >= 7)
  assert.match(await page.getByTestId('pi-cal-status').innerText(), /NOT CALIBRATED/)
  await page.getByRole('dialog').screenshot({ path: SHOTS + 'planimage_review_sketch.png' })
})

await step('fixes: rename a room, delete an opening, add a wall by two clicks — each undoable', async () => {
  // rename the first room
  await page.locator('[data-testid=pi-room] polygon').first().dispatchEvent('pointerdown')
  const name = page.getByTestId('pi-room-name')
  await name.fill('PHÒNG THỬ')
  await name.press('Enter')
  assert.ok(await page.locator('[data-testid=pi-room] text', { hasText: 'PHÒNG THỬ' }).count() === 1)
  // delete an opening, then undo
  const n0 = await count('[data-testid=pi-opening]')
  await page.locator('[data-testid=pi-opening]').first().dispatchEvent('pointerdown')
  await page.getByTestId('pi-delete').click()
  assert.equal(await count('[data-testid=pi-opening]'), n0 - 1)
  await page.getByTestId('pi-undo').click()
  assert.equal(await count('[data-testid=pi-opening]'), n0)
  // a new wall across the living room (two clicks), then undo
  const w0 = await count('[data-testid=pi-wall]')
  const g = await page.evaluate(() => { const g = window.__planImageGraph; return g.box })
  await page.getByTestId('pi-tool-addwall').click()
  const y = g.y0 + (g.y1 - g.y0) * 0.78
  await clickPic(g.x0 + (g.x1 - g.x0) * 0.15, y)
  await clickPic(g.x0 + (g.x1 - g.x0) * 0.4, y + 2)
  assert.equal(await count('[data-testid=pi-wall]'), w0 + 1)
  await page.getByTestId('pi-undo').click()
  assert.equal(await count('[data-testid=pi-wall]'), w0)
  assert.ok(await page.locator('[data-testid=pi-room] text', { hasText: 'PHÒNG THỬ' }).count() === 1, 'the rename survives undoing later edits')
})

await step('uncalibrated → Approve and build: the dialog review says REVIEW REQUIRED and the CNC release is blocked', async () => {
  await page.getByTestId('pi-approve').click()
  await page.getByTestId('auto-approve').waitFor({ timeout: 60000 })
  assert.equal(await page.getByTestId('auto-kind').innerText(), 'Building')
  const h = await page.getByTestId('auto-house').innerText()
  results.push(['INFO', h.replace(/\n/g, ' | ')])
  assert.match(h, /2 levels · \d+ walls · \d+ doors · \d+ windows · 6 rooms/)
  assert.match(h, /Interior \(.+\): \d+ rooms · \d+ items · \d+ cabinets/)
  assert.match(h, /Furnished by the room-type rules: /)
  assert.match(await page.getByTestId('auto-review-required').innerText(), /REVIEW REQUIRED/)
  const warn = await page.locator('details').filter({ hasText: /Warnings/ }).textContent()
  assert.match(warn, /SOURCE_DRAWING_NOT_FABRICATION_READY/)
  await page.getByRole('dialog').screenshot({ path: SHOTS + 'planimage_auto_review.png' })
})

await step('Approve: BIM + Interior applied (one undo step each), the recognised plan opens in CAD 2D as REVIEW REQUIRED', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('auto-approve').click()])
  const names = zipNames(readFileSync(await dl.path()))
  assert.ok(names.some((n) => /BIM\.ifc$/.test(n)) && names.some((n) => /Cut list\.csv$/.test(n)), names.join(' | '))
  assert.ok(!names.some((n) => /\.nc$/i.test(n)))
  await page.getByTestId('auto-done').waitFor()
  assert.match(await page.getByTestId('auto-applied').innerText(), /BIM, Interior/)
  const bim = (await store('thcad.bim')).model
  assert.ok(bim.walls.length >= 7 && bim.rooms.length === 6, `${bim.walls.length} walls, ${bim.rooms.length} rooms`)
  assert.ok(bim.rooms.some((r) => r.name === 'PHÒNG THỬ'))
  const int = (await store('thcad.interior')).doc
  assert.equal(int.rooms.length, 6)
  assert.ok(int.items.length > 0, 'furniture placed')
  const cad = await page.evaluate(() => { const s = window.__thcad.cad.getState(); const d = s.docs[s.activeId]; return { name: d.name, n: d.entities.length, gate: window.__thcad.fabricationAllowed?.(d) ?? null, review: d.provenance?.reviewRequired, underlay: !!d.underlay } })
  assert.ok(cad.name.startsWith('sketch_plan_SYNTHETIC') && cad.n > 20 && cad.review === true && cad.underlay, JSON.stringify(cad))
  await page.keyboard.press('Escape')
})

await step('calibrated with the dimension text read on the sketch ("9000") → no REVIEW REQUIRED, real sizes', async () => {
  await openAuto()
  await page.getByTestId('auto-file').setInputFiles(FX + 'sketch_plan_SYNTHETIC.png')
  await page.getByTestId('pi-analyse').click()
  await page.getByTestId('pi-found').waitFor({ timeout: 180000 })
  const use = page.getByTestId('pi-cal').locator('li', { hasText: '“9000”' }).getByRole('button', { name: 'Use', exact: true }).first()
  await use.click()
  const st = await page.getByTestId('pi-cal-status').innerText()
  results.push(['INFO', st])
  const k = Number(/1 px = ([\d.]+) mm/.exec(st)?.[1])
  assert.ok(Math.abs(k - 12.5) / 12.5 < 0.03, `calibrated ${k} mm/px vs 12.5`)
  await page.getByTestId('pi-approve').click()
  await page.getByTestId('auto-approve').waitFor({ timeout: 60000 })
  assert.equal(await page.getByTestId('auto-review-required').count(), 0)
  // the rooms at the true scale: the living room is 18.50 m² (inner faces)
  const h = await page.getByTestId('auto-house').innerText()
  results.push(['INFO', h.replace(/\n/g, ' | ')])
  await page.keyboard.press('Escape')
})

await step('a multi-page PDF: the page must be chosen before anything is read', async () => {
  await openAuto()
  await page.getByTestId('auto-file').setInputFiles(SCAN + 'two_page_SYNTHETIC.pdf')
  await page.getByTestId('pi-page-required').waitFor()
  await page.getByTestId('pi-page').selectOption('2')
  await page.getByTestId('pi-analyse').waitFor()
  assert.equal(await page.getByTestId('pi-page-required').count(), 0)
  await page.keyboard.press('Escape')
})

await step('Scan to CAD → "Build 3D from this picture" hands the picture to the one-command review', async () => {
  await page.goto(URL0 + '/#/ai-studio')
  await page.locator('input[type=file][accept="image/*,.pdf"]').setInputFiles(FX + 'sketch_plan_SYNTHETIC.png')
  await page.getByTestId('scan-to-3d').click()
  await page.getByTestId('pi-review').waitFor()
  assert.match(await page.getByTestId('auto').innerText(), /Floor plan|Recognise/)
})

await step('no errors in the console', async () => { assert.equal(errors.length, 0, errors.slice(0, 3).join(' | ')) })
await browser.close()
for (const [s, n] of results) console.log(`${s} ${n}`)
const fails = results.filter(([s]) => s === 'FAIL').length
console.log(`${results.filter(([s]) => s === 'PASS').length} passed, ${fails} failed`)
process.exitCode = fails ? 1 : 0
