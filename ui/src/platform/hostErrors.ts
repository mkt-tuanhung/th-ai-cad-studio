/**
 * The desktop host (C++) reports errors in English ("folder not chosen in this session", "no-writer",
 * "checksum mismatch — …"). This maps the most common ones to the UI language; anything unknown is shown as the
 * host wrote it (never hidden). Patterns follow native/app/src/host_bridge.cpp, model_downloader.cpp, dwg_reader.cpp.
 */
import { getMessages, fmt } from '../i18n'
import type { Language } from '../state/settings'

type Key = keyof ReturnType<typeof getMessages>['platform']['hostErrors']
const RULES: [RegExp, Key, ((m: RegExpMatchArray) => Record<string, string>)?][] = [
  [/^cancel+ed$/i, 'cancelled'],
  [/folder not chosen in this session|folder not found/i, 'folder'],
  [/^no-writer$|dxf2dwg \/ dwgadd not found|LibreDWG dxf2dwg/i, 'noWriter'],
  [/^no-reader$/i, 'noReader'],
  [/not enough disk space|no space left|ENOSPC/i, 'disk'],
  [/checksum mismatch|wrong size/i, 'checksum'],
  [/no (ai )?model|model (is )?not loaded/i, 'noModel'],
  [/HTTP 0|host not found|network|connection refused|could not resolve|unreachable|offline/i, 'network'],
  [/timed out|timeout/i, 'timeout'],
  [/^busy$|already running/i, 'busy'],
  [/^cannot (write|create) (.+)$/i, 'cannotWrite', (m) => ({ path: m[2] })],
]

/** The host error in the UI language (or the host's own text when no translation is known). */
export function hostError(raw: string | undefined | null, lang: Language): string {
  const H = getMessages(lang).platform.hostErrors
  const s = (raw ?? '').trim()
  if (!s) return H.unknown
  for (const [re, key, params] of RULES) {
    const m = s.match(re)
    if (m) return params ? fmt(H[key], params(m)) : H[key]
  }
  return s
}
