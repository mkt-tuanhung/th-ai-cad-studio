/**
 * Render studio data (Villa Riverside). In the desktop app jobs are rendered by the OCCT path tracer
 * (renders/runner.ts); in a plain browser they stay "Waiting" — nothing is ever shown as rendered that
 * was not. Estimates use plain arithmetic (pixel counts, bytes per pixel); no render-time guesses.
 */

/** Where a camera stands: exterior views see the BIM building, interior views the interior model. */
export interface CameraView {
  scene: 'exterior' | 'interior'
  eye: [number, number, number]
  at: [number, number, number]
  fov: number
  /** Up vector (default +Z) — camera bookmarks keep it. */
  up?: [number, number, number]
}

export interface Camera {
  id: string
  name: string
  kind: string
  aspect: string
  w: number
  h: number
  thumb: string
  view?: CameraView
  /** Camera bookmark this camera was saved from (BIM / Interior 3D views, v2.4). */
  bookmarkId?: string
}

/** Camera placements of the sample project (mm; BIM origin at the front-left corner, interior plan origin at the living room). */
export const CAMERA_VIEWS: Record<string, CameraView> = {
  cam1: { scene: 'exterior', eye: [-7000, -15500, 1700], at: [6900, 4900, 3800], fov: 50 },
  cam2: { scene: 'exterior', eye: [24000, 21000, 2200], at: [6900, 4900, 3600], fov: 50 },
  cam3: { scene: 'interior', eye: [7350, 3450, 1600], at: [2000, 900, 900], fov: 68 },
  cam4: { scene: 'interior', eye: [4150, 3950, 1600], at: [1400, 7200, 600], fov: 68 },
  cam5: { scene: 'exterior', eye: [32000, -24000, 27000], at: [6900, 4900, 3000], fov: 38 },
}
export const viewOf = (c: Camera): CameraView => c.view ?? CAMERA_VIEWS[c.id] ?? (c.kind.startsWith('Interior') ? CAMERA_VIEWS.cam3 : CAMERA_VIEWS.cam1)

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
export const ENGINES = ['Path Tracing (Physically Based)', 'Rasterized Preview', 'Hybrid (Path Traced GI)', 'Blender Cycles (local)'] as const
/** The user's own Blender, run as a separate process (v2.4); the other engines are the in-app OCCT tracer. */
export const BLENDER_ENGINE = 'Blender Cycles (local)' as const
export const isBlender = (s: { engine: string }) => s.engine === BLENDER_ENGINE
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
  /** Sun height above the horizon (°); default 40. */
  sunElevation?: number
  /** Day / Golden / Night preset (v2.4; Blender lighting + realtime viewport); absent = derived from sun / sky. */
  lighting?: 'day' | 'golden' | 'night'
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
  /** Camera and settings captured when the job was queued (what gets rendered). */
  cameraId?: string
  cfg?: { settings: RenderSettings; fx: PostFx }
  /** still (default) · panorama: 6 cube faces → 360° equirectangular JPG · video: one render per frame → MP4. */
  kind?: 'still' | 'panorama' | 'video'
  special?: { face?: number; samples?: number; fps?: number; w?: number; h?: number; frames?: { eye: number[]; at: number[]; fov: number }[] }
  /** Thumbnail render of a custom variation: its preview becomes the variation's picture. */
  thumbFor?: string
  /** Scene snapshot captured when the job was queued (revision, geometry hash, GLB, live frame). */
  snap?: import('./provenance').JobSnapshot
  /** Camera bookmark the job renders (v2.4). */
  bookmarkId?: string
  /** Presentation material option (batch of the same model, geometry identical). */
  variant?: { key: string; name: string; overrides: Record<string, import('./provenance').MaterialOverride> }
}

/** Lighting / look variation proposed by the local AI (or edited): applied to the settings and post-processing. */
export interface CustomVariation {
  id: string
  name: string
  sky: 'clear' | 'overcast' | 'studio' | 'night'
  sunAzimuth: number
  sunElevation: number
  sunIntensity: number
  exposure: number
  contrast: number
  saturation: number
  temperature: number
  /** Thumbnail from a real preview render (desktop), else none. */
  preview?: string
}

export interface PanoSettings {
  face: 512 | 1024 | 2048
  samples: number
}
export interface VideoSettings {
  path: 'orbit' | 'flythrough'
  seconds: number
  fps: 12 | 24 | 30
  resolution: '1280x720' | '1920x1080'
  samples: number
}
export const DEFAULT_PANO: PanoSettings = { face: 1024, samples: 128 }
export const DEFAULT_VIDEO: VideoSettings = { path: 'orbit', seconds: 4, fps: 24, resolution: '1280x720', samples: 32 }

/**
 * Frame cameras of a video: an orbit of 360° around the camera's target at its distance and height, or a
 * fly-through along the cameras that see the same scene (ease in / out between consecutive cameras).
 */
export function videoFrames(cams: Camera[], cam: Camera, v: VideoSettings): { eye: number[]; at: number[]; fov: number }[] {
  const n = Math.max(2, Math.round(v.seconds * v.fps))
  const c = viewOf(cam)
  if (v.path === 'orbit' && c.scene === 'interior') {
    // inside a room: turn 360° in place (an orbit around the target would leave the room)
    const dx = c.at[0] - c.eye[0], dy = c.at[1] - c.eye[1]
    const r = Math.hypot(dx, dy), a0 = Math.atan2(dy, dx)
    return Array.from({ length: n }, (_, i) => {
      const a = a0 + (2 * Math.PI * i) / n
      return { eye: [...c.eye], at: [c.eye[0] + r * Math.cos(a), c.eye[1] + r * Math.sin(a), c.at[2]], fov: c.fov }
    })
  }
  if (v.path === 'orbit') {
    const dx = c.eye[0] - c.at[0], dy = c.eye[1] - c.at[1]
    const r = Math.hypot(dx, dy), a0 = Math.atan2(dy, dx)
    return Array.from({ length: n }, (_, i) => {
      const a = a0 + (2 * Math.PI * i) / n
      return { eye: [c.at[0] + r * Math.cos(a), c.at[1] + r * Math.sin(a), c.eye[2]], at: [...c.at], fov: c.fov }
    })
  }
  const path = [cam, ...cams.filter((x) => x.id !== cam.id && viewOf(x).scene === c.scene)].map(viewOf)
  if (path.length < 2) return videoFrames(cams, cam, { ...v, path: 'orbit' })
  const legs = path.length - 1
  return Array.from({ length: n }, (_, i) => {
    const t = (i / (n - 1)) * legs
    const k = Math.min(legs - 1, Math.floor(t)), u = t - k
    const e = u * u * (3 - 2 * u) // smoothstep between cameras
    const A = path[k], B = path[k + 1]
    const mix = (p: number[], q: number[]) => p.map((x, j) => x + (q[j] - x) * e)
    return { eye: mix(A.eye, B.eye), at: mix(A.at, B.at), fov: A.fov + (B.fov - A.fov) * e }
  })
}

/** Settings and post-processing of a custom variation applied to the current ones. */
export function applyCustom(s: RenderSettings, fx: PostFx, v: CustomVariation): { settings: RenderSettings; fx: PostFx } {
  return {
    settings: { ...s, sunSky: v.sky !== 'night' && v.sunIntensity > 0, sunIntensity: v.sky === 'night' ? 0 : v.sunIntensity, sunDirection: Math.round(v.sunAzimuth), sunElevation: v.sunElevation, hdri: v.sky === 'overcast' ? 'Outdoor - Overcast' : v.sky === 'studio' ? 'Studio - Soft Box' : 'Outdoor - Clear Sky' },
    fx: { ...fx, exposure: v.exposure, contrast: v.contrast, saturation: v.saturation, temperature: v.temperature },
  }
}

/** Live state of a job in the desktop renderer (not part of the undoable document). */
export interface JobRun {
  status: 'waiting' | 'rendering' | 'done' | 'failed' | 'cancelled'
  samples?: number
  total?: number
  ms?: number
  path?: string
  error?: string
  finished?: number
  /** Engine that produced it ('blender' | 'occt'), device, provenance sidecar, and a note (e.g. Blender missing → OCCT). */
  engine?: 'blender' | 'occt'
  device?: string
  sidecar?: string
  note?: string
}

/** Quality presets: choosing one sets samples and bounces (both stay editable). */
export const QUALITY_PRESETS: Record<(typeof QUALITIES)[number], { samples: number; bounces: number }> = {
  Draft: { samples: 64, bounces: 3 },
  Medium: { samples: 256, bounces: 4 },
  High: { samples: 1024, bounces: 8 },
  Ultra: { samples: 4096, bounces: 12 },
}

export interface Variation {
  key: 'original' | 'warm' | 'overcast' | 'night'
  img: string
  /** What the variation changes (applied to the settings when chosen). */
  patch: Partial<RenderSettings>
}

export const VARIATIONS: Variation[] = [
  { key: 'original', img: '/assets/v2/renders/var-original.png', patch: { hdri: 'Outdoor - Clear Sky', sunIntensity: 1.2, sunDirection: 320, lighting: 'day' } },
  { key: 'warm', img: '/assets/v2/renders/var-warm.png', patch: { hdri: 'Outdoor - Clear Sky', sunIntensity: 0.8, sunDirection: 250, lighting: 'golden' } },
  { key: 'overcast', img: '/assets/v2/renders/var-overcast.png', patch: { hdri: 'Outdoor - Overcast', sunSky: false, lighting: undefined } },
  { key: 'night', img: '/assets/v2/renders/var-night.png', patch: { hdri: 'Outdoor - Clear Sky', sunIntensity: 0, sunSky: false, lighting: 'night' } },
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
