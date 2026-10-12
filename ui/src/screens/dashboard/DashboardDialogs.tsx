import { useRef, useState, type ReactNode } from 'react'
import { Box, ChevronRight, Cpu, File, FolderOpen, FolderPlus, Image, Layers, Settings, Sparkles, Upload } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { Modal } from '../../components/ui/Modal'
import { ActionButton } from '../../components/ui/Button'
import { useHost } from '../../services/host'
import { runBatch, type BatchOutput, type BatchResult } from '../../cad/batch'
import { PAPERS, type Paper } from '../../cad/plot'
import type { Route } from '../../state/router'
import s from './DashboardDialogs.module.css'

/** Batch conversion of DWG / DXF files (see cad/batch.ts). */
export function BatchModal({ onClose }: { onClose: () => void }) {
  const t = useT().dashboard.batch
  const host = useHost()
  const input = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [outs, setOuts] = useState<Record<BatchOutput, boolean>>({ pdf: true, dxf: false, dwg: false, png: false })
  const [paper, setPaper] = useState<Paper>('A3')
  const [dir, setDir] = useState<string | null>(null)
  const [results, setResults] = useState<BatchResult[]>([])
  const [running, setRunning] = useState(false)
  const chosen = (Object.keys(outs) as BatchOutput[]).filter((k) => outs[k])
  const run = async () => {
    setResults([])
    setRunning(true)
    await runBatch(files, chosen, paper, host, dir, (_, r) => setResults((x) => [...x, r]))
    setRunning(false)
  }
  const ok = results.filter((r) => r.ok).length
  const why = (e?: string) => (e === 'desktop-only' ? t.desktopOnly : e === 'no-dwg-reader' ? t.noReader : e)
  return (
    <Modal
      title={t.title}
      onClose={onClose}
      width={560}
      footer={
        <>
          {host && dir && results.length > 0 && <ActionButton icon={<FolderOpen size={15} />} onClick={() => void host.revealFolder(dir)}>{t.reveal}</ActionButton>}
          <ActionButton variant="primary" disabled={running || !files.length || !chosen.length || (!!host && !dir)} onClick={() => void run()}>
            {running ? fmt(t.running, { i: results.length + 1, n: files.length }) : t.run}
          </ActionButton>
        </>
      }
    >
      <p className={s.intro}>{t.intro}</p>
      <div className={s.row}>
        <ActionButton icon={<Upload size={15} />} onClick={() => input.current?.click()}>{t.choose}</ActionButton>
        <span className={s.muted} data-testid="batch-count">{fmt(t.files, { n: files.length })}</span>
        <input ref={input} type="file" accept=".dwg,.dxf" multiple hidden onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); setResults([]) }} />
      </div>
      <fieldset className={s.group}>
        <legend>{t.outputs}</legend>
        {(['pdf', 'dxf', 'dwg', 'png'] as BatchOutput[]).map((k) => (
          <label key={k} className={s.check}>
            <input type="checkbox" checked={outs[k]} onChange={(e) => setOuts({ ...outs, [k]: e.target.checked })} />
            {t[k]}
          </label>
        ))}
        <label className={s.check}>
          {t.paper}
          <select aria-label={t.paper} value={paper} onChange={(e) => setPaper(e.target.value as Paper)}>
            {(Object.keys(PAPERS) as Paper[]).map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
      </fieldset>
      <div className={s.row}>
        <span className={s.label}>{t.dest}</span>
        {host ? (
          <>
            <ActionButton icon={<FolderPlus size={15} />} onClick={async () => { const d = await host.pickFolder(t.dest, dir ?? ''); if (d) setDir(d) }}>{t.pickDir}</ActionButton>
            <span className={s.path} title={dir ?? ''}>{dir ?? ''}</span>
          </>
        ) : (
          <span className={s.muted}>{t.downloads}</span>
        )}
      </div>
      {results.length > 0 && (
        <ul className={s.results} data-testid="batch-results">
          {results.map((r) => (
            <li key={r.file} className={r.ok ? s.ok : s.bad}>
              <b>{r.file}</b>
              {r.entities !== undefined && <span className={s.muted}> · {fmt(t.entities, { n: r.entities })}</span>}
              {r.error && <span> — {t.failed}: {why(r.error)}</span>}
              {r.outputs.map((o) => (
                <span key={o.name} className={s.out}>{o.error ? `✕ ${o.name}: ${why(o.error)}` : `✓ ${o.name}${o.bytes ? ` (${Math.round(o.bytes / 1024)} KB)` : ''}`}</span>
              ))}
            </li>
          ))}
        </ul>
      )}
      {!running && results.length === files.length && results.length > 0 && <p className={s.summary} role="status">{fmt(t.done, { ok, n: files.length })}</p>}
    </Modal>
  )
}

/** "See all": every quick action of the dashboard in one place. */
export function AllActionsModal({ onClose, actions }: { onClose: () => void; actions: { label: string; icon: ReactNode; run: () => void }[] }) {
  const t = useT().dashboard.all
  return (
    <Modal title={t.title} onClose={onClose} width={520}>
      <ul className={s.grid}>
        {actions.map((a) => (
          <li key={a.label}>
            <button type="button" className={s.action} onClick={() => { onClose(); a.run() }}>
              <span className={s.icon}>{a.icon}</span>
              {a.label}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  )
}

export const actionIcons = { File, Upload, Sparkles, Layers, FolderPlus, FolderOpen, Box, Image, Cpu, Settings }

/** Learning: an offline getting-started guide that opens each screen. */
export function GuideModal({ onClose, go }: { onClose: () => void; go: (r: Route) => void }) {
  const t = useT().dashboard.guide
  return (
    <Modal title={t.title} onClose={onClose} width={600}>
      <p className={s.intro}>{t.intro}</p>
      <ol className={s.steps}>
        {t.steps.map(([title, text, route], i) => (
          <li key={title}>
            <span className={s.num}>{i + 1}</span>
            <span className={s.stepText}>
              <b>{title}</b>
              <span>{text}</span>
            </span>
            <button type="button" className={s.go} onClick={() => { onClose(); go(route as Route) }}>
              {t.go}
              <ChevronRight size={14} />
            </button>
          </li>
        ))}
      </ol>
      <p className={s.muted}>{t.shortcuts}</p>
    </Modal>
  )
}
