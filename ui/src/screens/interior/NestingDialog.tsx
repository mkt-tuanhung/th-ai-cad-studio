import { useMemo, useState } from 'react'
import { Download, Lock } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { blockerText } from '../../i18n/ws/cnc'
import { toast } from '../../state/toast'
import { useInterior, type CamPrefs } from '../../state/interior'
import { currentCommissioning, useMachines } from '../../state/machines'
import { Modal } from '../../components/ui/Modal'
import { csv, downloadFile } from '../../components/workspace/Workspace'
import { MATERIALS } from '../../interior/model'
import { DEFAULT_NEST, labelRows, layoutDxf, type NestSettings } from '../../cam/nesting'
import type { CamResult } from '../../cam/gcode'
import { profileContentHash } from '../../cam/machine'
import { approveJob, markReviewed, newJob, releaseJob, selectMachine, type ManufacturingJob, type StockRecord } from '../../cam/job'
import { interiorCnc } from '../../cam/interiorJob'
import { MOTION_ISSUES } from '../../cam/ncparse'
import { POSTS, POST_IDS } from '../../cam/posts'
import { ProductionBlocked, previewFiles, productionFiles } from '../../cam/release'
import { sha256 } from '../../lib/sha256'
import { zip } from '../../lib/zip'
import { MachinePicker, BlockerList } from '../cnc/MachinePanel'
import { MachinesDialog } from '../cnc/MachinesDialog'
import c0 from '../cnc/Cnc.module.css'
import s from './Nesting.module.css'

const colorOf = (m: string) => MATERIALS.find((x) => x.name === m)?.color ?? '#d9d4cc'
const PROJECT = 'Villa Riverside'

export function nestSettings(c: CamPrefs): NestSettings {
  return { ...DEFAULT_NEST, stock: c.stock, trim: c.trim, gap: c.cnc.cutterD + c.web, grained: c.grain ? DEFAULT_NEST.grained : () => false }
}

/**
 * Nesting of the cabinets' cut lists on stock sheets and the CNC programs that cut them — for ONE chosen machine
 * profile. Files are engineering previews unless the release gate is empty.
 */
export function NestingDialog({ onClose }: { onClose: () => void }) {
  const T = useT()
  const t = T.interior.cam
  const c = T.cnc
  const { doc, cam, set } = useInterior()
  const records = useMachines((st) => st.records)
  const jobs = useMachines((st) => st.jobs)
  const setJob = useMachines((st) => st.setJob)
  const addRelease = useMachines((st) => st.addRelease)
  const [sel, setSel] = useState(0)
  const [paths, setPaths] = useState(true)
  const [mgr, setMgr] = useState(false)
  const [who, setWho] = useState({ operator: '', engineer: '', fa: '' as '' | 'PASS' | 'FAIL' })
  const mid = cam.machineProfileId
  const rec = records.find((r) => r.profile.profile_id === mid) ?? null
  const machine = rec?.profile ?? null
  const pin = (p: typeof machine) => (p ? { profile_id: p.profile_id, revision: p.revision, hash: profileContentHash(p) } : null)
  const job: ManufacturingJob | null = useMemo(() => (machine ? (jobs.interior ?? newJob(`INT-${PROJECT}`, pin(machine))) : null), [machine, jobs.interior]) // eslint-disable-line react-hooks/exhaustive-deps
  const cnc = useMemo(
    () => (machine ? interiorCnc({ cabinets: doc.cabinets, cam, machine, machineProfileId: mid, commissioning: currentCommissioning(rec), job, jobName: PROJECT, doc }) : null),
    [doc.cabinets, cam, machine, mid, rec, job],
  )
  const up = (patch: Partial<CamPrefs>) => set({ cam: { ...cam, ...patch } })
  const upc = (patch: Partial<CamPrefs['cnc']>) => set({ cam: { ...cam, cnc: { ...cam.cnc, ...patch } } })
  const num = (v: string, min: number, max: number, fallback: number) => (Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max ? Number(v) : fallback)
  const choose = (id: string | null) => {
    up({ machineProfileId: id })
    const r = records.find((x) => x.profile.profile_id === id) ?? null
    const p = pin(r?.profile ?? null)
    setJob('interior', selectMachine(jobs.interior ?? newJob(`INT-${PROJECT}`, p), p))
    setSel(0)
  }
  const saveJob = (j: ManufacturingJob) => setJob('interior', j)
  const setStock = (material: string, nominal: number, patch: Partial<StockRecord>) => {
    if (!job) return
    const cur = job.stocks.find((x) => x.material === material) ?? { material, nominal_mm: nominal, measured_thickness_mm: null, lot: null, length_mm: null, width_mm: null, grain_axis: 'UNSPECIFIED' as const, face_a: 'inside' }
    const stocks = [...job.stocks.filter((x) => x.material !== material), { ...cur, ...patch }]
    saveJob({ ...job, stocks, stock: stocks[0] })
  }

  const sheets = cnc?.nest.sheets ?? []
  const cur = cnc?.sheets[Math.min(sel, Math.max(0, sheets.length - 1))]
  const sheet = sheets[Math.min(sel, Math.max(0, sheets.length - 1))]
  const totalMin = (cnc?.sheets ?? []).flatMap((x) => x.parses).reduce((a, x) => a + x.seconds, 0) / 60
  const materials = [...new Set(sheets.map((x) => `${x.material}|${x.t}`))].map((k) => ({ material: k.split('|')[0], t: Number(k.split('|')[1]) }))
  const programs = cnc?.sheets.flatMap((x) => x.programs) ?? []
  const depth = (t0: number) => t0 + cam.cnc.breakthrough
  const postLocked = !!(machine?.postprocessor.id && POSTS[machine.postprocessor.id as keyof typeof POSTS])

  const exportPreview = () => {
    if (!cnc || !job) return
    const r = previewFiles(programs, { machine, machineHash: machine ? profileContentHash(machine) : null, post: cnc.post, blockers: cnc.blockers, meta: cnc.meta })
    const file = `${PROJECT} - CNC engineering preview (NOT FOR MACHINE).zip`
    downloadFile(file, zip(r.files), 'application/zip')
    saveJob(markReviewed(job, cnc.chain))
    toast(fmt(c.previewSaved, { file }), 'success')
  }
  const exportProduction = () => {
    if (!cnc || !job || !machine) return
    try {
      const out = productionFiles(programs, { machine, machineHash: profileContentHash(machine), commissioning: currentCommissioning(rec), post: cnc.post, gate: cnc.gate, meta: cnc.meta })
      const file = `${PROJECT} - CNC production r${job.revision}.zip`
      downloadFile(file, zip(out.files), 'application/zip')
      const release = { job_id: job.job_id, job_revision: job.revision, at: new Date().toISOString(), machine_profile_id: machine.profile_id, machine_profile_revision: machine.revision, machine_profile_hash: profileContentHash(machine), post: { id: cnc.post.id, version: cnc.post.version, sha256: cnc.post.sha256 }, chain: cnc.chain, files: out.files.map((f) => ({ name: f.name, sha256: sha256(f.text), bytes: f.text.length })), approvals: { operator: job.approval!.operator, engineer: job.approval!.engineer, at: job.approval!.at } }
      addRelease(release)
      saveJob(releaseJob(job, release))
      toast(fmt(c.productionSaved, { file }), 'success')
    } catch (e) {
      toast(fmt(c.productionBlocked, { list: e instanceof ProductionBlocked ? e.blockers.join(', ') : String(e) }), 'warning')
    }
  }
  const approve = () => {
    if (!cnc || !job) return
    try {
      saveJob(approveJob(job, cnc.chain, { operator: who.operator, engineer: who.engineer, firstArticle: who.fa || null }))
      toast(c.approvedToast, 'success')
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), 'warning')
    }
  }
  const exportDxf = () => {
    if (!cnc) return
    const file = `${PROJECT} - sheet layouts.dxf`
    downloadFile(file, layoutDxf(sheets, cam.trim, cnc.sheets.flatMap((x, i) => x.cam.holes.map((h) => ({ sheet: i, x: h.x, y: h.y, d: h.d })))), 'application/dxf')
    toast(fmt(t.exported, { file }), 'success')
  }
  const exportLabels = () => {
    const file = `${PROJECT} - part labels.csv`
    downloadFile(file, csv(labelRows(sheets)))
    toast(fmt(t.exported, { file }), 'success')
  }
  const notMachined = cnc ? [...new Map(cnc.sheets.flatMap((x) => x.cam.skipped).map((k) => [`${k.op}|${k.what}`, k])).values()] : []

  return (
    <Modal title={t.title} onClose={onClose} width={1180}>
      <div className={s.wrap} data-testid="nesting-dialog">
        <aside className={s.side}>
          <h4>{c.machine}</h4>
          <MachinePicker value={mid} legacy={mid === undefined} onChange={choose} onManage={() => setMgr(true)} />
          {machine && job && job.machine_profile_revision !== null && job.machine_profile_revision !== machine.revision && (
            <button type="button" className={c0.linkBtn} onClick={() => choose(machine.profile_id)}>{fmt(c.repin, { n: machine.revision })}</button>
          )}
          {machine && (
            <>
              <h4>{t.stock}</h4>
              {materials.map(({ material: m }) => {
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
              {materials.map(({ material: m, t: nominal }) => {
                const r = job?.stocks.find((x) => x.material === m)
                return (
                  <label key={`${m}-measured`} className={s.row}>
                    <span>{m} · {c.measured}</span>
                    <input aria-label={`${m} ${c.measured}`} placeholder={String(nominal)} value={r?.measured_thickness_mm ?? ''} onChange={(e) => setStock(m, nominal, { measured_thickness_mm: e.target.value.trim() === '' ? null : num(e.target.value, 1, 60, r?.measured_thickness_mm ?? nominal) })} />
                    <input aria-label={`${m} ${c.lot}`} placeholder={c.lot} value={r?.lot ?? ''} onChange={(e) => setStock(m, nominal, { lot: e.target.value || null })} />
                  </label>
                )
              })}
              <label className={s.row}><span>{c.band}</span><input aria-label={c.band} value={job?.edge_band_mm ?? 1} onChange={(e) => job && saveJob({ ...job, edge_band_mm: num(e.target.value, 0, 3, job.edge_band_mm) })} /></label>
              <label className={s.check}><input type="checkbox" checked={!!job?.edge_band_confirmed} onChange={(e) => job && saveJob({ ...job, edge_band_confirmed: e.target.checked })} />{c.bandConfirm}</label>
              <label className={s.row}><span>{t.trim}</span><input aria-label={t.trim} value={cam.trim} onChange={(e) => up({ trim: num(e.target.value, 0, 50, cam.trim) })} /></label>
              <label className={s.row}><span>{t.web}</span><input aria-label={t.web} value={cam.web} onChange={(e) => up({ web: num(e.target.value, 0, 30, cam.web) })} /></label>
              <label className={s.check}><input type="checkbox" checked={cam.grain} onChange={(e) => up({ grain: e.target.checked })} />{t.grain}</label>
              <h4>{t.cnc}</h4>
              <label className={s.row}><span>{postLocked ? `${t.dialect} (${c.postLocked})` : c.postPreview}</span>
                <select aria-label={t.dialect} disabled={postLocked} value={postLocked ? machine.postprocessor.id! : cam.cnc.dialect === 'grbl' ? 'grbl11' : cam.cnc.dialect === 'iso' ? 'iso_generic' : cam.cnc.dialect} onChange={(e) => upc({ dialect: e.target.value === 'grbl11' ? 'grbl' : e.target.value === 'iso_generic' ? 'iso' : (e.target.value as 'linuxcnc' | 'ncstudio') })}>
                  {POST_IDS.map((id) => <option key={id} value={id}>{id === 'grbl11' ? t.grbl : id === 'iso_generic' ? t.iso : id === 'linuxcnc' ? t.linuxcnc : t.ncstudio}</option>)}
                </select>
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
              <h4>{c.job}</h4>
              <label className={s.row}><span>{c.operator}</span><input aria-label={c.operator} style={{ width: 130 }} value={who.operator} onChange={(e) => setWho({ ...who, operator: e.target.value })} /></label>
              <label className={s.row}><span>{c.engineer}</span><input aria-label={c.engineer} style={{ width: 130 }} value={who.engineer} onChange={(e) => setWho({ ...who, engineer: e.target.value })} /></label>
              <label className={s.row}><span>{c.firstArticle}</span>
                <select aria-label={c.firstArticle} value={who.fa} onChange={(e) => setWho({ ...who, fa: e.target.value as '' | 'PASS' | 'FAIL' })}>{(['', 'PASS', 'FAIL'] as const).map((k) => <option key={k} value={k}>{c.fa[k]}</option>)}</select>
              </label>
              <button type="button" className={c0.linkBtn} disabled={!who.operator.trim() || !who.engineer.trim() || !cnc || job?.status === 'PRODUCTION_RELEASED'} onClick={approve} data-testid="job-approve">{c.approve}</button>
              {job?.approval && <p className={s.note}>{fmt(c.approved, { operator: job.approval.operator, engineer: job.approval.engineer, at: job.approval.at.slice(0, 16).replace('T', ' ') })}</p>}
            </>
          )}
        </aside>
        <section className={s.main}>
          {!cnc && <p className={s.warn} data-testid="nesting-no-machine">{mid === undefined ? c.legacy : c.none}</p>}
          {cnc && machine && (
            <>
              {machine.status !== 'VERIFIED' && <p className={c0.danger} data-testid="not-for-machine">{fmt(c.warnUnverified, { status: c.status[machine.status] ?? machine.status })}</p>}
              <p className={s.summary} data-testid="nesting-summary">
                {fmt(t.summary, { parts: sheets.reduce((a, x) => a + x.parts.length, 0), sheets: sheets.length })}
                {' — '}
                {Object.entries(cnc.nest.byMaterial).map(([m, v]) => `${m} × ${v.sheets} (${fmt(t.yield, { y: ((v.partArea / v.sheetArea) * 100).toFixed(0) })})`).join(' · ')}
              </p>
              <p className={s.note} data-testid="job-status">
                {c.job} {cnc.meta.job.job_id} r{cnc.meta.job.revision}: <span className={`${c0.badge} ${cnc.status === 'STALE' ? c0.stale : cnc.status === 'VALIDATED' || cnc.status === 'PRODUCTION_RELEASED' ? c0.ok : ''}`}>{c.jobState[cnc.status] ?? cnc.status}</span>
              </p>
              {cnc.status === 'STALE' && cnc.stale.from && <p className={s.warn} data-testid="job-stale">{fmt(c.stale, { stage: c.stages[cnc.stale.from] ?? cnc.stale.from })}</p>}
              {cnc.nest.unplaced.length > 0 && <p className={s.warn}>{fmt(t.unplaced, { n: cnc.nest.unplaced.length, list: cnc.nest.unplaced.map((p) => `${p.label} ${p.l}×${p.w}`).join(', ') })}</p>}
              {cnc.nestErrors.length > 0 && <p className={s.warn}>{cnc.nestErrors.join('; ')}</p>}
              {notMachined.length > 0 && <p className={s.warn} data-testid="not-machined">{fmt(c.notMachined, { list: notMachined.map((k) => `${c.what[k.what] ?? k.what} × ${k.count} (${c.ops[k.op] ?? k.op}: ${k.reason})`).join('; ') })}</p>}
              <div className={s.strip} role="tablist">
                {sheets.map((sh, i) => (
                  <button key={i} type="button" role="tab" aria-selected={i === sel} className={i === sel ? s.on : undefined} onClick={() => setSel(i)}>
                    <SheetSvg sheet={sh} small />
                    <small>{sh.material.replace('MFC 18 - ', '').replace('HDF 6 - ', 'HDF ')} #{sh.index} · {(sh.yield * 100).toFixed(0)} %</small>
                  </button>
                ))}
              </div>
              {sheet && cur && (
                <>
                  <div className={s.big}>
                    <SheetSvg sheet={sheet} cam={paths ? cur.cam : undefined} cutterR={cnc.nestSettings.gap / 2 - cam.web / 2} clamps={machine.fixtures.clamp_no_go_shapes} />
                  </div>
                  <div className={s.cncRow}>
                    <label className={s.check}><input type="checkbox" checked={paths} onChange={(e) => setPaths(e.target.checked)} />{t.toolpaths}</label>
                    <b>{t.programs}:</b>
                    {cur.programs.map((p, k) => {
                      const sim = cur.parses[k]
                      const bad = sim.issues.filter((i) => MOTION_ISSUES.has(i.code))
                      return (
                        <span key={p.name} className={bad.length ? s.bad : s.ok} title={bad.length ? fmt(t.failed, { e: bad.map((i) => i.msg).join('; ') }) : fmt(t.verified, { d: depth(cur.cam.ir.stock.t).toFixed(1) })}>
                          {p.name.replace(/^.* - /, '')} · {fmt(t.lines, { n: sim.lines })} · {fmt(t.cut, { m: (sim.cutLength / 1000).toFixed(1) })} · {fmt(t.time, { min: (sim.seconds / 60).toFixed(1) })} {bad.length ? '✗' : '✓'}
                        </span>
                      )
                    })}
                  </div>
                </>
              )}
              <BlockerList blockers={cnc.blockers} />
              <div className={s.foot}>
                <span>{fmt(t.total, { min: totalMin.toFixed(0) })}</span>
                <button type="button" onClick={exportPreview} disabled={!programs.length} data-testid="export-preview"><Download size={14} />{t.zip}</button>
                <button type="button" onClick={exportDxf} disabled={!sheets.length}><Download size={14} />{t.dxf}</button>
                <button type="button" onClick={exportLabels} disabled={!sheets.length}><Download size={14} />{t.labels}</button>
                <button type="button" onClick={exportProduction} disabled={cnc.blockers.length > 0 || !programs.length} title={cnc.blockers.length ? fmt(c.productionBlocked, { list: cnc.blockers.slice(0, 8).map((b) => blockerText(b, c)).join('; ') }) : undefined} data-testid="export-production"><Lock size={14} />{c.production}</button>
              </div>
            </>
          )}
        </section>
      </div>
      {mgr && <MachinesDialog initial={mid ?? null} onClose={() => setMgr(false)} />}
    </Modal>
  )
}

function SheetSvg({ sheet, small, cam, cutterR = 4, clamps = [] }: { sheet: NonNullable<ReturnType<typeof interiorCnc>>['nest']['sheets'][number]; small?: boolean; cam?: CamResult; cutterR?: number; clamps?: { id: string; x0: number; y0: number; x1: number; y1: number }[] }) {
  const { l, w } = sheet
  return (
    <svg viewBox={`-20 -20 ${l + 40} ${w + 40}`} className={small ? s.thumb : s.sheet} role="img" aria-label={`${sheet.material} #${sheet.index}`}>
      <g transform={`translate(0 ${w}) scale(1 -1)`}>
        <rect x={0} y={0} width={l} height={w} className={s.stock} />
        {sheet.parts.map((p) => (
          <rect key={p.id} x={p.x} y={p.y} width={p.sx} height={p.sy} fill={colorOf(p.material)} className={s.part} />
        ))}
        {clamps.map((z) => <rect key={z.id} x={z.x0} y={z.y0} width={z.x1 - z.x0} height={z.y1 - z.y0} className={s.clamp} />)}
        {cam?.grooves.map((g, k) => <rect key={`g${k}`} x={g.x0} y={g.y0} width={g.x1 - g.x0} height={g.y1 - g.y0} className={s.groove} />)}
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
