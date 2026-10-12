import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { CadDocument, Entity, Vec2 } from '../../cad/types'
import {
  angleOf,
  arcFrom3,
  bboxOf,
  dist,
  distanceTo,
  nearestOn,
  norm,
  perp,
  perpendicularFeet,
  snapPoints,
  sub,
  translateEntity,
  unionBBox,
  type SnapKind,
} from '../../cad/geometry'
import { defaultView, useCad, type ViewState } from '../../state/cad'
import { cadUi, hitTest, insertQueue, useCadSession, type Stage } from '../../state/cadSession'
import { useCursor } from '../../state/cursor'
import { DrawingSvg, projector, renderEntity, type Projector } from './DrawingSvg'
import { GpuLayer, wantsGpu } from './gpu/GpuLayer'
import { intersectionsWith } from '../../cad/edit'
import s from './ModelViewport.module.css'

const POINT_STAGES: Stage[] = [
  'firstPoint', 'nextPoint', 'plStart', 'plNext', 'corner1', 'corner2', 'center', 'radius',
  'arc1', 'arc2', 'arc3', 'dim1', 'dim2', 'dim3', 'textPoint', 'basePoint', 'secondPoint', 'offsetSide',
  'distP1', 'distP2', 'areaFirst', 'areaNext', 'insertPoint',
]
const SNAP_UNIT = 50 // mm
const OSNAP_PX = 12

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

export function zoomExtentsView(doc: CadDocument, w: number, h: number): ViewState {
  const boxes = doc.entities.map(bboxOf)
  const u = doc.underlay
  if (u) boxes.push({ minX: u.origin.x, maxX: u.origin.x + u.crop.w * u.mmPerPx, maxY: u.origin.y, minY: u.origin.y - u.crop.h * u.mmPerPx })
  const b = unionBBox(boxes)
  if (!b || w === 0) return defaultView(doc)
  const mm = Math.max((b.maxX - b.minX) / (w * 0.92), (b.maxY - b.minY) / (h * 0.92), 0.5)
  return { center: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }, mmPerPx: mm }
}

export function ModelViewport({ doc }: { doc: CadDocument }) {
  const [ref, { w, h }] = useSize<HTMLDivElement>()
  const view = useCad((st) => st.views[doc.id]) ?? defaultView(doc)
  const setView = useCad((st) => st.setView)
  const selection = useCad((st) => st.selection)
  const toggles = useCad((st) => st.toggles)
  const osnapModes = useCad((st) => st.osnapModes)
  const tool = useCad((st) => st.tool)
  const session = useCadSession()
  const cursorSet = useCursor((st) => st.set)
  const setViewportSize = useCursor((st) => st.setViewport)
  useEffect(() => {
    if (w > 0) setViewportSize(w, h)
  }, [w, h, setViewportSize])
  const [screenCursor, setScreenCursor] = useState<Vec2 | null>(null)
  const [snapMark, setSnapMark] = useState<{ p: Vec2; kind: SnapKind } | null>(null)
  const pan = useRef<{ x: number; y: number; c: Vec2 } | null>(null)
  const space = useRef(false)
  const lastMiddle = useRef(0)

  const P = projector(view, w, h)
  // large drawings: geometry on the GPU, the SVG above only carries grid / selection / previews
  const [gpuFailed, setGpuFailed] = useState(false)
  const onGpuFail = useCallback(() => setGpuFailed(true), [])
  const gpu = wantsGpu(doc) && !gpuFailed
  const wantsPoint = POINT_STAGES.includes(session.stage)

  const zoomExtents = useCallback(() => setView(doc.id, zoomExtentsView(doc, w, h)), [doc, w, h, setView])
  // First show of each document: keep the approved framing when the canvas is at least
  // mockup-sized, otherwise (and for every other drawing, scans with an underlay included) fit.
  const fitted = useRef<string | null>(null)
  useEffect(() => {
    if (fitted.current === doc.id || w === 0) return
    fitted.current = doc.id
    if (!useCad.getState().views[doc.id] && (w < 830 || h < 580 || !(doc.underlay && doc.source === 'seed'))) zoomExtents()
  }, [w, h, doc, zoomExtents])
  useEffect(() => {
    cadUi.zoomExtents = zoomExtents
    return () => {
      if (cadUi.zoomExtents === zoomExtents) cadUi.zoomExtents = undefined
    }
  }, [zoomExtents])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) space.current = true
    }
    const up = (e: KeyboardEvent) => e.code === 'Space' && (space.current = false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  /** Raw pointer → effective point after OSNAP / SNAP / ORTHO / POLAR. */
  const resolvePoint = (raw: Vec2, P: Projector): { p: Vec2; snap: { p: Vec2; kind: SnapKind } | null } => {
    if (!wantsPoint) return { p: raw, snap: null }
    if (toggles.osnap) {
      let best: { p: Vec2; kind: SnapKind; d: number } | null = null
      const consider = (p: Vec2, kind: SnapKind) => {
        const d = dist(p, raw) / P.s
        if (d < OSNAP_PX && (!best || d < best.d)) best = { p, kind, d }
      }
      const visible = new Set(doc.layers.filter((l) => l.visible).map((l) => l.name))
      const near: Entity[] = []
      for (const e of doc.entities) {
        if (!visible.has(e.layer)) continue
        for (const sp of snapPoints(e)) if (osnapModes[sp.kind as keyof typeof osnapModes]) consider(sp.p, sp.kind)
        if ((osnapModes.intersection || osnapModes.perpendicular || osnapModes.nearest) && distanceTo(e, raw) / P.s < OSNAP_PX) near.push(e)
      }
      if (osnapModes.intersection) for (const e of near) for (const q of intersectionsWith(e, near)) consider(q, 'intersection')
      const from = session.points.at(-1)
      if (osnapModes.perpendicular && from) for (const e of near) for (const q of perpendicularFeet(e, from)) consider(q, 'perpendicular')
      // NEArest only when no other snap is in reach (it is always ~0 px away)
      if (!best && osnapModes.nearest) {
        const e = near.sort((a, b) => distanceTo(a, raw) - distanceTo(b, raw))[0]
        const q = e && nearestOn(e, raw)
        if (q) consider(q, 'nearest')
      }
      const b = best as { p: Vec2; kind: SnapKind } | null
      if (b) return { p: b.p, snap: { p: b.p, kind: b.kind } }
    }
    let p = raw
    if (toggles.snap) p = { x: Math.round(p.x / SNAP_UNIT) * SNAP_UNIT, y: Math.round(p.y / SNAP_UNIT) * SNAP_UNIT }
    const last = session.points.at(-1)
    if (last && (toggles.ortho || toggles.polar)) {
      const d = sub(p, last)
      if (toggles.ortho) p = Math.abs(d.x) >= Math.abs(d.y) ? { x: p.x, y: last.y } : { x: last.x, y: p.y }
      else {
        const ang = angleOf(d)
        const step = Math.PI / 4
        const snapped = Math.round(ang / step) * step
        if (Math.abs(ang - snapped) < (5 * Math.PI) / 180) {
          const r = Math.hypot(d.x, d.y)
          p = { x: last.x + r * Math.cos(snapped), y: last.y + r * Math.sin(snapped) }
        }
      }
    }
    return { p, snap: null }
  }

  const local = (e: React.PointerEvent | React.WheelEvent | React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const q = local(e)
    if (e.button === 1 || (e.button === 0 && space.current)) {
      e.preventDefault()
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      pan.current = { x: q.x, y: q.y, c: view.center }
      if (e.button === 1) {
        const now = performance.now()
        if (now - lastMiddle.current < 350) zoomExtents()
        lastMiddle.current = now
      }
      return
    }
    if (e.button !== 0) return
    const raw = P.toWorld(q.x, q.y)
    const { p } = resolvePoint(raw, P)
    const visible = new Set(doc.layers.filter((l) => l.visible).map((l) => l.name))
    const hit = hitTest(doc.entities, visible, raw, 6 * P.s, distanceTo)
    session.click(p, hit, e.shiftKey)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const q = local(e)
    if (pan.current) {
      const { x, y, c } = pan.current
      setView(doc.id, { ...view, center: { x: c.x - (q.x - x) * view.mmPerPx, y: c.y + (q.y - y) * view.mmPerPx } })
      return
    }
    const raw = P.toWorld(q.x, q.y)
    const { p, snap } = resolvePoint(raw, P)
    setScreenCursor(q)
    setSnapMark(snap)
    cursorSet(p, snap)
    if (wantsPoint || session.windowStart || session.stage === 'opposite') session.setHover(p)
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (pan.current) {
      pan.current = null
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    }
  }

  // wheel: mouse wheel / pinch zoom about the cursor, two-finger trackpad scroll pans
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const st = useCad.getState()
      const v = st.views[doc.id] ?? defaultView(doc)
      const r = el.getBoundingClientRect()
      const q = { x: e.clientX - r.left, y: e.clientY - r.top }
      const trackpadPan = !e.ctrlKey && (Math.abs(e.deltaX) > 0 || !Number.isInteger(e.deltaY))
      if (trackpadPan) {
        st.setView(doc.id, { ...v, center: { x: v.center.x + e.deltaX * v.mmPerPx, y: v.center.y - e.deltaY * v.mmPerPx } })
        return
      }
      const k = Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))
      const mm = Math.min(Math.max(v.mmPerPx * k, 0.05), 5000)
      const Pv = projector(v, r.width, r.height)
      const anchor = Pv.toWorld(q.x, q.y)
      st.setView(doc.id, {
        mmPerPx: mm,
        center: { x: anchor.x - (q.x - r.width / 2) * mm, y: anchor.y + (q.y - r.height / 2) * mm },
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [doc, ref])

  return (
    <div
      ref={ref}
      className={s.viewport}
      data-tool={tool}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setScreenCursor(null)}
      onAuxClick={(e) => e.preventDefault()}
      onContextMenu={(e) => {
        // right-click = Enter (AutoCAD default)
        e.preventDefault()
        if (useCadSession.getState().stage) useCadSession.getState().input('')
      }}
    >
      {w > 0 && gpu && <GpuLayer doc={doc} view={view} width={w} height={h} onFail={onGpuFail} />}
      {w > 0 && (
        <DrawingSvg doc={doc} view={view} width={w} height={h} selection={selection} grid={toggles.grid} gpu={gpu}>
          <Previews doc={doc} P={P} />
          {snapMark && <SnapMarker p={P.toScreen(snapMark.p)} kind={snapMark.kind} />}
          {screenCursor && <Crosshair x={screenCursor.x} y={screenCursor.y} w={w} h={h} picking={!wantsPoint} />}
        </DrawingSvg>
      )}
    </div>
  )
}

function Previews({ doc, P }: { doc: CadDocument; P: Projector }) {
  const { stage, points, hover, windowStart } = useCadSession()
  const tool = useCad((st) => st.tool)
  const selection = useCad((st) => st.selection)
  const scaleDen = Number(useCad((st) => st.scale).split(':')[1]) || 100
  if (windowStart && hover) {
    const a = P.toScreen(windowStart)
    const b = P.toScreen(hover)
    const crossing = hover.x < windowStart.x
    return (
      <rect
        x={Math.min(a.x, b.x)}
        y={Math.min(a.y, b.y)}
        width={Math.abs(b.x - a.x)}
        height={Math.abs(b.y - a.y)}
        fill={crossing ? 'rgba(40,180,90,0.10)' : 'rgba(36,119,227,0.10)'}
        stroke={crossing ? '#28a55a' : '#2477e3'}
        strokeDasharray={crossing ? '5 3' : undefined}
      />
    )
  }
  if (!hover || !stage) return null
  const ghost: Entity[] = []
  const base = { id: 'ghost', layer: doc.currentLayer, color: 'ByLayer', linetype: 'ByLayer' as const, lineweight: 'ByLayer' as const, transparency: 0 }
  const last = points.at(-1)
  switch (tool) {
    case 'line':
      if (last) ghost.push({ ...base, kind: 'line', a: last, b: hover })
      break
    case 'polyline':
      if (points.length) ghost.push({ ...base, kind: 'polyline', pts: [...points, hover], closed: false })
      break
    case 'dist':
      if (last) ghost.push({ ...base, kind: 'line', a: last, b: hover })
      break
    case 'insert':
      if (insertQueue.next) for (const e of insertQueue.next.entities) ghost.push({ ...translateEntity(e, hover), id: 'ghost' })
      break
    case 'area':
      if (points.length) ghost.push({ ...base, kind: 'polyline', pts: [...points, hover], closed: points.length >= 2 })
      break
    case 'rectangle':
      if (last) ghost.push({ ...base, kind: 'polyline', closed: true, pts: [last, { x: hover.x, y: last.y }, hover, { x: last.x, y: hover.y }] })
      break
    case 'circle':
      if (last) ghost.push({ ...base, kind: 'circle', c: last, r: dist(last, hover) })
      break
    case 'arc':
      if (points.length === 1) ghost.push({ ...base, kind: 'line', a: points[0], b: hover })
      if (points.length === 2) {
        const a = arcFrom3(points[0], points[1], hover)
        if (a) ghost.push({ ...base, kind: 'arc', c: a.c, r: a.r, start: a.start, end: a.end })
      }
      break
    case 'dimension':
      if (points.length === 1) ghost.push({ ...base, kind: 'line', a: points[0], b: hover })
      if (points.length === 2) {
        const [a, b] = points
        const n = perp(norm(sub(b, a)))
        const offset = (hover.x - a.x) * n.x + (hover.y - a.y) * n.y
        ghost.push({ ...base, kind: 'dimension', a, b, offset, override: null, textHeight: 2.5 * scaleDen })
      }
      break
    case 'move':
      if (stage === 'secondPoint' && last) {
        const d = sub(hover, last)
        const sel = new Set(selection)
        for (const e of doc.entities) if (sel.has(e.id)) ghost.push({ ...translateEntity(e, d), id: `g-${e.id}` })
        ghost.push({ ...base, kind: 'line', a: last, b: hover })
      }
      break
  }
  const layer = doc.layers.find((l) => l.name === doc.currentLayer)
  return <g pointerEvents="none">{ghost.map((e, i) => <g key={i}>{renderEntity(e, P, layer, { stroke: '#1f9aa0', width: 1.25 })}</g>)}</g>
}

function SnapMarker({ p, kind }: { p: Vec2; kind: SnapKind }): ReactNode {
  const c = '#e8a400'
  if (kind === 'midpoint') return <path d={`M${p.x},${p.y - 6}L${p.x + 6},${p.y + 5}L${p.x - 6},${p.y + 5}Z`} fill="none" stroke={c} strokeWidth={2} />
  if (kind === 'center') return <circle cx={p.x} cy={p.y} r={6} fill="none" stroke={c} strokeWidth={2} />
  if (kind === 'quadrant') return <path d={`M${p.x},${p.y - 7}L${p.x + 7},${p.y}L${p.x},${p.y + 7}L${p.x - 7},${p.y}Z`} fill="none" stroke={c} strokeWidth={2} />
  if (kind === 'intersection') return <path d={`M${p.x - 6},${p.y - 6}L${p.x + 6},${p.y + 6}M${p.x + 6},${p.y - 6}L${p.x - 6},${p.y + 6}`} stroke={c} strokeWidth={2} />
  if (kind === 'perpendicular') return <path d={`M${p.x - 6},${p.y - 6}V${p.y + 6}H${p.x + 6}M${p.x - 6},${p.y}H${p.x}V${p.y + 6}`} fill="none" stroke={c} strokeWidth={2} />
  if (kind === 'nearest') return <path d={`M${p.x - 6},${p.y - 6}H${p.x + 6}L${p.x - 6},${p.y + 6}H${p.x + 6}Z`} fill="none" stroke={c} strokeWidth={2} />
  return <rect x={p.x - 5.5} y={p.y - 5.5} width={11} height={11} fill="none" stroke={c} strokeWidth={2} />
}

function Crosshair({ x, y, w, h, picking }: { x: number; y: number; w: number; h: number; picking: boolean }) {
  const len = picking ? 22 : Math.max(w, h)
  return (
    <g pointerEvents="none" stroke="#1f2937" strokeWidth={1} shapeRendering="crispEdges" opacity={0.75}>
      <line x1={x - len} y1={y + 0.5} x2={x + len} y2={y + 0.5} />
      <line x1={x + 0.5} y1={y - len} x2={x + 0.5} y2={y + len} />
      {picking && <rect x={x - 4} y={y - 4} width={9} height={9} fill="none" />}
    </g>
  )
}
