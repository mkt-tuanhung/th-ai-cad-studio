import { useSettings, type Language } from '../state/settings'
import { en, type Messages } from './en'
import { vi } from './vi'

const catalogs: Record<Language, Messages> = { en, vi }

export function getMessages(lang: Language): Messages {
  return catalogs[lang]
}

/** Replace `{name}` placeholders. */
export function fmt(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`))
}

export function useT(): Messages {
  const lang = useSettings((s) => s.language)
  return catalogs[lang]
}

export function useLang(): Language {
  return useSettings((s) => s.language)
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

/** "2 hours ago" / "2 giờ trước" — numeric always, to match the mockup ("1 day ago"). */
export function relativeTime(ts: number, lang: Language, now = Date.now()): string {
  const diff = Math.round((ts - now) / 1000)
  const abs = Math.abs(diff)
  for (const [unit, secs] of UNITS) {
    if (unit === 'week') continue // mockup uses "5 days ago", not "1 week ago"
    if (abs >= secs) {
      return new Intl.RelativeTimeFormat(lang, { numeric: 'always' }).format(Math.round(diff / secs), unit)
    }
  }
  return getMessages(lang).time.justNow
}
