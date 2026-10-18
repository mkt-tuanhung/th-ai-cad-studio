// Interaction smoke test — Interior → AI → "Phong cách từ ảnh mẫu" in the browser (no desktop host: the basic analysis,
// labelled as such). Vietnamese UI (the default). Photos: qa/v2_4/fixtures/style (CC0).
//   THCAD_UI=http://127.0.0.1:52XX node tools/smoke-stylephoto.mjs
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const fx = new URL('../../qa/v2_4/fixtures/style/', import.meta.url)
const photo = (n) => ({ name: n, b64: readFileSync(new URL(n, fx)).toString('base64') })
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1586, height: 992 } })
ctx.setDefaultTimeout(8000)
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
    localStorage.setItem('thcad.settings', JSON.stringify({ state: { language: 'vi' }, version: 2 }))
    localStorage.removeItem('thcad.interior')
    sessionStorage.setItem('seeded', '1')
  }
})
await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/#/interior', { waitUntil: 'networkidle' })
const store = () => page.evaluate(() => { const s = window.__thcad.interior.getState(); return { room: s.styleRef?.room, status: s.styleRef?.status, a: s.styleRef?.analysis, dlg: s.styleDlg, undo: s.undoStack.length, doc: s.doc } })
/** Drops files (fixtures) on an element, as a drag from Finder does. */
const drop = (sel, files, at) => page.evaluate(({ sel, files, at }) => {
  const el = document.querySelector(sel)
  const dt = new DataTransfer()
  for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: 'image/jpeg' }))
  const r = el.getBoundingClientRect()
  const pos = at ? { clientX: r.left + at[0] * r.width, clientY: r.top + at[1] * r.height } : { clientX: r.left + 20, clientY: r.top + 20 }
  el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, ...pos }))
  el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, ...pos }))
}, { sel, files, at })

await step('browser preview: the AI panel keeps the mockup suggestion cards (DEMO) until photos are read', async () => {
  const sec = page.locator('[data-testid=ai-suggestions]')
  assert.ok(await sec.getByText('DEMO').isVisible())
  assert.equal(await sec.locator('figure').count(), 2)
  assert.equal(await page.locator('[data-testid=style-card]').count(), 0)
})

await step('dropping 2 reference photos on the panel reads them (basic analysis, labelled) and replaces the DEMO cards', async () => {
  await drop('[data-testid=ai-suggestions]', [photo('D_minimal_1.jpg'), photo('D_minimal_2.jpg')])
  await page.waitForFunction(() => window.__thcad.interior.getState().styleRef?.status === 'done', null, { timeout: 20000 })
  const s = await store()
  assert.equal(s.a.source, 'basic')
  assert.equal(s.a.images, 2)
  assert.ok(s.a.palette.length >= 2 && s.a.palette.every((p) => /^#[0-9a-f]{6}$/.test(p.hex)))
  assert.ok(s.a.confidence <= 0.4)
  const sec = page.locator('[data-testid=ai-suggestions]')
  assert.ok(await sec.locator('[data-testid=style-card]').isVisible())
  assert.equal(await sec.getByText('DEMO', { exact: true }).count(), 0)
  assert.ok(await sec.getByText('+1').isVisible())
  assert.ok(await sec.locator('[title^="phân tích cơ bản (chưa cài mô hình AI đọc ảnh)"]').count() >= 1)
})

await step('Xem & chỉnh: the dialog shows style, palette, a finish per surface with its library texture, furniture, lighting, VI description', async () => {
  await page.locator('[data-testid=style-review]').click()
  const dlg = page.locator('[data-testid=style-dialog]')
  await dlg.waitFor()
  for (const s of ['floor', 'walls', 'ceiling', 'joinery', 'upholstery', 'metal', 'stone']) assert.ok(await dlg.locator(`[data-testid=style-mat-${s}]`).isVisible(), s)
  assert.ok(await dlg.getByText('Bảng màu (đo từ ảnh)').isVisible())
  await dlg.locator('[data-testid=style-mat-floor]').selectOption('herringbone_oak')
  assert.equal((await store()).a.materials.floor, 'herringbone_oak')
  assert.ok(await dlg.getByText('vật liệu thư viện herringbone_parquet').isVisible())
  await dlg.locator('[data-testid=style-style]').selectOption('scandinavian')
  assert.equal((await store()).a.style, 'scandinavian')
})

await step('Phương án: nothing applied before a pick; doors read from the BIM model; layouts A–C + restyle K, each checked', async () => {
  const dlg = page.locator('[data-testid=style-dialog]')
  const before = JSON.stringify((await store()).doc)
  await dlg.locator('[data-testid=style-step-options]').click()
  await dlg.locator('[data-testid=style-make]').click()
  await dlg.locator('[data-testid=style-options]').waitFor()
  assert.equal(JSON.stringify((await store()).doc), before)
  const ids = await dlg.locator('[data-testid=style-options] article').evaluateAll((a) => a.map((x) => x.dataset.option))
  assert.ok(ids.includes('K') && ids.includes('A'), ids.join(','))
  assert.ok(await dlg.getByText(/Cửa lấy từ mô hình BIM/).first().isVisible())
  for (const id of ids) assert.match(await dlg.locator(`[data-testid=style-checks-${id}]`).innerText(), /Đã kiểm/)
  // preview shows the option in the plan without applying it
  await dlg.locator('[data-option=A] footer button').first().click()
  assert.equal(await page.evaluate(() => window.__thcad.interior.getState().preview?.label), 'style:A')
  assert.equal(JSON.stringify((await store()).doc), before)
})

await step('Áp dụng A: finishes + layout + furniture finishes in ONE undo step; other rooms and kept cabinets untouched; ⌘Z restores', async () => {
  const s0 = await store()
  await page.locator('[data-testid=style-apply-A]').click()
  const s1 = await store()
  assert.equal(s1.undo, s0.undo + 1)
  const lr = s1.doc.rooms.find((r) => r.id === 'living')
  assert.equal(lr.floorFinish, 'Parquet - Herringbone Oak')
  assert.ok(lr.doors?.length >= 1)
  const other = (d) => JSON.stringify([d.rooms.filter((r) => r.id !== 'living'), d.items.filter((i) => i.room !== 'living')])
  assert.equal(other(s1.doc), other(s0.doc))
  for (const c of s1.doc.cabinets) { const c0 = s0.doc.cabinets.find((x) => x.id === c.id); if (c0) assert.deepEqual(c, c0) }
  assert.ok(s1.doc.items.some((i) => i.room === 'living' && i.category === 'sofas' && /Fabric|Leather/.test(i.material)))
  assert.equal(s1.dlg, 'render')
  assert.ok(await page.getByText('Render chạy trong app desktop').isVisible())
  await page.evaluate(() => window.__thcad.interior.getState().set({ styleDlg: null }))
  await page.evaluate(() => window.__thcad.interior.getState().undo())
  assert.equal(JSON.stringify((await store()).doc), JSON.stringify(s0.doc))
})

await step('photos dropped on a room of the plan are read for that room', async () => {
  await page.evaluate(() => window.__thcad.interior.getState().set({ plan: 'floor', styleRef: null }))
  await page.locator('[data-testid=interior-plan]').waitFor()
  await page.waitForTimeout(500)
  // the master bedroom is the lower-left room of the sample plan (y grows downwards on screen)
  const at = await page.evaluate(() => {
    const el = document.querySelector('[data-testid=interior-plan]')
    const [cx, cy, k] = el.dataset.view.split(',').map(Number)
    const r = el.getBoundingClientRect()
    // plan point (2250, 5730) = centre of the master bedroom → screen
    return [((2250 - cx) / k + r.width / 2) / r.width, ((cy - 5730) / k + r.height / 2) / r.height]
  })
  await drop('[data-testid=interior-plan]', [photo('C_classic_wood.jpg')], at)
  await page.waitForFunction(() => window.__thcad.interior.getState().styleRef?.status === 'done', null, { timeout: 20000 })
  assert.equal((await store()).room, 'master')
})

await step('no console errors', async () => assert.deepEqual(errors, []))

for (const [r, n] of results) console.log(r, n)
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`${results.length - failed}/${results.length} passed`)
await browser.close()
process.exit(failed ? 1 : 0)
