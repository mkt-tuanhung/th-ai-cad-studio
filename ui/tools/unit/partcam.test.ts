// CAM of the sample bearing bracket (run: UNIT=partcam node tools/test-cam.mjs run). Asserts; returns { all }.
import { bracketPart } from '../../src/mech/part'
import { partCam, DEFAULT_PART_CAM } from '../../src/mech/partCam'
import { parseNc, parseSequence } from '../../src/cam/ncparse'
import { POSTS } from '../../src/cam/posts'

const code = (t: string) => t.split('\n').map((l) => l.replace(/\(.*?\)/g, '').trim())

export function run() {
  const checks: Record<string, boolean> = {}
  const r = partCam(bracketPart())
  if ('error' in r) return { all: false, error: r.error }
  const names = r.ops.map((o) => o.name)
  for (const o of ['Face', 'Profile Extrude 2', 'Profile Extrude 1', 'Bores and counterbores (helical)', 'Drill Ø9 (4)']) checks[`op: ${o}`] = names.some((n) => n.startsWith(o))
  checks.simNoErrors = r.sim.errors.length === 0
  // ISO with ATC: G43 H n after every T n M6
  const iso = code(r.gcode)
  const m6 = iso.map((l, i) => [l, i] as const).filter(([l]) => /^T\d+ M6$/.test(l))
  checks.isoG43AfterEveryM6 = m6.length === r.tools.length && m6.every(([l, i]) => iso.slice(i + 1, i + 3).some((x) => x.includes(`G43 H${/T(\d+)/.exec(l)![1]}`)))
  checks.isoParsesClean = parseNc(r.gcode, { dialect: POSTS.iso_generic.dialect, requireTlo: true, atc: true }).issues.filter((i) => i.block).length === 0
  // ISO without ATC: no T / M6, an M0 + operator message per tool, G43 H n still applied
  const noAtc = partCam(bracketPart(), { ...DEFAULT_PART_CAM, atc: false })
  checks.noAtcNoToolChange = !('error' in noAtc) && !code(noAtc.gcode).some((l) => /\bM6\b|^T\d/.test(l)) && (noAtc.gcode.match(/M0 \(LOAD T/g) ?? []).length === noAtc.tools.length
  checks.noAtcParserClean = !('error' in noAtc) && parseNc(noAtc.gcode, { dialect: POSTS.iso_generic.dialect, atc: false }).issues.filter((i) => i.block).length === 0
  // GRBL: one program per tool, M0 "load + zero Z" before any motion, no M6 / G43
  const g = partCam(bracketPart(), { ...DEFAULT_PART_CAM, dialect: 'grbl' })
  checks.grblProgramPerTool = !('error' in g) && g.programs.length === g.tools.length
  checks.grblNoM6G43 = !('error' in g) && g.programs.every((p) => !code(p.text).some((l) => /\bM6\b|\bG43\b/.test(l)))
  checks.grblZeroZBeforeMotion = !('error' in g) && g.programs.every((p) => { const c = code(p.text); const f = c.findIndex((l) => /[XYZ]-?\d/.test(l)); return c.slice(0, f).includes('M0') && /ZERO Z ON THE STOCK TOP/.test(p.text) })
  const gp = 'error' in g ? [] : parseSequence(g.programs.map((p) => ({ text: p.text, ctx: { dialect: POSTS.grbl11.dialect, atc: false } })))
  checks.grblParsesClean = gp.length > 0 && gp.every((x) => x.issues.filter((i) => i.block).length === 0)
  // a machine without vertical drilling: drills listed as not machined, not written
  const nd = partCam(bracketPart(), { ...DEFAULT_PART_CAM, allow: (op) => (op === 'DRILL_VERTICAL' ? 'NO_HEAD_FOR_OPERATION' : null) })
  checks.unsupportedDrillNotWritten = !('error' in nd) && nd.skipped.length === 1 && nd.tools.length === 1 && !/Drill/.test(nd.gcode.replace(/\(.*?\)/g, '')) && nd.ops.some((o) => /not machined/.test(o.name))
  // a saw-only machine cannot mill this part at all
  const saw = partCam(bracketPart(), { ...DEFAULT_PART_CAM, allow: (op) => (op === 'PROFILE' || op === 'POCKET' ? 'NO_HEAD_FOR_OPERATION' : null) })
  checks.sawMachineRefused = 'error' in saw
  return {
    all: Object.values(checks).every(Boolean),
    checks,
    grblIssues: gp.flatMap((x) => x.issues.filter((i) => i.block).map((i) => i.msg)).slice(0, 6),
    stock: r.stock,
    tools: r.tools,
    ops: r.ops.map((o) => `${o.name} [${o.tool}] ${o.zTop.toFixed(1)}→${o.zBottom.toFixed(1)} ${Math.round(o.lengthMm)} mm`),
    sim: { ...r.sim, minutes: +(r.sim.seconds / 60).toFixed(1) },
    lines: r.gcode.split('\n').length,
  }
}

export function gcode() {
  const r = partCam(bracketPart())
  return 'error' in r ? r : r.gcode
}
