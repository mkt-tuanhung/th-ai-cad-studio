// Pointer-move cost with the LINE tool active (OSNAP on) on a large drawing.
// Usage: node tools/bench-hover.mjs file.dxf
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
const file = process.argv[2]
const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1586, height: 992 } })
await page.goto((process.env.BENCH_URL ?? 'http://127.0.0.1:5173/') + '#/cad2d', { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__thcad?.cad?.persist.hasHydrated())
await page.locator('input[type=file][accept=".dxf,.dwg"]').setInputFiles({ name: basename(file), mimeType: 'application/dxf', buffer: readFileSync(file) })
await page.waitForFunction(() => { const s = window.__thcad.cad.getState(); return !!s.views[s.activeId] }, null, { timeout: 120000 })
const input = page.locator('input[aria-label="Type a command or use AI..."]')
await input.fill('LINE'); await input.press('Enter')
await page.mouse.click(700, 500)
const box = await page.locator('[data-tool]').first().boundingBox()
const times = []
for (let k = 0; k < 30; k++) {
  const t = Date.now()
  await page.mouse.move(box.x + 100 + k * 17, box.y + 100 + k * 9)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  times.push(Date.now() - t)
}
times.sort((a, b) => a - b)
console.log(JSON.stringify({ file: basename(file), hoverMedianMs: times[15], hoverP90Ms: times[27] }))
await browser.close()
