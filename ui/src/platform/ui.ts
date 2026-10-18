import { create } from 'zustand'

/** Session-only UI state of the platform dialogs (cheatsheet, version history). Not persisted, not a model. */
interface PlatformUi {
  cheatsheet: boolean
  history: boolean
  set: (p: Partial<Omit<PlatformUi, 'set'>>) => void
}
export const usePlatformUi = create<PlatformUi>()((set) => ({ cheatsheet: false, history: false, set: (p) => set(p) }))
export const openCheatsheet = () => usePlatformUi.getState().set({ cheatsheet: true })
export const openHistory = () => usePlatformUi.getState().set({ history: true })

/** Settings section requested from elsewhere (⌘K → a settings page); read once by the Settings screen. */
export const settingsInbox: { section: string | null } = { section: null }
/** Library component requested from ⌘K; read once by the Components screen. */
export const componentsInbox: { id: string | null } = { id: null }
