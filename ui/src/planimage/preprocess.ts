/**
 * Picture → ink mask for the plan recogniser: grey, paper-white normalisation (a photo's shadow gradient divided
 * out), 3 × 3 median (JPEG / sensor noise), contrast stretch, Otsu threshold, speckle removal. Pure.
 */
import { despeckle, grayOf, inkMask, median3, normalizeBackground, otsuOf, stretch, type Gray, type Mask } from './raster'

export interface PrepOptions {
  /** divide out uneven light / shadows (phone photos) */
  normalize: boolean
  /** 3 × 3 median before thresholding */
  denoise: boolean
}

export const DEFAULT_PREP: PrepOptions = { normalize: true, denoise: true }

export function inkOf(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, opt: PrepOptions = DEFAULT_PREP): { gray: Gray; ink: Mask; threshold: number } {
  let g = grayOf(rgba, w, h)
  if (opt.normalize) g = normalizeBackground(g)
  if (opt.denoise) g = median3(g)
  g = stretch(g)
  // Otsu on a white page with thin lines can sit high in the paper's noise: never above 200
  const threshold = Math.min(200, otsuOf(g))
  const ink = despeckle(inkMask(g, threshold), 4)
  // the picture's border (scanner edge, the paper's edge after a warp) is not ink
  for (let x = 0; x < w; x++) { ink.d[x] = 0; ink.d[(h - 1) * w + x] = 0 }
  for (let y = 0; y < h; y++) { ink.d[y * w] = 0; ink.d[y * w + w - 1] = 0 }
  return { gray: g, ink, threshold }
}
