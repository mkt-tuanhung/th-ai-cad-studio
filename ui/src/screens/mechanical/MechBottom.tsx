import { AlertTriangle, CheckCircle2, ChevronRight, Download, Ellipsis, Plus, Ruler, ShieldCheck, Scan, Settings2, XCircle } from 'lucide-react'
import { fmt, relativeTime, useLang, useT } from '../../i18n'
import { toast } from '../../state/toast'
import { useMech } from '../../state/mech'
import { NumField, Table, wsStyles as w, type Column } from '../../components/workspace/Workspace'
import { MenuList, PopoverPanel, useDismissable } from '../../components/ui/Popover'
import { designChecks, type BomLine, type Param } from '../../mech/model'
import s from './Mechanical.module.css'

export function MechBottom({ onExport }: { onExport: (k: 'bom' | 'params' | 'checks') => void }) {
  const T = useT()
  const t = T.mechanical
  const lang = useLang()
  const { doc, bottom, bomAll, checkedAt, checked, edit, set, nativeOverlap } = useMech()
  const [moreOpen, setMoreOpen, moreRef] = useDismissable<HTMLDivElement>()
  const up = (p: Param, v: number) => {
    const err = edit(`${p.name} = ${v} ${p.unit}`, (m) => ({ ...m, params: m.params.map((x) => (x.name === p.name ? { ...x, value: v } : x)) }))
    if (err) toast(fmt(t.toast.invalid, { why: err }), 'warning')
  }
  const addParam = () => {
    const n = doc.params.length + 1
    edit(fmt(t.params.add, {}), (m) => ({ ...m, params: [...m.params, { name: fmt(t.params.newName, { n }), value: 0, unit: 'mm', description: t.params.newDesc, min: -10000, max: 10000 }] }))
  }
  const pCols: Column<Param>[] = [
    { key: 'n', label: t.params.name, w: '68px', render: (p) => <span className={p.name.length > 10 ? s.tiny : undefined}>{p.name}</span> },
    { key: 'v', label: t.params.value, w: '42px', render: (p) => <NumField label={p.name} value={p.value} min={p.min} max={p.max} onCommit={(v) => up(p, v)} /> },
    { key: 'u', label: t.params.unit, w: '34px', render: (p) => p.unit },
    { key: 'd', label: t.params.description, w: 'minmax(80px,1fr)', render: (p) => <span className={s.small}>{t.names[p.description] ?? p.description}</span> },
  ]
  const bomRows = bomAll ? doc.bom : doc.bom.slice(0, 6)
  const bCols: Column<BomLine>[] = [
    { key: 'n', label: t.bom.n, w: '26px', render: (b) => b.n },
    { key: 'p', label: t.bom.part, w: '88px', render: (b) => b.name },
    { key: 'pn', label: t.bom.partNo, w: '74px', render: (b) => b.partNo },
    { key: 'm', label: t.bom.material, w: '72px', render: (b) => b.material },
    { key: 'q', label: t.bom.qty, w: 'minmax(30px,1fr)', render: (b) => b.qty },
  ]
  const checks = designChecks(doc).map((c) => {
    // desktop: the exact OCCT boolean common decides interference between impeller and casing
    if (c.key !== 'interference' || nativeOverlap === null) return c
    const hit = nativeOverlap > 1e-9
    return { ...c, tone: hit ? ('err' as const) : c.tone, detail: hit ? 'interference' : c.detail, facts: { ...c.facts, occt: (nativeOverlap * 1e6).toFixed(1) } }
  })
  const detailOf = (c: (typeof checks)[number]) => fmt(t.checks.details[c.key], c.facts) + ('occt' in c.facts ? fmt(t.checks.details.interferenceOcct, { v: c.facts.occt }) : '')
  const ICON = { interference: <Scan size={18} />, clearance: <Ruler size={17} />, strength: <AlertTriangle size={17} />, standard: <ShieldCheck size={17} />, dfm: <Settings2 size={17} /> }
  const run = () => {
    set({ checkedAt: Date.now(), bottom: 'checks' })
    toast(fmt(t.toast.checked, { ok: checks.filter((c) => c.tone === 'ok').length, warn: checks.filter((c) => c.tone === 'warn').length, err: checks.filter((c) => c.tone === 'err').length }), 'success')
  }
  const resText = (c: (typeof checks)[number]) => (t.checks.results[c.key] as Record<string, string>)[c.detail] ?? c.detail

  return (
    <>
      <section className={`${s.card} ${bottom === 'parameters' ? s.focus : ''}`} aria-label={fmt(t.params.title, { n: doc.params.length })}>
        <header>
          <b>{fmt(t.params.title, { n: doc.params.length })}</b>
          <button type="button" className={s.cardBtn} onClick={addParam}><Plus size={15} strokeWidth={1.8} />{t.params.add}</button>
        </header>
        <Table
          label={t.bottom.parameters}
          columns={pCols}
          rows={doc.params}
          rowKey={(p) => p.name}
          rowH={23.3}
          checkbox={{
            checked: (p) => checked.includes(p.name),
            toggle: (p) => set({ checked: checked.includes(p.name) ? checked.filter((x) => x !== p.name) : [...checked, p.name] }),
            all: doc.params.every((p) => checked.includes(p.name)),
            toggleAll: () => set({ checked: doc.params.every((p) => checked.includes(p.name)) ? [] : doc.params.map((p) => p.name) }),
          }}
        />
      </section>

      <section className={`${s.card} ${bottom === 'bom' ? s.focus : ''}`} aria-label={fmt(t.bom.title, { n: doc.bom.length })}>
        <header>
          <b>{fmt(t.bom.title, { n: doc.bom.length })}</b>
          <button type="button" className={w.link} onClick={() => set({ bomAll: !bomAll })}>{bomAll ? t.bom.less : t.bom.viewAll}</button>
          <button type="button" className={s.sq} aria-label={t.bom.download} title={t.bom.download} onClick={() => onExport('bom')}><Download size={15} strokeWidth={1.7} /></button>
          <div className={w.anchor} ref={moreRef}>
            <button type="button" className={s.sq} aria-label={t.bom.more} aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}><Ellipsis size={15} strokeWidth={2} /></button>
            {moreOpen && (
              <PopoverPanel width={220}>
                <MenuList onClose={() => setMoreOpen(false)} items={[{ label: t.exportItems.params, onSelect: () => onExport('params') }, { label: t.exportItems.checks, onSelect: () => onExport('checks') }]} />
              </PopoverPanel>
            )}
          </div>
        </header>
        {bottom === 'mates' ? (
          <Table label={fmt(t.mates.title, { n: doc.mates.length })} columns={[
            { key: 'k', label: t.mates.kind, w: '74px', render: (m) => t.mateKinds[m.kind] },
            { key: 'a', label: t.mates.a, w: 'minmax(80px,1fr)', render: (m) => m.a },
            { key: 'b', label: t.mates.b, w: 'minmax(80px,1fr)', render: (m) => m.b },
            { key: 'v', label: t.mates.value, w: '44px', render: (m) => m.value ?? '—' },
          ]} rows={doc.mates} rowKey={(m) => m.id} rowH={23.3} />
        ) : (
          <Table label={t.bottom.bom} columns={bCols} rows={bomRows} rowKey={(b) => String(b.n)} rowH={23.3} onSelect={(b) => b.component && set({ sel: b.component, browserSel: `c-${b.component}`, right: 'properties' })} />
        )}
      </section>

      <section className={`${s.card} ${s.checks} ${bottom === 'checks' ? s.focus : ''}`} aria-label={t.checks.title}>
        <header>
          <b>{t.checks.title}</b>
          {checkedAt && <small className={s.ran}>{fmt(t.checks.ran, { time: relativeTime(checkedAt, lang) })}</small>}
          <button type="button" className={s.cardBtn} onClick={run}><Download size={15} strokeWidth={1.8} style={{ transform: 'rotate(180deg)' }} />{t.checks.run}</button>
        </header>
        <ul>
          {checks.map((c) => (
            <li key={c.key} title={detailOf(c)}>
              <span className={`${s.ckIcon} ${s[`k_${c.key}`]}`}>{ICON[c.key]}</span>
              <b>{t.checks.names[c.key]}</b>
              <span className={`${s.res} ${s[c.tone]}`}>
                {c.tone === 'ok' ? <CheckCircle2 size={15} /> : c.tone === 'warn' ? <AlertTriangle size={15} /> : <XCircle size={15} />}
                {resText(c)}
              </span>
              <ChevronRight size={14} className={s.chev} />
              <small className={s.detail}>{detailOf(c)}</small>
            </li>
          ))}
        </ul>
        <p className={s.note}>{t.checks.note}</p>
      </section>
    </>
  )
}
