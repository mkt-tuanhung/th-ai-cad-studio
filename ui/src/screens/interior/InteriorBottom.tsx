import { useMemo, useState } from 'react'
import { fmt, useT } from '../../i18n'
import { useRouter } from '../../state/router'
import { toast } from '../../state/toast'
import { useInterior, type InteriorBottom as Tab } from '../../state/interior'
import { Status, TabCard, Table, wsStyles as w, type Column } from '../../components/workspace/Workspace'
import { MATERIALS, cutList, cutTotals, dimsLabel, roomQuantities, type CutPart, type Item, type Material, type RoomQty } from '../../interior/model'
import s from './Interior.module.css'

const n2 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function InteriorBottom({ full }: { full?: boolean }) {
  const T = useT()
  const t = T.interior
  const c = t.cols
  const navigate = useRouter((st) => st.navigate)
  const { doc, bottom, sel, filter, checked, edit, set } = useInterior()
  const [all, setAll] = useState(false)
  const rn = (id: string) => {
    const r = doc.rooms.find((x) => x.id === id)
    return r ? (t.roomNames[r.name] ?? r.name) : id
  }
  const mn = (m: string) => t.matNames[m] ?? m

  const items = useMemo(() => doc.items.filter((i) => !filter || i.category === filter), [doc.items, filter])
  const shown = all || full ? items : items.slice(0, 6)

  const furnCols: Column<Item>[] = [
    { key: 'img', label: c.image, w: '56px', render: (i) => (i.thumb ? <img className={s.thumb} src={i.thumb} alt="" /> : <span className={s.thumbNone} />) },
    { key: 'name', label: c.name, w: '98px', render: (i) => i.name },
    { key: 'cat', label: c.category, w: '69px', render: (i) => t.cats[i.category] },
    { key: 'room', label: c.room, w: '76px', render: (i) => rn(i.room) },
    { key: 'dims', label: c.dims, w: '107px', render: (i) => dimsLabel(i) },
    { key: 'mat', label: c.material, w: '96px', render: (i) => mn(i.material) },
    { key: 'qty', label: c.qty, w: '72px', align: 'center', render: (i) => i.qty },
    { key: 'status', label: c.status, w: 'minmax(80px,1fr)', render: (i) => <Status tone={i.status === 'placed' ? 'ok' : 'idle'}>{t.status[i.status]}</Status> },
  ]

  const usage = (m: Material) => {
    const it = doc.items.filter((i) => i.material === m.name)
    const rooms = doc.rooms.filter((r) => r.floorFinish === m.name || r.wallFinish === m.name || r.ceilingFinish === m.name)
    const cab = doc.cabinets.filter((x) => x.board === m.name || x.front === m.name)
    return { it, rooms, cab }
  }
  const matRows = MATERIALS.map((m) => ({ m, u: usage(m) })).filter((x) => x.u.it.length || x.u.rooms.length || x.u.cab.length)
  const matCols: Column<(typeof matRows)[number]>[] = [
    { key: 'sw', label: '', w: '30px', render: (x) => <i className={s.swatch} style={{ background: x.m.color }} /> },
    { key: 'name', label: c.name, w: 'minmax(120px,1.3fr)', render: (x) => mn(x.m.name) },
    { key: 'kind', label: c.kind, w: 'minmax(60px,0.6fr)', render: (x) => t.kinds[x.m.kind] },
    { key: 'used', label: c.usedBy, w: 'minmax(160px,2fr)', render: (x) => [...x.u.it.map((i) => i.name), ...x.u.rooms.map((r) => rn(r.id)), ...x.u.cab.map((k) => k.name)].join(', ') },
    {
      key: 'q', label: c.quantity, w: 'minmax(80px,0.9fr)', align: 'right', render: (x) => {
        const floor = x.u.rooms.filter((r) => r.floorFinish === x.m.name).reduce((a, r) => a + roomQuantities(r).floor, 0)
        const wall = x.u.rooms.filter((r) => r.wallFinish === x.m.name).reduce((a, r) => a + roomQuantities(r).wall, 0)
        const ceil = x.u.rooms.filter((r) => r.ceilingFinish === x.m.name).reduce((a, r) => a + roomQuantities(r).ceiling, 0)
        const board = doc.cabinets.flatMap(cutList).filter((p) => p.material === x.m.name).reduce((a, p) => a + (p.l * p.wd * p.qty) / 1e6, 0)
        const m2 = floor + wall + ceil + board
        return m2 ? `${n2(m2)} m²` : `${x.u.it.reduce((a, i) => a + i.qty, 0)} pcs`
      },
    },
  ]

  const parts = doc.cabinets.flatMap(cutList)
  const tot = cutTotals(parts)
  const cutCols: Column<CutPart & { k: string }>[] = [
    { key: 'cab', label: c.cabinet, w: 'minmax(100px,1.2fr)', render: (p) => p.cabinet },
    { key: 'part', label: c.part, w: 'minmax(84px,1fr)', render: (p) => p.part },
    { key: 'qty', label: c.qty, w: '44px', align: 'center', render: (p) => p.qty },
    { key: 'size', label: c.size, w: 'minmax(90px,1fr)', align: 'right', render: (p) => `${p.l} × ${p.wd}` },
    { key: 't', label: c.t, w: '54px', align: 'center', render: (p) => p.t },
    { key: 'mat', label: c.board, w: 'minmax(96px,1.1fr)', render: (p) => mn(p.material) },
    { key: 'edge', label: c.edge, w: 'minmax(70px,0.7fr)', align: 'right', render: (p) => n2((p.edge * p.qty) / 1000) },
  ]

  const qRows = doc.rooms.map(roomQuantities)
  const qCols: Column<RoomQty>[] = [
    { key: 'room', label: c.room, w: 'minmax(110px,1.3fr)', render: (q) => rn(q.room.id) },
    { key: 'floor', label: c.floor, w: 'minmax(60px,0.7fr)', align: 'right', render: (q) => n2(q.floor) },
    { key: 'per', label: c.perimeter, w: 'minmax(70px,0.8fr)', align: 'right', render: (q) => n2(q.perimeter) },
    { key: 'h', label: c.height, w: 'minmax(64px,0.7fr)', align: 'right', render: (q) => q.room.ceilingHeight },
    { key: 'wall', label: c.walls, w: 'minmax(64px,0.7fr)', align: 'right', render: (q) => n2(q.wall) },
    { key: 'ceil', label: c.ceiling, w: 'minmax(64px,0.7fr)', align: 'right', render: (q) => n2(q.ceiling) },
    { key: 'fin', label: c.floorFinish, w: 'minmax(110px,1.2fr)', render: (q) => mn(q.room.floorFinish) },
  ]

  const tabs: { key: Tab; label: string }[] = [
    { key: 'furniture', label: t.bottom.furniture },
    { key: 'materials', label: t.bottom.materials },
    { key: 'cutlist', label: t.bottom.cutlist },
    { key: 'quantities', label: t.bottom.quantities },
  ]
  const tabW: Record<Tab, number> = { furniture: 115, materials: 85, cutlist: 149, quantities: 120 }

  return (
    <TabCard
      label={t.bottom[bottom]}
      tabs={tabs}
      active={bottom}
      onTab={(k) => set({ bottom: k })}
      tabStyle={(k) => ({ minWidth: tabW[k], padding: '0 6px 5px 13px', textAlign: 'left' })}
      right={
        bottom === 'furniture' && !full && items.length > 6 ? (
          <button type="button" className={w.link} onClick={() => setAll(!all)}>
            {all ? t.bottom.showLess : t.bottom.viewAll}
          </button>
        ) : undefined
      }
    >
      {bottom === 'furniture' && (
        <Table
          label={t.bottom.furniture}
          columns={furnCols}
          rows={shown}
          rowKey={(i) => i.id}
          rowH={25.4}
          selected={sel?.kind === 'item' ? sel.id : null}
          onSelect={(i) => set({ sel: { kind: 'item', id: i.id }, right: 'properties' })}
          checkbox={{
            checked: (i) => checked.includes(i.id),
            toggle: (i) => set({ checked: checked.includes(i.id) ? checked.filter((x) => x !== i.id) : [...checked, i.id] }),
            all: shown.length > 0 && shown.every((i) => checked.includes(i.id)),
            toggleAll: () => set({ checked: shown.every((i) => checked.includes(i.id)) ? [] : shown.map((i) => i.id) }),
          }}
          menu={(i) => [
            { label: t.rowMenu.select, onSelect: () => set({ sel: { kind: 'item', id: i.id }, right: 'properties' }) },
            { label: i.status === 'placed' ? t.rowMenu.planned : t.rowMenu.placed, onSelect: () => void edit(`${i.name}: status`, (d) => ({ ...d, items: d.items.map((x) => (x.id === i.id ? { ...x, status: x.status === 'placed' ? 'planned' : 'placed' } : x)) })) },
            { label: t.rowMenu.duplicate, onSelect: () => void edit(`Duplicate ${i.name}`, (d) => ({ ...d, items: [...d.items, { ...i, id: `i${Date.now()}`, status: 'planned', cabinet: undefined }] })) },
            { label: t.rowMenu.components, onSelect: () => navigate('components') },
            { label: t.rowMenu.remove, danger: true, onSelect: () => { edit(`Remove ${i.name}`, (d) => ({ ...d, items: d.items.filter((x) => x.id !== i.id) })); toast(fmt(t.toast.removed, { name: i.name })) } },
          ]}
        />
      )}
      {bottom === 'materials' && <Table label={t.bottom.materials} columns={matCols} rows={matRows} rowKey={(x) => x.m.name} rowH={25.4} />}
      {bottom === 'cutlist' && (
        <>
          <p className={s.cutSum}>
            {fmt(t.cut.totals, { parts: tot.parts, area: n2(tot.boardArea), edge: n2(tot.edge) })} · {fmt(t.cut.sheets, { list: Object.entries(tot.sheets).map(([m, n]) => `${mn(m)} × ${n}`).join(', ') })}
            <em>{t.cut.note}</em>
          </p>
          <Table label={t.bottom.cutlist} columns={cutCols} rows={parts.map((p, i) => ({ ...p, k: `${p.cabinet}-${p.part}-${i}` }))} rowKey={(p) => p.k} rowH={24} />
        </>
      )}
      {bottom === 'quantities' && (
        <>
          <p className={s.cutSum}><em>{t.qty.gross}</em></p>
          <Table label={t.bottom.quantities} columns={qCols} rows={qRows} rowKey={(q) => q.room.id} rowH={24} selected={sel?.kind === 'room' ? sel.id : null} onSelect={(q) => set({ sel: { kind: 'room', id: q.room.id }, room: q.room.id, browserSel: `room-${q.room.id}`, right: 'properties' })} />
        </>
      )}
    </TabCard>
  )
}
