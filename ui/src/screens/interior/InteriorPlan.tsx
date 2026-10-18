import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Box, X } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { useInterior } from '../../state/interior'
import { toast } from '../../state/toast'
import { MATERIALS, area, dimsLabel, type Room } from '../../interior/model'
import { itemPlacements } from '../../interior/scene'
import { assetByKey } from '../../interior/catalog'
import { placeAsset, setPlace } from '../../interior/layout'
import { materialSpec } from '../../interior/materials'
import { checkClearance } from '../../interior/clearance'
import { wallFaces } from '../../interior/geom'
import { commit, rulesOf } from './spaceKit'
import { dragHasFiles, imageFilesOf, startStyleReading } from './StyleFromPhoto'
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

const ASSET = 'application/x-md-asset'

/**
 * Interior plans drawn from the model: furniture layout (rooms, finishes, every item at its placement),
 * reflected ceiling plan (ceiling heights, lights) and finish plan (rooms coloured by floor finish, with the
 * finish's texture tile drawn at its real size in mm). Dimension and Tag tools work here; picks select the
 * room / item in Properties. Space Planning: drag the selected item to move it (host and lock rules apply),
 * drop products from the library, see door swings, clearance issues and a previewed option (not applied).
 */
export function InteriorPlan() {
  const T = useT()
  const t = T.interior.plan
  const st = useInterior()
  const { plan, itool, sel, inst, set, edit, preview, bottom, spTab } = st
  // a previewed layout / fix is drawn instead of the design (nothing is applied)
  const doc = preview?.doc ?? st.doc
  const kind = plan ?? 'floor'
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<View | null>(null)
  const [pending, setPending] = useState<P2 | null>(null)
  const [cursor, setCursor] = useState<P2 | null>(null)
  const drag = useRef<{ x: number; y: number; v: View; moved: boolean; item?: { id: string; k: number; at: { x: number; y: number; rot: number }; w0: P2 } } | null>(null)
  const [ghost, setGhost] = useState<{ id: string; k: number; dx: number; dy: number } | null>(null)
  const places = useMemo(() => itemPlacements(doc), [doc])
  const rn = (n: string) => T.interior.roomNames[n] ?? n
  // clearance issues highlighted while the Space Planning checks are open
  const flagged = useMemo(() => {
    if (bottom !== 'space' || spTab !== 'checks' || preview) return new Set<string>()
    return new Set(checkClearance(st.doc, rulesOf(st.doc)).flatMap((x) => x.items.map(([id, k]) => `${id}#${k}`)))
  }, [bottom, spTab, preview, st.doc])

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
  /** The smallest item footprint under the point (a sofa over a rug picks the sofa), with its instance. */
  const hitInst = (p: P2) => {
    let best: { item: (typeof places)[number]['item']; k: number } | null = null, bestA = Infinity
    for (const pl of places)
      for (const [k, at] of pl.at.entries()) {
        const w = pl.item.w ?? pl.item.dia ?? 500, d = pl.item.d ?? pl.item.dia ?? 500
        const f = footprint(at.x, at.y, w, d, at.rot)
        let inside = false
        for (let i = 0, j = 3; i < 4; j = i++) if (f[i][1] > p[1] !== f[j][1] > p[1] && p[0] < ((f[j][0] - f[i][0]) * (p[1] - f[i][1])) / (f[j][1] - f[i][1]) + f[i][0]) inside = !inside
        if (inside && w * d < bestA) (best = { item: pl.item, k }), (bestA = w * d)
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
    const hit = hitInst(raw)
    const item = hit?.item ?? null
    const room = doc.rooms.find((r) => inRoom(r, raw))
    if (itool === 'tag') {
      const target = item?.id ?? room?.id
      if (!target) return
      return addNote({ id: `t${Date.now().toString(36)}`, kind: 'tag', a: [raw[0] + 450, raw[1] + 450], b: raw, target }, `${T.interior.tools.tag} ${item ? item.name : rn(room!.name)}`)
    }
    if (item) set({ sel: { kind: 'item', id: item.id }, inst: hit!.k, right: 'properties' })
    else if (room) set({ sel: { kind: 'room', id: room.id }, room: room.id, browserSel: `room-${room.id}`, right: 'properties' })
  }
  const local = (e: React.PointerEvent | React.MouseEvent | React.DragEvent): [number, number] => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  const drop = (e: React.DragEvent) => {
    // reference photos dropped on a room: read its style (Interior → AI → "Phong cách từ ảnh mẫu")
    const photos = imageFilesOf(e)
    if (photos.length && view) {
      e.preventDefault()
      const [x, y] = local(e)
      const p = W(x, y)
      const room = st.doc.rooms.find((r) => inRoom(r, p)) ?? st.doc.rooms.find((r) => r.id === st.room)
      if (room) void startStyleReading(photos, room.id)
      return
    }
    const key = e.dataTransfer.getData(ASSET)
    const a = assetByKey(key)
    if (!a || !view) return
    e.preventDefault()
    const [x, y] = local(e)
    const p = W(x, y)
    const room = st.doc.rooms.find((r) => inRoom(r, p))
    if (!room) return toast(fmt(T.interior.space.plan.blocked, { why: T.interior.space.insp.errors.room }), 'warning')
    const r = placeAsset(useInterior.getState().doc, a, room.id, { x: p[0], y: p[1] })
    if (!commit(`Place ${a.name}`, r)) return
    set({ sel: { kind: 'item', id: r.id! }, inst: 0, room: room.id, right: 'properties' })
    toast(fmt(T.interior.space.lib.placed, { name: a.name, dims: `${a.w} × ${a.d} × ${a.h}`, room: rn(room.name) }), 'success')
  }

  const out: ReactNode[] = []
  const defs: ReactNode[] = []
  if (view) {
    const poly = (ps: P2[]) => ps.map((p) => S(p).map((v) => v.toFixed(1)).join(',')).join(' ')
    for (const r of doc.rooms) {
      const ps = r.outline.map((p) => [p.x, p.y] as P2)
      const c = S([ps.reduce((a, p) => a + p[0], 0) / ps.length, ps.reduce((a, p) => a + p[1], 0) / ps.length])
      const selR = sel?.kind === 'room' && sel.id === r.id
      // finish plan: the floor finish's texture tile at its real size (mm), when it is large enough to read
      let tile: ReactNode = null
      if (kind === 'finish') {
        const sp = materialSpec(r.floorFinish)
        const pw = sp.tileMm[0] / view.k, ph = sp.tileMm[1] / view.k
        if (pw >= 4 && ph >= 4 && sp.tileMm[0] < 5000) {
          const id = `tile-${r.id}`
          const o = S([0, 0])
          defs.push(
            <pattern key={id} id={id} patternUnits="userSpaceOnUse" width={pw} height={ph} patternTransform={`translate(${o[0].toFixed(2)} ${o[1].toFixed(2)})`} data-tile-mm={`${sp.tileMm[0]}x${sp.tileMm[1]}`}>
              <path d={`M0 0H${pw}M0 0V${ph}`} className={s.tileLine} />
            </pattern>,
          )
          tile = <polygon points={poly(ps)} fill={`url(#${id})`} className={s.tile} data-tile={r.id} />
        }
      }
      out.push(
        <g key={r.id} data-room={r.id}>
          <polygon points={poly(ps)} className={`${s.room} ${selR ? s.sel : ''}`} style={kind === 'finish' ? { fill: finishColor(r.floorFinish), fillOpacity: 0.55 } : kind === 'ceiling' ? { fill: '#f8fafc' } : undefined} />
          {tile}
          <text x={c[0]} y={c[1] - (kind === 'floor' ? 0 : 6)} className={s.roomName}>{rn(r.name)}</text>
          <text x={c[0]} y={c[1] + 12} className={s.roomSub}>
            {kind === 'ceiling' ? fmt(t.ceilingH, { h: r.ceilingHeight.toLocaleString('en-US') }) : kind === 'finish' ? r.floorFinish : `${area(r.outline).toFixed(2)} m²`}
          </text>
        </g>,
      )
      // doors: the opening and, for a leaf swinging into the room, its quarter-circle swing
      const faces = wallFaces(r)
      for (const dr of r.doors ?? []) {
        const f = faces.find((x) => x.index === dr.wall)
        if (!f) continue
        const wd = dr.width ?? 0
        const a: P2 = [f.a[0] + f.dir[0] * dr.at, f.a[1] + f.dir[1] * dr.at]
        const b: P2 = [a[0] + f.dir[0] * Math.max(wd, 300), a[1] + f.dir[1] * Math.max(wd, 300)]
        const [A, B] = [S(a), S(b)]
        const leaf: P2 = [a[0] + f.n[0] * wd, a[1] + f.n[1] * wd]
        const L = S(leaf)
        out.push(
          <g key={`door-${dr.id}`} className={`${s.door} ${wd ? '' : s.doorUnknown}`} data-door={dr.id}>
            <line x1={A[0]} y1={A[1]} x2={B[0]} y2={B[1]} />
            {wd > 0 && (dr.swing ?? 'in') === 'in' && (
              <>
                <line x1={A[0]} y1={A[1]} x2={L[0]} y2={L[1]} />
                <path d={`M${L[0]} ${L[1]} A${wd / view.k} ${wd / view.k} 0 0 ${f.dir[0] * f.n[1] - f.dir[1] * f.n[0] > 0 ? 0 : 1} ${B[0]} ${B[1]}`} />
              </>
            )}
            {!wd && <text x={(A[0] + B[0]) / 2} y={(A[1] + B[1]) / 2 - 4}>?</text>}
          </g>,
        )
      }
    }
    for (const pl of places) {
      if (kind === 'ceiling' && pl.item.category !== 'lighting') continue
      if (kind === 'finish' && pl.item.category !== 'rugs') continue
      const selI = sel?.kind === 'item' && sel.id === pl.item.id
      for (const [n, at0] of pl.at.entries()) {
        const g = ghost && ghost.id === pl.item.id && ghost.k === n ? ghost : null
        const at = g ? { ...at0, x: at0.x + g.dx, y: at0.y + g.dy } : at0
        const w = pl.item.w ?? pl.item.dia ?? 500, d = pl.item.d ?? pl.item.dia ?? 500
        const cls = `${s.item} ${pl.item.category === 'lighting' ? s.light : ''} ${pl.item.status === 'planned' ? s.planned : ''} ${selI ? s.sel : ''} ${selI && n === inst && pl.at.length > 1 ? s.selInst : ''} ${flagged.has(`${pl.item.id}#${n}`) ? s.issue : ''} ${pl.item.locked ? s.locked : ''}`
        out.push(
          pl.item.dia ? (
            <circle key={pl.item.id + n} cx={S([at.x, at.y])[0]} cy={S([at.x, at.y])[1]} r={pl.item.dia / 2 / view.k} className={cls} data-item={pl.item.id} />
          ) : (
            <polygon key={pl.item.id + n} points={poly(footprint(at.x, at.y, w, d, at.rot))} className={cls} data-item={pl.item.id} />
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
      className={`${s.plan} ${itool ? s.drawing : ''} ${preview ? s.previewing : ''}`}
      data-testid="interior-plan"
      data-view={view ? `${view.cx},${view.cy},${view.k}` : ''}
      data-preview={preview ? preview.label : undefined}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(ASSET) || dragHasFiles(e)) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={drop}
      onPointerDown={(e) => {
        if (!view) return
        ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
        const [x, y] = local(e)
        // dragging the selected item moves it (not while previewing or using a plan tool)
        const hit = !itool && !preview && e.button === 0 ? hitInst(W(x, y)) : null
        const moving = hit && sel?.kind === 'item' && sel.id === hit.item.id ? { id: hit.item.id, k: hit.k, at: places.find((p) => p.item.id === hit.item.id)!.at[hit.k], w0: W(x, y) } : undefined
        drag.current = { x, y, v: view, moved: false, item: moving }
      }}
      onPointerMove={(e) => {
        const [x, y] = local(e)
        const d = drag.current
        if (d && Math.hypot(x - d.x, y - d.y) > 3 && !itool) {
          d.moved = true
          if (d.item) {
            const w = W(x, y)
            setGhost({ id: d.item.id, k: d.item.k, dx: Math.round(w[0] - d.item.w0[0]), dy: Math.round(w[1] - d.item.w0[1]) })
            return
          }
          setView({ ...d.v, cx: d.v.cx - (x - d.x) * d.v.k, cy: d.v.cy + (y - d.y) * d.v.k })
          return
        }
        if (itool === 'dimension') setCursor(snap(W(x, y)))
      }}
      onPointerUp={(e) => {
        const d = drag.current
        drag.current = null
        if (d?.item && d.moved && ghost) {
          const it = st.doc.items.find((i) => i.id === d.item!.id)
          setGhost(null)
          if (it && commit(fmt(T.interior.space.plan.moved, { name: it.name }), setPlace(useInterior.getState().doc, d.item.id, d.item.k, { ...d.item.at, x: d.item.at.x + ghost.dx, y: d.item.at.y + ghost.dy })))
            toast(fmt(T.interior.space.plan.moved, { name: it.name }))
          return
        }
        setGhost(null)
        if (!d || d.moved || e.button !== 0) return
        const [x, y] = local(e)
        click(W(x, y))
      }}
      onDoubleClick={() => !itool && fit()}
    >
      <svg width={size.w} height={size.h}>
        {defs.length > 0 && <defs>{defs}</defs>}
        {out}
      </svg>
      <div className={s.bar} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
        <strong>{t.titles[kind]}</strong>
        <span>{preview ? fmt(T.interior.space.layouts.previewing, { label: preview.label }) : t.hint[itool ?? 'select']}</span>
        {preview && <button type="button" onClick={() => set({ preview: null })} data-testid="close-preview"><X size={13} />{T.interior.space.layouts.closePreview}</button>}
        <button type="button" onClick={() => set({ plan: null, itool: null })}><Box size={13} />{t.back3d}</button>
      </div>
    </div>
  )
}
