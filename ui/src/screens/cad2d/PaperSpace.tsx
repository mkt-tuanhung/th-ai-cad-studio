import { useLayoutEffect, useRef, useState } from 'react'
import type { CadDocument } from '../../cad/types'
import { fmt, useT } from '../../i18n'
import { useCad } from '../../state/cad'
import { DrawingSvg } from './DrawingSvg'
import { zoomExtentsView } from './ModelViewport'
import s from './PaperSpace.module.css'

/** Layout tab: ISO A3 sheet with one viewport showing model space (read-only preview). */
export function PaperSpace({ doc, sheet }: { doc: CadDocument; sheet: string }) {
  const t = useT()
  const scale = useCad((st) => st.scale)
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const W = e.contentRect.width * 0.9
      const H = e.contentRect.height * 0.9
      const k = Math.min(W / 420, H / 297)
      setBox({ w: Math.round(420 * k), h: Math.round(297 * k) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const vpW = Math.round(box.w * 0.92)
  const vpH = Math.round(box.h * 0.78)
  return (
    <div ref={ref} className={s.paper}>
      {box.w > 0 && (
        <div className={s.sheet} style={{ width: box.w, height: box.h }}>
          <div className={s.vp} style={{ width: vpW, height: vpH }}>
            <DrawingSvg doc={doc} view={zoomExtentsView(doc, vpW, vpH)} width={vpW} height={vpH} />
          </div>
          <div className={s.title}>
            <strong>{doc.name.replace(/\.(dwg|dxf)$/i, '')}</strong>
            <span>{fmt(t.cad.sheets.paper, { name: sheet })}</span>
            <span>{scale}</span>
          </div>
        </div>
      )}
    </div>
  )
}
