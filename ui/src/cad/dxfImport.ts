import type { Entity, Vec2 } from './types'

/**
 * ASCII DXF import (R12 … 2018) for the prototype model.
 *
 * Model space only. Blocks (INSERT, incl. MINSERT arrays and nested blocks), dimensions and tables
 * are exploded from their block definitions, so they look as they do in AutoCAD. Curves the model
 * has no primitive for (bulged polylines, ellipses, splines, hatch boundaries) are approximated by
 * polylines and counted in `approximated`. Anything else is counted in `skipped` — never dropped
 * silently.
 */
export interface DxfImport {
  entities: Entity[]
  layers: { name: string; visible: boolean }[]
  skipped: Record<string, number>
  approximated: Record<string, number>
  /** Model-space records read (before block explosion). */
  records: number
}

type Pair = [number, string]
interface Rec {
  type: string
  props: Pair[]
  /** VERTEX records of a POLYLINE, ATTRIB records of an INSERT. */
  children: Rec[]
}
interface Block {
  base: Vec2
  recs: Rec[]
}
/** Affine 2D transform: x' = a·x + c·y + e, y' = b·x + d·y + f. */
interface M {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

const I: M = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
const mul = (p: M, q: M): M => ({
  a: p.a * q.a + p.c * q.b,
  b: p.b * q.a + p.d * q.b,
  c: p.a * q.c + p.c * q.d,
  d: p.b * q.c + p.d * q.d,
  e: p.a * q.e + p.c * q.f + p.e,
  f: p.b * q.e + p.d * q.f + p.f,
})
const ap = (m: M, p: Vec2): Vec2 => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f })
const det = (m: M) => m.a * m.d - m.b * m.c
const D2R = Math.PI / 180

function pairsOf(text: string): Pair[] {
  const raw = text.split(/\r?\n/)
  const out: Pair[] = []
  for (let i = 0; i + 1 < raw.length; i += 2) out.push([parseInt(raw[i], 10), raw[i + 1].trim()])
  return out
}

/** Records of the section whose name is `name`, with VERTEX/ATTRIB children attached. */
function section(pairs: Pair[], name: string): Pair[] {
  for (let i = 0; i + 1 < pairs.length; i++)
    if (pairs[i][0] === 0 && pairs[i][1] === 'SECTION' && pairs[i + 1][0] === 2 && pairs[i + 1][1] === name) {
      let j = i + 2
      while (j < pairs.length && !(pairs[j][0] === 0 && pairs[j][1] === 'ENDSEC')) j++
      return pairs.slice(i + 2, j)
    }
  return []
}

function records(pairs: Pair[]): Rec[] {
  const flat: Rec[] = []
  let i = 0
  while (i < pairs.length) {
    if (pairs[i][0] !== 0) { i++; continue }
    const rec: Rec = { type: pairs[i][1], props: [], children: [] }
    i++
    while (i < pairs.length && pairs[i][0] !== 0) rec.props.push(pairs[i++])
    flat.push(rec)
  }
  // attach VERTEX → POLYLINE and ATTRIB → INSERT (both terminated by SEQEND)
  const out: Rec[] = []
  for (let k = 0; k < flat.length; k++) {
    const r = flat[k]
    if ((r.type === 'POLYLINE' || r.type === 'INSERT') && (r.type === 'POLYLINE' || num(r, 66) === 1)) {
      const child = r.type === 'POLYLINE' ? 'VERTEX' : 'ATTRIB'
      while (k + 1 < flat.length && flat[k + 1].type === child) r.children.push(flat[++k])
      if (flat[k + 1]?.type === 'SEQEND') k++
    }
    out.push(r)
  }
  return out
}

function num(r: Rec, code: number, def = 0): number {
  for (const [c, v] of r.props) if (c === code) { const n = parseFloat(v); return Number.isFinite(n) ? n : def }
  return def
}
function str(r: Rec, code: number, def = ''): string {
  for (const [c, v] of r.props) if (c === code) return v
  return def
}
function all(r: Rec, code: number): number[] {
  const out: number[] = []
  for (const [c, v] of r.props) if (c === code) out.push(parseFloat(v))
  return out
}

/** MTEXT/TEXT control codes → plain text. */
export function dxfText(s: string): string {
  return s
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\[Pp]/g, ' ')
    .replace(/\\~/g, ' ')
    .replace(/\\S([^;]*?)[#^/]([^;]*?);/g, '$1/$2')
    .replace(/\\[A-Za-z][^;\\{}]*;/g, '')
    .replace(/\\[LlOoKk]/g, '')
    .replace(/[{}]/g, '')
    .replace(/%%[cC]/g, '⌀')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/%%%/g, '%')
    .replace(/%%[uUoO]/g, '')
    .replace(/\\\\/g, '\\')
    .trim()
}

/** Arc from bulge between p and q, sampled (bulge = tan(θ/4)). */
function bulgePts(p: Vec2, q: Vec2, bulge: number): Vec2[] {
  if (Math.abs(bulge) < 1e-9) return []
  const theta = 4 * Math.atan(bulge)
  const chord = Math.hypot(q.x - p.x, q.y - p.y)
  if (chord < 1e-12) return []
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2))
  const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2
  const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2)) * Math.sign(bulge) * (Math.abs(theta) > Math.PI ? -1 : 1)
  const nx = -(q.y - p.y) / chord, ny = (q.x - p.x) / chord
  const c = { x: mx + nx * h, y: my + ny * h }
  const a0 = Math.atan2(p.y - c.y, p.x - c.x)
  const n = Math.max(2, Math.ceil(Math.abs(theta) / (Math.PI / 16)))
  const out: Vec2[] = []
  for (let k = 1; k < n; k++) {
    const a = a0 + (theta * k) / n
    out.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) })
  }
  return out
}

/** Vertices with optional bulges → points (arcs expanded). */
function withBulges(pts: Vec2[], bulges: number[], closed: boolean): { pts: Vec2[]; bulged: boolean } {
  const out: Vec2[] = []
  let bulged = false
  const n = pts.length
  for (let k = 0; k < n; k++) {
    out.push(pts[k])
    const b = bulges[k] ?? 0
    if (b && (k + 1 < n || closed)) { out.push(...bulgePts(pts[k], pts[(k + 1) % n], b)); bulged = true }
  }
  return { pts: out, bulged }
}

function arcPts(c: Vec2, r: number, a0: number, a1: number, ccw = true): Vec2[] {
  let sweep = ccw ? a1 - a0 : a0 - a1
  while (sweep <= 0) sweep += 2 * Math.PI
  const n = Math.max(4, Math.ceil(sweep / (Math.PI / 24)))
  const s = ccw ? 1 : -1
  return Array.from({ length: n + 1 }, (_, k) => {
    const a = a0 + (s * sweep * k) / n
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) }
  })
}

function ellipsePts(c: Vec2, major: Vec2, ratio: number, t0: number, t1: number): Vec2[] {
  let sweep = t1 - t0
  while (sweep <= 0) sweep += 2 * Math.PI
  const n = Math.max(8, Math.ceil(sweep / (Math.PI / 32)))
  const minor = { x: -major.y * ratio, y: major.x * ratio }
  return Array.from({ length: n + 1 }, (_, k) => {
    const t = t0 + (sweep * k) / n
    return { x: c.x + major.x * Math.cos(t) + minor.x * Math.sin(t), y: c.y + major.y * Math.cos(t) + minor.y * Math.sin(t) }
  })
}

/** Rational B-spline (de Boor), sampled. Falls back to the control polygon on bad data. */
function splinePts(deg: number, knots: number[], ctrl: Vec2[], w: number[]): Vec2[] {
  const n = ctrl.length
  if (deg < 1 || n <= deg || knots.length !== n + deg + 1) return ctrl
  const W = ctrl.map((_, i) => w[i] ?? 1)
  const lo = knots[deg], hi = knots[n]
  const samples = Math.min(400, n * 8)
  const out: Vec2[] = []
  for (let s = 0; s <= samples; s++) {
    const t = lo + ((hi - lo) * s) / samples
    let k = deg
    while (k < n - 1 && t >= knots[k + 1]) k++
    const d = Array.from({ length: deg + 1 }, (_, j) => {
      const p = ctrl[k - deg + j], ww = W[k - deg + j]
      return { x: p.x * ww, y: p.y * ww, w: ww }
    })
    for (let r = 1; r <= deg; r++)
      for (let j = deg; j >= r; j--) {
        const i = k - deg + j
        const den = knots[i + deg - r + 1] - knots[i]
        const al = den === 0 ? 0 : (t - knots[i]) / den
        d[j] = { x: (1 - al) * d[j - 1].x + al * d[j].x, y: (1 - al) * d[j - 1].y + al * d[j].y, w: (1 - al) * d[j - 1].w + al * d[j].w }
      }
    out.push({ x: d[deg].x / d[deg].w, y: d[deg].y / d[deg].w })
  }
  return out
}

/** HATCH boundary loops, parsed sequentially (the group codes repeat per path / edge). */
function hatchLoops(r: Rec): Vec2[][] {
  const p = r.props
  let i = p.findIndex(([c]) => c === 91)
  if (i < 0) return []
  const loops: Vec2[][] = []
  const nPaths = parseInt(p[i][1], 10)
  i++
  const next = (code: number) => {
    while (i < p.length && p[i][0] !== code) i++
    return i < p.length ? parseFloat(p[i++][1]) : NaN
  }
  for (let path = 0; path < nPaths && i < p.length; path++) {
    const flags = next(92)
    const pts: Vec2[] = []
    if (flags & 2) {
      const hasBulge = next(72)
      next(73)
      const nv = next(93)
      const vs: Vec2[] = [], bs: number[] = []
      for (let v = 0; v < nv; v++) {
        const x = next(10), y = next(20)
        vs.push({ x, y })
        bs.push(hasBulge ? (p[i]?.[0] === 42 ? parseFloat(p[i++][1]) : 0) : 0)
      }
      pts.push(...withBulges(vs, bs, true).pts)
    } else {
      const ne = next(93)
      for (let e = 0; e < ne; e++) {
        const t = next(72)
        if (t === 1) { const a = { x: next(10), y: next(20) }, b = { x: next(11), y: next(21) }; pts.push(a, b) }
        else if (t === 2) {
          const c = { x: next(10), y: next(20) }, rr = next(40), s = next(50) * D2R, en = next(51) * D2R, ccw = next(73)
          pts.push(...(ccw ? arcPts(c, rr, s, en, true) : arcPts(c, rr, -s, -en, false)))
        } else if (t === 3) {
          const c = { x: next(10), y: next(20) }, mj = { x: next(11), y: next(21) }, ratio = next(40), s = next(50) * D2R, en = next(51) * D2R
          pts.push(...ellipsePts(c, mj, ratio, s, en))
        } else if (t === 4) {
          const deg = next(94); next(73); next(74)
          const nk = next(95), nc = next(96)
          const knots: number[] = []
          for (let k = 0; k < nk; k++) knots.push(next(40))
          const ctrl: Vec2[] = []
          for (let k = 0; k < nc; k++) ctrl.push({ x: next(10), y: next(20) })
          pts.push(...splinePts(deg, knots, ctrl, []))
        } else break
      }
    }
    // skip the source-boundary references (97 count, 330 handles)
    if (pts.length > 1) loops.push(pts)
  }
  return loops
}

export function importDxf(text: string): DxfImport {
  const pairs = pairsOf(text)
  const skipped: Record<string, number> = {}
  const approximated: Record<string, number> = {}
  const bump = (o: Record<string, number>, k: string) => { o[k] = (o[k] ?? 0) + 1 }

  // ---- layers (TABLES/LAYER): negative colour = off, flag 1 = frozen ----
  const layerVis = new Map<string, boolean>()
  for (const r of records(section(pairs, 'TABLES')))
    if (r.type === 'LAYER') layerVis.set(str(r, 2, '0'), num(r, 62, 7) >= 0 && (num(r, 70) & 1) === 0)

  // ---- block definitions ----
  const blocks = new Map<string, Block>()
  let cur: { name: string; block: Block } | null = null
  for (const r of records(section(pairs, 'BLOCKS'))) {
    if (r.type === 'BLOCK') { cur = { name: str(r, 2), block: { base: { x: num(r, 10), y: num(r, 20) }, recs: [] } }; continue }
    if (r.type === 'ENDBLK') { if (cur) blocks.set(cur.name, cur.block); cur = null; continue }
    cur?.block.recs.push(r)
  }

  const entities: Entity[] = []
  const used = new Set<string>()
  let seq = 0
  const stamp = Date.now().toString(36)
  const base = (layer: string) => {
    used.add(layer)
    return { id: `dxf-${stamp}-${++seq}`, layer, color: 'ByLayer', linetype: 'ByLayer' as const, lineweight: 'ByLayer' as const, transparency: 0 }
  }
  const poly = (layer: string, pts: Vec2[], closed: boolean, m: M, filled = false) => {
    if (pts.length < 2) return
    entities.push({ ...base(layer), kind: 'polyline', pts: pts.map((p) => ap(m, p)), closed, ...(filled ? { filled: true } : {}) })
  }
  /** Uniform scale + rotation of `m` (for radii, text heights and angles). */
  const scaleOf = (m: M) => Math.sqrt(Math.abs(det(m)))
  const rotOf = (m: M) => Math.atan2(m.b, m.a)
  const uniform = (m: M) => Math.abs(Math.hypot(m.a, m.b) - Math.hypot(m.c, m.d)) < 1e-9 * Math.max(1, Math.hypot(m.a, m.b))

  const emit = (r: Rec, m: M, parentLayer: string | null, depth: number) => {
    let layer = str(r, 8, '0')
    if (layer === '0' && parentLayer) layer = parentLayer // block entities on layer 0 inherit the INSERT's layer
    if (depth === 0 && num(r, 67) === 1) { bump(skipped, 'paper space'); return }
    if ((num(r, 60) & 1) === 1) return // invisible
    switch (r.type) {
      case 'LINE':
        entities.push({ ...base(layer), kind: 'line', a: ap(m, { x: num(r, 10), y: num(r, 20) }), b: ap(m, { x: num(r, 11), y: num(r, 21) }) })
        break
      case 'CIRCLE': {
        const c = { x: num(r, 10), y: num(r, 20) }, rad = num(r, 40)
        if (uniform(m)) entities.push({ ...base(layer), kind: 'circle', c: ap(m, c), r: rad * scaleOf(m) })
        else { poly(layer, arcPts(c, rad, 0, 2 * Math.PI), true, m); bump(approximated, 'CIRCLE (non-uniform block scale)') }
        break
      }
      case 'ARC': {
        const c = { x: num(r, 10), y: num(r, 20) }, rad = num(r, 40), s = num(r, 50) * D2R, e = num(r, 51) * D2R
        if (uniform(m)) {
          const rot = rotOf(m)
          // a mirrored block (negative determinant) reverses the arc direction
          const [s2, e2] = det(m) < 0 ? [-e + rot, -s + rot] : [s + rot, e + rot]
          entities.push({ ...base(layer), kind: 'arc', c: ap(m, c), r: rad * scaleOf(m), start: s2, end: e2 })
        } else { poly(layer, arcPts(c, rad, s, e), false, m); bump(approximated, 'ARC (non-uniform block scale)') }
        break
      }
      case 'TEXT':
      case 'ATTRIB': {
        if (r.type === 'ATTRIB' && (num(r, 70) & 1) === 1) break // invisible attribute
        const value = dxfText(str(r, 1))
        if (!value) break
        const h72 = num(r, 72), v = r.type === 'TEXT' ? num(r, 73) : num(r, 74)
        const aligned = h72 !== 0 || v !== 0
        const p = aligned ? { x: num(r, 11), y: num(r, 21) } : { x: num(r, 10), y: num(r, 20) }
        const h = num(r, 40, 250) * scaleOf(m)
        entities.push({ ...base(layer), kind: 'text', p: ap(m, p), height: h, value, rotation: num(r, 50) * D2R + rotOf(m), align: h72 === 1 || h72 === 4 ? 'center' : 'left' })
        break
      }
      case 'MTEXT': {
        const value = dxfText(r.props.filter(([c]) => c === 3).map(([, s]) => s).join('') + str(r, 1))
        if (!value) break
        const h = num(r, 40, 250) * scaleOf(m)
        const att = num(r, 71, 1) // 1..9: top/middle/bottom × left/center/right
        const dx = num(r, 11, NaN), dy = num(r, 21, 0)
        const rot = (Number.isFinite(dx) ? Math.atan2(dy, dx) : num(r, 50) * D2R) + rotOf(m)
        // our text is anchored at the baseline: shift a top/middle attachment down along the text's up-vector
        const drop = att <= 3 ? h : att <= 6 ? h / 2 : 0
        const p = ap(m, { x: num(r, 10), y: num(r, 20) })
        entities.push({ ...base(layer), kind: 'text', p: { x: p.x + Math.sin(rot) * drop, y: p.y - Math.cos(rot) * drop }, height: h, value, rotation: rot, align: att % 3 === 2 ? 'center' : 'left' })
        break
      }
      case 'LWPOLYLINE': {
        const pts: Vec2[] = [], bulges: number[] = []
        for (const [c, v] of r.props) {
          if (c === 10) { pts.push({ x: parseFloat(v), y: 0 }); bulges.push(0) }
          else if (c === 20 && pts.length) pts[pts.length - 1].y = parseFloat(v)
          else if (c === 42 && pts.length) bulges[pts.length - 1] = parseFloat(v)
        }
        const closed = (num(r, 70) & 1) === 1
        const wb = withBulges(pts, bulges, closed)
        if (wb.bulged) bump(approximated, 'LWPOLYLINE arc segments')
        poly(layer, wb.pts, closed, m)
        break
      }
      case 'POLYLINE': {
        const flags = num(r, 70)
        if (flags & (16 | 64)) { bump(skipped, 'POLYLINE (3D mesh)'); break }
        const vs = r.children.filter((v) => (num(v, 70) & 16) === 0) // skip spline frame points
        const wb = withBulges(vs.map((v) => ({ x: num(v, 10), y: num(v, 20) })), vs.map((v) => num(v, 42)), (flags & 1) === 1)
        if (wb.bulged) bump(approximated, 'POLYLINE arc segments')
        poly(layer, wb.pts, (flags & 1) === 1, m)
        break
      }
      case 'ELLIPSE': {
        const c = { x: num(r, 10), y: num(r, 20) }, mj = { x: num(r, 11), y: num(r, 21) }
        poly(layer, ellipsePts(c, mj, num(r, 40, 1), num(r, 41, 0), num(r, 42, 2 * Math.PI)), false, m)
        bump(approximated, 'ELLIPSE')
        break
      }
      case 'SPLINE': {
        const xs = all(r, 10), ys = all(r, 20), fx = all(r, 11), fy = all(r, 21)
        const pts = fx.length >= 2 && xs.length < 2
          ? fx.map((x, k) => ({ x, y: fy[k] ?? 0 }))
          : splinePts(num(r, 71, 3), all(r, 40), xs.map((x, k) => ({ x, y: ys[k] ?? 0 })), all(r, 41))
        poly(layer, pts, (num(r, 70) & 1) === 1, m)
        bump(approximated, 'SPLINE')
        break
      }
      case 'LEADER': {
        poly(layer, all(r, 10).map((x, k) => ({ x, y: all(r, 20)[k] ?? 0 })), false, m)
        break
      }
      case 'SOLID':
      case 'TRACE': {
        const c = [10, 11, 12, 13].map((k) => ({ x: num(r, k), y: num(r, k + 10) }))
        poly(layer, [c[0], c[1], c[3], c[2]], true, m, true) // SOLID vertex order is 1-2-4-3
        break
      }
      case 'HATCH': {
        const solid = num(r, 70) === 1
        for (const loop of hatchLoops(r)) poly(layer, loop, true, m, solid)
        bump(approximated, solid ? 'HATCH (solid fill)' : 'HATCH (pattern → boundary only)')
        break
      }
      case 'DIMENSION':
      case 'ACAD_TABLE': {
        // AutoCAD stores the exact rendered geometry in an anonymous block (*D… / *T…)
        const b = blocks.get(str(r, 2))
        if (b && depth < 16) for (const c of b.recs) emit(c, m, layer, depth + 1)
        else bump(skipped, `${r.type} (no block)`)
        break
      }
      case 'INSERT': {
        const b = blocks.get(str(r, 2))
        if (!b) { bump(skipped, 'INSERT (missing block)'); break }
        if (depth >= 16) { bump(skipped, 'INSERT (nesting > 16)'); break }
        const sx = num(r, 41, 1), sy = num(r, 42, 1), rot = num(r, 50) * D2R
        const cols = Math.max(1, num(r, 70, 1)), rows = Math.max(1, num(r, 71, 1)), cs = num(r, 44), rs = num(r, 45)
        const cos = Math.cos(rot), sin = Math.sin(rot)
        for (let row = 0; row < rows; row++)
          for (let col = 0; col < cols; col++) {
            const ox = col * cs, oy = row * rs
            const local: M = {
              a: cos * sx, b: sin * sx, c: -sin * sy, d: cos * sy,
              e: num(r, 10) + cos * ox - sin * oy, f: num(r, 20) + sin * ox + cos * oy,
            }
            const mm = mul(m, mul(local, { ...I, e: -b.base.x, f: -b.base.y }))
            for (const c of b.recs) emit(c, mm, layer, depth + 1)
          }
        for (const a of r.children) emit(a, m, null, depth + 1) // attributes are already in world coords
        break
      }
      case '3DFACE': {
        const c = [10, 11, 12, 13].map((k) => ({ x: num(r, k), y: num(r, k + 10) }))
        poly(layer, c, true, m)
        break
      }
      case 'POINT':
        // dimension definition points live on DEFPOINTS (never plotted); other points are dots
        if (layer.toUpperCase() !== 'DEFPOINTS') bump(skipped, 'POINT')
        break
      case 'ATTDEF': // definitions inside blocks are templates, not visible geometry
      case 'SEQEND':
        break
      default:
        bump(skipped, r.type)
    }
  }

  const recs = records(section(pairs, 'ENTITIES'))
  for (const r of recs) emit(r, I, null, 0)
  const layers = [...used].map((name) => ({ name, visible: layerVis.get(name) ?? true }))
  return { entities, layers, skipped, approximated, records: recs.length }
}
