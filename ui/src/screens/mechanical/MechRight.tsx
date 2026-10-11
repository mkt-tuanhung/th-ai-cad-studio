import { Ellipsis, Pencil } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { toast } from '../../state/toast'
import { useMech, type MechRight as Tab } from '../../state/mech'
import { PRow, PSelect, PanelTabs, Section, wsStyles as w } from '../../components/workspace/Workspace'
import { MATERIALS, massOf, type Component } from '../../mech/model'
import s from './Mechanical.module.css'

export function MechRight() {
  const t = useT().mechanical
  const { right, set } = useMech()
  const tabs: { key: Tab; label: string }[] = [
    { key: 'properties', label: t.right.properties },
    { key: 'configurations', label: t.right.configurations },
    { key: 'display', label: t.right.display },
  ]
  return (
    <section className={`${w.card} ${s.rcard}`} aria-label={t.right[right]}>
      <PanelTabs tabs={tabs} active={right} onTab={(k) => set({ right: k })} widths={[86, 120, 82]} />
      <div className={`${w.pbody} ${s.rbody}`}>
        {right === 'properties' && <Props />}
        {right === 'configurations' && <Configs />}
        {right === 'display' && <Display />}
      </div>
    </section>
  )
}

function Props() {
  const t = useT().mechanical
  const p = t.props
  const { doc, sel, edit } = useMech()
  const c = doc.components.find((x) => x.id === sel) ?? doc.components[0]
  const up = (label: string, patch: Partial<Component>) => {
    const err = edit(`${c.file}: ${label}`, (m) => ({ ...m, components: m.components.map((x) => (x.id === c.id ? { ...x, ...patch } : x)) }))
    if (err) toast(fmt(t.toast.invalid, { why: err }), 'warning')
  }
  const mass = massOf(c)
  return (
    <>
      <div className={w.elem}>
        {c.id === 'casing' ? <img className={w.elemThumb} src="/assets/v2/mechanical/casing-thumb.png" alt="" /> : <span className={s.thumbNone} />}
        <div className={w.elemText}>
          <strong>{c.file}</strong>
          <span>{c.kind === 'Assembly' ? p.assemblyComponent : p.partComponent}</span>
        </div>
        <Ellipsis size={18} strokeWidth={2} className={s.dots} />
      </div>
      <Section title={p.general}>
        <PRow label={p.name}><span>{c.file}</span></PRow>
        <PRow label={p.type}><span>{p.kinds[c.kind]}</span></PRow>
        <PRow label={p.directory}><span>{c.dir}</span></PRow>
        <PRow label={p.description}><span className={s.wrap}>{t.names[c.description] ?? c.description}</span><Pencil size={11} className={s.pencil} /></PRow>
      </Section>
      <Section title={p.appearance}>
        <PRow label={p.material}>
          <PSelect label={p.material} value={c.material} onChange={(v) => up(p.material, { material: v })} options={MATERIALS.map((m) => ({ value: m.name, label: m.name }))} />
        </PRow>
        <PRow label={p.color}><i className={s.swatch} style={{ background: c.color }} /><span>{p.byMaterial}</span></PRow>
        <PRow label={p.opacity}>
          <input className={s.slider} type="range" min={0} max={100} value={c.opacity} aria-label={p.opacity} onChange={(e) => up(p.opacity, { opacity: Number(e.target.value) })} />
          <span className={s.pct}>{c.opacity}%</span>
        </PRow>
      </Section>
      <Section title={p.mass}>
        <PRow label={p.massL}><span>{mass === null ? '—' : `${mass.toFixed(3)} kg`}</span></PRow>
        <PRow label={p.volume}><span>{c.volume.toFixed(5)} m³</span></PRow>
        <PRow label={p.area}><span>{c.area.toFixed(3)} m²</span></PRow>
        <PRow label={p.com}><span>{c.com.map((v) => v.toFixed(3)).join(', ')} m</span></PRow>
      </Section>
      <p className={s.note}>{p.geomNote}</p>
    </>
  )
}

function Configs() {
  const t = useT().mechanical
  const { doc, edit } = useMech()
  return (
    <Section title={t.configs.title}>
      {doc.configs.map((c) => (
        <PRow key={c.name} label={t.names[c.name] ?? c.name}>
          {c.active ? <span className={s.active}>{t.configs.active}</span> : (
            <button type="button" className={w.link} onClick={() => {
              const err = edit(`${t.configs.title}: ${c.name}`, (m) => ({ ...m, configs: m.configs.map((x) => ({ ...x, active: x.name === c.name })), params: m.params.map((p) => (p.name === 'Motor_Power' ? { ...p, value: c.motorKw } : p)) }))
              toast(err ? fmt(t.toast.invalid, { why: err }) : fmt(t.toast.config, { name: c.name, kw: c.motorKw }), err ? 'warning' : 'success')
            }}>{t.configs.activate}</button>
          )}
        </PRow>
      ))}
    </Section>
  )
}

function Display() {
  const t = useT().mechanical
  const { mode, set } = useMech()
  return (
    <Section title={t.display.title}>
      <PRow label={t.display.mode}>
        <PSelect label={t.display.mode} value={mode} onChange={(v) => set({ mode: v })} options={(['shaded', 'wireframe', 'hidden', 'realistic'] as const).map((k) => ({ value: k, label: t.viewer.modes[k] }))} />
      </PRow>
      <PRow label={t.display.explode}>
        <button type="button" className={w.link} onClick={() => toast(t.display.exploded)}>{t.tools.explode}</button>
      </PRow>
    </Section>
  )
}
