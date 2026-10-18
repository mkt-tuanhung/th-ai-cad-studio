// Accuracy of the plan-picture recogniser (v2.4 "Ảnh mặt bằng → nội thất 3D") on the fixtures of
// qa/v2_4/fixtures/planimage/ against their truth files: walls (count, total length), doors, windows, rooms found
// with the right name, area error per room — after calibration. Runs the app's own pipeline in a browser (OCR
// included), nothing simulated. Needs a dev server: THCAD_UI=http://127.0.0.1:52XX node tools/measure-planimage.mjs
// [fixture ...]. Writes qa/v2_4/planimage_accuracy.json and an overlay picture per fixture (qa/v2_4/planimage_*.jpg).
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const FX = new URL('../../qa/v2_4/fixtures/planimage/', import.meta.url).pathname
const OUT = new URL('../../qa/v2_4/', import.meta.url).pathname
const URL0 = process.env.THCAD_UI ?? 'http://127.0.0.1:5173'
const list = process.argv.slice(2).length ? process.argv.slice(2) : ['villa_t1_150dpi.png', 'villa_t1_phone_SYNTHETIC.jpg', 'sketch_plan_SYNTHETIC.png']
const truthOf = (f) => (f.startsWith('villa') ? 'villa_t1.truth.json' : f.replace(/\.(png|jpe?g|webp|pdf)$/i, '.truth.json'))

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.setDefaultTimeout(240000)
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(URL0 + '/#/dashboard', { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__thcad?.planImage)
const report = {}
let failed = 0
for (const f of list) {
  if (!existsSync(FX + f)) { console.log(`SKIP ${f} (missing)`); continue }
  const truth = JSON.parse(readFileSync(FX + truthOf(f), 'utf8'))
  const b64 = readFileSync(FX + f).toString('base64')
  const t0 = Date.now()
  const r = await page.evaluate(async ({ b64, name, truth }) => {
    const { pipeline, scale, toModel, build } = window.__thcad.planImage
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const file = new File([bytes], name, { type: name.endsWith('.png') ? 'image/png' : 'image/jpeg' })
    const pic = await pipeline.loadPicture(file, 1, 150)
    const corners = pipeline.findCorners(pic)
    const cor = pipeline.correct(pic, { corners, paper: true, deskew: true })
    // nominal: 150 dpi, 1:100 (what the dialog proposes for a picture)
    const nominalK = (25.4 / 150) * 100
    const g = await pipeline.analyse(cor, { pxPerM: 1000 / nominalK, ocr: true })
    const sug = scale.suggestScale(g)
    // the calibration: the consensus of the suggestions when there is one (what "Use the suggestion" does), else
    // the truth's known scale for an uncorrected scan (reported as such)
    const k = sug.k ?? (corners ? null : truth.mmPerPx) ?? nominalK
    const kHow = sug.k ? `suggested (${sug.agreeing.length} agreeing refs of ${sug.refs.length})` : corners ? 'nominal (no suggestion)' : 'known sheet scale'
    const rec = toModel.toRecognition({ graph: g, k, levelName: 'Tầng 1' })
    const names = { roofLevel: 'Mái', room: (n) => `Phòng ${n}`, wallExt: (t) => `Tường ngoài ${t}`, wallInt: (t) => `Tường trong ${t}`, curtain: (t) => `Vách kính ${t}`, door: 'Cửa đi', doubleDoor: 'Cửa đi 2 cánh', opening: 'Lỗ mở', window: 'Cửa sổ', furniture: new Proxy({}, { get: (_, p) => String(p) }) }
    const res = build.autoFromPlan(rec, { names, levelName: 'Tầng 1', file: name })
    const norm = (s) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
    const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length] }
    const sim = (a, b) => { const x = norm(a), y = norm(b); if (!x || !y) return 0; return 1 - lev(x, y) / Math.max(x.length, y.length) }
    const found = rec.rooms.map((x) => ({ name: x.name, area: x.area, outline: x.outline }))
    // rooms matched by PLACE: the truth room's inside point, in the truth's coordinates, falls in the found room —
    // the found plan is moved so that its walls' lower-left corner meets the truth's (scale from the calibration)
    const wpts = rec.walls.flatMap((w) => { const nx = -w.uy, ny = w.ux; return [[w.ux * w.s0 + nx * w.c, w.uy * w.s0 + ny * w.c], [w.ux * w.s1 + nx * w.c, w.uy * w.s1 + ny * w.c]] })
    const dx = truth.wallBox ? truth.wallBox.x0 - Math.min(...wpts.map((p) => p[0])) : 0, dy = truth.wallBox ? truth.wallBox.y0 - Math.min(...wpts.map((p) => p[1])) : 0
    const inside = (p, poly) => { let r = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) r = !r } return r }
    const used = new Set()
    const tokens = (s) => norm(s).split(' ').filter((t) => t.length >= 2)
    const rooms = truth.rooms.map((t) => {
      const i = t.at ? found.findIndex((x) => inside([t.at[0] - dx, t.at[1] - dy], x.outline)) : -1
      let best = i
      if (best < 0) { let bs = 0; found.forEach((x, k) => { if (used.has(k)) return; const s2 = sim(x.name, t.name); if (s2 > bs) { bs = s2; best = k } }); if (bs < 0.6) best = -1 }
      if (best < 0) return { truth: t.name, matched: false, found: null, nameOk: false, truthArea: t.area }
      used.add(best)
      const x = found[best]
      // the name: the same (≥ 80 % alike without diacritics), or all its words in the true name ("GIÚP VIỆC")
      const s2 = sim(x.name, t.name), tk = tokens(x.name ?? ''), tt = tokens(t.name)
      const nameOk = s2 >= 0.8, namePart = !nameOk && tk.length > 0 && tk.every((w) => tt.includes(w))
      return { truth: t.name, matched: true, found: x.name, nameOk, namePart, byPlace: i >= 0, area: x.area, truthArea: t.area, areaErrPct: +(((x.area - t.area) / t.area) * 100).toFixed(1) }
    })
    const len = rec.walls.reduce((a, w) => a + (w.s1 - w.s0), 0) / 1000
    const c = res.house.built.counts
    return {
      corners: !!corners, skew: cor.skew, size: [pic.w, pic.h], corrected: [cor.w, cor.h], k: +k.toFixed(3), kHow, kSuggested: sug.k ? +sug.k.toFixed(3) : null,
      words: g.words.length, title: g.title, level: rec.region.levelName,
      walls: rec.walls.length, curtain: rec.walls.filter((w) => w.curtain).length, wallLenM: +len.toFixed(2), thick: [...new Set(rec.walls.map((w) => w.t))].sort((a, b) => a - b),
      doors: rec.openings.filter((o) => o.kind === 'door').length, windows: rec.openings.filter((o) => o.kind === 'window').length, openings: rec.openings.filter((o) => o.kind === 'opening').length,
      columns: rec.columns.length, roomsFound: found.length, rooms, extraRooms: found.filter((_, i) => !used.has(i)).map((x) => ({ name: x.name, area: x.area })),
      built: c, interiorRooms: res.house.interior?.rooms.length ?? 0, furnished: res.furnished, items: res.house.interior?.items.length ?? 0, cabinets: res.house.interior?.cabinets.length ?? 0,
      notes: g.notes,
      overlay: (() => {
        // the recognition drawn over the corrected picture (QA record)
        const cv = pipeline.canvasOf(cor)
        const x = cv.getContext('2d')
        x.lineWidth = 3
        for (const w of g.walls) { x.strokeStyle = w.curtain ? '#06b6d4' : w.ext ? '#7c3aed' : '#2563eb'; x.globalAlpha = 0.55; x.lineWidth = Math.max(3, w.t); x.beginPath(); x.moveTo(...w.a); x.lineTo(...w.b); x.stroke() }
        x.globalAlpha = 0.85
        for (const o of g.openings) { const w = g.walls.find((q) => q.id === o.wall); const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]); const u = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L]; x.strokeStyle = o.kind === 'door' ? '#16a34a' : o.kind === 'window' ? '#0ea5e9' : '#f97316'; x.lineWidth = Math.max(4, w.t + 4); x.beginPath(); x.moveTo(w.a[0] + u[0] * o.s0, w.a[1] + u[1] * o.s0); x.lineTo(w.a[0] + u[0] * o.s1, w.a[1] + u[1] * o.s1); x.stroke() }
        x.fillStyle = '#dc2626'
        for (const cl of g.columns) x.fillRect(cl.x - cl.w / 2, cl.y - cl.d / 2, cl.w, cl.d)
        x.lineWidth = 2
        x.font = `bold ${Math.round(0.28 * g.pxPerM)}px sans-serif`
        for (const rm of g.rooms) { x.strokeStyle = '#ca8a04'; x.beginPath(); rm.outline.forEach((p, i) => (i ? x.lineTo(...p) : x.moveTo(...p))); x.closePath(); x.stroke(); x.fillStyle = '#b45309'; x.fillText(`${rm.name ?? '?'} ${(rm.areaPx * k * k / 1e6).toFixed(2)}`, rm.seed[0] - 40, rm.seed[1]) }
        const bx = g.box, pad = 0.4 * g.pxPerM
        const c2 = document.createElement('canvas')
        c2.width = Math.round(bx.x1 - bx.x0 + 2 * pad); c2.height = Math.round(bx.y1 - bx.y0 + 2 * pad)
        c2.getContext('2d').drawImage(cv, bx.x0 - pad, bx.y0 - pad, c2.width, c2.height, 0, 0, c2.width, c2.height)
        return c2.toDataURL('image/jpeg', 0.8)
      })(),
    }
  }, { b64, name: f, truth })
  writeFileSync(OUT + `planimage_${f.replace(/\.[^.]+$/, '')}.jpg`, Buffer.from(r.overlay.split(',')[1], 'base64'))
  delete r.overlay
  const ok = r.rooms.filter((x) => x.nameOk)
  const placed = r.rooms.filter((x) => x.matched && x.byPlace)
  const errs = placed.map((x) => Math.abs(x.areaErrPct))
  r.summary = {
    ms: Date.now() - t0,
    walls: `${r.walls} found / ${truth.walls} truth`, wallLenErrPct: +(((r.wallLenM - truth.wallLenM) / truth.wallLenM) * 100).toFixed(1),
    doors: `${r.doors} / ${truth.doors}`, windows: `${r.windows} (+${r.curtain} curtain) / ${truth.windows} (+${truth.curtain ?? 0} curtain)`,
    roomsFound: `${placed.length} / ${truth.rooms.length}`, roomsNamed: `${ok.length} / ${truth.rooms.length} (+${r.rooms.filter((x) => x.namePart).length} partly)`, roomAreaErrPct: errs.length ? { median: +errs.sort((a, b) => a - b)[Math.floor(errs.length / 2)].toFixed(1), max: +Math.max(...errs).toFixed(1) } : null,
  }
  report[f] = r
  console.log(`${f}: ${JSON.stringify(r.summary)} k=${r.k} (${r.kHow})`)
  if (!r.walls) failed++
}
writeFileSync(OUT + 'planimage_accuracy.json', JSON.stringify(report, null, 1))
if (errors.length) { console.log('PAGE ERRORS', errors.slice(0, 5)); failed++ }
await browser.close()
process.exitCode = failed ? 1 : 0
