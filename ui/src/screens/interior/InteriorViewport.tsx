import { Box, Camera, Expand, Focus, Hand, Home, Maximize2, Minimize2, RefreshCcw, ScanSearch, Trash2, ZoomIn, ZoomOut } from 'lucide-react'
import { useMemo, useRef } from 'react'
import { fmt, useT } from '../../i18n'
import { toast } from '../../state/toast'
import { useInterior, type InteriorMode } from '../../state/interior'
import { Modes, Select, ToolStrip, Viewport, wsStyles as w } from '../../components/workspace/Workspace'
import { NativeScene, type SceneCamera, type SceneLoad } from '../../components/workspace/NativeScene'
import { useHost } from '../../services/host'
import { interiorScene, interiorSceneId } from '../../interior/scene'
import s from './Interior.module.css'

const MODES: { key: InteriorMode; w: number }[] = [
  { key: 'realistic', w: 77 },
  { key: 'shaded', w: 70 },
  { key: 'wireframe', w: 79 },
  { key: 'hidden', w: 88 },
]

/**
 * Interior 3D view. In the desktop app (Shaded / Wireframe / Hidden Line) it is the live OCCT model built
 * from the rooms, furniture and parametric cabinets; Realistic — and the plain browser — show the
 * approved DEMO render, clearly badged.
 */
export function InteriorViewport({ max, onMax, onLoaded }: { max: boolean; onMax: () => void; onLoaded?: (r: SceneLoad) => void }) {
  const T = useT()
  const t = T.interior.viewer
  const { mode, view, level, scale, sel, doc, edit, set } = useInterior()
  const native = (what: string) => toast(fmt(T.interior.toast.native, { what }))
  const host = useHost()
  const live = !!host && mode !== 'realistic'
  const cam = useRef<SceneCamera | null>(null)
  const scene = useMemo(() => interiorScene(doc), [doc])
  const camOr = (action: string, label: string, ...args: number[]) => () => (live && cam.current ? cam.current(action, ...args) : native(label))
  const removeSel = () => {
    if (sel?.kind !== 'item') return native(t.remove)
    const it = doc.items.find((i) => i.id === sel.id)
    if (!it) return
    edit(`Remove ${it.name}`, (d) => ({ ...d, items: d.items.filter((i) => i.id !== it.id) }))
    set({ sel: null })
    toast(fmt(T.interior.toast.removed, { name: it.name }))
  }
  return (
    <Viewport
      mode={live ? 'shaded' : mode}
      img={live ? undefined : '/assets/v2/interior/viewport.png'}
      alt="Villa Riverside — living room (DEMO render)"
      label={t.label}
      demo={live ? undefined : { text: host ? t.demoRealistic : t.demo, style: { right: 52, bottom: 50 } }}
    >
      {live && host && (
        <NativeScene
          host={host}
          sceneKey="interior"
          scene={scene}
          mode={mode as 'shaded' | 'wireframe' | 'hidden'}
          selected={interiorSceneId(doc, sel)}
          cameraRef={cam}
          label={t.label}
          onLoaded={onLoaded}
          onPick={(id) => {
            const rid = id.startsWith('room:') || id.startsWith('walls:') ? id.split(':')[1] : null
            if (rid) return set({ sel: { kind: 'room', id: rid }, room: rid, browserSel: `room-${rid}`, right: 'properties' })
            set({ sel: { kind: 'item', id }, right: 'properties' })
          }}
        />
      )}
      <Select
        label={t.camera}
        value={view}
        onChange={(v) => (v === 'perspective' ? set({ view: v }) : native(t.views[v as 'exploded' | 'walk']))}
        options={(['perspective', 'exploded', 'walk'] as const).map((v) => ({ value: v, label: t.views[v] }))}
        style={{ left: 15, top: 12, width: 146 }}
      />
      <ToolStrip
        style={{ left: 271, top: 10 }}
        items={[
          { label: t.orbit, icon: <RefreshCcw size={18} strokeWidth={1.7} />, onClick: camOr('home', t.orbit) },
          { label: t.pan, icon: <Hand size={18} strokeWidth={1.7} />, onClick: () => native(t.pan) },
          { label: t.zoom, icon: <ZoomOut size={18} strokeWidth={1.7} />, onClick: camOr('zoom', t.zoom, 400, 300, -2) },
          { label: t.fit, icon: <Expand size={17} strokeWidth={1.7} />, onClick: camOr('fit', t.fit) },
          { label: t.snapshot, icon: <Camera size={17} strokeWidth={1.7} />, onClick: () => native(t.snapshot) },
          { label: t.remove, icon: <Trash2 size={17} strokeWidth={1.7} />, onClick: removeSel },
          { label: t.isolate, icon: <Focus size={17} strokeWidth={1.7} />, onClick: () => native(t.isolate) },
        ]}
      />
      <section className={`${w.inset} ${s.inset}`}>
        <header className={w.insetHead}>
          <span>{t.inset}</span>
          <button type="button" className={w.insetBtn} aria-label={t.openPlan} title={t.openPlan} onClick={() => native(t.openPlan)}>
            <Maximize2 size={13} strokeWidth={1.8} />
          </button>
        </header>
        <img className={s.insetImg} src="/assets/v2/interior/plan-inset.png" alt={t.inset} draggable={false} />
      </section>
      <ToolStrip
        vertical
        style={{ right: 6, top: 85 }}
        items={[
          { label: t.home, icon: <Home size={17} strokeWidth={1.6} />, onClick: () => (live && cam.current ? cam.current('home') : set({ mode: 'realistic' })) },
          { label: t.zoomIn, icon: <ZoomIn size={17} strokeWidth={1.6} />, onClick: camOr('zoom', t.zoomIn, 400, 300, 2) },
          { label: t.zoomRegion, icon: <ScanSearch size={17} strokeWidth={1.6} />, onClick: () => native(t.zoomRegion) },
          { label: t.zoomOut, icon: <ZoomOut size={17} strokeWidth={1.6} />, onClick: camOr('zoom', t.zoomOut, 400, 300, -2) },
          { label: t.box, icon: <Box size={17} strokeWidth={1.6} />, onClick: () => native(t.box) },
        ]}
      />
      <Modes label={t.modeLabel} style={{ left: 6, bottom: 6 }} value={mode} onChange={(m) => set({ mode: m })} items={MODES.map((m) => ({ ...m, label: t.modes[m.key] }))} />
      <div className={w.levelBar} style={{ right: 5, bottom: 6, width: 231 }}>
        <Select label={t.level} value={level} onChange={(v) => set({ level: v })} options={[{ value: 'L1', label: t.level1 }]} style={{ width: 81, paddingLeft: 6 }} />
        <Select label={t.scale} value={scale} onChange={(v) => set({ scale: v })} options={['1 : 20', '1 : 50', '1 : 100'].map((x) => ({ value: x, label: x }))} style={{ width: 90 }} />
        <button type="button" className={w.tbtn} style={{ width: 30 }} aria-label={max ? t.restore : t.fullscreen} title={max ? t.restore : t.fullscreen} onClick={onMax}>
          {max ? <Minimize2 size={16} strokeWidth={1.7} /> : <Expand size={16} strokeWidth={1.7} />}
        </button>
      </div>
    </Viewport>
  )
}
