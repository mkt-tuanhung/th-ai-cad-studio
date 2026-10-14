// 2D viewport benchmark: imports DXF files into the CAD 2D screen and measures
// import+first render, and the frame time of pan/zoom view changes.
// Usage: node tools/bench-2d.mjs out.png file1.dxf [file2.dxf …]   (vite dev server on :5173)
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const [shotPrefix, ...files] = process.argv.slice(2)
const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const results = []
for (const f of files) {
  const page = await browser.newPage({ viewport: { width: 1586, height: 992 } })
  await page.goto((process.env.BENCH_URL ?? (process.env.THCAD_UI ?? 'http://127.0.0.1:5173') + '/') + '#/cad2d', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__thcad?.cad?.persist.hasHydrated())
  const buf = readFileSync(f)
  const t0 = Date.now()
  await page.locator('input[type=file][accept=".dxf,.dwg"]').setInputFiles({ name: basename(f), mimeType: 'application/dxf', buffer: buf })
  const n = await page.waitForFunction((name) => { const s = window.__thcad.cad.getState(); const d = s.docs[s.activeId]; return d?.name === name && d.entities.length }, basename(f), { timeout: 600000 }).then((h) => h.jsonValue())
  // two animation frames after the document exists = first full paint (zoom extents included)
  // zoom-extents runs on the frame after import and stores the view
  await page.waitForFunction(() => { const s = window.__thcad.cad.getState(); return !!s.views[s.activeId] }, null, { timeout: 300000, polling: 50 }).catch(async (e) => { console.log("views wait failed", await page.evaluate(() => { const s = window.__thcad.cad.getState(); return JSON.stringify({ a: s.activeId, v: Object.keys(s.views), n: s.docs[s.activeId]?.name }) })); throw e })
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  const firstMs = Date.now() - t0
  const nodes = await page.evaluate(() => document.querySelectorAll('svg *').length)
  const gpu = await page.evaluate(() => window.thcadGpuStats ? { segments: window.thcadGpuStats.segments, buildMs: Math.round(window.thcadGpuStats.lastBuildMs), failed: window.thcadGpuStats.failed } : null)
  await page.screenshot({ path: `${shotPrefix}_${basename(f, '.dxf')}.png` })
  // pan / zoom: 20 view changes, each awaited until painted
  const frames = await page.evaluate(async () => {
    const st = window.__thcad.cad.getState()
    const id = st.activeId
    const v0 = st.views[id]
    const out = []
    for (let k = 0; k < 20; k++) {
      const t = performance.now()
      const v = k % 2 ? { center: { x: v0.center.x + (k * v0.mmPerPx * 15), y: v0.center.y }, mmPerPx: v0.mmPerPx } : { center: v0.center, mmPerPx: v0.mmPerPx * (k % 4 ? 0.9 : 1.1) }
      window.__thcad.cad.getState().setView(id, v)
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      out.push(performance.now() - t)
    }
    return out.sort((a, b) => a - b)
  })
  const med = frames[10], p90 = frames[18]
  // persistence: the drawing must survive a reload (IndexedDB)
  await page.waitForTimeout(1500)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__thcad && window.__thcad.cad.persist.hasHydrated())
  const after = await page.evaluate(() => { const s = window.__thcad.cad.getState(); return s.docs[s.activeId]?.entities.length ?? 0 })
  results.push({ file: basename(f), entities: n, svgNodes: nodes, firstPaintMs: firstMs, viewChangeMedianMs: Math.round(med), viewChangeP90Ms: Math.round(p90), entitiesAfterReload: after, gpu })
  console.log(JSON.stringify(results.at(-1)))
  await page.close()
}
await browser.close()
