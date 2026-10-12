/**
 * Feature-based part (Part Studio): sketches on a principal plane and an ordered feature list. The desktop
 * app evaluates it with OCCT (native/libs/geom_occt/src/part.cpp — extrude / revolve add or cut, holes
 * starting on the material under them with counterbores, fillets and chamfers by edge set, linear and
 * circular patterns); a feature that fails is skipped and reported. Units: mm.
 */
import { hex, type Scene } from '../engine3d/scene'
import { matOf } from './model'

export type SketchShape =
  | { t: 'rect'; x: number; y: number; w: number; h: number }
  | { t: 'circle'; x: number; y: number; r: number }
  | { t: 'poly'; pts: [number, number][] }
  | { t: 'slot'; x: number; y: number; w: number; r: number; angle: number }

export type Plane = 'XY' | 'XZ' | 'YZ'

export interface Sketch {
  id: string
  name: string
  plane: Plane
  offset: number
  shapes: SketchShape[]
}

export type EdgeSet = 'all' | 'vertical' | 'top' | 'bottom' | 'circular'

interface Base {
  id: string
  name: string
  suppressed?: boolean
}
export type Feature =
  | (Base & { kind: 'extrude'; sketch: string; depth: number; op: 'add' | 'cut'; reverse?: boolean; through?: boolean; symmetric?: boolean })
  | (Base & { kind: 'revolve'; sketch: string; angle: number; axis: 'u' | 'v'; op: 'add' | 'cut' })
  | (Base & { kind: 'hole'; x: number; y: number; dia: number; depth: number; through: boolean; cbDia?: number; cbDepth?: number })
  | (Base & { kind: 'fillet'; edges: EdgeSet; r: number })
  | (Base & { kind: 'chamfer'; edges: EdgeSet; r: number })
  | (Base & { kind: 'pattern'; source: string; type: 'linear' | 'circular'; count: number; dx: number; dy: number; angle: number; cx: number; cy: number })

export type FeatureKind = Feature['kind']

export interface Part {
  id: string
  name: string
  file: string
  material: string
  sketches: Sketch[]
  features: Feature[]
}

/** Sample part: a bearing bracket — plate with rounded corners, boss with a through bore, four counterbored mounting holes. */
export function bracketPart(): Part {
  return {
    id: 'part-bracket',
    name: 'Bearing Bracket',
    file: 'Bearing_Bracket.prt',
    material: 'AISI 1045',
    sketches: [
      { id: 's1', name: 'Sketch 1 — plate', plane: 'XY', offset: 0, shapes: [{ t: 'rect', x: 0, y: 0, w: 120, h: 80 }] },
      { id: 's2', name: 'Sketch 2 — boss', plane: 'XY', offset: 12, shapes: [{ t: 'circle', x: 60, y: 40, r: 22 }] },
    ],
    features: [
      { id: 'f1', name: 'Extrude 1 — plate 12', kind: 'extrude', sketch: 's1', depth: 12, op: 'add' },
      { id: 'f2', name: 'Fillet 1 — corners R6', kind: 'fillet', edges: 'vertical', r: 6 },
      { id: 'f3', name: 'Extrude 2 — boss 18', kind: 'extrude', sketch: 's2', depth: 18, op: 'add' },
      { id: 'f4', name: 'Hole 1 — bore Ø25', kind: 'hole', x: 60, y: 40, dia: 25, depth: 30, through: true },
      { id: 'f5', name: 'Hole 2 — M8 Ø9 / cb Ø15 × 5', kind: 'hole', x: 15, y: 15, dia: 9, depth: 12, through: true, cbDia: 15, cbDepth: 5 },
      { id: 'f6', name: 'Pattern 1 — ×2, 90 mm', kind: 'pattern', source: 'f5', type: 'linear', count: 2, dx: 90, dy: 0, angle: 360, cx: 0, cy: 0 },
      { id: 'f7', name: 'Hole 3 — M8 Ø9 / cb Ø15 × 5', kind: 'hole', x: 15, y: 65, dia: 9, depth: 12, through: true, cbDia: 15, cbDepth: 5 },
      { id: 'f8', name: 'Pattern 2 — ×2, 90 mm', kind: 'pattern', source: 'f7', type: 'linear', count: 2, dx: 90, dy: 0, angle: 360, cx: 0, cy: 0 },
    ],
  }
}

export function blankPart(n: number): Part {
  return { id: `part-${Date.now().toString(36)}`, name: `Part ${n}`, file: `Part_${n}.prt`, material: 'Steel', sketches: [], features: [] }
}

/** Scene for the native engine: one item evaluated from the feature tree. */
export function partScene(p: Part): Scene {
  const json = {
    sketches: p.sketches.map((s) => ({ id: s.id, plane: s.plane, offset: s.offset, shapes: s.shapes })),
    features: p.features.map((f) => ({ ...f })),
  }
  const color = /bronze/i.test(p.material) ? '#b08d57' : /cast iron/i.test(p.material) ? '#6b6e73' : /stainless|duplex/i.test(p.material) ? '#c4c8cd' : '#a7adb5'
  return { items: [{ id: p.id, rgb: hex(color), mat: 'metal', parts: [], part: json }], volumes: true }
}

export const density = (p: Part) => matOf(p.material)?.density ?? 7850

/** Feature id → native error message (from scene3dLoad errors "partId: featureId: reason"). */
export function featureErrors(p: Part, errors: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const e of errors ?? []) {
    const [item, fid, ...rest] = e.split(': ')
    if (item === p.id && fid) out[fid] = rest.join(': ')
  }
  return out
}

/** Sketch shapes' extents in the sketch's own (u, v) coordinates. */
export function shapeBounds(s: SketchShape): [number, number, number, number] {
  if (s.t === 'rect') return [s.x, s.y, s.x + s.w, s.y + s.h]
  if (s.t === 'circle') return [s.x - s.r, s.y - s.r, s.x + s.r, s.y + s.r]
  if (s.t === 'slot') {
    const a = (s.angle * Math.PI) / 180, dx = (Math.abs(Math.cos(a)) * s.w) / 2 + s.r, dy = (Math.abs(Math.sin(a)) * s.w) / 2 + s.r
    return [s.x - dx, s.y - dy, s.x + dx, s.y + dy]
  }
  const xs = s.pts.map((p) => p[0]), ys = s.pts.map((p) => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/** Stock box from the XY-plane "add" extrudes (what a 3-axis setup machines): x0 y0 z0 x1 y1 z1. */
export function stockOf(p: Part, margin = 2, top = 1): [number, number, number, number, number, number] | null {
  let b: number[] | null = null
  for (const f of p.features) {
    if (f.suppressed || f.kind !== 'extrude' || f.op !== 'add') continue
    const s = p.sketches.find((k) => k.id === f.sketch)
    if (!s || s.plane !== 'XY') continue
    const z0 = s.offset + (f.reverse ? -f.depth : 0) - (f.symmetric ? f.depth / 2 : 0), z1 = z0 + f.depth
    for (const sh of s.shapes) {
      const [x0, y0, x1, y1] = shapeBounds(sh)
      b = b ? [Math.min(b[0], x0), Math.min(b[1], y0), Math.min(b[2], z0), Math.max(b[3], x1), Math.max(b[4], y1), Math.max(b[5], z1)] : [x0, y0, z0, x1, y1, z1]
    }
  }
  return b ? [b[0] - margin, b[1] - margin, b[2], b[3] + margin, b[4] + margin, b[5] + top] : null
}

/** Hole instances after patterns (for drawings and CAM). */
export function holeInstances(p: Part): { f: Extract<Feature, { kind: 'hole' }>; x: number; y: number }[] {
  const out: { f: Extract<Feature, { kind: 'hole' }>; x: number; y: number }[] = []
  for (const f of p.features) {
    if (f.suppressed) continue
    if (f.kind === 'hole') out.push({ f, x: f.x, y: f.y })
    if (f.kind === 'pattern') {
      const src = p.features.find((x) => x.id === f.source)
      if (!src || src.kind !== 'hole' || src.suppressed) continue
      for (let i = 1; i < Math.max(2, f.count); i++) {
        if (f.type === 'linear') out.push({ f: src, x: src.x + f.dx * i, y: src.y + f.dy * i })
        else {
          const a = ((f.angle >= 360 ? 360 / f.count : f.angle / (f.count - 1)) * i * Math.PI) / 180
          const rx = src.x - f.cx, ry = src.y - f.cy
          out.push({ f: src, x: f.cx + rx * Math.cos(a) - ry * Math.sin(a), y: f.cy + rx * Math.sin(a) + ry * Math.cos(a) })
        }
      }
    }
  }
  return out
}

export const FEATURE_KINDS: FeatureKind[] = ['extrude', 'revolve', 'hole', 'fillet', 'chamfer', 'pattern']
