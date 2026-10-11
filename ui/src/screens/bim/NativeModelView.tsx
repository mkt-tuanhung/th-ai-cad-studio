import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useBim, type DisplayMode } from '../../state/bim'
import type { HostApi } from '../../services/host'
import s from './NativeModelView.module.css'

/**
 * Live OCCT model inside the web layout (desktop app). OCCT renders offscreen; frames arrive as
 * images, so all web overlays (modes, level bar, plan preview, view cube…) stay on top.
 */
export const nativeCamera: { current: ((action: string, a?: number, b?: number, c?: number) => void) | null } = { current: null }

export function NativeModelView({ host, mode }: { host: HostApi; mode: Exclude<DisplayMode, 'realistic'> }) {
  const ref = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState<string>()
  const [ms, setMs] = useState<number>()
  const model = useBim((st) => st.model)
  const selection = useBim((st) => st.selection)
  const busy = useRef(false)
  const dirty = useRef(false)
  const drag = useRef<{ x: number; y: number; pan: boolean } | null>(null)
  const sel = selection?.category === 'wall' ? selection.id : ''

  const frame = async () => {
    const el = ref.current
    if (!el) return
    if (busy.current) {
      dirty.current = true
      return
    }
    busy.current = true
    const dpr = window.devicePixelRatio || 1
    const r = await host.bim3dFrame(Math.round(el.clientWidth * dpr), Math.round(el.clientHeight * dpr), mode, sel)
    busy.current = false
    if (r.ok && r.url) {
      setUrl(r.url)
      setMs(r.ms)
    }
    if (dirty.current) {
      dirty.current = false
      frame()
    }
  }
  const frameRef = useRef(frame)
  frameRef.current = frame

  const camera = (action: string, a = 0, b = 0, c = 0) => {
    host.bim3dCamera(action, a, b, c, 0)
    frameRef.current()
  }
  useEffect(() => {
    nativeCamera.current = camera
    return () => {
      nativeCamera.current = null
    }
  })

  // model edits (type changes, constraints…) rebuild the OCCT solids
  useEffect(() => {
    host.bim3dLoad(JSON.stringify(model)).then(() => frameRef.current())
  }, [host, model])
  useEffect(() => {
    frameRef.current()
  }, [mode, sel])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => frameRef.current())
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const dev = (e: React.PointerEvent | React.WheelEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr }
  }

  return (
    <div
      ref={ref}
      className={s.view}
      data-testid="native-model-view"
      onPointerDown={(e) => {
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        const p = dev(e)
        const pan = e.button === 1 || e.shiftKey
        drag.current = { ...p, pan }
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
      onPointerUp={() => (drag.current = null)}
      onWheel={(e) => {
        const p = dev(e)
        camera('zoom', p.x, p.y, -e.deltaY / 100)
      }}
      onDoubleClick={() => camera('fit')}
    >
      {url && <img className={s.frame} src={url} alt="Villa Riverside — live OCCT model" draggable={false} />}
      {ms !== undefined && <span className={s.badge}>OCCT · {ms.toFixed(0)} ms</span>}
    </div>
  )
}
