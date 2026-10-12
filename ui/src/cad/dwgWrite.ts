/**
 * DWG export: the drawing is turned into a LibreDWG `dwgadd` script (run by the desktop host as a
 * separate GPL program, like the DWG reader) that builds an AutoCAD 2000 (AC1015) DWG in millimetres.
 *
 * - Layers keep their names and colours; lines, polylines (closed / open), circles, arcs and texts map 1:1.
 * - Non-ASCII text (Vietnamese) is written as \U+XXXX escapes — the way pre-2007 DWG stores Unicode;
 *   AutoCAD and our own reader decode them.
 * - Centered texts become left-aligned at an estimated start point (dwgadd cannot set the alignment
 *   point); dimensions are written exploded (lines, ticks, text) by default — DIMENSION objects without
 *   their block are optional and experimental.
 */
import type { CadDocument, Entity } from './types'
import { dimensionGeometry, formatLength, measured } from './geometry'
import { triangulate } from './edit'

const ACI: Record<string, number> = { '#111827': 7, '#1f2937': 7, '#0f766e': 4, '#2563eb': 5, '#6b7280': 8, '#9aa1ab': 9, '#3f4654': 8, '#9ca3af': 9 }
const f = (n: number) => (Math.round(n * 1e6) / 1e6).toString()
const p3 = (x: number, y: number) => `(${f(x)} ${f(y)} 0)`
const deg = (r: number) => ((r * 180) / Math.PI + 360) % 360

/** dwgadd string literal: ASCII only, Unicode as \U+XXXX, at most 255 characters. */
export function dwgString(s: string): string {
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (ch === '"') out += "'"
    else if (ch === '\\') out += '\\\\'
    else if (c < 32) out += ' '
    else if (c < 127) out += ch
    else if (c <= 0xffff) out += `\\U+${c.toString(16).toUpperCase().padStart(4, '0')}`
    else out += '?'
  }
  return `"${out.slice(0, 255)}"`
}

export interface DwgOptions {
  dimensionObjects?: boolean
}

export function toDwgAdd(doc: CadDocument, opt: DwgOptions = {}): { script: string; counts: Record<string, number> } {
  const o: string[] = [`# TH AI CAD Studio → DWG (${doc.name})`, 'version 2000', 'HEADER.INSUNITS = 4']
  const counts: Record<string, number> = {}
  const count = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n)
  for (const l of doc.layers) {
    if (l.name === '0') continue
    o.push(`layer ${dwgString(l.name)}`, `layer.color = ${ACI[l.color] ?? 7}`)
  }
  const on = (v: string, layer: string) => o.push(`${v}.layer = ${dwgString(layer)}`)
  const line = (x1: number, y1: number, x2: number, y2: number, layer: string) => {
    o.push(`line ${p3(x1, y1)} ${p3(x2, y2)}`)
    on('line', layer)
    count('LINE')
  }
  const text = (value: string, x: number, y: number, h: number, rot: number, center: boolean, layer: string) => {
    // estimated width of a centred text (dwgadd cannot set the alignment point)
    const w = center ? 0.6 * h * [...value].length : 0
    const sx = x - (Math.cos(rot) * w) / 2 + Math.sin(rot) * h * 0.5 * (center ? 1 : 0)
    const sy = y - (Math.sin(rot) * w) / 2 - Math.cos(rot) * h * 0.5 * (center ? 1 : 0)
    o.push(`text ${dwgString(value)} ${p3(sx, sy)} ${f(h)}`)
    if (rot) o.push(`text.rotation = ${f(rot)}`)
    on('text', layer)
    count('TEXT')
  }
  for (const e of doc.entities as Entity[]) {
    switch (e.kind) {
      case 'line':
        line(e.a.x, e.a.y, e.b.x, e.b.y, e.layer)
        break
      case 'polyline':
        if (e.pts.length < 2) break
        o.push(`lwpolyline ${e.pts.length} (${e.pts.map((p) => `(${f(p.x)} ${f(p.y)})`).join(' ')})`)
        if (e.closed) o.push('lwpolyline.flag = 1')
        on('lwpolyline', e.layer)
        count('LWPOLYLINE')
        // solid fill (HATCH) → SOLID triangles
        if (e.filled && e.closed)
          for (const [a, b, c] of triangulate(e.pts)) {
            o.push(`solid ${p3(a.x, a.y)} (${f(b.x)} ${f(b.y)}) (${f(c.x)} ${f(c.y)}) (${f(c.x)} ${f(c.y)})`)
            on('solid', e.layer)
            count('SOLID')
          }
        break
      case 'circle':
        o.push(`circle ${p3(e.c.x, e.c.y)} ${f(e.r)}`)
        on('circle', e.layer)
        count('CIRCLE')
        break
      case 'arc':
        o.push(`arc ${p3(e.c.x, e.c.y)} ${f(e.r)} ${f(deg(e.start))} ${f(deg(e.end))}`)
        on('arc', e.layer)
        count('ARC')
        break
      case 'text':
        text(e.value, e.p.x, e.p.y, e.height, e.rotation, e.align === 'center', e.layer)
        break
      case 'dimension': {
        const g = dimensionGeometry(e.a, e.b, e.offset)
        const label = e.override ?? formatLength(measured(e.a, e.b))
        if (opt.dimensionObjects) {
          o.push(`dimension_aligned ${p3(e.a.x, e.a.y)} ${p3(e.b.x, e.b.y)} ${p3(g.textAt.x, g.textAt.y)}`)
          count('DIMENSION')
          break
        }
        // exploded: extension lines, dimension line, 45° ticks, text above the line
        line(e.a.x, e.a.y, g.da.x + g.n.x * 0.1 * e.textHeight, g.da.y + g.n.y * 0.1 * e.textHeight, e.layer)
        line(e.b.x, e.b.y, g.db.x + g.n.x * 0.1 * e.textHeight, g.db.y + g.n.y * 0.1 * e.textHeight, e.layer)
        line(g.da.x, g.da.y, g.db.x, g.db.y, e.layer)
        const tk = e.textHeight * 0.5
        const dx = Math.cos(g.angle + Math.PI / 4) * tk, dy = Math.sin(g.angle + Math.PI / 4) * tk
        for (const p of [g.da, g.db]) line(p.x - dx, p.y - dy, p.x + dx, p.y + dy, e.layer)
        const up = { x: -Math.sin(g.angle), y: Math.cos(g.angle) }
        text(label, g.textAt.x + up.x * e.textHeight * 0.9, g.textAt.y + up.y * e.textHeight * 0.9, e.textHeight, e.textAngle ?? g.angle, true, e.layer)
        count('DIMENSION (exploded)')
        break
      }
    }
  }
  return { script: o.join('\n') + '\n', counts }
}

/** Entities the DWG must contain when read back (exploded dimensions count as their lines + text). */
export const expectedEntities = (counts: Record<string, number>) => Object.entries(counts).filter(([k]) => !k.includes('exploded')).reduce((a, [, n]) => a + n, 0)
