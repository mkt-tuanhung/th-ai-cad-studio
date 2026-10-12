// Scan to CAD (AI Studio): a vector PDF becomes CAD geometry; a raster image opens as an underlay.
// Fixtures: qa/fixtures/scan/canal_plot_vector.pdf (plotted by this app) and its 60-dpi PNG rendering.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const FX = new URL('../../qa/fixtures/scan/', import.meta.url).pathname
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1586, height: 992 } })
ctx.setDefaultTimeout(15000)
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
const results = []
const step = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]) } catch (e) { results.push(['FAIL', name + ' — ' + e.message.split('\n')[0]]) }
}
const cad = () => page.evaluate(() => { const s = window.__thcad.cad.getState(); const d = s.docs[s.activeId]; return { name: d.name, n: d.entities.length, kinds: d.entities.reduce((a, e) => ((a[e.kind] = (a[e.kind] ?? 0) + 1), a), {}), layers: d.layers.map((l) => l.name), underlay: d.underlay && { w: d.underlay.natW, mm: d.underlay.mmPerPx } } })

await page.goto('http://127.0.0.1:5173/#/ai-studio', { waitUntil: 'networkidle' })
await page.getByRole('radio', { name: 'EN' }).click()

await step('vector PDF → CAD geometry at 1:100 (lines, polylines, texts on PDF-* layers)', async () => {
  await page.locator('input[type=file][accept="image/*,.pdf"]').setInputFiles(FX + 'canal_plot_vector.pdf')
  const dlg = page.getByRole('dialog', { name: /Scan to CAD — canal_plot_vector\.pdf/ })
  await dlg.getByText(/Vector geometry found/).waitFor()
  const txt = await dlg.getByTestId('scan-result').textContent()
  assert.match(txt, /— 420 × 297 mm sheet/)
  await dlg.getByRole('button', { name: 'Open in CAD 2D' }).click()
  await page.waitForURL(/#\/cad2d$/)
  const d = await cad()
  assert.equal(d.name, 'canal_plot_vector.dwg')
  assert.ok(d.n > 300, `entities ${d.n}`)
  assert.ok(d.kinds.text > 10 && (d.kinds.polyline ?? 0) + (d.kinds.line ?? 0) > 100, JSON.stringify(d.kinds))
  assert.ok(d.layers.includes('PDF-TEXT'))
  results.push(['INFO', JSON.stringify(d.kinds)])
})

await step('exact size: the plot frame (5 mm inside the A3 edge = 410 mm) comes back as 41 000 mm at 1:100', async () => {
  const w = await page.evaluate(() => { const s = window.__thcad.cad.getState(); const d = s.docs[s.activeId]; const xs = d.entities.flatMap((e) => (e.kind === 'line' ? [e.a.x, e.b.x] : e.kind === 'polyline' ? e.pts.map((p) => p.x) : [])); return Math.max(...xs) - Math.min(...xs) })
  assert.ok(Math.abs(w - 41000) < 0.01, String(w))
})

await step('raster PNG → underlay with an honest note (image processing, not AI); 150 dpi at 1:100', async () => {
  await page.goto('http://127.0.0.1:5173/#/ai-studio')
  await page.locator('input[type=file][accept="image/*,.pdf"]').setInputFiles(FX + 'canal_plot_raster.png')
  const dlg = page.getByRole('dialog', { name: /Scan to CAD — canal_plot_raster\.png/ })
  await dlg.getByText(/not an AI that understands the drawing/).waitFor()
  await dlg.getByRole('button', { name: 'Open as underlay' }).click()
  await page.waitForURL(/#\/cad2d$/)
  const d = await cad()
  assert.equal(d.n, 0)
  assert.ok(d.underlay && Math.abs(d.underlay.mm - (25.4 / 150) * 100) < 1e-6, JSON.stringify(d.underlay))
})

await step('raster plan (synthetic, Vietnamese labels) → vectorised: lines + circle at true size, text read by OCR', async () => {
  await page.goto('http://127.0.0.1:5173/#/ai-studio')
  await page.locator('input[type=file][accept="image/*,.pdf"]').setInputFiles(FX + 'vi_plan_SYNTHETIC.png')
  const dlg = page.getByRole('dialog', { name: /vi_plan_SYNTHETIC\.png/ })
  await dlg.getByLabel('Drawing scale').selectOption('50')
  await dlg.getByLabel('Scan resolution (dpi)').selectOption('200')
  await dlg.getByRole('button', { name: 'Vectorise' }).click()
  await dlg.getByText(/^Traced:/).waitFor({ timeout: 120000 })
  results.push(['INFO', await dlg.getByTestId('scan-vector').textContent()])
  results.push(['INFO', await page.evaluate(() => JSON.stringify(window.__lastVectorize?.allWords))])
  await dlg.getByRole('button', { name: 'Open vectors in CAD 2D' }).click()
  await page.waitForURL(/#\/cad2d$/)
  const r = await page.evaluate(() => {
    const s = window.__thcad.cad.getState(); const d = s.docs[s.activeId]
    const lines = d.entities.filter((e) => e.layer === 'SCAN-LINES' && e.kind !== 'circle')
    const xs = lines.flatMap((e) => (e.kind === 'line' ? [e.a.x, e.b.x] : e.pts.map((p) => p.x)))
    const ys = lines.flatMap((e) => (e.kind === 'line' ? [e.a.y, e.b.y] : e.pts.map((p) => p.y)))
    return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), circles: d.entities.filter((e) => e.kind === 'circle').map((c) => Math.round(c.r)), texts: d.entities.filter((e) => e.kind === 'text').map((t) => t.value).join(' '), underlay: !!d.underlay }
  })
  results.push(['INFO', JSON.stringify(r)])
  const mm = 25.4 / 200 * 50
  assert.ok(Math.abs(r.w - 1400 * mm) < 1400 * mm * 0.01, `width ${r.w} vs ${1400 * mm}`)
  assert.ok(Math.abs(r.h - 800 * mm) < 800 * mm * 0.01, `height ${r.h} vs ${800 * mm}`)
  assert.ok(r.circles.some((x) => Math.abs(x - 120 * mm) < 120 * mm * 0.05), `circles ${r.circles}`)
  for (const wd of ['PHÒNG', 'KHÁCH', 'BẾP', 'MẶT', 'BẰNG', 'TẦNG']) assert.ok(r.texts.includes(wd), `${wd} in "${r.texts}"`)
  assert.ok(r.underlay)
})

await step('real drawing scanned at 200 dpi (the canal sheet) → lines + Vietnamese text', async () => {
  await page.goto('http://127.0.0.1:5173/#/ai-studio')
  await page.locator('input[type=file][accept="image/*,.pdf"]').setInputFiles(FX + 'canal_plot_200dpi.png')
  const dlg = page.getByRole('dialog', { name: /canal_plot_200dpi\.png/ })
  await dlg.getByLabel('Drawing scale').selectOption('1')
  await dlg.getByLabel('Scan resolution (dpi)').selectOption('200')
  await dlg.getByRole('button', { name: 'Vectorise' }).click()
  await dlg.getByText(/^Traced:/).waitFor({ timeout: 180000 })
  results.push(['INFO', await dlg.getByTestId('scan-vector').textContent()])
  await dlg.getByRole('button', { name: 'Open vectors in CAD 2D' }).click()
  await page.waitForURL(/#\/cad2d$/)
  await page.waitForTimeout(800)
  await page.screenshot({ path: '../qa/scan_canal_vectorised.png' })
  const r = await page.evaluate(() => { const s = window.__thcad.cad.getState(); const d = s.docs[s.activeId]; const ls = d.entities.filter((e) => e.layer === 'SCAN-LINES'); const xs = ls.flatMap((e) => (e.kind === 'line' ? [e.a.x, e.b.x] : e.kind === 'polyline' ? e.pts.map((p) => p.x) : [])); return { texts: d.entities.filter((e) => e.kind === 'text').map((t) => t.value).join(' '), frame: Math.max(...xs) - Math.min(...xs) } })
  results.push(['INFO', JSON.stringify(r).slice(0, 600)])
  for (const wd of ['Kênh', 'thống', 'tưới', 'THỦY', 'LỢI', 'Dũng']) assert.ok(r.texts.includes(wd), `${wd} in "${r.texts}"`)
  assert.ok(Math.abs(r.frame - 410) < 3, `frame ${r.frame} mm vs 410`)
})

await step('no console errors', async () => assert.deepEqual(errors, []))
for (const [s, n] of results) console.log(s, n)
await browser.close()
process.exitCode = results.some(([s]) => s === 'FAIL') ? 1 : 0
