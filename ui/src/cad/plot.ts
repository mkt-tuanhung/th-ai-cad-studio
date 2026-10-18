/**
 * Plotting: the drawing is laid out on a paper sheet at a standard scale (1:N that fits), with a frame and
 * a title block, as vector primitives in paper millimetres (origin top-left, y down). The same page feeds
 * the SVG / PNG export (browser) and the PDF export (desktop: Qt QPdfWriter, system fonts — Vietnamese safe).
 */
import type { CadDocument, Entity, Layer, PaperSize, Vec2 } from './types'
import { dimensionGeometry, formatLength, measured } from './geometry'

/** The plot date in the user's own time zone (an ISO string is UTC: the day before, in Vietnam, until 07:00). */
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export type Paper = PaperSize
/** ISO 216 sheet sizes in mm [width, height]: landscape, plus A1 / A0 portrait ("P"). */
export const PAPERS: Record<Paper, [number, number]> = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841], A1P: [594, 841], A0P: [841, 1189] }
/** Display name of a sheet size ("A0 portrait"). */
export const paperLabel = (p: Paper, portrait = 'portrait') => (p.endsWith('P') ? `${p.slice(0, -1)} ${portrait}` : p)

/** Plot options: `ruler` adds a check ruler (100 mm on paper + a model length at the plot scale) above the title block. */
export interface PlotOptions { ruler?: boolean }
/** Height (paper mm) the ruler strip takes from the drawing area. */
export const RULER_H = 9
/** Paper length (mm) of the paper ruler, and of the model reference bar at 1:scale (1 m, or 10 m when 1 m < 10 mm). */
export const RULER_MM = 100
export const modelRuler = (scale: number) => { const m = 1000 / scale >= 10 ? 1 : 1000 / scale >= 1 ? 10 : 100; return { metres: m, paperMm: (m * 1000) / scale } }
const SCALES = [1, 2, 5, 10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 500, 1000, 2000, 5000]

export type Prim =
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; w: number; color: string; dash?: number[] }
  | { t: 'poly'; pts: [number, number][]; closed: boolean; fill?: boolean; w: number; color: string; dash?: number[] }
  | { t: 'circle'; cx: number; cy: number; r: number; w: number; color: string; dash?: number[] }
  | { t: 'arc'; cx: number; cy: number; r: number; a0: number; a1: number; w: number; color: string; dash?: number[] } // degrees, CCW in world (paper y down → drawn mirrored)
  | { t: 'text'; x: number; y: number; h: number; rot: number; value: string; anchor: 'start' | 'middle'; color: string; bold?: boolean }

export interface Page {
  name: string
  w: number
  h: number
  scale: number // 1:scale
  prims: Prim[]
}

function extents(doc: CadDocument) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const grow = (p: Vec2, r = 0) => {
    x0 = Math.min(x0, p.x - r), y0 = Math.min(y0, p.y - r), x1 = Math.max(x1, p.x + r), y1 = Math.max(y1, p.y + r)
  }
  for (const e of doc.entities) {
    if (e.kind === 'line') (grow(e.a), grow(e.b))
    else if (e.kind === 'polyline') e.pts.forEach((p) => grow(p))
    else if (e.kind === 'circle' || e.kind === 'arc') grow(e.c, e.r)
    else if (e.kind === 'text') {
      // the text's box: its width from the insertion point (or both ways when centred), its height above the
      // baseline; turned text by the radius it can reach
      const w = e.height * [...e.value].length * 0.6
      if (Math.abs(e.rotation ?? 0) > 1e-6) grow(e.p, w)
      else if (e.align === 'center') (grow({ x: e.p.x - w / 2, y: e.p.y }), grow({ x: e.p.x + w / 2, y: e.p.y + e.height }))
      else (grow(e.p), grow({ x: e.p.x + w, y: e.p.y + e.height }))
    }
    else if (e.kind === 'dimension') {
      const g = dimensionGeometry(e.a, e.b, e.offset)
      ;[e.a, e.b, g.da, g.db].forEach((p) => grow(p, e.textHeight))
    }
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: 1000, y1: 1000 }
}

const DASH: Record<string, number[] | undefined> = { Dashed: [3, 1.5], DashDot: [5, 1, 0.6, 1] }

/**
 * Sheet geometry shared by the plot and the DXF / DWG paper space (paper mm, origin bottom-left, y up):
 * the viewport onto model space (centre, size, the model point at its centre and the model height it
 * shows = scale) plus the frame and title block, so a layout written to a DXF matches the PDF.
 */
export function sheetLayout(doc: CadDocument, paper: Paper = 'A3', fixedScale?: number, opts: PlotOptions = {}) {
  const [W, H] = PAPERS[paper]
  const margin = 10, titleH = 18
  const ext = extents(doc)
  const dw = ext.x1 - ext.x0, dh = ext.y1 - ext.y0
  const aw = W - 2 * margin, ah = H - 2 * margin - titleH - (opts.ruler ? RULER_H : 0)
  const scale = fixedScale ?? SCALES.find((s) => dw / s <= aw && dh / s <= ah) ?? Math.ceil(Math.max(dw / aw, dh / ah))
  const m = margin / 2, top = m + titleH
  return {
    W, H, scale,
    viewport: { cx: margin + aw / 2, cy: H - (margin + ah / 2), w: aw, h: ah },
    ruler: opts.ruler ? rulerPrims(H, scale).map((q) => (q.t === 'line' ? { x1: q.x1, y1: H - q.y1, x2: q.x2, y2: H - q.y2 } : null)).filter((q) => q !== null) : [],
    view: { cx: (ext.x0 + ext.x1) / 2, cy: (ext.y0 + ext.y1) / 2, height: ah * scale },
    lines: [
      [m, m, W - m, m], [W - m, m, W - m, H - m], [W - m, H - m, m, H - m], [m, H - m, m, m],
      [m, top, W - m, top], [W - 150, m, W - 150, top],
    ] as [number, number, number, number][],
    texts: [
      { x: margin, y: top - 11, h: 4, value: doc.name },
      { x: W - 145, y: top - 7.5, h: 2.6, value: `Scale 1:${scale} · ${paper} · mm` },
      { x: W - 145, y: top - 13.5, h: 2.6, value: `MD CAD AI STUDIO · ${today()}` },
    ],
  }
}

export function plotPage(doc: CadDocument, paper: Paper = 'A3', fixedScale?: number, opts: PlotOptions = {}): Page {
  const [W, H] = PAPERS[paper]
  const margin = 10, titleH = 18
  const ext = extents(doc)
  const dw = ext.x1 - ext.x0, dh = ext.y1 - ext.y0
  const aw = W - 2 * margin, ah = H - 2 * margin - titleH - (opts.ruler ? RULER_H : 0)
  const scale = fixedScale ?? SCALES.find((s) => dw / s <= aw && dh / s <= ah) ?? Math.ceil(Math.max(dw / aw, dh / ah))
  const ox = margin + (aw - dw / scale) / 2, oy = margin + (ah - dh / scale) / 2
  const X = (x: number) => ox + (x - ext.x0) / scale
  const Y = (y: number) => oy + (ext.y1 - y) / scale
  const layerOf = (e: Entity): Layer | undefined => doc.layers.find((l) => l.name === e.layer)
  const prims: Prim[] = []
  for (const e of doc.entities) {
    const l = layerOf(e)
    if (l && !l.visible) continue
    if (e.noPlot) continue // on screen only (Properties → Plot off)
    const color = e.color === 'ByLayer' ? (l?.color ?? '#111827') : e.color
    const w = Math.max(0.13, Number(e.lineweight === 'ByLayer' ? (l?.lineweight ?? 0.25) : e.lineweight) || 0.25)
    const dash = DASH[e.linetype === 'ByLayer' ? (l?.linetype ?? 'Continuous') : e.linetype]
    switch (e.kind) {
      case 'line':
        prims.push({ t: 'line', x1: X(e.a.x), y1: Y(e.a.y), x2: X(e.b.x), y2: Y(e.b.y), w, color, dash })
        break
      case 'polyline':
        prims.push({ t: 'poly', pts: e.pts.map((p) => [X(p.x), Y(p.y)]), closed: e.closed, fill: e.filled, w, color, dash })
        break
      case 'circle':
        prims.push({ t: 'circle', cx: X(e.c.x), cy: Y(e.c.y), r: e.r / scale, w, color, dash })
        break
      case 'arc':
        prims.push({ t: 'arc', cx: X(e.c.x), cy: Y(e.c.y), r: e.r / scale, a0: (e.start * 180) / Math.PI, a1: (e.end * 180) / Math.PI, w, color, dash })
        break
      case 'text':
        prims.push({ t: 'text', x: X(e.p.x), y: Y(e.p.y), h: e.height / scale, rot: (e.rotation * 180) / Math.PI, value: e.value, anchor: e.align === 'center' ? 'middle' : 'start', color })
        break
      case 'dimension': {
        const g = dimensionGeometry(e.a, e.b, e.offset)
        const L = (a: Vec2, b: Vec2) => prims.push({ t: 'line', x1: X(a.x), y1: Y(a.y), x2: X(b.x), y2: Y(b.y), w: 0.18, color })
        L(e.a, g.da)
        L(e.b, g.db)
        L(g.da, g.db)
        const tk = e.textHeight * 0.5
        const d = { x: Math.cos(g.angle + Math.PI / 4) * tk, y: Math.sin(g.angle + Math.PI / 4) * tk }
        for (const p of [g.da, g.db]) L({ x: p.x - d.x, y: p.y - d.y }, { x: p.x + d.x, y: p.y + d.y })
        const up = { x: -Math.sin(g.angle), y: Math.cos(g.angle) }
        const tp = { x: g.textAt.x + up.x * e.textHeight * 0.6, y: g.textAt.y + up.y * e.textHeight * 0.6 }
        prims.push({ t: 'text', x: X(tp.x), y: Y(tp.y), h: e.textHeight / scale, rot: (((e.textAngle ?? g.angle) * 180) / Math.PI), value: e.override ?? formatLength(measured(e.a, e.b)), anchor: 'middle', color })
        break
      }
    }
  }
  // frame + title block
  const k = '#111827'
  prims.push({ t: 'poly', pts: [[margin / 2, margin / 2], [W - margin / 2, margin / 2], [W - margin / 2, H - margin / 2], [margin / 2, H - margin / 2]], closed: true, w: 0.5, color: k })
  const ty = H - margin / 2 - titleH
  prims.push({ t: 'line', x1: margin / 2, y1: ty, x2: W - margin / 2, y2: ty, w: 0.35, color: k })
  prims.push({ t: 'line', x1: W - 150, y1: ty, x2: W - 150, y2: H - margin / 2, w: 0.25, color: k })
  prims.push({ t: 'text', x: margin, y: ty + 11, h: 4, rot: 0, value: doc.name, anchor: 'start', color: k, bold: true })
  prims.push({ t: 'text', x: W - 145, y: ty + 7.5, h: 2.6, rot: 0, value: `Scale 1:${scale} · ${paper} · mm`, anchor: 'start', color: k })
  prims.push({ t: 'text', x: W - 145, y: ty + 13.5, h: 2.6, rot: 0, value: `MD CAD AI STUDIO · ${today()}`, anchor: 'start', color: k })
  if (opts.ruler) prims.push(...rulerPrims(H, scale))
  return { name: doc.name, w: W, h: H, scale, prims }
}

/**
 * The check ruler (V24-035: measure the printed sheet at 100 %): a 100 mm paper ruler with 10 mm ticks and a model
 * bar of 1 m (10 m / 100 m at small scales) = 1000·m / scale paper mm, in the strip just above the title block.
 * Its first primitive is the 100 mm base line — tools/check-pdf-ruler.py looks for exactly that segment.
 */
export function rulerPrims(H: number, scale: number): Prim[] {
  const margin = 10, titleH = 18, k = '#111827'
  const y = H - margin / 2 - titleH - 3 // 3 mm above the title block line
  const x0 = margin
  const out: Prim[] = [{ t: 'line', x1: x0, y1: y, x2: x0 + RULER_MM, y2: y, w: 0.25, color: k }]
  for (let i = 0; i <= 10; i++) out.push({ t: 'line', x1: x0 + i * 10, y1: y, x2: x0 + i * 10, y2: y - (i % 5 === 0 ? 3 : 1.5), w: 0.18, color: k })
  out.push({ t: 'text', x: x0 + RULER_MM + 2, y: y - 0.3, h: 2, rot: 0, value: `${RULER_MM} mm (paper)`, anchor: 'start', color: k })
  const mr = modelRuler(scale)
  const mx = x0 + RULER_MM + 32
  out.push({ t: 'line', x1: mx, y1: y, x2: mx + mr.paperMm, y2: y, w: 0.25, color: k })
  out.push({ t: 'line', x1: mx, y1: y, x2: mx, y2: y - 3, w: 0.18, color: k }, { t: 'line', x1: mx + mr.paperMm, y1: y, x2: mx + mr.paperMm, y2: y - 3, w: 0.18, color: k })
  out.push({ t: 'text', x: mx + mr.paperMm + 2, y: y - 0.3, h: 2, rot: 0, value: `${mr.metres} m (model, 1:${scale})`, anchor: 'start', color: k })
  return out
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** SVG (mm units) of a page — also the source of the PNG export. */
export function pageSvg(p: Page): string {
  const o: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${p.w}mm" height="${p.h}mm" viewBox="0 0 ${p.w} ${p.h}">`, `<rect width="${p.w}" height="${p.h}" fill="#fff"/>`]
  const st = (q: { w: number; color: string; dash?: number[] }) => `stroke="${q.color}" stroke-width="${q.w}" fill="none"${q.dash ? ` stroke-dasharray="${q.dash.join(' ')}"` : ''} stroke-linecap="round" stroke-linejoin="round"`
  for (const q of p.prims) {
    if (q.t === 'line') o.push(`<line x1="${q.x1.toFixed(3)}" y1="${q.y1.toFixed(3)}" x2="${q.x2.toFixed(3)}" y2="${q.y2.toFixed(3)}" ${st(q)}/>`)
    else if (q.t === 'poly') o.push(`<${q.closed ? 'polygon' : 'polyline'} points="${q.pts.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join(' ')}" ${st(q).replace('fill="none"', q.fill ? `fill="${q.color}"` : 'fill="none"')}/>`)
    else if (q.t === 'circle') o.push(`<circle cx="${q.cx.toFixed(3)}" cy="${q.cy.toFixed(3)}" r="${q.r.toFixed(3)}" ${st(q)}/>`)
    else if (q.t === 'arc') {
      // world angles are CCW with y up; on paper (y down) the arc runs clockwise
      const a0 = (q.a0 * Math.PI) / 180, a1 = (q.a1 * Math.PI) / 180
      let sweep = a1 - a0
      while (sweep <= 0) sweep += 2 * Math.PI
      const sx = q.cx + q.r * Math.cos(a0), sy = q.cy - q.r * Math.sin(a0), ex = q.cx + q.r * Math.cos(a1), ey = q.cy - q.r * Math.sin(a1)
      o.push(`<path d="M${sx.toFixed(3)},${sy.toFixed(3)} A${q.r.toFixed(3)},${q.r.toFixed(3)} 0 ${sweep > Math.PI ? 1 : 0} 0 ${ex.toFixed(3)},${ey.toFixed(3)}" ${st(q)}/>`)
    } else o.push(`<text x="${q.x.toFixed(3)}" y="${q.y.toFixed(3)}" font-family="Roboto, Arial, sans-serif" font-size="${(q.h / 0.711).toFixed(3)}"${q.bold ? ' font-weight="700"' : ''} fill="${q.color}" text-anchor="${q.anchor}"${q.rot ? ` transform="rotate(${(-q.rot).toFixed(2)} ${q.x.toFixed(3)} ${q.y.toFixed(3)})"` : ''}>${esc(q.value)}</text>`)
  }
  o.push('</svg>')
  return o.join('\n')
}

/** PNG of a page at `dpi` (browser canvas). */
export async function pagePng(p: Page, dpi = 200): Promise<Blob> {
  const svg = pageSvg(p)
  const img = new Image()
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  await img.decode()
  const c = document.createElement('canvas')
  c.width = Math.round((p.w / 25.4) * dpi)
  c.height = Math.round((p.h / 25.4) * dpi)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG encoding failed'))), 'image/png'))
}
