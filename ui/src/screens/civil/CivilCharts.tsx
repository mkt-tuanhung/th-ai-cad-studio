import { fmt, useT } from '../../i18n'
import { groundOf, hydraulics, interp, segments, sta, type CivilModel, type CivilNote } from '../../civil/model'
import { crossLine } from '../../civil/tin'
import { tinOf } from '../../civil/surveyModel'
import s from './Civil.module.css'

/** Longitudinal profile drawn from the model: EG (survey), design invert, top of bank, culverts. */
/** Notes and dimensions of one chart, drawn through its own X / Y. */
function Notes({ notes, X, Y, pending, label }: { notes: CivilNote[]; X: (x: number) => number; Y: (z: number) => number; pending?: [number, number] | null; label: (n: CivilNote) => string }) {
  return (
    <g className={s.notes} data-testid="chart-notes">
      {notes.map((n) =>
        n.kind === 'text' ? (
          <g key={n.id}>
            <circle cx={X(n.a[0])} cy={Y(n.a[1])} r={2.5} className={s.noteDot} />
            <text x={X(n.a[0]) + 5} y={Y(n.a[1]) - 5} className={s.noteText}>{n.text}</text>
          </g>
        ) : (
          <g key={n.id}>
            <line x1={X(n.a[0])} y1={Y(n.a[1])} x2={X(n.b![0])} y2={Y(n.b![1])} className={s.noteDim} />
            {[n.a, n.b!].map((q, i) => <circle key={i} cx={X(q[0])} cy={Y(q[1])} r={2.5} className={s.noteDot} />)}
            <text x={(X(n.a[0]) + X(n.b![0])) / 2} y={(Y(n.a[1]) + Y(n.b![1])) / 2 - 6} textAnchor="middle" className={s.noteText}>{label(n)}</text>
          </g>
        ),
      )}
      {pending && <circle cx={X(pending[0])} cy={Y(pending[1])} r={4} className={s.notePending} />}
    </g>
  )
}

export interface ChartTool {
  active: boolean
  pending: [number, number] | null
  onPoint: (x: number, z: number) => void
}

export function ProfileChart({ m, w, h, station, onStation, tool, range }: { m: CivilModel; w: number; h: number; station: number; onStation: (s: number) => void; tool?: ChartTool; range?: [number, number] | null }) {
  const T = useT().civil
  const t = T.profile
  const { H } = hydraulics(m)
  const pad = { l: 44, r: 10, t: 10, b: 24 }
  const s0 = range?.[0] ?? m.alignment.start, s1 = range?.[1] ?? m.alignment.end
  const EG = groundOf(m)
  const zs = [...EG.map(([, z]) => z), ...m.invert.map(([, z]) => z), ...m.invert.map(([, z]) => z + H)]
  const zmin = Math.floor(Math.min(...zs) - 0.5), zmax = Math.ceil(Math.max(...zs) + 0.8)
  const X = (st: number) => pad.l + ((st - s0) / (s1 - s0)) * (w - pad.l - pad.r)
  const Y = (z: number) => pad.t + ((zmax - z) / (zmax - zmin)) * (h - pad.t - pad.b)
  const line = (pts: [number, number][]) => pts.map(([a, b], i) => `${i ? 'L' : 'M'}${X(a).toFixed(1)},${Y(b).toFixed(1)}`).join(' ')
  const tob = m.invert.map(([a, b]) => [a, b + H] as [number, number])
  const flat = segments(m.invert).filter((g) => g.slope < m.params.slopeMin)
  const yTicks: number[] = []
  const stepZ = zmax - zmin > 8 ? 2 : 1
  for (let z = zmin; z <= zmax; z += stepZ) yTicks.push(z)
  const xTicks: number[] = []
  const tick = s1 - s0 > 400 ? 100 : s1 - s0 > 150 ? 50 : 20
  for (let st = Math.ceil(s0 / tick) * tick; st <= s1; st += tick) xTicks.push(st)
  return (
    <svg className={`${s.chart} ${tool?.active ? s.chartTool : ''}`} width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={t.title} data-testid="profile-chart" data-view={`${pad.l},${pad.t},${w - pad.l - pad.r},${h - pad.t - pad.b},${s0},${s1},${zmin},${zmax}`} onClick={(e) => {
      const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
      const st = s0 + ((e.clientX - r.left - pad.l) / (w - pad.l - pad.r)) * (s1 - s0)
      if (tool?.active) {
        const z = zmax - ((e.clientY - r.top - pad.t) / (h - pad.t - pad.b)) * (zmax - zmin)
        if (st >= s0 && st <= s1) tool.onPoint(Math.round(st * 10) / 10, Math.round(z * 1000) / 1000)
        return
      }
      if (st >= s0 && st <= s1) onStation(Math.round(st / 20) * 20)
    }}>
      {yTicks.map((z) => (
        <g key={z}>
          <line x1={pad.l} x2={w - pad.r} y1={Y(z)} y2={Y(z)} className={s.grid} />
          <text x={pad.l - 6} y={Y(z) + 3} className={s.tick} textAnchor="end">{z}</text>
        </g>
      ))}
      {xTicks.map((st) => (
        <g key={st}>
          <line x1={X(st)} x2={X(st)} y1={pad.t} y2={h - pad.b} className={s.grid} />
          <text x={X(st)} y={h - 8} className={s.tick} textAnchor="middle">{sta(st)}</text>
        </g>
      ))}
      <text x={12} y={(h - pad.b) / 2 + pad.t} className={s.axis} transform={`rotate(-90 12 ${(h - pad.b) / 2 + pad.t})`} textAnchor="middle">{t.elev}</text>
      <path d={`${line(m.invert)} L${X(s1)},${Y(interp(m.invert, s1) + hydraulics(m).y)} ${m.invert.slice().reverse().map(([a, b]) => `L${X(a).toFixed(1)},${Y(b + hydraulics(m).y).toFixed(1)}`).join(' ')} Z`} className={s.water} />
      <defs>
        <clipPath id="profClip"><rect x={pad.l} y={pad.t} width={w - pad.l - pad.r} height={h - pad.t - pad.b} /></clipPath>
      </defs>
      <path d={line(EG)} className={s.eg} clipPath="url(#profClip)" />
      <path d={line(tob)} className={s.tob} clipPath="url(#profClip)" />
      <path d={line(m.invert)} className={s.dg} clipPath="url(#profClip)" />
      {flat.map((g) => <path key={g.from} d={line([[g.from, interp(m.invert, g.from)], [g.to, interp(m.invert, g.to)]])} className={s.flat}><title>{`${sta(g.from)}–${sta(g.to)}: ${t.flat}`}</title></path>)}
      {m.culverts.map((c) => (
        <g key={c.id}>
          <rect x={X(c.station) - 4} y={Y(c.invert) - 9} width={8} height={11} className={s.culvert} />
          <line x1={X(c.station)} x2={X(c.station)} y1={Y(c.invert) - 9} y2={Y(c.invert) - 26} className={s.leader} />
          <text x={X(c.station) - 14} y={Y(c.invert) - 50} className={s.label}>{T.names[c.name] ?? c.name}</text>
          <text x={X(c.station) - 14} y={Y(c.invert) - 39} className={s.label}>Sta {sta(c.station)}</text>
          <text x={X(c.station) - 14} y={Y(c.invert) - 28} className={s.label}>{fmt(t.invert, { z: c.invert.toFixed(2) })}</text>
        </g>
      ))}
      <line x1={X(station)} x2={X(station)} y1={pad.t} y2={h - pad.b} className={s.cursor} />
      <Notes notes={(m.notes ?? []).filter((n) => n.view === 'profile')} X={X} Y={Y} pending={tool?.pending} label={(n) => { const l = Math.abs(n.b![0] - n.a[0]), dz = n.b![1] - n.a[1]; return `${l.toFixed(1)} m · Δz ${dz.toFixed(3)} m · ${l ? ((dz / l) * 100).toFixed(3) : '—'} %` }} />
      <g transform={`translate(${w - pad.r - 128}, ${pad.t + 2})`}>
        <rect width={126} height={44} rx={4} className={s.legend} />
        <line x1={8} x2={26} y1={10} y2={10} className={s.eg} /><text x={32} y={13} className={s.legendText}>{t.eg}</text>
        <line x1={8} x2={26} y1={22} y2={22} className={s.dg} /><text x={32} y={25} className={s.legendText}>{t.dg}</text>
        <line x1={8} x2={26} y1={34} y2={34} className={s.tob} /><text x={32} y={37} className={s.legendText}>{t.tob}</text>
      </g>
    </svg>
  )
}

/** Trapezoidal cross section at a station: design section, normal-depth water, existing ground and dimensions. */
export function SectionChart({ m, w, h, station, tool }: { m: CivilModel; w: number; h: number; station: number; tool?: ChartTool }) {
  const hy = hydraulics(m)
  const { bottomWidth: b, sideSlope: k } = m.params
  const H = hy.H
  const top = b + 2 * k * H
  const inv = interp(m.invert, station)
  const g = interp(groundOf(m), station) - inv // ground above invert (centre line)
  const span = top + 6
  // surveyed ground across the section (from the TIN), relative to the invert
  const tin = tinOf(m)
  const cross = tin && m.plan ? crossLine(tin, m.plan, station, span / 2, 0.5).map(([o, z]) => [o, z - inv] as [number, number]) : []
  const zTop = Math.max(H, g, ...cross.map(([, z]) => z)) + 1.2, zBot = -0.25
  // vertical exaggeration (as on drawn canal sections): the depth would otherwise be a sliver
  const sx = (w - 60) / span
  const sy = Math.min((h - 34) / (zTop - zBot), sx * 8)
  const ve = sy / sx
  const cx = w / 2
  const X = (x: number) => cx + x * sx
  const Y = (z: number) => h - 14 - (z - zBot) * sy
  const half = top / 2
  const groundL = Math.min(g, H), bank = H
  const n2 = (v: number) => `${v.toFixed(2)} m`
  return (
    <svg className={`${s.chart} ${tool?.active ? s.chartTool : ''}`} width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Cross section ${sta(station)}`} data-testid="section-chart" data-view={`${cx},${sx},${sy},${h},${zBot},${inv}`} onClick={(e) => {
      if (!tool?.active) return
      const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
      const x = (e.clientX - r.left - cx) / sx, zr = zBot + (h - 14 - (e.clientY - r.top)) / sy
      tool.onPoint(Math.round(x * 100) / 100, Math.round((inv + zr) * 1000) / 1000)
    }}>
      <defs>
        <pattern id="soil" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="#c9ced4" strokeWidth="1" />
        </pattern>
      </defs>
      {/* soil around the cut */}
      <path d={`M${X(-span / 2)},${Y(groundL)} L${X(-half)},${Y(bank)} L${X(-b / 2)},${Y(0)} L${X(b / 2)},${Y(0)} L${X(half)},${Y(bank)} L${X(span / 2)},${Y(groundL)} L${X(span / 2)},${Y(zBot)} L${X(-span / 2)},${Y(zBot)} Z`} fill="url(#soil)" className={s.soil} />
      {/* existing ground at this station */}
      {cross.length >= 2 ? (
        <path d={cross.map(([o, z], i) => `${i ? 'L' : 'M'}${X(o).toFixed(1)},${Y(z).toFixed(1)}`).join(' ')} className={s.egLine} fill="none" data-testid="section-survey-ground" />
      ) : (
        <line x1={X(-span / 2)} x2={X(span / 2)} y1={Y(g)} y2={Y(g)} className={s.egLine} />
      )}
      <line x1={X(-span / 2)} x2={X(-half)} y1={Y(bank)} y2={Y(bank)} className={s.grass} />
      <line x1={X(half)} x2={X(span / 2)} y1={Y(bank)} y2={Y(bank)} className={s.grass} />
      {/* water at normal depth */}
      <path d={`M${X(-b / 2 - k * hy.y)},${Y(hy.y)} L${X(-b / 2)},${Y(0)} L${X(b / 2)},${Y(0)} L${X(b / 2 + k * hy.y)},${Y(hy.y)} Z`} className={s.waterSec} />
      <path d={`M${X(-half)},${Y(bank)} L${X(-b / 2)},${Y(0)} L${X(b / 2)},${Y(0)} L${X(half)},${Y(bank)}`} className={s.secLine} />
      {/* dimensions */}
      <g className={s.dim}>
        <line x1={X(-half)} x2={X(half)} y1={Y(zTop - 0.25)} y2={Y(zTop - 0.25)} />
        <text x={cx} y={Y(zTop - 0.25) - 4} textAnchor="middle">{n2(top)}</text>
        <line x1={X(-half)} x2={X(-b / 2)} y1={Y(zTop - 0.85)} y2={Y(zTop - 0.85)} />
        <line x1={X(-b / 2)} x2={X(b / 2)} y1={Y(zTop - 0.85)} y2={Y(zTop - 0.85)} />
        <line x1={X(b / 2)} x2={X(half)} y1={Y(zTop - 0.85)} y2={Y(zTop - 0.85)} />
        <text x={X(-(half + b / 2) / 2)} y={Y(zTop - 0.85) - 4} textAnchor="middle">{(k * H).toFixed(2)}</text>
        <text x={cx} y={Y(zTop - 0.85) - 4} textAnchor="middle">{n2(b)}</text>
        <text x={X((half + b / 2) / 2)} y={Y(zTop - 0.85) - 4} textAnchor="middle">{(k * H).toFixed(2)}</text>
        {[-half, -b / 2, b / 2, half].map((x) => <line key={x} x1={X(x)} x2={X(x)} y1={Y(zTop - 0.1)} y2={Y(x === -half || x === half ? bank : 0)} className={s.ext} />)}
        <line x1={X(half + 1.4)} x2={X(half + 1.4)} y1={Y(0)} y2={Y(bank)} />
        <text x={X(half + 1.6)} y={(Y(0) + Y(bank)) / 2 + 3}>{n2(H)}</text>
        <text x={cx} y={(Y(0) + Y(hy.y)) / 2 + 4} textAnchor="middle" className={s.waterText}>{n2(hy.y)}</text>
      </g>
      <text x={X(-(half + b / 2) / 2) - 8} y={(Y(0) + Y(bank)) / 2} className={s.slope} transform={`rotate(${-Math.atan2(ve, k) * 57.3} ${X(-(half + b / 2) / 2) - 8} ${(Y(0) + Y(bank)) / 2})`}>1:{k.toFixed(1)}</text>
      <text x={X((half + b / 2) / 2) + 2} y={(Y(0) + Y(bank)) / 2} className={s.slope} transform={`rotate(${Math.atan2(ve, k) * 57.3} ${X((half + b / 2) / 2) + 2} ${(Y(0) + Y(bank)) / 2})`}>1:{k.toFixed(1)}</text>
      <text x={w - 6} y={h - 3} className={s.slope} textAnchor="end">V:H = {ve.toFixed(1)}:1</text>
      <Notes notes={(m.notes ?? []).filter((n) => n.view === 'section' && n.station === station)} X={X} Y={(z) => Y(z - inv)} pending={tool?.pending} label={(n) => { const l = Math.hypot(n.b![0] - n.a[0], 0), dz = n.b![1] - n.a[1]; return `${Math.hypot(l, dz).toFixed(2)} m · Δz ${dz.toFixed(2)} m` }} />
    </svg>
  )
}
