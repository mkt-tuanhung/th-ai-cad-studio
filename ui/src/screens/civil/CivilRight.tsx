import { useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronRight, Lightbulb, Minus, Pencil, X } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { toast } from '../../state/toast'
import { useCivil, type CivilAiTab, type CivilRight as Tab } from '../../state/civil'
import { NumField, PRow, PSelect, PanelTabs, Section, wsStyles as w } from '../../components/workspace/Workspace'
import { checks, hydraulics, narrowerOption, sta, type DesignParams } from '../../civil/model'
import { tinOf } from '../../civil/surveyModel'
import { removeSurvey, setMaxEdge } from './surveyActions'
import { AiAssistModal } from '../../components/ai/AiAssist'
import { civilAi } from '../../ai/disciplines/civil'
import s from './Civil.module.css'

/** Station with millimetres, e.g. 0+619.992. */
const sta3 = (v: number) => `${Math.floor(v / 1000)}+${(v % 1000).toFixed(3).padStart(7, '0')}`

export function CivilRight() {
  const t = useT().civil
  const { right, set } = useCivil()
  const tabs: { key: Tab; label: string }[] = [
    { key: 'properties', label: t.right.properties },
    { key: 'layers', label: t.right.layers },
    { key: 'references', label: t.right.references },
  ]
  return (
    <section className={`${w.card} ${s.rcard}`} aria-label={t.right[right]}>
      <PanelTabs tabs={tabs} active={right} onTab={(k) => set({ right: k })} widths={[98, 102, 98]} />
      <div className={`${w.pbody} ${s.rbody}`}>
        {right === 'properties' && <Props />}
        {right === 'layers' && <Layers />}
        {right === 'references' && <Refs />}
        <AiCard />
        {right === 'properties' && <Hydraulics />}
      </div>
    </section>
  )
}

function Props() {
  const t = useT().civil
  const p = t.props
  const { doc, edit } = useCivil()
  const a = doc.alignment
  const up = (label: string, patch: Partial<DesignParams>) => {
    const err = edit(`${p.design}: ${label}`, (m) => ({ ...m, params: { ...m.params, ...patch } }))
    if (err) toast(fmt(t.toast.invalid, { why: err }), 'warning')
  }
  const P = doc.params
  return (
    <>
      <Section title={p.alignment}>
        <PRow label={p.name}><span>{a.name}</span></PRow>
        <PRow label={p.type}><span>{t.names[a.type] ?? a.type}</span></PRow>
        <PRow label={p.description}><span>{t.names[a.description] ?? a.description}</span><Pencil size={11} className={s.pencil} /></PRow>
        <PRow label={p.start}><span>{sta3(a.start)}</span></PRow>
        <PRow label={p.end}><span>{sta3(a.end)}</span></PRow>
        <PRow label={p.length}><span>{(a.end - a.start).toFixed(3)} m</span></PRow>
        <PRow label={p.speed}><span>-</span></PRow>
        <PRow label={p.site}><span>{t.names[a.site] ?? a.site}</span><Pencil size={11} className={s.pencil} /></PRow>
      </Section>
      <Section title={p.design}>
        <PRow label={p.slopeMin}><NumField label={p.slopeMin} value={P.slopeMin} min={0.00001} max={0.05} onCommit={(v) => up(p.slopeMin, { slopeMin: v })} /></PRow>
        <PRow label={p.slopeMax}><NumField label={p.slopeMax} value={P.slopeMax} min={0.00001} max={0.05} onCommit={(v) => up(p.slopeMax, { slopeMax: v })} /></PRow>
        <PRow label={p.bottom}><NumField label={p.bottom} value={P.bottomWidth} min={0.5} max={50} onCommit={(v) => up(p.bottom, { bottomWidth: v })} unit="m" /></PRow>
        <PRow label={p.side}><NumField label={p.side} value={P.sideSlope} min={0} max={5} onCommit={(v) => up(p.side, { sideSlope: v })} unit=": 1" /></PRow>
        <PRow label={p.lining}><PSelect label={p.lining} value={P.lining} onChange={(v) => up(p.lining, { lining: v })} options={['Concrete (M250)', 'Concrete (M200)', 'Concrete (M300)'].map((x) => ({ value: x, label: t.names[x] ?? x }))} /></PRow>
        <PRow label={p.freeboard}><NumField label={p.freeboard} value={P.freeboard} min={0.1} max={3} onCommit={(v) => up(p.freeboard, { freeboard: v })} unit="m" /></PRow>
      </Section>
    </>
  )
}

function Hydraulics() {
  const t = useT().civil
  const p = t.props
  const { doc, edit } = useCivil()
  const h = hydraulics(doc)
  const up = (label: string, patch: Partial<DesignParams>) => {
    const err = edit(`${p.hydraulics}: ${label}`, (m) => ({ ...m, params: { ...m.params, ...patch } }))
    if (err) toast(fmt(t.toast.invalid, { why: err }), 'warning')
  }
  return (
    <Section title={p.hydraulics}>
      <PRow label={p.q}><NumField label={p.q} value={doc.params.discharge} min={0.01} max={500} onCommit={(v) => up(p.q, { discharge: v })} unit="m³/s" /></PRow>
      <PRow label={p.n}><NumField label={p.n} value={doc.params.manningN} min={0.009} max={0.05} onCommit={(v) => up(p.n, { manningN: v })} /></PRow>
      <PRow label={p.s}><span>{h.S.toFixed(4)}</span></PRow>
      {/* no flow to compute (level bottom from a drawing): no normal depth, velocity or Froude number */}
      <PRow label={p.y}><span>{h.ok ? `${h.y.toFixed(2)} m` : '—'}</span></PRow>
      <PRow label={p.v}><span>{h.ok ? `${h.v.toFixed(2)} m/s` : '—'}</span></PRow>
      <PRow label={p.fr}><span>{h.ok ? h.fr.toFixed(2) : '—'}</span></PRow>
      {!h.ok && <p style={{ margin: '4px 10px', fontSize: 11, color: '#8a4b00' }} data-testid="civil-noflow">{t.fromCad.noFlow}</p>}
      <PRow label={p.depth}><span>{h.H.toFixed(2)} m</span></PRow>
      <PRow label={p.top}><span>{h.top.toFixed(2)} m</span></PRow>
    </Section>
  )
}

function Layers() {
  const t = useT().civil
  const { layers, set } = useCivil()
  return (
    <>
      <Section title={t.right.layers}>
        {(Object.keys(t.layers) as (keyof typeof t.layers)[]).map((k) => (
          <PRow key={k} label={t.layers[k]}>
            <input type="checkbox" aria-label={t.layers[k]} checked={layers[k] !== false} onChange={() => set({ layers: { ...layers, [k]: !(layers[k] !== false) } })} />
          </PRow>
        ))}
      </Section>
      <SurveyPanel />
    </>
  )
}

/** Imported survey surface: source, statistics, contour interval, edge limit, remove / re-import. */
function SurveyPanel() {
  const t = useT().civil.survey
  const { doc, contour, set } = useCivil()
  const tin = tinOf(doc)
  const n2 = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return (
    <Section title={t.panel}>
      {doc.survey && tin ? (
        <div data-testid="survey-panel">
          <PRow label={t.source}>{doc.survey.name}</PRow>
          <PRow label={t.crs}>{doc.survey.crs}</PRow>
          <PRow label={t.points}>{tin.x.length.toLocaleString('en-US')}</PRow>
          <PRow label={t.triangles}>{(tin.tri.length / 3).toLocaleString('en-US')}</PRow>
          <PRow label={t.area}>{n2(tin.area / 10000)} ha</PRow>
          <PRow label={t.zRange}>{tin.zmin.toFixed(2)} … {tin.zmax.toFixed(2)} m</PRow>
          <PRow label={t.egSource}>{doc.ground ? t.fromSurvey : t.fromSample}</PRow>
          <PRow label={t.contour}>
            <PSelect label={t.contour} value={String(contour)} onChange={(v) => set({ contour: Number(v) })} options={['0.1', '0.25', '0.5', '1', '2', '5'].map((v) => ({ value: v, label: `${v} m` }))} />
          </PRow>
          {!doc.survey.faces && (
            <PRow label={t.maxEdge}>
              <NumField label={t.maxEdge} value={Math.round((tin.maxEdge ?? 0) * 100) / 100} min={0.5} max={10000} unit="m" onCommit={(v) => setMaxEdge(v)} />
            </PRow>
          )}
          <p className={s.refs}>
            <button type="button" className={w.link} onClick={() => set({ importOpen: true })}>{t.reimport}</button>
            {' · '}
            <button type="button" className={w.link} onClick={() => removeSurvey(t)}>{t.remove}</button>
          </p>
        </div>
      ) : (
        <p className={s.refs}>
          {t.noSurvey}{' '}
          <button type="button" className={w.link} onClick={() => set({ importOpen: true })}>{t.choose}</button>
        </p>
      )}
    </Section>
  )
}

function Refs() {
  const t = useT().civil
  const { doc } = useCivil()
  return (
    <Section title={t.right.references}>
      <p className={s.refs}>{doc.survey ? `${t.survey.egSource}: ${doc.survey.name} (${doc.survey.format.toUpperCase()}, ${doc.survey.crs})` : t.refs.survey}</p>
      <p className={s.refs}>{t.refs.imagery}</p>
      <p className={s.refs}>{t.refs.standard}</p>
    </Section>
  )
}

function AiCard() {
  const T = useT()
  const t = T.civil
  const a = t.aiPanel
  const { doc, aiTab, aiOpen, set, edit } = useCivil()
  const [ask, setAsk] = useState(false)
  if (!aiOpen) return null
  const k = checks(doc)
  const opt = narrowerOption(doc)
  const flow = k.h.ok
  const bad = [!k.velocityOk && 'velocity', !k.froudeOk && 'Froude', !k.freeboardOk && 'freeboard', k.steep.length && 'slope max'].filter(Boolean).join(', ')
  const pct = Math.round(opt.saving * 100)
  const items = [
    {
      tab: 'analysis' as CivilAiTab,
      tone: k.flat.length ? 'err' : 'ok',
      title: a.slopeTitle,
      lines: k.flat.length
        ? [fmt(a.slopeText, { n: k.flat.length, min: doc.params.slopeMin }), `(${k.flat.map((g) => `Sta ${sta(g.from)} - ${sta(g.to)}`).join(', ')})`]
        : [fmt(a.slopeOk, { min: doc.params.slopeMin, max: doc.params.slopeMax })],
      onClick: () => set({ view: 'profile' }),
    },
    {
      tab: 'check' as CivilAiTab,
      tone: !flow || bad ? 'warn' : 'ok',
      title: a.complianceTitle,
      lines: [!flow ? t.fromCad.noFlow : bad ? fmt(a.complianceBad, { what: bad }) : fmt(a.complianceOk, { v: k.h.v.toFixed(2), fr: k.h.fr.toFixed(2), fb: doc.params.freeboard.toFixed(2) })],
      onClick: () => set({ view: 'section' }),
    },
    {
      tab: 'optimize' as CivilAiTab,
      tone: 'tip',
      title: a.optTitle,
      lines: [fmt(a.optText, { b: opt.b.toFixed(1), p: pct, y: opt.alt.y.toFixed(2), v: opt.alt.v.toFixed(2) })],
      onClick: () => {
        const err = edit(`${t.props.bottom} → ${opt.b} m`, (m) => ({ ...m, params: { ...m.params, bottomWidth: opt.b } }))
        toast(err ? fmt(t.toast.invalid, { why: err }) : fmt(t.toast.applied, { label: `${t.props.bottom} ${opt.b} m` }), err ? 'warning' : 'success')
      },
    },
  ]
  // a route from a drawing has fixed drawn sections: a narrower bottom would not change its earthwork
  const shown = doc.sections ? items.filter((it) => it.tab !== 'optimize') : items
  return (
    <section className={s.ai} aria-label={a.title}>
      <header>
        <span className={s.aiSpark}>✦</span>
        <b>{a.title}</b>
        <button type="button" aria-label={a.collapse} onClick={() => set({ aiOpen: false })}><Minus size={14} /></button>
        <button type="button" aria-label={a.close} onClick={() => set({ aiOpen: false })}><X size={14} /></button>
      </header>
      <div className={s.aiTabs} role="tablist">
        {(['analysis', 'check', 'optimize'] as CivilAiTab[]).map((k2) => (
          <button key={k2} type="button" role="tab" aria-selected={aiTab === k2} className={aiTab === k2 ? s.aiTabOn : undefined} onClick={() => set({ aiTab: k2 })}>{a.tabs[k2]}</button>
        ))}
      </div>
      {shown.map((it) => (
        <button key={it.title} type="button" className={`${s.aiItem} ${s[`t_${it.tone}`]} ${it.tab === aiTab ? s.aiItemOn : ''}`} onClick={it.onClick} title={it.tab === 'optimize' ? a.apply : undefined}>
          <span className={s.aiIcon}>{it.tone === 'err' || it.tone === 'warn' ? <AlertTriangle size={17} /> : it.tone === 'ok' ? <CheckCircle2 size={18} /> : <Lightbulb size={17} />}</span>
          <span className={s.aiText}>
            <b>{it.title}</b>
            {it.lines.map((l) => <small key={l}>{l}</small>)}
          </span>
          <ChevronRight size={15} />
        </button>
      ))}
      <p className={s.aiNote}>{a.note}</p>
      <button type="button" className={w.link} style={{ margin: '4px 10px 8px', alignSelf: 'flex-start' }} onClick={() => setAsk(true)} data-testid="civil-ai-ask">{T.aiAssist.open}</button>
      {ask && <AiAssistModal d={civilAi} model={doc} apply={(label, next) => edit(label, () => next)} example={T.aiAssist.examples.civil} onClose={() => setAsk(false)} />}
    </section>
  )
}
