import { useEffect } from 'react'
import {
  Box, Boxes, Camera, ChevronDown, Circle, CircleDot, Expand, FileBox, Focus, Grid2x2, Hand, Layers, MousePointer2, Plus, RefreshCcw, Scaling, Settings, Share, Spline,
  SquareDashed, Trash2, Triangle, X, ZoomOut, Disc, Move3d,
} from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { useRouter } from '../../state/router'
import { toast } from '../../state/toast'
import { useMech, type MechMode } from '../../state/mech'
import { undoKeys } from '../../state/undoable'
import { AiSparkIcon, DimensionToolIcon, ExportToolIcon } from '../../components/icons'
import { Modes, ToolStrip, ViewCube, Viewport, WsButton, WsHeader, WsRibbon, csv, downloadFile } from '../../components/workspace/Workspace'
import { designChecks } from '../../mech/model'
import { MechBrowser } from './MechBrowser'
import { MechBottom } from './MechBottom'
import { MechRight } from './MechRight'
import s from './Mechanical.module.css'

const MODES: { key: MechMode; w: number }[] = [
  { key: 'shaded', w: 74 },
  { key: 'wireframe', w: 80 },
  { key: 'hidden', w: 90 },
  { key: 'realistic', w: 76 },
]

/** Mechanical workspace — mockup 11 (assembly). */
export function MechanicalScreen() {
  const T = useT()
  const t = T.mechanical
  const navigate = useRouter((st) => st.navigate)
  const st = useMech()
  const native = (what: string) => toast(fmt(t.toast.native, { what }))

  useEffect(() => {
    const onKey = undoKeys(st.undo, st.redo, (label, redo) => toast(label ? fmt(redo ? t.toast.redone : t.toast.undone, { label }) : t.toast.nothing))
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [st.undo, st.redo, t])

  const exportCsv = (kind: 'bom' | 'params' | 'checks') => {
    const m = useMech.getState().doc
    let rows: (string | number)[][]
    if (kind === 'bom') rows = [['#', 'Part Name', 'Part Number', 'Material', 'Qty'], ...m.bom.map((b) => [b.n, b.name, b.partNo, b.material, b.qty])]
    else if (kind === 'params') rows = [['Name', 'Value', 'Unit', 'Description'], ...m.params.map((p) => [p.name, p.value, p.unit, p.description])]
    else rows = [['Check', 'Result', 'Detail'], ...designChecks(m).map((c) => [t.checks.names[c.key], c.tone, fmt(t.checks.details[c.key], c.facts)])]
    const file = `Centrifugal Pump - ${t.exportItems[kind].replace(/ \(CSV\)$/, '')}.csv`
    downloadFile(file, csv(rows))
    toast(fmt(t.toast.exported, { file }), 'success')
  }

  return (
    <div className={s.screen}>
      <div className={s.header}>
        <WsHeader
          homeLabel={T.nav.dashboard}
          onHome={() => navigate('dashboard')}
          crumbs={[{ label: t.crumbs.projects, onClick: () => navigate('projects') }, { label: t.crumbs.group, onClick: () => navigate('projects') }, { label: t.crumbs.project, onClick: () => navigate('projects') }]}
          current={t.crumbs.current}
          tabs={[
            { key: 'part', label: t.tabs.part, width: 85 },
            { key: 'assembly', label: t.tabs.assembly, width: 107 },
            { key: 'drawing', label: t.tabs.drawing, width: 96 },
          ]}
          active={st.tab}
          tabsStyle={{ left: 462 }}
          onTab={(k) => (k === 'drawing' ? navigate('cad2d') : k === 'part' ? native(t.tabs.part) : st.set({ tab: 'assembly' }))}
          actions={
            <>
              <WsButton icon={<Share size={15} strokeWidth={1.7} />} label={t.share} width={79} onClick={() => toast(t.toast.shareOffline)} />
              <WsButton icon={<ExportToolIcon size={19} strokeWidth={1.5} />} label={t.export} width={106} menu={(['bom', 'params', 'checks'] as const).map((k) => ({ label: t.exportItems[k], onSelect: () => exportCsv(k) }))} />
              <WsButton primary icon={<AiSparkIcon size={19} strokeWidth={1.7} />} label={t.ai} width={130} onClick={() => st.set({ bottom: 'checks' })} />
            </>
          }
        />
      </div>

      <div className={s.docs}>
        <div className={s.docTab} role="tab" aria-selected="true">
          <FileBox size={16} strokeWidth={1.6} />
          <span>{t.file}{st.undoStack.length ? '*' : ''}</span>
          <button type="button" aria-label={t.closeDoc} title={t.closeDoc} onClick={() => navigate('projects')}><X size={14} strokeWidth={1.8} /></button>
        </div>
        <button type="button" className={s.docNew} aria-label={t.newDoc} title={t.newDoc} onClick={() => native(t.newDoc)}><Plus size={17} strokeWidth={1.7} /></button>
      </div>

      <div className={s.ribbon}>
        <WsRibbon
          top={4}
          seps={[82, 214, 354, 439, 600, 679, 762, 853, 939, 1028, 1105]}
          tools={[
            { key: 'select', label: t.tools.select, Icon: MousePointer2, c: 43, w: 68, active: true, onClick: () => undefined, iconSize: 22 },
            { key: 'part', label: t.tools.part, Icon: Box, c: 113, w: 54, onClick: () => native(t.tools.part) },
            { key: 'sketch', label: t.tools.sketch, Icon: Scaling, c: 175, w: 58, onClick: () => native(t.tools.sketch) },
            { key: 'extrude', label: t.tools.extrude, Icon: Layers, c: 250, w: 62, onClick: () => native(t.tools.extrude) },
            { key: 'revolve', label: t.tools.revolve, Icon: Disc, c: 318, w: 62, onClick: () => native(t.tools.revolve) },
            { key: 'hole', label: t.tools.hole, Icon: CircleDot, c: 388, w: 70, onClick: () => native(t.tools.hole) },
            { key: 'fillet', label: t.tools.fillet, Icon: Circle, c: 484, w: 58, onClick: () => native(t.tools.fillet) },
            { key: 'chamfer', label: t.tools.chamfer, Icon: Triangle, c: 553, w: 64, onClick: () => native(t.tools.chamfer) },
            { key: 'pattern', label: t.tools.pattern, Icon: Grid2x2, c: 635, w: 62, onClick: () => native(t.tools.pattern) },
            { key: 'assembly', label: t.tools.assembly, Icon: Boxes, c: 718, w: 72, onClick: () => st.set({ bottom: 'bom' }) },
            { key: 'constraint', label: t.tools.constraint, Icon: Spline, c: 807, w: 78, onClick: () => st.set({ bottom: 'mates' }) },
            { key: 'explode', label: t.tools.explode, Icon: Move3d, c: 892, w: 64, onClick: () => native(t.tools.explode) },
            { key: 'dimension', label: t.tools.dimension, Icon: DimensionToolIcon, c: 977, w: 76, onClick: () => native(t.tools.dimension) },
            { key: 'cam', label: t.tools.cam, Icon: SquareDashed, c: 1067, w: 72, onClick: () => native(t.tools.cam) },
          ]}
          more={{ c: 1189, label: t.tools.more, items: [
            { label: t.moreItems.undo, onSelect: () => toast(st.undo() ? fmt(t.toast.undone, { label: '' }) : t.toast.nothing) },
            { label: t.moreItems.redo, onSelect: () => toast(st.redo() ? fmt(t.toast.redone, { label: '' }) : t.toast.nothing) },
            { label: t.moreItems.reset, onSelect: () => { st.reset(); toast(t.toast.reset) } },
          ] }}
        />
        <ChevronDown size={13} strokeWidth={2} className={s.holeCaret} aria-hidden="true" />
      </div>

      <div className={s.browser}>
        <MechBrowser />
      </div>

      <div className={s.viewer}>
        <Viewport mode={st.mode} img="/assets/v2/mechanical/viewport.png" alt="Centrifugal pump assembly (DEMO render)" label={t.viewer.label} demo={{ text: t.viewer.demo, style: { left: 12, top: 12 } }}>
          <ToolStrip
            style={{ left: 'calc(50% - 108px)', top: 6 }}
            items={[
              { label: t.viewer.orbit, icon: <RefreshCcw size={18} strokeWidth={1.7} />, onClick: () => native(t.viewer.orbit) },
              { label: t.viewer.pan, icon: <Hand size={18} strokeWidth={1.7} />, onClick: () => native(t.viewer.pan) },
              { label: t.viewer.zoom, icon: <ZoomOut size={18} strokeWidth={1.7} />, onClick: () => native(t.viewer.zoom) },
              { label: t.viewer.fit, icon: <Expand size={17} strokeWidth={1.7} />, onClick: () => native(t.viewer.fit) },
              { label: t.viewer.snapshot, icon: <Camera size={17} strokeWidth={1.7} />, onClick: () => native(t.viewer.snapshot) },
              { label: t.viewer.remove, icon: <Trash2 size={17} strokeWidth={1.7} />, onClick: () => native(t.viewer.remove) },
              { label: t.viewer.isolate, icon: <Focus size={17} strokeWidth={1.7} />, onClick: () => native(t.viewer.isolate) },
              { label: t.viewer.settings, icon: <Settings size={17} strokeWidth={1.7} />, onClick: () => st.set({ right: 'display' }) },
            ]}
          />
          <ViewCube style={{ right: 16, top: 22 }} labels={t.viewer.cube} onFace={(f) => native(`${t.viewer.cube[f]} view`)} />
          <svg className={s.triad} width="60" height="74" viewBox="0 0 60 74" aria-hidden="true">
            <line x1="12" y1="58" x2="12" y2="14" stroke="#2f6fed" strokeWidth="2" /><text x="8" y="10" fill="#2f6fed">Z</text>
            <line x1="12" y1="58" x2="30" y2="46" stroke="#13a35f" strokeWidth="2" /><text x="31" y="45" fill="#13a35f">Y</text>
            <line x1="12" y1="58" x2="40" y2="70" stroke="#e5383f" strokeWidth="2" /><text x="44" y="73" fill="#e5383f">X</text>
          </svg>
          <Modes label={t.viewer.modeLabel} style={{ left: 186, bottom: 6 }} value={st.mode} onChange={(m) => st.set({ mode: m })} items={MODES.map((m) => ({ ...m, label: t.viewer.modes[m.key] }))} />
        </Viewport>
      </div>

      <div className={s.btabs} role="tablist">
        {(['parameters', 'bom', 'mates', 'checks'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={st.bottom === k} className={st.bottom === k ? s.btabOn : undefined} onClick={() => st.set({ bottom: k })}>{t.bottom[k]}</button>
        ))}
      </div>

      <div className={s.cards}>
        <MechBottom onExport={exportCsv} />
      </div>

      <div className={s.right}>
        <MechRight />
      </div>
    </div>
  )
}
