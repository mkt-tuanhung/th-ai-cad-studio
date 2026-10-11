// End-to-end: a large DXF opened in CAD 2D is drawn by the WebGL2 layer inside QtWebEngine.
// THCAD_SCRIPT=…/e2e_gpu.js [THCAD_GPU_DXF=/path/real.dxf is not readable from the page; a
// 30×30 block array (2 700 lines) is generated instead].
;(async () => {
  const log = (m) => console.log('E2E ' + m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(100) } return null }
  let fails = 0
  const check = (name, ok, extra = '') => { if (!ok) fails++; log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')) }
  try {
    await window.thcadHostReady
    location.hash = '#/cad2d'
    const input = await until(() => document.querySelector('input[type=file][accept=".dxf,.dwg"]'))
    const g = []
    const p = (...a) => g.push(...a.map(String))
    p(0, 'SECTION', 2, 'BLOCKS', 0, 'BLOCK', 2, 'CELL', 10, 0, 20, 0)
    p(0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 800, 21, 0, 0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 0, 21, 800, 0, 'CIRCLE', 8, '0', 10, 400, 20, 400, 40, 300)
    p(0, 'ENDBLK', 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES')
    p(0, 'INSERT', 8, 'GRID', 2, 'CELL', 10, 0, 20, 0, 70, 30, 71, 30, 44, 1000, 45, 1000)
    p(0, 'ENDSEC', 0, 'EOF')
    const dt = new DataTransfer()
    dt.items.add(new File([g.join('\n') + '\n'], 'gpu-e2e.dxf', { type: 'application/dxf' }))
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    const doc = await until(() => { const d = window.thcadActiveDoc(); return d && d.name === 'gpu-e2e.dxf' ? d : null })
    check('large DXF imported (2 700 entities)', doc && doc.entities.length === 2700, doc ? String(doc.entities.length) : 'none')
    await until(() => window.thcadGpuStats && window.thcadGpuStats.frames > 0, 5000)
    const st = window.thcadGpuStats
    check('WebGL2 available in QtWebEngine', !st.failed, st.failed)
    check('geometry drawn by the GPU layer', document.querySelectorAll('canvas[data-gpu]').length === 2 && st.segments > 2700, JSON.stringify(st))
    const gl = document.querySelector('canvas[data-gpu=geometry]').getContext('webgl2')
    const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info')
    log('renderer ' + (dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl ? gl.getParameter(gl.RENDERER) : 'none'))
    // pan/zoom: 30 wheel steps, each until painted
    const vp = document.querySelector('[data-tool]')
    const r = vp.getBoundingClientRect()
    const times = []
    for (let k = 0; k < 30; k++) {
      const t = performance.now()
      vp.dispatchEvent(new WheelEvent('wheel', { deltaY: k % 2 ? 60 : -60, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, ctrlKey: true, bubbles: true, cancelable: true }))
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))
      times.push(performance.now() - t)
    }
    times.sort((a, b) => a - b)
    check('zoom frames stay within two vsyncs (median ≤ 40 ms)', times[15] <= 40, `median ${times[15].toFixed(1)} ms, p90 ${times[27].toFixed(1)} ms, last GPU frame ${st.lastFrameMs.toFixed(1)} ms`)
  } catch (e) {
    fails++
    log('FAIL exception ' + e)
  }
  log('DONE ' + (fails ? 'FAILED ' + fails : 'OK'))
})()
