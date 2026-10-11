import type { Entity, Vec2 } from '../cad/types'

/**
 * Tiny geometry kit for library components. Shapes are drawn in millimetres with the component's
 * bounding box from (0, 0) to (w, d); ids / layers / colours are assigned when inserted.
 */
const base = { id: '', layer: '0', color: 'ByLayer', linetype: 'ByLayer' as const, lineweight: 'ByLayer' as const, transparency: 0 }
export type Shape = Entity

export const line = (ax: number, ay: number, bx: number, by: number): Shape => ({ ...base, kind: 'line', a: { x: ax, y: ay }, b: { x: bx, y: by } })
export const poly = (pts: [number, number][], closed = true, filled = false): Shape => ({
  ...base, kind: 'polyline', pts: pts.map(([x, y]) => ({ x, y })), closed, ...(filled ? { filled: true } : {}),
})
export const rect = (x: number, y: number, w: number, h: number): Shape => poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]])
export const circle = (cx: number, cy: number, r: number): Shape => ({ ...base, kind: 'circle', c: { x: cx, y: cy }, r })
/** Angles in degrees, counter-clockwise from +X. */
export const arc = (cx: number, cy: number, r: number, a0: number, a1: number): Shape => ({
  ...base, kind: 'arc', c: { x: cx, y: cy }, r, start: (a0 * Math.PI) / 180, end: (a1 * Math.PI) / 180,
})
export const text = (x: number, y: number, h: number, value: string, center = true): Shape => ({
  ...base, kind: 'text', p: { x, y }, height: h, value, rotation: 0, align: center ? 'center' : 'left',
})
export const roundRect = (x: number, y: number, w: number, h: number, r: number): Shape[] => {
  r = Math.min(r, w / 2, h / 2)
  return [
    line(x + r, y, x + w - r, y), line(x + w, y + r, x + w, y + h - r), line(x + w - r, y + h, x + r, y + h), line(x, y + h - r, x, y + r),
    arc(x + w - r, y + r, r, 270, 360), arc(x + w - r, y + h - r, r, 0, 90), arc(x + r, y + h - r, r, 90, 180), arc(x + r, y + r, r, 180, 270),
  ]
}
export const regular = (cx: number, cy: number, r: number, n: number, rot = 0): Shape =>
  poly(Array.from({ length: n }, (_, i) => {
    const a = rot + (i * 2 * Math.PI) / n
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as [number, number]
  }))

export function bounds(shapes: Shape[]): { min: Vec2; max: Vec2 } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const add = (p: Vec2) => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y) }
  for (const s of shapes) {
    if (s.kind === 'line') { add(s.a); add(s.b) }
    else if (s.kind === 'polyline') s.pts.forEach(add)
    else if (s.kind === 'circle' || s.kind === 'arc') { add({ x: s.c.x - s.r, y: s.c.y - s.r }); add({ x: s.c.x + s.r, y: s.c.y + s.r }) }
    else if (s.kind === 'text') add(s.p)
    else if (s.kind === 'dimension') { add(s.a); add(s.b) }
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } }
}
