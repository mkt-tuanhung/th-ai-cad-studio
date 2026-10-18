// Interaction smoke test for AI Intelligence Studio. Fresh profile.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
mkdirSync(new URL('../../qa/v2_4/', import.meta.url).pathname, { recursive: true })

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
const cadState = () => page.evaluate(() => { const s = window.__thcad.cad.getState(); return { tabs: s.tabs, active: s.docs[s.activeId]?.name } })

await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/#/ai-studio', { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__thcad)

await step('mockup state: sample session, Option 1 selected, Proposal Details 120 m²', async () => {
  assert.ok(await page.getByRole('heading', { name: 'AI Intelligence Studio' }).isVisible())
  assert.equal(await page.locator('[data-source="demo"]').count() >= 1, true)
  assert.equal(await page.getByRole('button', { name: /^Option 1/ }).getAttribute('aria-pressed'), 'true')
  assert.ok(await page.getByText('120 m²', { exact: true }).isVisible())
  assert.ok(await page.getByText('Option 1 – Office Layout Plan').isVisible())
})

await step('Preview in chat selects Option 2 (no rendered preview → honest empty state)', async () => {
  await page.getByRole('button', { name: 'Preview', exact: true }).nth(1).click()
  assert.equal(await page.getByRole('button', { name: /^Option 2/ }).getAttribute('aria-pressed'), 'true')
  assert.ok(await page.getByText('No rendered preview for this sample option.').isVisible())
  assert.ok(await page.getByText('110 m²', { exact: true }).isVisible())
  await page.getByRole('button', { name: /^Option 1/ }).click()
})

await step('preview viewport zoom buttons change the view', async () => {
  const img = () => page.locator('svg svg image').first().boundingBox()
  const t0 = await img()
  await page.getByRole('button', { name: 'Zoom in' }).click()
  const t1 = await img()
  assert.ok(t1.width > t0.width * 1.2)
  await page.getByRole('button', { name: 'Frame drawing' }).click()
  const t2 = await img()
  assert.ok(Math.abs(t2.width - t0.width) < 1)
})

await step('Side by Side Comparison shows two previews', async () => {
  await page.getByRole('button', { name: 'Side by Side Comparison' }).click()
  assert.equal(await page.getByText(/Option \d – Office Layout Plan/).count(), 2)
  await page.getByRole('button', { name: 'Side by Side Comparison' }).click()
})

await step('Preview Changes → Structured Actions list for Option 1', async () => {
  await page.getByRole('button', { name: 'Preview Changes' }).click()
  assert.ok(await page.getByText('Structured CAD actions for Option 1').isVisible())
  assert.ok(await page.getByText('WALL', { exact: true }).isVisible())
})

await step('Approve & Apply asks for confirmation, opens the proposal in CAD 2D', async () => {
  await page.getByRole('button', { name: 'Approve & Apply' }).click()
  assert.ok(await page.getByRole('dialog').getByText(/not generated on this machine/).isVisible())
  await page.getByRole('dialog').getByRole('button', { name: 'Approve & open in CAD 2D' }).click()
  await page.waitForURL(/#\/cad2d$/)
  assert.equal((await cadState()).active, 'Office Layout - Option 1.dwg')
})

await step('Undo in the studio closes the applied drawing', async () => {
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'AI Assistant' }).click()
  const n = (await cadState()).tabs.length
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  assert.equal((await cadState()).tabs.length, n - 1)
})

await step('Reject Option 3 marks it rejected and disables approve', async () => {
  await page.getByRole('button', { name: /^Option 3/ }).click()
  await page.getByRole('button', { name: 'Reject' }).click()
  assert.ok(await page.getByRole('button', { name: 'Rejected', exact: true }).isDisabled())
  assert.ok(await page.getByRole('button', { name: 'Approve & Apply' }).isDisabled())
  await page.getByRole('button', { name: /^Option 1/ }).click()
})

await step('Geometry Doctor runs local checks on the open drawing (3 findings)', async () => {
  await page.getByRole('button', { name: /Geometry\s*Doctor/ }).click()
  assert.ok(await page.getByText(/Geometry Doctor — local check of/).isVisible())
  assert.equal(await page.getByText(/≠ measured/).count(), 3)
})

await step('sending a message gets an honest "runtime not integrated" reply, no fabricated answer', async () => {
  await page.getByRole('textbox', { name: 'Ask or describe your CAD task...' }).fill('Add a door to office 4')
  await page.getByRole('button', { name: 'Send' }).click()
  assert.ok(await page.getByText('Add a door to office 4').isVisible())
  assert.ok(await page.getByText(/No local AI model is available here/).isVisible())
})

await step('New Chat clears; menu re-opens the sample session; persisted across reload', async () => {
  await page.getByRole('button', { name: 'New Chat' }).click()
  assert.ok(await page.getByText(/Describe a CAD task/).isVisible())
  await page.reload({ waitUntil: 'networkidle' })
  assert.ok(await page.getByText(/Describe a CAD task/).isVisible())
  await page.getByRole('button', { name: 'Chat options' }).click()
  await page.getByRole('menuitem', { name: 'Open sample session' }).click()
  assert.ok(await page.getByText(/Tạo phương án cải tạo/).isVisible())
})

await step('suggestion chip fills the composer', async () => {
  await page.getByRole('button', { name: '"Fix wall intersections"' }).click()
  assert.equal(await page.getByRole('textbox', { name: 'Ask or describe your CAD task...' }).inputValue(), 'Fix wall intersections')
})

await step('VI translates studio chrome', async () => {
  await page.getByRole('tab', { name: /Preview 3 Options/ }).click()
  await page.getByRole('radio', { name: 'VI' }).click()
  assert.ok(await page.getByRole('button', { name: 'Duyệt & Áp dụng' }).isVisible())
  assert.ok(await page.getByText('Chi tiết đề xuất').isVisible())
  await page.getByRole('radio', { name: 'EN' }).click()
})

// ---------------- v2.4: AI task presets, AI job queue with checkpoints (V24-031, V24-032) ----------------
const URL0 = process.env.THCAD_UI ?? 'http://127.0.0.1:5173'
const FX = new URL('../../qa/fixtures/', import.meta.url).pathname
const jobsOf = () => page.evaluate(() => window.__thcad.aiStudio.getState().jobs)
const openMenu = async (item) => {
  await page.goto(URL0 + '/#/ai-studio')
  await page.getByRole('button', { name: 'Chat options' }).click()
  await page.getByRole('menuitem', { name: item }).click()
  await page.getByTestId('ai-presets').waitFor()
  return page.getByTestId('ai-presets')
}
const jobTab = async () => { const p = await openMenu('AI job queue…'); await p.getByTestId('job-list').waitFor(); return p }
/** Clicks picture px (x, y) in a calibration picker. */
const pick = async (scope, px, py) => {
  const el = scope.getByTestId('cal-picker')
  const w = Number(await el.getAttribute('data-w')), h = Number(await el.getAttribute('data-h'))
  await el.evaluate((e, [x, y]) => { const b = e.getBoundingClientRect(); e.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: b.left + x * b.width, clientY: b.top + y * b.height })) }, [px / w, py / h])
}
const cadCmd = async (cmd) => { await page.keyboard.press('Escape'); await page.keyboard.type(cmd); await page.keyboard.press('Enter') }

await step('task presets: 7 presets with stages / needs / uncertainties and an honest status (layout + 3 options “In development”)', async () => {
  const p = await openMenu('AI task presets…')
  const cards = p.locator('[data-testid^="preset-"]')
  assert.equal(await cards.count(), 7)
  for (const t of ['Image/PDF → CAD', 'CAD → 3D', 'Automatic room layout', '3 interior options', 'Offline 4K perspective', 'Elevations / sections', 'Take-off & CNC preparation']) assert.ok(await p.getByRole('heading', { name: new RegExp(t.replace(/[()/.+]/g, '.')) }).count(), t)
  assert.equal(await p.getByTestId('preset-layout').getAttribute('data-status'), 'dev')
  assert.equal(await p.getByTestId('preset-options3').getAttribute('data-status'), 'dev')
  assert.ok(await p.getByTestId('preset-options3').getByRole('button', { name: 'In development' }).isDisabled())
  assert.equal(await p.getByTestId('preset-render4k').getAttribute('data-status'), 'partial')
  assert.match(await p.getByTestId('preset-scan').innerText(), /Stages[\s\S]*Calibrate the scale[\s\S]*Needs[\s\S]*Uncertain[\s\S]*65 %/i)
  await page.waitForTimeout(300)
  await page.screenshot({ path: '../qa/v2_4/ai_presets.png' })
  await page.keyboard.press('Escape')
})

await step('preset Image/PDF → CAD as a job: unscaled open → job “Needs you” (calibration, nothing guessed); calibrated in CAD 2D → ready; Approve archives', async () => {
  const p = await openMenu('AI task presets…')
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), p.getByTestId('preset-scan').getByRole('button', { name: 'Start' }).click()])
  await fc.setFiles(FX + 'scan/plan_dims_SYNTHETIC.png')
  const dlg = page.getByRole('dialog', { name: /plan_dims_SYNTHETIC\.png/ })
  await dlg.getByTestId('cal-section').waitFor()
  await dlg.getByRole('button', { name: 'Open as underlay' }).click()
  await page.waitForURL(/#\/cad2d$/)
  let j = (await jobsOf()).find((x) => x.preset === 'scan')
  assert.equal(j.status, 'needs-user', JSON.stringify(j))
  assert.equal(j.questions[0].code, 'calibration-required')
  assert.ok(j.applied.length === 1 && j.steps.find((s) => s.id === 'open').status === 'done')
  const q = await jobTab()
  const row = q.locator('[data-testid="job"][data-preset="scan"]')
  assert.match(await row.getByTestId('job-question').innerText(), /has no scale calibration/)
  await row.getByRole('button', { name: 'Calibrate…' }).click()
  await page.waitForURL(/#\/cad2d$/)
  const cd = page.getByTestId('calibrate-dialog')
  await cd.waitFor()
  await pick(cd, 100, 930)
  await pick(cd, 1500, 930)
  await cd.getByTestId('cal-true').fill('7000')
  await cd.getByRole('button', { name: 'Add reference' }).click()
  await page.getByRole('button', { name: 'Apply calibration' }).click()
  const q2 = await jobTab()
  const row2 = q2.locator('[data-testid="job"][data-preset="scan"]')
  await row2.and(page.locator('[data-status="ready-for-review"]')).waitFor()
  await row2.getByRole('button', { name: 'Approve' }).click()
  j = (await jobsOf()).find((x) => x.preset === 'scan')
  assert.equal(j.status, 'archived')
  assert.equal(j.outcome, 'approved')
  await page.keyboard.press('Escape')
})

await step('V24-031 room-layout inputs: a measured room whose door has no width → job “Needs you” with the question (no default width); 900 typed → inputs complete', async () => {
  await page.goto(URL0 + '/#/cad2d')
  await cadCmd('NEW')
  await cadCmd('SURVEYROOM')
  const sv = page.getByTestId('survey-dialog')
  await sv.waitFor()
  await sv.getByLabel('Ceiling height (mm)').fill('3300')
  await sv.getByRole('button', { name: 'Add door' }).click()
  await sv.getByLabel('Door 1 From corner (mm)').fill('600')
  await page.getByRole('button', { name: 'Add to drawing' }).click()
  const texts = await page.evaluate(() => { const s = window.__thcad.cad.getState(); return s.docs[s.activeId].entities.filter((e) => e.kind === 'text').map((e) => e.value) })
  assert.ok(texts.some((t) => /D1 \? \(width not measured\)/.test(t)), texts.join(' | '))
  const p = await openMenu('AI task presets…')
  assert.ok(await p.getByTestId('preset-layout').getByRole('button', { name: 'In development' }).isDisabled())
  await p.getByTestId('preset-layout').getByRole('button', { name: 'Check inputs' }).click()
  const row = p.locator('[data-testid="job"][data-preset="layout"]').first()
  assert.equal(await row.getAttribute('data-status'), 'needs-user')
  const qt = await row.getByTestId('job-question').innerText()
  assert.match(qt, /Room 1: door 1 width is missing — type the measured value/)
  await page.waitForTimeout(400)
  await page.screenshot({ path: '../qa/v2_4/ai_job_needs_user.png' })
  await row.getByLabel('Answer').fill('900')
  await row.getByRole('button', { name: 'Answer' }).click()
  await row.and(page.locator('[data-status="ready-for-review"]')).waitFor()
  assert.match(await row.innerText(), /1 measured room\(s\) with every measurement the layout needs\. The layout engine itself is in development/)
  const jambs = await page.evaluate(() => { const s = window.__thcad.cad.getState(); return s.docs[s.activeId].entities.filter((e) => e.layer === 'SURVEY-DOOR' && e.kind === 'line').length })
  assert.equal(jambs, 2, 'door drawn with the measured width')
  await page.keyboard.press('Escape')
})

await step('V24-032 one command (preset CAD → 3D) as a job: compute checkpoints, approval, each model applied once with its idempotency key', async () => {
  await page.goto(URL0 + '/#/cad2d')
  await page.locator('input[type=file][accept=".dxf,.dwg"]').setInputFiles(FX + 'bim/house_vn_SYNTHETIC.dxf')
  await page.waitForFunction(() => { const s = window.__thcad.cad.getState(); return s.docs[s.activeId]?.name === 'house_vn_SYNTHETIC.dxf' })
  const p = await openMenu('AI task presets…')
  await p.getByTestId('preset-cad3d').getByRole('button', { name: 'Start' }).click()
  await page.getByTestId('auto-approve').waitFor({ timeout: 60000 })
  let j = (await jobsOf()).find((x) => x.preset === 'cad3d')
  assert.equal(j.status, 'ready-for-review')
  assert.ok(['read', 'layers', 'house', 'build', 'check'].every((id) => j.steps.find((s) => s.id === id).status === 'done'), JSON.stringify(j.steps))
  assert.equal(j.steps.find((s) => s.id === 'approve').status, 'pending')
  await page.getByTestId('auto-keep-files').uncheck()
  await page.getByTestId('auto-approve').click()
  await page.getByTestId('auto-done').waitFor()
  j = (await jobsOf()).find((x) => x.preset === 'cad3d')
  assert.deepEqual(j.applied.map((k) => k.split(':')[1]).sort(), ['apply-bim', 'apply-interior'])
  assert.equal(j.status, 'ready-for-review')
  await page.getByRole('button', { name: 'Close' }).last().click()
})

await step('V24-032 restart after a crash between “BIM applied” and “Interior applied” → resumes at the checkpoint: BIM skipped (not applied twice), Interior applied once', async () => {
  // the app dies after the BIM step's checkpoint, before the Interior step: as persisted at that moment
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('thcad.aiStudio'))
    const j = raw.state.jobs.find((x) => x.preset === 'cad3d')
    const k = j.steps.find((s) => s.id === 'apply-interior')
    j.applied = j.applied.filter((x) => x !== k.key)
    j.undo = j.undo.filter((u) => u.store !== 'interior')
    for (const s of j.steps) if (s.id === 'apply-interior' || s.id === 'write-files') s.status = 'pending'
    j.steps.find((s) => s.id === 'apply-bim').status = 'done'
    j.status = 'in-progress'
    localStorage.setItem('thcad.aiStudio', JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__thcad?.aiStudio)
  await page.getByText(/1 AI job\(s\) were interrupted/).waitFor()
  let j = (await jobsOf()).find((x) => x.preset === 'cad3d')
  assert.equal(j.status, 'queued')
  assert.ok(j.resumed)
  const bimUndo0 = await page.evaluate(() => window.__thcad.bim.getState().undoStack.length)
  const q = await jobTab()
  const row = q.locator('[data-testid="job"][data-preset="cad3d"]')
  assert.match(await row.innerText(), /Restored after a restart at its last checkpoint/)
  await row.getByRole('button', { name: 'Resume' }).click()
  await page.getByTestId('auto-approve').waitFor({ timeout: 60000 })
  assert.match(await page.getByTestId('auto-resumed').innerText(), /Resumed: 1 step\(s\) already applied will be skipped/)
  await page.getByTestId('auto-keep-files').uncheck()
  await page.getByTestId('auto-approve').click()
  await page.getByTestId('auto-done').waitFor()
  const after = await page.evaluate(() => ({ bim: window.__thcad.bim.getState().undoStack.length, interior: window.__thcad.interior.getState().undoStack.length }))
  j = (await jobsOf()).find((x) => x.preset === 'cad3d')
  assert.equal(after.bim, bimUndo0, `BIM applied again: ${JSON.stringify(after)}`)
  assert.equal(after.interior, 1, `Interior ${after.interior}`)
  assert.match(j.steps.find((s) => s.id === 'apply-bim').note, /already applied — skipped/)
  assert.deepEqual(j.applied.map((k) => k.split(':')[1]).sort(), ['apply-bim', 'apply-interior'])
  results.push(['INFO', `resume: BIM undo steps ${bimUndo0} → ${after.bim} (skipped), Interior 0 → ${after.interior}`])
  await page.getByRole('button', { name: 'Close' }).last().click()
})

await step('V24-032 restart while a step was “applying” → “Needs you: was it applied?”; answered yes → nothing applied again', async () => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('thcad.aiStudio'))
    const j = raw.state.jobs.find((x) => x.preset === 'cad3d')
    j.steps.find((s) => s.id === 'apply-interior').status = 'applying'
    j.status = 'in-progress'
    localStorage.setItem('thcad.aiStudio', JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__thcad?.aiStudio)
  await page.waitForFunction(() => window.__thcad.aiStudio.getState().jobs.some((x) => x.preset === 'cad3d' && x.status === 'needs-user'))
  const q = await jobTab()
  const row = q.locator('[data-testid="job"][data-preset="cad3d"]')
  assert.match(await row.getByTestId('job-question').innerText(), /Step “Apply Interior data” was interrupted while applying/)
  await page.waitForTimeout(400)
  await page.screenshot({ path: '../qa/v2_4/ai_job_interrupted.png' })
  await row.getByRole('button', { name: 'Yes, it was applied' }).click()
  const j = (await jobsOf()).find((x) => x.preset === 'cad3d')
  assert.ok(!j.questions.some((x) => x.answer === undefined))
  assert.ok(j.applied.some((k) => k.includes(':apply-interior:')))
  const st = await page.evaluate(() => window.__thcad.interior.getState().undoStack.length)
  assert.equal(st, 0, 'nothing re-applied')
  await page.keyboard.press('Escape')
})

await step('VI: presets in Vietnamese (Ảnh/PDF -> CAD, Bố trí phòng tự động “Đang phát triển”)', async () => {
  await page.goto(URL0 + '/#/ai-studio')
  await page.getByRole('radio', { name: 'VI' }).click()
  await page.getByRole('button', { name: 'Tùy chọn trò chuyện' }).click()
  await page.getByRole('menuitem', { name: 'Tác vụ AI mẫu…' }).click()
  const p = page.getByTestId('ai-presets')
  assert.ok(await p.getByRole('heading', { name: /Ảnh\/PDF -> CAD/ }).count())
  assert.ok(await p.getByTestId('preset-layout').getByRole('button', { name: 'Đang phát triển' }).isDisabled())
  await page.keyboard.press('Escape')
  await page.getByRole('radio', { name: 'EN' }).click()
})

await step('no console errors', async () => assert.deepEqual(errors, []))
for (const [s, n] of results) console.log(s, n)
await browser.close()
process.exitCode = results.some(([s]) => s === 'FAIL') ? 1 : 0
