// Visual-fidelity capture: renders a screen at the mockup's exact size (1586×992 @1x) in a fresh
// profile (seed data, EN) and saves a PNG for comparison with mockups_full/*.png.
// usage: node tools/capture.mjs <route> <out.png> [lang=en] [width=1586] [height=992] [hoverSelector]
import { chromium } from 'playwright'

const [route = 'dashboard', out = 'capture.png', lang = 'en', w = '1586', h = '992', hover] = process.argv.slice(2)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
await page.addInitScript((l) => {
  localStorage.setItem('thcad.settings', JSON.stringify({ state: { language: l, themePreference: 'light', learningExpanded: true }, version: 1 }))
}, lang)
await page.goto(`http://127.0.0.1:5173/#/${route}`, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
if (hover) await page.hover(hover)
await page.waitForTimeout(300)
await page.screenshot({ path: out })
await browser.close()
if (errors.length) {
  console.error('CONSOLE ERRORS:\n' + errors.join('\n'))
  process.exitCode = 1
} else console.log('ok, no console errors ->', out)
