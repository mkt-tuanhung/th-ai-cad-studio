import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { HostApi } from '../../services/host'
import type { Scene } from '../../engine3d/scene'
import { useT } from '../../i18n'
import type { SceneTool } from './sceneTools'
import s from './NativeScene.module.css'

export interface SceneLoad {
  ok: boolean
  items?: number
  failures?: number
  ms?: number
  volumes?: Record<string, number>
  /** Feature-part build messages: "item: feature: reason". */
  errors?: string[]
}

/** Camera commands for toolbars outside the view (Home / Fit / presets / zoom). */
export type SceneCamera = (action: string, a?: number, b?: number, c?: number) => void

/** View commands for toolbars outside the view (see HostBridge::scene3dCommand). */
export interface SceneCtl {
  command: (cmd: Record<string, unknown>) => Promise<Awaited<ReturnType<HostApi['scene3dCommand']>>>
  /** PNG of the current view at `scale` × the on-screen device pixels. */
  snapshot: (scale?: number) => Promise<Awaited<ReturnType<HostApi['scene3dCommand']>>>
}

/**
 * Live OCCT scene (desktop app). The native engine builds exact solids from `scene`, renders offscreen and
 * ships frames as images, so every web overlay stays on top. Drag = orbit, Shift/middle-drag = pan,
 * wheel = zoom, click = pick (exact ray–face intersection), double-click = fit.
 * Tools: pan (drag pans), zoomRegion (drag a rectangle → window fit), walk (first person: WASD / arrows,
 * drag to look, wheel forward / back). `hidden` items are not drawn or picked; `section` clips the view
 * to a capped box.
 */
export function NativeScene({
  host,
  sceneKey,
  scene,
  loader,
  mode,
  selected,
  highlighted,
  onPick,
  onLoaded,
  cameraRef,
  ctlRef,
  tool = 'orbit',
  onToolDone,
  hidden,
  keep,
  onVisible,
  section,
  label,
}: {
  host: HostApi
  sceneKey: string
  /** Primitives to build — or `loader` builds the scene another way (BIM building); `loadKey` changes trigger a rebuild. */
  scene?: Scene
  loader?: { loadKey: string; run: () => Promise<SceneLoad> }
  mode: 'shaded' | 'wireframe' | 'hidden' | 'clay'
  selected?: string
  highlighted?: string[]
  onPick?: (id: string) => void
  onLoaded?: (r: SceneLoad) => void
  cameraRef?: { current: SceneCamera | null }
  ctlRef?: { current: SceneCtl | null }
  tool?: SceneTool
  onToolDone?: () => void
  hidden?: string[]
  /** Isolate: only these are drawn (empty = all). */
  keep?: string[]
  /** Items drawn after hide / isolate. */
  onVisible?: (n: number) => void
  section?: { on: boolean; around: string[]; top?: number; planes?: number[][] }
  label: string
}) {
  const t = useT().view3d
  const ref = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState<string>()
  const [stats, setStats] = useState<{ build?: number; frame?: number; items?: number }>({})
  const [rect, setRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const busy = useRef(false)
  const dirty = useRef(false)
  const loaded = useRef(false)
  const drag = useRef<{ x: number; y: number; x0: number; y0: number; pan: boolean } | null>(null)
  const hi = (highlighted ?? []).join(',')

  const frame = async () => {
    const el = ref.current
    if (!el) return
    if (busy.current) {
      dirty.current = true
      return
    }
    busy.current = true
    const dpr = window.devicePixelRatio || 1
    const r = await host.scene3dFrame(sceneKey, Math.round(el.clientWidth * dpr), Math.round(el.clientHeight * dpr), mode, selected ?? '', hi)
    busy.current = false
    if (r.ok && r.url) {
      setUrl(r.url)
      setStats((st) => ({ ...st, frame: r.ms }))
    }
    if (dirty.current) {
      dirty.current = false
      frame()
    }
  }
  const frameRef = useRef(frame)
  frameRef.current = frame

  const camera: SceneCamera = (action, a = 0, b = 0, c = 0) => {
    host.scene3dCamera(sceneKey, action, a, b, c)
    frameRef.current()
  }
  const command: SceneCtl['command'] = async (cmd) => {
    const r = await host.scene3dCommand(sceneKey, JSON.stringify(cmd))
    if (cmd.cmd !== 'bounds' && cmd.cmd !== 'snapshot') frameRef.current()
    return r
  }
  const snapshot: SceneCtl['snapshot'] = async (scale = 2) => {
    const el = ref.current
    const dpr = window.devicePixelRatio || 1
    const w = Math.min(8192, Math.round((el?.clientWidth ?? 960) * dpr * scale)), h = Math.min(8192, Math.round((el?.clientHeight ?? 540) * dpr * scale))
    const r = await command({ cmd: 'snapshot', w, h })
    frameRef.current() // the snapshot render resized the offscreen view
    return r
  }
  useEffect(() => {
    if (cameraRef) cameraRef.current = camera
    if (ctlRef) ctlRef.current = { command, snapshot }
    return () => {
      if (cameraRef) cameraRef.current = null
      if (ctlRef) ctlRef.current = null
    }
  })

  // view state that the engine forgets when the scene is rebuilt
  const hiddenKey = (hidden ?? []).join(',') + '|' + (keep ?? []).join(',')
  const sectionKey = section?.on ? `on:${section.around.join(',')}:${section.top ?? ''}:${JSON.stringify(section.planes ?? '')}` : ''
  const applyView = async () => {
    const r = await host.scene3dCommand(sceneKey, JSON.stringify({ cmd: 'hide', ids: hidden ?? [], keep: keep ?? [] }))
    if (r.visible !== undefined) onVisible?.(r.visible)
    if (section?.on && section.planes) await host.scene3dCommand(sceneKey, JSON.stringify({ cmd: 'clip', planes: section.planes }))
    else await host.scene3dCommand(sceneKey, JSON.stringify({ cmd: 'section', on: !!section?.on, around: section?.around ?? [], ...(section?.top !== undefined ? { top: section.top } : {}) }))
  }
  const applyRef = useRef(applyView)
  applyRef.current = applyView

  const json = loader ? loader.loadKey : JSON.stringify(scene ?? { items: [] })
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  useEffect(() => {
    let live = true
    ;(loaderRef.current ? loaderRef.current.run() : host.scene3dLoad(sceneKey, json)).then(async (r) => {
      if (!live) return
      loaded.current = true
      setStats((st) => ({ ...st, build: r.ms, items: r.items }))
      await applyRef.current()
      onLoaded?.(r)
      frameRef.current()
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, sceneKey, json])
  useEffect(() => {
    if (!loaded.current) return
    applyRef.current().then(() => frameRef.current())
  }, [hiddenKey, sectionKey])
  useEffect(() => {
    frameRef.current()
  }, [mode, selected, hi])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => frameRef.current())
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    if (tool === 'walk') ref.current?.focus()
  }, [tool])

  const dev = (e: React.PointerEvent | React.WheelEvent | React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr, cx: e.clientX - r.left, cy: e.clientY - r.top }
  }
  const walk = (forward: number, right: number, yaw = 0, pitch = 0) => command({ cmd: 'walk', forward, right, yaw, pitch })
  const hint = tool === 'pan' ? t.pan : tool === 'zoomRegion' ? t.zoomRegion : tool === 'walk' ? t.walk : ''

  return (
    <div
      ref={ref}
      className={`${s.view} ${tool === 'pan' ? s.pan : tool === 'zoomRegion' ? s.region : tool === 'walk' ? s.walk : ''}`}
      data-testid="native-scene"
      data-tool={tool}
      aria-label={label}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && tool !== 'orbit') return onToolDone?.()
        if (tool !== 'walk') return
        const step = e.shiftKey ? 1500 : 400
        const k = e.key.toLowerCase()
        const mv: Record<string, [number, number, number]> = { w: [step, 0, 0], arrowup: [step, 0, 0], s: [-step, 0, 0], arrowdown: [-step, 0, 0], a: [0, -step, 0], d: [0, step, 0], arrowleft: [0, 0, 8], arrowright: [0, 0, -8] }
        const m = mv[k]
        if (!m) return
        e.preventDefault()
        walk(m[0], m[1], m[2])
      }}
      onPointerDown={(e) => {
        try {
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        } catch {
          // synthetic events (QA scripts) have no active pointer
        }
        const p = dev(e)
        const pan = tool === 'pan' || e.button === 1 || e.shiftKey
        drag.current = { ...p, x0: p.x, y0: p.y, pan }
        if (tool === 'zoomRegion') setRect({ x0: p.cx, y0: p.cy, x1: p.cx, y1: p.cy })
        else if (!pan && tool !== 'walk') camera('orbitStart', p.x, p.y)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const p = dev(e)
        if (tool === 'zoomRegion') setRect((r) => (r ? { ...r, x1: p.cx, y1: p.cy } : r))
        else if (tool === 'walk') walk(0, 0, -(p.x - d.x) * 0.15, -(p.y - d.y) * 0.15)
        else if (d.pan) camera('pan', p.x - d.x, p.y - d.y)
        else camera('orbit', p.x, p.y)
        drag.current = { ...d, x: p.x, y: p.y }
      }}
      onPointerUp={async (e) => {
        const d = drag.current
        drag.current = null
        if (!d) return
        const p = dev(e)
        if (tool === 'zoomRegion') {
          setRect(null)
          if (Math.hypot(p.x - d.x0, p.y - d.y0) >= 8) {
            await command({ cmd: 'window', x0: Math.round(d.x0), y0: Math.round(d.y0), x1: Math.round(p.x), y1: Math.round(p.y) })
            onToolDone?.()
          }
          return
        }
        if (!onPick) return
        // a click (not a drag): pick the solid under the cursor
        if (Math.hypot(p.x - d.x0, p.y - d.y0) < 4) {
          const id = await host.scene3dPick(sceneKey, Math.round(p.x), Math.round(p.y))
          if (id) onPick(id)
        }
      }}
      onWheel={(e) => {
        const p = dev(e)
        if (tool === 'walk') walk(-Math.sign(e.deltaY) * 300, 0)
        else camera('zoom', p.x, p.y, -e.deltaY / 100)
      }}
      onDoubleClick={() => tool === 'orbit' && camera('fit')}
    >
      {url && <img className={s.frame} src={url} alt={label} draggable={false} />}
      {rect && <span className={s.rect} style={{ left: Math.min(rect.x0, rect.x1), top: Math.min(rect.y0, rect.y1), width: Math.abs(rect.x1 - rect.x0), height: Math.abs(rect.y1 - rect.y0) }} />}
      {hint && (
        <span className={s.hint} data-testid="scene-tool-hint">
          {hint}
          <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => onToolDone?.()}>{t.done}</button>
        </span>
      )}
      <span className={s.badge}>
        OCCT · {stats.items ?? 0} solids · build {Math.round(stats.build ?? 0)} ms · frame {Math.round(stats.frame ?? 0)} ms
      </span>
    </div>
  )
}
