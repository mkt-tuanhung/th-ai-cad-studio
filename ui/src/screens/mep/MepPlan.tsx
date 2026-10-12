import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { fmt, useT } from '../../i18n'
import { useMep, type MepSel } from '../../state/mep'
import { toast } from '../../state/toast'
import { Modal } from '../../components/ui/Modal'
import { type Clash, type Duct, type DuctType, type Fitting, type FixtureKind, type MepAnnotation, type MepModel, type Pipe, type PipeService } from '../../mep/model'
import { clashIds, FIXTURE_RGB, runColor, TRAY_RGB } from '../../mep/scene'
import s from './MepPlan.module.css'

type P2 = [number, number]
interface View {
  cx: number
  cy: number
  k: number
}
type RunLike = { x: number; y: number; axis: 'x' | 'y'; length: number }

const runEnds = (r: RunLike): [P2, P2] => [[r.x, r.y], r.axis === 'x' ? [r.x + r.length, r.y] : [r.x, r.y + r.length]]
const dist = (a: P2, b: P2) => Math.hypot(b[0] - a[0], b[1] - a[1])
function segDist(p: P2, a: P2, b: P2) {
  const vx = b[0] - a[0], vy = b[1] - a[1]
  const L2 = vx * vx + vy * vy || 1
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2))
  const q: P2 = [a[0] + vx * t, a[1] + vy * t]
  return { d: dist(p, q), t, q }
}
const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
function nextMark(marks: string[], prefix: string, pad = 2) {
  let n = 0
  for (const m of marks) {
    const r = new RegExp(`^${prefix}-?(\\d+)$`).exec(m)
    if (r) n = Math.max(n, Number(r[1]))
  }
  return `${prefix}-${String(n + 1).padStart(pad, '0')}`
}

const SERVICE_PREFIX: Record<PipeService, string> = { 'Chilled Water Supply': 'CHWS', 'Chilled Water Return': 'CHWR', 'Domestic Cold Water': 'DCW', 'Domestic Hot Water': 'DHW', 'Sanitary Drain': 'SAN', 'Fire Sprinkler': 'FS' }
const DUCT_PREFIX: Record<DuctType, string> = { 'Supply Air Duct': 'SA', 'Return Air Duct': 'RA', 'Exhaust Air Duct': 'EA', 'Outdoor Air Duct': 'OA' }
export const FIXTURE_KINDS: FixtureKind[] = ['Downlight', 'Linear Light', 'Socket', 'WC', 'Basin', 'Sink', 'Floor Drain', 'Sprinkler']
const CEILING_FIXTURES = new Set<FixtureKind>(['Downlight', 'Linear Light', 'Sprinkler'])
const fixtureElevation = (k: FixtureKind) => (CEILING_FIXTURES.has(k) ? 2700 : k === 'Socket' ? 300 : 0)

/** Runs (ducts and pipes) meeting at a point: kind of fitting from their count and directions. */
export function fittingAt(m: MepModel, level: string, p: P2, tol: number): { at: P2; kind: Fitting['kind']; runs: (Duct | Pipe)[] } | null {
  const runs = [...m.ducts, ...m.pipes].filter((r) => r.level === level)
  const near = runs.map((r) => ({ r, ...segDist(p, ...runEnds(r)) })).filter((x) => x.d < tol)
  if (!near.length) return null
  // snap to an end or to the crossing of two runs
  let at: P2 = near[0].q
  for (const x of near) for (const e of runEnds(x.r)) if (dist(e, p) < tol) at = e
  if (near.length >= 2) {
    const a = near.find((x) => x.r.axis === 'x'), b = near.find((x) => x.r.axis === 'y')
    if (a && b) at = [b.r.x, a.r.y]
  }
  const touching = runs.filter((r) => segDist(at, ...runEnds(r)).d < 1)
  // a run passing through the point counts twice (both sides continue)
  const legs = touching.reduce((n, r) => n + (runEnds(r).some((e) => dist(e, at) < 1) ? 1 : 2), 0)
  const axes = new Set(touching.map((r) => r.axis))
  const kind: Fitting['kind'] = legs <= 1 ? 'Cap' : legs === 2 ? (axes.size === 2 ? 'Elbow' : 'Coupling') : legs === 3 ? 'Tee' : 'Cross'
  return { at, kind, runs: touching.length ? touching : [near[0].r] }
}

/**
 * MEP plan (floor or ceiling) of the current level, drawn from the model, and the place where the ribbon's
 * drawing tools work. Runs are straight along X or Y (the coordination model's convention); every click is
 * a validated, undoable edit that the schedules, the clash detection and the OCCT 3D view pick up.
 */
export function MepPlan({ clashes }: { clashes: Clash[] }) {
  const T = useT()
  const t = T.mep.draw
  const st = useMep()
  const { doc, level, tool, sel, set, edit, colorBy, hiddenCats, view: viewKind } = st
  const ceiling = viewKind === 'ceiling'
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<View | null>(null)
  const [pts, setPts] = useState<P2[]>([])
  const [cursor, setCursor] = useState<P2 | null>(null)
  const [noteAt, setNoteAt] = useState<P2 | null>(null)
  const [note, setNote] = useState('')
  const drag = useRef<{ x: number; y: number; v: View; moved: boolean } | null>(null)
  const clashing = useMemo(() => new Set(clashIds(clashes, level)), [clashes, level])
  const off = new Set(hiddenCats)
  const lvName = fmt(T.mep.viewer.levelName, { n: level.slice(1) })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const fit = () => setView({ cx: 7500, cy: 6000, k: Math.max(16000 / Math.max(1, size.w - 80), 13000 / Math.max(1, size.h - 100)) })
  useEffect(() => {
    if (size.w && !view) fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size])
  useEffect(() => setPts([]), [tool, level])

  const S = (p: P2): P2 => (view ? [(p[0] - view.cx) / view.k + size.w / 2, (view.cy - p[1]) / view.k + size.h / 2] : [0, 0])
  const W = (x: number, y: number): P2 => (view ? [(x - size.w / 2) * view.k + view.cx, view.cy - (y - size.h / 2) * view.k] : [0, 0])
  const px = (mm: number) => (view ? mm / view.k : 0)
  const on = <X extends { level: string }>(xs: X[]) => xs.filter((x) => x.level === level)

  /** 50 mm grid; snaps to run ends within 10 px; runs stay straight along X or Y. */
  const snap = (raw: P2): P2 => {
    if (!view) return raw
    for (const r of [...on(doc.ducts), ...on(doc.pipes), ...on(doc.trays)]) for (const e of runEnds(r)) if (dist(e, raw) < 10 * view.k) return e
    let p: P2 = [Math.round(raw[0] / 50) * 50, Math.round(raw[1] / 50) * 50]
    const last = pts.at(-1)
    if (last && (tool === 'duct' || tool === 'pipe' || tool === 'tray')) p = Math.abs(p[0] - last[0]) >= Math.abs(p[1] - last[1]) ? [p[0], last[1]] : [last[0], p[1]]
    return p
  }

  const hit = (p: P2): MepSel => {
    if (!view) return null
    const tol = 6 * view.k
    for (const a of on(doc.annotations)) if (dist(a.a, p) < tol * 3) return { kind: 'annotation', id: a.id }
    for (const x of on(doc.sections)) if (segDist(p, x.a, x.b).d < tol) return { kind: 'section', id: x.id }
    for (const f of on(doc.fittings)) if (dist([f.x, f.y], p) < tol * 2) return { kind: 'fitting', id: f.id }
    for (const f of on(doc.fixtures)) if (dist([f.x, f.y], p) < Math.max(tol * 2, 300)) return { kind: 'fixture', id: f.id }
    for (const f of on(doc.terminals)) if (Math.abs(f.x - p[0]) < f.size / 2 && Math.abs(f.y - p[1]) < f.size / 2) return { kind: 'terminal', id: f.id }
    for (const x of on(doc.pipes)) if (segDist(p, ...runEnds(x)).d < x.dn / 2 + tol) return { kind: 'pipe', id: x.id }
    for (const x of on(doc.ducts)) if (segDist(p, ...runEnds(x)).d < x.w / 2 + tol) return { kind: 'duct', id: x.id }
    for (const x of on(doc.trays)) if (segDist(p, ...runEnds(x)).d < x.w / 2 + tol) return { kind: 'tray', id: x.id }
    return null
  }

  const add = (what: string, fn: (m: MepModel) => MepModel, select?: MepSel) => {
    const err = edit(`Add ${what}`, fn)
    if (err) return toast(fmt(T.mep.toast.invalid, { why: err }), 'warning')
    if (select) set({ sel: select, right: 'properties' })
    toast(fmt(t.added, { what }))
  }

  const addRun = (a: P2, b: P2) => {
    const axis = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 'x' : 'y'
    const L = Math.round(axis === 'x' ? Math.abs(b[0] - a[0]) : Math.abs(b[1] - a[1]))
    if (L < 300) return toast(fmt(t.tooShort, { min: 300 }), 'warning')
    const start: P2 = axis === 'x' ? [Math.min(a[0], b[0]), a[1]] : [a[0], Math.min(a[1], b[1])]
    const base = { x: start[0], y: start[1], axis: axis as 'x' | 'y', length: L, level }
    if (tool === 'duct') {
      const type: DuctType = 'Supply Air Duct'
      const mark = nextMark(doc.ducts.map((d) => d.mark), DUCT_PREFIX[type])
      const d: Duct = { ...base, id: `${mark}-${level}`, mark, type, w: 400, h: 300, flow: 480, elevation: 2650, material: 'Galvanized Steel', insulation: 25, wall: 1.0 }
      return add(`${mark} 400 × 300`, (m) => ({ ...m, ducts: [...m.ducts, d] }), { kind: 'duct', id: d.id })
    }
    if (tool === 'pipe') {
      const service = st.pipeService as PipeService
      const dn = service === 'Sanitary Drain' ? 100 : service === 'Fire Sprinkler' ? 32 : 25
      const mark = nextMark(doc.pipes.map((x) => x.mark), SERVICE_PREFIX[service])
      const flow = Math.round(((Math.PI * (dn / 1000) ** 2) / 4) * 1.0 * 1000 * 100) / 100
      const p: Pipe = { ...base, id: uid(SERVICE_PREFIX[service]), mark, service, dn, flow, material: service === 'Sanitary Drain' ? 'PVC' : service.startsWith('Domestic') ? 'PPR' : 'Steel Sch 40', elevation: 2150 }
      return add(`${mark} DN${dn}`, (m) => ({ ...m, pipes: [...m.pipes, p] }), { kind: 'pipe', id: p.id })
    }
    const mark = nextMark(doc.trays.map((x) => x.mark), 'TR')
    const tr = { ...base, id: uid('tray'), mark, kind: 'Power' as const, w: 300, h: 100, elevation: 2400 }
    add(`${mark} 300 × 100`, (m) => ({ ...m, trays: [...m.trays, tr] }), { kind: 'tray', id: tr.id })
  }

  const click = (p: P2, raw: P2) => {
    switch (tool) {
      case 'select':
        return set({ sel: hit(raw), right: 'properties' })
      case 'duct':
      case 'pipe':
      case 'tray':
        if (pts.length) addRun(pts[pts.length - 1], p)
        return setPts([p])
      case 'fixture': {
        const kind = st.fixtureKind as FixtureKind
        const pre = CEILING_FIXTURES.has(kind) ? (kind === 'Sprinkler' ? 'SP' : 'L') : kind === 'Socket' ? 'SO' : 'PF'
        const mark = nextMark(doc.fixtures.map((f) => f.mark), pre)
        const f = { id: uid('fx'), mark, kind, level, x: p[0], y: p[1], elevation: fixtureElevation(kind) }
        return add(`${mark} ${T.mep.draw.kinds.fixture.toLowerCase()} (${kind})`, (m) => ({ ...m, fixtures: [...m.fixtures, f] }), { kind: 'fixture', id: f.id })
      }
      case 'terminal': {
        const mark = nextMark(doc.terminals.map((f) => f.mark), 'SD')
        const f = { id: uid('term'), mark, kind: 'Supply Diffuser' as const, level, x: p[0], y: p[1], size: 600, flow: 150, elevation: 2700 }
        return add(mark, (m) => ({ ...m, terminals: [...m.terminals, f] }), { kind: 'terminal', id: f.id })
      }
      case 'fitting': {
        const r = view && fittingAt(doc, level, raw, 12 * view.k)
        if (!r) return toast(t.noRun, 'warning')
        const mark = nextMark(doc.fittings.map((f) => f.mark), 'FT')
        const main = [...r.runs].sort((a, b) => ('w' in b ? b.w : b.dn) - ('w' in a ? a.w : a.dn))[0]
        const f: Fitting = { id: uid('fit'), mark, kind: r.kind, level, x: r.at[0], y: r.at[1], on: main.id, runs: r.runs.map((x) => x.id) }
        return add(`${mark} ${r.kind}`, (m) => ({ ...m, fittings: [...m.fittings, f] }), { kind: 'fitting', id: f.id })
      }
      case 'annotation':
        setNote('')
        return setNoteAt(p)
      case 'tag': {
        const target = hit(raw)
        if (!target || target.kind === 'annotation' || target.kind === 'section') return
        const a: MepAnnotation = { id: uid('tag'), kind: 'tag', level, a: [raw[0] + 600, raw[1] + 600], b: raw, target: target.id }
        return add(`${T.mep.tools.tag} ${labelOf(doc, target.id)}`, (m) => ({ ...m, annotations: [...m.annotations, a] }))
      }
      default: {
        if (!pts.length) return setPts([p])
        const a = pts[0]
        setPts([])
        if (dist(a, p) < 300) return toast(fmt(t.tooShort, { min: 300 }), 'warning')
        if (tool === 'dimension') {
          const d: MepAnnotation = { id: uid('dim'), kind: 'dimension', level, a, b: p }
          return add(`${T.mep.tools.dimension} ${Math.round(dist(a, p))} mm`, (m) => ({ ...m, annotations: [...m.annotations, d] }))
        }
        const mark = nextMark(doc.sections.map((x) => x.mark), 'S', 1)
        const sec = { id: uid('sec'), mark, level, a, b: p }
        add(mark, (m) => ({ ...m, sections: [...m.sections, sec] }), { kind: 'section', id: sec.id })
        set({ section: sec.id })
        toast(fmt(t.sectionOn, { mark }))
      }
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if (e.key === 'Escape') {
        if (pts.length) setPts([])
        else set({ tool: 'select' })
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && tool === 'select' && sel) {
        const label = deleteSel(useMep.getState().doc, sel)
        if (!label) return
        edit(`Delete ${label}`, (m) => removeElement(m, sel))
        set({ sel: null, section: useMep.getState().section === sel.id ? null : useMep.getState().section })
        toast(fmt(t.deleted, { what: label }))
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
        const sx = e.clientX - r.left, sy = e.clientY - r.top
        const wx = (sx - r.width / 2) * v.k + v.cx, wy = v.cy - (sy - r.height / 2) * v.k
        const k = Math.min(Math.max(v.k * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), 1), 400)
        return { k, cx: wx - (sx - r.width / 2) * k, cy: wy + (sy - r.height / 2) * k }
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
    const isSel = (id: string) => sel?.id === id
    const band = (r: RunLike, w: number): string => {
      const [a, b] = runEnds(r)
      const n: P2 = r.axis === 'x' ? [0, w / 2] : [w / 2, 0]
      return [[a[0] + n[0], a[1] + n[1]], [b[0] + n[0], b[1] + n[1]], [b[0] - n[0], b[1] - n[1]], [a[0] - n[0], a[1] - n[1]]].map((q) => S(q as P2).map((v) => v.toFixed(1)).join(',')).join(' ')
    }
    const label = (r: RunLike, text: string, key: string) => {
      const [a, b] = runEnds(r)
      if (px(r.length) < 90) return null
      const m = S([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])
      return <text key={key} x={m[0]} y={m[1] - 6} className={s.runLabel} transform={r.axis === 'y' ? `rotate(-90 ${m[0]} ${m[1]})` : undefined}>{text}</text>
    }
    if (!off.has('beams'))
      for (const b of on(doc.beams)) out.push(<polygon key={b.id} points={band(b, b.w)} className={s.beam} />)
    if (!off.has('ducts'))
      for (const d of on(doc.ducts)) {
        out.push(<polygon key={d.id} points={band(d, d.w)} className={`${s.duct} ${isSel(d.id) ? s.sel : ''}`} style={{ fill: runColor(d, colorBy, clashing) + '44', stroke: runColor(d, colorBy, clashing) }} />)
        out.push(label(d, `${d.mark} ${d.w}×${d.h}`, d.id + ':l'))
      }
    if (!off.has('trays'))
      for (const r of on(doc.trays)) {
        out.push(<polygon key={r.id} points={band(r, r.w)} className={`${s.tray} ${isSel(r.id) ? s.sel : ''}`} style={{ stroke: TRAY_RGB[r.kind] }} />)
        out.push(label(r, `${r.mark} ${r.w}×${r.h}`, r.id + ':l'))
      }
    if (!off.has('pipes'))
      for (const p of on(doc.pipes)) {
        if (ceiling && p.service !== 'Fire Sprinkler') continue
        const [a, b] = runEnds(p).map(S)
        out.push(<line key={p.id} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className={`${s.pipe} ${isSel(p.id) ? s.selLine : ''}`} style={{ stroke: runColor(p, colorBy, clashing), strokeWidth: Math.max(1.6, px(p.dn)) }} />)
        out.push(label(p, `${p.mark} DN${p.dn}`, p.id + ':l'))
      }
    if (!off.has('terminals'))
      for (const f of on(doc.terminals)) {
        const c = S([f.x, f.y]), h = px(f.size / 2)
        out.push(
          <g key={f.id} className={isSel(f.id) ? s.selG : ''}>
            <rect x={c[0] - h} y={c[1] - h} width={2 * h} height={2 * h} className={f.kind === 'Supply Diffuser' ? s.supply : s.ret} />
            <line x1={c[0] - h} y1={c[1] - h} x2={c[0] + h} y2={c[1] + h} className={s.thin} />
            <line x1={c[0] - h} y1={c[1] + h} x2={c[0] + h} y2={c[1] - h} className={s.thin} />
          </g>,
        )
      }
    if (!off.has('fixtures'))
      for (const f of on(doc.fixtures)) {
        if (ceiling && !CEILING_FIXTURES.has(f.kind)) continue
        out.push(<FixtureSymbol key={f.id} kind={f.kind} c={S([f.x, f.y])} px={px} sel={isSel(f.id)} />)
      }
    if (!off.has('fittings'))
      for (const f of on(doc.fittings)) {
        const c = S([f.x, f.y])
        out.push(<rect key={f.id} x={c[0] - 4} y={c[1] - 4} width={8} height={8} className={`${s.fitting} ${isSel(f.id) ? s.sel : ''}`} transform={f.kind === 'Tee' || f.kind === 'Cross' ? `rotate(45 ${c[0]} ${c[1]})` : undefined} />)
      }
    for (const x of on(doc.sections)) {
      const [a, b] = [S(x.a), S(x.b)]
      out.push(
        <g key={x.id} className={isSel(x.id) || st.section === x.id ? s.selG : ''}>
          <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className={s.section} />
          {[a, b].map((q, i) => (
            <g key={i}>
              <circle cx={q[0]} cy={q[1]} r={10} className={s.bubble} />
              <text x={q[0]} y={q[1] + 4} className={s.bubbleText}>{x.mark}</text>
            </g>
          ))}
        </g>,
      )
    }
    if (!off.has('annotations')) for (const a of on(doc.annotations)) out.push(<Note key={a.id} a={a} m={doc} S={S} sel={isSel(a.id)} />)

    const last = pts.at(-1)
    if (cursor && last) {
      const [a, b] = [S(last), S(cursor)]
      out.push(
        <g key="preview">
          <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className={s.preview} />
          <text x={(a[0] + b[0]) / 2} y={(a[1] + b[1]) / 2 - 8} className={s.previewText}>{Math.round(dist(last, cursor)).toLocaleString('en-US')} mm</text>
        </g>,
      )
    }
    if (cursor && tool !== 'select') {
      const q = S(cursor)
      out.push(<circle key="cur" cx={q[0]} cy={q[1]} r={3.5} className={s.cursor} />)
    }
  }

  const hint = (t.hint as Record<string, string>)[tool]
  return (
    <>
      <div
        ref={ref}
        className={`${s.plan} ${tool !== 'select' ? s.drawing : ''}`}
        data-testid="mep-plan"
        data-tool={tool}
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
          if (d && (tool === 'select' || e.buttons === 4 || e.buttons === 2) && Math.hypot(x - d.x, y - d.y) > 3) {
            d.moved = true
            setView({ ...d.v, cx: d.v.cx - (x - d.x) * d.v.k, cy: d.v.cy + (y - d.y) * d.v.k })
            return
          }
          setCursor(snap(W(x, y)))
        }}
        onPointerUp={(e) => {
          const d = drag.current
          drag.current = null
          if (!d || d.moved || e.button !== 0) return
          const [x, y] = local(e)
          const raw = W(x, y)
          click(snap(raw), raw)
        }}
        onDoubleClick={() => (tool === 'select' ? fit() : setPts([]))}
        onContextMenu={(e) => e.preventDefault()}
        onPointerLeave={() => setCursor(null)}
      >
        <svg width={size.w} height={size.h} className={s.svg}>
          {out}
        </svg>
        <div className={s.bar} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
          <strong>{fmt(ceiling ? t.ceiling : t.plan, { level: lvName })}</strong>
          <span>{hint}</span>
          {tool === 'pipe' && (
            <select aria-label={t.service} value={st.pipeService} onChange={(e) => set({ pipeService: e.target.value })}>
              {(Object.keys(SERVICE_PREFIX) as PipeService[]).map((k) => <option key={k} value={k}>{T.mep.services[k] ?? k}</option>)}
            </select>
          )}
          {tool === 'fixture' && (
            <select aria-label={t.fixtureKind} value={st.fixtureKind} onChange={(e) => set({ fixtureKind: e.target.value })}>
              {FIXTURE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          )}
          {colorBy === 'velocity' && <em>{t.legendVelocity}</em>}
          {tool !== 'select' && <button type="button" onClick={() => set({ tool: 'select' })}>{t.esc}</button>}
        </div>
      </div>
      {noteAt && (
        <Modal title={t.notePrompt} onClose={() => setNoteAt(null)} width={360}>
          <form
            className={s.form}
            onSubmit={(e) => {
              e.preventDefault()
              if (note.trim()) {
                const a: MepAnnotation = { id: uid('note'), kind: 'text', level, a: noteAt, text: note.trim() }
                add(`${T.mep.tools.annotation} “${note.trim()}”`, (m) => ({ ...m, annotations: [...m.annotations, a] }))
              }
              setNoteAt(null)
            }}
          >
            <input aria-label={t.notePrompt} autoFocus value={note} onChange={(e) => setNote(e.target.value)} />
            <button type="submit">{t.place}</button>
          </form>
        </Modal>
      )}
    </>
  )
}

/** Mark (+ size) shown by a tag. */
export function labelOf(m: MepModel, id: string): string {
  const d = m.ducts.find((x) => x.id === id)
  if (d) return `${d.mark} ${d.w}×${d.h}`
  const p = m.pipes.find((x) => x.id === id)
  if (p) return `${p.mark} DN${p.dn}`
  const t = m.trays.find((x) => x.id === id)
  if (t) return `${t.mark} ${t.w}×${t.h}`
  const all: { id: string; mark: string }[] = [...m.fixtures, ...m.terminals, ...m.fittings, ...m.sections]
  return all.find((x) => x.id === id)?.mark ?? '?'
}

const LIST: Record<string, keyof MepModel> = { duct: 'ducts', pipe: 'pipes', tray: 'trays', fixture: 'fixtures', terminal: 'terminals', fitting: 'fittings', annotation: 'annotations', section: 'sections' }

function deleteSel(m: MepModel, sel: NonNullable<MepSel>): string | null {
  const key = LIST[sel.kind]
  if (!key) return null
  const el = (m[key] as { id: string; mark?: string; kind?: string }[]).find((x) => x.id === sel.id)
  return el ? el.mark ?? el.kind ?? sel.kind : null
}

/** Removes an element; fittings on a removed run and tags of it go too. */
export function removeElement(m: MepModel, sel: NonNullable<MepSel>): MepModel {
  const key = LIST[sel.kind]
  const next = { ...m, [key]: (m[key] as { id: string }[]).filter((x) => x.id !== sel.id) } as MepModel
  next.fittings = next.fittings.filter((f) => f.on !== sel.id)
  next.annotations = next.annotations.filter((a) => a.target !== sel.id)
  return next
}

function FixtureSymbol({ kind, c, px, sel }: { kind: FixtureKind; c: P2; px: (mm: number) => number; sel: boolean }) {
  const col = FIXTURE_RGB[kind] ?? '#999'
  const cls = `${s.fixture} ${sel ? s.sel : ''}`
  const r = Math.max(5, px(150))
  switch (kind) {
    case 'Downlight':
      return (
        <g>
          <circle cx={c[0]} cy={c[1]} r={r} className={cls} style={{ fill: col }} />
          <line x1={c[0] - r} y1={c[1]} x2={c[0] + r} y2={c[1]} className={s.thin} />
          <line x1={c[0]} y1={c[1] - r} x2={c[0]} y2={c[1] + r} className={s.thin} />
        </g>
      )
    case 'Linear Light':
      return <rect x={c[0] - px(600)} y={c[1] - Math.max(3, px(60))} width={px(1200)} height={Math.max(6, px(120))} className={cls} style={{ fill: col }} />
    case 'Sprinkler':
      return <circle cx={c[0]} cy={c[1]} r={4} className={cls} style={{ fill: col }} />
    case 'Socket':
      return (
        <g>
          <circle cx={c[0]} cy={c[1]} r={6} className={cls} style={{ fill: '#fff' }} />
          <line x1={c[0] - 6} y1={c[1]} x2={c[0] + 6} y2={c[1]} className={s.thin} />
        </g>
      )
    case 'WC':
      return <ellipse cx={c[0]} cy={c[1]} rx={Math.max(5, px(190))} ry={Math.max(8, px(340))} className={cls} style={{ fill: col }} />
    case 'Basin':
      return <ellipse cx={c[0]} cy={c[1]} rx={Math.max(6, px(275))} ry={Math.max(5, px(225))} className={cls} style={{ fill: col }} />
    case 'Sink':
      return <rect x={c[0] - px(400)} y={c[1] - px(250)} width={px(800)} height={px(500)} rx={3} className={cls} style={{ fill: col }} />
    default:
      return <circle cx={c[0]} cy={c[1]} r={Math.max(4, px(75))} className={cls} style={{ fill: col }} />
  }
}

function Note({ a, m, S, sel }: { a: MepAnnotation; m: MepModel; S: (p: P2) => P2; sel: boolean }) {
  const p = S(a.a)
  if (a.kind === 'text') return <text x={p[0]} y={p[1]} className={`${s.note} ${sel ? s.selText : ''}`}>{a.text}</text>
  if (a.kind === 'tag') {
    const q = S(a.b ?? a.a)
    const text = a.target ? labelOf(m, a.target) : '?'
    return (
      <g className={sel ? s.selG : ''}>
        <line x1={q[0]} y1={q[1]} x2={p[0]} y2={p[1]} className={s.thin} />
        <rect x={p[0] - 6 - text.length * 3.3} y={p[1] - 10} width={12 + text.length * 6.6} height={18} rx={3} className={s.tagBox} />
        <text x={p[0]} y={p[1] + 3} className={s.tagText}>{text}</text>
      </g>
    )
  }
  const b = a.b ?? a.a
  const L = dist(a.a, b) || 1
  const nx = (-(b[1] - a.a[1]) / L) * 500, ny = ((b[0] - a.a[0]) / L) * 500
  const [A, B, A2, B2] = [S(a.a), S(b), S([a.a[0] + nx, a.a[1] + ny]), S([b[0] + nx, b[1] + ny])]
  const ang = (Math.atan2(B2[1] - A2[1], B2[0] - A2[0]) * 180) / Math.PI
  const up = ang > 90 || ang < -90 ? ang + 180 : ang
  const mid: P2 = [(A2[0] + B2[0]) / 2, (A2[1] + B2[1]) / 2]
  return (
    <g className={sel ? s.selG : ''}>
      <line x1={A[0]} y1={A[1]} x2={A2[0]} y2={A2[1]} className={s.dimExt} />
      <line x1={B[0]} y1={B[1]} x2={B2[0]} y2={B2[1]} className={s.dimExt} />
      <line x1={A2[0]} y1={A2[1]} x2={B2[0]} y2={B2[1]} className={s.dim} />
      <text x={mid[0]} y={mid[1] - 4} className={s.dimText} transform={`rotate(${up} ${mid[0]} ${mid[1]})`}>{Math.round(L).toLocaleString('en-US')}</text>
    </g>
  )
}

