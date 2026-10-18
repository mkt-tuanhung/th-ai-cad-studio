/**
 * Interaction profiles (SP61, V24-038/039): AutoCAD / SketchUp / 3ds Max / MD Space Planning key maps.
 *
 * A profile binds keys to app actions that already exist (a CAD 2D command, a BIM drawing tool, a view switch…);
 * a key the app has no equivalent for is simply not bound. The user can rebind any action per profile
 * (Settings → Keyboard Shortcuts); the profile is chosen globally and, optionally, per project.
 *
 * Collision rule (the point of V24-038): in CAD 2D the command line owns plain typing — AutoCAD aliases such as
 * L, PL, TR, REC are typed, then Enter / Space. A profile key without a modifier can therefore never act in
 * CAD 2D: it is reported as shadowing the aliases it would steal and is left to the command line. App shortcuts
 * (⌘K, ⌘Z, F3…) win over profile keys in the scopes where they act, and two actions of one scope cannot share a key.
 *
 * Pure module (no React, no DOM besides the KeyboardEvent shape) so the unit tests can check it in Node.
 */
import { COMMANDS } from '../cad/commands'
import { DEFAULT_SHORTCUTS, SHORTCUT_SCOPE, type KeyProfileId, type ShortcutId } from '../state/settings'

export type Scope = 'global' | 'cad2d' | 'bim' | 'interior'
export const PROFILES: KeyProfileId[] = ['autocad', 'sketchup', '3dsmax', 'md']

export interface ActionDef {
  id: string
  scope: Scope
  /** CAD 2D: the command the action types into the command line. */
  command?: string
}

/** Every action a profile can bind. Labels: i18n platform.actions[id]. */
export const ACTIONS: ActionDef[] = [
  // CAD 2D — the same commands as the command line (cad/commands.ts)
  { id: 'cad.select', scope: 'cad2d', command: 'SELECT' },
  { id: 'cad.line', scope: 'cad2d', command: 'LINE' },
  { id: 'cad.polyline', scope: 'cad2d', command: 'PLINE' },
  { id: 'cad.rectangle', scope: 'cad2d', command: 'RECTANG' },
  { id: 'cad.circle', scope: 'cad2d', command: 'CIRCLE' },
  { id: 'cad.arc', scope: 'cad2d', command: 'ARC' },
  { id: 'cad.move', scope: 'cad2d', command: 'MOVE' },
  { id: 'cad.offset', scope: 'cad2d', command: 'OFFSET' },
  { id: 'cad.trim', scope: 'cad2d', command: 'TRIM' },
  { id: 'cad.erase', scope: 'cad2d', command: 'ERASE' },
  { id: 'cad.dimension', scope: 'cad2d', command: 'DIMLINEAR' },
  { id: 'cad.text', scope: 'cad2d', command: 'TEXT' },
  { id: 'cad.hatch', scope: 'cad2d', command: 'HATCH' },
  { id: 'cad.measure', scope: 'cad2d', command: 'DIST' },
  { id: 'cad.zoomExtents', scope: 'cad2d', command: 'ZOOM' },
  // BIM — the ribbon's drawing tools and views (state/bim.ts)
  { id: 'bim.select', scope: 'bim' },
  { id: 'bim.wall', scope: 'bim' },
  { id: 'bim.door', scope: 'bim' },
  { id: 'bim.window', scope: 'bim' },
  { id: 'bim.column', scope: 'bim' },
  { id: 'bim.slab', scope: 'bim' },
  { id: 'bim.room', scope: 'bim' },
  { id: 'bim.stair', scope: 'bim' },
  { id: 'bim.dimension', scope: 'bim' },
  { id: 'bim.grid', scope: 'bim' },
  { id: 'bim.erase', scope: 'bim' },
  { id: 'bim.viewPlan', scope: 'bim' },
  { id: 'bim.view3d', scope: 'bim' },
  { id: 'bim.viewSchedule', scope: 'bim' },
  { id: 'bim.wireframe', scope: 'bim' },
  { id: 'bim.maximize', scope: 'bim' },
  // Interior — plan tools and views (state/interior.ts)
  { id: 'int.dimension', scope: 'interior' },
  { id: 'int.tag', scope: 'interior' },
  { id: 'int.viewFloor', scope: 'interior' },
  { id: 'int.viewCeiling', scope: 'interior' },
  { id: 'int.view3d', scope: 'interior' },
]
const ACTION = new Map(ACTIONS.map((a) => [a.id, a]))
export const actionDef = (id: string) => ACTION.get(id)

/**
 * Default key maps. Only keys of the original program that have an equivalent here are bound.
 * AutoCAD: commands are typed (CAD 2D command line) — no single-key tools anywhere, F-keys / ⌘ combos are the app
 * shortcuts. SketchUp: Space select, L line, R rectangle, C circle, A arc, M move, F offset, E eraser, T tape
 * measure, O orbit, Shift+Z zoom extents. 3ds Max: Q select, W move, Delete, T top, P perspective, F3 wireframe,
 * Alt+W maximise viewport, Z zoom extents. MD Space Planning: W wall, D door, N window, C column, R room, S slab,
 * G grid, M measure, T tag, 1/2/3 plan / 3D / schedule (BIM) or floor / ceiling / 3D (Interior) — and nothing in CAD 2D.
 */
export const PROFILE_KEYS: Record<KeyProfileId, Record<string, string>> = {
  autocad: {},
  sketchup: {
    'cad.select': 'Space', 'cad.line': 'L', 'cad.rectangle': 'R', 'cad.circle': 'C', 'cad.arc': 'A', 'cad.move': 'M', 'cad.offset': 'F', 'cad.erase': 'E', 'cad.measure': 'T', 'cad.zoomExtents': 'Shift+Z',
    'bim.select': 'Space', 'bim.wall': 'L', 'bim.slab': 'R', 'bim.erase': 'E', 'bim.dimension': 'T', 'bim.view3d': 'O',
    'int.dimension': 'T', 'int.view3d': 'O',
  },
  '3dsmax': {
    'cad.select': 'Q', 'cad.move': 'W', 'cad.zoomExtents': 'Z',
    'bim.select': 'Q', 'bim.viewPlan': 'T', 'bim.view3d': 'P', 'bim.wireframe': 'F3', 'bim.maximize': 'Alt+W',
    'int.viewFloor': 'T', 'int.view3d': 'P',
  },
  md: {
    'bim.select': 'V', 'bim.wall': 'W', 'bim.door': 'D', 'bim.window': 'N', 'bim.column': 'C', 'bim.room': 'R', 'bim.slab': 'S', 'bim.stair': 'Shift+S', 'bim.grid': 'G', 'bim.dimension': 'M',
    'bim.viewPlan': '1', 'bim.view3d': '2', 'bim.viewSchedule': '3',
    'int.dimension': 'M', 'int.tag': 'T', 'int.viewFloor': '1', 'int.viewCeiling': '2', 'int.view3d': '3',
  },
}

/** Keys the app itself uses in every workspace (cancel, confirm, field navigation, delete selection). */
export const RESERVED = ['Escape', 'Enter', 'Tab', 'Delete', 'Backspace']

/* ------------------------------------------------------------------ keys */

/** "Mod+Shift+Z" style combo of a key event (layout independent for letters / digits; Space named). */
export function comboOf(e: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): string | null {
  if (['Meta', 'Control', 'Shift', 'Alt', 'CapsLock'].includes(e.key)) return null
  let key = e.key
  if (/^Key[A-Z]$/.test(e.code ?? '')) key = e.code.slice(3)
  else if (/^Digit\d$/.test(e.code ?? '')) key = e.code.slice(5)
  else if (key === ' ' || e.code === 'Space') key = 'Space'
  else if (key.length === 1) key = key.toUpperCase()
  return [(e.metaKey || e.ctrlKey) && 'Mod', e.altKey && 'Alt', e.shiftKey && 'Shift', key].filter(Boolean).join('+')
}

/** Normalises a typed / stored combo ("shift+z" → "Shift+Z"). */
export function normCombo(c: string): string {
  if (!c) return ''
  const parts = c.split('+').map((x) => x.trim()).filter(Boolean)
  let key = parts.pop() ?? ''
  const mods = new Set(parts.map((x) => x.toLowerCase()))
  if (key.length === 1) key = key.toUpperCase()
  else if (/^space$/i.test(key)) key = 'Space'
  else if (/^f\d{1,2}$/i.test(key)) key = key.toUpperCase()
  else key = key.charAt(0).toUpperCase() + key.slice(1)
  return [mods.has('mod') && 'Mod', mods.has('alt') && 'Alt', mods.has('shift') && 'Shift', key].filter(Boolean).join('+')
}

/** A combo without ⌘/Ctrl/Alt that produces a character (or Space): typing in CAD 2D's command line. */
export function isTypingKey(combo: string): boolean {
  const parts = combo.split('+')
  const key = parts.pop() ?? ''
  if (parts.includes('Mod') || parts.includes('Alt')) return false
  return key === 'Space' || key.length === 1
}

/* ------------------------------------------------------------------ resolution */

export interface ProfilePrefs {
  keyProfile: KeyProfileId
  keyMaps: Partial<Record<KeyProfileId, Record<string, string>>>
  projectKeyProfiles: Record<string, KeyProfileId>
  shortcuts: Record<ShortcutId, string>
}

/** The profile in force: the current project's choice, else the default. */
export function activeProfile(p: Pick<ProfilePrefs, 'keyProfile' | 'projectKeyProfiles'>, projectId: string | null | undefined): KeyProfileId {
  const v = projectId ? p.projectKeyProfiles[projectId] : undefined
  return v && PROFILES.includes(v) ? v : PROFILES.includes(p.keyProfile) ? p.keyProfile : 'autocad'
}

/** Action → key of a profile with the user's own keys merged over the defaults ('' unbinds). */
export function profileBindings(profile: KeyProfileId, keyMaps: ProfilePrefs['keyMaps']): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [id, k] of Object.entries({ ...PROFILE_KEYS[profile], ...(keyMaps[profile] ?? {}) })) {
    if (!ACTION.has(id)) continue
    const c = normCombo(k)
    if (c) out[id] = c
  }
  return out
}

export type Collision =
  | { kind: 'alias'; action: string; combo: string; aliases: string[] }
  | { kind: 'commandLine'; action: string; combo: string }
  | { kind: 'app'; action: string; combo: string; shortcut: ShortcutId }
  | { kind: 'duplicate'; action: string; combo: string; other: string }
  | { kind: 'reserved'; action: string; combo: string }

const overlaps = (a: Scope, b: Scope) => a === b || a === 'global' || b === 'global'

/** CAD command names / aliases a typed key would steal (the key starts them). Space = Enter on the command line. */
export function aliasesStartingWith(key: string): string[] {
  if (key === 'Space') return []
  const out: string[] = []
  for (const c of COMMANDS) for (const a of [...c.aliases, c.name]) if (a.startsWith(key)) out.push(a)
  return [...new Set(out)].sort((x, y) => x.length - y.length || x.localeCompare(y))
}

/**
 * Every collision of a profile's key map (after the user's changes) with the CAD command line and its aliases,
 * the app shortcuts, the reserved keys and the other actions of the same scope. A colliding binding is inactive
 * (`activeBindings`); the earlier action of a duplicate pair keeps the key.
 */
export function collisions(bindings: Record<string, string>, shortcuts: Record<ShortcutId, string> = DEFAULT_SHORTCUTS): Collision[] {
  const out: Collision[] = []
  const seen: { id: string; combo: string; scope: Scope }[] = []
  for (const a of ACTIONS) {
    const combo = bindings[a.id]
    if (!combo) continue
    if (RESERVED.includes(combo)) { out.push({ kind: 'reserved', action: a.id, combo }); continue }
    if (overlaps(a.scope, 'cad2d') && isTypingKey(combo)) {
      const key = combo.split('+').pop()!
      const aliases = aliasesStartingWith(key)
      out.push(aliases.length ? { kind: 'alias', action: a.id, combo, aliases } : { kind: 'commandLine', action: a.id, combo })
      continue
    }
    const sc = (Object.keys(shortcuts) as ShortcutId[]).find((k) => normCombo(shortcuts[k]) === combo && overlaps(SHORTCUT_SCOPE[k] ?? 'global', a.scope))
    if (sc) { out.push({ kind: 'app', action: a.id, combo, shortcut: sc }); continue }
    const dup = seen.find((x) => x.combo === combo && overlaps(x.scope, a.scope))
    if (dup) { out.push({ kind: 'duplicate', action: a.id, combo, other: dup.id }); continue }
    seen.push({ id: a.id, combo, scope: a.scope })
  }
  return out
}

/** The bindings that act: combo → action per scope (colliding ones left out). */
export function activeBindings(bindings: Record<string, string>, shortcuts?: Record<ShortcutId, string>): Map<string, string> {
  const blocked = new Set(collisions(bindings, shortcuts).map((c) => c.action))
  const m = new Map<string, string>()
  for (const a of ACTIONS) {
    const combo = bindings[a.id]
    if (combo && !blocked.has(a.id)) m.set(`${a.scope}:${combo}`, a.id)
  }
  return m
}

/** The action a key event triggers in a workspace, or null (typing in a field never triggers anything). */
export function resolveKey(map: Map<string, string>, scope: Scope, combo: string | null): string | null {
  if (!combo) return null
  return map.get(`${scope}:${combo}`) ?? map.get(`global:${combo}`) ?? null
}

/** The workspace (key scope) of a screen route. */
export function scopeOfRoute(route: string): Scope {
  return route === 'cad2d' ? 'cad2d' : route === 'bim' ? 'bim' : route === 'interior' ? 'interior' : 'global'
}

/* ------------------------------------------------------------------ handlers */

type Handler = () => void
const handlers = new Map<string, Handler>()

/** A screen registers what its actions do while it is shown (returns the unregister function). */
export function registerActions(map: Record<string, Handler>): () => void {
  for (const [id, fn] of Object.entries(map)) handlers.set(id, fn)
  return () => {
    for (const [id, fn] of Object.entries(map)) if (handlers.get(id) === fn) handlers.delete(id)
  }
}
export const actionHandler = (id: string) => handlers.get(id) ?? null
