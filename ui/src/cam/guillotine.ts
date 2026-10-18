/**
 * Guillotine nesting for panel (beam) saws (machine_type PANEL_SAW) and its independent verifier.
 *
 * A beam saw only makes straight cuts right through the piece it cuts, so the layout is a guillotine tree:
 * - stage 0: trim cuts on the four sheet edges (the kerf lies inside the trim band; trim ≥ kerf);
 * - stage 1: rip cuts across the whole trimmed board make strips (along the sheet length, X);
 * - stage 2: cross cuts through the whole strip separate the columns;
 * - stage 3: recuts through the whole column separate parts stacked in it (same width) and the offcut.
 * Every cut removes the blade kerf (from the profile's saw blade, measured on a test cut). Grain: on wood-décor
 * boards a part's grain stays along the sheet length (rotation only when the part's grain is across or none —
 * the same rule as the router nesting). Identical sheets are one pattern cut as books of up to
 * floor(max cut height / board thickness) sheets.
 *
 * Saw machines never get router paths: the outputs are the cutting patterns (SVG), a cutting list and a cut
 * sequence list (CSV, "MDCAD-SAW-CSV-1", documented below). The saw's own optimiser / controller format (e.g. PTX)
 * is not written: the cut list is entered or imported there.
 *
 * `verifyGuillotine()` re-checks a pattern without using the nesting's data structures: it replays the cuts on the
 * sheet rectangle (each cut must run edge to edge through exactly one current piece and remove the kerf) and then
 * requires every part to BE one of the resulting pieces (so parts never overlap and never sit in a kerf), inside the
 * trim, at its cut size, with its grain respected.
 */
import { rotations, type NestSettings, type Piece, type Placement } from './nesting'

export interface GuillotineSettings {
  kerf: number
  trim: number
  sheetL: number
  sheetW: number
  stock?: Record<string, { l: number; w: number }>
  grained: (material: string) => boolean
  /** Saw max cut height (book height), mm; null = not defined (one sheet per book, flagged). */
  maxCutHeight: number | null
  /** Saw cut length, mm (the sheet length must not exceed it); null = not checked (flagged). */
  cutLength?: number | null
}

export type CutStage = 0 | 1 | 2 | 3
export interface GCut {
  n: number
  stage: CutStage
  /** H: a line y = pos running along X from `from` to `to`; V: a line x = pos running along Y. */
  axis: 'H' | 'V'
  /** Lower / left edge of the kerf; the kerf occupies [pos, pos + kerf]. */
  pos: number
  from: number
  to: number
  kerf: number
}

export interface GPattern {
  material: string
  t: number
  index: number
  l: number
  w: number
  parts: Placement[]
  cuts: GCut[]
  /** Identical sheets cut with this pattern and the books (stacks) they need. */
  count: number
  books: number
  perBook: number
  yield: number
}

export interface GuillotineResult {
  patterns: GPattern[]
  unplaced: Piece[]
  /** Setup problems (blocker codes): kerf / trim / cut height / cut length. */
  setup: string[]
  sheets: number
}

const EPS = 1e-6
const stockOf = (s: GuillotineSettings, m: string) => s.stock?.[m] ?? { l: s.sheetL, w: s.sheetW }
const asNest = (s: GuillotineSettings): NestSettings => ({ sheetL: s.sheetL, sheetW: s.sheetW, trim: s.trim, gap: s.kerf, grained: s.grained, stock: s.stock })

interface Col {
  x0: number
  sx: number
  parts: Placement[]
}

/** One sheet: strips filled first-fit-decreasing from the remaining pieces. */
function fillSheet(left: Piece[], s: GuillotineSettings, l: number, w: number, material: string, t: number): { parts: Placement[]; cuts: GCut[] } {
  const k = s.kerf, x0 = s.trim, x1 = l - s.trim, y1 = w - s.trim
  const cuts: Omit<GCut, 'n'>[] = []
  if (s.trim > 0) {
    cuts.push({ stage: 0, axis: 'H', pos: s.trim - k, from: 0, to: l, kerf: k }, { stage: 0, axis: 'H', pos: y1, from: 0, to: l, kerf: k })
    cuts.push({ stage: 0, axis: 'V', pos: s.trim - k, from: s.trim, to: y1, kerf: k }, { stage: 0, axis: 'V', pos: x1, from: s.trim, to: y1, kerf: k })
  }
  const parts: Placement[] = []
  const strips: { y0: number; h: number; cols: Col[] }[] = []
  const orient = (p: Piece, rot: boolean) => ({ sx: rot ? p.w : p.l, sy: rot ? p.l : p.w })
  const opts = (p: Piece) => rotations(p, asNest(s)).map((rot) => ({ rot, ...orient(p, rot) }))
  let y = s.trim
  for (;;) {
    // the tallest-first piece that opens a strip (oriented with its longer side along X when free)
    let open: { i: number; rot: boolean; sx: number; sy: number } | null = null
    left.forEach((p, i) => {
      if (open) return
      const o = opts(p).filter((q) => q.sx <= x1 - x0 + EPS && y + q.sy <= y1 + EPS).sort((a, b) => b.sx - a.sx)[0]
      if (o) open = { i, ...o }
    })
    if (!open) break
    const first = open as { i: number; rot: boolean; sx: number; sy: number }
    const h = first.sy
    const strip = { y0: y, h, cols: [] as Col[] }
    let x = x0
    const place = (i: number, o: { rot: boolean; sx: number; sy: number }) => {
      const p = left.splice(i, 1)[0]
      const col: Col = { x0: x, sx: o.sx, parts: [] }
      let cy = y
      const put = (q: Piece, oo: { rot: boolean; sx: number; sy: number }) => {
        const pl: Placement = { ...q, x, y: cy, sx: oo.sx, sy: oo.sy, rotated: oo.rot }
        col.parts.push(pl)
        parts.push(pl)
        cy += oo.sy + k
      }
      put(p, o)
      // stack more parts of the same width in the column while they fit under the strip top
      for (let j = 0; j < left.length; ) {
        const q = left[j]
        const oo = opts(q).find((c) => Math.abs(c.sx - o.sx) < 0.01 && cy + c.sy <= y + h + EPS)
        if (oo) {
          left.splice(j, 1)
          put(q, oo)
        } else j++
      }
      strip.cols.push(col)
      x += o.sx + k
    }
    place(first.i, first)
    for (let i = 0; i < left.length; ) {
      const o = opts(left[i]).filter((q) => q.sy <= h + EPS && x + q.sx <= x1 + EPS).sort((a, b) => b.sy - a.sy)[0]
      if (o) place(i, o)
      else i++
    }
    strips.push(strip)
    y += h + k
    if (y >= y1 - EPS) break
  }
  // cuts: rips (stage 1), then per strip cross cuts (stage 2) and recuts (stage 3)
  for (const st of strips) if (st.y0 + st.h < y1 - EPS) cuts.push({ stage: 1, axis: 'H', pos: st.y0 + st.h, from: x0, to: x1, kerf: k })
  for (const st of strips) {
    const top = st.y0 + st.h
    for (const c of st.cols) if (c.x0 + c.sx < x1 - EPS) cuts.push({ stage: 2, axis: 'V', pos: c.x0 + c.sx, from: st.y0, to: top, kerf: k })
    for (const c of st.cols) for (const p of c.parts) if (p.y + p.sy < top - EPS) cuts.push({ stage: 3, axis: 'H', pos: p.y + p.sy, from: c.x0, to: c.x0 + c.sx, kerf: k })
  }
  void material
  void t
  return { parts, cuts: cuts.map((c, i) => ({ ...c, n: i + 1 })) }
}

const signature = (p: { parts: Placement[] }) => JSON.stringify(p.parts.map((q) => [q.partId ?? q.label.replace(/ \d+\/\d+$/, ''), q.l, q.w, +q.x.toFixed(2), +q.y.toFixed(2), q.rotated]))

export function guillotineNest(pieces: Piece[], s: GuillotineSettings): GuillotineResult {
  const setup: string[] = []
  if (!(s.kerf > 0)) setup.push('SAW_KERF_NOT_DEFINED')
  if (s.trim > 0 && s.trim < s.kerf) setup.push(`SAW_TRIM_LESS_THAN_KERF:${s.trim}<${s.kerf}`)
  if (s.maxCutHeight == null) setup.push('SAW_MAX_CUT_HEIGHT_NOT_DEFINED')
  if (s.cutLength == null) setup.push('SAW_CUT_LENGTH_NOT_DEFINED')
  const patterns: GPattern[] = []
  const unplaced: Piece[] = []
  const groups = new Map<string, Piece[]>()
  for (const p of pieces) groups.set(`${p.material}|${p.t}`, [...(groups.get(`${p.material}|${p.t}`) ?? []), p])
  let sheets = 0
  for (const [key, list] of groups) {
    const [material, tStr] = key.split('|')
    const t = Number(tStr)
    const { l, w } = stockOf(s, material)
    if (s.cutLength != null && Math.min(l, w) > s.cutLength + EPS) setup.push(`STOCK_LONGER_THAN_SAW_CUT:${material}:${l}x${w}>${s.cutLength}`)
    if (s.maxCutHeight != null && t > s.maxCutHeight + EPS) setup.push(`BOARD_THICKER_THAN_SAW_CUT_HEIGHT:${material}:${t}>${s.maxCutHeight}`)
    // tallest first (after orienting free parts with the long side along X), then longest
    const h = (p: Piece) => Math.min(...rotations(p, asNest(s)).map((rot) => (rot ? p.l : p.w)))
    const left = [...list].sort((a, b) => h(b) - h(a) || Math.max(b.l, b.w) - Math.max(a.l, a.w) || a.id.localeCompare(b.id))
    const sheetsOf: { parts: Placement[]; cuts: GCut[] }[] = []
    if (!(s.kerf > 0)) {
      unplaced.push(...left)
      continue
    }
    for (;;) {
      if (!left.length) break
      const before = left.length
      const sh = fillSheet(left, s, l, w, material, t)
      if (left.length === before) {
        unplaced.push(...left.splice(0))
        break
      }
      sheetsOf.push(sh)
    }
    sheets += sheetsOf.length
    const perBook = s.maxCutHeight != null && t > 0 ? Math.max(1, Math.floor(s.maxCutHeight / t + EPS)) : 1
    const bySig = new Map<string, GPattern>()
    for (const sh of sheetsOf) {
      const sig = signature(sh)
      const ex = bySig.get(sig)
      if (ex) {
        ex.count++
        ex.books = Math.ceil(ex.count / perBook)
        continue
      }
      const pat: GPattern = { material, t, index: patterns.length + 1, l, w, parts: sh.parts, cuts: sh.cuts, count: 1, books: 1, perBook, yield: sh.parts.reduce((a, q) => a + q.sx * q.sy, 0) / (l * w) }
      bySig.set(sig, pat)
      patterns.push(pat)
    }
  }
  return { patterns, unplaced, setup: [...new Set(setup)], sheets }
}

/* ------------------------------------------------------------------ independent verifier */

interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Errors of one pattern (empty = a valid guillotine plan for this saw). */
export function verifyGuillotine(p: GPattern, s: Pick<GuillotineSettings, 'kerf' | 'trim' | 'grained'>): string[] {
  const errs: string[] = []
  let pieces: Rect[] = [{ x0: 0, y0: 0, x1: p.l, y1: p.w }]
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01
  for (const c of p.cuts) {
    if (!near(c.kerf, s.kerf)) errs.push(`KERF_MISMATCH:${c.n}`)
    const i = pieces.findIndex((r) => (c.axis === 'H' ? c.pos >= r.y0 - EPS && c.pos < r.y1 - EPS && near(c.from, r.x0) && near(c.to, r.x1) : c.pos >= r.x0 - EPS && c.pos < r.x1 - EPS && near(c.from, r.y0) && near(c.to, r.y1)))
    if (i < 0) {
      errs.push(`CUT_NOT_EDGE_TO_EDGE:${c.n}`)
      continue
    }
    const r = pieces[i]
    const next: Rect[] = c.axis === 'H' ? [{ ...r, y1: c.pos }, { ...r, y0: c.pos + c.kerf }] : [{ ...r, x1: c.pos }, { ...r, x0: c.pos + c.kerf }]
    pieces = [...pieces.slice(0, i), ...next.filter((q) => q.x1 - q.x0 > EPS && q.y1 - q.y0 > EPS), ...pieces.slice(i + 1)]
  }
  const used = new Set<number>()
  for (const q of p.parts) {
    const k = pieces.findIndex((r) => near(r.x0, q.x) && near(r.y0, q.y) && near(r.x1, q.x + q.sx) && near(r.y1, q.y + q.sy))
    if (k < 0) errs.push(`PART_NOT_SEPARATED:${q.label}`)
    else if (used.has(k)) errs.push(`PART_OVERLAP:${q.label}`)
    else used.add(k)
    if (q.x < s.trim - EPS || q.y < s.trim - EPS || q.x + q.sx > p.l - s.trim + EPS || q.y + q.sy > p.w - s.trim + EPS) errs.push(`OUTSIDE_TRIM:${q.label}`)
    if (!near(q.rotated ? q.w : q.l, q.sx) || !near(q.rotated ? q.l : q.w, q.sy)) errs.push(`SIZE_MISMATCH:${q.label}`)
    if (!rotations(q, { sheetL: p.l, sheetW: p.w, trim: s.trim, gap: s.kerf, grained: s.grained }).includes(q.rotated)) errs.push(`GRAIN_VIOLATION:${q.label}`)
  }
  return errs
}

export const verifyAll = (r: GuillotineResult, s: Pick<GuillotineSettings, 'kerf' | 'trim' | 'grained'>) => r.patterns.flatMap((p) => verifyGuillotine(p, s).map((e) => `P${p.index}:${e}`))

/* ------------------------------------------------------------------ outputs */

const STAGE = ['trim', 'rip', 'cross', 'recut'] as const
const f2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2).replace(/\.?0+$/, '') || '0'
const q = (v: string | number) => {
  const t = String(v)
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}
const csvOf = (rows: (string | number)[][]) => rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n'

/**
 * Cutting list (MDCAD-SAW-CSV-1, part rows): one row per part of every pattern. Columns: Pattern, Sheets, Books,
 * Sheets per book, Material, Thickness (mm), Part ID, Rev, Part, Cut length (mm), Cut width (mm), Rotated, X (mm),
 * Y (mm), Grain. X / Y = the part's lower-left corner from the sheet's lower-left corner (sheet length along X).
 */
export function cuttingListCsv(r: GuillotineResult): string {
  return csvOf([
    ['Pattern', 'Sheets', 'Books', 'Sheets per book', 'Material', 'Thickness (mm)', 'Part ID', 'Rev', 'Part', 'Cut length (mm)', 'Cut width (mm)', 'Rotated', 'X (mm)', 'Y (mm)', 'Grain'],
    ...r.patterns.flatMap((p) => p.parts.map((x) => [`P${p.index}`, p.count, p.books, p.perBook, p.material, p.t, x.partId ?? x.id, x.rev ?? '', x.label, x.l, x.w, x.rotated ? 'yes' : 'no', f2(x.x), f2(x.y), x.grain ?? ''])),
  ])
}

/**
 * Cut sequence (MDCAD-SAW-CSV-1, cut rows): Pattern, Cut, Stage (trim / rip / cross / recut), Axis (H = along the
 * sheet length at Y = position, V = across at X = position), Position (mm, lower / left kerf edge), From (mm),
 * To (mm), Kerf (mm). Cuts are in saw order; each runs through the whole piece it cuts.
 */
export function cutSequenceCsv(r: GuillotineResult): string {
  return csvOf([
    ['Pattern', 'Cut', 'Stage', 'Axis', 'Position (mm)', 'From (mm)', 'To (mm)', 'Kerf (mm)'],
    ...r.patterns.flatMap((p) => p.cuts.map((c) => [`P${p.index}`, c.n, STAGE[c.stage], c.axis, f2(c.pos), f2(c.from), f2(c.to), f2(c.kerf)])),
  ])
}

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!)

/** SVG of one cutting pattern (sheet, parts with labels, cut lines numbered; y up). */
export function patternSvg(p: GPattern, opts: { notForMachine?: boolean } = {}): string {
  const pad = 40, W = p.l + 2 * pad, H = p.w + 2 * pad + 60
  const Y = (y: number) => pad + 60 + (p.w - y)
  const o: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Arial, sans-serif">`]
  o.push(`<text x="${pad}" y="${pad}" font-size="34" font-weight="700">P${p.index} · ${esc(p.material)} ${p.l} × ${p.w} × ${p.t} mm · ${p.count} sheet(s), ${p.books} book(s) of ≤ ${p.perBook}</text>`)
  if (opts.notForMachine) o.push(`<text x="${pad}" y="${pad + 40}" font-size="26" fill="#b42d2d">ENGINEERING PREVIEW - NOT FOR MACHINE USE</text>`)
  o.push(`<rect x="${pad}" y="${Y(p.w)}" width="${p.l}" height="${p.w}" fill="#efe9df" stroke="#555" stroke-width="2"/>`)
  for (const x of p.parts) {
    o.push(`<rect x="${pad + x.x}" y="${Y(x.y + x.sy)}" width="${x.sx}" height="${x.sy}" fill="#d9c3a2" stroke="#6e4a33" stroke-width="1.5"/>`)
    const fs = Math.max(10, Math.min(28, x.sy * 0.18, x.sx / Math.max(8, x.label.length * 0.55)))
    o.push(`<text x="${pad + x.x + x.sx / 2}" y="${Y(x.y + x.sy / 2)}" font-size="${fs.toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${esc(x.label)} ${x.l}×${x.w}${x.rotated ? ' ↻' : ''}</text>`)
  }
  for (const c of p.cuts) {
    const mid = c.pos + c.kerf / 2
    const [x1, y1, x2, y2] = c.axis === 'H' ? [pad + c.from, Y(mid), pad + c.to, Y(mid)] : [pad + mid, Y(c.from), pad + mid, Y(c.to)]
    o.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${['#888', '#c0392b', '#2471a3', '#1e8449'][c.stage]}" stroke-width="${Math.max(2, c.kerf)}"/>`)
    o.push(`<text x="${(x1 + x2) / 2 + 4}" y="${(y1 + y2) / 2 - 4}" font-size="14" fill="#333">${c.n}</text>`)
  }
  o.push('</svg>')
  return o.join('\n') + '\n'
}
