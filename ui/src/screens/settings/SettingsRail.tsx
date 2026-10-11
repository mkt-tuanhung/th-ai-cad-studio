import { useState, type ComponentType } from 'react'
import {
  AArrowUp, ChevronDown, ChevronRight, Cpu, Database, FileText, Folder, FolderOutput, Gauge, Globe, Layers, Lightbulb, MemoryStick,
  Palette, Rocket, Settings as Gear, ShieldCheck, Table, WifiOff,
} from 'lucide-react'
import { useT } from '../../i18n'
import { useWorkspace } from '../../state/workspace'
import type { Prefs } from '../../state/settings'
import { formatGb, type SystemStatus } from '../../services/system'
import { Modal } from '../../components/ui/Modal'
import { folderPath } from './SettingsCards'
import s from './Settings.module.css'

const tail = (p: string) => {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : p
}

type Ico = ComponentType<{ size?: number; strokeWidth?: number }>

export function SettingsRail({ saved, sys }: { saved: Prefs; sys: SystemStatus | null }) {
  const T = useT().settings
  const R = T.rail
  const entries = useWorkspace((st) => st.entries)
  const [helpOpen, setHelpOpen] = useState(true)
  const [help, setHelp] = useState<null | 'guide' | 'perf' | 'models' | 'privacy'>(null)

  const demo = !sys || sys.ai.source === 'demo'
  const aiReady = !!sys && sys.ai.ready && !demo
  const gpuOn = saved.gpu2d && !!sys?.webgl2
  const allReady = aiReady && gpuOn
  const used = sys?.ai.vramUsedGb ?? 0
  const total = sys?.ai.vramTotalGb ?? 0

  const rows: [Ico, string, React.ReactNode][] = [
    [Cpu, R.aiModel, <span className={s.dotVal}><i className={aiReady ? s.dotGreen : s.dotGray} />{sys?.ai.modelName ?? '—'}{demo && <em className={s.demoTag}>DEMO</em>}</span>],
    [MemoryStick, R.modelStatus, <span className={aiReady ? s.green : s.mutedVal}>{demo ? R.demo : aiReady ? T.ai.ready : T.ai.noModel}</span>],
    [Table, R.vram, <span className={s.vramVal}><span className={s.miniBar}><span style={{ width: `${total ? (used / total) * 100 : 0}%` }} /></span>{used.toFixed(1)} / {Math.round(total)} GB</span>],
    [Layers, R.units, R.unitNames[saved.units]],
    [AArrowUp, R.angle, T.units[saved.angleUnits]],
    [Globe, R.language, saved.language === 'en' ? T.languageCard.en : T.languageCard.vi],
    [Palette, R.theme, saved.themePreference === 'light' ? T.ui.light : saved.themePreference === 'dark' ? T.ui.dark : T.ui.system],
    [Folder, R.projects, tail(folderPath('projectsDir', saved.projectsDir, sys))],
    [Folder, R.autosave, tail(folderPath('autosaveDir', saved.autosaveDir, sys))],
    [FolderOutput, R.export, tail(folderPath('exchangeDir', saved.exchangeDir, sys))],
    [Database, R.cache, `${saved.cacheSizeGb} GB`],
    [Gauge, R.gpu, <span className={gpuOn ? s.green : s.mutedVal}><i className={gpuOn ? s.dotGreen : s.dotGray} />{gpuOn ? R.enabled : sys && !sys.webgl2 ? R.unavailable : R.disabled}</span>],
    [WifiOff, R.offline, <span className={s.green}><i className={s.dotGreen} />{R.available}</span>],
  ]

  // storage breakdown (real figures; see services/system.ts)
  const models = sys?.host?.modelBytes ?? 0
  const projects = entries.reduce((n, e) => n + (e.sizeBytes ?? 0), 0)
  const cache = sys?.cacheBytes ?? 0
  const other = sys?.appDataBytes ?? 0
  const sum = models + projects + cache + other
  const cap = Math.max(sys?.capacityBytes ?? 0, sum)
  const seg = (b: number) => `${cap ? (b / cap) * 100 : 0}%`

  const helpItems: { id: 'guide' | 'perf' | 'models' | 'privacy'; Icon: Ico }[] = [
    { id: 'guide', Icon: FileText },
    { id: 'perf', Icon: Rocket },
    { id: 'models', Icon: Gear },
    { id: 'privacy', Icon: ShieldCheck },
  ]
  const helpText = { guide: T.help.guideText, perf: T.help.perfText, models: T.help.modelsText, privacy: T.help.privacyText }

  return (
    <aside className={s.rail}>
      <section className={s.railCard} aria-label={R.config}>
        <div className={s.railHead}>
          <span className={s.railIcon}><Layers size={30} strokeWidth={1.3} /></span>
          <div>
            <h2>{R.config}</h2>
            <p>{R.configText}</p>
          </div>
          <span className={`${s.chip} ${allReady ? s.chip_green : demo ? s.chip_gray : s.chip_amber} ${s.railChip}`}><i />{allReady ? R.allReady : demo ? R.demo : R.attention}</span>
        </div>
        <ul className={s.config}>
          {rows.map(([Icon, label, value]) => (
            <li key={label}>
              <Icon size={15} strokeWidth={1.6} />
              <span>{label}</span>
              <span className={s.configVal}>{value}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={`${s.railCard} ${s.storage}`} aria-label={R.storage}>
        <div className={s.railHead}>
          <span className={s.railTile}><Database size={22} strokeWidth={1.5} /></span>
          <div>
            <h2>{R.storage}</h2>
            <p>{R.storageText}</p>
          </div>
        </div>
        <p className={s.storageTotal}>{formatGb(sum)} / {formatGb(cap)}</p>
        <div className={s.stack}>
          <span style={{ width: seg(models), background: '#1aa49c' }} />
          <span style={{ width: seg(projects), background: '#3b82f6' }} />
          <span style={{ width: seg(cache), background: '#fbbf24' }} />
          <span style={{ width: seg(other), background: '#9ca3af' }} />
        </div>
        <ul className={s.legend}>
          <li><i style={{ background: '#1aa49c' }} />{R.models}<b>{formatGb(models)}</b></li>
          <li><i style={{ background: '#3b82f6' }} />{R.projectsS}<b>{formatGb(projects)}</b></li>
          <li><i style={{ background: '#fbbf24' }} />{R.cacheS}<b>{formatGb(cache)}</b></li>
          <li><i style={{ background: '#9ca3af' }} />{R.other}<b>{formatGb(other)}</b></li>
        </ul>
      </section>

      <section className={`${s.railCard} ${s.help2}`} aria-label={R.help}>
        <div className={s.railHead}>
          <span className={s.railTile}><Lightbulb size={22} strokeWidth={1.5} /></span>
          <div><h2>{R.help}</h2></div>
          <button type="button" className={s.openBtn} aria-expanded={helpOpen} onClick={() => setHelpOpen(!helpOpen)}>
            {helpOpen ? R.open : R.close} <ChevronDown size={14} strokeWidth={2} />
          </button>
        </div>
        {helpOpen && (
          <ul className={s.helpList}>
            {helpItems.map(({ id, Icon }) => (
              <li key={id}>
                <button type="button" onClick={() => setHelp(id)}>
                  <Icon size={18} strokeWidth={1.5} />
                  <span><b>{T.help[id][0]}</b><small>{T.help[id][1]}</small></span>
                  <ChevronRight size={16} strokeWidth={1.8} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {help && (
        <Modal title={T.help[help][0]} onClose={() => setHelp(null)}>
          <p className={s.modalText}>{helpText[help]}</p>
        </Modal>
      )}
    </aside>
  )
}
