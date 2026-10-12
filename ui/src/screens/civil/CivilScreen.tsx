import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, Calculator, CalendarDays, Camera, Expand, Focus, Hand, Home, Layers, MousePointer2, Move, Mountain, PanelTop, RefreshCcw, ScanSearch, Share, Spline,
  SquareDashedBottom, Trash2, TrendingDown, Type, Waves, ZoomIn, ZoomOut, Columns2, Maximize,
} from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { useRouter } from '../../state/router'
import { toast } from '../../state/toast'
import { useCivil, type CivilView } from '../../state/civil'
import { undoKeys } from '../../state/undoable'
import { AiSparkIcon, DimensionToolIcon, ExportToolIcon } from '../../components/icons'
import { Select, ToolStrip, WsButton, WsHeader, WsRibbon, csv, downloadFile, wsStyles as w } from '../../components/workspace/Workspace'
import { areasAt, earthwork, groundOf, hydraulics, interp, sta } from '../../civil/model'
import { CivilBrowser } from './CivilBrowser'
import { CivilBottom } from './CivilBottom'
import { CivilRight } from './CivilRight'
import { ProfileChart, RouteStrip, SectionChart, type ChartTool } from './CivilCharts'
import { RouteFromCadDialog } from './RouteFromCadDialog'
import { Civil3D, CrossingDialog } from './Civil3D'
import { Modal } from '../../components/ui/Modal'
import { ImportSurveyDialog, readSurveyFiles, type SurveyInput } from './ImportSurveyDialog'
import { SurveyPlan, type PlanControl } from './SurveyPlan'
import { removeSurvey } from './surveyActions'
import { contours } from '../../civil/tin'
import { tinOf } from '../../civil/surveyModel'
import { contoursDxf, landXml, pointsCsv } from '../../civil/surveyExport'
import s from './Civil.module.css'

/** Measures an element so the vector charts fill their card. */
function useSize<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  // callback ref: the observed box may mount later (Plan ↔ Profile/Section views)
  return [setEl, size] as const
}

/** Civil workspace — mockup 10 (canal design). */
export function CivilScreen() {
  const T = useT()
  const t = T.civil
  const navigate = useRouter((st) => st.navigate)
  const st = useCivil()
  const native = (what: string) => toast(fmt(t.toast.native, { what }))
  const [profRef, prof] = useSize<HTMLDivElement>()
  const [secRef, sec] = useSize<HTMLDivElement>()
  const [bigRef, big] = useSize<HTMLDivElement>()
  const [planRef, planBox] = useSize<HTMLDivElement>()
  const [routeOpen, setRouteOpen] = useState(false)
  const planCtl = useRef<PlanControl | null>(null)
  const [dropped, setDropped] = useState<SurveyInput | null>(null)
  const hasSurvey = !!st.doc.survey
  const sv = t.survey
  const exportSurvey = (kind: 'points' | 'contours' | 'landxml') => {
    const m = useCivil.getState().doc
    const tin = tinOf(m)
    if (!m.survey || !tin) return toast(sv.noSurvey)
    const base = `North Canal - ${t.exportItems[kind].replace(/ \((CSV|DXF|LandXML)\)$/, '')}`
    const [file, body, mime] =
      kind === 'points' ? [`${base}.csv`, pointsCsv(m.survey), 'text/csv']
      : kind === 'contours' ? [`${base}.dxf`, contoursDxf(contours(tin, useCivil.getState().contour)), 'application/dxf']
      : [`${base}.xml`, landXml(m.survey.name, tin, m.plan, m.alignment.name), 'application/xml']
    downloadFile(file, body, mime)
    toast(fmt(t.toast.exported, { file }), 'success')
  }
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files?.length ? await readSurveyFiles(e.dataTransfer.files) : null
    if (!f) return
    setDropped(f)
    st.set({ importOpen: true })
  }
  // ---- notes and dimensions on the profile / section charts
  const [pending, setPending] = useState<{ view: 'profile' | 'section'; a: [number, number] } | null>(null)
  const [noteAt, setNoteAt] = useState<{ view: 'profile' | 'section'; a: [number, number] } | null>(null)
  const [noteText, setNoteText] = useState('')
  const nt = t.notes
  const addNote = (n: { kind: 'text' | 'dimension'; view: 'profile' | 'section'; a: [number, number]; b?: [number, number]; text?: string }, label: string) => {
    const note = { id: `n${Date.now().toString(36)}`, station: n.view === 'section' ? st.station : undefined, ...n }
    const err = st.edit(label, (d) => ({ ...d, notes: [...(d.notes ?? []), note] }))
    if (err) toast(fmt(t.toast.invalid, { why: err }), 'warning')
    else toast(fmt(nt.added, { what: label }))
  }
  const chartTool = (view: 'profile' | 'section'): ChartTool => ({
    active: !!st.tool,
    pending: pending?.view === view ? pending.a : null,
    onPoint: (x, z) => {
      if (st.tool === 'annotation') return (setNoteText(''), setNoteAt({ view, a: [x, z] }))
      if (!pending || pending.view !== view) return setPending({ view, a: [x, z] })
      addNote({ kind: 'dimension', view, a: pending.a, b: [x, z] }, `${t.tools.dimension} ${view === 'profile' ? sta(pending.a[0]) + '–' + sta(x) : sta(st.station)}`)
      setPending(null)
    },
  })
  const toggleTool = (k: 'annotation' | 'dimension') => {
    setPending(null)
    const on = st.tool === k ? null : k
    st.set({ tool: on, ...(on && st.view !== 'plan' && st.view !== 'profile' && st.view !== 'section' ? { view: 'plan' } : {}) })
    if (on) toast(nt[on])
  }

  // a route read from a drawing has its own sections (stakes); otherwise every 20 m
  const stations = useMemo(() => (st.doc.sections?.length ? st.doc.sections.map((x) => x.station) : Array.from({ length: Math.floor((st.doc.alignment.end - st.doc.alignment.start) / 20) + 1 }, (_, i) => st.doc.alignment.start + i * 20)), [st.doc.alignment, st.doc.sections])

  useEffect(() => {
    const onKey = undoKeys(st.undo, st.redo, (label, redo) => toast(label ? fmt(redo ? t.toast.redone : t.toast.undone, { label }) : t.toast.nothing))
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [st.undo, st.redo, t])

  const exportCsv = (kind: 'earthwork' | 'profile' | 'section') => {
    const m = useCivil.getState().doc
    const H = hydraulics(m).H
    let rows: (string | number)[][]
    if (kind === 'earthwork') rows = [['From Station', 'To Station', 'Length (m)', 'Cut (m3)', 'Fill (m3)', 'Net (m3)'], ...earthwork(m).map((r) => [sta(r.from), sta(r.to), r.length.toFixed(3), r.cut.toFixed(2), r.fill.toFixed(2), r.net.toFixed(2)])]
    else if (kind === 'profile') rows = [['Station', 'Existing ground (m)', 'Design invert (m)', 'Top of bank (m)'], ...groundOf(m).map(([s0, z]) => [sta(s0), z.toFixed(3), interp(m.invert, s0).toFixed(3), (interp(m.invert, s0) + H).toFixed(3)])]
    else if (m.sections?.length) rows = [['Stake', 'Station', 'Cut area (m2)', 'Fill area (m2)', 'Drawn cut (m2)', 'Drawn fill (m2)'], ...m.sections.map((x) => [x.name, sta(x.station), x.cut.toFixed(3), x.fill.toFixed(3), x.drawn?.cut?.toFixed(2) ?? '', x.drawn?.fill?.toFixed(2) ?? ''])]
    else rows = [['Station', 'Ground (m)', 'Invert (m)', 'Cut area (m2)', 'Fill area (m2)'], ...stations.map((s0) => { const a = areasAt(m, s0, H); return [sta(s0), a.g.toFixed(3), a.inv.toFixed(3), a.cut.toFixed(3), a.fill.toFixed(3)] })]
    const file = `North Canal - ${t.exportItems[kind].replace(/ \(CSV\)$/, '')}.csv`
    downloadFile(file, csv(rows))
    toast(fmt(t.toast.exported, { file }), 'success')
  }

  const views = [
    { key: 'plan', label: t.views.plan, icon: <Box size={15} strokeWidth={1.7} />, width: 97 },
    { key: 'profile', label: t.views.profile, icon: <TrendingDown size={15} strokeWidth={1.6} />, width: 95 },
    { key: 'section', label: t.views.section, icon: <Spline size={15} strokeWidth={1.6} />, width: 95 },
    { key: '3d', label: t.views['3d'], icon: <PanelTop size={15} strokeWidth={1.6} />, width: 82 },
    { key: 'schedule', label: t.views.schedule, icon: <CalendarDays size={15} strokeWidth={1.6} />, width: 106 },
  ]
  const stationSel = (
    <Select label={T.civil.section.at} value={String(st.station)} onChange={(v) => st.set({ station: Number(v) })} options={stations.map((x) => ({ value: String(x), label: fmt(t.section.title, { sta: sta(x) }) }))} className={s.cardSel} />
  )
  // profile window: orbit = whole alignment, pan = centre on the current station (half the alignment when showing all), zoom = widen ×2
  const A = st.doc.alignment
  const win = st.profileRange ?? [A.start, A.end]
  const setWin = (c: number, half: number) => {
    const hh = Math.min(half, (A.end - A.start) / 2)
    const a = Math.max(A.start, Math.min(A.end - 2 * hh, c - hh))
    st.set({ profileRange: hh * 2 >= A.end - A.start - 1e-6 ? null : [a, a + 2 * hh] })
  }
  /** PNG of a chart card (SVG → canvas at 2×) or of the survey plan canvas. */
  const snapshot = async (sel: string, name: string) => {
    const el = document.querySelector(sel)
    if (!el) return
    let url: string
    if (el instanceof HTMLCanvasElement) url = el.toDataURL('image/png')
    else {
      const svg = el as SVGSVGElement
      const r = svg.getBoundingClientRect()
      const css = [...document.styleSheets].flatMap((ss) => { try { return [...ss.cssRules].map((c) => c.cssText) } catch { return [] } }).join('\n')
      const clone = svg.cloneNode(true) as SVGSVGElement
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      clone.insertAdjacentHTML('afterbegin', `<style>${css}</style><rect width="100%" height="100%" fill="#fff"/>`)
      const img = new Image()
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone))
      await img.decode()
      const c = document.createElement('canvas')
      c.width = r.width * 2
      c.height = r.height * 2
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      url = c.toDataURL('image/png')
    }
    const file = `North Canal - ${name}.png`
    const a = document.createElement('a')
    a.href = url
    a.download = file
    a.click()
    toast(fmt(t.toast.exported, { file }), 'success')
  }
  const removeNotes = (view: 'profile' | 'section') => {
    const left = (st.doc.notes ?? []).filter((n) => n.view !== view || (view === 'section' && n.station !== st.station))
    if (left.length === (st.doc.notes ?? []).length) return toast(t.toast.nothing)
    st.edit(nt.clear, (d) => ({ ...d, notes: left }))
    toast(nt.cleared)
  }
  const chartTools = (label: string) => [
    { label: t.plan.orbit, icon: <RefreshCcw size={15} strokeWidth={1.7} />, onClick: () => st.set({ profileRange: null }) },
    { label: t.plan.pan, icon: <Hand size={15} strokeWidth={1.7} />, onClick: () => setWin(st.station, (win[1] - win[0]) / (st.profileRange ? 2 : 4)) },
    { label: t.plan.zoom, icon: <ZoomOut size={15} strokeWidth={1.7} />, onClick: () => setWin((win[0] + win[1]) / 2, win[1] - win[0]) },
    { label: t.plan.fit, icon: <Expand size={14} strokeWidth={1.7} />, onClick: () => st.set({ view: label as CivilView, profileRange: null }) },
    { label: t.plan.remove, icon: <Trash2 size={14} strokeWidth={1.7} />, onClick: () => removeNotes(label === 'section' ? 'section' : 'profile') },
    { label: t.plan.snapshot, icon: <Camera size={14} strokeWidth={1.7} />, onClick: () => void snapshot(label === 'section' ? '[data-testid=section-chart]' : '[data-testid=profile-chart]', label === 'section' ? `Cross section ${sta(st.station)}` : 'Longitudinal profile') },
  ]

  return (
    <div className={`${s.screen} ${st.view !== 'plan' ? s.single : ''}`}>
      <div className={s.header}>
        <WsHeader
          homeLabel={T.nav.dashboard}
          onHome={() => navigate('dashboard')}
          crumbs={[{ label: t.crumbs.projects, onClick: () => navigate('projects') }, { label: t.crumbs.project, onClick: () => navigate('projects') }]}
          current={t.crumbs.discipline}
          currentMenu={[{ label: t.disciplines.civil, onSelect: () => undefined }, { label: t.disciplines.survey, onSelect: () => st.set({ importOpen: true }) }]}
          tabs={views}
          active={st.view}
          tabsStyle={{ left: 386 }}
          onTab={(k) => st.set({ view: k as CivilView })}
          actions={
            <>
              <WsButton icon={<Share size={15} strokeWidth={1.7} />} label={t.share} width={79} onClick={() => toast(t.toast.shareOffline)} />
              <WsButton icon={<ExportToolIcon size={19} strokeWidth={1.5} />} label={t.export} width={104} menu={[...(['earthwork', 'profile', 'section'] as const).map((k) => ({ label: t.exportItems[k], onSelect: () => exportCsv(k) })), ...(hasSurvey ? (['points', 'contours', 'landxml'] as const).map((k) => ({ label: t.exportItems[k], onSelect: () => exportSurvey(k) })) : [])]} />
              <WsButton primary icon={<AiSparkIcon size={19} strokeWidth={1.7} />} label={t.ai} width={128} onClick={() => st.set({ aiOpen: true })} />
            </>
          }
        />
      </div>

      <div className={s.ribbon}>
        <WsRibbon
          seps={[76, 157, 236, 333, 419, 497, 585, 663, 760, 862, 963, 1050]}
          tools={[
            { key: 'select', label: t.tools.select, Icon: MousePointer2, c: 41, w: 64, active: true, onClick: () => undefined, iconSize: 22 },
            { key: 'alignment', label: t.tools.alignment, Icon: Spline, c: 118, onClick: () => st.set({ view: 'plan' }) },
            { key: 'profile', label: t.tools.profile, Icon: TrendingDown, c: 197, onClick: () => st.set({ view: 'profile' }) },
            { key: 'cross', label: t.tools.crossSection, Icon: SquareDashedBottom, c: 284, w: 90, onClick: () => st.set({ view: 'section' }) },
            { key: 'channel', label: t.tools.channel, Icon: Waves, c: 377, onClick: () => st.set({ bottom: 'channel' }) },
            { key: 'culvert', label: t.tools.culvert, Icon: Columns2, c: 456, onClick: () => st.set({ bottom: 'structures' }) },
            { key: 'earthwork', label: t.tools.earthwork, Icon: Mountain, c: 536, w: 76, onClick: () => st.set({ bottom: 'earthwork' }) },
            { key: 'surface', label: t.tools.surface, Icon: Layers, c: 621, onClick: () => st.set({ right: 'layers' }) },
            { key: 'intersection', label: t.tools.intersection, Icon: Move, c: 710, w: 84, onClick: () => st.set({ crossingOpen: true }) },
            { key: 'annotation', label: t.tools.annotation, Icon: Type, c: 809, w: 80, active: st.tool === 'annotation', onClick: () => toggleTool('annotation') },
            { key: 'dimension', label: t.tools.dimension, Icon: DimensionToolIcon, c: 913, w: 80, active: st.tool === 'dimension', onClick: () => toggleTool('dimension') },
            { key: 'quantity', label: t.tools.quantity, Icon: Calculator, c: 1010, onClick: () => st.set({ view: 'schedule' }) },
          ]}
          more={{ c: 1112, label: t.tools.more, items: [
            { label: t.moreItems.importSurvey, onSelect: () => { setDropped(null); st.set({ importOpen: true }) } },
            { label: t.fromCad.menu, onSelect: () => setRouteOpen(true) },
            { label: t.moreItems.drawAlignment, onSelect: () => (hasSurvey ? st.set({ drawing: true, view: 'plan' }) : toast(sv.noSurvey)) },
            ...(hasSurvey ? [{ label: t.moreItems.removeSurvey, onSelect: () => removeSurvey(sv) }] : []),
            ...((st.doc.notes ?? []).length ? [{ label: nt.clear, onSelect: () => { st.edit(nt.clear, (d) => ({ ...d, notes: [] })); toast(nt.cleared) } }] : []),
            { label: t.moreItems.undo, onSelect: () => toast(st.undo() ? fmt(t.toast.undone, { label: '' }) : t.toast.nothing) },
            { label: t.moreItems.redo, onSelect: () => toast(st.redo() ? fmt(t.toast.redone, { label: '' }) : t.toast.nothing) },
            { label: t.moreItems.reset, onSelect: () => { st.reset(); toast(t.toast.reset) } },
          ] }}
        />
      </div>

      <div className={s.browser}>
        <CivilBrowser />
      </div>

      {st.view === 'plan' ? (
        <>
          <section className={`${w.card} ${s.plan}`} aria-label={t.plan.label}>
            <header className={s.cardHead}>
              <Select label={t.plan.title} value="plan" onChange={() => undefined} options={[{ value: 'plan', label: t.plan.title }]} className={s.cardSel} />
              <ToolStrip style={{ position: 'static', boxShadow: 'none', background: 'transparent' }} items={[
                { label: t.plan.orbit, icon: <RefreshCcw size={15} strokeWidth={1.7} />, onClick: () => (planCtl.current ? planCtl.current.home() : native(t.plan.orbit)) },
                { label: t.plan.pan, icon: <Hand size={15} strokeWidth={1.7} />, onClick: () => (planCtl.current ? toast(T.view3d.pan) : native(t.plan.pan)) },
                { label: t.plan.zoom, icon: <ZoomOut size={15} strokeWidth={1.7} />, onClick: () => (planCtl.current ? planCtl.current.zoom(1 / 1.4) : native(t.plan.zoom)) },
                { label: t.plan.fit, icon: <Expand size={14} strokeWidth={1.7} />, onClick: () => (planCtl.current ? planCtl.current.home() : native(t.plan.fit)) },
                { label: t.plan.snapshot, icon: <ScanSearch size={15} strokeWidth={1.7} />, onClick: () => (hasSurvey ? void snapshot('[aria-label="' + t.plan.label + '"] canvas', 'Plan') : native(t.plan.snapshot)) },
                { label: t.plan.remove, icon: <Trash2 size={15} strokeWidth={1.7} />, onClick: () => (hasSurvey ? removeSurvey(sv) : native(t.plan.remove)) },
                { label: t.plan.isolate, icon: <Focus size={15} strokeWidth={1.7} />, on: !st.layers.surfaces, onClick: () => st.set({ layers: { ...st.layers, surfaces: !st.layers.surfaces, ground: !st.layers.ground } }) },
              ]} />
            </header>
            <div ref={planRef} className={s.planImg} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
              {hasSurvey ? <SurveyPlan ctl={planCtl} /> : st.doc.sections?.length ? (planBox.w > 0 && <RouteStrip m={st.doc} w={planBox.w} h={planBox.h} station={st.station} onStation={(x) => st.set({ station: x })} />) : <img src="/assets/v2/civil/plan.png" alt="CANAL-01 plan (DEMO imagery)" draggable={false} style={{ opacity: st.layers.surfaces ? 1 : 0.35 }} />}
              <ToolStrip vertical style={{ right: 5, top: 70 }} items={[
                { label: t.plan.home, icon: <Home size={16} strokeWidth={1.6} />, onClick: () => (planCtl.current ? planCtl.current.home() : native(t.plan.home)) },
                { label: t.plan.zoomIn, icon: <ZoomIn size={16} strokeWidth={1.6} />, onClick: () => (planCtl.current ? planCtl.current.zoom(1.4) : native(t.plan.zoomIn)) },
                { label: t.plan.zoomOut, icon: <ZoomOut size={16} strokeWidth={1.6} />, onClick: () => (planCtl.current ? planCtl.current.zoom(1 / 1.4) : native(t.plan.zoomOut)) },
                { label: t.plan.zoomRegion, icon: <ScanSearch size={16} strokeWidth={1.6} />, onClick: () => (planCtl.current ? planCtl.current.zoom(2) : native(t.plan.zoomRegion)) },
                { label: t.plan.full, icon: <Maximize size={15} strokeWidth={1.6} />, onClick: () => (planCtl.current ? planCtl.current.home() : st.set({ view: 'profile' })) },
              ]} />
              {!hasSurvey && !st.doc.sections?.length && <span className={w.demoBadge} style={{ left: 160, bottom: 8 }}>{t.plan.demo}</span>}
            </div>
          </section>
          <section className={`${w.card} ${s.profile}`} aria-label={t.profile.title}>
            <header className={s.cardHead}>
              <Select label={t.profile.title} value="p" onChange={() => undefined} options={[{ value: 'p', label: t.profile.title }]} className={s.cardSel} />
              <ToolStrip style={{ position: 'static', boxShadow: 'none', background: 'transparent' }} items={chartTools('profile')} />
            </header>
            <div ref={profRef} className={s.chartBox}>
              {prof.w > 0 && <ProfileChart m={st.doc} w={prof.w} h={prof.h} station={st.station} onStation={(x) => st.set({ station: x })} tool={chartTool('profile')} range={st.profileRange} />}
            </div>
          </section>
          <section className={`${w.card} ${s.section}`} aria-label={fmt(t.section.title, { sta: sta(st.station) })}>
            <header className={s.cardHead}>
              {stationSel}
              <ToolStrip style={{ position: 'static', boxShadow: 'none', background: 'transparent' }} items={chartTools('section').slice(3)} />
            </header>
            <div ref={secRef} className={s.chartBox}>
              {sec.w > 0 && <SectionChart m={st.doc} w={sec.w} h={sec.h} station={st.station} tool={chartTool('section')} />}
            </div>
          </section>
          <div className={s.bottom}>
            <CivilBottom />
          </div>
        </>
      ) : (
        <section className={`${w.card} ${s.big}`} aria-label={t.views[st.view]}>
          {st.view === 'schedule' ? (
            <CivilBottom full />
          ) : st.view === '3d' ? (
            <Civil3D />
          ) : (
            <>
              <header className={s.cardHead}>
                {st.view === 'section' ? stationSel : <Select label={t.profile.title} value="p" onChange={() => undefined} options={[{ value: 'p', label: t.profile.title }]} className={s.cardSel} />}
              </header>
              <div ref={bigRef} className={s.chartBox}>
                {big.w > 0 && (st.view === 'profile' ? <ProfileChart m={st.doc} w={big.w} h={big.h} station={st.station} onStation={(x) => st.set({ station: x })} tool={chartTool('profile')} range={st.profileRange} /> : <SectionChart m={st.doc} w={big.w} h={big.h} station={st.station} tool={chartTool('section')} />)}
              </div>
            </>
          )}
        </section>
      )}

      <div className={s.right}>
        <CivilRight />
      </div>
      {st.crossingOpen && <CrossingDialog onClose={() => st.set({ crossingOpen: false })} />}
      {noteAt && (
        <Modal title={nt.prompt} onClose={() => setNoteAt(null)} width={380}>
          <form
            className={s.form}
            onSubmit={(e) => {
              e.preventDefault()
              if (noteText.trim()) addNote({ kind: 'text', view: noteAt.view, a: noteAt.a, text: noteText.trim() }, `${t.tools.annotation} “${noteText.trim()}”`)
              setNoteAt(null)
            }}
          >
            <input aria-label={nt.prompt} autoFocus value={noteText} onChange={(e) => setNoteText(e.target.value)} />
            <button type="submit" className={s.formBtn}>{nt.place}</button>
          </form>
        </Modal>
      )}
      {st.importOpen && <ImportSurveyDialog initial={dropped} onClose={() => { setDropped(null); st.set({ importOpen: false }) }} />}
      {routeOpen && <RouteFromCadDialog onClose={() => setRouteOpen(false)} />}
    </div>
  )
}
