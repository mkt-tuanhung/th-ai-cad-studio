/**
 * Reference photos → interior style (v2.4), page side: decode the user's photos (never uploaded anywhere), measure
 * their palette (interior/palette.ts), ask the local vision model through the host when it is installed
 * (HostBridge::visionAnalyze → llama-mtmd-cli + Qwen2.5-VL, GBNF-constrained, validated here), otherwise — or when
 * the model fails — the basic colour / texture analysis, labelled as such.
 */
import type { HostApi } from './host'
import { extractPalette, type Pixels, type RoleSwatch } from '../interior/palette'
import { basicAnalysis, parseModelAnswer, STYLE_SYSTEM, styleGrammar, stylePrompt, type StyleAnalysis } from '../interior/styleRef'

export interface VisionStatus {
  available: boolean
  helper: string
  model: string
  mmproj: string
  modelBytes: number
  device?: string
  reason?: string
  busy?: boolean
  dir?: string
}

export interface RefImage {
  name: string
  /** JPEG data URL (≤ 1280 px) for display and the side-by-side comparison. */
  url: string
  w: number
  h: number
  /** Base64 JPEG (≤ 768 px) given to the model. */
  b64: string
}

export const MAX_REF_IMAGES = 5

const isImageFile = (f: File) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name)

async function decode(f: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(f)
  const url = URL.createObjectURL(f)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

function draw(src: CanvasImageSource & { width: number; height: number }, max: number) {
  const s = Math.min(1, max / Math.max(src.width, src.height))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(src.width * s))
  c.height = Math.max(1, Math.round(src.height * s))
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.fillStyle = '#fff'
  g.fillRect(0, 0, c.width, c.height)
  g.drawImage(src, 0, 0, c.width, c.height)
  return { c, g }
}

/** Decodes 1–5 photos: display copy, model copy and the small pixel buffer the palette is measured on. */
export async function loadRefImages(files: File[]): Promise<{ images: RefImage[]; pixels: Pixels[]; rejected: string[]; dropped: number }> {
  const ok = files.filter(isImageFile)
  const rejected = files.filter((f) => !isImageFile(f)).map((f) => f.name)
  const use = ok.slice(0, MAX_REF_IMAGES)
  const images: RefImage[] = []
  const pixels: Pixels[] = []
  for (const f of use) {
    try {
      const bmp = await decode(f)
      const big = draw(bmp, 1280)
      const mid = draw(bmp, 768)
      const small = draw(bmp, 160)
      const id = small.g.getImageData(0, 0, small.c.width, small.c.height)
      images.push({ name: f.name, url: big.c.toDataURL('image/jpeg', 0.88), w: big.c.width, h: big.c.height, b64: mid.c.toDataURL('image/jpeg', 0.9).split(',')[1] })
      pixels.push({ data: id.data, w: id.width, h: id.height })
    } catch {
      rejected.push(f.name)
    }
  }
  return { images, pixels, rejected, dropped: Math.max(0, ok.length - MAX_REF_IMAGES) }
}

/* ------------------------------------------------------------------ the model through the host */

let subscribed: HostApi | null = null
const waiting = new Map<string, (r: VisionResult) => void>()
export interface VisionResult {
  id: string
  ok: boolean
  text?: string
  ms?: number
  device?: string
  error?: string
  cancelled?: boolean
}

function listen(host: HostApi) {
  if (subscribed === host) return
  subscribed = host
  host.on('visionResult', (p) => {
    const r = p as VisionResult
    const fn = waiting.get(r.id)
    if (!fn) return
    waiting.delete(r.id)
    fn(r)
  })
}

let seq = 0
/** One run of the vision model: resolves with its answer (or the error); a stuck run times out. */
export async function runVision(host: HostApi, task: { images: string[]; system: string; prompt: string; grammar: string; maxTokens?: number }, timeoutMs = 360000): Promise<VisionResult> {
  listen(host)
  const id = `vis-${Date.now().toString(36)}-${seq++}`
  const done = new Promise<VisionResult>((resolve) => {
    waiting.set(id, resolve)
    setTimeout(() => {
      if (!waiting.has(id)) return
      waiting.delete(id)
      void host.visionCancel(id)
      resolve({ id, ok: false, error: 'timed out' })
    }, timeoutMs)
  })
  const r = await host.visionAnalyze(JSON.stringify({ id, ...task, maxTokens: task.maxTokens ?? 700 }))
  if (!r.ok) {
    waiting.delete(id)
    return { id, ok: false, error: r.error ?? 'failed' }
  }
  return done
}

export interface StyleReading {
  analysis: StyleAnalysis
  palette: RoleSwatch[]
  /** The model's raw answer (shown under "Analysis JSON" for transparency). */
  raw?: string
  /** Why the model was not used / failed (the basic analysis is shown then). */
  modelError?: string
  device?: string
}

/**
 * Reads the photos: palette by code; style by the local model when installed (answer validated), else / on failure
 * the basic analysis.
 */
export async function readStyle(host: HostApi | null, images: RefImage[], pixels: Pixels[]): Promise<StyleReading> {
  const sw = extractPalette(pixels)
  const palette = sw.slice(0, 6).map((s) => ({ hex: s.hex, role: s.role, share: Math.round(s.share * 1000) / 1000 }))
  let modelError: string | undefined
  if (host) {
    const st = await host.visionStatus().catch(() => null)
    if (st?.available) {
      const r = await runVision(host, { images: images.map((i) => i.b64), system: STYLE_SYSTEM, prompt: stylePrompt(palette, images.length), grammar: styleGrammar() })
      if (r.ok && r.text) {
        const p = parseModelAnswer(r.text, palette, { model: st.model.replace(/\.gguf$/i, ''), ms: r.ms, images: images.length })
        if (p.ok) return { analysis: p.value, palette: sw, raw: r.text, device: r.device }
        modelError = `invalid answer (${p.errors.join(', ')})`
      } else modelError = r.error ?? 'failed'
    } else if (st && st.reason) modelError = undefined // not installed: the basic analysis is the expected path
  }
  return { analysis: basicAnalysis(sw, images.length), palette: sw, ...(modelError ? { modelError } : {}) }
}
