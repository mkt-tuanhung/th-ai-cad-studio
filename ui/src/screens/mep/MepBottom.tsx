import { Download, Settings } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { toast } from '../../state/toast'
import { useMep, type MepBottom as Tab, type MepSchedule } from '../../state/mep'
import { Status, TabCard, Table, wsStyles as w, type Column } from '../../components/workspace/Workspace'
import { designChecks, type Circuit, type Clash, type Duct, type Equipment, type Finding, type LevelId, type Pipe } from '../../mep/model'
import { cableCheck, pipeCheck, LIMITS } from '../../mep/calc'
import s from './Mep.module.css'

const f1 = (v: number) => v.toFixed(1)
const f2 = (v: number) => v.toFixed(2)

export function MepBottom({ clashes, onCheck, onDownload }: { clashes: Clash[]; onCheck: () => void; onDownload: () => void }) {
  const T = useT()
  const t = T.mep
  const c = t.cols
  const { doc, bottom, schedule, sel, level, allLevels, checked, edit, set } = useMep()
  const lv = (id: LevelId) => fmt(t.viewer.levelName, { n: id.slice(1) })
  const onLevel = <X extends { level: LevelId }>(a: X[]) => (allLevels ? a : a.filter((x) => x.level === level))
  const clashOf = new Set(clashes.flatMap((x) => [x.a, x.b]))
  const findings = designChecks(doc)
  const flagged = new Set(findings.map((f) => f.target.id))
  const statusOf = (id: string, mark: string) => (clashOf.has(mark) ? <Status tone="err">{t.status.clash}</Status> : flagged.has(id) ? <Status tone="warn">{t.status.check}</Status> : <Status tone="ok">{t.status.ok}</Status>)
  const select = (kind: 'duct' | 'pipe' | 'circuit' | 'equipment', id: string) => set({ sel: { kind, id }, right: 'properties' })
  const checkbox = <R extends { id: string }>(rows: R[]) => ({
    checked: (r: R) => checked.includes(r.id),
    toggle: (r: R) => set({ checked: checked.includes(r.id) ? checked.filter((x) => x !== r.id) : [...checked, r.id] }),
    all: rows.length > 0 && rows.every((r) => checked.includes(r.id)),
    toggleAll: () => set({ checked: rows.every((r) => checked.includes(r.id)) ? [] : rows.map((r) => r.id) }),
  })

  const ductCols: Column<Duct>[] = [
    { key: 'mark', label: c.mark, w: '60px', render: (d) => d.mark },
    { key: 'sys', label: c.system, w: '71px', render: () => 'HVAC' },
    { key: 'type', label: c.type, w: '92px', render: (d) => t.ductTypes[d.type] ?? d.type },
    { key: 'w', label: c.width, w: '69px', render: (d) => d.w },
    { key: 'h', label: c.height, w: '74px', render: (d) => d.h },
    { key: 'l', label: c.length, w: '78px', render: (d) => d.length },
    { key: 'q', label: c.flow, w: '76px', render: (d) => d.flow },
    { key: 'lv', label: c.level, w: '73px', render: (d) => lv(d.level) },
    { key: 'st', label: c.status, w: 'minmax(70px,1fr)', render: (d) => statusOf(d.id, d.mark) },
  ]
  const pipeCols: Column<Pipe>[] = [
    { key: 'mark', label: c.mark, w: '66px', render: (p) => p.mark },
    { key: 'svc', label: c.service, w: 'minmax(120px,1.4fr)', render: (p) => t.services[p.service] ?? p.service },
    { key: 'dn', label: c.dn, w: '48px', render: (p) => p.dn },
    { key: 'l', label: c.length, w: '74px', render: (p) => p.length },
    { key: 'q', label: c.flow, w: '74px', render: (p) => p.flow.toFixed(2) },
    { key: 'v', label: c.velocity, w: '84px', render: (p) => f2(pipeCheck(p.dn, p.flow).v) },
    { key: 'lv', label: c.level, w: '64px', render: (p) => lv(p.level) },
    { key: 'st', label: c.status, w: 'minmax(70px,1fr)', render: (p) => statusOf(p.id, p.mark) },
  ]
  const elecCols: Column<Circuit>[] = [
    { key: 'mark', label: c.mark, w: '88px', render: (x) => x.mark },
    { key: 'load', label: c.load, w: 'minmax(90px,1fr)', render: (x) => x.load },
    { key: 'kw', label: c.kw, w: '48px', render: (x) => x.kw },
    { key: 'cab', label: c.cable, w: '74px', render: (x) => `${x.phases === 3 ? '4×' : '2×'}${x.cable}` },
    { key: 'len', label: c.length.replace('(mm)', '(m)'), w: '70px', render: (x) => x.length },
    { key: 'i', label: c.current, w: '56px', render: (x) => f1(cableCheck(x.kw, x.phases, x.cable, x.length).i) },
    { key: 'vd', label: c.vd, w: '56px', render: (x) => f2(cableCheck(x.kw, x.phases, x.cable, x.length).vdPct) },
    { key: 'st', label: c.status, w: 'minmax(70px,1fr)', render: (x) => statusOf(x.id, x.mark) },
  ]
  const eqCols: Column<Equipment>[] = [
    { key: 'mark', label: c.mark, w: '70px', render: (e) => e.mark },
    { key: 'kind', label: c.kind, w: 'minmax(110px,1fr)', render: (e) => t.browser.equip[e.kind] },
    { key: 'sys', label: c.system, w: '100px', render: (e) => t.systems[e.system] },
    { key: 'cap', label: c.capacity, w: '96px', render: (e) => e.capacity },
    { key: 'lv', label: c.level, w: '80px', render: (e) => lv(e.level) },
  ]

  const clashCols: Column<Clash>[] = [
    { key: 'a', label: c.clashA, w: '80px', render: (x) => x.a },
    { key: 'b', label: c.clashB, w: 'minmax(90px,1fr)', render: (x) => x.b },
    { key: 'k', label: c.clashKind, w: '120px', render: (x) => t.clashKinds[x.kind] },
    { key: 'lv', label: c.level, w: '70px', render: (x) => lv(x.level) },
    { key: 'd', label: c.depth, w: '96px', align: 'right', render: (x) => x.depth },
    { key: 'fix', label: c.action, w: 'minmax(140px,1.4fr)', render: (x) => (x.kind === 'duct-beam' ? <button type="button" className={w.link} onClick={(e) => { e.stopPropagation(); lowerDuct(x.a, x.level) }}>{t.fixes.lower}</button> : '—') },
  ]
  const lowerDuct = (mark: string, lvId: LevelId) => {
    const d = doc.ducts.find((x) => x.mark === mark && x.level === lvId)
    if (!d) return
    const err = edit(`${d.mark}: ${t.fixes.lower}`, (m) => ({ ...m, ducts: m.ducts.map((x) => (x.id === d.id ? { ...x, elevation: 2650 } : x)) }))
    toast(err ? fmt(t.toast.invalid, { why: err }) : fmt(t.toast.applied, { label: `${d.mark} → 2650 mm` }), err ? 'warning' : 'success')
  }

  const systems = [
    { id: 'hvac', n: doc.ducts.length, total: `${(doc.ducts.reduce((a, d) => a + d.length, 0) / 1000).toFixed(1)} m`, cl: clashes.filter((x) => x.kind !== 'pipe-beam').length, is: findings.filter((f) => f.target.kind === 'duct').length },
    { id: 'plumbing', n: doc.pipes.length, total: `${(doc.pipes.reduce((a, d) => a + d.length, 0) / 1000).toFixed(1)} m`, cl: clashes.filter((x) => x.kind !== 'duct-beam').length, is: findings.filter((f) => f.target.kind === 'pipe').length },
    { id: 'electrical', n: doc.circuits.length, total: `${doc.circuits.reduce((a, d) => a + d.kw, 0).toFixed(1)} kW`, cl: 0, is: findings.filter((f) => f.target.kind === 'circuit').length },
  ] as const
  const statusCols: Column<(typeof systems)[number]>[] = [
    { key: 's', label: c.system, w: 'minmax(110px,1fr)', render: (x) => t.systems[x.id] },
    { key: 'n', label: c.elements, w: '90px', align: 'right', render: (x) => x.n },
    { key: 't', label: c.total, w: '100px', align: 'right', render: (x) => x.total },
    { key: 'c', label: c.clashCount, w: '90px', align: 'right', render: (x) => x.cl },
    { key: 'i', label: c.issues, w: '100px', align: 'right', render: (x) => x.is },
    { key: 'st', label: c.status, w: '100px', render: (x) => (x.cl ? <Status tone="err">{t.status.clash}</Status> : x.is ? <Status tone="warn">{t.status.check}</Status> : <Status tone="ok">{t.status.ok}</Status>) },
  ]

  const nameOf = (f: Finding) => (f.target.kind === 'duct' ? doc.ducts.find((d) => d.id === f.target.id)?.mark : f.target.kind === 'pipe' ? doc.pipes.find((d) => d.id === f.target.id)?.mark : doc.circuits.find((d) => d.id === f.target.id)?.mark) ?? f.target.id
  const unit = (f: Finding) => (f.rule === 'vd' ? '%' : f.rule === 'ampacity' ? ' A' : f.rule === 'ductLoss' ? ' Pa/m' : ' m/s')
  const applyFix = (f: Finding) => {
    if (!f.fix) return
    const err = edit(`${nameOf(f)}: ${fmt(t.fixes.resize, { label: f.fix.label })}`, (m) =>
      f.target.kind === 'duct'
        ? { ...m, ducts: m.ducts.map((x) => (x.id === f.target.id ? { ...x, ...f.fix!.patch } : x)) }
        : { ...m, circuits: m.circuits.map((x) => (x.id === f.target.id ? { ...x, ...f.fix!.patch } : x)) },
    )
    toast(err ? fmt(t.toast.invalid, { why: err }) : fmt(t.toast.applied, { label: `${nameOf(f)} → ${f.fix.label}` }), err ? 'warning' : 'success')
  }
  const aiCols: Column<Finding>[] = [
    { key: 't', label: c.mark, w: '86px', render: (f) => nameOf(f) },
    { key: 'r', label: c.finding, w: 'minmax(160px,1.6fr)', render: (f) => t.rules[f.rule] },
    { key: 'v', label: c.value, w: '84px', align: 'right', render: (f) => `${f2(f.value)}${unit(f)}` },
    { key: 'l', label: c.limit, w: '76px', align: 'right', render: (f) => `${f.limit}${unit(f)}` },
    { key: 'a', label: c.action, w: 'minmax(120px,1fr)', render: (f) => (f.fix ? <button type="button" className={w.link} onClick={(e) => { e.stopPropagation(); applyFix(f) }}>{fmt(t.fixes.resize, { label: f.fix.label })}</button> : '—') },
  ]

  const tabs: { key: Tab; label: string }[] = [
    { key: 'schedules', label: t.bottom.schedules },
    { key: 'clashes', label: fmt(t.bottom.clashes, { n: clashes.length }) },
    { key: 'status', label: t.bottom.status },
    { key: 'ai', label: t.bottom.ai },
  ]
  const tabW: Record<Tab, number> = { schedules: 145, clashes: 145, status: 143, ai: 118 }
  const ducts = onLevel(doc.ducts), pipes = onLevel(doc.pipes), circuits = onLevel(doc.circuits), equip = onLevel(doc.equipment)
  // pill counts are project totals (mockup: Duct Schedule (48)); the table shows the current level unless View all
  const pills: [MepSchedule, number][] = [['duct', doc.ducts.length], ['pipe', doc.pipes.length], ['electrical', doc.circuits.length], ['equipment', doc.equipment.length]]

  return (
    <TabCard
      label={t.bottom[bottom === 'clashes' ? 'schedules' : bottom]}
      tabs={tabs}
      active={bottom}
      onTab={(k) => set({ bottom: k })}
      tabStyle={(k) => ({ minWidth: tabW[k], padding: '0 6px 0 16px', textAlign: 'left', fontSize: 12.5 })}
      right={
        <>
          <button type="button" className={w.link} style={{ marginRight: 10 }} aria-pressed={allLevels} onClick={() => set({ allLevels: !allLevels })}>{allLevels ? t.bottom.levelOnly : t.bottom.viewAll}</button>
          <button type="button" className={s.sqBtn} aria-label={t.bottom.download} title={t.bottom.download} onClick={onDownload}><Download size={16} strokeWidth={1.7} /></button>
          <button type="button" className={s.sqBtn} aria-label={t.bottom.settings} title={t.bottom.settings} onClick={onCheck}><Settings size={16} strokeWidth={1.7} /></button>
        </>
      }
    >
      {bottom === 'schedules' && (
        <>
          <div className={s.pills} role="tablist">
            {pills.map(([k, n]) => (
              <button key={k} type="button" role="tab" aria-selected={schedule === k} className={schedule === k ? s.pillOn : undefined} onClick={() => set({ schedule: k })}>
                {fmt(t.pills[k], { n })}
              </button>
            ))}
          </div>
          {schedule === 'duct' && <Table label={fmt(t.pills.duct, { n: ducts.length })} columns={ductCols} rows={ducts} rowKey={(d) => d.id} rowH={20.8} selected={sel?.id} onSelect={(d) => select('duct', d.id)} checkbox={checkbox(ducts)} menu={(d) => [{ label: t.props.identity, onSelect: () => select('duct', d.id) }, { label: t.fixes.lower, onSelect: () => lowerDuct(d.mark, d.level) }]} />}
          {schedule === 'pipe' && <Table label={fmt(t.pills.pipe, { n: pipes.length })} columns={pipeCols} rows={pipes} rowKey={(p) => p.id} rowH={20.8} selected={sel?.id} onSelect={(p) => select('pipe', p.id)} checkbox={checkbox(pipes)} />}
          {schedule === 'electrical' && <Table label={fmt(t.pills.electrical, { n: circuits.length })} columns={elecCols} rows={circuits} rowKey={(x) => x.id} rowH={20.8} selected={sel?.id} onSelect={(x) => select('circuit', x.id)} checkbox={checkbox(circuits)} />}
          {schedule === 'equipment' && <Table label={fmt(t.pills.equipment, { n: equip.length })} columns={eqCols} rows={equip} rowKey={(x) => x.id} rowH={20.8} selected={sel?.id} onSelect={(x) => select('equipment', x.id)} />}
        </>
      )}
      {bottom === 'clashes' && <Table label={fmt(t.bottom.clashes, { n: clashes.length })} columns={clashCols} rows={clashes} rowKey={(x) => x.id} rowH={22} onSelect={(x) => { const d = doc.ducts.find((y) => y.mark === x.a && y.level === x.level); if (d) select('duct', d.id) }} empty={t.aiCard.none} />}
      {bottom === 'status' && <Table label={t.bottom.status} columns={statusCols} rows={[...systems]} rowKey={(x) => x.id} rowH={24} />}
      {bottom === 'ai' && (
        <>
          <p className={s.note}>{t.aiCard.note} · {LIMITS.ductVelMain} m/s · {LIMITS.ductLoss} Pa/m · ΔU {LIMITS.vdPct} %</p>
          <Table label={t.bottom.ai} columns={aiCols} rows={findings} rowKey={(f) => f.id} rowH={22} empty={t.aiCard.none} />
        </>
      )}
    </TabCard>
  )
}
