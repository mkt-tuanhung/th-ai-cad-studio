/**
 * Machine library: search / filter / similar machines, controller-family dialect facts, hardware products.
 * Reference data only (cam/library/types.ts); `templateToProfile()` (./fromTemplate.ts) makes the user's own
 * UNVERIFIED profile from a template.
 */
import { MACHINES } from './data/machines'
import { CONTROLLERS } from './data/controllers'
import { HARDWARE } from './data/hardware'
import { ORIGIN } from './data/origin'
import type { ControllerFamily, ControllerFamilyId, HardwareItem, HardwareKind, LibraryData, MachineCategory, MachineTemplate, Note } from './types'

export * from './types'

export const LIBRARY: LibraryData = { machines: MACHINES, controllers: CONTROLLERS, hardware: HARDWARE, origin: ORIGIN }

export const templateById = (id: string | null | undefined): MachineTemplate | null => (id ? MACHINES.find((m) => m.id === id) ?? null : null)
export const familyById = (id: string | null | undefined): ControllerFamily | null => (id ? CONTROLLERS.find((c) => c.id === id) ?? null : null)
export const hardwareById = (id: string | null | undefined): HardwareItem | null => (id ? HARDWARE.find((h) => h.id === id) ?? null : null)
export const hardwareOf = (kind: HardwareKind): HardwareItem[] => HARDWARE.filter((h) => h.kind === kind)

/* ------------------------------------------------------------------ controller-family facts */

const NOT_DOC = /^\s*(not documented|not found|unknown|n\/a|none found|undocumented)/i

/** A note that states something (null / "not documented" = the profile must state it). */
export const documented = (n: Note | undefined): n is string => typeof n === 'string' && n.trim() !== '' && !NOT_DOC.test(n)

/** G / M codes named in a text, normalised (G00 → G0, M06 → M6, G43.1 kept). */
export function codesFromText(text: string | null | undefined): string[] {
  if (!text) return []
  const out = new Set<string>()
  for (const m of text.toUpperCase().matchAll(/(?<![A-Z0-9])([GM])0*(\d{1,3}(?:\.\d)?)(?![\d.])/g)) out.add(`${m[1]}${Number(m[2])}`)
  return [...out]
}

const NOTE_KEYS = ['units_codes', 'absolute', 'tool_change', 'tool_length_offset', 'spindle', 'multi_spindle', 'canned_cycles', 'arcs', 'comments', 'program_end'] as const
export type NoteKey = (typeof NOTE_KEYS)[number]
export { NOTE_KEYS }

/** Clauses of a note (split at . and ; followed by a space, or a new line). */
const clauses = (n: string) => n.split(/(?<=[.;])\s+|\n/)
/** A clause states the pattern without a negation. */
const statedIn = (n: string, re: RegExp) => clauses(n).some((c) => re.test(c) && !/\bnot\b|unsupported|whether/i.test(c))

/** "not supported" notes (GRBL: "M6 is an error") name codes that must NOT be allowed. */
const NEGATIVE = /not supported|unsupported|is an error|not available|no\s+(?:tool|g43|canned)/i

/**
 * Codes the controller family's documentation names (prefill of a profile's verified codes — the user checks
 * them on the real controller). Motion G0 / G1 and feed F are the base of every ISO dialect; T / H / S follow the
 * tool-change / tool-length / spindle notes. Codes in `known_unsupported` or in a "not supported" note are left out.
 */
export function familyCodes(f: ControllerFamily | null): string[] {
  if (!f || f.id === 'PROPRIETARY') return []
  const set = new Set<string>(['G0', 'G1', 'F'])
  // "G20/G21 (use G70/G71)": only what is unsupported, not the replacement named after it
  const deny = new Set<string>(f.known_unsupported.flatMap((x) => codesFromText(x.replace(/\(.*?\)/g, ' ').replace(/\b(?:use|uses|instead)\b.*$/i, ''))))
  for (const k of NOTE_KEYS) {
    const n = f[k]
    if (!documented(n)) continue
    const codes = codesFromText(n)
    if (NEGATIVE.test(n) && k !== 'comments') {
      // "M6 not supported", "G43.1 dynamic only; no G43 H": only the positively stated codes count
      if (k === 'tool_change' || k === 'canned_cycles' || k === 'multi_spindle') {
        for (const c of codes) deny.add(c)
        continue
      }
    }
    for (const c of codes) set.add(c)
    // letters: stated in a clause that is not negated ("H-word usage not documented" does not count)
    if (k === 'tool_change' && statedIn(n, /\bT\s*(?:n\b|<\w+>|\d|_|=)|\bT word|\bT code|\bT address/i)) set.add('T')
    if (k === 'tool_length_offset' && codes.includes('G43') && statedIn(n, /\bH\s*(?:n\b|<\w+>|\d|_|=|number)|\bH[- ]word|with H\b/i)) set.add('H')
    if (k === 'spindle' && statedIn(n, /\bS\s*(?:n\b|<\w+>|\d|=|speed)|\bS word|\bS = /i)) set.add('S')
  }
  for (const d of deny) set.delete(d)
  return [...set].sort()
}

export type CommentStyle = 'paren' | 'semicolon' | 'slash' | 'apostrophe' | 'block' | 'none'

/**
 * Comment syntax the family documents. Each style counts only when a sentence of the note states it without a
 * negation ("NOT comments", "not documented", "whether … is accepted") and, for ';', calls it a comment (on FANUC
 * ';' is the end-of-block character). Preference: ( ) > ; > // > ' > /* *\/. Nothing stated → 'none' (the post
 * writes no comments, which every controller accepts).
 */
export function commentStyle(f: ControllerFamily | null): CommentStyle {
  const n = f?.comments
  if (!documented(n)) return 'none'
  const unsupported = (f?.known_unsupported ?? []).join(' ')
  const sentences = n.split(/(?<=[.;])\s+|\n/)
  const negated = (s: string) => /\bnot\b|whether|undocumented|unsupported/i.test(s)
  const stated = (token: RegExp, needComment = false) => sentences.some((s) => token.test(s) && !negated(s) && (!needComment || /comment|to (?:the )?end of (?:line|block)|rest of (?:the )?(?:line|block)/i.test(s)))
  if (!/parenthes/i.test(unsupported) && stated(/parenthes|round brackets|'\(\s*(?:\.\.\.|…)?\s*\)'|\(\s*(?:\.\.\.|…)\s*\)/i)) return 'paren'
  if (stated(/';'|semicolon/i, true)) return 'semicolon'
  if (stated(/'\/\/'|"\/\/"/)) return 'slash'
  if (stated(/apostrophe|single quotation/i)) return 'apostrophe'
  if (stated(/'\/\*'|"\/\*"/)) return 'block'
  return 'none'
}

/** Metric units code of the family (G21; OSAI / Siemens native G71); null = not documented. */
export function metricCode(f: ControllerFamily | null): string | null {
  const c = codesFromText(f?.units_codes)
  return c.includes('G21') ? 'G21' : c.includes('G71') ? 'G71' : null
}

/** Notes the family does not document (the profile must fill them in). */
export const undocumentedNotes = (f: ControllerFamily | null): NoteKey[] => (f ? NOTE_KEYS.filter((k) => !documented(f[k])) : [...NOTE_KEYS])

/* ------------------------------------------------------------------ search, filters, similar */

export interface LibraryFilter {
  q?: string
  manufacturer?: string
  country?: string
  category?: MachineCategory | ''
  controller?: ControllerFamilyId | ''
  /** The table must hold a sheet of this size (either orientation), mm. */
  minL?: number | null
  minW?: number | null
}

const fits = (m: MachineTemplate, l: number, w: number) => {
  const x = m.work_envelope_mm.x, y = m.work_envelope_mm.y
  if (x == null || y == null) return false
  return (x >= l && y >= w) || (x >= w && y >= l)
}

export function searchTemplates(f: LibraryFilter, list: MachineTemplate[] = MACHINES): MachineTemplate[] {
  const words = (f.q ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  return list.filter((m) => {
    const hay = `${m.manufacturer} ${m.country} ${m.series} ${m.model} ${m.category} ${m.controller_family ?? ''} ${m.controller_models.join(' ')} ${m.vendor_cam ?? ''}`.toLowerCase()
    if (!words.every((w) => hay.includes(w))) return false
    if (f.manufacturer && m.manufacturer !== f.manufacturer) return false
    if (f.country && m.country !== f.country) return false
    if (f.category && m.category !== f.category) return false
    if (f.controller && m.controller_family !== f.controller) return false
    if ((f.minL || f.minW) && !fits(m, f.minL ?? 0, f.minW ?? 0)) return false
    return true
  })
}

/** Distinct values for the filter dropdowns. */
export const facets = (list: MachineTemplate[] = MACHINES) => ({
  manufacturers: [...new Set(list.map((m) => m.manufacturer))].sort(),
  countries: [...new Set(list.map((m) => m.country))].sort(),
  categories: [...new Set(list.map((m) => m.category))],
  controllers: [...new Set(list.map((m) => m.controller_family).filter((x): x is ControllerFamilyId => !!x))],
})

/**
 * Similar machines: same category first, then the same controller family and machine type, then the closest
 * table size (relative difference of X and Y). Never the template itself.
 */
export function similarTemplates(t: MachineTemplate, n = 5, list: MachineTemplate[] = MACHINES): MachineTemplate[] {
  const size = (m: MachineTemplate) => {
    const a = [t.work_envelope_mm.x, t.work_envelope_mm.y].map((v) => v ?? 0).sort((p, q) => q - p)
    const b = [m.work_envelope_mm.x, m.work_envelope_mm.y].map((v) => v ?? 0).sort((p, q) => q - p)
    if (!a[0] || !b[0]) return 1
    return (Math.abs(a[0] - b[0]) / a[0] + Math.abs(a[1] - b[1]) / Math.max(1, a[1])) / 2
  }
  const score = (m: MachineTemplate) => (m.category === t.category ? 4 : 0) + (m.controller_family && m.controller_family === t.controller_family ? 2 : 0) + (m.machine_type === t.machine_type ? 1 : 0) - Math.min(2, size(m) * 2)
  return list.filter((m) => m.id !== t.id).map((m) => ({ m, s: score(m) })).sort((a, b) => b.s - a.s || a.m.id.localeCompare(b.m.id)).slice(0, n).map((x) => x.m)
}
