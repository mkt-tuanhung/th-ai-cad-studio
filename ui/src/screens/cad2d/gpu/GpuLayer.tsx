import { memo, useLayoutEffect, useMemo, useRef } from 'react'
import type { CadDocument } from '../../../cad/types'
import type { ViewState } from '../../../state/cad'
import { buildScene, type GpuScene } from './scene'
import { drawTexts, GpuRenderer } from './renderer'

/**
 * Drawings at or above this size are drawn on the GPU (measured: SVG stays at 60 fps up to ~3k
 * entities and drops to ~4 fps at 42k; see qa/QA_DWG_RENDER_PACKAGING.md). The approved mockup
 * drawing (raster underlay) always stays on the SVG renderer.
 */
export const GPU_MIN_ENTITIES = 2000

/** QA override (`window.thcadGpuPref.force = true | false`) for side-by-side SVG/GPU comparisons. */
export const gpuPref: { force: boolean | null } = { force: null }
;(window as unknown as { thcadGpuPref: typeof gpuPref }).thcadGpuPref = gpuPref

export const wantsGpu = (doc: CadDocument) => gpuPref.force ?? (!doc.underlay && doc.entities.length >= GPU_MIN_ENTITIES)

/** QA counters (read by the benchmark / smoke tests). */
export const gpuStats = { builds: 0, lastBuildMs: 0, frames: 0, lastFrameMs: 0, segments: 0, failed: '' }
;(window as unknown as { thcadGpuStats: typeof gpuStats }).thcadGpuStats = gpuStats

interface Props {
  doc: CadDocument
  view: ViewState
  width: number
  height: number
  onFail: (reason: string) => void
}

/**
 * Geometry on a WebGL2 canvas, texts on a Canvas 2D overlay. Only re-renders when the document,
 * the view or the size change (pointer moves re-render the SVG overlay above it, not this).
 */
export const GpuLayer = memo(function GpuLayer({ doc, view, width, height, onFail }: Props) {
  const glRef = useRef<HTMLCanvasElement>(null)
  const txRef = useRef<HTMLCanvasElement>(null)
  const renderer = useRef<GpuRenderer | null>(null)
  const font = useMemo(() => getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || 'sans-serif', [])

  // layer colours / weights change the vertex groups; visibility only filters them at draw time
  const styleKey = doc.layers.map((l) => `${l.name}:${l.color}:${l.lineweight}`).join('|')
  const scene: GpuScene = useMemo(() => {
    const t = performance.now()
    const s = buildScene(doc.entities, doc.layers)
    gpuStats.builds++
    gpuStats.lastBuildMs = performance.now() - t
    gpuStats.segments = s.segments
    return s
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.entities, styleKey])
  const hidden = useMemo(() => new Set(doc.layers.filter((l) => !l.visible).map((l) => l.name)), [doc.layers])

  // layout effects run in declaration order: create → upload → draw, all before paint
  useLayoutEffect(() => {
    const canvas = glRef.current!
    try {
      renderer.current = new GpuRenderer(canvas)
    } catch (e) {
      gpuStats.failed = String(e)
      onFail(String(e))
      return
    }
    const lost = (ev: Event) => {
      ev.preventDefault()
      gpuStats.failed = 'context lost'
      onFail('context lost')
    }
    canvas.addEventListener('webglcontextlost', lost)
    return () => {
      canvas.removeEventListener('webglcontextlost', lost)
      renderer.current?.dispose()
      renderer.current = null
    }
  }, [onFail])

  useLayoutEffect(() => {
    renderer.current?.setScene(scene)
  }, [scene])

  // draw in the same commit as the SVG overlay so geometry and grips never drift apart
  useLayoutEffect(() => {
    const r = renderer.current
    if (!r) return
    const t = performance.now()
    const v = { centerX: view.center.x, centerY: view.center.y, mmPerPx: view.mmPerPx, width, height, dpr: window.devicePixelRatio || 1 }
    r.draw(v, hidden)
    const ctx = txRef.current?.getContext('2d')
    if (ctx) drawTexts(ctx, scene, v, hidden, font)
    gpuStats.frames++
    gpuStats.lastFrameMs = performance.now() - t
  })

  const css = { position: 'absolute', left: 0, top: 0, width, height, pointerEvents: 'none' } as const
  return (
    <>
      <canvas ref={glRef} style={css} data-gpu="geometry" />
      <canvas ref={txRef} style={css} data-gpu="text" />
    </>
  )
})
