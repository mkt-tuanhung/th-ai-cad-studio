// Plan image → BIM (v2.4 "Ảnh mặt bằng → nội thất 3D"): unit tests of the geometry steps, the ground truth of the
// VILLA_150 Tầng 1 plan from its DWG/DXF, and a debug run on a PGM/PPM picture.
//   UNIT=planimage node tools/test-cam.mjs run                     geometry steps (asserting, { all })
//   UNIT=planimage node tools/test-cam.mjs truth <MASTER.dxf>      Tầng 1 truth from the DWG recogniser (JSON)
//   PI_OUT=/tmp/x.png UNIT=planimage node tools/test-cam.mjs debug <page.pgm|ppm>   recognition + overlay PNG
import { decodeDxf, importDxf } from '../../src/cad/dxfImport'
import type { CadDocument } from '../../src/cad/types'
import { findPlans, interiorPoint, layerStats, recognize, wallLine, type LayerRole } from '../../src/bim/fromCad'
import { inkOf } from '../../src/planimage/preprocess'
import { applyH, detectSheet, homography, invertH, paperAspect, rotationH, skewAngle, warpRGBA } from '../../src/planimage/perspective'
import { textInkOf, textLineBoxes } from '../../src/planimage/textlines'
import { fillRect, mask, normalizeBackground, open, runLengths, type Gray, type Mask } from '../../src/planimage/raster'
import { recognizePlan, roomLabel, textLines, type PlanGraph, type Pt, type PWord } from '../../src/planimage/recognize'
import { planRecord, toRecognition } from '../../src/planimage/toModel'
import { autoFromPlan } from '../../src/planimage/build'
import { mergeCollinear, suggestScale } from '../../src/planimage/scale'
import { lexiconWord } from '../../src/planimage/roomWords'
import { addWall, pointIn, remove, renameRoom, setOpening } from '../../src/planimage/edit'
import type { BuildNames } from '../../src/bim/fromCadBuild'
import { fromCadEn } from '../../src/i18n/ws/fromCad'
import { validateInterior } from '../../src/state/interior'
import { fabricationAllowed } from '../../src/cad/provenance'
import type { CalRef } from '../../src/cad/calibration'

const proc = (globalThis as unknown as { process: { cwd(): string; env: Record<string, string | undefined>; getBuiltinModule(m: string): Record<string, (...a: unknown[]) => unknown> } }).process
const fs = () => proc.getBuiltinModule('node:fs') as unknown as { readFileSync(p: string, e?: string): string | Uint8Array; writeFileSync(p: string, d: Uint8Array | string): void }
const zlib = () => proc.getBuiltinModule('node:zlib') as unknown as { deflateSync(b: Uint8Array): Uint8Array }

/* ---------------------------------------------------------------- picture I/O for Node */

/** PGM (P5) / PPM (P6) from a latin1 string → RGBA. */
export function readPnm(latin1: string): { w: number; h: number; rgba: Uint8ClampedArray } {
  let pos = 0
  const tok = () => {
    while (pos < latin1.length) {
      const c = latin1[pos]
      if (c === '#') { while (latin1[pos] !== '\n') pos++; continue }
      if (/\s/.test(c)) { pos++; continue }
      break
    }
    let s = ''
    while (pos < latin1.length && !/\s/.test(latin1[pos])) s += latin1[pos++]
    return s
  }
  const magic = tok(), w = Number(tok()), h = Number(tok())
  tok()
  pos++
  const ch = magic === 'P6' ? 3 : 1
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const r = latin1.charCodeAt(pos + i * ch), g = ch === 3 ? latin1.charCodeAt(pos + i * ch + 1) : r, b = ch === 3 ? latin1.charCodeAt(pos + i * ch + 2) : r
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = 255
  }
  return { w, h, rgba }
}

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
function crc32(b: Uint8Array) { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
/** RGB → PNG bytes. */
export function pngOf(w: number, h: number, rgb: Uint8Array): Uint8Array {
  const raw = new Uint8Array((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1) }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    const dv = new DataView(out.buffer)
    dv.setUint32(0, data.length)
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
    out.set(data, 8)
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
    return out
  }
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 2
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib().deflateSync(raw)), chunk('IEND', new Uint8Array(0))]
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

/** Overlay of a recognition on the picture (crop of the plan box), RGB. */
export function overlay(g: PlanGraph, grey: Uint8Array, pad = 30): { w: number; h: number; rgb: Uint8Array } {
  const x0 = Math.max(0, Math.floor(g.box.x0 - pad)), y0 = Math.max(0, Math.floor(g.box.y0 - pad)), x1 = Math.min(g.w, Math.ceil(g.box.x1 + pad)), y1 = Math.min(g.h, Math.ceil(g.box.y1 + pad))
  const w = x1 - x0, h = y1 - y0
  const rgb = new Uint8Array(w * h * 3)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = 150 + (grey[(y + y0) * g.w + x + x0] * 105) / 255; rgb.set([v, v, v], (y * w + x) * 3) }
  const put = (x: number, y: number, c: number[]) => { const xx = Math.round(x - x0), yy = Math.round(y - y0); if (xx >= 0 && yy >= 0 && xx < w && yy < h) rgb.set(c, (yy * w + xx) * 3) }
  const seg = (a: number[], b: number[], c: number[]) => { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])) + 1; for (let i = 0; i <= n; i++) put(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, c) }
  const COL = { room: [250, 200, 60], wall: [30, 90, 230], ext: [140, 40, 200], curtain: [0, 190, 210], door: [20, 170, 60], window: [0, 200, 255], opening: [255, 120, 0], col: [220, 30, 30] }
  for (const r of g.rooms) for (let i = 0; i < r.outline.length; i++) seg(r.outline[i], r.outline[(i + 1) % r.outline.length], COL.room)
  for (const wl of g.walls) {
    const dx = wl.b[0] - wl.a[0], dy = wl.b[1] - wl.a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L
    const c = wl.curtain ? COL.curtain : wl.ext ? COL.ext : COL.wall
    for (const o of [-wl.t / 2, wl.t / 2]) seg([wl.a[0] + nx * o, wl.a[1] + ny * o], [wl.b[0] + nx * o, wl.b[1] + ny * o], c)
    seg(wl.a, wl.b, c)
  }
  for (const op of g.openings) {
    const wl = g.walls.find((x) => x.id === op.wall)!
    const dx = wl.b[0] - wl.a[0], dy = wl.b[1] - wl.a[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux
    const c = COL[op.kind]
    for (let o = -wl.t / 2 - 2; o <= wl.t / 2 + 2; o += 1) seg([wl.a[0] + ux * op.s0 + nx * o, wl.a[1] + uy * op.s0 + ny * o], [wl.a[0] + ux * op.s1 + nx * o, wl.a[1] + uy * op.s1 + ny * o], o === -wl.t / 2 - 2 || o >= wl.t / 2 + 1 ? c : [255, 255, 255].map((v, i) => (v + c[i]) / 2))
  }
  for (const c of g.columns) for (let y = c.y - c.d / 2; y <= c.y + c.d / 2; y++) seg([c.x - c.w / 2, y], [c.x + c.w / 2, y], COL.col)
  for (const a of g.arcs) for (let k = 0; k < 40; k++) put(a.c[0] + a.r * Math.cos((k / 40) * 2 * Math.PI), a.c[1] + a.r * Math.sin((k / 40) * 2 * Math.PI), [255, 0, 255])
  return { w, h, rgb }
}

export function debug(latin1?: string) {
  const { w, h, rgba } = readPnm(latin1 ?? '')
  const t0 = Date.now()
  const { ink, gray } = inkOf(rgba, w, h)
  const t1 = Date.now()
  const pxPerM = Number(proc.env.PI_PXM ?? 1000 / ((25.4 / 150) * 100))
  const dbg: Record<string, unknown> = {}
  const g = recognizePlan({ ink, words: [] }, { pxPerM, debug: dbg, ...(proc.env.PI_K ? { kernel: Number(proc.env.PI_K) } : {}) })
  const t2 = Date.now()
  const out = proc.env.PI_OUT
  if (out) {
    const o = overlay(g, gray.d)
    const c = (proc.env.PI_CROP ?? '').split(',').map(Number)
    if (c.length === 4) {
      const [cx, cy, cw, ch] = c, z = Number(proc.env.PI_ZOOM ?? 1), rgb = new Uint8Array(cw * ch * 3 * z * z)
      const raw = proc.env.PI_RAW === '1'
      for (let y = 0; y < ch * z; y++) for (let x = 0; x < cw * z; x++) {
        const sx = cx + Math.floor(x / z), sy = cy + Math.floor(y / z)
        if (raw) { const gx = sx + Math.max(0, Math.floor(g.box.x0 - 30)), gy = sy + Math.max(0, Math.floor(g.box.y0 - 30)); const v = gray.d[gy * g.w + gx]; rgb.set([v, v, v], (y * cw * z + x) * 3) }
        else if (sx < o.w && sy < o.h) rgb.set(o.rgb.subarray((sy * o.w + sx) * 3, (sy * o.w + sx) * 3 + 3), (y * cw * z + x) * 3)
      }
      fs().writeFileSync(out, pngOf(cw * z, ch * z, rgb))
    } else fs().writeFileSync(out, pngOf(o.w, o.h, o.rgb))
  }
  const k = 1000 / g.pxPerM
  return {
    ms: { prep: t1 - t0, rec: t2 - t1 }, dbg, corners: detectSheet(rgba, w, h, dbg), size: [w, h], style: g.style, pxPerM: g.pxPerM, notes: g.notes,
    walls: g.walls.length, wallLenM: +(g.walls.reduce((a, x) => a + Math.hypot(x.b[0] - x.a[0], x.b[1] - x.a[1]), 0) * k / 1000).toFixed(2),
    thick: [...new Set(g.walls.map((x) => Math.round(x.t * k / 10) * 10))].sort((a, b) => a - b),
    doors: g.openings.filter((o) => o.kind === 'door').length, windows: g.openings.filter((o) => o.kind === 'window').length, openings: g.openings.filter((o) => o.kind === 'opening').length,
    curtain: g.walls.filter((x) => x.curtain).length, columns: g.columns.length, arcs: g.arcs.length, segs: g.segs.length, flights: g.flights.length,
    rooms: g.rooms.map((r) => +(r.areaPx * k * k / 1e6).toFixed(2)).sort((a, b) => b - a),
    wl: proc.env.PI_OPS ? g.walls.map((w) => `${Math.round(w.a[0] - g.box.x0 + 30)},${Math.round(w.a[1] - g.box.y0 + 30)}>${Math.round(w.b[0] - g.box.x0 + 30)},${Math.round(w.b[1] - g.box.y0 + 30)} t${w.t.toFixed(0)}${w.curtain ? "C" : ""}${w.ext ? "E" : ""}`) : undefined,
    ops: proc.env.PI_OPS ? g.openings.map((o) => { const w = g.walls.find((x) => x.id === o.wall)!; const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]); const m = (o.s0 + o.s1) / 2 / L; return `${o.kind[0]}@${Math.round(w.a[0] + (w.b[0] - w.a[0]) * m - g.box.x0 + 30)},${Math.round(w.a[1] + (w.b[1] - w.a[1]) * m - g.box.y0 + 30)} w${Math.round(o.s1 - o.s0)} ${o.why.join("+")} ${o.conf.toFixed(2)}` }) : undefined,
  }
}

/* ---------------------------------------------------------------- truth from the DWG recogniser */

function load(latin1: string): CadDocument {
  const bytes = new Uint8Array(latin1.length)
  for (let i = 0; i < latin1.length; i++) bytes[i] = latin1.charCodeAt(i)
  const r = importDxf(decodeDxf(bytes).text)
  return { id: 'u', name: 'u.dxf', entities: r.entities, layers: [], currentLayer: '0', underlay: null, blocks: [], dirty: false, createdAt: 0, savedAt: null, source: 'dxf-import' }
}

/** Tầng 1 of the VILLA_150 master drawing as the DWG recogniser reads it: the truth the picture is measured against. */
export function truth(latin1?: string) {
  const doc = load(latin1 ?? '')
  const roles = Object.fromEntries(layerStats(doc).map((s) => [s.name, s.role])) as Record<string, LayerRole>
  const plans = findPlans(doc, roles).filter((p) => p.kind === 'plan')
  const p = plans.find((x) => /T[ẦA]NG 1\b/i.test(x.title ?? '')) ?? plans[0]
  const r = recognize(doc, roles, p)
  return {
    title: p.title, level: p.levelName,
    walls: r.walls.length, curtain: r.walls.filter((w) => w.curtain).length,
    wallLenM: +(r.walls.reduce((a, w) => a + (w.s1 - w.s0), 0) / 1000).toFixed(2),
    wallLenNoCurtainM: +(r.walls.filter((w) => !w.curtain).reduce((a, w) => a + (w.s1 - w.s0), 0) / 1000).toFixed(2),
    thick: [...new Set(r.walls.map((w) => w.t))].sort((a, b) => a - b),
    doors: r.openings.filter((o) => o.kind === 'door').length, windows: r.openings.filter((o) => o.kind === 'window').length, openings: r.openings.filter((o) => o.kind === 'opening').length,
    columns: r.columns.length,
    rooms: r.rooms.map((x) => ({ name: x.name, number: x.number, area: x.area, at: interiorPoint(x.outline).map((v) => Math.round(v)), outline: x.outline.map(([a, b]) => [Math.round(a), Math.round(b)]) })),
    box: p.box,
    wallBox: (() => { const pts = r.walls.flatMap((w) => { const l = wallLine(w); return [l.a, l.b] }); return { x0: Math.min(...pts.map((q) => q[0])), y0: Math.min(...pts.map((q) => q[1])), x1: Math.max(...pts.map((q) => q[0])), y1: Math.max(...pts.map((q) => q[1])) } })(),
  }
}

/** Text line boxes of a picture (QA of the letter finder): overlay PNG to PI_OUT. */
export function textdebug(latin1?: string) {
  const { w, h, rgba } = readPnm(latin1 ?? '')
  const { ink, gray } = inkOf(rgba, w, h)
  const pxPerM = Number(proc.env.PI_PXM ?? 1000 / ((25.4 / 150) * 100))
  const dbg: Record<string, unknown> = {}
  const g = recognizePlan({ ink, words: [] }, { pxPerM, debug: dbg })
  const text = textInkOf(ink, open(ink, Number(dbg.k)), Math.max(2 * Math.round(0.75 * pxPerM), Math.round(1.4 * pxPerM)))
  const { lines } = textLineBoxes(text, Math.max(4, Math.round(0.07 * pxPerM)), Math.max(12, Math.round(0.75 * pxPerM)))
  const out = proc.env.PI_OUT
  if (out) {
    const x0 = Math.max(0, Math.floor(g.box.x0 - 30)), y0 = Math.max(0, Math.floor(g.box.y0 - 30)), x1 = Math.min(w, Math.ceil(g.box.x1 + 30)), y1 = Math.min(h, Math.ceil(g.box.y1 + 30))
    const W = x1 - x0, H = y1 - y0, rgb = new Uint8Array(W * H * 3)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y + y0) * w + x + x0; const v = text.d[i] ? 0 : 150 + gray.d[i] * 105 / 255; rgb.set([v, v, v], (y * W + x) * 3) }
    for (const L of lines) for (let x = L.x0; x < L.x1; x++) for (const y of [L.y0, L.y1 - 1]) { const xx = x - x0, yy = y - y0; if (xx >= 0 && yy >= 0 && xx < W && yy < H) rgb.set([255, 0, 0], (yy * W + xx) * 3) }
    for (const L of lines) for (let y = L.y0; y < L.y1; y++) for (const x of [L.x0, L.x1 - 1]) { const xx = x - x0, yy = y - y0; if (xx >= 0 && yy >= 0 && xx < W && yy < H) rgb.set([255, 0, 0], (yy * W + xx) * 3) }
    fs().writeFileSync(out, pngOf(W, H, rgb))
  }
  return { lines: lines.length, h: lines.map((l) => l.h) }
}

/* ---------------------------------------------------------------- unit tests of the geometry steps */

/** A synthetic plan drawn into a mask (picture px, y down): 50 px per metre, outer walls 200 mm (10 px) filled,
 *  one interior wall 100 mm with a door (quarter arc + leaf, 1 px lines), a window (two thin lines) in the outer
 *  wall, two rooms. Truth in mm. */
function synthPlan() {
  const P = 50 // px per metre
  const W = 700, H = 560
  const m: Mask = mask(W, H)
  const x0 = 100, y0 = 80, x1 = 100 + 10 * P, y1 = 80 + 8 * P // centre lines: 10 m × 8 m
  const band = (ax: number, ay: number, bx: number, by: number, t: number) => fillRect(m, Math.min(ax, bx) - t / 2, Math.min(ay, by) - t / 2, Math.max(ax, bx) + t / 2, Math.max(ay, by) + t / 2)
  const line = (ax: number, ay: number, bx: number, by: number) => { const n = Math.ceil(Math.hypot(bx - ax, by - ay) * 2); for (let k = 0; k <= n; k++) { const x = Math.round(ax + ((bx - ax) * k) / n), y = Math.round(ay + ((by - ay) * k) / n); if (x >= 0 && y >= 0 && x < W && y < H) m.d[y * W + x] = 1 } }
  // outer walls, the top one with a window gap 2 m wide (x 250…350)
  band(x0, y0, 250, y0, 10); band(350, y0, x1, y0, 10)
  band(x0, y1, x1, y1, 10); band(x0, y0, x0, y1, 10); band(x1, y0, x1, y1, 10)
  line(250, y0 - 3, 350, y0 - 3); line(250, y0 + 3, 350, y0 + 3)
  // interior wall x = 350 (100 mm = 5 px… drawn 6 px), door gap y 280…325 (0.9 m) hinged at y 325, swinging right
  band(350, y0, 350, 280, 6); band(350, 325, 350, y1, 6)
  const r = 45
  line(350, 325, 350 + r, 325)
  for (let k = 0; k <= 90; k++) { const a = (k * Math.PI) / 180; const x = Math.round(350 + r * Math.cos(a)), y = Math.round(325 - r * Math.sin(a)); m.d[y * W + x] = 1 }
  const words: PWord[] = [
    { text: 'P.', conf: 90, x0: 180, y0: 270, x1: 195, y1: 285, line: 1 }, { text: 'KHÁCH', conf: 90, x0: 200, y0: 270, x1: 260, y1: 285, line: 1 },
    { text: 'BẾP', conf: 88, x0: 440, y0: 270, x1: 480, y1: 285, line: 2 },
  ]
  // inner faces: left room x 105…347, y 85…475 → 242 × 390 px; right room x 353…595
  const truth = { walls: 5, lenM: (2 * 10 + 2 * 8 + 8), rooms: { 'P. KHÁCH': (242 * 390) / (P * P), 'BẾP': (242 * 390) / (P * P) } }
  return { m, words, P, truth }
}

export function run() {
  const out: string[] = []
  let fails = 0
  const check = (name: string, ok: boolean, extra = '') => { if (!ok) fails++; out.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`) }
  const near = (a: number, b: number, rel: number) => Math.abs(a - b) <= rel * Math.abs(b)

  /* raster: exact morphology, run lengths, background */
  {
    const m = mask(60, 40)
    fillRect(m, 5, 5, 55, 7) // a 2 px line
    fillRect(m, 5, 20, 55, 28) // an 8 px band
    const o = open(m, 5)
    let line = 0, bandN = 0
    for (let y = 0; y < 40; y++) for (let x = 0; x < 60; x++) { if (o.d[y * 60 + x] && y < 10) line++; if (o.d[y * 60 + x] && y >= 20) bandN++ }
    check('opening by 5 px: a 2 px line vanishes, an 8 px band stays exactly', line === 0 && bandN === 50 * 8, `${line} / ${bandN}`)
    const { hr, vr } = runLengths(m)
    check('run lengths across / along a band', hr[22 * 60 + 30] === 50 && vr[22 * 60 + 30] === 8)
    const g: Gray = { w: 200, h: 50, d: new Uint8Array(200 * 50) }
    for (let y = 0; y < 50; y++) for (let x = 0; x < 200; x++) g.d[y * 200 + x] = 120 + x / 2 // a shadow gradient
    const n = normalizeBackground(g, 8)
    const left = n.d[25 * 200 + 20], right = n.d[25 * 200 + 180]
    check('background normalisation evens out a shadow gradient (paper → white on both sides)', left > 235 && right > 235, `${left} ${right}`)
  }

  /* perspective: homography, sheet, aspect, deskew */
  {
    const src: Pt[] = [[10, 20], [300, 5], [320, 260], [0, 240]], dst: Pt[] = [[0, 0], [400, 0], [400, 280], [0, 280]]
    const H = homography(src, dst)
    const err = Math.max(...src.map((p, i) => Math.hypot(applyH(H, p)[0] - dst[i][0], applyH(H, p)[1] - dst[i][1])))
    const Hi = invertH(H), back = applyH(Hi, [200, 140]), fwd = applyH(H, back)
    check('homography from 4 corners maps them exactly; its inverse round-trips', err < 1e-6 && Math.hypot(fwd[0] - 200, fwd[1] - 140) < 1e-6, `${err}`)
    check('A-series aspect recognised from the corners (1 : √2 within 10 %)', paperAspect([[0, 0], [1414, 0], [1414, 1000], [0, 1000]]) === 1 / Math.SQRT2)
    // a white sheet (quad) on a dark table
    const w = 400, h = 300, rgba = new Uint8ClampedArray(w * h * 4)
    const quad: Pt[] = [[60, 40], [350, 30], [370, 270], [40, 260]]
    const inside = (x: number, y: number) => pointIn([x, y], quad)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = inside(x + 0.5, y + 0.5) ? 245 : 70; rgba.set([v, v, v, 255], (y * w + x) * 4) }
    const c = detectSheet(rgba, w, h)
    check('the sheet’s four corners are found in a photo (within 6 px)', !!c && c.every((p, i) => Math.hypot(p[0] - quad[i][0], p[1] - quad[i][1]) < 6), JSON.stringify(c))
    const white = new Uint8ClampedArray(w * h * 4).fill(255)
    check('a scan (paper fills the picture): no corners, no correction', detectSheet(white, w, h) === null)
    // deskew: horizontal / vertical lines turned by 2.5°
    const m = mask(400, 400)
    const a = (2.5 * Math.PI) / 180
    for (let k = 0; k < 6; k++) for (let s = -150; s <= 150; s++) {
      for (const [x, y] of [[s, -150 + k * 60], [-150 + k * 60, s]]) { const X = Math.round(200 + x * Math.cos(a) - y * Math.sin(a)), Y = Math.round(200 + x * Math.sin(a) + y * Math.cos(a)); m.d[Y * 400 + X] = 1 }
    }
    const sk = skewAngle(m)
    check('skew of a drawing turned 2.5° is measured (±0.2°)', Math.abs(Math.abs(sk) - 2.5) <= 0.2, `${sk}`)
    const rgbaM = new Uint8ClampedArray(400 * 400 * 4)
    for (let i = 0; i < m.d.length; i++) { const v = m.d[i] ? 0 : 255; rgbaM.set([v, v, v, 255], i * 4) }
    const turned = warpRGBA(rgbaM, 400, 400, rotationH(-sk, 400, 400), 400, 400)
    const m2 = mask(400, 400)
    for (let i = 0; i < m2.d.length; i++) m2.d[i] = turned[i * 4] < 128 ? 1 : 0
    check('turned back by the measured skew it is square (±0.15°)', Math.abs(skewAngle(m2)) <= 0.15, `${skewAngle(m2)}`)
  }

  /* recognition of a synthetic plan */
  const { m, words, P, truth } = synthPlan()
  const g = recognizePlan({ ink: m, words }, { pxPerM: P })
  {
    const len = g.walls.reduce((a, w) => a + Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), 0) / P
    check('walls: the five walls found, centre lines within 3 % of the true length', g.walls.length === truth.walls && near(len, truth.lenM, 0.03), `${g.walls.length} walls, ${len.toFixed(2)} m vs ${truth.lenM}`)
    const doors = g.openings.filter((o) => o.kind === 'door'), wins = g.openings.filter((o) => o.kind === 'window')
    check('door: a swing arc with its leaf at the gap → one door 0.78 m wide (the gap between the wall ends)', doors.length === 1 && near((doors[0].s1 - doors[0].s0) / P, 0.78, 0.08), JSON.stringify(doors.map((d) => [d.s1 - d.s0, d.why])))
    check('window: two thin lines across the gap → one window 1.8 m wide (between the wall ends)', wins.length === 1 && near((wins[0].s1 - wins[0].s0) / P, 1.8, 0.06), JSON.stringify(wins.map((d) => [d.s1 - d.s0, d.why])))
    const byName = Object.fromEntries(g.rooms.map((r) => [r.name, r.areaPx / (P * P)]))
    check('rooms: two, named from the words inside them, areas within 3 % (inner faces)', g.rooms.length === 2 && near(byName['P. KHÁCH'], truth.rooms['P. KHÁCH'], 0.03) && near(byName['BẾP'], truth.rooms['BẾP'], 0.03), JSON.stringify(byName))
    check('outer walls flagged, the interior one not', g.walls.filter((w) => w.ext).length === 4)
    check('every element has a confidence 0…1', [...g.walls, ...g.openings, ...g.rooms].every((x) => x.conf > 0 && x.conf <= 1))
  }

  /* the same intermediate as the DWG recogniser; the downstream builders unchanged */
  {
    const k = 1000 / P // 20 mm / px
    const rec = toRecognition({ graph: g, k, levelName: 'Tầng 1' })
    check('Recognition: walls in mm, y up, thickness snapped (200 outer / 100 inner)', rec.walls.length === 5 && rec.walls.filter((w) => w.t === 200).length === 4 && rec.walls.some((w) => w.t === 100 || w.t === 110), JSON.stringify(rec.walls.map((w) => w.t)))
    check('openings lie inside their host wall’s extent', rec.openings.every((o) => o.s0 >= rec.walls[o.wall].s0 - 1 && o.s1 <= rec.walls[o.wall].s1 + 1))
    check('rooms in m² from the calibrated scale', rec.rooms.every((r) => r.area > 30 && r.area < 45), JSON.stringify(rec.rooms.map((r) => r.area)))
    const names: BuildNames = { roofLevel: 'Roof', room: (n) => `Room ${n}`, wallExt: (t) => `Ext ${t}`, wallInt: (t) => `Int ${t}`, curtain: (t) => `CW ${t}`, door: 'Door', doubleDoor: 'Double door', opening: 'Opening', window: 'Window', furniture: fromCadEn.furniture }
    const res = autoFromPlan(rec, { names, levelName: 'Tầng 1', file: 'synth.png' })
    const c = res.house!.built.counts
    check('BIM model built by the DWG path’s builder: walls, door, window, rooms, roof level', c.walls === 5 && c.doors === 1 && c.windows === 1 && c.rooms === 2 && c.levels === 2, JSON.stringify(c))
    check('model checks pass', res.house!.checks.every((x) => x.status !== 'error'), res.house!.checks.map((x) => `${x.key}:${x.status}`).join(' '))
    const it = res.house!.interior!
    check('Interior: both rooms; the living room and the kitchen furnished by the room-type rules (catalog items, cabinets)', it.rooms.length === 2 && it.items.length > 0 && it.cabinets.length > 0 && res.furnished.length >= 1, `${it.items.length} items, ${it.cabinets.length} cabinets, ${res.furnished.join(', ')}`)
    check('interior validates (the Interior workspace would accept it)', validateInterior({ rooms: it.rooms, items: it.items, cabinets: it.cabinets, notes: [] }) === null)
    // provenance: uncalibrated → REVIEW REQUIRED and no fabrication; calibrated → allowed
    const nominal = { dpi: 150, scale: 100, mmPerPx: 16.933 }
    const un = planRecord({ graph: g, file: 'synth.png', page: null, kind: 'image', nominal, refs: [], picture: null })
    check('CAD record uncalibrated: REVIEW REQUIRED, fabrication blocked', un.provenance!.reviewRequired && !fabricationAllowed(un).ok)
    const ref: CalRef = { id: 'r1', method: 'two-point', a: { x: 100, y: 80 }, b: { x: 600, y: 80 }, measured: 500, refDistance: 10000 }
    const cal = planRecord({ graph: g, file: 'synth.png', page: null, kind: 'image', nominal, refs: [ref], picture: null })
    const xs = cal.entities.filter((e) => e.layer === 'IMG-WALL' && e.kind === 'polyline').flatMap((e) => (e.kind === 'polyline' ? e.pts.map((p) => p.x) : []))
    check('CAD record calibrated (10 000 mm over 500 px): true size, fabrication allowed', fabricationAllowed(cal).ok && near(Math.max(...xs) - Math.min(...xs), 10200, 0.02), `${Math.max(...xs) - Math.min(...xs)}`)
  }

  /* scale suggestions, OCR clean-up */
  {
    const g2: PlanGraph = { ...g, rooms: g.rooms.map((r) => ({ ...r, areaLabel: +((r.areaPx * 400) / 1e6).toFixed(2) })) }
    const s = suggestScale(g2)
    check('written room areas suggest the scale (two agree → 20 mm/px ±1 %)', s.k !== null && near(s.k, 20, 0.01), `${s.k}`)
    // a dimension line cut by a tick is not joined across it; a broken line without a tick is
    const segs: PlanGraph['segs'] = [{ a: [0, 10], b: [50, 10] }, { a: [50, 10], b: [100, 10] }, { a: [50, 4], b: [50, 16] }, { a: [130, 10], b: [180, 10] }, { a: [200, 10.5], b: [260, 10.5] }]
    const mg = mergeCollinear(segs).filter((x) => Math.abs(x.a[1] - x.b[1]) < 1).map((x) => [Math.round(x.a[0]), Math.round(x.b[0])])
    check('collinear pieces: joined over a gap, never across a tick', JSON.stringify(mg) === JSON.stringify([[0, 50], [50, 260]]), JSON.stringify(mg))
    check('room words put back to their dictionary form ("BÊP" → BẾP, "TÀNG" → TẦNG, "KHÁC" → KHÁCH, "P." stays)', lexiconWord('BÊP') === 'BẾP' && lexiconWord('TÀNG') === 'TẦNG' && lexiconWord('KHÁC') === 'KHÁCH' && lexiconWord('P.') === 'P.' && lexiconWord('XYZQ') === null)
    const lab = roomLabel(textLines([{ text: 'R113', conf: 90, x0: 0, y0: 0, x1: 20, y1: 8, line: 0 }, { text: 'GIẶT', conf: 80, x0: 0, y0: 12, x1: 40, y1: 26, line: 1 }, { text: '6.72', conf: 85, x0: 0, y0: 30, x1: 25, y1: 38, line: 2 }, { text: 'm²', conf: 60, x0: 27, y0: 30, x1: 37, y1: 38, line: 2 }]))
    check('room label: name, number and written area read apart', lab.name === 'GIẶT' && lab.number === 'R113' && lab.area === 6.72, JSON.stringify(lab))
    check('a stair marked only by its direction is the stair', roomLabel(textLines([{ text: 'LÊN', conf: 90, x0: 0, y0: 0, x1: 30, y1: 14, line: 0 }])).name === 'THANG BỘ')
  }

  /* fixes */
  {
    const w0 = g.walls.length
    const g1 = addWall(g, [110, 300], [345, 303])
    const nw = g1.walls[g1.walls.length - 1]
    check('add wall: squared (horizontal) and snapped to the walls it meets', g1.walls.length === w0 + 1 && nw.a[1] === nw.b[1] && Math.abs(nw.a[0] - 100) < 1 && Math.abs(nw.b[0] - 350) < 1, JSON.stringify([nw.a, nw.b]))
    check('…and the room it crosses is split in two', g1.rooms.length === 3)
    const win = g.openings.find((o) => o.kind === 'window')!
    const g2 = remove(g, { type: 'wall', id: win.wall })
    check('delete a wall: its openings go with it', !g2.openings.some((o) => o.wall === win.wall) && g2.walls.length === w0 - 1)
    const g3 = setOpening(g, win.id, { kind: 'door', width: 40 })
    const o3 = g3.openings.find((o) => o.id === win.id)!
    check('opening: type and width changed about its centre, confirmed by the user', o3.kind === 'door' && Math.abs(o3.s1 - o3.s0 - 40) < 1e-6 && o3.conf === 1)
    const room = g.rooms.find((r) => r.name === 'BẾP')!
    const g4 = addWall(renameRoom(g, room.id, "BẾP CHÍNH"), [355, 200], [595, 200])
    check('a typed room name is kept when the walls change', g4.rooms.some((r) => r.name === 'BẾP CHÍNH'))
  }

  out.push(fails ? `FAILED ${fails}` : 'ALL PASS')
  return { all: fails === 0, lines: out }
}

/** The synthetic plan of `run` with its recognition (QA). */
export function synthdebug() {
  const { m, words, P } = synthPlan()
  const dbg: Record<string, unknown> = {}
  const g = recognizePlan({ ink: m, words }, { pxPerM: P, debug: dbg })
  const out = proc.env.PI_OUT
  if (out) { const grey = m.d.map((v) => (v ? 0 : 255)); const o = overlay(g, grey, 20); fs().writeFileSync(out, pngOf(o.w, o.h, o.rgb)) }
  return { dbg, walls: g.walls.map((w) => [w.a, w.b, w.t, w.by]), ops: g.openings.map((o) => [o.kind, o.s0, o.s1, o.wall]), notes: g.notes }
}
