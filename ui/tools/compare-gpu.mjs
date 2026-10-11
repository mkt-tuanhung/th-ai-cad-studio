// Renders one DXF twice — SVG renderer vs GPU layer — at the same view and saves both screenshots.
// Usage: node tools/compare-gpu.mjs file.dxf outPrefix   (vite dev server on :5173)
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
const [file, out] = process.argv.slice(2)
const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
for (const mode of ['svg', 'gpu']) {
  const page = await browser.newPage({ viewport: { width: 1586, height: 992 }, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.log('pageerror', e.message))
  await page.goto((process.env.BENCH_URL ?? 'http://127.0.0.1:5173/') + '#/cad2d', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__thcad?.cad?.persist.hasHydrated())
  await page.evaluate((m) => { window.thcadGpuPref.force = m === 'gpu' }, mode)
  await page.locator('input[type=file][accept=".dxf,.dwg"]').setInputFiles({ name: basename(file), mimeType: 'application/dxf', buffer: readFileSync(file) })
  await page.waitForFunction(() => { const s = window.__thcad.cad.getState(); return !!s.views[s.activeId] }, null, { timeout: 120000 })
  await page.waitForTimeout(800)
  const canvas = page.locator('[data-tool]').first()
  await canvas.screenshot({ path: `${out}_${mode}.png` })
  // zoomed-in detail: 8x around a point a quarter into the drawing
  await page.evaluate(() => { const s = window.__thcad.cad.getState(); const v = s.views[s.activeId]; s.setView(s.activeId, { center: { x: v.center.x - 180 * v.mmPerPx, y: v.center.y + 120 * v.mmPerPx }, mmPerPx: v.mmPerPx / 8 }) })
  await page.waitForTimeout(400)
  await canvas.screenshot({ path: `${out}_${mode}_zoom.png` })
  console.log(mode, JSON.stringify(await page.evaluate(() => ({ gpu: window.thcadGpuStats, canvases: document.querySelectorAll('canvas[data-gpu]').length, svgNodes: document.querySelector('[data-tool] svg').querySelectorAll('*').length }))))
  await page.close()
}
await browser.close()
