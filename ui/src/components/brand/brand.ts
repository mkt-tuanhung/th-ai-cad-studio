/**
 * MD CAD AI STUDIO brand: name, the fixed credit line and the local assets (public/assets/branding, made from
 * the approved logo by tools/make-branding.py — crops and a dark-background variant, never redrawn).
 */
export const BRAND = {
  name: 'MD CAD AI STUDIO',
  /** Must appear exactly like this in the app intro and the installer intro. Never translated or edited. */
  credit: 'Xây dựng và phát triển bởi Minh Dũng',
  version: '0.1.0',
} as const

const B = '/assets/branding/'
export const BRAND_ASSETS = {
  logo: B + 'md-logo.png', // full lockup for light backgrounds
  logoDark: B + 'md-logo-dark.png', // full lockup for dark backgrounds
  monogram: B + 'md-monogram.png',
  monogramDark: B + 'md-monogram-dark.png',
  wordmark: B + 'md-wordmark.png',
  wordmarkDark: B + 'md-wordmark-dark.png',
  wordmarkText: B + 'md-wordmark-text.png', // letters only, for small sizes
  wordmarkTextDark: B + 'md-wordmark-text-dark.png',
  appIcon: B + 'md-app-icon-1024.png',
} as const

/** Monogram crop size (px) — the SVG construction lines of the intro use this coordinate system. */
export const MONOGRAM_SIZE = { w: 1152, h: 712 } as const
