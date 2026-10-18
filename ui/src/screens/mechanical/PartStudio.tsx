import { useMemo, useRef, useState } from 'react'
import { Circle, CircleDot, Disc, Download, Eye, EyeOff, Grid2x2, Layers, Pencil, Scaling, Trash2, Triangle, TriangleAlert } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { toast } from '../../state/toast'
import { useMech } from '../../state/mech'
import { useHost } from '../../services/host'
import { Modal } from '../../components/ui/Modal'
import { NativeScene, type SceneCamera } from '../../components/workspace/NativeScene'
import { downloadFile } from '../../components/workspace/Workspace'
import { MATERIALS } from '../../mech/model'
import { density, featureErrors, holeInstances, partScene, shapeBounds, type EdgeSet, type Feature, type FeatureKind, type Part, type Plane, type Sketch, type SketchShape } from '../../mech/part'
import { DEFAULT_PART_CAM, outline, partCam, type PartCamSettings } from '../../mech/partCam'
import { capabilities, profileContentHash, releaseBlockers, toolsHash, type JobGateInput, type OperationKind } from '../../cam/machine'
import { approveJob, chainOf, isStale, jobStatus, markReviewed, newJob, selectMachine, validApproval, type StockRecord } from '../../cam/job'
import { parseSequence } from '../../cam/ncparse'
import { POSTS, getPost } from '../../cam/posts'
import { ProductionBlocked, previewFiles, productionFiles, type NcProgram, type ReleaseMeta } from '../../cam/release'
import { hashOf } from '../../lib/sha256'
import { zip } from '../../lib/zip'
import { currentCommissioning, useMachines } from '../../state/machines'
import { BlockerList, MachinePicker } from '../cnc/MachinePanel'
import { MachinesDialog } from '../cnc/MachinesDialog'
import cs from '../cnc/Cnc.module.css'
import s from './PartStudio.module.css'

const ICON = { extrude: Layers, revolve: Disc, hole: CircleDot, fillet: Circle, chamfer: Triangle, pattern: Grid2x2 } as const
const uid = (p: string) => `${p}${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 4)}`

/** The open part and an undoable editor of it. */
export function usePart() {
  const st = useMech()
  const part = st.doc.parts?.find((p) => p.id === st.activePart) ?? null
  const editPart = (label: string, fn: (p: Part) => Part) => {
    if (!part) return
    const err = st.edit(label, (m) => ({ ...m, parts: (m.parts ?? []).map((p) => (p.id === part.id ? fn(p) : p)) }))
    if (err) toast(err, 'warning')
  }
  return { part, editPart }
}

/* ------------------------------------------------------------------ tree */

export function PartTree() {
  const T = useT()
  const t = T.mechanical.partStudio
  const st = useMech()
  const { part, editPart } = usePart()
  if (!part) return <section className={s.tree}><p className={s.empty}>{t.noPart}</p></section>
  const errs = featureErrors(part, st.partErrors)
  const del = (id: string, name: string) => {
    editPart(`Delete ${name}`, (p) => {
      const sketches = p.sketches.filter((k) => k.id !== id)
      // features that use a deleted sketch / feature go with it
      let features = p.features.filter((f) => f.id !== id && !('sketch' in f && f.sketch === id))
      features = features.filter((f) => f.kind !== 'pattern' || features.some((x) => x.id === f.source))
      return { ...p, sketches, features }
    })
    st.set({ partSel: null })
    toast(fmt(t.deleted, { what: name }))
  }
  return (
    <section className={s.tree} aria-label={t.tree}>
      <header className={s.treeHead}>
        <strong>{part.name}</strong>
        <span>{part.file}</span>
      </header>
      <h4>{t.sketches}</h4>
      <ul>
        {part.sketches.map((k) => (
          <li key={k.id} className={st.partSel === k.id ? s.on : undefined} onClick={() => st.set({ partSel: k.id })} onDoubleClick={() => st.set({ partDialog: { kind: 'sketch', id: k.id } })}>
            <Scaling size={14} strokeWidth={1.7} />
            <span className={s.name} title={k.name}>{k.name}</span>
            <small>{t.planes[k.plane]}</small>
            <button type="button" aria-label={`${t.edit} ${k.name}`} onClick={(e) => (e.stopPropagation(), st.set({ partDialog: { kind: 'sketch', id: k.id } }))}><Pencil size={12} /></button>
            <button type="button" aria-label={`${t.remove} ${k.name}`} onClick={(e) => (e.stopPropagation(), del(k.id, k.name))}><Trash2 size={12} /></button>
          </li>
        ))}
      </ul>
      <h4>{t.features}</h4>
      {!part.features.length && <p className={s.empty}>{t.empty}</p>}
      <ul>
        {part.features.map((f) => {
          const Icon = ICON[f.kind]
          const err = errs[f.id]
          return (
            <li key={f.id} className={`${st.partSel === f.id ? s.on : ''} ${f.suppressed ? s.off : ''} ${err ? s.bad : ''}`} onClick={() => st.set({ partSel: f.id })} onDoubleClick={() => st.set({ partDialog: { kind: f.kind, id: f.id } })} title={err ? fmt(t.failed, { why: err }) : undefined} data-testid={`feature-${f.id}`}>
              {err ? <TriangleAlert size={14} strokeWidth={1.8} /> : <Icon size={14} strokeWidth={1.7} />}
              <span className={s.name} title={f.name}>{f.name}</span>
              <button type="button" aria-label={`${t.edit} ${f.name}`} onClick={(e) => (e.stopPropagation(), st.set({ partDialog: { kind: f.kind, id: f.id } }))}><Pencil size={12} /></button>
              <button type="button" aria-label={`${f.suppressed ? t.unsuppress : t.suppress} ${f.name}`} onClick={(e) => {
                  e.stopPropagation()
                  editPart(`${f.suppressed ? 'Unsuppress' : 'Suppress'} ${f.name}`, (p) => ({ ...p, features: p.features.map((x) => (x.id === f.id ? { ...x, suppressed: !x.suppressed } : x)) }))
                }}>
                {f.suppressed ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
              <button type="button" aria-label={`${t.remove} ${f.name}`} onClick={(e) => (e.stopPropagation(), del(f.id, f.name))}><Trash2 size={12} /></button>
              {err && <em className={s.err}>{err}</em>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/* ------------------------------------------------------------------ view */

export function PartView({ cam, mode, sceneTools }: { cam: { current: SceneCamera | null }; mode: 'shaded' | 'wireframe' | 'hidden'; sceneTools: Record<string, unknown> }) {
  const T = useT()
  const t = T.mechanical.partStudio
  const host = useHost()
  const st = useMech()
  const { part } = usePart()
  const scene = useMemo(() => (part ? partScene(part) : { items: [] }), [part])
  if (!part) return <p className={s.empty} style={{ padding: 20 }}>{t.noPart}</p>
  if (host)
    return (
      <NativeScene
        host={host}
        sceneKey="mechpart"
        scene={scene}
        mode={mode}
        cameraRef={cam}
        {...sceneTools}
        label={part.name}
        onLoaded={async (r) => {
          const b = await host.scene3dCommand('mechpart', JSON.stringify({ cmd: 'bounds', ids: [] }))
          st.set({ partErrors: r.errors ?? [], partVolume: r.volumes?.[part.id] ?? null, partBounds: b.bounds ?? null })
        }}
      />
    )
  return <SketchPreview part={part} label={t.props.preview} />
}

/** Browser: top view of the XY sketches and the holes (the solid needs the desktop kernel). */
function SketchPreview({ part, label }: { part: Part; label: string }) {
  const xy = part.sketches.filter((k) => k.plane === 'XY')
  const holes = holeInstances(part)
  const pts = xy.flatMap((k) => k.shapes.flatMap((sh) => { const b = shapeBounds(sh); return [[b[0], b[1]], [b[2], b[3]]] }))
  if (!pts.length) pts.push([0, 0], [100, 100])
  const x0 = Math.min(...pts.map((p) => p[0])) - 10, x1 = Math.max(...pts.map((p) => p[0])) + 10
  const y0 = Math.min(...pts.map((p) => p[1])) - 10, y1 = Math.max(...pts.map((p) => p[1])) + 10
  return (
    <div className={s.preview}>
      <svg viewBox={`${x0} ${-y1} ${x1 - x0} ${y1 - y0}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={label}>
        {xy.map((k) => k.shapes.map((sh, i) => <polygon key={k.id + i} points={outline(sh, 0, 0).map(([x, y]) => `${x},${-y}`).join(' ')} className={s.prevShape} />))}
        {holes.map((h, i) => <circle key={i} cx={h.x} cy={-h.y} r={h.f.dia / 2} className={s.prevHole} />)}
      </svg>
      <span className={s.previewNote}>{label}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ properties */

export function PartProps() {
  const T = useT()
  const t = T.mechanical.partStudio
  const host = useHost()
  const st = useMech()
  const { part, editPart } = usePart()
  if (!part) return <p className={s.empty}>{t.noPart}</p>
  const errs = featureErrors(part, st.partErrors)
  const rho = density(part)
  const vol = st.partVolume
  const b = st.partBounds
  const exportStep = async () => {
    if (!host) return
    const r = await host.scene3dExportStep('mechpart', part.file.replace(/\.prt$/, '.step'))
    if (r.ok) toast(fmt(t.step, { file: r.path ?? '', kb: Math.round((r.bytes ?? 0) / 1024) }), 'success')
  }
  return (
    <div className={s.props} data-testid="part-props">
      <h4>{t.props.title}</h4>
      <label className={s.row}><span>{t.fields.name}</span><input aria-label={t.fields.name} defaultValue={part.name} onBlur={(e) => e.target.value.trim() && e.target.value !== part.name && editPart('Rename part', (p) => ({ ...p, name: e.target.value.trim() }))} /></label>
      <label className={s.row}>
        <span>{t.props.material}</span>
        <select aria-label={t.props.material} value={part.material} onChange={(e) => editPart('Material', (p) => ({ ...p, material: e.target.value }))}>
          {MATERIALS.map((m) => <option key={m.name}>{m.name}</option>)}
        </select>
      </label>
      <div className={s.row}><span>{t.props.density}</span><b>{rho.toLocaleString('en-US')} kg/m³</b></div>
      <div className={s.row}><span>{t.props.volume}</span><b data-testid="part-volume">{vol !== null ? `${(vol * 1e9).toLocaleString('en-US', { maximumFractionDigits: 1 })} mm³` : '—'}</b></div>
      <div className={s.row}><span>{t.props.mass}</span><b data-testid="part-mass">{vol !== null ? `${(vol * rho).toFixed(3)} kg` : '—'}</b></div>
      <div className={s.row}><span>{t.props.bounds}</span><b>{b ? `${(b[3] - b[0]).toFixed(1)} × ${(b[4] - b[1]).toFixed(1)} × ${(b[5] - b[2]).toFixed(1)} mm` : '—'}</b></div>
      <div className={s.row}><span>{t.props.features}</span><b>{part.features.filter((f) => !f.suppressed).length} / {part.features.length}</b></div>
      {Object.keys(errs).length > 0 && (
        <div className={s.errs}>
          <h5>{t.props.errors}</h5>
          {Object.entries(errs).map(([id, why]) => <p key={id}><b>{part.features.find((f) => f.id === id)?.name ?? id}</b>: {why}</p>)}
        </div>
      )}
      {!host && <p className={s.note}>{t.props.desktopOnly}</p>}
      {host && <button type="button" className={s.btn} onClick={() => void exportStep()}><Download size={14} />STEP</button>}
    </div>
  )
}

/* ------------------------------------------------------------------ sketch dialog */

export function SketchDialog({ id, onClose }: { id?: string; onClose: () => void }) {
  const T = useT()
  const t = T.mechanical.partStudio
  const { part, editPart } = usePart()
  const st = useMech()
  const existing = part?.sketches.find((k) => k.id === id)
  const n = (part?.sketches.length ?? 0) + 1
  const [sk, setSk] = useState<Sketch>(existing ?? { id: uid('s'), name: `Sketch ${n}`, plane: 'XY', offset: 0, shapes: [] })
  const [mode, setMode] = useState<'rect' | 'circle' | 'poly'>('rect')
  const [poly, setPoly] = useState<[number, number][]>([])
  const [drag, setDrag] = useState<{ a: [number, number]; b: [number, number] } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  if (!part) return null
  // view: fit the shapes (and a 160 × 110 mm start area)
  const ext = sk.shapes.map(shapeBounds)
  const vx0 = Math.min(0, ...ext.map((e) => e[0])) - 10, vy0 = Math.min(0, ...ext.map((e) => e[1])) - 10
  const vx1 = Math.max(160, ...ext.map((e) => e[2])) + 10, vy1 = Math.max(110, ...ext.map((e) => e[3])) + 10
  const W = 560, H = 380, k = Math.max((vx1 - vx0) / W, (vy1 - vy0) / H)
  const toW = (e: React.PointerEvent | React.MouseEvent): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect()
    return [Math.round(vx0 + (e.clientX - r.left) * k), Math.round(vy1 - (e.clientY - r.top) * k)]
  }
  const S = (x: number, y: number) => [(x - vx0) / k, (vy1 - y) / k] as const
  const setShape = (i: number, sh: SketchShape) => setSk({ ...sk, shapes: sk.shapes.map((x, j) => (j === i ? sh : x)) })
  const save = () => {
    if (existing) editPart(`Edit ${sk.name}`, (p) => ({ ...p, sketches: p.sketches.map((x) => (x.id === sk.id ? sk : x)) }))
    else editPart(`Add ${sk.name}`, (p) => ({ ...p, sketches: [...p.sketches, sk] }))
    st.set({ partSel: sk.id })
    toast(fmt(existing ? t.updated : t.added, { what: sk.name }))
    onClose()
  }
  const grid: number[] = []
  for (let g = Math.ceil(vx0 / 10) * 10; g <= vx1; g += 10) grid.push(g)
  const gridY: number[] = []
  for (let g = Math.ceil(vy0 / 10) * 10; g <= vy1; g += 10) gridY.push(g)
  return (
    <Modal title={`${t.sketchTitle} — ${sk.name}`} onClose={onClose} width={960}>
      <div className={s.sketch} data-testid="sketch-dialog">
        <div>
          <div className={s.sketchBar}>
            {(['rect', 'circle', 'poly'] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} className={mode === m ? s.on : undefined} onClick={() => (setMode(m), setPoly([]))}>{t[m]}</button>
            ))}
            <small>{t.canvasHint}</small>
          </div>
          <svg
            ref={svgRef}
            width={W}
            height={H}
            className={s.canvas}
            data-testid="sketch-canvas"
            data-view={`${vx0},${vy1},${k}`}
            onPointerDown={(e) => {
              const p = toW(e)
              if (mode === 'poly') return setPoly([...poly, p])
              setDrag({ a: p, b: p })
            }}
            onPointerMove={(e) => drag && setDrag({ ...drag, b: toW(e) })}
            onPointerUp={() => {
              if (!drag) return
              const { a, b } = drag
              setDrag(null)
              if (mode === 'rect' && Math.abs(b[0] - a[0]) >= 1 && Math.abs(b[1] - a[1]) >= 1) setSk({ ...sk, shapes: [...sk.shapes, { t: 'rect', x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) }] })
              if (mode === 'circle' && Math.hypot(b[0] - a[0], b[1] - a[1]) >= 1) setSk({ ...sk, shapes: [...sk.shapes, { t: 'circle', x: a[0], y: a[1], r: Math.round(Math.hypot(b[0] - a[0], b[1] - a[1])) }] })
            }}
            onDoubleClick={() => {
              if (mode === 'poly' && poly.length >= 3) setSk({ ...sk, shapes: [...sk.shapes, { t: 'poly', pts: poly.slice(0, poly.length - (poly.length > 3 && poly.at(-1)![0] === poly.at(-2)![0] && poly.at(-1)![1] === poly.at(-2)![1] ? 1 : 0)) }] })
              setPoly([])
            }}
          >
            {grid.map((g) => <line key={'x' + g} x1={S(g, 0)[0]} x2={S(g, 0)[0]} y1={0} y2={H} className={g === 0 ? s.axis : s.gridLine} />)}
            {gridY.map((g) => <line key={'y' + g} y1={S(0, g)[1]} y2={S(0, g)[1]} x1={0} x2={W} className={g === 0 ? s.axis : s.gridLine} />)}
            {sk.shapes.map((sh, i) => <polygon key={i} points={outline(sh, 0, 0).map(([x, y]) => S(x, y).join(',')).join(' ')} className={s.shape} />)}
            {drag && mode === 'rect' && <rect x={Math.min(S(...drag.a)[0], S(...drag.b)[0])} y={Math.min(S(...drag.a)[1], S(...drag.b)[1])} width={Math.abs(S(...drag.b)[0] - S(...drag.a)[0])} height={Math.abs(S(...drag.b)[1] - S(...drag.a)[1])} className={s.rubber} />}
            {drag && mode === 'circle' && <circle cx={S(...drag.a)[0]} cy={S(...drag.a)[1]} r={Math.hypot(drag.b[0] - drag.a[0], drag.b[1] - drag.a[1]) / k} className={s.rubber} />}
            {poly.length > 0 && <polyline points={poly.map(([x, y]) => S(x, y).join(',')).join(' ')} className={s.rubber} />}
          </svg>
        </div>
        <div className={s.sketchSide}>
          <label className={s.row}><span>{t.fields.name}</span><input aria-label={t.fields.name} value={sk.name} onChange={(e) => setSk({ ...sk, name: e.target.value })} /></label>
          <label className={s.row}>
            <span>{t.plane}</span>
            <select aria-label={t.plane} value={sk.plane} onChange={(e) => setSk({ ...sk, plane: e.target.value as Plane })}>
              {(['XY', 'XZ', 'YZ'] as const).map((p) => <option key={p} value={p}>{t.planes[p]}</option>)}
            </select>
          </label>
          <label className={s.row}><span>{t.offset}</span><input aria-label={t.offset} type="number" value={sk.offset} onChange={(e) => setSk({ ...sk, offset: Number(e.target.value) || 0 })} /></label>
          <h5>{fmt(t.shapes, { n: sk.shapes.length })}</h5>
          <div className={s.shapeList}>
            {sk.shapes.map((sh, i) => (
              <div key={i} className={s.shapeRow}>
                <b>{t[sh.t]}</b>
                {sh.t === 'rect' && (['x', 'y', 'w', 'h'] as const).map((f) => <input key={f} aria-label={`${t[sh.t]} ${i + 1} ${f}`} type="number" value={sh[f]} onChange={(e) => setShape(i, { ...sh, [f]: Number(e.target.value) || 0 })} />)}
                {sh.t === 'circle' && (['x', 'y', 'r'] as const).map((f) => <input key={f} aria-label={`${t[sh.t]} ${i + 1} ${f}`} type="number" value={sh[f]} onChange={(e) => setShape(i, { ...sh, [f]: Number(e.target.value) || 0 })} />)}
                {sh.t === 'poly' && <span>{sh.pts.length} pts</span>}
                {sh.t === 'slot' && <span>{sh.w} × R{sh.r}</span>}
                <button type="button" aria-label={`${t.remove} ${i + 1}`} onClick={() => setSk({ ...sk, shapes: sk.shapes.filter((_, j) => j !== i) })}><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
          <div className={s.actions}>
            <button type="button" onClick={onClose}>{t.cancel}</button>
            <button type="button" className={s.primary} disabled={!sk.shapes.length} onClick={save}>{t.save}</button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ feature dialog */

export function FeatureDialog({ kind, id, onClose }: { kind: FeatureKind; id?: string; onClose: () => void }) {
  const T = useT()
  const t = T.mechanical.partStudio
  const F = t.fields
  const { part, editPart } = usePart()
  const st = useMech()
  const existing = part?.features.find((f) => f.id === id)
  const lastSketch = part?.sketches.at(-1)?.id ?? ''
  const n = (part?.features.filter((f) => f.kind === kind).length ?? 0) + 1
  const base = { id: uid('f'), name: `${t.kinds[kind]} ${n}` }
  const init: Feature =
    existing ??
    (kind === 'extrude' ? { ...base, kind, sketch: lastSketch, depth: 10, op: 'add' }
    : kind === 'revolve' ? { ...base, kind, sketch: lastSketch, angle: 360, axis: 'v', op: 'add' }
    : kind === 'hole' ? { ...base, kind, x: 0, y: 0, dia: 8.5, depth: 10, through: true, cbDia: 0, cbDepth: 0 }
    : kind === 'fillet' ? { ...base, kind, edges: 'vertical', r: 2 }
    : kind === 'chamfer' ? { ...base, kind, edges: 'top', r: 1 }
    : { ...base, kind: 'pattern', source: part?.features.filter((f) => f.kind === 'hole' || f.kind === 'extrude').at(-1)?.id ?? '', type: 'linear', count: 3, dx: 20, dy: 0, angle: 360, cx: 0, cy: 0 })
  const [f, setF] = useState<Feature>(init)
  if (!part) return null
  const up = (patch: Partial<Feature>) => setF({ ...f, ...patch } as Feature)
  const num = (label: string, key: string, v: number) => (
    <label className={s.row} key={key}><span>{label}</span><input aria-label={label} type="number" value={v} onChange={(e) => up({ [key]: Number(e.target.value) } as Partial<Feature>)} /></label>
  )
  const check = (label: string, key: string, v: boolean | undefined) => (
    <label className={s.check} key={key}><input type="checkbox" checked={!!v} onChange={(e) => up({ [key]: e.target.checked } as Partial<Feature>)} />{label}</label>
  )
  const sketchSel = (v: string) => (
    <label className={s.row}>
      <span>{F.sketch}</span>
      <select aria-label={F.sketch} value={v} onChange={(e) => up({ sketch: e.target.value } as Partial<Feature>)}>
        {part.sketches.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
      </select>
    </label>
  )
  const opSel = (v: 'add' | 'cut') => (
    <label className={s.row}>
      <span>{F.op}</span>
      <select aria-label={F.op} value={v} onChange={(e) => up({ op: e.target.value } as Partial<Feature>)}>
        <option value="add">{F.add}</option>
        <option value="cut">{F.cut}</option>
      </select>
    </label>
  )
  const edgeSel = (v: EdgeSet) => (
    <label className={s.row}>
      <span>{F.edges}</span>
      <select aria-label={F.edges} value={v} onChange={(e) => up({ edges: e.target.value as EdgeSet } as Partial<Feature>)}>
        {(['vertical', 'top', 'bottom', 'circular', 'all'] as const).map((k) => <option key={k} value={k}>{t.edgeSets[k]}</option>)}
      </select>
    </label>
  )
  const needsSketch = (f.kind === 'extrude' || f.kind === 'revolve') && !part.sketches.length
  const save = () => {
    if (existing) editPart(`Edit ${f.name}`, (p) => ({ ...p, features: p.features.map((x) => (x.id === f.id ? f : x)) }))
    else editPart(`Add ${f.name}`, (p) => ({ ...p, features: [...p.features, f] }))
    st.set({ partSel: f.id })
    toast(fmt(existing ? t.updated : t.added, { what: f.name }))
    onClose()
  }
  return (
    <Modal title={`${t.kinds[kind]} — ${f.name}`} onClose={onClose} width={440}>
      <div className={s.form} data-testid="feature-dialog">
        <label className={s.row}><span>{F.name}</span><input aria-label={F.name} value={f.name} onChange={(e) => up({ name: e.target.value })} /></label>
        {needsSketch && <p className={s.note}>{t.noSketch}</p>}
        {f.kind === 'extrude' && (
          <>
            {sketchSel(f.sketch)}
            {opSel(f.op)}
            {num(F.depth, 'depth', f.depth)}
            {check(F.reverse, 'reverse', f.reverse)}
            {check(F.symmetric, 'symmetric', f.symmetric)}
            {f.op === 'cut' && check(F.through, 'through', f.through)}
          </>
        )}
        {f.kind === 'revolve' && (
          <>
            {sketchSel(f.sketch)}
            {opSel(f.op)}
            {num(F.angle, 'angle', f.angle)}
            <label className={s.row}>
              <span>{F.axis}</span>
              <select aria-label={F.axis} value={f.axis} onChange={(e) => up({ axis: e.target.value as 'u' | 'v' })}>
                <option value="u">{F.u}</option>
                <option value="v">{F.v}</option>
              </select>
            </label>
          </>
        )}
        {f.kind === 'hole' && (
          <>
            {num(F.x, 'x', f.x)}
            {num(F.y, 'y', f.y)}
            {num(F.dia, 'dia', f.dia)}
            {check(F.through, 'through', f.through)}
            {!f.through && num(F.depth, 'depth', f.depth)}
            {num(F.cbDia, 'cbDia', f.cbDia ?? 0)}
            {(f.cbDia ?? 0) > 0 && num(F.cbDepth, 'cbDepth', f.cbDepth ?? 0)}
          </>
        )}
        {(f.kind === 'fillet' || f.kind === 'chamfer') && (
          <>
            {edgeSel(f.edges)}
            {num(f.kind === 'fillet' ? F.r : F.d, 'r', f.r)}
          </>
        )}
        {f.kind === 'pattern' && (
          <>
            <label className={s.row}>
              <span>{F.source}</span>
              <select aria-label={F.source} value={f.source} onChange={(e) => up({ source: e.target.value })}>
                {part.features.filter((x) => x.kind === 'hole' || x.kind === 'extrude' || x.kind === 'revolve').map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
            <label className={s.row}>
              <span>{F.type}</span>
              <select aria-label={F.type} value={f.type} onChange={(e) => up({ type: e.target.value as 'linear' | 'circular' })}>
                <option value="linear">{F.linear}</option>
                <option value="circular">{F.circular}</option>
              </select>
            </label>
            {num(F.count, 'count', f.count)}
            {f.type === 'linear' ? (
              <>
                {num(F.dx, 'dx', f.dx)}
                {num(F.dy, 'dy', f.dy)}
              </>
            ) : (
              <>
                {num(F.angle, 'angle', f.angle)}
                {num(F.cx, 'cx', f.cx)}
                {num(F.cy, 'cy', f.cy)}
              </>
            )}
          </>
        )}
        <div className={s.actions}>
          <button type="button" onClick={onClose}>{t.cancel}</button>
          <button type="button" className={s.primary} disabled={needsSketch} onClick={save}>{t.save}</button>
        </div>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ CAM */

export function PartCamDialog({ onClose }: { onClose: () => void }) {
  const T = useT()
  const t = T.mechanical.partStudio.cam
  const c = T.cnc
  const { part } = usePart()
  const records = useMachines((st) => st.records)
  const mid = useMachines((st) => st.partMachineId)
  const setPartMachine = useMachines((st) => st.setPartMachine)
  const jobs = useMachines((st) => st.jobs)
  const setJob = useMachines((st) => st.setJob)
  const [cfg, setCfg] = useState<PartCamSettings>(DEFAULT_PART_CAM)
  const [mgr, setMgr] = useState(false)
  const [who, setWho] = useState({ operator: '', engineer: '' })
  const rec = records.find((x) => x.profile.profile_id === mid) ?? null
  const machine = rec?.profile ?? null
  const profilePost = machine ? getPost(machine.postprocessor.id) : null
  const dialect: PartCamSettings['dialect'] = profilePost ? (profilePost.id === 'grbl11' ? 'grbl' : 'iso') : cfg.dialect
  const post = profilePost ?? (dialect === 'grbl' ? POSTS.grbl11 : POSTS.iso_generic)
  const r = useMemo(() => {
    if (!part || !machine) return null
    const caps = capabilities(machine)
    const allow = (op: OperationKind) => {
      const x = caps.find((k) => k.op === op)
      return x && x.state === 'unsupported' ? x.reason ?? 'NO_HEAD_FOR_OPERATION' : null
    }
    return partCam(part, { ...cfg, dialect, atc: machine.atc.supported, allow })
  }, [part, cfg, machine, dialect])
  const key = `part:${part?.file ?? ''}`
  const pin = machine ? { profile_id: machine.profile_id, revision: machine.revision, hash: profileContentHash(machine) } : null
  const job = useMemo(() => jobs[key] ?? newJob(`PART-${part?.file ?? ''}`, pin), [jobs, key, machine]) // eslint-disable-line react-hooks/exhaustive-deps
  const cnc = useMemo(() => {
    if (!part || !machine || !r || 'error' in r) return null
    const programs: NcProgram[] = r.programs.map((p) => ({
      name: p.name,
      text: p.text,
      ctx: { dialect: post.dialect, dialectName: post.label, profileCodes: machine.controller.supported_codes, atc: machine.atc.supported, requireTlo: post.tlo, sheet: { l: r.stock.x, w: r.stock.y }, margin: cfg.millD / 2 + 2, envelope: machine.work_envelope_mm, maxDepth: r.stock.z + 0.3 + 13 * 0.3, rapid: 6000 },
    }))
    const parses = parseSequence(programs)
    const st = job.stocks[0]
    const chain = chainOf({ parts: hashOf(part), stock: { stock: r.stock, measured: st?.measured_thickness_mm ?? null, lot: st?.lot ?? null }, machine: pin, tools: toolsHash(machine), nest: null, cam: cfg, post: { id: post.id, version: post.version, sha256: post.sha256 }, nc: programs.map((p) => p.text) })
    const recorded = job.approval?.chain ?? job.reviewed?.chain ?? null
    const stale = isStale(recorded, chain)
    const approval = validApproval(job, chain)
    const gate: JobGateInput = {
      machineProfileId: job.machine_profile_id ?? machine.profile_id,
      machineProfileRevision: job.machine_profile_revision,
      machineProfileHash: job.machine_profile_hash,
      stocks: [{ material: part.material, nominal_mm: r.stock.z, measured_thickness_mm: st?.measured_thickness_mm ?? null, lot: st?.lot ?? null }],
      edgeBandConfirmed: true,
      stale: recorded ? stale : null,
      approvals: approval ? { operator: approval.operator, engineer: approval.engineer } : null,
      ncIssues: parses.flatMap((x) => x.issues),
      unsupported: r.skipped.map((k) => ({ op: k.op, reason: k.reason })),
      unplaced: [],
      nestErrors: [],
      post: { id: post.id, version: post.version, sha256: post.sha256 },
    }
    const blockers = releaseBlockers(machine, gate, currentCommissioning(rec))
    const meta: ReleaseMeta = { app: 'MD CAD AI STUDIO', job: { job_id: job.job_id, revision: job.revision, part_revision_hash: hashOf(part), chain }, parts: [{ id: part.id, rev: hashOf(part).slice(0, 8) }] }
    return { programs, parses, chain, stale, gate, blockers, meta, status: jobStatus(job, chain, programs.length > 0) }
  }, [part, machine, r, job, cfg, post, rec]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!part) return null
  const base = part.file.replace(/\.prt$/, '')
  const choose = (id: string | null) => {
    setPartMachine(id)
    const m = records.find((x) => x.profile.profile_id === id)?.profile ?? null
    setJob(key, selectMachine(job, m ? { profile_id: m.profile_id, revision: m.revision, hash: profileContentHash(m) } : null))
  }
  const setStock = (patch: Partial<StockRecord>) => {
    const cur: StockRecord = job.stocks[0] ?? { material: part.material, nominal_mm: r && !('error' in r) ? r.stock.z : 0, measured_thickness_mm: null, lot: null, length_mm: null, width_mm: null, grain_axis: 'NONE', face_a: 'top' }
    const next = { ...cur, ...patch }
    setJob(key, { ...job, stocks: [next], stock: next })
  }
  const preview = () => {
    if (!cnc || !machine) return
    const out = previewFiles(cnc.programs, { machine, machineHash: profileContentHash(machine), post, blockers: cnc.blockers, meta: cnc.meta })
    const file = `${base} - CNC engineering preview (NOT FOR MACHINE).zip`
    downloadFile(file, zip(out.files), 'application/zip')
    setJob(key, markReviewed(job, cnc.chain))
    toast(fmt(c.previewSaved, { file }), 'success')
  }
  const production = () => {
    if (!cnc || !machine) return
    try {
      const out = productionFiles(cnc.programs, { machine, machineHash: profileContentHash(machine), commissioning: currentCommissioning(rec), post, gate: cnc.gate, meta: cnc.meta })
      const file = `${base} - CNC production r${job.revision}.zip`
      downloadFile(file, zip(out.files), 'application/zip')
      toast(fmt(c.productionSaved, { file }), 'success')
    } catch (e) {
      toast(fmt(c.productionBlocked, { list: e instanceof ProductionBlocked ? e.blockers.join(', ') : String(e) }), 'warning')
    }
  }
  const approve = () => {
    if (!cnc) return
    try {
      setJob(key, approveJob(job, cnc.chain, who))
      toast(c.approvedToast, 'success')
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), 'warning')
    }
  }
  return (
    <Modal title={fmt(t.title, { part: part.name })} onClose={onClose} width={980}>
      <MachinePicker value={mid} onChange={choose} onManage={() => setMgr(true)} />
      {machine && machine.status !== 'VERIFIED' && <p className={cs.danger} data-testid="not-for-machine">{fmt(c.warnUnverified, { status: c.status[machine.status] ?? machine.status })}</p>}
      {!machine ? null : !r || 'error' in r ? (
        <p className={s.note}>{r && 'error' in r && r.error.startsWith('machine') ? r.error : t.noStock}</p>
      ) : (
        <div className={s.cam} data-testid="cam-dialog">
          <div>
            <p className={s.note}>{fmt(t.stock, { x: r.stock.x.toFixed(0), y: r.stock.y.toFixed(0), z: r.stock.z.toFixed(0) })}</p>
            <svg viewBox={`${-8} ${-r.stock.y - 8} ${r.stock.x + 16} ${r.stock.y + 16}`} className={s.camPreview} role="img" aria-label="Toolpaths">
              <rect x={0} y={-r.stock.y} width={r.stock.x} height={r.stock.y} className={s.stock} />
              {r.paths.map((p, i) => (p.pts.length === 1 ? <circle key={i} cx={p.pts[0][0]} cy={-p.pts[0][1]} r={1.6} className={s.drill} /> : <polyline key={i} points={p.pts.map(([x, y]) => `${x},${-y}`).join(' ')} className={p.tool === 1 ? s.mill : s.drill} />))}
            </svg>
            <p className={r.sim.errors.length ? s.bad : s.good} data-testid="cam-sim">
              {fmt(t.sim, { lines: r.sim.lines.toLocaleString('en-US'), cut: (r.sim.cutLength / 1000).toFixed(1), min: (r.sim.seconds / 60).toFixed(1) })} — {r.sim.errors.length ? r.sim.errors.slice(0, 3).join('; ') : t.simOk}
            </p>
            {cnc && (
              <p className={s.note} data-testid="job-status">
                {c.job} {cnc.meta.job.job_id} r{cnc.meta.job.revision}: <span className={`${cs.badge} ${cnc.status === 'STALE' ? cs.stale : ''}`}>{c.jobState[cnc.status] ?? cnc.status}</span>
                {cnc.status === 'STALE' && cnc.stale.from ? ` — ${fmt(c.stale, { stage: c.stages[cnc.stale.from] ?? cnc.stale.from })}` : ''}
              </p>
            )}
            {cnc && <BlockerList blockers={cnc.blockers} />}
          </div>
          <div>
            <label className={s.row}>
              <span>{t.dialect}{profilePost ? ` (${c.postLocked})` : ''}</span>
              <select aria-label={t.dialect} value={dialect} disabled={!!profilePost} onChange={(e) => setCfg({ ...cfg, dialect: e.target.value as 'iso' | 'grbl' })}>
                <option value="iso">{t.iso}</option>
                <option value="grbl">{t.grbl}</option>
              </select>
            </label>
            <label className={s.row}><span>{t.mill}</span><input aria-label={t.mill} type="number" value={cfg.millD} onChange={(e) => Number(e.target.value) >= 2 && setCfg({ ...cfg, millD: Number(e.target.value) })} /></label>
            <label className={s.row}><span>{t.stepdown}</span><input aria-label={t.stepdown} type="number" value={cfg.stepdown} onChange={(e) => Number(e.target.value) > 0.1 && setCfg({ ...cfg, stepdown: Number(e.target.value) })} /></label>
            <label className={s.row}><span>{t.stepover}</span><input aria-label={t.stepover} type="number" value={Math.round(cfg.stepover * 100)} onChange={(e) => Number(e.target.value) >= 10 && Number(e.target.value) <= 90 && setCfg({ ...cfg, stepover: Number(e.target.value) / 100 })} /></label>
            <label className={s.row}><span>{c.measured}</span><input aria-label={c.measured} placeholder={r.stock.z.toFixed(1)} value={job.stocks[0]?.measured_thickness_mm ?? ''} onChange={(e) => setStock({ measured_thickness_mm: e.target.value.trim() === '' || !Number.isFinite(Number(e.target.value)) ? null : Number(e.target.value) })} /></label>
            <label className={s.row}><span>{c.lot}</span><input aria-label={c.lot} value={job.stocks[0]?.lot ?? ''} onChange={(e) => setStock({ lot: e.target.value || null })} /></label>
            <h5>{t.ops}</h5>
            <table className={s.table} data-testid="cam-ops">
              <tbody>
                {r.ops.map((o, i) => <tr key={i}><td>{o.name}</td><td>{o.tool}</td><td>{o.zBottom.toFixed(1)}</td><td>{(o.lengthMm / 1000).toFixed(2)} m</td></tr>)}
              </tbody>
            </table>
            <h5>{t.tools}</h5>
            <table className={s.table}>
              <tbody>
                {r.tools.map((x) => <tr key={x.n}><td>T{x.n}</td><td>{x.name}</td><td>S{x.rpm}</td><td>F{x.feed}</td></tr>)}
              </tbody>
            </table>
            <label className={s.row}><span>{c.operator}</span><input aria-label={c.operator} value={who.operator} onChange={(e) => setWho({ ...who, operator: e.target.value })} /></label>
            <label className={s.row}><span>{c.engineer}</span><input aria-label={c.engineer} value={who.engineer} onChange={(e) => setWho({ ...who, engineer: e.target.value })} /></label>
            <button type="button" className={s.btn} disabled={!who.operator.trim() || !who.engineer.trim() || !cnc} onClick={approve}>{c.approve}</button>
            <button type="button" className={s.btn} onClick={preview} data-testid="export-preview"><Download size={14} />{t.download}</button>
            <button type="button" className={s.btn} onClick={production} disabled={!cnc || cnc.blockers.length > 0} title={cnc?.blockers.length ? fmt(c.productionBlocked, { list: cnc.blockers.slice(0, 8).join(', ') }) : undefined} data-testid="export-production"><Download size={14} />{c.production}</button>
          </div>
        </div>
      )}
      {mgr && <MachinesDialog initial={mid} onClose={() => setMgr(false)} />}
    </Modal>
  )
}
