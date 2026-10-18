// Interaction smoke test — "One command: build everything from a drawing" (command bar ⌘K / Dashboard actions).
// Fresh profile, dev server :5173. SYNTHETIC fixtures: qa/fixtures/bim/house_vn_SYNTHETIC.dxf, qa/fixtures/civil/canal_route_SYNTHETIC.dxf.
// In the browser the package is one ZIP (sheets as SVG); its contents are checked.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'

const FX = new URL('../../qa/fixtures/', import.meta.url).pathname
const SHOTS = new URL('../../qa/fromcad/', import.meta.url).pathname
mkdirSync(SHOTS, { recursive: true })
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1586, height: 992 }, acceptDownloads: true })
ctx.setDefaultTimeout(15000)
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
await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/#/dashboard', { waitUntil: 'networkidle' })
const store = (k) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').state, k)
/** Names in a ZIP (central directory). */
const zipNames = (buf) => {
  const out = []
  for (let i = 0; i + 46 < buf.length; i++) if (buf.readUInt32LE(i) === 0x02014b50) { const n = buf.readUInt16LE(i + 28); out.push(buf.slice(i + 46, i + 46 + n).toString('utf8')); i += 45 + n }
  return out
}
const openFromBar = async () => {
  await page.keyboard.press('Meta+k')
  await page.keyboard.type('one command')
  await page.getByRole('option', { name: /One command: build everything from a drawing/ }).click()
  await page.getByTestId('auto').waitFor()
}

await step('⌘K → "one command" opens the dialog', async () => {
  await openFromBar()
  assert.match(await page.getByTestId('auto').innerText(), /Drop a DWG \/ DXF here/)
})

let houseZip
await step('a house DXF: read, recognised and built by itself — building summary, interior with cabinets, package', async () => {
  await page.getByTestId('auto-file').setInputFiles(FX + 'bim/house_vn_SYNTHETIC.dxf')
  await page.getByTestId('auto-approve').waitFor()
  assert.equal(await page.getByTestId('auto-kind').innerText(), 'Building')
  const h = await page.getByTestId('auto-house').innerText()
  assert.match(h, /3 levels · 18 walls · 9 doors · 13 windows · 10 rooms · 12 columns · 18 furniture/)
  assert.match(h, /Interior \(Tầng 1\): 5 rooms · 9 items · 4 cabinets/)
  // the cut list and CNC cover every level with furniture (Tầng 2 has a wardrobe too)
  assert.match(h, /Cut list and CNC, 2 levels: \d+ cabinets → \d+ parts on \d+ sheets · \d+ CNC previews \(NOT for machine\)/)
  assert.match(h, /Model checks: all passed/)
  // elevations and sections are drawn by the OCCT kernel: the browser says so instead of pretending
  assert.match(h, /Elevations and sections need the desktop app/)
  assert.match(await page.getByTestId('auto-files').innerText(), /files in one ZIP/)
  // replacing the current models is said, with the backup
  assert.match(await page.getByTestId('auto-replace-note').innerText(), /Replaces the current model \(BIM model, Interior data\) — it is backed up first/)
  await page.getByRole('dialog').screenshot({ path: SHOTS + 'auto_house_review.png' })
})

await step('Approve & build everything: BIM + Interior applied, the ZIP holds IFC, plans (DXF + SVG), schedules, cut list, nesting, CNC previews (never .nc), report', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('auto-approve').click()])
  houseZip = readFileSync(await dl.path())
  const names = zipNames(houseZip)
  const has = (re) => assert.ok(names.some((n) => re.test(n)), `missing ${re} in ${names.join(' | ')}`)
  has(/BIM\.ifc$/); has(/Walls\.csv$/); has(/Rooms\.csv$/); has(/Doors and windows\.csv$/); has(/Floor plan Tầng 1\.dxf$/); has(/Floor plan Tầng 2\.dxf$/)
  has(/Floor plan.*\.svg$/); has(/Bill of quantities\.csv$/); has(/Bill of quantities.*\.svg$/); has(/Door and window schedule.*\.svg$/); has(/Interior furniture\.csv$/); has(/Cut list\.csv$/); has(/Nesting\.dxf$/); has(/CNC .*\.NOT_FOR_MACHINE\.txt$/); has(/CNC manifest\.json$/); has(/^Report\.html$/)
  // the one-command package only ever writes engineering previews
  assert.ok(!names.some((n) => /\.nc$/i.test(n)), `production-looking .nc in ${names.filter((n) => /\.nc$/i.test(n)).join(' | ')}`)
  await page.getByTestId('auto-done').waitFor()
  assert.match(await page.getByTestId('auto-applied').innerText(), /Applied \(one Undo step each\): BIM, Interior/)
  const bim = (await store('thcad.bim')).model
  assert.equal(bim.walls.length, 18)
  const int = (await store('thcad.interior')).doc
  assert.equal(int.cabinets.length, 4)
})

await step('the package is real: IFC header, plan DXF with the walls, watermarked CNC preview, report with CNC blockers', async () => {
  const s = houseZip.toString('utf8')
  assert.match(s, /ISO-10303-21;/)
  assert.match(s, /FILE_SCHEMA\(\('IFC4'\)\)/)
  assert.match(s, /A-WALL/)
  assert.match(s, /G0 Z/)
  assert.match(s, /\(ENGINEERING PREVIEW - NOT FOR MACHINE USE\)/)
  assert.match(s, /\(machine=NONE status=NO_MACHINE_PROFILE post=/)
  assert.match(s, /"kind": "ENGINEERING_PREVIEW"/)
  assert.match(s, /one-command report/)
  // the report says the CNC files are previews and lists the release blockers
  assert.match(s, /CNC files are engineering previews/)
  assert.match(s, /CNC production blocked: MACHINE_NOT_SELECTED/)
})

await step('Done: Open BIM 3D goes to the built model', async () => {
  await page.getByRole('button', { name: 'Open BIM 3D' }).click()
  await page.waitForFunction(() => location.hash === '#/bim')
})

await step('a canal DXF from the Dashboard actions: route found, volumes, package with profile + sections', async () => {
  await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/#/dashboard', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'See All' }).click()
  await page.getByRole('button', { name: /One command: build everything from a drawing/ }).click()
  await page.getByTestId('auto-file').setInputFiles(FX + 'civil/canal_route_SYNTHETIC.dxf')
  await page.getByTestId('auto-approve').waitFor()
  assert.equal(await page.getByTestId('auto-kind').innerText(), 'Route')
  assert.match(await page.getByTestId('auto-route').innerText(), /kênh mẫu 1: 4 sections · 150 m · cut 650 m³ · fill 741 m³/)
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('auto-approve').click()])
  const names = zipNames(readFileSync(await dl.path()))
  for (const re of [/Earthwork\.csv$/, /Cross sections\.csv$/, /Long profile\.csv$/, /Long profile\.dxf$/, /Cross sections 1\.dxf$/, /\.svg$/]) assert.ok(names.some((n) => re.test(n)), `missing ${re}`)
  const civil = (await store('thcad.civil')).doc
  assert.equal(civil.sections.length, 4)
})

await step('the replaced model was backed up: "Restore the previous Civil route" brings it back (an undoable edit)', async () => {
  await page.getByTestId('auto-done').waitFor()
  await page.getByTestId('auto-restore').getByRole('button', { name: /Restore the previous Civil route/ }).click()
  await page.getByText(/Civil route: the previous model restored/).waitFor()
  const civil = (await store('thcad.civil')).doc
  assert.notEqual(civil.sections?.length ?? 0, 4)
})

await step('Vietnamese command bar: "1 lệnh" finds the command', async () => {
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('thcad.settings')); s.state.language = 'vi'; localStorage.setItem('thcad.settings', JSON.stringify(s)) })
  await page.reload({ waitUntil: 'networkidle' })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Meta+k')
  await page.keyboard.type('1 lệnh')
  await page.getByRole('option', { name: /1 lệnh: làm hết từ bản vẽ/ }).click()
  await page.getByRole('dialog', { name: '1 lệnh — làm hết từ bản vẽ' }).waitFor()
  await page.getByRole('dialog').getByRole('button', { name: 'Huỷ' }).click()
})

await step('No console errors', async () => assert.deepEqual(errors, []))

for (const [r, n] of results) console.log(r, n)
console.log(results.every(([r]) => r === 'PASS') ? 'ALL PASS' : 'SOME FAILED')
await browser.close()
