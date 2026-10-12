import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fmt, useT } from '../../i18n'
import { useCivil } from '../../state/civil'
import { hydraulics, sta } from '../../civil/model'
import { contours, elevationAt, pointAt, polyLength, stationOf, type Polyline } from '../../civil/tin'
import { tinOf } from '../../civil/surveyModel'
import { applyPlan } from './surveyActions'
import s from './Civil.module.css'

export interface PlanControl {
  home: () => void
  zoom: (k: number) => void
}

/** Hypsometric tint: low green → khaki → high brown. */
function tint(f: number): string {
  const stops: [number, [number, number, number]][] = [[0, [86, 150, 98]], [0.5, [214, 205, 140]], [1, [168, 120, 78]]]
  const i = f <= 0.5 ? 0 : 1
  const [a, ca] = stops[i], [b, cb] = stops[i + 1]
  const r = Math.min(1, Math.max(0, (f - a) / (b - a)))
  return `rgb(${ca.map((c, k) => Math.round(c + (cb[k] - c) * r)).join(',')})`
}

/** Offset of a polyline (positive = right of travel), per-vertex mitre-free normals. */
function offset(p: Polyline, d: number): Polyline {
  return p.map((q, i) => {
    const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)]
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    return [q[0] + ((b[1] - a[1]) / l) * d, q[1] - ((b[0] - a[0]) / l) * d]
  })
}

/**
 * Plan view of the imported survey: TIN tinted by elevation, contours, survey points, the alignment with
 * stations, top-of-bank lines, structures and the current cross section. Wheel = zoom, drag = pan,
 * click = pick a station on the alignment; in drawing mode clicks add centre-line points.
 */
export function SurveyPlan({ ctl }: { ctl: { current: PlanControl | null } }) {
  const T = useT()
  const t = T.civil.survey
  const st = useCivil()
  const m = st.doc
  const tin = tinOf(m)
  const box = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<{ cx: number; cy: number; k: number } | null>(null)
  const [cursor, setCursor] = useState<string>('')
  const [draft, setDraft] = useState<Polyline>([])
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null)
  const cont = useMemo(() => (tin && st.layers.ground !== false ? contours(tin, st.contour) : []), [tin, st.contour, st.layers.ground])
  const top = useMemo(() => hydraulics(m).top, [m])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fit = useCallback(() => {
    if (!tin || !size.w) return
    const { x0, y0, x1, y1 } = tin.bounds
    const k = Math.min(size.w / ((x1 - x0) * 1.08 || 1), size.h / ((y1 - y0) * 1.08 || 1))
    setView({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, k })
  }, [tin, size.w, size.h])
  useEffect(() => {
    if (!view) fit()
  }, [view, fit])
  useEffect(() => fit(), [m.survey, fit]) // a new survey reframes the view

  const toScreen = useCallback((x: number, y: number): [number, number] => (view ? [size.w / 2 + (x - view.cx) * view.k, size.h / 2 - (y - view.cy) * view.k] : [0, 0]), [view, size])
  const toWorld = useCallback((px: number, py: number): [number, number] => (view ? [view.cx + (px - size.w / 2) / view.k, view.cy - (py - size.h / 2) / view.k] : [0, 0]), [view, size])

  useEffect(() => {
    ctl.current = {
      home: fit,
      zoom: (f) => setView((v) => (v ? { ...v, k: v.k * f } : v)),
    }
    return () => {
      ctl.current = null
    }
  })

  // the surface layer (triangles, contours, points) is cached as a bitmap; while the view moves a large
  // survey shows the cached bitmap transformed and redraws it in full once the view settles
  const base = useRef<{ canvas: HTMLCanvasElement; view: { cx: number; cy: number; k: number }; key: unknown[] } | null>(null)
  const [settled, setSettled] = useState(0)
  const settleTimer = useRef<number>(0)
  const needFull = useRef(false)

  // draw
  useEffect(() => {
    const c = cv.current
    if (!c || !tin || !view || !size.w) return
    const surf = tin, vw = view // narrowed for the draw helpers below
    const dpr = window.devicePixelRatio || 1
    c.width = size.w * dpr
    c.height = size.h * dpr
    const out = c.getContext('2d')!
    const key = [tin, cont, st.layers.surfaces, st.layers.ground, size.w, size.h, dpr]
    const sameKey = base.current && base.current.key.length === key.length && base.current.key.every((v, i) => v === key[i])
    const sameView = sameKey && base.current!.view.cx === view.cx && base.current!.view.cy === view.cy && base.current!.view.k === view.k
    const heavy = tin.tri.length / 3 > 20000
    if (sameKey && !sameView && heavy && !needFull.current) {
      // fast path: reuse the cached surface, then redraw it properly when the user stops
      const b = base.current!
      const r = view.k / b.view.k
      out.setTransform(dpr, 0, 0, dpr, 0, 0)
      out.fillStyle = '#eef1f4'
      out.fillRect(0, 0, size.w, size.h)
      const ox = size.w / 2 + (b.view.cx - view.cx) * view.k - (size.w / 2) * r
      const oy = size.h / 2 - (b.view.cy - view.cy) * view.k - (size.h / 2) * r
      out.drawImage(b.canvas, ox, oy, size.w * r, size.h * r)
      window.clearTimeout(settleTimer.current)
      settleTimer.current = window.setTimeout(() => {
        needFull.current = true
        setSettled((n) => n + 1)
      }, 160)
    } else if (!sameView) {
      needFull.current = false
      const bc = base.current?.canvas ?? document.createElement('canvas')
      bc.width = size.w * dpr
      bc.height = size.h * dpr
      drawBase(bc.getContext('2d')!, dpr)
      base.current = { canvas: bc, view, key }
    }
    const bv = base.current?.view
    if (bv && bv.cx === view.cx && bv.cy === view.cy && bv.k === view.k) {
      out.setTransform(1, 0, 0, 1, 0, 0)
      out.drawImage(base.current!.canvas, 0, 0)
    }
    const g = out
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawOverlay(g)

    function drawBase(g: CanvasRenderingContext2D, dpr: number) {
    const tin = surf
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = '#eef1f4'
    g.fillRect(0, 0, size.w, size.h)
    const path = (p: Polyline) => {
      g.beginPath()
      p.forEach(([x, y], i) => {
        const [sx, sy] = toScreen(x, y)
        if (i) g.lineTo(sx, sy)
        else g.moveTo(sx, sy)
      })
    }
    // surface
    if (st.layers.surfaces !== false) {
      const dz = tin.zmax - tin.zmin || 1
      for (let k = 0; k < tin.tri.length; k += 3) {
        const a = tin.tri[k], b = tin.tri[k + 1], d = tin.tri[k + 2]
        const [ax, ay] = toScreen(tin.x[a], tin.y[a]), [bx, by] = toScreen(tin.x[b], tin.y[b]), [dx, dy] = toScreen(tin.x[d], tin.y[d])
        g.fillStyle = g.strokeStyle = tint(((tin.z[a] + tin.z[b] + tin.z[d]) / 3 - tin.zmin) / dz)
        g.beginPath()
        g.moveTo(ax, ay)
        g.lineTo(bx, by)
        g.lineTo(dx, dy)
        g.closePath()
        g.fill()
        g.lineWidth = 0.6
        g.stroke() // hides hairline seams between triangles
      }
    }
    // contours
    g.font = '10px Roboto, sans-serif'
    for (const c2 of cont) {
      g.strokeStyle = c2.major ? 'rgba(70, 50, 25, 0.9)' : 'rgba(80, 65, 40, 0.42)'
      g.lineWidth = c2.major ? 1.3 : 0.7
      for (const line of c2.lines) {
        path(line)
        g.stroke()
      }
      if (c2.major)
        for (const line of c2.lines) {
          if (line.length < 6) continue
          const [lx, ly] = toScreen(...line[line.length >> 1])
          const label = c2.level.toFixed(2)
          g.fillStyle = 'rgba(255,255,255,0.85)'
          g.fillRect(lx - 14, ly - 7, 28, 12)
          g.fillStyle = '#4a3820'
          g.fillText(label, lx - 12, ly + 3)
        }
    }
    // survey points
    if (st.layers.ground !== false && tin.x.length <= 8000) {
      g.fillStyle = 'rgba(30, 40, 50, 0.7)'
      for (let i = 0; i < tin.x.length; i++) {
        const [px, py] = toScreen(tin.x[i], tin.y[i])
        if (px >= 0 && py >= 0 && px <= size.w && py <= size.h) g.fillRect(px - 1, py - 1, 2, 2)
      }
    }
    }

    function drawOverlay(g: CanvasRenderingContext2D) {
    const view = vw
    const path = (p: Polyline) => {
      g.beginPath()
      p.forEach(([x, y], i) => {
        const [sx, sy] = toScreen(x, y)
        if (i) g.lineTo(sx, sy)
        else g.moveTo(sx, sy)
      })
    }
    g.font = '10px Roboto, sans-serif'
    // alignment, top of bank, structures, current section
    if (m.plan && m.plan.length >= 2) {
      if (st.layers.channel !== false) {
        g.setLineDash([6, 4])
        g.strokeStyle = '#0f8f96'
        g.lineWidth = 1.4
        for (const d of [-top / 2, top / 2]) {
          path(offset(m.plan, d))
          g.stroke()
        }
        g.setLineDash([])
      }
      if (st.layers.alignment !== false) {
        g.strokeStyle = '#1f6fe0'
        g.lineWidth = 2.6
        path(m.plan)
        g.stroke()
        const L = polyLength(m.plan)
        g.fillStyle = '#123a7a'
        g.font = '600 10.5px Roboto, sans-serif'
        for (let s0 = 0; s0 <= L + 1e-6; s0 += 20) {
          const q = pointAt(m.plan, Math.min(s0, L))
          const major = Math.round(s0) % 100 === 0
          const len = major ? 9 : 5
          const [x1, y1] = toScreen(q.x + q.dy * len / view.k, q.y - q.dx * len / view.k), [x2, y2] = toScreen(q.x - q.dy * len / view.k, q.y + q.dx * len / view.k)
          g.strokeStyle = '#1f6fe0'
          g.lineWidth = 1.4
          g.beginPath()
          g.moveTo(x1, y1)
          g.lineTo(x2, y2)
          g.stroke()
          if (major) g.fillText(sta(s0), x1 + 3, y1 + 3)
        }
      }
      if (st.layers.structures !== false)
        for (const c3 of m.culverts) {
          const q = pointAt(m.plan, c3.station)
          const [x, y] = toScreen(q.x, q.y)
          g.fillStyle = '#7a4fd0'
          g.fillRect(x - 5, y - 5, 10, 10)
          g.fillStyle = '#3d2275'
          g.fillText(c3.id, x + 7, y - 6)
        }
      const q = pointAt(m.plan, st.station)
      const [ax, ay] = toScreen(q.x + q.dy * 40, q.y - q.dx * 40), [bx, by] = toScreen(q.x - q.dy * 40, q.y + q.dx * 40)
      g.strokeStyle = '#d6343b'
      g.lineWidth = 1.6
      g.setLineDash([5, 3])
      g.beginPath()
      g.moveTo(ax, ay)
      g.lineTo(bx, by)
      g.stroke()
      g.setLineDash([])
      const [sx, sy] = toScreen(q.x, q.y)
      g.fillStyle = '#d6343b'
      g.beginPath()
      g.arc(sx, sy, 4.5, 0, Math.PI * 2)
      g.fill()
    }
    // alignment being drawn
    if (draft.length) {
      g.strokeStyle = '#e07b1f'
      g.lineWidth = 2.2
      path(draft)
      g.stroke()
      g.fillStyle = '#e07b1f'
      for (const [x, y] of draft) {
        const [px, py] = toScreen(x, y)
        g.fillRect(px - 3, py - 3, 6, 6)
      }
    }
    // north arrow + scale bar
    g.fillStyle = '#3a4352'
    g.beginPath()
    g.moveTo(22, 14)
    g.lineTo(28, 32)
    g.lineTo(22, 28)
    g.lineTo(16, 32)
    g.closePath()
    g.fill()
    g.font = '600 10px Roboto, sans-serif'
    g.fillText('N', 19, 44)
    const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find((v) => v * view.k >= 70) ?? 5000
    const bw = nice * view.k
    g.fillRect(16, size.h - 22, bw, 4)
    g.fillText(`${nice} m`, 16 + bw + 6, size.h - 17)
    }
  }, [tin, view, size, cont, m, st.station, st.layers, draft, top, toScreen, settled])

  // drawing mode keys
  useEffect(() => {
    if (!st.drawing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDraft([])
        st.set({ drawing: false })
      }
      if (e.key === 'Enter' && draft.length >= 2) {
        applyPlan(draft, t)
        setDraft([])
        st.set({ drawing: false })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [st, draft, t])

  if (!tin) return null
  const ev = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top] as [number, number]
  }
  return (
    <div
      ref={box}
      className={s.surveyPlan}
      data-testid="survey-plan"
      style={{ cursor: st.drawing ? 'crosshair' : drag.current?.moved ? 'grabbing' : 'default' }}
      onWheel={(e) => {
        if (!view) return
        const [px, py] = ev(e)
        const [wx, wy] = toWorld(px, py)
        const k = view.k * Math.exp(-e.deltaY / 400)
        setView({ k, cx: wx - (px - size.w / 2) / k, cy: wy + (py - size.h / 2) / k })
      }}
      onPointerDown={(e) => {
        if (!view) return
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        const [px, py] = ev(e)
        drag.current = { x: px, y: py, cx: view.cx, cy: view.cy, moved: false }
      }}
      onPointerMove={(e) => {
        const [px, py] = ev(e)
        const [wx, wy] = toWorld(px, py)
        const z = elevationAt(tin, wx, wy)
        setCursor(fmt(t.cursor, { e: wx.toFixed(2), n: wy.toFixed(2), z: z === null ? t.outside : z.toFixed(3) }))
        const d = drag.current
        if (!d || !view) return
        if (Math.hypot(px - d.x, py - d.y) > 3) d.moved = true
        if (d.moved) setView({ ...view, cx: d.cx - (px - d.x) / view.k, cy: d.cy + (py - d.y) / view.k })
      }}
      onPointerUp={(e) => {
        const d = drag.current
        drag.current = null
        if (!d || d.moved) return
        const [wx, wy] = toWorld(...ev(e))
        if (st.drawing) return setDraft((p) => [...p, [wx, wy]])
        if (m.plan && view) {
          const q = stationOf(m.plan, wx, wy)
          if (q.offset * view.k < 14) st.set({ station: Math.round(q.s / 20) * 20 > m.alignment.end ? m.alignment.end : Math.round(q.s / 20) * 20 })
        }
      }}
      onDoubleClick={() => {
        if (!st.drawing) return
        // the double-click's two clicks added the same point twice
        const p = draft.filter((q, i) => i === 0 || Math.hypot(q[0] - draft[i - 1][0], q[1] - draft[i - 1][1]) > 1e-6)
        if (p.length >= 2) applyPlan(p, t)
        setDraft([])
        st.set({ drawing: false })
      }}
    >
      <canvas ref={cv} style={{ width: size.w, height: size.h }} aria-label={T.civil.plan.label} />
      <span className={s.surveyBadge}>
        {fmt(t.badge, { name: m.survey!.name, n: tin.x.length.toLocaleString('en-US'), t: (tin.tri.length / 3).toLocaleString('en-US'), crs: m.survey!.crs })}
      </span>
      {st.drawing ? <span className={s.surveyHint}>{t.draw}</span> : cursor && <span className={s.surveyCursor}>{cursor}</span>}
    </div>
  )
}
