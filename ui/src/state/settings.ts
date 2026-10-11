import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Language = 'en' | 'vi'
export type ThemePreference = 'light' | 'dark'

interface SettingsState {
  language: Language
  /** Stored for when a dark theme is approved; only the light theme is designed today. */
  themePreference: ThemePreference
  learningExpanded: boolean
  setLanguage: (lang: Language) => void
  setThemePreference: (t: ThemePreference) => void
  setLearningExpanded: (v: boolean) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      // EN is pre-selected in all approved mockups.
      language: 'en',
      themePreference: 'light',
      learningExpanded: true,
      setLanguage: (language) => {
        document.documentElement.lang = language
        set({ language })
      },
      setThemePreference: (themePreference) => set({ themePreference }),
      setLearningExpanded: (learningExpanded) => set({ learningExpanded }),
    }),
    {
      name: 'thcad.settings',
      version: 1,
      onRehydrateStorage: () => (state) => {
        if (state) document.documentElement.lang = state.language
      },
    },
  ),
)
