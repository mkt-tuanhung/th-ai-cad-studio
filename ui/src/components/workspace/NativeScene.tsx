import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { HostApi } from '../../services/host'
import type { Scene } from '../../engine3d/scene'
import s from './NativeScene.module.css'

export interface SceneLoad {
  ok: boolean
  items?: number
  failures?: number
  ms?: number
  volumes?: Record<string, number>
}

/** Camera commands for toolbars outside the view (Home / Fit / presets / zoom). */
export type SceneCamera = (action: string, a?: number, b?: number, c?: number) => void

/**
 * Live OCCT scene (desktop app). The native engine builds exact solids from `scene`, renders offscreen and
 * ships frames as images, so every web overlay stays on top. Drag = orbit, Shift/middle-drag = pan,
 * wheel = zoom, click = pick (exact ray–face intersection), double-click = fit.
 */
export function NativeScene({
  host,
  sceneKey,
  scene,
  mode,
  selected,
  highlighted,
  onPick,
  onLoaded,
  cameraRef,
  label,
}: {
  host: HostApi
  sceneKey: string
  scene: Scene
  mode: 'shaded' | 'wireframe' | 'hidden' | 'clay'
  selected?: string
  highlighted?: string[]
  onPick?: (id: string) => void
  onLoaded?: (r: SceneLoad) => void
  cameraRef?: { current: SceneCamera | null }
  label: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState<string>()
  const [stats, setStats] = useState<{ build?: number; frame?: number; items?: number }>({})
  const busy = useRef(false)
  const dirty = useRef(false)
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
  useEffect(() => {
    if (!cameraRef) return
    cameraRef.current = camera
    return () => {
      cameraRef.current = null
    }
  })

  const json = JSON.stringify(scene)
  useEffect(() => {
    let live = true
    host.scene3dLoad(sceneKey, json).then((r) => {
      if (!live) return
      setStats((st) => ({ ...st, build: r.ms, items: r.items }))
      onLoaded?.(r)
      frameRef.current()
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, sceneKey, json])
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

  const dev = (e: React.PointerEvent | React.WheelEvent | React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr }
  }

  return (
    <div
      ref={ref}
      className={s.view}
      data-testid="native-scene"
      aria-label={label}
      onPointerDown={(e) => {
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        const p = dev(e)
        const pan = e.button === 1 || e.shiftKey
        drag.current = { ...p, x0: p.x, y0: p.y, pan }
        if (!pan) camera('orbitStart', p.x, p.y)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const p = dev(e)
        if (d.pan) camera('pan', p.x - d.x, p.y - d.y)
        else camera('orbit', p.x, p.y)
        drag.current = { ...d, x: p.x, y: p.y }
      }}
      onPointerUp={async (e) => {
        const d = drag.current
        drag.current = null
        if (!d || !onPick) return
        const p = dev(e)
        // a click (not a drag): pick the solid under the cursor
        if (Math.hypot(p.x - d.x0, p.y - d.y0) < 4) {
          const id = await host.scene3dPick(sceneKey, Math.round(p.x), Math.round(p.y))
          if (id) onPick(id)
        }
      }}
      onWheel={(e) => {
        const p = dev(e)
        camera('zoom', p.x, p.y, -e.deltaY / 100)
      }}
      onDoubleClick={() => camera('fit')}
    >
      {url && <img className={s.frame} src={url} alt={label} draggable={false} />}
      <span className={s.badge}>
        OCCT · {stats.items ?? 0} solids · build {Math.round(stats.build ?? 0)} ms · frame {Math.round(stats.frame ?? 0)} ms
      </span>
    </div>
  )
}
