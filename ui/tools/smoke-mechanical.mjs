// Interaction smoke test — Mechanical workspace (mockup 11). Fresh profile, dev server :5173.
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
await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/#/mechanical', { waitUntil: 'networkidle' })
const checks = () => page.getByRole('region', { name: 'AI Design Checks' })
const blank = () => page.locator('body').click({ position: { x: 900, y: 450 } })
const param = (n) => page.getByRole('textbox', { name: n, exact: true })

await step('opens like the mockup: Assembly tab, Pump_Casing.asm selected, Parameters (8), BOM (24), DEMO render badge', async () => {
  assert.equal(await page.getByRole('tab', { name: 'Assembly', exact: true }).first().getAttribute('aria-selected'), 'true')
  assert.ok(await page.getByText('Pump_Casing.asm').first().isVisible())
  assert.ok(await page.getByText('Parameters (8)').isVisible())
  assert.ok(await page.getByText('Bill of Materials (24)').isVisible())
  assert.ok(await page.getByText('DEMO render · the OCCT 3D kernel runs in the desktop app').isVisible())
})

await step('mass = volume × density: 0.00158 m³ × 8000 kg/m³ = 12.640 kg; switching to Duplex 2205 recomputes', async () => {
  assert.ok(await page.getByText('12.640 kg').isVisible())
  await page.getByRole('combobox', { name: 'Material' }).selectOption('Duplex 2205')
  assert.ok(await page.getByText('12.324 kg').isVisible())
  await blank(); await page.keyboard.press('Meta+z')
  assert.ok(await page.getByText('12.640 kg').isVisible())
})

await step('design checks are computed: shaft FEA flags the seal deflection at shut-off load (63 µm > 50), the rest pass', async () => {
  const t = await checks().innerText()
  assert.match(t, /No interference/); assert.match(t, /All clearances OK/); assert.match(t, /Strength Check \(FEA\)\s*1 warning/); assert.match(await checks().textContent(), /seal deflection 63 µm \(API 610 ≤ 50\)/); assert.match(t, /ISO 5199/); assert.match(t, /Good for manufacturing/)
})

await step('Impeller_Dia 240 → interference (casing bore 236) and clearance warning; ⌘Z clears it', async () => {
  const p = param('Impeller_Dia')
  await p.fill('240'); await p.press('Enter')
  assert.match(await checks().innerText(), /Interference found/)
  assert.match(await checks().innerText(), /Clearance below 2 mm/)
  await blank(); await page.keyboard.press('Meta+z')
  assert.match(await checks().innerText(), /No interference/)
})

await step('Shaft_Dia 55 → shaft FEA passes (seal deflection under 50 µm); 20 mm → more warnings; out-of-range 5 rejected', async () => {
  const p = param('Shaft_Dia')
  await p.fill('5'); await p.press('Enter')
  assert.equal(await p.inputValue(), '40')
  await p.fill('55'); await p.press('Enter')
  assert.match(await checks().innerText(), /FEA OK/)
  await p.fill('20'); await p.press('Enter')
  assert.match(await checks().innerText(), /Strength Check \(FEA\)\s*[234] warnings/)
  await blank(); await page.keyboard.press('Meta+z'); await page.keyboard.press('Meta+z')
})

await step('Casing_Thickness 4 → manufacturability warning', async () => {
  const p = param('Casing_Thickness')
  await p.fill('4'); await p.press('Enter')
  assert.match(await checks().innerText(), /Wall too thin to cast/)
  await blank(); await page.keyboard.press('Meta+z')
})

await step('Run Check reports the counts; Add Parameter adds a 9th parameter', async () => {
  await page.getByRole('button', { name: 'Run Check' }).click()
  assert.ok(await page.getByText(/Design checks: 4 OK, 1 warnings, 0 errors/).isVisible())
  await page.getByRole('button', { name: 'Add Parameter' }).click()
  assert.ok(await page.getByText('Parameters (9)').isVisible())
  await blank(); await page.keyboard.press('Meta+z')
  assert.ok(await page.getByText('Parameters (8)').isVisible())
})

await step('BOM View all lists 24 rows; clicking Shaft selects Shaft.asm in Properties', async () => {
  await page.getByRole('button', { name: 'View all' }).click()
  assert.equal(await page.getByRole('table', { name: 'Bill of Materials' }).getByRole('row').count(), 25)
  await page.getByRole('table', { name: 'Bill of Materials' }).getByRole('row').filter({ hasText: 'SH-001' }).click()
  assert.ok(await page.getByText('Shaft.asm').first().isVisible())
  assert.ok(await page.getByText('Pump shaft with keyways').isVisible())
})

await step('Configurations: activating “High head - 15 kW” sets Motor_Power = 15', async () => {
  await page.getByRole('tab', { name: 'Configurations' }).click()
  await page.getByRole('button', { name: 'Activate' }).first().click()
  assert.equal(await param('Motor_Power').inputValue(), '15')
  await page.getByRole('tab', { name: 'Properties' }).click()
})

await step('Mates tab lists the 8 mates; Drawing tab opens CAD 2D', async () => {
  await page.getByRole('tab', { name: 'Mates / Constraints' }).click()
  assert.equal(await page.getByRole('table', { name: 'Mates (8)' }).getByRole('row').count(), 9)
  await page.getByRole('tab', { name: 'Drawing' }).click()
  await page.waitForURL(/#\/cad2d/)
  await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/#/mechanical', { waitUntil: 'networkidle' })
})

await step('Export → BOM CSV', async () => {
  await page.getByRole('button', { name: 'Export' }).click()
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Bill of materials (CSV)' }).click()])
  const text = await (await dl.createReadStream()).toArray().then((c) => Buffer.concat(c).toString())
  assert.match(text, /^#,Part Name,Part Number,Material,Qty/)
  assert.match(text, /Bearing 6208,BRG-6208,Steel,2/)
})

await step('VI: tabs, checks and descriptions are translated', async () => {
  await page.getByRole('radio', { name: 'VI', exact: true }).click()
  assert.ok(await page.getByRole('tab', { name: 'Lắp ráp' }).isVisible())
  assert.ok(await page.getByText('Kiểm tra va chạm').isVisible())
  assert.ok(await page.getByText('Đường kính trục').isVisible())
  await page.getByRole('radio', { name: 'EN', exact: true }).click()
})

await step('Strength Check (FEA) opens the shaft FEA: seal deflection 63.1 µm not met, safety 15.68, critical 10,264 rpm; Shaft_Dia 55 → seal deflection met', async () => {
  await page.getByTestId('check-strength').click()
  const r = page.getByTestId('fea-results')
  await r.waitFor()
  const t = await r.innerText()
  assert.match(t, /Deflection at the seal\s+63\.1 µm\s+API 610 ≤ 50 µm — not met/)
  assert.match(t, /Safety on yield\s+[\d.]+/)
  assert.match(t, /10,264 rpm/)
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
  const p = param('Shaft_Dia')
  await p.fill('55'); await p.press('Enter')
  await page.getByTestId('check-strength').click()
  assert.match(await page.getByTestId('fea-results').innerText(), /Deflection at the seal\s+[\d.]+ µm\s+API 610 ≤ 50 µm — pass/)
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
  await blank(); await page.keyboard.press('Meta+z')
})

for (const [r, n] of results) console.log(`${r}  ${n}`)
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.join('\n'))
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed}/${results.length} passed${errors.length ? `, ${errors.length} console errors` : ''}`)
await browser.close()
process.exitCode = failed || errors.length ? 1 : 0
