import { useEffect, useState, type ReactNode } from 'react'
import {
  ChevronDown, ChevronUp, CircleHelp, Cpu, FileText, Folder, FolderOpen, Gauge, Globe, Keyboard, Monitor, Moon, Plug,
  Settings as Gear, ShieldCheck, Sun, Trash2, CloudUpload, Ruler, History,
} from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { DEFAULT_SHORTCUTS, shortcutFromEvent, shortcutLabel, useSettings, type KeyProfileId, type Prefs, type ShortcutId, type UnitSystem } from '../../state/settings'
import { useWorkspace } from '../../state/workspace'
import { ACTIONS, activeProfile, collisions, comboOf, PROFILES, profileBindings } from '../../platform/keymap'
import { collisionText } from '../../platform/profileState'
import { openCheatsheet, openHistory } from '../../platform/ui'
import ps from '../../platform/Platform.module.css'
import { getHost } from '../../services/host'
import { onModelDownloadDone, useModelDownload } from '../../services/modelDownload'
import { clearCaches, formatGb, type SystemStatus } from '../../services/system'
import { formatAngle, formatArea, formatLength } from '../../lib/units'
import { toast } from '../../state/toast'
import { Dropdown, Switch } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import { ActionButton } from '../../components/ui/Button'
import { Field, TextInput } from '../../components/ui/Field'
import { hostError } from '../../platform/hostErrors'
import s from './Settings.module.css'

export interface CardProps {
  draft: Prefs
  set: (p: Partial<Prefs>) => void
  sys: SystemStatus | null
  refresh: () => void
  modelPath: string | null
  setModelPath: (p: string | null) => void
}

function Card({ icon, title, text, chip, children, className }: { icon: ReactNode; title: string; text: string; chip?: ReactNode; children: ReactNode; className?: string }) {
  const T = useT().settings
  const [open, setOpen] = useState(true)
  return (
    <section className={`${s.card} ${className ?? ''}`} aria-label={title}>
      <div className={s.cardHead}>
        <span className={s.tile}>{icon}</span>
        <div className={s.cardTitles}>
          <h2>{title}</h2>
          <p>{text}</p>
        </div>
        {chip}
        <button type="button" className={s.chev} aria-expanded={open} aria-label={open ? T.collapse : T.expand} onClick={() => setOpen(!open)}>
          {open ? <ChevronUp size={17} strokeWidth={1.8} /> : <ChevronDown size={17} strokeWidth={1.8} />}
        </button>
      </div>
      {open && <div className={s.cardBody}>{children}</div>}
    </section>
  )
}

export function Chip({ tone, children }: { tone: 'green' | 'amber' | 'gray'; children: ReactNode }) {
  return (
    <span className={`${s.chip} ${s[`chip_${tone}`]}`}>
      <i />
      {children}
    </span>
  )
}

// ---------------------------------------------------------------- folders
type FolderKey = 'modelsDir' | 'projectsDir' | 'autosaveDir' | 'exchangeDir'

/** The folder actually used: the saved choice, else the platform default. */
export function folderPath(key: FolderKey, value: string, sys: SystemStatus | null): string {
  if (value) return value
  const docs = sys?.host?.documents ?? '~/Documents'
  switch (key) {
    case 'modelsDir':
      return sys?.host?.modelsDir ?? '~/Library/Application Support/MD CAD AI STUDIO/models'
    case 'projectsDir':
      return `${docs}/MD CAD AI STUDIO/Projects`
    case 'autosaveDir':
      return `${docs}/MD CAD AI STUDIO/Autosave`
    default:
      return `${docs}/MD CAD AI STUDIO/Exchange`
  }
}

function FolderRow({ label, k, p }: { label: string; k: FolderKey; p: CardProps }) {
  const T = useT().settings.files
  const [editing, setEditing] = useState(false)
  const path = folderPath(k, p.draft[k], p.sys)
  const desktop = !!p.sys?.host
  const change = async () => {
    const host = await getHost()
    if (!host) return setEditing(true)
    const picked = await host.pickFolder(T.pickTitle, path)
    if (picked) p.set({ [k]: picked } as Partial<Prefs>)
  }
  return (
    <div className={s.row}>
      <span className={s.label}>{label}</span>
      <div className={s.pathField} title={path}>
        <Folder size={16} strokeWidth={1.6} />
        <span>{path}</span>
      </div>
      <button type="button" className={s.iconBtn} aria-label={`${T.reveal}: ${label}`} disabled={!desktop} onClick={async () => (await getHost())?.revealFolder(path)}>
        <FolderOpen size={16} strokeWidth={1.6} />
      </button>
      <button type="button" className={s.changeBtn} onClick={() => void change()} aria-label={`${T.change} ${label}`}>{T.change}</button>
      {editing && <PathModal title={label} initial={path} onClose={() => setEditing(false)} onSave={(v) => { p.set({ [k]: v } as Partial<Prefs>); setEditing(false) }} />}
    </div>
  )
}

function PathModal({ title, initial, onClose, onSave }: { title: string; initial: string; onClose: () => void; onSave: (v: string) => void }) {
  const t = useT()
  const [v, setV] = useState(initial)
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <ActionButton onClick={onClose}>{t.projects.modals.cancel}</ActionButton>
      <ActionButton variant="primary" disabled={!v.trim()} onClick={() => onSave(v.trim())}>{t.projects.modals.save}</ActionButton>
    </>}>
      <Field label={t.settings.files.pathLabel}><TextInput autoFocus value={v} onChange={(e) => setV(e.target.value)} /></Field>
    </Modal>
  )
}

// ---------------------------------------------------------------- AI model
export function aiChip(sys: SystemStatus | null, T: ReturnType<typeof useT>['settings']) {
  if (!sys) return null
  if (sys.ai.source === 'demo') return <Chip tone="gray">{T.ai.demo}</Chip>
  return sys.ai.ready ? <Chip tone="green">{T.ai.modelReady}</Chip> : <Chip tone="amber">{T.ai.noModel}</Chip>
}

export function AiModelCard(p: CardProps) {
  const T = useT().settings
  const A = T.ai
  const [manage, setManage] = useState(false)
  const sys = p.sys
  const demo = !sys || sys.ai.source === 'demo'
  const models = sys?.host?.models ?? []
  const active = models.find((m) => m.active)?.path ?? ''
  const options = demo
    ? [{ value: 'demo', label: sys?.ai.modelName ?? '—' }]
    : models.length
      ? models.map((m) => ({ value: m.path, label: `${m.name} (${formatGb(m.bytes)})` }))
      : [{ value: '', label: A.none }]
  const dl = useModelDownload()
  // the download block sits in the card while there is no model, or while a download runs / just ended;
  // once the AI is ready it stays one click away in Manage Models
  const showDownload = !demo && (!sys!.ai.ready || !!dl.progress || !!dl.result)
  const used = sys?.ai.vramUsedGb ?? 0
  const total = sys?.ai.vramTotalGb ?? 0
  const pct = total ? Math.round((used / total) * 100) : 0
  return (
    <Card icon={<Cpu size={22} strokeWidth={1.5} />} title={A.title} text={A.text} chip={aiChip(sys, T)} className={s.aiCard}>
      <div className={s.row}>
        <span className={s.label}>{A.model}</span>
        <Dropdown className={s.modelSel} label={A.model} value={demo ? 'demo' : (p.modelPath ?? active)} options={options}
          onChange={(v) => !demo && p.setModelPath(v === active ? null : v)} />
        <button type="button" className={s.manageBtn} onClick={() => setManage(true)}>
          <Gear size={17} strokeWidth={1.6} />
          {A.manage}
        </button>
      </div>
      <div className={s.row}>
        <span className={s.label}>{A.status}</span>
        {demo ? <Chip tone="gray">{A.demo}</Chip> : sys!.ai.ready ? <Chip tone="green">{A.ready}</Chip> : <Chip tone="amber">{A.noModel}</Chip>}
        <span className={s.muted} data-testid="ai-device">{demo ? A.demoText : sys!.ai.ready ? (sys!.ai.device ? fmt(A.runningOn, { device: sys!.ai.device }) : A.running) : ''}</span>
      </div>
      <div className={s.row}>
        <span className={s.label}>{A.vram}</span>
        <span className={s.bar}><span style={{ width: `${pct}%` }} /></span>
        <span className={s.barText}>{used.toFixed(1)} / {Math.round(total)} GB ({pct}%)</span>
        {demo && <em className={s.demoTag}>DEMO</em>}
      </div>
      {showDownload && !manage && <ModelDownload onDone={p.refresh} />}
      <FolderRow label={A.folder} k="modelsDir" p={p} />
      {manage && (
        <Modal title={A.manageTitle} onClose={() => setManage(false)}>
          <p className={s.modalText}>{A.manageText}</p>
          <p className={s.modalPath}>{folderPath('modelsDir', p.draft.modelsDir, sys)}</p>
          {!demo && <ModelDownload onDone={p.refresh} />}
          <SpeechModel />
          <ul className={s.modelList}>
            {models.map((m) => (
              <li key={m.path}>
                <b>{m.name}</b>
                <span>{formatGb(m.bytes)}</span>
                {m.active && <Chip tone="green">{A.active}</Chip>}
              </li>
            ))}
            {models.length === 0 && <li>{demo ? A.demo : A.none}</li>}
          </ul>
        </Modal>
      )}
    </Card>
  )
}

/**
 * Download AI model (desktop): the host's catalogue with the model recommended for this computer's memory,
 * one button that downloads or resumes, live progress (speed, time left, sha256 check, load, test question)
 * and a Pause that keeps what is already on disk. The work and every check are in the host
 * (native/app/src/model_downloader.cpp); this only shows it.
 */
function ModelDownload({ onDone }: { onDone: () => void }) {
  const D = useT().settings.ai.dl
  const T = useT().platform
  const { state, progress, result, refresh, start, cancel } = useModelDownload()
  const [pick, setPick] = useState<string | null>(null)
  useEffect(() => {
    void refresh()
    return onModelDownloadDone(() => onDone())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (!state) return null
  const chosen = state.models.find((m) => m.id === (pick ?? progress?.id ?? state.recommended)) ?? state.models[0]
  const busy = !!progress
  const left = chosen.bytes - chosen.partialBytes
  const pct = (a = 0, b = 1) => Math.max(0, Math.min(100, Math.floor((a / b) * 100)))
  const dur = (sec: number) => (sec >= 90 ? fmt(D.min, { n: Math.round(sec / 60) }) : fmt(D.sec, { n: Math.max(1, Math.round(sec)) }))
  let line = ''
  let bar: number | null = null
  if (progress) {
    const ph = progress.phase
    if (ph === 'download') {
      bar = pct(progress.received, progress.total ?? chosen.bytes)
      line = fmt(D.downloading, { got: formatGb(progress.received ?? 0), total: formatGb(progress.total ?? chosen.bytes) })
      if (progress.bytesPerSecond) line += ' · ' + fmt(D.speed, { speed: formatGb(progress.bytesPerSecond), eta: dur(progress.etaSeconds ?? 0) })
      if ((progress.shards ?? 1) > 1) line += ' · ' + fmt(D.part, { n: progress.shard ?? 1, of: progress.shards ?? 1 })
    } else if (ph === 'verify') {
      bar = pct(progress.received, progress.total)
      line = fmt(D.verifying, { pct: bar })
    } else if (ph === 'retry') line = fmt(D.retry, { why: progress.error ?? '', s: progress.inSeconds ?? 0, n: progress.attempt ?? 1 })
    else if (ph === 'load') line = D.loading
    else if (ph === 'test') line = D.testing
  }
  let outcome: { ok: boolean; text: string } | null = null
  if (!busy && result) {
    if (result.ok) outcome = { ok: true, text: fmt(D.done, { answer: result.test ?? '', secs: (result as { seconds?: number }).seconds?.toFixed(1) ?? '—', device: result.device || 'CPU' }) }
    else if (result.cancelled) outcome = { ok: false, text: fmt(D.paused, { got: formatGb(chosen.partialBytes) }) }
    else if (result.needBytes) outcome = { ok: false, text: fmt(D.noSpace, { need: formatGb(result.needBytes), free: formatGb(result.freeBytes ?? 0) }) }
    else outcome = { ok: false, text: fmt(D.failed, { why: hostError(result.error, useSettings.getState().language) }) }
  }
  return (
    <div className={s.dl} data-testid="model-download">
      <b>{D.title}</b>
      <p>{D.text}</p>
      <div className={s.dlList} role="radiogroup" aria-label={D.title}>
        {state.models.map((m) => (
          <label key={m.id} className={`${s.dlItem} ${m.id === chosen.id ? s.dlOn : ''}`}>
            <input type="radio" name="dl-model" checked={m.id === chosen.id} disabled={busy} onChange={() => setPick(m.id)} />
            <span className={s.dlName} title={/3b-instruct/i.test(m.id) ? T.licences.nonCommercial : T.licences.apache}>{m.label}{/3b-instruct/i.test(m.id) ? ` · ${T.licences.nonCommercialShort}` : ""}</span>
            <span className={s.dlSize}>{formatGb(m.bytes)}</span>
            {m.installed ? <Chip tone="green">{D.installed}</Chip> : m.id === state.recommended ? <Chip tone="green">{fmt(D.recommended, { ram: formatGb(state.ramBytes).replace('.0 ', ' ') })}</Chip> : !m.fits ? <Chip tone="amber">{D.slow}</Chip> : null}
            {!m.installed && m.partialBytes > 0 && !busy && <span className={s.dlNote}>{fmt(D.partial, { pct: pct(m.partialBytes, m.bytes) })}</span>}
          </label>
        ))}
      </div>
      <p className={s.dlWhere} title={state.dir}>
        <span>{D.saveTo}:</span>
        <code>{state.dir}</code>
        <span>· {fmt(D.free, { free: formatGb(state.freeBytes) })}</span>
      </p>
      {busy && (
        <div className={s.dlProgress} data-testid="model-download-progress">
          <span className={s.bar}><span style={{ width: `${bar ?? 100}%` }} className={bar === null ? s.dlPulse : ''} /></span>
          <span>{line}</span>
        </div>
      )}
      {outcome && <p className={outcome.ok ? s.dlOk : s.dlErr} data-testid="model-download-result">{outcome.text}</p>}
      <div className={s.dlActions}>
        {busy ? (
          <ActionButton onClick={() => void cancel()} disabled={progress?.phase === 'load' || progress?.phase === 'test'}>{D.pause}</ActionButton>
        ) : (
          !chosen.installed && (
            <ActionButton variant="primary" onClick={() => void start(chosen.id)}>
              {chosen.partialBytes > 0 ? fmt(D.resume, { size: formatGb(left) }) : fmt(D.download, { size: formatGb(chosen.bytes) })}
            </ActionButton>
          )
        )}
      </div>
    </div>
  )
}

/** Whisper speech model: status, and a download the user starts (547 MB, checksum-verified by the host). */
function SpeechModel() {
  const A = useT().settings.ai
  const [st, setSt] = useState<{ available: boolean; model: string; modelBytes: number; device?: string } | null | 'browser'>(null)
  const [pct, setPct] = useState<number | null>(null)
  const refresh = async () => {
    const h = await getHost()
    setSt(h ? await h.whisperStatus() : 'browser')
  }
  useEffect(() => {
    void refresh()
  }, [])
  const download = async () => {
    const h = await getHost()
    if (!h) return
    setPct(0)
    h.on('whisperProgress', (p) => {
      const r = p as { received?: number; total?: number; done?: boolean; ok?: boolean; error?: string }
      if (!r.done) return setPct(r.total ? Math.floor(((r.received ?? 0) / r.total) * 100) : 0)
      setPct(null)
      toast(r.ok ? A.speechDone : fmt(A.speechFailed, { why: hostError(r.error, useSettings.getState().language) }), r.ok ? 'success' : 'warning')
      void refresh()
    })
    void h.whisperDownload()
  }
  return (
    <div className={s.speech} data-testid="speech-model">
      <b>{A.speechTitle}</b>
      <p>
        {st === 'browser' ? A.speechBrowser : !st ? '…' : st.available ? fmt(A.speechReady, { model: st.model.replace(/^ggml-|\.bin$/g, ''), size: formatGb(st.modelBytes) }) : A.speechMissing}
      </p>
      {st && st !== 'browser' && st.available && <p data-testid="speech-device">{st.device ? fmt(A.speechDevice, { device: st.device }) : A.speechDeviceUnknown}</p>}
      {st && st !== 'browser' && !st.available && (
        <ActionButton variant="primary" disabled={pct !== null} onClick={() => void download()}>
          {pct !== null ? fmt(A.speechProgress, { pct }) : A.speechDownload}
        </ActionButton>
      )}
    </div>
  )
}

export function FileLocationsCard(p: CardProps) {
  const T = useT().settings.files
  return (
    <Card icon={<Folder size={22} strokeWidth={1.5} />} title={T.title} text={T.text} className={s.filesCard}>
      <FolderRow label={T.projects} k="projectsDir" p={p} />
      <FolderRow label={T.autosave} k="autosaveDir" p={p} />
      <FolderRow label={T.exchange} k="exchangeDir" p={p} />
    </Card>
  )
}

// ---------------------------------------------------------------- units
export function precisionLabel(n: number, U: ReturnType<typeof useT>['settings']['units']) {
  const sample = (0).toFixed(n)
  return `${sample} (${n === 0 ? U.place0 : n === 1 ? U.place1 : fmt(U.places, { n })})`
}

export function UnitsCard(p: CardProps) {
  const U = useT().settings.units
  const d = p.draft
  return (
    <Card icon={<Ruler size={22} strokeWidth={1.5} />} title={U.title} text={U.text} className={s.unitsCard}>
      <div className={s.row}>
        <span className={s.label}>{U.system}</span>
        <div className={s.segs} role="radiogroup" aria-label={U.system}>
          {(['mm', 'cm', 'm', 'in'] as UnitSystem[]).map((u) => (
            <button key={u} type="button" role="radio" aria-checked={d.units === u} className={`${s.seg} ${d.units === u ? s.segOn : ''}`} onClick={() => p.set({ units: u })}>{u}</button>
          ))}
        </div>
      </div>
      <div className={s.row}>
        <span className={s.label}>{U.precision}</span>
        <Dropdown className={s.wide} label={U.precision} value={d.precision} onChange={(v) => p.set({ precision: v })}
          options={[0, 1, 2, 3, 4].map((n) => ({ value: n, label: precisionLabel(n, U) }))} />
      </div>
      <div className={s.row}>
        <span className={s.label}>{U.angle}</span>
        <Dropdown className={s.wide} label={U.angle} value={d.angleUnits} onChange={(v) => p.set({ angleUnits: v })}
          options={(['deg', 'rad', 'grad'] as const).map((a) => ({ value: a, label: U[a] }))} />
      </div>
      <div className={s.preview} title={U.appliesTo}>
        <b>{U.preview}</b>
        <div>
          <span>{U.length}</span><strong>{formatLength(1234.56, d)}</strong>
          <span>{U.angleL}</span><strong>{formatAngle(Math.PI / 4, d)}</strong>
          <span>{U.area}</span><strong>{formatArea(12_345_600, d)}</strong>
        </div>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------- interface / language
export function InterfaceCard(p: CardProps) {
  const T = useT().settings
  const I = T.ui
  const d = p.draft
  const themes = [
    { id: 'light' as const, Icon: Sun, label: I.light },
    { id: 'dark' as const, Icon: Moon, label: I.dark },
    { id: 'system' as const, Icon: Monitor, label: I.system },
  ]
  return (
    <Card icon={<Monitor size={22} strokeWidth={1.5} />} title={I.title} text={I.text} className={s.uiCard}>
      <div className={s.row}>
        <span className={s.label}>{I.theme}</span>
        <div className={s.themes} role="radiogroup" aria-label={I.theme}>
          {themes.map(({ id, Icon, label }) => (
            <button key={id} type="button" role="radio" aria-checked={d.themePreference === id} className={`${s.theme} ${d.themePreference === id ? s.themeOn : ''}`} onClick={() => p.set({ themePreference: id })}>
              <Icon size={17} strokeWidth={1.6} />
              {label}
            </button>
          ))}
        </div>
      </div>
      {d.themePreference !== 'light' && <p className={s.note}>{I.themeNote}</p>}
      <div className={s.row}>
        <span className={s.label}>{I.language}</span>
        <Dropdown className={s.wide} label={I.language} value={d.language} onChange={(v) => p.set({ language: v })}
          options={[{ value: 'en', label: T.languageCard.en }, { value: 'vi', label: T.languageCard.vi }]} />
      </div>
      {([['startPage', I.startPage], ['compactUi', I.compact], ['tooltips', I.tooltips], ['animations', I.animations]] as const).map(([k, label]) => (
        <div key={k} className={s.toggleRow}>
          <span>{label}</span>
          <Switch checked={d[k]} onChange={(v) => p.set({ [k]: v } as Partial<Prefs>)} label={label} />
        </div>
      ))}
    </Card>
  )
}

export function LanguageCard(p: CardProps) {
  const L = useT().settings.languageCard
  return (
    <Card icon={<Globe size={22} strokeWidth={1.5} />} title={L.title} text={L.text}>
      <div className={s.radioList} role="radiogroup" aria-label={L.title}>
        {(['en', 'vi'] as const).map((l) => (
          <label key={l} className={s.radio}>
            <input type="radio" name="lang" checked={p.draft.language === l} onChange={() => p.set({ language: l })} />
            {L[l]}
          </label>
        ))}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------- file handling / performance
export function FileHandlingCard(p: CardProps) {
  const H = useT().settings.handling
  const d = p.draft
  return (
    <Card icon={<FileText size={20} strokeWidth={1.5} />} title={H.title} text={H.text} className={s.handlingCard}>
      <div className={s.split}>
        <div className={s.smallToggles}>
          {([['autoRecover', H.autoRecover], ['backup', H.backup], ['embedFonts', H.embedFonts], ['optimizeSize', H.optimize]] as const).map(([k, label]) => (
            <div key={k} className={s.smallToggle}>
              <Switch size="sm" checked={d[k]} onChange={(v) => p.set({ [k]: v } as Partial<Prefs>)} label={label} />
              <span>{label}</span>
              {k === 'autoRecover' && <span className={s.help} title={H.autoRecoverHelp}><CircleHelp size={13} strokeWidth={1.7} /></span>}
            </div>
          ))}
        </div>
        <div className={s.smallSelects}>
          <span className={s.tiny}>{H.format}</span>
          <Dropdown className={s.smallSel} label={H.format} value={d.defaultFormat} onChange={(v) => p.set({ defaultFormat: v })}
            options={[{ value: 'dxf-r12', label: H.dxfR12 }, { value: 'dwg', label: H.dwg, disabled: true }]} />
          <div className={s.inline}>
            <span className={s.tiny}>{H.image}</span>
            <Dropdown className={s.tinySel} label={H.image} value={d.imageFormat} onChange={(v) => p.set({ imageFormat: v })}
              options={[{ value: 'png', label: 'PNG' }, { value: 'jpg', label: 'JPG' }]} />
          </div>
          <div className={s.inline}>
            <span className={s.tiny}>{H.quality}</span>
            <Dropdown className={s.tinySel} label={H.quality} value={d.renderQuality} onChange={(v) => p.set({ renderQuality: v })}
              options={(['draft', 'medium', 'high'] as const).map((q) => ({ value: q, label: H[q] }))} />
          </div>
        </div>
      </div>
    </Card>
  )
}

export function PerformanceCard(p: CardProps) {
  const P = useT().settings.perf
  const d = p.draft
  return (
    <Card icon={<Gauge size={22} strokeWidth={1.5} />} title={P.title} text={P.text} className={s.perfCard}>
      <div className={s.split}>
        <div className={s.smallToggles}>
          <div className={s.smallToggle}>
            <Switch size="sm" checked={d.gpu2d} onChange={(v) => p.set({ gpu2d: v })} label={P.gpu} />
            <span>{P.gpu}</span>
          </div>
          <div className={s.smallToggle}>
            <Switch size="sm" checked={d.aiGpu} onChange={(v) => p.set({ aiGpu: v })} label={P.aiGpu} />
            <span>{P.aiGpu}</span>
          </div>
        </div>
        <div className={s.perfRight}>
          <div className={s.inline}>
            <span className={s.tinyLabel}>{P.cache}</span>
            <Dropdown className={s.perfSel} label={P.cache} value={d.cacheSizeGb} onChange={(v) => p.set({ cacheSizeGb: v })}
              options={[2, 5, 10, 20].map((n) => ({ value: n, label: `${n} GB` }))} />
          </div>
          <div className={s.inline}>
            <span className={s.tinyLabel}>{P.undo}</span>
            <input className={s.numInput} type="number" min={10} max={1000} step={10} value={d.maxUndo} aria-label={P.undo}
              onChange={(e) => p.set({ maxUndo: Math.max(10, Math.min(1000, Math.round(Number(e.target.value) || 10))) })} />
          </div>
          <button type="button" className={s.clearBtn} onClick={async () => { await clearCaches(); toast(P.cleared, 'success'); p.refresh() }}>
            <Trash2 size={15} strokeWidth={1.7} />
            <span>{P.clear}</span>
            <b>{formatGb(p.sys?.cacheBytes ?? 0)}</b>
          </button>
        </div>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------- shortcuts
export function ShortcutsCard(p: CardProps) {
  const t = useT()
  const K = t.settings.shortcuts
  const P = t.platform.profiles
  const [capturing, setCapturing] = useState<ShortcutId | null>(null)
  const [capAction, setCapAction] = useState<string | null>(null)
  const [warn, setWarn] = useState('')
  const project = useWorkspace((st) => st.projects.find((x) => x.id === st.currentId) ?? null)
  const perProject = !!project && !!p.draft.projectKeyProfiles[project.id]
  const profile = activeProfile(p.draft, project?.id)
  const bindings = profileBindings(profile, p.draft.keyMaps)
  const why = new Map(collisions(bindings, p.draft.shortcuts).map((c) => [c.action, c]))
  const setProfile = (v: KeyProfileId) => {
    if (perProject && project) p.set({ projectKeyProfiles: { ...p.draft.projectKeyProfiles, [project.id]: v } })
    else p.set({ keyProfile: v })
  }
  const setScope = (v: 'all' | 'project') => {
    if (!project) return
    const { [project.id]: _drop, ...rest } = p.draft.projectKeyProfiles
    void _drop
    p.set({ projectKeyProfiles: v === 'project' ? { ...rest, [project.id]: profile } : rest })
  }
  const setKey = (action: string, combo: string) =>
    p.set({ keyMaps: { ...p.draft.keyMaps, [profile]: { ...(p.draft.keyMaps[profile] ?? {}), [action]: combo } } })
  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') return setCapturing(null)
      const combo = shortcutFromEvent(e)
      if (!combo) return
      const clash = (Object.keys(p.draft.shortcuts) as ShortcutId[]).find((k) => k !== capturing && p.draft.shortcuts[k] === combo)
      if (clash) return setWarn(fmt(K.conflict, { name: K.names[clash] }))
      p.set({ shortcuts: { ...p.draft.shortcuts, [capturing]: combo } })
      setWarn('')
      setCapturing(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, p, K])
  // a profile key: any key, plain letters included (the collision check decides where it can act)
  useEffect(() => {
    if (!capAction) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') return setCapAction(null)
      if (e.key === 'Backspace') { setKey(capAction, ''); return setCapAction(null) }
      const combo = comboOf(e)
      if (!combo) return
      setKey(capAction, combo)
      setCapAction(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })
  const scopes = ['cad2d', 'bim', 'interior'] as const
  return (
    <Card icon={<Keyboard size={22} strokeWidth={1.5} />} title={K.title} text={K.text}>
      <div className={ps.selects}>
        <label>
          {P.title}
          <select aria-label={P.title} value={profile} onChange={(e) => setProfile(e.target.value as KeyProfileId)}>
            {PROFILES.map((id) => <option key={id} value={id}>{P.names[id]}</option>)}
          </select>
        </label>
        <label>
          {P.appliesTo}
          <select aria-label={P.appliesTo} value={perProject ? 'project' : 'all'} disabled={!project} onChange={(e) => setScope(e.target.value as 'all' | 'project')}>
            <option value="all">{P.allProjects}</option>
            {project && <option value="project">{fmt(P.thisProject, { name: project.name })}</option>}
          </select>
        </label>
        <button type="button" className={s.linkBtn} onClick={openCheatsheet}>{P.cheatsheet}</button>
      </div>
      <p className={s.note} style={{ color: '#6b7381' }}>{P.text[profile]}{project ? '' : ' ' + P.noProject}</p>
      {warn && <p className={s.note}>{warn}</p>}
      <ul className={s.keys}>
        {(Object.keys(DEFAULT_SHORTCUTS) as ShortcutId[]).map((id) => (
          <li key={id}>
            <span>{K.names[id]}</span>
            <button type="button" className={`${s.keyBtn} ${capturing === id ? s.keyOn : ''}`} aria-label={`${K.names[id]}: ${p.draft.shortcuts[id]}`} onClick={() => { setWarn(''); setCapturing(id) }}>
              {capturing === id ? K.press : <kbd>{shortcutLabel(p.draft.shortcuts[id])}</kbd>}
            </button>
            <button type="button" className={s.linkBtn} disabled={p.draft.shortcuts[id] === DEFAULT_SHORTCUTS[id]}
              onClick={() => p.set({ shortcuts: { ...p.draft.shortcuts, [id]: DEFAULT_SHORTCUTS[id] } })}>{K.reset}</button>
          </li>
        ))}
      </ul>
      <p className={ps.group}>{P.keysTitle} · {P.names[profile]}</p>
      <p className={s.note} style={{ color: '#6b7381' }}>{P.keysText}</p>
      {scopes.map((sc) => (
        <div key={sc}>
          <p className={ps.group}>{P.workspaces[sc]}</p>
          <ul className={`${s.keys} ${ps.profileKeys}`} data-testid={`profile-keys-${sc}`}>
            {ACTIONS.filter((a) => a.scope === sc).map((a) => {
              const c = why.get(a.id)
              const k = bindings[a.id]
              return (
                <li key={a.id} data-action={a.id} data-active={k && !c ? 'true' : 'false'}>
                  <span>{t.platform.actions[a.id]}</span>
                  <button type="button" className={`${s.keyBtn} ${capAction === a.id ? s.keyOn : ''}`} aria-label={`${P.keysTitle}: ${t.platform.actions[a.id]} (${P.workspaces[sc]})`} onClick={() => { setWarn(''); setCapAction(a.id) }}>
                    {capAction === a.id ? P.press : k ? <kbd>{shortcutLabel(k)}</kbd> : <span className={ps.off}>{P.unbound}</span>}
                  </button>
                  <span className={ps.why}>{c ? `${P.inactive}: ${collisionText(c, t)}` : ''}</span>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      <div className={ps.selects}>
        <button type="button" className={s.linkBtn} disabled={!Object.keys(p.draft.keyMaps[profile] ?? {}).length}
          onClick={() => { const { [profile]: _d, ...rest } = p.draft.keyMaps; void _d; p.set({ keyMaps: rest }) }}>{P.reset}</button>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------- version history
/** Files section: what Auto-recover / backup do now, and the Version history dialog (platform/VersionHistory.tsx). */
export function VersionsCard(p: CardProps) {
  const H = useT().platform.history
  return (
    <Card icon={<History size={22} strokeWidth={1.5} />} title={H.title} text={H.text}>
      <p className={s.note} style={{ color: '#6b7381' }}>{p.draft.autoRecover || p.draft.backup ? fmt(H.on, { n: 10 }) : H.off}</p>
      <div className={ps.selects}>
        <ActionButton onClick={openHistory}>{H.open}</ActionButton>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------- facts
function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className={s.facts}>
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function UpdatesCard(p: CardProps) {
  const U = useT().settings.updates
  const i = p.sys?.info
  return (
    <Card icon={<CloudUpload size={22} strokeWidth={1.5} />} title={U.title} text={U.text}>
      <Facts rows={[
        [U.app, '0.1.0'],
        [U.engine, i?.engine ?? U.browser],
        [U.occt, i?.occt ?? '—'],
        [U.ai, i?.aiBackend ?? '—'],
        [U.dwg, i?.dwgReader || '—'],
      ]} />
    </Card>
  )
}

export function PrivacyCard() {
  const P = useT().settings.privacy
  return (
    <Card icon={<ShieldCheck size={22} strokeWidth={1.5} />} title={P.title} text={P.text}>
      <Facts rows={[[P.network, P.networkV], [P.ai, P.aiV], [P.telemetry, P.telemetryV], [P.files, P.filesV]]} />
    </Card>
  )
}

export function IntegrationsCard(p: CardProps) {
  const I = useT().settings.integrations
  const B = useT().render24.settingsCard
  const i = p.sys?.info
  const desktop = !!p.sys?.host
  return (
    <Card icon={<Plug size={22} strokeWidth={1.5} />} title={I.title} text={I.text}>
      <Facts rows={[
        [I.dwg, desktop ? i?.dwgReader || I.notInstalled : I.browser],
        [I.occt, desktop ? (i?.occt ?? I.notInstalled) : I.browser],
        [I.llama, desktop ? (i?.aiBackend ?? I.notInstalled) : I.browser],
        [B.blender, !desktop ? B.browser : i?.blender?.found ? fmt(B.value, { version: i.blender.version ?? '', path: i.blender.path ?? '' }) : B.notFound],
        [I.cloud, I.none],
      ]} />
    </Card>
  )
}

/** Current saved theme label, for the rail. */
export function useThemeLabel() {
  const I = useT().settings.ui
  const th = useSettings((st) => st.themePreference)
  return th === 'light' ? I.light : th === 'dark' ? I.dark : I.system
}

