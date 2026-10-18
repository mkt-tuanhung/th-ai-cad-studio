import { useEffect, useMemo, useRef, useState } from 'react'
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
import { pumpScene } from '../../mech/scene'
import { useHost } from '../../services/host'
import { useSceneTools } from '../../components/workspace/sceneTools'
import { NativeScene, type SceneCamera } from '../../components/workspace/NativeScene'
import { PartCamDialog, PartProps, PartTree, PartView, SketchDialog, FeatureDialog } from './PartStudio'
import { blankPart, bracketPart, stockOf, type FeatureKind, type Part } from '../../mech/part'
import { MechBrowser } from './MechBrowser'
import { MechBottom } from './MechBottom'
import { MechRight } from './MechRight'
import { AiAssistModal } from '../../components/ai/AiAssist'
import { FeaDialog } from './FeaDialog'
import { mechAi } from '../../ai/disciplines/mechanical'
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
  const host = useHost()
  const live = !!host && st.mode !== 'realistic'
  const cam = useRef<SceneCamera | null>(null)
  const [askAi, setAskAi] = useState(false)
  const scene = useMemo(() => pumpScene(st.doc, st.exploded ? 140 : 0), [st.doc, st.exploded])
  // camera tools act on the live OCCT view; in the browser they explain that the kernel runs in the desktop app
  const tools = useSceneTools('Centrifugal pump assembly')
  const liveOr = (fn: () => void, label: string) => () => (live && host ? fn() : native(label))
  const camOr = (action: string, label: string, ...args: number[]) => () => (live && cam.current ? cam.current(action, ...args) : native(label))
  // ---- Part Studio
  const onPart = st.tab === 'part'
  const parts = st.doc.parts ?? []
  const partCam = useRef<SceneCamera | null>(null)
  const partTools = useSceneTools('Part')
  const partCtl = partTools.ctl
  const [dims, setDims] = useState<string | null>(null)
  const openPart = (p: Part) => {
    st.edit(`Add ${p.name}`, (m) => ({ ...m, parts: [...(m.parts ?? []), p] }))
    st.set({ tab: 'part', activePart: p.id, partSel: null, partErrors: [], partVolume: null, partBounds: null })
    toast(fmt(t.partStudio.added, { what: p.file }))
  }
  const goPart = () => {
    if (!parts.length) return openPart(bracketPart())
    st.set({ tab: 'part', activePart: st.activePart && parts.some((p) => p.id === st.activePart) ? st.activePart : parts[0].id })
  }
  const partTool = (kind: 'sketch' | FeatureKind) => () => {
    if (!parts.length) openPart(bracketPart())
    else if (!onPart) goPart()
    st.set({ partDialog: { kind } })
  }
  const overall = async () => {
    if (dims) return setDims(null)
    let b: number[] | undefined
    if (host) b = (await (onPart ? partCtl : tools.ctl).current?.command({ cmd: 'bounds', ids: [] }))?.bounds
    else if (onPart) {
      const p = parts.find((x) => x.id === st.activePart)
      const sb = p && stockOf(p, 0, 0)
      if (sb) b = sb
    }
    if (!b) return native(t.tools.dimension)
    setDims(`${(b[3] - b[0]).toFixed(1)} × ${(b[4] - b[1]).toFixed(1)} × ${(b[5] - b[2]).toFixed(1)} mm`)
  }

  const exportStep = async () => {
    if (!host) return native('STEP')
    const r = await host.scene3dExportStep('mech', 'Centrifugal_Pump_Assembly.step')
    if (r.ok) toast(fmt(t.toast.exported, { file: r.path ?? '' }), 'success')
    else if (!r.cancelled) toast(fmt(t.toast.invalid, { why: r.error ?? 'STEP' }), 'warning')
  }

  // v2.4 SP38: glTF binary of the live assembly scene (presentation geometry, never BOM / CNC)
  const exportGlb = async () => {
    if (!host) return native('GLB')
    const r = await host.scene3dExportGlb('mech', 'Centrifugal_Pump_Assembly.glb')
    if (r.ok) toast(fmt(T.render24.glb.saved, { file: r.path ?? '', n: r.nodes ?? 0, m: r.materials?.length ?? 0 }), 'success')
    else if (!r.cancelled) toast(fmt(T.render24.glb.failed, { why: r.error ?? 'GLB' }), 'warning')
  }

  // Browser → datum plane / origin view
  useEffect(() => {
    const r = st.camReq
    if (!r) return
    if (st.tab !== 'assembly') st.set({ tab: 'assembly' })
    if (!live) return native(r.label)
    let tries = 0
    const go = () => (cam.current ? cam.current(r.view) : ++tries < 30 && setTimeout(go, 150))
    go()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.camReq?.n])

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
    else rows = [['Check', 'Result', 'Detail'], ...designChecks(m, useMech.getState().fea).map((c) => [t.checks.names[c.key], c.tone, fmt(t.checks.details[c.key], c.facts)])]
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
          current={onPart ? (parts.find((p) => p.id === st.activePart)?.name ?? t.tabs.part) : t.crumbs.current}
          tabs={[
            { key: 'part', label: t.tabs.part, width: 85 },
            { key: 'assembly', label: t.tabs.assembly, width: 107 },
            { key: 'drawing', label: t.tabs.drawing, width: 96 },
          ]}
          active={st.tab}
          tabsStyle={{ left: 462 }}
          onTab={(k) => (k === 'drawing' ? navigate('cad2d') : k === 'part' ? goPart() : st.set({ tab: 'assembly' }))}
          actions={
            <>
              <WsButton icon={<Share size={15} strokeWidth={1.7} />} label={t.share} width={79} onClick={() => toast(t.toast.shareOffline)} />
              <WsButton icon={<ExportToolIcon size={19} strokeWidth={1.5} />} label={t.export} width={106} menu={[...(['bom', 'params', 'checks'] as const).map((k) => ({ label: t.exportItems[k], onSelect: () => exportCsv(k) })), { label: t.exportItems.step, onSelect: () => void exportStep() }, { label: T.render24.glb.export, onSelect: () => void exportGlb() }]} />
              <WsButton primary icon={<AiSparkIcon size={19} strokeWidth={1.7} />} label={t.ai} width={130} onClick={() => { st.set({ bottom: 'checks' }); setAskAi(true) }} />
            </>
          }
        />
      </div>

      <div className={s.docs}>
        <div className={s.docTab} role="tab" aria-selected={!onPart} onClick={() => st.set({ tab: 'assembly' })}>
          <FileBox size={16} strokeWidth={1.6} />
          <span>{t.file}{st.undoStack.length ? '*' : ''}</span>
          <button type="button" aria-label={t.closeDoc} title={t.closeDoc} onClick={(e) => (e.stopPropagation(), navigate('projects'))}><X size={14} strokeWidth={1.8} /></button>
        </div>
        {parts.map((p) => (
          <div key={p.id} className={s.docTab} role="tab" aria-selected={onPart && st.activePart === p.id} onClick={() => st.set({ tab: 'part', activePart: p.id, partSel: null, partErrors: [], partVolume: null, partBounds: null })}>
            <Box size={15} strokeWidth={1.6} />
            <span>{p.file}</span>
            <button
              type="button"
              aria-label={`${t.closeDoc} ${p.file}`}
              title={t.closeDoc}
              onClick={(e) => {
                e.stopPropagation()
                st.edit(`Close ${p.file}`, (m) => ({ ...m, parts: (m.parts ?? []).filter((x) => x.id !== p.id) }))
                if (st.activePart === p.id) st.set({ tab: 'assembly', activePart: null })
              }}
            >
              <X size={14} strokeWidth={1.8} />
            </button>
          </div>
        ))}
        <button type="button" className={s.docNew} aria-label={t.newDoc} title={t.newDoc} onClick={() => openPart(blankPart(parts.length + 1))}><Plus size={17} strokeWidth={1.7} /></button>
      </div>

      <div className={s.ribbon}>
        <WsRibbon
          top={4}
          seps={[82, 214, 354, 439, 600, 679, 762, 853, 939, 1028, 1105]}
          tools={[
            { key: 'select', label: t.tools.select, Icon: MousePointer2, c: 43, w: 68, active: true, onClick: () => st.set({ partSel: null }), iconSize: 22 },
            {
              key: 'part', label: t.tools.part, Icon: Box, c: 113, w: 54, active: onPart, onClick: () => undefined,
              menu: [
                ...(parts.length ? [{ label: t.tabs.part + ': ' + (parts.find((p) => p.id === st.activePart) ?? parts[0]).file, onSelect: goPart }] : []),
                { label: t.partStudio.sample, onSelect: () => openPart(bracketPart()) },
                { label: t.partStudio.blank, onSelect: () => openPart(blankPart(parts.length + 1)) },
              ],
            },
            { key: 'sketch', label: t.tools.sketch, Icon: Scaling, c: 175, w: 58, onClick: partTool('sketch') },
            { key: 'extrude', label: t.tools.extrude, Icon: Layers, c: 250, w: 62, onClick: partTool('extrude') },
            { key: 'revolve', label: t.tools.revolve, Icon: Disc, c: 318, w: 62, onClick: partTool('revolve') },
            { key: 'hole', label: t.tools.hole, Icon: CircleDot, c: 388, w: 70, onClick: partTool('hole') },
            { key: 'fillet', label: t.tools.fillet, Icon: Circle, c: 484, w: 58, onClick: partTool('fillet') },
            { key: 'chamfer', label: t.tools.chamfer, Icon: Triangle, c: 553, w: 64, onClick: partTool('chamfer') },
            { key: 'pattern', label: t.tools.pattern, Icon: Grid2x2, c: 635, w: 62, onClick: partTool('pattern') },
            { key: 'assembly', label: t.tools.assembly, Icon: Boxes, c: 718, w: 72, onClick: () => st.set({ bottom: 'bom' }) },
            { key: 'constraint', label: t.tools.constraint, Icon: Spline, c: 807, w: 78, onClick: () => st.set({ bottom: 'mates' }) },
            { key: 'explode', label: t.tools.explode, Icon: Move3d, c: 892, w: 64, active: st.exploded, onClick: () => (host ? st.set({ exploded: !st.exploded, mode: st.mode === 'realistic' ? 'shaded' : st.mode }) : native(t.tools.explode)) },
            { key: 'dimension', label: t.tools.dimension, Icon: DimensionToolIcon, c: 977, w: 76, active: !!dims, onClick: () => void overall() },
            { key: 'cam', label: t.tools.cam, Icon: SquareDashed, c: 1067, w: 72, onClick: () => (parts.length ? (goPart(), st.set({ camOpen: true })) : (openPart(bracketPart()), st.set({ camOpen: true }))) },
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
        {onPart ? <PartTree /> : <MechBrowser />}
      </div>

      <div className={s.viewer}>
        {onPart && (
          <Viewport mode="shaded" alt="" label={t.viewer.label}>
            <PartView cam={partCam} mode={st.mode === 'realistic' ? 'shaded' : (st.mode as 'shaded' | 'wireframe' | 'hidden')} sceneTools={partTools.props} />
            {host && <partTools.Chips />}
            {dims && <span className={s.dims} data-testid="overall-dims">{dims}</span>}
            {host && (
              <ToolStrip
                style={{ left: 'calc(50% - 108px)', top: 6 }}
                items={[
                  { label: t.viewer.orbit, icon: <RefreshCcw size={18} strokeWidth={1.7} />, onClick: () => partCam.current?.('home') },
                  { label: t.viewer.pan, icon: <Hand size={18} strokeWidth={1.7} />, on: partTools.tool === 'pan', onClick: () => partTools.toggleTool('pan') },
                  { label: t.viewer.zoom, icon: <ZoomOut size={18} strokeWidth={1.7} />, onClick: () => partCam.current?.('zoom', 400, 300, -2) },
                  { label: t.viewer.fit, icon: <Expand size={17} strokeWidth={1.7} />, onClick: () => partCam.current?.('fit') },
                  { label: t.viewer.snapshot, icon: <Camera size={17} strokeWidth={1.7} />, onClick: () => void partTools.snapshot() },
                  { label: T.view3d.section, icon: <Box size={17} strokeWidth={1.7} />, on: partTools.section.on, onClick: () => partTools.toggleSection([]) },
                ]}
              />
            )}
            {host && <ViewCube style={{ right: 16, top: 22 }} labels={t.viewer.cube} onFace={(f) => partCam.current?.(f)} />}
            <Modes label={t.viewer.modeLabel} style={{ left: 186, bottom: 6 }} value={st.mode} onChange={(m) => st.set({ mode: m })} items={MODES.map((m) => ({ ...m, label: t.viewer.modes[m.key] }))} />
          </Viewport>
        )}
        {!onPart && <Viewport mode={live ? 'shaded' : st.mode} img={live ? undefined : '/assets/v2/mechanical/viewport.png'} alt="Centrifugal pump assembly (DEMO render)" label={t.viewer.label} demo={live ? undefined : { text: host ? t.viewer.demoRealistic : t.viewer.demo, style: { left: 12, top: 12 } }}>
          {dims && <span className={s.dims} data-testid="overall-dims">{dims}</span>}
          {live && host && (
            <NativeScene
              host={host}
              sceneKey="mech"
              scene={scene}
              mode={st.mode as 'shaded' | 'wireframe' | 'hidden'}
              selected={st.sel}
              cameraRef={cam}
              {...tools.props}
              label={t.viewer.label}
              onPick={(id) => st.set({ sel: id, browserSel: `c-${id}`, right: 'properties' })}
              onLoaded={async (r) => {
                const overlap = await host.scene3dCommon('mech', 'impeller', 'casing')
                st.set({ nativeVolumes: r.volumes ?? null, nativeOverlap: overlap >= 0 ? overlap : null })
              }}
            />
          )}
          {live && <tools.Chips />}
          <ToolStrip
            style={{ left: 'calc(50% - 108px)', top: 6 }}
            items={[
              { label: t.viewer.orbit, icon: <RefreshCcw size={18} strokeWidth={1.7} />, onClick: camOr('home', t.viewer.orbit) },
              { label: t.viewer.pan, icon: <Hand size={18} strokeWidth={1.7} />, on: tools.tool === 'pan', onClick: liveOr(() => tools.toggleTool('pan'), t.viewer.pan) },
              { label: t.viewer.zoom, icon: <ZoomOut size={18} strokeWidth={1.7} />, onClick: camOr('zoom', t.viewer.zoom, 400, 300, -2) },
              { label: t.viewer.fit, icon: <Expand size={17} strokeWidth={1.7} />, onClick: camOr('fit', t.viewer.fit) },
              { label: t.viewer.snapshot, icon: <Camera size={17} strokeWidth={1.7} />, onClick: liveOr(tools.snapshot, t.viewer.snapshot) },
              { label: t.viewer.remove, icon: <Trash2 size={17} strokeWidth={1.7} />, onClick: liveOr(() => tools.hide(scene.items.some((i) => i.id === st.sel) ? st.sel : undefined, st.sel), t.viewer.remove) },
              { label: t.viewer.isolate, icon: <Focus size={17} strokeWidth={1.7} />, on: tools.isolated, onClick: liveOr(() => tools.isolate(scene.items.some((i) => i.id === st.sel) ? [st.sel] : []), t.viewer.isolate) },
              { label: t.viewer.settings, icon: <Settings size={17} strokeWidth={1.7} />, onClick: () => st.set({ right: 'display' }) },
            ]}
          />
          <ViewCube style={{ right: 16, top: 22 }} labels={t.viewer.cube} onFace={(f) => (live && cam.current ? cam.current(f) : native(`${t.viewer.cube[f]} view`))} />
          <svg className={s.triad} width="60" height="74" viewBox="0 0 60 74" aria-hidden="true">
            <line x1="12" y1="58" x2="12" y2="14" stroke="#2f6fed" strokeWidth="2" /><text x="8" y="10" fill="#2f6fed">Z</text>
            <line x1="12" y1="58" x2="30" y2="46" stroke="#13a35f" strokeWidth="2" /><text x="31" y="45" fill="#13a35f">Y</text>
            <line x1="12" y1="58" x2="40" y2="70" stroke="#e5383f" strokeWidth="2" /><text x="44" y="73" fill="#e5383f">X</text>
          </svg>
          <Modes label={t.viewer.modeLabel} style={{ left: 186, bottom: 6 }} value={st.mode} onChange={(m) => st.set({ mode: m })} items={MODES.map((m) => ({ ...m, label: t.viewer.modes[m.key] }))} />
        </Viewport>}
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
        {onPart ? <PartProps /> : <MechRight />}
      </div>
      {st.partDialog?.kind === 'sketch' && <SketchDialog id={st.partDialog.id} onClose={() => st.set({ partDialog: null })} />}
      {st.partDialog && st.partDialog.kind !== 'sketch' && <FeatureDialog kind={st.partDialog.kind} id={st.partDialog.id} onClose={() => st.set({ partDialog: null })} />}
      {st.camOpen && <PartCamDialog onClose={() => st.set({ camOpen: false })} />}
      {st.feaOpen && <FeaDialog onClose={() => st.set({ feaOpen: false })} />}
      {askAi && <AiAssistModal d={mechAi} model={st.doc} apply={(label, next) => st.edit(label, () => next)} example={T.aiAssist.examples.mechanical} onClose={() => setAskAi(false)} />}
    </div>
  )
}
