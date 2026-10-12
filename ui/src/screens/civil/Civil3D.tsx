import { useMemo, useRef, useState } from 'react'
import { Box, Camera, Expand, Hand, Home, ScanSearch, ZoomIn, ZoomOut } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { toast } from '../../state/toast'
import { useCivil } from '../../state/civil'
import { useHost } from '../../services/host'
import { NativeScene, type SceneCamera } from '../../components/workspace/NativeScene'
import { useSceneTools } from '../../components/workspace/sceneTools'
import { Modal } from '../../components/ui/Modal'
import { Select, ToolStrip, wsStyles as w } from '../../components/workspace/Workspace'
import { civilScene, corridorFrame, template } from '../../civil/scene3d'
import { hydraulics, interp, sta } from '../../civil/model'
import { tinOf } from '../../civil/surveyModel'
import s from './Civil.module.css'

/**
 * 3D tab: the canal corridor, terrain and culverts as an OCCT scene in the desktop app (shaded, pick,
 * section box, snapshot); the browser shows a labelled wireframe of the design sections.
 */
export function Civil3D() {
  const T = useT()
  const t = T.civil.view3d
  const host = useHost()
  const st = useCivil()
  const cam = useRef<SceneCamera | null>(null)
  const tools = useSceneTools('North Canal - CANAL-01 3D')
  const scene = useMemo(() => civilScene(st.doc, st.ve), [st.doc, st.ve])
  const statsText = fmt(t.stats, { n: scene.stats.stations, t: scene.stats.triangles.toLocaleString('en-US'), g: scene.stats.terrain === 'survey' ? t.survey : scene.stats.terrain === 'drawing' ? T.civil.fromCad.ground3d : t.sample })
  return (
    <div className={s.chartBox} style={{ position: 'relative' }} data-testid="civil-3d">
      {host ? (
        <>
          <NativeScene host={host} sceneKey="civil" scene={scene} mode="shaded" cameraRef={cam} {...tools.props} label={t.title} onPick={(id) => st.doc.culverts.some((c) => c.id === id) && st.set({ bottom: 'structures' })} />
          <tools.Chips />
          <ToolStrip
            style={{ left: 'calc(50% - 120px)', top: 8 }}
            items={[
              { label: T.civil.plan.home, icon: <Home size={16} strokeWidth={1.6} />, onClick: () => cam.current?.('home') },
              { label: T.civil.plan.pan, icon: <Hand size={16} strokeWidth={1.7} />, on: tools.tool === 'pan', onClick: () => tools.toggleTool('pan') },
              { label: T.civil.plan.zoomIn, icon: <ZoomIn size={16} strokeWidth={1.6} />, onClick: () => cam.current?.('zoom', 400, 300, 2) },
              { label: T.civil.plan.zoomOut, icon: <ZoomOut size={16} strokeWidth={1.6} />, onClick: () => cam.current?.('zoom', 400, 300, -2) },
              { label: T.civil.plan.zoomRegion, icon: <ScanSearch size={16} strokeWidth={1.6} />, on: tools.tool === 'zoomRegion', onClick: () => tools.toggleTool('zoomRegion') },
              { label: T.civil.plan.fit, icon: <Expand size={15} strokeWidth={1.7} />, onClick: () => cam.current?.('fit') },
              { label: T.view3d.section, icon: <Box size={16} strokeWidth={1.6} />, on: tools.section.on, onClick: () => tools.toggleSection(['lining', 'water']) },
              { label: T.civil.plan.snapshot, icon: <Camera size={15} strokeWidth={1.7} />, onClick: () => void tools.snapshot() },
            ]}
          />
        </>
      ) : (
        <Wireframe />
      )}
      <div className={s.view3dBar}>
        <Select label={t.ve} value={String(st.ve)} onChange={(v) => st.set({ ve: Number(v) })} options={[1, 2, 3, 5, 10].map((k) => ({ value: String(k), label: `${t.ve} ×${k}` }))} style={{ position: 'relative', left: 0, top: 0, width: 190 }} />
        <span data-testid="civil-3d-stats">{statsText}</span>
      </div>
      {!host && <span className={w.demoBadge} style={{ right: 12, bottom: 12 }}>{t.browser}</span>}
    </div>
  )
}

/** Browser: isometric wireframe of the design template every 20 m and the ground line. */
function Wireframe() {
  const st = useCivil()
  const m = st.doc
  const f = useMemo(() => corridorFrame(m, tinOf(m)), [m])
  const ve = st.ve
  const lines: [number, number, number][][] = []
  const water: [number, number, number][][] = []
  const hy = hydraulics(m)
  const grounds: [number, number, number][][] = []
  if (m.sections?.length) {
    // a route read from a drawing: its own design and ground lines (drawn offsets are + to the right)
    for (const sec of m.sections) {
      const p = f.at(sec.station)
      const pt = (o: number, z: number): [number, number, number] => [p.x + p.dy * o - f.origin[0], p.y - p.dx * o - f.origin[1], z]
      lines.push(sec.design.map(([o, z]) => pt(o, z)))
      grounds.push(sec.ground.map(([o, z]) => pt(o, z)))
    }
  } else for (let x = m.alignment.start; x <= m.alignment.end; x += 20) {
    const p = f.at(x)
    const pt = (o: number, z: number): [number, number, number] => [p.x - p.dy * o - f.origin[0], p.y + p.dx * o - f.origin[1], z]
    lines.push(template(m, x, f).map((q) => pt(q.o, q.z)))
    const wy = m.params.bottomWidth / 2 + m.params.sideSlope * hy.y, wz = interp(m.invert, x) + hy.y
    water.push([pt(wy, wz), pt(-wy, wz)])
  }
  const zRef = Math.min(...m.invert.map(([, z]) => z), ...grounds.flat().map((q) => q[2]))
  // isometric: x along, y across, z up (exaggerated)
  const iso = ([x, y, z]: [number, number, number]) => [x * 0.87 - y * 0.87, x * 0.5 + y * 0.5 - (z - zRef) * ve * 6] as const
  const all = lines.flat().map(iso)
  const x0 = Math.min(...all.map((p) => p[0])) - 10, x1 = Math.max(...all.map((p) => p[0])) + 10, y0 = Math.min(...all.map((p) => p[1])) - 10, y1 = Math.max(...all.map((p) => p[1])) + 10
  const path = (ps: [number, number, number][]) => ps.map((p, i) => `${i ? 'L' : 'M'}${iso(p)[0].toFixed(1)},${iso(p)[1].toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`${x0} ${y0} ${x1 - x0} ${y1 - y0}`} width="100%" height="100%" role="img" aria-label="Corridor wireframe">
      {lines.map((l, i) => <path key={i} d={path(l)} className={s.wire} />)}
      {water.map((l, i) => <path key={'w' + i} d={path(l)} className={s.wireWater} />)}
      {grounds.map((l, i) => <path key={'g' + i} d={path(l)} className={s.wireGround} />)}
      {!grounds.length && (
        <>
          <path d={path(lines.map((l) => l[4]))} className={s.wire} />
          <path d={path(lines.map((l) => l[5]))} className={s.wire} />
          <path d={path(lines.map((l) => l[0]))} className={s.wireGround} />
          <path d={path(lines.map((l) => l[l.length - 1]))} className={s.wireGround} />
        </>
      )}
    </svg>
  )
}

/** Intersection: a road crossing the canal → a box culvert at the station (structures, profile, 3D, quantities). */
export function CrossingDialog({ onClose }: { onClose: () => void }) {
  const T = useT()
  const t = T.civil.crossing
  const st = useCivil()
  const m = st.doc
  const [station, setStation] = useState(st.station)
  const [road, setRoad] = useState(12)
  const [cells, setCells] = useState(2)
  const [span, setSpan] = useState(2)
  const [rise, setRise] = useState(1.5)
  const n = m.culverts.length + 1
  const [name, setName] = useState(`Culvert CL-${String(n).padStart(2, '0')}`)
  const add = () => {
    if (station < m.alignment.start || station > m.alignment.end) return toast(t.outside, 'warning')
    if (m.culverts.some((c) => Math.abs(c.station - station) < 10)) return toast(fmt(t.exists, { sta: sta(station) }), 'warning')
    const size = `Box ${cells} × ${span.toFixed(1)} × ${rise.toFixed(1)} m`
    const inv = Math.round(interp(m.invert, station) * 1000) / 1000
    const id = `CL-${String(n).padStart(2, '0')}`
    const err = st.edit(`Add ${name}`, (d) => ({ ...d, culverts: [...d.culverts, { id, name, station, invert: inv, size, length: road }].sort((a, b) => a.station - b.station) }))
    if (err) return toast(fmt(T.civil.toast.invalid, { why: err }), 'warning')
    st.set({ bottom: 'structures', crossingOpen: false })
    toast(fmt(t.added, { name, sta: sta(station), size, z: inv.toFixed(2) }), 'success')
    onClose()
  }
  const field = (label: string, v: number, set: (n: number) => void, min: number, max: number, stepv = 1) => (
    <label className={s.formRow}>
      <span>{label}</span>
      <input aria-label={label} type="number" value={v} min={min} max={max} step={stepv} onChange={(e) => Number.isFinite(Number(e.target.value)) && set(Number(e.target.value))} />
    </label>
  )
  return (
    <Modal title={t.title} onClose={onClose} width={420}>
      <div className={s.form} data-testid="crossing-dialog">
        <label className={s.formRow}><span>{t.name}</span><input aria-label={t.name} value={name} onChange={(e) => setName(e.target.value)} /></label>
        {field(t.station, station, setStation, m.alignment.start, m.alignment.end, 10)}
        {field(t.road, road, setRoad, 4, 60)}
        {field(t.cells, cells, setCells, 1, 6)}
        {field(t.span, span, setSpan, 0.5, 6, 0.1)}
        {field(t.rise, rise, setRise, 0.5, 5, 0.1)}
        <button type="button" className={s.formBtn} onClick={add}>{t.add}</button>
      </div>
    </Modal>
  )
}
