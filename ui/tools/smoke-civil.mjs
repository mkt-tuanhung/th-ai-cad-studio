// Interaction smoke test — Civil workspace (mockup 10). Fresh profile, dev server :5173.
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
await page.goto('http://127.0.0.1:5173/#/civil', { waitUntil: 'networkidle' })
const firstRow = () => page.getByRole('table', { name: 'Earthwork Quantities' }).getByRole('row').nth(1).innerText()
const section = () => page.getByRole('img', { name: /^Cross section/ }).first()
const blank = () => page.locator('body').click({ position: { x: 1000, y: 140 } })

await step('opens like the mockup: Plan view, CANAL-01, Earthwork Quantities, STA 0+300 section 12.00 / 8.00 / 2.00 m', async () => {
  assert.equal(await page.getByRole('tab', { name: 'Plan' }).getAttribute('aria-selected'), 'true')
  assert.ok(await page.locator('[aria-current="true"]').filter({ hasText: 'CANAL-01 (Main)' }).isVisible())
  const t = await section().textContent()
  assert.match(t, /12\.00 m/); assert.match(t, /8\.00 m/); assert.match(t, /2\.00/); assert.match(t, /1\.00 m/)
  assert.ok(await page.getByText('DEMO imagery · import a survey: More Tools → Import survey / GIS').isVisible())
})

await step('normal depth is computed with Manning (0.50 m for Q = 6.7 m³/s) — not the mockup’s 3.00 m', async () => {
  assert.match(await section().textContent(), /0\.50 m/)
  assert.ok(await page.getByText('0.50 m', { exact: true }).last().isVisible())
})

await step('slope check finds the two flat stretches in the design profile', async () => {
  assert.ok(await page.getByText('2 segments have slope < 0.0005').isVisible())
  assert.ok(await page.getByText('(Sta 0+120 - 0+160, Sta 0+480 - 0+500)').isVisible())
})

await step('earthwork is average-end-area: first 100 m cut 1,528.98 m³, net = cut − fill', async () => {
  const r = await firstRow()
  assert.match(r, /0\+000/); assert.match(r, /1,528\.98/)
  const cells = await page.getByRole('table', { name: 'Earthwork Quantities' }).getByRole('row').nth(1).getByRole('cell').allInnerTexts()
  const [cut, fill, net] = cells.slice(3, 6).map((x) => Number(x.replace(/,/g, '')))
  assert.ok(Math.abs(cut - fill - net) < 0.02)
})

await step('bottom width 7 m: section and earthwork recompute; freeboard 0 rejected; ⌘Z restores', async () => {
  const before = await firstRow()
  const bw = page.getByRole('textbox', { name: 'Bottom Width' })
  await bw.fill('7'); await bw.press('Enter')
  assert.match(await section().textContent(), /11\.20 m/)
  assert.notEqual(await firstRow(), before)
  const fb = page.getByRole('textbox', { name: 'Freeboard' })
  await fb.fill('0'); await fb.press('Enter')
  assert.equal(await fb.inputValue(), '0.5')
  await blank(); await page.keyboard.press('Meta+z')
  assert.equal(await firstRow(), before)
})

await step('Optimization Suggestion applies the narrower section (rule-based) and is undoable', async () => {
  await page.getByRole('button', { name: /Optimization Suggestion/ }).click()
  assert.equal(await page.getByRole('textbox', { name: 'Bottom Width' }).inputValue(), '7')
  await blank(); await page.keyboard.press('Meta+z')
  assert.equal(await page.getByRole('textbox', { name: 'Bottom Width' }).inputValue(), '8')
})

await step('design discharge drives the hydraulics (normal depth rises with Q)', async () => {
  const q = page.getByRole('textbox', { name: 'Design discharge' })
  await q.scrollIntoViewIfNeeded()
  await q.fill('12'); await q.press('Enter')
  assert.match(await section().textContent(), /0\.7\d m/)
  await blank(); await page.keyboard.press('Meta+z')
})

await step('browser STA 0+500 sets the cross section station', async () => {
  await page.getByRole('button', { name: 'STA 0+500' }).click()
  assert.ok(await page.getByRole('img', { name: 'Cross section 0+500' }).isVisible())
})

await step('Profile tab shows the full longitudinal profile; Schedule shows the quantities table', async () => {
  await page.getByRole('tab', { name: 'Profile' }).click()
  await page.getByRole('img', { name: 'Longitudinal Profile - CANAL-01' }).waitFor() // drawn after the box is measured
  await page.getByRole('tab', { name: 'Schedule' }).click()
  await page.getByRole('table', { name: 'Earthwork Quantities' }).waitFor()
  await page.getByRole('tab', { name: 'Plan' }).click()
  await page.getByRole('img', { name: /^Cross section/ }).first().waitFor()
})

await step('Materials: lining concrete = perimeter × length × 0.12 m (927.93 m³)', async () => {
  await page.getByRole('tab', { name: 'Materials' }).click()
  assert.match(await page.getByRole('table', { name: 'Materials' }).innerText(), /927\.93/)
  await page.getByRole('tab', { name: 'Earthwork Quantities' }).click()
})

await step('Export → Earthwork CSV', async () => {
  await page.getByRole('button', { name: 'Export' }).click()
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Earthwork quantities (CSV)' }).click()])
  const text = await (await dl.createReadStream()).toArray().then((c) => Buffer.concat(c).toString())
  assert.match(text, /^From Station,To Station/)
  assert.match(text, /0\+000,0\+100,100\.000,1528\.98/)
})

await step('VI: views, data names and remarks are translated', async () => {
  await page.getByRole('radio', { name: 'VI', exact: true }).click()
  assert.ok(await page.getByRole('tab', { name: 'Mặt bằng' }).isVisible())
  assert.ok(await page.getByText('Kênh tiêu chính').isVisible())
  assert.ok(await page.getByText('Đào', { exact: true }).first().isVisible())
  await page.getByRole('radio', { name: 'EN', exact: true }).click()
})

for (const [r, n] of results) console.log(`${r}  ${n}`)
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.join('\n'))
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed}/${results.length} passed${errors.length ? `, ${errors.length} console errors` : ''}`)
await browser.close()
process.exitCode = failed || errors.length ? 1 : 0
