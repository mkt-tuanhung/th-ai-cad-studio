import { fmt, useT } from '../../i18n'
import { useBim, type ScheduleCat } from '../../state/bim'
import { ScheduleTable } from './ScheduleTable'
import s from './ScheduleCard.module.css'

const CATS: ScheduleCat[] = ['walls', 'doors', 'windows', 'rooms', 'levels']
const W: Record<ScheduleCat, number> = { walls: 76, doors: 84, windows: 86, rooms: 70, levels: 68 }

export function useCounts() {
  const m = useBim((st) => st.model)
  return { walls: m.walls.length, doors: m.doors.length, windows: m.windows.length, rooms: m.rooms.length, levels: m.levels.length }
}

export function CategoryPills() {
  const t = useT().bim.schedule
  const { scheduleCat, set } = useBim()
  const n = useCounts()
  return (
    <div className={s.pills} role="tablist">
      {CATS.map((c) => (
        <button key={c} type="button" role="tab" aria-selected={scheduleCat === c} className={`${s.pill} ${scheduleCat === c ? s.pillOn : ''}`} style={{ width: W[c] }} onClick={() => set({ scheduleCat: c })}>
          {fmt(t.cats[c], { n: n[c] })}
        </button>
      ))}
    </div>
  )
}

export function ScheduleCard() {
  const t = useT().bim.schedule
  const { scheduleCat, set } = useBim()
  return (
    <section className={s.card}>
      <header className={s.head}>
        <h2 className={s.title}>{t.title}</h2>
        <button type="button" className={s.viewAll} onClick={() => set({ view: 'schedule' })}>
          {t.viewAll}
        </button>
      </header>
      <CategoryPills />
      <div className={`${s.body} scroll-y`}>
        <ScheduleTable cat={scheduleCat} />
      </div>
    </section>
  )
}
