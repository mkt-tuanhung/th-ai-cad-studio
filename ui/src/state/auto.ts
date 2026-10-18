import { create } from 'zustand'

/** The one-command dialog (opened from the command bar and the Dashboard actions). `jobId`: the AI job it runs
 *  (an AI task preset, or a job resumed from the AI job queue); null = a new job is made when it starts. */
export const useAutoRun = create<{ open: boolean; jobId: string | null; show: (jobId?: string) => void; hide: () => void }>()((set) => ({
  open: false,
  jobId: null,
  show: (jobId) => set({ open: true, jobId: jobId ?? null }),
  hide: () => set({ open: false, jobId: null }),
}))
