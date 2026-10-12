import { BRAND, BRAND_ASSETS } from './brand'
import s from './BrandLogo.module.css'

/**
 * The MD CAD AI STUDIO logo from the approved artwork. `variant`: full lockup, monogram only, wordmark only,
 * or the horizontal lockup used in the sidebar (monogram + wordmark). `tone`: the background it sits on.
 */
export function BrandLogo({ variant = 'full', tone = 'light', height, className }: { variant?: 'full' | 'monogram' | 'wordmark' | 'horizontal' | 'stacked'; tone?: 'light' | 'dark'; height?: number; className?: string }) {
  const dark = tone === 'dark'
  if (variant === 'stacked') {
    // the logo's own lockup (monogram over the name) at a small size: the name uses the letters-only crop
    const h = height ?? 40
    return (
      <span className={`${s.stacked} ${className ?? ''}`} role="img" aria-label={BRAND.name}>
        <img src={dark ? BRAND_ASSETS.monogramDark : BRAND_ASSETS.monogram} alt="" draggable={false} style={{ height: h }} />
        <img src={dark ? BRAND_ASSETS.wordmarkTextDark : BRAND_ASSETS.wordmarkText} alt="" draggable={false} style={{ height: h * 0.37 }} />
      </span>
    )
  }
  if (variant === 'horizontal') {
    const h = height ?? 34
    return (
      <span className={`${s.horizontal} ${className ?? ''}`} role="img" aria-label={BRAND.name}>
        <img src={dark ? BRAND_ASSETS.monogramDark : BRAND_ASSETS.monogram} alt="" draggable={false} style={{ height: h }} />
        <img src={dark ? BRAND_ASSETS.wordmarkDark : BRAND_ASSETS.wordmark} alt="" draggable={false} style={{ height: h * 0.42 }} />
      </span>
    )
  }
  const src = {
    full: dark ? BRAND_ASSETS.logoDark : BRAND_ASSETS.logo,
    monogram: dark ? BRAND_ASSETS.monogramDark : BRAND_ASSETS.monogram,
    wordmark: dark ? BRAND_ASSETS.wordmarkDark : BRAND_ASSETS.wordmark,
  }[variant]
  return <img className={`${s.img} ${className ?? ''}`} src={src} alt={BRAND.name} draggable={false} style={height ? { height } : undefined} />
}
