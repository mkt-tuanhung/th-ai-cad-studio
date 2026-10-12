import { useEffect } from 'react'
import { fmt, useT } from '../../i18n'
import { useBim } from '../../state/bim'
import { toast } from '../../state/toast'
import { wallsCsv } from '../../bim/model'
import { BimHeader } from './BimHeader'
import { BimRibbon } from './BimRibbon'
import { ProjectBrowser } from './ProjectBrowser'
import { Viewer3D } from './Viewer3D'
import { BimPlan } from './BimPlan'
import { ScheduleCard, CategoryPills } from './ScheduleCard'
import { ScheduleTable } from './ScheduleTable'
import { CoordinationCard } from './CoordinationCard'
import { PropertiesPanel } from './PropertiesPanel'
import s from './BimScreen.module.css'

export function BimScreen() {
  const T = useT()
  const { view, maximized, browserCollapsed, scheduleCat } = useBim()

  const exportCsv = () => {
    const file = 'Villa Riverside - Wall Schedule.csv'
    const url = URL.createObjectURL(new Blob([wallsCsv(useBim.getState().model)], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = file
    a.click()
    URL.revokeObjectURL(url)
    toast(fmt(T.bim.toast.exported, { file }), 'success')
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement
      if (typing || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      e.preventDefault()
      const label = e.shiftKey ? useBim.getState().redo() : useBim.getState().undo()
      toast(label ? fmt(e.shiftKey ? T.bim.toast.redone : T.bim.toast.undone, { label }) : T.bim.toast.nothing)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [T])

  return (
    <div className={`${s.screen} ${maximized ? s.max : ''} ${browserCollapsed ? s.slim : ''}`}>
      <div className={s.header}>
        <BimHeader onExportCsv={exportCsv} />
      </div>
      <div className={s.ribbon}>
        <BimRibbon />
      </div>
      <div className={s.browser}>
        <ProjectBrowser />
      </div>
      <div className={s.viewer}>
        {view === '3d' && <Viewer3D />}
        {view === 'plan' && <BimPlan />}
        {view === 'schedule' && (
          <section className={s.fullSchedule}>
            <CategoryPills />
            <div className={`${s.fullBody} scroll-y`}>
              <ScheduleTable cat={scheduleCat} dense />
            </div>
          </section>
        )}
      </div>
      {!maximized && (
        <>
          <div className={s.schedule}>
            <ScheduleCard />
          </div>
          <div className={s.coord}>
            <CoordinationCard />
          </div>
        </>
      )}
      <div className={s.props}>
        <PropertiesPanel />
      </div>
    </div>
  )
}
