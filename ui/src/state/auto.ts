import { create } from 'zustand'

/** The one-command dialog (opened from the command bar and the Dashboard actions). `jobId`: the AI job it runs
 *  (an AI task preset, or a job resumed from the AI job queue); null = a new job is made when it starts.
 *  `files`: files handed over to start with (Scan to CAD → "Build 3D from this picture"), `page` of a PDF. */
export const useAutoRun = create<{ open: boolean; jobId: string | null; files: File[] | null; page: number | null; show: (jobId?: string, files?: File[], page?: number) => void; hide: () => void }>()((set) => ({
  open: false,
  jobId: null,
  files: null,
  page: null,
  show: (jobId, files, page) => set({ open: true, jobId: jobId ?? null, files: files ?? null, page: page ?? null }),
  hide: () => set({ open: false, jobId: null, files: null, page: null }),
}))
