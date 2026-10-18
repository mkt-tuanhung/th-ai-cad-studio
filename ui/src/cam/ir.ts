/**
 * Neutral intermediate representation (IR) of a CNC job, before any controller dialect. The CAM of a nested
 * sheet (drilling, back-panel rebates / grooves, outside profiles with tabs) is built here once; the posts in
 * cam/posts/* turn the same IR into GRBL 1.1, LinuxCNC, ISO generic or NcStudio-style text. Coordinates: mm,
 * sheet lower-left corner = X0 Y0, Z0 = top of the board.
 *
 * Traverses are clamp-aware: a rapid that would cross a clamp / no-go zone (grown by the tool radius) below its
 * top + clearance first climbs to the clearance height, so drilling hops at Z2 never sweep over a clamp.
 */
import type { OperationKind } from './machine'
import type { Placement } from './nesting'

export type IrMove =
  | { k: 'rapid'; x?: number; y?: number; z?: number }
  | { k: 'feed'; x?: number; y?: number; z?: number; f?: number }
  | { k: 'arc'; cw: boolean; x: number; y: number; i: number; j: number }
  | { k: 'comment'; text: string }

export interface IrTool {
  n: number
  name: string
  d: number
  rpm: number
  feed: number
  plunge: number
  kind: 'END_MILL' | 'DRILL' | 'FORSTNER'
  head_id?: string | null
  tool_id?: string | null
}

export interface IrBlock {
  op: OperationKind
  tool: number
  label: string
  moves: IrMove[]
}

export interface IrProgram {
  name: string
  /** Header comment lines (plain text, no parentheses). */
  title: string[]
  /** Retract height above the board between features. */
  safeZ: number
  /** Height that clears every clamp (= safeZ without clamps): program start, tool changes, the end. */
  clearZ: number
  tools: IrTool[]
  /** In machining order; blocks of one tool are contiguous. */
  blocks: IrBlock[]
  stock: { l: number; w: number; t: number }
}

export interface ClampRect {
  x0: number
  y0: number
  x1: number
  y1: number
  z_top: number
}

/** Does the segment a → b pass within r of the rectangle? (Liang–Barsky on the grown rectangle.) */
export function segmentHitsRect(ax: number, ay: number, bx: number, by: number, z: { x0: number; y0: number; x1: number; y1: number }, r: number): boolean {
  const x0 = z.x0 - r, y0 = z.y0 - r, x1 = z.x1 + r, y1 = z.y1 + r
  let t0 = 0, t1 = 1
  const dx = bx - ax, dy = by - ay
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]] as const) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return false
    } else {
      const t = q / p
      if (p < 0) t0 = Math.max(t0, t)
      else t1 = Math.min(t1, t)
      if (t0 > t1) return false
    }
  }
  return true
}

/** Tracks the tool position and emits clamp-aware traverses. */
export class Traverse {
  x = 0
  y = 0
  z: number
  private clamps: ClampRect[]
  private clearance: number
  readonly clearZ: number
  constructor(clamps: ClampRect[], clearance: number, safeZ: number) {
    this.clamps = clamps
    this.clearance = clearance
    this.clearZ = clamps.length ? Math.max(safeZ, ...clamps.map((c) => c.z_top + clearance)) : safeZ
    this.z = this.clearZ
  }
  /** Lowest Z at which a straight XY move to (x, y) clears every clamp for a tool of radius r. */
  needZ(x: number, y: number, r: number): number {
    let need = -Infinity
    for (const c of this.clamps) if (segmentHitsRect(this.x, this.y, x, y, c, r + 1)) need = Math.max(need, c.z_top + this.clearance)
    return need
  }
  /** Rapid to (x, y): climbs first when the straight move would cross a clamp too low. */
  to(moves: IrMove[], x: number, y: number, r: number) {
    const need = this.needZ(x, y, r)
    if (this.z < need) {
      moves.push({ k: 'rapid', z: need })
      this.z = need
    }
    moves.push({ k: 'rapid', x, y })
    this.x = x
    this.y = y
  }
  rapidZ(moves: IrMove[], z: number) {
    moves.push({ k: 'rapid', z })
    this.z = z
  }
  feed(moves: IrMove[], m: { x?: number; y?: number; z?: number; f?: number }) {
    moves.push({ k: 'feed', ...m })
    this.x = m.x ?? this.x
    this.y = m.y ?? this.y
    this.z = m.z ?? this.z
  }
  arc(moves: IrMove[], m: { cw: boolean; x: number; y: number; i: number; j: number }) {
    moves.push({ k: 'arc', ...m })
    this.x = m.x
    this.y = m.y
  }
  /** At the start of every tool (header / tool change retract to clearZ). */
  reset() {
    this.z = this.clearZ
  }
}

/** Groove / rebate strip of a placed part in SHEET coordinates (cut-blank frame, rotation applied). */
export interface SheetGroove {
  part: string
  partId?: string
  /** Along-the-groove start / end and the across range, in sheet coordinates. */
  x0: number
  y0: number
  x1: number
  y1: number
  /** true: the groove runs along sheet X. */
  alongX: boolean
  depth: number
  width: number
  /** Open on one side (a rebate): a cutter wider than the strip may run half outside the part. */
  open: boolean
  /** Which side of the strip is open (for a rebate): +1 = the high side (larger coordinate). */
  openSide: 1 | -1
}

/**
 * Part-local (cut blank, x along the length, y across) → sheet coordinates. A rotated part is turned by +90°
 * (a rigid rotation, never a mirror), so face A stays up and its features keep their handing:
 * sheet X = x0 + w − y, sheet Y = y0 + x.
 */
export const toSheet = (p: Placement, x: number, y: number): [number, number] => (p.rotated ? [p.x + p.w - y, p.y + x] : [p.x + x, p.y + y])

/** Grooves of a placed piece in sheet coordinates. */
export function groovesOf(p: Placement): SheetGroove[] {
  const e = p.edges ?? { L1: 0, L2: 0, W1: 0, W2: 0 }
  const wf = p.finished?.w ?? p.w
  const out: SheetGroove[] = []
  for (const g of p.grooves ?? []) {
    // part-local (cut blank): groove along L2 (the y = w side), through the whole length
    const yb = Math.min(wf - g.setback - e.L1, p.w), ya = wf - g.setback - g.width - e.L1
    const open = g.setback <= 1e-9
    if (!p.rotated) out.push({ part: p.label, partId: p.partId, x0: p.x, x1: p.x + p.l, y0: p.y + ya, y1: p.y + yb, alongX: true, depth: g.depth, width: g.width, open, openSide: 1 })
    // rotated: local y → sheet X = x0 + w − y, so the L2 side is the low-X side
    else out.push({ part: p.label, partId: p.partId, x0: p.x + p.w - yb, x1: p.x + p.w - ya, y0: p.y, y1: p.y + p.l, alongX: false, depth: g.depth, width: g.width, open, openSide: -1 })
  }
  return out
}

/** Centre-line offsets (across the strip) of the passes a cutter of radius R needs; null = the cutter cannot. */
export function groovePasses(g: SheetGroove, R: number): number[] | null {
  const a = g.alongX ? g.y0 : g.x0, b = g.alongX ? g.y1 : g.x1
  const width = b - a
  if (2 * R > width + 1e-6) {
    if (!g.open) return null
    // a rebate: one pass with the cutter's far side flush with the strip's inner edge
    return g.openSide > 0 ? [a + R] : [b - R]
  }
  const n = Math.max(1, Math.ceil((width - 2 * R) / (1.6 * R)) + 1)
  return Array.from({ length: n }, (_, i) => (n === 1 ? a + R : a + R + ((width - 2 * R) * i) / (n - 1)))
}
