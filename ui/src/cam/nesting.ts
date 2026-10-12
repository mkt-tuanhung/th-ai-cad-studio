/**
 * Panel nesting for CNC routing: the cut-list parts of every cabinet are placed on stock sheets with
 * the MaxRects algorithm (best-short-side fit, largest parts first). Each part keeps a gap of one cutter
 * diameter + spacing to its neighbours (the router cuts around every part) and stays inside the trimmed
 * sheet. Grain: on wood-décor boards the part length follows the sheet length (no rotation); plain
 * boards (HDF white…) may be rotated by 90°.
 */
import { cutList, type Cabinet, type CutPart } from '../interior/model'

export interface NestSettings {
  sheetL: number // mm, along the grain (default stock)
  sheetW: number // mm
  /** Stock size per material (overrides sheetL × sheetW). */
  stock?: Record<string, { l: number; w: number }>
  trim: number // mm removed on every sheet edge
  /** Gap between parts (mm): cutter diameter + spacing, so neighbouring outlines do not overlap. */
  gap: number
  /** Materials whose décor has a grain direction (no rotation). */
  grained: (material: string) => boolean
}

export const DEFAULT_NEST: NestSettings = {
  // 2440 × 1830 is the common MFC / HDF stock in Vietnam (1220 × 2440 also exists)
  sheetL: 2440,
  sheetW: 1830,
  trim: 10,
  gap: 12, // 8 mm cutter + 4 mm web
  grained: (m) => /walnut|oak|ash|wood/i.test(m),
}

export interface Piece {
  id: string
  label: string
  cabinet: string
  part: string
  material: string
  /** Finished length (along grain) × width × thickness, mm. */
  l: number
  w: number
  t: number
}

export interface Placement extends Piece {
  x: number // mm from the sheet origin (lower-left), part's lower-left corner
  y: number
  /** Size on the sheet (l × w, or w × l when rotated). */
  sx: number
  sy: number
  rotated: boolean
}

export interface Sheet {
  material: string
  t: number
  index: number
  l: number
  w: number
  parts: Placement[]
  /** Net part area / sheet area. */
  yield: number
}

export interface NestResult {
  sheets: Sheet[]
  /** Parts larger than the usable sheet. */
  unplaced: Piece[]
  byMaterial: Record<string, { sheets: number; parts: number; partArea: number; sheetArea: number }>
}

/** Every physical piece of the cut lists (quantities expanded). */
export function piecesOf(cabinets: Cabinet[]): Piece[] {
  const out: Piece[] = []
  for (const c of cabinets)
    for (const p of cutList(c) as CutPart[])
      for (let k = 1; k <= p.qty; k++)
        out.push({ id: `${c.id}-${p.part.replace(/\W+/g, '')}-${k}`, label: `${c.name} · ${p.part}${p.qty > 1 ? ` ${k}/${p.qty}` : ''}`, cabinet: c.name, part: p.part, material: p.material, l: p.l, w: p.wd, t: p.t })
  return out
}

type Rect = { x: number; y: number; w: number; h: number }

/** MaxRects bin with best-short-side-fit placement. Free rectangles include the gap on their far sides. */
class Bin {
  free: Rect[]
  constructor(w: number, h: number) {
    this.free = [{ x: 0, y: 0, w, h }]
  }
  place(r: Rect) {
    const next: Rect[] = []
    for (const f of this.free) {
      if (r.x >= f.x + f.w || r.x + r.w <= f.x || r.y >= f.y + f.h || r.y + r.h <= f.y) {
        next.push(f)
        continue
      }
      if (r.x > f.x) next.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h })
      if (r.x + r.w < f.x + f.w) next.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - r.x - r.w, h: f.h })
      if (r.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y })
      if (r.y + r.h < f.y + f.h) next.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - r.y - r.h })
    }
    // prune rectangles contained in others
    this.free = next.filter((a, i) => !next.some((b, j) => j !== i && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h && (j < i || a.w !== b.w || a.h !== b.h || a.x !== b.x || a.y !== b.y)))
  }
}

const stockOf = (s: NestSettings, material: string) => s.stock?.[material] ?? { l: s.sheetL, w: s.sheetW }

type Fit = 'bssf' | 'baf' | 'blsf'
const score = (f: Rect, w: number, h: number, fit: Fit) => {
  const dw = f.w - w, dh = f.h - h
  return fit === 'bssf' ? Math.min(dw, dh) * 1e6 + Math.max(dw, dh) : fit === 'blsf' ? Math.max(dw, dh) * 1e6 + Math.min(dw, dh) : (f.w * f.h - w * h) * 1e3 + Math.min(dw, dh)
}

/** One nesting pass of a material group with a given order and fit rule. */
function pass(list: Piece[], s: NestSettings, fit: Fit): { sheets: Sheet[]; unplaced: Piece[] } {
  const unplaced: Piece[] = []
  const bins: { bin: Bin; sheet: Sheet }[] = []
  for (const p of list) {
    const stock = stockOf(s, p.material)
    const usableL = stock.l - 2 * s.trim, usableW = stock.w - 2 * s.trim
    // each part reserves its size + gap; the trimmed sheet gets + gap so the last part may touch the trim line
    const options: [number, number, boolean][] = [[p.l + s.gap, p.w + s.gap, false]]
    if (!s.grained(p.material)) options.push([p.w + s.gap, p.l + s.gap, true])
    const tryBin = (bin: Bin) => {
      let best: { r: Rect; rot: boolean; sc: number } | null = null
      for (const [w, h, rot] of options)
        for (const f of bin.free)
          if (w <= f.w && h <= f.h) {
            const sc = score(f, w, h, fit)
            if (!best || sc < best.sc) best = { r: { x: f.x, y: f.y, w, h }, rot, sc }
          }
      return best
    }
    let target = bins.map((b) => ({ b, best: tryBin(b.bin) })).find((x) => x.best)
    if (!target) {
      if (!options.some(([w, h]) => w <= usableL + s.gap && h <= usableW + s.gap)) {
        unplaced.push(p)
        continue
      }
      const b = { bin: new Bin(usableL + s.gap, usableW + s.gap), sheet: { material: p.material, t: p.t, index: 0, l: stock.l, w: stock.w, parts: [], yield: 0 } as Sheet }
      bins.push(b)
      target = { b, best: tryBin(b.bin) }
    }
    const { b, best } = target as { b: { bin: Bin; sheet: Sheet }; best: { r: Rect; rot: boolean } }
    b.bin.place(best.r)
    b.sheet.parts.push({ ...p, x: s.trim + best.r.x, y: s.trim + best.r.y, sx: best.rot ? p.w : p.l, sy: best.rot ? p.l : p.w, rotated: best.rot })
  }
  bins.forEach((b, i) => {
    b.sheet.index = i + 1
    b.sheet.yield = b.sheet.parts.reduce((a, q) => a + q.sx * q.sy, 0) / (b.sheet.l * b.sheet.w)
  })
  return { sheets: bins.map((b) => b.sheet), unplaced }
}

export function nest(pieces: Piece[], s: NestSettings = DEFAULT_NEST): NestResult {
  const sheets: Sheet[] = []
  const unplaced: Piece[] = []
  const groups = new Map<string, Piece[]>()
  for (const p of pieces) groups.set(`${p.material}|${p.t}`, [...(groups.get(`${p.material}|${p.t}`) ?? []), p])
  const orders: ((a: Piece, b: Piece) => number)[] = [
    (a, b) => b.l * b.w - a.l * a.w || b.l - a.l,
    (a, b) => b.l - a.l || b.w - a.w,
    (a, b) => b.w - a.w || b.l - a.l,
    (a, b) => Math.max(b.l, b.w) - Math.max(a.l, a.w) || b.l * b.w - a.l * a.w,
  ]
  for (const [, list] of groups) {
    // several orders × fit rules; keep the fewest sheets, then the emptiest last sheet (most reusable offcut)
    let best: ReturnType<typeof pass> | null = null
    for (const o of orders)
      for (const fit of ['bssf', 'baf', 'blsf'] as Fit[]) {
        const r = pass([...list].sort(o), s, fit)
        const last = (x: ReturnType<typeof pass>) => x.sheets[x.sheets.length - 1]?.yield ?? 0
        if (!best || r.sheets.length < best.sheets.length || (r.sheets.length === best.sheets.length && last(r) < last(best))) best = r
      }
    sheets.push(...best!.sheets)
    unplaced.push(...best!.unplaced)
  }
  const byMaterial: NestResult['byMaterial'] = {}
  for (const sh of sheets) {
    const m = (byMaterial[sh.material] ??= { sheets: 0, parts: 0, partArea: 0, sheetArea: 0 })
    m.sheets++
    m.parts += sh.parts.length
    m.partArea += sh.parts.reduce((a, q) => a + q.sx * q.sy, 0) / 1e6
    m.sheetArea += (sh.l * sh.w) / 1e6
  }
  return { sheets, unplaced, byMaterial }
}

/** Independent check of a nesting result: inside the trimmed sheet, gap respected, grain respected. */
export function verifyNest(r: NestResult, s: NestSettings = DEFAULT_NEST): string[] {
  const errs: string[] = []
  for (const sh of r.sheets) {
    for (const p of sh.parts) {
      if (p.material !== sh.material) errs.push(`${p.label}: on a ${sh.material} sheet`)
      if (p.x < s.trim - 1e-6 || p.y < s.trim - 1e-6 || p.x + p.sx > sh.l - s.trim + 1e-6 || p.y + p.sy > sh.w - s.trim + 1e-6) errs.push(`${p.label}: outside the trimmed sheet`)
      if (p.rotated && s.grained(p.material)) errs.push(`${p.label}: rotated against the grain`)
    }
    for (let i = 0; i < sh.parts.length; i++)
      for (let j = i + 1; j < sh.parts.length; j++) {
        const a = sh.parts[i], b = sh.parts[j]
        const dx = Math.max(b.x - (a.x + a.sx), a.x - (b.x + b.sx)), dy = Math.max(b.y - (a.y + a.sy), a.y - (b.y + b.sy))
        if (Math.max(dx, dy) < s.gap - 1e-6) errs.push(`${a.label} / ${b.label}: closer than ${s.gap} mm`)
      }
  }
  return errs
}

/* ------------------------------------------------------------------ exports */

/** DXF R12 of the sheet layouts side by side: SHEET outlines, PARTS, TRIM line, labels, DRILL circles. */
export function layoutDxf(sheets: Sheet[], trim: number, holes: { sheet: number; x: number; y: number; d: number }[] = []): string {
  const o: string[] = ['0', 'SECTION', '2', 'ENTITIES']
  const poly = (layer: string, pts: [number, number][]) => {
    o.push('0', 'POLYLINE', '8', layer, '66', '1', '70', '1')
    for (const [x, y] of pts) o.push('0', 'VERTEX', '8', layer, '10', x.toFixed(3), '20', y.toFixed(3))
    o.push('0', 'SEQEND')
  }
  const rect = (layer: string, x: number, y: number, w: number, h: number) => poly(layer, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]])
  let ox = 0
  sheets.forEach((sh, i) => {
    rect('SHEET', ox, 0, sh.l, sh.w)
    rect('TRIM', ox + trim, trim, sh.l - 2 * trim, sh.w - 2 * trim)
    o.push('0', 'TEXT', '8', 'LABELS', '10', String(ox), '20', String(sh.w + 40), '40', '40', '1', `${sh.material} #${sh.index} (${(sh.yield * 100).toFixed(1)} %)`)
    for (const p of sh.parts) {
      rect('PARTS', ox + p.x, p.y, p.sx, p.sy)
      o.push('0', 'TEXT', '8', 'LABELS', '10', (ox + p.x + 10).toFixed(1), '20', (p.y + 10).toFixed(1), '40', '18', '1', `${p.label} ${p.l}x${p.w}`)
    }
    for (const h of holes.filter((q) => q.sheet === i)) o.push('0', 'CIRCLE', '8', 'DRILL', '10', (ox + h.x).toFixed(3), '20', h.y.toFixed(3), '40', (h.d / 2).toFixed(3))
    ox += sh.l + 200
  })
  o.push('0', 'ENDSEC', '0', 'EOF')
  return o.join('\r\n') + '\r\n'
}
