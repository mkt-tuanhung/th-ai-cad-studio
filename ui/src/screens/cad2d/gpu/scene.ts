import earcut from 'earcut'
import type { Entity, Layer, Vec2 } from '../../../cad/types'
import { arcPoint, bboxOf, dimensionGeometry, formatLength, measured, norm, add, scale, sub, unionBBox } from '../../../cad/geometry'

/**
 * GPU scene for large drawings: every entity tessellated into line segments (and triangles for
 * solid fills), grouped by (layer, colour, opacity, width) so a layer can be hidden without a
 * rebuild. Coordinates are stored relative to `origin` (the drawing centre) — world millimetres
 * can reach 1e7 and float32 would lose precision otherwise. Texts stay on the CPU (Canvas 2D).
 */
export interface DrawGroup {
  layer: string
  rgba: [number, number, number, number]
  widthPx: number
  /** In segments (4 floats each). */
  segStart: number
  segCount: number
  /** In vertices (2 floats each). */
  triStart: number
  triCount: number
}

export interface SceneText {
  x: number
  y: number
  /** World cap height (mm). */
  h: number
  rot: number
  value: string
  align: 'left' | 'center'
  middle: boolean
  layer: string
  color: string
  alpha: number
}

export interface GpuScene {
  origin: Vec2
  segs: Float32Array
  tris: Float32Array
  groups: DrawGroup[]
  texts: SceneText[]
  segments: number
}

const DEFAULT_COLOR = '#1f2937'

export function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [0.12, 0.16, 0.22]
  const n = parseInt(m[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** Same stroke resolution as the SVG renderer (DrawingSvg.strokeOf). */
function style(e: Entity, layer: Layer | undefined) {
  const color = e.color === 'ByLayer' ? (layer?.color ?? DEFAULT_COLOR) : e.color
  const lw = e.lineweight === 'ByLayer' ? (layer?.lineweight ?? 0.25) : Number(e.lineweight)
  return { color, alpha: 1 - e.transparency / 100, width: lw >= 0.5 ? 2 : lw >= 0.35 ? 1.5 : 1 }
}

export function buildScene(entities: Entity[], layers: Layer[]): GpuScene {
  const byName = new Map(layers.map((l) => [l.name, l]))
  const box = unionBBox(entities.map(bboxOf))
  const origin = box ? { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 } : { x: 0, y: 0 }
  const diag = box ? Math.hypot(box.maxX - box.minX, box.maxY - box.minY) : 1
  // chord tolerance for curves: fine enough to look round when zoomed well in
  const tol = Math.max(diag * 2e-6, 1e-3)

  interface Acc { layer: string; color: string; alpha: number; width: number; segs: number[]; tris: number[] }
  const acc = new Map<string, Acc>()
  const texts: SceneText[] = []
  const ox = origin.x, oy = origin.y

  for (const e of entities) {
    const st = style(e, byName.get(e.layer))
    const key = `${e.layer}\u0000${st.color}\u0000${st.alpha}\u0000${st.width}`
    let a = acc.get(key)
    if (!a) acc.set(key, (a = { layer: e.layer, color: st.color, alpha: st.alpha, width: st.width, segs: [], tris: [] }))
    const S = a.segs
    const seg = (p: Vec2, q: Vec2) => S.push(p.x - ox, p.y - oy, q.x - ox, q.y - oy)
    const curve = (c: Vec2, r: number, a0: number, sweep: number) => {
      const step = r > tol ? 2 * Math.acos(Math.max(-1, 1 - tol / r)) : Math.PI / 4
      const n = Math.min(1024, Math.max(8, Math.ceil(Math.abs(sweep) / step)))
      let p = arcPoint(c, r, a0)
      for (let k = 1; k <= n; k++) {
        const q = arcPoint(c, r, a0 + (sweep * k) / n)
        seg(p, q)
        p = q
      }
    }
    switch (e.kind) {
      case 'line':
        seg(e.a, e.b)
        break
      case 'polyline': {
        const pts = e.pts
        for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i])
        if (e.closed && pts.length > 2) seg(pts[pts.length - 1], pts[0])
        if (e.filled && pts.length > 2) {
          const flat: number[] = []
          for (const p of pts) flat.push(p.x - ox, p.y - oy)
          const idx = earcut(flat)
          for (const i of idx) a.tris.push(flat[2 * i], flat[2 * i + 1])
        }
        break
      }
      case 'circle':
        curve(e.c, e.r, 0, Math.PI * 2)
        break
      case 'arc': {
        let sweep = e.end - e.start
        while (sweep < 0) sweep += Math.PI * 2
        curve(e.c, e.r, e.start, sweep)
        break
      }
      case 'text':
        texts.push({ x: e.p.x, y: e.p.y, h: e.height, rot: e.rotation, value: e.value, align: e.align, middle: false, layer: e.layer, color: st.color, alpha: st.alpha })
        break
      case 'dimension': {
        // same construction as DrawingSvg's dimension renderer
        const g = dimensionGeometry(e.a, e.b, e.offset)
        const dir = norm(sub(g.db, g.da))
        const tick = scale(norm(add(dir, g.n)), e.textHeight * 0.45)
        if (e.offset !== 0) {
          seg(e.a, add(g.da, scale(g.n, Math.sign(e.offset) * e.textHeight * 0.4)))
          seg(e.b, add(g.db, scale(g.n, Math.sign(e.offset) * e.textHeight * 0.4)))
        }
        seg(g.da, g.db)
        seg(sub(g.da, tick), add(g.da, tick))
        seg(sub(g.db, tick), add(g.db, tick))
        const t = add(g.textAt, scale(g.n, e.textHeight * 0.95))
        texts.push({ x: t.x, y: t.y, h: e.textHeight, rot: e.textAngle ?? g.angle, value: e.override ?? formatLength(measured(e.a, e.b)), align: 'center', middle: true, layer: e.layer, color: st.color, alpha: st.alpha })
        break
      }
    }
  }

  let nSeg = 0, nTri = 0
  for (const a of acc.values()) { nSeg += a.segs.length; nTri += a.tris.length }
  const segs = new Float32Array(nSeg)
  const tris = new Float32Array(nTri)
  const groups: DrawGroup[] = []
  let so = 0, to = 0
  for (const a of acc.values()) {
    segs.set(a.segs, so)
    tris.set(a.tris, to)
    const [r, g, b] = hexRgb(a.color)
    groups.push({ layer: a.layer, rgba: [r, g, b, a.alpha], widthPx: a.width, segStart: so / 4, segCount: a.segs.length / 4, triStart: to / 2, triCount: a.tris.length / 2 })
    so += a.segs.length
    to += a.tris.length
  }
  return { origin, segs, tris, groups, texts, segments: nSeg / 4 }
}
