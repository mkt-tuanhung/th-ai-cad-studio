import { useEffect, useMemo, useRef, useState } from 'react'
import { fmt, relativeTime, useLang, useT } from '../i18n'
import { Modal } from '../components/ui/Modal'
import { ActionButton } from '../components/ui/Button'
import { toast } from '../state/toast'
import { useSettings } from '../state/settings'
import { useWorkspace } from '../state/workspace'
import { downloadFile } from '../components/workspace/Workspace'
import { latestBackups, restoreBackup, type BackupStore } from '../auto/backup'
import {
  currentInfo, diffSummary, listSnapshots, makeSnapshot, onSnapshotsChanged, restoreSnapshot, saveSnapshot,
  type ApplyResult, type ModelStore, type SnapshotMeta,
} from './snapshots'
import { exportProject, importProject, parseProject, projectFileName } from './projectJson'
import { usePlatformUi } from './ui'
import s from './Platform.module.css'

/** Version history dialog: snapshots (provenance, revision ids, diff in counts, restore), project JSON, backups. */
export function VersionHistory() {
  const t = useT()
  const H = t.platform.history
  const lang = useLang()
  const close = () => usePlatformUi.getState().set({ history: false })
  const autoRecover = useSettings((st) => st.autoRecover)
  const backup = useSettings((st) => st.backup)
  const ws = useWorkspace()
  const current = ws.projects.find((p) => p.id === ws.currentId)
  const minutes = current?.details?.autoSave?.minutes ?? 10
  const [list, setList] = useState<SnapshotMeta[] | null>(null)
  const [backups, setBackups] = useState<{ store: BackupStore; at: number; label: string }[]>([])
  const [tick, setTick] = useState(0)
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => {
    void listSnapshots().then((l) => setList([...l].sort((a, b) => b.at - a.at))).catch(() => setList([]))
    void latestBackups().then(setBackups).catch(() => setBackups([]))
  }, [tick])
  useEffect(() => onSnapshotsChanged(() => setTick((n) => n + 1)), [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => currentInfo(), [tick, list])

  const storeName = (k: ModelStore) => H.stores[k]
  const report = (r: ApplyResult, label: string) => {
    for (const e of r.errors) toast(fmt(H.failed, { store: storeName(e.store), error: e.error }), 'warning')
    toast(r.applied.length ? fmt(H.restored, { label, n: r.applied.length }) : H.nothing, r.applied.length ? 'success' : 'info')
    setTick((n) => n + 1)
  }
  const saveNow = async () => {
    const m = await saveSnapshot(makeSnapshot(H.manualLabel, 'manual'))
    toast(m ? fmt(H.saved, { label: m.label }) : H.notSaved, m ? 'success' : 'warning')
  }
  const restore = async (m: SnapshotMeta) => {
    const label = fmt(H.restoreLabel, { time: new Date(m.at).toLocaleString(lang) })
    const r = await restoreSnapshot(m.id, label)
    if (r !== 'none') report(r, m.label)
  }
  const exportJson = () => {
    const f = exportProject(current)
    const name = projectFileName(f)
    downloadFile(name, JSON.stringify(f), 'application/json')
    toast(fmt(H.exported, { file: name }), 'success')
  }
  const importJson = async (fl: FileList | null) => {
    const f = fl?.[0]
    if (!f) return
    const parsed = parseProject(await f.text())
    if (file.current) file.current.value = ''
    if (!parsed.ok) return toast(fmt(H.importBad[parsed.error], { file: f.name }), 'warning')
    const r = await importProject(parsed.file, fmt(H.importLabel, { file: f.name }))
    for (const e of r.errors) toast(fmt(H.failed, { store: storeName(e.store), error: e.error }), 'warning')
    toast(fmt(H.imported, { file: f.name, n: r.applied.length }), 'success')
    setTick((n) => n + 1)
  }

  return (
    <Modal title={H.title} onClose={close} width={680}>
      <p className={s.note}>{H.text} {autoRecover || backup ? fmt(H.on, { n: minutes }) : H.off}</p>
      <div className={s.actions}>
        <ActionButton variant="primary" onClick={() => void saveNow()}>{H.saveNow}</ActionButton>
        <ActionButton onClick={exportJson}>{H.export}</ActionButton>
        <ActionButton onClick={() => file.current?.click()}>{H.import}</ActionButton>
        <input ref={file} type="file" accept=".json,application/json" hidden aria-label={H.import} data-testid="project-import" onChange={(e) => void importJson(e.target.files)} />
      </div>
      <ul className={s.list} data-testid="version-list">
        {list && list.length === 0 && <li className={s.note}>{H.none}</li>}
        {list?.map((m) => {
          const d = diffSummary(m, now)
          const changed = d.filter((x) => x.changed)
          return (
            <li key={m.id} className={s.item} data-testid="version">
              <div className={s.itemHead}>
                <b>{m.label}</b>
                <span className={s.reason}>{H.reasons[m.reason]}</span>
                <span className={s.meta} title={new Date(m.at).toLocaleString(lang)}>{relativeTime(m.at, lang)}</span>
                <ActionButton onClick={() => void restore(m)} disabled={!changed.length}>{H.restore}</ActionButton>
              </div>
              <div className={s.meta}>
                {fmt(H.provenance, { app: m.appVersion, schema: m.schema })}{m.project ? ' · ' + fmt(H.project, { name: m.project.name }) : ''} · {new Date(m.at).toLocaleString(lang)}
              </div>
              <div className={s.meta} title={Object.entries(m.revisions).map(([k, v]) => `${k}: ${v}`).join('\n')}>
                {H.revisions}: {Object.entries(m.revisions).map(([k, v]) => `${storeName(k as ModelStore)} ${v.slice(4)}`).join(' · ')}
              </div>
              <div className={s.diff} data-testid="version-diff">
                <b>{H.diff}:</b>
                {changed.length === 0 && <span>{H.same}</span>}
                {changed.map((x) => (
                  <span key={x.store}>
                    <b>{storeName(x.store)}</b> {x.rows.length ? x.rows.map((r) => `${r.key} ${r.now} → ${r.then}`).join(', ') : H.changedNoCount}
                  </span>
                ))}
              </div>
            </li>
          )
        })}
      </ul>
      {backups.length > 0 && (
        <>
          <p className={s.note}><b>{H.backups}</b></p>
          <ul className={s.list}>
            {backups.map((b) => (
              <li key={b.store} className={s.item}>
                <div className={s.itemHead}>
                  <b>{storeName(b.store)}</b>
                  <span className={s.meta}>{b.label} · {relativeTime(b.at, lang)}</span>
                  <ActionButton onClick={async () => {
                    const err = await restoreBackup(b.store, H.restoreBackup)
                    toast(err ? fmt(H.failed, { store: storeName(b.store), error: err }) : fmt(H.restored, { label: b.label, n: 1 }), err ? 'warning' : 'success')
                    setTick((n) => n + 1)
                  }}>{H.restoreBackup}</ActionButton>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  )
}
