// Dumps bounding rects for CSS selectors (page coords) — for layout calibration against mockups.
import { chromium } from 'playwright'
const [route, ...sels] = process.argv.slice(2)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1586, height: 992 }, deviceScaleFactor: 1 })
await page.goto(`${process.env.THCAD_UI ?? 'http://127.0.0.1:5173'}/#/${route}`, { waitUntil: 'networkidle' })
for (const sel of sels) {
  const rs = await page.$$eval(sel, (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10) }))
  console.log(sel.padEnd(40), JSON.stringify(rs))
}
await browser.close()
