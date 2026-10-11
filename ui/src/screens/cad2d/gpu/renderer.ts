import type { GpuScene } from './scene'

/**
 * WebGL2 renderer for a GpuScene. Lines are instanced quads (one instance per segment), so line
 * widths are exact CSS pixels on any display scale — `gl.lineWidth` is fixed at 1 device pixel on
 * most GPUs. MSAA smooths the edges. All per-frame work is a handful of uniforms and one draw call
 * per group; pan/zoom never touches the vertex data.
 */
const LINE_VS = `#version 300 es
layout(location = 0) in vec2 corner;   // x: 0|1 along the segment, y: -1|1 across it
layout(location = 1) in vec4 seg;      // a.xy, b.xy relative to the scene origin (mm)
uniform vec2 uOffset;                  // origin - view centre (mm)
uniform float uScale;                  // CSS px per mm
uniform vec2 uHalf;                    // half the viewport (CSS px)
uniform float uWidth;                  // CSS px
void main() {
  vec2 a = (seg.xy + uOffset) * uScale;
  vec2 b = (seg.zw + uOffset) * uScale;
  vec2 d = b - a;
  float len = length(d);
  vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
  vec2 n = vec2(-dir.y, dir.x);
  float hw = uWidth * 0.5;
  vec2 p = mix(a, b, corner.x) + n * corner.y * hw + dir * (corner.x * 2.0 - 1.0) * hw;
  gl_Position = vec4(p / uHalf, 0.0, 1.0);
}`
const FILL_VS = `#version 300 es
layout(location = 0) in vec2 pos;
uniform vec2 uOffset;
uniform float uScale;
uniform vec2 uHalf;
void main() { gl_Position = vec4((pos + uOffset) * uScale / uHalf, 0.0, 1.0); }`
const FS = `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 color;
void main() { color = vec4(uColor.rgb * uColor.a, uColor.a); }`

export interface GpuView {
  centerX: number
  centerY: number
  mmPerPx: number
  width: number
  height: number
  dpr: number
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader')
    return s
  }
  const p = gl.createProgram()!
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs))
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs))
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link')
  const u = (n: string) => gl.getUniformLocation(p, n)
  return { p, uOffset: u('uOffset'), uScale: u('uScale'), uHalf: u('uHalf'), uWidth: u('uWidth'), uColor: u('uColor') }
}

export class GpuRenderer {
  private gl: WebGL2RenderingContext
  private line: ReturnType<typeof program>
  private fill: ReturnType<typeof program>
  private lineVao: WebGLVertexArrayObject
  private fillVao: WebGLVertexArrayObject
  private segBuf: WebGLBuffer
  private triBuf: WebGLBuffer
  private scene: GpuScene | null = null
  private canvas: HTMLCanvasElement

  /** Throws when WebGL2 is unavailable (the caller falls back to SVG). */
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: false })
    if (!gl) throw new Error('WebGL2 unavailable')
    this.gl = gl
    this.line = program(gl, LINE_VS, FS)
    this.fill = program(gl, FILL_VS, FS)
    this.segBuf = gl.createBuffer()!
    this.triBuf = gl.createBuffer()!

    this.lineVao = gl.createVertexArray()!
    gl.bindVertexArray(this.lineVao)
    const corners = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, corners)
    // two triangles: (0,-1) (1,-1) (1,1) · (0,-1) (1,1) (0,1)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.segBuf)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribDivisor(1, 1)

    this.fillVao = gl.createVertexArray()!
    gl.bindVertexArray(this.fillVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.triBuf)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
  }

  setScene(scene: GpuScene) {
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, this.segBuf)
    gl.bufferData(gl.ARRAY_BUFFER, scene.segs, gl.STATIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.triBuf)
    gl.bufferData(gl.ARRAY_BUFFER, scene.tris, gl.STATIC_DRAW)
    this.scene = scene
  }

  draw(v: GpuView, hidden: Set<string>) {
    const { gl, canvas, scene } = this
    const W = Math.round(v.width * v.dpr), H = Math.round(v.height * v.dpr)
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H }
    gl.viewport(0, 0, W, H)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (!scene) return
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    // offset in float64 on the CPU, then a small float32 value on the GPU
    const offX = scene.origin.x - v.centerX, offY = scene.origin.y - v.centerY
    const s = 1 / v.mmPerPx
    const common = (p: ReturnType<typeof program>) => {
      gl.useProgram(p.p)
      gl.uniform2f(p.uOffset, offX, offY)
      gl.uniform1f(p.uScale, s)
      gl.uniform2f(p.uHalf, v.width / 2, v.height / 2)
    }
    // fills first, outlines on top (same order as SVG: fill + stroke)
    common(this.fill)
    gl.bindVertexArray(this.fillVao)
    for (const g of scene.groups) {
      if (!g.triCount || hidden.has(g.layer)) continue
      gl.uniform4fv(this.fill.uColor, g.rgba)
      gl.drawArrays(gl.TRIANGLES, g.triStart, g.triCount)
    }
    common(this.line)
    gl.bindVertexArray(this.lineVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.segBuf)
    for (const g of scene.groups) {
      if (!g.segCount || hidden.has(g.layer)) continue
      // WebGL2 has no base-instance draw: point the instanced attribute at this group's range
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 16, g.segStart * 16)
      gl.uniform4fv(this.line.uColor, g.rgba)
      gl.uniform1f(this.line.uWidth, g.widthPx)
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, g.segCount)
    }
    gl.bindVertexArray(null)
  }

  dispose() {
    const gl = this.gl
    gl.deleteBuffer(this.segBuf)
    gl.deleteBuffer(this.triBuf)
    gl.deleteVertexArray(this.lineVao)
    gl.deleteVertexArray(this.fillVao)
    gl.deleteProgram(this.line.p)
    gl.deleteProgram(this.fill.p)
  }
}

const CAP = 0.711 // Roboto cap-height / em — CAD text height is cap height (as in DrawingSvg)

/** Texts on a Canvas 2D overlay: culled to the view, labels under ~2 px skipped. */
export function drawTexts(ctx: CanvasRenderingContext2D, scene: GpuScene, v: GpuView, hidden: Set<string>, font: string) {
  const W = Math.round(v.width * v.dpr), H = Math.round(v.height * v.dpr)
  const c = ctx.canvas
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H }
  ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0)
  ctx.clearRect(0, 0, v.width, v.height)
  const s = v.mmPerPx
  const sx = (x: number) => v.width / 2 + (x - v.centerX) / s
  const sy = (y: number) => v.height / 2 - (y - v.centerY) / s
  let lastFont = '', lastFill = '', lastAlpha = 1
  for (const t of scene.texts) {
    const px = t.h / s / CAP
    if (px < 1.2 || hidden.has(t.layer)) continue
    const X = sx(t.x), Y = sy(t.y)
    const reach = px * Math.max(4, t.value.length) // generous bound for any rotation
    if (X < -reach || X > v.width + reach || Y < -reach || Y > v.height + reach) continue
    const f = `400 ${px.toFixed(2)}px ${font}`
    if (f !== lastFont) { ctx.font = f; lastFont = f }
    if (t.color !== lastFill) { ctx.fillStyle = t.color; lastFill = t.color }
    if (t.alpha !== lastAlpha) { ctx.globalAlpha = t.alpha; lastAlpha = t.alpha }
    ctx.textAlign = t.align === 'center' ? 'center' : 'left'
    ctx.textBaseline = t.middle ? 'middle' : 'alphabetic'
    if (t.rot) {
      ctx.save()
      ctx.translate(X, Y)
      ctx.rotate(-t.rot)
      ctx.fillText(t.value, 0, 0)
      ctx.restore()
    } else ctx.fillText(t.value, X, Y)
  }
  ctx.globalAlpha = 1
}
