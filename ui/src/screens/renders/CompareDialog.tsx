import { useEffect, useState } from 'react'
import { fmt, useT } from '../../i18n'
import { useRenders } from '../../state/renders'
import { useHost } from '../../services/host'
import { Modal } from '../../components/ui/Modal'

/**
 * Before / after comparison (v2.4 SP45, V24-045): the live OCCT frame captured from the job camera when the
 * render was queued, against the finished render of the same job — the same camera and scene revision by
 * construction (both come from the job's snapshot). Drag the slider to wipe between them.
 */
export function CompareDialog({ cameraId, onClose }: { cameraId: string; onClose: () => void }) {
  const T = useT()
  const R = T.render24
  const host = useHost()
  const st = useRenders()
  const job = [...st.doc.queue].reverse().find((j) => j.cameraId === cameraId && st.runs[j.id]?.status === 'done' && j.snap?.frame)
  const hist = job ? undefined : st.history.find((h) => (h.cameraId ?? '') === cameraId && h.frame)
  const run = job ? st.runs[job.id] : undefined
  const framePath = job?.snap?.frame ?? hist?.frame
  const renderPath = run?.path ?? hist?.path
  const rev = job?.snap?.sceneRev ?? hist?.sceneRev ?? '—'
  const engine = (run?.engine ?? hist?.engine) === 'blender' ? R.compare.engineBlender : R.compare.engineOcct
  const [imgs, setImgs] = useState<{ live?: string; render?: string }>({})
  const [renderRev, setRenderRev] = useState<string | null>(null)
  const [pos, setPos] = useState(50)
  useEffect(() => {
    if (!host || !framePath) return
    let live = true
    void host.renderReadImage(framePath, 1600).then((r) => live && r.ok && setImgs((x) => ({ ...x, live: r.url })))
    const pre = job ? st.previews[job.id] : undefined
    if (pre) setImgs((x) => ({ ...x, render: pre }))
    else if (renderPath) void host.renderReadImage(renderPath, 1600).then((r) => live && r.ok && setImgs((x) => ({ ...x, render: r.url })))
    // the render's own revision, as recorded in its provenance sidecar next to the image
    if (renderPath) void host.renderReadSidecar(renderPath).then((r) => live && setRenderRev(r.ok ? r.sidecar?.scene?.revision ?? null : null))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, framePath, renderPath])
  const same = renderRev !== null && renderRev === rev
  return (
    <Modal title={R.compare.title} onClose={onClose} width={980}>
      {!framePath || !renderPath ? (
        <p data-testid="compare-none">{R.compare.none}</p>
      ) : (
        <div data-testid="compare-dialog">
          <div style={{ position: 'relative', width: '100%', aspectRatio: job?.special?.w && job.special.h ? `${job.special.w} / ${job.special.h}` : '16 / 9', background: '#0b1418', borderRadius: 6, overflow: 'hidden', userSelect: 'none' }}>
            {imgs.render && <img data-testid="compare-render" src={imgs.render} alt={fmt(R.compare.render, { engine, rev })} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} draggable={false} />}
            {imgs.live && <img data-testid="compare-live" src={imgs.live} alt={fmt(R.compare.live, { rev })} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', clipPath: `inset(0 ${100 - pos}% 0 0)` }} draggable={false} />}
            <i style={{ position: 'absolute', top: 0, bottom: 0, left: `${pos}%`, width: 2, background: '#fff', boxShadow: '0 0 4px rgba(0,0,0,0.6)' }} />
            <span style={{ position: 'absolute', left: 8, top: 8, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 12, padding: '3px 7px', borderRadius: 4 }}>{fmt(R.compare.live, { rev })}</span>
            <span style={{ position: 'absolute', right: 8, top: 8, background: 'rgba(16,92,96,0.9)', color: '#fff', fontSize: 12, padding: '3px 7px', borderRadius: 4 }}>{fmt(R.compare.render, { engine, rev: renderRev ?? '—' })}</span>
            <span style={{ position: 'absolute', left: 8, bottom: 8, background: 'rgba(0,0,0,0.6)', color: '#ffd28a', fontSize: 11, padding: '2px 6px', borderRadius: 4 }}>{R.presentationOnly}</span>
          </div>
          <input type="range" min={0} max={100} value={pos} aria-label={R.compare.slider} onChange={(e) => setPos(Number(e.target.value))} style={{ width: '100%', marginTop: 10 }} />
          <p data-testid="compare-rev" data-same={same ? '1' : '0'} style={{ margin: '6px 0 0', fontSize: 13 }}>{same ? fmt(R.compare.same, { rev }) : fmt(R.compare.differ, { a: rev, b: renderRev ?? '—' })}</p>
        </div>
      )}
    </Modal>
  )
}
