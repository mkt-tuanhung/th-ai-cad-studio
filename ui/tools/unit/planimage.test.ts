// Plan image → BIM (v2.4 "Ảnh mặt bằng → nội thất 3D"): unit tests of the geometry steps, the ground truth of the
// VILLA_150 Tầng 1 plan from its DWG/DXF, and a debug run on a PGM/PPM picture.
//   UNIT=planimage node tools/test-cam.mjs run                     geometry steps (asserting, { all })
//   UNIT=planimage node tools/test-cam.mjs truth <MASTER.dxf>      Tầng 1 truth from the DWG recogniser (JSON)
//   PI_OUT=/tmp/x.png UNIT=planimage node tools/test-cam.mjs debug <page.pgm|ppm>   recognition + overlay PNG
import { decodeDxf, importDxf } from '../../src/cad/dxfImport'
import type { CadDocument } from '../../src/cad/types'
import { findPlans, interiorPoint, layerStats, recognize, wallLine, type LayerRole } from '../../src/bim/fromCad'
import { inkOf } from '../../src/planimage/preprocess'
import { detectSheet } from '../../src/planimage/perspective'
import { textInkOf, textLineBoxes } from '../../src/planimage/textlines'
import { open } from '../../src/planimage/raster'
import { recognizePlan, type PlanGraph } from '../../src/planimage/recognize'

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
