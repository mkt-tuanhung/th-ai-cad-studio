/**
 * Floor plan recognition on a picture (v2.4 "Ảnh mặt bằng → nội thất 3D"), in picture pixels (x right, y down).
 * Classic image processing, no AI, every step explainable:
 *
 *  1. wall bands: the ink opened by a square a little wider than the thin lines (thin lines, text, arcs, hatching
 *     vanish; poured / thick-stroke walls stay). Drawings with hollow walls (two thin lines) are filled first: the
 *     narrow closed strips between the two faces become bands ("outline" style);
 *  2. columns: what survives an opening a little wider than the thickest wall and is roughly square;
 *  3. walls: horizontal / vertical runs of the bands, split where the thickness changes, merged across junctions and
 *     columns, ends extended to the centre line of the wall they meet; other elongated bands → slanted walls;
 *  4. openings: gaps along a wall line — a door where a swing arc (traced from the thin ink) has its hinge at the gap
 *     end and its radius ≈ the gap; a window where ≥ 2 thin lines run across the gap inside the wall band; an
 *     opening where the gap is empty; glazing between two stops with no wall piece on its line → a curtain wall;
 *  5. rooms: the free space closed by the walls (openings close with their wall), exterior flooded from the border;
 *     each named from the OCR'd words inside it ("P. KHÁCH", "BẾP", …), its labelled area ("13.53 m²") kept;
 *  6. stair flights: ≥ 5 parallel, evenly spaced thin lines of similar length (treads) inside a room.
 *
 * Every element carries a confidence (0–1) and what identified it. Sizes are thresholded with `pxPerM` (an
 * estimate: the nominal dpi × scale or a suggested calibration); the geometry itself stays in pixels until the
 * user's calibration converts it (toModel.ts).
 */
import { fitCircle, rdp, thin, trace } from '../cad/vectorize'
import type { Vec2 } from '../cad/types'
import { isLexicon, lexiconWord } from './roomWords'
import { and, cloneMask, components, dilate, distanceToBackground, fillPoly, fillRect, mask, minus, open, or, runLengths, type CompStat, type Mask } from './raster'

export type Pt = [number, number]

export interface PWord { text: string; conf: number; x0: number; y0: number; x1: number; y1: number; /** text line it was read in */ line?: number }
export interface PWall {
  id: string
  /** centre line ends (px) */
  a: Pt
  b: Pt
  /** thickness (px) */
  t: number
  ext: boolean
  /** glazing filling the whole stretch (no wall body): a curtain wall */
  curtain?: boolean
  conf: number
  by: 'band' | 'outline' | 'glazing' | 'door' | 'slanted' | 'user'
}
export interface POpening {
  id: string
  wall: string
  kind: 'door' | 'window' | 'opening'
  /** extent along the wall from its end `a` (px) */
  s0: number
  s1: number
  conf: number
  why: string[]
  mark: string | null
}
export interface PColumn { id: string; x: number; y: number; w: number; d: number; conf: number }
export interface PRoom {
  id: string
  name: string | null
  number: string | null
  /** confidence of the name (OCR) 0–1; 1 = typed by the user */
  nameConf: number
  /** a point inside (labels, editing) */
  seed: Pt
  outline: Pt[]
  areaPx: number
  /** area written in the room ("13.53 m²"), m² */
  areaLabel: number | null
  conf: number
  /** left out of the model by the user */
  skip?: boolean
}
export interface PFlight { a: Pt; b: Pt; width: number; treads: number; going: number; conf: number }
export interface PSeg { a: Pt; b: Pt }
export interface PArc { c: Pt; r: number; ends: [Pt, Pt]; sweep: number; fit: number }

export interface PlanGraph {
  w: number
  h: number
  walls: PWall[]
  openings: POpening[]
  columns: PColumn[]
  rooms: PRoom[]
  flights: PFlight[]
  words: PWord[]
  /** drawing title ("MẶT BẰNG TẦNG 1 ±0.000"), from OCR */
  title: string | null
  /** drawing scale written on the sheet ("TỶ LỆ 1:100") */
  scaleText: number | null
  footprint: Pt[] | null
  /** plan extent (px) */
  box: { x0: number; y0: number; x1: number; y1: number }
  style: 'filled' | 'outline'
  /** thin straight lines (dimension lines etc.), for the calibration suggestions */
  segs: PSeg[]
  arcs: PArc[]
  pxPerM: number
  /** "code" or "code:n" — warnings for the review */
  notes: string[]
}

export interface RecogOptions {
  /** estimate of the scale (px per metre of the building) used for the size thresholds */
  pxPerM: number
  style?: 'auto' | 'filled' | 'outline'
  /** band opening size (px); default: from the scale (80 mm) and the thin-line width */
  kernel?: number
  /** filled with the internal numbers (QA) */
  debug?: Record<string, unknown>
}

const med = (v: number[]) => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
let uid = 0
const nid = (p: string) => `${p}${++uid}`

/* ================================================================ walls from the bands */

interface Piece { o: 'h' | 'v'; c: number; t: number; s0: number; s1: number; by: PWall['by']; conf: number }

/** Accessors that let one routine handle both orientations (v = the transposed picture). */
function view(m: Mask, o: 'h' | 'v') {
  return o === 'h'
    ? { L: m.w, A: m.h, get: (s: number, a: number) => m.d[a * m.w + s] }
    : { L: m.h, A: m.w, get: (s: number, a: number) => m.d[s * m.w + a] }
}

/**
 * Pieces of one orientation: the band pixels whose run along it is long (≥ L0) and across it short, as connected
 * groups, each cut where its across-extent (thickness or position) changes for ≥ 3 px.
 */
function piecesOf(wm: Mask, o: 'h' | 'v', L0: number, tMax: number): Piece[] {
  const { hr, vr } = runLengths(wm)
  const along = o === 'h' ? hr : vr, across = o === 'h' ? vr : hr
  const sel = mask(wm.w, wm.h)
  for (let i = 0; i < sel.d.length; i++) if (wm.d[i] && along[i] >= L0 && across[i] <= tMax) sel.d[i] = 1
  const { label, stats } = components(sel, 4)
  const out: Piece[] = []
  for (const st of stats) {
    if (st.area < L0 * 2) continue
    const s0 = o === 'h' ? st.x0 : st.y0, s1 = o === 'h' ? st.x1 : st.y1
    const a0 = o === 'h' ? st.y0 : st.x0, a1 = o === 'h' ? st.y1 : st.x1
    const n = s1 - s0 + 1
    const top = new Float64Array(n).fill(-1), bot = new Float64Array(n).fill(-1)
    for (let s = s0; s <= s1; s++)
      for (let a = a0; a <= a1; a++) {
        const i = o === 'h' ? a * wm.w + s : s * wm.w + a
        if (label[i] !== st.id) continue
        if (top[s - s0] < 0) top[s - s0] = a
        bot[s - s0] = a
      }
    // cut into stretches of constant extent
    let start = -1, rt = 0, rb = 0, bad = 0
    const flush = (end: number) => {
      if (start < 0) return
      const len = end - start
      if (len >= Math.max(3, L0 * 0.5)) {
        const ts: number[] = [], cs: number[] = []
        for (let k = start; k < end; k++) if (top[k] >= 0) { ts.push(bot[k] - top[k] + 1); cs.push((top[k] + bot[k] + 1) / 2) }
        out.push({ o, c: cs.reduce((p, q) => p + q, 0) / cs.length, t: med(ts), s0: s0 + start, s1: s0 + end, by: 'band', conf: 0.9 })
      }
      start = -1
    }
    for (let k = 0; k < n; k++) {
      if (top[k] < 0) { flush(k - bad); bad = 0; continue }
      if (start < 0) { start = k; rt = top[k]; rb = bot[k]; bad = 0; continue }
      const tol = Math.max(1, 0.15 * (rb - rt + 1))
      if (Math.abs(top[k] - rt) <= tol && Math.abs(bot[k] - rb) <= tol) { bad = 0; continue }
      bad++
      if (bad >= 3) { flush(k - bad + 1); start = k - bad + 1; rt = top[k]; rb = bot[k]; bad = 0 }
    }
    flush(n - bad)
  }
  return out
}

/** Fraction of `m` pixels in the band of a stretch [s0, s1] × [c − t/2, c + t/2]. */
function cover(m: Mask, o: 'h' | 'v', c: number, t: number, s0: number, s1: number): number {
  const v = view(m, o)
  let n = 0, k = 0
  const a0 = Math.max(0, Math.round(c - t / 2)), a1 = Math.min(v.A - 1, Math.round(c + t / 2) - 1)
  for (let s = Math.max(0, Math.round(s0)); s < Math.min(v.L, Math.round(s1)); s++) for (let a = a0; a <= a1; a++) { n++; k += v.get(s, a) }
  return n ? k / n : 0
}

const sameLine = (p: Piece, q: Piece) => p.o === q.o && Math.abs(p.c - q.c) <= Math.max(1.6, 0.25 * Math.min(p.t, q.t)) && Math.abs(p.t - q.t) <= Math.max(2.1, 0.3 * Math.max(p.t, q.t))

/** Lines: pieces of one orientation on the same centre line and thickness, sorted along. */
function linesOf(ps: Piece[]): Piece[][] {
  const sorted = [...ps].sort((a, b) => (a.o === b.o ? a.c - b.c : a.o < b.o ? -1 : 1) || a.s0 - b.s0)
  const lines: Piece[][] = []
  for (const p of sorted) {
    const l = lines.find((x) => sameLine(x[0], p))
    if (l) l.push(p)
    else lines.push([p])
  }
  for (const l of lines) l.sort((a, b) => a.s0 - b.s0)
  return lines
}

/** Merges pieces of a line that overlap or whose gap is filled with band / column pixels (junctions, columns). */
function mergeFilled(ps: Piece[], filled: Mask, maxGap: number): Piece[] {
  const out: Piece[] = []
  for (const l of linesOf(ps)) {
    let cur = { ...l[0] }
    for (let i = 1; i < l.length; i++) {
      const p = l[i]
      const gap = p.s0 - cur.s1
      const t = Math.max(cur.t, p.t)
      if (gap <= 1 || (gap <= maxGap && cover(filled, cur.o, (cur.c + p.c) / 2, Math.min(cur.t, p.t), cur.s1, p.s0) >= 0.7)) {
        const L1 = cur.s1 - cur.s0, L2 = p.s1 - p.s0
        cur = { ...cur, c: (cur.c * L1 + p.c * L2) / (L1 + L2), t: (L1 >= L2 ? cur.t : p.t), s1: Math.max(cur.s1, p.s1) }
        void t
      } else { out.push(cur); cur = { ...p } }
    }
    out.push(cur)
  }
  return out
}

/** Extends free ends to the centre line of a perpendicular wall (or the centre of a column) they touch. */
function extendEnds(ps: Piece[], cols: PColumn[]) {
  const orig = ps.map((p) => ({ ...p }))
  for (const p of ps) {
    for (const end of [0, 1] as const) {
      const e = end ? p.s1 : p.s0
      let best: number | null = null, bd = Infinity
      for (const q of orig) {
        if (q.o === p.o) continue
        // q's band across p's direction: [q.c − q.t/2, q.c + q.t/2]; it must cross p's centre line (± half p)
        if (p.c < q.s0 - p.t / 2 - 3 || p.c > q.s1 + p.t / 2 + 3) continue
        const lo = q.c - q.t / 2, hi = q.c + q.t / 2
        const touch = end ? e >= lo - 3 && e <= hi + 2 : e <= hi + 3 && e >= lo - 2
        if (!touch) continue
        const d = Math.abs(q.c - e)
        if (d < bd) { bd = d; best = q.c }
      }
      for (const c of cols) {
        const along = p.o === 'h' ? c.x : c.y, acr = p.o === 'h' ? c.y : c.x, half = (p.o === 'h' ? c.w : c.d) / 2, halfA = (p.o === 'h' ? c.d : c.w) / 2
        if (Math.abs(acr - p.c) > halfA + 1) continue
        const touch = end ? e >= along - half - 3 && e <= along + half + 2 : e <= along + half + 3 && e >= along - half - 2
        if (touch && Math.abs(along - e) < bd) { bd = Math.abs(along - e); best = along }
      }
      if (best !== null) { if (end) p.s1 = Math.max(p.s1, best); else p.s0 = Math.min(p.s0, best) }
    }
  }
}

/* ================================================================ thin ink: segments and arcs */

function traceThin(thinInk: Mask, ox: number, oy: number): { segs: PSeg[]; arcs: PArc[]; chains: Vec2[][] } {
  const m = thinInk.d.slice()
  thin(m, thinInk.w, thinInk.h)
  const segs: PSeg[] = [], arcs: PArc[] = [], chains: Vec2[][] = []
  for (const ch of trace(m, thinInk.w, thinInk.h)) {
    let pts: Vec2[] = ch.pts.map((i) => ({ x: (i % thinInk.w) + 0.5, y: Math.floor(i / thinInk.w) + 0.5 }))
    if (ch.ends?.[0]) pts[0] = { x: ch.ends[0].x + 0.5, y: ch.ends[0].y + 0.5 }
    if (ch.ends?.[1]) pts[pts.length - 1] = { x: ch.ends[1].x + 0.5, y: ch.ends[1].y + 0.5 }
    if (pts.length < 3) continue
    pts = pts.map((p) => ({ x: p.x + ox, y: p.y + oy }))
    chains.push(pts)
    // an arc: a chain on a circle, sweep 50°…200°
    if (pts.length >= 12) {
      const circ = fitCircle(pts, 1.3)
      if (circ) {
        const ang = pts.map((p) => Math.atan2(p.y - circ.c.y, p.x - circ.c.x))
        let sweep = 0
        for (let i = 1; i < ang.length; i++) { let d = ang[i] - ang[i - 1]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; sweep += d }
        const sw = Math.abs(sweep) * 180 / Math.PI
        const chord = Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y)
        if (sw >= 50 && sw <= 200 && chord > 4) {
          arcs.push({ c: [circ.c.x, circ.c.y], r: circ.r, ends: [[pts[0].x, pts[0].y], [pts[pts.length - 1].x, pts[pts.length - 1].y]], sweep: sw, fit: 1 })
          continue
        }
      }
    }
    const simple = rdp(pts, 1.2)
    for (let i = 0; i + 1 < simple.length; i++) {
      const a = simple[i], b = simple[i + 1]
      if (Math.hypot(b.x - a.x, b.y - a.y) >= 6) segs.push({ a: [a.x, a.y], b: [b.x, b.y] })
    }
  }
  return { segs, arcs, chains }
}

/* ================================================================ text */

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toUpperCase().replace(/\s+/g, ' ').trim()

/** Words grouped into text lines (same baseline band, close along x), left to right. */
export function textLines(words: PWord[]): { text: string; conf: number; x0: number; y0: number; x1: number; y1: number; words: PWord[] }[] {
  const ws = [...words].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2)
  const lines: PWord[][] = []
  // words read line by line keep their line
  if (ws.length && ws.every((w) => w.line !== undefined)) {
    const by = new Map<number, PWord[]>()
    for (const w of ws) (by.get(w.line!) ?? by.set(w.line!, []).get(w.line!)!).push(w)
    lines.push(...by.values())
  } else for (const w of ws) {
    const h = w.y1 - w.y0, cy = (w.y0 + w.y1) / 2
    const l = lines.find((L) => {
      const last = L[L.length - 1], lh = last.y1 - last.y0, lc = (last.y0 + last.y1) / 2
      if (Math.abs(lc - cy) > 0.5 * Math.max(h, lh)) return false
      return L.some((x) => Math.max(x.x0, w.x0) - Math.min(x.x1, w.x1) < 1.6 * Math.max(h, lh))
    })
    if (l) l.push(w)
    else lines.push([w])
  }
  return lines.map((L) => {
    L = [...L]
    L.sort((a, b) => a.x0 - b.x0)
    return { text: L.map((w) => w.text).join(' '), conf: L.reduce((a, w) => a + w.conf, 0) / L.length, x0: Math.min(...L.map((w) => w.x0)), y0: Math.min(...L.map((w) => w.y0)), x1: Math.max(...L.map((w) => w.x1)), y1: Math.max(...L.map((w) => w.y1)), words: L }
  })
}

/** "13.53 m²", "13,5m2", "6.72 m?" → 13.53 (m²); null when the line is not an area. */
export function parseArea(s: string): number | null {
  const m = /(\d{1,3}[.,]\d{1,2})\s*(m2|m²|m\?|m'|m|㎡)/i.exec(s.replace(/\s+/g, ' '))
  if (!m) return null
  const v = Number(m[1].replace(',', '.'))
  return v > 0.3 && v < 2000 ? v : null
}

const ROOM_NO = /^(R|P)?\d{3,4}[A-Z]?$/i
const MARK = /^(D|W|S|CS|CD|CĐ|CK|CW|DW|SW|WD)[-.]?\d{1,3}[A-Z]?$/i
const STAIR_WORD = /^(LEN|XUONG|UP|DN|DOWN)$/
const isLabelWord = (t: string) => /[A-Za-zÀ-ỹĐđ]{2,}/.test(t)

/** Name, number and written area of a room from the text lines inside it. */
export function roomLabel(lines: ReturnType<typeof textLines>): { name: string | null; number: string | null; area: number | null; conf: number } {
  let number: string | null = null, area: number | null = null
  const cands: { text: string; conf: number; h: number; letters: number; lex: number }[] = []
  for (const l of lines) {
    const a = parseArea(l.text)
    if (a !== null) { area = area ?? a; continue }
    const words = l.words.filter((w) => {
      const t = w.text.trim()
      if (ROOM_NO.test(t)) { number = number ?? t.toUpperCase(); return false }
      if (MARK.test(t)) return false
      // a doubtful reading stays only when it is a word of a room name (put back to its dictionary form)
      return t.length > 0 && (w.conf >= 55 || isLexicon(t) || (/^[+/&\-]$/.test(t) && w.conf >= 40) || (/^\d{1,2}$/.test(t) && w.conf >= 70))
    }).map((w) => ({ ...w, text: lexiconWord(w.text) ?? w.text }))
    // trim symbols left at the ends ("+ BẾP", "BẾP /")
    while (words.length && !/[\p{L}\p{N}]/u.test(words[0].text)) words.shift()
    while (words.length && !/[\p{L}\p{N}]/u.test(words[words.length - 1].text)) words.pop()
    const text = words.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim()
    if (!text || !isLabelWord(text)) continue
    // a name has words of the dictionary (one of 3+ letters, or two), or reads clearly
    // two-letter dictionary words (BÀ, LỆ, ĐI…) are easy false readings: they count only when read clearly
    const SHORT = /^(WC|KT)$/i
    const lexW = words.filter((w) => isLexicon(w.text) && ((w.text.match(/\p{L}/gu) ?? []).length >= 3 || w.conf >= 70 || (SHORT.test(w.text) && w.conf >= 40)))
    const lex = lexW.length >= 2 || lexW.some((w) => (w.text.match(/\p{L}/gu) ?? []).length >= 3 || /^WC$/i.test(w.text))
    if (!lex && (lexW.length || words.reduce((a, w) => a + w.conf, 0) / words.length < 80)) continue
    // a label is mostly letters (not a level "+0.000", not a stray dimension)
    const letters = (text.match(/[A-Za-zÀ-ỹĐđ]/g) ?? []).length
    if (letters < 2 || letters < 0.4 * text.replace(/\s/g, '').length) continue
    cands.push({ text, conf: words.reduce((p, w) => p + w.conf, 0) / words.length, h: med(words.map((w) => w.y1 - w.y0)), letters, lex: lexW.length })
  }
  if (!cands.length) return { name: null, number, area, conf: 0 }
  // a stair is marked by its direction ("LÊN" / "XUỐNG" / "UP" / "DN") — the room is the stair
  const dirOnly = cands.every((c) => STAIR_WORD.test(norm(c.text)))
  if (dirOnly) return { name: /UP|DN|DOWN/.test(norm(cands[0].text)) ? 'STAIR' : 'THANG BỘ', number, area, conf: cands[0].conf / 100 }
  for (let i = cands.length - 1; i >= 0; i--) if (STAIR_WORD.test(norm(cands[i].text))) cands.splice(i, 1)
  // the line with most dictionary words wins, then the bigger text (names are written larger than notes), the longer
  cands.sort((a, b) => b.lex * 1000 + b.h * 10 + b.letters - (a.lex * 1000 + a.h * 10 + a.letters))
  const best = cands[0]
  return { name: best.text, number, area, conf: Math.max(0, Math.min(1, best.conf / 100)) }
}

/* ================================================================ rooms from the walls */

/** Outer boundary of the pixels with label `id` (crack following on the pixel corners), as a polygon. */
export function contourOf(label: Int32Array, w: number, h: number, id: number, st: CompStat): Pt[] {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && label[y * w + x] === id
  // start: the first pixel of the top row
  let sx = st.x0, sy = st.y0
  for (let x = st.x0; x <= st.x1; x++) if (inside(x, st.y0)) { sx = x; break }
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1] // E S W N (y down)
  let x = sx, y = sy, d = 0
  const pts: Pt[] = [[x, y]]
  const pix = (dir: number, side: 'l' | 'r'): boolean => {
    // pixels around vertex (x, y): NW (x−1, y−1), NE (x, y−1), SW (x−1, y), SE (x, y)
    const NW = inside(x - 1, y - 1), NE = inside(x, y - 1), SW = inside(x - 1, y), SE = inside(x, y)
    if (dir === 0) return side === 'l' ? NE : SE
    if (dir === 1) return side === 'l' ? SE : SW
    if (dir === 2) return side === 'l' ? SW : NW
    return side === 'l' ? NW : NE
  }
  for (let guard = 0; guard < 4 * (w + 2) * (h + 2); guard++) {
    let nd: number
    if (pix(d, 'l')) nd = (d + 3) % 4
    else if (pix(d, 'r')) nd = d
    else nd = (d + 1) % 4
    if (nd !== d) { const last = pts[pts.length - 1]; if (last[0] !== x || last[1] !== y) pts.push([x, y]) }
    d = nd
    x += DX[d]; y += DY[d]
    if (x === sx && y === sy) break
  }
  return pts
}

/** Ramer–Douglas–Peucker on a closed polygon. */
export function simplifyClosed(p: Pt[], eps: number): Pt[] {
  if (p.length < 4) return p
  // split at the point farthest from the first
  let far = 0, fd = -1
  for (let i = 1; i < p.length; i++) { const d = Math.hypot(p[i][0] - p[0][0], p[i][1] - p[0][1]); if (d > fd) { fd = d; far = i } }
  const V = (q: Pt[]) => q.map(([x, y]) => ({ x, y }))
  const a = rdp(V(p.slice(0, far + 1)), eps), b = rdp(V([...p.slice(far), p[0]]), eps)
  const out = [...a.slice(0, -1), ...b.slice(0, -1)].map((q) => [q.x, q.y] as Pt)
  return out.length >= 3 ? out : p
}

/** Barrier of the model (walls with their openings, columns) rasterised into the plan box. */
export function barrierOf(g: Pick<PlanGraph, 'walls' | 'columns'>, box: PlanGraph['box'], extra: { a: Pt; b: Pt; t: number }[] = []): { m: Mask; ox: number; oy: number } {
  const pad = 4
  const ox = Math.floor(box.x0) - pad, oy = Math.floor(box.y0) - pad
  const m = mask(Math.ceil(box.x1 - box.x0) + 2 * pad + 1, Math.ceil(box.y1 - box.y0) + 2 * pad + 1)
  for (const w of [...g.walls, ...extra]) {
    const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], L = Math.hypot(dx, dy)
    if (L < 1e-6) continue
    const ux = dx / L, uy = dy / L, nx = -uy, ny = ux, h = Math.max(1, w.t) / 2, e = h
    const p = (s: number, o: number): Pt => [w.a[0] + ux * s + nx * o - ox, w.a[1] + uy * s + ny * o - oy]
    fillPoly(m, [p(-e, -h), p(L + e, -h), p(L + e, h), p(-e, h)])
  }
  for (const c of g.columns) fillRect(m, c.x - c.w / 2 - ox, c.y - c.d / 2 - oy, c.x + c.w / 2 - ox, c.y + c.d / 2 - oy)
  return { m, ox, oy }
}

/**
 * Rooms, exterior wall flags and the footprint from the walls (recomputed after every edit): the free space closed
 * by the walls; the exterior flooded from the border of the plan box. `closers`: extra barrier lines (gaps closed
 * for the rooms only — never built).
 */
export function roomsFromWalls(g: PlanGraph, closers: { a: Pt; b: Pt; t: number }[] = [], keep: PRoom[] = []): { rooms: PRoom[]; footprint: Pt[] | null; ext: Set<string> } {
  const { m, ox, oy } = barrierOf(g, g.box, closers)
  const free = mask(m.w, m.h)
  for (let i = 0; i < m.d.length; i++) free.d[i] = m.d[i] ^ 1
  const { label, stats } = components(free, 4)
  splitByNames(label, stats, m.w, m.h, ox, oy, g)
  const outside = new Set<number>()
  for (let x = 0; x < m.w; x++) { if (label[x] >= 0) outside.add(label[x]); if (label[(m.h - 1) * m.w + x] >= 0) outside.add(label[(m.h - 1) * m.w + x]) }
  for (let y = 0; y < m.h; y++) { if (label[y * m.w] >= 0) outside.add(label[y * m.w]); if (label[y * m.w + m.w - 1] >= 0) outside.add(label[y * m.w + m.w - 1]) }
  const pxM = g.pxPerM
  const minArea = 0.5 * pxM * pxM, minSide = 0.45 * pxM
  const rooms: PRoom[] = []
  const lines = textLines(g.words)
  const at = (x: number, y: number) => { const xx = Math.floor(x - ox), yy = Math.floor(y - oy); return xx < 0 || yy < 0 || xx >= m.w || yy >= m.h ? -1 : label[yy * m.w + xx] }
  for (const st of stats) {
    if (outside.has(st.id) || st.area < minArea || Math.min(st.x1 - st.x0 + 1, st.y1 - st.y0 + 1) < minSide) continue
    const poly = simplifyClosed(contourOf(label, m.w, m.h, st.id, st), 0.9).map(([x, y]) => [x + ox, y + oy] as Pt)
    const inside = lines.filter((l) => at((l.x0 + l.x1) / 2, (l.y0 + l.y1) / 2) === st.id)
    const lab = roomLabel(inside)
    // a room the user named keeps its name when the walls change (same place)
    const seed = interiorSeed(label, m.w, st)
    const seedW: Pt = [seed[0] + ox, seed[1] + oy]
    const prev = keep.find((r) => at(r.seed[0], r.seed[1]) === st.id && r.nameConf >= 1)
    rooms.push({
      id: nid('R'), name: prev?.name ?? lab.name, number: prev?.number ?? lab.number, nameConf: prev ? 1 : lab.conf, seed: prev ? prev.seed : seedW, outline: poly, areaPx: st.area,
      areaLabel: lab.area, conf: lab.name ? 0.6 + 0.4 * lab.conf : 0.5,
    })
  }
  // exterior faces of the walls
  const ext = new Set<string>()
  for (const w of g.walls) {
    const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], L = Math.hypot(dx, dy)
    if (L < 1) continue
    const ux = dx / L, uy = dy / L, nx = -uy, ny = ux
    let hits = 0, n = 0
    for (let k = 1; k < 8; k++) {
      const s = (L * k) / 8
      for (const sg of [-1, 1]) {
        const o = sg * (w.t / 2 + 2.5)
        const id = at(w.a[0] + ux * s + nx * o, w.a[1] + uy * s + ny * o)
        n++
        if (id >= 0 && outside.has(id)) hits++
      }
    }
    if (hits >= 3) ext.add(w.id)
  }
  // footprint: everything not exterior, its largest part
  const inner = mask(m.w, m.h)
  for (let i = 0; i < m.d.length; i++) inner.d[i] = label[i] >= 0 && outside.has(label[i]) ? 0 : 1
  const ic = components(inner, 4)
  let footprint: Pt[] | null = null
  if (ic.stats.length) {
    const big = ic.stats.reduce((a, b) => (b.area > a.area ? b : a))
    if (big.area > 4 * minArea) footprint = simplifyClosed(contourOf(ic.label, m.w, m.h, big.id, big), 1.2).map(([x, y]) => [x + ox, y + oy] as Pt)
  }
  return { rooms, footprint, ext }
}

/**
 * Open-plan spaces (no wall between the living room, the dining room and the kitchen) carry two or more room names:
 * they are split along the long thin lines drawn inside them (room boundaries, glass, a void's edge), the pieces
 * without a name joined to the nearest named one (geodesic). Room names: text lines that read as a name, as large as
 * the plan's room names (notes and equipment labels are smaller).
 */
function splitByNames(label: Int32Array, stats: CompStat[], w: number, h: number, ox: number, oy: number, g: PlanGraph) {
  const b = g.box
  // a seed is a real room name: a dictionary word of 3+ letters in it, not a stair's direction word
  const strong = (n: string) => n.split(/\s+/).some((w) => isLexicon(w) && (w.match(/\p{L}/gu) ?? []).length >= 3 && !STAIR_WORD.test(norm(w)))
  const lines = textLines(g.words).filter((l) => { const n = roomLabel([l]).name; const cx = (l.x0 + l.x1) / 2, cy = (l.y0 + l.y1) / 2; return !!n && strong(n) && !l.words.some((w) => STAIR_WORD.test(norm(w.text))) && cx > b.x0 && cx < b.x1 && cy > b.y0 && cy < b.y1 })
  if (lines.length < 2) return
  // room names are the plan's larger text (inside the plan): about as high as most of them, notes are smaller
  const hs = lines.map((l) => med(l.words.map((w) => w.y1 - w.y0))).sort((a, b) => a - b)
  const bigH = hs[Math.floor(hs.length / 2)]
  const names = lines.filter((l) => med(l.words.map((w) => w.y1 - w.y0)) >= 0.6 * bigH).map((l) => ({ x: Math.floor((l.x0 + l.x1) / 2 - ox), y: Math.floor((l.y0 + l.y1) / 2 - oy) }))
  const pxM = g.pxPerM
  const n0 = stats.length
  for (let si = 0; si < n0; si++) {
    const st = stats[si]
    const inside = names.filter((p) => p.x >= 0 && p.y >= 0 && p.x < w && p.y < h && label[p.y * w + p.x] === st.id)
    if (inside.length < 2) continue
    const W = st.x1 - st.x0 + 1, H = st.y1 - st.y0 + 1
    const sub = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) sub[y * W + x] = label[(st.y0 + y) * w + st.x0 + x] === st.id ? 1 : 0
    // the drawn lines inside the space (room boundaries, glass, a void's edge, furniture) are costly to cross: the
    // space is shared among the names by the cheapest path from each (a geodesic Voronoi that follows the lines)
    const cost = new Uint8Array(W * H).fill(1)
    const P = Math.max(4, Math.min(120, Math.round(0.6 * pxM)))
    for (const sg of g.segs) {
      const ax = sg.a[0] - ox - st.x0, ay = sg.a[1] - oy - st.y0, bx = sg.b[0] - ox - st.x0, by = sg.b[1] - oy - st.y0
      const L = Math.hypot(bx - ax, by - ay)
      if (L < 0.3 * pxM) continue
      if (Math.max(ax, bx) < 0 || Math.min(ax, bx) >= W || Math.max(ay, by) < 0 || Math.min(ay, by) >= H) continue
      const n = Math.ceil(L * 2)
      for (let k = 0; k <= n; k++) {
        const x = Math.floor(ax + ((bx - ax) * k) / n), y = Math.floor(ay + ((by - ay) * k) / n)
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) cost[yy * W + xx] = 1 + P }
      }
    }
    // seeds: one per distinct name position (names closer than 0.8 m are one room's label lines)
    const seeds: { x: number; y: number }[] = []
    // label lines closer than 1.5 m are one room's label (a name on two lines)
    for (const p of inside) { const x = p.x - st.x0, y = p.y - st.y0; if (!seeds.some((q) => Math.hypot(q.x - x, q.y - y) < 1.5 * pxM)) seeds.push({ x, y }) }
    if (seeds.length < 2) continue
    const own = new Int32Array(W * H).fill(-1)
    const dist = new Float64Array(W * H).fill(Infinity)
    // Dial's buckets (integer costs ≤ 1 + P)
    const B = P + 2
    const buckets: number[][] = Array.from({ length: B }, () => [])
    let pending = 0
    seeds.forEach((sd, k) => {
      // the nearest pixel of the space to the label's centre
      let best = -1, bd = Infinity
      for (let y = Math.max(0, sd.y - 12); y < Math.min(H, sd.y + 13); y++) for (let x = Math.max(0, sd.x - 12); x < Math.min(W, sd.x + 13); x++) { const i = y * W + x; if (sub[i]) { const d = (x - sd.x) ** 2 + (y - sd.y) ** 2; if (d < bd) { bd = d; best = i } } }
      if (best >= 0 && dist[best] > 0) { dist[best] = 0; own[best] = k; buckets[0].push(best); pending++ }
    })
    for (let d = 0; pending > 0; d++) {
      const bk = buckets[d % B]
      while (bk.length) {
        const i = bk.pop()!
        pending--
        if (dist[i] < d) continue
        const x = i % W, y = (i - x) / W
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, yy = y + dy
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue
          const j = yy * W + xx
          if (!sub[j]) continue
          const nd = d + cost[j]
          if (nd < dist[j]) { dist[j] = nd; own[j] = own[i]; buckets[nd % B].push(j); pending++ }
        }
      }
    }
    {
      const areas = new Array(seeds.length).fill(0)
      for (let i = 0; i < own.length; i++) if (own[i] >= 0) areas[own[i]]++
      if (areas.some((a) => a < 2 * pxM * pxM)) continue
    }
    const seedOf = new Map(seeds.map((_, k) => [k, k]))
    // part 0 keeps the component's id, the others get new ones
    const ids = [...Array(seedOf.size).keys()].map((k) => (k === 0 ? st.id : stats.length + k - 1))
    const fresh: CompStat[] = ids.map((id) => ({ id, area: 0, x0: w, y0: h, x1: -1, y1: -1, sx: 0, sy: 0 }))
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (!sub[i] || own[i] < 0) continue
      const c = fresh[own[i]], X = st.x0 + x, Y = st.y0 + y
      label[Y * w + X] = c.id
      c.area++; c.sx += X; c.sy += Y
      if (X < c.x0) c.x0 = X
      if (X > c.x1) c.x1 = X
      if (Y < c.y0) c.y0 = Y
      if (Y > c.y1) c.y1 = Y
    }
    stats[si] = fresh[0]
    for (let k = 1; k < fresh.length; k++) stats.push(fresh[k])
    void pxM
  }
}

/** A pixel deep inside a component (largest distance to its edge, sampled). */
function interiorSeed(label: Int32Array, w: number, st: CompStat): Pt {
  const W = st.x1 - st.x0 + 1, H = st.y1 - st.y0 + 1
  const sub = mask(W, H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) sub.d[y * W + x] = label[(st.y0 + y) * w + st.x0 + x] === st.id ? 1 : 0
  const d = distanceToBackground(sub)
  let bi = 0
  for (let i = 0; i < d.length; i++) if (d[i] > d[bi]) bi = i
  return [st.x0 + (bi % W) + 0.5, st.y0 + Math.floor(bi / W) + 0.5]
}

/* ================================================================ the recogniser */

export interface InkInput {
  /** ink mask of the (corrected) picture */
  ink: Mask
  words: PWord[]
  /** the darkest ink (solid wall cores): the bands are looked for in it when given — a blurred photo's bold thin
   *  lines are grey, its poured walls black */
  dark?: Mask
}

/** Typical thin-line width (px): the most common short run across the ink. */
export function lineWidth(ink: Mask): number {
  const { hr, vr } = runLengths(ink)
  const hist = new Float64Array(64)
  for (let i = 0; i < ink.d.length; i++) if (ink.d[i]) { const v = Math.min(hr[i], vr[i]); if (v < 64) hist[v]++ }
  // weight per line (a run of width v is counted v times per unit length)
  let best = 1
  for (let v = 1; v < 8; v++) if (hist[v] / v > hist[best] / best) best = v
  return best
}

/**
 * Hollow walls (two thin faces): the closed background strips between the faces, narrower than the thickest wall
 * and at least `minW` wide, elongated, become ink (bands) — window sub-strips (a third of a wall) stay open.
 */
function fillOutlineWalls(ink: Mask, tMinPx: number, tMaxPx: number): Mask {
  const bg = mask(ink.w, ink.h)
  for (let i = 0; i < bg.d.length; i++) bg.d[i] = ink.d[i] ^ 1
  const { label, stats } = components(bg, 4)
  const dist = distanceToBackground(bg)
  const width = new Float64Array(stats.length)
  for (let i = 0; i < label.length; i++) if (label[i] >= 0 && dist[i] > width[label[i]]) width[label[i]] = dist[i]
  const out = cloneMask(ink)
  const widths: number[] = []
  const cand: number[] = []
  for (const st of stats) {
    const touches = st.x0 === 0 || st.y0 === 0 || st.x1 === ink.w - 1 || st.y1 === ink.h - 1
    const wd = 2 * width[st.id]
    if (touches || wd > tMaxPx || wd < Math.max(2, tMinPx * 0.8)) continue
    if (st.area < 3 * wd * wd) continue
    widths.push(wd)
    cand.push(st.id)
  }
  const mode = med(widths)
  const ok = new Set(cand.filter((id) => 2 * width[id] >= 0.6 * mode))
  for (let i = 0; i < label.length; i++) if (label[i] >= 0 && ok.has(label[i])) out.d[i] = 1
  return out
}

/** Pixel thicknesses of a band mask: the run across each pixel whose run along is long. */
function bandThicknesses(wm: Mask, L0: number): number[] {
  const { hr, vr } = runLengths(wm)
  const ts: number[] = []
  for (let i = 0; i < wm.d.length; i += 3) {
    if (!wm.d[i]) continue
    if (hr[i] >= L0 && vr[i] < L0) ts.push(vr[i])
    else if (vr[i] >= L0 && hr[i] < L0) ts.push(hr[i])
  }
  return ts
}

export function recognizePlan(input: InkInput, opt: RecogOptions): PlanGraph {
  const { ink, words } = input
  const W = ink.w, H = ink.h
  let pxM = opt.pxPerM
  const notes: string[] = []
  const lw = lineWidth(ink)
  // text pixels out of the line work (bold letters must not become walls)
  const noText = cloneMask(ink)
  // (only readings that look like text: letters / digits, read with some confidence, not a flat sliver over a line)
  for (const w of words) if (w.conf >= 50 && /[\p{L}\p{N}]/u.test(w.text) && w.y1 - w.y0 >= 5 && w.y1 - w.y0 < 0.6 * pxM) fillRect(noText, w.x0 - 1, w.y0 - 1, w.x1 + 1, w.y1 + 1, 0)

  // ---- 1. bands
  const k = opt.kernel ?? Math.max(3, lw + 2, Math.min(15, Math.round(0.08 * pxM)))
  let style: PlanGraph['style'] = 'filled'
  let wm = open(input.dark ? and(noText, input.dark) : noText, k)
  const L0 = Math.max(8, Math.round(0.4 * pxM))
  const longPieces = (m: Mask) => piecesOf(m, 'h', L0, Math.round(0.6 * pxM)).length + piecesOf(m, 'v', L0, Math.round(0.6 * pxM)).length
  if (opt.style === 'outline' || (opt.style !== 'filled' && longPieces(wm) < 4)) {
    const filled = fillOutlineWalls(noText, 0.06 * pxM, 0.5 * pxM)
    const wm2 = open(filled, k)
    if (opt.style === 'outline' || longPieces(wm2) > longPieces(wm)) { wm = wm2; style = 'outline' }
  }
  // the plan: the biggest cluster of bands (title-block frames, logos, legends left out); clusters at least a
  // quarter as heavy are kept too (a plan whose wings only meet through glazing)
  {
    const near = dilate(wm, Math.max(3, Math.round(2.5 * pxM)))
    const { label, stats } = components(near, 8)
    if (stats.length > 1) {
      const wgt = new Float64Array(stats.length)
      for (let i = 0; i < wm.d.length; i++) if (wm.d[i]) wgt[label[i]]++
      const top = Math.max(...wgt)
      const keep = new Set(stats.filter((st) => wgt[st.id] >= 0.25 * top).map((st) => st.id))
      for (let i = 0; i < wm.d.length; i++) if (wm.d[i] && !keep.has(label[i])) wm.d[i] = 0
      if (stats.length > keep.size) notes.push(`otherClusters:${stats.length - keep.size}`)
    }
  }
  let ts = bandThicknesses(wm, L0)
  if (ts.length < 20) {
    notes.push('noWalls')
    return { w: W, h: H, walls: [], openings: [], columns: [], rooms: [], flights: [], words, title: titleOf(words, null), scaleText: scaleOf(words), footprint: null, box: { x0: 0, y0: 0, x1: W, y1: H }, style, segs: [], arcs: [], pxPerM: pxM, notes }
  }
  // a scale estimate far off (walls < 50 mm or > 400 mm thick): re-estimated from the typical wall (150 mm)
  const tMed = med(ts)
  if (tMed / pxM * 1000 < 50 || tMed / pxM * 1000 > 400) { pxM = tMed / 0.15; notes.push('scaleFromWalls') }
  const tHist: Record<number, number> = {}
  for (const t of ts) tHist[t] = (tHist[t] ?? 0) + 1
  // the thickest common wall: the largest thickness holding ≥ 8 % of the band pixels
  const tMaxPx = Math.max(k, ...Object.entries(tHist).filter(([, n]) => n >= 0.08 * ts.length).map(([t]) => Number(t)))
  if (opt.debug) Object.assign(opt.debug, { lw, k, L0, tMaxPx, tHist })
  ts = []

  // plan box (bands), with a margin for the dimension lines and the title
  let bx0 = W, by0 = H, bx1 = 0, by1 = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (wm.d[y * W + x]) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y }
  const box = { x0: bx0, y0: by0, x1: bx1 + 1, y1: by1 + 1 }

  // ---- 2. columns: square blobs wider than the thickest wall
  const columns: PColumn[] = []
  {
    const kc = tMaxPx + 1
    const cm = open(wm, kc)
    const { stats } = components(cm, 4)
    for (const st of stats) {
      const cw = st.x1 - st.x0 + 1, cd = st.y1 - st.y0 + 1
      if (Math.max(cw, cd) > 3.2 * kc || Math.max(cw, cd) / Math.min(cw, cd) > 1.6) continue
      if (cw / pxM > 0.9 || cd / pxM > 0.9) continue
      // a column is drawn as a filled square / rectangle — a round blob (a hand-drawn stroke's round end at a corner)
      // is not one
      if (st.area / (cw * cd) < 0.82) continue
      // and wider than the walls it stands in (a thick wall's corner is not a column)
      if (Math.min(cw, cd) < tMaxPx + 2) continue
      columns.push({ id: nid('C'), x: st.x0 + cw / 2, y: st.y0 + cd / 2, w: cw, d: cd, conf: st.area / (cw * cd) > 0.85 ? 0.85 : 0.6 })
    }
  }
  const colMask = mask(W, H)
  for (const c of columns) fillRect(colMask, c.x - c.w / 2 - 1, c.y - c.d / 2 - 1, c.x + c.w / 2 + 1, c.y + c.d / 2 + 1)
  const wmc = minus(wm, colMask)
  for (const c of columns) { c.w = Math.max(1, c.w - lw); c.d = Math.max(1, c.d - lw) }

  // ---- 3. walls
  const tLimit = Math.round(Math.max(tMaxPx * 1.3, 0.5 * pxM))
  let pieces = [...piecesOf(wmc, 'h', L0, tLimit), ...piecesOf(wmc, 'v', L0, tLimit)]
  const filled = or(wm, colMask)
  pieces = mergeFilled(pieces, filled, Math.max(tMaxPx * 2.5, 0.6 * pxM))
  extendEnds(pieces, columns)
  pieces = mergeFilled(pieces, filled, Math.max(tMaxPx * 2.5, 0.6 * pxM))

  // slanted walls: elongated band parts no straight piece covers; small leftover blobs are knots (wall corners drawn
  // as a blob, small columns) — stops for the openings, never built
  const slanted: PWall[] = []
  const knots: { x0: number; y0: number; x1: number; y1: number }[] = []
  {
    const covered = mask(W, H)
    for (const p of pieces) if (p.o === 'h') fillRect(covered, p.s0 - 1, p.c - p.t / 2 - 1, p.s1 + 1, p.c + p.t / 2 + 1); else fillRect(covered, p.c - p.t / 2 - 1, p.s0 - 1, p.c + p.t / 2 + 1, p.s1 + 1)
    const rest = minus(wmc, covered)
    const { label, stats } = components(rest, 8)
    for (const st of stats) {
      if (st.area >= 1.5 * (k + 1) ** 2 && Math.min(st.x1 - st.x0, st.y1 - st.y0) + 1 >= k + 1 && Math.max(st.x1 - st.x0, st.y1 - st.y0) <= 0.8 * pxM) knots.push({ x0: st.x0, y0: st.y0, x1: st.x1 + 1, y1: st.y1 + 1 })
      if (st.area < L0 * 3) continue
      // principal axis
      let sxx = 0, syy = 0, sxy = 0
      const mx = st.sx / st.area, my = st.sy / st.area
      for (let y = st.y0; y <= st.y1; y++) for (let x = st.x0; x <= st.x1; x++) if (label[y * W + x] === st.id) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my) }
      const tr = sxx + syy, det = sxx * syy - sxy * sxy, l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det)), l2 = tr / 2 - Math.sqrt(Math.max(0, tr * tr / 4 - det))
      const len = Math.sqrt(12 * l1 / st.area), th = st.area / Math.max(1, len)
      if (len < L0 * 1.5 || len / Math.max(1, th) < 4 || Math.sqrt(12 * Math.max(0, l2) / st.area) > tLimit) continue
      const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(ang), uy = Math.sin(ang)
      slanted.push({ id: nid('W'), a: [mx - ux * len / 2, my - uy * len / 2], b: [mx + ux * len / 2, my + uy * len / 2], t: th, ext: false, conf: 0.6, by: 'slanted' })
    }
  }

  // ---- thin ink: everything that is not a band, a column or a word
  const pad = Math.round(0.25 * Math.max(box.x1 - box.x0, box.y1 - box.y0))
  const cx0 = Math.max(0, box.x0 - pad), cy0 = Math.max(0, box.y0 - pad), cx1 = Math.min(W, box.x1 + pad), cy1 = Math.min(H, box.y1 + pad)
  const thinInk = mask(cx1 - cx0, cy1 - cy0)
  const fat = dilate(filled, 3)
  for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) { const i = y * W + x; if (noText.d[i] && !fat.d[i]) thinInk.d[(y - cy0) * thinInk.w + x - cx0] = 1 }
  const { segs, arcs } = traceThin(thinInk, cx0, cy0)
  // a thin-ink picture without the bands, for the window lines
  const lines = mask(W, H)
  for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) lines.d[y * W + x] = thinInk.d[(y - cy0) * thinInk.w + x - cx0]

  // ---- 4. openings
  const walls: PWall[] = []
  const openings: POpening[] = []
  const usedArcs = new Set<PArc>()
  const doorMin = 0.5 * pxM, doorMax = 1.35 * pxM, gapMax = 6 * pxM
  const marks = words.filter((w) => MARK.test(w.text.trim()))
  const markNear = (x: number, y: number) => {
    let best: PWord | null = null, bd = 1.6 * pxM
    for (const w of marks) { const d = Math.hypot((w.x0 + w.x1) / 2 - x, (w.y0 + w.y1) / 2 - y); if (d < bd) { bd = d; best = w } }
    return best ? best.text.trim().toUpperCase() : null
  }
  /** Thin ink within ~1.5 px of a point. */
  const inkNear = (x: number, y: number) => {
    const xi = Math.round(x - 0.5), yi = Math.round(y - 0.5)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = xi + dx, yy = yi + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && lines.d[yy * W + xx]) return true }
    return false
  }
  /** Share of a quarter circle (12°…78°, clear of the leaf and the wall lines) drawn in thin ink. */
  const quarter = (cx: number, cy: number, r: number, sx: number, sy: number) => {
    let hit = 0
    for (let k = 0; k < 24; k++) { const t = ((12 + (66 * k) / 23) * Math.PI) / 180; if (inkNear(cx + sx * r * Math.cos(t), cy + sy * r * Math.sin(t))) hit++ }
    return hit / 24
  }
  /** Share of a straight stretch drawn in thin ink. */
  const along = (x0: number, y0: number, dx: number, dy: number, L: number) => {
    let hit = 0
    for (let k = 0; k < 16; k++) { const f = 0.15 + (0.7 * k) / 15; if (inkNear(x0 + dx * L * f, y0 + dy * L * f)) hit++ }
    return hit / 16
  }
  /**
   * Best swing arc with its hinge at `s` on the line (leaf closing towards `dir`), either side, radius ≈ r. A door
   * symbol is the arc plus the open leaf (perpendicular to the wall); the closed position (along the wall) is empty
   * — the same quarter circle read as a door of the perpendicular wall has it the other way round.
   */
  const swing = (o: 'h' | 'v', c: number, t: number, s: number, dir: 1 | -1, r: number, strict = false) => {
    let best = 0
    for (const side of [-1, 1])
      for (const off of [0, t / 2])
        for (const back of [0, t / 2])
        for (const k of [0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.25]) {
          // a hand-drawn wall stroke ends round, over the hinge: the hinge may sit half a wall back
          const R = r * k
          const sh = s - dir * back
          const [cx, cy] = o === 'h' ? [sh, c + side * off] : [c + side * off, sh]
          const arc = o === 'h' ? quarter(cx, cy, R, dir, side) : quarter(cx, cy, R, side, dir)
          if (arc < 0.6 || arc <= best) continue
          // open leaf: from the hinge across the wall; closed: from the hinge along the wall line
          const leaf = o === 'h' ? along(cx, cy, 0, side, R) : along(cx, cy, side, 0, R)
          // the closed position anywhere across the wall band (a leaf is drawn on a face, not on the centre line)
          let shut = 0
          for (const so of [-t / 2, 0, t / 2]) shut = Math.max(shut, o === 'h' ? along(sh, c + so, dir, 0, R) : along(c + so, sh, 0, dir, R))
          if (shut > 0.5) continue
          if (leaf < 0.5 && (strict || arc < 0.85)) continue
          best = arc
        }
    return best
  }
  /** Door swing for a gap [g0, g1] on a line (centre c): one arc of radius ≈ the gap hinged at an end, or two of
   *  half the gap hinged at both ends (double door). */
  const doorArc = (o: 'h' | 'v', c: number, t: number, g0: number, g1: number): { conf: number; why: string } | null => {
    const g = g1 - g0
    const one = Math.max(swing(o, c, t, g0, 1, g), swing(o, c, t, g1, -1, g))
    const two = Math.min(swing(o, c, t, g0, 1, g / 2), swing(o, c, t, g1, -1, g / 2))
    if (two >= 0.6 && two >= one - 0.1 && g >= 1.0 * pxM) return { conf: Math.min(0.95, 0.4 + two / 2), why: 'arcs' }
    if (one >= 0.6) return { conf: Math.min(0.95, 0.4 + one / 2), why: 'arc' }
    return null
  }
  /** A door narrower than its gap (a short wall stub beside it): the best arc hinged at either end, radius between a
   *  door's limits; returns the door's stretch. */
  const partialDoor = (o: 'h' | 'v', c: number, t: number, g0: number, g1: number): { s0: number; s1: number; conf: number } | null => {
    let best: { s0: number; s1: number; conf: number } | null = null
    for (let r = doorMin; r <= Math.min(doorMax, g1 - g0 - 3); r += 1.5) {
      const a = swing(o, c, t, g0, 1, r, true), b = swing(o, c, t, g1, -1, r, true)
      if (a >= 0.7 && (!best || a > best.conf)) best = { s0: g0, s1: g0 + r, conf: a }
      if (b >= 0.7 && (!best || b > best.conf)) best = { s0: g1 - r, s1: g1, conf: b }
    }
    return best ? { ...best, conf: Math.min(0.9, 0.35 + best.conf / 2) } : null
  }
  /** Window: ≥ 2 thin lines across the gap inside the wall band. */
  const windowLines = (o: 'h' | 'v', c: number, t: number, g0: number, g1: number): number => {
    const v = view(lines, o)
    const a0 = Math.max(0, Math.floor(c - t / 2 - 2)), a1 = Math.min(v.A - 1, Math.ceil(c + t / 2 + 1))
    const s0 = Math.round(g0 + 2), s1 = Math.round(g1 - 2)
    if (s1 - s0 < 4) return 0
    let groups = 0, inG = false
    for (let a = a0; a <= a1; a++) {
      let n = 0
      for (let s = s0; s < s1; s++) n += v.get(s, a)
      // a row of ink with a dilation tolerance of the adjacent rows
      const row = n / (s1 - s0) >= 0.7
      if (row && !inG) groups++
      inG = row
    }
    return groups
  }
  const emptyGap = (o: 'h' | 'v', c: number, t: number, g0: number, g1: number) => cover(lines, o, c, t + 2, g0 + 1, g1 - 1) < 0.08

  const lineList = linesOf(pieces)
  const stopsOf = (o: 'h' | 'v', c: number, t: number) => {
    // perpendicular pieces and columns crossing this centre line: [s0, s1] along it
    const out: [number, number][] = []
    const tol = Math.max(t / 2 + 2, 0.08 * pxM)
    for (const q of pieces) if (q.o !== o && c >= q.s0 - tol && c <= q.s1 + tol) out.push([q.c - q.t / 2, q.c + q.t / 2])
    for (const b of knots) { const a0 = o === 'h' ? b.y0 : b.x0, a1 = o === 'h' ? b.y1 : b.x1; if (c >= a0 - 1 && c <= a1 + 1) out.push(o === 'h' ? [b.x0, b.x1] : [b.y0, b.y1]) }
    for (const col of columns) { const acr = o === 'h' ? col.y : col.x, al = o === 'h' ? col.x : col.y, hw = (o === 'h' ? col.w : col.d) / 2, ha = (o === 'h' ? col.d : col.w) / 2; if (Math.abs(acr - c) <= ha + 1) out.push([al - hw, al + hw]) }
    return out.sort((a, b) => a[0] - b[0])
  }
  for (const line of lineList) {
    const o = line[0].o
    const tt = med(line.map((p) => p.t))
    const cc = line.reduce((a, p) => a + p.c * (p.s1 - p.s0), 0) / line.reduce((a, p) => a + (p.s1 - p.s0), 0)
    type Op = { kind: POpening['kind']; s0: number; s1: number; conf: number; why: string[] }
    const classify = (g0: number, g1: number, between: boolean): Op | null => {
      const g = g1 - g0
      if (g < doorMin * 0.8 || g > gapMax) return null
      const P = (s: number): Pt => (o === 'h' ? [s, cc] : [cc, s])
      const mid = P((g0 + g1) / 2)
      const mk = markNear(mid[0], mid[1])
      const d = g <= doorMax * 2.1 ? doorArc(o, cc, tt, g0, g1) : null
      if (d) return { kind: 'door', s0: g0, s1: g1, conf: d.conf, why: [d.why, ...(mk ? ['tag'] : [])] }
      const pd = g > doorMin * 1.3 && g <= 3 * pxM ? partialDoor(o, cc, tt, g0, g1) : null
      if (pd) return { kind: 'door', s0: pd.s0, s1: pd.s1, conf: pd.conf, why: ['arc', 'stub', ...(mk ? ['tag'] : [])] }
      const nl = windowLines(o, cc, tt, g0, g1)
      if (nl >= 1) return { kind: 'window', s0: g0, s1: g1, conf: nl >= 3 ? 0.85 : nl === 2 ? 0.75 : 0.6, why: [`glazing ${nl}`, ...(mk ? ['tag'] : [])] }
      if (mk && /^(W|S|CS|CW|SW)/i.test(mk)) return { kind: 'window', s0: g0, s1: g1, conf: 0.55, why: ['tag'] }
      if (mk && /^(D|CD|CĐ|DW)/i.test(mk)) return { kind: 'door', s0: g0, s1: g1, conf: 0.55, why: ['tag'] }
      if (between && g <= 2.5 * pxM && emptyGap(o, cc, tt, g0, g1)) return { kind: 'opening', s0: g0, s1: g1, conf: 0.45, why: ['gap'] }
      return null
    }
    // the line's pieces and the stops on it (perpendicular walls, columns), in order: chains joined where they touch
    // or where the gap between them is an opening; a chain with a piece of this line becomes one wall
    type Iv = { s0: number; s1: number; piece: boolean }
    const ivs: Iv[] = [...line.map((p) => ({ s0: p.s0, s1: p.s1, piece: true })), ...stopsOf(o, cc, tt).map(([s0, s1]) => ({ s0, s1, piece: false }))].sort((p, q) => p.s0 - q.s0)
    type Chain = { ivs: Iv[]; ops: Op[] }
    const chains: Chain[] = []
    let cur: Chain = { ivs: [ivs[0]], ops: [] }
    let reach = ivs[0].s1
    for (let i = 1; i < ivs.length; i++) {
      const iv = ivs[i]
      if (iv.s0 <= reach + 1.5) { cur.ivs.push(iv); reach = Math.max(reach, iv.s1); continue }
      const prevPiece = cur.ivs[cur.ivs.length - 1].piece
      // a short gap (a window's frame, a broken band, a junction drawn apart): the chain goes on
      if (iv.s0 - reach < doorMin * 0.8) {
        const last = cur.ops[cur.ops.length - 1]
        if (last && last.s1 >= reach - 1.5 && last.kind === 'window') last.s1 = iv.s0
        cur.ivs.push(iv); reach = Math.max(reach, iv.s1); continue
      }
      const op = classify(reach, iv.s0, prevPiece && iv.piece)
      if (op) { cur.ops.push(op); cur.ivs.push(iv); reach = Math.max(reach, iv.s1); continue }
      chains.push(cur)
      cur = { ivs: [iv], ops: [] }
      reach = iv.s1
    }
    chains.push(cur)
    for (const ch of chains) {
      const pcs = ch.ivs.filter((x) => x.piece)
      if (!pcs.length) continue
      // the wall runs over its pieces and openings; a stop at an end of it gives the end (its centre line)
      const used = [...pcs.map((x) => [x.s0, x.s1]), ...ch.ops.map((op) => [op.s0, op.s1])]
      let s0 = Math.min(...used.map((u) => u[0])), s1 = Math.max(...used.map((u) => u[1]))
      // a chain ending on a stop (a perpendicular wall, a column) ends on its centre
      const F = ch.ivs[0], Lst = ch.ivs[ch.ivs.length - 1]
      if (!F.piece) s0 = Math.min(s0, (F.s0 + F.s1) / 2)
      if (!Lst.piece) s1 = Math.max(s1, (Lst.s0 + Lst.s1) / 2)
      const wid = nid('W')
      const a: Pt = o === 'h' ? [s0, cc] : [cc, s0], b: Pt = o === 'h' ? [s1, cc] : [cc, s1]
      // the band includes the outline stroke of the drawing (half a line on each face)
      walls.push({ id: wid, a, b, t: Math.max(1, tt - lw), ext: false, conf: 0.9, by: style === 'outline' ? 'outline' : 'band' })
      for (const op of ch.ops) openings.push({ id: nid('O'), wall: wid, kind: op.kind, s0: op.s0 - s0, s1: op.s1 - s0, conf: op.conf, why: op.why, mark: markNear(...(o === 'h' ? [(op.s0 + op.s1) / 2, cc] : [cc, (op.s0 + op.s1) / 2]) as [number, number]) })
    }
  }
  walls.push(...slanted)

  // glazing with no wall piece on its line (curtain walls between two stops): ≥ 2 long parallel thin lines
  {
    const tExt = tMaxPx
    for (const o of ['h', 'v'] as const) {
      const ls = segs.filter((s) => (o === 'h' ? Math.abs(s.b[1] - s.a[1]) < 1.2 : Math.abs(s.b[0] - s.a[0]) < 1.2)).map((s) => {
        const s0 = o === 'h' ? Math.min(s.a[0], s.b[0]) : Math.min(s.a[1], s.b[1]), s1 = o === 'h' ? Math.max(s.a[0], s.b[0]) : Math.max(s.a[1], s.b[1])
        return { c: o === 'h' ? (s.a[1] + s.b[1]) / 2 : (s.a[0] + s.b[0]) / 2, s0, s1 }
      }).filter((s) => s.s1 - s.s0 >= 0.6 * pxM)
      const used = new Set<number>()
      ls.forEach((s, i) => {
        if (used.has(i)) return
        const group = ls.map((q, j) => ({ q, j })).filter(({ q }) => Math.abs(q.c - s.c) <= tExt * 1.3 && Math.min(q.s1, s.s1) - Math.max(q.s0, s.s0) >= 0.8 * Math.min(q.s1 - q.s0, s.s1 - s.s0))
        if (group.length < 2) return
        const c0 = Math.min(...group.map((g) => g.q.c)), c1 = Math.max(...group.map((g) => g.q.c))
        if (c1 - c0 < 2) return
        const g0 = med(group.map((g) => g.q.s0)), g1 = med(group.map((g) => g.q.s1))
        const cc = (c0 + c1) / 2
        // already a window of a wall here?
        const covered = walls.some((w) => {
          const wo = Math.abs(w.a[1] - w.b[1]) < 1e-6 ? 'h' : Math.abs(w.a[0] - w.b[0]) < 1e-6 ? 'v' : null
          if (wo !== o) return false
          const wc = o === 'h' ? w.a[1] : w.a[0], ws0 = o === 'h' ? Math.min(w.a[0], w.b[0]) : Math.min(w.a[1], w.b[1]), ws1 = o === 'h' ? Math.max(w.a[0], w.b[0]) : Math.max(w.a[1], w.b[1])
          return Math.abs(wc - cc) <= w.t && ws0 <= g0 + 2 && ws1 >= g1 - 2
        })
        if (covered) { group.forEach((g) => used.add(g.j)); return }
        // both ends at a stop (a wall or a column) within a wall thickness
        const st = stopsOf(o, cc, tExt)
        const atStart = st.find((x) => Math.abs(x[1] - g0) <= tExt + 3 || (x[0] <= g0 && x[1] >= g0))
        const atEnd = st.find((x) => Math.abs(x[0] - g1) <= tExt + 3 || (x[0] <= g1 && x[1] >= g1))
        if (!atStart || !atEnd) return
        group.forEach((g) => used.add(g.j))
        const s0 = (atStart[0] + atStart[1]) / 2, s1 = (atEnd[0] + atEnd[1]) / 2
        const a: Pt = o === 'h' ? [s0, cc] : [cc, s0], b: Pt = o === 'h' ? [s1, cc] : [cc, s1]
        walls.push({ id: nid('W'), a, b, t: Math.max(c1 - c0 + lw, tExt * 0.8), ext: false, curtain: true, conf: 0.7, by: 'glazing' })
      })
    }
  }

  // doors whose wall has no band at all (a door filling the stretch between two walls): the arc and two stops
  {
    const tInt = Math.max(2, med(walls.filter((w) => !w.curtain).map((w) => w.t).sort((a, b) => a - b).slice(0, Math.max(1, Math.ceil(walls.length / 2)))))
    for (const a of arcs) {
      if (usedArcs.has(a) || a.r < doorMin || a.r > doorMax || a.sweep < 70 || a.sweep > 110) continue
      for (const e of a.ends) {
        const dx = e[0] - a.c[0], dy = e[1] - a.c[1]
        const o: 'h' | 'v' | null = Math.abs(dy) < 0.2 * a.r ? 'h' : Math.abs(dx) < 0.2 * a.r ? 'v' : null
        if (!o) continue
        const cc = o === 'h' ? a.c[1] : a.c[0]
        const sA = o === 'h' ? a.c[0] : a.c[1], sE = o === 'h' ? e[0] : e[1]
        const g0 = Math.min(sA, sE), g1 = Math.max(sA, sE)
        const st = stopsOf(o, cc, tInt)
        const before = st.find((x) => x[1] >= g0 - 0.15 * pxM && x[1] <= g0 + 3)
        const after = st.find((x) => x[0] <= g1 + 0.15 * pxM && x[0] >= g1 - 3)
        if (!before || !after) continue
        // not where a wall already runs
        if (walls.some((w) => { const wo = Math.abs(w.a[1] - w.b[1]) < 1e-6 ? 'h' : 'v'; if (wo !== o) return false; const wc = o === 'h' ? w.a[1] : w.a[0]; const ws0 = o === 'h' ? Math.min(w.a[0], w.b[0]) : Math.min(w.a[1], w.b[1]), ws1 = o === 'h' ? Math.max(w.a[0], w.b[0]) : Math.max(w.a[1], w.b[1]); return Math.abs(wc - cc) < w.t + 2 && ws1 > g0 + 2 && ws0 < g1 - 2 })) continue
        const s0 = (before[0] + before[1]) / 2, s1 = (after[0] + after[1]) / 2
        const wid = nid('W')
        walls.push({ id: wid, a: o === 'h' ? [s0, cc] : [cc, s0], b: o === 'h' ? [s1, cc] : [cc, s1], t: tInt, ext: false, conf: 0.6, by: 'door' })
        openings.push({ id: nid('O'), wall: wid, kind: 'door', s0: Math.max(0, before[1] - s0), s1: Math.min(s1 - s0, after[0] - s0), conf: 0.7, why: ['arc', 'stops'], mark: markNear(...((o === 'h' ? [(g0 + g1) / 2, cc] : [cc, (g0 + g1) / 2]) as [number, number])) })
        usedArcs.add(a)
        break
      }
    }
  }

  dedupe(walls, openings)

  // ---- 5. rooms, exterior flags, footprint
  const g: PlanGraph = { w: W, h: H, walls, openings, columns, rooms: [], flights: [], words, title: null, scaleText: scaleOf(words), footprint: null, box, style, segs, arcs, pxPerM: pxM, notes }
  const closers = virtualClosers(g)
  const rr = roomsFromWalls(g, closers)
  g.rooms = rr.rooms
  g.footprint = rr.footprint
  for (const w of g.walls) w.ext = rr.ext.has(w.id)
  g.title = titleOf(words, box)
  g.flights = flightsOf(segs, g.rooms, pxM)
  if (closers.length) notes.push(`gapsClosedVirtual:${closers.length}`)
  const unnamed = g.rooms.filter((r) => !r.name).length
  if (unnamed) notes.push(`unnamedRooms:${unnamed}`)
  const lowOps = openings.filter((o) => o.conf < 0.6).length
  if (lowOps) notes.push(`openingsNoSymbol:${lowOps}`)
  return g
}

/** Axis of a wall: 'h' / 'v' / null (slanted), its centre coordinate and extent. */
export function axisOf(w: Pick<PWall, 'a' | 'b'>): { o: 'h' | 'v'; c: number; s0: number; s1: number } | null {
  if (Math.abs(w.a[1] - w.b[1]) < 1e-6) return { o: 'h', c: w.a[1], s0: Math.min(w.a[0], w.b[0]), s1: Math.max(w.a[0], w.b[0]) }
  if (Math.abs(w.a[0] - w.b[0]) < 1e-6) return { o: 'v', c: w.a[0], s0: Math.min(w.a[1], w.b[1]), s1: Math.max(w.a[1], w.b[1]) }
  return null
}

/**
 * Duplicates from two readings of one wall (two centre lines a pixel apart, a window seen from both): a wall lying
 * inside another one's band for ≥ 80 % of its length goes (its openings move to the other when free); of two
 * openings covering the same stretch the more confident stays.
 */
export function dedupe(walls: PWall[], openings: POpening[]) {
  const span = (o: POpening) => {
    const w = walls.find((x) => x.id === o.wall)!
    const ax = axisOf(w)
    if (!ax) return null
    const dir = (ax.o === 'h' ? w.b[0] - w.a[0] : w.b[1] - w.a[1]) >= 0 ? 1 : -1
    const base = ax.o === 'h' ? w.a[0] : w.a[1]
    const p0 = base + dir * o.s0, p1 = base + dir * o.s1
    return { o: ax.o, c: ax.c, t: w.t, s0: Math.min(p0, p1), s1: Math.max(p0, p1) }
  }
  const order = walls.map((w, i) => ({ w, i, ax: axisOf(w) })).filter((x) => x.ax).sort((p, q) => (q.ax!.s1 - q.ax!.s0) - (p.ax!.s1 - p.ax!.s0))
  const gone = new Set<string>()
  for (const { w, ax } of order) {
    if (gone.has(w.id)) continue
    for (const { w: v, ax: bx } of order) {
      if (v === w || gone.has(v.id) || bx!.o !== ax!.o) continue
      if (Math.abs(bx!.c - ax!.c) > Math.max(w.t, v.t) / 2 + 1) continue
      const ov = Math.min(ax!.s1, bx!.s1) - Math.max(ax!.s0, bx!.s0)
      if (ov < 0.8 * (bx!.s1 - bx!.s0)) continue
      gone.add(v.id)
      for (const op of openings.filter((x) => x.wall === v.id)) {
        const sp = span(op)!
        const dir = (ax!.o === 'h' ? w.b[0] - w.a[0] : w.b[1] - w.a[1]) >= 0 ? 1 : -1
        const base = ax!.o === 'h' ? w.a[0] : w.a[1]
        op.wall = w.id
        op.s0 = dir > 0 ? sp.s0 - base : base - sp.s1
        op.s1 = dir > 0 ? sp.s1 - base : base - sp.s0
      }
    }
  }
  for (let i = walls.length - 1; i >= 0; i--) if (gone.has(walls[i].id)) walls.splice(i, 1)
  const sp = openings.map(span)
  const drop = new Set<number>()
  for (let i = 0; i < openings.length; i++)
    for (let j = i + 1; j < openings.length; j++) {
      const a = sp[i], b = sp[j]
      if (!a || !b || drop.has(i) || drop.has(j) || a.o !== b.o || Math.abs(a.c - b.c) > Math.max(a.t, b.t) + 2) continue
      const ov = Math.min(a.s1, b.s1) - Math.max(a.s0, b.s0)
      if (ov < 0.3 * Math.min(a.s1 - a.s0, b.s1 - b.s0)) continue
      drop.add(openings[i].conf >= openings[j].conf ? j : i)
    }
  for (const i of [...drop].sort((p, q) => q - p)) openings.splice(i, 1)
}

/** Gaps between collinear walls (≤ 4 m, not an opening) closed for the rooms only. */
export function virtualClosers(g: PlanGraph): { a: Pt; b: Pt; t: number }[] {
  const out: { a: Pt; b: Pt; t: number }[] = []
  const pxM = g.pxPerM
  const orient = (w: PWall) => (Math.abs(w.a[1] - w.b[1]) < 1e-6 ? 'h' : Math.abs(w.a[0] - w.b[0]) < 1e-6 ? 'v' : null)
  const ws = g.walls.filter((w) => orient(w)).map((w) => {
    const o = orient(w)!
    return { w, o, c: o === 'h' ? w.a[1] : w.a[0], s0: o === 'h' ? Math.min(w.a[0], w.b[0]) : Math.min(w.a[1], w.b[1]), s1: o === 'h' ? Math.max(w.a[0], w.b[0]) : Math.max(w.a[1], w.b[1]) }
  })
  for (const a of ws)
    for (const b of ws) {
      if (a === b || a.o !== b.o || Math.abs(a.c - b.c) > Math.max(2, 0.5 * Math.min(a.w.t, b.w.t)) || b.s0 <= a.s1) continue
      const gap = b.s0 - a.s1
      if (gap > 4 * pxM) continue
      // the nearest one only
      if (ws.some((c) => c !== b && c.o === a.o && Math.abs(c.c - a.c) <= Math.max(2, 0.5 * a.w.t) && c.s0 > a.s1 && c.s0 < b.s0)) continue
      const t = Math.min(a.w.t, b.w.t)
      out.push(a.o === 'h' ? { a: [a.s1, a.c], b: [b.s0, a.c], t } : { a: [a.c, a.s1], b: [a.c, b.s0], t })
    }
  return out
}

/** The drawing title: the tallest text line saying "MẶT BẰNG …" / "… PLAN" (under the plan preferred). */
export function titleOf(words: PWord[], box: PlanGraph['box'] | null): string | null {
  const ls = textLines(words).filter((l) => /\b(MAT BANG|MB|PLAN|TANG|FLOOR)\b/.test(norm(l.text)) && l.text.length >= 5)
  if (!ls.length) return null
  const score = (l: (typeof ls)[number]) => (l.y1 - l.y0) * (/\bMAT BANG\b|\bPLAN\b/.test(norm(l.text)) ? 3 : 1) * (box && l.y0 >= box.y1 - 2 ? 1.5 : 1)
  const best = ls.sort((a, b) => score(b) - score(a))[0]
  return best.words.map((w) => lexiconWord(w.text) ?? w.text).join(' ').replace(/\s+/g, ' ').trim()
}

/** "TỶ LỆ 1:100", "TL 1/50", "SCALE 1:100" → 100. */
export function scaleOf(words: PWord[]): number | null {
  for (const l of textLines(words)) {
    const m = /\b(TY LE|TL|SCALE)\s*:?\s*1\s*[:/]\s*(\d{1,4})\b/.exec(norm(l.text))
    if (m) return Number(m[2])
  }
  return null
}

/** Stair flights: ≥ 5 parallel thin lines of similar length, evenly spaced (treads), inside one room. */
export function flightsOf(segs: PSeg[], rooms: PRoom[], pxM: number): PFlight[] {
  const out: PFlight[] = []
  for (const o of ['h', 'v'] as const) {
    const ls = segs.filter((s) => (o === 'h' ? Math.abs(s.b[1] - s.a[1]) < 1.2 : Math.abs(s.b[0] - s.a[0]) < 1.2)).map((s) => ({
      c: o === 'h' ? (s.a[1] + s.b[1]) / 2 : (s.a[0] + s.b[0]) / 2,
      s0: o === 'h' ? Math.min(s.a[0], s.b[0]) : Math.min(s.a[1], s.b[1]),
      s1: o === 'h' ? Math.max(s.a[0], s.b[0]) : Math.max(s.a[1], s.b[1]),
    })).filter((s) => s.s1 - s.s0 >= 0.6 * pxM && s.s1 - s.s0 <= 2.2 * pxM).sort((a, b) => a.c - b.c)
    const used = new Set<number>()
    for (let i = 0; i < ls.length; i++) {
      if (used.has(i)) continue
      const run = [i]
      for (let j = i + 1; j < ls.length; j++) {
        const p = ls[run[run.length - 1]], q = ls[j]
        const gap = q.c - p.c
        if (gap < 0.15 * pxM) continue
        if (gap > 0.4 * pxM) break
        if (Math.abs(q.s0 - ls[i].s0) > 0.12 * pxM || Math.abs(q.s1 - ls[i].s1) > 0.12 * pxM) continue
        if (run.length >= 2) { const g0 = ls[run[1]].c - ls[run[0]].c; if (Math.abs(gap - g0) > 0.25 * g0) continue }
        run.push(j)
      }
      if (run.length < 5) continue
      run.forEach((k) => used.add(k))
      const first = ls[run[0]], last = ls[run[run.length - 1]]
      const going = (last.c - first.c) / (run.length - 1)
      const s0 = med(run.map((k) => ls[k].s0)), s1 = med(run.map((k) => ls[k].s1))
      const mid = (s0 + s1) / 2
      const a: Pt = o === 'h' ? [mid, first.c] : [first.c, mid], b: Pt = o === 'h' ? [mid, last.c] : [last.c, mid]
      void rooms
      out.push({ a, b, width: s1 - s0, treads: run.length, going, conf: 0.6 })
    }
  }
  return out
}
