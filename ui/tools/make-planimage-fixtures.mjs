// SYNTHETIC fixtures for the plan-picture tests (qa/v2_4/fixtures/planimage/), made in a browser canvas:
//  - villa_t1_phone_SYNTHETIC.jpg: villa_t1_150dpi.png (the VILLA_150 A2 sheet, Tầng 1, 150 dpi) as a phone photo:
//    the sheet in perspective on a table, a shadow gradient, slight blur, sensor noise, JPEG at quality 0.72;
//  - sketch_plan_SYNTHETIC.png (+ .truth.json): a clean hand-drawn-style plan — thick wobbly marker walls with
//    overshooting corners, doors as gaps with hand arcs and leaves, windows as two thin lines, handwriting-like
//    labels (6 rooms), an overall dimension "9000"; 80 px per metre (12.5 mm / px).
// run: node tools/make-planimage-fixtures.mjs
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'

const OUT = new URL('../../qa/v2_4/fixtures/planimage/', import.meta.url).pathname
const browser = await chromium.launch()
const page = await browser.newPage()

// ---------------------------------------------------------------- phone photo
{
  const b64 = readFileSync(OUT + 'villa_t1_150dpi.png').toString('base64')
  const jpg = await page.evaluate(async (b64) => {
    const im = new Image()
    await new Promise((r) => { im.onload = r; im.src = 'data:image/png;base64,' + b64 })
    const sw = im.naturalWidth, sh = im.naturalHeight
    const sc = document.createElement('canvas'); sc.width = sw; sc.height = sh
    const sg = sc.getContext('2d'); sg.drawImage(im, 0, 0)
    const src = sg.getImageData(0, 0, sw, sh).data
    const W = 3200, H = 2400
    // the sheet's corners in the photo (TL, TR, BR, BL): held a little turned and tilted
    const Q = [[300, 230], [2930, 150], [3010, 2190], [190, 2290]]
    // homography sheet px → photo px (DLT), inverted per pixel
    const hom = (s, d) => {
      const A = []
      for (let i = 0; i < 4; i++) { const [x, y] = s[i], [u, v] = d[i]; A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]); A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]) }
      for (let c = 0; c < 8; c++) { let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; [A[c], A[p]] = [A[p], A[c]]; for (let r = 0; r < 8; r++) { if (r === c) continue; const f = A[r][c] / A[c][c]; for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k] } }
      return [...A.map((r, i) => r[8] / A[i][i]), 1]
    }
    const Hi = hom(Q, [[0, 0], [sw, 0], [sw, sh], [0, sh]]) // photo → sheet
    const out = new ImageData(W, H)
    let seed = 7
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    const gauss = () => { let s = 0; for (let i = 0; i < 4; i++) s += rnd(); return (s - 2) * 1.7 }
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const w = Hi[6] * x + Hi[7] * y + Hi[8]
        const sx = (Hi[0] * x + Hi[1] * y + Hi[2]) / w, sy = (Hi[3] * x + Hi[4] * y + Hi[5]) / w
        const o = (y * W + x) * 4
        let r, g, b
        if (sx < 0 || sy < 0 || sx >= sw - 1 || sy >= sh - 1) {
          // the table: dark wood, its own gradient
          const t = 0.75 + 0.25 * Math.sin(y / 37 + Math.sin(x / 300)) * 0.3
          r = 92 * t; g = 70 * t; b = 52 * t
        } else {
          const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0
          const px = (xx, yy, c) => src[(yy * sw + xx) * 4 + c]
          const v = (c) => px(x0, y0, c) * (1 - fx) * (1 - fy) + px(x0 + 1, y0, c) * fx * (1 - fy) + px(x0, y0 + 1, c) * (1 - fx) * fy + px(x0 + 1, y0 + 1, c) * fx * fy
          // light: a warm cast, brighter top-left, a soft shadow (the phone / a hand) across the lower right
          const light = 0.97 - 0.22 * (x / W) * (y / H) - 0.18 * Math.exp(-(((x - 2300) / 700) ** 2 + ((y - 1700) / 500) ** 2))
          r = v(0) * light; g = v(1) * light * 0.97; b = v(2) * light * 0.9
        }
        const n = gauss() * 5
        out.data[o] = r + n; out.data[o + 1] = g + n; out.data[o + 2] = b + n; out.data[o + 3] = 255
      }
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const g = c.getContext('2d')
    const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H
    tmp.getContext('2d').putImageData(out, 0, 0)
    g.filter = 'blur(0.7px)'
    g.drawImage(tmp, 0, 0)
    return c.toDataURL('image/jpeg', 0.72).split(',')[1]
  }, b64)
  writeFileSync(OUT + 'villa_t1_phone_SYNTHETIC.jpg', Buffer.from(jpg, 'base64'))
}

// ---------------------------------------------------------------- hand-drawn sketch
{
  const K = 12.5 // mm per px
  const M = 140 // margin px
  const r = await page.evaluate(({ K, M }) => {
    const W = 9000, Hm = 7000
    const cw = Math.round(W / K) + 2 * M, ch = Math.round(Hm / K) + 2 * M + 120
    const c = document.createElement('canvas'); c.width = cw; c.height = ch
    const g = c.getContext('2d')
    g.fillStyle = '#fbfaf6'; g.fillRect(0, 0, cw, ch)
    let seed = 3
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    // model mm (y up) → picture px
    const P = (x, y) => [M + x / K, M + (Hm - y) / K]
    const wob = (a, b, width, color = '#1b1b1b', over = 0) => {
      // a hand line: small low-frequency wobble, ends overshooting a little
      const [ax, ay] = P(...a), [bx, by] = P(...b)
      const L = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / L, uy = (by - ay) / L
      const n = Math.max(2, Math.round(L / 6)), ph = rnd() * 6, amp = 0.9 + rnd() * 0.6
      g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round'; g.lineJoin = 'round'
      g.beginPath()
      for (let i = 0; i <= n; i++) {
        const s = -over + ((L + 2 * over) * i) / n
        const off = amp * Math.sin(ph + s / 23) + 0.4 * Math.sin(s / 7 + ph)
        const x = ax + ux * s - uy * off, y = ay + uy * s + ux * off
        i ? g.lineTo(x, y) : g.moveTo(x, y)
      }
      g.stroke()
    }
    const tE = 200, tI = 140
    // walls with their openings (gaps); each [a, b, t, gaps: [[s0, s1], ...] along a→b in mm]
    const walls = [
      [[0, 0], [9000, 0], tE, [[1500, 2400]]],
      [[9000, 0], [9000, 7000], tE, [[800, 2200]]],
      [[9000, 7000], [0, 7000], tE, [[1000, 3000], [5500, 7500]]],
      [[0, 7000], [0, 0], tE, [[4000, 6000]]],
      [[5000, 0], [5000, 7000], tI, [[1000, 1900], [3200, 3900]]],
      [[0, 4000], [5000, 4000], tI, [[3500, 4300]]],
      [[5000, 3000], [9000, 3000], tI, []],
      [[5000, 5000], [9000, 5000], tI, [[2400, 3200]]],
      [[7000, 3000], [7000, 5000], tI, [[300, 1000]]],
    ]
    const doors = [] // hinge, end (mm), swing side
    for (const [a, b, t, gaps] of walls) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L
      let s = 0
      const ends = [...gaps, [L, L]]
      for (const [g0, g1] of ends) {
        if (g0 > s) wob([a[0] + ux * s, a[1] + uy * s], [a[0] + ux * g0, a[1] + uy * g0], t / K, '#1b1b1b', s === 0 || g0 === L ? 4 : 0)
        s = g1
      }
    }
    // windows: two thin lines in the gap (ext walls); doors: arc + leaf in the others
    const windows = [[0, 0], [1, 0], [2, 0], [2, 1], [3, 0]]
    const isWin = (wi, gi) => windows.some(([w, gg]) => w === wi && gg === gi)
    walls.forEach(([a, b, t, gaps], wi) => {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, nx = -uy, ny = ux
      gaps.forEach(([g0, g1], gi) => {
        const A = [a[0] + ux * g0, a[1] + uy * g0], B = [a[0] + ux * g1, a[1] + uy * g1]
        if (wi === 0 && gi === 0) { /* the entrance: a door */ }
        if (isWin(wi, gi) && !(wi === 0 && gi === 0)) {
          for (const o of [-t / 4, t / 4]) wob([A[0] + nx * o, A[1] + ny * o], [B[0] + nx * o, B[1] + ny * o], 2.2, '#222')
          return
        }
        // door: hinge at A, leaf open across the wall (to the left of a→b), arc from the leaf end to B
        const R = g1 - g0, side = wi === 5 || wi === 7 ? -1 : 1
        const leaf = [A[0] + nx * R * side, A[1] + ny * R * side]
        wob(A, leaf, 2.4, '#222')
        const [hx, hy] = P(...A)
        const a0 = Math.atan2(-(ny * side), nx * side), a1 = Math.atan2(-uy, ux)
        g.strokeStyle = '#333'; g.lineWidth = 1.8; g.beginPath()
        const n = 24
        let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI
        for (let i = 0; i <= n; i++) { const t2 = a0 + (d * i) / n, rr = R / K + Math.sin(i / 3) * 0.6; const x = hx + rr * Math.cos(t2), y = hy + rr * Math.sin(t2); i ? g.lineTo(x, y) : g.moveTo(x, y) }
        g.stroke()
        doors.push({ wall: wi, s0: g0, s1: g1 })
      })
    })
    // labels in a handwriting-like face, a little turned
    const label = (txt, x, y, size) => {
      const [px, py] = P(x, y)
      g.save(); g.translate(px, py); g.rotate((rnd() - 0.5) * 0.06)
      g.font = `${size}px "Chalkboard SE", "Comic Sans MS", "Bradley Hand", "Marker Felt", cursive`
      g.fillStyle = '#1d2a4a'; g.textAlign = 'center'; g.textBaseline = 'middle'
      g.fillText(txt, 0, 0); g.restore()
    }
    const rooms = [
      { name: 'P. KHÁCH', box: [0, 0, 5000, 4000], at: [2500, 2100] },
      { name: 'P. NGỦ 1', box: [0, 4000, 5000, 7000], at: [2500, 5600] },
      { name: 'BẾP', box: [5000, 0, 9000, 3000], at: [7000, 1500] },
      { name: 'WC', box: [5000, 3000, 7000, 5000], at: [6000, 4100] },
      { name: 'KHO', box: [7000, 3000, 9000, 5000], at: [8000, 4100] },
      { name: 'P. NGỦ 2', box: [5000, 5000, 9000, 7000], at: [7000, 6100] },
    ]
    for (const rm of rooms) label(rm.name, rm.at[0], rm.at[1], 30)
    // overall dimension over the top
    {
      const y = 7000 + 900
      wob([0, y], [9000, y], 1.6, '#333')
      for (const x of [0, 9000]) wob([x, y - 220], [x, y + 220], 1.6, '#333')
      label('9000', 4500, y + 330, 26)
    }
    label('MẶT BẰNG TẦNG 1', 4500, -1100, 34)
    // the truth: inner faces of the walls (half thickness each side)
    const half = (x, isOuter) => (isOuter ? tE / 2 : tI / 2)
    const truthRooms = rooms.map((rm) => {
      const [x0, y0, x1, y1] = rm.box
      const ix0 = x0 + half(x0, x0 === 0), ix1 = x1 - half(x1, x1 === 9000), iy0 = y0 + half(y0, y0 === 0), iy1 = y1 - half(y1, y1 === 7000)
      return { name: rm.name, area: +(((ix1 - ix0) * (iy1 - iy0)) / 1e6).toFixed(2), at: rm.at, outline: [[ix0, iy0], [ix1, iy0], [ix1, iy1], [ix0, iy1]] }
    })
    const wallLen = walls.reduce((s, [a, b]) => s + Math.hypot(b[0] - a[0], b[1] - a[1]), 0) / 1000
    return { png: c.toDataURL('image/png').split(',')[1], truth: { source: 'tools/make-planimage-fixtures.mjs (geometry drawn from these numbers)', mmPerPx: K, level: 'Tầng 1', walls: walls.length, curtain: 0, wallLenM: wallLen, thick: [tI, tE], doors: doors.length, windows: windows.length - 1 + 0, columns: 0, rooms: truthRooms, wallBox: { x0: 0, y0: 0, x1: 9000, y1: 7000 } } }
  }, { K, M })
  writeFileSync(OUT + 'sketch_plan_SYNTHETIC.png', Buffer.from(r.png, 'base64'))
  writeFileSync(OUT + 'sketch_plan_SYNTHETIC.truth.json', JSON.stringify(r.truth, null, 1))
}
await browser.close()
console.log('fixtures written to', OUT)
