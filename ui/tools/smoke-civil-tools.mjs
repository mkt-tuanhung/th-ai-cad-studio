// Civil: Intersection (road crossing → culvert), notes and dimensions on the charts, profile window, chart
// snapshot, 3D tab (browser wireframe + stats). Fresh profile.
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
    localStorage.clear()
    localStorage.setItem('thcad.settings', JSON.stringify({ state: { language: 'en' }, version: 1 }))
    sessionStorage.setItem('seeded', '1')
  }
})
await page.goto('http://127.0.0.1:5173/#/civil', { waitUntil: 'networkidle' })
const tool = (name) => page.getByRole('toolbar').getByRole('button', { name, exact: true }).first().click()
/** Click a profile point (station, elevation) through the chart's own transform. */
const profileAt = async (s, z) => {
  const c = page.getByTestId('profile-chart').first()
  const box = await c.boundingBox()
  const [l, t, w, h, s0, s1, z0, z1] = (await c.getAttribute('data-view')).split(',').map(Number)
  await page.mouse.click(box.x + l + ((s - s0) / (s1 - s0)) * w, box.y + t + ((z1 - z) / (z1 - z0)) * h)
}
const sectionAt = async (x, z) => {
  const c = page.getByTestId('section-chart').first()
  const box = await c.boundingBox()
  const [cx, sx, sy, h, zBot, inv] = (await c.getAttribute('data-view')).split(',').map(Number)
  await page.mouse.click(box.x + cx + x * sx, box.y + h - 14 - (z - inv - zBot) * sy)
}

await step('Intersection: a 14 m road crossing at 0+400 adds box culvert CL-03 (structures, profile)', async () => {
  await tool('Intersection')
  const d = page.getByTestId('crossing-dialog')
  await d.getByRole('spinbutton', { name: 'Station' }).fill('400')
  await d.getByRole('spinbutton', { name: 'Road width = culvert length (m)' }).fill('14')
  await d.getByRole('button', { name: 'Add crossing' }).click()
  assert.ok(await page.getByText(/Crossing Culvert CL-03 at 0\+400: box culvert Box 2 × 2.0 × 1.5 m, invert 5\.97 m/).isVisible())
  assert.match(await page.getByTestId('profile-chart').first().textContent(), /Culvert CL-03/)
})

await step('Annotation on the profile: “Bridge deck” note at 0+200', async () => {
  await tool('Annotation')
  await profileAt(200, 8.2)
  await page.getByRole('textbox', { name: 'Note text' }).fill('Bridge deck')
  await page.getByRole('button', { name: 'Place', exact: true }).click()
  assert.match(await page.getByTestId('profile-chart').first().textContent(), /Bridge deck/)
  await tool('Annotation')
})

await step('Dimension on the profile measures length, Δz and grade between two clicks', async () => {
  await tool('Dimension')
  await profileAt(100, 6.4); await profileAt(300, 6.2)
  const t = await page.getByTestId('profile-chart').first().textContent()
  assert.match(t, /(199\.\d|200\.\d) m · Δz -0\.\d{3} m · -0\.\d{3} %/)
})

await step('Dimension on the cross section measures between two points (top of the left bank → bottom edge)', async () => {
  await sectionAt(-6, 8.0); await sectionAt(-4, 6.0)
  assert.match(await page.getByTestId('section-chart').first().textContent(), /2\.\d\d m · Δz -2\.\d\d m/)
  await tool('Dimension')
})

await step('Profile window: zoom out / pan to the station / orbit resets', async () => {
  const card = page.getByRole('region', { name: 'Longitudinal Profile - CANAL-01' })
  const view = async () => (await page.getByTestId('profile-chart').first().getAttribute('data-view')).split(',').map(Number).slice(4, 6)
  await card.getByRole('button', { name: 'Pan' }).click()
  const v1 = await view()
  assert.deepEqual(v1, [145, 455]) // 310 m around STA 0+300
  await card.getByRole('button', { name: 'Zoom', exact: true }).click()
  assert.deepEqual(await view(), [0, 620])
  await card.getByRole('button', { name: 'Pan' }).click()
  await card.getByRole('button', { name: 'Orbit' }).click()
  assert.deepEqual(await view(), [0, 620])
})

await step('Chart snapshot downloads a PNG', async () => {
  const card = page.getByRole('region', { name: 'Longitudinal Profile - CANAL-01' })
  const [dl] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: 'Snapshot' }).click()])
  assert.equal(dl.suggestedFilename(), 'North Canal - Longitudinal profile.png')
})

await step('3D tab: browser wireframe with corridor stats (63 sections, sample ground) and a labelled note', async () => {
  await page.getByRole('tab', { name: '3D' }).click()
  await page.getByTestId('civil-3d').waitFor()
  assert.match(await page.getByTestId('civil-3d-stats').innerText(), /^63 stations · [\d,]+ triangles · ground: sample profile strip$/)
  assert.ok(await page.getByText(/Wireframe preview/).isVisible())
  await page.getByRole('tab', { name: 'Plan' }).click()
})

for (const [r, n] of results) console.log(`${r}  ${n}`)
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.join('\n'))
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed}/${results.length} passed${errors.length ? `, ${errors.length} console errors` : ''}`)
await browser.close()
process.exitCode = failed || errors.length ? 1 : 0
