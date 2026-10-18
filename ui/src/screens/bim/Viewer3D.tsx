import { useEffect, useRef, useState, type ReactNode } from 'react'
import { nonStructuralIds } from '../../bim/scene'
import { syncBim3d, type SyncResult } from '../../bim/live3d'
import { frontWalls, lowWallCuts, roomFocus, walkStart } from '../../bim/view3d'
import { lensFromFov, type CameraBookmark, type V3 } from '../../model/bookmark'
import { useLinkedT } from '../../i18n/ws/linked'
import type { BimModel } from '../../bim/model'
import { getHost, isDesktopHost, type HostApi } from '../../services/host'
import { NativeScene, type SceneCamera } from '../../components/workspace/NativeScene'
import { useSceneTools } from '../../components/workspace/sceneTools'
import { useNativeSlot } from '../../lib/useNativeSlot'
import { Box, Camera, ChevronDown, Expand, EyeOff, Focus, Hand, Home, Maximize2, Minimize2, RefreshCcw, ScanSearch, ZoomIn, ZoomOut } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { useBim, type DisplayMode, type View3dMode } from '../../state/bim'
import { toast } from '../../state/toast'
import { CroppedImage } from '../../components/ui/CroppedImage'
import s from './Viewer3D.module.css'

const MODES: DisplayMode[] = ['realistic', 'shaded', 'wireframe', 'hidden']
const VIEW_MODES: View3dMode[] = ['section', 'exterior', 'lowWalls', 'xray', 'walk']

/** A number per model object (the scene reloads / patches when the model object changes). */
const modelIds = new WeakMap<BimModel, number>()
let modelSeq = 0
const modelKey = (m: BimModel) => {
  let k = modelIds.get(m)
  if (!k) modelIds.set(m, (k = ++modelSeq))
  return k
}
const MODE_W: Record<DisplayMode, number> = { realistic: 80, shaded: 80, wireframe: 82, hidden: 92 }
export const SCALES = ['1 : 50', '1 : 100', '1 : 200']

/**
 * 3D viewer slot. In the desktop host (architecture option A) the native OCCT viewer renders here.
 * In the browser the approved render is shown 1:1 at its mockup position and every overlay is a real
 * component placed exactly over the matching area of the render.
 */
export function Viewer3D() {
  const T = useT()
  const t = T.bim.viewer
  const { display, set, level, scale, model, maximized, selection, discipline, viewReq, live3d, setLive3d, focusReq, bookmarks, setBookmarks } = useBim()
  const L = useLinkedT().view3d
  const native = (what: string) => toast(fmt(T.bim.toast.native, { what }))
  const lvl = model.levels.find((l) => l.id === level)
  const slotRef = useRef<HTMLDivElement>(null)
  useNativeSlot(slotRef, 'bim-3d')
  // desktop app: the non-photographic modes show the live OCCT model; "Realistic" keeps the approved render
  const [host, setHost] = useState<HostApi | null>(null)
  useEffect(() => {
    getHost().then(setHost)
  }, [])
  const live = !!host && display !== 'realistic'
  const camRef = useRef<SceneCamera | null>(null)
  const cam = (action: string, a = 0, b = 0, c = 0) => (live && camRef.current ? (camRef.current(action, a, b, c), true) : false)
  const tools = useSceneTools('Villa Riverside - BIM')
  // "3D - Section view" cuts the building 1.5 m above the current level (a dollhouse of that floor); "Exterior" shows it
  // whole; Low walls / See-through / Walkthrough (v2.4) are view-only states on the whole building
  const view3d = live3d.mode
  const setView3d = (v: View3dMode) => setLive3d({ mode: v })
  const cutAt = (lvl?.elevation ?? 0) + 1500
  const boxOn = tools.section.on && tools.section.top === undefined && !tools.section.planes
  const viewSection = (v: View3dMode) => tools.setSection(v === 'section' ? { on: true, around: [], top: cutAt } : { on: false, around: [] })
  useEffect(() => {
    if (!boxOn && !focusOn.current) viewSection(view3d)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view3d, cutAt])
  const focusOn = useRef(false)
  const [sync, setSync] = useState<SyncResult | null>(null)
  const [blocked, setBlocked] = useState('')
  // Project Browser → elevation / section / named 3D view — applied once the scene is loaded (a fresh load
  // resets the camera, e.g. when this view opens from a 2D drawing)
  const [loadedTick, setLoadedTick] = useState(0)
  const applied = useRef(0)
  useEffect(() => {
    if (!viewReq || applied.current === viewReq.n) return
    if (!host) {
      // the host arrives asynchronously in the desktop app; only a plain browser has none
      if (isDesktopHost()) return
      applied.current = viewReq.n
      return native(T.bim.browser.views3d)
    }
    // the approved render is a still: show the live model (elevations / sections read best as hidden line)
    if (display === 'realistic') return set({ display: viewReq.kind === 'elev' || viewReq.kind === 'section' ? 'hidden' : 'shaded' })
    if (!loadedTick) return
    applied.current = viewReq.n
    let tries = 0
    const run = async () => {
      if (!camRef.current) return void (++tries < 40 && setTimeout(run, 150))
      const r = viewReq
      if (r.kind === 'saveView') return saveView()
      if (r.kind === 'bookmark') return restoreView(r.id ?? '')
      if (r.kind === 'home' || r.kind === 'exterior' || r.kind === 'sectionBox') {
        setView3d(r.kind === 'exterior' ? 'exterior' : 'section')
        if (r.kind === 'exterior') viewSection('exterior')
        return camRef.current('home')
      }
      if (r.kind === 'elev') {
        setView3d('exterior')
        viewSection('exterior')
        return camRef.current(r.face!)
      }
      // section: one clip plane through the middle of the building (exact bounds from the kernel)
      const b = (await host.scene3dCommand('bim', JSON.stringify({ cmd: 'bounds' }))).bounds
      if (!b) return
      const plane = r.axis === 'y' ? [0, 1, 0, -(b[1] + b[4]) / 2] : [1, 0, 0, -(b[0] + b[3]) / 2]
      setView3d('exterior')
      tools.setSection({ on: true, around: [], planes: [plane] })
      camRef.current(r.face!)
    }
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewReq?.n, loadedTick, display, host])
  const selId = !selection || selection.category === 'level' || selection.category === 'room' ? '' : selection.category === 'door' ? `leaf:${selection.id}` : selection.category === 'window' ? `glass:${selection.id}` : selection.id
  const liveOr = (fn: () => void, label: string) => () => (live ? fn() : native(label))
  const doorsOpen = live3d.doorsOpen
  const loadKey = `${modelKey(model)}|${doorsOpen ? 1 : 0}`
  // a view command and a new frame (through the scene's control); `query` reads without re-rendering
  const command = (cmd: Record<string, unknown>) => (tools.ctl.current ? tools.ctl.current.command(cmd) : host ? host.scene3dCommand('bim', JSON.stringify(cmd)) : Promise.resolve({ ok: false }))
  const query = (cmd: Record<string, unknown>) => (host ? host.scene3dCommand('bim', JSON.stringify(cmd)) : Promise.resolve({ ok: false }))

  // ── view-only states: low walls (per-wall clip at a height), see-through front walls (per-wall opacity) ──
  const lowKey = view3d === 'lowWalls' ? `${live3d.lowWalls}|${loadKey}` : ''
  useEffect(() => {
    if (!live || !loadedTick) return
    void command({ cmd: 'lowWalls', items: view3d === 'lowWalls' ? lowWallCuts(model, live3d.lowWalls) : {} })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lowKey, live, loadedTick])
  const camSig = useRef('')
  useEffect(() => {
    if (!live || !loadedTick) return
    if (view3d !== 'xray') {
      camSig.current = ''
      void command({ cmd: 'alpha', items: {} })
      return
    }
    // the walls in front follow the camera: re-checked while the view moves
    let stop = false
    const tick = async () => {
      if (stop) return
      const c = (await query({ cmd: 'camFull' })) as unknown as { eye?: V3; at?: V3 }
      const sig = `${c.eye?.map(Math.round)}|${c.at?.map(Math.round)}|${live3d.wallOpacity}|${loadKey}`
      if (c.eye && c.at && sig !== camSig.current) {
        camSig.current = sig
        const ids = frontWalls(model, c.eye, c.at)
        await command({ cmd: 'alpha', items: Object.fromEntries(ids.map((id) => [id, live3d.wallOpacity])) })
      }
      setTimeout(tick, 350)
    }
    void tick()
    return () => {
      stop = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view3d, live3d.wallOpacity, loadKey, live, loadedTick])
  // walkthrough: the eye 1.6 m over the level (the selected room's middle), the walk tool, collision as set
  const walkSet = useRef(false)
  useEffect(() => {
    if (!live || !loadedTick) return
    if (view3d !== 'walk') {
      if (walkSet.current) tools.setTool('orbit')
      walkSet.current = false
      return
    }
    if (walkSet.current) return
    walkSet.current = true
    const st = walkStart(model, level, selection?.category === 'room' ? selection.id : undefined)
    void command({ cmd: 'setCamFull', eye: st.eye, at: st.at, up: [0, 0, 1], fov: 60, ortho: false }).then(() => tools.setTool('walk'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view3d, live, loadedTick])
  useEffect(() => {
    if (tools.tool !== 'walk' && view3d === 'walk' && walkSet.current) setView3d('section')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tools.tool])

  // ── room focus (SP20): camera to the room, its level, a clip box round it ──
  const focusDone = useRef(0)
  useEffect(() => {
    if (!focusReq || focusDone.current === focusReq.n || !live || !loadedTick) return
    focusDone.current = focusReq.n
    const f = roomFocus(model, focusReq.room)
    if (!f) return
    focusOn.current = true
    set({ level: f.level })
    tools.setSection({ on: true, around: [], planes: f.planes })
    void command({ cmd: 'setCamFull', eye: f.eye, at: f.at, up: f.up, fov: f.fov, ortho: false }).then(() => {
      toast(fmt(L.focus, { name: f.name, level: model.levels.find((l) => l.id === f.level)?.name ?? f.level }))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusReq?.n, live, loadedTick])
  useEffect(() => {
    if (!tools.section.planes) focusOn.current = false
  }, [tools.section.planes])

  // ── saved viewpoints (SP17 / V24-015) ──
  const saveView = async () => {
    const c = (await query({ cmd: 'camFull' })) as unknown as { ok: boolean; eye: V3; at: V3; up: V3; fov: number; ortho: boolean }
    if (!c.ok) return
    const n = bookmarks.length + 1
    const b: CameraBookmark = {
      id: `view-${Date.now().toString(36)}`, name: fmt(L.name, { n }), scene: 'bim', eye: c.eye, at: c.at, up: c.up, fov: c.fov, lens: lensFromFov(c.fov), ortho: c.ortho, level,
      visibility: { hidden: tools.hidden, keep: [], discipline, display, view3d, wallOpacity: live3d.wallOpacity, lowWalls: view3d === 'lowWalls' ? live3d.lowWalls : null, doorsOpen },
      section: tools.section.on ? { ...tools.section } : null, revision: model.rev ?? 0, createdAt: Date.now(),
    }
    setBookmarks([...bookmarks, b])
    toast(fmt(L.saved, { name: b.name, rev: b.revision }), 'success')
  }
  const restoreView = async (id: string) => {
    const b = useBim.getState().bookmarks.find((x) => x.id === id)
    if (!b) return
    const v = b.visibility
    set({ level: b.level ?? level, ...(v.discipline ? { discipline: v.discipline as 'architecture' | 'structure' } : {}) })
    setLive3d({ mode: (v.view3d as View3dMode) ?? 'section', ...(v.wallOpacity ? { wallOpacity: v.wallOpacity } : {}), ...(v.lowWalls ? { lowWalls: v.lowWalls } : {}), doorsOpen: !!v.doorsOpen })
    walkSet.current = v.view3d === 'walk'
    if (b.section) {
      focusOn.current = !!b.section.planes
      tools.setSection(b.section)
    } else tools.setSection({ on: false, around: [] })
    // the camera last, after the mode effects have run
    setTimeout(async () => {
      await command({ cmd: 'setCamFull', eye: b.eye, at: b.at, up: b.up, fov: b.fov, ortho: !!b.ortho })
      const now = useBim.getState().model.rev ?? 0
      toast(now === b.revision ? fmt(L.restored, { name: b.name }) : fmt(L.stale, { name: b.name, rev: b.revision, now }), now === b.revision ? 'success' : 'warning')
    }, 250)
  }
  const tool = (label: string, icon: ReactNode, onClick?: () => void, on?: boolean) => (
    <button type="button" className={`${s.tbtn} ${on ? s.tbtnOn : ''}`} aria-label={label} title={label} aria-pressed={on} onClick={onClick ?? (() => native(label))}>
      {icon}
    </button>
  )

  return (
    <div ref={slotRef} className={`${s.viewer} ${s[`m_${display}`]}`} data-native-viewport-slot="bim-3d">
      <svg width="0" height="0" className={s.defs} aria-hidden="true">
        <filter id="bimWire">
          <feColorMatrix type="saturate" values="0" />
          <feConvolveMatrix order="3" kernelMatrix="-1 -1 -1 -1 8 -1 -1 -1 -1" preserveAlpha="true" />
          <feComponentTransfer>
            <feFuncR type="linear" slope="-3" intercept="1" />
            <feFuncG type="linear" slope="-3" intercept="1" />
            <feFuncB type="linear" slope="-3" intercept="1" />
          </feComponentTransfer>
        </filter>
        <filter id="bimHidden">
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncR type="discrete" tableValues="0.2 0.75 1 1" />
            <feFuncG type="discrete" tableValues="0.2 0.75 1 1" />
            <feFuncB type="discrete" tableValues="0.2 0.75 1 1" />
          </feComponentTransfer>
        </filter>
      </svg>
      {live ? (
        <NativeScene
          host={host!}
          sceneKey="bim"
          loader={{
            loadKey,
            run: async () => {
              // incremental: only what this edit made dirty is rebuilt (a full load the first time / on failure)
              const r = await syncBim3d(host!, 'bim', model, { doorsOpen })
              setSync(r)
              return { ok: r.ok, items: r.items, failures: r.failures, ms: r.ms }
            },
          }}
          mode={display as 'shaded' | 'wireframe' | 'hidden'}
          selected={selId}
          cameraRef={camRef}
          onLoaded={() => setLoadedTick((n) => n + 1)}
          {...tools.props}
          hidden={discipline === 'structure' ? [...tools.hidden, ...nonStructuralIds(model)] : tools.hidden}
          label="Villa Riverside — live OCCT model"
          collide={view3d === 'walk' && live3d.collide ? 300 : undefined}
          onWalk={(r) => setBlocked(r.blocked)}
          onPick={(raw) => {
            const id = raw.replace(/:frame$/, '')
            const leaf = id.startsWith('leaf:') ? model.doors.find((x) => x.id === id.slice(5)) : undefined
            if (leaf) return set({ selection: { category: 'door', id: leaf.id } })
            if (model.walls.some((w) => w.id === id)) return set({ selection: { category: 'wall', id } })
            for (const [cat, list] of [['column', model.columns], ['slab', model.slabs], ['stair', model.stairs], ['railing', model.railings], ['component', model.components]] as const)
              if ((list as { id: string }[]).some((x) => x.id === id)) return set({ selection: { category: cat, id } })
            const o = id.startsWith('glass:') ? [...model.doors, ...model.windows].find((x) => x.id === id.slice(6)) : undefined
            if (o) set({ selection: { category: o.category, id: o.id } })
          }}
        />
      ) : (
        <img className={s.render} src="/assets/bim_main_3d_model.png" alt="Villa Riverside — 3D section view" draggable={false} />
      )}

      {live && <tools.Chips />}
      {live && view3d !== 'section' && view3d !== 'exterior' && (
        <div className={s.modeChips} data-testid="view3d-chips">
          {view3d === 'lowWalls' && (
            <span>
              {fmt(L.lowWalls, { h: live3d.lowWalls })}
              <button type="button" aria-label="−" onClick={() => setLive3d({ lowWalls: Math.max(300, live3d.lowWalls - 300) })}>−</button>
              <button type="button" aria-label="+" onClick={() => setLive3d({ lowWalls: Math.min(2700, live3d.lowWalls + 300) })}>+</button>
            </span>
          )}
          {view3d === 'xray' && (
            <span>
              {fmt(L.xray, { p: Math.round(live3d.wallOpacity * 100) })}
              <button type="button" aria-label="−" onClick={() => setLive3d({ wallOpacity: Math.max(0.1, Math.round((live3d.wallOpacity - 0.15) * 100) / 100) })}>−</button>
              <button type="button" aria-label="+" onClick={() => setLive3d({ wallOpacity: Math.min(1, Math.round((live3d.wallOpacity + 0.15) * 100) / 100) })}>+</button>
            </span>
          )}
          {view3d === 'walk' && (
            <span>
              {blocked ? fmt(L.blocked, { what: blocked.replace(/^(leaf|glass):/, '') }) : L.walk}
              <button type="button" aria-pressed={live3d.collide} onClick={() => setLive3d({ collide: !live3d.collide })}>{live3d.collide ? L.collideOn : L.collideOff}</button>
            </span>
          )}
          <span>
            <button type="button" aria-pressed={doorsOpen} onClick={() => setLive3d({ doorsOpen: !doorsOpen })}>{doorsOpen ? L.doorsOpen : L.doorsClosed}</button>
            <button type="button" onClick={() => setView3d('section')}>{L.off}</button>
          </span>
        </div>
      )}
      <label className={s.viewSelect} data-sync={sync?.mode ?? ''} data-rebuilt={sync?.rebuilt?.length ?? ''}>
        <span>{view3d === 'section' ? t.sectionView : L.modes[view3d]}</span>
        <ChevronDown size={15} strokeWidth={1.8} />
        <select aria-label={t.sectionView} value={view3d} onChange={(e) => (live ? setView3d(e.target.value as View3dMode) : native('3D view'))}>
          {VIEW_MODES.map((v) => (
            <option key={v} value={v}>{v === 'section' ? t.sectionView : L.modes[v]}</option>
          ))}
        </select>
      </label>

      <div className={s.toolbar} role="toolbar">
        {tool(t.orbit, <RefreshCcw size={18} strokeWidth={1.7} />, () => cam('home') || native(t.orbit))}
        {tool(t.pan, <Hand size={18} strokeWidth={1.7} />, liveOr(() => tools.toggleTool('pan'), t.pan), tools.tool === 'pan')}
        {tool(t.zoom, <ZoomOut size={18} strokeWidth={1.7} />, () => cam('zoom', 370, 265, -2) || native(t.zoom))}
        {tool(t.fit, <Expand size={17} strokeWidth={1.7} />, () => cam('fit') || native(t.fit))}
        {tool(t.snapshot, <Camera size={17} strokeWidth={1.7} />, liveOr(tools.snapshot, t.snapshot))}
        {tool(t.hide, <EyeOff size={17} strokeWidth={1.7} />, liveOr(() => tools.hide(selId || undefined, selection?.id), t.hide))}
        {tool(t.isolate, <Focus size={17} strokeWidth={1.7} />, liveOr(() => tools.isolate(selId ? [selId] : []), t.isolate), tools.isolated)}
      </div>

      <section className={s.plan}>
        <header className={s.planHead}>
          <span>{fmt(t.planPreview, { level: lvl?.name ?? '' })}</span>
          <button type="button" className={s.planOpen} aria-label={t.openPlan} title={t.openPlan} onClick={() => set({ view: 'plan' })}>
            <Maximize2 size={14} strokeWidth={1.8} />
          </button>
        </header>
        {level === 'L1' ? (
          <CroppedImage className={s.planImg} src="/assets/bim_main_3d_model.png" natW={651} natH={504} crop={{ x: 19, y: 79, w: 205, h: 145 }} alt={fmt(t.planPreview, { level: 'Level 1' })} />
        ) : (
          <div className={`${s.planImg} ${s.planNone}`}>{t.noPlanPreview}</div>
        )}
      </section>

      <div className={s.cube} aria-label="View cube">
        <button type="button" className={s.cubeTop} onClick={() => cam('top') || native(`${t.cube.top} view`)}>{t.cube.top}</button>
        <button type="button" className={s.cubeFront} onClick={() => cam('front') || native(`${t.cube.front} view`)}>{t.cube.front}</button>
        <button type="button" className={s.cubeRight} onClick={() => cam('right') || native(`${t.cube.right} view`)}>{t.cube.right}</button>
      </div>

      <div className={s.nav}>
        {tool(t.home, <Home size={17} strokeWidth={1.6} />, () => cam('home') || set({ display: 'realistic' }))}
        {tool(t.zoomIn, <ZoomIn size={17} strokeWidth={1.6} />, () => cam('zoom', 370, 265, 2) || native(t.zoomIn))}
        {tool(t.zoomRegion, <ScanSearch size={17} strokeWidth={1.6} />, liveOr(() => tools.toggleTool('zoomRegion'), t.zoomRegion), tools.tool === 'zoomRegion')}
        {tool(t.zoomOut, <ZoomOut size={17} strokeWidth={1.6} />, () => cam('zoom', 370, 265, -2) || native(t.zoomOut))}
        {tool(t.box, <Box size={17} strokeWidth={1.6} />, liveOr(() => (boxOn ? viewSection(view3d) : tools.setSection({ on: true, around: selId ? [selId] : [] })), t.box), boxOn)}
      </div>

      <div className={s.modes} role="radiogroup" aria-label="Display mode">
        {MODES.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={display === m} className={`${s.mode} ${display === m ? s.modeOn : ''}`} style={{ width: MODE_W[m] }} onClick={() => set({ display: m })}>
            {t.modes[m]}
          </button>
        ))}
      </div>

      <div className={s.levelBar}>
        <label className={s.sel}>
          <span>{lvl?.name}</span>
          <ChevronDown size={14} strokeWidth={1.8} />
          <select aria-label={t.level} value={level} onChange={(e) => set({ level: e.target.value })}>
            {model.levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className={`${s.sel} ${s.scaleSel}`}>
          <span>{scale}</span>
          <ChevronDown size={14} strokeWidth={1.8} />
          <select aria-label={t.scale} value={scale} onChange={(e) => set({ scale: e.target.value })}>
            {SCALES.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <button type="button" className={s.full} aria-label={maximized ? t.restore : t.fullscreen} title={maximized ? t.restore : t.fullscreen} onClick={() => set({ maximized: !maximized })}>
          {maximized ? <Minimize2 size={16} strokeWidth={1.7} /> : <Expand size={16} strokeWidth={1.7} />}
        </button>
      </div>
    </div>
  )
}
