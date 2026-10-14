// Records the MD CAD AI STUDIO intro (video + frames at each phase) and the brand screens for QA.
// Run with the dev server up: node tools/capture-intro.mjs → qa/brand/
import { chromium } from 'playwright'
const out = new URL('../../qa/brand/', import.meta.url).pathname
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1528, height: 957 }, recordVideo: { dir: out, size: { width: 1528, height: 957 } } })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/?splash=1#/dashboard')
const t0 = Date.now()
for (const ms of [250, 900, 1500, 2300, 2900, 3500, 4200]) {
  await page.waitForTimeout(Math.max(0, ms - (Date.now() - t0)))
  await page.screenshot({ path: `${out}intro_${String(ms).padStart(4, '0')}ms.png` })
}
await page.waitForSelector('[data-testid=intro-screen]', { state: 'detached', timeout: 15000 })
const total = Date.now() - t0
await page.waitForTimeout(400)
await page.screenshot({ path: `${out}after_intro_dashboard.png` })
await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/?splash=0#/brand')
await page.waitForTimeout(1200)
await page.screenshot({ path: `${out}brand_screen.png`, fullPage: false })
await page.getByTestId('installer-welcome').screenshot({ path: `${out}installer_welcome.png` })
await page.getByTestId('app-icon-preview').screenshot({ path: `${out}app_icon_preview.png` })
const video = await page.video().path()
await ctx.close()
await browser.close()
console.log(JSON.stringify({ introMs: total, video, errors }))
