// Interaction smoke test — Civil "Route from CAD" (long profile + cross sections → route, areas, volumes, 3D).
// Fresh profile, dev server :5173. SYNTHETIC fixture qa/fixtures/civil/canal_route_SYNTHETIC.dxf (tools/make-route-fixtures.mjs).
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'

const FX = new URL('../../qa/fixtures/civil/', import.meta.url).pathname
const SHOTS = new URL('../../qa/fromcad/', import.meta.url).pathname
mkdirSync(SHOTS, { recursive: true })
const truth = JSON.parse(readFileSync(FX + 'canal_route_SYNTHETIC.truth.json', 'utf8'))
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1586, height: 992 } })
ctx.setDefaultTimeout(10000)
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
await page.goto('http://127.0.0.1:5173/#/civil', { waitUntil: 'networkidle' })
const civil = () => page.evaluate(() => JSON.parse(localStorage.getItem('thcad.civil') ?? '{}').state?.doc)
const summary = () => page.getByTestId('routefromcad-summary').innerText()

await step('Civil → More Tools → Route from CAD: the DXF is read — one route, 4 stakes, 4 sections', async () => {
  await page.getByRole('button', { name: /More Tools/ }).click()
  await page.getByRole('menuitem', { name: 'Route from CAD (long profile + cross sections)…' }).click()
  await page.getByTestId('routefromcad').waitFor()
  await page.getByTestId('routefromcad-file').setInputFiles(FX + 'canal_route_SYNTHETIC.dxf')
  await page.getByTestId('routefromcad-table').waitFor()
  assert.match(await page.getByLabel('Route', { exact: true }).locator('option:checked').innerText(), /kênh mẫu 1, l=150m · 4 \/ 4/)
  assert.equal(await page.getByLabel('Ground and design lines: Mat dat tu nhien').inputValue(), 'ground')
  assert.equal(await page.getByLabel('Ground and design lines: Thietke').inputValue(), 'design')
})

await step('areas computed per section match the exact ones; volumes by average end areas; the bad table value is flagged', async () => {
  const rows = await page.getByTestId('routefromcad-table').locator('tbody tr').allInnerTexts()
  for (const [i, t] of truth.sections.entries()) {
    assert.match(rows[i], new RegExp(`${t.name}\\s+0\\+${String(t.station).padStart(3, '0')}\\s+${t.cut.toFixed(2)}\\s+${t.fill.toFixed(2)}`))
    assert.match(rows[i], /matches/)
  }
  assert.match(rows[3], /\*/)
  assert.match(await summary(), /4 sections · 150 m · cut 650 m³ · fill 741 m³/)
  assert.match(await page.getByTestId('routefromcad').innerText(), /elevation table and the drawn ground line disagree/)
  assert.match(await page.getByTestId('routefromcad').innerText(), /hydraulics \(normal depth, velocity\) are not computed/)
  await page.getByTestId('routefromcad-table').locator('tbody tr').nth(2).click()
  await page.locator('[data-testid=routefromcad-preview] [data-section=C3]').waitFor()
  await page.getByRole('dialog').screenshot({ path: SHOTS + 'route_dialog_en.png' })
})

await step('AI suggestion needs the desktop app (disabled in the browser)', async () => {
  assert.equal(await page.getByTestId('routefromcad-ai').isDisabled(), true)
})

await step('Approve & build: one Civil edit — alignment 0+000–0+150, drawn sections, earthwork from them', async () => {
  await page.getByTestId('routefromcad-approve').click()
  await page.getByText(/Route kênh mẫu 1 built/).waitFor()
  const m = await civil()
  assert.equal(m.alignment.name, 'kênh mẫu 1')
  assert.deepEqual([m.alignment.start, m.alignment.end], [0, 150])
  assert.equal(m.sections.length, 4)
  assert.deepEqual(m.invert, [[0, -1], [50, -1], [100, -1], [150, -1]])
  assert.equal(m.culverts.length, 0)
  await page.getByRole('tab', { name: 'Plan' }).click()
  const tbl = page.getByRole('table', { name: 'Earthwork Quantities' })
  await tbl.waitFor()
  const n = await tbl.getByRole('row').count()
  let cut = 0
  for (let i = 1; i < n; i++) cut += Number((await tbl.getByRole('row').nth(i).getByRole('cell').allInnerTexts())[3].replace(/,/g, ''))
  assert.ok(Math.abs(cut - truth.volume.cut) < 0.1, `earthwork cut ${cut}`)
})

await step('Section view shows the drawn section with computed and designer areas; plan view is the chainage strip (no DEMO)', async () => {
  await page.getByRole('tab', { name: 'Section' }).click()
  const sec = page.getByTestId('section-chart').first()
  await sec.waitFor()
  assert.equal(await sec.getAttribute('data-section'), 'C1')
  assert.match(await sec.innerHTML(), /Computed: cut 4\.79 m² · fill 5\.49 m²/)
  assert.match(await sec.innerHTML(), /Designer: cut 4\.79 m² · fill 5\.49 m²/)
  await page.getByRole('tab', { name: 'Plan' }).click()
  await page.getByTestId('route-strip').waitFor()
  assert.equal(await page.getByText(/^DEMO imagery/).count(), 0)
  await page.screenshot({ path: SHOTS + 'route_civil_plan.png' })
})

await step('Hydraulics: no normal depth / velocity invented (shown as —, with the reason)', async () => {
  await page.getByTestId('civil-noflow').waitFor()
})

await step('Undo restores the previous Civil model', async () => {
  await page.locator('body').click({ position: { x: 5, y: 500 } })
  await page.keyboard.press('Meta+z')
  await page.waitForTimeout(300)
  const m = await civil()
  assert.equal(m.alignment.end, 620)
  assert.ok(!m.sections)
})

await step('Vietnamese UI', async () => {
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('thcad.settings')); s.state.language = 'vi'; localStorage.setItem('thcad.settings', JSON.stringify(s)) })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Thêm công cụ/ }).click()
  await page.getByRole('menuitem', { name: 'Dựng tuyến từ bản vẽ CAD (trắc dọc + trắc ngang)…' }).click()
  await page.getByRole('dialog', { name: 'Dựng tuyến từ bản vẽ CAD' }).waitFor()
  await page.getByTestId('routefromcad-file').setInputFiles(FX + 'canal_route_SYNTHETIC.dxf')
  await page.getByTestId('routefromcad-table').waitFor()
  assert.match(await summary(), /4 mặt cắt · 150 m · đào 650 m³ · đắp 741 m³/)
  await page.getByRole('dialog').screenshot({ path: SHOTS + 'route_dialog_vi.png' })
  await page.getByRole('dialog').getByRole('button', { name: 'Huỷ' }).click()
})

await step('No console errors', async () => assert.deepEqual(errors, []))

for (const [r, n] of results) console.log(r, n)
console.log(results.every(([r]) => r === 'PASS') ? 'ALL PASS' : 'SOME FAILED')
await browser.close()
