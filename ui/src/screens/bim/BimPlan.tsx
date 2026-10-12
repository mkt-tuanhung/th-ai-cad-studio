import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { fmt, useT } from '../../i18n'
import { useBim, type BimTool } from '../../state/bim'
import { toast } from '../../state/toast'
import { levelOf, typeOf, type Annotation, type BimModel, type ElementRef, type Opening, type P2, type Wall } from '../../bim/model'
import { centreOf, dist, markOf, nextGridLabel, nextLevel, nextMark, openingPoint, pointInPoly, polyArea, rectPoly, roomAt, segDist, uid, wallEnds, wallPoly, wallsOn } from '../../bim/geometry'
import { isStructuralWall, stairRisers } from '../../bim/scene'
import { Modal } from '../../components/ui/Modal'
import s from './BimPlan.module.css'

interface View {
  cx: number
  cy: number
  k: number // mm per px
}

const DOOR_W = 900,
  WINDOW_W = 1500,
  COLUMN = 400
const TWO_CLICK: BimTool[] = ['slab', 'roof', 'ceiling', 'stair', 'dimension', 'grid']

/**
 * BIM plan of the current level, drawn from the model (walls cut at 1.2 m, openings, columns, slabs,
 * stairs, railings, rooms, components, grids, annotations) and the place where the ribbon's drawing tools
 * work: every click becomes a validated, undoable model edit that the schedules, checks and the OCCT 3D
 * view pick up.
 */
export function BimPlan() {
  const T = useT()
  const t = T.bim.draw
  const { model: full, level, tool, wallType, selection, set, edit, discipline } = useBim()
  // the Structure discipline draws (and picks) only the load-bearing elements
  const model = useMemo(() => (discipline === 'structure' ? structuralView(full) : full), [full, discipline])
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<View | null>(null)
  const [pts, setPts] = useState<P2[]>([])
  const [cursor, setCursor] = useState<{ p: P2; snapped: boolean } | null>(null)
  const [textAt, setTextAt] = useState<P2 | null>(null)
  const [text, setText] = useState('')
  const drag = useRef<{ x: number; y: number; v: View; moved: boolean } | null>(null)
  const lvl = levelOf(model, level)
  const top = nextLevel(model, level)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) =>
      setSize({
        w: Math.round(e.contentRect.width),
        h: Math.round(e.contentRect.height),
      }),
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const fit = () => {
    const xs: number[] = [],
      ys: number[] = []
    for (const w of model.walls) for (const p of Object.values(wallEnds(w)).slice(0, 2) as P2[]) (xs.push(p[0]), ys.push(p[1]))
    if (!xs.length) (xs.push(0, 14000), ys.push(0, 10000))
    const x0 = Math.min(...xs),
      x1 = Math.max(...xs),
      y0 = Math.min(...ys),
      y1 = Math.max(...ys)
    setView({
      cx: (x0 + x1) / 2,
      cy: (y0 + y1) / 2,
      k: Math.max((x1 - x0) / Math.max(1, size.w - 120), (y1 - y0) / Math.max(1, size.h - 120), 1),
    })
  }
  useEffect(() => {
    if (size.w && !view) fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size])
  useEffect(() => setPts([]), [tool, level])

  // screen ↔ world
  const S = (p: P2): P2 => (view ? [(p[0] - view.cx) / view.k + size.w / 2, (view.cy - p[1]) / view.k + size.h / 2] : [0, 0])
  const W = (x: number, y: number): P2 => (view ? [(x - size.w / 2) * view.k + view.cx, view.cy - (y - size.h / 2) * view.k] : [0, 0])
  const px = (mm: number) => (view ? mm / view.k : 0)

  const walls = useMemo(() => wallsOn(model, level), [model, level])
  const wallIds = useMemo(() => new Set(walls.map((w) => w.id)), [walls])
  const openings = useMemo(() => [...model.doors, ...model.windows].filter((o) => wallIds.has(o.hostWall)), [model, wallIds])
  const onLevel = <X extends { level: string }>(xs: X[]) => xs.filter((x) => x.level === level)

  /** Snap: element points within 10 px, else a 50 mm grid; orthogonal from the last point unless Shift. */
  const snap = (raw: P2, free: boolean): { p: P2; snapped: boolean } => {
    if (!view) return { p: raw, snapped: false }
    const r = 10 * view.k
    const cands: P2[] = []
    for (const w of walls) {
      const e = wallEnds(w)
      cands.push(e.a, e.b)
    }
    for (const c of onLevel(model.columns)) cands.push([c.x, c.y])
    for (const g of model.grids) cands.push(g.a, g.b)
    for (const x of [...onLevel(model.slabs), ...model.rooms.filter((q) => q.level === level && q.outline)]) cands.push(...(x.outline ?? []))
    let best: P2 | null = null,
      bd = r
    for (const c of cands) {
      const d = dist(c, raw)
      if (d < bd) ((best = c), (bd = d))
    }
    if (best) return { p: best, snapped: true }
    let p: P2 = [Math.round(raw[0] / 50) * 50, Math.round(raw[1] / 50) * 50]
    const last = pts.at(-1)
    if (last && !free && tool !== 'room') {
      const a = Math.atan2(p[1] - last[1], p[0] - last[0])
      const q = Math.round(a / (Math.PI / 2)) * (Math.PI / 2)
      if (Math.abs(a - q) < (8 * Math.PI) / 180) {
        const L = dist(last, p)
        p = [Math.round((last[0] + Math.cos(q) * L) / 10) * 10, Math.round((last[1] + Math.sin(q) * L) / 10) * 10]
      }
    }
    return { p, snapped: false }
  }

  /** Topmost element under a plan point. */
  const hit = (p: P2, wallsOnly = false): ElementRef | null => {
    if (!view) return null
    const tol = 6 * view.k
    if (!wallsOnly) {
      for (const a of onLevel(model.annotations)) if (dist(a.a, p) < tol * 3 || (a.b && segDist(p, a.a, a.b).d < tol)) return { category: 'annotation', id: a.id }
      for (const c of onLevel(model.components)) if (pointInPoly(p, boxPoly(c.x, c.y, c.w, c.d, c.rot))) return { category: 'component', id: c.id }
      for (const c of onLevel(model.columns)) if (Math.abs(p[0] - c.x) <= c.w / 2 + tol && Math.abs(p[1] - c.y) <= c.d / 2 + tol) return { category: 'column', id: c.id }
      for (const st of model.stairs.filter((x) => x.baseLevel === level)) if (pointInPoly(p, stairPoly(st))) return { category: 'stair', id: st.id }
      for (const o of openings) {
        const w = model.walls.find((x) => x.id === o.hostWall)!
        const d = segDist(p, openingPoint(w, o, 0), openingPoint(w, o, 1))
        if (d.d < (typeOf(model, w)?.thickness ?? 200) / 2 + tol) return { category: o.category, id: o.id }
      }
    }
    let bw: Wall | null = null,
      bd = Infinity
    for (const w of walls) {
      const e = wallEnds(w)
      const d = segDist(p, e.a, e.b).d - (typeOf(model, w)?.thickness ?? 200) / 2
      if (d < tol && d < bd) ((bw = w), (bd = d))
    }
    if (bw) return { category: 'wall', id: bw.id }
    if (wallsOnly) return null
    for (const r of onLevel(model.railings)) for (let i = 0; i + 1 < r.pts.length; i++) if (segDist(p, r.pts[i], r.pts[i + 1]).d < tol) return { category: 'railing', id: r.id }
    for (const g of model.grids) if (segDist(p, g.a, g.b).d < tol) return { category: 'grid', id: g.id }
    for (const r of model.rooms) if (r.level === level && r.outline && pointInPoly(p, r.outline)) return { category: 'room', id: r.id }
    for (const sl of onLevel(model.slabs)) if (pointInPoly(p, sl.outline)) return { category: 'slab', id: sl.id }
    return null
  }

  const add = (what: string, fn: (m: BimModel) => BimModel, sel?: ElementRef) => {
    const err = edit(`Add ${what}`, fn)
    if (err) return toast(fmt(T.bim.props.invalid, { mark: err }), 'warning')
    if (sel) set({ selection: sel })
    toast(fmt(t.added, { what }))
  }
  const topOf = () => (top ? { topLevel: top.id, topOffset: 0 } : { topLevel: level, topOffset: 3000 })

  const addWall = (a: P2, b: P2) => {
    const L = Math.round(dist(a, b))
    if (L < 200) return toast(fmt(t.tooShort, { min: 200 }), 'warning')
    const mark = nextMark(
      full.walls.map((w) => w.mark),
      'W',
    )
    const typeId = tool === 'curtainWall' ? 'CW100' : wallType
    const w: Wall = {
      id: mark,
      category: 'wall',
      mark,
      typeId,
      baseLevel: level,
      baseOffset: 0,
      ...topOf(),
      length: L,
      x: a[0],
      y: a[1],
      angle: Math.round(((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI) * 100) / 100,
    }
    add(`${mark} (${typeOf(model, w).name})`, (m) => ({ ...m, walls: [...m.walls, w] }), { category: 'wall', id: w.id })
  }
  const addOpening = (p: P2, cat: 'door' | 'window') => {
    const hw = hit(p, true)
    const host = hw && model.walls.find((w) => w.id === hw.id)
    const name = cat === 'door' ? T.bim.tools.door : T.bim.tools.window
    if (!host || typeOf(model, host)?.family === 'Curtain Wall') return toast(fmt(t.noHost, { what: name.toLowerCase() }), 'warning')
    const width = cat === 'door' ? DOOR_W : WINDOW_W
    if (host.length < width + 200) return toast(fmt(t.tooShort, { min: width + 200 }), 'warning')
    const e = wallEnds(host)
    const along = segDist(p, e.a, e.b).t * host.length
    const offset = Math.round(Math.min(host.length - width - 100, Math.max(100, along - width / 2)) / 10) * 10
    const list = cat === 'door' ? full.doors : full.windows
    const mark = nextMark(
      list.map((o) => o.mark),
      cat === 'door' ? 'D' : 'WN',
    )
    const o: Opening = {
      id: uid(cat),
      category: cat,
      mark,
      family: cat === 'door' ? 'Single-Flush' : 'Fixed',
      type: cat === 'door' ? `${width} x 2100mm` : `${width} x 1500mm`,
      hostWall: host.id,
      offset,
      width,
      height: cat === 'door' ? 2100 : 1500,
      sill: cat === 'door' ? 0 : 900,
    }
    add(`${mark} → ${host.mark}`, (m) => (cat === 'door' ? { ...m, doors: [...m.doors, o] } : { ...m, windows: [...m.windows, o] }), { category: cat, id: o.id })
  }
  const finishRailing = () => {
    if (pts.length < 2) return toast(t.railingMin, 'warning')
    const mark = nextMark(
      full.railings.map((r) => r.mark),
      'R',
    )
    const r = {
      id: uid('rail'),
      category: 'railing' as const,
      mark,
      level,
      pts,
      height: 1100,
    }
    add(mark, (m) => ({ ...m, railings: [...m.railings, r] }), {
      category: 'railing',
      id: r.id,
    })
    setPts([])
  }

  const click = (p: P2, raw: P2) => {
    switch (tool) {
      case 'select':
        return set({ selection: hit(raw), rightTab: 'properties' })
      case 'wall':
      case 'curtainWall':
        if (pts.length) addWall(pts[pts.length - 1], p)
        return setPts([p])
      case 'door':
      case 'window':
        return addOpening(raw, tool)
      case 'column': {
        const mark = nextMark(
          full.columns.map((c) => c.mark),
          'C',
        )
        const c = {
          id: uid('col'),
          category: 'column' as const,
          mark,
          level,
          topLevel: top?.id ?? level,
          x: p[0],
          y: p[1],
          w: COLUMN,
          d: COLUMN,
        }
        if (!top) return toast(fmt(T.bim.props.invalid, { mark }), 'warning')
        return add(mark, (m) => ({ ...m, columns: [...m.columns, c] }), {
          category: 'column',
          id: c.id,
        })
      }
      case 'room': {
        const outline = roomAt(model, level, raw)
        if (!outline) return toast(t.noRoom, 'warning')
        const idx = [...model.levels].sort((a, b) => a.elevation - b.elevation).findIndex((l) => l.id === level) + 1
        const nums = full.rooms
          .filter((r) => r.level === level)
          .map((r) => Number(r.number))
          .filter(Number.isFinite)
        const number = String(nums.length ? Math.max(...nums) + 1 : idx * 100 + 1)
        const r = {
          id: uid('room'),
          category: 'room' as const,
          number,
          name: 'Room',
          level,
          area: Math.round(polyArea(outline) / 1e4) / 100,
          outline,
        }
        return add(`${T.bim.tools.room} ${number}`, (m) => ({ ...m, rooms: [...m.rooms, r] }), { category: 'room', id: r.id })
      }
      case 'railing':
        return setPts([...pts, p])
      case 'component': {
        const mark = nextMark(
          full.components.map((c) => c.mark),
          'F',
        )
        // a library component (Components → Insert into BIM) or the generic one; it sits on the level's floor
        const pc = useBim.getState().pendingComponent
        let rot = pc?.rot ?? 0
        if (pc?.autoAlign) {
          let best = 1000
          for (const w of wallsOn(full, level)) {
            const { a, b } = wallEnds(w)
            const d = segDist(p, a, b).d
            if (d < best) (best = d), (rot = (((w.angle ?? 0) % 180) + 180) % 180)
          }
        }
        const c = {
          id: uid('comp'),
          category: 'component' as const,
          mark,
          name: pc?.name ?? t.componentName,
          level,
          x: p[0],
          y: p[1],
          w: pc?.w ?? 1200,
          d: pc?.d ?? 600,
          h: pc?.h ?? 750,
          rot,
        }
        return add(mark, (m) => ({ ...m, components: [...m.components, c] }), {
          category: 'component',
          id: c.id,
        })
      }
      case 'modelText':
        setText('')
        return setTextAt(p)
      case 'tag': {
        const target = hit(raw)
        if (!target || target.category === 'annotation') return
        const c = centreOf(model, target) ?? raw
        const a: Annotation = {
          id: uid('tag'),
          category: 'annotation',
          kind: 'tag',
          level,
          a: [c[0] + 500, c[1] + 500],
          b: c,
          target: target.id,
        }
        return add(`${T.bim.tools.tag} ${markOf(model, target)}`, (m) => ({
          ...m,
          annotations: [...m.annotations, a],
        }))
      }
      default: {
        // two-click tools
        if (!pts.length) return setPts([p])
        const a = pts[0]
        setPts([])
        if (tool === 'slab' || tool === 'roof' || tool === 'ceiling') {
          const poly = rectPoly(a, p)
          if (Math.abs(p[0] - a[0]) < 500 || Math.abs(p[1] - a[1]) < 500) return toast(fmt(t.tooShort, { min: 500 }), 'warning')
          const prefix = tool === 'roof' ? 'RF' : tool === 'ceiling' ? 'CL' : 'S'
          const mark = nextMark(
            full.slabs.map((x) => x.mark),
            prefix,
          )
          const sl = {
            id: uid('slab'),
            category: 'slab' as const,
            mark,
            kind: tool === 'slab' ? ('floor' as const) : tool,
            level,
            offset: tool === 'ceiling' ? 2700 : 0,
            thickness: tool === 'roof' ? 250 : tool === 'ceiling' ? 20 : 200,
            outline: poly,
          }
          return add(mark, (m) => ({ ...m, slabs: [...m.slabs, sl] }), {
            category: 'slab',
            id: sl.id,
          })
        }
        if (tool === 'stair') {
          const L = Math.round(dist(a, p))
          if (L < 1500) return toast(fmt(t.tooShort, { min: 1500 }), 'warning')
          if (!top) return
          const mark = nextMark(
            full.stairs.map((x) => x.mark),
            'ST',
          )
          const st = {
            id: uid('stair'),
            category: 'stair' as const,
            mark,
            baseLevel: level,
            topLevel: top.id,
            x: a[0],
            y: a[1],
            angle: (Math.atan2(p[1] - a[1], p[0] - a[0]) * 180) / Math.PI,
            length: L,
            width: 1000,
          }
          return add(mark, (m) => ({ ...m, stairs: [...m.stairs, st] }), {
            category: 'stair',
            id: st.id,
          })
        }
        if (tool === 'dimension') {
          if (dist(a, p) < 50) return
          const d: Annotation = {
            id: uid('dim'),
            category: 'annotation',
            kind: 'dimension',
            level,
            a,
            b: p,
          }
          return add(`${T.bim.tools.dimension} ${Math.round(dist(a, p))} mm`, (m) => ({ ...m, annotations: [...m.annotations, d] }))
        }
        if (tool === 'grid') {
          if (dist(a, p) < 1000) return toast(fmt(t.tooShort, { min: 1000 }), 'warning')
          const label = nextGridLabel(model, a, p)
          const g = {
            id: uid('grid'),
            category: 'grid' as const,
            label,
            a,
            b: p,
          }
          return add(`${T.bim.tools.grid} ${label}`, (m) => ({ ...m, grids: [...m.grids, g] }), { category: 'grid', id: g.id })
        }
      }
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement
      if (typing) return
      if (e.key === 'Escape') {
        if (pts.length) setPts([])
        else set({ tool: 'select' })
      } else if (e.key === 'Enter' && tool === 'railing') finishRailing()
      else if ((e.key === 'Delete' || e.key === 'Backspace') && tool === 'select') {
        const label = useBim.getState().deleteSelection()
        if (label) toast(fmt(t.deleted, { what: label.replace(/^Delete /, '') }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      setView((v) => {
        if (!v) return v
        const sx = e.clientX - r.left,
          sy = e.clientY - r.top
        const wx = (sx - r.width / 2) * v.k + v.cx,
          wy = v.cy - (sy - r.height / 2) * v.k
        const k = Math.min(Math.max(v.k * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), 1), 400)
        return {
          k,
          cx: wx - (sx - r.width / 2) * k,
          cy: wy + (sy - r.height / 2) * k,
        }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const local = (e: React.PointerEvent | React.MouseEvent): [number, number] => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  // ── drawing ──────────────────────────────────────────────────────────────
  const out: ReactNode[] = []
  if (view) {
    const poly = (ps: P2[]) =>
      ps
        .map((p) =>
          S(p)
            .map((v) => v.toFixed(1))
            .join(','),
        )
        .join(' ')
    const isSel = (id: string) => selection?.id === id
    for (const sl of onLevel(model.slabs)) out.push(<polygon key={sl.id} points={poly(sl.outline)} className={`${s.slab} ${s[sl.kind]} ${isSel(sl.id) ? s.sel : ''}`} />)
    for (const r of model.rooms.filter((q) => q.level === level && q.outline)) {
      const c = S(centreOf(model, { category: 'room', id: r.id })!)
      out.push(
        <g key={r.id}>
          <polygon points={poly(r.outline!)} className={`${s.room} ${isSel(r.id) ? s.sel : ''}`} />
          <text x={c[0]} y={c[1] - 4} className={s.roomName}>
            {r.name} {r.number}
          </text>
          <text x={c[0]} y={c[1] + 11} className={s.roomArea}>
            {r.area.toFixed(2)} m²
          </text>
        </g>,
      )
    }
    for (const g of model.grids) {
      const [a, b] = [S(g.a), S(g.b)]
      const ux = b[0] - a[0],
        uy = b[1] - a[1],
        L = Math.hypot(ux, uy) || 1
      const bub: P2 = [a[0] - (ux / L) * 14, a[1] - (uy / L) * 14]
      out.push(
        <g key={g.id} className={isSel(g.id) ? s.selG : ''}>
          <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className={s.grid} />
          <circle cx={bub[0]} cy={bub[1]} r={12} className={s.gridBubble} />
          <text x={bub[0]} y={bub[1] + 4} className={s.gridLabel}>
            {g.label}
          </text>
        </g>,
      )
    }
    for (const w of walls) {
      const ty = typeOf(model, w)
      const cw = ty?.family === 'Curtain Wall'
      out.push(<polygon key={w.id} points={poly(wallPoly(model, w))} className={`${cw ? s.curtain : ty && ty.thickness <= 150 ? s.partition : s.wall} ${isSel(w.id) ? s.sel : ''}`} data-id={w.id} />)
    }
    for (const o of openings) {
      const w = model.walls.find((x) => x.id === o.hostWall)!
      const half = (typeOf(model, w)?.thickness ?? 200) / 2 + 2
      const { dir } = wallEnds(w)
      const n: P2 = [-dir[1], dir[0]]
      const p0 = openingPoint(w, o, 0),
        p1 = openingPoint(w, o, 1)
      const gap = [
        [p0[0] + n[0] * half, p0[1] + n[1] * half],
        [p1[0] + n[0] * half, p1[1] + n[1] * half],
        [p1[0] - n[0] * half, p1[1] - n[1] * half],
        [p0[0] - n[0] * half, p0[1] - n[1] * half],
      ] as P2[]
      const sel = isSel(o.id) ? s.sel : ''
      if (o.category === 'door') {
        const leafEnd: P2 = [p0[0] + n[0] * o.width, p0[1] + n[1] * o.width]
        const [A, B, C] = [S(p0), S(leafEnd), S(p1)]
        out.push(
          <g key={o.id}>
            <polygon points={poly(gap)} className={s.gap} />
            <line x1={A[0]} y1={A[1]} x2={B[0]} y2={B[1]} className={`${s.door} ${sel}`} />
            <path d={`M${B[0]},${B[1]} A${px(o.width)},${px(o.width)} 0 0 ${(B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]) > 0 ? 1 : 0} ${C[0]},${C[1]}`} className={s.swing} />
          </g>,
        )
      } else {
        const lines = [-0.5, 0, 0.5].map((f) => [S([p0[0] + n[0] * half * f, p0[1] + n[1] * half * f]), S([p1[0] + n[0] * half * f, p1[1] + n[1] * half * f])])
        out.push(
          <g key={o.id}>
            <polygon points={poly(gap)} className={`${s.gap} ${sel}`} />
            {lines.map(([a, b], i) => (
              <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className={s.window} />
            ))}
          </g>,
        )
      }
    }
    for (const c of onLevel(model.columns)) {
      const q = S([c.x, c.y])
      out.push(
        c.round ? (
          <circle key={c.id} cx={q[0]} cy={q[1]} r={px(c.w / 2)} className={`${s.column} ${isSel(c.id) ? s.sel : ''}`} />
        ) : (
          <rect key={c.id} x={q[0] - px(c.w / 2)} y={q[1] - px(c.d / 2)} width={px(c.w)} height={px(c.d)} className={`${s.column} ${isSel(c.id) ? s.sel : ''}`} />
        ),
      )
    }
    for (const st of model.stairs.filter((x) => x.baseLevel === level)) out.push(<StairPlan key={st.id} st={st} m={model} S={S} sel={isSel(st.id)} />)
    for (const r of onLevel(model.railings)) out.push(<polyline key={r.id} points={poly(r.pts)} className={`${s.railing} ${isSel(r.id) ? s.sel : ''}`} />)
    for (const c of onLevel(model.components)) {
      const ps = boxPoly(c.x, c.y, c.w, c.d, c.rot)
      const [a, , b] = [S(ps[0]), S(ps[1]), S(ps[2])]
      const d = S(ps[3]),
        bb = S(ps[1])
      out.push(
        <g key={c.id}>
          <polygon points={poly(ps)} className={`${s.component} ${isSel(c.id) ? s.sel : ''}`} />
          <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className={s.componentX} />
          <line x1={bb[0]} y1={bb[1]} x2={d[0]} y2={d[1]} className={s.componentX} />
        </g>,
      )
    }
    for (const a of onLevel(model.annotations)) out.push(<AnnotationPlan key={a.id} a={a} m={model} S={S} px={px} sel={isSel(a.id)} />)

    // preview of the active tool
    const cur = cursor?.p
    const last = pts.at(-1)
    if (cur && last && (tool === 'wall' || tool === 'curtainWall' || tool === 'railing' || tool === 'stair' || tool === 'dimension' || tool === 'grid')) {
      const [a, b] = [S(last), S(cur)]
      out.push(
        <g key="preview">
          {tool === 'railing' && pts.length > 1 && <polyline points={poly(pts)} className={s.preview} />}
          <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className={s.preview} />
          <text x={(a[0] + b[0]) / 2} y={(a[1] + b[1]) / 2 - 8} className={s.previewText}>
            {fmt(t.length, {
              l: Math.round(dist(last, cur)).toLocaleString('en-US'),
            })}
          </text>
        </g>,
      )
    }
    if (cur && last && (tool === 'slab' || tool === 'roof' || tool === 'ceiling')) out.push(<polygon key="preview" points={poly(rectPoly(last, cur))} className={s.previewFill} />)
    if (cur && (tool === 'door' || tool === 'window')) {
      const hw = hit(cur, true)
      const w = hw && model.walls.find((x) => x.id === hw.id)
      if (w) out.push(<polygon key="preview" points={poly(wallPoly(model, w))} className={s.previewFill} />)
    }
    if (cur && tool === 'column') {
      const q = S(cur)
      out.push(<rect key="preview" x={q[0] - px(COLUMN / 2)} y={q[1] - px(COLUMN / 2)} width={px(COLUMN)} height={px(COLUMN)} className={s.previewFill} />)
    }
    if (cur && tool === 'room') {
      const r = roomAt(model, level, cur)
      if (r) out.push(<polygon key="preview" points={poly(r)} className={s.previewFill} />)
    }
    if (cur && tool !== 'select') {
      const q = S(cur)
      out.push(cursor!.snapped ? <rect key="snap" x={q[0] - 5} y={q[1] - 5} width={10} height={10} className={s.snap} /> : <circle key="snap" cx={q[0]} cy={q[1]} r={3} className={s.cursor} />)
    }
  }

  const hint = (T.bim.draw.hint as Record<string, string>)[tool]
  return (
    <>
      <div
        ref={ref}
        className={`${s.plan} ${tool !== 'select' ? s.drawing : ''}`}
        data-native-viewport-slot="bim-plan"
        data-testid="bim-plan"
        data-tool={tool}
        onPointerDown={(e) => {
          if (!view) return
          ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
          const [x, y] = local(e)
          drag.current = { x, y, v: view, moved: false }
        }}
        onPointerMove={(e) => {
          const [x, y] = local(e)
          const d = drag.current
          if (d && (tool === 'select' || e.buttons === 4 || e.buttons === 2) && Math.hypot(x - d.x, y - d.y) > 3) {
            d.moved = true
            setView({
              ...d.v,
              cx: d.v.cx - (x - d.x) * d.v.k,
              cy: d.v.cy + (y - d.y) * d.v.k,
            })
            return
          }
          setCursor(snap(W(x, y), e.shiftKey))
        }}
        onPointerUp={(e) => {
          const d = drag.current
          drag.current = null
          if (!d || d.moved || e.button !== 0) return
          const [x, y] = local(e)
          const raw = W(x, y)
          click(snap(raw, e.shiftKey).p, raw)
        }}
        onDoubleClick={() => {
          if (tool === 'wall' || tool === 'curtainWall') setPts([])
          else if (tool === 'railing') finishRailing()
          else if (tool === 'select') fit()
        }}
        onContextMenu={(e) => e.preventDefault()}
        onPointerLeave={() => setCursor(null)}
      >
        <svg width={size.w} height={size.h} className={s.svg}>
          {out}
        </svg>
        {!walls.length && <p className={s.none}>{t.noLevelPlan}</p>}
        <div className={s.bar} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
          <strong>{lvl?.name}</strong>
          <span>
            {fmt(hint ?? '', {
              w: tool === 'door' ? DOOR_W : tool === 'window' ? WINDOW_W : COLUMN,
            })}
          </span>
          {tool === 'wall' && (
            <select aria-label={t.wallType} value={wallType} onChange={(e) => set({ wallType: e.target.value })}>
              {model.wallTypes
                .filter((x) => x.family === 'Basic Wall')
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </select>
          )}
          {TWO_CLICK.includes(tool) && pts.length === 1 && <em>1 / 2</em>}
          {tool !== 'select' && (
            <button type="button" onClick={() => set({ tool: 'select' })}>
              {t.esc}
            </button>
          )}
        </div>
      </div>
      {/* outside the plan: its pointer capture must not swallow the dialog's clicks */}
      {textAt && (
        <Modal title={t.textPrompt} onClose={() => setTextAt(null)} width={360}>
          <form
            className={s.form}
            onSubmit={(e) => {
              e.preventDefault()
              if (text.trim()) {
                const a: Annotation = {
                  id: uid('text'),
                  category: 'annotation',
                  kind: 'text',
                  level,
                  a: textAt,
                  text: text.trim(),
                }
                add(`${T.bim.tools.modelText} “${text.trim()}”`, (m) => ({
                  ...m,
                  annotations: [...m.annotations, a],
                }))
              }
              setTextAt(null)
            }}
          >
            <input aria-label={t.textPrompt} autoFocus value={text} onChange={(e) => setText(e.target.value)} />
            <button type="submit">{t.textOk}</button>
          </form>
        </Modal>
      )}
    </>
  )
}

function boxPoly(cx: number, cy: number, w: number, d: number, rot: number): P2[] {
  const a = (rot * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a)
  return (
    [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ] as P2[]
  ).map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c])
}

function stairPoly(st: BimModel['stairs'][number]): P2[] {
  const t = (st.angle * Math.PI) / 180
  const ux = Math.cos(t),
    uy = Math.sin(t),
    nx = -uy * (st.width / 2),
    ny = ux * (st.width / 2)
  return [
    [st.x + nx, st.y + ny],
    [st.x + ux * st.length + nx, st.y + uy * st.length + ny],
    [st.x + ux * st.length - nx, st.y + uy * st.length - ny],
    [st.x - nx, st.y - ny],
  ]
}

function StairPlan({ st, m, S, sel }: { st: BimModel['stairs'][number]; m: BimModel; S: (p: P2) => P2; sel: boolean }) {
  const { n } = stairRisers(m, st.baseLevel, st.topLevel)
  const t = (st.angle * Math.PI) / 180
  const ux = Math.cos(t),
    uy = Math.sin(t),
    nx = -uy * (st.width / 2),
    ny = ux * (st.width / 2)
  const poly = stairPoly(st)
    .map((p) => S(p).join(','))
    .join(' ')
  const treads = Array.from({ length: n - 1 }, (_, i) => {
    const d = ((i + 1) * st.length) / n
    return [S([st.x + ux * d + nx, st.y + uy * d + ny]), S([st.x + ux * d - nx, st.y + uy * d - ny])]
  })
  const a = S([st.x + ux * 150, st.y + uy * 150]),
    b = S([st.x + ux * (st.length - 150), st.y + uy * (st.length - 150)])
  return (
    <g>
      <polygon points={poly} className={`${s.stair} ${sel ? s.sel : ''}`} />
      {treads.map(([p, q], i) => (
        <line key={i} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} className={s.tread} />
      ))}
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className={s.arrow} markerEnd="url(#bimArrow)" />
      <text x={a[0]} y={a[1] - 6} className={s.upText}>
        UP {n}R
      </text>
      <defs>
        <marker id="bimArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#374151" />
        </marker>
      </defs>
    </g>
  )
}

function AnnotationPlan({ a, m, S, px, sel }: { a: Annotation; m: BimModel; S: (p: P2) => P2; px: (mm: number) => number; sel: boolean }) {
  const p = S(a.a)
  if (a.kind === 'text')
    return (
      <text x={p[0]} y={p[1]} className={`${s.modelText} ${sel ? s.selText : ''}`} style={{ fontSize: Math.min(40, Math.max(9, px(300))) }}>
        {a.text}
      </text>
    )
  if (a.kind === 'tag') {
    const q = S(a.b ?? a.a)
    const label = a.target ? markOf(m, { category: 'wall', id: a.target }) : '?'
    return (
      <g className={sel ? s.selG : ''}>
        <line x1={q[0]} y1={q[1]} x2={p[0]} y2={p[1]} className={s.leader} />
        <rect x={p[0] - 4 - label.length * 3.6} y={p[1] - 10} width={8 + label.length * 7.2} height={18} rx={3} className={s.tagBox} />
        <text x={p[0]} y={p[1] + 3} className={s.tagText}>
          {label}
        </text>
      </g>
    )
  }
  // aligned dimension, 600 mm to the left of a → b
  const b = a.b ?? a.a
  const L = dist(a.a, b) || 1
  const nx = (-(b[1] - a.a[1]) / L) * 600,
    ny = ((b[0] - a.a[0]) / L) * 600
  const [A, B, A2, B2] = [S(a.a), S(b), S([a.a[0] + nx, a.a[1] + ny]), S([b[0] + nx, b[1] + ny])]
  const ang = (Math.atan2(B2[1] - A2[1], B2[0] - A2[0]) * 180) / Math.PI
  const up = ang > 90 || ang < -90 ? ang + 180 : ang
  const mid: P2 = [(A2[0] + B2[0]) / 2, (A2[1] + B2[1]) / 2]
  return (
    <g className={sel ? s.selG : ''}>
      <line x1={A[0]} y1={A[1]} x2={A2[0]} y2={A2[1]} className={s.dimExt} />
      <line x1={B[0]} y1={B[1]} x2={B2[0]} y2={B2[1]} className={s.dimExt} />
      <line x1={A2[0]} y1={A2[1]} x2={B2[0]} y2={B2[1]} className={s.dim} />
      {[A2, B2].map((q, i) => (
        <line key={i} x1={q[0] - 4} y1={q[1] + 4} x2={q[0] + 4} y2={q[1] - 4} className={s.dim} />
      ))}
      <text x={mid[0]} y={mid[1] - 4} className={s.dimText} transform={`rotate(${up} ${mid[0]} ${mid[1]})`}>
        {Math.round(L).toLocaleString('en-US')}
      </text>
    </g>
  )
}

function structuralView(m: BimModel): BimModel {
  const walls = m.walls.filter((w) => isStructuralWall(m, w))
  const ids = new Set(walls.map((w) => w.id))
  return {
    ...m,
    walls,
    doors: m.doors.filter((o) => ids.has(o.hostWall)),
    windows: m.windows.filter((o) => ids.has(o.hostWall)),
    rooms: [],
    railings: [],
    components: [],
    slabs: m.slabs.filter((x) => x.kind !== 'ceiling'),
  }
}
