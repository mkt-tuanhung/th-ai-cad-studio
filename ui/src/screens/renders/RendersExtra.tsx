import { useEffect, useMemo, useRef, useState } from 'react'
import { FolderOpen, Play, Trash2 } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { toast } from '../../state/toast'
import { useRenders } from '../../state/renders'
import { useInterior } from '../../state/interior'
import { useBim } from '../../state/bim'
import { useHost, type HostApi } from '../../services/host'
import { Modal } from '../../components/ui/Modal'
import { Select } from '../../components/workspace/Workspace'
import { NativeScene, type SceneCamera, type SceneCtl } from '../../components/workspace/NativeScene'
import { interiorScene } from '../../interior/scene'
import { bimExtras, nativeBuildingModel } from '../../bim/scene'
import { VARIATIONS, applyCustom, videoFrames, viewOf, type Camera, type CustomVariation } from '../../renders/model'
import { startJob } from '../../renders/runner'
import s from './Renders.module.css'

const fileName = (p?: string) => (p ? (p.split(/[\\/]/).pop() ?? p) : '')

async function run(host: HostApi | null, id: string, label: string) {
  if (!host) return
  const err = await startJob(host, id)
  if (err && err !== 'busy') toast(`${label}: ${err}`, 'warning')
}

/** Latest finished job of a kind for a camera (path + preview). */
function useLast(kind: 'panorama' | 'video', cameraId: string) {
  const st = useRenders()
  const job = [...st.doc.queue].reverse().find((j) => j.kind === kind && j.cameraId === cameraId && st.runs[j.id])
  return job ? { job, run: st.runs[job.id], preview: st.previews[job.id] } : null
}

/* ------------------------------------------------------------------ panorama */

export function PanoPanel({ cam }: { cam: Camera }) {
  const T = useT()
  const t = T.renders.extra.pano
  const host = useHost()
  const st = useRenders()
  const last = useLast('panorama', cam.id)
  const [yaw, setYaw] = useState(0)
  const drag = useRef<{ x: number; yaw: number } | null>(null)
  const running = last?.run?.status === 'rendering'
  return (
    <div className={s.extra} data-testid="pano-panel">
      <div
        className={s.panoView}
        style={last?.preview ? { backgroundImage: `url(${last.preview})`, backgroundPositionX: `${yaw}px` } : undefined}
        onPointerDown={(e) => (drag.current = { x: e.clientX, yaw })}
        onPointerMove={(e) => drag.current && setYaw(drag.current.yaw + (e.clientX - drag.current.x))}
        onPointerUp={() => (drag.current = null)}
        onPointerLeave={() => (drag.current = null)}
        role="img"
        aria-label={fmt(t.title, { cam: cam.name })}
      >
        {!last?.preview && <p>{host ? t.none : t.browser}</p>}
        {last?.preview && <span className={s.badge}>{running ? fmt(T.renders.viewer.rendering, { s: last.run?.samples ?? 0, n: last.run?.total ?? 0, time: '' }) : last.run?.status === 'done' ? fmt(t.last, { file: fileName(last.run.path), w: st.pano.face * 2, h: st.pano.face }) + ' · ' + t.drag : last.run?.status}</span>}
      </div>
      <div className={s.extraBar}>
        <b>{fmt(t.title, { cam: cam.name })}</b>
        <Select label={t.face} value={String(st.pano.face)} onChange={(v) => st.set({ pano: { ...st.pano, face: Number(v) as 512 | 1024 | 2048 } })} options={[512, 1024, 2048].map((n) => ({ value: String(n), label: `${t.face} ${n} px → ${n * 2} × ${n}` }))} className={s.extraSel} />
        <Select label={t.samples} value={String(st.pano.samples)} onChange={(v) => st.set({ pano: { ...st.pano, samples: Number(v) } })} options={[32, 64, 128, 256, 512].map((n) => ({ value: String(n), label: `${n} ${t.samples.toLowerCase()}` }))} className={s.extraSel} />
        {last?.run?.status === 'done' && host && <button type="button" className={s.iconBtn} aria-label={T.renders.queue.folder} onClick={() => host.revealFolder(last.run.path!.replace(/[\\/][^\\/]*$/, ''))}><FolderOpen size={15} /></button>}
        <button type="button" className={s.go} disabled={running} onClick={() => { const id = st.enqueueSpecial('panorama', cam.id); if (!host) return toast(t.browser); void run(host, id, t.render) }}><Play size={14} />{t.render}</button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ video */

export function VideoPanel({ cam }: { cam: Camera }) {
  const T = useT()
  const t = T.renders.extra.video
  const host = useHost()
  const st = useRenders()
  const last = useLast('video', cam.id)
  const frames = useMemo(() => videoFrames(st.doc.cameras, cam, st.video), [st.doc.cameras, cam, st.video])
  const running = last?.run?.status === 'rendering'
  // a strip of the camera path (top view) so the move is visible before rendering
  const xs = frames.flatMap((f) => [f.eye[0], f.at[0]]), ys = frames.flatMap((f) => [f.eye[1], f.at[1]])
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  const span = Math.max(x1 - x0, y1 - y0, 1)
  const P = (x: number, y: number) => `${(((x - x0) / span) * 260 + 20).toFixed(1)},${(280 - ((y - y0) / span) * 260).toFixed(1)}`
  return (
    <div className={s.extra} data-testid="video-panel">
      <div className={s.videoView}>
        {last?.preview ? <img src={last.preview} alt="" /> : <p>{host ? t.none : t.browser}</p>}
        <svg viewBox="0 0 300 300" className={s.pathSvg} aria-label={t.path}>
          <polyline points={frames.map((f) => P(f.eye[0], f.eye[1])).join(' ')} className={s.camPath} />
          {frames.filter((_, i) => i % Math.max(1, Math.round(frames.length / 12)) === 0).map((f, i) => <line key={i} x1={P(f.eye[0], f.eye[1]).split(',')[0]} y1={P(f.eye[0], f.eye[1]).split(',')[1]} x2={P(f.at[0], f.at[1]).split(',')[0]} y2={P(f.at[0], f.at[1]).split(',')[1]} className={s.camRay} />)}
        </svg>
        {last && <span className={s.badge}>{running ? `${last.run?.samples ?? 0} / ${last.run?.total ?? 0}` : last.run?.status === 'done' ? fmt(t.last, { file: fileName(last.run.path), codec: last.run.path?.endsWith('.mp4') ? 'H.264 MP4' : 'Motion-JPEG AVI' }) : last.run?.error ?? last.run?.status}</span>}
      </div>
      <div className={s.extraBar}>
        <b>{fmt(t.title, { cam: cam.name })}</b>
        <Select label={t.path} value={st.video.path} onChange={(v) => st.set({ video: { ...st.video, path: v as 'orbit' | 'flythrough' } })} options={[{ value: 'orbit', label: t.orbit }, { value: 'flythrough', label: t.flythrough }]} className={s.extraSel} />
        <Select label={t.seconds} value={String(st.video.seconds)} onChange={(v) => st.set({ video: { ...st.video, seconds: Number(v) } })} options={[2, 4, 6, 10, 20].map((n) => ({ value: String(n), label: `${n} s` }))} className={s.extraSelS} />
        <Select label={t.fps} value={String(st.video.fps)} onChange={(v) => st.set({ video: { ...st.video, fps: Number(v) as 12 | 24 | 30 } })} options={[12, 24, 30].map((n) => ({ value: String(n), label: `${n} fps` }))} className={s.extraSelS} />
        <Select label={t.resolution} value={st.video.resolution} onChange={(v) => st.set({ video: { ...st.video, resolution: v as '1280x720' | '1920x1080' } })} options={[{ value: '1280x720', label: '1280 × 720' }, { value: '1920x1080', label: '1920 × 1080' }]} className={s.extraSelS} />
        <Select label={t.samples} value={String(st.video.samples)} onChange={(v) => st.set({ video: { ...st.video, samples: Number(v) } })} options={[16, 32, 64, 128].map((n) => ({ value: String(n), label: `${n} spp` }))} className={s.extraSelS} />
        <small data-testid="video-frames">{fmt(t.frames, { n: frames.length, t: frames.length, s: st.video.samples })}</small>
        {last?.run?.status === 'done' && host && <button type="button" className={s.iconBtn} aria-label={T.renders.queue.folder} onClick={() => host.revealFolder(last.run.path!.replace(/[\\/][^\\/]*$/, ''))}><FolderOpen size={15} /></button>}
        <button type="button" className={s.go} disabled={running} onClick={() => { const id = st.enqueueSpecial('video', cam.id); if (!host) return toast(t.browser); void run(host, id, t.render) }}><Play size={14} />{t.render}</button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ variations */

/** Applies a custom variation to the settings + post-processing (undoable). */
export function applyVariation(v: CustomVariation, label: string) {
  const st = useRenders.getState()
  st.edit(v.name, (d) => ({ ...d, ...applyCustom(d.settings, d.fx, v) }))
  st.set({ customSel: v.id })
  toast(label)
}

/** Queues small preview renders of the custom variations without a thumbnail. */
export function queueThumbs(host: HostApi | null, cam: Camera, t: ReturnType<typeof useT>['renders']['extra']['vars']) {
  if (!host) return toast(t.desktopOnly)
  const st = useRenders.getState()
  const todo = (st.doc.custom ?? []).filter((v) => !v.preview)
  if (!todo.length) return
  const jobs = todo.map((v, i) => {
    const cfg = applyCustom(st.doc.settings, st.doc.fx, v)
    return { id: `thumb-${Date.now()}-${i}`, cameraId: cam.id, camera: `${cam.name} - ${v.name} (thumbnail)`, settings: '640 × 360 · 48 samples', output: 'PNG', status: 'waiting' as const, created: Date.now(), cfg: { settings: { ...cfg.settings, samples: 48 }, fx: cfg.fx }, special: { w: 640, h: 360, samples: 48 }, thumbFor: v.id }
  })
  st.edit(`Queue ${jobs.length} thumbnail(s)`, (d) => ({ ...d, queue: [...d.queue, ...jobs] }))
  toast(fmt(t.thumbsQueued, { n: jobs.length }))
  void startJob(host, jobs[0].id)
}

export function VariationsGallery({ cam, onClose }: { cam: Camera; onClose: () => void }) {
  const T = useT()
  const t = T.renders.extra.vars
  const host = useHost()
  const st = useRenders()
  const custom = st.doc.custom ?? []
  return (
    <Modal title={t.title} onClose={onClose} width={860}>
      <div className={s.gallery} data-testid="variations-gallery">
        <h4>{t.builtin}</h4>
        <ul>
          {VARIATIONS.map((v) => (
            <li key={v.key}>
              <img src={v.img} alt="" />
              <span>{T.renders.variations.names[v.key]}</span>
              <button type="button" onClick={() => { st.edit(T.renders.variations.names[v.key], (d) => ({ ...d, settings: { ...d.settings, ...v.patch } })); st.set({ variation: v.key, customSel: null }); toast(fmt(T.renders.variations.applied, { name: T.renders.variations.names[v.key] })) }}>{t.apply}</button>
            </li>
          ))}
        </ul>
        <h4>{t.custom}</h4>
        {!custom.length && <p>{t.noCustom}</p>}
        <ul>
          {custom.map((v) => (
            <li key={v.id} data-testid={`custom-${v.id}`}>
              {v.preview ? <img src={v.preview} alt="" /> : <i className={s.swatch} style={{ background: swatch(v) }} />}
              <span>{v.name}</span>
              <small>{v.sky} · {Math.round(v.sunAzimuth)}° / {Math.round(v.sunElevation)}° · {v.exposure >= 0 ? '+' : ''}{v.exposure} EV · {v.temperature > 0 ? '+' : ''}{v.temperature}</small>
              <button type="button" onClick={() => applyVariation(v, fmt(t.applied, { name: v.name }))}>{t.apply}</button>
              <button type="button" aria-label={`${t.remove} ${v.name}`} onClick={() => st.edit(`${t.remove} ${v.name}`, (d) => ({ ...d, custom: (d.custom ?? []).filter((x) => x.id !== v.id) }))}><Trash2 size={13} /></button>
            </li>
          ))}
        </ul>
        {custom.some((v) => !v.preview) && <button type="button" className={s.go} onClick={() => queueThumbs(host, cam, t)}><Play size={14} />{t.thumbs}</button>}
      </div>
    </Modal>
  )
}

/** Sky-ish gradient standing in for a variation without a rendered thumbnail. */
export function swatch(v: CustomVariation) {
  const top = v.sky === 'night' ? '#0f1b3a' : v.sky === 'overcast' ? '#9aa4ae' : v.sky === 'studio' ? '#e9e7e3' : v.sunElevation < 15 ? '#f6a65a' : '#7fb3e6'
  const bot = v.sky === 'night' ? '#2b3b66' : v.temperature > 20 ? '#f4d6a4' : v.temperature < -20 ? '#bcd3ef' : '#e8eef4'
  return `linear-gradient(180deg, ${top}, ${bot})`
}

/* ------------------------------------------------------------------ live camera view (desktop) */

export function LiveCameraView({ host, cam, mode, camRef, ctlRef, tools }: { host: HostApi; cam: Camera; mode: 'wireframe' | 'clay' | 'shaded'; camRef: { current: SceneCamera | null }; ctlRef: { current: SceneCtl | null }; tools: Record<string, unknown> }) {
  const T = useT()
  const st = useRenders()
  const interior = useInterior((x) => x.doc)
  const bim = useBim((x) => x.model)
  const v = viewOf(cam)
  const scene = useMemo(() => (v.scene === 'interior' ? interiorScene(interior, { fullWalls: true, furniture: st.layers.furniture !== false }) : { items: [] }), [v.scene, interior, st.layers.furniture])
  const modelJson = useMemo(() => JSON.stringify(nativeBuildingModel(bim)), [bim])
  const extrasJson = useMemo(() => JSON.stringify(bimExtras(bim)), [bim])
  // put the view on the render camera whenever the camera changes
  const placed = useRef('')
  const place = () => {
    const key = `${cam.id}:${v.eye.join(',')}:${v.at.join(',')}`
    if (placed.current === key) return
    placed.current = key
    void ctlRef.current?.command({ cmd: 'camera', eye: v.eye, at: v.at, fov: v.fov })
  }
  const placeRef = useRef(place)
  placeRef.current = place
  useEffect(() => {
    const id = setTimeout(() => placeRef.current(), 150)
    return () => clearTimeout(id)
  }, [cam.id, v.eye.join(','), v.at.join(',')])
  return (
    <>
      <NativeScene
        host={host}
        sceneKey={`render-${v.scene}`}
        scene={v.scene === 'interior' ? scene : undefined}
        loader={v.scene === 'exterior' ? { loadKey: modelJson + extrasJson, run: () => host.scene3dLoadBim(`render-${v.scene}`, modelJson, extrasJson) } : undefined}
        mode={mode}
        cameraRef={camRef}
        {...tools}
        label={T.renders.viewer.label}
        onLoaded={() => setTimeout(place, 50)}
      />
      <span className={s.liveNote}>{T.renders.extra.liveNote}</span>
    </>
  )
}
