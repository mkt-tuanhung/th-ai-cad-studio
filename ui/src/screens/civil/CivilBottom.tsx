import { useState } from 'react'
import { fmt, useT } from '../../i18n'
import { useCivil, type CivilBottom as Tab } from '../../state/civil'
import { TabCard, Table, wsStyles as w, type Column } from '../../components/workspace/Workspace'
import { earthwork, liningQuantities, sta, type Culvert, type EarthRow } from '../../civil/model'

const n2 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const n3 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })

export function CivilBottom({ full }: { full?: boolean }) {
  const t = useT().civil
  const c = t.cols
  const { doc, bottom, set, station } = useCivil()
  const [all, setAll] = useState(false)
  const rowsAll = earthwork(doc)
  const rows = all || full ? rowsAll : rowsAll.slice(0, 6)
  const ewCols: Column<EarthRow>[] = [
    { key: 'f', label: c.from, w: '104px', render: (r) => sta(r.from) },
    { key: 't', label: c.to, w: '117px', render: (r) => sta(r.to) },
    { key: 'l', label: c.length, w: '94px', render: (r) => n3(r.length) },
    { key: 'c', label: c.cut, w: '91px', render: (r) => n2(r.cut) },
    { key: 'fi', label: c.fill, w: '104px', render: (r) => n2(r.fill) },
    { key: 'n', label: c.net, w: '98px', render: (r) => n2(r.net) },
    { key: 'r', label: c.remarks, w: 'minmax(80px,1fr)', render: (r) => (r.net >= 0 ? t.remarks.excavation : t.remarks.embankment) },
  ]
  const lin = liningQuantities(doc)
  const chRows = rowsAll.map((r) => ({ ...r, lining: (lin.perim * r.length), concrete: lin.perim * r.length * doc.params.liningT }))
  const chCols: Column<(typeof chRows)[number]>[] = [
    { key: 'f', label: c.from, w: '105px', render: (r) => sta(r.from) },
    { key: 't', label: c.to, w: '104px', render: (r) => sta(r.to) },
    { key: 'l', label: c.length, w: '96px', align: 'right', render: (r) => n3(r.length) },
    { key: 'li', label: c.lining, w: '100px', align: 'right', render: (r) => n2(r.lining) },
    { key: 'co', label: c.concrete, w: '110px', align: 'right', render: (r) => n2(r.concrete) },
    { key: 'ex', label: c.excav, w: 'minmax(90px,1fr)', align: 'right', render: (r) => n2(r.cut) },
  ]
  const stCols: Column<Culvert>[] = [
    { key: 'n', label: c.name, w: 'minmax(110px,1fr)', render: (x) => t.names[x.name] ?? x.name },
    { key: 's', label: c.station, w: '90px', render: (x) => sta(x.station) },
    { key: 'i', label: c.invert, w: '110px', align: 'right', render: (x) => x.invert.toFixed(2) },
    { key: 'z', label: c.size, w: '150px', render: (x) => t.names[x.size] ?? x.size },
    { key: 'l', label: c.length, w: '90px', align: 'right', render: (x) => x.length.toFixed(1) },
  ]
  const cut = rowsAll.reduce((a, r) => a + r.cut, 0), fill = rowsAll.reduce((a, r) => a + r.fill, 0)
  const grade = doc.params.lining.match(/\((.*)\)/)?.[1] ?? doc.params.lining
  const mats = [
    { k: 'concrete', item: fmt(t.mats.concrete, { grade }), qty: lin.concrete, unit: 'm³', basis: fmt(t.matBasis.lining, { t: Math.round(doc.params.liningT * 1000) }) },
    { k: 'excavation', item: t.mats.excavation, qty: cut, unit: 'm³', basis: t.matBasis.excavation },
    { k: 'fill', item: t.mats.fill, qty: fill, unit: 'm³', basis: t.matBasis.fill },
    { k: 'spoil', item: t.mats.spoil, qty: cut - fill, unit: 'm³', basis: t.matBasis.spoil },
    { k: 'culverts', item: t.mats.culverts, qty: doc.culverts.length, unit: 'pcs', basis: t.matBasis.culverts },
  ]
  const matCols: Column<(typeof mats)[number]>[] = [
    { key: 'i', label: c.item, w: 'minmax(160px,1.4fr)', render: (x) => x.item },
    { key: 'q', label: c.qty, w: '110px', align: 'right', render: (x) => (x.unit === 'pcs' ? x.qty : n2(x.qty)) },
    { key: 'u', label: c.unit, w: '60px', render: (x) => x.unit },
    { key: 'b', label: c.basis, w: 'minmax(140px,1fr)', render: (x) => x.basis },
  ]
  const tabs: { key: Tab; label: string }[] = (['earthwork', 'channel', 'structures', 'materials'] as Tab[]).map((k) => ({ key: k, label: t.bottom[k] }))
  const tabW: Record<Tab, number> = { earthwork: 141, channel: 133, structures: 95, materials: 96 }
  return (
    <TabCard
      label={t.bottom[bottom]}
      tabs={tabs}
      active={bottom}
      onTab={(k) => set({ bottom: k })}
      tabStyle={(k) => ({ minWidth: tabW[k], padding: '0 6px 0 22px', textAlign: 'left' })}
      right={!full && bottom === 'earthwork' && rowsAll.length > 6 ? <button type="button" className={w.link} onClick={() => setAll(!all)}>{all ? t.bottom.showLess : t.bottom.viewAll}</button> : undefined}
    >
      {bottom === 'earthwork' && <Table label={t.bottom.earthwork} columns={ewCols} rows={rows} rowKey={(r) => String(r.from)} rowH={20.2} selected={String(Math.floor(station / 100) * 100)} onSelect={(r) => set({ station: r.from + 50 > doc.alignment.end ? r.from : r.from + 40 })} />}
      {bottom === 'channel' && <Table label={t.bottom.channel} columns={chCols} rows={chRows} rowKey={(r) => String(r.from)} rowH={20.2} />}
      {bottom === 'structures' && <Table label={t.bottom.structures} columns={stCols} rows={doc.culverts} rowKey={(x) => x.id} rowH={22} onSelect={(x) => set({ station: x.station })} />}
      {bottom === 'materials' && <Table label={t.bottom.materials} columns={matCols} rows={mats} rowKey={(x) => x.k} rowH={22} />}
    </TabCard>
  )
}
