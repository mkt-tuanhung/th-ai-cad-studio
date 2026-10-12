import { Ellipsis, Lightbulb, Pencil } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { toast } from '../../state/toast'
import { useMep, type MepRight as Tab } from '../../state/mep'
import { NumField, PRow, PanelTabs, Section, wsStyles as w } from '../../components/workspace/Workspace'
import { LEVELS, clearElevation, designChecks, type Clash, type Duct, type Finding, type LevelId } from '../../mep/model'
import { cableCheck, ductLoss, pipeCheck } from '../../mep/calc'
import { AiAssist } from '../../components/ai/AiAssist'
import { mepAi } from '../../ai/disciplines/mep'
import s from './Mep.module.css'

export function MepRight({ clashes }: { clashes: Clash[] }) {
  const t = useT().mep
  const { right, set } = useMep()
  const tabs: { key: Tab; label: string }[] = [
    { key: 'properties', label: t.right.properties },
    { key: 'system', label: t.right.system },
    { key: 'ai', label: t.right.ai },
  ]
  return (
    <section className={`${w.card} ${s.right}`} aria-label={t.right[right]}>
      <PanelTabs tabs={tabs} active={right} onTab={(k) => set({ right: k })} widths={[76, 128, 76]} />
      <div className={`${w.pbody} ${s.rbody}`}>
        {right === 'properties' && <Props />}
        {right === 'system' && <SystemData />}
        {right === 'ai' && <AiList clashes={clashes} />}
        {right !== 'ai' && <AiCard clashes={clashes} />}
      </div>
    </section>
  )
}

const lvName = (t: ReturnType<typeof useT>['mep'], id: LevelId) => fmt(t.viewer.levelName, { n: id.slice(1) })

function Props() {
  const t = useT().mep
  const p = t.props
  const { doc, sel, edit } = useMep()
  const report = (err: string | null) => err && toast(fmt(t.toast.invalid, { why: err }), 'warning')
  if (!sel) return <p className={w.none}>{p.noSel}</p>
  if (sel.kind === 'duct') {
    const d = doc.ducts.find((x) => x.id === sel.id)
    if (!d) return <p className={w.none}>{p.noSel}</p>
    const up = (label: string, patch: Partial<Duct>) => report(edit(`${d.mark}: ${label}`, (m) => ({ ...m, ducts: m.ducts.map((x) => (x.id === d.id ? { ...x, ...patch } : x)) })))
    const r = ductLoss(d.w, d.h, d.flow)
    const sys = d.type.split(' ')[0]
    return (
      <>
        <div className={w.elem}>
          <img className={w.elemThumb} src="/assets/v2/mep/duct-thumb.png" alt="" />
          <div className={w.elemText}>
            <strong>{p.rectDuct}</strong>
            <span>Generic - {sys} Air Duct</span>
          </div>
          <Ellipsis size={18} strokeWidth={2} className={s.dots} />
        </div>
        <Section title={p.identity}>
          <PRow label={p.family}><span>{p.rectDuct}</span></PRow>
          <PRow label={p.type}><span>{sys} Air - {d.material}</span></PRow>
          <PRow label={p.typeMark}><span>{d.mark}</span><Pencil size={11} className={s.pencil} /></PRow>
          <PRow label={p.system}><span>HVAC - {sys} Air</span></PRow>
          <PRow label={p.description}><span>{sys === 'Supply' ? p.supplyDesc : t.ductTypes[d.type] ?? d.type}</span></PRow>
        </Section>
        <Section title={p.dims}>
          <PRow label={p.width}><NumField label={p.width} value={d.w} min={100} max={2500} onCommit={(v) => up(p.width, { w: v })} unit="mm" /></PRow>
          <PRow label={p.height}><NumField label={p.height} value={d.h} min={100} max={1500} onCommit={(v) => up(p.height, { h: v })} unit="mm" /></PRow>
          <PRow label={p.length}><NumField label={p.length} value={d.length} min={1} onCommit={(v) => up(p.length, { length: v })} unit="mm" /></PRow>
          <PRow label={p.wall}><span>{d.wall.toFixed(1)} mm</span></PRow>
          <PRow label={p.insulation}><span>{d.insulation.toFixed(1)} mm</span></PRow>
          <PRow label={p.size}><span>{d.w} × {d.h} mm</span></PRow>
        </Section>
        <Section title={p.flow}>
          <PRow label={p.flowRate}><NumField label={p.flowRate} value={d.flow} min={1} max={20000} onCommit={(v) => up(p.flowRate, { flow: v })} unit="L/s" /></PRow>
          <PRow label={p.velocity}><span>{r.v.toFixed(2)} m/s</span></PRow>
          <PRow label={p.pressureDrop}><span>{r.paPerM.toFixed(2)} Pa/m</span></PRow>
          <PRow label={p.de}><span>{Math.round(r.de * 1000)} mm</span></PRow>
          <PRow label={p.elevation}><NumField label={p.elevation} value={d.elevation} min={1800} max={3600} onCommit={(v) => up(p.elevation, { elevation: v })} unit="mm" /></PRow>
          <PRow label={p.material}><span>{d.material}</span></PRow>
        </Section>
      </>
    )
  }
  if (sel.kind === 'pipe') {
    const x = doc.pipes.find((y) => y.id === sel.id)
    if (!x) return null
    const r = pipeCheck(x.dn, x.flow)
    return (
      <>
        <div className={w.elem}><div className={w.elemText}><strong>{p.pipe} {x.mark}</strong><span>{t.services[x.service] ?? x.service}</span></div></div>
        <Section title={p.identity}>
          <PRow label={p.service}><span>{t.services[x.service] ?? x.service}</span></PRow>
          <PRow label={p.dn}><span>DN{x.dn}</span></PRow>
          <PRow label={p.material}><span>{x.material}</span></PRow>
          <PRow label={p.level}><span>{lvName(t, x.level)}</span></PRow>
        </Section>
        <Section title={p.flow}>
          <PRow label={p.flowRate}><span>{x.flow.toFixed(2)} L/s</span></PRow>
          <PRow label={p.velocity}><span>{r.v.toFixed(2)} m/s</span></PRow>
          <PRow label={p.pressureDrop}><span>{r.paPerM.toFixed(0)} Pa/m</span></PRow>
          <PRow label={p.elevation}><span>{x.elevation} mm</span></PRow>
        </Section>
      </>
    )
  }
  if (sel.kind === 'circuit') {
    const x = doc.circuits.find((y) => y.id === sel.id)
    if (!x) return null
    const r = cableCheck(x.kw, x.phases, x.cable, x.length)
    return (
      <>
        <div className={w.elem}><div className={w.elemText}><strong>{p.circuit} {x.mark}</strong><span>{x.load} · {x.panel}</span></div></div>
        <Section title={p.electrical}>
          <PRow label={p.load}><span>{x.load}</span></PRow>
          <PRow label={p.kw}><span>{x.kw} kW</span></PRow>
          <PRow label={p.phases}><span>{x.phases}</span></PRow>
          <PRow label={p.cable}><span>{x.cable} mm² Cu</span></PRow>
          <PRow label={p.breaker}><span>{x.breaker} A</span></PRow>
          <PRow label={p.length}><span>{x.length} m</span></PRow>
          <PRow label={p.current}><span>{r.i.toFixed(1)} A</span></PRow>
          <PRow label={p.iz}><span>{r.iz} A</span></PRow>
          <PRow label={p.vd}><span>{r.vdPct.toFixed(2)} %</span></PRow>
        </Section>
      </>
    )
  }
  const e = doc.equipment.find((y) => y.id === sel.id)
  if (!e) return null
  return (
    <>
      <div className={w.elem}><div className={w.elemText}><strong>{e.mark}</strong><span>{t.browser.equip[e.kind]}</span></div></div>
      <Section title={p.identity}>
        <PRow label={p.kind}><span>{t.browser.equip[e.kind]}</span></PRow>
        <PRow label={p.system}><span>{t.systems[e.system]}</span></PRow>
        <PRow label={p.capacity}><span>{e.capacity}</span></PRow>
        <PRow label={p.level}><span>{lvName(t, e.level)}</span></PRow>
      </Section>
    </>
  )
}

function SystemData() {
  const t = useT().mep
  const d = t.sysData
  const { doc } = useMep()
  const supply = doc.ducts.filter((x) => x.type === 'Supply Air Duct')
  const chw = doc.pipes.filter((x) => x.service === 'Chilled Water Supply')
  return (
    <>
      <Section title={d.title}>
        <PRow label={d.airflow}><span>{supply.reduce((a, x) => a + x.flow, 0).toLocaleString('en-US')} L/s</span></PRow>
        <PRow label={d.ductLen}><span>{(doc.ducts.reduce((a, x) => a + x.length, 0) / 1000).toFixed(1)} m</span></PRow>
        <PRow label={d.pipeLen}><span>{(doc.pipes.reduce((a, x) => a + x.length, 0) / 1000).toFixed(1)} m</span></PRow>
        <PRow label={d.waterFlow}><span>{chw.reduce((a, x) => a + x.flow, 0).toFixed(2)} L/s</span></PRow>
        <PRow label={d.load}><span>{doc.circuits.reduce((a, x) => a + x.kw, 0).toFixed(1)} kW</span></PRow>
        <PRow label={d.circuits}><span>{doc.circuits.length}</span></PRow>
        <PRow label={d.equipment}><span>{doc.equipment.length}</span></PRow>
      </Section>
      <Section title={d.byLevel}>
        {LEVELS.map((l) => (
          <PRow key={l.id} label={lvName(t, l.id)}>
            <span>{doc.ducts.filter((x) => x.level === l.id).length} ducts · {doc.pipes.filter((x) => x.level === l.id).length} pipes · {doc.circuits.filter((x) => x.level === l.id).reduce((a, x) => a + x.kw, 0).toFixed(1)} kW</span>
          </PRow>
        ))}
      </Section>
    </>
  )
}

/** Open issues: clashes first (with an automatic "lower below the beam" fix), then design checks. */
function useIssues(clashes: Clash[]) {
  const t = useT().mep
  const { doc, edit } = useMep()
  const findings = designChecks(doc)
  type Issue = { id: string; text: string; apply?: () => void }
  const issues: Issue[] = [
    ...clashes.filter((c) => c.kind === 'duct-beam').map((c) => ({
      id: c.id,
      text: fmt(t.aiCard.clashText, { a: c.a, b: c.b, level: lvName(t, c.level), depth: c.depth }),
      apply: () => {
        const d = doc.ducts.find((x) => x.mark === c.a && x.level === c.level)!
        const e = clearElevation(doc, d.id)
        if (e === null) return toast(fmt(t.toast.invalid, { why: t.fixes.noRoom }), 'warning')
        const err = edit(`${d.mark}: ${t.fixes.lower}`, (m) => ({ ...m, ducts: m.ducts.map((x) => (x.id === d.id ? { ...x, elevation: e } : x)) }))
        toast(err ? fmt(t.toast.invalid, { why: err }) : fmt(t.toast.applied, { label: `${d.mark} → ${e} mm` }), err ? 'warning' : 'success')
      },
    })),
    ...findings.map((f: Finding) => ({ id: f.id, text: fmt(t.aiCard.findingText, { target: f.target.id, rule: t.rules[f.rule], value: f.value.toFixed(2), limit: f.limit }) })),
  ]
  return issues
}

function AiCard({ clashes }: { clashes: Clash[] }) {
  const t = useT().mep
  const set = useMep((st) => st.set)
  const issues = useIssues(clashes)
  const first = issues.find((i) => i.apply)
  return (
    <section className={s.aiCard}>
      <header>
        <span className={s.bulb}><Lightbulb size={15} strokeWidth={1.8} /></span>
        <b>{t.aiCard.title}</b>
        <span className={w.count}>{issues.length}</span>
      </header>
      <p>{first ? first.text : issues[0]?.text ?? t.aiCard.none}</p>
      <div className={w.aiBtns}>
        <button type="button" className={w.solid} disabled={!first} onClick={() => first?.apply?.()}>{t.aiCard.apply}</button>
        <button type="button" className={w.ghost} onClick={() => set({ right: 'ai' })}>{t.aiCard.details}</button>
      </div>
    </section>
  )
}

function AiList({ clashes }: { clashes: Clash[] }) {
  const T = useT()
  const t = T.mep
  const issues = useIssues(clashes)
  const { doc, edit } = useMep()
  return (
    <>
      <AiAssist d={mepAi} model={doc} apply={(label, next) => edit(label, () => next)} example={T.aiAssist.examples.mep} compact />
      <p className={s.calcNote}>{t.aiCard.note}</p>
      <ul className={s.issues}>
        {issues.map((i) => (
          <li key={i.id}>
            <span>{i.text}</span>
            {i.apply && <button type="button" className={w.link} onClick={i.apply}>{t.fixes.lower}</button>}
          </li>
        ))}
        {issues.length === 0 && <li>{t.aiCard.none}</li>}
      </ul>
    </>
  )
}
