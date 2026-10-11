import { Ellipsis } from 'lucide-react'
import { useT } from '../../i18n'
import { useBim, type ScheduleCat } from '../../state/bim'
import { levelOf, typeOf, wallArea, wallVolume, type BimModel } from '../../bim/model'
import { MenuList, PopoverPanel, useDismissable } from '../../components/ui/Popover'
import s from './ScheduleTable.module.css'

const nf = (n: number, d = 0) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

export function scheduleRows(m: BimModel, cat: ScheduleCat, noMark: string) {
  const lvl = (id: string) => levelOf(m, id)?.name ?? id
  switch (cat) {
    case 'walls':
      return m.walls.map((w) => ({ id: w.id, category: 'wall' as const, cells: [w.mark, typeOf(m, w).name, lvl(w.baseLevel), nf(w.length), nf(wallArea(m, w), 2), nf(wallVolume(m, w), 2), '1'] }))
    case 'doors':
    case 'windows': {
      const list = cat === 'doors' ? m.doors : m.windows
      return list.map((o) => {
        const host = m.walls.find((w) => w.id === o.hostWall)
        return { id: o.id, category: o.category, cells: [o.mark || noMark, `${o.family} - ${o.type}`, host ? lvl(host.baseLevel) : '—', o.hostWall, nf(o.width), nf(o.height), '1'] }
      })
    }
    case 'rooms':
      return m.rooms.map((r) => ({ id: r.id, category: 'room' as const, cells: [r.number, r.name, lvl(r.level), '', nf(r.area, 2), '', '1'] }))
    case 'levels':
      return m.levels.map((l) => ({ id: l.id, category: 'level' as const, cells: [l.id, l.name, '', nf(l.elevation), '', '', '1'] }))
  }
}

export function ScheduleTable({ cat, limit, dense }: { cat: ScheduleCat; limit?: number; dense?: boolean }) {
  const T = useT()
  const t = T.bim.schedule
  const { model, checked, set, selection } = useBim()
  const rows = scheduleRows(model, cat, t.noMark)
  const shown = limit ? rows.slice(0, limit) : rows
  const c = t.cols
  const heads: Record<ScheduleCat, string[]> = {
    walls: [c.mark, c.type, c.level, c.length, c.area, c.volume, c.count],
    doors: [c.mark, c.type, c.level, c.host, c.width, c.height, c.count],
    windows: [c.mark, c.type, c.level, c.host, c.width, c.height, c.count],
    rooms: [c.number, c.name, c.level, '', c.area, '', c.count],
    levels: [c.mark, c.name, '', c.elevation, '', '', c.count],
  }
  const allChecked = shown.length > 0 && shown.every((r) => checked.includes(r.id))
  return (
    <div className={`${s.table} ${dense ? s.dense : ''}`} role="table">
      <div className={`${s.row} ${s.head}`} role="row">
        <span className={s.cbCell}>
          <input type="checkbox" aria-label={t.selectAll} checked={allChecked} onChange={() => set({ checked: allChecked ? [] : shown.map((r) => r.id) })} />
        </span>
        {heads[cat].map((h, i) => (
          <span key={i} role="columnheader" className={i >= 3 ? s.num : undefined}>
            {h}
          </span>
        ))}
        <span />
      </div>
      {shown.map((r) => {
        const isSel = selection?.id === r.id
        return (
          <div key={r.id} role="row" className={`${s.row} ${isSel ? s.sel : ''}`} onClick={() => set({ selection: { category: r.category, id: r.id }, rightTab: 'properties' })}>
            <span className={s.cbCell} onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                aria-label={r.cells[0]}
                checked={checked.includes(r.id)}
                onChange={() => set({ checked: checked.includes(r.id) ? checked.filter((x) => x !== r.id) : [...checked, r.id] })}
              />
            </span>
            {r.cells.map((cell, i) => (
              <span key={i} role="cell" className={`${i >= 3 ? s.num : ''} ${i === 0 && cell === t.noMark ? s.warn : ''}`}>
                {cell}
              </span>
            ))}
            <RowMenu label={t.rowMenu} onSelect={() => set({ selection: { category: r.category, id: r.id }, rightTab: 'properties' })} selectLabel={t.select} />
          </div>
        )
      })}
    </div>
  )
}

function RowMenu({ label, selectLabel, onSelect }: { label: string; selectLabel: string; onSelect: () => void }) {
  const [open, setOpen, ref] = useDismissable<HTMLDivElement>()
  return (
    <div className={s.menu} ref={ref} onClick={(e) => e.stopPropagation()}>
      <button type="button" aria-label={label} className={s.more} onClick={() => setOpen(!open)}>
        <Ellipsis size={16} strokeWidth={2.2} />
      </button>
      {open && (
        <PopoverPanel width={170}>
          <MenuList onClose={() => setOpen(false)} items={[{ label: selectLabel, onSelect }]} />
        </PopoverPanel>
      )}
    </div>
  )
}
