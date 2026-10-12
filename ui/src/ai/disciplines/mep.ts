import type { Discipline, Op, OpSpec } from '../discipline'
import { findClashes, designChecks, type MepModel } from '../../mep/model'
import { validateMep } from '../../state/mep'
import { cableCheck, ductLoss, pipeCheck, PIPE_ID, LIMITS } from '../../mep/calc'

const CABLES = ['1.5', '2.5', '4', '6', '10', '16', '25', '35', '50']
const BREAKERS = ['6', '10', '16', '20', '25', '32', '40', '50', '63']
const r1 = (v: number) => Math.round(v * 10) / 10

export const mepAi: Discipline<MepModel> = {
  key: 'mep',
  role: 'MEP (HVAC, plumbing, electrical) coordination',
  ops: (m): OpSpec[] => [
    { op: 'resizeDuct', desc: 'set the clear size of a duct (velocity and friction are recomputed)', args: { duct: { kind: 'enum', values: m.ducts.map((d) => d.id) }, w: { kind: 'number', min: 100, max: 2500, unit: 'mm', integer: true }, h: { kind: 'number', min: 100, max: 1500, unit: 'mm', integer: true } } },
    { op: 'setDuctElevation', desc: 'move a duct up or down (centre-line elevation above its level)', args: { duct: { kind: 'enum', values: m.ducts.map((d) => d.id) }, elevation: { kind: 'number', min: 1800, max: 3600, unit: 'mm', integer: true } } },
    { op: 'lowerDuctBelowBeams', desc: 'place a duct at the highest elevation where it clashes with nothing (computed)', args: { duct: { kind: 'enum', values: m.ducts.map((d) => d.id) } } },
    { op: 'resizePipe', desc: 'set the nominal diameter of a pipe', args: { pipe: { kind: 'enum', values: m.pipes.map((p) => p.id) }, dn: { kind: 'enum', values: Object.keys(PIPE_ID) } } },
    { op: 'setPipeElevation', desc: 'move a pipe up or down (centre-line elevation above its level)', args: { pipe: { kind: 'enum', values: m.pipes.map((p) => p.id) }, elevation: { kind: 'number', min: 1800, max: 3600, unit: 'mm', integer: true } } },
    { op: 'setCable', desc: 'set the cable cross-section of a circuit', args: { circuit: { kind: 'enum', values: m.circuits.map((c) => c.id) }, cable: { kind: 'enum', values: CABLES, desc: 'mm²' } } },
    { op: 'upsizeCableForVoltageDrop', desc: 'set a circuit to the smallest cable that keeps its voltage drop within the limit (computed)', args: { circuit: { kind: 'enum', values: m.circuits.map((c) => c.id) } } },
    { op: 'setBreaker', desc: 'set the breaker rating of a circuit', args: { circuit: { kind: 'enum', values: m.circuits.map((c) => c.id) }, breaker: { kind: 'enum', values: BREAKERS, desc: 'A' } } },
  ],
  context: (m) => {
    const clashes = findClashes(m)
    const findings = designChecks(m)
    return [
      `Limits: duct velocity ≤ ${LIMITS.ductVelMain} m/s, duct friction ≤ ${LIMITS.ductLoss} Pa/m, pipe velocity ≤ ${LIMITS.pipeVel} m/s, voltage drop ≤ ${LIMITS.vdPct} %. Beams 300×600 with soffit at 3000 mm above each level.`,
      'Ducts (id | type | w×h mm | flow L/s | velocity m/s | friction Pa/m | elevation mm | level):',
      ...m.ducts.map((d) => { const l = ductLoss(d.w, d.h, d.flow); return `${d.id} | ${d.type} | ${d.w}×${d.h} | ${d.flow} | ${r1(l.v)} | ${l.paPerM.toFixed(2)} | ${d.elevation} | ${d.level}` }),
      'Pipes (id | service | DN | flow L/s | velocity m/s | elevation mm | level):',
      ...m.pipes.map((p) => `${p.id} | ${p.service} | ${p.dn} | ${p.flow} | ${pipeCheck(p.dn, p.flow).v.toFixed(2)} | ${p.elevation} | ${p.level}`),
      'Circuits (id | mark | load | kW | phases | cable mm² | breaker A | length m | current A | voltage drop %):',
      ...m.circuits.map((c) => { const k = cableCheck(c.kw, c.phases, c.cable, c.length); return `${c.id} | ${c.mark} | ${c.load} | ${c.kw} | ${c.phases} | ${c.cable} | ${c.breaker} | ${c.length} | ${k.i.toFixed(1)} | ${k.vdPct.toFixed(2)}` }),
      `Clashes (${clashes.length}): ${clashes.map((c) => `${c.id.replace('×', ' × ')} (${c.kind}, ${c.level}, ${c.depth} mm)`).join('; ') || 'none'}`,
      `Design findings (${findings.length}): ${findings.map((f) => `${f.target.id} ${f.rule} ${f.value.toFixed(2)} > ${f.limit}`).join('; ') || 'none'}`,
    ].join('\n')
  },
  apply: (m, op: Op) => {
    const a = op as Record<string, unknown>
    switch (op.op) {
      case 'resizeDuct': {
        const d = m.ducts.find((x) => x.id === a.duct)!
        const v0 = ductLoss(d.w, d.h, d.flow).v, v1 = ductLoss(a.w as number, a.h as number, d.flow).v
        return { model: { ...m, ducts: m.ducts.map((x) => (x.id === d.id ? { ...x, w: a.w as number, h: a.h as number } : x)) }, change: `${d.mark} (${d.level}): ${d.w}×${d.h} → ${a.w}×${a.h} mm · v ${r1(v0)} → ${r1(v1)} m/s` }
      }
      case 'setDuctElevation': {
        const d = m.ducts.find((x) => x.id === a.duct)!
        return { model: { ...m, ducts: m.ducts.map((x) => (x.id === d.id ? { ...x, elevation: a.elevation as number } : x)) }, change: `${d.mark} (${d.level}): elevation ${d.elevation} → ${a.elevation} mm` }
      }
      case 'lowerDuctBelowBeams': {
        const d = m.ducts.find((x) => x.id === a.duct)!
        // highest clash-free elevation, 50 mm steps (same rule as the "Lower to clear the beam" fix)
        for (let e = Math.floor((3000 - d.h / 2 - d.insulation) / 50) * 50; e >= 1800; e -= 50) {
          const trial = { ...m, ducts: m.ducts.map((x) => (x.id === d.id ? { ...x, elevation: e } : x)) }
          if (!findClashes(trial).some((c) => c.id.split('×').includes(d.id))) return { model: trial, change: `${d.mark} (${d.level}): elevation ${d.elevation} → ${e} mm (clash-free)` }
        }
        return { error: `${d.mark}: no clash-free elevation below the beams — re-route needed` }
      }
      case 'resizePipe': {
        const p = m.pipes.find((x) => x.id === a.pipe)!
        const dn = Number(a.dn)
        return { model: { ...m, pipes: m.pipes.map((x) => (x.id === p.id ? { ...x, dn } : x)) }, change: `${p.mark}: DN${p.dn} → DN${dn} · v ${pipeCheck(p.dn, p.flow).v.toFixed(2)} → ${pipeCheck(dn, p.flow).v.toFixed(2)} m/s` }
      }
      case 'setPipeElevation': {
        const p = m.pipes.find((x) => x.id === a.pipe)!
        return { model: { ...m, pipes: m.pipes.map((x) => (x.id === p.id ? { ...x, elevation: a.elevation as number } : x)) }, change: `${p.mark}: elevation ${p.elevation} → ${a.elevation} mm` }
      }
      case 'setCable': {
        const c = m.circuits.find((x) => x.id === a.circuit)!
        const mm2 = Number(a.cable)
        return { model: { ...m, circuits: m.circuits.map((x) => (x.id === c.id ? { ...x, cable: mm2 } : x)) }, change: `${c.mark} (${c.load}): cable ${c.cable} → ${mm2} mm² · ΔU ${cableCheck(c.kw, c.phases, c.cable, c.length).vdPct.toFixed(2)} → ${cableCheck(c.kw, c.phases, mm2, c.length).vdPct.toFixed(2)} %` }
      }
      case 'upsizeCableForVoltageDrop': {
        const c = m.circuits.find((x) => x.id === a.circuit)!
        const size = CABLES.map(Number).find((s) => s >= c.cable && cableCheck(c.kw, c.phases, s, c.length).vdPct <= LIMITS.vdPct)
        if (size === undefined) return { error: `${c.mark}: no cable up to ${CABLES[CABLES.length - 1]} mm² keeps ΔU ≤ ${LIMITS.vdPct} %` }
        return { model: { ...m, circuits: m.circuits.map((x) => (x.id === c.id ? { ...x, cable: size } : x)) }, change: `${c.mark} (${c.load}): cable ${c.cable} → ${size} mm² · ΔU ${cableCheck(c.kw, c.phases, c.cable, c.length).vdPct.toFixed(2)} → ${cableCheck(c.kw, c.phases, size, c.length).vdPct.toFixed(2)} %` }
      }
      case 'setBreaker': {
        const c = m.circuits.find((x) => x.id === a.circuit)!
        return { model: { ...m, circuits: m.circuits.map((x) => (x.id === c.id ? { ...x, breaker: Number(a.breaker) } : x)) }, change: `${c.mark} (${c.load}): breaker ${c.breaker} → ${a.breaker} A` }
      }
    }
    return { error: 'unknown operation' }
  },
  validate: validateMep,
  examples: [
    { request: 'Make SA-02 on level 2 600 wide so the velocity drops', reply: { title: 'Widen SA-02 (Level 2) to 600 × 300', ops: [{ op: 'resizeDuct', duct: 'SA-02-L2', w: 600, h: 300 }] } },
    { request: 'Add a sprinkler head in the kitchen', reply: { title: 'New equipment cannot be added here — only existing ducts, pipes and circuits can be changed', ops: [] } },
    { request: 'Hạ ống gió OA-15 tầng 2 xuống dưới dầm', reply: { title: 'Hạ OA-15 (Tầng 2) xuống dưới dầm', ops: [{ op: 'lowerDuctBelowBeams', duct: 'OA-15-L2' }] } },
  ],
}
