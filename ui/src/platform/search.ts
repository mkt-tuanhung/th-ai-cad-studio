/**
 * ⌘K search beyond projects and files (SP48): CAD 2D commands with their aliases, workspace tools / views (the
 * interaction-profile actions, with the key the active profile gives them), library components, Settings pages and
 * the platform dialogs. Pure matching (tools/unit/platform.test.ts); SearchBar turns hits into actions.
 */
import { COMMANDS } from '../cad/commands'
import { norm } from '../bim/fromCad'
import { ACTIONS, type Scope } from './keymap'

export type Hit =
  | { kind: 'command'; name: string; aliases: string[]; score: number }
  | { kind: 'action'; id: string; scope: Scope; label: string; key?: string; score: number }
  | { kind: 'library'; id: string; name: string; sub: string; score: number }
  | { kind: 'setting'; section: string; label: string; score: number }
  | { kind: 'platform'; what: 'cheatsheet' | 'history' | 'export'; label: string; score: number }

/** 3 exact, 2 prefix (of the text or a word), 1 contains, 0 no match — accents and case ignored. */
export function score(needle: string, text: string): number {
  const n = norm(needle), t = norm(text)
  if (!n || !t) return 0
  if (t === n) return 3
  if (t.startsWith(n) || t.split(' ').some((w) => w.startsWith(n))) return 2
  return t.includes(n) ? 1 : 0
}

export interface SearchCtx {
  actionLabel: (id: string) => string
  /** active key of an action in the current profile (only bindings that act) */
  actionKey: (id: string) => string | undefined
  components: { id: string; name: string; sub: string }[]
  settings: { section: string; label: string }[]
  platform: { what: 'cheatsheet' | 'history' | 'export'; label: string }[]
}

export function searchAll(q: string, ctx: SearchCtx, limit = 8): Hit[] {
  const needle = q.trim()
  if (!needle) return []
  const out: Hit[] = []
  const up = needle.toUpperCase()
  for (const c of COMMANDS) {
    // a typed alias is matched exactly (L, PL, TR…); the command name by prefix
    const sc = c.aliases.includes(up) || c.name === up ? 3 : c.name.startsWith(up) && up.length >= 2 ? 2 : 0
    if (sc) out.push({ kind: 'command', name: c.name, aliases: c.aliases, score: sc + 0.5 })
  }
  for (const a of ACTIONS) {
    if (a.scope === 'cad2d') continue // the CAD 2D tools are the commands above
    const label = ctx.actionLabel(a.id)
    const sc = score(needle, label)
    if (sc) out.push({ kind: 'action', id: a.id, scope: a.scope, label, key: ctx.actionKey(a.id), score: sc })
  }
  for (const p of ctx.platform) { const sc = score(needle, p.label); if (sc) out.push({ kind: 'platform', what: p.what, label: p.label, score: sc + 0.2 }) }
  for (const s of ctx.settings) { const sc = score(needle, s.label); if (sc) out.push({ kind: 'setting', section: s.section, label: s.label, score: sc }) }
  for (const c of ctx.components) { const sc = score(needle, c.name); if (sc) out.push({ kind: 'library', id: c.id, name: c.name, sub: c.sub, score: sc - 0.2 }) }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}
