import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { toast } from '../../state/toast'
import { useInterior, type CamPrefs } from '../../state/interior'
import { Modal } from '../../components/ui/Modal'
import { csv, downloadFile } from '../../components/workspace/Workspace'
import { MATERIALS } from '../../interior/model'
import { DEFAULT_NEST, layoutDxf, nest, piecesOf, verifyNest, type NestSettings } from '../../cam/nesting'
import { camSheet, simulate } from '../../cam/gcode'
import { zip } from '../../lib/zip'
import s from './Nesting.module.css'

const colorOf = (m: string) => MATERIALS.find((x) => x.name === m)?.color ?? '#d9d4cc'

export function nestSettings(c: CamPrefs): NestSettings {
  return { ...DEFAULT_NEST, stock: c.stock, trim: c.trim, gap: c.cnc.cutterD + c.web, grained: c.grain ? DEFAULT_NEST.grained : () => false }
}

/** Nesting of the cabinets' cut lists on stock sheets and the CNC programs that cut them. */
export function NestingDialog({ onClose }: { onClose: () => void }) {
  const T = useT()
  const t = T.interior.cam
  const { doc, cam, set } = useInterior()
  const [sel, setSel] = useState(0)
  const [paths, setPaths] = useState(true)
  const ns = nestSettings(cam)
  const result = useMemo(() => nest(piecesOf(doc.cabinets), ns), [doc.cabinets, cam]) // eslint-disable-line react-hooks/exhaustive-deps
  const hasShelves = (name: string) => (doc.cabinets.find((c) => c.name === name)?.shelves ?? 0) > 0
  const cams = useMemo(() => result.sheets.map((sh) => camSheet(sh, cam.cnc, hasShelves, 'Villa Riverside')), [result, cam]) // eslint-disable-line react-hooks/exhaustive-deps
  const depth = (t0: number) => t0 + cam.cnc.breakthrough
  const sims = useMemo(() => cams.map((c, i) => c.programs.map((p) => simulate(p.text, result.sheets[i], depth(result.sheets[i].t), cam.cnc.cutterD / 2 + 0.01, cam.cnc.rapid))), [cams]) // eslint-disable-line react-hooks/exhaustive-deps
  const nestErrors = useMemo(() => verifyNest(result, ns), [result]) // eslint-disable-line react-hooks/exhaustive-deps
  const materials = [...new Set(piecesOf(doc.cabinets).map((p) => p.material))]
  const sheet = result.sheets[Math.min(sel, result.sheets.length - 1)]
  const cur = cams[Math.min(sel, cams.length - 1)]
  const curSim = sims[Math.min(sel, sims.length - 1)] ?? []
  const totalMin = sims.flat().reduce((a, x) => a + x.seconds, 0) / 60
  const up = (patch: Partial<CamPrefs>) => set({ cam: { ...cam, ...patch } })
  const upc = (patch: Partial<CamPrefs['cnc']>) => set({ cam: { ...cam, cnc: { ...cam.cnc, ...patch } } })
  const num = (v: string, min: number, max: number, fallback: number) => (Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max ? Number(v) : fallback)

  const exportZip = () => {
    const files = cams.flatMap((c) => c.programs.map((p) => ({ name: p.name, text: p.text })))
    const file = 'Villa Riverside - CNC programs.zip'
    downloadFile(file, zip(files), 'application/zip')
    toast(fmt(t.exported, { file }), 'success')
  }
  const exportDxf = () => {
    const file = 'Villa Riverside - sheet layouts.dxf'
    downloadFile(file, layoutDxf(result.sheets, cam.trim, cams.flatMap((c, i) => c.holes.map((h) => ({ sheet: i, x: h.x, y: h.y, d: h.d })))), 'application/dxf')
    toast(fmt(t.exported, { file }), 'success')
  }
  const exportLabels = () => {
    const file = 'Villa Riverside - part labels.csv'
    downloadFile(file, csv([['Sheet', 'Material', 'Part', 'Length (mm)', 'Width (mm)', 'Thickness (mm)', 'X (mm)', 'Y (mm)', 'Rotated'], ...result.sheets.flatMap((sh) => sh.parts.map((p) => [`${sh.material} #${sh.index}`, p.material, p.label, p.l, p.w, p.t, p.x.toFixed(1), p.y.toFixed(1), p.rotated ? 'yes' : 'no']))]))
    toast(fmt(t.exported, { file }), 'success')
  }

  return (
    <Modal title={t.title} onClose={onClose} width={1180}>
      <div className={s.wrap} data-testid="nesting-dialog">
        <aside className={s.side}>
          <h4>{t.stock}</h4>
          {materials.map((m) => {
            const st = cam.stock[m] ?? { l: DEFAULT_NEST.sheetL, w: DEFAULT_NEST.sheetW }
            return (
              <label key={m} className={s.row}>
                <span><i style={{ background: colorOf(m) }} />{m}</span>
                <input aria-label={`${m} length`} value={st.l} inputMode="numeric" onChange={(e) => up({ stock: { ...cam.stock, [m]: { ...st, l: num(e.target.value, 300, 6000, st.l) } } })} />
                ×
                <input aria-label={`${m} width`} value={st.w} inputMode="numeric" onChange={(e) => up({ stock: { ...cam.stock, [m]: { ...st, w: num(e.target.value, 300, 3000, st.w) } } })} />
              </label>
            )
          })}
          <label className={s.row}><span>{t.trim}</span><input aria-label={t.trim} value={cam.trim} onChange={(e) => up({ trim: num(e.target.value, 0, 50, cam.trim) })} /></label>
          <label className={s.row}><span>{t.web}</span><input aria-label={t.web} value={cam.web} onChange={(e) => up({ web: num(e.target.value, 0, 30, cam.web) })} /></label>
          <label className={s.check}><input type="checkbox" checked={cam.grain} onChange={(e) => up({ grain: e.target.checked })} />{t.grain}</label>
          <h4>{t.cnc}</h4>
          <label className={s.row}><span>{t.dialect}</span>
            <select aria-label={t.dialect} value={cam.cnc.dialect} onChange={(e) => upc({ dialect: e.target.value as 'grbl' | 'iso' })}><option value="grbl">{t.grbl}</option><option value="iso">{t.iso}</option></select>
          </label>
          <label className={s.row}><span>{t.cutter}</span><select aria-label={t.cutter} value={cam.cnc.cutterD} onChange={(e) => upc({ cutterD: Number(e.target.value) })}>{[6, 8, 10, 12].map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
          <label className={s.row}><span>{t.feed}</span><input aria-label={t.feed} value={cam.cnc.feed} onChange={(e) => upc({ feed: num(e.target.value, 100, 40000, cam.cnc.feed) })} /></label>
          <label className={s.row}><span>{t.plunge}</span><input aria-label={t.plunge} value={cam.cnc.plunge} onChange={(e) => upc({ plunge: num(e.target.value, 50, 10000, cam.cnc.plunge) })} /></label>
          <label className={s.row}><span>{t.rpm}</span><input aria-label={t.rpm} value={cam.cnc.rpm} onChange={(e) => upc({ rpm: num(e.target.value, 1000, 30000, cam.cnc.rpm) })} /></label>
          <label className={s.row}><span>{t.stepdown}</span><input aria-label={t.stepdown} value={cam.cnc.stepdown} onChange={(e) => upc({ stepdown: num(e.target.value, 1, 30, cam.cnc.stepdown) })} /></label>
          <label className={s.check}><input type="checkbox" checked={cam.cnc.tabs} onChange={(e) => upc({ tabs: e.target.checked })} />{t.tabs}</label>
          <label className={s.check}><input type="checkbox" checked={cam.cnc.hingeCups} onChange={(e) => upc({ hingeCups: e.target.checked })} />{t.hinge}</label>
          <label className={s.check}><input type="checkbox" checked={cam.cnc.shelfPins} onChange={(e) => upc({ shelfPins: e.target.checked })} />{t.pins}</label>
          <p className={s.note}>{t.zero}</p>
        </aside>
        <section className={s.main}>
          <p className={s.summary} data-testid="nesting-summary">
            {fmt(t.summary, { parts: result.sheets.reduce((a, x) => a + x.parts.length, 0), sheets: result.sheets.length })}
            {' — '}
            {Object.entries(result.byMaterial).map(([m, v]) => `${m} × ${v.sheets} (${fmt(t.yield, { y: ((v.partArea / v.sheetArea) * 100).toFixed(0) })})`).join(' · ')}
          </p>
          {result.unplaced.length > 0 && <p className={s.warn}>{fmt(t.unplaced, { n: result.unplaced.length, list: result.unplaced.map((p) => `${p.label} ${p.l}×${p.w}`).join(', ') })}</p>}
          {nestErrors.length > 0 && <p className={s.warn}>{nestErrors.join('; ')}</p>}
          <div className={s.strip} role="tablist">
            {result.sheets.map((sh, i) => (
              <button key={i} type="button" role="tab" aria-selected={i === sel} className={i === sel ? s.on : undefined} onClick={() => setSel(i)}>
                <SheetSvg sheet={sh} small />
                <small>{sh.material.replace('MFC 18 - ', '').replace('HDF 6 - ', 'HDF ')} #{sh.index} · {(sh.yield * 100).toFixed(0)} %</small>
              </button>
            ))}
          </div>
          {sheet && cur && (
            <>
              <div className={s.big}>
                <SheetSvg sheet={sheet} cam={paths ? cur : undefined} cutterR={cam.cnc.cutterD / 2} />
              </div>
              <div className={s.cncRow}>
                <label className={s.check}><input type="checkbox" checked={paths} onChange={(e) => setPaths(e.target.checked)} />{t.toolpaths}</label>
                <b>{t.programs}:</b>
                {cur.programs.map((p, k) => {
                  const sim = curSim[k]
                  return (
                    <span key={p.name} className={sim?.errors.length ? s.bad : s.ok} title={sim?.errors.length ? fmt(t.failed, { e: sim.errors.join('; ') }) : fmt(t.verified, { d: depth(sheet.t).toFixed(1) })}>
                      {p.name.replace(/^.* - /, '')} · {fmt(t.lines, { n: sim?.lines ?? 0 })} · {fmt(t.cut, { m: ((sim?.cutLength ?? 0) / 1000).toFixed(1) })} · {fmt(t.time, { min: ((sim?.seconds ?? 0) / 60).toFixed(1) })} {sim?.errors.length ? '✗' : '✓'}
                    </span>
                  )
                })}
              </div>
            </>
          )}
          <div className={s.foot}>
            <span>{fmt(t.total, { min: totalMin.toFixed(0) })}</span>
            <button type="button" onClick={exportZip} disabled={!cams.length}><Download size={14} />{t.zip}</button>
            <button type="button" onClick={exportDxf} disabled={!cams.length}><Download size={14} />{t.dxf}</button>
            <button type="button" onClick={exportLabels} disabled={!cams.length}><Download size={14} />{t.labels}</button>
          </div>
        </section>
      </div>
    </Modal>
  )
}

function SheetSvg({ sheet, small, cam, cutterR = 4 }: { sheet: ReturnType<typeof nest>['sheets'][number]; small?: boolean; cam?: ReturnType<typeof camSheet>; cutterR?: number }) {
  const { l, w } = sheet
  return (
    <svg viewBox={`-20 -20 ${l + 40} ${w + 40}`} className={small ? s.thumb : s.sheet} role="img" aria-label={`${sheet.material} #${sheet.index}`}>
      <g transform={`translate(0 ${w}) scale(1 -1)`}>
        <rect x={0} y={0} width={l} height={w} className={s.stock} />
        {sheet.parts.map((p) => (
          <rect key={p.id} x={p.x} y={p.y} width={p.sx} height={p.sy} fill={colorOf(p.material)} className={s.part} />
        ))}
        {cam?.profiles.map((pr) => {
          const xs = pr.pts.map((q) => q[0]), ys = pr.pts.map((q) => q[1])
          return <rect key={pr.part} x={Math.min(...xs)} y={Math.min(...ys)} width={Math.max(...xs) - Math.min(...xs)} height={Math.max(...ys) - Math.min(...ys)} rx={cutterR} className={s.path} />
        })}
        {cam?.profiles.flatMap((pr) => pr.tabs.map(([x, y], k) => <rect key={`${pr.part}-${k}`} x={x - 6} y={y - 6} width={12} height={12} className={s.tab} />))}
        {cam?.holes.map((h, k) => <circle key={k} cx={h.x} cy={h.y} r={Math.max(h.d / 2, 3)} className={h.d > 10 ? s.cup : s.pin} />)}
      </g>
      {!small &&
        sheet.parts.map((p) => {
          const fs = Math.min(42, p.sy * 0.22, p.sx / (p.label.length * 0.62))
          return fs >= 9 ? (
            <text key={p.id} x={p.x + p.sx / 2} y={w - (p.y + p.sy / 2)} fontSize={fs} textAnchor="middle" dominantBaseline="middle" className={s.label}>
              {p.label} · {p.l}×{p.w}
            </text>
          ) : null
        })}
    </svg>
  )
}
