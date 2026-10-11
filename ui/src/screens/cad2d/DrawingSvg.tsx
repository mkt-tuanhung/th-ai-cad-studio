import { memo, type ReactNode } from 'react'
import type { CadDocument, Entity, Layer, Vec2 } from '../../cad/types'
import { add, arcPoint, dimensionGeometry, formatLength, measured, norm, scale, snapPoints, sub } from '../../cad/geometry'
import type { ViewState } from '../../state/cad'

export interface Projector {
  sx: (x: number) => number
  sy: (y: number) => number
  toScreen: (p: Vec2) => Vec2
  toWorld: (x: number, y: number) => Vec2
  s: number
}

export function projector(view: ViewState, width: number, height: number): Projector {
  const s = view.mmPerPx
  const sx = (x: number) => width / 2 + (x - view.center.x) / s
  const sy = (y: number) => height / 2 - (y - view.center.y) / s
  return {
    s,
    sx,
    sy,
    toScreen: (p) => ({ x: sx(p.x), y: sy(p.y) }),
    toWorld: (x, y) => ({ x: view.center.x + (x - width / 2) * s, y: view.center.y - (y - height / 2) * s }),
  }
}

const CAP = 0.711 // Roboto cap-height / em: CAD text height is cap height
const DASH: Record<string, string | undefined> = { Dashed: '8 4', DashDot: '14 3 2 3', Continuous: undefined }

function strokeOf(e: Entity, layer: Layer | undefined) {
  const color = e.color === 'ByLayer' ? (layer?.color ?? '#1f2937') : e.color
  const lt = e.linetype === 'ByLayer' ? (layer?.linetype ?? 'Continuous') : e.linetype
  const lw = e.lineweight === 'ByLayer' ? (layer?.lineweight ?? 0.25) : Number(e.lineweight)
  return {
    stroke: color,
    strokeWidth: lw >= 0.5 ? 2 : lw >= 0.35 ? 1.5 : 1,
    strokeDasharray: DASH[lt],
    opacity: 1 - e.transparency / 100,
  }
}

export function renderEntity(e: Entity, P: Projector, layer: Layer | undefined, override?: { stroke: string; dash?: string; width?: number }): ReactNode {
  const st = strokeOf(e, layer)
  const stroke = override?.stroke ?? st.stroke
  const common = {
    stroke,
    strokeWidth: override?.width ?? st.strokeWidth,
    strokeDasharray: override?.dash ?? st.strokeDasharray,
    opacity: st.opacity,
    fill: 'none',
    vectorEffect: 'non-scaling-stroke' as const,
  }
  const key = e.id + (override ? '-hl' : '')
  switch (e.kind) {
    case 'line':
      return <line key={key} x1={P.sx(e.a.x)} y1={P.sy(e.a.y)} x2={P.sx(e.b.x)} y2={P.sy(e.b.y)} {...common} />
    case 'polyline': {
      const d = e.pts.map((p, i) => `${i ? 'L' : 'M'}${P.sx(p.x)},${P.sy(p.y)}`).join('') + (e.closed ? 'Z' : '')
      return <path key={key} d={d} {...common} fill={e.filled && !override ? stroke : 'none'} strokeLinejoin="round" />
    }
    case 'circle':
      return <circle key={key} cx={P.sx(e.c.x)} cy={P.sy(e.c.y)} r={e.r / P.s} {...common} />
    case 'arc': {
      const a = P.toScreen(arcPoint(e.c, e.r, e.start))
      const b = P.toScreen(arcPoint(e.c, e.r, e.end))
      let sweep = e.end - e.start
      while (sweep < 0) sweep += Math.PI * 2
      const r = e.r / P.s
      return <path key={key} d={`M${a.x},${a.y}A${r},${r} 0 ${sweep > Math.PI ? 1 : 0} 0 ${b.x},${b.y}`} {...common} />
    }
    case 'text': {
      const p = P.toScreen(e.p)
      return (
        <text
          key={key}
          x={p.x}
          y={p.y}
          fontSize={e.height / P.s / CAP}
          textAnchor={e.align === 'center' ? 'middle' : 'start'}
          fill={stroke}
          opacity={st.opacity}
          transform={e.rotation ? `rotate(${(-e.rotation * 180) / Math.PI} ${p.x} ${p.y})` : undefined}
          style={{ fontFamily: 'var(--font-sans)', fontWeight: 400 }}
        >
          {e.value}
        </text>
      )
    }
    case 'dimension': {
      const g = dimensionGeometry(e.a, e.b, e.offset)
      const dir = norm(sub(g.db, g.da))
      const tick = scale(norm(add(dir, g.n)), e.textHeight * 0.45)
      const seg = (p: Vec2, q: Vec2, k: string) => (
        <line key={k} x1={P.sx(p.x)} y1={P.sy(p.y)} x2={P.sx(q.x)} y2={P.sy(q.y)} {...common} />
      )
      const tAt = P.toScreen(add(g.textAt, scale(g.n, e.textHeight * 0.95)))
      return (
        <g key={key}>
          {e.offset !== 0 && seg(e.a, add(g.da, scale(g.n, Math.sign(e.offset) * e.textHeight * 0.4)), 'e1')}
          {e.offset !== 0 && seg(e.b, add(g.db, scale(g.n, Math.sign(e.offset) * e.textHeight * 0.4)), 'e2')}
          {seg(g.da, g.db, 'dl')}
          {seg(sub(g.da, tick), add(g.da, tick), 't1')}
          {seg(sub(g.db, tick), add(g.db, tick), 't2')}
          <text
            x={tAt.x}
            y={tAt.y}
            fontSize={e.textHeight / P.s / CAP}
            textAnchor="middle"
            dominantBaseline="central"
            fill={stroke}
            transform={`rotate(${(-(e.textAngle ?? g.angle) * 180) / Math.PI} ${tAt.x} ${tAt.y})`}
            style={{ fontFamily: 'var(--font-sans)' }}
          >
            {e.override ?? formatLength(measured(e.a, e.b))}
          </text>
        </g>
      )
    }
  }
}

export interface DrawingSvgProps {
  doc: CadDocument
  view: ViewState
  width: number
  height: number
  selection?: string[]
  grid?: boolean
  /** Geometry is drawn by the GPU layer underneath: render only grid, selection and children. */
  gpu?: boolean
  children?: ReactNode
}

/** Pure renderer for a document in a view (model space). */
export const DrawingSvg = memo(function DrawingSvg({ doc, view, width, height, selection = [], grid, gpu, children }: DrawingSvgProps) {
  const P = projector(view, width, height)
  const layers = new Map(doc.layers.map((l) => [l.name, l]))
  const visible = (e: Entity) => layers.get(e.layer)?.visible !== false
  const u = doc.underlay
  const split = u ? u.drawIndex : 0
  const sel = new Set(selection)

  return (
    <svg width={width} height={height} style={{ display: 'block', position: 'relative' }} shapeRendering="geometricPrecision">
      {grid && <GridLines P={P} width={width} height={height} />}
      {!gpu && doc.entities.slice(0, split).filter(visible).map((e) => renderEntity(e, P, layers.get(e.layer)))}
      {u && (
        <svg
          x={P.sx(u.origin.x)}
          y={P.sy(u.origin.y)}
          width={(u.crop.w * u.mmPerPx) / P.s}
          height={(u.crop.h * u.mmPerPx) / P.s}
          viewBox={`${u.crop.x} ${u.crop.y} ${u.crop.w} ${u.crop.h}`}
          preserveAspectRatio="none"
        >
          <image href={u.src} width={u.natW} height={u.natH} />
        </svg>
      )}
      {!gpu && doc.entities.slice(split).filter(visible).map((e) => renderEntity(e, P, layers.get(e.layer)))}
      {(sel.size ? doc.entities : [])
        .filter((e) => sel.has(e.id) && visible(e))
        .map((e) => (
          <g key={`sel-${e.id}`}>
            {renderEntity(e, P, layers.get(e.layer), { stroke: '#1f9aa0', dash: '5 3', width: 1.5 })}
            {snapPoints(e)
              .filter((sp) => sp.kind !== 'midpoint')
              .map((sp, i) => {
                const q = P.toScreen(sp.p)
                return <rect key={i} x={q.x - 3.5} y={q.y - 3.5} width={7} height={7} fill="#2477e3" stroke="#fff" strokeWidth={1} />
              })}
          </g>
        ))}
      {children}
    </svg>
  )
})

function GridLines({ P, width, height }: { P: Projector; width: number; height: number }) {
  let step = 1000
  while (step / P.s < 12) step *= 5
  while (step / P.s > 80) step /= 5
  const tl = P.toWorld(0, 0)
  const br = P.toWorld(width, height)
  const xs: number[] = []
  const ys: number[] = []
  for (let x = Math.ceil(tl.x / step) * step; x <= br.x; x += step) xs.push(x)
  for (let y = Math.ceil(br.y / step) * step; y <= tl.y; y += step) ys.push(y)
  return (
    <g stroke="#e8edf1" strokeWidth={1} shapeRendering="crispEdges">
      {xs.map((x) => (
        <line key={`x${x}`} x1={P.sx(x)} y1={0} x2={P.sx(x)} y2={height} />
      ))}
      {ys.map((y) => (
        <line key={`y${y}`} x1={0} y1={P.sy(y)} x2={width} y2={P.sy(y)} />
      ))}
    </g>
  )
}
