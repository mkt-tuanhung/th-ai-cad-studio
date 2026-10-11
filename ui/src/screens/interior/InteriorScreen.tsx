import { useEffect, useState } from 'react'
import {
  Armchair, Box, CalendarDays, Columns2, FileText, Image as ImageIcon, Layers, LayoutGrid, Lightbulb, MousePointer2, PanelTop, Share, Sprout,
} from 'lucide-react'
import { fmt, useLang, useT } from '../../i18n'
import { useRouter } from '../../state/router'
import { toast } from '../../state/toast'
import { useInterior } from '../../state/interior'
import { undoKeys } from '../../state/undoable'
import { AiSparkIcon, DimensionToolIcon, ExportToolIcon, TagToolIcon } from '../../components/icons'
import { WsButton, WsHeader, WsRibbon, csv, downloadFile } from '../../components/workspace/Workspace'
import { cutList, dimsLabel, roomQuantities } from '../../interior/model'
import { InteriorBrowser } from './InteriorBrowser'
import { InteriorViewport } from './InteriorViewport'
import { InteriorBottom } from './InteriorBottom'
import { InteriorRight } from './InteriorRight'
import { CabinetDialog } from './CabinetDialog'
import s from './Interior.module.css'

/** Interior workspace — mockup 09 (Design). */
export function InteriorScreen() {
  const T = useT()
  const t = T.interior
  const lang = useLang()
  const navigate = useRouter((st) => st.navigate)
  const st = useInterior()
  const [cabOpen, setCabOpen] = useState(false)
  const [max, setMax] = useState(false)
  const native = (what: string) => toast(fmt(t.toast.native, { what }))

  useEffect(() => {
    const onKey = undoKeys(st.undo, st.redo, (label, redo) => toast(label ? fmt(redo ? t.toast.redone : t.toast.undone, { label }) : t.toast.nothing))
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [st.undo, st.redo, t])

  const exportCsv = (kind: 'furniture' | 'cutlist' | 'quantities') => {
    const d = useInterior.getState().doc
    const room = (id: string) => d.rooms.find((r) => r.id === id)?.name ?? id
    let rows: (string | number)[][]
    if (kind === 'furniture') rows = [['Name', 'Category', 'Room', 'Dimensions (mm)', 'Material', 'Qty', 'Status'], ...d.items.map((i) => [i.name, i.category, room(i.room), dimsLabel(i), i.material, i.qty, i.status])]
    else if (kind === 'cutlist') rows = [['Cabinet', 'Part', 'Qty', 'Length (mm)', 'Width (mm)', 'Thickness (mm)', 'Material', 'Edge banding per piece (mm)'], ...d.cabinets.flatMap(cutList).map((p) => [p.cabinet, p.part, p.qty, p.l, p.wd, p.t, p.material, p.edge])]
    else rows = [['Room', 'Floor (m2)', 'Perimeter (m)', 'Walls gross (m2)', 'Ceiling (m2)', 'Ceiling height (mm)', 'Floor finish', 'Wall finish'], ...d.rooms.map(roomQuantities).map((q) => [q.room.name, q.floor.toFixed(2), q.perimeter.toFixed(2), q.wall.toFixed(2), q.ceiling.toFixed(2), q.room.ceilingHeight, q.room.floorFinish, q.room.wallFinish])]
    const file = `Villa Riverside - ${t.exportItems[kind].replace(/ \(CSV\)$/, '')}.csv`
    downloadFile(file, csv(rows))
    toast(fmt(t.toast.exported, { file }), 'success')
  }

  const tabs = [
    { key: 'design', label: t.tabs.design, icon: <PanelTop size={15} strokeWidth={1.7} />, width: 107 },
    { key: 'renders', label: t.tabs.renders, icon: <ImageIcon size={15} strokeWidth={1.6} />, width: 103 },
    { key: 'drawings', label: t.tabs.drawings, icon: <FileText size={15} strokeWidth={1.6} />, width: 103 },
    { key: 'schedule', label: t.tabs.schedule, icon: <CalendarDays size={15} strokeWidth={1.6} />, width: 99 },
  ]

  return (
    <div className={`${s.screen} ${max ? s.max : ''}`} lang={lang}>
      <div className={s.header}>
        <WsHeader
          homeLabel={T.nav.dashboard}
          onHome={() => navigate('dashboard')}
          crumbs={[{ label: t.crumbs.projects, onClick: () => navigate('projects') }, { label: t.crumbs.project, onClick: () => navigate('projects') }]}
          current={t.crumbs.discipline}
          currentMenu={[
            { label: t.disciplines.architecture, onSelect: () => navigate('bim') },
            { label: t.disciplines.interior, onSelect: () => undefined },
            { label: t.disciplines.mep, onSelect: () => navigate('mep') },
          ]}
          tabs={tabs}
          active={st.tab}
          tabsStyle={{ left: 422 }}
          onTab={(k) => {
            if (k === 'renders') return navigate('renders')
            if (k === 'drawings') return navigate('cad2d')
            st.set({ tab: k as 'design' | 'schedule' })
          }}
          actions={
            <>
              <WsButton icon={<Share size={15} strokeWidth={1.7} />} label={t.share} width={79} onClick={() => toast(t.toast.shareOffline)} />
              <WsButton
                icon={<ExportToolIcon size={19} strokeWidth={1.5} />}
                label={t.export}
                width={104}
                menu={(['furniture', 'cutlist', 'quantities'] as const).map((k) => ({ label: t.exportItems[k], onSelect: () => exportCsv(k) }))}
              />
              <WsButton primary icon={<AiSparkIcon size={19} strokeWidth={1.7} />} label={t.ai} width={130} onClick={() => st.set({ right: 'ai' })} />
            </>
          }
        />
      </div>

      <div className={s.ribbon}>
        <WsRibbon
          seps={[83, 184, 285, 385, 472, 560, 662, 749, 882, 993]}
          tools={[
            { key: 'select', label: t.tools.select, Icon: MousePointer2, c: 41, w: 70, active: true, onClick: () => st.set({ sel: null }), iconSize: 22 },
            { key: 'furniture', label: t.tools.furniture, Icon: Armchair, c: 133, onClick: () => st.set({ bottom: 'furniture', filter: null }) },
            { key: 'cabinet', label: t.tools.cabinet, Icon: Columns2, c: 234, onClick: () => st.set({ bottom: 'furniture', filter: 'cabinet' }) },
            { key: 'material', label: t.tools.material, Icon: LayoutGrid, c: 334, onClick: () => st.set({ right: 'materials' }) },
            { key: 'lighting', label: t.tools.lighting, Icon: Lightbulb, c: 429, onClick: () => st.set({ bottom: 'furniture', filter: 'lighting' }) },
            { key: 'decor', label: t.tools.decor, Icon: Sprout, c: 516, onClick: () => navigate('components') },
            { key: 'dimension', label: t.tools.dimension, Icon: DimensionToolIcon, c: 612, w: 80, onClick: () => native(t.tools.dimension) },
            { key: 'tag', label: t.tools.tag, Icon: TagToolIcon, c: 705, onClick: () => native(t.tools.tag) },
            { key: 'cabinetParam', label: t.tools.cabinetParam, Icon: Box, c: 817, w: 120, onClick: () => setCabOpen(true) },
            { key: 'cutList', label: t.tools.cutList, Icon: Layers, c: 928, w: 80, onClick: () => st.set({ bottom: 'cutlist' }) },
          ]}
          more={{
            c: 1062,
            label: t.tools.more,
            items: [
              { label: t.moreItems.edge, onSelect: () => st.set({ bottom: 'cutlist' }) },
              { label: t.moreItems.nesting, onSelect: () => native(t.moreItems.nesting) },
              { label: t.moreItems.toolpath, onSelect: () => native(t.moreItems.toolpath) },
              { label: t.moreItems.undo, onSelect: () => toast(st.undo() ? fmt(t.toast.undone, { label: '' }) : t.toast.nothing) },
              { label: t.moreItems.redo, onSelect: () => toast(st.redo() ? fmt(t.toast.redone, { label: '' }) : t.toast.nothing) },
              { label: t.moreItems.reset, onSelect: () => { st.reset(); toast(t.toast.reset) } },
            ],
          }}
        />
      </div>

      <div className={s.browser}>
        <InteriorBrowser />
      </div>
      <div className={s.viewer}>
        {st.tab === 'schedule' ? <InteriorBottom full /> : <InteriorViewport max={max} onMax={() => setMax(!max)} />}
      </div>
      {!max && st.tab !== 'schedule' && (
        <div className={s.bottom}>
          <InteriorBottom />
        </div>
      )}
      <div className={s.right}>
        <InteriorRight />
      </div>
      {cabOpen && <CabinetDialog onClose={() => setCabOpen(false)} />}
    </div>
  )
}
