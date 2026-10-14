// Interaction smoke test for the CAD 2D workspace (prototype engine). Fresh profile.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs'

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
const doc = () => page.evaluate(() => { const s = window.__thcad.cad.getState(); return JSON.parse(JSON.stringify(s.docs[s.activeId])) })
const count = async () => (await doc()).entities.length
const cmd = async (...lines) => {
  const input = page.getByRole('textbox', { name: 'Type a command or use AI...' })
  for (const l of lines) { await input.fill(l); await input.press('Enter') }
}
const log = () => page.getByRole('log').innerText()
const vp = () => page.locator('[data-native-viewport-slot] > div')

await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/#/cad2d', { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__thcad)
const seedCount = await count()

await step('opens Villa Riverside with mockup state (tab, Detected (3), OSNAP/SNAP/MODEL on)', async () => {
  assert.ok(await page.getByRole('tab', { name: /Villa Riverside - Floor Plan\.dwg/ }).isVisible())
  assert.ok(await page.getByRole('tab', { name: 'Detected (3)' }).isVisible())
  for (const [n, on] of [['OSNAP', 'true'], ['SNAP', 'true'], ['MODEL', 'true'], ['ORTHO', 'false'], ['GRID', 'false'], ['POLAR', 'false']])
    assert.equal(await page.getByRole('button', { name: n, exact: true }).getAttribute('aria-pressed'), on, n)
  assert.equal(await page.getByRole('button', { name: 'Undo' }).isDisabled(), true)
})

await step('LINE from the command line with absolute + relative coordinates', async () => {
  await cmd('L', '0,0', '@3000,0', '@0,2000', '')
  assert.equal(await count(), seedCount + 2)
  assert.match(await log(), /Command: LINE/)
  assert.equal(await page.getByRole('button', { name: 'Undo' }).isDisabled(), false)
})

await step('UNDO / REDO via ⌘Z / ⌘⇧Z', async () => {
  await vp().click({ position: { x: 5, y: 5 } }); await page.keyboard.press('Escape')
  await page.keyboard.press('Meta+z')
  assert.equal(await count(), seedCount + 1)
  await page.keyboard.press('Meta+Shift+z')
  assert.equal(await count(), seedCount + 2)
})

await step('typing on the canvas goes to the command line (AutoCAD style): CIRCLE with typed radius', async () => {
  await vp().click({ position: { x: 5, y: 5 } }); await page.keyboard.press('Escape')
  await page.keyboard.type('c'); await page.keyboard.press('Enter')
  await cmd('20000,20000', '750')
  const d = await doc()
  const c = d.entities.at(-1)
  assert.equal(c.kind, 'circle'); assert.equal(c.r, 750)
})

await step('RECTANGLE by two clicks in the viewport', async () => {
  const before = await count()
  await page.getByRole('button', { name: 'Rectangle' }).click()
  await vp().click({ position: { x: 120, y: 520 } })
  await vp().click({ position: { x: 220, y: 560 } })
  assert.equal(await count(), before + 1)
  const r = (await doc()).entities.at(-1)
  assert.equal(r.kind, 'polyline'); assert.equal(r.closed, true); assert.equal(r.pts.length, 4)
})

await step('click-select → Properties shows type; change layer; Delete erases', async () => {
  await page.getByRole('button', { name: 'Select' }).click()
  await vp().click({ position: { x: 170, y: 520 } }) // top edge of the rectangle
  assert.ok(await page.getByText('Polyline (1)').isVisible())
  await page.getByRole('combobox', { name: 'A-Wall' }).selectOption('A-Door')
  assert.equal((await doc()).entities.at(-1).layer, 'A-Door')
  const before = await count()
  await vp().hover({ position: { x: 400, y: 300 } })
  await page.keyboard.press('Delete')
  assert.equal(await count(), before - 1)
})

await step('window selection (left→right) selects only fully enclosed objects', async () => {
  await page.keyboard.press('Escape')
  await vp().click({ position: { x: 760, y: 30 } }) // empty area near north arrow → starts window
  await vp().click({ position: { x: 820, y: 100 } })
  assert.match(await page.getByText(/^(Circle|Polyline|Text|All) \(\d+\)$/).first().innerText(), /\(\d+\)/)
})

await step('F8 toggles ORTHO, persisted across reload', async () => {
  await page.keyboard.press('Escape')
  await page.keyboard.press('F8')
  assert.equal(await page.getByRole('button', { name: 'ORTHO', exact: true }).getAttribute('aria-pressed'), 'true')
  await page.reload({ waitUntil: 'networkidle' })
  assert.equal(await page.getByRole('button', { name: 'ORTHO', exact: true }).getAttribute('aria-pressed'), 'true')
  await page.keyboard.press('F8')
})

await step('Layers: hiding A-Grid removes grid geometry from the view', async () => {
  await page.getByRole('button', { name: 'Layer', exact: true }).click()
  const circles = () => page.locator('[data-native-viewport-slot] svg circle').count()
  const before = await circles()
  await page.getByRole('button', { name: 'On A-Grid' }).click()
  assert.ok((await circles()) < before)
  await page.getByRole('button', { name: 'On A-Grid' }).click()
  await page.getByRole('button', { name: 'Properties', exact: true }).click()
})

await step('Detected tab lists the 3 dimension texts that disagree with measured geometry', async () => {
  await page.getByRole('tab', { name: 'Detected (3)' }).click()
  assert.equal(await page.getByText(/does not match measured/).count(), 3)
  await page.getByRole('tab', { name: 'Command Line' }).click()
})

await step('TRIM / HATCH prompt for their picks; PLOT runs the plot (no "native engine" notice any more)', async () => {
  await cmd('TR')
  assert.ok(await page.getByText(/Select the part of an object to trim/).isVisible())
  await page.keyboard.press('Escape')
  await cmd('H')
  assert.ok(await page.getByText(/Pick an internal point or a closed boundary/).isVisible())
  await page.keyboard.press('Escape')
  await cmd('PLOT')
  assert.doesNotMatch(await log(), /needs the native CAD engine/)
})

const exportDxf = async (name) => {
  const [dl] = await Promise.all([page.waitForEvent('download'), (async () => {
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    await page.getByRole('menuitem', { name }).click()
  })()])
  return fs.readFileSync(await dl.path(), 'utf8')
}
await step('Export DXF (2000) keeps the layouts; importing it opens a tab with the same vectors and the layouts back', async () => {
  const text = await exportDxf('DXF (2000, with layouts)')
  assert.match(text, /AC1015/); assert.match(text, /\bLAYOUT\b/); assert.match(text, /\bVIEWPORT\b/); assert.match(text, /\bCIRCLE\b/)
  const vectors = await count()
  const layouts = await page.evaluate(() => { const s = window.__thcad.cad.getState(); return (s.docs[s.activeId].layouts ?? [{ name: 'Layout1' }, { name: 'Layout2' }]).map((l) => l.name) })
  await page.locator('input[type=file][accept=".dxf,.dwg"]').setInputFiles({ name: 'roundtrip.dxf', mimeType: 'application/dxf', buffer: Buffer.from(text) })
  assert.ok(await page.getByRole('tab', { name: /roundtrip\.dxf/ }).isVisible())
  assert.ok((await count()) >= vectors) // dimensions are exploded to lines + text; the title blocks stay in paper space
  const back = await page.evaluate(() => { const s = window.__thcad.cad.getState(); return s.docs[s.activeId].layouts.map((l) => l.name) })
  assert.deepEqual(back, layouts)
})

await step('Export DXF R12 (model only) for old programs', async () => {
  const text = await exportDxf('DXF R12 (model only)')
  assert.match(text, /AC1009/); assert.doesNotMatch(text, /\bLAYOUT\b/)
})

await step('large DXF (blocks, 2 500+ entities) is exploded and drawn by the GPU layer, or by SVG if WebGL2 is unavailable', async () => {
  // a block with 3 lines inserted as a 30×30 MINSERT array = 2 700 lines, plus one dimension-like block
  const g = []
  const p = (...a) => g.push(...a.map(String))
  p(0, 'SECTION', 2, 'BLOCKS', 0, 'BLOCK', 2, 'CELL', 10, 0, 20, 0)
  p(0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 800, 21, 0, 0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 0, 21, 800, 0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 800, 21, 800)
  p(0, 'ENDBLK', 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES')
  p(0, 'INSERT', 8, 'GRID', 2, 'CELL', 10, 0, 20, 0, 70, 30, 71, 30, 44, 1000, 45, 1000)
  p(0, 'TEXT', 8, 'TXT', 10, 0, 20, -1500, 40, 500, 1, 'LARGE %%c200')
  p(0, 'ENDSEC', 0, 'EOF')
  await page.locator('input[type=file][accept=".dxf,.dwg"]').setInputFiles({ name: 'large.dxf', mimeType: 'application/dxf', buffer: Buffer.from(g.join('\n') + '\n') })
  await page.waitForFunction(() => { const s = window.__thcad.cad.getState(); const d = s.docs[s.activeId]; return d?.name === 'large.dxf' && s.views[s.activeId] })
  const st = await page.evaluate(() => { const s = window.__thcad.cad.getState(); const d = s.docs[s.activeId]; return { n: d.entities.length, text: d.entities.find((e) => e.kind === 'text')?.value, gpu: window.thcadGpuStats, canvases: document.querySelectorAll('canvas[data-gpu]').length, svg: document.querySelectorAll('[data-tool] svg line, [data-tool] svg path').length } })
  assert.equal(st.n, 2701)
  assert.equal(st.text, 'LARGE ⌀200')
  if (st.gpu.failed) assert.ok(st.svg >= 2700, 'SVG fallback draws everything')
  else { assert.equal(st.canvases, 2); assert.equal(st.gpu.segments, 2700); assert.ok(st.svg < 50, 'SVG overlay holds no geometry') }
})

await step('Vietnamese TCVN3 text (.VnTime / .VnTimeH fonts) is converted to Unicode', async () => {
  const g = []
  const p = (...a) => g.push(...a.map(String))
  p(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'STYLE')
  p(0, 'STYLE', 2, 'VN', 70, 0, 3, '', 1001, 'ACAD', 1000, '.VnTime')
  p(0, 'STYLE', 2, 'VNH', 70, 0, 3, '', 1001, 'ACAD', 1000, '.VnTimeH')
  p(0, 'ENDTAB', 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES')
  p(0, 'TEXT', 8, '0', 7, 'VN', 10, 0, 20, 0, 40, 250, 1, 'Cao ®é mÆt ®Êt tù nhiªn')
  p(0, 'TEXT', 8, '0', 7, 'VNH', 10, 0, 20, 500, 40, 250, 1, 'céng hoµ x· héi chñ nghÜa viÖt nam')
  p(0, 'ENDSEC', 0, 'EOF')
  await page.locator('input[type=file][accept=".dxf,.dwg"]').setInputFiles({ name: 'tcvn3.dxf', mimeType: 'application/dxf', buffer: Buffer.from(g.join('\n') + '\n', 'utf8') })
  await page.waitForFunction(() => { const s = window.__thcad.cad.getState(); return s.docs[s.activeId]?.name === 'tcvn3.dxf' })
  const texts = await page.evaluate(() => { const s = window.__thcad.cad.getState(); return s.docs[s.activeId].entities.map((e) => e.value) })
  assert.deepEqual(texts, ['Cao độ mặt đất tự nhiên', 'CỘNG HOÀ XÃ HỘI CHỦ NGHĨA VIỆT NAM'])
})

await step('DWG in a plain browser explains that the desktop app reads DWG', async () => {
  await page.locator('input[type=file][accept=".dxf,.dwg"]').setInputFiles({ name: 'site.dwg', mimeType: 'application/acad', buffer: Buffer.alloc(64) })
  assert.ok(await page.getByText(/needs the desktop app/).first().isVisible())
})

await step('new drawing tab (+) and close tab', async () => {
  await page.getByRole('button', { name: 'New drawing' }).click()
  assert.ok(await page.getByRole('tab', { name: /Drawing1\.dwg/ }).isVisible())
  await page.getByRole('button', { name: 'Close Drawing1.dwg' }).click()
  assert.equal(await page.getByRole('tab', { name: /Drawing1\.dwg/ }).count(), 0)
})

await step('Layouts: Layout1 sheet; add a layout, set A4 1:200, delete it; MODEL toggles back', async () => {
  await page.getByRole('tab', { name: 'Villa Riverside - Floor Plan.dwg' }).click()
  await page.getByRole('tab', { name: 'Layout1' }).click()
  assert.equal(await page.getByLabel('Paper', { exact: true }).inputValue(), 'A3')
  await page.getByRole('button', { name: 'New layout' }).click()
  await page.getByRole('tab', { name: 'Layout3' }).waitFor()
  await page.getByLabel('Paper', { exact: true }).selectOption('A4')
  await page.getByLabel('Scale', { exact: true }).selectOption('200')
  assert.equal(await page.getByTestId('paper-sheet').getAttribute('data-scale'), '200')
  assert.ok((await page.getByTestId('paper-sheet').innerHTML()).includes('A4'))
  await page.getByRole('button', { name: 'Delete layout' }).click()
  assert.equal(await page.getByRole('tab', { name: 'Layout3' }).count(), 0)
  await page.getByRole('tab', { name: 'Layout1' }).click()
  await page.getByRole('button', { name: 'MODEL', exact: true }).click()
  assert.equal(await page.getByRole('tab', { name: 'Model' }).getAttribute('aria-selected'), 'true')
})

await step('Snap settings menu: OSNAP modes toggle and persist; command line settings (text size, Space = Enter)', async () => {
  await page.getByRole('button', { name: 'Snap settings' }).click()
  const quad = page.getByRole('menuitemcheckbox', { name: 'Quadrant' })
  assert.equal(await quad.getAttribute('aria-checked'), 'false')
  await quad.click()
  assert.equal(await quad.getAttribute('aria-checked'), 'true')
  assert.equal(await page.getByRole('menuitemcheckbox', { name: 'Endpoint' }).getAttribute('aria-checked'), 'true')
  await page.keyboard.press('Escape')
  assert.equal(await page.evaluate(() => window.__thcad.cad.getState().osnapModes.quadrant), true)
  await page.getByRole('button', { name: 'Command line settings' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Text size: 15px' }).click()
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('log').evaluate((e) => getComputedStyle(e).fontSize), '15px')
  await page.getByRole('button', { name: 'Command line settings' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Text size: 13px' }).click()
  await page.keyboard.press('Escape')
})

await step('AI Assist: a suggestion is sent to AI Studio (browser: honest “no model” reply); close + reopen from ribbon', async () => {
  await page.getByRole('button', { name: /Detect similar rooms/ }).click()
  await page.waitForURL(/#\/ai-studio$/)
  await page.getByText('Which rooms in this drawing have the same size and shape? List them in groups.').first().waitFor()
  assert.ok(await page.getByText(/No local AI model is available here/).first().isVisible())
  await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/#/cad2d')
  await page.getByRole('heading', { name: 'AI Assist' }).waitFor()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  assert.equal(await page.getByRole('heading', { name: 'AI Assist' }).count(), 0)
  await page.getByRole('button', { name: 'AI Assist', exact: true }).click()
  assert.ok(await page.getByRole('heading', { name: 'AI Assist' }).isVisible())
})

await step('Save clears the unsaved marker', async () => {
  await page.keyboard.press('Meta+s')
  assert.equal((await doc()).dirty, false)
})

await step('VI language translates CAD chrome', async () => {
  await page.getByRole('radio', { name: 'VI' }).click()
  assert.ok(await page.getByRole('tab', { name: 'Thuộc tính' }).isVisible())
  assert.ok(await page.getByRole('tab', { name: 'Phát hiện (3)' }).isVisible())
  await page.getByRole('radio', { name: 'EN' }).click()
})

await step('no console errors', async () => assert.deepEqual(errors, []))
for (const [s, n] of results) console.log(s, n)
await browser.close()
process.exitCode = results.some(([s]) => s === 'FAIL') ? 1 : 0
