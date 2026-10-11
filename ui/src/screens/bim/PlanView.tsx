import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { useBim } from '../../state/bim'
import { useCad, type ViewState } from '../../state/cad'
import { createVillaDocument } from '../../cad/seed'
import { DrawingSvg, projector } from '../cad2d/DrawingSvg'
import { zoomExtentsView } from '../cad2d/ModelViewport'
import s from './PlanView.module.css'

/** Plan view: the project's Level 1 drawing (same document as CAD 2D), read-only, pan/zoom. */
export function PlanView() {
  const t = useT().bim.viewer
  const level = useBim((st) => st.level)
  const cadDoc = useCad((st) => st.docs['villa-riverside-floor-plan'])
  const doc = useMemo(() => cadDoc ?? createVillaDocument(0), [cadDoc])
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<ViewState | null>(null)
  const drag = useRef<{ x: number; y: number; c: { x: number; y: number } } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    if (size.w && !view) setView(zoomExtentsView(doc, size.w, size.h))
  }, [size, view, doc])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      setView((v) => {
        if (!v) return v
        const q = { x: e.clientX - r.left, y: e.clientY - r.top }
        const a = projector(v, r.width, r.height).toWorld(q.x, q.y)
        const mm = Math.min(Math.max(v.mmPerPx * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), 1), 500)
        return { mmPerPx: mm, center: { x: a.x - (q.x - r.width / 2) * mm, y: a.y + (q.y - r.height / 2) * mm } }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div
      ref={ref}
      className={s.plan}
      data-native-viewport-slot="bim-plan"
      onPointerDown={(e) => {
        if (!view) return
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, y: e.clientY, c: view.center }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        setView((v) => v && { ...v, center: { x: d.c.x - (e.clientX - d.x) * v.mmPerPx, y: d.c.y + (e.clientY - d.y) * v.mmPerPx } })
      }}
      onPointerUp={() => (drag.current = null)}
      onDoubleClick={() => setView(zoomExtentsView(doc, size.w, size.h))}
    >
      {level === 'L1' ? (
        view && size.w > 0 && <DrawingSvg doc={doc} view={view} width={size.w} height={size.h} />
      ) : (
        <p className={s.none}>{t.noPlanPreview}</p>
      )}
    </div>
  )
}
