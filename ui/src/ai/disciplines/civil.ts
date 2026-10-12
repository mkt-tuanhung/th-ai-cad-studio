import type { Discipline, Op, OpSpec } from '../discipline'
import { checks, earthwork, hydraulics, interp, segments, sta, type CivilModel, type DesignParams } from '../../civil/model'
import { validateCivil } from '../../state/civil'

const PARAMS: (keyof DesignParams)[] = ['bottomWidth', 'sideSlope', 'freeboard', 'manningN', 'discharge', 'slopeMin', 'slopeMax', 'liningT']
const r3 = (v: number) => Math.round(v * 1000) / 1000

export const civilAi: Discipline<CivilModel> = {
  key: 'civil',
  role: 'civil / canal design',
  ops: (m): OpSpec[] => [
    { op: 'setDesignParameter', desc: 'change a design parameter (hydraulics, quantities and checks are recomputed)', args: { name: { kind: 'enum', values: PARAMS }, value: { kind: 'number', min: 0, max: 500, desc: 'bottomWidth m, sideSlope H:1V, freeboard m, manningN, discharge m³/s, slopeMin/slopeMax m/m, liningT m' } } },
    { op: 'setInvert', desc: 'set the design invert elevation at a station (adds a grade break if there is none)', args: { station: { kind: 'number', min: m.alignment.start, max: m.alignment.end, unit: 'm' }, elevation: { kind: 'number', min: -50, max: 500, unit: 'm' } } },
    { op: 'regrade', desc: 'make the invert between two stations a constant slope, keeping the elevation at "from"; everything downstream of "to" moves by the same amount (computed)', args: { from: { kind: 'number', min: m.alignment.start, max: m.alignment.end, unit: 'm' }, to: { kind: 'number', min: m.alignment.start, max: m.alignment.end, unit: 'm' }, slope: { kind: 'number', min: 0, max: 0.05, unit: 'm/m (falling downstream)' } } },
    { op: 'moveCulvert', desc: 'move a culvert to another station (its invert follows the design profile)', args: { culvert: { kind: 'enum', values: m.culverts.map((c) => c.id) }, station: { kind: 'number', min: m.alignment.start, max: m.alignment.end, unit: 'm' } } },
  ],
  context: (m) => {
    const h = hydraulics(m), c = checks(m)
    const ew = earthwork(m).reduce((a, r) => ({ cut: a.cut + r.cut, fill: a.fill + r.fill }), { cut: 0, fill: 0 })
    return [
      `Alignment ${m.alignment.name}: ${sta(m.alignment.start)} … ${sta(m.alignment.end)} (${m.alignment.end - m.alignment.start} m)`,
      `Design parameters: ${PARAMS.map((k) => `${k}=${m.params[k]}`).join(', ')}, lining=${m.params.lining}`,
      'Design invert vertices (station m | elevation m):',
      m.invert.map(([s, z]) => `${s} | ${z}`).join('; '),
      'Segments (from–to | slope m/m):',
      segments(m.invert).map((g) => `${g.from}–${g.to} | ${g.slope.toFixed(5)}`).join('; '),
      `Hydraulics: normal depth ${h.y.toFixed(3)} m, velocity ${h.v.toFixed(2)} m/s, Froude ${h.fr.toFixed(2)}, section depth ${h.H} m, top width ${h.top.toFixed(2)} m`,
      `Checks: flat segments (< slopeMin) ${c.flat.map((g) => `${g.from}–${g.to}`).join(', ') || 'none'}; steep segments ${c.steep.map((g) => `${g.from}–${g.to}`).join(', ') || 'none'}; velocity ${c.velocityOk ? 'ok' : 'out of 0.6–3.0 m/s'}; Froude ${c.froudeOk ? 'ok' : '≥ 0.8'}; freeboard ${c.freeboardOk ? 'ok' : '< 0.5 m'}`,
      `Culverts: ${m.culverts.map((x) => `${x.id} at ${x.station} m (invert ${x.invert}, ${x.size})`).join('; ')}`,
      `Earthwork: cut ${ew.cut.toFixed(0)} m³, fill ${ew.fill.toFixed(0)} m³; existing ground from ${m.ground ? 'the survey surface' : 'the sample profile'}`,
    ].join('\n')
  },
  apply: (m, op: Op) => {
    const a = op as Record<string, unknown>
    const followCulverts = (inv: [number, number][]) => m.culverts.map((c) => ({ ...c, invert: r3(interp(inv, c.station)) }))
    switch (op.op) {
      case 'setDesignParameter': {
        const k = a.name as keyof DesignParams
        return { model: { ...m, params: { ...m.params, [k]: a.value as number } }, change: `${k}: ${m.params[k]} → ${a.value}` }
      }
      case 'setInvert': {
        const s = a.station as number, z = a.elevation as number
        const old = interp(m.invert, s)
        const inv = [...m.invert.filter(([x]) => Math.abs(x - s) > 1e-6), [s, z] as [number, number]].sort((p, q) => p[0] - q[0])
        return { model: { ...m, invert: inv, culverts: followCulverts(inv) }, change: `invert at ${sta(s)}: ${old.toFixed(3)} → ${z.toFixed(3)} m` }
      }
      case 'regrade': {
        const f = a.from as number, t = a.to as number, sl = a.slope as number
        if (!(t > f)) return { error: '"to" must be downstream of "from"' }
        const zf = interp(m.invert, f), zt0 = interp(m.invert, t), zt = r3(zf - sl * (t - f))
        const delta = zt - zt0
        const inv: [number, number][] = [
          ...m.invert.filter(([s]) => s < f - 1e-6),
          [f, r3(zf)],
          [t, zt],
          ...m.invert.filter(([s]) => s > t + 1e-6).map(([s, z]) => [s, r3(z + delta)] as [number, number]),
        ]
        return { model: { ...m, invert: inv, culverts: followCulverts(inv) }, change: `regrade ${sta(f)}–${sta(t)} at ${sl} m/m: invert at ${sta(t)} ${zt0.toFixed(3)} → ${zt.toFixed(3)} m; downstream ${delta >= 0 ? '+' : ''}${delta.toFixed(3)} m` }
      }
      case 'moveCulvert': {
        const c = m.culverts.find((x) => x.id === a.culvert)!
        const s = a.station as number
        return { model: { ...m, culverts: m.culverts.map((x) => (x.id === c.id ? { ...x, station: s, invert: r3(interp(m.invert, s)) } : x)) }, change: `${c.id}: ${sta(c.station)} → ${sta(s)} (invert ${r3(interp(m.invert, s))} m)` }
      }
    }
    return { error: 'unknown operation' }
  },
  validate: validateCivil,
  examples: [
    { request: 'Set the bottom width to 7 m', reply: { title: 'Bottom width 7.0 m', ops: [{ op: 'setDesignParameter', name: 'bottomWidth', value: 7 }] } },
    { request: 'Add a bridge over the canal at 0+300', reply: { title: 'Bridges are not part of the canal model — no operation creates them', ops: [] } },
    { request: 'Sửa đoạn dốc phẳng 120–160 thành độ dốc 0.0005', reply: { title: 'Kẻ lại đoạn 0+120–0+160 với i = 0.0005', ops: [{ op: 'regrade', from: 120, to: 160, slope: 0.0005 }] } },
  ],
}
