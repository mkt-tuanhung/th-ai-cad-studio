import { memo, useMemo } from 'react'
import type { CadDocument, Entity } from '../../cad/types'
import { createBlankDocument } from '../../cad/seed'
import { DrawingSvg } from '../cad2d/DrawingSvg'
import { zoomExtentsView } from '../cad2d/ModelViewport'
import type { LibComponent } from '../../library/catalog'

/** A throw-away document so the CAD renderer can draw library geometry (thumbnails / previews). */
export function shapesDoc(entities: Entity[], color = '#374151'): CadDocument {
  const d = createBlankDocument('preview', 0)
  d.layers = [{ name: '0', color, visible: true, locked: false, linetype: 'Continuous', lineweight: 0.25 }]
  d.currentLayer = '0'
  d.entities = entities.map((e, i) => ({ ...e, id: `p${i}`, layer: '0', color: 'ByLayer' }))
  return d
}

/** Vector drawing of entities fitted into w × h (same renderer as CAD 2D). */
export const ShapesView = memo(function ShapesView({ entities, w, h, pad = 0.82 }: { entities: Entity[]; w: number; h: number; pad?: number }) {
  const doc = useMemo(() => shapesDoc(entities), [entities])
  const view = useMemo(() => {
    const v = zoomExtentsView(doc, w, h)
    return { ...v, mmPerPx: v.mmPerPx / pad * 0.92 }
  }, [doc, w, h, pad])
  return <DrawingSvg doc={doc} view={view} width={w} height={h} />
})

/** Card thumbnail: DEMO product photo when the component has one, else its plan geometry. */
export function ComponentThumb({ comp, w, h, className }: { comp: LibComponent; w: number; h: number; className?: string }) {
  const plan = useMemo(() => comp.plan?.() ?? [], [comp])
  if (comp.photo) return <img className={className} src={comp.photo} alt="" draggable={false} style={{ objectFit: 'contain' }} />
  if (comp.group === 'materials' && comp.material)
    return comp.material.image
      ? <img className={className} src={comp.material.image} alt="" style={{ objectFit: 'cover' }} />
      : <div className={className} style={{ background: comp.material.color }} />
  return <div className={className}><ShapesView entities={plan} w={w} h={h} /></div>
}
