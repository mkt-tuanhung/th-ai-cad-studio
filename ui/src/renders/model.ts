/**
 * Render studio data (Villa Riverside). No renderer is connected in this build: jobs are queued with
 * their real settings and stay "Waiting for renderer" — nothing is ever shown as rendering or done.
 * Estimates use plain arithmetic (pixel counts, bytes per pixel); no render-time guesses.
 */

export interface Camera {
  id: string
  name: string
  kind: string
  aspect: string
  w: number
  h: number
  thumb: string
}

export type Resolution = '1920x1080' | '2560x1440' | '3840x2160' | '7680x4320' | '1080x1080' | '1080x1920'
export const RESOLUTIONS: { key: Resolution; label: string; tag: string }[] = [
  { key: '1920x1080', label: '1920 × 1080 (Full HD)', tag: 'FHD' },
  { key: '2560x1440', label: '2560 × 1440 (QHD)', tag: 'QHD' },
  { key: '3840x2160', label: '3840 × 2160 (4K UHD)', tag: '4K' },
  { key: '7680x4320', label: '7680 × 4320 (8K UHD)', tag: '8K' },
  { key: '1080x1080', label: '1080 × 1080 (Square)', tag: '1:1' },
  { key: '1080x1920', label: '1080 × 1920 (Portrait)', tag: '9:16' },
]
export type FileFormat = 'png' | 'png16' | 'jpg' | 'exr' | 'tiff'
export const FORMATS: { key: FileFormat; label: string; ext: string; bytesPerPixel: number; compress: number }[] = [
  { key: 'png', label: 'PNG (High Quality)', ext: 'PNG', bytesPerPixel: 3, compress: 0.55 },
  { key: 'png16', label: 'PNG 16-bit', ext: 'PNG', bytesPerPixel: 6, compress: 0.6 },
  { key: 'jpg', label: 'JPEG (95%)', ext: 'JPG', bytesPerPixel: 3, compress: 0.12 },
  { key: 'exr', label: 'OpenEXR (32-bit float)', ext: 'EXR', bytesPerPixel: 16, compress: 0.5 },
  { key: 'tiff', label: 'TIFF (8-bit)', ext: 'TIFF', bytesPerPixel: 3, compress: 1 },
]
export const ENGINES = ['Path Tracing (Physically Based)', 'Rasterized Preview', 'Hybrid (Path Traced GI)'] as const
export const QUALITIES = ['Draft', 'Medium', 'High', 'Ultra'] as const
export const HDRIS = [
  { name: 'Outdoor - Clear Sky', thumb: '/assets/v2/renders/hdri.png' },
  { name: 'Outdoor - Overcast', thumb: '/assets/v2/renders/var-overcast.png' },
  { name: 'Studio - Soft Box', thumb: '' },
] as const

export interface RenderSettings {
  resolution: Resolution
  format: FileFormat
  dpi: number
  engine: (typeof ENGINES)[number]
  samples: number
  denoise: boolean
  bounces: number
  quality: (typeof QUALITIES)[number]
  hdri: string
  rotation: number
  sunSky: boolean
  sunIntensity: number
  sunDirection: number
  ai: { denoise: boolean; lighting: boolean; material: boolean; style: boolean }
}

export interface PostFx {
  exposure: number // EV, −2…+2
  contrast: number // %, 50…150
  saturation: number // %, 0…200
  temperature: number // −100…+100 (cool … warm)
  vignette: number // 0…100
}

export interface Job {
  id: string
  camera: string
  settings: string
  output: string
  status: 'waiting'
  created: number
}

export interface Variation {
  key: 'original' | 'warm' | 'overcast' | 'night'
  img: string
  /** What the variation changes (applied to the settings when chosen). */
  patch: Partial<RenderSettings>
}

export const VARIATIONS: Variation[] = [
  { key: 'original', img: '/assets/v2/renders/var-original.png', patch: { hdri: 'Outdoor - Clear Sky', sunIntensity: 1.2, sunDirection: 320 } },
  { key: 'warm', img: '/assets/v2/renders/var-warm.png', patch: { hdri: 'Outdoor - Clear Sky', sunIntensity: 0.8, sunDirection: 250 } },
  { key: 'overcast', img: '/assets/v2/renders/var-overcast.png', patch: { hdri: 'Outdoor - Overcast', sunSky: false } },
  { key: 'night', img: '/assets/v2/renders/var-night.png', patch: { hdri: 'Outdoor - Clear Sky', sunIntensity: 0, sunSky: false } },
]

export const MATERIALS = ['concrete', 'wood', 'marble', 'metal', 'glass', 'fabric', 'stone', 'vegetation'] as const

export const CAMERAS: Camera[] = [
  { id: 'cam1', name: 'Cam 01', kind: 'Exterior - Front View', aspect: '16:9', w: 3840, h: 2160, thumb: '/assets/v2/renders/cam1.png' },
  { id: 'cam2', name: 'Cam 02', kind: 'Exterior - Pool View', aspect: '16:9', w: 3840, h: 2160, thumb: '/assets/v2/renders/cam2.png' },
  { id: 'cam3', name: 'Cam 03', kind: 'Interior - Living Room', aspect: '16:9', w: 3840, h: 2160, thumb: '/assets/v2/renders/cam3.png' },
  { id: 'cam4', name: 'Cam 04', kind: 'Interior - Bedroom', aspect: '16:9', w: 3840, h: 2160, thumb: '/assets/v2/renders/cam4.png' },
  { id: 'cam5', name: 'Cam 05', kind: 'Aerial View', aspect: '16:9', w: 3840, h: 2160, thumb: '/assets/v2/renders/cam5.png' },
]

export const DEFAULT_SETTINGS: RenderSettings = {
  resolution: '3840x2160', format: 'png', dpi: 300, engine: 'Path Tracing (Physically Based)', samples: 1024, denoise: true, bounces: 8, quality: 'High',
  hdri: 'Outdoor - Clear Sky', rotation: 120, sunSky: true, sunIntensity: 1.2, sunDirection: 320, ai: { denoise: true, lighting: true, material: true, style: false },
}
export const DEFAULT_FX: PostFx = { exposure: 0, contrast: 100, saturation: 100, temperature: 0, vignette: 0 }

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
export function dims(r: Resolution) {
  const [w, h] = r.split('x').map(Number)
  const g = gcd(w, h)
  return { w, h, aspect: `${w / g}:${h / g}`, mp: (w * h) / 1e6 }
}

/** Estimated file size (MB) from pixel count, bytes per pixel and a typical compression ratio. */
export function fileSizeMb(r: Resolution, f: FileFormat) {
  const { w, h } = dims(r)
  const fmt = FORMATS.find((x) => x.key === f)!
  return (w * h * fmt.bytesPerPixel * fmt.compress) / (1024 * 1024)
}

/** Printed size at the chosen DPI (cm). */
export const printCm = (r: Resolution, dpi: number) => {
  const { w, h } = dims(r)
  return { w: (w / dpi) * 2.54, h: (h / dpi) * 2.54 }
}

export const settingsSummary = (s: RenderSettings) => `${RESOLUTIONS.find((r) => r.key === s.resolution)!.tag} · ${s.samples} samples`

/** CSS filter that previews post-processing on the DEMO image (not a re-render). */
export function fxFilter(fx: PostFx) {
  const b = Math.pow(2, fx.exposure)
  const sepia = Math.max(0, fx.temperature) / 250
  const hue = fx.temperature < 0 ? fx.temperature / 6 : 0
  return `brightness(${b.toFixed(3)}) contrast(${fx.contrast}%) saturate(${fx.saturation}%) sepia(${sepia.toFixed(2)}) hue-rotate(${hue.toFixed(0)}deg)`
}
