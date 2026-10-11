import { useT } from '../../i18n'
import { useSettings, type Language } from '../../state/settings'
import s from './LanguageSwitch.module.css'

const OPTIONS: { value: Language; label: string }[] = [
  { value: 'vi', label: 'VI' },
  { value: 'en', label: 'EN' },
]

export function LanguageSwitch() {
  const t = useT()
  const { language, setLanguage } = useSettings()
  return (
    <div className={s.group} role="radiogroup" aria-label={t.topbar.language}>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={language === o.value}
          className={`${s.opt} ${language === o.value ? s.on : ''}`}
          onClick={() => setLanguage(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
