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
import { cutListRows } from '../../cam/nesting'
import { roomSchedule, scheduleCsvRows } from '../../interior/production'
import { InteriorBrowser } from './InteriorBrowser'
import { InteriorViewport } from './InteriorViewport'
import { InteriorPlan } from './InteriorPlan'
import { InteriorBottom } from './InteriorBottom'
import { InteriorRight } from './InteriorRight'
import { CabinetDialog } from './CabinetDialog'
import { NestingDialog } from './NestingDialog'
import { FromCadDialog } from '../bim/FromCadDialog'
import { useKeyActions } from '../../platform/useKeyActions'
import { getHost } from '../../services/host'
import { exportGlb, interiorSpec } from '../../renders/snapshot'
import s from './Interior.module.css'

const ist = () => useInterior.getState()
/** Interaction-profile actions (platform/keymap.ts): the plan tools and views of the ribbon. */
const INT_ACTIONS: Record<string, () => void> = {
  'int.dimension': () => ist().set({ itool: ist().itool === 'dimension' ? null : 'dimension', plan: ist().plan ?? 'floor', tab: 'design' }),
  'int.tag': () => ist().set({ itool: ist().itool === 'tag' ? null : 'tag', plan: ist().plan ?? 'floor', tab: 'design' }),
  'int.viewFloor': () => ist().set({ plan: 'floor', tab: 'design' }),
  'int.viewCeiling': () => ist().set({ plan: 'ceiling', tab: 'design' }),
  'int.view3d': () => ist().set({ plan: null, itool: null, tab: 'design' }),
}

/** Interior workspace — mockup 09 (Design). */
export function InteriorScreen() {
  const T = useT()
  const t = T.interior
  const lang = useLang()
  const navigate = useRouter((st) => st.navigate)
  const st = useInterior()
  const [cabOpen, setCabOpen] = useState(false)
  const [fromCad, setFromCad] = useState(false)
  const [max, setMax] = useState(false)

  useEffect(() => {
    const onKey = undoKeys(st.undo, st.redo, (label, redo) => toast(label ? fmt(redo ? t.toast.redone : t.toast.undone, { label }) : t.toast.nothing))
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [st.undo, st.redo, t])
  useKeyActions(INT_ACTIONS)

  const exportCsv = (kind: 'furniture' | 'cutlist' | 'quantities' | 'roomSchedule') => {
    const d = useInterior.getState().doc
    const room = (id: string) => d.rooms.find((r) => r.id === id)?.name ?? id
    let rows: (string | number)[][]
    if (kind === 'furniture') rows = [['Name', 'Category', 'Room', 'Dimensions (mm)', 'Material', 'Qty', 'Status'], ...d.items.map((i) => [i.name, i.category, room(i.room), dimsLabel(i), i.material, i.qty, i.status])]
    else if (kind === 'cutlist') rows = cutListRows(d.cabinets.flatMap(cutList))
    else if (kind === 'roomSchedule') rows = scheduleCsvRows(roomSchedule(d), room)
    else rows = [['Room', 'Floor (m2)', 'Perimeter (m)', 'Walls gross (m2)', 'Ceiling (m2)', 'Ceiling height (mm)', 'Floor finish', 'Wall finish'], ...d.rooms.map(roomQuantities).map((q) => [q.room.name, q.floor.toFixed(2), q.perimeter.toFixed(2), q.wall.toFixed(2), q.ceiling.toFixed(2), q.room.ceilingHeight, q.room.floorFinish, q.room.wallFinish])]
    const file = `Villa Riverside - ${t.exportItems[kind].replace(/ \(CSV\)$/, '')}.csv`
    downloadFile(file, csv(rows))
    toast(fmt(t.toast.exported, { file }), 'success')
  }

  // v2.4 SP38: glTF binary of the interior (rooms, walls to the ceiling, furniture, cabinets)
  const exportGlbFile = async () => {
    const host = await getHost()
    if (!host) return toast(T.render24.glb.desktop)
    const r = await exportGlb(host, interiorSpec(useInterior.getState().doc, { furniture: true }), 'Villa Riverside - interior.glb')
    if (r.ok) toast(fmt(T.render24.glb.saved, { file: (r.path ?? '').split(/[\\/]/).pop() ?? '', n: r.nodes ?? 0, m: r.materials?.length ?? 0 }), 'success')
    else if (!('cancelled' in r && r.cancelled)) toast(fmt(T.render24.glb.failed, { why: r.error ?? '' }), 'warning')
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
                menu={[...(['furniture', 'cutlist', 'quantities', 'roomSchedule'] as const).map((k) => ({ label: t.exportItems[k], onSelect: () => exportCsv(k) })), { label: T.render24.glb.export, onSelect: () => void exportGlbFile() }]}
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
            { key: 'dimension', label: t.tools.dimension, Icon: DimensionToolIcon, c: 612, w: 80, active: st.itool === 'dimension', onClick: () => st.set({ itool: st.itool === 'dimension' ? null : 'dimension', plan: st.plan ?? 'floor', tab: 'design' }) },
            { key: 'tag', label: t.tools.tag, Icon: TagToolIcon, c: 705, active: st.itool === 'tag', onClick: () => st.set({ itool: st.itool === 'tag' ? null : 'tag', plan: st.plan ?? 'floor', tab: 'design' }) },
            { key: 'cabinetParam', label: t.tools.cabinetParam, Icon: Box, c: 817, w: 120, onClick: () => setCabOpen(true) },
            { key: 'cutList', label: t.tools.cutList, Icon: Layers, c: 928, w: 80, onClick: () => st.set({ bottom: 'cutlist' }) },
          ]}
          more={{
            c: 1062,
            label: t.tools.more,
            items: [
              { label: T.bim.fromCad.interiorMenu, onSelect: () => setFromCad(true) },
              { label: t.moreItems.edge, onSelect: () => st.set({ bottom: 'cutlist' }) },
              { label: t.moreItems.nesting, onSelect: () => st.set({ nestingOpen: true }) },
              { label: t.moreItems.toolpath, onSelect: () => st.set({ nestingOpen: true }) },
              ...((st.doc.notes ?? []).length ? [{ label: t.plan.clear, onSelect: () => { st.edit(t.plan.clear, (d) => ({ ...d, notes: [] })); toast(t.plan.cleared) } }] : []),
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
        {st.tab === 'schedule' ? <InteriorBottom full /> : st.plan ? <InteriorPlan /> : <InteriorViewport max={max} onMax={() => setMax(!max)} onLoaded={(r) => st.set({ nativeVolumes: r.volumes ?? null })} />}
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
      {st.nestingOpen && <NestingDialog onClose={() => st.set({ nestingOpen: false })} />}
      {fromCad && <FromCadDialog interior onClose={() => setFromCad(false)} />}
    </div>
  )
}
