import { useEffect, useMemo, useRef, useState } from 'react'
import { fmt, useT } from '../../i18n'
import { ActionButton } from '../../components/ui/Button'
import { solveScale, fmtK, type CalRef } from '../../cad/calibration'
import { fabricationAllowed } from '../../cad/provenance'
import type { CadDocument } from '../../cad/types'
import type { AutoResult } from '../../auto/pipeline'
import { buildNames } from '../bim/fromCadActions'
import { CalibrationPicker, CalibrationRefs } from '../ai/CalibrationPicker'
import { analyse, correct, findCorners, isPdf, loadPicture, pagesOf, recognizeAt, srcOf, type Loaded, type Picture } from '../../planimage/pipeline'
import type { Mask } from '../../planimage/raster'
import type { PlanGraph, PWord, Pt } from '../../planimage/recognize'
import { addWall, remove, renameRoom, setOpening, setWallThickness, type Sel } from '../../planimage/edit'
import { doorRef, suggestScale } from '../../planimage/scale'
import { toRecognition, planRecord } from '../../planimage/toModel'
import { autoFromPlan } from '../../planimage/build'
import s from './PlanImage.module.css'

export interface PlanBuilt {
  res: AutoResult & { furnished: string[] }
  /** the CAD 2D record of the recognised plan (provenance: calibrated or REVIEW REQUIRED) */
  doc: CadDocument
  gate: { file: string; ok: boolean }
  calibrated: boolean
}

type View = { x: number; y: number; w: number; h: number }
const SCALES = [20, 50, 75, 100, 150, 200]
const DPIS = [72, 100, 150, 200, 300]
const COL = { wall: '#2563eb', ext: '#6d28d9', curtain: '#06b6d4', door: '#16a34a', window: '#0ea5e9', opening: '#f97316', column: '#dc2626', room: '#0f766e', low: '#f59e0b', sel: '#e11d48' }

/**
 * Plan picture → reviewed plan (v2.4 "Ảnh mặt bằng → nội thất 3D"), inside the one-command dialog: page choice,
 * photo correction (corners the user can drag), recognition, scale (suggested, confirmed by the user), the
 * recognised elements over the picture with their confidence and the fixes (delete, add a wall by two clicks,
 * opening type / width, room name, undo). "Approve and build" makes the BIM + Interior result for the dialog's own
 * review — nothing is applied here.
 */
export function PlanImageReview({ file, page0, onCancel, onBuilt }: { file: File; page0?: number | null; onCancel: () => void; onBuilt: (b: PlanBuilt) => void }) {
  const T = useT()
  const t = T.planImage
  const pdf = isPdf(file)
  const [pages, setPages] = useState<number | null>(null)
  const [page, setPage] = useState<number | null>(page0 ?? null)
  const [dpi, setDpi] = useState(150)
  const [scaleDen, setScaleDen] = useState(100)
  const [pic, setPic] = useState<(Loaded & { src: string }) | null>(null)
  const [corners, setCorners] = useState<Pt[] | null>(null)
  const [moved, setMoved] = useState(false)
  const [opt, setOpt] = useState({ photo: false, paper: true, deskew: true, clean: true, ocr: true })
  const [cor, setCor] = useState<{ p: Picture & { skew: number }; src: string } | null>(null)
  const [an, setAn] = useState<{ ink: Mask; dark?: Mask; words: PWord[] } | null>(null)
  const [g, setG] = useState<PlanGraph | null>(null)
  const hist = useRef<PlanGraph[]>([])
  const [histN, setHistN] = useState(0)
  const [refs, setRefs] = useState<CalRef[]>([])
  const [sel, setSel] = useState<Sel>(null)
  const [tool, setTool] = useState<'select' | 'addWall'>('select')
  const [pend, setPend] = useState<Pt | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View | null>(null)
  const svg = useRef<SVGSVGElement>(null)

  // pages, then the picture of the chosen page
  useEffect(() => {
    let live = true
    pagesOf(file).then((n) => { if (!live) return; setPages(n); if (n === 1) setPage(1) }, (e) => live && setError(fmt(t.failed, { why: (e as Error).message })))
    return () => { live = false }
  }, [file]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!page) return
    let live = true
    setBusy(t.loading)
    setPic(null); setG(null); setCor(null)
    loadPicture(file, page, dpi).then((p) => {
      if (!live) return
      const c = findCorners(p)
      setPic({ ...p, src: srcOf(p, 'image/jpeg', 0.85) })
      setCorners(c); setMoved(false)
      setOpt((o) => ({ ...o, photo: !!c }))
      setBusy(null)
    }, (e) => { if (live) { setBusy(null); setError(fmt(t.failed, { why: (e as Error).message })) } })
    return () => { live = false }
  }, [file, page, dpi]) // eslint-disable-line react-hooks/exhaustive-deps

  // nominal placement: a PDF page rendered at `dpi`; a picture taken as `dpi` (what the user selects) × the drawing scale
  const nominalK = (25.4 / dpi) * scaleDen
  const fit = solveScale(refs)
  const k = fit ? fit.k : nominalK
  const sug = useMemo(() => (g ? suggestScale(g) : null), [g])
  const door = useMemo(() => (g ? doorRef(g) : null), [g])

  const fitView = (gg: PlanGraph) => {
    const m = 0.08 * Math.max(gg.box.x1 - gg.box.x0, gg.box.y1 - gg.box.y0)
    setView({ x: gg.box.x0 - m, y: gg.box.y0 - m, w: gg.box.x1 - gg.box.x0 + 2 * m, h: gg.box.y1 - gg.box.y0 + 2 * m })
  }
  const recognise = async () => {
    if (!pic) return
    setError(null)
    setBusy(t.steps.clean)
    await new Promise((r) => setTimeout(r, 20))
    try {
      const c = correct(pic, { corners: opt.photo ? corners : null, paper: opt.paper, deskew: opt.deskew })
      const r = await analyse(c, { pxPerM: 1000 / nominalK, ocr: opt.ocr, photo: opt.photo, prep: { normalize: opt.clean, denoise: opt.clean }, onStep: (st, pct) => setBusy(`${t.steps[st] ?? st}${pct !== undefined ? ` ${pct}%` : ''}…`) })
      setCor({ p: c, src: srcOf(c, 'image/jpeg', 0.9) })
      setAn({ ink: r.ink, dark: r.dark, words: r.words })
      if (r.scaleText && SCALES.includes(r.scaleText)) setScaleDen(r.scaleText)
      hist.current = []
      setHistN(0)
      setRefs([]); setSel(null); setPend(null); setTool('select')
      setG(r)
      fitView(r)
      ;(window as unknown as { __planImageGraph?: unknown }).__planImageGraph = r
    } catch (e) {
      setError(fmt(t.failed, { why: (e as Error).message }))
    } finally {
      setBusy(null)
    }
  }
  /** Recognition again at the calibrated scale (the size limits of doors, walls… follow it); fixes are redone. */
  const reRecognise = () => {
    if (!an || !fit || !g) return
    hist.current.push(g)
    setHistN(hist.current.length)
    const r = recognizeAt(an.ink, an.dark, an.words, 1000 / fit.k)
    setG({ ...r, words: an.words }); setSel(null)
  }
  const edit = (next: PlanGraph) => { if (!g || next === g) return; hist.current.push(g); if (hist.current.length > 40) hist.current.shift(); setHistN(hist.current.length); setG(next) }
  const undo = () => { const p = hist.current.pop(); setHistN(hist.current.length); if (p) { setG(p); setSel(null) } }

  const approve = () => {
    if (!g || !cor) return
    setBusy(t.building)
    setTimeout(() => {
      try {
        const levelName = fmt(T.bim.fromCad.levelDefault, { n: 1 })
        const rec = toRecognition({ graph: g, k, levelName })
        const res = autoFromPlan(rec, { names: buildNames(T.bim.fromCad), levelName, file: file.name })
        const doc = planRecord({ graph: g, file: file.name, page: pdf ? page : null, kind: pdf ? 'pdf' : 'image', nominal: { dpi, scale: scaleDen, mmPerPx: nominalK }, refs, picture: { src: cor.src, w: cor.p.w, h: cor.p.h } })
        onBuilt({ res, doc, gate: { file: doc.name, ok: fabricationAllowed(doc).ok }, calibrated: !!fit })
      } catch (e) {
        setError(fmt(t.failed, { why: (e as Error).message }))
      } finally {
        setBusy(null)
      }
    }, 20)
  }

  /* ---------------- picture coordinates, pan, zoom */
  const toPic = (e: { clientX: number; clientY: number }): Pt | null => {
    const el = svg.current
    const m = el?.getScreenCTM()
    if (!el || !m) return null
    const p = el.createSVGPoint()
    p.x = e.clientX; p.y = e.clientY
    const q = p.matrixTransform(m.inverse())
    return [q.x, q.y]
  }
  const drag = useRef<{ x: number; y: number; v: View; moved: boolean; handle?: number } | null>(null)
  const onDown = (e: React.PointerEvent<SVGSVGElement>, handle?: number) => {
    const v = view ?? (pic ? { x: 0, y: 0, w: pic.w, h: pic.h } : null)
    if (!v) return
    drag.current = { x: e.clientX, y: e.clientY, v, moved: false, handle }
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d) return
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 3) d.moved = true
    if (d.handle !== undefined && corners) {
      const p = toPic(e)
      if (p) { setCorners(corners.map((c, i) => (i === d.handle ? p : c))); setMoved(true) }
      return
    }
    if (!d.moved || !g) return
    const r = svg.current!.getBoundingClientRect()
    const f = Math.max(d.v.w / r.width, d.v.h / r.height)
    setView({ ...d.v, x: d.v.x - (e.clientX - d.x) * f, y: d.v.y - (e.clientY - d.y) * f })
  }
  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    drag.current = null
    if (!d || d.moved || d.handle !== undefined || !g) return
    // a click on the background
    if (tool === 'addWall') {
      const p = toPic(e)
      if (!p) return
      if (!pend) setPend(p)
      else { edit(addWall(g, pend, p)); setPend(null) }
    } else setSel(null)
  }
  const zoom = (f: number) => {
    if (!view) return
    const cx = view.x + view.w / 2, cy = view.y + view.h / 2
    setView({ x: cx - (view.w * f) / 2, y: cy - (view.h * f) / 2, w: view.w * f, h: view.h * f })
  }
  const pick = (type: NonNullable<Sel>['type'], id: string) => (e: React.PointerEvent) => {
    if (tool !== 'select') return
    e.stopPropagation()
    setSel({ type, id })
  }

  /* ---------------- the selection's panel */
  const mm = (px: number) => Math.round(px * k)
  const selPanel = (() => {
    if (!g || !sel) return <div className={s.muted}>{t.selectHint}</div>
    if (sel.type === 'wall') {
      const w = g.walls.find((x) => x.id === sel.id)
      if (!w) return null
      return (
        <div className={s.card} data-testid="pi-sel">
          <b>{w.curtain ? t.legend.curtain : w.ext ? t.legend.ext : t.legend.wall}</b>
          <span>{fmt(t.conf, { p: Math.round(w.conf * 100) })} · {fmt(t.why, { why: w.by })}</span>
          <span>{(Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) * k / 1000).toFixed(2)} m</span>
          <label>{t.thickness} <input type="number" defaultValue={mm(w.t)} key={w.id + w.t} data-testid="pi-wall-t" onBlur={(e) => { const v = Number(e.target.value); if (v > 0 && Math.abs(v - mm(w.t)) > 0.5) edit(setWallThickness(g, w.id, v / k)) }} /></label>
        </div>
      )
    }
    if (sel.type === 'opening') {
      const o = g.openings.find((x) => x.id === sel.id)
      if (!o) return null
      return (
        <div className={s.card} data-testid="pi-sel">
          <b>{t.kinds[o.kind]}{o.mark ? ` ${o.mark}` : ''}</b>
          <span>{fmt(t.conf, { p: Math.round(o.conf * 100) })} · {fmt(t.why, { why: o.why.join(', ') })}</span>
          <label>{t.kind} <select value={o.kind} data-testid="pi-op-kind" onChange={(e) => edit(setOpening(g, o.id, { kind: e.target.value as typeof o.kind }))}>
            {(['door', 'window', 'opening'] as const).map((x) => <option key={x} value={x}>{t.kinds[x]}</option>)}
          </select></label>
          <label>{t.width} <input type="number" key={o.id + o.s1} defaultValue={mm(o.s1 - o.s0)} data-testid="pi-op-width" onBlur={(e) => { const v = Number(e.target.value); if (v > 0 && Math.abs(v - mm(o.s1 - o.s0)) > 0.5) edit(setOpening(g, o.id, { width: v / k })) }} /></label>
        </div>
      )
    }
    if (sel.type === 'column') {
      const c = g.columns.find((x) => x.id === sel.id)
      if (!c) return null
      return <div className={s.card} data-testid="pi-sel"><b>{t.legend.column}</b><span>{fmt(t.conf, { p: Math.round(c.conf * 100) })}</span><span>{mm(c.w)} × {mm(c.d)} mm</span></div>
    }
    const r = g.rooms.find((x) => x.id === sel.id)
    if (!r) return null
    return (
      <div className={s.card} data-testid="pi-sel">
        <b>{t.legend.room}</b>
        <span>{fmt(t.conf, { p: Math.round(r.conf * 100) })} · {fmt(t.area, { a: (r.areaPx * k * k / 1e6).toFixed(2) })}{r.areaLabel ? ` · ${fmt(t.areaWritten, { a: r.areaLabel })}` : ''}</span>
        <label>{t.roomName} <input key={r.id + (r.name ?? '')} defaultValue={r.name ?? ''} data-testid="pi-room-name" onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} onBlur={(e) => { if (e.target.value.trim() !== (r.name ?? '')) edit(renameRoom(g, r.id, e.target.value)) }} /></label>
      </div>
    )
  })()

  const len = g ? g.walls.reduce((a, w) => a + Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), 0) * k / 1000 : 0
  const low = g ? g.walls.filter((w) => w.conf < 0.6).length + g.openings.filter((o) => o.conf < 0.6).length + g.rooms.filter((r) => !r.skip && r.conf < 0.6).length : 0
  const needPage = pdf && pages !== null && pages > 1 && !page
  const vb = view ?? (pic ? { x: 0, y: 0, w: pic.w, h: pic.h } : { x: 0, y: 0, w: 1, h: 1 })
  const sw = Math.max(1, vb.w / 500)

  return (
    <div className={s.wrap} data-testid="pi-review">
      <p className={s.muted} style={{ margin: 0 }}>{t.intro}</p>
      {error && <p className={s.warn} role="alert" data-testid="pi-error">{error}</p>}
      <div className={s.row}>
        {pdf && pages !== null && pages > 1 && (
          <label>{t.page} <select aria-label={t.page} data-testid="pi-page" value={page ?? 0} onChange={(e) => setPage(Number(e.target.value))}>
            {!page && <option value={0} disabled>{t.pageChoose}</option>}
            {Array.from({ length: pages }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
          </select></label>
        )}
        <label>{t.dpi} <select aria-label={t.dpi} value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>{DPIS.map((d) => <option key={d}>{d}</option>)}</select></label>
        <label>{t.drawingScale} <select aria-label={t.drawingScale} value={scaleDen} onChange={(e) => setScaleDen(Number(e.target.value))}>{SCALES.map((d) => <option key={d} value={d}>1:{d}</option>)}</select></label>
        <label><input type="checkbox" checked={opt.photo} disabled={!corners} data-testid="pi-photo" onChange={(e) => setOpt({ ...opt, photo: e.target.checked })} /> {t.photo}</label>
        <label><input type="checkbox" checked={opt.paper} disabled={!opt.photo} onChange={(e) => setOpt({ ...opt, paper: e.target.checked })} /> {t.paper}</label>
        <label><input type="checkbox" checked={opt.deskew} onChange={(e) => setOpt({ ...opt, deskew: e.target.checked })} /> {t.deskew}</label>
        <label><input type="checkbox" checked={opt.clean} onChange={(e) => setOpt({ ...opt, clean: e.target.checked })} /> {t.clean}</label>
        <label><input type="checkbox" checked={opt.ocr} onChange={(e) => setOpt({ ...opt, ocr: e.target.checked })} /> {t.ocr}</label>
        <ActionButton disabled={!pic || !!busy} onClick={() => void recognise()} data-testid="pi-analyse">{g ? t.reanalyse : t.analyse}</ActionButton>
      </div>
      {needPage && <p className={s.warn} role="alert" data-testid="pi-page-required">{fmt(t.pageRequired, { n: pages! })}</p>}
      {busy && <p className={s.status} role="status" data-testid="pi-busy">{busy}</p>}
      {pic && !g && (
        <>
          <p className={s.muted} style={{ margin: 0 }}>{corners ? fmt(t.photoHint, { how: moved ? t.cornersManual : t.cornersAuto }) : t.noCorners}</p>
          <div className={s.view}>
            <svg ref={svg} viewBox={`0 0 ${pic.w} ${pic.h}`} preserveAspectRatio="xMidYMid meet" onPointerMove={onMove} onPointerUp={onUp} data-testid="pi-corners">
              <image href={pic.src} x={0} y={0} width={pic.w} height={pic.h} />
              {corners && opt.photo && (
                <>
                  <polygon points={corners.map((c) => c.join(',')).join(' ')} fill="rgba(225,29,72,0.08)" stroke={COL.sel} strokeWidth={pic.w / 300} />
                  {corners.map((c, i) => <circle key={i} cx={c[0]} cy={c[1]} r={pic.w / 70} className={s.handle} strokeWidth={pic.w / 400} data-testid={`pi-corner-${i}`} onPointerDown={(e) => { e.stopPropagation(); onDown(e as unknown as React.PointerEvent<SVGSVGElement>, i) }} />)}
                </>
              )}
            </svg>
          </div>
        </>
      )}
      {g && cor && (
        <>
          <p className={s.status} data-testid="pi-found" role="status">
            {fmt(t.found, { walls: g.walls.length, len: len.toFixed(1), doors: g.openings.filter((o) => o.kind === 'door').length, windows: g.openings.filter((o) => o.kind === 'window').length + g.walls.filter((w) => w.curtain).length, openings: g.openings.filter((o) => o.kind === 'opening').length, columns: g.columns.length, rooms: g.rooms.filter((r) => !r.skip).length, named: g.rooms.filter((r) => !r.skip && r.name).length })}
            {cor.p.skew ? ` · ${fmt(t.skew, { deg: cor.p.skew.toFixed(2) })}` : ''}
          </p>
          {!g.walls.length && <p className={s.warn} role="alert">{t.noWalls}</p>}
          {g.notes.length > 0 && <p className={s.muted} style={{ margin: 0 }}>{g.notes.map((n) => { const [c, v] = n.split(':'); return fmt(t.wallWarn[c] ?? n, { n: v ?? '' }) }).join(' ')}</p>}
          {low > 0 && <p className={s.warn} data-testid="pi-low">{fmt(t.lowConf, { n: low })}</p>}
          <div className={s.split}>
            <div className={s.view}>
              <svg ref={svg} className={tool === 'addWall' ? s.adding : undefined} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet" data-testid="pi-svg" data-w={cor.p.w} data-h={cor.p.h}
                onPointerDown={(e) => onDown(e)} onPointerMove={onMove} onPointerUp={onUp}
                onWheel={(e) => { const p = toPic(e); if (!p || !view) return; const f = e.deltaY > 0 ? 1.15 : 1 / 1.15; setView({ x: p[0] - (p[0] - view.x) * f, y: p[1] - (p[1] - view.y) * f, w: view.w * f, h: view.h * f }) }}>
                <image href={cor.src} x={0} y={0} width={cor.p.w} height={cor.p.h} opacity={0.7} />
                {g.rooms.map((r) => (
                  <g key={r.id} onPointerDown={pick('room', r.id)} data-testid="pi-room" data-id={r.id}>
                    <polygon points={r.outline.map((p) => p.join(',')).join(' ')} fill={r.skip ? 'rgba(100,100,100,0.18)' : r.conf < 0.6 ? 'rgba(245,158,11,0.16)' : 'rgba(15,118,110,0.10)'} stroke={sel?.id === r.id ? COL.sel : COL.room} strokeWidth={sw} strokeDasharray={r.skip ? `${4 * sw}` : undefined} />
                    <text x={r.seed[0]} y={r.seed[1]} fontSize={14 * sw} textAnchor="middle" fill="#0b3b3c" stroke="#fff" strokeWidth={3 * sw} paintOrder="stroke" style={{ pointerEvents: 'none' }}>{r.name ?? t.unnamed}</text>
                    <text x={r.seed[0]} y={r.seed[1] + 15 * sw} fontSize={11 * sw} textAnchor="middle" fill="#0b3b3c" stroke="#fff" strokeWidth={3 * sw} paintOrder="stroke" style={{ pointerEvents: 'none' }}>{(r.areaPx * k * k / 1e6).toFixed(1)} m²</text>
                  </g>
                ))}
                {g.walls.map((w) => {
                  const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L * w.t / 2, ny = dx / L * w.t / 2
                  const c = sel?.id === w.id ? COL.sel : w.conf < 0.6 ? COL.low : w.curtain ? COL.curtain : w.ext ? COL.ext : COL.wall
                  return <polygon key={w.id} data-testid="pi-wall" data-id={w.id} onPointerDown={pick('wall', w.id)} points={[[w.a[0] + nx, w.a[1] + ny], [w.b[0] + nx, w.b[1] + ny], [w.b[0] - nx, w.b[1] - ny], [w.a[0] - nx, w.a[1] - ny]].map((p) => p.join(',')).join(' ')} fill={c} fillOpacity={0.55} stroke={c} strokeWidth={sw} />
                })}
                {g.openings.map((o) => {
                  const w = g.walls.find((x) => x.id === o.wall)
                  if (!w) return null
                  const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy * (w.t / 2 + 2 * sw), ny = ux * (w.t / 2 + 2 * sw)
                  const A = [w.a[0] + ux * o.s0, w.a[1] + uy * o.s0], B = [w.a[0] + ux * o.s1, w.a[1] + uy * o.s1]
                  const c = sel?.id === o.id ? COL.sel : o.conf < 0.6 ? COL.low : COL[o.kind]
                  return <polygon key={o.id} data-testid="pi-opening" data-kind={o.kind} data-id={o.id} onPointerDown={pick('opening', o.id)} points={[[A[0] + nx, A[1] + ny], [B[0] + nx, B[1] + ny], [B[0] - nx, B[1] - ny], [A[0] - nx, A[1] - ny]].map((p) => p.join(',')).join(' ')} fill="#fff" stroke={c} strokeWidth={2 * sw} />
                })}
                {g.columns.map((c) => <rect key={c.id} data-testid="pi-column" onPointerDown={pick('column', c.id)} x={c.x - c.w / 2} y={c.y - c.d / 2} width={c.w} height={c.d} fill={sel?.id === c.id ? COL.sel : COL.column} />)}
                {pend && <circle cx={pend[0]} cy={pend[1]} r={4 * sw} fill={COL.sel} />}
              </svg>
            </div>
            <div className={s.side}>
              <div className={s.tools}>
                <button type="button" aria-pressed={tool === 'select'} onClick={() => { setTool('select'); setPend(null) }}>{t.tools.select}</button>
                <button type="button" aria-pressed={tool === 'addWall'} data-testid="pi-tool-addwall" onClick={() => { setTool('addWall'); setSel(null); setPend(null) }}>{t.tools.addWall}</button>
                <button type="button" disabled={!sel} data-testid="pi-delete" onClick={() => { edit(remove(g, sel)); setSel(null) }}>{t.tools.delete}</button>
                <button type="button" disabled={!histN} data-testid="pi-undo" onClick={undo}>{t.tools.undo}</button>
              </div>
              <div className={s.tools}>
                <button type="button" aria-label={`${t.zoom} +`} onClick={() => zoom(1 / 1.3)}>+</button>
                <button type="button" aria-label={`${t.zoom} −`} onClick={() => zoom(1.3)}>−</button>
                <button type="button" onClick={() => fitView(g)}>{t.zoom}</button>
              </div>
              {tool === 'addWall' && <div className={s.muted}>{t.addWallHint}</div>}
              {selPanel}
              <div className={s.legend}>
                {(['wall', 'ext', 'curtain', 'door', 'window', 'opening', 'column', 'room'] as const).map((x) => <span key={x}><i style={{ background: COL[x] }} />{t.legend[x]}</span>)}
                <span><i style={{ background: COL.low }} />&lt; 60 %</span>
              </div>
            </div>
          </div>
          <details className={s.cal} open data-testid="pi-cal">
            <summary>{t.scaleTitle}</summary>
            <p className={fit ? s.ok : s.warn} data-testid="pi-cal-status">{fit ? fmt(t.calibrated, { k: fmtK(fit.k), n: refs.length }) : `${t.uncalibrated} ${fmt(t.nominal, { dpi, scale: scaleDen, k: fmtK(nominalK) })}`}</p>
            <div className={s.row}>
              {sug?.k ? (
                <>
                  <span data-testid="pi-suggest">{fmt(t.scaleSuggest, { k: fmtK(sug.k), n: sug.agreeing.length })}</span>
                  <ActionButton data-testid="pi-use-suggest" onClick={() => setRefs((r) => [...r, ...sug.agreeing.filter((x) => !r.some((y) => y.id === x.id))])}>{t.scaleUse}</ActionButton>
                </>
              ) : <span className={s.muted}>{t.scaleNone}</span>}
              {door && <ActionButton data-testid="pi-door-ref" onClick={() => setRefs((r) => (r.some((y) => y.id === door.id) ? r : [...r, door]))}>{fmt(t.scaleDoor, { w: door.refDistance })}</ActionButton>}
              {fit && Math.abs(1000 / fit.k / g.pxPerM - 1) > 0.05 && <ActionButton data-testid="pi-rerecognise" onClick={reRecognise}>{t.reanalyse}</ActionButton>}
            </div>
            <CalibrationPicker src={cor.src} w={cor.p.w} h={cor.p.h} refs={refs} onAdd={(r) => setRefs((x) => [...x, r])} />
            <CalibrationRefs refs={refs} onRemove={(id) => setRefs((x) => x.filter((r) => r.id !== id))} candidates={sug?.refs ?? []} onUse={(c) => setRefs((x) => [...x, ...c.filter((y) => !x.some((z) => z.id === y.id))])} unit={T.importCal.cal.unitPx} perUnitLabel={(kk) => fmt(T.importCal.cal.calibrated, { k: fmtK(kk), n: refs.length })} />
          </details>
        </>
      )}
      <div className={s.row} style={{ justifyContent: 'flex-end' }}>
        <span className={s.muted} style={{ flex: 1 }}>{g ? t.approveHint : ''}</span>
        <ActionButton onClick={onCancel}>{t.back}</ActionButton>
        <ActionButton variant="primary" disabled={!g || !g.walls.length || !!busy} onClick={approve} data-testid="pi-approve">{t.approve}</ActionButton>
      </div>
    </div>
  )
}
