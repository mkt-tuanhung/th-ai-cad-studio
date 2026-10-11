import { Box, Camera, Expand, EyeOff, Focus, Hand, Home, Minimize2, RefreshCcw, ScanSearch, ZoomIn, ZoomOut } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { toast } from '../../state/toast'
import { useMep, type MepMode } from '../../state/mep'
import { LEVELS, type LevelId } from '../../mep/model'
import { Modes, Select, ToolStrip, ViewCube, Viewport, wsStyles as w } from '../../components/workspace/Workspace'

const MODES: { key: MepMode; w: number }[] = [
  { key: 'realistic', w: 76 },
  { key: 'shaded', w: 68 },
  { key: 'wireframe', w: 82 },
  { key: 'hidden', w: 92 },
]

/** MEP 3D view: DEMO coordination render (badged) with real controls; the native MEP engine is not connected. */
export function MepViewport({ max, onMax }: { max: boolean; onMax: () => void }) {
  const T = useT()
  const t = T.mep.viewer
  const { mode, view, level, scale, set } = useMep()
  const native = (what: string) => toast(fmt(T.mep.toast.native, { what }))
  const lv = (id: LevelId) => fmt(t.levelName, { n: id.slice(1) })
  return (
    <Viewport mode={mode} img="/assets/v2/mep/viewport.png" alt="Villa Riverside — MEP coordination (DEMO render)" label={t.label} demo={{ text: t.demo, style: { left: 12, bottom: 52 } }}>
      <Select
        label={t.camera}
        value={view}
        onChange={(v) => set({ view: v, discipline: v === 'coord' ? 'coordination' : (v as 'hvac' | 'plumbing' | 'electrical'), browserSel: `v-${v}` })}
        options={(['coord', 'hvac', 'plumbing', 'electrical'] as const).map((v) => ({ value: v, label: t.views[v] }))}
        style={{ left: 9, top: 10, width: 160 }}
      />
      <ToolStrip
        style={{ left: 272, top: 9 }}
        items={[
          { label: t.orbit, icon: <RefreshCcw size={18} strokeWidth={1.7} />, onClick: () => native(t.orbit) },
          { label: t.pan, icon: <Hand size={18} strokeWidth={1.7} />, onClick: () => native(t.pan) },
          { label: t.zoom, icon: <ZoomOut size={18} strokeWidth={1.7} />, onClick: () => native(t.zoom) },
          { label: t.fit, icon: <Expand size={17} strokeWidth={1.7} />, onClick: () => native(t.fit) },
          { label: t.snapshot, icon: <Camera size={17} strokeWidth={1.7} />, onClick: () => native(t.snapshot) },
          { label: t.hide, icon: <EyeOff size={17} strokeWidth={1.7} />, onClick: () => native(t.hide) },
          { label: t.isolate, icon: <Focus size={17} strokeWidth={1.7} />, onClick: () => native(t.isolate) },
        ]}
      />
      <ViewCube style={{ right: 12, top: 18 }} labels={t.cube} onFace={(f) => native(`${t.cube[f]} view`)} />
      <ToolStrip
        vertical
        style={{ right: 8, top: 108 }}
        items={[
          { label: t.home, icon: <Home size={17} strokeWidth={1.6} />, onClick: () => set({ mode: 'realistic' }) },
          { label: t.zoomIn, icon: <ZoomIn size={17} strokeWidth={1.6} />, onClick: () => native(t.zoomIn) },
          { label: t.zoomRegion, icon: <ScanSearch size={17} strokeWidth={1.6} />, onClick: () => native(t.zoomRegion) },
          { label: t.zoomOut, icon: <ZoomOut size={17} strokeWidth={1.6} />, onClick: () => native(t.zoomOut) },
          { label: t.box, icon: <Box size={17} strokeWidth={1.6} />, onClick: () => native(t.box) },
        ]}
      />
      <Modes label={t.modeLabel} style={{ left: 7, bottom: 11 }} value={mode} onChange={(m) => set({ mode: m })} items={MODES.map((m) => ({ ...m, label: t.modes[m.key] }))} />
      <div className={w.levelBar} style={{ right: 5, bottom: 11, width: 222 }}>
        <Select label={t.level} value={level} onChange={(v) => set({ level: v as LevelId })} options={LEVELS.map((l) => ({ value: l.id, label: lv(l.id) }))} style={{ width: 79, paddingLeft: 2 }} />
        <Select label={t.scale} value={scale} onChange={(v) => set({ scale: v })} options={['1 : 50', '1 : 100', '1 : 200'].map((x) => ({ value: x, label: x }))} style={{ width: 95 }} />
        <button type="button" className={w.tbtn} style={{ width: 28 }} aria-label={max ? t.restore : t.fullscreen} title={max ? t.restore : t.fullscreen} onClick={onMax}>
          {max ? <Minimize2 size={16} strokeWidth={1.7} /> : <Expand size={16} strokeWidth={1.7} />}
        </button>
      </div>
    </Viewport>
  )
}
