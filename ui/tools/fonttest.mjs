// Renders sample strings in candidate fonts and prints ink widths to compare with mockup measurements.
import { chromium } from 'playwright'
const fonts = process.argv.slice(2)
const samples = [
  ['Dashboard', 15, 500], ['Projects', 15, 400], ['Settings', 15, 400], ['Components', 15, 400],
  ['Design Smarter. Build Faster.', 12, 400], ['Villa Riverside', 14.5, 600], ['Architectural • DWG', 12.5, 400],
  ['Active Projects', 12.5, 400], ['Mechanical', 15, 600], ['AI model running locally on your machine', 12, 400],
  ['New Drawing (DWG)', 13.5, 400], ['Search projects, files, components... or type a command with AI...', 14, 400],
  ['MD CAD AI STUDIO', 48, 700], ['Professional CAD with Local AI', 20.5, 400], ['Hoàng Trần', 14, 500],
]
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/'); await page.waitForTimeout(500)
const css = `@import url('/node_modules/@fontsource/roboto/400.css');@import url('/node_modules/@fontsource/roboto/500.css');@import url('/node_modules/@fontsource/roboto/700.css');
@import url('/node_modules/@fontsource/inter-tight/400.css');@import url('/node_modules/@fontsource/inter-tight/500.css');@import url('/node_modules/@fontsource/inter-tight/600.css');@import url('/node_modules/@fontsource/inter-tight/700.css');`
const res = await page.evaluate(async ({ fonts, samples, css }) => {
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st)
  const out = {}
  for (const f of fonts) {
    out[f] = []
    for (const [txt, size, w] of samples) {
      const s = document.createElement('span')
      s.style.cssText = `font-family:${f};font-size:${size}px;font-weight:${w};position:absolute;white-space:nowrap`
      s.textContent = txt; document.body.appendChild(s)
      await document.fonts.load(`${w} ${size}px ${f}`, txt); await new Promise((r) => setTimeout(r, 30))
      out[f].push(Math.round(s.getBoundingClientRect().width)); s.remove()
    }
  }
  return out
}, { fonts, samples, css })
console.log('sample'.padEnd(34), Object.keys(res).map((k) => k.slice(0, 14).padEnd(15)).join(''))
samples.forEach((smp, i) => console.log(smp[0].slice(0, 32).padEnd(34), Object.values(res).map((v) => String(v[i]).padEnd(15)).join('')))
await browser.close()
