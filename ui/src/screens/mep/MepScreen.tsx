import { useEffect, useMemo, useState } from 'react'
import {
  Box, Cylinder, Fan, Filter, Grid3x3, Layers, LayoutPanelTop, MousePointer2, Share, Smartphone, Spline, Square, Wrench, Zap, Diamond, Type, Lamp,
} from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { useRouter } from '../../state/router'
import { toast } from '../../state/toast'
import { useMep } from '../../state/mep'
import { undoKeys } from '../../state/undoable'
import { AiSparkIcon, DimensionToolIcon, ExportToolIcon, PipeIcon, TagToolIcon } from '../../components/icons'
import { WsButton, WsHeader, WsRibbon, csv, downloadFile } from '../../components/workspace/Workspace'
import { designChecks, findClashes } from '../../mep/model'
import { cableCheck, ductLoss, pipeCheck } from '../../mep/calc'
import { MepBrowser } from './MepBrowser'
import { MepViewport } from './MepViewport'
import { MepBottom } from './MepBottom'
import { MepRight } from './MepRight'
import s from './Mep.module.css'

/** MEP workspace — mockup 08. */
export function MepScreen() {
  const T = useT()
  const t = T.mep
  const navigate = useRouter((st) => st.navigate)
  const st = useMep()
  const [max, setMax] = useState(false)
  const native = (what: string) => toast(fmt(t.toast.native, { what }))
  const clashes = useMemo(() => findClashes(st.doc), [st.doc])

  useEffect(() => {
    const onKey = undoKeys(st.undo, st.redo, (label, redo) => toast(label ? fmt(redo ? t.toast.redone : t.toast.undone, { label }) : t.toast.nothing))
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [st.undo, st.redo, t])

  const exportCsv = (kind: 'duct' | 'pipe' | 'electrical' | 'clashes') => {
    const m = useMep.getState().doc
    let rows: (string | number)[][]
    if (kind === 'duct') rows = [['Mark', 'Type', 'Width (mm)', 'Height (mm)', 'Length (mm)', 'Flow (L/s)', 'Velocity (m/s)', 'Friction (Pa/m)', 'Level', 'Elevation (mm)'], ...m.ducts.map((d) => { const r = ductLoss(d.w, d.h, d.flow); return [d.mark, d.type, d.w, d.h, d.length, d.flow, r.v.toFixed(2), r.paPerM.toFixed(2), d.level, d.elevation] })]
    else if (kind === 'pipe') rows = [['Mark', 'Service', 'DN', 'Length (mm)', 'Flow (L/s)', 'Velocity (m/s)', 'Friction (Pa/m)', 'Material', 'Level'], ...m.pipes.map((p) => { const r = pipeCheck(p.dn, p.flow); return [p.mark, p.service, p.dn, p.length, p.flow, r.v.toFixed(2), r.paPerM.toFixed(0), p.material, p.level] })]
    else if (kind === 'electrical') rows = [['Circuit', 'Panel', 'Load', 'kW', 'Phases', 'Cable (mm2)', 'Breaker (A)', 'Length (m)', 'Current (A)', 'Voltage drop (%)'], ...m.circuits.map((c) => { const r = cableCheck(c.kw, c.phases, c.cable, c.length); return [c.mark, c.panel, c.load, c.kw, c.phases, c.cable, c.breaker, c.length, r.i.toFixed(1), r.vdPct.toFixed(2)] })]
    else rows = [['Element', 'Clashes with', 'Kind', 'Level', 'Overlap (mm)'], ...findClashes(m).map((c) => [c.a, c.b, c.kind, c.level, c.depth])]
    const file = `Villa Riverside - ${t.exportItems[kind].replace(/ \(CSV\)$/, '')}.csv`
    downloadFile(file, csv(rows))
    toast(fmt(t.toast.exported, { file }), 'success')
  }

  const runCheck = () => {
    const m = useMep.getState().doc
    st.set({ checkedAt: Date.now(), bottom: 'clashes' })
    toast(fmt(t.toast.checked, { n: findClashes(m).length, f: designChecks(m).length }), 'success')
  }

  const disc = [
    { key: 'hvac', label: t.disciplines.hvac, icon: <Fan size={19} strokeWidth={1.7} />, width: 163 },
    { key: 'plumbing', label: t.disciplines.plumbing, icon: <PipeIcon size={20} strokeWidth={1.6} />, width: 162 },
    { key: 'electrical', label: t.disciplines.electrical, icon: <Zap size={19} strokeWidth={1.6} />, width: 163 },
    { key: 'coordination', label: t.disciplines.coordination, icon: <Layers size={19} strokeWidth={1.6} />, width: 182 },
  ]

  return (
    <div className={`${s.screen} ${max ? s.max : ''}`}>
      <div className={s.header}>
        <WsHeader
          homeLabel={T.nav.dashboard}
          onHome={() => navigate('dashboard')}
          crumbs={[{ label: t.crumbs.projects, onClick: () => navigate('projects') }, { label: t.crumbs.project, onClick: () => navigate('projects') }]}
          current={t.crumbs.current}
          tabs={disc}
          active={st.discipline}
          big
          crumbsStyle={{ paddingLeft: 8 }}
          tabsStyle={{ left: 248, top: 34 }}
          onTab={(k) => {
            const d = k as typeof st.discipline
            st.set({
              discipline: d,
              schedule: d === 'plumbing' ? 'pipe' : d === 'electrical' ? 'electrical' : d === 'hvac' ? 'duct' : st.schedule,
              bottom: d === 'coordination' ? 'clashes' : 'schedules',
              view: d === 'coordination' ? 'coord' : d,
            })
          }}
          actions={
            <>
              <WsButton icon={<Share size={15} strokeWidth={1.7} />} label={t.share} width={79} onClick={() => toast(t.toast.shareOffline)} />
              <WsButton icon={<ExportToolIcon size={19} strokeWidth={1.5} />} label={t.export} width={104} menu={(['duct', 'pipe', 'electrical', 'clashes'] as const).map((k) => ({ label: t.exportItems[k], onSelect: () => exportCsv(k) }))} />
              <WsButton primary icon={<AiSparkIcon size={19} strokeWidth={1.7} />} label={t.ai} width={130} onClick={() => st.set({ right: 'ai' })} />
            </>
          }
        />
      </div>

      <div className={s.ribbon}>
        <WsRibbon
          top={4}
          seps={[82, 263, 340, 471, 537, 617, 682, 768, 838, 912, 987, 1072]}
          tools={[
            { key: 'select', label: t.tools.select, Icon: MousePointer2, c: 38, w: 69, active: true, onClick: () => st.set({ sel: null }), iconSize: 22 },
            { key: 'duct', label: t.tools.duct, Icon: Box, c: 111, w: 54, onClick: () => st.set({ bottom: 'schedules', schedule: 'duct' }) },
            { key: 'pipe', label: t.tools.pipe, Icon: Cylinder, c: 166, w: 50, onClick: () => st.set({ bottom: 'schedules', schedule: 'pipe' }) },
            { key: 'tray', label: t.tools.cableTray, Icon: Spline, c: 226, w: 70, onClick: () => native(t.tools.cableTray) },
            { key: 'equip', label: t.tools.equipment, Icon: LayoutPanelTop, c: 300, w: 72, onClick: () => st.set({ bottom: 'schedules', schedule: 'equipment' }) },
            { key: 'fixture', label: t.tools.fixture, Icon: Lamp, c: 375, w: 60, onClick: () => native(t.tools.fixture) },
            { key: 'fitting', label: t.tools.fitting, Icon: Wrench, c: 438, w: 58, onClick: () => native(t.tools.fitting) },
            { key: 'terminal', label: t.tools.terminal, Icon: Grid3x3, c: 505, w: 62, onClick: () => native(t.tools.terminal) },
            { key: 'annotation', label: t.tools.annotation, Icon: Type, c: 578, w: 74, onClick: () => native(t.tools.annotation) },
            { key: 'section', label: t.tools.section, Icon: Diamond, c: 650, w: 62, onClick: () => native(t.tools.section) },
            { key: 'dimension', label: t.tools.dimension, Icon: DimensionToolIcon, c: 725, w: 72, onClick: () => native(t.tools.dimension) },
            { key: 'tag', label: t.tools.tag, Icon: TagToolIcon, c: 803, w: 54, onClick: () => native(t.tools.tag) },
            { key: 'schedule', label: t.tools.schedule, Icon: Square, c: 876, w: 66, onClick: () => st.set({ bottom: 'schedules' }) },
            { key: 'filter', label: t.tools.colorFilter, Icon: Filter, c: 952, w: 76, onClick: () => native(t.tools.colorFilter) },
            { key: 'vis', label: t.tools.visibility, Icon: Smartphone, c: 1030, w: 70, onClick: () => native(t.tools.visibility) },
          ]}
          more={{
            c: 1127,
            label: t.tools.more,
            items: [
              { label: t.moreItems.check, onSelect: runCheck },
              { label: t.moreItems.undo, onSelect: () => toast(st.undo() ? fmt(t.toast.undone, { label: '' }) : t.toast.nothing) },
              { label: t.moreItems.redo, onSelect: () => toast(st.redo() ? fmt(t.toast.redone, { label: '' }) : t.toast.nothing) },
              { label: t.moreItems.reset, onSelect: () => { st.reset(); toast(t.toast.reset) } },
            ],
          }}
        />
      </div>

      <div className={s.browser}>
        <MepBrowser />
      </div>
      <div className={s.viewer}>
        <MepViewport max={max} onMax={() => setMax(!max)} clashes={clashes} />
      </div>
      {!max && (
        <div className={s.bottom}>
          <MepBottom clashes={clashes} onCheck={runCheck} onDownload={() => exportCsv(st.schedule === 'equipment' ? 'duct' : st.schedule)} />
        </div>
      )}
      <div className={s.right}>
        <MepRight clashes={clashes} />
      </div>
    </div>
  )
}
