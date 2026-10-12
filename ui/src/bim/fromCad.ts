/**
 * Building model from 2D CAD floor plans (a DWG / DXF opened in CAD 2D).
 *
 * The geometry is read by code — the AI never invents it:
 *  - every layer gets a role (wall, door, window, column, room name, furniture, grid…) from its name (Vietnamese
 *    and English office conventions) or, for names the rules do not know, from its geometry; the local AI may
 *    suggest roles too (src/ai/layerRoles.ts). The user sees and can change every role before anything is built;
 *  - the drawing is split into its plans (clusters of wall geometry), each named by its title ("MẶT BẰNG TẦNG 2
 *    +3.900" → level and elevation);
 *  - walls = mutually nearest parallel faces 60–450 mm apart on the wall layers (lines, polylines, hatch
 *    boundaries), merged along their axis and joined at L / T junctions;
 *  - doors / windows = gaps between collinear pieces of one wall that hold door or window evidence (layer, block
 *    name, swing arc, glazing lines), sized by the gap, marked and sized by their tag ("D1", "S2 1200x1500");
 *    door / window blocks drawn over an unbroken wall are hosted on it as well;
 *  - columns = small closed rectangles / circles on the column layers;
 *  - rooms = regions closed by the walls (raster flood fill, outline snapped back onto the wall faces, so the area
 *    is exact for straight walls), named by the text inside; footprint (floor slab) = the outline of the building;
 *  - furniture = block instances on furniture layers, sized in the block's own frame.
 * Nothing here edits a model: the result is a preview the user approves (src/bim/fromCadBuild.ts builds it).
 * Units: drawing units are taken as millimetres (the CAD 2D convention).
 */
import type { CadDocument, Entity, Vec2 } from '../cad/types'
import type { P2 } from './model'

/* ================================================================ layer roles */

export type LayerRole = 'wall' | 'door' | 'window' | 'column' | 'room' | 'furniture' | 'stair' | 'grid' | 'level' | 'text' | 'ignore'
export const LAYER_ROLES: LayerRole[] = ['wall', 'door', 'window', 'column', 'room', 'furniture', 'stair', 'grid', 'level', 'text', 'ignore']
/** How a role was decided: name rule, geometry, local AI suggestion, the user, or nothing matched. */
export type RoleSource = 'rule' | 'geometry' | 'ai' | 'user' | 'none'

/** Upper-case ASCII without Vietnamese diacritics (đ → D); separators become single spaces. */
export function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'D').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
}

/** Name rules, first match wins (the input is norm(layer name)). */
const RULES: [LayerRole, RegExp][] = [
  ['ignore', /\b(DIM\w*|KICH ?THUOC|KTHUOC|DEFPOINTS|VPORTS?|VIEWPORTS?|THANG ?MAY|ELEVATORS?|LIFT)\b/],
  ['window', /\b(WINDOWS?|WIN|WINDOW\w*|CUA ?SO|CS|GLAZING|VACH ?KINH)\b/],
  ['door', /\b(DOORS?|DOOR\w*|CUA ?DI|CUA|CD|DR)\b/],
  ['wall', /(WALL|TUONG|BRICK|GACH|\bXAY\b)/],
  ['column', /\b(COLUMNS?|COLUMN\w*|COL|COT|PILLAR|TRU)\b/],
  ['stair', /(STAIR|CAU ?THANG|\bTHANG\b)/],
  ['grid', /\b(GRIDS?|GRID\w*|AXIS|AXES|TRUC|LUOI)\b/],
  ['level', /\b(LEVELS?|COS|CAO ?DO|ELEV)\b/],
  ['room', /\b(ROOMS?|AREAS?|PHONG|TEN ?PHONG|SPACES?|DIEN ?TICH)\b/],
  ['furniture', /(FURN|NOI ?THAT|FIXTURE|EQUIP|THIET ?BI|TBVS|SANITARY|PLUMB|\bBEP\b|KITCHEN|PLANT|\bCAY\b|DO ?GO|DECOR|TRANG ?TRI)/],
  ['text', /\b(TEXTS?|TXT|CHU|GHI ?CHU|ANNO\w*|NOTES?|TEN)\b/],
  ['ignore', /\b(HATCH\w*|VAT ?LIEU|TITLE\w*|KHUNG|SECTION\w*|MAT ?CAT|ROOF|MAI|VOID|THONG ?TANG|LEADER|XREF|CHI ?TIET|DETAIL|SITE|LANDSCAPE)\b/],
]

export function ruleRole(layer: string): LayerRole | null {
  const n = norm(layer)
  for (const [role, re] of RULES) if (re.test(n)) return role
  return null
}

export interface LayerStat {
  name: string
  count: number
  kinds: Partial<Record<Entity['kind'], number>>
  /** Up to 3 sample texts and block names (for the user and the AI). */
  texts: string[]
  blocks: string[]
  /** Share of the long straight segments with a parallel partner 60–450 mm away (wall-like). */
  pairRatio: number
  role: LayerRole
  by: RoleSource
}

type Seg = [Vec2, Vec2]

/** Straight segments of an entity (lines, polyline edges). */
export function segsOf(e: Entity): Seg[] {
  if (e.kind === 'line') return [[e.a, e.b]]
  if (e.kind === 'polyline') {
    const out: Seg[] = []
    for (let i = 0; i + 1 < e.pts.length; i++) out.push([e.pts[i], e.pts[i + 1]])
    if (e.closed && e.pts.length > 2) out.push([e.pts[e.pts.length - 1], e.pts[0]])
    return out
  }
  return []
}

export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}
const EMPTY: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
const addPt = (b: Box, p: Vec2) => {
  if (p.x < b.x0) b.x0 = p.x
  if (p.y < b.y0) b.y0 = p.y
  if (p.x > b.x1) b.x1 = p.x
  if (p.y > b.y1) b.y1 = p.y
}
/** Points describing an entity's extent (arcs and circles by their extreme points). */
function ptsOf(e: Entity): Vec2[] {
  switch (e.kind) {
    case 'line': return [e.a, e.b]
    case 'polyline': return e.pts
    case 'circle': return [{ x: e.c.x - e.r, y: e.c.y - e.r }, { x: e.c.x + e.r, y: e.c.y + e.r }]
    case 'arc': {
      const out: Vec2[] = []
      let span = e.end - e.start
      while (span <= 0) span += 2 * Math.PI
      for (let k = 0; k <= 8; k++) {
        const t = e.start + (span * k) / 8
        out.push({ x: e.c.x + e.r * Math.cos(t), y: e.c.y + e.r * Math.sin(t) })
      }
      return out
    }
    case 'text': return [e.p]
    case 'dimension': return [e.a, e.b]
  }
}
export function boxOf(e: Entity): Box {
  const b = { ...EMPTY }
  for (const p of ptsOf(e)) addPt(b, p)
  return b
}
const overlaps = (a: Box, b: Box, pad = 0) => a.x0 - pad <= b.x1 && b.x0 - pad <= a.x1 && a.y0 - pad <= b.y1 && b.y0 - pad <= a.y1
const centre = (b: Box): Vec2 => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 })

/** Wall-likeness of a set of segments: share of the long ones with a parallel partner 60–450 mm away. */
function pairRatioOf(segs: Seg[]): number {
  const long = segs.filter(([a, b]) => Math.hypot(b.x - a.x, b.y - a.y) >= 300).slice(0, 3000)
  if (long.length < 4) return 0
  const info = long.map(([a, b]) => {
    let th = Math.atan2(b.y - a.y, b.x - a.x)
    if (th < 0) th += Math.PI
    if (th >= Math.PI) th -= Math.PI
    const ux = Math.cos(th), uy = Math.sin(th)
    const s0 = a.x * ux + a.y * uy, s1 = b.x * ux + b.y * uy
    return { th, c: -a.x * uy + a.y * ux, lo: Math.min(s0, s1), hi: Math.max(s0, s1) }
  })
  info.sort((p, q) => p.th - q.th)
  let paired = 0
  for (let i = 0; i < info.length; i++) {
    const p = info[i]
    for (let j = 0; j < info.length; j++) {
      if (i === j) continue
      const q = info[j]
      if (Math.abs(q.th - p.th) > 0.005) continue
      const d = Math.abs(q.c - p.c)
      const ov = Math.min(p.hi, q.hi) - Math.max(p.lo, q.lo)
      if (d >= 60 && d <= 450 && ov >= 0.5 * Math.min(p.hi - p.lo, q.hi - q.lo)) { paired++; break }
    }
  }
  return paired / info.length
}

/** Per-layer statistics with the rule / geometry role of each layer (entities on hidden layers included). */
export function layerStats(doc: CadDocument): LayerStat[] {
  const by = new Map<string, Entity[]>()
  for (const e of doc.entities) {
    const l = by.get(e.layer) ?? []
    l.push(e)
    by.set(e.layer, l)
  }
  const out: LayerStat[] = []
  for (const [name, ents] of by) {
    const kinds: LayerStat['kinds'] = {}
    for (const e of ents) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1
    const texts = [...new Set(ents.filter((e) => e.kind === 'text').map((e) => (e as { value: string }).value.trim()).filter(Boolean))].slice(0, 3)
    const blocks = [...new Set(ents.map((e) => e.insert?.name).filter((n): n is string => !!n))].slice(0, 3)
    const pairRatio = pairRatioOf(ents.flatMap(segsOf))
    const st: LayerStat = { name, count: ents.length, kinds, texts, blocks, pairRatio, role: 'ignore', by: 'none' }
    const r = ruleRole(name)
    if (r) Object.assign(st, { role: r, by: 'rule' as const })
    else Object.assign(st, geometryRole(st))
    out.push(st)
  }
  return out.sort((a, b) => b.count - a.count)
}

/** Role of a layer whose name says nothing: wall-like pairs → wall, swing arcs in blocks → door, texts → text. */
function geometryRole(st: LayerStat): { role: LayerRole; by: RoleSource } {
  const n = (k: Entity['kind']) => st.kinds[k] ?? 0
  const straight = n('line') + n('polyline')
  if (st.pairRatio >= 0.4 && straight >= 6) return { role: 'wall', by: 'geometry' }
  if (n('text') > 0.8 * st.count) return { role: 'text', by: 'geometry' }
  return { role: 'ignore', by: 'none' }
}

/* ================================================================ texts */

/** "+3.900", "±0.000", "-0,450", "COS +3.600" → mm (null when the text holds no elevation). */
export function parseElevation(s: string): number | null {
  const m = /(±|\+|-|–)?\s*(\d{1,3})[.,](\d{3})(?!\d)/.exec(s)
  if (!m) return null
  const v = Number(m[2]) * 1000 + Number(m[3])
  return m[1] === '-' || m[1] === '–' ? -v : v
}

/** Door / window tag ("D1", "Đ-02", "S3", "CS1", "W04", "LM1"): its kind and the mark as written. */
export function parseMark(s: string): { kind: 'door' | 'window'; mark: string } | null {
  const t = s.trim()
  const m = /^(Đ|D|DD|CĐ|CD|LM|SD|CL|S|CS|W|WD)[-\s.]?(\d{1,3}[A-Z]?)$/i.exec(t)
  if (!m) return null
  const p = norm(m[1])
  return { kind: p === 'S' || p === 'CS' || p === 'W' || p === 'WD' ? 'window' : 'door', mark: t.replace(/\s+/g, '') }
}

/** "900x2200", "1200 X 1500", "800*2100" → [width, height] (mm). */
export function parseSize(s: string): [number, number] | null {
  const m = /(\d{3,4})\s*[xX×*]\s*(\d{3,4})/.exec(s)
  return m ? [Number(m[1]), Number(m[2])] : null
}

const isAreaText = (s: string) => /m2|m²/i.test(s) || /^\s*S\s*=/.test(s)
const hasLetters = (s: string) => /[A-Za-zÀ-ỹĐđ]{2,}/.test(s)

/* ================================================================ plans in the drawing */

export interface PlanRegion {
  id: string
  /** Extent of the plan's wall geometry. */
  box: Box
  /** Drawing title found under (or over) the plan. */
  title: string | null
  /** Elevation written in the title (mm). */
  elevation: number | null
  /** floor plan, roof plan, or another drawing (elevation, section, detail) that also uses the wall layers. */
  kind: 'plan' | 'roof' | 'other'
  /** Storey order from the title (basement 0, ground 1, mezzanine 1.5, floor n, roof 99). */
  order: number | null
  /** Level name from the title ("Tầng 2"), null when the title does not name one. */
  levelName: string | null
}

/** Storey of a title: [order, level name]. */
function storeyOf(title: string): [number | null, string | null] {
  const n = norm(title)
  const t = /\bTANG ?(\d{1,2})\b/.exec(n) ?? /\b(?:FLOOR|LEVEL|STOREY) ?(\d{1,2})\b/.exec(n)
  if (/\bMAI\b|\bROOF\b/.test(n)) return [99, /\bMAI\b/.test(n) ? 'Mái' : 'Roof']
  if (/\bTANG ?HAM\b|\bHAM\b|BASEMENT/.test(n)) return [0, /HAM/.test(n) ? 'Tầng hầm' : 'Basement']
  if (/\bLUNG\b|MEZZ/.test(n)) return [1.5, /LUNG/.test(n) ? 'Tầng lửng' : 'Mezzanine']
  if (/\bTRET\b|GROUND/.test(n)) return [1, /TRET/.test(n) ? 'Tầng trệt' : 'Ground floor']
  if (t) return [Number(t[1]), /TANG/.test(n) ? `Tầng ${Number(t[1])}` : `Level ${Number(t[1])}`]
  return [null, null]
}

/**
 * The plans of a drawing: wall geometry clustered by proximity (2.5 m), each cluster named by the largest text
 * under it. Clusters smaller than 2 × 2 m or with fewer than 6 wall segments are dropped.
 */
export function findPlans(doc: CadDocument, roles: Record<string, LayerRole>): PlanRegion[] {
  const walls = doc.entities.filter((e) => roles[e.layer] === 'wall' && (e.kind === 'line' || e.kind === 'polyline'))
  const items = walls.map((e) => ({ b: boxOf(e), n: segsOf(e).length }))
  // union-find over boxes closer than GAP (sweep along x)
  const GAP = 2500
  const parent = items.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const order = items.map((_, i) => i).sort((a, b) => items[a].b.x0 - items[b].b.x0)
  const active: number[] = []
  for (const i of order) {
    const bi = items[i].b
    for (let k = active.length - 1; k >= 0; k--) {
      const j = active[k]
      if (items[j].b.x1 + GAP < bi.x0) { active.splice(k, 1); continue }
      if (overlaps(bi, items[j].b, GAP)) parent[find(i)] = find(j)
    }
    active.push(i)
  }
  const groups = new Map<number, { b: Box; n: number }>()
  items.forEach((it, i) => {
    const r = find(i)
    const g = groups.get(r) ?? { b: { ...EMPTY }, n: 0 }
    addPt(g.b, { x: it.b.x0, y: it.b.y0 })
    addPt(g.b, { x: it.b.x1, y: it.b.y1 })
    g.n += it.n
    groups.set(r, g)
  })
  const texts = doc.entities.filter((e): e is Extract<Entity, { kind: 'text' }> => e.kind === 'text' && hasLetters(e.value))
  const regions: PlanRegion[] = []
  for (const g of groups.values()) {
    const w = g.b.x1 - g.b.x0, h = g.b.y1 - g.b.y0
    if (w < 2000 || h < 2000 || g.n < 6) continue
    // title: the largest text in a band under the plan (or over it), preferring drawing-title words
    const below = (p: Vec2) => p.x >= g.b.x0 - 3000 && p.x <= g.b.x1 + 3000 && p.y < g.b.y0 && p.y >= g.b.y0 - Math.max(6000, 0.4 * h)
    const above = (p: Vec2) => p.x >= g.b.x0 - 3000 && p.x <= g.b.x1 + 3000 && p.y > g.b.y1 && p.y <= g.b.y1 + Math.max(4000, 0.25 * h)
    const score = (t: { value: string; height: number }) => t.height * (/\b(MAT BANG|MAT DUNG|MAT CAT|PLAN|ELEVATION|SECTION)\b/.test(norm(t.value)) ? 3 : 1)
    const pick = (f: (p: Vec2) => boolean) => texts.filter((t) => f(t.p) && t.value.trim().length >= 5).sort((a, b) => score(b) - score(a))[0]
    const t = pick(below) ?? pick(above)
    const title = t ? t.value.trim() : null
    const nt = title ? norm(title) : ''
    const other = /\b(MAT DUNG|MAT CAT|ELEVATION|SECTION|CHI TIET|DETAIL|TRIEN KHAI)\b/.test(nt)
    const [ord, levelName] = title && !other ? storeyOf(title) : [null, null]
    regions.push({
      id: `plan-${regions.length + 1}`,
      box: g.b,
      title,
      elevation: title && !other ? parseElevation(title) : null,
      kind: other ? 'other' : ord === 99 ? 'roof' : 'plan',
      order: ord,
      levelName,
    })
  }
  return regions.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.box.x0 - b.box.x0 || b.box.y0 - a.box.y0).map((r, i) => ({ ...r, id: `plan-${i + 1}` }))
}

/** Elevation written in a roof plan's title ("MẶT BẰNG MÁI +11.100"), even when the roof has no walls. */
export function roofElevation(doc: CadDocument): number | null {
  for (const e of doc.entities) {
    if (e.kind !== 'text') continue
    const n = norm(e.value)
    if (/\b(MAT BANG MAI|ROOF PLAN)\b/.test(n)) {
      const v = parseElevation(e.value)
      if (v !== null) return v
    }
  }
  return null
}

/* ================================================================ recognition */

export interface RecOptions {
  /** Wall thickness range (mm). */
  tMin: number
  tMax: number
  /** Default door height, window sill and height, and the head of an opening without a symbol (mm). */
  doorH: number
  winSill: number
  winH: number
  openingH: number
}
export const DEFAULT_REC: RecOptions = { tMin: 40, tMax: 450, doorH: 2200, winSill: 900, winH: 1400, openingH: 2400 }

export interface RecWall {
  /** Axis direction (unit), normal, offset of the centre line (n · p = c), extent along the axis (u · p). */
  ux: number
  uy: number
  c: number
  s0: number
  s1: number
  t: number
  /** One face borders the outside of the building. */
  ext: boolean
  /** Drawn as glazing only (a window symbol filling the whole stretch, no wall body): a curtain wall. */
  curtain?: boolean
}
export interface RecOpening {
  wall: number
  kind: 'door' | 'window' | 'opening'
  /** Extent along the host's axis (same parameter as RecWall.s0 / s1). */
  s0: number
  s1: number
  height: number
  sill: number
  mark: string | null
  /** What identified it (for the preview): layer, block, arc, glazing lines, tag. */
  why: string[]
}
export interface RecColumn {
  x: number
  y: number
  w: number
  d: number
  round: boolean
}
export interface RecRoom {
  name: string | null
  number: string | null
  outline: P2[]
  /** m², computed from the outline (columns inside deducted). */
  area: number
}
export type FurnKind =
  | 'sofa' | 'bed' | 'wardrobe' | 'tvCabinet' | 'island' | 'kitchen' | 'fridge' | 'dining' | 'desk' | 'nightstand' | 'coffeeTable'
  | 'chair' | 'table' | 'altar' | 'shoeCabinet' | 'shelf' | 'cabinet' | 'wc' | 'basin' | 'shower' | 'bathtub' | 'washer' | 'plant'
  | 'bench' | 'rug' | 'light' | 'other'
export interface RecFurniture {
  block: string
  kind: FurnKind
  /** Footprint centre, size in the block's frame, rotation (degrees). */
  x: number
  y: number
  w: number
  d: number
  rot: number
}
export interface RecGrid {
  label: string
  a: P2
  b: P2
}
export type RecWarning =
  | { code: 'noWalls' }
  | { code: 'unnamedRooms'; n: number }
  | { code: 'gapsLeftOpen'; n: number }
  | { code: 'openingsNoSymbol'; n: number }
  | { code: 'symbolsNoWall'; n: number }
  | { code: 'roomSnapFallback'; n: number }
  | { code: 'stairsSkipped' }
  | { code: 'unknownFurniture'; n: number }

export interface Recognition {
  region: PlanRegion
  /** The plan was turned by −angle about pivot to square it; every coordinate below is in that frame. */
  frame: { angle: number; pivot: P2 }
  walls: RecWall[]
  openings: RecOpening[]
  columns: RecColumn[]
  rooms: RecRoom[]
  /** Outline of the building (outer wall faces), null if the walls do not close. */
  footprint: P2[] | null
  furniture: RecFurniture[]
  grids: RecGrid[]
  warnings: RecWarning[]
}

/** Wall end points (centre line). */
export function wallLine(w: RecWall): { a: P2; b: P2 } {
  const nx = -w.uy, ny = w.ux
  return { a: [w.ux * w.s0 + nx * w.c, w.uy * w.s0 + ny * w.c], b: [w.ux * w.s1 + nx * w.c, w.uy * w.s1 + ny * w.c] }
}
/** Footprint rectangle of a wall (or of a stretch s0…s1 of it). */
export function wallRect(w: RecWall, s0 = w.s0, s1 = w.s1, extra = 0): P2[] {
  const nx = -w.uy, ny = w.ux, h = w.t / 2 + extra
  const p = (s: number, o: number): P2 => [w.ux * s + nx * (w.c + o), w.uy * s + ny * (w.c + o)]
  return [p(s0, -h), p(s1, -h), p(s1, h), p(s0, h)]
}

interface Face {
  th: number
  c: number
  s0: number
  s1: number
}
interface Piece {
  cl: number
  ux: number
  uy: number
  c: number
  t: number
  s0: number
  s1: number
}

const ANG_TOL = 0.3 * (Math.PI / 180)

/** Collinear segments merged into maximal face lines, grouped by direction. */
export function faceLines(segs: Seg[]): { th: number; faces: Face[] }[] {
  const items = segs
    .map(([a, b]) => {
      const L = Math.hypot(b.x - a.x, b.y - a.y)
      if (L < 5) return null
      let th = Math.atan2(b.y - a.y, b.x - a.x)
      if (th < 0) th += Math.PI
      if (th >= Math.PI - 1e-12) th -= Math.PI
      return { a, b, th }
    })
    .filter((x): x is { a: Vec2; b: Vec2; th: number } => !!x)
    .sort((p, q) => p.th - q.th)
  // direction clusters (and the wrap-around near 180° = 0°)
  const clusters: { a: Vec2; b: Vec2; th: number }[][] = []
  for (const it of items) {
    const cur = clusters[clusters.length - 1]
    if (cur && it.th - cur[0].th <= ANG_TOL) cur.push(it)
    else clusters.push([it])
  }
  if (clusters.length > 1) {
    const last = clusters[clusters.length - 1], first = clusters[0]
    if (Math.PI - last[last.length - 1].th + first[0].th <= ANG_TOL) {
      first.push(...last.map((x) => ({ ...x, th: x.th - Math.PI })))
      clusters.pop()
    }
  }
  return clusters.map((cl) => {
    const th = cl.reduce((s, x) => s + x.th, 0) / cl.length
    const ux = Math.cos(th), uy = Math.sin(th)
    const rows = cl
      .map(({ a, b }) => {
        const s0 = a.x * ux + a.y * uy, s1 = b.x * ux + b.y * uy
        return { c: (-a.x * uy + a.y * ux + -b.x * uy + b.y * ux) / 2, s0: Math.min(s0, s1), s1: Math.max(s0, s1) }
      })
      .sort((p, q) => p.c - q.c)
    const faces: Face[] = []
    let i = 0
    while (i < rows.length) {
      let j = i + 1
      while (j < rows.length && rows[j].c - rows[i].c <= 3) j++
      const grp = rows.slice(i, j).sort((p, q) => p.s0 - q.s0)
      const c = grp.reduce((s, r) => s + r.c, 0) / grp.length
      let cur = { s0: grp[0].s0, s1: grp[0].s1 }
      for (const r of grp.slice(1)) {
        if (r.s0 <= cur.s1 + 2) cur.s1 = Math.max(cur.s1, r.s1)
        else { faces.push({ th, c, ...cur }); cur = { s0: r.s0, s1: r.s1 } }
      }
      faces.push({ th, c, ...cur })
      i = j
    }
    return { th, faces }
  })
}

/** Wall pieces: for each face, the nearest parallel face 60–450 mm away along each stretch; mutual pairs only. */
export function pairFaces(clusters: { th: number; faces: Face[] }[], opt: RecOptions): Piece[] {
  const pieces: Piece[] = []
  clusters.forEach(({ th, faces }, cl) => {
    const ux = Math.cos(th), uy = Math.sin(th)
    faces.sort((a, b) => a.c - b.c)
    // faces closer than tMin (but not duplicates) block the pairing across them: a thin strip is not two walls
    const cand: { j: number; d: number; lo: number; hi: number; block: boolean }[][] = faces.map(() => [])
    for (let i = 0; i < faces.length; i++)
      for (let j = i + 1; j < faces.length && faces[j].c - faces[i].c <= opt.tMax; j++) {
        const d = faces[j].c - faces[i].c
        if (d < 15) continue
        const lo = Math.max(faces[i].s0, faces[j].s0), hi = Math.min(faces[i].s1, faces[j].s1)
        if (hi - lo < 30) continue
        const block = d < opt.tMin
        cand[i].push({ j, d, lo, hi, block })
        cand[j].push({ j: i, d, lo, hi, block })
      }
    // nearest partner along each face, as stretches [p, q] → partner
    const nearest = cand.map((cs) => {
      const cuts = [...new Set(cs.flatMap((c) => [c.lo, c.hi]))].sort((a, b) => a - b)
      const out: { p: number; q: number; k: number }[] = []
      for (let i = 0; i + 1 < cuts.length; i++) {
        const m = (cuts[i] + cuts[i + 1]) / 2
        let best: (typeof cs)[number] | null = null
        for (const c of cs) if (c.lo <= m && m <= c.hi && (!best || c.d < best.d)) best = c
        if (!best || best.block) continue
        const last = out[out.length - 1]
        if (last && last.k === best.j && Math.abs(last.q - cuts[i]) < 1e-6) last.q = cuts[i + 1]
        else out.push({ p: cuts[i], q: cuts[i + 1], k: best.j })
      }
      return out
    })
    for (let i = 0; i < faces.length; i++)
      for (const a of nearest[i]) {
        if (a.k < i) continue
        for (const b of nearest[a.k]) {
          if (b.k !== i) continue
          const lo = Math.max(a.p, b.p), hi = Math.min(a.q, b.q)
          if (hi - lo < 30) continue
          pieces.push({ cl, ux, uy, c: (faces[i].c + faces[a.k].c) / 2, t: faces[a.k].c - faces[i].c, s0: lo, s1: hi })
        }
      }
  })
  return pieces
}

/* ---------- small geometry helpers ---------- */

type Rect = P2[]
function rectsIntersect(p: Rect, q: Rect): boolean {
  // separating axis test for two convex quads
  for (const poly of [p, q])
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length]
      const nx = -(b[1] - a[1]), ny = b[0] - a[0]
      let pmin = Infinity, pmax = -Infinity, qmin = Infinity, qmax = -Infinity
      for (const v of p) { const d = v[0] * nx + v[1] * ny; pmin = Math.min(pmin, d); pmax = Math.max(pmax, d) }
      for (const v of q) { const d = v[0] * nx + v[1] * ny; qmin = Math.min(qmin, d); qmax = Math.max(qmax, d) }
      if (pmax < qmin || qmax < pmin) return false
    }
  return true
}
const pieceRect = (p: Piece, extra = 0): Rect => wallRect({ ux: p.ux, uy: p.uy, c: p.c, s0: p.s0, s1: p.s1, t: p.t, ext: false }, p.s0 - extra, p.s1 + extra)
export const shoelace = (poly: P2[]) => poly.reduce((s, p, i) => s + p[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * p[1], 0) / 2
function insidePoly(p: P2, poly: P2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * Drops false pieces. A small rectangle of wall geometry pairs both ways; the end caps of a wall cut (at a column,
 * between two stubs) pair across the cut. Kept: pieces at least as long as thick, and short stubs that continue a
 * wall of the same line and thickness; of two crossing pieces from one small rectangle, the one continuing a wall.
 * Pieces inside a column are the column.
 */
export function cleanPieces(raw: Piece[], columns: RecColumn[]): Piece[] {
  // a piece lying inside a column (all four corners) is the column's own outline
  const inCol = (p: Piece) => columns.some((c) => pieceRect(p).every(([x, y]) => Math.abs(x - c.x) <= c.w / 2 + 5 && Math.abs(y - c.y) <= c.d / 2 + 5))
  const cont = raw.map((p) =>
    raw.some((q) => q !== p && q.cl === p.cl && Math.abs(q.c - p.c) <= 6 && Math.abs(q.t - p.t) <= 10 && q.s1 - q.s0 > p.s1 - p.s0 && (Math.abs(q.s0 - p.s1) <= 1200 || Math.abs(p.s0 - q.s1) <= 1200)),
  )
  return raw.filter((p, i) => {
    if (inCol(p)) return false
    const len = p.s1 - p.s0
    if (len < p.t && !cont[i]) return false
    if (len < 2 * p.t && !cont[i]) {
      const r = pieceRect(p, -2)
      const rival = raw.some((q, j) => j !== i && cont[j] && q.cl !== p.cl && q.s1 - q.s0 < 2 * q.t && rectsIntersect(r, pieceRect(q, -2)))
      if (rival) return false
    }
    return true
  })
}

/* ---------- columns ---------- */

export function findColumns(ents: Entity[]): RecColumn[] {
  const out: RecColumn[] = []
  for (const e of ents) {
    let col: RecColumn | null = null
    if (e.kind === 'circle' && e.r >= 75 && e.r <= 750) col = { x: e.c.x, y: e.c.y, w: 2 * e.r, d: 2 * e.r, round: true }
    else if (e.kind === 'polyline' && e.closed && e.pts.length >= 4) {
      const b = boxOf(e)
      const w = b.x1 - b.x0, d = b.y1 - b.y0
      const area = Math.abs(shoelace(e.pts.map((p) => [p.x, p.y] as P2)))
      if (w >= 100 && d >= 100 && w <= 1500 && d <= 1500 && area >= 0.85 * w * d) col = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, w, d, round: false }
    }
    if (!col) continue
    const dup = out.findIndex((c) => Math.hypot(c.x - col!.x, c.y - col!.y) < 40)
    if (dup < 0) out.push(col)
    else if (col.w * col.d > out[dup].w * out[dup].d) out[dup] = col
  }
  return out
}
const columnRect = (c: RecColumn): Rect => [[c.x - c.w / 2, c.y - c.d / 2], [c.x + c.w / 2, c.y - c.d / 2], [c.x + c.w / 2, c.y + c.d / 2], [c.x - c.w / 2, c.y + c.d / 2]]

/* ---------- door / window evidence ---------- */

const DOOR_BLOCK = /DOOR|\bCUA\b(?! ?SO)|CUA ?DI|^D ?\d|\bD\d|SLIDE|LUA/
const WIN_BLOCK = /WIN|CUA ?SO|^S ?\d|\bCS\b|GLAZ|KINH/

interface Other {
  e: Entity
  role: LayerRole
  box: Box
  c: Vec2
  block: string | null
}

interface InsGroup {
  name: string
  role: LayerRole
  pts: Vec2[]
}

/** Does any part of the entity lie in the polygon (segments, arc polylines, circle bounds, text point)? */
function touches(e: Entity, poly: P2[]): boolean {
  const segs: Seg[] = segsOf(e)
  if (e.kind === 'arc' || e.kind === 'circle') {
    const pts = e.kind === 'arc' ? ptsOf(e) : Array.from({ length: 17 }, (_, k) => ({ x: e.c.x + e.r * Math.cos((k * Math.PI) / 8), y: e.c.y + e.r * Math.sin((k * Math.PI) / 8) }))
    for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i], pts[i + 1]])
  }
  if (e.kind === 'text') return insidePoly([e.p.x, e.p.y], poly)
  return segs.some(([a, b]) => rectsIntersect([[a.x, a.y], [b.x, b.y]], poly))
}

/**
 * Door / window decision for a free stretch s0…s1 of a wall line (local frame u, n, c, t): geometry on door /
 * window layers lying in the opening itself, a door / window block filling ≥ 60 % of it, swing arcs pivoting at a
 * jamb, glazing lines spanning it. null = nothing says what it is.
 */
function evidence(o: Other[], groups: Map<string, InsGroup>, ux: number, uy: number, c: number, t: number, s0: number, s1: number): { kind: 'door' | 'window' | null; why: string[] } {
  const g = s1 - s0
  let door = 0, win = 0
  const why = new Set<string>()
  let roleDoor = false, roleWin = false, blockDoor = false, glazing = 0
  const local = (p: Vec2) => ({ s: p.x * ux + p.y * uy, o: -p.x * uy + p.y * ux - c })
  const nx = -uy, ny = ux
  const at = (s: number, off: number): P2 => [ux * s + nx * (c + off), uy * s + ny * (c + off)]
  const hole: P2[] = [at(s0 + 20, -t / 2 - 20), at(s1 - 20, -t / 2 - 20), at(s1 - 20, t / 2 + 20), at(s0 + 20, t / 2 + 20)]
  const R = Math.min(Math.max(g, 600), 1300)
  for (const x of o) {
    const lc = local(x.c)
    if (lc.s < s0 - R || lc.s > s1 + R || Math.abs(lc.o) > t / 2 + R) continue
    const e = x.e
    if ((x.role === 'door' || x.role === 'window') && touches(e, hole)) {
      if (x.role === 'door') roleDoor = true
      else roleWin = true
    }
    if (e.kind === 'arc') {
      const ac = local(e.c)
      const nearJamb = Math.abs(ac.s - s0) < 150 || Math.abs(ac.s - s1) < 150
      if (Math.abs(ac.o) <= t / 2 + 100 && nearJamb && e.r >= 0.35 * g && e.r <= 1.2 * g) { door += 3; why.add('arc') }
    }
    if (Math.abs(lc.o) <= t / 2 + 30 && lc.s >= s0 - 50 && lc.s <= s1 + 50 && glazing < 3)
      for (const [a, b] of segsOf(e)) {
        const L = Math.hypot(b.x - a.x, b.y - a.y)
        const par = Math.abs((b.x - a.x) * uy - (b.y - a.y) * ux) < 0.035 * L
        const la = local(a), lb = local(b)
        if (par && L >= 0.6 * g && Math.abs(la.o) <= t / 2 + 30 && Math.abs(lb.o) <= t / 2 + 30) { glazing++; why.add('glazing') }
        if (glazing >= 3) break
      }
  }
  // blocks: the part of the block inside the wall band must fill most of the opening
  for (const grp of groups.values()) {
    const b = norm(grp.name)
    const isWin = WIN_BLOCK.test(b) || grp.role === 'window', isDoor = !isWin && (DOOR_BLOCK.test(b) || grp.role === 'door')
    if (!isWin && !isDoor) continue
    let lo = Infinity, hi = -Infinity
    for (const p of grp.pts) {
      const l = local(p)
      if (Math.abs(l.o) <= t / 2 + 30 && l.s >= s0 - 150 && l.s <= s1 + 150) { lo = Math.min(lo, l.s); hi = Math.max(hi, l.s) }
    }
    if (hi - lo < 0.6 * g) continue
    why.add('block')
    if (isWin) win += 3
    else { door += 3; blockDoor = true }
  }
  win += glazing
  if (roleDoor) { door += 2; why.add('layer') }
  if (roleWin) { win += 2; why.add('layer') }
  // a door with a swing arc wins over glazing lines of its frame; otherwise the stronger evidence decides.
  // Doors wider than 2.6 m need a door block or swing arcs (sliding / folding sets): a layer alone is not enough.
  const doorOk = g <= 2600 || blockDoor || why.has('arc')
  const kind = door >= 2 && door >= win && doorOk ? 'door' : win >= 2 ? 'window' : null
  return { kind, why: [...why] }
}

/* ---------- raster rooms ---------- */

interface Raster {
  x0: number
  y0: number
  h: number
  W: number
  H: number
  /** 1 = solid (wall, column), 0 = free. */
  solid: Uint8Array
  /** 0 = solid, 1 = outside, ≥ 2 = enclosed region id. */
  label: Int32Array
  regions: number
}

function rasterize(walls: RecWall[], cols: RecColumn[], box: Box): Raster {
  const pad = 2000
  const span = Math.max(box.x1 - box.x0, box.y1 - box.y0) + 2 * pad
  const h = Math.min(60, Math.max(20, Math.ceil(span / 1800)))
  const x0 = box.x0 - pad, y0 = box.y0 - pad
  const W = Math.ceil((box.x1 - box.x0 + 2 * pad) / h), H = Math.ceil((box.y1 - box.y0 + 2 * pad) / h)
  const solid = new Uint8Array(W * H)
  const fill = (poly: P2[]) => {
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity
    for (const [x, y] of poly) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y) }
    const i0 = Math.max(0, Math.floor((bx0 - x0) / h)), i1 = Math.min(W - 1, Math.floor((bx1 - x0) / h))
    const j0 = Math.max(0, Math.floor((by0 - y0) / h)), j1 = Math.min(H - 1, Math.floor((by1 - y0) / h))
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) if (insidePoly([x0 + (i + 0.5) * h, y0 + (j + 0.5) * h], poly)) solid[j * W + i] = 1
  }
  // conservative: each wall grown by half a cell so thin walls stay closed
  for (const w of walls) fill(wallRect(w, w.s0 - h / 2, w.s1 + h / 2, h / 2))
  for (const c of cols) fill(columnRect({ ...c, w: c.w + h, d: c.d + h }))
  // close hairline cracks: one cell of dilation
  const grown = solid.slice()
  for (let j = 1; j < H - 1; j++)
    for (let i = 1; i < W - 1; i++) {
      const k = j * W + i
      if (!solid[k] && (solid[k - 1] || solid[k + 1] || solid[k - W] || solid[k + W])) grown[k] = 1
    }
  const label = new Int32Array(W * H)
  const flood = (start: number, id: number) => {
    const stack = [start]
    label[start] = id
    while (stack.length) {
      const k = stack.pop()!
      const i = k % W, j = (k - i) / W
      const nb = [i > 0 ? k - 1 : -1, i < W - 1 ? k + 1 : -1, j > 0 ? k - W : -1, j < H - 1 ? k + W : -1]
      for (const q of nb) if (q >= 0 && !grown[q] && label[q] === 0) { label[q] = id; stack.push(q) }
    }
  }
  flood(0, 1)
  let regions = 1
  for (let k = 0; k < W * H; k++) if (!grown[k] && label[k] === 0) flood(k, ++regions)
  return { x0, y0, h, W, H, solid: grown, label, regions }
}

/** Outer boundary loop of the cells where `inside(k)` (cell-edge polygon, collinear points removed, CCW). */
function traceOuter(r: Raster, inside: (k: number) => boolean, bounds?: [number, number, number, number]): P2[] | null {
  const { W, H } = r
  const [bi0, bj0, bi1, bj1] = bounds ?? [0, 0, W - 1, H - 1]
  const key = (i: number, j: number) => j * (W + 1) + i
  const next = new Map<number, number[]>()
  const add = (a: number, b: number) => {
    const l = next.get(a)
    if (l) l.push(b)
    else next.set(a, [b])
  }
  const at = (i: number, j: number) => i >= 0 && j >= 0 && i < W && j < H && inside(j * W + i)
  for (let j = bj0; j <= bj1; j++)
    for (let i = bi0; i <= bi1; i++) {
      if (!at(i, j)) continue
      if (!at(i, j - 1)) add(key(i, j), key(i + 1, j))
      if (!at(i + 1, j)) add(key(i + 1, j), key(i + 1, j + 1))
      if (!at(i, j + 1)) add(key(i + 1, j + 1), key(i, j + 1))
      if (!at(i - 1, j)) add(key(i, j + 1), key(i, j))
    }
  const xy = (k: number): [number, number] => [k % (W + 1), Math.floor(k / (W + 1))]
  let best: P2[] | null = null, bestA = 0
  while (next.size) {
    const [start] = next.keys()
    const loop: number[] = [start]
    let cur = start, prev = -1
    for (let guard = 0; guard < 4 * W * H; guard++) {
      const outs = next.get(cur)
      if (!outs?.length) break
      let k = 0
      if (outs.length > 1 && prev >= 0) {
        // at a pinch, turn left (keeps the regions separate)
        const [px, py] = xy(prev), [cx, cy] = xy(cur)
        const din = [cx - px, cy - py]
        k = outs.findIndex((o) => { const [ox, oy] = xy(o); return din[0] * (oy - cy) - din[1] * (ox - cx) > 0 })
        if (k < 0) k = 0
      }
      const nx = outs.splice(k, 1)[0]
      if (!outs.length) next.delete(cur)
      prev = cur
      cur = nx
      if (cur === start) break
      loop.push(cur)
    }
    // drop collinear points
    const pts: P2[] = []
    for (let i = 0; i < loop.length; i++) {
      const [ax, ay] = xy(loop[(i - 1 + loop.length) % loop.length]), [bx, by] = xy(loop[i]), [cx, cy] = xy(loop[(i + 1) % loop.length])
      if ((bx - ax) * (cy - by) - (by - ay) * (cx - bx) !== 0) pts.push([r.x0 + bx * r.h, r.y0 + by * r.h])
    }
    if (pts.length < 3) continue
    const a = shoelace(pts)
    if (a > bestA) { bestA = a; best = pts }
  }
  return best
}

/** Douglas–Peucker on a closed polygon. */
function simplify(poly: P2[], tol: number): P2[] {
  if (poly.length <= 4) return poly
  // start at the point farthest from the first one so the closing seam is a real corner
  let far = 0, fd = -1
  for (let i = 0; i < poly.length; i++) { const d = Math.hypot(poly[i][0] - poly[0][0], poly[i][1] - poly[0][1]); if (d > fd) { fd = d; far = i } }
  const rdp = (pts: P2[]): P2[] => {
    if (pts.length < 3) return pts
    const [a, b] = [pts[0], pts[pts.length - 1]]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    let k = -1, dm = -1
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs((b[0] - a[0]) * (a[1] - pts[i][1]) - (a[0] - pts[i][0]) * (b[1] - a[1])) / L
      if (d > dm) { dm = d; k = i }
    }
    if (dm <= tol) return [a, b]
    return [...rdp(pts.slice(0, k + 1)).slice(0, -1), ...rdp(pts.slice(k))]
  }
  const ring = [...poly.slice(0), poly[0]]
  const first = rdp(ring.slice(0, far + 1))
  const second = rdp(ring.slice(far))
  return [...first.slice(0, -1), ...second.slice(0, -1)]
}

interface FaceLine {
  ux: number
  uy: number
  /** n · p of the line. */
  off: number
  lo: number
  hi: number
}
/** Faces of the walls (both sides) and of the columns, as lines to snap outlines onto. */
function snapLines(walls: RecWall[], cols: RecColumn[]): FaceLine[] {
  const out: FaceLine[] = []
  for (const w of walls) for (const sg of [-1, 1]) out.push({ ux: w.ux, uy: w.uy, off: w.c + (sg * w.t) / 2, lo: w.s0 - w.t, hi: w.s1 + w.t })
  for (const c of cols) {
    out.push({ ux: 1, uy: 0, off: c.y - c.d / 2, lo: c.x - c.w, hi: c.x + c.w }, { ux: 1, uy: 0, off: c.y + c.d / 2, lo: c.x - c.w, hi: c.x + c.w })
    out.push({ ux: 0, uy: 1, off: -(c.x - c.w / 2), lo: c.y - c.d, hi: c.y + c.d }, { ux: 0, uy: 1, off: -(c.x + c.w / 2), lo: c.y - c.d, hi: c.y + c.d })
  }
  return out
}

/** Moves every edge of a raster outline onto the nearest parallel wall face (within `reach`), then re-intersects. */
function snapOutline(poly: P2[], lines: FaceLine[], reach: number): P2[] {
  const n = poly.length
  const edges = poly.map((p, i) => {
    const q = poly[(i + 1) % n]
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1
    const dx = (q[0] - p[0]) / L, dy = (q[1] - p[1]) / L
    const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2
    let best: FaceLine | null = null, bd = Infinity
    for (const f of lines) {
      if (Math.abs(dx * f.uy - dy * f.ux) > 0.07) continue
      const d = Math.abs(-mx * f.uy + my * f.ux - f.off)
      if (d > reach || d >= bd) continue
      const sp = p[0] * f.ux + p[1] * f.uy, sq = q[0] * f.ux + q[1] * f.uy
      const ov = Math.min(Math.max(sp, sq), f.hi) - Math.max(Math.min(sp, sq), f.lo)
      if (ov < 0.3 * L) continue
      best = f
      bd = d
    }
    // line: point + direction
    if (best) {
      const nx = -best.uy, ny = best.ux
      const s = mx * best.ux + my * best.uy
      return { px: best.ux * s + nx * best.off, py: best.uy * s + ny * best.off, dx: best.ux * Math.sign(dx * best.ux + dy * best.uy || 1), dy: best.uy * Math.sign(dx * best.ux + dy * best.uy || 1) }
    }
    return { px: mx, py: my, dx, dy }
  })
  const out: P2[] = []
  for (let i = 0; i < n; i++) {
    const a = edges[(i - 1 + n) % n], b = edges[i]
    const den = a.dx * b.dy - a.dy * b.dx
    if (Math.abs(den) < 1e-6) {
      // parallel neighbours: keep the vertex only if the lines differ (a jog)
      const gap = Math.abs((b.px - a.px) * a.dy - (b.py - a.py) * a.dx)
      if (gap > 1) out.push(poly[i])
      continue
    }
    const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / den
    const x = a.px + a.dx * t, y = a.py + a.dy * t
    out.push(Math.hypot(x - poly[i][0], y - poly[i][1]) > reach * 3 ? poly[i] : [Math.round(x * 10) / 10, Math.round(y * 10) / 10])
  }
  // remove repeated / collinear points
  const clean: P2[] = []
  for (let i = 0; i < out.length; i++) {
    const p = out[(i - 1 + out.length) % out.length], q = out[i], r = out[(i + 1) % out.length]
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.5) continue
    if (Math.abs((q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0])) < 1e-3 * Math.hypot(q[0] - p[0], q[1] - p[1]) * Math.hypot(r[0] - q[0], r[1] - q[1])) continue
    clean.push(q)
  }
  return clean
}

/**
 * Closed outlines (≥ 1 m²) on room layers. Duplicates (outline + hatch, or the same space drawn on a room layer and
 * on an area layer) are merged — the room-layer one, else the smaller, is kept — and outlines holding two or more
 * other rooms (floor area zones) are dropped.
 */
function explicitRooms(ents: Entity[]): P2[][] {
  const cand: { poly: P2[]; a: number; ip: P2; pref: boolean }[] = []
  for (const e of ents) {
    if (e.kind !== 'polyline' || e.pts.length < 3) continue
    const closed = e.closed || Math.hypot(e.pts[0].x - e.pts[e.pts.length - 1].x, e.pts[0].y - e.pts[e.pts.length - 1].y) < 1
    if (!closed) continue
    const poly = e.pts.map((p) => [p.x, p.y] as P2)
    const a = Math.abs(shoelace(poly))
    if (a < 1e6) continue
    cand.push({ poly, a, ip: interiorPoint(poly), pref: /ROOM|PHONG|SPACE/.test(norm(e.layer)) })
  }
  // containers of ≥ 2 others go first
  const rooms = cand.filter((c) => cand.filter((d) => d !== c && d.a < c.a && insidePoly(d.ip, c.poly)).length < 2)
  const keep: typeof rooms = []
  for (const c of rooms.sort((x, y) => Number(y.pref) - Number(x.pref) || x.a - y.a)) {
    if (keep.some((k) => insidePoly(k.ip, c.poly) || insidePoly(c.ip, k.poly))) continue
    keep.push(c)
  }
  return keep.map((k) => k.poly)
}

/** A point inside a simple polygon (its centroid if inside, else the middle of the first chord through it). */
export function interiorPoint(poly: P2[]): P2 {
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length, cy = poly.reduce((s, p) => s + p[1], 0) / poly.length
  if (insidePoly([cx, cy], poly)) return [cx, cy]
  const xs: number[] = []
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if (yi > cy !== yj > cy) xs.push(xi + ((cy - yi) * (xj - xi)) / (yj - yi))
  }
  xs.sort((a, b) => a - b)
  return xs.length >= 2 ? [(xs[0] + xs[1]) / 2, cy] : [cx, cy]
}

/* ---------- furniture ---------- */

const FURN_RULES: [RegExp, FurnKind][] = [
  [/ALTAR|BAN ?THO/, 'altar'],
  [/SOFA|SALON|GHE ?DAI/, 'sofa'],
  [/BED|GIUONG/, 'bed'],
  [/WARD|TU ?AO|TU ?QUAN ?AO|CLOSET/, 'wardrobe'],
  [/\bTV\b|^TV|TIVI|KE ?TV|TU ?TV/, 'tvCabinet'],
  [/ISLAND|DAO ?BEP/, 'island'],
  [/FRIDGE|TU ?LANH|REFRIG/, 'fridge'],
  [/KITCHEN|TU ?BEP|COUNTER|BEP/, 'kitchen'],
  [/\bDIN|DINING|BAN ?AN/, 'dining'],
  [/DESK|BAN ?LAM ?VIEC|BAN ?HOC/, 'desk'],
  [/CTABLE|COFFEE|BAN ?TRA|BAN ?NUOC|BAN ?SOFA/, 'coffeeTable'],
  [/NIGHT|TAB ?DAU|DAU ?GIUONG/, 'nightstand'],
  [/SHOE|TU ?GIAY/, 'shoeCabinet'],
  [/BENCH|GHE ?BANG/, 'bench'],
  [/CHAIR|GHE/, 'chair'],
  [/TABLE|\bBAN\b/, 'table'],
  [/BOOK|KE ?SACH|SHELF|\bKE\b/, 'shelf'],
  [/CABINET|\bTU\b/, 'cabinet'],
  [/\bWC\b|^WC|TOILET|BON ?CAU|XI ?BET/, 'wc'],
  [/LAV|BASIN|LAVABO|CHAU ?RUA/, 'basin'],
  [/SHOWER|SEN ?TAM/, 'shower'],
  [/BATH|BON ?TAM/, 'bathtub'],
  [/WASH|MAY ?GIAT/, 'washer'],
  [/PLANT|\bCAY\b|CHAU ?CAY/, 'plant'],
  [/RUG|\bTHAM\b/, 'rug'],
  [/LAMP|\bDEN\b|LIGHT/, 'light'],
]
/** Blocks on furniture layers that are not furniture (stair treads, floor drains, level marks…). */
const NOT_FURNITURE = /TREAD|DRAIN|PHEU|GA ?THU|LEVEL|GRID|BUB|NORTH|ARROW|SECTION|TAG/

export function furnKind(block: string): FurnKind {
  const n = norm(block).replace(/^(V|A|F|B|BL|BLK)\s/, '')
  for (const [re, k] of FURN_RULES) if (re.test(n)) return k
  return 'other'
}

/** Drops walls a junction trim left shorter than their own minimum (≥ 100 mm), with their openings. */
function pruneWalls(walls: RecWall[], openings: RecOpening[], opt: RecOptions) {
  const keep = walls.map((w) => w.s1 - w.s0 >= Math.max(100, Math.min(opt.tMax, 0.5 * w.t)))
  if (keep.every(Boolean)) return
  const map = new Map<number, number>()
  let k = 0
  keep.forEach((ok, i) => { if (ok) map.set(i, k++) })
  const kw = walls.filter((_, i) => keep[i])
  walls.splice(0, walls.length, ...kw)
  const ops = openings.filter((o) => map.has(o.wall)).map((o) => {
    const w = walls[map.get(o.wall)!]
    return { ...o, wall: map.get(o.wall)!, s0: Math.max(o.s0, w.s0), s1: Math.min(o.s1, w.s1) }
  }).filter((o) => o.s1 - o.s0 >= 200)
  openings.splice(0, openings.length, ...ops)
}

/** Removes a wall lying (≥ 70 % of its length) inside a parallel, longer wall's band; its doors / windows move over. */
function dedupeWalls(walls: RecWall[], openings: RecOpening[]) {
  const gone = new Set<number>()
  for (let i = 0; i < walls.length; i++)
    for (let j = 0; j < walls.length; j++) {
      if (i === j || gone.has(i) || gone.has(j)) continue
      const a = walls[i], b = walls[j]
      if (Math.abs(a.ux * b.uy - a.uy * b.ux) > 0.01 || a.ux * b.ux + a.uy * b.uy < 0) continue
      if (Math.abs(a.c - b.c) >= (a.t + b.t) / 2 - 5) continue
      const la = a.s1 - a.s0, lb = b.s1 - b.s0
      if (la > lb || (la === lb && i < j)) continue
      const ov = Math.min(a.s1, b.s1) - Math.max(a.s0, b.s0)
      if (ov < 0.7 * la) continue
      gone.add(i)
      for (const o of openings) {
        if (o.wall !== i) continue
        // a plain gap of the dropped line (e.g. between the end caps of two crossing partitions) is not an opening
        if (o.kind === 'opening' || openings.some((q) => q !== o && q.wall === j && q.s0 < o.s1 && o.s0 < q.s1)) { o.wall = -1; continue }
        o.wall = j
      }
    }
  if (!gone.size) return
  const map = new Map<number, number>()
  const kept = walls.filter((_, i) => !gone.has(i))
  walls.forEach((w, i) => { if (!gone.has(i)) map.set(i, kept.indexOf(w)) })
  walls.splice(0, walls.length, ...kept)
  const ops = openings.filter((o) => o.wall >= 0 && map.has(o.wall)).map((o) => ({ ...o, wall: map.get(o.wall)! }))
  openings.splice(0, openings.length, ...ops)
}

/** Curtain wall from a window block's points: its frame (block axes) if it is as deep as a wall. */
function curtainFrom(pts: Vec2[], rot: number, opt: RecOptions): RecWall | null {
  const c = Math.cos(-rot), s = Math.sin(-rot)
  const lb = { ...EMPTY }
  for (const p of pts) addPt(lb, { x: p.x * c - p.y * s, y: p.x * s + p.y * c })
  let span = lb.x1 - lb.x0, depth = lb.y1 - lb.y0
  let th = rot
  if (depth > span) { [span, depth] = [depth, span]; th += Math.PI / 2 }
  if (depth < opt.tMin || depth > opt.tMax || span < 300) return null
  th = ((th % Math.PI) + Math.PI) % Math.PI
  const ux = Math.cos(th), uy = Math.sin(th)
  const lc = centre(lb)
  const wx = lc.x * Math.cos(rot) - lc.y * Math.sin(rot), wy = lc.x * Math.sin(rot) + lc.y * Math.cos(rot)
  const sm = wx * ux + wy * uy
  return { ux, uy, c: -wx * uy + wy * ux, s0: sm - span / 2, s1: sm + span / 2, t: Math.round(depth), ext: false, curtain: true }
}

/** L / T junctions: an end inside or touching another wall's band — an L corner runs on to the other wall's outer
 *  face, a T end stops at its near face (butt joins, no overlap). Idempotent. */
function joinEnds(walls: RecWall[]) {
  const TOL = 40
  for (let i = 0; i < walls.length; i++)
    for (const end of [0, 1] as const) {
      const w1 = walls[i]
      const s = end ? w1.s1 : w1.s0
      const out = end ? 1 : -1
      const nx1 = -w1.uy, ny1 = w1.ux
      const E: P2 = [w1.ux * s + nx1 * w1.c, w1.uy * s + ny1 * w1.c]
      let best: { j: number; e: number; t: boolean; sin: number; p2: number } | null = null
      for (let j = 0; j < walls.length; j++) {
        if (j === i) continue
        const w2 = walls[j]
        const sin = Math.abs(w1.ux * w2.uy - w1.uy * w2.ux)
        if (sin < 0.34) continue
        // distance along w1 from E to w2's centre line
        const nx2 = -w2.uy, ny2 = w2.ux
        const dn = (out * w1.ux) * nx2 + (out * w1.uy) * ny2
        if (Math.abs(dn) < 1e-9) continue
        const e = (w2.c - (E[0] * nx2 + E[1] * ny2)) / dn
        const half2 = w2.t / 2 / sin
        if (e < -half2 - TOL || e > half2 + TOL) continue
        const P: P2 = [E[0] + out * w1.ux * e, E[1] + out * w1.uy * e]
        const p2 = P[0] * w2.ux + P[1] * w2.uy
        const half1 = w1.t / 2 / sin
        if (p2 < w2.s0 - half1 - TOL || p2 > w2.s1 + half1 + TOL) continue
        if (!best || Math.abs(e) < Math.abs(best.e)) best = { j, e, t: p2 > w2.s0 + 1 && p2 < w2.s1 - 1, sin, p2 }
      }
      if (!best) continue
      const w2 = walls[best.j]
      const half2 = w2.t / 2 / best.sin
      // T: stop at the near face; L: run on to the far (outer) face
      const target = best.t ? best.e - half2 : best.e + half2
      if (end) w1.s1 = s + target
      else w1.s0 = s - target
    }
}

/* ---------- main ---------- */

/** Main wall direction of a plan, modulo 90° (radians, −45°…45°): length-weighted, refined on the winning bin. */
export function dominantAngle(segs: Seg[]): number {
  const bins = new Map<number, number>()
  const items = segs.map(([a, b]) => {
    const L = Math.hypot(b.x - a.x, b.y - a.y)
    let th = Math.atan2(b.y - a.y, b.x - a.x) % (Math.PI / 2)
    if (th < 0) th += Math.PI / 2
    if (th > Math.PI / 4) th -= Math.PI / 2
    return { L, th }
  }).filter((x) => x.L >= 200)
  for (const { L, th } of items) { const k = Math.round((th * 180) / Math.PI / 0.05); bins.set(k, (bins.get(k) ?? 0) + L) }
  let best = 0, bw = -1
  for (const [k, w] of bins) if (w > bw) { bw = w; best = k }
  const c = (best * 0.05 * Math.PI) / 180
  const near = items.filter((x) => Math.abs(x.th - c) <= (0.1 * Math.PI) / 180)
  const sum = near.reduce((a, x) => a + x.L, 0)
  return sum ? near.reduce((a, x) => a + x.th * x.L, 0) / sum : 0
}

/** Entity rotated by `ang` (radians, CCW) about `o`. */
export function rotateEntity(e: Entity, ang: number, o: Vec2): Entity {
  const c = Math.cos(ang), s = Math.sin(ang)
  const R = (p: Vec2): Vec2 => ({ x: o.x + (p.x - o.x) * c - (p.y - o.y) * s, y: o.y + (p.x - o.x) * s + (p.y - o.y) * c })
  const ins = e.insert ? { insert: { ...e.insert, rot: e.insert.rot + ang } } : {}
  switch (e.kind) {
    case 'line': return { ...e, ...ins, a: R(e.a), b: R(e.b) }
    case 'polyline': return { ...e, ...ins, pts: e.pts.map(R) }
    case 'circle': return { ...e, ...ins, c: R(e.c) }
    case 'arc': return { ...e, ...ins, c: R(e.c), start: e.start + ang, end: e.end + ang }
    case 'text': return { ...e, ...ins, p: R(e.p), rotation: e.rotation + ang }
    case 'dimension': return { ...e, ...ins, a: R(e.a), b: R(e.b) }
  }
}

/** Recognises one plan region of the drawing. */
export function recognize(doc: CadDocument, roles: Record<string, LayerRole>, region: PlanRegion, opt: RecOptions = DEFAULT_REC): Recognition {
  const warnings: RecWarning[] = []
  // wall geometry of this plan only; symbols, tags and room texts also from a 1.2 m margin (tags outside the walls)
  let near = doc.entities.filter((e) => { const b = boxOf(e); return overlaps(b, region.box, roles[e.layer] === 'wall' ? 50 : 1200) })
  let wallEnts = near.filter((e) => roles[e.layer] === 'wall' && overlaps(boxOf(e), region.box, 50))
  // a plan drawn at an angle is turned square to its main wall direction first (everything below is axis-friendly);
  // the result stays in that frame (the BIM model is built square), the preview turns it back
  const angle = dominantAngle(wallEnts.flatMap(segsOf))
  const pivot = centre(region.box)
  let box = region.box
  if (Math.abs(angle) > 1e-4) {
    near = near.map((e) => rotateEntity(e, -angle, pivot))
    wallEnts = wallEnts.map((e) => rotateEntity(e, -angle, pivot))
    box = { ...EMPTY }
    for (const e of wallEnts) { const b = boxOf(e); addPt(box, { x: b.x0, y: b.y0 }); addPt(box, { x: b.x1, y: b.y1 }) }
  }
  const frame = { angle: Math.abs(angle) > 1e-4 ? angle : 0, pivot: [pivot.x, pivot.y] as P2 }

  // 1. columns
  const columns = findColumns(near.filter((e) => roles[e.layer] === 'column'))
  // 2. wall pieces; a "piece" shorter than it is thick is the end caps of a wall cut (at a column or an opening)
  const pieces = cleanPieces(pairFaces(faceLines(wallEnts.flatMap(segsOf)), opt), columns)
  // non-wall geometry for door / window evidence
  const others: Other[] = near
    .filter((e) => roles[e.layer] !== 'wall' && roles[e.layer] !== 'grid' && roles[e.layer] !== 'level' && roles[e.layer] !== 'ignore')
    .map((e) => { const b = boxOf(e); return { e, role: roles[e.layer] ?? 'ignore', box: b, c: centre(b), block: e.insert?.name ?? null } })
  const texts = near.filter((e): e is Extract<Entity, { kind: 'text' }> => e.kind === 'text' && roles[e.layer] !== 'grid' && roles[e.layer] !== 'level' && roles[e.layer] !== 'ignore' && roles[e.layer] !== 'stair')
  const insGroups = new Map<string, InsGroup>()
  for (const x of others) {
    const ins = x.e.insert
    if (!ins) continue
    const g = insGroups.get(ins.id) ?? { name: ins.name, role: x.role, pts: [] }
    g.pts.push(...ptsOf(x.e))
    insGroups.set(ins.id, g)
  }

  // 3. chains of collinear pieces (same line, same thickness), gaps classified
  const sorted = [...pieces].sort((a, b) => a.cl - b.cl || a.c - b.c)
  const lines: Piece[][] = []
  for (const p of sorted) {
    const l = lines.find((g) => g[0].cl === p.cl && Math.abs(g[0].c - p.c) <= 6 && Math.abs(g[0].t - p.t) <= 10)
    if (l) l.push(p)
    else lines.push([p])
  }
  const walls: RecWall[] = []
  const openings: RecOpening[] = []
  let gapsLeft = 0
  for (const grp of lines) {
    grp.sort((a, b) => a.s0 - b.s0)
    const { ux, uy, cl } = grp[0]
    const c = grp.reduce((s, p) => s + p.c * (p.s1 - p.s0), 0) / grp.reduce((s, p) => s + (p.s1 - p.s0), 0)
    const t = grp.reduce((s, p) => s + p.t * (p.s1 - p.s0), 0) / grp.reduce((s, p) => s + (p.s1 - p.s0), 0)
    let cur: RecWall = { ux, uy, c, t: Math.round(t), s0: grp[0].s0, s1: grp[0].s1, ext: false }
    let curOps: Omit<RecOpening, 'wall'>[] = []
    const flush = () => {
      if (cur.s1 - cur.s0 >= Math.max(100, 0.8 * cur.t)) {
        walls.push(cur)
        for (const o of curOps) openings.push({ ...o, wall: walls.length - 1 })
      }
    }
    for (const p of grp.slice(1)) {
      const g0 = cur.s1, g1 = p.s0
      if (g1 - g0 <= 20) { cur.s1 = Math.max(cur.s1, p.s1); continue }
      if (g1 - g0 > 8000) {
        // far apart: two walls on one line (e.g. the parapets of two balconies)
        gapsLeft++
        flush()
        cur = { ux, uy, c, t: Math.round(t), s0: p.s0, s1: p.s1, ext: false }
        curOps = []
        continue
      }
      const gapRect = wallRect(cur, g0, g1)
      // solid stretches inside the gap (crossing walls at T / X junctions, columns); the rest is free
      const proj = (poly: P2[]): [number, number] => { const ss = poly.map(([x, y]) => x * ux + y * uy); return [Math.min(...ss), Math.max(...ss)] }
      const solids: [number, number][] = []
      for (const q of pieces) if (q.cl !== cl && Math.abs(q.ux * uy - q.uy * ux) > 0.34) { const r = pieceRect(q, 5); if (rectsIntersect(gapRect, r)) solids.push(proj(r)) }
      for (const col of columns) { const r = columnRect(col); if (rectsIntersect(gapRect, r)) solids.push(proj(r)) }
      solids.sort((x, y) => x[0] - y[0])
      const free: [number, number][] = []
      let at = g0
      for (const [x, y] of solids) { if (x > at) free.push([at, Math.min(x, g1)]); at = Math.max(at, y) }
      if (at < g1) free.push([at, g1])
      for (const [f0, f1] of free) {
        const len = f1 - f0
        if (len < 400) continue // a short break in the drawing: the wall runs through
        const ev = len <= 6000 ? evidence(others, insGroups, ux, uy, cur.c, cur.t, f0, f1) : { kind: null, why: [] }
        const kind: RecOpening['kind'] | null = ev.kind ?? (len <= 2500 ? 'opening' : null)
        if (kind) {
          curOps.push({ kind, s0: f0, s1: f1, height: 0, sill: 0, mark: null, why: ev.why })
          continue
        }
        // nothing in a wide gap: the wall stops here and starts again after it
        gapsLeft++
        cur.s1 = Math.max(cur.s1, f0)
        flush()
        cur = { ux, uy, c, t: Math.round(t), s0: f1, s1: f1, ext: false }
        curOps = []
      }
      cur.s1 = Math.max(cur.s1, p.s1)
    }
    flush()
  }
  if (gapsLeft) warnings.push({ code: 'gapsLeftOpen', n: gapsLeft })
  if (!walls.length) warnings.push({ code: 'noWalls' })

  // 4. overlapping parallel walls (one wall drawn as two lines of pieces): the shorter one goes, its openings move
  dedupeWalls(walls, openings)
  // 5. junctions
  joinEnds(walls)
  pruneWalls(walls, openings, opt)

  // 6. door / window blocks over unbroken walls
  const hosted = new Set<string>()
  for (const o of openings) for (const x of others) {
    const w = walls[o.wall]
    const lc = { s: x.c.x * w.ux + x.c.y * w.uy, o: -x.c.x * w.uy + x.c.y * w.ux - w.c }
    if (x.e.insert && lc.s >= o.s0 - 150 && lc.s <= o.s1 + 150 && Math.abs(lc.o) <= w.t / 2 + 1300) hosted.add(x.e.insert.id)
  }
  const symbolGroups = new Map<string, { kind: 'door' | 'window'; rot: number; pts: Vec2[] }>()
  for (const x of others) {
    const ins = x.e.insert
    if (!ins || hosted.has(ins.id)) continue
    const b = norm(ins.name)
    const kind = WIN_BLOCK.test(b) || x.role === 'window' ? 'window' : DOOR_BLOCK.test(b) || x.role === 'door' ? 'door' : null
    if (!kind) continue
    const g = symbolGroups.get(ins.id) ?? { kind, rot: ins.rot, pts: [] }
    g.pts.push(...ptsOf(x.e))
    symbolGroups.set(ins.id, g)
  }
  let orphan = 0, curtains = 0
  for (const g of symbolGroups.values()) {
    let host = -1, lo = 0, hi = 0
    for (let i = 0; i < walls.length && host < 0; i++) {
      const w = walls[i]
      const ls = g.pts.map((p) => ({ s: p.x * w.ux + p.y * w.uy, o: -p.x * w.uy + p.y * w.ux - w.c }))
      // the block's points that lie in the wall band give the opening's extent
      const inBand = ls.filter((p) => Math.abs(p.o) <= w.t / 2 + 5)
      if (inBand.length < 2) continue
      const a = Math.min(...inBand.map((p) => p.s)), b2 = Math.max(...inBand.map((p) => p.s))
      if (b2 - a < 300 || a < w.s0 - 5 || b2 > w.s1 + 5) continue
      if (openings.some((o) => o.wall === i && o.s0 < b2 && a < o.s1)) continue
      host = i; lo = a; hi = b2
    }
    if (host < 0) {
      // a window symbol as deep as a wall with no wall around it: glazing over the whole stretch (curtain wall)
      const cw = g.kind === 'window' ? curtainFrom(g.pts, g.rot, opt) : null
      if (cw) { walls.push(cw); curtains++ } else orphan++
      continue
    }
    openings.push({ wall: host, kind: g.kind, s0: lo, s1: hi, height: 0, sill: 0, mark: null, why: ['block'] })
  }
  if (orphan) warnings.push({ code: 'symbolsNoWall', n: orphan })
  if (curtains) { joinEnds(walls); pruneWalls(walls, openings, opt) }

  // 7. tags: each tag text goes to the nearest opening of its kind (an opening without a symbol takes a tag
  //    only from close by); sizes ("900x2200") from the nearest text matching the opening's width
  const mid = (o: RecOpening): P2 => {
    const w = walls[o.wall], m = (o.s0 + o.s1) / 2
    return [w.ux * m - w.uy * w.c, w.uy * m + w.ux * w.c]
  }
  const tagCands: { i: number; t: number; d: number; m: { kind: 'door' | 'window'; mark: string } }[] = []
  openings.forEach((o, i) => {
    const [cx, cy] = mid(o)
    const reach = Math.max(1000, o.s1 - o.s0)
    texts.forEach((t, k) => {
      const d = Math.hypot(t.p.x - cx, t.p.y - cy)
      if (d > reach) return
      const m = parseMark(t.value.split(/\s/)[0] ?? '')
      if (!m) return
      if (o.kind === 'opening' ? d > 700 : m.kind !== o.kind) return
      tagCands.push({ i, t: k, d, m })
    })
  })
  tagCands.sort((x, y) => x.d - y.d)
  const usedTag = new Set<number>(), tagged = new Set<number>()
  for (const c of tagCands) {
    if (usedTag.has(c.t) || tagged.has(c.i)) continue
    usedTag.add(c.t)
    tagged.add(c.i)
    const o = openings[c.i]
    o.mark = c.m.mark
    o.why.push('tag')
    if (o.kind === 'opening') o.kind = c.m.kind
  }
  for (const o of openings) {
    const [cx, cy] = mid(o)
    const reach = Math.max(1000, o.s1 - o.s0)
    let size: [number, number] | null = null, sd = Infinity
    for (const t of texts) {
      const d = Math.hypot(t.p.x - cx, t.p.y - cy)
      const sz = d <= reach ? parseSize(t.value) : null
      if (sz && d < sd && Math.abs(sz[0] - (o.s1 - o.s0)) <= 0.2 * (o.s1 - o.s0)) { size = sz; sd = d }
    }
    if (o.kind === 'window') { o.sill = opt.winSill; o.height = size?.[1] ?? opt.winH }
    else { o.sill = 0; o.height = size?.[1] ?? (o.kind === 'door' ? opt.doorH : opt.openingH) }
  }

  const noSymbol = openings.filter((o) => o.kind === 'opening').length
  if (noSymbol) warnings.push({ code: 'openingsNoSymbol', n: noSymbol })

  // 8. rooms and footprint (raster), exterior walls
  let rooms: RecRoom[] = []
  let footprint: P2[] | null = null
  if (walls.length) {
    const ras = rasterize(walls, columns, box)
    const lines = snapLines(walls, columns)
    const reach = 3 * ras.h
    const cellOf = (x: number, y: number) => {
      const i = Math.floor((x - ras.x0) / ras.h), j = Math.floor((y - ras.y0) / ras.h)
      return i < 0 || j < 0 || i >= ras.W || j >= ras.H ? -1 : j * ras.W + i
    }
    // exterior walls: one side of the wall is outside
    for (const w of walls) {
      const mid = (w.s0 + w.s1) / 2
      const nx = -w.uy, ny = w.ux
      for (const sg of [-1, 1]) {
        const off = w.c + sg * (w.t / 2 + 2.5 * ras.h)
        const k = cellOf(w.ux * mid + nx * off, w.uy * mid + ny * off)
        if (k >= 0 && ras.label[k] === 1) w.ext = true
      }
    }
    // region sizes and cell bounds
    const cells = new Int32Array(ras.regions + 1)
    const bnd = new Int32Array(4 * (ras.regions + 1)).fill(-1)
    for (let k = 0; k < ras.label.length; k++) {
      const id = ras.label[k]
      cells[id]++
      const i = k % ras.W, j = (k - i) / ras.W, b = 4 * id
      if (bnd[b] < 0) { bnd[b] = i; bnd[b + 1] = j; bnd[b + 2] = i; bnd[b + 3] = j }
      else { bnd[b] = Math.min(bnd[b], i); bnd[b + 1] = Math.min(bnd[b + 1], j); bnd[b + 2] = Math.max(bnd[b + 2], i); bnd[b + 3] = Math.max(bnd[b + 3], j) }
    }
    // names: room texts inside a region
    const named = new Map<number, { name: string | null; number: string | null; score: number }>()
    for (const t of texts) {
      const v = t.value.trim()
      if (!hasLetters(v) || isAreaText(v) || parseMark(v) || parseSize(v) || (parseElevation(v) !== null && v.length < 14)) {
        // room numbers ("101", "R101") are kept as numbers
        if (/^[A-Z]?\d{2,4}[A-Z]?$/i.test(v) && !parseMark(v)) {
          const k = cellOf(t.p.x, t.p.y)
          const id = k >= 0 ? ras.label[k] : 0
          if (id >= 2) { const cur = named.get(id) ?? { name: null, number: null, score: 0 }; cur.number ??= v; named.set(id, cur) }
        }
        continue
      }
      const k = cellOf(t.p.x, t.p.y)
      const id = k >= 0 ? ras.label[k] : 0
      if (id < 2) continue
      const score = t.height + (roles[t.layer] === 'room' ? 1e6 : 0)
      const cur = named.get(id) ?? { name: null, number: null, score: 0 }
      if (score > cur.score) { cur.name = v; cur.score = score }
      named.set(id, cur)
    }
    let unnamed = 0, fallback = 0
    // rooms drawn as closed outlines on the room layers (designer's areas) win over the raster regions they cover
    const covered = new Set<number>()
    const explicit = explicitRooms(near.filter((e) => roles[e.layer] === 'room'))
    const roomTexts = (poly: P2[]) => {
      let name: string | null = null, number: string | null = null, best = -1
      for (const t of texts) {
        if (!insidePoly([t.p.x, t.p.y], poly)) continue
        const v = t.value.trim()
        if (/^[A-Z]?\d{2,4}[A-Z]?$/i.test(v) && !parseMark(v)) { number ??= v; continue }
        if (!hasLetters(v) || isAreaText(v) || parseMark(v) || parseSize(v) || (parseElevation(v) !== null && v.length < 14)) continue
        const sc = t.height + (roles[t.layer] === 'room' ? 1e6 : 0)
        if (sc > best) { best = sc; name = v }
      }
      return { name, number }
    }
    for (const poly of explicit) {
      const ip = interiorPoint(poly)
      const k = cellOf(ip[0], ip[1])
      if (k >= 0 && ras.label[k] >= 2) covered.add(ras.label[k])
      const nm = roomTexts(poly)
      if (!nm.name) unnamed++
      rooms.push({ ...nm, outline: shoelace(poly) < 0 ? [...poly].reverse() : poly, area: Math.round(Math.abs(shoelace(poly)) / 1e4) / 100 })
    }
    const minCells = 0.8e6 / (ras.h * ras.h)
    for (let id = 2; id <= ras.regions; id++) {
      if (cells[id] < minCells || covered.has(id)) continue
      // a region largely inside drawn room outlines is those rooms (sampled every 3rd cell)
      if (explicit.length) {
        let n = 0, hit = 0
        for (let j = bnd[4 * id + 1]; j <= bnd[4 * id + 3]; j += 3)
          for (let i = bnd[4 * id]; i <= bnd[4 * id + 2]; i += 3) {
            if (ras.label[j * ras.W + i] !== id) continue
            n++
            const pt: P2 = [ras.x0 + (i + 0.5) * ras.h, ras.y0 + (j + 0.5) * ras.h]
            if (explicit.some((q) => insidePoly(pt, q))) hit++
          }
        if (hit >= 0.3 * n) continue
      }
      const nm = named.get(id)
      if (!nm?.name && cells[id] < 2e6 / (ras.h * ras.h)) continue
      const raw = traceOuter(ras, (k) => ras.label[k] === id, [bnd[4 * id], bnd[4 * id + 1], bnd[4 * id + 2], bnd[4 * id + 3]])
      if (!raw) continue
      const simple = simplify(raw, 1.2 * ras.h)
      let outline = snapOutline(simple, lines, reach)
      const rasterArea = cells[id] * ras.h * ras.h
      let area = Math.abs(shoelace(outline))
      if (outline.length < 3 || Math.abs(area - rasterArea) > 0.15 * rasterArea) { outline = simple; area = Math.abs(shoelace(simple)); fallback++ }
      if (shoelace(outline) < 0) outline.reverse()
      // free-standing columns inside the room are not floor area
      for (const c of columns) if (insidePoly([c.x, c.y], outline)) area -= c.round ? (Math.PI * c.w * c.w) / 4 : c.w * c.d
      if (!nm?.name) unnamed++
      rooms.push({ name: nm?.name ?? null, number: nm?.number ?? null, outline, area: Math.round(area / 1e4) / 100 })
    }
    rooms = rooms.sort((a, b) => b.area - a.area)
    if (unnamed) warnings.push({ code: 'unnamedRooms', n: unnamed })
    if (fallback) warnings.push({ code: 'roomSnapFallback', n: fallback })
    const outer = traceOuter(ras, (k) => ras.label[k] !== 1)
    if (outer) {
      const fp = snapOutline(simplify(outer, 1.2 * ras.h), lines, reach)
      footprint = fp.length >= 3 ? (shoelace(fp) < 0 ? fp.reverse() : fp) : null
    }
  }

  // 9. furniture blocks
  const groups = new Map<string, { name: string; rot: number; pts: Vec2[] }>()
  for (const e of near) {
    const ins = e.insert
    if (!ins || roles[e.layer] !== 'furniture') continue
    if (NOT_FURNITURE.test(norm(ins.name)) || DOOR_BLOCK.test(norm(ins.name)) || WIN_BLOCK.test(norm(ins.name))) continue
    const g = groups.get(ins.id) ?? { name: ins.name, rot: ins.rot, pts: [] }
    g.pts.push(...ptsOf(e))
    groups.set(ins.id, g)
  }
  const furniture: RecFurniture[] = []
  let unknownFurn = 0
  for (const g of groups.values()) {
    const c = Math.cos(-g.rot), s = Math.sin(-g.rot)
    const lb = { ...EMPTY }
    for (const p of g.pts) addPt(lb, { x: p.x * c - p.y * s, y: p.x * s + p.y * c })
    const w = lb.x1 - lb.x0, d = lb.y1 - lb.y0
    if (w < 150 || d < 150 || w > 8000 || d > 8000) continue
    const lc = centre(lb)
    const kind = furnKind(g.name)
    if (kind === 'other') unknownFurn++
    // centre back in plan coordinates
    furniture.push({ block: g.name, kind, x: lc.x * Math.cos(g.rot) - lc.y * Math.sin(g.rot), y: lc.x * Math.sin(g.rot) + lc.y * Math.cos(g.rot), w: Math.round(w), d: Math.round(d), rot: Math.round(((((g.rot * 180) / Math.PI + 540) % 360) - 180) * 100) / 100 })
  }
  if (unknownFurn) warnings.push({ code: 'unknownFurniture', n: unknownFurn })
  if (near.some((e) => roles[e.layer] === 'stair')) warnings.push({ code: 'stairsSkipped' })

  // 10. grids: long lines on grid layers labelled by the nearest short text at one of their ends
  const grids: RecGrid[] = []
  const gridEnts = doc.entities.filter((e) => roles[e.layer] === 'grid' && overlaps(boxOf(e), region.box, 8000)).map((e) => (frame.angle ? rotateEntity(e, -frame.angle, pivot) : e))
  const gridTexts = gridEnts.filter((e): e is Extract<Entity, { kind: 'text' }> => e.kind === 'text' && e.value.trim().length <= 3)
  for (const e of gridEnts) {
    for (const [a, b] of segsOf(e)) {
      const L = Math.hypot(b.x - a.x, b.y - a.y)
      if (L < 3000) continue
      let label: string | null = null, ld = 1500
      for (const t of gridTexts)
        for (const p of [a, b]) {
          const d = Math.hypot(t.p.x - p.x, t.p.y - p.y)
          if (d < ld) { ld = d; label = t.value.trim() }
        }
      if (!label) continue
      const prev = grids.find((g) => g.label === label)
      if (prev && Math.hypot(prev.b[0] - prev.a[0], prev.b[1] - prev.a[1]) >= L) continue
      const gl: RecGrid = { label, a: [a.x, a.y], b: [b.x, b.y] }
      if (prev) Object.assign(prev, gl)
      else grids.push(gl)
    }
  }

  return { region, frame, walls, openings, columns, rooms, footprint, furniture, grids, warnings }
}
