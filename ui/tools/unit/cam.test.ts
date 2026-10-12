import { CABINETS } from '../../src/interior/model'
import { nest, piecesOf, verifyNest, DEFAULT_NEST } from '../../src/cam/nesting'
import { camSheet, simulate, DEFAULT_CAM } from '../../src/cam/gcode'

export function run() {
  const pieces = piecesOf(CABINETS)
  const r = nest(pieces)
  const shelves = (name: string) => (CABINETS.find((c) => c.name === name)?.shelves ?? 0) > 0
  const cam: Record<string, unknown>[] = []
  for (const dialect of ['grbl', 'iso'] as const)
    for (const sh of r.sheets) {
      const c = camSheet(sh, { ...DEFAULT_CAM, dialect }, shelves, 'Villa')
      // every hole lies inside its own part (with a 5 mm margin to the edge)
      const holeErr = c.holes.filter((h) => { const p = sh.parts.find((q) => q.label === h.part)!; return !(h.x - h.d / 2 >= p.x && h.x + h.d / 2 <= p.x + p.sx && h.y - h.d / 2 >= p.y && h.y + h.d / 2 <= p.y + p.sy) }).map((h) => h.part)
      for (const p of c.programs) {
        const sim = simulate(p.text, sh, sh.t + DEFAULT_CAM.breakthrough, DEFAULT_CAM.cutterD / 2 + 0.01)
        cam.push({ dialect, program: p.name, lines: sim.lines, cut_m: +(sim.cutLength / 1000).toFixed(1), min: +(sim.seconds / 60).toFixed(1), minZ: sim.minZ, errors: sim.errors.slice(0, 3), holes: c.holes.length, holeErr })
      }
    }
  return {
    pieces: pieces.length,
    sheets: r.sheets.map((s) => `${s.material} #${s.index}: ${s.parts.length} parts, yield ${(s.yield * 100).toFixed(1)} %`),
    unplaced: r.unplaced.map((p) => p.label),
    verify: verifyNest(r),
    cam,
    camErrors: cam.reduce((a, x) => a + (x.errors as string[]).length + (x.holeErr as string[]).length, 0),
    gap: DEFAULT_NEST.gap,
    sample: camSheet(r.sheets[0], DEFAULT_CAM, shelves, 'Villa').programs.map((p) => p.text.split('\n').slice(0, 24).join('\n')).join('\n----\n'),
  }
}

import { solveBeam, shaftFea } from '../../src/mech/fea'
import { createPump } from '../../src/mech/model'

/** FEA checks against closed-form beam solutions, then the pump rotor. */
export function fea() {
  const E = 210e9, G = E / 2.6, rho = 7850, d = 0.05, L = 1.0, P = 1000
  const I = (Math.PI * d ** 4) / 64, A = (Math.PI * d * d) / 4, kappa = 0.9
  const stiff = 1e15
  // simply supported, central load: δ = PL³/48EI + PL/(4κGA)
  const ss = solveBeam({ sections: [{ x0: 0, x1: L, d }], E, G, rho, hMax: 0.02, supports: [{ x: 0, kv: stiff }, { x: L, kv: stiff }], forces: [{ x: L / 2, F: P }], masses: [], selfWeight: false })
  const dSS = (P * L ** 3) / (48 * E * I) + (P * L) / (4 * kappa * G * A)
  const mid = ss.v[ss.x.findIndex((x) => Math.abs(x - L / 2) < 1e-9)]
  // cantilever, tip load: δ = PL³/3EI + PL/(κGA); fixed end via translational + rotational springs
  const cl = solveBeam({ sections: [{ x0: 0, x1: L, d }], E, G, rho, hMax: 0.02, supports: [{ x: 0, kv: stiff, kt: stiff }], forces: [{ x: L, F: P }], masses: [], selfWeight: false })
  const dCL = (P * L ** 3) / (3 * E * I) + (P * L) / (kappa * G * A)
  // first natural frequency, simply supported slender beam: f1 = (π/2) √(EI / (ρ A L⁴))
  const f1 = (Math.PI / 2) * Math.sqrt((E * I) / (rho * A * L ** 4))
  const err = (a: number, b: number) => +(((a - b) / b) * 100).toFixed(3)
  const pump = shaftFea(createPump())
  return {
    simplySupported: { fe: mid, exact: dSS, errPct: err(mid, dSS), momentMid: Math.max(...ss.M.map(Math.abs)), exactMoment: (P * L) / 4 },
    cantilever: { fe: cl.v[cl.v.length - 1], exact: dCL, errPct: err(cl.v[cl.v.length - 1], dCL), rootMoment: Math.max(...cl.M.map(Math.abs)), exactRoot: P * L },
    modal: { fe: ss.freqs[0], exact: f1, errPct: err(ss.freqs[0], f1), f2: ss.freqs[1], exact2: 4 * f1 },
    pump: {
      nodes: pump.res.x.length, stations: pump.stations, loads: pump.loads, sealUm: +(pump.sealDeflection * 1e6).toFixed(2), maxUm: +(pump.maxDeflection * 1e6).toFixed(2),
      maxMoment: +pump.maxMoment.toFixed(2), sigmaB: +pump.sigmaB.toFixed(2), tau: +pump.tau.toFixed(2), sigmaVM: +pump.sigmaVM.toFixed(2), safety: pump.safety && +pump.safety.toFixed(2),
      critical1: Math.round(pump.critical1), margin: +(pump.margin * 100).toFixed(1), reactions: pump.res.reactions.map((r) => +r.R.toFixed(1)), pass: pump.pass, material: pump.material,
    },
  }
}

import { zip } from '../../src/lib/zip'
export function zipBytes() {
  const r = nest(piecesOf(CABINETS))
  const files = r.sheets.flatMap((sh) => camSheet(sh, DEFAULT_CAM, () => true, 'Villa').programs.map((p) => ({ name: p.name, text: p.text })))
  return { n: files.length, b64: btoa(String.fromCharCode(...zip(files.slice(0, 6)))) }
}
