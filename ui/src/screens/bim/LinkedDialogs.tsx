/**
 * v2.4 authoring dialogs of the BIM ribbon's More menu: Smart Room (templates with typed sizes in mm), Roof from
 * perimeter, and the L / U stair. Each commits ONE undoable model edit (or arms the plan's Smart Room tool).
 */
import { useState } from 'react'
import { fmt } from '../../i18n'
import { linkedT, useLinkedT } from '../../i18n/ws/linked'
import { ruleMessage, useBim } from '../../state/bim'
import { toast } from '../../state/toast'
import { Modal } from '../../components/ui/Modal'
import { defaultSpec, smartRoom, specProblem, type SmartRoomSpec, type SmartShape } from '../../bim/smartRoom'
import { roofFromPerimeter } from '../../bim/roofTool'
import { nextLevel, nextMark, uid } from '../../bim/geometry'
import { stairFlight } from '../../bim/scene'
import type { P2, Stair } from '../../bim/model'
import s from './BimRibbon.module.css'

const SHAPES: SmartShape[] = ['rect', 'L', 'U', 'polygon', 'round', 'corridor']
const num = (v: string) => Number(v.replace(',', '.'))
const pts = (v: string): P2[] => v.split(';').map((q) => q.split(',').map(num) as P2).filter((p) => p.length === 2 && p.every(Number.isFinite))
const xy = (v: string): P2 | null => {
  const p = v.split(/[,;\s]+/).filter(Boolean).map(num)
  return p.length === 2 && p.every(Number.isFinite) ? [p[0], p[1]] : null
}

/** Commits a Smart Room as one undoable edit (shared walls reused) and reports it. Returns false when rejected. */
export function commitSmartRoom(spec: SmartRoomSpec): boolean {
  const st = useBim.getState()
  const L = linkedT()
  const r = smartRoom(st.model, spec)
  if ('error' in r && r.error) {
    toast(L.smart.errors[r.error as keyof typeof L.smart.errors] ?? r.error, 'warning')
    return false
  }
  const ok = r as Exclude<typeof r, { error: string }>
  const err = st.edit(`Smart Room ${L.smart.shapes[spec.shape]}`, () => ok.model)
  if (err) {
    toast(ruleMessage(err) ?? err, 'warning')
    return false
  }
  const room = useBim.getState().model.rooms.find((x) => x.id === ok.room)
  st.set({ selection: { category: 'room', id: ok.room }, rightTab: 'properties' })
  toast(fmt(L.plan.smartAdded, { number: room?.number ?? '', walls: ok.created.length, reused: ok.reused.length, area: (room?.area ?? 0).toFixed(2) }), 'success')
  return !!room
}

export function SmartRoomDialog({ onClose }: { onClose: () => void }) {
  const L = useLinkedT()
  const t = L.smart
  const { level, set } = useBim()
  const [shape, setShape] = useState<SmartShape>('rect')
  const d0 = defaultSpec('rect', level)
  const [f, setF] = useState<Record<string, string>>({ w: String(d0.w), d: String(d0.d), cutW: '2400', cutD: '2000', r: '2500', segments: '16', pts: '0,0; 5000,0; 6000,2500; 3000,4500; 0,3500', thickness: '200', height: '3000', angle: '0', origin: '0,0', name: 'Room' })
  const [dims, setDims] = useState<'inner' | 'centre'>('inner')
  const [arcWalls, setArcWalls] = useState(false)
  const pick = (sh: SmartShape) => {
    const d = defaultSpec(sh, level)
    setShape(sh)
    setF((x) => ({ ...x, ...(d.w ? { w: String(d.w) } : {}), ...(d.d ? { d: String(d.d) } : {}), ...(d.cutW ? { cutW: String(d.cutW) } : {}), ...(d.cutD ? { cutD: String(d.cutD) } : {}), thickness: String(d.thickness) }))
  }
  const spec = (origin: P2): SmartRoomSpec => ({
    shape, level, origin, w: num(f.w), d: num(f.d), cutW: num(f.cutW), cutD: num(f.cutD), r: num(f.r), segments: num(f.segments), arcWalls, pts: pts(f.pts),
    thickness: num(f.thickness), height: num(f.height), angle: num(f.angle) || 0, dims, name: f.name.trim() || 'Room',
  })
  const field = (k: string, label: string) => (
    <label key={k}>
      <span>{label}</span>
      <input aria-label={label} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} inputMode={k === 'pts' || k === 'origin' || k === 'name' ? undefined : 'numeric'} />
    </label>
  )
  const check = (sp: SmartRoomSpec) => {
    const bad = specProblem(useBim.getState().model, sp)
    if (bad) toast(t.errors[bad as keyof typeof t.errors] ?? bad, 'warning')
    return !bad
  }
  return (
    <Modal title={t.title} onClose={onClose} width={440}>
      <form className={s.levelForm} data-testid="smart-room-form" onSubmit={(e) => e.preventDefault()}>
        <label>
          <span>{t.shape}</span>
          <select aria-label={t.shape} value={shape} onChange={(e) => pick(e.target.value as SmartShape)}>
            {SHAPES.map((x) => (
              <option key={x} value={x}>{t.shapes[x]}</option>
            ))}
          </select>
        </label>
        {shape === 'round' ? [field('r', t.r), field('segments', t.segments)] : shape === 'polygon' ? field('pts', t.pts) : [field('w', t.w), field('d', t.d)]}
        {(shape === 'L' || shape === 'U') && [field('cutW', t.cutW), field('cutD', t.cutD)]}
        {shape === 'round' && (
          <label>
            <span>{t.arcWalls}</span>
            <input type="checkbox" aria-label={t.arcWalls} checked={arcWalls} onChange={(e) => setArcWalls(e.target.checked)} style={{ justifySelf: 'start', height: 16 }} />
          </label>
        )}
        {field('thickness', t.thickness)}
        {field('height', t.height)}
        <label>
          <span>{t.dims}</span>
          <select aria-label={t.dims} value={dims} onChange={(e) => setDims(e.target.value as 'inner' | 'centre')}>
            <option value="inner">{t.inner}</option>
            <option value="centre">{t.centre}</option>
          </select>
        </label>
        {field('angle', t.angle)}
        {field('name', t.name)}
        {field('origin', t.origin)}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => {
            const sp = spec([0, 0])
            if (!check(sp)) return
            set({ pendingRoom: sp, tool: 'smartRoom', view: 'plan', selection: null })
            onClose()
          }}>{t.place}</button>
          <button type="button" onClick={() => {
            const o = xy(f.origin)
            if (!o) return toast(t.errors.size, 'warning')
            const sp = spec(o)
            if (!check(sp)) return
            if (commitSmartRoom(sp)) {
              set({ view: 'plan' })
              onClose()
            }
          }}>{t.create}</button>
        </div>
      </form>
    </Modal>
  )
}

export function PerimeterRoofDialog({ onClose }: { onClose: () => void }) {
  const L = useLinkedT()
  const t = L.roof
  const { level, edit, set } = useBim()
  const [kind, setKind] = useState<'hip' | 'gable'>('hip')
  const [slope, setSlope] = useState('30')
  const [over, setOver] = useState('500')
  return (
    <Modal title={t.title} onClose={onClose} width={400}>
      <form
        className={s.levelForm}
        onSubmit={(e) => {
          e.preventDefault()
          const r = roofFromPerimeter(useBim.getState().model, { level, kind, slope: num(slope), overhang: num(over) })
          if ('error' in r) return toast(r.error === 'noWalls' ? L.plan.noWalls : r.error, 'warning')
          const err = edit(t.title, () => r.model)
          if (err) return toast(ruleMessage(err) ?? err, 'warning')
          const roof = r.model.roofs!.find((x) => x.id === r.roof)!
          toast(fmt(L.plan.roofAdded, { mark: roof.mark, n: r.walls.length, kind: kind === 'hip' ? t.hip : t.gable, slope: roof.slope }), 'success')
          set({ view: '3d' })
          onClose()
        }}
      >
        <label>
          <span>{t.kind}</span>
          <select aria-label={t.kind} value={kind} onChange={(e) => setKind(e.target.value as 'hip' | 'gable')}>
            <option value="hip">{t.hip}</option>
            <option value="gable">{t.gable}</option>
          </select>
        </label>
        <label>
          <span>{t.slope}</span>
          <input aria-label={t.slope} value={slope} onChange={(e) => setSlope(e.target.value)} inputMode="numeric" />
        </label>
        <label>
          <span>{t.overhang}</span>
          <input aria-label={t.overhang} value={over} onChange={(e) => setOver(e.target.value)} inputMode="numeric" />
        </label>
        <button type="submit">{t.create}</button>
      </form>
    </Modal>
  )
}

export function StairDialog({ onClose }: { onClose: () => void }) {
  const L = useLinkedT()
  const t = L.stair
  const { level, edit, set, model } = useBim()
  const [f, setF] = useState<Record<string, string>>({ kind: 'U', turn: 'left', width: '1100', length1: '2700', length2: '2700', landing: '1200', gap: '100', origin: '0,0', angle: '90' })
  const field = (k: string, label: string) => (
    <label key={k}>
      <span>{label}</span>
      <input aria-label={label} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  )
  const top = nextLevel(model, level)
  return (
    <Modal title={t.title} onClose={onClose} width={420}>
      <form
        className={s.levelForm}
        onSubmit={(e) => {
          e.preventDefault()
          const o = xy(f.origin)
          const vals = ['width', 'length1', 'length2', 'landing'].map((k) => num(f[k]))
          if (!o || !top || vals.some((v) => !(v >= 300))) return toast(L.smart.errors.size, 'warning')
          const m = useBim.getState().model
          const mark = nextMark(m.stairs.map((x) => x.mark), 'ST')
          const st: Stair = {
            id: uid('stair'), category: 'stair', mark, baseLevel: level, topLevel: top.id, x: o[0], y: o[1], angle: num(f.angle) || 0, length: vals[1], width: vals[0],
            run: { kind: f.kind === 'L' ? 'L' : 'U', turn: f.turn === 'right' ? 'right' : 'left', landing: vals[3], length2: vals[2], ...(f.kind === 'U' ? { gap: num(f.gap) || 0 } : {}) },
          }
          const err = edit(`${t.title} ${mark}`, (x) => ({ ...x, stairs: [...x.stairs, st] }))
          if (err) return toast(ruleMessage(err) ?? err, 'warning')
          const fl = stairFlight(useBim.getState().model, st)
          toast(fmt(L.plan.stairAdded, { kind: st.run!.kind, mark, n: fl.n, r: fl.riser.toFixed(1) }), 'success')
          set({ selection: { category: 'stair', id: st.id }, view: 'plan' })
          onClose()
        }}
      >
        <label>
          <span>{t.kind}</span>
          <select aria-label={t.kind} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="L">{t.L}</option>
            <option value="U">{t.U}</option>
          </select>
        </label>
        <label>
          <span>{t.turn}</span>
          <select aria-label={t.turn} value={f.turn} onChange={(e) => setF({ ...f, turn: e.target.value })}>
            <option value="left">{t.left}</option>
            <option value="right">{t.right}</option>
          </select>
        </label>
        {field('width', t.width)}
        {field('length1', t.length1)}
        {field('length2', t.length2)}
        {field('landing', t.landing)}
        {f.kind === 'U' && field('gap', t.gap)}
        {field('origin', t.origin)}
        {field('angle', t.angle)}
        <button type="submit">{t.create}</button>
      </form>
    </Modal>
  )
}
