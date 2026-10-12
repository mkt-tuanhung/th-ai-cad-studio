import { create } from 'zustand'

/** The one-command dialog (opened from the command bar and the Dashboard actions). */
export const useAutoRun = create<{ open: boolean; show: () => void; hide: () => void }>()((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}))
