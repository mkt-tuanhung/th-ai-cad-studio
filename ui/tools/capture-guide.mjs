// Screenshots for the Windows install guide (PDF + video): the app's own screens in Vietnamese, from the dev
// server (the UI is the same in the Windows build). Desktop-only screens (local AI settings) are captured in the
// desktop app by native/app/resources/e2e_guide_shots.js.
// Run: THCAD_UI=http://127.0.0.1:5173 node tools/capture-guide.mjs <outDir>
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const URL0 = process.env.THCAD_UI ?? 'http://127.0.0.1:5173'
const out = process.argv[2] ?? '../qa/guide'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })).newPage()
const shot = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name) }
const step = async (name, fn) => { try { await fn() } catch (e) { console.log('FAIL', name, String(e).split('\n')[0]) } }

await page.goto(`${URL0}/?splash=0#/dashboard`, { waitUntil: 'networkidle' })
await page.getByRole('radio', { name: 'VI' }).click().catch(() => {})
await page.waitForTimeout(800)

await step('dashboard', async () => shot('10_dashboard'))
await step('search', async () => {
  await page.keyboard.press('Meta+k')
  await page.keyboard.type('1 lệnh')
  await shot('20_command_search')
  await page.keyboard.press('Escape')
})
await step('nesting + library', async () => {
  await page.goto(`${URL0}/?splash=0#/interior`, { waitUntil: 'networkidle' })
  await page.getByRole('tab', { name: /Bảng cắt|Cut List/ }).click()
  await page.getByTestId('open-nesting').click()
  await page.getByTestId('nesting-dialog').waitFor()
  await shot('40_nesting_dialog')
  await page.getByTestId('open-library').click()
  await page.getByTestId('machine-library').waitFor()
  await shot('41_machine_library')
  await page.getByTestId('library-list').locator('button').filter({ hasText: /KDT|Nanxing|1325/ }).first().click()
  await shot('42_machine_detail')
  await page.getByRole('tab', { name: 'Tự nhập máy' }).click()
  await page.getByTestId('own-start').click().catch(() => {})
  await shot('43_enter_my_machine')
  await page.getByRole('tab', { name: 'Máy của tôi' }).click()
  await page.getByTestId('commissioning').scrollIntoViewIfNeeded()
  await shot('44_commissioning_wizard')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
})
await step('space planning', async () => {
  await page.goto(`${URL0}/?splash=0#/interior`, { waitUntil: 'networkidle' })
  await page.getByRole('tab', { name: 'Bố trí không gian' }).click()
  await page.getByTestId('space-planning').waitFor()
  await shot('50_space_planning')
})
await step('renders', async () => {
  await page.goto(`${URL0}/?splash=0#/renders`, { waitUntil: 'networkidle' })
  await shot('60_renders')
})
await step('ai presets', async () => {
  await page.goto(`${URL0}/?splash=0#/ai-studio`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Tùy chọn trò chuyện' }).click()
  await page.getByRole('menuitem', { name: 'Tác vụ AI mẫu…' }).click()
  await page.getByTestId('ai-presets').waitFor()
  await shot('70_ai_presets')
  await page.keyboard.press('Escape')
})
await step('cad2d', async () => {
  await page.goto(`${URL0}/?splash=0#/cad2d`, { waitUntil: 'networkidle' })
  await shot('80_cad2d')
})
await step('bim', async () => {
  await page.goto(`${URL0}/?splash=0#/bim`, { waitUntil: 'networkidle' })
  await shot('81_bim')
})
await browser.close()
