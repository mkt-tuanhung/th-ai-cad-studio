import { Download } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { toast } from '../../state/toast'
import { useMech } from '../../state/mech'
import { Modal } from '../../components/ui/Modal'
import { csv, downloadFile } from '../../components/workspace/Workspace'
import { feaOf } from '../../mech/model'
import type { ShaftReport } from '../../mech/fea'
import s from './Fea.module.css'

/** Shaft FEA results: diagrams along the shaft, results against the limits, editable load inputs. */
export function FeaDialog({ onClose }: { onClose: () => void }) {
  const T = useT()
  const t = T.mechanical.fea
  const { doc, fea, set } = useMech()
  const r = feaOf(doc, fea)
  const up = (patch: Partial<typeof fea>) => set({ fea: { ...fea, ...patch } })
  const n0 = (v: number, d = 0) => v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d })
  const rows: [string, string, string, boolean | null][] = [
    [t.seal, `${n0(r.sealDeflection * 1e6, 1)} µm`, t.sealLimit, r.pass.deflection],
    [t.tip, `${n0(r.maxDeflection * 1e6, 1)} µm`, '', null],
    [t.stress, `${n0(r.sigmaVM, 1)} MPa (σb ${n0(r.sigmaB, 1)}, τ ${n0(r.tau, 1)})`, `${r.material.name}: yield ${r.material.yieldMPa || '—'} MPa`, null],
    [t.safety, r.safety ? n0(r.safety, 2) : '—', t.safetyLimit, r.pass.stress],
    [t.critical, `${n0(r.critical1)} rpm (+${n0(r.margin * 100)} %)`, t.criticalLimit, r.pass.critical],
  ]
  const exportCsv = () => {
    const file = 'Centrifugal pump - shaft FEA nodes.csv'
    downloadFile(file, csv([['x (mm)', 'd (mm)', 'deflection (um)', 'rotation (mrad)', 'moment (N.m)', 'shear (N)', 'mode 1 (-)'], ...r.res.x.map((x, i) => [(x * 1000).toFixed(1), (r.res.d[i] * 1000).toFixed(1), (r.res.v[i] * 1e6).toFixed(3), (r.res.theta[i] * 1000).toFixed(4), r.res.M[i].toFixed(3), r.res.shear[i].toFixed(2), (r.res.modes[0]?.[i] ?? 0).toFixed(4)])]))
    toast(fmt(T.mechanical.toast.exported, { file }), 'success')
  }
  return (
    <Modal title={t.title} onClose={onClose} width={980}>
      <div className={s.wrap} data-testid="fea-dialog">
        <p className={s.note}>{fmt(t.model, { n: r.res.x.length, mat: r.material.name, E: r.material.E })}</p>
        <div className={s.grid}>
          <section>
            <Chart r={r} values={r.res.v.map((v) => v * 1e6)} title={t.deflection} unit="µm" stations={t.stations} />
            <Chart r={r} values={r.res.M} title={t.moment} unit="N·m" stations={t.stations} />
            <Chart r={r} values={r.res.modes[0] ?? []} title={fmt(t.mode, { f: n0(r.res.freqs[0] ?? 0, 1), rpm: n0(r.critical1) })} unit="" stations={t.stations} />
          </section>
          <aside>
            <h4>{t.results}</h4>
            <table className={s.table} data-testid="fea-results">
              <tbody>
                {rows.map(([k, v, lim, ok]) => (
                  <tr key={k}>
                    <th>{k}</th>
                    <td>{v}</td>
                    <td className={ok === null ? '' : ok ? s.ok : s.bad}>{lim}{ok === null ? '' : ` — ${ok ? t.ok : t.fail}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={s.small}>{fmt(t.loads, { mi: n0(r.loads.impellerMass, 2), mc: n0(r.loads.couplingMass, 2), T: n0(r.loads.torque, 1) })}</p>
            <p className={s.small}>{fmt(t.reactions, { r: r.res.reactions.map((x) => `${n0(Math.abs(x.R))} N`).join(' / ') })}</p>
            <h4>{t.inputs}</h4>
            <label className={s.row}><span>{t.K}</span><input aria-label={t.K} value={fea.K} onChange={(e) => Number(e.target.value) >= 0 && Number(e.target.value) <= 1 && up({ K: Number(e.target.value) })} /></label>
            <label className={s.row}><span>{t.psi}</span><input aria-label={t.psi} value={fea.psi} onChange={(e) => Number(e.target.value) > 0 && Number(e.target.value) <= 1.5 && up({ psi: Number(e.target.value) })} /></label>
            <label className={s.row}><span>{t.fr}</span><input aria-label={t.fr} value={fea.radialForce ?? ''} placeholder={n0(r.loads.Fr)} onChange={(e) => up({ radialForce: e.target.value.trim() === '' ? null : Math.max(0, Number(e.target.value) || 0) })} /></label>
            <label className={s.row}><span>{t.kb}</span><input aria-label={t.kb} value={fea.bearingK / 1e6} onChange={(e) => Number(e.target.value) > 0 && up({ bearingK: Number(e.target.value) * 1e6 })} /></label>
            <p className={s.small}>{fmt(t.estimate, { u: n0(r.loads.tipSpeed, 1), H: n0(r.loads.head, 1), b2: n0(r.loads.b2 * 1000, 1), fr: n0(r.loads.Fr) })}</p>
            <p className={s.small}>{t.note}</p>
            <button type="button" className={s.btn} onClick={exportCsv}><Download size={14} />{t.csv}</button>
          </aside>
        </div>
      </div>
    </Modal>
  )
}

function Chart({ r, values, title, unit, stations }: { r: ShaftReport; values: number[]; title: string; unit: string; stations: Record<string, string> }) {
  const W = 560, H = 132, pad = { l: 46, r: 10, t: 18, b: 22 }
  const xs = r.res.x.map((x) => x * 1000)
  const x0 = Math.min(...xs), x1 = Math.max(...xs)
  const v0 = Math.min(0, ...values), v1 = Math.max(0, ...values)
  const X = (x: number) => pad.l + ((x - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r)
  const Y = (v: number) => pad.t + (1 - (v - v0) / (v1 - v0 || 1)) * (H - pad.t - pad.b)
  const st = r.stations
  const marks: [string, number][] = [[stations.impeller, st.impeller], [stations.seal, st.seal], [stations.bearing1, st.bearing1], [stations.bearing2, st.bearing2], [stations.coupling, st.coupling]]
  const peak = values.reduce((a, c) => (Math.abs(c) > Math.abs(a) ? c : a), 0)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={s.chart} role="img" aria-label={title}>
      <text x={pad.l} y={12} className={s.title}>{title}{unit && peak ? ` · max ${Math.abs(peak) < 10 ? peak.toFixed(2) : peak.toFixed(0)} ${unit}` : ''}</text>
      <line x1={pad.l} x2={W - pad.r} y1={Y(0)} y2={Y(0)} className={s.axis} />
      {marks.map(([name, x]) => (
        <g key={name}>
          <line x1={X(x * 1000)} x2={X(x * 1000)} y1={pad.t} y2={H - pad.b} className={name.includes('1') || name.includes('2') ? s.support : s.mark} />
          <text x={X(x * 1000)} y={H - 8} textAnchor="middle" className={s.tick}>{name}</text>
        </g>
      ))}
      <path d={values.map((v, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')} className={s.curve} />
      <text x={pad.l - 4} y={Y(v1) + 4} textAnchor="end" className={s.tick}>{v1.toFixed(Math.abs(v1) < 10 ? 2 : 0)}</text>
      <text x={pad.l - 4} y={Y(v0)} textAnchor="end" className={s.tick}>{v0.toFixed(Math.abs(v0) < 10 ? 2 : 0)}</text>
    </svg>
  )
}
