import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Box } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { useInterior } from '../../state/interior'
import { toast } from '../../state/toast'
import { MATERIALS, area, dimsLabel, type Room } from '../../interior/model'
import { itemPlacements } from '../../interior/scene'
import s from './InteriorPlan.module.css'

type P2 = [number, number]
interface View {
  cx: number
  cy: number
  k: number
}

const dist = (a: P2, b: P2) => Math.hypot(b[0] - a[0], b[1] - a[1])
const finishColor = (name: string) => MATERIALS.find((m) => m.name === name)?.color ?? '#e5e7eb'

/** Corners of an item footprint (w × d centred, rotated). */
function footprint(x: number, y: number, w: number, d: number, rot: number): P2[] {
  const a = (rot * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a)
  return ([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] as P2[]).map(([u, v]) => [x + u * c - v * sn, y + u * sn + v * c])
}

/**
 * Interior plans drawn from the model: furniture layout (rooms, finishes, every item at its placement),
 * reflected ceiling plan (ceiling heights, lights) and finish plan (rooms coloured by floor finish).
 * Dimension and Tag tools work here; picks select the room / item in Properties.
 */
export function InteriorPlan() {
  const T = useT()
  const t = T.interior.plan
  const st = useInterior()
  const { doc, plan, itool, sel, set, edit } = st
  const kind = plan ?? 'floor'
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<View | null>(null)
  const [pending, setPending] = useState<P2 | null>(null)
  const [cursor, setCursor] = useState<P2 | null>(null)
  const drag = useRef<{ x: number; y: number; v: View; moved: boolean } | null>(null)
  const places = useMemo(() => itemPlacements(doc), [doc])
  const rn = (n: string) => T.interior.roomNames[n] ?? n

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const fit = () => {
    const xs = doc.rooms.flatMap((r) => r.outline.map((p) => p.x)), ys = doc.rooms.flatMap((r) => r.outline.map((p) => p.y))
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
    setView({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, k: Math.max((x1 - x0) / Math.max(1, size.w - 100), (y1 - y0) / Math.max(1, size.h - 110)) })
  }
  useEffect(() => {
    if (size.w && !view) fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size])
  useEffect(() => setPending(null), [itool])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      setView((v) => {
        if (!v) return v
        const sx = e.clientX - r.left, sy = e.clientY - r.top
        const wx = (sx - r.width / 2) * v.k + v.cx, wy = v.cy - (sy - r.height / 2) * v.k
        const k = Math.min(Math.max(v.k * Math.exp(e.deltaY * 0.0015), 1), 200)
        return { k, cx: wx - (sx - r.width / 2) * k, cy: wy + (sy - r.height / 2) * k }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const S = (p: P2): P2 => (view ? [(p[0] - view.cx) / view.k + size.w / 2, (view.cy - p[1]) / view.k + size.h / 2] : [0, 0])
  const W = (x: number, y: number): P2 => (view ? [(x - size.w / 2) * view.k + view.cx, view.cy - (y - size.h / 2) * view.k] : [0, 0])

  // snap targets: room corners and furniture corners
  const corners = useMemo(() => {
    const out: P2[] = doc.rooms.flatMap((r) => r.outline.map((p) => [p.x, p.y] as P2))
    for (const pl of places) for (const at of pl.at) out.push(...footprint(at.x, at.y, pl.item.w ?? pl.item.dia ?? 500, pl.item.d ?? pl.item.dia ?? 500, at.rot))
    return out
  }, [doc, places])
  const snap = (raw: P2): P2 => {
    if (!view) return raw
    let best: P2 | null = null, bd = 10 * view.k
    for (const c of corners) {
      const d = dist(c, raw)
      if (d < bd) (best = c), (bd = d)
    }
    return best ?? [Math.round(raw[0] / 10) * 10, Math.round(raw[1] / 10) * 10]
  }
  const inRoom = (r: Room, p: P2) => {
    let inside = false
    const o = r.outline
    for (let i = 0, j = o.length - 1; i < o.length; j = i++) if (o[i].y > p[1] !== o[j].y > p[1] && p[0] < ((o[j].x - o[i].x) * (p[1] - o[i].y)) / (o[j].y - o[i].y) + o[i].x) inside = !inside
    return inside
  }
  /** The smallest item footprint under the point (a sofa over a rug picks the sofa). */
  const hitItem = (p: P2) => {
    let best: (typeof places)[number]['item'] | null = null, bestA = Infinity
    for (const pl of places)
      for (const at of pl.at) {
        const w = pl.item.w ?? pl.item.dia ?? 500, d = pl.item.d ?? pl.item.dia ?? 500
        const f = footprint(at.x, at.y, w, d, at.rot)
        let inside = false
        for (let i = 0, j = 3; i < 4; j = i++) if (f[i][1] > p[1] !== f[j][1] > p[1] && p[0] < ((f[j][0] - f[i][0]) * (p[1] - f[i][1])) / (f[j][1] - f[i][1]) + f[i][0]) inside = !inside
        if (inside && w * d < bestA) (best = pl.item), (bestA = w * d)
      }
    return best
  }
  const addNote = (n: NonNullable<typeof doc.notes>[number], label: string) => {
    const err = edit(label, (d) => ({ ...d, notes: [...(d.notes ?? []), n] }))
    if (err) toast(err, 'warning')
    else toast(fmt(t.added, { what: label }))
  }
  const click = (raw: P2) => {
    if (itool === 'dimension') {
      const p = snap(raw)
      if (!pending) return setPending(p)
      if (dist(pending, p) >= 10) addNote({ id: `d${Date.now().toString(36)}`, kind: 'dimension', a: pending, b: p }, `${T.interior.tools.dimension} ${Math.round(dist(pending, p)).toLocaleString('en-US')} mm`)
      return setPending(null)
    }
    const item = hitItem(raw)
    const room = doc.rooms.find((r) => inRoom(r, raw))
    if (itool === 'tag') {
      const target = item?.id ?? room?.id
      if (!target) return
      return addNote({ id: `t${Date.now().toString(36)}`, kind: 'tag', a: [raw[0] + 450, raw[1] + 450], b: raw, target }, `${T.interior.tools.tag} ${item ? item.name : rn(room!.name)}`)
    }
    if (item) set({ sel: { kind: 'item', id: item.id }, right: 'properties' })
    else if (room) set({ sel: { kind: 'room', id: room.id }, room: room.id, browserSel: `room-${room.id}`, right: 'properties' })
  }
  const local = (e: React.PointerEvent | React.MouseEvent): [number, number] => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  const out: ReactNode[] = []
  if (view) {
    const poly = (ps: P2[]) => ps.map((p) => S(p).map((v) => v.toFixed(1)).join(',')).join(' ')
    for (const r of doc.rooms) {
      const ps = r.outline.map((p) => [p.x, p.y] as P2)
      const c = S([ps.reduce((a, p) => a + p[0], 0) / ps.length, ps.reduce((a, p) => a + p[1], 0) / ps.length])
      const selR = sel?.kind === 'room' && sel.id === r.id
      out.push(
        <g key={r.id} data-room={r.id}>
          <polygon points={poly(ps)} className={`${s.room} ${selR ? s.sel : ''}`} style={kind === 'finish' ? { fill: finishColor(r.floorFinish), fillOpacity: 0.55 } : kind === 'ceiling' ? { fill: '#f8fafc' } : undefined} />
          <text x={c[0]} y={c[1] - (kind === 'floor' ? 0 : 6)} className={s.roomName}>{rn(r.name)}</text>
          <text x={c[0]} y={c[1] + 12} className={s.roomSub}>
            {kind === 'ceiling' ? fmt(t.ceilingH, { h: r.ceilingHeight.toLocaleString('en-US') }) : kind === 'finish' ? r.floorFinish : `${area(r.outline).toFixed(2)} m²`}
          </text>
        </g>,
      )
    }
    for (const pl of places) {
      if (kind === 'ceiling' && pl.item.category !== 'lighting') continue
      if (kind === 'finish' && pl.item.category !== 'rugs') continue
      const selI = sel?.kind === 'item' && sel.id === pl.item.id
      for (const [n, at] of pl.at.entries()) {
        const w = pl.item.w ?? pl.item.dia ?? 500, d = pl.item.d ?? pl.item.dia ?? 500
        out.push(
          pl.item.dia ? (
            <circle key={pl.item.id + n} cx={S([at.x, at.y])[0]} cy={S([at.x, at.y])[1]} r={pl.item.dia / 2 / view.k} className={`${s.item} ${pl.item.category === 'lighting' ? s.light : ''} ${pl.item.status === 'planned' ? s.planned : ''} ${selI ? s.sel : ''}`} data-item={pl.item.id} />
          ) : (
            <polygon key={pl.item.id + n} points={poly(footprint(at.x, at.y, w, d, at.rot))} className={`${s.item} ${pl.item.category === 'lighting' ? s.light : ''} ${pl.item.status === 'planned' ? s.planned : ''} ${selI ? s.sel : ''}`} data-item={pl.item.id} />
          ),
        )
      }
    }
    for (const n of doc.notes ?? []) {
      if (n.kind === 'dimension' && n.b) {
        const L = dist(n.a, n.b) || 1
        const off = 300
        const nx = (-(n.b[1] - n.a[1]) / L) * off, ny = ((n.b[0] - n.a[0]) / L) * off
        const [A, B, A2, B2] = [S(n.a), S(n.b), S([n.a[0] + nx, n.a[1] + ny]), S([n.b[0] + nx, n.b[1] + ny])]
        const ang = (Math.atan2(B2[1] - A2[1], B2[0] - A2[0]) * 180) / Math.PI
        const up = ang > 90 || ang < -90 ? ang + 180 : ang
        const mid: P2 = [(A2[0] + B2[0]) / 2, (A2[1] + B2[1]) / 2]
        out.push(
          <g key={n.id} className={s.dim}>
            <line x1={A[0]} y1={A[1]} x2={A2[0]} y2={A2[1]} />
            <line x1={B[0]} y1={B[1]} x2={B2[0]} y2={B2[1]} />
            <line x1={A2[0]} y1={A2[1]} x2={B2[0]} y2={B2[1]} />
            <text x={mid[0]} y={mid[1] - 4} transform={`rotate(${up} ${mid[0]} ${mid[1]})`}>{Math.round(L).toLocaleString('en-US')}</text>
          </g>,
        )
      } else if (n.kind === 'tag') {
        const item = doc.items.find((i) => i.id === n.target)
        const room = doc.rooms.find((r) => r.id === n.target)
        const text = item ? `${item.name} · ${dimsLabel(item)}` : room ? `${rn(room.name)} · ${area(room.outline).toFixed(2)} m²` : '?'
        const [p, q] = [S(n.a), S(n.b ?? n.a)]
        out.push(
          <g key={n.id} className={s.tag}>
            <line x1={q[0]} y1={q[1]} x2={p[0]} y2={p[1]} />
            <rect x={p[0] - 4} y={p[1] - 11} width={8 + text.length * 6.2} height={18} rx={3} />
            <text x={p[0] + 2} y={p[1] + 2}>{text}</text>
          </g>,
        )
      }
    }
    if (pending && cursor) {
      const [a, b] = [S(pending), S(cursor)]
      out.push(
        <g key="pv" className={s.preview}>
          <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />
          <text x={(a[0] + b[0]) / 2} y={(a[1] + b[1]) / 2 - 6}>{Math.round(dist(pending, cursor)).toLocaleString('en-US')} mm</text>
        </g>,
      )
    }
  }

  return (
    <div
      ref={ref}
      className={`${s.plan} ${itool ? s.drawing : ''}`}
      data-testid="interior-plan"
      data-view={view ? `${view.cx},${view.cy},${view.k}` : ''}
      onPointerDown={(e) => {
        if (!view) return
        ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
        const [x, y] = local(e)
        drag.current = { x, y, v: view, moved: false }
      }}
      onPointerMove={(e) => {
        const [x, y] = local(e)
        const d = drag.current
        if (d && Math.hypot(x - d.x, y - d.y) > 3 && !itool) {
          d.moved = true
          setView({ ...d.v, cx: d.v.cx - (x - d.x) * d.v.k, cy: d.v.cy + (y - d.y) * d.v.k })
          return
        }
        if (itool === 'dimension') setCursor(snap(W(x, y)))
      }}
      onPointerUp={(e) => {
        const d = drag.current
        drag.current = null
        if (!d || d.moved || e.button !== 0) return
        const [x, y] = local(e)
        click(W(x, y))
      }}
      onDoubleClick={() => !itool && fit()}
    >
      <svg width={size.w} height={size.h}>{out}</svg>
      <div className={s.bar} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
        <strong>{t.titles[kind]}</strong>
        <span>{t.hint[itool ?? 'select']}</span>
        <button type="button" onClick={() => set({ plan: null, itool: null })}><Box size={13} />{t.back3d}</button>
      </div>
    </div>
  )
}
