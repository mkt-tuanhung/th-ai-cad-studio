import { brandLoading } from '../../components/brand/BrandLoader'
import { useEffect, useMemo, useState, type ComponentType, type ReactElement } from 'react'
import { CloudUpload, Folder, Globe, Keyboard, LayoutPanelLeft, RotateCcw, Ruler, Save, Settings as Gear, ShieldCheck, Activity, Plug } from 'lucide-react'
import { useT } from '../../i18n'
import { DEFAULT_PREFS, prefsOf, useSettings, type Prefs } from '../../state/settings'
import { toast } from '../../state/toast'
import { getHost } from '../../services/host'
import { readSystemStatus, type SystemStatus } from '../../services/system'
import { AiSparkIcon } from '../../components/icons'
import {
  AiModelCard, FileHandlingCard, FileLocationsCard, IntegrationsCard, InterfaceCard, LanguageCard, PerformanceCard, PrivacyCard,
  ShortcutsCard, UnitsCard, UpdatesCard, type CardProps,
} from './SettingsCards'
import { SettingsRail } from './SettingsRail'
import s from './Settings.module.css'

export type Section = 'general' | 'interface' | 'files' | 'ai' | 'units' | 'shortcuts' | 'language' | 'performance' | 'updates' | 'privacy' | 'integrations'

const MENU: { id: Section; Icon: ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
  { id: 'general', Icon: Gear },
  { id: 'interface', Icon: LayoutPanelLeft },
  { id: 'files', Icon: Folder },
  { id: 'ai', Icon: AiSparkIcon },
  { id: 'units', Icon: Ruler },
  { id: 'shortcuts', Icon: Keyboard },
  { id: 'language', Icon: Globe },
  { id: 'performance', Icon: Activity },
  { id: 'updates', Icon: CloudUpload },
  { id: 'privacy', Icon: ShieldCheck },
  { id: 'integrations', Icon: Plug },
]

const same = (a: Prefs, b: Prefs) => JSON.stringify(a) === JSON.stringify(b)

export function SettingsScreen() {
  const t = useT()
  const T = t.settings
  const store = useSettings()
  const saved = useMemo(() => prefsOf(store), [store])
  const [draft, setDraft] = useState<Prefs>(saved)
  const [section, setSection] = useState<Section>('general')
  const [sys, setSys] = useState<SystemStatus | null>(null)
  const [modelPath, setModelPath] = useState<string | null>(null)
  const dirty = !same(draft, saved) || modelPath !== null

  const refresh = () => readSystemStatus().then(setSys)
  useEffect(() => {
    void refresh()
  }, [])

  const set = (p: Partial<Prefs>) => setDraft((d) => ({ ...d, ...p }))
  const save = async () => {
    store.apply(draft)
    if (modelPath) {
      const host = await getHost()
      await brandLoading.run(T.loadingModel, async () => host?.loadModel(modelPath))
      setModelPath(null)
    }
    toast(T.saved, 'success')
    void refresh()
  }
  const reset = () => {
    setDraft(DEFAULT_PREFS)
    toast(T.resetDone, 'info')
  }

  const props: CardProps = { draft, set, sys, refresh, modelPath, setModelPath }
  const content: Record<Section, ReactElement> = {
    general: (
      <>
        <AiModelCard {...props} />
        <FileLocationsCard {...props} />
        <div className={s.pair}>
          <UnitsCard {...props} />
          <InterfaceCard {...props} />
        </div>
        <div className={s.pair}>
          <FileHandlingCard {...props} />
          <PerformanceCard {...props} />
        </div>
      </>
    ),
    interface: <InterfaceCard {...props} />,
    files: (
      <>
        <FileLocationsCard {...props} />
        <FileHandlingCard {...props} />
      </>
    ),
    ai: <AiModelCard {...props} />,
    units: <UnitsCard {...props} />,
    shortcuts: <ShortcutsCard {...props} />,
    language: <LanguageCard {...props} />,
    performance: <PerformanceCard {...props} />,
    updates: <UpdatesCard {...props} />,
    privacy: <PrivacyCard />,
    integrations: <IntegrationsCard {...props} />,
  }

  return (
    <div className={s.screen}>
      <div className={s.main}>
        <header className={s.header}>
          <div className={s.headText}>
            <h1 className={s.title}>{T.title}</h1>
            <p className={s.subtitle}>{T.subtitle}</p>
          </div>
          <div className={s.actions}>
            {dirty && <span className={s.dirty}>{T.unsaved}</span>}
            <button type="button" className={s.resetBtn} onClick={reset}>
              <RotateCcw size={18} strokeWidth={1.8} />
              <span>{T.reset}</span>
            </button>
            <button type="button" className={s.saveBtn} onClick={() => void save()}>
              <Save size={19} strokeWidth={1.7} />
              <span>{T.save}</span>
            </button>
          </div>
        </header>

        <div className={s.body}>
          <nav className={s.menu} aria-label={T.title}>
            {MENU.map(({ id, Icon }) => (
              <button key={id} type="button" className={`${s.menuItem} ${section === id ? s.menuOn : ''}`} aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}>
                <Icon size={22} strokeWidth={1.5} />
                <span>
                  <b>{T.menu[id][0]}</b>
                  <small>{T.menu[id][1]}</small>
                </span>
              </button>
            ))}
          </nav>
          <div className={s.content}>{content[section]}</div>
        </div>
      </div>
      <SettingsRail saved={saved} sys={sys} />
    </div>
  )
}
