import type { CSSProperties } from 'react'
import s from './CroppedImage.module.css'

export interface CroppedImageProps {
  src: string
  alt: string
  /** Natural size of the asset in px. */
  natW: number
  natH: number
  /** Clean region inside the asset (handoff crops carry bleed from neighbouring mockup elements). */
  crop: { x: number; y: number; w: number; h: number }
  className?: string
  style?: CSSProperties
}

/**
 * Shows only `crop` of an asset, scaled uniformly (never distorted) to cover the box and anchored
 * top-left — the crop's top-left matches the mockup slot's top-left.
 */
export function CroppedImage({ src, alt, natW, natH, crop, className, style }: CroppedImageProps) {
  const vars = {
    '--nw': natW,
    '--nh': natH,
    '--cx': crop.x,
    '--cy': crop.y,
    '--cw': crop.w,
    '--ch': crop.h,
  } as CSSProperties
  return (
    <div className={`${s.wrap} ${className ?? ''}`} style={style}>
      <img className={s.img} style={vars} src={src} alt={alt} draggable={false} />
    </div>
  )
}
