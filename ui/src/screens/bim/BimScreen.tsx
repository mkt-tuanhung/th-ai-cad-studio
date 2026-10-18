import { BimDrawing } from './BimDrawing'
import { useEffect } from 'react'
import { fmt, useT } from '../../i18n'
import { useBim } from '../../state/bim'
import { toast } from '../../state/toast'
import { undoKeys } from '../../state/undoable'
import { useKeyActions } from '../../platform/useKeyActions'
import type { BimTool } from '../../state/bim'
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

const tool = (t: BimTool) => () => useBim.getState().set(t === 'select' ? { tool: t } : { tool: t, view: 'plan', selection: null, pendingComponent: null })
const BIM_ACTIONS: Record<string, () => void> = {
  'bim.select': tool('select'), 'bim.wall': tool('wall'), 'bim.door': tool('door'), 'bim.window': tool('window'), 'bim.column': tool('column'),
  'bim.slab': tool('slab'), 'bim.room': tool('room'), 'bim.stair': tool('stair'), 'bim.dimension': tool('dimension'), 'bim.grid': tool('grid'),
  'bim.erase': () => { useBim.getState().deleteSelection() },
  'bim.viewPlan': () => useBim.getState().set({ view: 'plan' }),
  'bim.view3d': () => useBim.getState().set({ view: '3d' }),
  'bim.viewSchedule': () => useBim.getState().set({ view: 'schedule' }),
  'bim.wireframe': () => { const st = useBim.getState(); st.set({ view: '3d', display: st.display === 'wireframe' ? 'shaded' : 'wireframe' }) },
  'bim.maximize': () => { const st = useBim.getState(); st.set({ maximized: !st.maximized }) },
}

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

  // undo / redo: the keys of Settings → Keyboard Shortcuts (was a hard-coded ⌘Z)
  useEffect(() => {
    const onKey = undoKeys(() => useBim.getState().undo(), () => useBim.getState().redo(), (label, redo) =>
      toast(label ? fmt(redo ? T.bim.toast.redone : T.bim.toast.undone, { label }) : T.bim.toast.nothing))
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [T])
  // interaction profile keys (platform/keymap.ts): the ribbon's tools and views
  useKeyActions(BIM_ACTIONS)

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
        {view === 'drawing' && <BimDrawing />}
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
