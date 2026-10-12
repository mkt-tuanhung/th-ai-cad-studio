import { Box, Camera, Expand, EyeOff, Focus, Hand, Home, Minimize2, RefreshCcw, ScanSearch, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { fmt, useT } from '../../i18n'
import { toast } from '../../state/toast'
import { useMep, type MepMode } from '../../state/mep'
import { LEVELS, type Clash, type LevelId } from '../../mep/model'
import { clashIds, mepScene, type MepView } from '../../mep/scene'
import { NativeScene, type SceneCamera } from '../../components/workspace/NativeScene'
import { useHost } from '../../services/host'
import { useSceneTools } from '../../components/workspace/sceneTools'
import { Modes, Select, ToolStrip, ViewCube, Viewport, wsStyles as w } from '../../components/workspace/Workspace'

const MODES: { key: MepMode; w: number }[] = [
  { key: 'realistic', w: 76 },
  { key: 'shaded', w: 68 },
  { key: 'wireframe', w: 82 },
  { key: 'hidden', w: 92 },
]

/**
 * MEP 3D view. In the desktop app (Shaded / Wireframe / Hidden Line) it is the live OCCT model of the
 * current level — ducts, pipes, beams, clashing elements in red; Realistic and the plain browser show the
 * DEMO coordination render (badged).
 */
export function MepViewport({ max, onMax, clashes }: { max: boolean; onMax: () => void; clashes: Clash[] }) {
  const T = useT()
  const t = T.mep.viewer
  const { mode, view, level, scale, set, doc, sel, colorBy, hiddenCats, section } = useMep()
  const native = (what: string) => toast(fmt(T.mep.toast.native, { what }))
  const host = useHost()
  const live = !!host && mode !== 'realistic'
  const cam = useRef<SceneCamera | null>(null)
  const clashing = useMemo(() => new Set(clashIds(clashes, level)), [clashes, level])
  const scene = useMemo(() => mepScene(doc, level, view as MepView, { colorBy, clashing, hidden: hiddenCats }), [doc, level, view, colorBy, clashing, hiddenCats])
  const nativeOverlaps = useMep((st) => st.nativeOverlaps)
  const hi = useMemo(() => {
    const ids = new Set(clashIds(clashes, level))
    if (nativeOverlaps?.level === level) for (const p of nativeOverlaps.pairs) ids.add(p.a).add(p.b)
    return [...ids]
  }, [clashes, level, nativeOverlaps])
  const tools = useSceneTools(`Villa Riverside - MEP L${level.slice(1)}`)
  const selId = sel && sel.kind !== 'circuit' && sel.kind !== 'equipment' && sel.kind !== 'annotation' && sel.kind !== 'section' ? sel.id : ''
  // a section line from the plan: a 1.2 m slice along it, seen from its side
  const sec = doc.sections.find((x) => x.id === section)
  useEffect(() => {
    if (!sec) {
      if (tools.section.planes) tools.setSection({ on: false, around: [] })
      return
    }
    const L = Math.hypot(sec.b[0] - sec.a[0], sec.b[1] - sec.a[1]) || 1
    const u = [(sec.b[0] - sec.a[0]) / L, (sec.b[1] - sec.a[1]) / L], n = [-u[1], u[0]]
    const dot = (v: number[], p: number[]) => v[0] * p[0] + v[1] * p[1]
    tools.setSection({ on: true, around: [], planes: [[n[0], n[1], 0, 600 - dot(n, sec.a)], [-n[0], -n[1], 0, 600 + dot(n, sec.a)], [u[0], u[1], 0, 500 - dot(u, sec.a)], [-u[0], -u[1], 0, 500 + dot(u, sec.b)]] })
    const z = (LEVELS.find((l) => l.id === level)?.elev ?? 0) + 1800
    const mid = [(sec.a[0] + sec.b[0]) / 2, (sec.a[1] + sec.b[1]) / 2]
    const id = setTimeout(() => tools.ctl.current?.command({ cmd: 'camera', eye: [mid[0] - n[0] * (L + 6000), mid[1] - n[1] * (L + 6000), z], at: [mid[0], mid[1], z], fov: 40 }), 300)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, sec?.a[0], sec?.a[1], sec?.b[0], sec?.b[1], level])
  // "Remove section box" on the chip also clears the plan's active section
  const wasOn = useRef(false)
  useEffect(() => {
    if (wasOn.current && !tools.section.on && section) set({ section: null })
    wasOn.current = tools.section.on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tools.section.on])
  const liveOr = (fn: () => void, label: string) => () => (live && host ? fn() : native(label))
  const camOr = (action: string, label: string, ...args: number[]) => () => (live && cam.current ? cam.current(action, ...args) : native(label))
  const lv = (id: LevelId) => fmt(t.levelName, { n: id.slice(1) })
  return (
    <Viewport
      mode={live ? 'shaded' : mode}
      img={live ? undefined : '/assets/v2/mep/viewport.png'}
      alt="Villa Riverside — MEP coordination (DEMO render)"
      label={t.label}
      demo={live ? undefined : { text: host ? t.demoRealistic : t.demo, style: { left: 12, bottom: 52 } }}
    >
      {live && host && (
        <NativeScene
          host={host}
          sceneKey="mep"
          scene={scene}
          mode={mode as 'shaded' | 'wireframe' | 'hidden'}
          selected={selId}
          highlighted={hi}
          cameraRef={cam}
          {...tools.props}
          label={t.label}
          onLoaded={async () => {
            // exact clash check of everything drawn; beam–beam joints at the grid are structure, not clashes
            const pairs = (await host.scene3dOverlaps('mep')).filter((p) => !(p.a.startsWith('B-') && p.b.startsWith('B-')) && !p.a.startsWith('slab:') && !p.b.startsWith('slab:'))
            set({ nativeOverlaps: { level, pairs } })
          }}
          onPick={(id) => {
            if (doc.ducts.some((d) => d.id === id)) set({ sel: { kind: 'duct', id }, right: 'properties' })
            else if (doc.pipes.some((p) => p.id === id)) set({ sel: { kind: 'pipe', id }, right: 'properties' })
            else
              for (const [kind, list] of [['tray', doc.trays], ['fixture', doc.fixtures], ['terminal', doc.terminals], ['fitting', doc.fittings]] as const)
                if ((list as { id: string }[]).some((x) => x.id === id)) return set({ sel: { kind, id }, right: 'properties' })
          }}
        />
      )}
      {live && <tools.Chips />}
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
          { label: t.orbit, icon: <RefreshCcw size={18} strokeWidth={1.7} />, onClick: camOr('home', t.orbit) },
          { label: t.pan, icon: <Hand size={18} strokeWidth={1.7} />, on: tools.tool === 'pan', onClick: liveOr(() => tools.toggleTool('pan'), t.pan) },
          { label: t.zoom, icon: <ZoomOut size={18} strokeWidth={1.7} />, onClick: camOr('zoom', t.zoom, 400, 300, -2) },
          { label: t.fit, icon: <Expand size={17} strokeWidth={1.7} />, onClick: camOr('fit', t.fit) },
          { label: t.snapshot, icon: <Camera size={17} strokeWidth={1.7} />, onClick: liveOr(tools.snapshot, t.snapshot) },
          { label: t.hide, icon: <EyeOff size={17} strokeWidth={1.7} />, onClick: liveOr(() => (tools.hide(selId || undefined), selId && set({ sel: null })), t.hide) },
          { label: t.isolate, icon: <Focus size={17} strokeWidth={1.7} />, on: tools.isolated, onClick: liveOr(() => tools.isolate(selId ? [selId] : hi), t.isolate) },
        ]}
      />
      <ViewCube style={{ right: 12, top: 18 }} labels={t.cube} onFace={(f) => (live && cam.current ? cam.current(f) : native(`${t.cube[f]} view`))} />
      <ToolStrip
        vertical
        style={{ right: 8, top: 108 }}
        items={[
          { label: t.home, icon: <Home size={17} strokeWidth={1.6} />, onClick: () => (live && cam.current ? cam.current('home') : set({ mode: 'realistic' })) },
          { label: t.zoomIn, icon: <ZoomIn size={17} strokeWidth={1.6} />, onClick: camOr('zoom', t.zoomIn, 400, 300, 2) },
          { label: t.zoomRegion, icon: <ScanSearch size={17} strokeWidth={1.6} />, on: tools.tool === 'zoomRegion', onClick: liveOr(() => tools.toggleTool('zoomRegion'), t.zoomRegion) },
          { label: t.zoomOut, icon: <ZoomOut size={17} strokeWidth={1.6} />, onClick: camOr('zoom', t.zoomOut, 400, 300, -2) },
          { label: t.box, icon: <Box size={17} strokeWidth={1.6} />, on: tools.section.on, onClick: liveOr(() => tools.toggleSection(selId ? [selId] : hi), t.box) },
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
