// Renders a specimen of candidate fonts (for matching the mockup typeface by eye).
import { chromium } from 'playwright'
const [out, text, size, weight, ...fonts] = process.argv.slice(2)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 900, height: 120 * fonts.length }, deviceScaleFactor: 1 })
await page.goto((process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/'); await page.waitForTimeout(400)
await page.evaluate(async ({ text, size, weight, fonts }) => {
  const css = ['roboto/400','roboto/500','roboto/700','inter-tight/400','inter-tight/500','inter-tight/600','inter-tight/700'].map((p)=>`@import url('/node_modules/@fontsource/${p}.css');`).join('')
  document.body.innerHTML = `<style>${css} body{background:#f9fbfc;margin:0;overflow:visible} div{height:120px;display:flex;align-items:center;padding-left:20px;color:#0f1729;white-space:nowrap}</style>` +
    fonts.map((f) => `<div style="font:${weight} ${size}px ${f}">${text} <small style="font:12px monospace;margin-left:12px">${f}</small></div>`).join('')
  for (const f of fonts) await document.fonts.load(`${weight} ${size}px ${f}`, text)
  await new Promise((r) => setTimeout(r, 200))
}, { text, size, weight, fonts })
await page.screenshot({ path: out })
await browser.close()
