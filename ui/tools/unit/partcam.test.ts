// CAM of the sample bearing bracket (run: UNIT=partcam node tools/test-cam.mjs run).
import { bracketPart } from '../../src/mech/part'
import { partCam } from '../../src/mech/partCam'

export function run() {
  const r = partCam(bracketPart())
  if ('error' in r) return r
  return { stock: r.stock, tools: r.tools, ops: r.ops.map((o) => `${o.name} [${o.tool}] ${o.zTop.toFixed(1)}→${o.zBottom.toFixed(1)} ${Math.round(o.lengthMm)} mm`), sim: { ...r.sim, minutes: +(r.sim.seconds / 60).toFixed(1) }, lines: r.gcode.split('\n').length }
}

export function gcode() {
  const r = partCam(bracketPart())
  return 'error' in r ? r : r.gcode
}
