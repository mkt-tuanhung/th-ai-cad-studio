/**
 * Colour palette of reference photos (v2.4 "Ảnh mẫu → phong cách"): k-means in CIE Lab over the pixels of 1–5 photos,
 * computed by code (never by the AI model), deterministic (seeded k-means++), with what each colour is in the photo:
 *   - share of the pixels, mean height in the frame (walls sit high, floors low), local texture (mean luminance
 *     gradient: wood grain, brick, fabric weave are "busy", paint is flat);
 *   - a role guessed from those numbers: wall, floor, wood, accent, metal, textile.
 * Pure: the page draws each photo into a small canvas and passes the RGBA pixels.
 */
export interface Pixels {
  data: ArrayLike<number>
  w: number
  h: number
}

export type PaletteRole = 'wall' | 'floor' | 'wood' | 'textile' | 'accent' | 'metal' | 'stone' | 'ceiling'
export const PALETTE_ROLES: PaletteRole[] = ['wall', 'floor', 'wood', 'textile', 'accent', 'metal', 'stone', 'ceiling']

export interface Swatch {
  hex: string
  rgb: [number, number, number]
  lab: [number, number, number]
  /** Share of the sampled pixels (0…1). */
  share: number
  /** Mean vertical position (0 = top of the frame, 1 = bottom). */
  y: number
  /** Share of its pixels in the top 40 % / bottom 35 % of the frame. */
  top: number
  bottom: number
  /** Mean luminance gradient of its pixels (0 = flat paint, > 12 = grain / brick / weave). */
  texture: number
}
export type RoleSwatch = Swatch & { role: PaletteRole }

/* ------------------------------------------------------------------ colour maths */

const srgbToLin = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const fLab = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)

/** sRGB (0…255) → CIE Lab (D65). */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = srgbToLin(r), G = srgbToLin(g), B = srgbToLin(b)
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883
  const fx = fLab(x), fy = fLab(y), fz = fLab(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

export const hexOf = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
export function rgbOfHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [128, 128, 128]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
export const labOfHex = (hex: string) => rgbToLab(...rgbOfHex(hex))
/** CIE76 colour difference (good enough to pick the nearest finish). */
export const deltaE = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
export const chroma = (lab: readonly number[]) => Math.hypot(lab[1], lab[2])

/** Seeded PRNG (mulberry32): the same photos always give the same palette. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ------------------------------------------------------------------ k-means */

interface Sample {
  lab: [number, number, number]
  rgb: [number, number, number]
  y: number
  grad: number
}

/** Pixels of the photos, sub-sampled to at most `max` samples in total (each photo weighs the same). */
function samples(images: Pixels[], max = 24000): Sample[] {
  const out: Sample[] = []
  const per = Math.max(1, Math.floor(max / Math.max(1, images.length)))
  for (const im of images) {
    const n = im.w * im.h
    if (!n) continue
    const step = Math.max(1, Math.floor(Math.sqrt(n / per)))
    const lum = (x: number, y: number) => {
      const i = (y * im.w + x) * 4
      return 0.2126 * im.data[i] + 0.7152 * im.data[i + 1] + 0.0722 * im.data[i + 2]
    }
    for (let y = 0; y < im.h; y += step)
      for (let x = 0; x < im.w; x += step) {
        const i = (y * im.w + x) * 4
        if (im.data[i + 3] !== undefined && im.data[i + 3] < 128) continue // transparent
        const r = im.data[i], g = im.data[i + 1], b = im.data[i + 2]
        const l = lum(x, y)
        const gx = x + 1 < im.w ? Math.abs(lum(x + 1, y) - l) : 0
        const gy = y + 1 < im.h ? Math.abs(lum(x, y + 1) - l) : 0
        out.push({ lab: rgbToLab(r, g, b), rgb: [r, g, b], y: im.h > 1 ? y / (im.h - 1) : 0.5, grad: gx + gy })
      }
  }
  return out
}

/**
 * The palette of 1–5 photos: up to `k` colours (similar clusters merged, ΔE < 7), largest first, each with its share,
 * position and texture. Deterministic.
 */
export function kmeansPalette(images: Pixels[], k = 6, iterations = 14): Swatch[] {
  const S = samples(images)
  if (!S.length) return []
  const rand = rng(0x5eed + S.length)
  // k-means++ seeding
  const C: [number, number, number][] = [S[Math.floor(rand() * S.length)].lab]
  const d2 = new Float64Array(S.length).fill(Infinity)
  while (C.length < Math.min(k, S.length)) {
    let sum = 0
    for (let i = 0; i < S.length; i++) {
      const d = deltaE(S[i].lab, C[C.length - 1]) ** 2
      if (d < d2[i]) d2[i] = d
      sum += d2[i]
    }
    if (sum <= 0) break
    let pick = rand() * sum, j = 0
    for (; j < S.length - 1; j++) {
      pick -= d2[j]
      if (pick <= 0) break
    }
    C.push([...S[j].lab] as [number, number, number])
  }
  const lab = new Int32Array(S.length)
  for (let it = 0; it < iterations; it++) {
    const acc = C.map(() => [0, 0, 0, 0])
    for (let i = 0; i < S.length; i++) {
      let best = 0, bd = Infinity
      for (let c = 0; c < C.length; c++) {
        const d = deltaE(S[i].lab, C[c])
        if (d < bd) {
          bd = d
          best = c
        }
      }
      lab[i] = best
      const a = acc[best]
      a[0] += S[i].lab[0]
      a[1] += S[i].lab[1]
      a[2] += S[i].lab[2]
      a[3]++
    }
    let moved = 0
    acc.forEach((a, c) => {
      if (!a[3]) return
      const n: [number, number, number] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]
      moved = Math.max(moved, deltaE(n, C[c]))
      C[c] = n
    })
    if (moved < 0.05) break
  }
  // per-cluster statistics (colour as the mean sRGB of its pixels: the hex the user sees)
  const stats = C.map(() => ({ n: 0, r: 0, g: 0, b: 0, y: 0, top: 0, bottom: 0, grad: 0 }))
  for (let i = 0; i < S.length; i++) {
    const s = stats[lab[i]], p = S[i]
    s.n++
    s.r += p.rgb[0]
    s.g += p.rgb[1]
    s.b += p.rgb[2]
    s.y += p.y
    s.grad += p.grad
    if (p.y < 0.4) s.top++
    if (p.y > 0.65) s.bottom++
  }
  let sw: Swatch[] = stats
    .filter((s) => s.n > 0)
    .map((s) => {
      const rgb: [number, number, number] = [s.r / s.n, s.g / s.n, s.b / s.n]
      return { hex: hexOf(...rgb), rgb: rgb.map(Math.round) as [number, number, number], lab: rgbToLab(...rgb), share: s.n / S.length, y: s.y / s.n, top: s.top / s.n, bottom: s.bottom / s.n, texture: s.grad / s.n }
    })
  // merge near-identical colours (k larger than the photo needs)
  sw.sort((a, b) => b.share - a.share)
  const merged: Swatch[] = []
  for (const s of sw) {
    const m = merged.find((x) => deltaE(x.lab, s.lab) < 7)
    if (!m) {
      merged.push({ ...s })
      continue
    }
    const t = m.share + s.share
    const mix = (a: number, b: number) => (a * m.share + b * s.share) / t
    m.rgb = [0, 1, 2].map((i) => Math.round(mix(m.rgb[i], s.rgb[i]))) as [number, number, number]
    m.hex = hexOf(...m.rgb)
    m.lab = rgbToLab(...m.rgb)
    m.y = mix(m.y, s.y)
    m.top = mix(m.top, s.top)
    m.bottom = mix(m.bottom, s.bottom)
    m.texture = mix(m.texture, s.texture)
    m.share = t
  }
  sw = merged.sort((a, b) => b.share - a.share)
  return sw
}

/* ------------------------------------------------------------------ roles */

const isWoodish = (l: readonly number[]) => l[1] >= 4 && l[1] <= 32 && l[2] >= 12 && l[2] <= 48 && l[0] >= 22 && l[0] <= 74

/**
 * What each colour probably is in the photo, from where it sits and how it looks: the light colour filling the upper
 * frame = wall, the one filling the bottom = floor, a brown-orange = wood, the most saturated small one = accent, a
 * small near-black neutral = metal (frames, legs), the rest = textile. Guidance for the finish choice, not a fact.
 */
export function assignRoles(sw: Swatch[]): RoleSwatch[] {
  const left = new Set(sw.map((_, i) => i))
  const role = new Map<number, PaletteRole>()
  const take = (r: PaletteRole, score: (s: Swatch) => number, ok: (s: Swatch) => boolean = () => true) => {
    let best = -1, bs = 0
    for (const i of left) {
      const s = sw[i]
      if (!ok(s)) continue
      const v = score(s)
      if (v > bs) {
        bs = v
        best = i
      }
    }
    if (best >= 0) {
      role.set(best, r)
      left.delete(best)
    }
  }
  take('wall', (s) => s.share * (s.top + 0.25), (s) => s.lab[0] >= 45)
  // floors are usually textured (planks, tiles, stone): grain weighs in, a flat bright colour low in the frame is
  // more often furniture (a white console) than the floor
  take('floor', (s) => s.share * (s.bottom + 0.15) * (1 + Math.min(s.texture, 15) / 8), (s) => s.bottom >= 0.3)
  take('wood', (s) => s.share, (s) => isWoodish(s.lab))
  take('accent', (s) => chroma(s.lab), (s) => chroma(s.lab) >= 22 && s.share >= 0.015)
  take('metal', (s) => 1 - s.share, (s) => s.lab[0] < 26 && chroma(s.lab) < 9 && s.share < 0.12)
  return sw.map((s, i) => ({ ...s, role: role.get(i) ?? 'textile' }))
}

/** Palette with roles of 1–5 photos. */
export const extractPalette = (images: Pixels[], k = 6): RoleSwatch[] => assignRoles(kmeansPalette(images, k))

/** Overall light of the photos: mean lightness (0…100) and warmth (mean Lab b*, > 10 reads warm). */
export function lightOf(sw: Swatch[]): { meanL: number; warm: number } {
  const t = sw.reduce((a, s) => a + s.share, 0) || 1
  return { meanL: sw.reduce((a, s) => a + s.lab[0] * s.share, 0) / t, warm: sw.reduce((a, s) => a + s.lab[2] * s.share, 0) / t }
}
