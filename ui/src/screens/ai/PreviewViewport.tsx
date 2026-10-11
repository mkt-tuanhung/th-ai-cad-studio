import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Expand, Hand, Rotate3d, Scan, ZoomIn, ZoomOut } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { createProposalDocument, PREVIEW_VIEW } from '../../ai/sampleSession'
import { DrawingSvg, projector } from '../cad2d/DrawingSvg'
import { zoomExtentsView } from '../cad2d/ModelViewport'
import type { ViewState } from '../../state/cad'
import s from './PreviewViewport.module.css'

/**
 * Read-only proposal viewer (same renderer as CAD 2D). Pan with the hand tool, middle button or
 * space-drag; wheel / pinch zooms about the cursor.
 */
export function PreviewViewport({ option, name, hasPreview, compact }: { option: number; name: string; hasPreview: boolean; compact?: boolean }) {
  const t = useT().ai
  const doc = useMemo(() => (hasPreview ? createProposalDocument(0) : null), [hasPreview])
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<ViewState>(PREVIEW_VIEW)
  const [hand, setHand] = useState(true)
  const drag = useRef<{ x: number; y: number; c: { x: number; y: number } } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // keep the approved framing at mockup size, fit otherwise
  const fitted = useRef(false)
  useEffect(() => {
    if (!doc || fitted.current || size.w === 0) return
    fitted.current = true
    if (size.w < 520 || size.h < 375) setView(zoomExtentsView(doc, size.w, size.h))
  }, [doc, size])

  const zoomBy = (k: number, at?: { x: number; y: number }) =>
    setView((v) => {
      const q = at ?? { x: size.w / 2, y: size.h / 2 }
      const P = projector(v, size.w, size.h)
      const a = P.toWorld(q.x, q.y)
      const mm = Math.min(Math.max(v.mmPerPx * k, 2), 400)
      return { mmPerPx: mm, center: { x: a.x - (q.x - size.w / 2) * mm, y: a.y + (q.y - size.h / 2) * mm } }
    })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      if (!e.ctrlKey && (Math.abs(e.deltaX) > 0 || !Number.isInteger(e.deltaY))) {
        setView((v) => ({ ...v, center: { x: v.center.x + e.deltaX * v.mmPerPx, y: v.center.y - e.deltaY * v.mmPerPx } }))
        return
      }
      zoomBy(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), { x: e.clientX - r.left, y: e.clientY - r.top })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  const label = fmt(t.planLabel, { n: option, name })

  return (
    <div className={`${s.panel} ${compact ? s.compact : ''}`}>
      <div
        ref={ref}
        className={`${s.canvas} ${hand ? s.handMode : ''}`}
        onPointerDown={(e) => {
          if (!doc || (e.button !== 1 && !(e.button === 0 && hand))) return
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, y: e.clientY, c: view.center }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          setView((v) => ({ ...v, center: { x: d.c.x - (e.clientX - d.x) * v.mmPerPx, y: d.c.y + (e.clientY - d.y) * v.mmPerPx } }))
        }}
        onPointerUp={() => (drag.current = null)}
      >
        {doc && size.w > 0 && <DrawingSvg doc={doc} view={view} width={size.w} height={size.h} />}
        {!doc && <p className={s.none}>{t.noPreview}</p>}
      </div>
      <div className={s.label}>
        <Scan size={15} strokeWidth={1.7} className={s.labelIcon} />
        {label}
      </div>
      {!compact && (
        <div className={s.tools} role="toolbar">
          <button type="button" className={`${s.tool} ${hand ? s.toolOn : ''}`} aria-pressed={hand} aria-label={t.tools.pan} title={t.tools.pan} onClick={() => setHand(!hand)}>
            <Hand size={18} strokeWidth={1.6} />
          </button>
          <button type="button" className={s.tool} aria-label={t.tools.zoomOut} title={t.tools.zoomOut} disabled={!doc} onClick={() => zoomBy(1.25)}>
            <ZoomOut size={18} strokeWidth={1.6} />
          </button>
          <button type="button" className={s.tool} aria-label={t.tools.zoomIn} title={t.tools.zoomIn} disabled={!doc} onClick={() => zoomBy(0.8)}>
            <ZoomIn size={18} strokeWidth={1.6} />
          </button>
          <button type="button" className={s.tool} aria-label={t.tools.fit} title={t.tools.fit} disabled={!doc} onClick={() => doc && setView(zoomExtentsView(doc, size.w, size.h))}>
            <Expand size={18} strokeWidth={1.6} />
          </button>
          <button type="button" className={s.tool} aria-label={t.tools.frame} title={t.tools.frame} disabled={!doc} onClick={() => setView(PREVIEW_VIEW)}>
            <Scan size={18} strokeWidth={1.6} />
          </button>
          <button type="button" className={s.tool} aria-label={t.tools.view3d} title={t.tools.view3d} disabled>
            <Rotate3d size={18} strokeWidth={1.6} />
          </button>
        </div>
      )}
    </div>
  )
}
