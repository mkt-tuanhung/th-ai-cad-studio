import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Language = 'en' | 'vi'
/** Only the light theme is designed (and approved); dark / system are stored for later. */
export type ThemePreference = 'light' | 'dark' | 'system'
export type UnitSystem = 'mm' | 'cm' | 'm' | 'in'
export type AngleUnits = 'deg' | 'rad' | 'grad'
export type ShortcutId = 'commandSearch' | 'undo' | 'redo' | 'save' | 'saveAs' | 'osnap' | 'grid' | 'ortho' | 'snap' | 'polar' | 'help' | 'cheatsheet'
/** Interaction profiles (key maps for tools / navigation, see platform/keymap.ts). */
export type KeyProfileId = 'autocad' | 'sketchup' | '3dsmax' | 'md'

export const DEFAULT_SHORTCUTS: Record<ShortcutId, string> = {
  commandSearch: 'Mod+K',
  undo: 'Mod+Z',
  redo: 'Mod+Shift+Z',
  save: 'Mod+S',
  saveAs: 'Mod+Shift+S',
  osnap: 'F3',
  grid: 'F7',
  ortho: 'F8',
  snap: 'F9',
  polar: 'F10',
  help: 'F1',
  cheatsheet: 'Mod+/',
}

/** Where an app shortcut acts (the drafting toggles only exist in CAD 2D). Used by the collision check. */
export const SHORTCUT_SCOPE: Record<ShortcutId, 'global' | 'cad2d'> = {
  commandSearch: 'global', undo: 'global', redo: 'global', save: 'global', saveAs: 'global', help: 'global', cheatsheet: 'global',
  osnap: 'cad2d', grid: 'cad2d', ortho: 'cad2d', snap: 'cad2d', polar: 'cad2d',
}

/** Everything the Settings screen edits (persisted). Empty folder strings = the platform default. */
export interface Prefs {
  language: Language
  themePreference: ThemePreference
  units: UnitSystem
  precision: number
  angleUnits: AngleUnits
  startPage: boolean
  compactUi: boolean
  tooltips: boolean
  animations: boolean
  modelsDir: string
  projectsDir: string
  autosaveDir: string
  exchangeDir: string
  autoRecover: boolean
  backup: boolean
  embedFonts: boolean
  optimizeSize: boolean
  defaultFormat: 'dxf-r12' | 'dwg'
  imageFormat: 'png' | 'jpg'
  renderQuality: 'draft' | 'medium' | 'high'
  gpu2d: boolean
  aiGpu: boolean
  cacheSizeGb: number
  maxUndo: number
  shortcuts: Record<ShortcutId, string>
  /** Default interaction profile (all projects). AutoCAD = typed commands first, no single-key tools. */
  keyProfile: KeyProfileId
  /** The user's own key per action, per profile ('' = unbound); merged over the profile's defaults. */
  keyMaps: Partial<Record<KeyProfileId, Record<string, string>>>
  /** Profile chosen for one project (project id → profile); else keyProfile. */
  projectKeyProfiles: Record<string, KeyProfileId>
}

export const DEFAULT_PREFS: Prefs = {
  // EN is pre-selected in all approved mockups.
  language: 'en',
  themePreference: 'light',
  units: 'mm',
  precision: 2,
  angleUnits: 'deg',
  startPage: true,
  compactUi: false,
  tooltips: true,
  animations: true,
  modelsDir: '',
  projectsDir: '',
  autosaveDir: '',
  exchangeDir: '',
  autoRecover: true,
  backup: true,
  embedFonts: false,
  optimizeSize: true,
  defaultFormat: 'dxf-r12',
  imageFormat: 'png',
  renderQuality: 'high',
  gpu2d: true,
  aiGpu: true,
  cacheSizeGb: 10,
  maxUndo: 100,
  shortcuts: DEFAULT_SHORTCUTS,
  keyProfile: 'autocad',
  keyMaps: {},
  projectKeyProfiles: {},
}

interface SettingsState extends Prefs {
  learningExpanded: boolean
  /** Last screen, restored on launch when "Show Start Page on Launch" is off. */
  lastRoute: string
  setLanguage: (lang: Language) => void
  setThemePreference: (t: ThemePreference) => void
  setLearningExpanded: (v: boolean) => void
  /** Settings → Save Changes. */
  apply: (p: Partial<Prefs>) => void
  setLastRoute: (r: string) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_PREFS,
      learningExpanded: true,
      lastRoute: 'dashboard',
      setLanguage: (language) => {
        document.documentElement.lang = language
        set({ language })
      },
      setThemePreference: (themePreference) => set({ themePreference }),
      setLearningExpanded: (learningExpanded) => set({ learningExpanded }),
      apply: (p) => {
        if (p.language) document.documentElement.lang = p.language
        set(p)
      },
      setLastRoute: (lastRoute) => set({ lastRoute }),
    }),
    {
      name: 'thcad.settings',
      version: 1,
      // new keys fall back to their defaults (shallow merge); shortcuts merge per action
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>
        return { ...current, ...p, shortcuts: { ...DEFAULT_SHORTCUTS, ...(p.shortcuts ?? {}) } }
      },
      onRehydrateStorage: () => (state) => {
        if (state) document.documentElement.lang = state.language
      },
    },
  ),
)

export const prefsOf = (s: SettingsState): Prefs => {
  const out = {} as Record<string, unknown>
  for (const k of Object.keys(DEFAULT_PREFS)) out[k] = (s as unknown as Record<string, unknown>)[k]
  return out as unknown as Prefs
}

/** "Mod+Shift+Z" ⇄ KeyboardEvent (Mod = ⌘ on macOS, Ctrl elsewhere). */
export function matchesShortcut(e: KeyboardEvent, combo: string): boolean {
  if (!combo) return false
  const parts = combo.split('+')
  const key = parts.pop()!.toLowerCase()
  const want = new Set(parts.map((x) => x.toLowerCase()))
  const mod = e.metaKey || e.ctrlKey
  if (want.has('mod') !== mod) return false
  if (want.has('shift') !== e.shiftKey) return false
  if (want.has('alt') !== e.altKey) return false
  return e.key.toLowerCase() === key
}

export function shortcutFromEvent(e: KeyboardEvent): string | null {
  if (['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) return null
  const fn = /^F\d{1,2}$/.test(e.key)
  const mod = e.metaKey || e.ctrlKey
  if (!fn && !mod && !e.altKey) return null // plain letters belong to the command line
  return [mod && 'Mod', e.altKey && 'Alt', e.shiftKey && 'Shift', fn ? e.key : e.key.length === 1 ? e.key.toUpperCase() : e.key].filter(Boolean).join('+')
}

export function shortcutLabel(combo: string, mac = /Mac|iPhone|iPad/.test(navigator.platform)): string {
  return combo
    .split('+')
    .map((x) => (x === 'Mod' ? (mac ? '⌘' : 'Ctrl') : x === 'Shift' ? (mac ? '⇧' : 'Shift') : x === 'Alt' ? (mac ? '⌥' : 'Alt') : x))
    .join(mac ? '' : '+')
}
